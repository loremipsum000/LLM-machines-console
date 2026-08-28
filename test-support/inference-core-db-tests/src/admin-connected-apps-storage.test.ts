import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../../../apps/bff/src/auth/authorization"
import {
  type InferenceCoreTransaction,
  getInferenceCoreDb,
} from "../../../apps/bff/src/db/inference-core-client"
import * as schema from "../../../apps/bff/src/db/inference-core-schema"
import {
  createAdminConnectedApp,
  deleteAdminConnectedApp,
  disableAdminConnectedApp,
  enableAdminConnectedApp,
  recordConnectedAppModelsConnection,
  resetConnectedAppsForTest,
  resolveConnectedAppRuntimeIdentityByApiKey,
  revokeAdminConnectedAppCredential,
} from "../../../apps/bff/src/services/admin-connected-apps"
import {
  IdempotencyCompletionError,
  completeIdempotency,
  reserveIdempotency,
  resetIdempotencyForTest,
} from "../../../apps/bff/src/services/idempotency"
import {
  IdentityMutationExecutionError,
  IdentityMutationReconciliationRequiredError,
  type IdentityMutationRouteContext,
  resetIdentityMutationJournalForTest,
} from "../../../apps/bff/src/services/identity-mutation-journal"

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
const actor: Actor = {
  authMode: "service-forwarded",
  role: "admin",
  subject: "admin-storage-test",
}
const staticRevealEndpoints = {
  bffBaseUrl: "https://api.example.test",
  openAiBaseUrl: "https://api.example.test/v1",
  tokenUrl: null,
} as const
const oauthRevealEndpoints = {
  ...staticRevealEndpoints,
  tokenUrl:
    "https://identity.example.test/realms/llm-machines-applications/protocol/openid-connect/token",
} as const

let database: PGlite
let inferenceDb: NonNullable<ReturnType<typeof getInferenceCoreDb>>
const databaseQueries: string[] = []

describe("connected app credential lifecycle in PostgreSQL", () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-31T12:00:00.000Z"))
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    database = await PGlite.create()
    await database.exec(migration)
    databaseQueries.length = 0
    inferenceDb = drizzle(database, {
      logger: {
        logQuery(query) {
          databaseQueries.push(query)
        },
      },
      schema,
    }) as unknown as NonNullable<ReturnType<typeof getInferenceCoreDb>>
    vi.mocked(getInferenceCoreDb).mockReturnValue(inferenceDb)
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    resetIdentityMutationJournalForTest()
    resetIdempotencyForTest()
    await resetConnectedAppsForTest()
    await database.close()
  })

  it("rolls soft delete back on audit failure, then atomically revokes every credential and removes stale auth", async () => {
    const created = await createAdminConnectedApp(
      actor,
      connectedAppRequest("api_key"),
    )
    if (
      created.status !== "created" ||
      created.credential.authMethod !== "api_key"
    ) {
      throw new Error("Expected the initial static credential.")
    }
    const activeKey = created.credential.apiKey
    const activeCredentialId = created.credential.credentialId

    await database.exec(`
      ALTER TABLE common.audit_events
      ADD CONSTRAINT pr06_test_fail_delete_audit
      CHECK (action <> 'admin.connected_app.deleted')
    `)
    databaseQueries.length = 0
    try {
      await expect(
        deleteAdminConnectedApp(actor, created.app.id),
      ).rejects.toThrow()
    } finally {
      await database.exec(`
        ALTER TABLE common.audit_events
        DROP CONSTRAINT pr06_test_fail_delete_audit
      `)
    }
    expectApplicationLockBeforeCredentialWrite(databaseQueries)

    expect(await storedDeleteState(created.app.id)).toEqual({
      applicationStatus: "enabled",
      audit: [],
      credentials: [
        { id: activeCredentialId, revoked_at: null, status: "active" },
      ],
    })
    await expect(
      resolveConnectedAppRuntimeIdentityByApiKey(activeKey),
    ).resolves.toMatchObject({ appId: created.app.id })

    const deleted = await deleteAdminConnectedApp(actor, created.app.id)
    expect(deleted).toEqual({
      app: null,
      applicationId: created.app.id,
      detail: "Key deleted. Its identifiers and audit history remain.",
      status: "deleted",
    })
    const stored = await storedDeleteState(created.app.id)
    expect(stored.applicationStatus).toBe("deleted")
    expect(stored.credentials).toHaveLength(1)
    expect(
      stored.credentials.every(
        (credential) =>
          credential.status === "revoked" &&
          credential.revoked_at instanceof Date,
      ),
    ).toBe(true)
    expect(stored.audit).toEqual([
      {
        application_id: created.app.id,
        credential_record_id: activeCredentialId,
        keycloak_subject_id: actor.subject,
      },
    ])
    await expect(
      resolveConnectedAppRuntimeIdentityByApiKey(activeKey),
    ).resolves.toBeNull()
  })

  it("does not create an OAuth client without durable identity mutation context", async () => {
    const created = await createAdminConnectedApp(
      actor,
      connectedAppRequest("oauth_client_credentials"),
    )
    expect(created).toEqual({
      detail: "Durable OAuth identity mutation state is unavailable.",
      status: "blocked",
    })
    expect(await applicationCount()).toBe(0)
  })

  it("rolls back static create state when PostgreSQL receipt completion fails", async () => {
    const receipt = await atomicReceiptContext({
      failCompletion: true,
      operationCode: "application.static.create",
      statusCode: 201,
    })

    const error = await captureRejectedError(
      createAdminConnectedApp(
        actor,
        connectedAppRequest("api_key"),
        receipt.context,
        staticRevealEndpoints,
      ),
    )

    expect(error).toBeInstanceOf(Error)
    expect(receipt.resourceIds).toEqual([
      expect.stringMatching(/^app-[0-9a-f-]+$/),
    ])
    expect(await localMutationState(receipt.ledgerId)).toEqual({
      applications: 0,
      auditEvents: 0,
      credentials: 0,
      humanIdentities: 0,
      receipt: { resource_id: null, state: "pending" },
    })
  })

  it("rolls back OAuth create, retains the Keycloak fence, and blocks same and new keys", async () => {
    const receipt = await atomicReceiptContext({
      failCompletion: true,
      operationCode: "application.oauth.create",
      statusCode: 201,
    })

    const error = await captureRejectedError(
      createAdminConnectedApp(
        actor,
        connectedAppRequest("oauth_client_credentials"),
        receipt.context,
        oauthRevealEndpoints,
      ),
    )
    expect(error).toBeInstanceOf(IdentityMutationReconciliationRequiredError)
    const reconciliation = await identityReconciliationState(receipt.ledgerId)
    expect(reconciliation).toMatchObject({
      reconciliation_reason: "completion_persistence_failed",
      state: "reconciliation_required",
      target_identifier: expect.stringMatching(/^llmm-app-/),
    })
    expect(reconciliation.resource_id).toMatch(/^fixture-[0-9a-f-]+$/)
    expect(receipt.resourceIds).toEqual([
      expect.stringMatching(/^app-[0-9a-f-]+$/),
    ])
    expect(reconciliation.resource_id).not.toBe(receipt.resourceIds[0])
    expect(JSON.stringify(error)).not.toContain(reconciliation.resource_id)
    expect(error.message).not.toContain(
      reconciliation.resource_id ?? "fixture-",
    )
    expect(await localMutationState(receipt.ledgerId)).toEqual({
      applications: 0,
      auditEvents: 0,
      credentials: 0,
      humanIdentities: 0,
      receipt: { resource_id: null, state: "pending" },
    })
    await expect(reserveIdempotency(receipt.request)).resolves.toEqual({
      status: "reconciliation_required",
    })

    const newKey = await atomicReceiptContext({
      failCompletion: false,
      operationCode: "application.oauth.create",
      statusCode: 201,
    })
    const blocked = await captureRejectedError(
      createAdminConnectedApp(
        actor,
        connectedAppRequest("oauth_client_credentials"),
        newKey.context,
        oauthRevealEndpoints,
      ),
    )
    expect(blocked).toBeInstanceOf(IdentityMutationExecutionError)
    expect((blocked as IdentityMutationExecutionError).status).toBe(
      "blocked_by_active_reconciliation",
    )
    expect(newKey.resourceIds).toEqual([])
    expect(await identityJournalCount()).toBe(1)
    expect(await applicationCount()).toBe(0)
  })

  it("does not re-enable after the active credential is concurrently revoked", async () => {
    const created = await createAdminConnectedApp(
      actor,
      connectedAppRequest("api_key"),
    )
    if (created.status !== "created") {
      throw new Error("Expected an Application.")
    }
    await disableAdminConnectedApp(actor, created.app.id)
    const activeCredential = created.app.credentials.find(
      (credential) => credential.status === "active",
    )
    if (!activeCredential) {
      throw new Error("Expected an active credential.")
    }
    const paused = pauseNextTransaction(inferenceDb)
    vi.mocked(getInferenceCoreDb).mockReturnValue(paused.db)
    const enabling = enableAdminConnectedApp(actor, created.app.id)

    await paused.started
    vi.mocked(getInferenceCoreDb).mockReturnValue(inferenceDb)
    databaseQueries.length = 0
    const revoked = await revokeAdminConnectedAppCredential(
      actor,
      created.app.id,
      activeCredential.id,
    )
    expectApplicationLockBeforeCredentialWrite(databaseQueries)
    paused.release()
    const enabled = await enabling

    expect(revoked.status).toBe("revoked")
    expect(enabled).toEqual({
      detail: "An active credential is required before enabling the Key.",
      status: "blocked",
    })
    expect(await storedApplicationState(created.app.id)).toMatchObject({
      activeCredentials: 0,
      reenableAudits: 0,
      status: "disabled",
    })
  })

  it("atomically records active-key connection evidence", async () => {
    const created = await createAdminConnectedApp(
      actor,
      connectedAppRequest("api_key"),
    )
    if (
      created.status !== "created" ||
      created.credential.authMethod !== "api_key"
    ) {
      throw new Error("Expected a static Application credential.")
    }
    const activeIdentity = await resolveConnectedAppRuntimeIdentityByApiKey(
      created.credential.apiKey,
    )
    if (!activeIdentity) {
      throw new Error("Expected the active key to be usable.")
    }

    databaseQueries.length = 0
    await expect(
      recordConnectedAppModelsConnection(activeIdentity, "active-key-models"),
    ).resolves.toBe(true)
    expectApplicationLockBeforeCredentialWrite(databaseQueries)

    const state = await storedApplicationState(created.app.id)
    expect(state).toMatchObject({
      connectionStatus: "connected",
      lastConnectedAt: expect.any(Date),
      modelsAudits: 1,
    })
    const credential = await database.query<{
      last_used_at: Date | null
      status: string
    }>(
      `SELECT last_used_at, status
       FROM admin.application_credentials
       WHERE id = $1`,
      [created.credential.credentialId],
    )
    expect(credential.rows).toEqual([
      {
        last_used_at: new Date("2026-07-31T12:00:00.000Z"),
        status: "active",
      },
    ])
  })
})

function connectedAppRequest(
  authMethod: "api_key" | "oauth_client_credentials",
) {
  return {
    allowedModels: ["local-a"],
    authMethod,
    description: "PostgreSQL lifecycle test.",
    maxConcurrentRequests: null,
    maxContextBytes: null,
    modelMode: "manual" as const,
    name: `Lifecycle ${authMethod}`,
    rateLimitRps: null,
    tokenAlertThreshold7d: null,
  }
}

async function applicationCount(): Promise<number> {
  const result = await database.query<{ count: number }>(
    "SELECT count(*)::integer AS count FROM admin.applications",
  )
  return result.rows[0]?.count ?? -1
}

async function storedDeleteState(appId: string) {
  const [application, credentials, audit] = await Promise.all([
    database.query<{ status: string }>(
      "SELECT status FROM admin.applications WHERE id = $1",
      [appId],
    ),
    database.query<{
      id: string
      revoked_at: Date | null
      status: string
    }>(
      `SELECT id, revoked_at, status
       FROM admin.application_credentials
       WHERE app_id = $1
       ORDER BY issued_at`,
      [appId],
    ),
    database.query<{
      application_id: string
      credential_record_id: string
      keycloak_subject_id: string
    }>(
      `SELECT application_id, credential_record_id, keycloak_subject_id
       FROM common.audit_events
       WHERE action = 'admin.connected_app.deleted'`,
    ),
  ])
  return {
    applicationStatus: application.rows[0]?.status ?? "missing",
    audit: audit.rows,
    credentials: credentials.rows,
  }
}

async function storedApplicationState(appId: string) {
  const [application, activeCredentials, audit] = await Promise.all([
    database.query<{
      connection_status: string
      last_connected_at: Date | null
      status: string
    }>(
      `SELECT connection_status, last_connected_at, status
       FROM admin.applications
       WHERE id = $1`,
      [appId],
    ),
    database.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM admin.application_credentials
       WHERE app_id = $1 AND status = 'active'`,
      [appId],
    ),
    database.query<{ action: string }>(
      `SELECT action
       FROM common.audit_events
       WHERE application_id = $1`,
      [appId],
    ),
  ])
  const actions = audit.rows.map((row) => row.action)
  return {
    activeCredentials: activeCredentials.rows[0]?.count ?? -1,
    connectionStatus: application.rows[0]?.connection_status ?? "missing",
    lastConnectedAt: application.rows[0]?.last_connected_at ?? null,
    modelsAudits: actions.filter(
      (action) => action === "connected_app.gateway.models",
    ).length,
    reenableAudits: actions.filter(
      (action) => action === "admin.connected_app.reenabled",
    ).length,
    status: application.rows[0]?.status ?? "missing",
    updateAudits: actions.filter(
      (action) => action === "admin.connected_app.updated",
    ).length,
  }
}

let atomicReceiptSequence = 0

async function atomicReceiptContext(input: {
  failCompletion: boolean
  operationCode: string
  statusCode: number
}): Promise<{
  context: IdentityMutationRouteContext
  ledgerId: string
  request: Parameters<typeof reserveIdempotency>[0]
  resourceIds: Array<string | null>
}> {
  atomicReceiptSequence += 1
  const requestHash = atomicReceiptSequence.toString(16).padStart(64, "0")
  const request = {
    actorId: actor.subject,
    correlationId: `atomic-receipt-${atomicReceiptSequence}`,
    idempotencyKey: `atomic-receipt-key-${atomicReceiptSequence}`,
    requestHash,
    route: input.operationCode,
  }
  const reservation = await reserveIdempotency(request)
  if (reservation.status !== "reserved") {
    throw new Error(
      `Expected an idempotency reservation, got ${reservation.status}.`,
    )
  }
  const resourceIds: Array<string | null> = []
  const complete = async (
    resourceId: string | null,
    transaction?: InferenceCoreTransaction,
  ) => {
    const completed = await completeIdempotency(
      {
        outcome: "succeeded",
        requestHash: input.failCompletion ? "f".repeat(64) : requestHash,
        resourceId,
        statusCode: input.statusCode,
        storeKey: reservation.storeKey,
      },
      transaction,
    )
    if (!completed) {
      throw new IdempotencyCompletionError(
        "Synthetic durable receipt completion failure.",
      )
    }
  }
  const context: IdentityMutationRouteContext = {
    commitWithReceipt: async ({ resourceId, run }) => {
      resourceIds.push(resourceId)
      return inferenceDb.transaction(async (transaction) => {
        const value = await run(transaction)
        await complete(resourceId, transaction)
        return value
      })
    },
    finalizeReceipt: async ({ resourceId }) => complete(resourceId),
    idempotencyLedgerId: reservation.storeKey,
    operationCode: input.operationCode,
    requestFingerprint: requestHash,
  }
  return {
    context,
    ledgerId: reservation.storeKey,
    request,
    resourceIds,
  }
}

async function captureRejectedError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    if (error instanceof Error) {
      return error
    }
    throw new Error("Expected a rejected Error value.")
  }
  throw new Error("Expected the operation to reject.")
}

async function localMutationState(ledgerId: string) {
  const [applications, credentials, auditEvents, humanIdentities, receipt] =
    await Promise.all([
      database.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM admin.applications",
      ),
      database.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM admin.application_credentials",
      ),
      database.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM common.audit_events",
      ),
      database.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM common.human_identities",
      ),
      database.query<{ resource_id: string | null; state: string }>(
        `SELECT resource_id, state
         FROM admin.idempotency_ledger
         WHERE id = $1`,
        [ledgerId],
      ),
    ])
  return {
    applications: applications.rows[0]?.count ?? -1,
    auditEvents: auditEvents.rows[0]?.count ?? -1,
    credentials: credentials.rows[0]?.count ?? -1,
    humanIdentities: humanIdentities.rows[0]?.count ?? -1,
    receipt: receipt.rows[0] ?? null,
  }
}

async function identityReconciliationState(ledgerId: string) {
  const result = await database.query<{
    reconciliation_reason: string | null
    resource_id: string | null
    state: string
    target_identifier: string
  }>(
    `SELECT reconciliation_reason, resource_id, state, target_identifier
     FROM admin.identity_mutation_journal
     WHERE idempotency_ledger_id = $1`,
    [ledgerId],
  )
  return result.rows[0] ?? null
}

async function identityJournalCount(): Promise<number> {
  const result = await database.query<{ count: number }>(
    "SELECT count(*)::integer AS count FROM admin.identity_mutation_journal",
  )
  return result.rows[0]?.count ?? -1
}

function pauseNextTransaction(
  db: NonNullable<ReturnType<typeof getInferenceCoreDb>>,
) {
  return pauseTransaction(db, 1)
}

function pauseTransaction(
  db: NonNullable<ReturnType<typeof getInferenceCoreDb>>,
  ordinal: number,
) {
  let release: () => void = () => {}
  let signalStarted: () => void = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve
  })
  let transactionCount = 0
  const proxy = new Proxy(db, {
    get(target, property) {
      if (property === "transaction") {
        return async (...args: unknown[]) => {
          transactionCount += 1
          if (transactionCount === ordinal) {
            signalStarted()
            await released
          }
          return Reflect.apply(target.transaction, target, args)
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  return { db: proxy, release, started }
}

function expectApplicationLockBeforeCredentialWrite(queries: string[]): void {
  const lockIndex = queries.findIndex(
    (query) =>
      query.includes('from "admin"."applications"') &&
      query.toLowerCase().includes("for update"),
  )
  const credentialWriteIndex = queries.findIndex(
    (query) =>
      query.includes('"admin"."application_credentials"') &&
      /^(insert into|update) /i.test(query.trim()),
  )
  expect(lockIndex).toBeGreaterThanOrEqual(0)
  expect(credentialWriteIndex).toBeGreaterThan(lockIndex)
}
