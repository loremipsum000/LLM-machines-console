import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { describe, expect, it } from "vitest"
import * as schema from "../../../apps/bff/src/db/inference-core-schema"
import { createDrizzleIdentityMutationJournalStore } from "../../../apps/bff/src/services/identity-mutation-journal"

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../infra/migrations/0000_inference_core.sql",
      import.meta.url,
    ),
  ),
  "utf8",
)

describe("PR-05 PostgreSQL identity mutation journal", () => {
  it("enforces one journal intent per idempotency receipt and cascades cleanup", async () => {
    const database = await PGlite.create()

    try {
      await database.exec(migration)
      await insertLedger(
        database,
        "30000000-0000-4000-8000-000000000001",
        "ledger-key-one",
      )
      await insertPreparedJournal(
        database,
        "31000000-0000-4000-8000-000000000001",
        "30000000-0000-4000-8000-000000000001",
        "user",
      )

      await expect(
        insertPreparedJournal(
          database,
          "31000000-0000-4000-8000-000000000002",
          "30000000-0000-4000-8000-000000000001",
          "group",
        ),
      ).rejects.toThrow()
      await expect(
        insertPreparedJournal(
          database,
          "31000000-0000-4000-8000-000000000003",
          "30000000-0000-4000-8000-000000000099",
          "user",
        ),
      ).rejects.toThrow()

      await database.exec(`
        DELETE FROM admin.idempotency_ledger
        WHERE id = '30000000-0000-4000-8000-000000000001'
      `)
      const remaining = await database.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM admin.identity_mutation_journal
      `)
      expect(remaining.rows).toEqual([{ count: 0 }])
    } finally {
      await database.close()
    }
  })

  it("admits the PR-06 OAuth target and rejects inconsistent lifecycle states", async () => {
    const database = await PGlite.create()

    try {
      await database.exec(migration)
      await insertLedger(
        database,
        "40000000-0000-4000-8000-000000000001",
        "ledger-key-target",
      )
      await insertPreparedJournal(
        database,
        "41000000-0000-4000-8000-000000000001",
        "40000000-0000-4000-8000-000000000001",
        "oauth_client",
      )
      const oauthTarget = await database.query<{ target_type: string }>(`
        SELECT target_type
        FROM admin.identity_mutation_journal
        WHERE id = '41000000-0000-4000-8000-000000000001'
      `)
      expect(oauthTarget.rows).toEqual([{ target_type: "oauth_client" }])
      await database.exec(`
        DELETE FROM admin.idempotency_ledger
        WHERE id = '40000000-0000-4000-8000-000000000001'
      `)

      await insertLedger(
        database,
        "40000000-0000-4000-8000-000000000002",
        "ledger-key-lifecycle",
      )
      await insertPreparedJournal(
        database,
        "41000000-0000-4000-8000-000000000002",
        "40000000-0000-4000-8000-000000000002",
        "group",
      )

      await expect(
        database.exec(`
          UPDATE admin.identity_mutation_journal
          SET state = 'completed',
              completed_at = clock_timestamp(),
              updated_at = clock_timestamp()
          WHERE id = '41000000-0000-4000-8000-000000000002'
        `),
      ).rejects.toThrow()
      await expect(
        database.exec(`
          UPDATE admin.identity_mutation_journal
          SET state = 'reconciliation_required',
              reconciliation_required_at = clock_timestamp(),
              updated_at = clock_timestamp()
          WHERE id = '41000000-0000-4000-8000-000000000002'
        `),
      ).rejects.toThrow()

      await database.exec(`
        UPDATE admin.identity_mutation_journal
        SET state = 'keycloak_applied',
            resource_id = 'keycloak-user-id',
            keycloak_applied_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE id = '41000000-0000-4000-8000-000000000002';

        UPDATE admin.identity_mutation_journal
        SET state = 'completed',
            completed_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE id = '41000000-0000-4000-8000-000000000002';
      `)
      const completed = await database.query<{
        resource_id: string
        state: string
      }>(`
        SELECT resource_id, state
        FROM admin.identity_mutation_journal
        WHERE id = '41000000-0000-4000-8000-000000000002'
      `)
      expect(completed.rows).toEqual([
        { resource_id: "keycloak-user-id", state: "completed" },
      ])
    } finally {
      await database.close()
    }
  })

  it("allows only one compare-and-set transition from prepared", async () => {
    const database = await PGlite.create()

    try {
      await database.exec(migration)
      await insertLedger(
        database,
        "50000000-0000-4000-8000-000000000001",
        "ledger-key-cas",
      )
      await insertPreparedJournal(
        database,
        "51000000-0000-4000-8000-000000000001",
        "50000000-0000-4000-8000-000000000001",
        "user",
      )

      const transitions = await Promise.all([
        database.query<{ state: string }>(`
          UPDATE admin.identity_mutation_journal
          SET state = 'keycloak_applied',
              keycloak_applied_at = clock_timestamp(),
              updated_at = clock_timestamp()
          WHERE id = '51000000-0000-4000-8000-000000000001'
            AND state = 'prepared'
          RETURNING state
        `),
        database.query<{ state: string }>(`
          UPDATE admin.identity_mutation_journal
          SET state = 'failed',
              completed_at = clock_timestamp(),
              updated_at = clock_timestamp()
          WHERE id = '51000000-0000-4000-8000-000000000001'
            AND state = 'prepared'
          RETURNING state
        `),
      ])

      expect(transitions.flatMap(({ rows }) => rows)).toHaveLength(1)
      const current = await database.query<{ state: string }>(`
        SELECT state
        FROM admin.identity_mutation_journal
        WHERE id = '51000000-0000-4000-8000-000000000001'
      `)
      expect(["keycloak_applied", "failed"]).toContain(current.rows[0]?.state)
    } finally {
      await database.close()
    }
  })

  it("does not allow a rejected mutation to retain applied-write evidence", async () => {
    const database = await PGlite.create()

    try {
      await database.exec(migration)
      await insertLedger(
        database,
        "52000000-0000-4000-8000-000000000001",
        "ledger-key-rejected-evidence",
      )
      await insertPreparedJournal(
        database,
        "52000000-0000-4000-8000-000000000002",
        "52000000-0000-4000-8000-000000000001",
        "user",
      )

      await expect(
        database.exec(`
          UPDATE admin.identity_mutation_journal
          SET state = 'failed',
              resource_id = 'unexpected-keycloak-user-id',
              keycloak_applied_at = clock_timestamp(),
              completed_at = clock_timestamp(),
              updated_at = clock_timestamp()
          WHERE id = '52000000-0000-4000-8000-000000000002'
        `),
      ).rejects.toThrow()
    } finally {
      await database.close()
    }
  })

  it("enforces one unresolved parent globally across independent ledgers", async () => {
    const database = await PGlite.create()

    try {
      await database.exec(migration)
      await insertLedger(
        database,
        "53000000-0000-4000-8000-000000000001",
        "ledger-global-one",
      )
      await insertLedger(
        database,
        "53000000-0000-4000-8000-000000000002",
        "ledger-global-two",
      )
      await insertPreparedJournal(
        database,
        "53000000-0000-4000-8000-000000000011",
        "53000000-0000-4000-8000-000000000001",
        "user",
      )
      await expect(
        insertPreparedJournal(
          database,
          "53000000-0000-4000-8000-000000000012",
          "53000000-0000-4000-8000-000000000002",
          "group",
        ),
      ).rejects.toThrow()

      await database.exec(`
        UPDATE admin.identity_mutation_journal
        SET state = 'failed',
            completed_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE id = '53000000-0000-4000-8000-000000000011'
      `)
      await expect(
        insertPreparedJournal(
          database,
          "53000000-0000-4000-8000-000000000012",
          "53000000-0000-4000-8000-000000000002",
          "group",
        ),
      ).resolves.toBeUndefined()
    } finally {
      await database.close()
    }
  })

  it("persists allowlisted child intent and atomically gates parent completion", async () => {
    const database = await PGlite.create()

    try {
      await database.exec(migration)
      await insertLedger(
        database,
        "54000000-0000-4000-8000-000000000001",
        "ledger-child-manifest",
      )
      await insertPreparedJournal(
        database,
        "54000000-0000-4000-8000-000000000011",
        "54000000-0000-4000-8000-000000000001",
        "user",
      )
      const orm = drizzle(database, { schema })
      const store = createDrizzleIdentityMutationJournalStore(
        orm as unknown as Parameters<
          typeof createDrizzleIdentityMutationJournalStore
        >[0],
      )
      expect(store).not.toBeNull()
      if (!store) {
        throw new Error("journal store unavailable")
      }
      const createdAt = new Date()
      const targets = await store.insertTargets([
        {
          id: "54000000-0000-4000-8000-000000000021",
          intent: {
            displayName: "Admin One",
            email: "admin.one@example.test",
            enabled: true,
            group: "Platform",
            kind: "csv_user",
            line: 2,
            role: "admin",
            sendInvite: false,
            username: "admin.one",
          },
          journalId: "54000000-0000-4000-8000-000000000011",
          now: createdAt,
          ordinal: 0,
          targetIdentifier: "admin.one@example.test",
          targetType: "user",
        },
        {
          id: "54000000-0000-4000-8000-000000000022",
          intent: {
            groupId: "platform-group",
            kind: "group_membership",
            memberId: "operator-1",
          },
          journalId: "54000000-0000-4000-8000-000000000011",
          now: createdAt,
          ordinal: 1,
          targetIdentifier: "platform-group:operator-1",
          targetType: "group_membership",
        },
      ])
      expect(targets.map((target) => target.state)).toEqual([
        "unattempted",
        "unattempted",
      ])

      await expect(
        database.query(
          `INSERT INTO admin.identity_mutation_journal_targets (
             id, journal_id, ordinal, target_type, target_identifier, intent
           ) VALUES ($1, $2, 2, 'user', 'secret-bearing-user', $3::jsonb)`,
          [
            "54000000-0000-4000-8000-000000000023",
            "54000000-0000-4000-8000-000000000011",
            JSON.stringify({
              displayName: "Forbidden",
              email: "forbidden@example.test",
              enabled: false,
              group: "",
              kind: "csv_user",
              line: 3,
              password: "must-not-persist",
              role: "operator",
              sendInvite: false,
              username: "forbidden",
            }),
          ],
        ),
      ).rejects.toThrow()

      const startedAt = new Date(createdAt.getTime() + 1_000)
      const completedAt = new Date(createdAt.getTime() + 2_000)
      await store.transitionTarget({
        expectedStates: ["unattempted"],
        id: targets[0]?.id ?? "",
        nextState: "unknown",
        now: startedAt,
        startedAt,
      })
      await store.transitionTarget({
        expectedStates: ["unknown"],
        id: targets[0]?.id ?? "",
        nextState: "unknown",
        now: startedAt,
        resourceId: "keycloak-user-1",
      })
      await store.transitionTarget({
        completedAt,
        expectedStates: ["unknown"],
        id: targets[0]?.id ?? "",
        nextState: "applied",
        now: completedAt,
      })

      const parentApplied = await store.transition({
        expectedStates: ["prepared"],
        id: "54000000-0000-4000-8000-000000000011",
        keycloakAppliedAt: startedAt,
        nextState: "keycloak_applied",
        now: startedAt,
        resourceId: "keycloak-user-1",
      })
      expect(parentApplied?.state).toBe("keycloak_applied")
      await expect(
        store.transition({
          completedAt,
          expectedStates: ["keycloak_applied"],
          id: "54000000-0000-4000-8000-000000000011",
          nextState: "completed",
          now: completedAt,
          requiredAppliedTargetCount: 2,
        }),
      ).resolves.toBeNull()

      await store.transitionTarget({
        expectedStates: ["unattempted"],
        id: targets[1]?.id ?? "",
        nextState: "unknown",
        now: startedAt,
        startedAt,
      })
      await store.transitionTarget({
        completedAt,
        expectedStates: ["unknown"],
        id: targets[1]?.id ?? "",
        nextState: "applied",
        now: completedAt,
      })
      await expect(
        store.transition({
          completedAt,
          expectedStates: ["keycloak_applied"],
          id: "54000000-0000-4000-8000-000000000011",
          nextState: "completed",
          now: completedAt,
          requiredAppliedTargetCount: 2,
        }),
      ).resolves.toMatchObject({ state: "completed" })

      const persisted = await database.query<{
        intent: Record<string, unknown>
        resource_id: string | null
        state: string
      }>(`
        SELECT intent, resource_id, state
        FROM admin.identity_mutation_journal_targets
        ORDER BY ordinal
      `)
      expect(persisted.rows).toMatchObject([
        {
          intent: {
            email: "admin.one@example.test",
            kind: "csv_user",
            username: "admin.one",
          },
          resource_id: "keycloak-user-1",
          state: "applied",
        },
        {
          intent: {
            groupId: "platform-group",
            kind: "group_membership",
            memberId: "operator-1",
          },
          resource_id: null,
          state: "applied",
        },
      ])
    } finally {
      await database.close()
    }
  })

  it("persists reconciliation-required intent across a database restart", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "pr05-journal-"))
    let database: PGlite | null = null

    try {
      database = await PGlite.create(dataDirectory)
      await database.exec(migration)
      await insertLedger(
        database,
        "60000000-0000-4000-8000-000000000001",
        "ledger-key-restart",
      )
      await insertPreparedJournal(
        database,
        "61000000-0000-4000-8000-000000000001",
        "60000000-0000-4000-8000-000000000001",
        "user",
      )
      await database.exec(`
        UPDATE admin.identity_mutation_journal
        SET state = 'reconciliation_required',
            reconciliation_reason = 'keycloak_outcome_unknown',
            reconciliation_required_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE id = '61000000-0000-4000-8000-000000000001'
      `)
      await database.close()

      database = await PGlite.create(dataDirectory)
      const persisted = await database.query<{
        reconciliation_reason: string
        state: string
      }>(`
        SELECT reconciliation_reason, state
        FROM admin.identity_mutation_journal
        WHERE id = '61000000-0000-4000-8000-000000000001'
      `)
      expect(persisted.rows).toEqual([
        {
          reconciliation_reason: "keycloak_outcome_unknown",
          state: "reconciliation_required",
        },
      ])
    } finally {
      if (database && !database.closed) {
        await database.close()
      }
      await rm(dataDirectory, { force: true, recursive: true })
    }
  })
})

async function insertLedger(
  database: PGlite,
  id: string,
  keySeed: string,
): Promise<void> {
  await database.query(
    `INSERT INTO admin.idempotency_ledger (
       id,
       keycloak_subject_id,
       operation_code,
       idempotency_key_digest,
       request_fingerprint,
       correlation_id,
       expires_at
     )
     VALUES (
       $1,
       'admin-journal-test',
       'POST /api/admin/identity',
       $2,
       $3,
       $4,
       clock_timestamp() + interval '1 day'
     )`,
    [
      id,
      createHash("sha256").update(keySeed).digest("hex"),
      "c".repeat(64),
      `correlation-${keySeed}`,
    ],
  )
}

async function insertPreparedJournal(
  database: PGlite,
  id: string,
  ledgerId: string,
  targetType: string,
): Promise<void> {
  await database.query(
    `INSERT INTO admin.identity_mutation_journal (
       id,
       idempotency_ledger_id,
       keycloak_subject_id,
       operation_code,
       request_fingerprint,
       target_type,
       target_identifier
     )
     VALUES (
       $1,
       $2,
       'admin-journal-test',
       'POST /api/admin/identity',
       $3,
       $4,
       'target-journal-test'
     )`,
    [id, ledgerId, "d".repeat(64), targetType],
  )
}
