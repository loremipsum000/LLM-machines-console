import { afterEach, describe, expect, it, vi } from "vitest"
import { GET } from "./route"

function activeConsoleSession(role: "admin" | "operator") {
  return {
    session: {
      groups: [],
      mfaVerifiedAt: null,
      role,
      subject: `${role}-1`,
    },
    sessionHandle: "A".repeat(43),
    state: "active",
  } as const
}

function verificationKeysRequest() {
  return new Request(
    "https://console.example.test/api/admin/audit/export/verification-keys",
  )
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

describe("audit export verification-key proxy", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mocks.getBffRequest.mockReset()
    mocks.getCurrentConsoleSession.mockReset()
  })

  it("rejects Operator verification-key access before contacting the BFF", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue(
      activeConsoleSession("operator"),
    )
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const response = await GET(verificationKeysRequest())

    expect(response.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("clears a terminal transition before downloading verification keys", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue(
      activeConsoleSession("admin"),
    )
    mocks.getBffRequest.mockResolvedValue({
      reason: "revoked",
      state: "terminal",
    })

    const response = await GET(verificationKeysRequest())

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(
      "https://console.example.test/auth/signin?session=expired&returnTo=%2Fapi%2Fadmin%2Faudit%2Fexport%2Fverification-keys",
    )
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
  })

  it("downloads only the BFF-provided public verification keys", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue(
      activeConsoleSession("admin"),
    )
    mocks.getBffRequest.mockResolvedValue({
      baseUrl: "http://bff.test",
      headers: { Authorization: "Bearer service-key" },
      state: "active",
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

    const response = await GET(verificationKeysRequest())

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

  it("clears a downstream 401 before redirecting to sign-in", async () => {
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

    const response = await GET(verificationKeysRequest())

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toContain(
      "/auth/signin?session=expired&returnTo=",
    )
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
  })
})
