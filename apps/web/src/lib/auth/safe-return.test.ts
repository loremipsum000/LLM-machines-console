import { describe, expect, it } from "vitest"
import { normalizeConsoleReturnPath } from "./safe-return"

describe("same-origin Console return path", () => {
  it("retains only path-relative application destinations", () => {
    expect(normalizeConsoleReturnPath("/applications?tab=keys#current")).toBe(
      "/applications?tab=keys#current",
    )
    expect(
      normalizeConsoleReturnPath("/applications?next=%2Fmodels&tab=keys"),
    ).toBe("/applications?next=%2Fmodels&tab=keys")
  })

  it.each([
    "https://console.example.test/applications",
    "//attacker.example.test/path",
    "/\\attacker.example.test/path",
    "/%2f%2fattacker.example.test/path",
    "/%5c%5cattacker.example.test/path",
    "/%2e%2e//attacker.example.test",
    "/.%2e//attacker.example.test",
    "/safe/%2E%2E/settings",
    "/safe/../settings",
    "/%0aattacker.example.test",
    "/path\nset-cookie:value",
  ])("rejects unsafe return target %s", (value) => {
    expect(normalizeConsoleReturnPath(value)).toBe("/")
  })
})
