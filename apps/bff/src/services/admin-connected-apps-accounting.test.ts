import type { SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getInferenceCoreDb } from "../db/inference-core-client"
import {
  type ConnectedAppGatewayUsageContext,
  type ConnectedAppRuntimeIdentity,
  admitConnectedAppGatewayUsage,
  consumeConnectedAppGatewayRateLimit,
  reconcileConnectedAppGatewayUsage,
  recordConnectedAppGatewayUsage,
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
  maxConcurrentRequests: null,
  maxContextBytes: null,
  rateLimitRps: 10,
  status: "enabled",
  tokenAlertState: "below",
  tokenAlertThreshold7d: 100_000,
  usage: {
    failures7d: 0,
    lastUsedAt: null,
    requests7d: 0,
    tokens7d: 0,
  },
}

const context: ConnectedAppGatewayUsageContext = {
  appId: app.appId,
  bucketDate: "2026-07-31",
  contextBytes: 128,
  credentialId: app.credentialRecordId,
  leaseExpiresAt: "2026-07-31T12:15:00.000Z",
  model: "local-a",
  requestId: "00000000-0000-4000-8000-000000000071",
  route: "chat_completions",
  startedAt: "2026-07-31T12:00:00.000Z",
}

describe("connected app PostgreSQL coordination", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("increments a requests-per-second window atomically", async () => {
    const { execute } = mockAdmissionDatabase([
      [{ id: app.appId }],
      [
        {
          max_concurrent_requests: null,
          max_context_bytes: null,
          requests_per_second: 3,
        },
      ],
      [{ request_count: 1 }],
    ])

    await expect(consumeConnectedAppGatewayRateLimit(app)).resolves.toEqual({
      ok: true,
    })

    expect(sqlQuery(execute.mock.calls[0]?.[0]).sql).toContain(
      "FOR UPDATE OF application",
    )
    const query = sqlQuery(execute.mock.calls[2]?.[0])
    expect(query.sql).toContain(
      "INSERT INTO admin.application_rate_limit_windows",
    )
    expect(query.sql).toContain("date_trunc('second', statement_timestamp())")
    expect(query.sql).toContain("ON CONFLICT (app_id, window_started_at)")
    expect(query.sql).toContain("request_count + 1")
    expect(query.sql).toContain("RETURNING request_count")
    expect(query.params).toContain(app.appId)
    expect(query.params).toContain(3)
  })

  it("fails closed when a configured rate limit loses PostgreSQL", async () => {
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

  it("fails closed when storage is unavailable even if runtime RPS is stale-null", async () => {
    vi.stubEnv("BFF_FIXTURE_MODE", "false")
    vi.stubEnv("NODE_ENV", "production")
    vi.mocked(getInferenceCoreDb).mockReturnValue(null)

    await expect(
      consumeConnectedAppGatewayRateLimit({ ...app, rateLimitRps: null }),
    ).resolves.toMatchObject({ ok: false, status: 503 })
  })

  it("writes a universal request lease without enforcing the token alert", async () => {
    const { execute } = mockAdmissionDatabase([
      [{ id: app.appId }],
      [{ max_concurrent_requests: null, max_context_bytes: null }],
      [
        {
          lease_expires_at: "2026-07-31T12:15:00.000Z",
          started_at: "2026-07-31T12:00:00.000Z",
        },
      ],
    ])

    await expect(
      admitConnectedAppGatewayUsage(app, {
        contextBytes: 128,
        model: "local-a",
        route: "chat_completions",
      }),
    ).resolves.toMatchObject({
      context: {
        appId: app.appId,
        contextBytes: 128,
        credentialId: app.credentialRecordId,
        model: "local-a",
        route: "chat_completions",
      },
      ok: true,
    })

    const lockQuery = sqlQuery(execute.mock.calls[0]?.[0])
    expect(lockQuery.sql).toContain("FOR UPDATE OF application")
    const policyQuery = sqlQuery(execute.mock.calls[1]?.[0])
    expect(policyQuery.sql).not.toContain("token_alert_threshold_7d")
    const leaseQuery = sqlQuery(execute.mock.calls[2]?.[0])
    expect(leaseQuery.sql).toContain(
      "INSERT INTO admin.application_request_ledger",
    )
  })

  it("applies the exact current byte cap before creating a lease", async () => {
    const { execute } = mockAdmissionDatabase([
      [{ id: app.appId }],
      [{ max_concurrent_requests: null, max_context_bytes: "127" }],
    ])

    await expect(
      admitConnectedAppGatewayUsage(
        { ...app, maxContextBytes: 256 },
        {
          contextBytes: 128,
          model: "local-a",
          route: "chat_completions",
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      status: 413,
      title: "Context limit exceeded",
    })
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it("fails closed when universal accounting storage is unavailable", async () => {
    vi.stubEnv("BFF_FIXTURE_MODE", "false")
    vi.stubEnv("NODE_ENV", "production")
    vi.mocked(getInferenceCoreDb).mockReturnValue(null)

    await expect(
      admitConnectedAppGatewayUsage(
        {
          ...app,
          maxConcurrentRequests: null,
          maxContextBytes: null,
          tokenAlertState: null,
          tokenAlertThreshold7d: null,
        },
        { contextBytes: 0, model: null, route: "models" },
      ),
    ).resolves.toMatchObject({
      ok: false,
      status: 503,
      title: "Request protection backend unavailable",
    })
  })

  it("rejects a full current concurrency lease set atomically", async () => {
    const { execute } = mockAdmissionDatabase([
      [{ id: app.appId }],
      [{ max_concurrent_requests: 1, max_context_bytes: null }],
      [{ active_count: 1 }],
    ])

    await expect(
      admitConnectedAppGatewayUsage(
        { ...app, maxConcurrentRequests: 1 },
        {
          contextBytes: 128,
          model: "local-a",
          route: "chat_completions",
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      status: 429,
      title: "Concurrency limit exceeded",
    })
    expect(sqlQuery(execute.mock.calls[2]?.[0]).sql).toContain(
      "lease_expires_at > clock_timestamp()",
    )
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it("settles once and aggregates exact metadata without content", async () => {
    const execute = vi.fn(async (_statement: unknown) => [])
    vi.mocked(getInferenceCoreDb).mockReturnValue({
      execute,
    } as unknown as ReturnType<typeof getInferenceCoreDb>)

    await reconcileConnectedAppGatewayUsage(
      app,
      {
        inputTokens: 12,
        latencyMs: 25,
        model: "local-a",
        outputTokens: 8,
        route: "chat_completions",
        status: 200,
        totalTokens: 42,
      },
      context,
    )

    const query = sqlQuery(execute.mock.calls[0]?.[0])
    expect(query.sql).toContain("admin.application_request_ledger")
    expect(query.sql).toContain("admin.application_usage_daily")
    expect(query.sql).toContain("ON CONFLICT (id)")
    expect(query.sql).toContain("application_request_ledger.state = 'active'")
    expect(query.sql).toContain("latency_ms_sum")
    expect(query.sql).toContain("latency_ms_max")
    expect(query.sql).toContain("admin.application_credentials")
    expect(query.sql).not.toMatch(
      /\b(?:prompt|request_body|response_body|tool_call|tool_result|correlation_id)\b/i,
    )
    expect(query.params).toEqual(
      expect.arrayContaining([
        context.requestId,
        context.contextBytes,
        context.route,
        context.model,
        12,
        8,
        42,
        25,
      ]),
    )
  })

  it("uses only PostgreSQL time for direct pre-admission accounting", async () => {
    const execute = vi.fn(async (_statement: unknown) => [])
    vi.mocked(getInferenceCoreDb).mockReturnValue({
      execute,
    } as unknown as ReturnType<typeof getInferenceCoreDb>)

    await recordConnectedAppGatewayUsage(app, {
      inputTokens: 0,
      latencyMs: 2,
      model: null,
      outputTokens: 0,
      route: "chat_completions",
      status: 400,
      totalTokens: 0,
    })

    const query = sqlQuery(execute.mock.calls[0]?.[0])
    expect(query.sql).toContain("SELECT clock_timestamp() AS started_at")
    expect(query.sql).toContain("request_clock.started_at")
    expect(query.sql).toContain("started_at AT TIME ZONE 'UTC'")
    expect(query.params).not.toContainEqual(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    )
  })
})

function mockAdmissionDatabase(responses: unknown[][]) {
  const execute = vi.fn(async (_statement: unknown) => responses.shift() ?? [])
  const transaction = vi.fn(
    async (run: (executor: { execute: typeof execute }) => Promise<unknown>) =>
      run({ execute }),
  )
  vi.mocked(getInferenceCoreDb).mockReturnValue({
    transaction,
  } as unknown as ReturnType<typeof getInferenceCoreDb>)
  return { execute, transaction }
}

function sqlQuery(statement: unknown) {
  expect(statement).toBeDefined()
  return new PgDialect().sqlToQuery(statement as SQL)
}
