import type {
  AdminAuditEvent,
  AdminPolicyViolation,
  AdminPolicyViolationRemediationRequest,
  AdminPolicyViolationsResponse,
  AdminPureModeResponse,
  HubSeverity,
  HubSourceStatus,
} from "@llm-machines/contracts"
import { personaCanAccess } from "@llm-machines/contracts"
import type { Actor } from "../auth/persona"
import type { PolicyViolationRecord } from "./admin-governance-state"
import {
  readGovernanceState,
  recordPolicyViolationRemediation,
} from "./admin-governance-state"
import type { AuditEventRecord } from "./audit"
import { emitAudit, getRecentAuditEvents } from "./audit"

export async function getAdminPolicyViolations(
  actor: Actor,
  filters: { query?: string } = {},
): Promise<AdminPolicyViolationsResponse> {
  if (!personaCanAccess(actor.persona, "admin")) {
    throw new Error("Admin policy violations require admin persona.")
  }

  const generatedAt = new Date().toISOString()
  const query = normalizeQuery(filters.query)
  const source = await readGovernanceState()

  await emitAudit({
    actorId: actor.subject,
    action: "admin.policy_violations.read",
    targetType: "admin.policy_violations",
    targetId: query ?? "24h",
    metadata: {
      authMode: actor.authMode,
      query,
      sourceStatus: source.sourceStatus,
    },
  })

  if (source.sourceStatus !== "ok") {
    return emptyPolicyViolations(generatedAt, query, source.sourceStatus)
  }

  const records = source.policyViolations.records.filter((violation) =>
    matchesViolation(violation, query),
  )

  return {
    generatedAt,
    query,
    sourceStatus: records.length > 0 ? "degraded" : "ok",
    window: "24h",
    totalCount: records.length,
    criticalCount: records.filter((record) => record.severity === "critical")
      .length,
    warningCount: records.filter((record) => record.severity === "warning")
      .length,
    violations: records.map(toAdminPolicyViolation),
  }
}

export async function remediateAdminPolicyViolation(
  actor: Actor,
  violationId: string,
  input: AdminPolicyViolationRemediationRequest,
): Promise<AdminPolicyViolation | null> {
  if (!personaCanAccess(actor.persona, "admin")) {
    throw new Error("Admin policy remediation requires admin persona.")
  }

  const violation = await recordPolicyViolationRemediation({
    actor,
    note: input.note,
    status: input.status,
    violationId,
  })
  if (!violation) {
    return null
  }

  await emitAudit({
    actorId: actor.subject,
    action: `admin.policy_violation.${input.status}`,
    targetType: "admin.policy_violations",
    targetId: violation.id,
    reason: input.note,
    metadata: {
      policyType: violation.policyType,
      remediationStatus: input.status,
      severity: violation.severity,
      violatedTargetId: violation.targetId,
      violatedTargetType: violation.targetType,
    },
  })

  return toAdminPolicyViolation(violation)
}

export async function getAdminPureMode(
  actor: Actor,
): Promise<AdminPureModeResponse> {
  if (!personaCanAccess(actor.persona, "admin")) {
    throw new Error("Admin Pure Mode requires admin persona.")
  }

  const generatedAt = new Date().toISOString()
  const source = await readGovernanceState()
  const recentEvents = (await getRecentAuditEvents(50))
    .filter(isPureModeAuditEvent)
    .slice(0, 10)
    .map(toAdminAuditEvent)

  await emitAudit({
    actorId: actor.subject,
    action: "admin.pure_mode.read",
    targetType: "admin.pure_mode_state",
    targetId: "singleton",
    metadata: {
      authMode: actor.authMode,
      sourceStatus: source.sourceStatus,
      recentEventCount: recentEvents.length,
    },
  })

  if (source.sourceStatus !== "ok") {
    return {
      ...emptyPureMode(generatedAt, source.sourceStatus),
      recentEvents,
    }
  }

  const pureMode = source.pureMode
  return {
    generatedAt,
    sourceStatus: pureMode.active ? "degraded" : "ok",
    active: pureMode.active,
    reason: pureMode.reason,
    activatedBy: pureMode.activatedBy,
    activatedAt: pureMode.activatedAt,
    deactivatedAt: pureMode.deactivatedAt,
    affectedComponents: pureMode.affectedComponents,
    updatedAt: pureMode.updatedAt,
    control: pureModeControl("ok"),
    recentEvents,
  }
}

function emptyPolicyViolations(
  generatedAt: string,
  query: string | null,
  sourceStatus: HubSourceStatus,
): AdminPolicyViolationsResponse {
  return {
    generatedAt,
    query,
    sourceStatus,
    window: "24h",
    totalCount: 0,
    criticalCount: 0,
    warningCount: 0,
    violations: [],
  }
}

function emptyPureMode(
  generatedAt: string,
  sourceStatus: HubSourceStatus,
): Omit<AdminPureModeResponse, "recentEvents"> {
  return {
    generatedAt,
    sourceStatus,
    active: false,
    reason: null,
    activatedBy: null,
    activatedAt: null,
    deactivatedAt: null,
    affectedComponents: [],
    updatedAt: null,
    control: pureModeControl(sourceStatus),
  }
}

function toAdminPolicyViolation(
  violation: PolicyViolationRecord,
): AdminPolicyViolation {
  return {
    id: violation.id,
    policyId: violation.policyId,
    policyType: violation.policyType,
    severity: violation.severity,
    actionTaken: violation.actionTaken,
    remediationStatus: violation.remediationStatus,
    remediationActorId: violation.remediationActorId,
    remediationAt: violation.remediationAt,
    remediationNote: violation.remediationNote,
    actorId: violation.actorId,
    targetType: violation.targetType,
    targetId: violation.targetId,
    message: violation.message,
    metadata: metadataEntries(violation.metadata),
    auditHref: "#audit-log-deferred",
    createdAt: violation.createdAt,
  }
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

function pureModeControl(
  sourceStatus: HubSourceStatus,
): AdminPureModeResponse["control"] {
  if (sourceStatus === "unavailable") {
    return {
      enabled: false,
      reason:
        "Pure Mode transitions are unavailable because the governance store could not be read.",
    }
  }
  if (sourceStatus === "not_configured") {
    return {
      enabled: false,
      reason:
        "Pure Mode transitions require the governance store before they can be persisted.",
    }
  }

  return {
    enabled: true,
    reason:
      "Pure Mode transitions require an Admin role, an idempotency key, a reason, and the typed confirmation PURE.",
  }
}

function normalizeQuery(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function matchesViolation(
  violation: PolicyViolationRecord,
  query: string | null,
): boolean {
  if (!query) {
    return true
  }
  const haystack = [
    violation.id,
    violation.policyId ?? "",
    violation.policyType,
    violation.severity,
    violation.actionTaken,
    violation.remediationActorId ?? "",
    violation.remediationAt ?? "",
    violation.remediationNote ?? "",
    violation.remediationStatus,
    violation.actorId ?? "",
    violation.targetType,
    violation.targetId,
    violation.message,
    ...Object.values(violation.metadata).map(stringifyMetadataValue),
  ]
    .join(" ")
    .toLowerCase()
  return haystack.includes(query.toLowerCase())
}

function isPureModeAuditEvent(event: AuditEventRecord): boolean {
  const haystack =
    `${event.action} ${event.targetType} ${event.targetId}`.toLowerCase()
  return haystack.includes("pure_mode") || haystack.includes("pure-mode")
}

function auditSeverity(event: AuditEventRecord): HubSeverity {
  if (event.action.includes("failed") || event.action.includes("denied")) {
    return "warning"
  }
  if (event.action.includes("toggle") || event.action.includes("activate")) {
    return "critical"
  }
  return "info"
}

function metadataEntries(
  metadata: Record<string, unknown>,
): AdminPolicyViolation["metadata"] {
  return Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined)
    .slice(0, 6)
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
  return JSON.stringify(value)
}
