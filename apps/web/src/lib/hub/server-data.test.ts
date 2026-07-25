import { afterEach, describe, expect, it, vi } from "vitest"
import { getBffForwardedIdentity } from "@/lib/auth/session"
import { hubHome, hubResources } from "@/lib/hub/mock-data"
import { getHubHome, getHubResourceById } from "@/lib/hub/server-data"

vi.mock("@/lib/auth/session", () => ({
  getBffForwardedIdentity: vi.fn(),
}))

describe("Hub server data loader", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("fails closed when the BFF is not configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    await expect(getHubHome()).rejects.toThrow(
      "Console BFF is not available for /api/hub/home",
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("fetches Hub data with server-only forwarded identity headers", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      accessToken: "keycloak-access-token",
      email: "builder@example.test",
      groups: ["Engineering"],
      roles: ["builder"],
      subject: "builder-1",
    })
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ...hubHome, persona: "builder" }), {
        status: 200,
      }),
    )

    await expect(getHubHome()).resolves.toMatchObject({
      persona: "builder",
    })
    expect(fetchSpy).toHaveBeenCalledWith("http://bff.test/api/hub/home", {
      cache: "no-store",
      headers: expect.objectContaining({
        Authorization: "Bearer service-key",
        "x-llm-machines-keycloak-token": "keycloak-access-token",
        "x-llm-machines-user-sub": "builder-1",
        "x-llm-machines-user-email": "builder@example.test",
        "x-llm-machines-user-groups": "Engineering",
        "x-llm-machines-user-roles": "builder",
      }),
    })
  })

  it("fetches resource details through the BFF detail route", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test/")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify(
            hubResources.find((resource) => resource.id === "internal-docs"),
          ),
          { status: 200 },
        ),
      )

    await expect(
      getHubResourceById("mcp_connector", "internal-docs"),
    ).resolves.toMatchObject({
      id: "internal-docs",
      type: "mcp_connector",
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://bff.test/api/hub/resources/mcp_connector/internal-docs",
      expect.objectContaining({
        cache: "no-store",
      }),
    )
  })

  it("does not fall back to local detail data when the configured BFF returns 404", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not found", { status: 404 }),
    )

    await expect(
      getHubResourceById("mcp_connector", "internal-docs"),
    ).resolves.toBeUndefined()
  })

  it("fails closed when the BFF is configured but no authenticated session is available", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue(null)
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    await expect(getHubHome()).rejects.toThrow("fixture mode is disabled")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("fails closed when the configured BFF returns a non-OK response", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("BFF unavailable", { status: 503 }),
    )

    await expect(getHubHome()).rejects.toThrow("Console BFF returned HTTP 503")
  })
})
