import { randomUUID } from "node:crypto"
import { isIP } from "node:net"
import {
  type SQL,
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  isNotNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm"
import {
  canUseBffFixtureData,
  isProductionRuntime,
} from "../config/fixture-mode"
import {
  type InferenceCoreDatabase,
  type InferenceCoreQueryExecutor,
  getInferenceCoreDb,
} from "../db/inference-core-client"
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

export const nativeAuditSourceSystems = [
  "keycloak",
  "litellm",
  "grafana",
  "alertmanager",
] as const
export type NativeAuditSourceSystem = (typeof nativeAuditSourceSystems)[number]

export const nativeAuditActions = {
  keycloak: [
    "keycloak.authentication.failed",
    "keycloak.authentication.succeeded",
    "keycloak.credential.updated",
    "keycloak.role.assigned",
    "keycloak.role.revoked",
    "keycloak.user.created",
    "keycloak.user.deleted",
    "keycloak.user.updated",
  ],
  litellm: [
    "litellm.request.denied",
    "litellm.request.failed",
    "litellm.request.succeeded",
    "litellm.route.created",
    "litellm.route.deleted",
    "litellm.route.updated",
    "litellm.virtual_key.created",
    "litellm.virtual_key.revoked",
    "litellm.virtual_key.rotated",
    "litellm.virtual_key.updated",
  ],
  grafana: [
    "grafana.alert_rule.created",
    "grafana.alert_rule.deleted",
    "grafana.alert_rule.updated",
    "grafana.dashboard.created",
    "grafana.dashboard.deleted",
    "grafana.dashboard.updated",
    "grafana.datasource.updated",
    "grafana.folder.created",
    "grafana.folder.deleted",
    "grafana.folder.updated",
  ],
  alertmanager: [
    "alertmanager.configuration.reloaded",
    "alertmanager.notification.failed",
    "alertmanager.notification.succeeded",
    "alertmanager.silence.created",
    "alertmanager.silence.deleted",
    "alertmanager.silence.expired",
  ],
} as const satisfies Record<NativeAuditSourceSystem, readonly string[]>

export const nativeAuditRecoveryReasonCodes = {
  keycloak: [
    "account_disabled",
    "authentication_failed",
    "authorization_denied",
    "invalid_credentials",
    "policy_rejected",
  ],
  litellm: [
    "model_denied",
    "rate_limited",
    "request_failed",
    "route_unavailable",
  ],
  grafana: ["operation_failed", "permission_denied", "validation_failed"],
  alertmanager: ["delivery_failed", "receiver_unavailable", "silence_rejected"],
} as const satisfies Record<NativeAuditSourceSystem, readonly string[]>

export type AuditSeverity = "info" | "warning" | "critical"

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
  ingestedAt: string
  action: string
  outcome: AuditOutcome
  sourceSystem: AuditSourceSystem
  correlationId: string
  keycloakSubjectId: string | null
  applicationId: string | null
  credentialRecordId: string | null
  credentialPrefix: string | null
  recoveryReasonCode: string | null
  actorId: string
  targetType: string
  targetId: string
  reason?: string
  metadata: Record<string, string>
  createdAt: string
}

export interface AuditEventFilters {
  applicationId?: string | null
  eventId?: string | null
  outcome?: AuditOutcome | null
  query?: string | null
  severity?: AuditSeverity | null
  sourceSystem?: AuditSourceSystem | null
}

export interface AuditEventPage {
  events: AuditEventRecord[]
  nextCursor: string | null
}

export interface AuditExportEventPage extends AuditEventPage {
  requestedCursor: string | null
}

export interface ParsedAuditEventInput {
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

const memoryAuditEvents: AuditEventRecord[] = []
const MAX_AUDIT_PAGE_SIZE = 100
const MAX_AUDIT_EXPORT_ROWS_PLUS_ONE = 5_001

export class InvalidAuditCursorError extends Error {
  constructor() {
    super("Audit cursor is invalid.")
    this.name = "InvalidAuditCursorError"
  }
}

export async function emitAudit(
  event: AuditEventInput,
  database: InferenceCoreQueryExecutor | null = getInferenceCoreDb(),
): Promise<AuditEventRecord> {
  const parsed = parseAuditEventInput(event)
  if (isNativeAuditSourceSystem(parsed.sourceSystem)) {
    throw new TypeError(
      "Native audit events require the deterministic ingestion path.",
    )
  }
  const occurredAt = new Date()
  const record = toAuditEventRecord({
    id: randomUUID(),
    occurredAt,
    ingestedAt: occurredAt,
    ...parsed,
  })

  if (database) {
    await database.insert(auditEvents).values(auditEventValues(record))
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
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(limit)

    return rows.map(auditRowToRecord)
  }

  assertFixtureAuditStorage()
  return stableMemoryEvents().slice(0, limit).map(cloneAuditEvent)
}

export async function getAuditEventPage(
  filters: AuditEventFilters,
  options: {
    cursor?: string | null
    database?: InferenceCoreDatabase | null
    limit?: number
  } = {},
): Promise<AuditEventPage> {
  const limit = boundedInteger(options.limit, 50, MAX_AUDIT_PAGE_SIZE)
  const cursor = decodeAuditCursor(options.cursor)
  const database = options.database ?? getInferenceCoreDb()
  const events = database
    ? await getDatabaseAuditEvents(database, filters, cursor, limit + 1)
    : getFixtureAuditEvents(filters, cursor).slice(0, limit + 1)
  const hasMore = events.length > limit
  const page = events.slice(0, limit)
  const last = hasMore ? page.at(-1) : undefined

  return {
    events: page.map(cloneAuditEvent),
    nextCursor: last ? encodeAuditCursor(last) : null,
  }
}

export async function getAuditEventsForExport(
  filters: AuditEventFilters,
  options: {
    cursor?: string | null
    database?: InferenceCoreDatabase | null
    from: Date
    limit?: number
    to: Date
  },
): Promise<AuditExportEventPage> {
  const limit = boundedInteger(
    options.limit,
    5_000,
    MAX_AUDIT_EXPORT_ROWS_PLUS_ONE - 1,
  )
  const cursor = decodeAuditCursor(options.cursor)
  const database = options.database ?? getInferenceCoreDb()
  const events = database
    ? await getDatabaseAuditEventsAscending(
        database,
        filters,
        cursor,
        options.from,
        options.to,
        limit + 1,
      )
    : getFixtureAuditEventsAscending(
        filters,
        cursor,
        options.from,
        options.to,
      ).slice(0, limit + 1)
  const hasMore = events.length > limit
  const page = events.slice(0, limit)
  const last = hasMore ? page.at(-1) : undefined
  return {
    events: page.map(cloneAuditEvent),
    nextCursor: last ? encodeAuditCursor(last) : null,
    requestedCursor: options.cursor ?? null,
  }
}

export function resetAuditEventsForTest(): void {
  memoryAuditEvents.length = 0
}

export function parseAuditEventInput(value: unknown): ParsedAuditEventInput {
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
  const suppliedCorrelationId = optionalIdentifier(
    value.correlationId,
    "correlationId",
    128,
  )
  const correlationId = suppliedCorrelationId ?? randomUUID()
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
  const nativeSource = isNativeAuditSourceSystem(sourceSystem)
  if (nativeSource && !suppliedCorrelationId) {
    throw new TypeError("Native audit events require a correlation ID.")
  }
  if (nativeSource && !isCanonicalUuid(correlationId)) {
    throw new TypeError("Native audit correlationId must be a canonical UUID.")
  }
  if (nativeSource) {
    if (!nativeAuditActions[sourceSystem].includes(action as never)) {
      throw new TypeError("Native audit action is not allowlisted.")
    }
    if (
      recoveryReasonCode &&
      !nativeAuditRecoveryReasonCodes[sourceSystem].includes(
        recoveryReasonCode as never,
      )
    ) {
      throw new TypeError("Native audit recoveryReasonCode is not allowlisted.")
    }
    assertNativeIdentifier(keycloakSubjectId, "keycloakSubjectId")
    assertNativeIdentifier(applicationId, "applicationId")
    assertNativeIdentifier(credentialRecordId, "credentialRecordId")
    assertNativeCredentialPrefix(credentialPrefix)
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

export function auditSeverity(event: AuditEventRecord): AuditSeverity {
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

function auditEventValues(record: AuditEventRecord) {
  return {
    id: record.id,
    occurredAt: new Date(record.occurredAt),
    ingestedAt: new Date(record.ingestedAt),
    action: record.action,
    outcome: record.outcome,
    sourceSystem: record.sourceSystem,
    correlationId: record.correlationId,
    keycloakSubjectId: record.keycloakSubjectId,
    applicationId: record.applicationId,
    credentialRecordId: record.credentialRecordId,
    credentialPrefix: record.credentialPrefix,
    recoveryReasonCode: record.recoveryReasonCode,
  }
}

function auditRowToRecord(row: typeof auditEvents.$inferSelect) {
  return toAuditEventRecord({
    id: row.id,
    occurredAt: row.occurredAt,
    ingestedAt: row.ingestedAt,
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
  })
}

function toAuditEventRecord(input: {
  id: string
  occurredAt: Date
  ingestedAt: Date
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
  const occurredAt = input.occurredAt.toISOString()
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
    createdAt: occurredAt,
    occurredAt,
    ingestedAt: input.ingestedAt.toISOString(),
  }
}

async function getDatabaseAuditEvents(
  database: InferenceCoreDatabase,
  filters: AuditEventFilters,
  cursor: AuditCursor | null,
  limit: number,
): Promise<AuditEventRecord[]> {
  const conditions = databaseAuditConditions(filters, cursor)
  const rows = await database
    .select()
    .from(auditEvents)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(limit)
  return rows.map(auditRowToRecord)
}

async function getDatabaseAuditEventsAscending(
  database: InferenceCoreDatabase,
  filters: AuditEventFilters,
  cursor: AuditCursor | null,
  from: Date,
  to: Date,
  limit: number,
): Promise<AuditEventRecord[]> {
  const conditions = databaseAuditConditions(filters, null)
  conditions.push(gte(auditEvents.occurredAt, from))
  conditions.push(lte(auditEvents.occurredAt, to))
  if (cursor) {
    const occurredAt = new Date(cursor.occurredAt)
    const cursorCondition = or(
      gt(auditEvents.occurredAt, occurredAt),
      and(
        eq(auditEvents.occurredAt, occurredAt),
        gt(auditEvents.id, cursor.id),
      ),
    )
    if (cursorCondition) {
      conditions.push(cursorCondition)
    }
  }
  const rows = await database
    .select()
    .from(auditEvents)
    .where(and(...conditions))
    .orderBy(asc(auditEvents.occurredAt), asc(auditEvents.id))
    .limit(limit)
  return rows.map(auditRowToRecord)
}

function databaseAuditConditions(
  filters: AuditEventFilters,
  cursor: AuditCursor | null,
): SQL[] {
  const conditions: SQL[] = []
  if (filters.eventId) {
    conditions.push(eq(auditEvents.id, filters.eventId))
  }
  if (filters.applicationId) {
    conditions.push(eq(auditEvents.applicationId, filters.applicationId))
  }
  if (filters.sourceSystem) {
    conditions.push(eq(auditEvents.sourceSystem, filters.sourceSystem))
  }
  if (filters.outcome) {
    conditions.push(eq(auditEvents.outcome, filters.outcome))
  }
  if (filters.query) {
    const pattern = `%${escapeLike(filters.query)}%`
    const queryCondition = or(
      sql`${auditEvents.id}::text ILIKE ${pattern}`,
      ilike(auditEvents.action, pattern),
      ilike(auditEvents.correlationId, pattern),
      ilike(auditEvents.keycloakSubjectId, pattern),
      ilike(auditEvents.applicationId, pattern),
      ilike(auditEvents.credentialRecordId, pattern),
      ilike(auditEvents.credentialPrefix, pattern),
      ilike(auditEvents.recoveryReasonCode, pattern),
    )
    if (queryCondition) {
      conditions.push(queryCondition)
    }
  }
  const severity = databaseSeverityCondition(filters.severity)
  if (severity) {
    conditions.push(severity)
  }
  if (cursor) {
    const occurredAt = new Date(cursor.occurredAt)
    const cursorCondition = or(
      lt(auditEvents.occurredAt, occurredAt),
      and(
        eq(auditEvents.occurredAt, occurredAt),
        lt(auditEvents.id, cursor.id),
      ),
    )
    if (cursorCondition) {
      conditions.push(cursorCondition)
    }
  }
  return conditions
}

function databaseSeverityCondition(
  severity: AuditSeverity | null | undefined,
): SQL | null {
  if (!severity) {
    return null
  }
  const warning = or(
    ne(auditEvents.outcome, "succeeded"),
    isNotNull(auditEvents.recoveryReasonCode),
    sql`lower(${auditEvents.action}) ~ '(failed|denied|reject)'`,
  )
  if (severity === "warning") {
    return warning ?? sql`false`
  }
  if (severity === "critical") {
    return sql`false`
  }
  return sql`NOT (${warning ?? sql`false`})`
}

function getFixtureAuditEvents(
  filters: AuditEventFilters,
  cursor: AuditCursor | null,
): AuditEventRecord[] {
  assertFixtureAuditStorage()
  return stableMemoryEvents().filter((event) => {
    if (filters.eventId && event.id !== filters.eventId) {
      return false
    }
    if (
      filters.applicationId &&
      event.applicationId !== filters.applicationId
    ) {
      return false
    }
    if (filters.sourceSystem && event.sourceSystem !== filters.sourceSystem) {
      return false
    }
    if (filters.outcome && event.outcome !== filters.outcome) {
      return false
    }
    if (filters.severity && auditSeverity(event) !== filters.severity) {
      return false
    }
    if (filters.query && !matchesQuery(event, filters.query)) {
      return false
    }
    return !cursor || isAfterAuditCursor(event, cursor)
  })
}

function getFixtureAuditEventsAscending(
  filters: AuditEventFilters,
  cursor: AuditCursor | null,
  from: Date,
  to: Date,
): AuditEventRecord[] {
  return getFixtureAuditEvents(filters, null)
    .filter((event) => {
      const occurredAt = new Date(event.occurredAt)
      if (occurredAt < from || occurredAt > to) {
        return false
      }
      return !cursor || isBeforeAuditCursor(event, cursor)
    })
    .reverse()
}

function matchesQuery(event: AuditEventRecord, query: string): boolean {
  const needle = query.toLowerCase()
  return [
    event.id,
    event.action,
    event.correlationId,
    event.keycloakSubjectId ?? "",
    event.applicationId ?? "",
    event.credentialRecordId ?? "",
    event.credentialPrefix ?? "",
    event.recoveryReasonCode ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle)
}

function stableMemoryEvents(): AuditEventRecord[] {
  return memoryAuditEvents.slice().sort((left, right) => {
    const time = right.occurredAt.localeCompare(left.occurredAt)
    return time || right.id.localeCompare(left.id)
  })
}

interface AuditCursor {
  id: string
  occurredAt: string
}

function encodeAuditCursor(event: AuditEventRecord): string {
  return Buffer.from(
    JSON.stringify({ id: event.id, occurredAt: event.occurredAt }),
    "utf8",
  ).toString("base64url")
}

function decodeAuditCursor(
  value: string | null | undefined,
): AuditCursor | null {
  if (!value) {
    return null
  }
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new InvalidAuditCursorError()
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown
    if (
      !isPlainRecord(parsed) ||
      Reflect.ownKeys(parsed).length !== 2 ||
      !isUuid(parsed.id) ||
      typeof parsed.occurredAt !== "string" ||
      !isCanonicalTimestamp(parsed.occurredAt)
    ) {
      throw new InvalidAuditCursorError()
    }
    return { id: parsed.id, occurredAt: parsed.occurredAt }
  } catch (error) {
    if (error instanceof InvalidAuditCursorError) {
      throw error
    }
    throw new InvalidAuditCursorError()
  }
}

function isAfterAuditCursor(
  event: AuditEventRecord,
  cursor: AuditCursor,
): boolean {
  return (
    event.occurredAt < cursor.occurredAt ||
    (event.occurredAt === cursor.occurredAt && event.id < cursor.id)
  )
}

function isBeforeAuditCursor(
  event: AuditEventRecord,
  cursor: AuditCursor,
): boolean {
  return (
    event.occurredAt > cursor.occurredAt ||
    (event.occurredAt === cursor.occurredAt && event.id > cursor.id)
  )
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

function isNativeAuditSourceSystem(
  value: AuditSourceSystem,
): value is NativeAuditSourceSystem {
  return nativeAuditSourceSystems.includes(value as NativeAuditSourceSystem)
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.min(Math.max(Math.trunc(value ?? fallback), 1), maximum)
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&")
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
}

function isCanonicalUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  )
}

const NATIVE_PROVIDER_TOKEN_SHAPED_IDENTIFIER_PATTERN = new RegExp(
  `^(?:${[
    "sk[-_](?:live|test|proj)[-_][A-Za-z0-9_-]{1,120}",
    "github_pat_[A-Za-z0-9_]{1,120}",
    "gh[pousr]_[A-Za-z0-9]{1,120}",
    "xox[baprs]-[A-Za-z0-9-]{1,120}",
    "eyJ[A-Za-z0-9_-]{5,120}[.][A-Za-z0-9_-]{4,120}[.][A-Za-z0-9_-]{4,120}",
    "(?:AKIA|ASIA)[A-Z0-9]{16}",
    "AIza[A-Za-z0-9_-]{20,120}",
  ].join("|")})$`,
)

function assertNativeIdentifier(value: string | null, field: string): void {
  if (value === null) {
    return
  }
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_:-]*$/.test(value) ||
    /^(?:llmm_|bearer[:_-]|token[:_-]|secret[:_-]|password[:_-]|api[_-]?key[:_-])/i.test(
      value,
    ) ||
    /^[0-9a-f]{64,}$/i.test(value) ||
    NATIVE_PROVIDER_TOKEN_SHAPED_IDENTIFIER_PATTERN.test(value)
  ) {
    throw new TypeError(`Native audit ${field} must be a safe identifier.`)
  }
}

function assertNativeCredentialPrefix(value: string | null): void {
  if (
    value !== null &&
    !/^(?:llmm_t4_[0-9a-f]{18}|llmm_fc_[0-9a-f]{16})$/.test(value)
  ) {
    throw new TypeError(
      "Native audit credentialPrefix must be an approved product prefix.",
    )
  }
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
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
