import { afterEach, describe, expect, it, vi } from "vitest"
import { checkInferenceCoreDbReadiness } from "./db/inference-core-client"
import { buildServer } from "./index"

vi.mock("./db/inference-core-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./db/inference-core-client")>()
  return {
    ...actual,
    checkInferenceCoreDbReadiness: vi.fn(),
  }
})

describe("Console BFF persistence preflight", () => {
  afterEach(() => {
    vi.mocked(checkInferenceCoreDbReadiness).mockReset()
    vi.unstubAllEnvs()
  })

  it("requires PostgreSQL in production", () => {
    configureProductionRuntime()
    vi.stubEnv("DATABASE_URL", "")

    expect(() => buildServer()).toThrow(
      "DATABASE_URL is required for the Console BFF.",
    )
  })

  it.each(["BFF_FIXTURE_MODE", "CONNECTED_APPS_KEYCLOAK_FIXTURE"] as const)(
    "rejects %s before production can initialize fixture-backed services",
    (flag) => {
      configureProductionRuntime()
      vi.stubEnv(flag, "true")

      expect(() => buildServer()).toThrow(
        `Fixture configuration is forbidden in production: ${flag}.`,
      )
    },
  )

  it("requires an explicit connected-Application BFF base URL in production", () => {
    configureProductionRuntime()
    vi.stubEnv("CONNECTED_APPS_BFF_BASE_URL", "")
    vi.stubEnv("PUBLIC_BFF_BASE_URL", "")

    expect(() => buildServer()).toThrow(
      "Connected app reveal endpoint configuration is invalid.",
    )
  })

  it.each([
    "ftp://console.invalid",
    "http://localhost:4001",
    "http://127.0.0.1:4001",
    "http://[::1]:4001",
    "http://[::ffff:127.0.0.1]:4001",
  ])("rejects invalid connected-app base URL %s in production", (baseUrl) => {
    configureProductionRuntime()
    vi.stubEnv("CONNECTED_APPS_BFF_BASE_URL", baseUrl)

    expect(() => buildServer()).toThrow(
      "Connected app reveal endpoint configuration is invalid.",
    )
  })

  it.each([
    "http://10.254.254.254:4001/console/",
    "http://[::ffff:10.254.254.254]:4001/console/",
  ])(
    "accepts private customer-network URL %s through PUBLIC_BFF_BASE_URL",
    async (baseUrl) => {
      configureProductionRuntime()
      vi.stubEnv("CONNECTED_APPS_BFF_BASE_URL", "")
      vi.stubEnv("PUBLIC_BFF_BASE_URL", baseUrl)

      const server = buildServer()
      await server.close()
    },
  )

  it("rejects an invalid OAuth token reveal endpoint in production", () => {
    configureProductionRuntime()
    vi.stubEnv("CONNECTED_APPS_BFF_BASE_URL", "https://console.example.test")
    vi.stubEnv("KEYCLOAK_ADMIN_BASE_URL", "ftp://keycloak.invalid")
    vi.stubEnv("KEYCLOAK_ADMIN_REALM", "llm-machines")
    vi.stubEnv("KEYCLOAK_APPLICATION_ADMIN_REALM", "llm-machines-applications")
    vi.stubEnv(
      "KEYCLOAK_APPLICATION_ADMIN_CLIENT_ID",
      "console-application-admin",
    )
    vi.stubEnv("KEYCLOAK_APPLICATION_ADMIN_CLIENT_SECRET", "secret")
    vi.stubEnv("KEYCLOAK_AUDIENCE", "console-bff")

    expect(() => buildServer()).toThrow(
      "Connected app OAuth reveal endpoint configuration is invalid.",
    )
  })

  it.each(["master", "llm-machines", "customer-applications"])(
    "rejects cross-wired Application realm %s during production startup",
    (realm) => {
      configureProductionRuntime()
      vi.stubEnv("KEYCLOAK_ADMIN_BASE_URL", "https://keycloak.example.test")
      vi.stubEnv("KEYCLOAK_APPLICATION_ADMIN_REALM", realm)
      vi.stubEnv(
        "KEYCLOAK_APPLICATION_ADMIN_CLIENT_ID",
        "console-application-admin",
      )
      vi.stubEnv("KEYCLOAK_APPLICATION_ADMIN_CLIENT_SECRET", "secret")
      vi.stubEnv("KEYCLOAK_AUDIENCE", "console-bff")

      expect(() => buildServer()).toThrow(
        "Connected app OAuth reveal endpoint configuration is invalid.",
      )
    },
  )

  it("fails readiness when PostgreSQL or the required schema is unavailable", async () => {
    configureProductionRuntime()
    vi.mocked(checkInferenceCoreDbReadiness).mockResolvedValue(false)
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/readyz",
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      service: "console-bff",
      status: "degraded",
    })
    await server.close()
  })

  it("reports ready only after PostgreSQL and the required schema pass", async () => {
    configureProductionRuntime()
    vi.mocked(checkInferenceCoreDbReadiness).mockResolvedValue(true)
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/readyz",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      service: "console-bff",
      status: "ok",
    })
    await server.close()
  })

  it("ignores injected authorization and recovery authorities outside tests", async () => {
    configureProductionRuntime()
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_REQUIRE_FORWARDED_KEYCLOAK_TOKEN", "false")
    const injectedIdentity = vi.fn(async () => ({
      enabled: true,
      role: "admin" as const,
      subject: "forged-admin",
    }))
    const injectedRecoveryStatus = vi.fn(async () => ({
      activeGrant: null,
      factor: null,
      status: "ok" as const,
    }))
    const server = buildServer({
      testEmergencyRecoveryService: {
        activate: vi.fn(async () => ({ status: "unavailable" as const })),
        commission: vi.fn(async () => ({ status: "unavailable" as const })),
        resolve: vi.fn(async () => ({ status: "inactive" as const })),
        revoke: vi.fn(async () => ({ status: "unavailable" as const })),
        status: injectedRecoveryStatus,
      },
      testAuthorization: {
        resolveCurrentIdentity: injectedIdentity,
        resolveRecoverySession: async () => ({ status: "inactive" }),
      },
    })

    const response = await server.inject({
      headers: {
        authorization: "Bearer test-service-key",
        "x-llm-machines-user-roles": "admin",
        "x-llm-machines-user-sub": "forged-admin",
      },
      method: "GET",
      url: "/api/admin/recovery/status",
    })

    expect(response.statusCode).toBe(401)
    expect(injectedIdentity).not.toHaveBeenCalled()
    expect(injectedRecoveryStatus).not.toHaveBeenCalled()
    await server.close()
  })
})

function configureProductionRuntime(): void {
  vi.stubEnv("NODE_ENV", "production")
  vi.stubEnv("DATABASE_URL", "postgres://fixture.invalid/console")
  vi.stubEnv("CONNECTED_APPS_BFF_BASE_URL", "https://console.example.test")
  vi.stubEnv("PUBLIC_BFF_BASE_URL", "")
}
