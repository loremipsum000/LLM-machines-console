import { afterEach, describe, expect, it, vi } from "vitest"
import { getBffForwardedIdentity } from "@/lib/auth/session"
import { GET } from "./route"

vi.mock("@/lib/auth/session", () => ({
  getBffForwardedIdentity: vi.fn(),
}))

describe("web Hub events route", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("fails closed when the BFF is not configured", async () => {
    const response = await GET(
      new Request("http://web.test/api/hub/events?once=true"),
    )

    expect(response.status).toBe(503)
    expect(response.headers.get("content-type")).toContain("application/json")
    await expect(response.json()).resolves.toMatchObject({
      title: "Hub event stream unavailable",
    })
  })

  it("proxies the BFF stream with forwarded identity headers when configured", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("event: notification.created\n\n", {
        headers: { "Content-Type": "text/event-stream" },
        status: 200,
      }),
    )

    const response = await GET(
      new Request("http://web.test/api/hub/events?once=true"),
    )

    await expect(response.text()).resolves.toContain(
      "event: notification.created",
    )
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://bff.test/api/hub/events?once=true",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer service-key",
          "x-llm-machines-user-sub": "admin-1",
        }),
      }),
    )
  })

  it("does not fall back to fixture SSE when a configured BFF fails", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ status: 503, title: "Unavailable" }, { status: 503 }),
    )

    const response = await GET(
      new Request("http://web.test/api/hub/events?once=true"),
    )

    expect(response.status).toBe(503)
    expect(response.headers.get("content-type")).toContain("application/json")
    await expect(response.json()).resolves.toMatchObject({
      title: "Hub event stream unavailable",
    })
  })
})
