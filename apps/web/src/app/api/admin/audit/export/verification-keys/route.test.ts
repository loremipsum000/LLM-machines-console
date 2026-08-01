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

describe("audit export verification-key proxy", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mocks.getBffRequest.mockReset()
    mocks.getCurrentConsoleRole.mockReset()
  })

  it("rejects Operator verification-key access before contacting the BFF", async () => {
    mocks.getCurrentConsoleRole.mockResolvedValue("operator")
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const response = await GET()

    expect(response.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("downloads only the BFF-provided public verification keys", async () => {
    mocks.getCurrentConsoleRole.mockResolvedValue("admin")
    mocks.getBffRequest.mockResolvedValue({
      baseUrl: "http://bff.test",
      headers: { Authorization: "Bearer service-key" },
    })
    const payload = {
      activeKid: "audit-key-1",
      keys: [
        {
          alg: "EdDSA",
          crv: "Ed25519",
          kid: "audit-key-1",
          kty: "OKP",
          use: "sig",
          x: "A".repeat(43),
        },
      ],
    }
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(payload, {
        headers: { "Content-Type": "application/jwk-set+json" },
      }),
    )

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(payload)
    expect(response.headers.get("content-type")).toBe(
      "application/jwk-set+json",
    )
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="audit-export-verification-keys.jwks.json"',
    )
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://bff.test/api/admin/audit/export/verification-keys",
      expect.objectContaining({
        cache: "no-store",
        headers: { Authorization: "Bearer service-key" },
      }),
    )
  })
})
