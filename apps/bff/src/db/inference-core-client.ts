import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./inference-core-schema"

let client: ReturnType<typeof postgres> | null = null
let database: ReturnType<typeof drizzle<typeof schema>> | null = null

export const INFERENCE_CORE_POSTGRES_OPTIONS = {
  connect_timeout: 3,
  connection: {
    idle_in_transaction_session_timeout: 60_000,
    lock_timeout: 2_000,
    statement_timeout: 10_000,
  },
  max: 5,
} as const

export function getInferenceCoreDb(): ReturnType<
  typeof drizzle<typeof schema>
> | null {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    return null
  }

  if (!client) {
    client = postgres(databaseUrl, INFERENCE_CORE_POSTGRES_OPTIONS)
    database = drizzle(client, { schema })
  }

  return database
}

export async function checkInferenceCoreDbReadiness(
  database: ReturnType<typeof getInferenceCoreDb> = getInferenceCoreDb(),
): Promise<boolean> {
  if (!database) {
    return false
  }

  try {
    return await database.transaction(async (transaction) => {
      await transaction.execute(sql`SET LOCAL statement_timeout = '3s'`)
      const result = await transaction.execute(sql`
        SELECT count(*)::integer AS missing_relations
        FROM (
          VALUES
            ('common.human_identities'),
            ('common.human_identity_roles'),
            ('common.audit_events'),
            ('admin.applications'),
            ('admin.application_credentials'),
            ('admin.application_model_allowlists'),
            ('admin.application_limits'),
            ('admin.application_rate_limit_windows'),
            ('admin.application_usage_daily'),
            ('admin.idempotency_ledger'),
            ('admin.identity_mutation_journal'),
            ('admin.identity_mutation_journal_targets'),
            ('admin.console_settings'),
            ('admin.license_state'),
            ('admin.update_state'),
            ('admin.backup_state'),
            ('admin.emergency_recovery_factor'),
            ('admin.emergency_recovery_sessions'),
            ('admin.recovery_state')
        ) AS required(relation_name)
        WHERE to_regclass(relation_name) IS NULL
      `)
      const row = resultRows(result)[0] as
        | { missing_relations?: unknown }
        | undefined
      return Number(row?.missing_relations) === 0
    })
  } catch {
    return false
  }
}

export async function closeInferenceCoreDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 1 })
    client = null
    database = null
  }
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
