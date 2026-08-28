import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  closeInferenceCoreDb,
  getInferenceCoreDb,
} from "../db/inference-core-client"
import {
  type InferenceCoreRetentionResult,
  runInferenceCoreRetention,
} from "../services/inference-core-retention"

const DATABASE_URL_REQUIRED =
  "DATABASE_URL is required for the Inference Core retention command."
const RETENTION_DATABASE_UNAVAILABLE =
  "The Inference Core retention database is unavailable."
type RetentionFailureClass =
  | "configuration_missing"
  | "database_unavailable"
  | "retention_execution_failed"

export async function runRetentionCommand(
  log: (message: string) => void = console.log,
): Promise<InferenceCoreRetentionResult> {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error(DATABASE_URL_REQUIRED)
  }
  const database = getInferenceCoreDb()
  if (!database) {
    throw new Error(RETENTION_DATABASE_UNAVAILABLE)
  }

  try {
    const result = await runInferenceCoreRetention(database)
    log(JSON.stringify(result))
    return result
  } finally {
    await closeInferenceCoreDb()
  }
}

export function formatRetentionCommandFailure(error: unknown): string {
  let failureClass: RetentionFailureClass = "retention_execution_failed"
  if (error instanceof Error && error.message === DATABASE_URL_REQUIRED) {
    failureClass = "configuration_missing"
  } else if (
    error instanceof Error &&
    error.message === RETENTION_DATABASE_UNAVAILABLE
  ) {
    failureClass = "database_unavailable"
  }
  return JSON.stringify({
    event: "inference_core_retention_failed",
    failureClass,
  })
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ""
if (invokedPath === fileURLToPath(import.meta.url)) {
  runRetentionCommand().catch((error: unknown) => {
    console.error(formatRetentionCommandFailure(error))
    process.exitCode = 1
  })
}
