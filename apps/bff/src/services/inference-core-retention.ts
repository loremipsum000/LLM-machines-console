import { sql, type SQL } from "drizzle-orm"
import type { getInferenceCoreDb } from "../db/inference-core-client"

type InferenceCoreDatabase = NonNullable<ReturnType<typeof getInferenceCoreDb>>
type RetentionExecute = (statement: SQL) => Promise<unknown>

export type InferenceCoreRetentionResult =
  | {
      idempotencyRowsDeleted: number
      rateLimitWindowsDeleted: number
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
  const usageCutoff = utcUsageCutoff(options.now ?? new Date())
  return database.transaction(async (transaction) => {
    const execute: RetentionExecute = async (statement) =>
      transaction.execute(statement)
    const acquired = await (options.acquireLock ?? acquireRetentionLock)(
      execute,
    )
    if (!acquired) {
      return { status: "lock_busy" }
    }

    const result = await execute(sql`
      WITH deleted_rate_limit_windows AS (
        DELETE FROM admin.application_rate_limit_windows
        WHERE expires_at <= clock_timestamp()
        RETURNING 1
      ),
      deleted_idempotency_rows AS (
        DELETE FROM admin.idempotency_ledger
        WHERE expires_at <= clock_timestamp()
          AND state IN ('completed', 'failed')
        RETURNING 1
      ),
      deleted_usage_buckets AS (
        DELETE FROM admin.application_usage_daily
        WHERE bucket_date < ${usageCutoff}::date
        RETURNING 1
      )
      SELECT
        (SELECT count(*)::integer FROM deleted_rate_limit_windows)
          AS rate_limit_windows_deleted,
        (SELECT count(*)::integer FROM deleted_idempotency_rows)
          AS idempotency_rows_deleted,
        (SELECT count(*)::integer FROM deleted_usage_buckets)
          AS usage_buckets_deleted
    `)
    const row = resultRows(result)[0] as
      | {
          idempotency_rows_deleted?: unknown
          rate_limit_windows_deleted?: unknown
          usage_buckets_deleted?: unknown
        }
      | undefined
    if (!row) {
      throw new Error("Inference Core retention returned no count row.")
    }
    return {
      idempotencyRowsDeleted: countValue(row.idempotency_rows_deleted),
      rateLimitWindowsDeleted: countValue(row.rate_limit_windows_deleted),
      status: "completed",
      usageBucketsDeleted: countValue(row.usage_buckets_deleted),
    }
  })
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
