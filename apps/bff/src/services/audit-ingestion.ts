import type { InferenceCoreSourceStatus } from "@llm-machines/contracts/inference-core"
import { eq, inArray } from "drizzle-orm"
import {
  type InferenceCoreDatabase,
  getInferenceCoreDb,
} from "../db/inference-core-client"
import { auditEvents, auditSourceCursors } from "../db/inference-core-schema"
import {
  type NativeAuditSourceSystem,
  nativeAuditSourceSystems,
  parseAuditEventInput,
} from "./audit"
import type { NativeAuditEvent, NativeAuditSource } from "./native-audit-source"

const MAX_EVENTS_PER_SOURCE_RUN = 1_000

export type AuditCursorHealth = "never_run" | "healthy" | "degraded"

export interface AuditSourceHealth {
  sourceSystem: NativeAuditSourceSystem
  sourceStatus: InferenceCoreSourceStatus
  cursorHealth: AuditCursorHealth
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastEventAt: string | null
  lastErrorCode: string | null
}

export interface AuditSourceIngestionResult {
  sourceSystem: NativeAuditSourceSystem
  status: "completed" | "degraded"
  eventsReceived: number
  eventsInserted: number
  eventsDeduplicated: number
  cursorAdvanced: boolean
  errorCode: string | null
}

export interface AuditIngestionRunResult {
  status: "completed" | "degraded"
  sources: AuditSourceIngestionResult[]
}

export class AuditIngestionConcurrencyError extends Error {
  constructor() {
    super("Audit source state changed during collection.")
    this.name = "AuditIngestionConcurrencyError"
  }
}

export class AuditIngestionEventCollisionError extends Error {
  constructor() {
    super("Native audit event ID collided with different canonical metadata.")
    this.name = "AuditIngestionEventCollisionError"
  }
}

export async function runAuditIngestion(
  database: InferenceCoreDatabase,
  sources: readonly NativeAuditSource[],
  options: { now?: Date } = {},
): Promise<AuditIngestionRunResult> {
  const now = options.now ?? new Date()
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Audit ingestion requires a valid clock value.")
  }
  assertUniqueSources(sources)

  const results: AuditSourceIngestionResult[] = []
  for (const source of sources) {
    results.push(await ingestOneSource(database, source, now))
  }
  return {
    status: results.some((result) => result.status === "degraded")
      ? "degraded"
      : "completed",
    sources: results,
  }
}

export async function getAuditSourceHealth(
  database: InferenceCoreDatabase | null = getInferenceCoreDb(),
): Promise<AuditSourceHealth[]> {
  if (!database) {
    return nativeAuditSourceSystems.map(emptySourceHealth)
  }
  let rows: (typeof auditSourceCursors.$inferSelect)[]
  try {
    rows = await database.select().from(auditSourceCursors)
  } catch {
    return nativeAuditSourceSystems.map(unavailableSourceHealth)
  }
  const rowsBySource = new Map(rows.map((row) => [row.sourceSystem, row]))
  return nativeAuditSourceSystems.map((sourceSystem) => {
    const row = rowsBySource.get(sourceSystem)
    if (!row) {
      return emptySourceHealth(sourceSystem)
    }
    const cursorHealth = row.lastErrorCode
      ? "degraded"
      : row.lastSuccessAt
        ? "healthy"
        : "never_run"
    return {
      sourceSystem,
      sourceStatus: row.lastErrorCode
        ? "degraded"
        : row.lastSuccessAt
          ? "ok"
          : "not_configured",
      cursorHealth,
      lastAttemptAt: isoOrNull(row.lastAttemptAt),
      lastSuccessAt: isoOrNull(row.lastSuccessAt),
      lastEventAt: isoOrNull(row.lastEventOccurredAt),
      lastErrorCode: row.lastErrorCode,
    }
  })
}

async function ingestOneSource(
  database: InferenceCoreDatabase,
  source: NativeAuditSource,
  now: Date,
): Promise<AuditSourceIngestionResult> {
  const sourceSystem = source.system
  assertNativeSourceSystem(sourceSystem)
  await database
    .insert(auditSourceCursors)
    .values({ sourceSystem })
    .onConflictDoNothing()
  const [before] = await database
    .select()
    .from(auditSourceCursors)
    .where(eq(auditSourceCursors.sourceSystem, sourceSystem))
    .limit(1)
  if (!before) {
    throw new Error("Audit ingestion cursor row is unavailable.")
  }
  const beforeCursor = storedCursor(before)

  let collected: Awaited<ReturnType<NativeAuditSource["collect"]>>
  try {
    collected = await source.collect(beforeCursor)
  } catch {
    await recordSourceFailure(
      database,
      sourceSystem,
      beforeCursor,
      now,
      "collection_failed",
    )
    return degradedResult(sourceSystem, "collection_failed")
  }

  let validatedBatch: ValidatedSourceBatch
  try {
    validatedBatch = validateNativeAuditSourceBatch(
      sourceSystem,
      collected,
      now,
    )
  } catch {
    await recordSourceFailure(
      database,
      sourceSystem,
      beforeCursor,
      now,
      "invalid_source_batch",
    )
    return degradedResult(sourceSystem, "invalid_source_batch")
  }
  const { cursor: nextCursor, events } = validatedBatch
  if (
    (events.length === 0 && nextCursor !== beforeCursor) ||
    (beforeCursor &&
      nextCursor &&
      compareCanonicalCursors(nextCursor, beforeCursor) < 0)
  ) {
    await recordSourceFailure(
      database,
      sourceSystem,
      beforeCursor,
      now,
      "invalid_source_batch",
    )
    return degradedResult(sourceSystem, "invalid_source_batch")
  }

  return database.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(auditSourceCursors)
      .where(eq(auditSourceCursors.sourceSystem, sourceSystem))
      .limit(1)
      .for("update")
    if (
      !current ||
      storedCursor(current) !== beforeCursor ||
      (current.lastAttemptAt && current.lastAttemptAt > now)
    ) {
      throw new AuditIngestionConcurrencyError()
    }

    const values = events.map((event) => auditValues(event, now))
    const inserted = values.length
      ? await transaction
          .insert(auditEvents)
          .values(values)
          .onConflictDoNothing()
          .returning({ id: auditEvents.id })
      : []
    const insertedIds = new Set(inserted.map((row) => row.id))
    const replayedValues = values.filter((value) => !insertedIds.has(value.id))
    if (replayedValues.length) {
      const storedRows = await transaction
        .select()
        .from(auditEvents)
        .where(
          inArray(
            auditEvents.id,
            replayedValues.map((value) => value.id),
          ),
        )
      const storedById = new Map(storedRows.map((row) => [row.id, row]))
      if (
        replayedValues.some(
          (value) =>
            !sameStoredNativeAuditEvent(storedById.get(value.id), value),
        )
      ) {
        throw new AuditIngestionEventCollisionError()
      }
    }
    const lastEventOccurredAt = latestOccurredAt(events)
    const storedNextCursor = nextCursor
      ? parseNativeAuditCursor(nextCursor)
      : null
    await transaction
      .update(auditSourceCursors)
      .set({
        cursorVersion: storedNextCursor?.version ?? null,
        cursorWatermark: storedNextCursor
          ? new Date(storedNextCursor.watermark)
          : null,
        cursorTieBreaker: storedNextCursor?.tieBreaker ?? null,
        lastAttemptAt: now,
        lastSuccessAt: now,
        lastEventOccurredAt: laterDate(
          lastEventOccurredAt,
          current.lastEventOccurredAt,
        ),
        lastErrorCode: null,
        updatedAt: now,
      })
      .where(eq(auditSourceCursors.sourceSystem, sourceSystem))

    return {
      sourceSystem,
      status: "completed",
      eventsReceived: events.length,
      eventsInserted: inserted.length,
      eventsDeduplicated: events.length - inserted.length,
      cursorAdvanced: nextCursor !== beforeCursor,
      errorCode: null,
    }
  })
}

async function recordSourceFailure(
  database: InferenceCoreDatabase,
  sourceSystem: NativeAuditSourceSystem,
  expectedCursor: string | null,
  now: Date,
  errorCode: string,
): Promise<void> {
  await database.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(auditSourceCursors)
      .where(eq(auditSourceCursors.sourceSystem, sourceSystem))
      .limit(1)
      .for("update")
    if (
      !current ||
      storedCursor(current) !== expectedCursor ||
      (current.lastAttemptAt && current.lastAttemptAt > now)
    ) {
      return
    }
    await transaction
      .update(auditSourceCursors)
      .set({
        lastAttemptAt: now,
        lastErrorCode: errorCode,
        updatedAt: now,
      })
      .where(eq(auditSourceCursors.sourceSystem, sourceSystem))
  })
}

interface ValidatedNativeAuditEvent {
  eventId: string
  event: ReturnType<typeof parseAuditEventInput>
  occurredAt: Date
}

export interface NativeAuditCursor {
  version: 1
  watermark: string
  tieBreaker: string
}

const NATIVE_AUDIT_CURSOR_PATTERN =
  /^v1\|([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z)\|([0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/

export interface ValidatedSourceBatch {
  cursor: string | null
  events: ValidatedNativeAuditEvent[]
}

export function validateNativeAuditSourceBatch(
  sourceSystem: NativeAuditSourceSystem,
  batch: Awaited<ReturnType<NativeAuditSource["collect"]>>,
  now: Date,
): ValidatedSourceBatch {
  if (
    !batch ||
    typeof batch !== "object" ||
    !hasExactOwnKeys(batch, nativeAuditBatchKeys) ||
    !Array.isArray(batch.events) ||
    batch.events.length > MAX_EVENTS_PER_SOURCE_RUN
  ) {
    throw new TypeError("Native audit source returned an invalid batch.")
  }
  const cursor = canonicalCursorOrNull(batch.cursor)
  if (batch.events.length > 0 && !cursor) {
    throw new TypeError("Native audit event batches require a cursor.")
  }

  const eventIds = new Set<string>()
  const events = batch.events.map((event) =>
    validateNativeEvent(sourceSystem, event, now),
  )
  for (const { eventId } of events) {
    if (eventIds.has(eventId)) {
      throw new TypeError("Native audit event IDs must be unique.")
    }
    eventIds.add(eventId)
  }
  events.sort(
    (left, right) =>
      left.occurredAt.getTime() - right.occurredAt.getTime() ||
      left.eventId.localeCompare(right.eventId),
  )
  const last = events.at(-1)
  if (
    last &&
    cursor !==
      encodeNativeAuditCursor(last.occurredAt.toISOString(), last.eventId)
  ) {
    throw new TypeError(
      "Native audit cursor must match the final event watermark.",
    )
  }
  return { cursor, events }
}

function validateNativeEvent(
  sourceSystem: NativeAuditSourceSystem,
  event: NativeAuditEvent,
  now: Date,
): ValidatedNativeAuditEvent {
  if (
    !event ||
    !hasExactOwnKeys(event, nativeAuditEventKeys) ||
    event.sourceSystem !== sourceSystem
  ) {
    throw new TypeError("Native audit event source does not match collector.")
  }
  const occurredAt = canonicalTimestamp(event.occurredAt)
  if (occurredAt.getTime() > now.getTime() + 5 * 60_000) {
    throw new TypeError("Native audit event timestamp is in the future.")
  }
  return {
    eventId: canonicalNativeEventId(event.eventId),
    occurredAt,
    event: parseAuditEventInput({
      action: event.action,
      applicationId: event.applicationId ?? undefined,
      correlationId: event.correlationId,
      credentialRecordId: event.credentialRecordId ?? undefined,
      credentialPrefix: event.credentialPrefix ?? undefined,
      keycloakSubjectId: event.keycloakSubjectId ?? undefined,
      outcome: event.outcome,
      recoveryReasonCode: event.recoveryReasonCode ?? undefined,
      sourceSystem: event.sourceSystem,
    }),
  }
}

function auditValues(validated: ValidatedNativeAuditEvent, ingestedAt: Date) {
  const { eventId, event, occurredAt } = validated
  return {
    id: eventId,
    occurredAt,
    ingestedAt,
    action: event.action,
    outcome: event.outcome,
    sourceSystem: event.sourceSystem,
    correlationId: event.correlationId,
    keycloakSubjectId: event.keycloakSubjectId,
    applicationId: event.applicationId,
    credentialRecordId: event.credentialRecordId,
    credentialPrefix: event.credentialPrefix,
    recoveryReasonCode: event.recoveryReasonCode,
  }
}

function sameStoredNativeAuditEvent(
  stored: typeof auditEvents.$inferSelect | undefined,
  expected: ReturnType<typeof auditValues>,
): boolean {
  return Boolean(
    stored &&
      stored.id === expected.id &&
      stored.occurredAt.getTime() === expected.occurredAt.getTime() &&
      stored.action === expected.action &&
      stored.outcome === expected.outcome &&
      stored.sourceSystem === expected.sourceSystem &&
      stored.correlationId === expected.correlationId &&
      stored.keycloakSubjectId === expected.keycloakSubjectId &&
      stored.applicationId === expected.applicationId &&
      stored.credentialRecordId === expected.credentialRecordId &&
      stored.credentialPrefix === expected.credentialPrefix &&
      stored.recoveryReasonCode === expected.recoveryReasonCode,
  )
}

function latestOccurredAt(events: ValidatedNativeAuditEvent[]): Date | null {
  return events.length ? (events.at(-1)?.occurredAt ?? null) : null
}

function laterDate(left: Date | null, right: Date | null): Date | null {
  if (!left) {
    return right
  }
  if (!right) {
    return left
  }
  return left > right ? left : right
}

function storedCursor(
  row: typeof auditSourceCursors.$inferSelect,
): string | null {
  if (
    row.cursorVersion === null &&
    row.cursorWatermark === null &&
    row.cursorTieBreaker === null
  ) {
    return null
  }
  if (
    row.cursorVersion !== 1 ||
    !row.cursorWatermark ||
    !row.cursorTieBreaker
  ) {
    throw new Error("Audit source cursor storage is invalid.")
  }
  return encodeNativeAuditCursor(
    row.cursorWatermark.toISOString(),
    row.cursorTieBreaker,
  )
}

export function encodeNativeAuditCursor(
  watermark: string,
  tieBreaker: string,
): string {
  canonicalTimestamp(watermark)
  canonicalNativeEventId(tieBreaker)
  return `v1|${watermark}|${tieBreaker}`
}

export function parseNativeAuditCursor(value: string): NativeAuditCursor {
  const match = NATIVE_AUDIT_CURSOR_PATTERN.exec(value)
  const watermark = match?.[1]
  const tieBreaker = match?.[2]
  if (!watermark || !tieBreaker) {
    throw new TypeError("Native audit cursor is invalid.")
  }
  canonicalTimestamp(watermark)
  canonicalNativeEventId(tieBreaker)
  return { version: 1, watermark, tieBreaker }
}

function canonicalNativeEventId(value: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  ) {
    throw new TypeError(
      "Native audit eventId must be a canonical deterministic UUID.",
    )
  }
  return value
}

function compareCanonicalCursors(left: string, right: string): number {
  const leftCursor = parseNativeAuditCursor(left)
  const rightCursor = parseNativeAuditCursor(right)
  return (
    leftCursor.watermark.localeCompare(rightCursor.watermark) ||
    leftCursor.tieBreaker.localeCompare(rightCursor.tieBreaker)
  )
}

function canonicalCursorOrNull(value: string | null): string | null {
  if (value === null) {
    return null
  }
  parseNativeAuditCursor(value)
  return value
}

function canonicalTimestamp(value: string): Date {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError("Native audit timestamp must be canonical UTC.")
  }
  return parsed
}

function assertUniqueSources(sources: readonly NativeAuditSource[]): void {
  const systems = new Set<string>()
  for (const source of sources) {
    assertNativeSourceSystem(source.system)
    if (systems.has(source.system)) {
      throw new Error("Audit ingestion sources must be unique.")
    }
    systems.add(source.system)
  }
}

function assertNativeSourceSystem(
  value: string,
): asserts value is NativeAuditSourceSystem {
  if (!nativeAuditSourceSystems.includes(value as NativeAuditSourceSystem)) {
    throw new Error("Audit ingestion source is unsupported.")
  }
}

function emptySourceHealth(
  sourceSystem: NativeAuditSourceSystem,
): AuditSourceHealth {
  return {
    sourceSystem,
    sourceStatus: "not_configured",
    cursorHealth: "never_run",
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastEventAt: null,
    lastErrorCode: null,
  }
}

function unavailableSourceHealth(
  sourceSystem: NativeAuditSourceSystem,
): AuditSourceHealth {
  return {
    sourceSystem,
    sourceStatus: "unavailable",
    cursorHealth: "degraded",
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastEventAt: null,
    lastErrorCode: "cursor_store_unavailable",
  }
}

function degradedResult(
  sourceSystem: NativeAuditSourceSystem,
  errorCode: string,
): AuditSourceIngestionResult {
  return {
    sourceSystem,
    status: "degraded",
    eventsReceived: 0,
    eventsInserted: 0,
    eventsDeduplicated: 0,
    cursorAdvanced: false,
    errorCode,
  }
}

function isoOrNull(value: Date | null): string | null {
  return value?.toISOString() ?? null
}

function hasExactOwnKeys(
  value: object,
  expectedKeys: readonly string[],
): boolean {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return false
  }
  const keys = Reflect.ownKeys(value)
  return (
    keys.length === expectedKeys.length &&
    keys.every((key) => typeof key === "string" && expectedKeys.includes(key))
  )
}

const nativeAuditBatchKeys = ["cursor", "events"] as const
const nativeAuditEventKeys = [
  "action",
  "applicationId",
  "correlationId",
  "credentialPrefix",
  "credentialRecordId",
  "eventId",
  "keycloakSubjectId",
  "occurredAt",
  "outcome",
  "recoveryReasonCode",
  "sourceSystem",
] as const
