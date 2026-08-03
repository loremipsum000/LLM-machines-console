import { afterEach, describe, expect, it, vi } from "vitest"
import { GET } from "./route"

const mocks = vi.hoisted(() => ({
  getBffRequest: vi.fn(),
}))

vi.mock("@/lib/bff/server-request", () => ({
  getBffRequest: mocks.getBffRequest,
}))

const requestUrl = "https://console.example.test/team/import/template"

describe("Team CSV template proxy", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mocks.getBffRequest.mockReset()
  })

  it("clears a terminal transition before redirecting to sign-in", async () => {
    mocks.getBffRequest.mockResolvedValue({
      reason: "expired",
      state: "terminal",
    })

    const response = await GET(new Request(requestUrl))

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(
      "https://console.example.test/auth/signin?session=expired&returnTo=%2Fteam%2Fimport%2Ftemplate",
    )
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
  })

  it("keeps retryable unavailability cookie-preserving", async () => {
    mocks.getBffRequest.mockResolvedValue({
      reason: "identity_unavailable",
      retryable: true,
      state: "unavailable",
    })

    const response = await GET(new Request(requestUrl))

    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(response.headers.get("location")).toBeNull()
  })

  it("clears a downstream BFF 401", async () => {
    mocks.getBffRequest.mockResolvedValue({
      baseUrl: "http://bff.test",
      headers: { Authorization: "Bearer service-key" },
      state: "active",
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ title: "Authentication required" }, { status: 401 }),
    )

    const response = await GET(new Request(requestUrl))

    expect(response.status).toBe(303)
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
  })

  it("streams the approved CSV response for an active session", async () => {
    mocks.getBffRequest.mockResolvedValue({
      baseUrl: "http://bff.test",
      headers: { Authorization: "Bearer service-key" },
      state: "active",
    })
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("email,role\n", { status: 200 }))

    const response = await GET(new Request(requestUrl))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("email,role\n")
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8")
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://bff.test/api/admin/team/csv-template",
      expect.objectContaining({
        cache: "no-store",
        headers: { Authorization: "Bearer service-key" },
      }),
    )
  })
})
