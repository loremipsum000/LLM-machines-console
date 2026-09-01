import { describe, expect, it } from "vitest"
import { consoleMfaElevationHref, hasFreshConsoleMfa } from "./mfa-elevation"

const now = () => Date.parse("2026-08-03T12:00:00.000Z")

describe("Console MFA elevation", () => {
  it("accepts only the five-minute freshness window and bounded clock skew", () => {
    expect(hasFreshConsoleMfa("2026-08-03T11:55:00.000Z", now)).toBe(true)
    expect(hasFreshConsoleMfa("2026-08-03T11:54:59.999Z", now)).toBe(false)
    expect(hasFreshConsoleMfa("2026-08-03T12:01:00.000Z", now)).toBe(true)
    expect(hasFreshConsoleMfa("2026-08-03T12:01:00.001Z", now)).toBe(false)
    expect(hasFreshConsoleMfa(null, now)).toBe(false)
  })

  it("binds a known action to one path-only return target", () => {
    expect(consoleMfaElevationHref("activity_audit.export", "/settings")).toBe(
      "/auth/elevate?action=activity_audit.export&returnTo=%2Fsettings",
    )
    expect(
      consoleMfaElevationHref(
        "activity_audit.export",
        "https://attacker.example.test/",
      ),
    ).toBe("/auth/elevate?action=activity_audit.export&returnTo=%2F")
  })
})
