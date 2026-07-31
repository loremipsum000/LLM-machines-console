import type { SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getInferenceCoreDb } from "../db/inference-core-client"
import {
  type ConnectedAppRuntimeIdentity,
  reconcileConnectedAppGatewayUsage,
  reserveConnectedAppGatewayTokens,
} from "./admin-connected-apps"
import { upsertActorUser } from "./users"

vi.mock("../db/inference-core-client", () => ({
  getInferenceCoreDb: vi.fn(),
}))

vi.mock("./users", () => ({
  upsertActorUser: vi.fn(),
}))

const app: ConnectedAppRuntimeIdentity = {
  allowedModels: ["local-a"],
  appId: "app-accounting-test",
  appName: "Accounting Test",
  authMethod: "api_key",
  clientId: "llmm_test",
  credentialRecordId: "cak-accounting-test",
  environment: "staging",
  keycloakSubjectId: null,
  rateLimitRpm: null,
  status: "enabled",
  tokenBudget7d: 100_000,
  usage: {
    failures7d: 0,
    lastUsedAt: null,
    requests7d: 0,
    tokens7d: 0,
  },
}

describe("connected app gateway accounting SQL", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("binds the token-reservation timestamp as an ISO string", async () => {
    const execute = vi.fn(async (_statement: unknown) => [
      { usage_summary: {} },
    ])
    vi.mocked(getInferenceCoreDb).mockReturnValue({
      execute,
    } as unknown as ReturnType<typeof getInferenceCoreDb>)
    vi.mocked(upsertActorUser).mockResolvedValue({
      authMode: "service-forwarded",
      persona: "admin",
      roles: ["admin"],
      subject: "connected-app-gateway",
    })

    await reserveConnectedAppGatewayTokens(app, 128)

    const statement = execute.mock.calls[0]?.[0]
    expect(statement).toBeDefined()
    const query = new PgDialect().sqlToQuery(statement as SQL)
    expect(query.sql).toContain("::timestamptz")
    expect(query.params).not.toContainEqual(expect.any(Date))
    expect(query.params).toContainEqual(expect.stringMatching(ISO_TIMESTAMP))
  })

  it("binds the usage-reconciliation timestamp as an ISO string", async () => {
    const execute = vi.fn(async (_statement: unknown) => [])
    vi.mocked(getInferenceCoreDb).mockReturnValue({
      execute,
    } as unknown as ReturnType<typeof getInferenceCoreDb>)
    vi.mocked(upsertActorUser).mockResolvedValue({
      authMode: "service-forwarded",
      persona: "admin",
      roles: ["admin"],
      subject: "connected-app-gateway",
    })

    await reconcileConnectedAppGatewayUsage(
      app.appId,
      {
        environment: "staging",
        latencyMs: 25,
        model: "local-a",
        status: 200,
        tokens: 42,
      },
      {
        appId: app.appId,
        environment: "staging",
        reservedTokens: 128,
      },
    )

    const statement = execute.mock.calls[0]?.[0]
    expect(statement).toBeDefined()
    const query = new PgDialect().sqlToQuery(statement as SQL)
    expect(query.sql).toContain("::text")
    expect(query.sql).toContain("::timestamptz")
    expect(query.params).not.toContainEqual(expect.any(Date))
    expect(query.params).toContainEqual(expect.stringMatching(ISO_TIMESTAMP))
  })
})

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
