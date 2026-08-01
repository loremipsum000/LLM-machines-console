import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  closeInferenceCoreDb,
  getInferenceCoreDb,
} from "../db/inference-core-client"
import {
  type AuditIngestionRunResult,
  runAuditIngestion,
} from "../services/audit-ingestion"
import type { NativeAuditSource } from "../services/expert-capabilities"

const DATABASE_URL_REQUIRED =
  "DATABASE_URL is required for the audit ingestion command."
const AUDIT_DATABASE_UNAVAILABLE =
  "The audit ingestion database is unavailable."
const AUDIT_SOURCES_REQUIRED =
  "At least one qualified native audit source is required."

type AuditIngestionFailureClass =
  | "configuration_missing"
  | "database_unavailable"
  | "ingestion_execution_failed"

export async function runAuditIngestionCommand(
  sources: readonly NativeAuditSource[],
  log: (message: string) => void = console.log,
): Promise<AuditIngestionRunResult> {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error(DATABASE_URL_REQUIRED)
  }
  if (sources.length === 0) {
    throw new Error(AUDIT_SOURCES_REQUIRED)
  }
  const database = getInferenceCoreDb()
  if (!database) {
    throw new Error(AUDIT_DATABASE_UNAVAILABLE)
  }

  try {
    const result = await runAuditIngestion(database, sources)
    log(JSON.stringify(result))
    return result
  } finally {
    await closeInferenceCoreDb()
  }
}

export function formatAuditIngestionCommandFailure(error: unknown): string {
  let failureClass: AuditIngestionFailureClass = "ingestion_execution_failed"
  if (
    error instanceof Error &&
    (error.message === DATABASE_URL_REQUIRED ||
      error.message === AUDIT_SOURCES_REQUIRED)
  ) {
    failureClass = "configuration_missing"
  } else if (
    error instanceof Error &&
    error.message === AUDIT_DATABASE_UNAVAILABLE
  ) {
    failureClass = "database_unavailable"
  }
  return JSON.stringify({
    event: "audit_ingestion_failed",
    failureClass,
  })
}

// Native source adapters and their mounted credentials are intentionally wired
// during appliance runtime qualification in PR-12. The source package remains
// executable but fails closed until that composition is supplied.
const configuredSources: readonly NativeAuditSource[] = []
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ""
if (invokedPath === fileURLToPath(import.meta.url)) {
  runAuditIngestionCommand(configuredSources).catch((error: unknown) => {
    console.error(formatAuditIngestionCommandFailure(error))
    process.exitCode = 1
  })
}
