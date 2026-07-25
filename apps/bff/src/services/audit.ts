import { randomUUID } from "node:crypto"
import { desc } from "drizzle-orm"
import { getDb } from "../db/client"
import { auditEvents } from "../db/schema"

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
    actorId: event.actorId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    reason: event.reason,
    metadata: event.metadata ?? {},
    createdAt: new Date().toISOString(),
  }

  const db = getDb()
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
  const db = getDb()
  if (db) {
    const rows = await db
      .select()
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit)

    return rows.map((row) => ({
      id: row.id,
      actorId: row.actorId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      reason: row.reason ?? undefined,
      metadata:
        row.metadata && typeof row.metadata === "object"
          ? (row.metadata as Record<string, unknown>)
          : {},
      createdAt: row.createdAt.toISOString(),
    }))
  }

  return [...memoryAuditEvents]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
}

export function resetAuditEventsForTest(): void {
  memoryAuditEvents.length = 0
}
