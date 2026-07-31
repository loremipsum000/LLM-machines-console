import { beforeEach, describe, expect, it, vi } from "vitest"
import { getBffForwardedIdentity, getCurrentConsoleRole } from "./session"

const authMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({
  auth: authMock,
}))

describe("Console forwarded identity", () => {
  beforeEach(() => {
    authMock.mockReset()
  })

  it("forwards only fresh retained authority", async () => {
    authMock.mockResolvedValue({
      accessToken: "fresh-access-token",
      user: {
        email: "operator@example.test",
        groups: ["Operators"],
        id: "operator-1",
        roles: ["offline_access", "operator", "auditor"],
      },
    })

    await expect(getBffForwardedIdentity()).resolves.toEqual({
      accessToken: "fresh-access-token",
      email: "operator@example.test",
      groups: ["Operators"],
      roles: ["operator"],
      subject: "operator-1",
    })
    await expect(getCurrentConsoleRole()).resolves.toBe("operator")
  })

  it("does not forward identity without a fresh token or retained role", async () => {
    for (const session of [
      {
        user: { id: "admin-1", roles: ["admin"] },
      },
      {
        accessToken: "fresh-access-token",
        user: { id: "unclassified-1", roles: ["auditor", "support"] },
      },
    ]) {
      authMock.mockResolvedValue(session)
      await expect(getBffForwardedIdentity()).resolves.toBeNull()
      await expect(getCurrentConsoleRole()).resolves.toBeNull()
    }
  })
})
