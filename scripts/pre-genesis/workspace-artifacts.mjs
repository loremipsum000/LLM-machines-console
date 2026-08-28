import { cp, rename, rm } from "node:fs/promises"

const defaultOperations = { cp, rename, rm }

export async function restoreWorkspaceBuildArtifacts(
  snapshot,
  { operations = defaultOperations, runId } = {},
) {
  if (!/^[a-f0-9]{16}$/.test(runId ?? "")) {
    throw new Error("F0-C1 workspace restore identity is invalid.")
  }
  for (const artifact of snapshot) {
    if (!artifact.existed) {
      await operations.rm(artifact.path, { force: true, recursive: true })
      continue
    }
    const pending = `${artifact.path}.llmm-f0-c1-restore-${runId}`
    const displaced = `${artifact.path}.llmm-f0-c1-generated-${runId}`
    await operations.rm(pending, { force: true, recursive: true })
    await operations.rm(displaced, { force: true, recursive: true })
    await operations.cp(artifact.backup, pending, {
      preserveTimestamps: true,
      recursive: true,
    })
    let currentWasDisplaced = false
    try {
      try {
        await operations.rename(artifact.path, displaced)
        currentWasDisplaced = true
      } catch (error) {
        if (error?.code !== "ENOENT") throw error
      }
      await operations.rename(pending, artifact.path)
    } catch (restoreError) {
      if (currentWasDisplaced) {
        try {
          await operations.rename(displaced, artifact.path)
        } catch (rollbackError) {
          throw new AggregateError(
            [restoreError, rollbackError],
            "F0-C1 workspace artifact restore and rollback failed.",
          )
        }
      }
      throw restoreError
    }
    if (currentWasDisplaced) {
      await operations.rm(displaced, { force: true, recursive: true })
    }
  }
}
