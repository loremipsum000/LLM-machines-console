import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../../../apps/bff/src/auth/authorization"
import {
  type InferenceCoreDatabase,
  getInferenceCoreDb,
} from "../../../apps/bff/src/db/inference-core-client"
import * as schema from "../../../apps/bff/src/db/inference-core-schema"
import {
  updateAdminSettingsOrganization,
  updateAdminSettingsTelemetry,
} from "../../../apps/bff/src/services/admin-settings-core"
import {
  IdempotencyCompletionError,
  completeIdempotency,
} from "../../../apps/bff/src/services/idempotency"
import type { IdentityMutationRouteContext } from "../../../apps/bff/src/services/identity-mutation-journal"

vi.mock(
  "../../../apps/bff/src/db/inference-core-client",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../apps/bff/src/db/inference-core-client")
    >()),
    getInferenceCoreDb: vi.fn(),
  }),
)

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../infra/migrations/0000_inference_core.sql",
      import.meta.url,
    ),
  ),
  "utf8",
)

const admin: Actor = {
  authMode: "service-forwarded",
  role: "admin",
  subject: "admin-settings-atomicity",
}

type CommitWithReceipt = NonNullable<
  IdentityMutationRouteContext["commitWithReceipt"]
>

describe("PR-11 Settings transaction atomicity", () => {
  let client: PGlite
  let database: InferenceCoreDatabase

  beforeEach(async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("BFF_FIXTURE_MODE", "false")
    for (const name of [
      "KEYCLOAK_ADMIN_BASE_URL",
      "KEYCLOAK_ADMIN_REALM",
      "KEYCLOAK_ADMIN_CLIENT_ID",
      "KEYCLOAK_ADMIN_CLIENT_SECRET",
      "ADMIN_LITELLM_BASE_URL",
      "ADMIN_LITELLM_API_KEY",
      "ADMIN_GRAFANA_BASE_URL",
      "ADMIN_PROMETHEUS_BASE_URL",
      "ADMIN_ALERTMANAGER_BASE_URL",
      "LIFECYCLE_SERVICE_BASE_URL",
      "FIRECRAWL_INSTALLED",
    ]) {
      vi.stubEnv(name, "")
    }

    client = await PGlite.create()
    await client.exec(migration)
    database = drizzle(client, { schema }) as unknown as InferenceCoreDatabase
    vi.mocked(getInferenceCoreDb).mockReturnValue(database)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    await client.close()
  })

  it("rolls back actor and organization writes when the success audit fails", async () => {
    const before = await committedSettingsState(database)
    const receipt = await createReceiptCommit(database)

    await expect(
      updateAdminSettingsOrganization(
        admin,
        {
          defaultLanguage: "hr",
          organizationName: "Must roll back",
        },
        "invalid correlation id",
        receipt.commitWithReceipt,
      ),
    ).rejects.toThrow(/correlationId/)

    expect(await committedSettingsState(database)).toEqual(before)
    await expect(receiptState(database, receipt.id)).resolves.toMatchObject({
      outcome: null,
      resourceId: null,
      state: "pending",
      statusCode: null,
    })
  })

  it("rolls back actor, telemetry, license, and audit writes when receipt completion fails", async () => {
    const before = await committedSettingsState(database)
    const receipt = await createReceiptCommit(database, true)

    await expect(
      updateAdminSettingsTelemetry(
        admin,
        {
          confirmation: "ENABLE TELEMETRY",
          enabled: true,
        },
        randomUUID(),
        receipt.commitWithReceipt,
      ),
    ).rejects.toBeInstanceOf(IdempotencyCompletionError)

    expect(await committedSettingsState(database)).toEqual(before)
    await expect(receiptState(database, receipt.id)).resolves.toMatchObject({
      outcome: null,
      resourceId: null,
      state: "pending",
      statusCode: null,
    })
  })
})

async function createReceiptCommit(
  database: InferenceCoreDatabase,
  failCompletion = false,
): Promise<{ commitWithReceipt: CommitWithReceipt; id: string }> {
  const id = randomUUID()
  const requestFingerprint = randomDigest()
  await database.insert(schema.idempotencyLedger).values({
    correlationId: randomUUID(),
    expiresAt: new Date(Date.now() + 60_000),
    id,
    idempotencyKeyDigest: randomDigest(),
    keycloakSubjectId: admin.subject,
    operationCode: "POST /api/admin/settings/test",
    requestFingerprint,
  })

  const commitWithReceipt: CommitWithReceipt = async ({
    outcome = "succeeded",
    resourceId,
    run,
    statusCode = 200,
  }) =>
    database.transaction(async (transaction) => {
      const result = await run(transaction)
      const completed = await completeIdempotency(
        {
          outcome,
          requestHash: failCompletion ? "f".repeat(64) : requestFingerprint,
          resourceId,
          statusCode,
          storeKey: id,
        },
        transaction,
      )
      if (!completed) {
        throw new IdempotencyCompletionError("Synthetic receipt failure.")
      }
      return result
    })

  return { commitWithReceipt, id }
}

async function committedSettingsState(database: InferenceCoreDatabase) {
  return {
    audit: await database.select().from(schema.auditEvents),
    identityRoles: await database.select().from(schema.humanIdentityRoles),
    identities: await database.select().from(schema.humanIdentities),
    license: await database.select().from(schema.licenseState),
    settings: await database.select().from(schema.consoleSettings),
  }
}

async function receiptState(database: InferenceCoreDatabase, id: string) {
  const receipts = await database
    .select({
      id: schema.idempotencyLedger.id,
      outcome: schema.idempotencyLedger.outcome,
      resourceId: schema.idempotencyLedger.resourceId,
      state: schema.idempotencyLedger.state,
      statusCode: schema.idempotencyLedger.statusCode,
    })
    .from(schema.idempotencyLedger)
  return receipts.find((receipt) => receipt.id === id)
}

function randomDigest(): string {
  return randomUUID().replaceAll("-", "").repeat(2)
}
