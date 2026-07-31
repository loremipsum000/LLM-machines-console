import { createHash, randomUUID } from "node:crypto"
import { and, eq, inArray, lte } from "drizzle-orm"
import { canUseBffFixtureData } from "../config/fixture-mode"
import { getInferenceCoreDb } from "../db/inference-core-client"
import { idempotencyLedger } from "../db/inference-core-schema"

export interface IdempotencyReceipt {
  correlationId: string
  outcome: "denied" | "failed" | "succeeded"
  resourceId: string | null
  statusCode: number
}

interface IdempotencyRecord {
  correlationId: string
  expiresAt: number
  id: string
  receipt: IdempotencyReceipt | null
  requestFingerprint: string
  state: "completed" | "failed" | "pending"
}

const ttlMs = 24 * 60 * 60 * 1000
const memoryStore = new Map<string, IdempotencyRecord>()

export async function reserveIdempotency(input: {
  actorId: string
  correlationId: string
  idempotencyKey: string
  requestHash: string
  route: string
}): Promise<
  | { status: "reserved"; storeKey: string }
  | { receipt: IdempotencyReceipt; status: "replay" }
  | { status: "conflict" }
  | { status: "pending" }
  | { status: "reconciliation_required" }
  | { status: "unavailable" }
> {
  const idempotencyKey = digest(input.idempotencyKey)
  const memoryKey = buildMemoryKey({
    actorId: input.actorId,
    idempotencyKey,
    route: input.route,
  })
  const now = new Date()
  const expiresAt = new Date(now.getTime() + ttlMs)
  const id = randomUUID()
  const db = getInferenceCoreDb()

  if (!db) {
    if (!canUseBffFixtureData()) {
      return { status: "unavailable" }
    }
    return reserveInMemory(memoryKey, {
      correlationId: input.correlationId,
      expiresAt: expiresAt.getTime(),
      id,
      receipt: null,
      requestFingerprint: input.requestHash,
      state: "pending",
    })
  }

  try {
    const inserted = await db
      .insert(idempotencyLedger)
      .values({
        correlationId: input.correlationId,
        createdAt: now,
        expiresAt,
        id,
        idempotencyKeyDigest: idempotencyKey,
        keycloakSubjectId: input.actorId,
        operationCode: input.route,
        outcome: null,
        requestFingerprint: input.requestHash,
        resourceId: null,
        state: "pending",
        statusCode: null,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyLedger.id })
    if (inserted.length > 0) {
      return { status: "reserved", storeKey: id }
    }

    const reclaimed = await db
      .update(idempotencyLedger)
      .set({
        correlationId: input.correlationId,
        createdAt: now,
        expiresAt,
        id,
        outcome: null,
        requestFingerprint: input.requestHash,
        resourceId: null,
        state: "pending",
        statusCode: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(idempotencyLedger.keycloakSubjectId, input.actorId),
          eq(idempotencyLedger.operationCode, input.route),
          eq(idempotencyLedger.idempotencyKeyDigest, idempotencyKey),
          lte(idempotencyLedger.expiresAt, now),
          inArray(idempotencyLedger.state, ["completed", "failed"]),
        ),
      )
      .returning({ id: idempotencyLedger.id })
    if (reclaimed[0]) {
      return { status: "reserved", storeKey: reclaimed[0].id }
    }

    const existing = await db
      .select()
      .from(idempotencyLedger)
      .where(
        and(
          eq(idempotencyLedger.keycloakSubjectId, input.actorId),
          eq(idempotencyLedger.operationCode, input.route),
          eq(idempotencyLedger.idempotencyKeyDigest, idempotencyKey),
        ),
      )
      .limit(1)
    const record = existing[0]
    return record
      ? persistedRecordToResult(record, input.requestHash)
      : { status: "unavailable" }
  } catch {
    return { status: "unavailable" }
  }
}

export async function completeIdempotency(input: {
  outcome: IdempotencyReceipt["outcome"]
  requestHash: string
  resourceId?: string | null
  statusCode: number
  storeKey: string
}): Promise<boolean> {
  const db = getInferenceCoreDb()
  const receipt = {
    correlationId: "",
    outcome: input.outcome,
    resourceId: input.resourceId ?? null,
    statusCode: input.statusCode,
  } satisfies IdempotencyReceipt

  if (!db) {
    if (!canUseBffFixtureData()) {
      return false
    }
    const record = [...memoryStore.values()].find(
      (candidate) => candidate.id === input.storeKey,
    )
    if (
      !record ||
      record.requestFingerprint !== input.requestHash ||
      record.state !== "pending"
    ) {
      return false
    }
    record.state = input.outcome === "succeeded" ? "completed" : "failed"
    record.receipt = {
      ...receipt,
      correlationId: record.correlationId,
    }
    record.expiresAt = Date.now() + ttlMs
    return true
  }

  try {
    const rows = await db
      .update(idempotencyLedger)
      .set({
        expiresAt: new Date(Date.now() + ttlMs),
        outcome: input.outcome,
        resourceId: input.resourceId ?? null,
        state: input.outcome === "succeeded" ? "completed" : "failed",
        statusCode: input.statusCode,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(idempotencyLedger.id, input.storeKey),
          eq(idempotencyLedger.requestFingerprint, input.requestHash),
          eq(idempotencyLedger.state, "pending"),
        ),
      )
      .returning({ id: idempotencyLedger.id })
    return rows.length === 1
  } catch {
    return false
  }
}

export function resetIdempotencyForTest(): void {
  memoryStore.clear()
}

function reserveInMemory(
  memoryKey: string,
  candidate: IdempotencyRecord,
):
  | { status: "reserved"; storeKey: string }
  | { receipt: IdempotencyReceipt; status: "replay" }
  | { status: "conflict" }
  | { status: "pending" }
  | { status: "reconciliation_required" }
  | { status: "unavailable" } {
  const existing = memoryStore.get(memoryKey)
  if (!existing) {
    memoryStore.set(memoryKey, candidate)
    return { status: "reserved", storeKey: candidate.id }
  }
  if (existing.expiresAt <= Date.now()) {
    if (existing.state === "pending") {
      return { status: "reconciliation_required" }
    }
    memoryStore.set(memoryKey, candidate)
    return { status: "reserved", storeKey: candidate.id }
  }
  return memoryRecordToResult(existing, candidate.requestFingerprint)
}

function persistedRecordToResult(
  record: typeof idempotencyLedger.$inferSelect,
  requestFingerprint: string,
):
  | { receipt: IdempotencyReceipt; status: "replay" }
  | { status: "conflict" }
  | { status: "pending" }
  | { status: "reconciliation_required" }
  | { status: "unavailable" } {
  if (record.requestFingerprint !== requestFingerprint) {
    return { status: "conflict" }
  }
  if (record.state === "pending") {
    return record.expiresAt.getTime() <= Date.now()
      ? { status: "reconciliation_required" }
      : { status: "pending" }
  }
  if (!isReceiptOutcome(record.outcome) || record.statusCode === null) {
    return { status: "unavailable" }
  }
  return {
    receipt: {
      correlationId: record.correlationId,
      outcome: record.outcome,
      resourceId: record.resourceId,
      statusCode: record.statusCode,
    },
    status: "replay",
  }
}

function isReceiptOutcome(
  value: string | null,
): value is IdempotencyReceipt["outcome"] {
  return value === "denied" || value === "failed" || value === "succeeded"
}

function memoryRecordToResult(
  record: IdempotencyRecord,
  requestFingerprint: string,
):
  | { receipt: IdempotencyReceipt; status: "replay" }
  | { status: "conflict" }
  | { status: "pending" }
  | { status: "reconciliation_required" }
  | { status: "unavailable" } {
  if (record.requestFingerprint !== requestFingerprint) {
    return { status: "conflict" }
  }
  if (record.state === "pending") {
    return record.expiresAt <= Date.now()
      ? { status: "reconciliation_required" }
      : { status: "pending" }
  }
  return record.receipt
    ? { receipt: record.receipt, status: "replay" }
    : { status: "unavailable" }
}

function buildMemoryKey(input: {
  actorId: string
  idempotencyKey: string
  route: string
}): string {
  return `${input.actorId}\u0000${input.route}\u0000${input.idempotencyKey}`
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
