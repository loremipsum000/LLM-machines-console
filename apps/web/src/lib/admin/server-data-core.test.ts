import { getBffForwardedIdentity } from "@/lib/auth/session"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ConsoleBffAuthExpiredError,
  getAdminConnectedApps,
} from "./server-data-core"

vi.mock("@/lib/auth/session", () => ({
  getBffForwardedIdentity: vi.fn(),
}))

describe("inference-core Admin data loader", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("loads connected-app metadata without credential material", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      accessToken: "keycloak-access-token",
      email: "operator@example.test",
      roles: ["operator"],
      subject: "operator-1",
    })
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          apps: [],
          generatedAt: "2026-07-31T08:00:00.000Z",
          sourceStatus: "ok",
        }),
        { status: 200 },
      ),
    )

    await expect(getAdminConnectedApps()).resolves.toEqual({
      apps: [],
      generatedAt: "2026-07-31T08:00:00.000Z",
      sourceStatus: "ok",
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://bff.test/api/admin/applications/connected-apps",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer service-key",
          "x-llm-machines-user-sub": "operator-1",
        }),
      }),
    )
  })

  it("classifies a BFF 401 as expired Console authentication", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      accessToken: "stale-keycloak-access-token",
      email: "operator@example.test",
      roles: ["operator"],
      subject: "operator-1",
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ title: "Unauthorized" }), {
        status: 401,
      }),
    )

    await expect(getAdminConnectedApps()).rejects.toBeInstanceOf(
      ConsoleBffAuthExpiredError,
    )
  })
})
