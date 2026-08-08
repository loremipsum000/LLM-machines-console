import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { resolve } from "node:path"
import { describe, expect, test, vi } from "vitest"
import { signalOwnedProcessGroup } from "../../../scripts/pre-genesis/process-group.mjs"

const repositoryRoot = resolve(import.meta.dirname, "../../..")

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
    const signalProcess = vi.fn(() => true)

    expect(
      signalOwnedProcessGroup(123, "SIGTERM", () => true, signalProcess),
    ).toBe(false)
    expect(signalProcess).not.toHaveBeenCalled()
  })

  test("signals a process group only while its owner is still tracked", () => {
    const signalProcess = vi.fn(() => true)

    expect(
      signalOwnedProcessGroup(123, "SIGTERM", () => false, signalProcess),
    ).toBe(true)
    expect(signalProcess).toHaveBeenCalledWith(-123, "SIGTERM")
  })

  test("keeps group ownership after a launcher exits before its descendant", async () => {
    const supervisor = spawn(
      process.execPath,
      [
        resolve(
          repositoryRoot,
          "scripts/pre-genesis/process-group-supervisor.mjs",
        ),
        "/bin/sh",
        "-c",
        "sleep 30 &",
      ],
      {
        cwd: repositoryRoot,
        detached: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    )
    const processGroupId = supervisor.pid
    assert(processGroupId)
    try {
      const [message] = await once(supervisor, "message")
      expect(message).toMatchObject({ code: 0, type: "target-exit" })
      expect(supervisor.exitCode).toBeNull()
      expect(() => process.kill(-processGroupId, 0)).not.toThrow()
    } finally {
      process.kill(-processGroupId, "SIGKILL")
      await once(supervisor, "exit")
    }
    expect(() => process.kill(-processGroupId, 0)).toThrow(
      expect.objectContaining({ code: "ESRCH" }),
    )
  })
})

function processError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}
