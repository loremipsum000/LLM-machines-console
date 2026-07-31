import { randomUUID } from "node:crypto"
import { desc } from "drizzle-orm"
import { getInferenceCoreDb } from "../db/inference-core-client"
import { auditEvents } from "../db/inference-core-schema"

export interface AuditEventRecord {
  id: string
  actorId: string
  action: string
  targetType: string
  targetId: string
  reason?: string
  metadata: Record<string, unknown>
  createdAt: string
}

const memoryAuditEvents: AuditEventRecord[] = []

export async function emitAudit(event: {
  actorId: string
  action: string
  targetType: string
  targetId: string
  reason?: string
  metadata?: Record<string, unknown>
}): Promise<AuditEventRecord> {
  const record: AuditEventRecord = {
    id: randomUUID(),
    actorId: sanitizeAuditEnvelopeIdentifier(event.actorId),
    action: sanitizeAuditEnvelopeIdentifier(event.action),
    targetType: sanitizeAuditEnvelopeIdentifier(event.targetType),
    targetId: sanitizeAuditEnvelopeIdentifier(event.targetId),
    reason: sanitizeAuditReason(event.reason),
    metadata: sanitizeAuditMetadata(event.metadata),
    createdAt: new Date().toISOString(),
  }

  const db = getInferenceCoreDb()
  if (db) {
    await db.insert(auditEvents).values({
      id: record.id,
      actorId: record.actorId,
      action: record.action,
      targetType: record.targetType,
      targetId: record.targetId,
      reason: record.reason,
      metadata: record.metadata,
      createdAt: new Date(record.createdAt),
    })
  } else {
    memoryAuditEvents.push(record)
  }

  return record
}

export function getAuditEventsForTest(): AuditEventRecord[] {
  return [...memoryAuditEvents]
}

export async function getRecentAuditEvents(
  limit = 10,
): Promise<AuditEventRecord[]> {
  const db = getInferenceCoreDb()
  if (db) {
    const rows = await db
      .select()
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit)

    return rows.map((row) => {
      const metadata =
        row.metadata && typeof row.metadata === "object"
          ? (row.metadata as Record<string, unknown>)
          : undefined
      return {
        id: row.id,
        actorId: sanitizeAuditEnvelopeIdentifier(row.actorId),
        action: sanitizeAuditEnvelopeIdentifier(row.action),
        targetType: sanitizeAuditEnvelopeIdentifier(row.targetType),
        targetId: sanitizeAuditEnvelopeIdentifier(row.targetId),
        reason: sanitizeAuditReason(row.reason ?? undefined),
        metadata: sanitizeAuditMetadata(metadata),
        createdAt: row.createdAt.toISOString(),
      }
    })
  }

  return [...memoryAuditEvents]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
}

export function resetAuditEventsForTest(): void {
  memoryAuditEvents.length = 0
}

export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  if (!metadata) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(metadata).flatMap(([key, value]) => {
      if (!safeAuditMetadataKeys.has(key)) {
        return []
      }
      const sanitized = sanitizeAuditMetadataValue(key, value)
      return sanitized === null ? [] : [[key, sanitized]]
    }),
  )
}

function sanitizeAuditReason(reason: string | undefined): string | undefined {
  const normalized = reason?.trim()
  return normalized && retainedAuditReasonCodes.has(normalized)
    ? normalized
    : undefined
}

function sanitizeAuditEnvelopeIdentifier(value: string): string {
  const normalized = value.trim()
  return normalized.length <= 128 &&
    /^[a-z0-9][a-z0-9._:-]*$/i.test(normalized)
    ? normalized
    : "redacted"
}

function sanitizeAuditMetadataValue(
  key: string,
  value: unknown,
): string | number | boolean | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === "boolean") {
    return value
  }
  if (typeof value !== "string") {
    return null
  }

  const normalized = value.trim()
  if (!normalized || normalized.length > 256) {
    return null
  }
  if (
    key === "route" &&
    !/^\/[a-z0-9_/:.-]{1,255}$/i.test(normalized)
  ) {
    return null
  }
  return normalized
}

const safeAuditMetadataKeys = new Set([
  "appId",
  "applicationId",
  "application_id",
  "authMethod",
  "authMode",
  "clientId",
  "completionTokens",
  "correlationId",
  "correlation_id",
  "credentialId",
  "credentialRecordId",
  "credential_id",
  "durationMs",
  "keyId",
  "keyPrefix",
  "key_identifier",
  "keycloakSubjectId",
  "keycloak_subject_id",
  "latencyMs",
  "model",
  "outcome",
  "promptTokens",
  "requestCount",
  "returnedCount",
  "route",
  "selectedEventId",
  "source",
  "sourceSystem",
  "status",
  "statusCode",
  "tokens",
  "totalTokens",
])

const retainedAuditReasonCodes = new Set([
  "adapter_blocked",
  "insufficient_persona",
  "invalid_forwarded_identity",
  "invalid_forwarded_token",
  "invalid_token",
  "missing_token",
  "not_available_or_unconfigured",
  "unresolved_placeholder",
])
