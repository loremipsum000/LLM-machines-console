import { readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../infra/migrations/0000_inference_core.sql",
      import.meta.url,
    ),
  ),
  "utf8",
)

describe("PR-05 PostgreSQL emergency recovery", () => {
  it("applies to an empty database with only verifier recovery material", async () => {
    const database = await PGlite.create()

    try {
      await database.exec(migration)

      const tables = await database.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'admin'
          AND table_name IN (
            'emergency_recovery_factor',
            'emergency_recovery_sessions',
            'identity_mutation_journal'
          )
        ORDER BY table_name
      `)
      expect(tables.rows.map(({ table_name }) => table_name)).toEqual([
        "emergency_recovery_factor",
        "emergency_recovery_sessions",
        "identity_mutation_journal",
      ])

      const factorColumns = await tableColumns(
        database,
        "admin",
        "emergency_recovery_factor",
      )
      expect(factorColumns).toEqual([
        "algorithm",
        "block_size",
        "commissioned_at",
        "commissioned_by",
        "cost",
        "id",
        "key_length",
        "max_memory",
        "parallelization",
        "salt",
        "verifier_hash",
      ])
      expect(
        factorColumns.filter((column) =>
          /(plaintext|raw|secret|token|value)/i.test(column),
        ),
      ).toEqual([])

      const plaintextFactor = "customer-offline-recovery-factor"
      await database.query(
        `INSERT INTO admin.emergency_recovery_factor (
           id,
           algorithm,
           verifier_hash,
           salt,
           cost,
           block_size,
           parallelization,
           key_length,
           max_memory,
           commissioned_by
         )
         VALUES (
           'appliance',
           'scrypt',
           $1,
           $2,
           16384,
           8,
           1,
           32,
           67108864,
           'operator-commissioner'
         )`,
        ["a".repeat(64), "b".repeat(32)],
      )

      const persisted = await database.query(
        "SELECT * FROM admin.emergency_recovery_factor",
      )
      expect(JSON.stringify(persisted.rows)).not.toContain(plaintextFactor)
    } finally {
      await database.close()
    }
  })

  it("allows only one active emergency session under competing inserts", async () => {
    const database = await PGlite.create()

    try {
      await database.exec(migration)
      const outcomes = await Promise.allSettled([
        insertActiveSession(
          database,
          "10000000-0000-4000-8000-000000000001",
          "operator-one",
          "correlation-one",
        ),
        insertActiveSession(
          database,
          "10000000-0000-4000-8000-000000000002",
          "operator-two",
          "correlation-two",
        ),
      ])

      expect(
        outcomes.filter(({ status }) => status === "fulfilled"),
      ).toHaveLength(1)
      expect(
        outcomes.filter(({ status }) => status === "rejected"),
      ).toHaveLength(1)

      const active = await database.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM admin.emergency_recovery_sessions
        WHERE status = 'active'
      `)
      expect(active.rows).toEqual([{ count: 1 }])
    } finally {
      await database.close()
    }
  })

  it("preserves absolute expiry and explicit revocation across restarts", async () => {
    const dataDirectory = await mkdtemp(
      join(tmpdir(), "pr05-emergency-recovery-"),
    )
    let database: PGlite | null = null

    try {
      database = await PGlite.create(dataDirectory)
      await database.exec(migration)
      await database.exec(`
        INSERT INTO admin.emergency_recovery_sessions (
          id,
          keycloak_subject_id,
          reason_code,
          activated_at,
          expires_at,
          correlation_id
        )
        VALUES (
          '20000000-0000-4000-8000-000000000001',
          'operator-expired',
          'admin_lockout',
          '2000-01-01T00:00:00Z',
          '2000-01-01T00:15:00Z',
          'correlation-expired'
        )
      `)
      await database.close()

      database = await PGlite.create(dataDirectory)
      const validAfterRestart = await database.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM admin.emergency_recovery_sessions
        WHERE status = 'active'
          AND expires_at > clock_timestamp()
      `)
      expect(validAfterRestart.rows).toEqual([{ count: 0 }])

      await database.exec(`
        UPDATE admin.emergency_recovery_sessions
        SET status = 'expired'
        WHERE id = '20000000-0000-4000-8000-000000000001';

        INSERT INTO admin.emergency_recovery_sessions (
          id,
          keycloak_subject_id,
          reason_code,
          activated_at,
          expires_at,
          correlation_id
        )
        VALUES (
          '20000000-0000-4000-8000-000000000002',
          'operator-revoked',
          'admin_role_repair',
          '2100-01-01T00:00:00Z',
          '2100-01-01T00:15:00Z',
          'correlation-revoked'
        );

        UPDATE admin.emergency_recovery_sessions
        SET status = 'revoked',
            revoked_at = '2100-01-01T00:05:00Z',
            revoked_by = 'operator-revoker'
        WHERE id = '20000000-0000-4000-8000-000000000002';
      `)
      await database.close()

      database = await PGlite.create(dataDirectory)
      const persisted = await database.query<{
        correlation_id: string
        status: string
      }>(`
        SELECT correlation_id, status
        FROM admin.emergency_recovery_sessions
        ORDER BY correlation_id
      `)
      expect(persisted.rows).toEqual([
        { correlation_id: "correlation-expired", status: "expired" },
        { correlation_id: "correlation-revoked", status: "revoked" },
      ])
    } finally {
      if (database && !database.closed) {
        await database.close()
      }
      await rm(dataDirectory, { force: true, recursive: true })
    }
  })
})

async function insertActiveSession(
  database: PGlite,
  id: string,
  subject: string,
  correlationId: string,
): Promise<void> {
  await database.query(
    `INSERT INTO admin.emergency_recovery_sessions (
       id,
       keycloak_subject_id,
       reason_code,
       activated_at,
       expires_at,
       correlation_id
     )
     VALUES (
       $1,
       $2,
       'admin_mfa_repair',
       '2100-01-01T00:00:00Z',
       '2100-01-01T00:15:00Z',
       $3
     )`,
    [id, subject, correlationId],
  )
}

async function tableColumns(
  database: PGlite,
  schema: string,
  table: string,
): Promise<string[]> {
  const result = await database.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = $1
       AND table_name = $2
     ORDER BY column_name`,
    [schema, table],
  )
  return result.rows.map(({ column_name }) => column_name)
}
