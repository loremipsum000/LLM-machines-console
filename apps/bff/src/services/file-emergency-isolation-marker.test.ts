import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { FileEmergencyIsolationNonRestorableAuthority } from "./file-emergency-isolation-marker"

const roots: string[] = []
const first = "01234567-89ab-4cde-8fab-0123456789ab"
const second = "11234567-89ab-4cde-8fab-0123456789ab"

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  )
})

describe("file emergency isolation marker authority", () => {
  it("persists, reads, and compare-clears one exact recovery marker", async () => {
    const authority = fixture()
    await expect(authority.readRecoveryRequired()).resolves.toBeNull()
    await expect(authority.persistRecoveryRequired(first)).resolves.toBe(true)
    await expect(authority.readRecoveryRequired()).resolves.toEqual({
      operationId: first,
      state: "recovery_required",
    })
    await expect(
      authority.clearRecoveryRequiredAndConfirm(second),
    ).resolves.toBe(false)
    await expect(
      authority.clearRecoveryRequiredAndConfirm(first),
    ).resolves.toBe(true)
    await expect(authority.readRecoveryRequired()).resolves.toBeNull()
  })

  it("rejects replacement, malformed content, loose permissions, and stale locks", async () => {
    const root = await makeRoot()
    const authority = new FileEmergencyIsolationNonRestorableAuthority(root)
    await expect(authority.persistRecoveryRequired(first)).resolves.toBe(true)
    await expect(authority.persistRecoveryRequired(second)).resolves.toBe(false)

    const marker = join(root, "recovery-required.json")
    await writeFile(marker, "{}\n", { mode: 0o600 })
    await expect(authority.readRecoveryRequired()).rejects.toThrow(/invalid/)

    await writeFile(
      marker,
      `${JSON.stringify({ operationId: first, state: "recovery_required" })}\n`,
      { mode: 0o600 },
    )
    await chmod(marker, 0o644)
    await expect(authority.readRecoveryRequired()).rejects.toThrow(/invalid/)

    await chmod(marker, 0o600)
    await writeFile(join(root, ".recovery-required.lock"), "held\n", {
      mode: 0o600,
    })
    await expect(
      authority.clearRecoveryRequiredAndConfirm(first),
    ).rejects.toMatchObject({ code: "EEXIST" })
    expect(await readFile(marker, "utf8")).toContain(first)
  })

  it("rejects invalid marker directories and operation identifiers", async () => {
    expect(
      () => new FileEmergencyIsolationNonRestorableAuthority("relative"),
    ).toThrow(/directory is invalid/)
    const authority = fixture()
    await expect(authority.persistRecoveryRequired("invalid")).resolves.toBe(
      false,
    )
  })
})

function fixture(): FileEmergencyIsolationNonRestorableAuthority {
  const root = join(
    tmpdir(),
    `llmm-isolation-marker-${process.pid}-${Date.now()}-${roots.length}`,
  )
  roots.push(root)
  return new FileEmergencyIsolationNonRestorableAuthority(root)
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "llmm-isolation-marker-"))
  roots.push(root)
  return root
}
