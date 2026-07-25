import { afterEach, describe, expect, it, vi } from "vitest"
import { getBffForwardedIdentity } from "@/lib/auth/session"
import { POST } from "./route"

vi.mock("@/lib/auth/session", () => ({
  getBffForwardedIdentity: vi.fn(),
}))

describe("web Hub chat route", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("fails closed when the BFF is not configured", async () => {
    const response = await POST(
      new Request("http://web.test/api/hub/chat", {
        body: JSON.stringify({ input: "@summary-agent summarize this" }),
        method: "POST",
      }),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      title: "Hub prompt unavailable",
    })
  })

  it("proxies prompts to the BFF chat completions route", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: "Model response",
            },
          },
        ],
      }),
    )

    const response = await POST(
      new Request("http://web.test/api/hub/chat", {
        body: JSON.stringify({ input: "hello" }),
        method: "POST",
      }),
    )

    await expect(response.json()).resolves.toEqual({
      output: "Model response",
      source: "bff",
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://bff.test/v1/chat/completions",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer service-key",
          "x-llm-machines-user-sub": "admin-1",
        }),
        method: "POST",
      }),
    )
  })
})
