import { getBffForwardedIdentity } from "@/lib/auth/session"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ConsoleBffAuthExpiredError,
  getAdminAudit,
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

  it("forwards the bounded Activity filters and parses normalized audit metadata", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      accessToken: "keycloak-access-token",
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    const payload = {
      events: [
        {
          action: "console.application.credential.rotate",
          actorId: "admin-1",
          createdAt: "2026-08-01T08:00:00.000Z",
          href: "/activity?eventId=event-1",
          id: "event-1",
          metadata: [
            { label: "applicationId", value: "app-1" },
            { label: "credentialRecordId", value: "credential-1" },
          ],
          outcome: "succeeded",
          reason: null,
          severity: "info",
          sourceSystem: "console",
          targetId: "credential-1",
          targetType: "application_credential",
        },
      ],
      generatedAt: "2026-08-01T08:01:00.000Z",
      nextCursor: "cursor-2",
      query: "rotate",
      selectedApplicationId: "app-1",
      selectedEventId: "event-1",
      selectedOutcome: "succeeded",
      selectedSeverity: "info",
      selectedSource: "console",
      sourceStatus: "ok",
      sources: [
        {
          cursorHealth: "not_applicable",
          id: "console",
          ingressReadiness: "not_applicable",
          label: "Console audit",
          lastAttemptAt: null,
          lastErrorCode: null,
          lastEventAt: "2026-08-01T08:00:00.000Z",
          lastSuccessAt: null,
          sourceStatus: "ok",
        },
      ],
    }
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))

    await expect(
      getAdminAudit({
        applicationId: " app-1 ",
        cursor: "cursor-1",
        eventId: "event-1",
        limit: "25",
        outcome: "succeeded",
        query: "rotate",
        severity: "info",
        source: "console",
      }),
    ).resolves.toEqual(payload)
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://bff.test/api/admin/audit?q=rotate&applicationId=app-1&eventId=event-1&cursor=cursor-1&limit=25&source=console&outcome=succeeded&severity=info",
      expect.objectContaining({ cache: "no-store" }),
    )
  })
})
