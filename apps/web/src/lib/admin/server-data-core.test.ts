import { getCurrentConsoleSession } from "@/lib/auth/session"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ConsoleBffAuthExpiredError,
  ConsoleBffUnavailableError,
  getAdminConnectedApps,
  getAdminOverview,
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

    await expect(getAdminOverview()).rejects.toBeInstanceOf(
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

    await expect(getAdminOverview()).rejects.toBeInstanceOf(
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

    await expect(getAdminOverview()).rejects.toBeInstanceOf(
      ConsoleBffUnavailableError,
    )
  })

  it("loads the source-backed Overview without fixture fallback", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getCurrentConsoleSession).mockResolvedValue(
      activeConsoleSession("operator"),
    )
    const payload = overviewFixture()
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))

    await expect(getAdminOverview()).resolves.toEqual(payload)
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://bff.test/api/admin/overview",
      expect.objectContaining({ cache: "no-store" }),
    )
  })
})

function overviewFixture() {
  const generatedAt = "2026-08-01T08:01:00.000Z"
  return {
    activityEvents: [],
    activitySourceStatus: "ok",
    generatedAt,
    tiles: [
      overviewTile("applications", "Keys", "/keys", generatedAt),
      overviewTile("inference", "Inference", "/inference", generatedAt),
      overviewTile("hardware", "Hardware", "/hardware", generatedAt),
      overviewTile("system", "System", "/settings", generatedAt),
    ],
  }
}

function overviewTile(
  id: "applications" | "hardware" | "inference" | "system",
  title: string,
  href: string,
  updatedAt: string,
) {
  return {
    href,
    id,
    metrics: [
      {
        detail: "Authentic BFF source",
        id: `${id}-status`,
        label: "Status",
        tone: "good" as const,
        value: "Operational",
      },
    ],
    sourceStatus: "ok" as const,
    summary: `${title} source preview is available.`,
    title,
    updatedAt,
  }
}
