import { randomUUID } from "node:crypto"
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises"
import { dirname, isAbsolute, join, normalize } from "node:path"

import type { EmergencyIsolationNonRestorableAuthority } from "./emergency-isolation"

const markerFileName = "recovery-required.json"
const lockFileName = ".recovery-required.lock"
const maximumMarkerBytes = 512

export class FileEmergencyIsolationNonRestorableAuthority
  implements EmergencyIsolationNonRestorableAuthority
{
  constructor(private readonly directory: string) {
    if (!validDirectoryPath(directory)) {
      throw new Error("Emergency isolation marker directory is invalid.")
    }
  }

  async clearRecoveryRequiredAndConfirm(operationId: string): Promise<boolean> {
    if (!uuid(operationId)) return false
    return await this.withLock(async () => {
      const current = await this.readMarker()
      if (!current || current.operationId !== operationId) return false
      await rm(this.markerPath(), { force: false })
      await syncDirectory(this.directory)
      return (await this.readMarker()) === null
    })
  }

  async persistRecoveryRequired(operationId: string): Promise<boolean> {
    if (!uuid(operationId)) return false
    return await this.withLock(async () => {
      const current = await this.readMarker()
      if (current && current.operationId !== operationId) return false
      if (current) return true

      const temporary = join(
        this.directory,
        `.${markerFileName}.${process.pid}.${randomUUID()}.tmp`,
      )
      const handle = await open(temporary, "wx", 0o600)
      try {
        await handle.writeFile(
          `${JSON.stringify({ operationId, state: "recovery_required" })}\n`,
          "utf8",
        )
        await handle.sync()
      } finally {
        await handle.close()
      }
      try {
        await rename(temporary, this.markerPath())
        await chmod(this.markerPath(), 0o600)
        await syncDirectory(this.directory)
      } finally {
        await rm(temporary, { force: true })
      }
      const persisted = await this.readMarker()
      return persisted?.operationId === operationId
    })
  }

  async readRecoveryRequired(): Promise<unknown> {
    await this.prepareDirectory()
    return await this.readMarker()
  }

  private markerPath(): string {
    return join(this.directory, markerFileName)
  }

  private async prepareDirectory(): Promise<void> {
    await mkdir(this.directory, { mode: 0o700, recursive: true })
    const metadata = await lstat(this.directory)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("Emergency isolation marker directory is invalid.")
    }
    await chmod(this.directory, 0o700)
  }

  private async readMarker(): Promise<{
    operationId: string
    state: "recovery_required"
  } | null> {
    let metadata: Awaited<ReturnType<typeof lstat>>
    try {
      metadata = await lstat(this.markerPath())
    } catch (error) {
      if (missing(error)) return null
      throw error
    }
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.size < 1 ||
      metadata.size > maximumMarkerBytes
    ) {
      throw new Error("Emergency isolation marker is invalid.")
    }
    const parsed: unknown = JSON.parse(
      await readFile(this.markerPath(), "utf8"),
    )
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.keys(parsed).sort().join(",") !== "operationId,state" ||
      !("operationId" in parsed) ||
      !uuid(parsed.operationId) ||
      !("state" in parsed) ||
      parsed.state !== "recovery_required"
    ) {
      throw new Error("Emergency isolation marker is invalid.")
    }
    return {
      operationId: parsed.operationId,
      state: "recovery_required",
    }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.prepareDirectory()
    const path = join(this.directory, lockFileName)
    const lock = await open(path, "wx", 0o600)
    try {
      await lock.sync()
      return await operation()
    } finally {
      await lock.close()
      await rm(path, { force: true })
      await syncDirectory(this.directory)
    }
  }
}

export function fileEmergencyIsolationAuthorityFromRuntime(): EmergencyIsolationNonRestorableAuthority | null {
  const directory = process.env.EMERGENCY_ISOLATION_MARKER_DIRECTORY?.trim()
  return directory
    ? new FileEmergencyIsolationNonRestorableAuthority(directory)
    : null
}

function validDirectoryPath(value: string): boolean {
  return (
    isAbsolute(value) &&
    normalize(value) === value &&
    value !== "/" &&
    dirname(value) !== value &&
    !value.includes("\n") &&
    !value.includes("\0")
  )
}

function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
}

function missing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  )
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
