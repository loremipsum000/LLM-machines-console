import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../../../apps/bff/src/auth/authorization"
import { getInferenceCoreDb } from "../../../apps/bff/src/db/inference-core-client"
import * as schema from "../../../apps/bff/src/db/inference-core-schema"
import {
  type ConnectedAppRuntimeIdentity,
  admitConnectedAppGatewayUsage,
  consumeConnectedAppGatewayRateLimit,
  getAdminConnectedAppDetail,
  reconcileConnectedAppGatewayUsage,
  recordConnectedAppGatewayAccountingDegraded,
  recordConnectedAppGatewayUsage,
  updateAdminConnectedApp,
} from "../../../apps/bff/src/services/admin-connected-apps"

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

let database: PGlite
let inferenceDb: NonNullable<ReturnType<typeof getInferenceCoreDb>>

const actor: Actor = {
  authMode: "service-forwarded",
  role: "admin",
  subject: "pr07-admin",
}

const app: ConnectedAppRuntimeIdentity = {
  allowedModels: ["local-a"],
  appId: "pr07-app",
  appName: "PR-07 app",
  authMethod: "api_key",
  clientId: "llmm_pr07",
  credentialRecordId: "pr07-credential",
  keycloakSubjectId: null,
  maxConcurrentRequests: 1,
  maxContextBytes: 1_024,
  rateLimitRps: 1,
  status: "enabled",
  tokenAlertState: "reached",
  tokenAlertThreshold7d: 1,
  usage: {
    failures7d: 0,
    lastUsedAt: null,
    requests7d: 0,
    tokens7d: 100,
  },
}

describe("PR-07 PostgreSQL inference data plane", () => {
  beforeEach(async () => {
    database = await PGlite.create()
    await database.exec(migration)
    await database.exec(`
      INSERT INTO common.human_identities (subject_id)
      VALUES ('pr07-admin');

      INSERT INTO admin.applications (
        id,
        name,
        auth_mode,
        created_by,
        updated_by
      )
      VALUES (
        'pr07-app',
        'PR-07 app',
        'api_key',
        'pr07-admin',
        'pr07-admin'
      );

      INSERT INTO admin.application_credentials (
        id,
        app_id,
        kind,
        key_prefix,
        verifier_hash
      )
      VALUES (
        'pr07-credential',
        'pr07-app',
        'api_key',
        'llmm_pr07',
        repeat('7', 64)
      );

      INSERT INTO admin.application_limits (
        app_id,
        requests_per_second,
        token_alert_threshold_7d,
        max_concurrent_requests,
        max_context_bytes
      )
      VALUES ('pr07-app', 1, 1, 1, 1024);
    `)
    inferenceDb = drizzle(database, {
      schema,
    }) as unknown as NonNullable<ReturnType<typeof getInferenceCoreDb>>
    vi.mocked(getInferenceCoreDb).mockReturnValue(inferenceDb)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await database.close()
  })

  it.each([null, 10])(
    "enforces current RPS under concurrent calls when runtime RPS is %s",
    async (runtimeRps) => {
      const runtime = { ...app, rateLimitRps: runtimeRps }
      const results = await Promise.all([
        consumeConnectedAppGatewayRateLimit(runtime),
        consumeConnectedAppGatewayRateLimit(runtime),
      ])

      expect(results.filter((result) => result.ok)).toHaveLength(1)
      expect(results.filter((result) => !result.ok)).toEqual([
        expect.objectContaining({ status: 429 }),
      ])
      const windows = await database.query<{ request_count: number }>(`
        SELECT request_count
        FROM admin.application_rate_limit_windows
      `)
      expect(windows.rows).toEqual([{ request_count: 1 }])
    },
  )

  it("serializes current-state admission with one database-backed lease", async () => {
    const results = await Promise.all([admitChat(app, 10), admitChat(app, 10)])

    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({ status: 429 }),
    ])
    const leases = await database.query<{
      active: boolean
      context_bytes: number
      model_alias: string
      route_kind: string
    }>(`
      SELECT
        state = 'active' AS active,
        context_bytes,
        model_alias,
        route_kind
      FROM admin.application_request_ledger
    `)
    expect(leases.rows).toEqual([
      {
        active: true,
        context_bytes: 10,
        model_alias: "local-a",
        route_kind: "chat_completions",
      },
    ])
  })

  it("settles and aggregates a request exactly once with exact known counters", async () => {
    const admission = await admitChat(app, 128)
    if (!admission.ok) {
      throw new Error("Expected a request lease.")
    }
    const usage = {
      inputTokens: 12,
      latencyMs: 25,
      model: "local-a",
      outputTokens: 8,
      route: "chat_completions" as const,
      status: 200,
      totalTokens: 42,
    }

    await Promise.all([
      reconcileConnectedAppGatewayUsage(app, usage, admission.context),
      reconcileConnectedAppGatewayUsage(app, usage, admission.context),
    ])

    const aggregate = await database.query<{
      failure_count: number
      input_tokens: number
      latency_ms_max: number
      latency_ms_sum: number
      model_alias: string
      output_tokens: number
      request_count: number
      route_kind: string
      total_tokens: number
    }>(`
      SELECT
        request_count,
        failure_count,
        input_tokens,
        output_tokens,
        total_tokens,
        latency_ms_sum,
        latency_ms_max,
        route_kind,
        model_alias
      FROM admin.application_usage_daily
    `)
    expect(aggregate.rows).toEqual([
      {
        failure_count: 0,
        input_tokens: 12,
        latency_ms_max: 25,
        latency_ms_sum: 25,
        model_alias: "local-a",
        output_tokens: 8,
        request_count: 1,
        route_kind: "chat_completions",
        total_tokens: 42,
      },
    ])
    const ledger = await database.query<{
      state: string
      total_tokens: number
    }>(`
      SELECT state, total_tokens
      FROM admin.application_request_ledger
    `)
    expect(ledger.rows).toEqual([{ state: "settled", total_tokens: 42 }])
  })

  it("ignores stale active leases while retaining them for bounded cleanup", async () => {
    await database.exec(`
      INSERT INTO admin.application_request_ledger (
        id,
        app_id,
        credential_id,
        route_kind,
        model_alias,
        context_bytes,
        started_at,
        lease_expires_at
      )
      VALUES (
        '00000000-0000-4000-8000-000000000075',
        'pr07-app',
        'pr07-credential',
        'chat_completions',
        'local-a',
        10,
        clock_timestamp() - interval '20 minutes',
        clock_timestamp() - interval '5 minutes'
      )
    `)

    await expect(admitChat(app, 10)).resolves.toMatchObject({ ok: true })
    const counts = await database.query<{
      active_rows: number
      current_leases: number
    }>(`
      SELECT
        count(*) FILTER (WHERE state = 'active')::integer AS active_rows,
        count(*) FILTER (
          WHERE state = 'active' AND lease_expires_at > clock_timestamp()
        )::integer AS current_leases
      FROM admin.application_request_ledger
    `)
    expect(counts.rows).toEqual([{ active_rows: 2, current_leases: 1 }])
  })

  it("never uses the seven-day token alert as an admission denial", async () => {
    await database.exec(`
      UPDATE admin.application_limits
      SET max_concurrent_requests = NULL
      WHERE app_id = 'pr07-app'
    `)

    await expect(admitChat(app, 10)).resolves.toMatchObject({ ok: true })
  })

  it("rejects stale runtime identity state without creating a lease", async () => {
    await database.exec(`
      UPDATE admin.application_credentials
      SET status = 'revoked', revoked_at = clock_timestamp()
      WHERE id = 'pr07-credential'
    `)

    await expect(admitChat(app, 10)).resolves.toMatchObject({
      ok: false,
      status: 503,
      title: "Connected app state changed",
    })
    const rows = await database.query<{ count: number }>(`
      SELECT count(*)::integer AS count
      FROM admin.application_request_ledger
    `)
    expect(rows.rows).toEqual([{ count: 0 }])
  })

  it("reads policy after a waiting application lock observes the committed update", async () => {
    const paused = pauseAfterNextApplicationLock(database)
    vi.mocked(getInferenceCoreDb).mockReturnValue(paused.db)
    const updating = updateAdminConnectedApp(actor, app.appId, {
      allowedModels: ["local-a"],
      description: "Policy changed while admission waits.",
      maxConcurrentRequests: 1,
      maxContextBytes: 5,
      name: "PR-07 app",
      rateLimitRps: 1,
      tokenAlertThreshold7d: 1,
    })

    await paused.locked
    vi.mocked(getInferenceCoreDb).mockReturnValue(inferenceDb)
    let admissionSettled = false
    const admission = admitChat(app, 10).finally(() => {
      admissionSettled = true
    })
    await Promise.resolve()
    expect(admissionSettled).toBe(false)
    paused.release()

    await expect(updating).resolves.toMatchObject({ status: "updated" })
    await expect(admission).resolves.toMatchObject({
      ok: false,
      status: 413,
      title: "Context limit exceeded",
    })
    const rows = await database.query<{ count: number }>(`
      SELECT count(*)::integer AS count
      FROM admin.application_request_ledger
    `)
    expect(rows.rows).toEqual([{ count: 0 }])
  })

  it("fails runtime projection and admission closed when the required policy row is missing", async () => {
    await database.exec(`
      DELETE FROM admin.application_limits
      WHERE app_id = 'pr07-app'
    `)

    await expect(getAdminConnectedAppDetail(actor, app.appId)).rejects.toThrow(
      "Application protection policy storage is incomplete.",
    )
    await expect(admitChat(app, 10)).resolves.toMatchObject({
      ok: false,
      status: 503,
      title: "Connected app state changed",
    })
    await expect(
      consumeConnectedAppGatewayRateLimit({ ...app, rateLimitRps: null }),
    ).resolves.toMatchObject({ ok: false, status: 503 })
  })

  it("enforces the contract ceilings in PostgreSQL", async () => {
    await expect(
      database.exec(`
        UPDATE admin.application_limits
        SET requests_per_second = 10001
        WHERE app_id = 'pr07-app'
      `),
    ).rejects.toThrow()
    await expect(
      database.exec(`
        UPDATE admin.application_limits
        SET max_concurrent_requests = 10001
        WHERE app_id = 'pr07-app'
      `),
    ).rejects.toThrow()
    await expect(
      database.exec(`
        UPDATE admin.application_limits
        SET token_alert_threshold_7d = 100000001
        WHERE app_id = 'pr07-app'
      `),
    ).rejects.toThrow()
    await expect(
      database.exec(`
        UPDATE admin.application_limits
        SET max_context_bytes = 9007199254740992
        WHERE app_id = 'pr07-app'
      `),
    ).rejects.toThrow()
  })

  it("durably marks degraded state only for a current credential", async () => {
    await expect(
      recordConnectedAppGatewayAccountingDegraded(app),
    ).resolves.toBe(true)
    const degraded = await database.query<{ connection_status: string }>(`
      SELECT connection_status
      FROM admin.applications
      WHERE id = 'pr07-app'
    `)
    expect(degraded.rows).toEqual([{ connection_status: "degraded" }])

    await database.exec(`
      UPDATE admin.application_credentials
      SET status = 'revoked', revoked_at = clock_timestamp()
      WHERE id = 'pr07-credential'
    `)
    await expect(
      recordConnectedAppGatewayAccountingDegraded(app),
    ).resolves.toBe(false)
  })

  it("insert-settles rejected chat metadata with an unknown model", async () => {
    await recordConnectedAppGatewayUsage(app, {
      inputTokens: 0,
      latencyMs: 1,
      model: null,
      outputTokens: 0,
      route: "chat_completions",
      status: 400,
      totalTokens: 0,
    })

    const usage = await database.query<{
      failure_count: number
      model_alias: string
      request_count: number
      route_kind: string
    }>(`
      SELECT request_count, failure_count, route_kind, model_alias
      FROM admin.application_usage_daily
    `)
    expect(usage.rows).toEqual([
      {
        failure_count: 1,
        model_alias: "",
        request_count: 1,
        route_kind: "chat_completions",
      },
    ])
  })

  it("keeps the request ledger metadata-only", async () => {
    const columns = await database.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'admin'
        AND table_name = 'application_request_ledger'
      ORDER BY ordinal_position
    `)
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "id",
      "app_id",
      "credential_id",
      "route_kind",
      "model_alias",
      "context_bytes",
      "state",
      "status_code",
      "input_tokens",
      "output_tokens",
      "total_tokens",
      "latency_ms",
      "started_at",
      "lease_expires_at",
      "settled_at",
    ])
    expect(columns.rows.map((row) => row.column_name).join(" ")).not.toMatch(
      /prompt|body|response|tool|content|correlation/i,
    )
  })
})

function admitChat(
  identity: ConnectedAppRuntimeIdentity,
  contextBytes: number,
) {
  return admitConnectedAppGatewayUsage(identity, {
    contextBytes,
    model: "local-a",
    route: "chat_completions",
  })
}

function pauseAfterNextApplicationLock(client: PGlite) {
  let release: () => void = () => {}
  let signalLocked: () => void = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const locked = new Promise<void>((resolve) => {
    signalLocked = resolve
  })
  let paused = false
  const wrapTransaction = <Transaction extends object>(
    transaction: Transaction,
  ): Transaction =>
    new Proxy(transaction, {
      get(target, property) {
        const value = Reflect.get(target, property, target)
        if (property === "query" && typeof value === "function") {
          return async (...args: unknown[]) => {
            const result = await Reflect.apply(value, target, args)
            const query = typeof args[0] === "string" ? args[0] : ""
            if (
              !paused &&
              query.includes('from "admin"."applications"') &&
              query.toLowerCase().includes("for update")
            ) {
              paused = true
              signalLocked()
              await released
            }
            return result
          }
        }
        return typeof value === "function" ? value.bind(target) : value
      },
    })
  const clientProxy = new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property, target)
      if (property === "transaction" && typeof value === "function") {
        return (...args: unknown[]) => {
          const callback = args[0]
          if (typeof callback !== "function") {
            return Reflect.apply(value, target, args)
          }
          const wrappedCallback = (transaction: object) =>
            Reflect.apply(callback, undefined, [wrapTransaction(transaction)])
          return Reflect.apply(value, target, [
            wrappedCallback,
            ...args.slice(1),
          ])
        }
      }
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  const db = drizzle(clientProxy, { schema }) as unknown as NonNullable<
    ReturnType<typeof getInferenceCoreDb>
  >
  return { db, locked, release }
}
