import type {
  AdminAuditEvent,
  AdminAuditResponse,
  HubSeverity,
} from "@llm-machines/contracts"
import { personaCanAccess } from "@llm-machines/contracts"
import type { Actor } from "../auth/persona"
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
  if (!personaCanAccess(actor.persona, "admin")) {
    throw new Error("Admin audit requires admin persona.")
  }

  const generatedAt = new Date().toISOString()
  const normalizedQuery = normalizeQuery(filters.query)
  const selectedEventId = normalizeQuery(filters.eventId)
  const limit = clampLimit(filters.limit)
  const allEvents = await getRecentAuditEvents(MAX_AUDIT_LOOKBACK)
  const events = allEvents
    .filter((event) => matchesFilters(event, normalizedQuery, selectedEventId))
    .slice(0, limit)
    .map(toAdminAuditEvent)

  await emitAudit({
    actorId: actor.subject,
    action: "admin.audit.read",
    targetType: "common.audit_events",
    targetId: selectedEventId ?? "timeline",
    metadata: {
      authMode: actor.authMode,
      query: normalizedQuery,
      selectedEventId,
      returnedCount: events.length,
    },
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

function auditSeverity(event: AuditEventRecord): HubSeverity {
  const action = event.action.toLowerCase()
  if (
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
    .filter(([, value]) => value !== null && value !== undefined)
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
  return JSON.stringify(value)
}
