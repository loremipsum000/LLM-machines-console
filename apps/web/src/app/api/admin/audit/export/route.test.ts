import { afterEach, describe, expect, it, vi } from "vitest"
import { GET } from "./route"

const mocks = vi.hoisted(() => ({
  getBffRequest: vi.fn(),
  getCurrentConsoleRole: vi.fn(),
}))

vi.mock("@/lib/bff/server-request", () => ({
  getBffRequest: mocks.getBffRequest,
}))

vi.mock("@/lib/auth/session", () => ({
  getCurrentConsoleRole: mocks.getCurrentConsoleRole,
}))

describe("Admin audit export proxy", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mocks.getBffRequest.mockReset()
    mocks.getCurrentConsoleRole.mockReset()
  })

  it("rejects Operator export before contacting the BFF", async () => {
    mocks.getCurrentConsoleRole.mockResolvedValue("operator")
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

  it("rejects unsupported formats", async () => {
    mocks.getCurrentConsoleRole.mockResolvedValue("admin")

    const response = await GET(
      new Request(
        "https://console.example.test/api/admin/audit/export?format=xml",
      ),
    )

    expect(response.status).toBe(400)
    expect(mocks.getBffRequest).not.toHaveBeenCalled()
  })

  it("requires a canonical export window before contacting the BFF", async () => {
    mocks.getCurrentConsoleRole.mockResolvedValue("admin")

    const response = await GET(
      new Request(
        "https://console.example.test/api/admin/audit/export?format=json&from=not-a-date&to=2026-08-01T08%3A00",
      ),
    )

    expect(response.status).toBe(400)
    expect(mocks.getBffRequest).not.toHaveBeenCalled()
  })

  it("forwards only bounded export filters and preserves signed response headers", async () => {
    mocks.getCurrentConsoleRole.mockResolvedValue("admin")
    mocks.getBffRequest.mockResolvedValue({
      baseUrl: "http://bff.test",
      headers: { Authorization: "Bearer service-key" },
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
})
