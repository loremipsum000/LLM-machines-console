import { getCurrentConsoleSession } from "@/lib/auth/session"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ConsoleBffAuthExpiredError,
  ConsoleBffUnavailableError,
  getAdminConnectedApps,
} from "./server-data-core"

vi.mock("@/lib/auth/session", () => ({
  getCurrentConsoleSession: vi.fn(),
}))

function activeConsoleSession(role: "admin" | "operator") {
  return {
    session: {
      email: `${role}@example.test`,
      groups: role === "admin" ? ["Administrators"] : ["Operators"],
      mfaVerifiedAt: null,
      role,
      subject: `${role}-1`,
    },
    sessionHandle: "A".repeat(43),
    state: "active",
  } as const
}

describe("inference-core Admin data loader", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("loads connected-app metadata without credential material", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getCurrentConsoleSession).mockResolvedValue(
      activeConsoleSession("operator"),
    )
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
        headers: {
          Authorization: "Bearer service-key",
          "x-llm-machines-console-session": "A".repeat(43),
        },
      }),
    )
  })

  it("classifies a BFF 401 as expired Console authentication", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getCurrentConsoleSession).mockResolvedValue(
      activeConsoleSession("operator"),
    )
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ title: "Unauthorized" }), {
        status: 401,
      }),
    )

    await expect(getAdminConnectedApps()).rejects.toBeInstanceOf(
      ConsoleBffAuthExpiredError,
    )
  })

  it("preserves a terminal session transition before the later BFF request", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getCurrentConsoleSession).mockResolvedValue({
      reason: "expired",
      state: "terminal",
    })
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    await expect(getAdminConnectedApps()).rejects.toBeInstanceOf(
      ConsoleBffAuthExpiredError,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("preserves a retryable outage before the later BFF request", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getCurrentConsoleSession).mockResolvedValue({
      reason: "identity_unavailable",
      retryable: true,
      state: "unavailable",
    })
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    await expect(getAdminConnectedApps()).rejects.toBeInstanceOf(
      ConsoleBffUnavailableError,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("classifies a later BFF 503 as retryable unavailability", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getCurrentConsoleSession).mockResolvedValue(
      activeConsoleSession("operator"),
    )
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ title: "Unavailable" }), {
        status: 503,
      }),
    )

    await expect(getAdminConnectedApps()).rejects.toBeInstanceOf(
      ConsoleBffUnavailableError,
    )
  })
})
