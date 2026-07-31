import type { SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getInferenceCoreDb } from "../db/inference-core-client"
import {
  type ConnectedAppRuntimeIdentity,
  admitConnectedAppGatewayUsage,
  consumeConnectedAppGatewayRateLimit,
  reconcileConnectedAppGatewayUsage,
} from "./admin-connected-apps"

vi.mock("../db/inference-core-client", () => ({
  getInferenceCoreDb: vi.fn(),
}))

const app: ConnectedAppRuntimeIdentity = {
  allowedModels: ["local-a"],
  appId: "app-accounting-test",
  appName: "Accounting Test",
  authMethod: "api_key",
  clientId: "llmm_test",
  credentialRecordId: "cak-accounting-test",
  keycloakSubjectId: null,
  rateLimitRpm: 10,
  status: "enabled",
  tokenBudget7d: 100_000,
  usage: {
    failures7d: 0,
    lastUsedAt: null,
    requests7d: 0,
    tokens7d: 0,
  },
}

describe("connected app PostgreSQL coordination", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("increments a requests-per-minute window atomically", async () => {
    const execute = vi.fn(async (_statement: unknown) => [{ request_count: 1 }])
    vi.mocked(getInferenceCoreDb).mockReturnValue({
      execute,
    } as unknown as ReturnType<typeof getInferenceCoreDb>)

    await expect(consumeConnectedAppGatewayRateLimit(app)).resolves.toEqual({
      ok: true,
    })

    const query = sqlQuery(execute.mock.calls[0]?.[0])
    expect(query.sql).toContain(
      "INSERT INTO admin.application_rate_limit_windows",
    )
    expect(query.sql).toContain("ON CONFLICT (app_id, window_started_at)")
    expect(query.sql).toContain("request_count + 1")
    expect(query.sql).toContain("RETURNING request_count")
    expect(query.params).toContain(app.appId)
    expect(query.params).toContain(app.rateLimitRpm)
  })

  it("fails closed when a rate limit needs PostgreSQL outside fixture mode", async () => {
    vi.stubEnv("BFF_FIXTURE_MODE", "false")
    vi.stubEnv("NODE_ENV", "production")
    vi.mocked(getInferenceCoreDb).mockReturnValue(null)

    await expect(
      consumeConnectedAppGatewayRateLimit(app),
    ).resolves.toMatchObject({
      ok: false,
      status: 503,
      title: "Rate limit backend unavailable",
    })
  })

  it("does not require PostgreSQL when the rate limit is disabled", async () => {
    vi.stubEnv("BFF_FIXTURE_MODE", "false")
    vi.stubEnv("NODE_ENV", "production")
    vi.mocked(getInferenceCoreDb).mockReturnValue(null)

    await expect(
      consumeConnectedAppGatewayRateLimit({ ...app, rateLimitRpm: null }),
    ).resolves.toEqual({ ok: true })
  })

  it("fails closed while seven-day token-budget enforcement is not qualified", async () => {
    await expect(admitConnectedAppGatewayUsage(app)).resolves.toEqual({
      detail:
        "Seven-day token-budget enforcement is unavailable until total-token admission and streaming reconciliation are qualified.",
      ok: false,
      status: 503,
      title: "Token budget enforcement not qualified",
    })
    expect(getInferenceCoreDb).not.toHaveBeenCalled()
  })

  it("creates only a zero-value accounting marker when the token limit is disabled", async () => {
    await expect(
      admitConnectedAppGatewayUsage({ ...app, tokenBudget7d: null }),
    ).resolves.toEqual({
      context: {
        appId: app.appId,
        bucketDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        credentialId: app.credentialRecordId,
      },
      ok: true,
    })
    expect(getInferenceCoreDb).not.toHaveBeenCalled()
  })

  it("reconciles usage and credential activity without payload retention", async () => {
    const execute = vi.fn(async (_statement: unknown) => [])
    vi.mocked(getInferenceCoreDb).mockReturnValue({
      execute,
    } as unknown as ReturnType<typeof getInferenceCoreDb>)

    await reconcileConnectedAppGatewayUsage(
      app,
      {
        latencyMs: 25,
        model: "local-a",
        status: 200,
        tokens: 42,
      },
      {
        appId: app.appId,
        bucketDate: "2026-07-31",
        credentialId: app.credentialRecordId,
      },
    )

    const query = sqlQuery(execute.mock.calls[0]?.[0])
    expect(query.sql).toContain("admin.application_usage_daily")
    expect(query.sql).not.toContain("admin.applications")
    expect(query.sql).toContain("admin.application_credentials")
    expect(query.sql).not.toContain("reserved_tokens")
    expect(query.sql).not.toContain("usage_summary")
    expect(query.params).not.toContainEqual(expect.any(Date))
    expect(query.params).toContainEqual(expect.stringMatching(ISO_TIMESTAMP))
  })
})

function sqlQuery(statement: unknown) {
  expect(statement).toBeDefined()
  return new PgDialect().sqlToQuery(statement as SQL)
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
