import { describe, expect, test, vi } from "vitest"
import { signalOwnedProcessGroup } from "../../../scripts/pre-genesis/process-group.mjs"

describe("F0-B1 owned process-group signaling", () => {
  test("treats a missing process group as already stopped", () => {
    const signalProcess = vi.fn(() => {
      throw processError("ESRCH")
    })

    expect(
      signalOwnedProcessGroup(123, "SIGTERM", () => false, signalProcess),
    ).toBe(false)
  })

  test("does not claim a permission-denied live owner stopped", () => {
    const signalProcess = vi.fn(() => {
      throw processError("EPERM")
    })

    expect(() =>
      signalOwnedProcessGroup(123, "SIGTERM", () => false, signalProcess),
    ).toThrow(expect.objectContaining({ code: "EPERM" }))
  })

  test("does not signal an unrelated group after the owner exits", () => {
    const signalProcess = vi.fn(() => {
      throw processError("EPERM")
    })

    expect(
      signalOwnedProcessGroup(123, "SIGTERM", () => true, signalProcess),
    ).toBe(false)
  })
})

function processError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}
