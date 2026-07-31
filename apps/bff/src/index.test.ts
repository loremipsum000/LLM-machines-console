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
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("DATABASE_URL", "")

    expect(() => buildServer()).toThrow(
      "DATABASE_URL is required for the Console BFF.",
    )
  })

  it("fails readiness when PostgreSQL or the required schema is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("DATABASE_URL", "postgres://fixture.invalid/console")
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
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("DATABASE_URL", "postgres://fixture.invalid/console")
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
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("DATABASE_URL", "postgres://fixture.invalid/console")
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
