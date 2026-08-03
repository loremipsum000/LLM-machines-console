import { type SQL, sql } from "drizzle-orm"
import type { getInferenceCoreDb } from "../db/inference-core-client"

type InferenceCoreDatabase = NonNullable<ReturnType<typeof getInferenceCoreDb>>
type RetentionExecute = (statement: SQL) => Promise<unknown>

export type InferenceCoreRetentionResult =
  | {
      abandonedRequestsSettled: number
      auditEventsDeleted: number
      consoleLoginTransactionsDeleted: number
      consoleLogoutTokenReplaysDeleted: number
      consoleSessionsDeleted: number
      idempotencyRowsDeleted: number
      rateLimitWindowsDeleted: number
      requestLedgerRowsDeleted: number
      status: "completed"
      usageBucketsDeleted: number
    }
  | { status: "lock_busy" }

export async function runInferenceCoreRetention(
  database: InferenceCoreDatabase,
  options: {
    acquireLock?: (execute: RetentionExecute) => Promise<boolean>
    now?: Date
  } = {},
): Promise<InferenceCoreRetentionResult> {
  const now = options.now ?? new Date()
  const usageCutoff = utcUsageCutoff(now)
  const auditCutoff = auditRetentionCutoff(now)
  const transientCutoff = now.toISOString()
  return database.transaction(async (transaction) => {
    const execute: RetentionExecute = async (statement) =>
      transaction.execute(statement)
    const acquired = await (options.acquireLock ?? acquireRetentionLock)(
      execute,
    )
    if (!acquired) {
      return { status: "lock_busy" }
    }

    const abandonedResult = await execute(sql`
      WITH expired_requests AS (
        UPDATE admin.application_request_ledger
        SET
          state = 'settled',
          status_code = 504,
          latency_ms = LEAST(
            2147483647,
            GREATEST(
              0,
              floor(
                extract(epoch FROM (lease_expires_at - started_at)) * 1000
              )
            )
          )::integer,
          settled_at = clock_timestamp()
        WHERE state = 'active'
          AND lease_expires_at <= clock_timestamp()
        RETURNING
          app_id,
          credential_id,
          (started_at AT TIME ZONE 'UTC')::date AS bucket_date,
          route_kind,
          COALESCE(model_alias, '') AS model_alias,
          latency_ms,
          started_at
      ),
      usage_rows AS (
        INSERT INTO admin.application_usage_daily (
          app_id,
          credential_id,
          bucket_date,
          route_kind,
          model_alias,
          request_count,
          failure_count,
          input_tokens,
          output_tokens,
          total_tokens,
          latency_ms_sum,
          latency_ms_max,
          updated_at
        )
        SELECT
          app_id,
          credential_id,
          bucket_date,
          route_kind,
          model_alias,
          count(*)::integer,
          count(*)::integer,
          0,
          0,
          0,
          sum(latency_ms),
          max(latency_ms),
          clock_timestamp()
        FROM expired_requests
        GROUP BY
          app_id,
          credential_id,
          bucket_date,
          route_kind,
          model_alias
        ON CONFLICT (
          app_id,
          credential_id,
          bucket_date,
          route_kind,
          model_alias
        )
        DO UPDATE SET
          request_count =
            admin.application_usage_daily.request_count
            + EXCLUDED.request_count,
          failure_count =
            admin.application_usage_daily.failure_count
            + EXCLUDED.failure_count,
          latency_ms_sum =
            admin.application_usage_daily.latency_ms_sum
            + EXCLUDED.latency_ms_sum,
          latency_ms_max = GREATEST(
            admin.application_usage_daily.latency_ms_max,
            EXCLUDED.latency_ms_max
          ),
          updated_at = EXCLUDED.updated_at
        RETURNING app_id
      ),
      updated_credentials AS (
        UPDATE admin.application_credentials AS credential
        SET last_used_at = GREATEST(
          COALESCE(credential.last_used_at, '-infinity'::timestamptz),
          credential.issued_at,
          expired.last_started_at
        )
        FROM (
          SELECT credential_id, max(started_at) AS last_started_at
          FROM expired_requests
          GROUP BY credential_id
        ) AS expired
        WHERE credential.id = expired.credential_id
        RETURNING credential.id
      ),
      firecrawl_expired_requests AS (
        UPDATE admin.application_firecrawl_request_ledger
        SET
          state = 'settled',
          status_code = 504,
          latency_ms = LEAST(
            2147483647,
            GREATEST(
              0,
              floor(
                extract(epoch FROM (lease_expires_at - started_at)) * 1000
              )
            )
          )::integer,
          settled_at = clock_timestamp()
        WHERE state = 'active'
          AND lease_expires_at <= clock_timestamp()
        RETURNING
          app_id,
          credential_id,
          (started_at AT TIME ZONE 'UTC')::date AS bucket_date,
          route_kind,
          latency_ms,
          started_at
      ),
      firecrawl_usage_rows AS (
        INSERT INTO admin.application_firecrawl_usage_daily (
          app_id,
          credential_id,
          bucket_date,
          route_kind,
          request_count,
          failure_count,
          latency_ms_sum,
          latency_ms_max,
          updated_at
        )
        SELECT
          app_id,
          credential_id,
          bucket_date,
          route_kind,
          count(*)::integer,
          count(*)::integer,
          sum(latency_ms),
          max(latency_ms),
          clock_timestamp()
        FROM firecrawl_expired_requests
        GROUP BY
          app_id,
          credential_id,
          bucket_date,
          route_kind
        ON CONFLICT (
          app_id,
          credential_id,
          bucket_date,
          route_kind
        )
        DO UPDATE SET
          request_count =
            admin.application_firecrawl_usage_daily.request_count
            + EXCLUDED.request_count,
          failure_count =
            admin.application_firecrawl_usage_daily.failure_count
            + EXCLUDED.failure_count,
          latency_ms_sum =
            admin.application_firecrawl_usage_daily.latency_ms_sum
            + EXCLUDED.latency_ms_sum,
          latency_ms_max = GREATEST(
            admin.application_firecrawl_usage_daily.latency_ms_max,
            EXCLUDED.latency_ms_max
          ),
          updated_at = EXCLUDED.updated_at
        RETURNING app_id
      ),
      firecrawl_updated_credentials AS (
        UPDATE admin.application_firecrawl_credentials AS credential
        SET last_used_at = GREATEST(
          COALESCE(credential.last_used_at, '-infinity'::timestamptz),
          credential.issued_at,
          expired.last_started_at
        )
        FROM (
          SELECT credential_id, max(started_at) AS last_started_at
          FROM firecrawl_expired_requests
          GROUP BY credential_id
        ) AS expired
        WHERE credential.id = expired.credential_id
        RETURNING credential.id
      )
      SELECT
        (
          (SELECT count(*)::integer FROM expired_requests)
          +
          (SELECT count(*)::integer FROM firecrawl_expired_requests)
        )
          AS abandoned_requests_settled,
        (
          (SELECT count(*)::integer FROM usage_rows)
          +
          (SELECT count(*)::integer FROM firecrawl_usage_rows)
        )
          AS usage_rows_updated,
        (
          (SELECT count(*)::integer FROM updated_credentials)
          +
          (SELECT count(*)::integer FROM firecrawl_updated_credentials)
        )
          AS credentials_updated
    `)
    const abandonedRow = resultRows(abandonedResult)[0] as
      | { abandoned_requests_settled?: unknown }
      | undefined
    if (!abandonedRow) {
      throw new Error("Inference Core abandonment returned no count row.")
    }
    const abandonedRequestsSettled = countValue(
      abandonedRow.abandoned_requests_settled,
    )

    const result = await execute(sql`
      WITH deleted_rate_limit_windows AS (
        DELETE FROM admin.application_rate_limit_windows
        WHERE expires_at <= clock_timestamp()
        RETURNING 1
      ),
      deleted_firecrawl_rate_limit_windows AS (
        DELETE FROM admin.application_firecrawl_rate_limit_windows
        WHERE expires_at <= clock_timestamp()
        RETURNING 1
      ),
      deleted_idempotency_rows AS (
        DELETE FROM admin.idempotency_ledger AS ledger
        WHERE ledger.expires_at <= clock_timestamp()
          AND ledger.state IN ('completed', 'failed')
          AND NOT EXISTS (
            SELECT 1
            FROM admin.identity_mutation_journal AS journal
            WHERE journal.idempotency_ledger_id = ledger.id
              AND journal.state IN (
                'prepared',
                'keycloak_applied',
                'reconciliation_required'
              )
          )
        RETURNING 1
      ),
      deleted_request_ledger_rows AS (
        DELETE FROM admin.application_request_ledger
        WHERE state = 'settled'
          AND started_at < (
            ${usageCutoff}::date::timestamp AT TIME ZONE 'UTC'
        )
        RETURNING 1
      ),
      deleted_firecrawl_request_ledger_rows AS (
        DELETE FROM admin.application_firecrawl_request_ledger
        WHERE state = 'settled'
          AND started_at < (
            ${usageCutoff}::date::timestamp AT TIME ZONE 'UTC'
          )
        RETURNING 1
      ),
      deleted_usage_buckets AS (
        DELETE FROM admin.application_usage_daily
        WHERE bucket_date < ${usageCutoff}::date
        RETURNING 1
      ),
      deleted_firecrawl_usage_buckets AS (
        DELETE FROM admin.application_firecrawl_usage_daily
        WHERE bucket_date < ${usageCutoff}::date
        RETURNING 1
      ),
      deleted_console_login_transactions AS (
        DELETE FROM common.console_login_transactions
        WHERE expires_at <= ${transientCutoff}::timestamptz
        RETURNING 1
      ),
      deleted_console_sessions AS (
        DELETE FROM common.console_sessions
        WHERE idle_expires_at <= ${transientCutoff}::timestamptz
           OR absolute_expires_at <= ${transientCutoff}::timestamptz
        RETURNING 1
      ),
      deleted_console_logout_token_replays AS (
        DELETE FROM common.console_logout_token_replays
        WHERE retain_until <= ${transientCutoff}::timestamptz
        RETURNING 1
      ),
      deleted_audit_events AS (
        DELETE FROM common.audit_events
        WHERE occurred_at < ${auditCutoff}::timestamptz
        RETURNING 1
      )
      SELECT
        (
          (SELECT count(*)::integer FROM deleted_rate_limit_windows)
          +
          (
            SELECT count(*)::integer
            FROM deleted_firecrawl_rate_limit_windows
          )
        )
          AS rate_limit_windows_deleted,
        (SELECT count(*)::integer FROM deleted_idempotency_rows)
          AS idempotency_rows_deleted,
        (SELECT count(*)::integer FROM deleted_audit_events)
          AS audit_events_deleted,
        (SELECT count(*)::integer FROM deleted_console_login_transactions)
          AS console_login_transactions_deleted,
        (SELECT count(*)::integer FROM deleted_console_sessions)
          AS console_sessions_deleted,
        (SELECT count(*)::integer FROM deleted_console_logout_token_replays)
          AS console_logout_token_replays_deleted,
        (
          (SELECT count(*)::integer FROM deleted_request_ledger_rows)
          +
          (
            SELECT count(*)::integer
            FROM deleted_firecrawl_request_ledger_rows
          )
        )
          AS request_ledger_rows_deleted,
        (
          (SELECT count(*)::integer FROM deleted_usage_buckets)
          +
          (SELECT count(*)::integer FROM deleted_firecrawl_usage_buckets)
        )
          AS usage_buckets_deleted
    `)
    const row = resultRows(result)[0] as
      | {
          audit_events_deleted?: unknown
          console_login_transactions_deleted?: unknown
          console_logout_token_replays_deleted?: unknown
          console_sessions_deleted?: unknown
          idempotency_rows_deleted?: unknown
          rate_limit_windows_deleted?: unknown
          request_ledger_rows_deleted?: unknown
          usage_buckets_deleted?: unknown
        }
      | undefined
    if (!row) {
      throw new Error("Inference Core retention returned no count row.")
    }
    return {
      abandonedRequestsSettled,
      auditEventsDeleted: countValue(row.audit_events_deleted),
      consoleLoginTransactionsDeleted: countValue(
        row.console_login_transactions_deleted,
      ),
      consoleLogoutTokenReplaysDeleted: countValue(
        row.console_logout_token_replays_deleted,
      ),
      consoleSessionsDeleted: countValue(row.console_sessions_deleted),
      idempotencyRowsDeleted: countValue(row.idempotency_rows_deleted),
      rateLimitWindowsDeleted: countValue(row.rate_limit_windows_deleted),
      requestLedgerRowsDeleted: countValue(row.request_ledger_rows_deleted),
      status: "completed",
      usageBucketsDeleted: countValue(row.usage_buckets_deleted),
    }
  })
}

function auditRetentionCutoff(now: Date): string {
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Inference Core retention requires a valid clock value.")
  }
  return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString()
}

function utcUsageCutoff(now: Date): string {
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Inference Core retention requires a valid clock value.")
  }
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
  cutoff.setUTCDate(cutoff.getUTCDate() - 89)
  return cutoff.toISOString().slice(0, 10)
}

async function acquireRetentionLock(
  execute: RetentionExecute,
): Promise<boolean> {
  await execute(sql`SET LOCAL lock_timeout = '2s'`)
  await execute(sql`SET LOCAL statement_timeout = '15s'`)
  const result = await execute(sql`
    SELECT pg_try_advisory_xact_lock(
      hashtextextended('llm-machines:inference-core:retention:v1', 0)
    ) AS acquired
  `)
  const row = resultRows(result)[0] as { acquired?: unknown } | undefined
  return row?.acquired === true
}

function countValue(value: unknown): number {
  if (
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    (typeof value === "string" && /^\d+$/.test(value))
  ) {
    return Number(value)
  }
  throw new Error("Inference Core retention returned an invalid count.")
}

function resultRows(result: unknown): unknown[] {
  if (Array.isArray(result)) {
    return result
  }
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray(result.rows)
  ) {
    return result.rows
  }
  return []
}
