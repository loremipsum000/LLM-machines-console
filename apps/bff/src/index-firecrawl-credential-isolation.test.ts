import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "./index"
import { resetConnectedAppsForTest } from "./services/admin-connected-apps"
import { resetAuditEventsForTest } from "./services/audit"
import { resetIdempotencyForTest } from "./services/idempotency"
import { resetIdentityMutationJournalForTest } from "./services/identity-mutation-journal"

const adminHeaders = {
  authorization: "Bearer test-service-key",
  "x-llm-machines-keycloak-token": "",
  "x-llm-machines-user-email": "admin-1@example.test",
  "x-llm-machines-user-roles": "admin",
  "x-llm-machines-user-sub": "admin-1",
}

describe("Firecrawl credential namespace isolation", () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetIdentityMutationJournalForTest()
    resetIdempotencyForTest()
    resetAuditEventsForTest()
    await resetConnectedAppsForTest()
  })

  it("keeps inference, Firecrawl, human, and service credentials non-interchangeable", async () => {
    configureFixtureRuntime()
    const upstreamFetch = vi.fn(async () =>
      Response.json({ data: { web: [] }, success: true }),
    )
    const logLines: string[] = []
    const server = buildServer({
      testFirecrawlGateway: { fetchImpl: upstreamFetch },
      testLoggerStream: {
        write(message) {
          logLines.push(message)
        },
      },
    })

    const created = await server.inject({
      headers: { ...adminHeaders, "idempotency-key": "isolation-create" },
      method: "POST",
      payload: {
        allowedModels: ["local-a"],
        description: "Credential isolation test.",
        name: "Credential isolation",
      },
      url: "/api/admin/applications/connected-apps",
    })
    expect(created.statusCode).toBe(201)
    const applicationId = created.json().app.id as string
    const inferenceKey = created.json().credential.apiKey as string

    const enabled = await server.inject({
      headers: {
        ...adminHeaders,
        "idempotency-key": "isolation-firecrawl-enable",
      },
      method: "POST",
      payload: { disclaimerAccepted: true },
      url: `/api/admin/applications/connected-apps/${applicationId}/firecrawl/enable`,
    })
    expect(enabled.statusCode).toBe(200)
    const firecrawlKey = enabled.json().credential.apiKey as string

    const firecrawlOwnPlane = await firecrawlSearch(server, firecrawlKey)
    expect(firecrawlOwnPlane.statusCode).toBe(200)
    expect(upstreamFetch).toHaveBeenCalledTimes(1)

    const firecrawlOnInference = await server.inject({
      headers: { authorization: `Bearer ${firecrawlKey}` },
      method: "GET",
      url: "/api/app-gateway/v1/models",
    })
    expect(firecrawlOnInference.statusCode).toBe(401)

    const inferenceOnFirecrawl = await firecrawlSearch(server, inferenceKey)
    expect(inferenceOnFirecrawl.statusCode).toBe(401)
    const serviceOnFirecrawl = await firecrawlSearch(server, "test-service-key")
    expect(serviceOnFirecrawl.statusCode).toBe(401)
    const malformedOnFirecrawl = await firecrawlSearch(
      server,
      "llmm_fc_not-a-valid-key",
    )
    expect(malformedOnFirecrawl.statusCode).toBe(401)
    expect(upstreamFetch).toHaveBeenCalledTimes(1)

    const dataKeyOnAdmin = await server.inject({
      headers: { authorization: `Bearer ${firecrawlKey}` },
      method: "GET",
      url: "/api/admin/settings",
    })
    expect(dataKeyOnAdmin.statusCode).toBe(401)

    const disabled = await server.inject({
      headers: {
        ...adminHeaders,
        "idempotency-key": "isolation-firecrawl-disable",
      },
      method: "POST",
      url: `/api/admin/applications/connected-apps/${applicationId}/firecrawl/disable`,
    })
    expect(disabled.statusCode).toBe(200)
    expect((await firecrawlSearch(server, firecrawlKey)).statusCode).toBe(403)
    expect(upstreamFetch).toHaveBeenCalledTimes(1)

    const logs = logLines.join("")
    expect(logs).not.toContain(inferenceKey)
    expect(logs).not.toContain(firecrawlKey)
    await server.close()
  })
})

function firecrawlSearch(
  server: ReturnType<typeof buildServer>,
  credential: string,
) {
  return server.inject({
    headers: { authorization: `Bearer ${credential}` },
    method: "POST",
    payload: { limit: 1, query: "synthetic test query" },
    url: "/v2/search",
  })
}

function configureFixtureRuntime(): void {
  vi.stubEnv("BFF_FIXTURE_MODE", "true")
  vi.stubEnv("BFF_FALLBACK_MODELS", "local-a")
  vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
  vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
  vi.stubEnv("FIRECRAWL_INSTALLED", "true")
  vi.stubEnv("FIRECRAWL_APPLIANCE_KILL_SWITCH", "false")
  vi.stubEnv("FIRECRAWL_RESOURCE_PROFILE_QUALIFIED", "true")
  vi.stubEnv("FIRECRAWL_EGRESS_POLICY_READY", "true")
  vi.stubEnv("FIRECRAWL_PUBLIC_BASE_URL", "https://bff.example.test")
  vi.stubEnv("FIRECRAWL_UPSTREAM_BASE_URL", "http://firecrawl-api:3002")
  vi.stubEnv("FIRECRAWL_EGRESS_ALLOWED_HOSTS", "public.example")
  vi.stubEnv(
    "FIRECRAWL_EGRESS_ALLOWLIST_DIR",
    "/run/llm-machines/firecrawl/egress-allowlist",
  )
}
