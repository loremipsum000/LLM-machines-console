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
})
