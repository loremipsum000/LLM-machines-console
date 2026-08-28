import { describe, expect, it } from "vitest"
import {
  CONSOLE_SESSION_COOKIE,
  clearConsoleCookie,
  readConsoleCookie,
  serializeConsoleCookie,
  validServiceCredential,
} from "./console-session-cookie"

const handle = "A".repeat(43)

describe("opaque Console session cookie", () => {
  it("is host-only, secure, HttpOnly, and contains no token material", () => {
    const cookie = serializeConsoleCookie(
      CONSOLE_SESSION_COOKIE,
      handle,
      28_800,
    )
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("Secure")
    expect(cookie).toContain("SameSite=Lax")
    expect(cookie).toContain("Path=/")
    expect(cookie).not.toContain("Domain=")
    expect(cookie).not.toMatch(/access|refresh|eyJ/i)
  })

  it("accepts only a fixed-width opaque handle", () => {
    expect(
      readConsoleCookie(
        `a=1; ${CONSOLE_SESSION_COOKIE}=${handle}`,
        CONSOLE_SESSION_COOKIE,
      ),
    ).toBe(handle)
    expect(
      readConsoleCookie(
        `${CONSOLE_SESSION_COOKIE}=eyJ.token.value`,
        CONSOLE_SESSION_COOKIE,
      ),
    ).toBeNull()
    expect(() =>
      serializeConsoleCookie(CONSOLE_SESSION_COOKIE, "short", 20),
    ).toThrow()
  })

  it("clears with the same host-only attributes", () => {
    expect(clearConsoleCookie(CONSOLE_SESSION_COOKIE)).toBe(
      `${CONSOLE_SESSION_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`,
    )
  })

  it("compares the private web-to-BFF credential without prefix ambiguity", () => {
    expect(validServiceCredential("Bearer exact-secret", "exact-secret")).toBe(
      true,
    )
    expect(validServiceCredential("Bearer exact-secre", "exact-secret")).toBe(
      false,
    )
  })
})
