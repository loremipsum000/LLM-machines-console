import type {
  AdminAuditEvent,
  AdminAuditResponse,
  AdminAuditSource,
  InferenceCoreAuditOutcome,
  InferenceCoreAuditSourceSystem,
  InferenceCoreSeverity,
} from "@llm-machines/contracts/inference-core"
import type { Actor } from "../auth/authorization"
import {
  type AuditEventRecord,
  auditOutcomes,
  auditSeverity,
  auditSourceSystems,
  emitAudit,
  getAuditEventPage,
} from "./audit"
import { getAuditSourceHealth } from "./audit-ingestion"

export interface AdminAuditFilters {
  applicationId?: string
  cursor?: string
  eventId?: string
  outcome?: string
  query?: string
  limit?: number
  severity?: string
  sourceSystem?: string
}

const MAX_AUDIT_PAGE_SIZE = 100

export class AdminAuditFilterError extends Error {
  constructor() {
    super("Audit filters are invalid.")
    this.name = "AdminAuditFilterError"
  }
}

export interface NormalizedAdminAuditFilters {
  applicationId: string | null
  cursor: string | null
  eventId: string | null
  limit: number
  outcome: InferenceCoreAuditOutcome | null
  query: string | null
  severity: InferenceCoreSeverity | null
  sourceSystem: InferenceCoreAuditSourceSystem | null
}

export async function getAdminAuditTimeline(
  actor: Actor,
  filters: AdminAuditFilters = {},
): Promise<AdminAuditResponse> {
  if (actor.role !== "admin" && actor.role !== "operator") {
    throw new Error("Admin audit requires Admin or Operator access.")
  }

  const generatedAt = new Date().toISOString()
  const normalized = normalizeFilters(filters)
  const [page, nativeHealth] = await Promise.all([
    getAuditEventPage(
      {
        applicationId: normalized.applicationId,
        eventId: normalized.eventId,
        outcome: normalized.outcome,
        query: normalized.query,
        severity: normalized.severity,
        sourceSystem: normalized.sourceSystem,
      },
      { cursor: normalized.cursor, limit: normalized.limit },
    ),
    getAuditSourceHealth(),
  ])
  const sources = auditSources(nativeHealth)

  await emitAudit({
    action: "admin.audit.read",
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })

  return {
    generatedAt,
    query: normalized.query,
    selectedEventId: normalized.eventId,
    selectedApplicationId: normalized.applicationId,
    selectedSource: normalized.sourceSystem,
    selectedOutcome: normalized.outcome,
    selectedSeverity: normalized.severity,
    nextCursor: page.nextCursor,
    sourceStatus: aggregateAuditSourceStatus(sources),
    sources,
    events: page.events.map(toAdminAuditEvent),
  }
}

function aggregateAuditSourceStatus(
  sources: AdminAuditSource[],
): AdminAuditResponse["sourceStatus"] {
  const nativeSources = sources.filter(
    (source) =>
      source.ingressReadiness === "implemented_pending_runtime_qualification",
  )
  if (
    nativeSources.some(
      (source) =>
        source.sourceStatus === "degraded" ||
        source.sourceStatus === "unavailable",
    )
  ) {
    return "degraded"
  }
  return nativeSources.some(
    (source) => source.sourceStatus === "not_configured",
  )
    ? "not_configured"
    : "ok"
}

export function normalizeAdminAuditFilters(
  filters: AdminAuditFilters,
): NormalizedAdminAuditFilters {
  return normalizeFilters(filters)
}

function normalizeFilters(filters: AdminAuditFilters) {
  const query = optionalSearch(filters.query)
  const eventId = optionalUuid(filters.eventId)
  const applicationId = optionalIdentifier(filters.applicationId, 128)
  const cursor = optionalCursor(filters.cursor)
  const sourceSystem = optionalEnum(filters.sourceSystem, auditSourceSystems)
  const outcome = optionalEnum(filters.outcome, auditOutcomes)
  const severity = optionalEnum(filters.severity, [
    "info",
    "warning",
    "critical",
  ] as const)
  return {
    applicationId,
    cursor,
    eventId,
    limit: clampLimit(filters.limit),
    outcome,
    query,
    severity,
    sourceSystem,
  }
}

function auditSources(
  nativeHealth: Awaited<ReturnType<typeof getAuditSourceHealth>>,
): AdminAuditSource[] {
  const healthBySource = new Map<string, (typeof nativeHealth)[number]>(
    nativeHealth.map((health) => [health.sourceSystem, health]),
  )
  return auditSourceSystems.map((id) => {
    const health = healthBySource.get(id)
    if (health) {
      return {
        id,
        label: auditSourceLabel(id),
        sourceStatus: health.sourceStatus,
        ingressReadiness: "implemented_pending_runtime_qualification",
        cursorHealth: health.cursorHealth,
        lastAttemptAt: health.lastAttemptAt,
        lastSuccessAt: health.lastSuccessAt,
        lastEventAt: health.lastEventAt,
        lastErrorCode: health.lastErrorCode,
      }
    }
    return {
      id,
      label: auditSourceLabel(id),
      sourceStatus: "ok",
      ingressReadiness: "not_applicable",
      cursorHealth: "not_applicable",
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastEventAt: null,
      lastErrorCode: null,
    }
  })
}

function auditSourceLabel(source: InferenceCoreAuditSourceSystem): string {
  return {
    console: "Console",
    keycloak: "Keycloak",
    litellm: "LiteLLM",
    grafana: "Grafana",
    alertmanager: "Alertmanager",
    firecrawl: "Firecrawl",
    lifecycle: "Appliance lifecycle",
  }[source]
}

function toAdminAuditEvent(event: AuditEventRecord): AdminAuditEvent {
  return {
    id: event.id,
    actorId: event.actorId,
    action: event.action,
    outcome: event.outcome,
    sourceSystem: event.sourceSystem,
    targetType: event.targetType,
    targetId: event.targetId,
    reason: event.reason ?? null,
    severity: auditSeverity(event),
    metadata: metadataEntries(event.metadata),
    href: `/activity?eventId=${encodeURIComponent(event.id)}`,
    createdAt: event.createdAt,
  }
}

function metadataEntries(
  metadata: Record<string, unknown>,
): AdminAuditEvent["metadata"] {
  return Object.entries(metadata)
    .slice(0, 8)
    .map(([label, value]) => ({
      label,
      value: stringifyMetadataValue(value),
    }))
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

function optionalSearch(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") {
    return null
  }
  const normalized = value.trim()
  if (normalized.length > 160 || hasControlCharacter(normalized)) {
    throw new AdminAuditFilterError()
  }
  return normalized
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 31 || code === 127) {
      return true
    }
  }
  return false
}

function optionalUuid(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") {
    return null
  }
  const normalized = value.trim()
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalized,
    )
  ) {
    throw new AdminAuditFilterError()
  }
  return normalized
}

function optionalIdentifier(
  value: string | undefined,
  maximumLength: number,
): string | null {
  if (value === undefined || value.trim() === "") {
    return null
  }
  const normalized = value.trim()
  if (
    normalized.length > maximumLength ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)
  ) {
    throw new AdminAuditFilterError()
  }
  return normalized
}

function optionalCursor(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") {
    return null
  }
  const normalized = value.trim()
  if (normalized.length > 512 || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new AdminAuditFilterError()
  }
  return normalized
}

function optionalEnum<const T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
): T[number] | null {
  if (value === undefined || value.trim() === "") {
    return null
  }
  if (!allowed.includes(value)) {
    throw new AdminAuditFilterError()
  }
  return value
}

function clampLimit(value: number | undefined): number {
  if (value === undefined) {
    return 50
  }
  if (!Number.isFinite(value)) {
    throw new AdminAuditFilterError()
  }
  return Math.min(Math.max(Math.trunc(value), 1), MAX_AUDIT_PAGE_SIZE)
}
