import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Actor } from "../../../apps/bff/src/auth/authorization"
import type { InferenceCoreDatabase } from "../../../apps/bff/src/db/inference-core-client"
import * as schema from "../../../apps/bff/src/db/inference-core-schema"
import {
  AdminAlertEgressConflictError,
  AdminAlertEgressUnavailableError,
  getAdminAlertEgress,
  updateAdminAlertEgress,
} from "../../../apps/bff/src/services/admin-alert-egress"
import {
  IdempotencyCompletionError,
  completeIdempotency,
} from "../../../apps/bff/src/services/idempotency"
import type { IdentityMutationRouteContext } from "../../../apps/bff/src/services/identity-mutation-journal"

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
  subject: "admin-alert-egress-db",
}

const alertEgressOperation = "POST /api/admin/observability/alert-egress"
type CommitWithReceipt = NonNullable<
  IdentityMutationRouteContext["commitWithReceipt"]
>

describe("PR-09 alert egress persistence", () => {
  let client: PGlite
  let database: InferenceCoreDatabase

  beforeEach(async () => {
    client = await PGlite.create()
    await client.exec(migration)
    database = drizzle(client, { schema }) as unknown as InferenceCoreDatabase
  })

  afterEach(async () => {
    await client.close()
  })

  it("atomically records redacted intent, acknowledgement, and audit metadata", async () => {
    const [initialSettings] = await database
      .select({
        sharedUpdatedAt: schema.consoleSettings.updatedAt,
        sharedUpdatedBy: schema.consoleSettings.updatedBy,
      })
      .from(schema.consoleSettings)
    const receipt = await createReceiptCommit(database)

    await expect(getAdminAlertEgress(database)).resolves.toMatchObject({
      deliveryState: "disabled",
      revision: 0,
      transport: "disabled",
      updatedAt: null,
      updatedBySubjectId: null,
    })

    const prepared = await updateAdminAlertEgress(
      admin,
      "db-alert-egress-1",
      {
        expectedRevision: 0,
        transport: "webhook",
        warningAcknowledgement: {
          accepted: true,
          version: "alert-egress-v1",
        },
      },
      receipt.commitWithReceipt,
      database,
    )

    expect(prepared).toMatchObject({
      deliveryState: "prepared_pending_runtime_qualification",
      destinationState: "not_stored",
      outboundDeliveryEnabled: false,
      revision: 1,
      runtimeQualified: false,
      secretState: "not_stored",
      transport: "webhook",
      warningAcknowledgedBySubjectId: admin.subject,
    })
    const [settings] = await database
      .select({
        alertUpdatedAt: schema.consoleSettings.alertEgressUpdatedAt,
        alertUpdatedBy: schema.consoleSettings.alertEgressUpdatedBy,
        sharedUpdatedAt: schema.consoleSettings.updatedAt,
        sharedUpdatedBy: schema.consoleSettings.updatedBy,
      })
      .from(schema.consoleSettings)
    expect(settings).toMatchObject({
      alertUpdatedAt: expect.any(Date),
      alertUpdatedBy: admin.subject,
      sharedUpdatedAt: initialSettings?.sharedUpdatedAt,
      sharedUpdatedBy: initialSettings?.sharedUpdatedBy,
    })
    const audit = await client.query<{
      action: string
      correlation_id: string
      keycloak_subject_id: string
    }>(`
      SELECT action, correlation_id, keycloak_subject_id
      FROM common.audit_events
      WHERE action = 'admin.observability.alert_egress.updated'
    `)
    expect(audit.rows).toEqual([
      {
        action: "admin.observability.alert_egress.updated",
        correlation_id: "db-alert-egress-1",
        keycloak_subject_id: admin.subject,
      },
    ])
    const completedReceipt = (
      await database
        .select({
          id: schema.idempotencyLedger.id,
          outcome: schema.idempotencyLedger.outcome,
          resourceId: schema.idempotencyLedger.resourceId,
          state: schema.idempotencyLedger.state,
          statusCode: schema.idempotencyLedger.statusCode,
        })
        .from(schema.idempotencyLedger)
    ).find((candidate) => candidate.id === receipt.id)
    expect(completedReceipt).toMatchObject({
      outcome: "succeeded",
      resourceId: "singleton",
      state: "completed",
      statusCode: 200,
    })
  })

  it("rejects a stale revision and clears acknowledgement when disabled", async () => {
    const prepareReceipt = await createReceiptCommit(database)
    await updateAdminAlertEgress(
      admin,
      "db-alert-egress-prepare",
      {
        expectedRevision: 0,
        transport: "smtp",
        warningAcknowledgement: {
          accepted: true,
          version: "alert-egress-v1",
        },
      },
      prepareReceipt.commitWithReceipt,
      database,
    )
    const staleReceipt = await createReceiptCommit(database)
    await expect(
      updateAdminAlertEgress(
        admin,
        "db-alert-egress-stale",
        {
          expectedRevision: 0,
          transport: "webhook",
          warningAcknowledgement: {
            accepted: true,
            version: "alert-egress-v1",
          },
        },
        staleReceipt.commitWithReceipt,
        database,
      ),
    ).rejects.toBeInstanceOf(AdminAlertEgressConflictError)

    const disableReceipt = await createReceiptCommit(database)
    const disabled = await updateAdminAlertEgress(
      admin,
      "db-alert-egress-disable",
      {
        expectedRevision: 1,
        transport: "disabled",
        warningAcknowledgement: null,
      },
      disableReceipt.commitWithReceipt,
      database,
    )
    expect(disabled).toMatchObject({
      deliveryState: "disabled",
      revision: 2,
      transport: "disabled",
      warningAcknowledgedAt: null,
      warningAcknowledgedBySubjectId: null,
      warningVersion: null,
    })
    const rows = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM common.audit_events
      WHERE action = 'admin.observability.alert_egress.updated'
    `)
    expect(rows.rows).toEqual([{ count: 2 }])
  })

  it("rolls back state and audit when durable receipt completion fails", async () => {
    const receipt = await createReceiptCommit(database, true)

    await expect(
      updateAdminAlertEgress(
        admin,
        "db-alert-egress-receipt-failure",
        {
          expectedRevision: 0,
          transport: "webhook",
          warningAcknowledgement: {
            accepted: true,
            version: "alert-egress-v1",
          },
        },
        receipt.commitWithReceipt,
        database,
      ),
    ).rejects.toBeInstanceOf(IdempotencyCompletionError)

    await expect(getAdminAlertEgress(database)).resolves.toMatchObject({
      revision: 0,
      transport: "disabled",
      updatedAt: null,
      updatedBySubjectId: null,
    })
    const audit = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM common.audit_events
      WHERE action = 'admin.observability.alert_egress.updated'
    `)
    expect(audit.rows).toEqual([{ count: 0 }])
    const pendingReceipt = (
      await database
        .select({
          id: schema.idempotencyLedger.id,
          outcome: schema.idempotencyLedger.outcome,
          resourceId: schema.idempotencyLedger.resourceId,
          state: schema.idempotencyLedger.state,
          statusCode: schema.idempotencyLedger.statusCode,
        })
        .from(schema.idempotencyLedger)
    ).find((candidate) => candidate.id === receipt.id)
    expect(pendingReceipt).toMatchObject({
      outcome: null,
      resourceId: null,
      state: "pending",
      statusCode: null,
    })
  })

  it("fails closed when durable receipt finalization is absent", async () => {
    await expect(
      updateAdminAlertEgress(
        admin,
        "db-alert-egress-no-receipt",
        {
          expectedRevision: 0,
          transport: "disabled",
          warningAcknowledgement: null,
        },
        undefined,
        database,
      ),
    ).rejects.toBeInstanceOf(AdminAlertEgressUnavailableError)

    await expect(getAdminAlertEgress(database)).resolves.toMatchObject({
      revision: 0,
      updatedAt: null,
      updatedBySubjectId: null,
    })
  })

  it("has no destination or secret-bearing persistence columns", async () => {
    const columns = await client.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'admin'
        AND table_name = 'console_settings'
      ORDER BY column_name
    `)
    expect(columns.rows.map(({ column_name }) => column_name)).not.toEqual(
      expect.arrayContaining([
        "alert_destination",
        "alert_email",
        "alert_host",
        "alert_password",
        "alert_recipient",
        "alert_secret",
        "alert_token",
        "alert_url",
      ]),
    )
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
    operationCode: alertEgressOperation,
    requestFingerprint,
  })

  const commitWithReceipt: CommitWithReceipt = async ({ resourceId, run }) =>
    database.transaction(async (transaction) => {
      const result = await run(transaction)
      const completed = await completeIdempotency(
        {
          outcome: "succeeded",
          requestHash: failCompletion ? "f".repeat(64) : requestFingerprint,
          resourceId,
          statusCode: 200,
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

function randomDigest(): string {
  return randomUUID().replaceAll("-", "").repeat(2)
}
