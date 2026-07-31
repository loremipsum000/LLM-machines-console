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
        abandonedRequestsSettled: 2,
        idempotencyRowsDeleted: 1,
        rateLimitWindowsDeleted: 1,
        requestLedgerRowsDeleted: 2,
        status: "completed",
        usageBucketsDeleted: 2,
      })

      await expect(
        runInferenceCoreRetention(database, {
          acquireLock: async () => true,
          now: new Date("2026-07-31T00:30:00.000Z"),
        }),
      ).resolves.toEqual({
        abandonedRequestsSettled: 0,
        idempotencyRowsDeleted: 0,
        rateLimitWindowsDeleted: 0,
        requestLedgerRowsDeleted: 0,
        status: "completed",
        usageBucketsDeleted: 0,
      })

      const windows = await client.query<{ expired: boolean }>(`
        SELECT expires_at <= clock_timestamp() AS expired
        FROM admin.application_rate_limit_windows
      `)
      expect(windows.rows).toEqual([{ expired: false }])

      const ledger = await client.query<{
        expired: boolean
        operation_code: string
        state: string
      }>(`
        SELECT
          expires_at <= clock_timestamp() AS expired,
          operation_code,
          state
        FROM admin.idempotency_ledger
        ORDER BY operation_code
      `)
      expect(ledger.rows).toEqual([
        {
          expired: false,
          operation_code: "POST /active-terminal",
          state: "completed",
        },
        {
          expired: true,
          operation_code: "POST /expired-linked-terminal",
          state: "completed",
        },
        {
          expired: true,
          operation_code: "POST /expired-pending",
          state: "pending",
        },
      ])

      const journal = await client.query<{ state: string }>(`
        SELECT state
        FROM admin.identity_mutation_journal
      `)
      expect(journal.rows).toEqual([{ state: "prepared" }])

      const usage = await client.query<{ age_days: number }>(`
        SELECT (DATE '2026-07-31' - bucket_date)::integer AS age_days
        FROM admin.application_usage_daily
        ORDER BY bucket_date
      `)
      expect(usage.rows).toEqual([
        { age_days: 89 },
        { age_days: 0 },
        { age_days: 0 },
      ])

      const requestLedger = await client.query<{
        id: string
        state: string
      }>(`
        SELECT id, state
        FROM admin.application_request_ledger
        ORDER BY id
      `)
      expect(requestLedger.rows).toEqual([
        { id: "00000000-0000-4000-8000-000000000073", state: "settled" },
        { id: "00000000-0000-4000-8000-000000000074", state: "active" },
        { id: "00000000-0000-4000-8000-000000000075", state: "settled" },
      ])

      const abandonedUsage = await client.query<{
        failure_count: number
        latency_ms_max: number
        latency_ms_sum: number
        request_count: number
      }>(`
        SELECT
          request_count,
          failure_count,
          latency_ms_sum,
          latency_ms_max
        FROM admin.application_usage_daily
        WHERE route_kind = 'chat_completions'
          AND bucket_date = DATE '2026-07-31'
      `)
      expect(abandonedUsage.rows).toEqual([
        {
          failure_count: 1,
          latency_ms_max: 900000,
          latency_ms_sum: 900000,
          request_count: 1,
        },
      ])
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
      bucket_date,
      route_kind
    )
    VALUES
      (
        'retention-test-app',
        'retention-test-credential',
        DATE '2026-05-02',
        'models'
      ),
      (
        'retention-test-app',
        'retention-test-credential',
        DATE '2026-05-03',
        'models'
      ),
      (
        'retention-test-app',
        'retention-test-credential',
        DATE '2026-07-31',
        'models'
      );

    INSERT INTO admin.application_request_ledger (
      id,
      app_id,
      credential_id,
      route_kind,
      model_alias,
      state,
      status_code,
      latency_ms,
      started_at,
      lease_expires_at,
      settled_at
    )
    VALUES
      (
        '00000000-0000-4000-8000-000000000071',
        'retention-test-app',
        'retention-test-credential',
        'chat_completions',
        'local-a',
        'settled',
        200,
        10,
        TIMESTAMPTZ '2026-05-02T12:30:00Z',
        TIMESTAMPTZ '2026-05-02T12:45:00Z',
        TIMESTAMPTZ '2026-05-02T12:30:01Z'
      ),
      (
        '00000000-0000-4000-8000-000000000072',
        'retention-test-app',
        'retention-test-credential',
        'chat_completions',
        'local-a',
        'active',
        NULL,
        NULL,
        TIMESTAMPTZ '2026-05-02T12:30:00Z',
        TIMESTAMPTZ '2026-05-02T12:45:00Z',
        NULL
      ),
      (
        '00000000-0000-4000-8000-000000000073',
        'retention-test-app',
        'retention-test-credential',
        'chat_completions',
        'local-a',
        'settled',
        200,
        10,
        TIMESTAMPTZ '2026-05-03T00:00:00Z',
        TIMESTAMPTZ '2026-05-03T00:15:00Z',
        TIMESTAMPTZ '2026-05-03T00:00:01Z'
      ),
      (
        '00000000-0000-4000-8000-000000000074',
        'retention-test-app',
        'retention-test-credential',
        'models',
        NULL,
        'active',
        NULL,
        NULL,
        clock_timestamp(),
        clock_timestamp() + interval '15 minutes',
        NULL
      ),
      (
        '00000000-0000-4000-8000-000000000075',
        'retention-test-app',
        'retention-test-credential',
        'chat_completions',
        'local-a',
        'active',
        NULL,
        NULL,
        clock_timestamp() - interval '20 minutes',
        clock_timestamp() - interval '5 minutes',
        NULL
      );

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
        'POST /expired-linked-terminal',
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
      ),
      (
        '00000000-0000-4000-8000-000000000004',
        'retention-test-actor',
        'POST /expired-terminal',
        repeat('1', 64),
        repeat('2', 64),
        'completed',
        'succeeded',
        'correlation-expired-terminal',
        201,
        clock_timestamp() - interval '1 day',
        clock_timestamp() - interval '2 days'
      );

    INSERT INTO admin.identity_mutation_journal (
      id,
      idempotency_ledger_id,
      keycloak_subject_id,
      operation_code,
      request_fingerprint,
      target_type,
      target_identifier
    )
    VALUES (
      '10000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      'retention-test-actor',
      'POST /expired-linked-terminal',
      repeat('c', 64),
      'user',
      'protected-user'
    );
  `)
}

function sqlQuery(statement: unknown) {
  expect(statement).toBeDefined()
  return new PgDialect().sqlToQuery(statement as SQL)
}
