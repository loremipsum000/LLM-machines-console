import { randomUUID } from "node:crypto"
import { isIP } from "node:net"
import { desc } from "drizzle-orm"
import {
  canUseBffFixtureData,
  isProductionRuntime,
} from "../config/fixture-mode"
import { getInferenceCoreDb } from "../db/inference-core-client"
import { auditEvents } from "../db/inference-core-schema"

export const auditOutcomes = ["succeeded", "failed", "denied"] as const
export type AuditOutcome = (typeof auditOutcomes)[number]

export const auditSourceSystems = [
  "console",
  "keycloak",
  "litellm",
  "grafana",
  "alertmanager",
  "firecrawl",
  "lifecycle",
] as const
export type AuditSourceSystem = (typeof auditSourceSystems)[number]

export interface AuditEventInput {
  action: string
  outcome: AuditOutcome
  sourceSystem: AuditSourceSystem
  correlationId?: string
  keycloakSubjectId?: string
  applicationId?: string
  credentialRecordId?: string
  credentialPrefix?: string
  recoveryReasonCode?: string
}

export interface AuditEventRecord {
  id: string
  occurredAt: string
  action: string
  outcome: AuditOutcome
  sourceSystem: AuditSourceSystem
  correlationId: string
  keycloakSubjectId: string | null
  applicationId: string | null
  credentialRecordId: string | null
  credentialPrefix: string | null
  recoveryReasonCode: string | null
  /**
   * Compatibility projection for the retained Admin read models. These fields
   * are derived only from the canonical audit columns and are never persisted.
   */
  actorId: string
  targetType: string
  targetId: string
  reason?: string
  metadata: Record<string, string>
  createdAt: string
}

const memoryAuditEvents: AuditEventRecord[] = []

export async function emitAudit(
  event: AuditEventInput,
): Promise<AuditEventRecord> {
  const parsed = parseAuditEventInput(event)
  const occurredAt = new Date()
  const record = toAuditEventRecord({
    id: randomUUID(),
    occurredAt,
    ...parsed,
  })

  const db = getInferenceCoreDb()
  if (db) {
    await db.insert(auditEvents).values({
      id: record.id,
      occurredAt,
      action: record.action,
      outcome: record.outcome,
      sourceSystem: record.sourceSystem,
      correlationId: record.correlationId,
      keycloakSubjectId: record.keycloakSubjectId,
      applicationId: record.applicationId,
      credentialRecordId: record.credentialRecordId,
      credentialPrefix: record.credentialPrefix,
      recoveryReasonCode: record.recoveryReasonCode,
    })
  } else {
    assertFixtureAuditStorage()
    memoryAuditEvents.push(record)
  }

  return cloneAuditEvent(record)
}

export function getAuditEventsForTest(): AuditEventRecord[] {
  return memoryAuditEvents.map(cloneAuditEvent)
}

export async function getRecentAuditEvents(
  limit = 10,
): Promise<AuditEventRecord[]> {
  const db = getInferenceCoreDb()
  if (db) {
    const rows = await db
      .select()
      .from(auditEvents)
      .orderBy(desc(auditEvents.occurredAt))
      .limit(limit)

    return rows.map((row) =>
      toAuditEventRecord({
        id: row.id,
        occurredAt: row.occurredAt,
        ...parseAuditEventInput({
          action: row.action,
          outcome: row.outcome,
          sourceSystem: row.sourceSystem,
          correlationId: row.correlationId,
          keycloakSubjectId: row.keycloakSubjectId ?? undefined,
          applicationId: row.applicationId ?? undefined,
          credentialRecordId: row.credentialRecordId ?? undefined,
          credentialPrefix: row.credentialPrefix ?? undefined,
          recoveryReasonCode: row.recoveryReasonCode ?? undefined,
        }),
      }),
    )
  }

  assertFixtureAuditStorage()
  return memoryAuditEvents
    .map(cloneAuditEvent)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, limit)
}

export function resetAuditEventsForTest(): void {
  memoryAuditEvents.length = 0
}

function parseAuditEventInput(value: unknown): RequiredAuditEventInput {
  if (!isPlainRecord(value)) {
    throw new TypeError("Audit event must be a plain object.")
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !auditEventInputKeys.has(key)) {
      throw new TypeError(
        `Audit event contains unsupported field ${String(key)}.`,
      )
    }
  }

  const action = requiredCode(value.action, "action", 128)
  const outcome = requiredEnum(value.outcome, "outcome", auditOutcomes)
  const sourceSystem = requiredEnum(
    value.sourceSystem,
    "sourceSystem",
    auditSourceSystems,
  )
  const correlationId =
    optionalIdentifier(value.correlationId, "correlationId", 128) ??
    randomUUID()
  const keycloakSubjectId = optionalIdentifier(
    value.keycloakSubjectId,
    "keycloakSubjectId",
    255,
  )
  const applicationId = optionalIdentifier(
    value.applicationId,
    "applicationId",
    128,
  )
  const credentialRecordId = optionalIdentifier(
    value.credentialRecordId,
    "credentialRecordId",
    128,
  )
  const credentialPrefix = optionalCredentialPrefix(value.credentialPrefix)
  const recoveryReasonCode = optionalCode(
    value.recoveryReasonCode,
    "recoveryReasonCode",
    64,
  )

  if (credentialRecordId && credentialPrefix) {
    throw new TypeError(
      "Audit event may contain a credential record ID or credential prefix, not both.",
    )
  }

  return {
    action,
    outcome,
    sourceSystem,
    correlationId,
    keycloakSubjectId,
    applicationId,
    credentialRecordId,
    credentialPrefix,
    recoveryReasonCode,
  }
}

function toAuditEventRecord(input: {
  id: string
  occurredAt: Date
  action: string
  outcome: AuditOutcome
  sourceSystem: AuditSourceSystem
  correlationId: string
  keycloakSubjectId: string | null
  applicationId: string | null
  credentialRecordId: string | null
  credentialPrefix: string | null
  recoveryReasonCode: string | null
}): AuditEventRecord {
  const createdAt = input.occurredAt.toISOString()
  const actorId = input.keycloakSubjectId ?? "system"
  const targetType = input.applicationId
    ? "application"
    : input.credentialRecordId || input.credentialPrefix
      ? "credential"
      : input.keycloakSubjectId
        ? "keycloak_subject"
        : "audit_event"
  const targetId =
    input.applicationId ??
    input.credentialRecordId ??
    input.credentialPrefix ??
    input.keycloakSubjectId ??
    input.correlationId
  const metadata = Object.fromEntries(
    Object.entries({
      outcome: input.outcome,
      sourceSystem: input.sourceSystem,
      correlationId: input.correlationId,
      keycloakSubjectId: input.keycloakSubjectId,
      applicationId: input.applicationId,
      credentialRecordId: input.credentialRecordId,
      credentialPrefix: input.credentialPrefix,
      recoveryReasonCode: input.recoveryReasonCode,
    }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  )

  return {
    ...input,
    actorId,
    targetType,
    targetId,
    reason: input.recoveryReasonCode ?? undefined,
    metadata,
    createdAt,
    occurredAt: createdAt,
  }
}

function cloneAuditEvent(record: AuditEventRecord): AuditEventRecord {
  return {
    ...record,
    metadata: { ...record.metadata },
  }
}

function assertFixtureAuditStorage(): void {
  if (isProductionRuntime() || !canUseBffFixtureData()) {
    throw new Error(
      "Audit persistence requires PostgreSQL outside fixture or test mode.",
    )
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function requiredEnum<const T extends readonly string[]>(
  value: unknown,
  field: string,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new TypeError(`Audit ${field} must be one of ${allowed.join(", ")}.`)
  }
  return value
}

function requiredCode(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  const parsed = optionalCode(value, field, maxLength)
  if (!parsed) {
    throw new TypeError(`Audit ${field} is required.`)
  }
  return parsed
}

function optionalCode(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === undefined) {
    return null
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    !/^[a-z][a-z0-9._:-]*$/.test(value) ||
    isIP(value) !== 0 ||
    /^llmm_/i.test(value) ||
    /^[a-f0-9]{64,}$/i.test(value)
  ) {
    throw new TypeError(`Audit ${field} must be a bounded code.`)
  }
  return value
}

function optionalIdentifier(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === undefined) {
    return null
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    !/^[a-z0-9][a-z0-9._:-]*$/i.test(value) ||
    isIP(value) !== 0 ||
    /^llmm_/i.test(value) ||
    /^[a-f0-9]{64,}$/i.test(value)
  ) {
    throw new TypeError(`Audit ${field} must be a safe opaque identifier.`)
  }
  return value
}

function optionalCredentialPrefix(value: unknown): string | null {
  if (value === undefined) {
    return null
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 32 ||
    value.trim() !== value ||
    !/^[a-z0-9][a-z0-9._:-]*$/i.test(value) ||
    isIP(value) !== 0 ||
    /^[a-f0-9]{64,}$/i.test(value)
  ) {
    throw new TypeError("Audit credentialPrefix must be a safe key prefix.")
  }
  return value
}

const auditEventInputKeys = new Set([
  "action",
  "outcome",
  "sourceSystem",
  "correlationId",
  "keycloakSubjectId",
  "applicationId",
  "credentialRecordId",
  "credentialPrefix",
  "recoveryReasonCode",
])

interface RequiredAuditEventInput {
  action: string
  outcome: AuditOutcome
  sourceSystem: AuditSourceSystem
  correlationId: string
  keycloakSubjectId: string | null
  applicationId: string | null
  credentialRecordId: string | null
  credentialPrefix: string | null
  recoveryReasonCode: string | null
}
