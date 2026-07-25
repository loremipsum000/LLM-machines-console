import { afterEach, describe, expect, it, vi } from "vitest"
import { getBffForwardedIdentity } from "@/lib/auth/session"
import { GET } from "./route"

vi.mock("@/lib/auth/session", () => ({
  getBffForwardedIdentity: vi.fn(),
}))

describe("web Hub search route", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("fails closed when the BFF is not configured", async () => {
    const response = await GET(
      new Request("http://web.test/api/hub/search?q=internal"),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      title: "Hub search unavailable",
    })
  })

  it("proxies BFF search with forwarded identity headers when configured", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      email: "builder@example.test",
      roles: ["builder"],
      subject: "builder-1",
    })
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json([
        {
          id: "task-1",
          type: "task",
          title: "Review MCP catalog seed",
          description: "waiting",
          href: "/tasks/task-1",
          rank: 1,
        },
      ]),
    )

    const response = await GET(
      new Request("http://web.test/api/hub/search?q=Review MCP"),
    )

    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({
        id: "task-1",
        type: "task",
      }),
    ])
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://bff.test/api/hub/search?q=Review%20MCP",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer service-key",
          "x-llm-machines-user-sub": "builder-1",
        }),
      }),
    )
  })

  it("does not fall back to fixture search when a configured BFF fails", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      email: "builder@example.test",
      roles: ["builder"],
      subject: "builder-1",
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ status: 503, title: "Unavailable" }, { status: 503 }),
    )

    const response = await GET(
      new Request("http://web.test/api/hub/search?q=internal"),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      title: "Hub search unavailable",
    })
  })
})
