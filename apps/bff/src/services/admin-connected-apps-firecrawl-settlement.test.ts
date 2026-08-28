import { randomUUID } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/authorization"
import type { InferenceCoreTransaction } from "../db/inference-core-client"
import {
  applicationFirecrawlAccess,
  applicationFirecrawlRequestLedger,
  applicationFirecrawlUsageDaily,
  auditEvents,
} from "../db/inference-core-schema"
import type { IdentityMutationRouteContext } from "./identity-mutation-journal"

const settlementMocks = vi.hoisted(() => ({
  emitAudit: vi.fn(),
  getInferenceCoreDb: vi.fn(),
}))

vi.mock("../db/inference-core-client", () => ({
  getInferenceCoreDb: settlementMocks.getInferenceCoreDb,
}))

vi.mock("./audit", () => ({
  emitAudit: settlementMocks.emitAudit,
}))

import {
  enableAdminConnectedAppFirecrawl,
  getAdminConnectedAppFirecrawlProjection,
  initializeAdminConnectedAppFirecrawlForParent,
  recordAdminConnectedAppFirecrawlConnection,
  resetAdminConnectedAppFirecrawlForTest,
  settleAdminConnectedAppFirecrawlRequest,
} from "./admin-connected-apps-firecrawl"

const actor: Actor = {
  authMode: "service-forwarded",
  role: "admin",
  subject: "keycloak-admin-1",
}

describe("Firecrawl terminal settlement persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-01T00:00:01.000Z"))
    settlementMocks.emitAudit.mockReset()
    settlementMocks.getInferenceCoreDb.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetAdminConnectedAppFirecrawlForTest()
    vi.useRealTimers()
  })

  it("writes the terminal audit and start-day usage through one transaction", async () => {
    const inserts: Array<{ table: unknown; values: Record<string, unknown> }> =
      []
    const updates: Array<{ table: unknown; values: Record<string, unknown> }> =
      []
    const transaction = {
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          inserts.push({ table, values })
          return table === applicationFirecrawlUsageDaily
            ? { onConflictDoUpdate: async () => [] }
            : Promise.resolve([])
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => ({
              for: async () => [
                {
                  appId: "app-1",
                  credentialId: "fck-1",
                  id: "00000000-0000-4000-8000-000000000001",
                  routeKind: "search",
                  startedAt: new Date("2026-07-31T23:59:59.000Z"),
                  state: "active",
                },
              ],
            }),
          }),
        }),
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          updates.push({ table, values })
          return { where: async () => [] }
        },
      }),
    } as unknown as InferenceCoreTransaction
    const database = {
      transaction: vi.fn(
        async (run: (executor: InferenceCoreTransaction) => Promise<boolean>) =>
          run(transaction),
      ),
    }
    settlementMocks.getInferenceCoreDb.mockReturnValue(database)

    await expect(
      settleAdminConnectedAppFirecrawlRequest({
        admissionId: "00000000-0000-4000-8000-000000000001",
        applicationId: "app-1",
        correlationId: "request-1",
        credentialRecordId: "fck-1",
        latencyMs: 2_000,
        operation: "search",
        outcome: "succeeded",
        requestBytes: 64,
        responseBytes: 128,
        resultCount: 1,
        status: 200,
      }),
    ).resolves.toBe(true)

    expect(database.transaction).toHaveBeenCalledOnce()
    expect(settlementMocks.emitAudit).not.toHaveBeenCalled()
    expect(
      inserts.find(({ table }) => table === applicationFirecrawlUsageDaily)
        ?.values,
    ).toMatchObject({
      appId: "app-1",
      bucketDate: "2026-07-31",
      credentialId: "fck-1",
      routeKind: "search",
    })
    expect(inserts.find(({ table }) => table === auditEvents)?.values).toEqual(
      expect.objectContaining({
        action: "firecrawl.gateway.search",
        applicationId: "app-1",
        correlationId: "request-1",
        credentialRecordId: "fck-1",
        occurredAt: new Date("2026-08-01T00:00:01.000Z"),
        outcome: "succeeded",
        sourceSystem: "firecrawl",
      }),
    )
    expect(
      updates.find(({ table }) => table === applicationFirecrawlRequestLedger)
        ?.values,
    ).toMatchObject({ state: "settled", statusCode: 200 })
  })

  it("commits connection evidence and its audit through one transaction", async () => {
    const inserts: Array<{ table: unknown; values: Record<string, unknown> }> =
      []
    const updates: Array<{ table: unknown; values: Record<string, unknown> }> =
      []
    const transaction = {
      execute: async () => [
        {
          max_concurrent_scrapes: null,
          scrape_rate_limit_rps: null,
          search_rate_limit_rps: null,
        },
      ],
      insert: (table: unknown) => ({
        values: async (values: Record<string, unknown>) => {
          inserts.push({ table, values })
          return []
        },
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          updates.push({ table, values })
          return {
            where: () => ({ returning: async () => [{ appId: "app-1" }] }),
          }
        },
      }),
    } as unknown as InferenceCoreTransaction
    const database = {
      transaction: vi.fn(
        async (run: (executor: InferenceCoreTransaction) => Promise<boolean>) =>
          run(transaction),
      ),
    }
    settlementMocks.getInferenceCoreDb.mockReturnValue(database)

    await expect(
      recordAdminConnectedAppFirecrawlConnection({
        applicationId: "app-1",
        connectedAt: "2026-07-31T23:59:59.000Z",
        correlationId: "request-connection-1",
        credentialRecordId: "fck-1",
      }),
    ).resolves.toBe(true)

    expect(database.transaction).toHaveBeenCalledOnce()
    expect(settlementMocks.emitAudit).not.toHaveBeenCalled()
    expect(
      updates.find(({ table }) => table === applicationFirecrawlAccess)?.values,
    ).toEqual({
      connectionStatus: "connected",
      lastConnectedAt: new Date("2026-07-31T23:59:59.000Z"),
    })
    expect(inserts.find(({ table }) => table === auditEvents)?.values).toEqual(
      expect.objectContaining({
        action: "firecrawl.gateway.connection_observed",
        applicationId: "app-1",
        correlationId: "request-connection-1",
        credentialRecordId: "fck-1",
        occurredAt: new Date("2026-08-01T00:00:01.000Z"),
        outcome: "succeeded",
        sourceSystem: "firecrawl",
      }),
    )
  })

  it("leaves fixture connection state unchanged when audit persistence fails", async () => {
    configureReadyFirecrawlFixture()
    settlementMocks.getInferenceCoreDb.mockReturnValue(null)
    await initializeAdminConnectedAppFirecrawlForParent(actor, "app-1")
    const enabled = await enableAdminConnectedAppFirecrawl(
      actor,
      "app-1",
      {
        disclaimerAccepted: true,
        maxConcurrentScrapes: null,
        scrapeRateLimitRps: null,
        searchRateLimitRps: null,
      },
      identityContext(),
    )
    if (enabled.status !== "enabled" || !enabled.credential) {
      throw new Error("Expected enabled fixture Firecrawl access.")
    }
    settlementMocks.emitAudit.mockReset()
    settlementMocks.emitAudit.mockRejectedValueOnce(
      new Error("audit unavailable"),
    )

    await expect(
      recordAdminConnectedAppFirecrawlConnection({
        applicationId: "app-1",
        connectedAt: "2026-08-01T00:00:00.000Z",
        correlationId: "request-connection-2",
        credentialRecordId: enabled.credential.credentialId,
      }),
    ).resolves.toBe(false)
    await expect(
      getAdminConnectedAppFirecrawlProjection("app-1"),
    ).resolves.toMatchObject({
      connectionStatus: "not_connected",
      lastConnectedAt: null,
    })
  })
})

function configureReadyFirecrawlFixture(): void {
  vi.stubEnv("DATABASE_URL", "")
  vi.stubEnv("NODE_ENV", "test")
  vi.stubEnv("FIRECRAWL_INSTALLED", "true")
  vi.stubEnv("FIRECRAWL_APPLIANCE_KILL_SWITCH", "false")
  vi.stubEnv("FIRECRAWL_RESOURCE_PROFILE_QUALIFIED", "true")
  vi.stubEnv("FIRECRAWL_EGRESS_POLICY_READY", "true")
  vi.stubEnv("FIRECRAWL_PUBLIC_BASE_URL", "https://bff.example.test")
  vi.stubEnv("FIRECRAWL_UPSTREAM_BASE_URL", "http://firecrawl-api:3002")
  vi.stubEnv("FIRECRAWL_EGRESS_ALLOWED_HOSTS", "example.test")
  vi.stubEnv(
    "FIRECRAWL_EGRESS_ALLOWLIST_DIR",
    "/run/llm-machines/firecrawl/egress-allowlist",
  )
}

function identityContext(): IdentityMutationRouteContext {
  return {
    commitWithReceipt: async <T>(input: {
      resourceId: string | null
      run(transaction: null): Promise<T>
    }) => input.run(null),
    finalizeReceipt: async () => undefined,
    idempotencyLedgerId: randomUUID(),
    operationCode: "firecrawl.enable",
    requestFingerprint: randomUUID(),
  }
}
