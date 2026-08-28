import { describe, expect, it } from "vitest"
import { sourceStatusLabel } from "./source-status"

describe("sourceStatusLabel", () => {
  it.each([
    ["ok", "Available"],
    ["degraded", "Degraded"],
    ["unavailable", "Unavailable"],
    ["not_configured", "Not configured"],
  ] as const)("renders %s as %s", (status, label) => {
    expect(sourceStatusLabel(status)).toBe(label)
  })
})
