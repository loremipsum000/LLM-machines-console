import { afterEach, describe, expect, it, vi } from "vitest"
import { getBffForwardedIdentity } from "@/lib/auth/session"
import { hubNotifications } from "@/lib/hub/mock-data"
import { PATCH } from "./route"

vi.mock("@/lib/auth/session", () => ({
  getBffForwardedIdentity: vi.fn(),
}))

const notification = hubNotifications[0]

describe("web Hub notification read route", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("fails closed when the BFF is not configured", async () => {
    const response = await PATCH(new Request("http://web.test"), {
      params: Promise.resolve({ id: notification.id }),
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      title: "Notification update unavailable",
    })
  })

  it("proxies the read request with forwarded identity headers when configured", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        ...notification,
        readAt: "2026-05-20T12:00:00.000Z",
      }),
    )

    const response = await PATCH(new Request("http://web.test"), {
      params: Promise.resolve({ id: notification.id }),
    })

    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        id: notification.id,
        readAt: "2026-05-20T12:00:00.000Z",
      }),
    )
    expect(fetchSpy).toHaveBeenCalledWith(
      `http://bff.test/api/hub/notifications/${notification.id}/read`,
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer service-key",
          "Idempotency-Key": `hub-notification-read:${notification.id}`,
          "x-llm-machines-user-sub": "admin-1",
        }),
        method: "PATCH",
      }),
    )
  })

  it("returns problem details when a configured BFF denies the notification", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          type: "about:blank",
          title: "Notification not found",
          status: 404,
        },
        { status: 404 },
      ),
    )

    const response = await PATCH(new Request("http://web.test"), {
      params: Promise.resolve({ id: notification.id }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        status: 404,
        title: "Notification not found",
      }),
    )
  })
})
