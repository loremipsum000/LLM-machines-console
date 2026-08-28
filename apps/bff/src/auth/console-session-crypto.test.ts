import { randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  createConsoleSessionCipher,
  newOpaqueHandle,
  opaqueHandleDigest,
} from "./console-session-crypto"

describe("Console server-side session encryption", () => {
  it("authenticates ciphertext and record binding", () => {
    const cipher = createConsoleSessionCipher({
      activeKid: "session-2026-08",
      keys: { "session-2026-08": randomBytes(32) },
    })
    const first = opaqueHandleDigest(newOpaqueHandle())
    const second = opaqueHandleDigest(newOpaqueHandle())
    const context = sessionContext(first)
    const sealed = cipher.seal(context, {
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
    })

    expect(cipher.open(context, sealed)).toEqual({
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
    })
    expect(() => cipher.open(sessionContext(second), sealed)).toThrow()
    expect(() =>
      cipher.open(
        { ...context, issuer: "https://forged.example.test" },
        sealed,
      ),
    ).toThrow()
    expect(() =>
      cipher.open({ ...context, subject: "other" }, sealed),
    ).toThrow()
    expect(sealed).not.toContain("access-secret")
    expect(sealed).not.toContain("refresh-secret")
  })

  it("supports decrypt-only keys during key rotation", () => {
    const previous = randomBytes(32)
    const recordId = opaqueHandleDigest(newOpaqueHandle())
    const oldCipher = createConsoleSessionCipher({
      activeKid: "old",
      keys: { old: previous },
    })
    const rotated = createConsoleSessionCipher({
      activeKid: "new",
      keys: { new: randomBytes(32), old: previous },
    })

    const context = sessionContext(recordId)
    expect(
      rotated.open(context, oldCipher.seal(context, { value: 1 })),
    ).toEqual({
      value: 1,
    })
  })

  it("zeroes key material when destroyed", () => {
    const cipher = createConsoleSessionCipher({
      activeKid: "active",
      keys: { active: randomBytes(32) },
    })
    const context = sessionContext(opaqueHandleDigest(newOpaqueHandle()))
    const sealed = cipher.seal(context, { value: 1 })
    cipher.destroy()
    expect(() => cipher.open(context, sealed)).toThrow(/destroyed/)
  })

  it("rejects extra keys and non-canonical or wrongly sized envelope fields", () => {
    const cipher = createConsoleSessionCipher({
      activeKid: "active",
      keys: { active: randomBytes(32) },
    })
    const context = sessionContext(opaqueHandleDigest(newOpaqueHandle()))
    const envelope = JSON.parse(cipher.seal(context, { value: 1 }))
    expect(() =>
      cipher.open(context, JSON.stringify({ ...envelope, extra: true })),
    ).toThrow()
    expect(() =>
      cipher.open(context, JSON.stringify({ ...envelope, iv: "AA" })),
    ).toThrow()
    expect(() =>
      cipher.open(
        context,
        JSON.stringify({ ...envelope, tag: `${envelope.tag}=` }),
      ),
    ).toThrow()
  })
})

function sessionContext(recordId: string) {
  return {
    clientId: "console-web",
    issuer: "https://console.example.test/identity/realms/appliance",
    recordId,
    recordType: "session" as const,
    recordVersion: 1 as const,
    subject: "subject-1",
  }
}
