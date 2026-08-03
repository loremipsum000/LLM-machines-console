import { beforeEach, describe, expect, it, vi } from "vitest"
import { getCurrentConsoleSession } from "./session"

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  opaqueConsoleSessionHandle: vi.fn(),
  resolveConsoleSession: vi.fn(),
}))

vi.mock("next/headers", () => ({ headers: mocks.headers }))
vi.mock("./session-client", () => ({
  opaqueConsoleSessionHandle: mocks.opaqueConsoleSessionHandle,
  resolveConsoleSession: mocks.resolveConsoleSession,
}))

describe("current opaque Console session", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.headers.mockResolvedValue(
      new Headers({ cookie: "__Host-llm-machines-session=opaque" }),
    )
    mocks.opaqueConsoleSessionHandle.mockReturnValue("A".repeat(43))
  })

  it("returns only the BFF-verified projection and opaque handle", async () => {
    mocks.resolveConsoleSession.mockResolvedValue({
      session: {
        email: "operator@example.test",
        groups: ["Operators"],
        mfaVerifiedAt: null,
        role: "operator",
        subject: "operator-1",
      },
      state: "active",
    })

    await expect(getCurrentConsoleSession()).resolves.toEqual({
      session: {
        email: "operator@example.test",
        groups: ["Operators"],
        mfaVerifiedAt: null,
        role: "operator",
        subject: "operator-1",
      },
      sessionHandle: "A".repeat(43),
      state: "active",
    })
  })

  it("preserves terminal and retryable state without inventing authority", async () => {
    mocks.resolveConsoleSession.mockResolvedValueOnce({
      reason: "expired",
      state: "terminal",
    })
    await expect(getCurrentConsoleSession()).resolves.toEqual({
      reason: "expired",
      state: "terminal",
    })

    mocks.resolveConsoleSession.mockResolvedValue({
      reason: "identity_unavailable",
      retryable: true,
      state: "unavailable",
    })
    await expect(getCurrentConsoleSession()).resolves.toEqual({
      reason: "identity_unavailable",
      retryable: true,
      state: "unavailable",
    })
  })

  it("does not contact the BFF when the opaque cookie is absent", async () => {
    mocks.opaqueConsoleSessionHandle.mockReturnValue(null)

    await expect(getCurrentConsoleSession()).resolves.toEqual({
      reason: "absent",
      state: "terminal",
    })
    expect(mocks.resolveConsoleSession).not.toHaveBeenCalled()
  })
})
