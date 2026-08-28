import { afterEach, describe, expect, it, vi } from "vitest"
import { GET } from "./route"

function activeConsoleSession(role: "admin" | "operator") {
  return {
    session: {
      groups: [],
      mfaVerifiedAt: new Date().toISOString(),
      role,
      subject: `${role}-1`,
    },
    sessionHandle: "A".repeat(43),
    state: "active",
  } as const
}

const mocks = vi.hoisted(() => ({
  getBffRequest: vi.fn(),
  getCurrentConsoleSession: vi.fn(),
}))

vi.mock("@/lib/bff/server-request", () => ({
  getBffRequest: mocks.getBffRequest,
}))

vi.mock("@/lib/auth/session", () => ({
  getCurrentConsoleSession: mocks.getCurrentConsoleSession,
}))

describe("Admin audit export proxy", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mocks.getBffRequest.mockReset()
    mocks.getCurrentConsoleSession.mockReset()
  })

  it("rejects Operator export before contacting the BFF", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue(
      activeConsoleSession("operator"),
    )
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const response = await GET(
      new Request(
        "https://console.example.test/api/admin/audit/export?format=json",
      ),
    )

    expect(response.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mocks.getBffRequest).not.toHaveBeenCalled()
  })

  it("returns a retryable service response during identity outage", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue({
      reason: "identity_unavailable",
      retryable: true,
      state: "unavailable",
    })

    const response = await GET(
      new Request(
        "https://console.example.test/api/admin/audit/export?format=json",
      ),
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      title: "Identity service temporarily unavailable",
    })
    expect(mocks.getBffRequest).not.toHaveBeenCalled()
  })

  it("clears and redirects when the session becomes terminal before the BFF request", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue(
      activeConsoleSession("admin"),
    )
    mocks.getBffRequest.mockResolvedValue({
      reason: "expired",
      state: "terminal",
    })
    const request = new Request(
      "https://console.example.test/api/admin/audit/export?format=json&from=2026-07-01T08%3A00&to=2026-08-01T08%3A00",
    )

    const response = await GET(request)
    const setCookie = response.headers.get("set-cookie") ?? ""

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(
      "https://console.example.test/auth/signin?session=expired&returnTo=%2Fapi%2Fadmin%2Faudit%2Fexport%3Fformat%3Djson%26from%3D2026-07-01T08%253A00%26to%3D2026-08-01T08%253A00",
    )
    expect(setCookie).toContain("__Host-llm-machines-session=")
    expect(setCookie).toContain("Max-Age=0")
    expect(setCookie).not.toContain("Domain=")
  })

  it("preserves local custody when the later session check is unavailable", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue(
      activeConsoleSession("admin"),
    )
    mocks.getBffRequest.mockResolvedValue({
      reason: "identity_unavailable",
      retryable: true,
      state: "unavailable",
    })
    const request = new Request(
      "https://console.example.test/api/admin/audit/export?format=json&from=2026-07-01T08%3A00&to=2026-08-01T08%3A00",
    )

    const response = await GET(request)

    expect(response.status).toBe(503)
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(response.headers.get("location")).toBeNull()
    expect(await response.json()).toMatchObject({
      title: "Identity service temporarily unavailable",
    })
  })

  it("authorizes Admin export by role without MFA elevation", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue({
      ...activeConsoleSession("admin"),
      session: {
        ...activeConsoleSession("admin").session,
        mfaVerifiedAt: "2000-01-01T00:00:00.000Z",
      },
    })

    mocks.getBffRequest.mockResolvedValue({
      baseUrl: "http://bff.test",
      headers: { Authorization: "Bearer service-key" },
      state: "active",
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("signed-export", {
        headers: { "Content-Type": "application/jose" },
        status: 200,
      }),
    )

    const response = await GET(
      new Request(
        "https://console.example.test/api/admin/audit/export?format=json&from=2026-07-01T08%3A00&to=2026-08-01T08%3A00",
      ),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("signed-export")
    expect(response.headers.get("location")).toBeNull()
    expect(mocks.getBffRequest).toHaveBeenCalledTimes(1)
  })

  it("rejects unsupported formats", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue(
      activeConsoleSession("admin"),
    )

    const response = await GET(
      new Request(
        "https://console.example.test/api/admin/audit/export?format=xml",
      ),
    )

    expect(response.status).toBe(400)
    expect(mocks.getBffRequest).not.toHaveBeenCalled()
  })

  it("requires a canonical export window before contacting the BFF", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue(
      activeConsoleSession("admin"),
    )

    const response = await GET(
      new Request(
        "https://console.example.test/api/admin/audit/export?format=json&from=not-a-date&to=2026-08-01T08%3A00",
      ),
    )

    expect(response.status).toBe(400)
    expect(mocks.getBffRequest).not.toHaveBeenCalled()
  })

  it("forwards only bounded export filters and preserves signed response headers", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue(
      activeConsoleSession("admin"),
    )
    mocks.getBffRequest.mockResolvedValue({
      baseUrl: "http://bff.test",
      headers: { Authorization: "Bearer service-key" },
      state: "active",
    })
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("signed-compact-jws", {
        headers: {
          "Content-Disposition": 'attachment; filename="audit-export.json.jws"',
          "Content-Type": "application/jose",
          "X-LLM-Machines-Audit-Content-Type": "application/json",
          "X-LLM-Machines-Audit-Event-Count": "12",
          "X-LLM-Machines-Audit-Format": "json",
          "X-LLM-Machines-Audit-Next-Cursor": "export-cursor-2",
          "X-LLM-Machines-Audit-Payload-Bytes": "1024",
        },
        status: 200,
      }),
    )

    const response = await GET(
      new Request(
        "https://console.example.test/api/admin/audit/export?format=json&from=2026-07-01T08%3A00&to=2026-08-01T08%3A00&q=rotate&applicationId=app-1&source=console&outcome=succeeded&severity=info&eventId=event-1&cursor=export-cursor-1&limit=5000&unknown=value",
      ),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("signed-compact-jws")
    expect(response.headers.get("content-type")).toBe("application/jose")
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="audit-export.json.jws"',
    )
    expect(response.headers.get("x-llm-machines-audit-event-count")).toBe("12")
    expect(response.headers.get("x-llm-machines-audit-next-cursor")).toBe(
      "export-cursor-2",
    )
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://bff.test/api/admin/audit/export?format=json&from=2026-07-01T08%3A00%3A00.000Z&to=2026-08-01T08%3A00%3A00.000Z&q=rotate&applicationId=app-1&eventId=event-1&source=console&outcome=succeeded&severity=info&cursor=export-cursor-1&limit=5000",
      expect.objectContaining({
        cache: "no-store",
        headers: { Authorization: "Bearer service-key" },
      }),
    )
  })

  it("clears and redirects on a downstream BFF 401", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue(
      activeConsoleSession("admin"),
    )
    mocks.getBffRequest.mockResolvedValue({
      baseUrl: "http://bff.test",
      headers: { Authorization: "Bearer service-key" },
      state: "active",
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ title: "Authentication required" }, { status: 401 }),
    )
    const request = new Request(
      "https://console.example.test/api/admin/audit/export?format=json&from=2026-07-01T08%3A00&to=2026-08-01T08%3A00",
    )

    const response = await GET(request)

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toContain(
      "/auth/signin?session=expired&returnTo=",
    )
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
  })
})
