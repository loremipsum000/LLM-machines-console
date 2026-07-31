import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import type { SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { drizzle } from "drizzle-orm/pglite"
import { describe, expect, it, vi } from "vitest"
import type { getInferenceCoreDb } from "../../../apps/bff/src/db/inference-core-client"
import * as schema from "../../../apps/bff/src/db/inference-core-schema"
import { runInferenceCoreRetention } from "../../../apps/bff/src/services/inference-core-retention"

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../infra/migrations/0000_inference_core.sql",
      import.meta.url,
    ),
  ),
  "utf8",
)

describe("Inference Core one-shot retention", () => {
  it("uses the UTC calendar boundary in a non-UTC database session", async () => {
    const client = await PGlite.create()
    try {
      await client.exec(migration)
      await client.exec("SET TIME ZONE 'Pacific/Kiritimati'")
      await seedRetentionRows(client)
      const database = drizzle(client, { schema }) as unknown as NonNullable<
        ReturnType<typeof getInferenceCoreDb>
      >

      await expect(
        runInferenceCoreRetention(database, {
          acquireLock: async () => true,
          now: new Date("2026-07-31T00:30:00.000Z"),
        }),
      ).resolves.toEqual({
        idempotencyRowsDeleted: 1,
        rateLimitWindowsDeleted: 1,
        status: "completed",
        usageBucketsDeleted: 1,
      })

      const windows = await client.query<{ expired: boolean }>(`
        SELECT expires_at <= clock_timestamp() AS expired
        FROM admin.application_rate_limit_windows
      `)
      expect(windows.rows).toEqual([{ expired: false }])

      const ledger = await client.query<{
        expired: boolean
        state: string
      }>(`
        SELECT expires_at <= clock_timestamp() AS expired, state
        FROM admin.idempotency_ledger
        ORDER BY state
      `)
      expect(ledger.rows).toEqual([
        { expired: false, state: "completed" },
        { expired: true, state: "pending" },
      ])

      const usage = await client.query<{ age_days: number }>(`
        SELECT (DATE '2026-07-31' - bucket_date)::integer AS age_days
        FROM admin.application_usage_daily
        ORDER BY bucket_date
      `)
      expect(usage.rows).toEqual([{ age_days: 89 }, { age_days: 0 }])
    } finally {
      await client.close()
    }
  })

  it("uses bounded transaction settings and exits without deleting when the advisory lock is busy", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ acquired: false }])
    const transaction = vi.fn(
      async (run: (client: { execute: typeof execute }) => Promise<unknown>) =>
        run({ execute }),
    )
    const database = {
      transaction,
    } as unknown as NonNullable<ReturnType<typeof getInferenceCoreDb>>

    await expect(runInferenceCoreRetention(database)).resolves.toEqual({
      status: "lock_busy",
    })
    expect(transaction).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledTimes(3)
    expect(sqlQuery(execute.mock.calls[0]?.[0]).sql).toContain(
      "SET LOCAL lock_timeout",
    )
    expect(sqlQuery(execute.mock.calls[1]?.[0]).sql).toContain(
      "SET LOCAL statement_timeout",
    )
    expect(sqlQuery(execute.mock.calls[2]?.[0]).sql).toContain(
      "pg_try_advisory_xact_lock",
    )
  })
})

async function seedRetentionRows(client: PGlite): Promise<void> {
  await client.exec(`
    INSERT INTO common.human_identities (subject_id)
    VALUES ('retention-test-actor');

    INSERT INTO admin.applications (
      id,
      name,
      auth_mode,
      created_by,
      updated_by
    )
    VALUES (
      'retention-test-app',
      'Retention Test',
      'api_key',
      'retention-test-actor',
      'retention-test-actor'
    );

    INSERT INTO admin.application_credentials (
      id,
      app_id,
      kind,
      key_prefix,
      verifier_hash
    )
    VALUES (
      'retention-test-credential',
      'retention-test-app',
      'api_key',
      'llmm_test',
      repeat('a', 64)
    );

    INSERT INTO admin.application_rate_limit_windows (
      app_id,
      window_started_at,
      request_count,
      expires_at
    )
    VALUES
      (
        'retention-test-app',
        clock_timestamp() - interval '3 minutes',
        1,
        clock_timestamp() - interval '1 minute'
      ),
      (
        'retention-test-app',
        clock_timestamp(),
        1,
        clock_timestamp() + interval '2 minutes'
      );

    INSERT INTO admin.application_usage_daily (
      app_id,
      credential_id,
      bucket_date
    )
    VALUES
      ('retention-test-app', 'retention-test-credential', DATE '2026-05-02'),
      ('retention-test-app', 'retention-test-credential', DATE '2026-05-03'),
      ('retention-test-app', 'retention-test-credential', DATE '2026-07-31');

    INSERT INTO admin.idempotency_ledger (
      id,
      keycloak_subject_id,
      operation_code,
      idempotency_key_digest,
      request_fingerprint,
      state,
      outcome,
      correlation_id,
      status_code,
      expires_at,
      created_at
    )
    VALUES
      (
        '00000000-0000-4000-8000-000000000001',
        'retention-test-actor',
        'POST /expired-terminal',
        repeat('b', 64),
        repeat('c', 64),
        'completed',
        'succeeded',
        'correlation-expired-terminal',
        201,
        clock_timestamp() - interval '1 day',
        clock_timestamp() - interval '2 days'
      ),
      (
        '00000000-0000-4000-8000-000000000002',
        'retention-test-actor',
        'POST /expired-pending',
        repeat('d', 64),
        repeat('e', 64),
        'pending',
        NULL,
        'correlation-expired-pending',
        NULL,
        clock_timestamp() - interval '1 day',
        clock_timestamp() - interval '2 days'
      ),
      (
        '00000000-0000-4000-8000-000000000003',
        'retention-test-actor',
        'POST /active-terminal',
        repeat('f', 64),
        repeat('0', 64),
        'completed',
        'succeeded',
        'correlation-active-terminal',
        201,
        clock_timestamp() + interval '1 day',
        clock_timestamp()
      );
  `)
}

function sqlQuery(statement: unknown) {
  expect(statement).toBeDefined()
  return new PgDialect().sqlToQuery(statement as SQL)
}
