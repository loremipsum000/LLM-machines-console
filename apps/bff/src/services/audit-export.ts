import { createHash } from "node:crypto"
import type {
  AdminAuditExportFormat,
  AdminAuditVerificationKeysResponse,
} from "@llm-machines/contracts/inference-core"
import type { Actor } from "../auth/authorization"
import {
  type AuditEventFilters,
  type AuditEventRecord,
  emitAudit,
  getAuditEventsForExport,
} from "./audit"
import {
  type AuditExportProtectedAuthority,
  type AuditExportSigningMaterial,
  loadAuditExportSigningMaterial,
  signAuditExport,
} from "./audit-export-signing"

export const MAX_AUDIT_EXPORT_EVENTS = 5_000
export const MAX_AUDIT_EXPORT_PAYLOAD_BYTES = 8 * 1024 * 1024
export const MAX_AUDIT_EXPORT_RANGE_MS = 365 * 24 * 60 * 60 * 1000

export interface AuditExportWindow {
  cursor?: string | null
  from: Date
  limit?: number
  to: Date
}

export interface SignedAuditExport {
  compactJws: string
  contentType: "application/json" | "text/csv"
  eventCount: number
  filename: string
  format: AdminAuditExportFormat
  nextCursor: string | null
  payloadBytes: number
}

export class AuditExportLimitError extends Error {
  constructor() {
    super("Audit export exceeds the bounded export limit.")
    this.name = "AuditExportLimitError"
  }
}

export class AuditExportRangeError extends Error {
  constructor() {
    super("Audit export range is invalid.")
    this.name = "AuditExportRangeError"
  }
}

export async function createSignedAuditExport(
  actor: Actor,
  format: AdminAuditExportFormat,
  filters: AuditEventFilters,
  window: AuditExportWindow,
  options: {
    material?: AuditExportSigningMaterial
    now?: Date
  } = {},
): Promise<SignedAuditExport> {
  const now = options.now ?? new Date()
  assertExportWindow(window, now)

  try {
    const material =
      options.material ?? (await loadAuditExportSigningMaterial())
    const page = await getAuditEventsForExport(filters, {
      cursor: window.cursor,
      from: window.from,
      limit: boundedExportLimit(window.limit),
      to: window.to,
    })
    const authority = exportAuthority(
      filters,
      window,
      page.requestedCursor,
      page.nextCursor,
      page.events.length,
      now,
    )
    const contentType =
      format === "json" ? ("application/json" as const) : ("text/csv" as const)
    const payload = serializeAuditExportPayload(format, page.events, authority)
    if (payload.byteLength > MAX_AUDIT_EXPORT_PAYLOAD_BYTES) {
      throw new AuditExportLimitError()
    }
    const compactJws = signAuditExport(
      payload,
      contentType,
      material,
      authority,
    )

    await emitAudit({
      action: "admin.audit.export",
      keycloakSubjectId: actor.subject,
      outcome: "succeeded",
      sourceSystem: "console",
    })
    return {
      compactJws,
      contentType,
      eventCount: page.events.length,
      filename: auditExportFilename(format, now),
      format,
      nextCursor: page.nextCursor,
      payloadBytes: payload.byteLength,
    }
  } catch (error) {
    await bestEffortFailedAudit(actor, "admin.audit.export")
    throw error
  }
}

export async function getAuditExportVerificationKeys(
  actor: Actor,
  material?: AuditExportSigningMaterial,
): Promise<AdminAuditVerificationKeysResponse> {
  try {
    const keys = (material ?? (await loadAuditExportSigningMaterial()))
      .verificationKeys
    await emitAudit({
      action: "admin.audit.verification_keys.read",
      keycloakSubjectId: actor.subject,
      outcome: "succeeded",
      sourceSystem: "console",
    })
    return keys
  } catch (error) {
    await bestEffortFailedAudit(actor, "admin.audit.verification_keys.read")
    throw error
  }
}

export function serializeAuditExportPayload(
  format: AdminAuditExportFormat,
  events: readonly AuditEventRecord[],
  authority: AuditExportProtectedAuthority,
): Buffer {
  return format === "json"
    ? Buffer.from(jsonExport(events, authority), "utf8")
    : Buffer.from(csvExport(events), "utf8")
}

function jsonExport(
  events: readonly AuditEventRecord[],
  authority: AuditExportProtectedAuthority,
): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    authority,
    retentionDays: 365,
    events: events.map(canonicalExportEvent),
  })}\n`
}

function csvExport(events: readonly AuditEventRecord[]): string {
  const header = [
    "id",
    "occurred_at",
    "ingested_at",
    "source_system",
    "action",
    "outcome",
    "correlation_id",
    "keycloak_subject_id",
    "application_id",
    "credential_record_id",
    "credential_prefix",
    "recovery_reason_code",
  ]
  const rows = events.map((event) =>
    [
      event.id,
      event.occurredAt,
      event.ingestedAt,
      event.sourceSystem,
      event.action,
      event.outcome,
      event.correlationId,
      event.keycloakSubjectId,
      event.applicationId,
      event.credentialRecordId,
      event.credentialPrefix,
      event.recoveryReasonCode,
    ]
      .map(csvCell)
      .join(","),
  )
  return `${[header.map(csvCell).join(","), ...rows].join("\r\n")}\r\n`
}

function canonicalExportEvent(event: AuditEventRecord) {
  return {
    id: event.id,
    occurredAt: event.occurredAt,
    ingestedAt: event.ingestedAt,
    sourceSystem: event.sourceSystem,
    action: event.action,
    outcome: event.outcome,
    correlationId: event.correlationId,
    keycloakSubjectId: event.keycloakSubjectId,
    applicationId: event.applicationId,
    credentialRecordId: event.credentialRecordId,
    credentialPrefix: event.credentialPrefix,
    recoveryReasonCode: event.recoveryReasonCode,
  }
}

function exportAuthority(
  filters: AuditEventFilters,
  window: AuditExportWindow,
  requestedCursor: string | null,
  nextCursor: string | null,
  rowCount: number,
  now: Date,
): AuditExportProtectedAuthority {
  return {
    schemaVersion: 1,
    exportedAt: now.toISOString(),
    range: {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
    },
    requestedCursor,
    nextCursor,
    rowCount,
    order: "occurred_at_asc,id_asc",
    filters: {
      applicationId: filters.applicationId ?? null,
      eventId: filters.eventId ?? null,
      outcome: filters.outcome ?? null,
      querySha256: filters.query ? sha256(filters.query) : null,
      severity: filters.severity ?? null,
      sourceSystem: filters.sourceSystem ?? null,
    },
  }
}

function csvCell(value: string | null): string {
  const original = value ?? ""
  const safe = /^[\s=+\-@]/.test(original) ? `'${original}` : original
  return `"${safe.replace(/"/g, '""')}"`
}

function assertExportWindow(window: AuditExportWindow, now: Date): void {
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(window.from.getTime()) ||
    !Number.isFinite(window.to.getTime()) ||
    window.from > window.to ||
    window.to > now ||
    window.to.getTime() - window.from.getTime() > MAX_AUDIT_EXPORT_RANGE_MS
  ) {
    throw new AuditExportRangeError()
  }
}

function boundedExportLimit(value: number | undefined): number {
  if (value === undefined) {
    return MAX_AUDIT_EXPORT_EVENTS
  }
  if (!Number.isSafeInteger(value) || value < 1 || value > 5_000) {
    throw new AuditExportRangeError()
  }
  return value
}

async function bestEffortFailedAudit(
  actor: Actor,
  action: string,
): Promise<void> {
  try {
    await emitAudit({
      action,
      keycloakSubjectId: actor.subject,
      outcome: "failed",
      sourceSystem: "console",
    })
  } catch {
    // Export failure is isolated from inference availability.
  }
}

function auditExportFilename(
  format: AdminAuditExportFormat,
  now: Date,
): string {
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
  return `llm-machines-audit-${timestamp}.${format}.jws`
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
