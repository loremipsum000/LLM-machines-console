import { randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"
import { cipherFromSerializedKeyring } from "./console-session-keyring"

describe("root-mounted Console session keyring format", () => {
  it("accepts one active key plus decrypt-only rotation keys", () => {
    const cipher = cipherFromSerializedKeyring(
      Buffer.from(
        JSON.stringify({
          activeKid: "2026-08",
          keys: [
            {
              kid: "2026-07",
              material: randomBytes(32).toString("base64"),
              status: "decrypt-only",
            },
            {
              kid: "2026-08",
              material: randomBytes(32).toString("base64"),
              status: "active",
            },
          ],
          version: 1,
        }),
      ),
    )
    expect(cipher.activeKid).toBe("2026-08")
    cipher.destroy()
  })

  it.each([
    { activeKid: "missing", keys: [], version: 1 },
    {
      activeKid: "a",
      keys: [
        {
          kid: "a",
          material: randomBytes(31).toString("base64"),
          status: "active",
        },
      ],
      version: 1,
    },
    {
      activeKid: "a",
      keys: [
        {
          kid: "a",
          material: randomBytes(32).toString("base64"),
          status: "active",
        },
        {
          kid: "b",
          material: randomBytes(32).toString("base64"),
          status: "active",
        },
      ],
      version: 1,
    },
  ])("rejects unsafe rotation state", (value) => {
    expect(() =>
      cipherFromSerializedKeyring(Buffer.from(JSON.stringify(value))),
    ).toThrow()
  })
})
