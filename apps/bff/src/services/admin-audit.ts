import type {
  AdminAuditEvent,
  AdminAuditResponse,
  InferenceCoreSeverity,
} from "@llm-machines/contracts/inference-core"
import type { Actor } from "../auth/authorization"
import type { AuditEventRecord } from "./audit"
import { emitAudit, getRecentAuditEvents } from "./audit"

export interface AdminAuditFilters {
  eventId?: string
  query?: string
  limit?: number
}

const MAX_AUDIT_LOOKBACK = 100

export async function getAdminAuditTimeline(
  actor: Actor,
  filters: AdminAuditFilters = {},
): Promise<AdminAuditResponse> {
  if (
    actor.role !== "admin" &&
    actor.role !== "operator"
  ) {
    throw new Error("Admin audit requires Admin or Operator access.")
  }

  const generatedAt = new Date().toISOString()
  const normalizedQuery = normalizeQuery(filters.query)
  const selectedEventId = normalizeEventId(filters.eventId)
  const limit = clampLimit(filters.limit)
  const allEvents = await getRecentAuditEvents(MAX_AUDIT_LOOKBACK)
  const events = allEvents
    .filter((event) => matchesFilters(event, normalizedQuery, selectedEventId))
    .slice(0, limit)
    .map(toAdminAuditEvent)

  await emitAudit({
    action: "admin.audit.read",
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })

  return {
    generatedAt,
    query: normalizedQuery,
    selectedEventId,
    sourceStatus: "degraded",
    sources: [
      {
        id: "console",
        label: "Console audit",
        sourceStatus: "ok",
      },
      {
        id: "external-audit",
        label: "External audit sources",
        sourceStatus: "not_configured",
      },
    ],
    events,
  }
}

function normalizeQuery(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function normalizeEventId(value: string | undefined): string | null {
  const normalized = normalizeQuery(value)
  return normalized &&
    normalized.length <= 128 &&
    /^[a-z0-9][a-z0-9._:-]*$/i.test(normalized)
    ? normalized
    : null
}

function clampLimit(value: number | undefined): number {
  if (!value || Number.isNaN(value)) {
    return 50
  }
  return Math.min(Math.max(Math.trunc(value), 1), MAX_AUDIT_LOOKBACK)
}

function matchesFilters(
  event: AuditEventRecord,
  query: string | null,
  selectedEventId: string | null,
): boolean {
  if (selectedEventId && event.id !== selectedEventId) {
    return false
  }
  if (!query) {
    return true
  }

  const haystack = [
    event.id,
    event.actorId,
    event.action,
    event.targetType,
    event.targetId,
    event.reason ?? "",
    ...metadataValues(event.metadata),
  ]
    .join(" ")
    .toLowerCase()

  return haystack.includes(query.toLowerCase())
}

function toAdminAuditEvent(event: AuditEventRecord): AdminAuditEvent {
  return {
    id: event.id,
    actorId: event.actorId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    reason: event.reason ?? null,
    severity: auditSeverity(event),
    metadata: metadataEntries(event.metadata),
    href: "#audit-log-deferred",
    createdAt: event.createdAt,
  }
}

function auditSeverity(event: AuditEventRecord): InferenceCoreSeverity {
  const action = event.action.toLowerCase()
  if (
    event.outcome !== "succeeded" ||
    action.includes("failed") ||
    action.includes("denied") ||
    action.includes("reject") ||
    event.reason
  ) {
    return "warning"
  }
  return "info"
}

function metadataEntries(
  metadata: Record<string, unknown>,
): AdminAuditEvent["metadata"] {
  return Object.entries(metadata)
    .slice(0, 6)
    .map(([label, value]) => ({
      label,
      value: stringifyMetadataValue(value),
    }))
}

function metadataValues(metadata: Record<string, unknown>): string[] {
  return Object.values(metadata).map(stringifyMetadataValue)
}

function stringifyMetadataValue(value: unknown): string {
  if (typeof value === "string") {
    return value
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return ""
}
