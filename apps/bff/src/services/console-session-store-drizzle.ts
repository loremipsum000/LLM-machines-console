import { timingSafeEqual } from "node:crypto"
import { and, desc, eq, sql } from "drizzle-orm"
import type { InferenceCoreDatabase } from "../db/inference-core-client"
import { auditEvents } from "../db/inference-core-schema"
import type {
  ConsoleLoginRecord,
  ConsoleSessionRecord,
  ConsoleSessionRepository,
  LockedSessionResult,
} from "./console-session-store"

interface LoginRow {
  created_at: Date | string
  encrypted_payload: unknown
  encryption_kid: string
  expires_at: Date | string
  handle_digest: string
  state_digest: string
  subject_digest: string | null
}

interface SessionRow {
  absolute_expires_at: Date | string
  access_expires_at: Date | string
  created_at: Date | string
  encrypted_payload: unknown
  encryption_kid: string
  handle_digest: string
  idle_expires_at: Date | string
  keycloak_session_digest: string | null
  last_seen_at: Date | string
  refresh_blocked_until: Date | string | null
  refresh_failure_reason: string | null
  refresh_generation: number | string
  subject_digest: string
  updated_at: Date | string
}

export class DrizzleConsoleSessionRepository
  implements ConsoleSessionRepository
{
  constructor(private readonly database: InferenceCoreDatabase) {}

  async consumeLogin(
    handleDigest: string,
    stateDigest: string,
    now: Date,
  ): Promise<ConsoleLoginRecord | null> {
    return this.database.transaction(async (transaction) => {
      const result = await transaction.execute(sql<LoginRow>`
        DELETE FROM common.console_login_transactions
        WHERE handle_digest = ${handleDigest}
        RETURNING *
      `)
      const row = resultRows<LoginRow>(result)[0]
      if (!row) {
        return null
      }
      const record = parseLoginRow(row)
      return safeDigestEqual(record.stateDigest, stateDigest) &&
        record.expiresAt > now
        ? record
        : null
    })
  }

  async consumeLogoutAndRevoke(input: {
    jtiDigest: string
    keycloakSessionDigest?: string
    now: Date
    retainUntil: Date
    subjectDigest?: string
  }): Promise<number> {
    if (
      input.retainUntil <= input.now ||
      (!input.keycloakSessionDigest && !input.subjectDigest)
    ) {
      return 0
    }
    const selector = input.keycloakSessionDigest
      ? sql`keycloak_session_digest = ${input.keycloakSessionDigest}`
      : sql`subject_digest = ${input.subjectDigest}`
    const result = await this.database.execute(sql<{
      revoked_count: number | string
    }>`
      WITH accepted AS (
        INSERT INTO common.console_logout_token_replays (
          jti_digest, retain_until, consumed_at
        )
        SELECT ${input.jtiDigest}, ${timestamp(input.retainUntil)}::timestamptz,
          ${timestamp(input.now)}::timestamptz
        WHERE ${timestamp(input.retainUntil)}::timestamptz
          > ${timestamp(input.now)}::timestamptz
        ON CONFLICT (jti_digest) DO NOTHING
        RETURNING jti_digest
      ), revoked AS (
        DELETE FROM common.console_sessions
        WHERE ${selector}
          AND EXISTS (SELECT 1 FROM accepted)
        RETURNING handle_digest
      )
      SELECT count(*)::integer AS revoked_count FROM revoked
    `)
    return count(
      resultRows<{ revoked_count: number | string }>(result)[0]?.revoked_count,
    )
  }

  async insertLogin(record: ConsoleLoginRecord): Promise<void> {
    await this.database.execute(sql`
      INSERT INTO common.console_login_transactions (
        handle_digest, state_digest, subject_digest, encrypted_payload, encryption_kid,
        expires_at, created_at
      ) VALUES (
        ${record.handleDigest}, ${record.stateDigest}, ${record.subjectDigest},
        ${record.encryptedPayload}::jsonb,
        ${record.encryptionKid}, ${timestamp(record.expiresAt)},
        ${timestamp(record.createdAt)}
      )
    `)
  }

  async insertSession(record: ConsoleSessionRecord): Promise<void> {
    await this.database.execute(sql`
      INSERT INTO common.console_sessions (
        handle_digest, subject_digest, keycloak_session_digest,
        encrypted_payload, encryption_kid, refresh_generation,
        refresh_blocked_until, refresh_failure_reason,
        access_expires_at, idle_expires_at, absolute_expires_at,
        last_seen_at, created_at, updated_at
      ) VALUES (
        ${record.handleDigest}, ${record.subjectDigest},
        ${record.keycloakSessionDigest}, ${record.encryptedPayload}::jsonb,
        ${record.encryptionKid}, ${record.refreshGeneration},
        ${nullableTimestamp(record.refreshBlockedUntil)},
        ${record.refreshFailureReason}, ${timestamp(record.accessExpiresAt)},
        ${timestamp(record.idleExpiresAt)}, ${timestamp(record.absoluteExpiresAt)},
        ${timestamp(record.lastSeenAt)}, ${timestamp(record.createdAt)},
        ${timestamp(record.updatedAt)}
      )
    `)
  }

  async latestNativeLogoutAt(subjectId: string): Promise<Date | null> {
    const rows = await this.database
      .select({ occurredAt: auditEvents.occurredAt })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "console.native_session.logout"),
          eq(auditEvents.sourceSystem, "console"),
          eq(auditEvents.keycloakSubjectId, subjectId),
        ),
      )
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(1)
    return rows[0]?.occurredAt ? new Date(rows[0].occurredAt) : null
  }

  async latestNativeGlobalLogoutAt(): Promise<Date | null> {
    const rows = await this.database
      .select({ occurredAt: auditEvents.occurredAt })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "console.native_session.logout_all"),
          eq(auditEvents.sourceSystem, "console"),
        ),
      )
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(1)
    return rows[0]?.occurredAt ? new Date(rows[0].occurredAt) : null
  }

  async readSession(
    handleDigest: string,
  ): Promise<ConsoleSessionRecord | null> {
    const result = await this.database.execute(sql<SessionRow>`
      SELECT *
      FROM common.console_sessions
      WHERE handle_digest = ${handleDigest}
      LIMIT 1
    `)
    const row = resultRows<SessionRow>(result)[0]
    return row ? parseSessionRow(row) : null
  }

  async recordNativeLogoutAndDelete(input: {
    correlationId: string
    eventId: string
    handleDigest: string
    now: Date
    subjectDigest: string
    subjectId: string
  }): Promise<boolean> {
    const result = await this.database.execute(sql<{
      fenced_count: number | string
    }>`
      WITH deleted AS (
        DELETE FROM common.console_sessions
        WHERE handle_digest = ${input.handleDigest}
          AND subject_digest = ${input.subjectDigest}
        RETURNING handle_digest
      ), fenced AS (
        INSERT INTO common.audit_events (
          id, occurred_at, ingested_at, action, outcome, source_system,
          correlation_id, keycloak_subject_id
        )
        SELECT
          ${input.eventId}::uuid,
          ${timestamp(input.now)}::timestamptz,
          ${timestamp(input.now)}::timestamptz,
          'console.native_session.logout',
          'succeeded',
          'console',
          ${input.correlationId},
          ${input.subjectId}
        WHERE EXISTS (SELECT 1 FROM deleted)
        RETURNING id
      )
      SELECT count(*)::integer AS fenced_count FROM fenced
    `)
    return (
      count(
        resultRows<{ fenced_count: number | string }>(result)[0]?.fenced_count,
      ) === 1
    )
  }

  async recordNativeGlobalLogoutAndDelete(input: {
    correlationId: string
    eventId: string
    handleDigest: string
    now: Date
    subjectDigest: string
  }): Promise<boolean> {
    const result = await this.database.execute(sql<{
      fenced_count: number | string
    }>`
      WITH deleted AS (
        DELETE FROM common.console_sessions
        WHERE handle_digest = ${input.handleDigest}
          AND subject_digest = ${input.subjectDigest}
        RETURNING handle_digest
      ), fenced AS (
        INSERT INTO common.audit_events (
          id, occurred_at, ingested_at, action, outcome, source_system,
          correlation_id
        )
        SELECT
          ${input.eventId}::uuid,
          ${timestamp(input.now)}::timestamptz,
          ${timestamp(input.now)}::timestamptz,
          'console.native_session.logout_all',
          'succeeded',
          'console',
          ${input.correlationId}
        WHERE EXISTS (SELECT 1 FROM deleted)
        RETURNING id
      )
      SELECT count(*)::integer AS fenced_count FROM fenced
    `)
    return (
      count(
        resultRows<{ fenced_count: number | string }>(result)[0]?.fenced_count,
      ) === 1
    )
  }

  async withLockedSession<T>(
    handleDigest: string,
    work: (
      record: ConsoleSessionRecord | null,
    ) => Promise<LockedSessionResult<T>>,
  ): Promise<T> {
    return this.database.transaction(async (transaction) => {
      const result = await transaction.execute(sql<SessionRow>`
        SELECT *
        FROM common.console_sessions
        WHERE handle_digest = ${handleDigest}
        FOR UPDATE
      `)
      const row = resultRows<SessionRow>(result)[0]
      const outcome = await work(row ? parseSessionRow(row) : null)
      if (!outcome.record) {
        if (row) {
          await transaction.execute(sql`
            DELETE FROM common.console_sessions
            WHERE handle_digest = ${handleDigest}
          `)
        }
        return outcome.value
      }
      if (!row) {
        throw new Error("Locked Console session disappeared.")
      }
      await transaction.execute(sql`
        UPDATE common.console_sessions SET
          subject_digest = ${outcome.record.subjectDigest},
          keycloak_session_digest = ${outcome.record.keycloakSessionDigest},
          encrypted_payload = ${outcome.record.encryptedPayload}::jsonb,
          encryption_kid = ${outcome.record.encryptionKid},
          refresh_generation = ${outcome.record.refreshGeneration},
          refresh_blocked_until = ${nullableTimestamp(outcome.record.refreshBlockedUntil)},
          refresh_failure_reason = ${outcome.record.refreshFailureReason},
          access_expires_at = ${timestamp(outcome.record.accessExpiresAt)},
          idle_expires_at = ${timestamp(outcome.record.idleExpiresAt)},
          absolute_expires_at = ${timestamp(outcome.record.absoluteExpiresAt)},
          last_seen_at = ${timestamp(outcome.record.lastSeenAt)},
          updated_at = ${timestamp(outcome.record.updatedAt)}
        WHERE handle_digest = ${handleDigest}
      `)
      return outcome.value
    })
  }
}

function parseLoginRow(row: LoginRow): ConsoleLoginRecord {
  return {
    createdAt: date(row.created_at),
    encryptedPayload: serializedEnvelope(row.encrypted_payload),
    encryptionKid: row.encryption_kid,
    expiresAt: date(row.expires_at),
    handleDigest: row.handle_digest,
    stateDigest: row.state_digest,
    subjectDigest: row.subject_digest,
  }
}

function parseSessionRow(row: SessionRow): ConsoleSessionRecord {
  return {
    absoluteExpiresAt: date(row.absolute_expires_at),
    accessExpiresAt: date(row.access_expires_at),
    createdAt: date(row.created_at),
    encryptedPayload: serializedEnvelope(row.encrypted_payload),
    encryptionKid: row.encryption_kid,
    handleDigest: row.handle_digest,
    idleExpiresAt: date(row.idle_expires_at),
    keycloakSessionDigest: row.keycloak_session_digest,
    lastSeenAt: date(row.last_seen_at),
    refreshBlockedUntil: nullableDate(row.refresh_blocked_until),
    refreshFailureReason: refreshFailureReason(row.refresh_failure_reason),
    refreshGeneration: count(row.refresh_generation),
    subjectDigest: row.subject_digest,
    updatedAt: date(row.updated_at),
  }
}

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[]
  }
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray(result.rows)
  ) {
    return result.rows as T[]
  }
  throw new Error("Invalid Console session storage response.")
}

function safeDigestEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex")
  const b = Buffer.from(right, "hex")
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b)
}

function count(value: number | string | undefined): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Invalid Console session storage count.")
  }
  return parsed
}

function date(value: Date | string): Date {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("Invalid Console session storage timestamp.")
  }
  return parsed
}

function nullableDate(value: Date | string | null): Date | null {
  return value === null ? null : date(value)
}

function nullableTimestamp(value: Date | null): string | null {
  return value === null ? null : timestamp(value)
}

function timestamp(value: Date): string {
  if (!Number.isFinite(value.getTime())) {
    throw new Error("Invalid Console session storage timestamp.")
  }
  return value.toISOString()
}

function refreshFailureReason(
  value: string | null,
): ConsoleSessionRecord["refreshFailureReason"] {
  if (
    value === null ||
    value === "identity_restart" ||
    value === "identity_timeout" ||
    value === "identity_unavailable"
  ) {
    return value
  }
  throw new Error("Invalid Console session refresh failure reason.")
}

function serializedEnvelope(value: unknown): string {
  if (typeof value === "string") {
    return value
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Console session encrypted envelope storage.")
  }
  return JSON.stringify(value)
}
