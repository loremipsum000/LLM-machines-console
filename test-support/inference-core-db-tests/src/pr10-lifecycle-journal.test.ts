import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { InferenceCoreDatabase } from "../../../apps/bff/src/db/inference-core-client"
import * as schema from "../../../apps/bff/src/db/inference-core-schema"
import {
  createDrizzleLifecycleOperationJournal,
  createDrizzleLifecycleRestoreIsolationRecoveryAuthority,
} from "../../../apps/bff/src/services/lifecycle-operation-journal"
import { createLifecycleSnapshotManifest } from "../../../apps/bff/src/services/lifecycle-snapshot-manifest"

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../infra/migrations/0000_inference_core.sql",
      import.meta.url,
    ),
  ),
  "utf8",
)

const operationId = "11111111-1111-4111-8111-111111111111"
const secondOperationId = "22222222-2222-4222-8222-222222222222"
const snapshotId = "33333333-3333-4333-8333-333333333333"
const secondSnapshotId = "44444444-4444-4444-8444-444444444444"
const at = new Date("2026-08-01T12:00:00.000Z")

describe("PR-10 lifecycle operation journal", () => {
  let client: PGlite
  let database: InferenceCoreDatabase
  let journal: NonNullable<
    ReturnType<typeof createDrizzleLifecycleOperationJournal>
  >
  let recoveryAuthority: NonNullable<
    ReturnType<typeof createDrizzleLifecycleRestoreIsolationRecoveryAuthority>
  >

  beforeEach(async () => {
    client = await PGlite.create()
    await client.exec(migration)
    database = drizzle(client, { schema }) as unknown as InferenceCoreDatabase
    const candidate = createDrizzleLifecycleOperationJournal(database)
    if (!candidate) {
      throw new Error("Lifecycle journal was not created.")
    }
    journal = candidate
    const recoveryCandidate =
      createDrizzleLifecycleRestoreIsolationRecoveryAuthority(database)
    if (!recoveryCandidate) {
      throw new Error("Restore isolation recovery authority was not created.")
    }
    recoveryAuthority = recoveryCandidate
  })

  afterEach(async () => {
    await client.close()
  })

  it("atomically projects a new actor without decreasing last seen time", async () => {
    const before = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM common.human_identities
    `)
    expect(before.rows).toEqual([{ count: 0 }])

    await expect(journal.begin(beginInput())).resolves.toBe("created")
    const created = await client.query<{
      first_seen_at: Date
      last_seen_at: Date
      subject_id: string
    }>(`
      SELECT subject_id, first_seen_at, last_seen_at
      FROM common.human_identities
      WHERE subject_id = 'admin-1'
    `)
    expect(created.rows).toEqual([
      {
        first_seen_at: at,
        last_seen_at: at,
        subject_id: "admin-1",
      },
    ])

    await expect(
      journal.begin({
        ...beginInput({
          operationId: secondOperationId,
          snapshotId: secondSnapshotId,
        }),
        at: new Date("2026-08-01T11:00:00.000Z"),
      }),
    ).resolves.toBe("busy")
    const retained = await client.query<{ last_seen_at: Date }>(`
      SELECT last_seen_at
      FROM common.human_identities
      WHERE subject_id = 'admin-1'
    `)
    expect(retained.rows).toEqual([{ last_seen_at: at }])
  })

  it("commits state transitions with ordered operation events", async () => {
    await expect(journal.begin(beginInput())).resolves.toBe("created")
    await expect(
      journal.transition({
        at,
        expectedState: "prepared",
        nextState: "quiescing",
        operationId,
      }),
    ).resolves.toBe(true)
    await expect(
      journal.recordPhase({
        at,
        component: "console_database",
        operationId,
        operationState: "quiescing",
        outcome: "succeeded",
        phase: "quiesce",
      }),
    ).resolves.toBe(true)
    await expect(
      journal.transition({
        at,
        expectedState: "quiescing",
        nextState: "capturing",
        operationId,
      }),
    ).resolves.toBe(true)

    const rows = await client.query<{
      operation_state: string
      outcome: string
      phase: string
      sequence: number
    }>(`
      SELECT sequence, operation_state, phase, outcome
      FROM admin.lifecycle_operation_events
      WHERE operation_id = '${operationId}'
      ORDER BY sequence
    `)
    expect(rows.rows).toEqual([
      {
        operation_state: "prepared",
        outcome: "started",
        phase: "operation",
        sequence: 0,
      },
      {
        operation_state: "quiescing",
        outcome: "started",
        phase: "operation",
        sequence: 1,
      },
      {
        operation_state: "quiescing",
        outcome: "succeeded",
        phase: "quiesce",
        sequence: 2,
      },
      {
        operation_state: "capturing",
        outcome: "started",
        phase: "operation",
        sequence: 3,
      },
    ])
  })

  it("persists prepared isolation fence and reassertion events", async () => {
    await expect(
      journal.begin({ ...beginInput(), kind: "restore" }),
    ).resolves.toBe("created")
    for (const [phase, outcome] of [
      ["emergency_isolation_fence", "started"],
      ["emergency_isolation_fence", "succeeded"],
      ["emergency_isolation_reassertion", "started"],
      ["emergency_isolation_reassertion", "succeeded"],
    ] as const) {
      await expect(
        journal.recordPhase({
          at,
          operationId,
          operationState: "prepared",
          outcome,
          phase,
        }),
      ).resolves.toBe(true)
    }

    const rows = await client.query<{
      component: string | null
      operation_state: string
      outcome: string
      phase: string
      sequence: number
    }>(`
      SELECT sequence, operation_state, phase, component, outcome
      FROM admin.lifecycle_operation_events
      WHERE operation_id = '${operationId}'
        AND phase <> 'operation'
      ORDER BY sequence
    `)
    expect(rows.rows).toEqual([
      {
        component: null,
        operation_state: "prepared",
        outcome: "started",
        phase: "emergency_isolation_fence",
        sequence: 1,
      },
      {
        component: null,
        operation_state: "prepared",
        outcome: "succeeded",
        phase: "emergency_isolation_fence",
        sequence: 2,
      },
      {
        component: null,
        operation_state: "prepared",
        outcome: "started",
        phase: "emergency_isolation_reassertion",
        sequence: 3,
      },
      {
        component: null,
        operation_state: "prepared",
        outcome: "succeeded",
        phase: "emergency_isolation_reassertion",
        sequence: 4,
      },
    ])
  })

  it("terminalizes and idempotently reconciles one unfenced prepared restore", async () => {
    await expect(
      journal.begin({ ...beginInput(), kind: "restore" }),
    ).resolves.toBe("created")
    await expect(recoveryAuthority.readUnfencedRestore()).resolves.toEqual({
      kind: "restore",
      operationId,
      state: "prepared",
    })

    await expect(
      recoveryAuthority.terminalizeUnfencedRestore(operationId, at),
    ).resolves.toBe(true)
    await expect(
      recoveryAuthority.terminalizeUnfencedRestore(operationId, at),
    ).resolves.toBe(true)
    await expect(
      recoveryAuthority.readRestoreOperation(operationId),
    ).resolves.toEqual({
      kind: "restore",
      operationId,
      state: "recovery_required",
    })
    await expect(recoveryAuthority.readUnfencedRestore()).resolves.toEqual({
      kind: "restore",
      operationId,
      state: "recovery_required",
    })

    const terminal = await client.query<{
      completed_at: Date
      failure_code: string
      state: string
    }>(`
      SELECT state, failure_code, completed_at
      FROM admin.lifecycle_operations
      WHERE id = '${operationId}'
    `)
    expect(terminal.rows).toEqual([
      {
        completed_at: at,
        failure_code: "restore_failed",
        state: "recovery_required",
      },
    ])
    const terminalEvents = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM admin.lifecycle_operation_events
      WHERE operation_id = '${operationId}'
        AND phase = 'operation'
        AND operation_state = 'recovery_required'
        AND outcome = 'failed'
        AND failure_code = 'restore_failed'
    `)
    expect(terminalEvents.rows).toEqual([{ count: 1 }])

    await expect(
      recoveryAuthority.recordIsolationReconciled(operationId, at),
    ).resolves.toBe(true)
    await expect(
      recoveryAuthority.recordIsolationReconciled(operationId, at),
    ).resolves.toBe(true)
    await expect(recoveryAuthority.readUnfencedRestore()).resolves.toBeNull()
    const reconciliation = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM admin.lifecycle_operation_events
      WHERE operation_id = '${operationId}'
        AND phase = 'emergency_isolation_reassertion'
        AND operation_state = 'recovery_required'
        AND outcome = 'succeeded'
        AND component IS NULL
        AND failure_code IS NULL
    `)
    expect(reconciliation.rows).toEqual([{ count: 1 }])
  })

  it.each([
    "emergency_isolation_fence",
    "emergency_isolation_reassertion",
  ] as const)("excludes a restore with succeeded %s", async (phase) => {
    await journal.begin({ ...beginInput(), kind: "restore" })
    await expect(
      journal.recordPhase({
        at,
        operationId,
        operationState: "prepared",
        outcome: "succeeded",
        phase,
      }),
    ).resolves.toBe(true)

    await expect(recoveryAuthority.readUnfencedRestore()).resolves.toBeNull()
    await expect(
      recoveryAuthority.terminalizeUnfencedRestore(operationId, at),
    ).resolves.toBe(false)
  })

  it("rejects multiple unfenced restore matches instead of selecting one", async () => {
    await client.exec("DROP INDEX admin.lifecycle_operations_one_active_idx")
    await expect(
      journal.begin({ ...beginInput(), kind: "restore" }),
    ).resolves.toBe("created")
    await expect(
      journal.begin({
        ...beginInput({
          operationId: secondOperationId,
          snapshotId: secondSnapshotId,
        }),
        kind: "restore",
      }),
    ).resolves.toBe("created")

    await expect(recoveryAuthority.readUnfencedRestore()).rejects.toThrow(
      "Lifecycle restore isolation recovery storage returned invalid data",
    )
  })

  it("rejects missing and wrong-kind recovery operations", async () => {
    await expect(
      recoveryAuthority.readRestoreOperation(operationId),
    ).resolves.toBeNull()
    await expect(
      recoveryAuthority.terminalizeUnfencedRestore(operationId, at),
    ).resolves.toBe(false)
    await expect(
      recoveryAuthority.recordIsolationReconciled(operationId, at),
    ).resolves.toBe(false)

    await journal.begin(beginInput())
    await expect(
      recoveryAuthority.readRestoreOperation(operationId),
    ).resolves.toBeNull()
    await expect(recoveryAuthority.readUnfencedRestore()).resolves.toBeNull()
    await expect(
      recoveryAuthority.terminalizeUnfencedRestore(operationId, at),
    ).resolves.toBe(false)
    await expect(
      recoveryAuthority.recordIsolationReconciled(operationId, at),
    ).resolves.toBe(false)
  })

  it("rejects a restore in another lifecycle state", async () => {
    await journal.begin({ ...beginInput(), kind: "restore" })
    await journal.transition({
      at,
      expectedState: "prepared",
      nextState: "validating",
      operationId,
    })

    await expect(
      recoveryAuthority.readRestoreOperation(operationId),
    ).resolves.toEqual({
      kind: "restore",
      operationId,
      state: "validating",
    })
    await expect(recoveryAuthority.readUnfencedRestore()).resolves.toBeNull()
    await expect(
      recoveryAuthority.terminalizeUnfencedRestore(operationId, at),
    ).resolves.toBe(false)
    await expect(
      recoveryAuthority.recordIsolationReconciled(operationId, at),
    ).resolves.toBe(false)
  })

  it("stores one verified manifest and all four normalized components", async () => {
    await journal.begin(beginInput())
    for (const [expectedState, nextState] of [
      ["prepared", "quiescing"],
      ["quiescing", "capturing"],
      ["capturing", "validating"],
    ] as const) {
      await expect(
        journal.transition({
          at,
          expectedState,
          nextState,
          operationId,
        }),
      ).resolves.toBe(true)
    }
    const manifest = createLifecycleSnapshotManifest({
      capturedAt: at.toISOString(),
      captures,
      operationId,
      snapshotId,
    })

    await expect(journal.saveManifest(manifest)).resolves.toBe(true)
    await expect(journal.saveManifest(manifest)).resolves.toBe(false)
    const headers = await client.query<{
      component_count: number
      content_free: boolean
      emergency_sessions_included: boolean
      plaintext_secrets_included: boolean
      workload_content_included: boolean
    }>(`
      SELECT
        component_count,
        content_free,
        emergency_sessions_included,
        plaintext_secrets_included,
        workload_content_included
      FROM admin.lifecycle_snapshot_manifests
      WHERE snapshot_id = '${snapshotId}'
    `)
    expect(headers.rows).toEqual([
      {
        component_count: 4,
        content_free: true,
        emergency_sessions_included: false,
        plaintext_secrets_included: false,
        workload_content_included: false,
      },
    ])
    const components = await client.query<{
      component: string
      ordinal: number
    }>(`
      SELECT component, ordinal
      FROM admin.lifecycle_snapshot_components
      WHERE snapshot_id = '${snapshotId}'
      ORDER BY ordinal
    `)
    expect(components.rows).toEqual([
      { component: "console_database", ordinal: 0 },
      { component: "keycloak", ordinal: 1 },
      { component: "litellm", ordinal: 2 },
      { component: "grafana", ordinal: 3 },
    ])
  })

  it("keeps recovery-required work unresolved and blocks a new operation", async () => {
    await journal.begin(beginInput())
    await expect(
      journal.transition({
        at,
        expectedState: "prepared",
        failureCode: "journal_failed",
        nextState: "recovery_required",
        operationId,
      }),
    ).resolves.toBe(true)
    await expect(
      journal.begin(
        beginInput({
          operationId: secondOperationId,
          snapshotId: secondSnapshotId,
        }),
      ),
    ).resolves.toBe("busy")
  })
})

function beginInput(
  overrides: Partial<{ operationId: string; snapshotId: string }> = {},
) {
  return {
    actorSubjectId: "admin-1",
    at,
    correlationId: "correlation-1",
    kind: "snapshot" as const,
    operationId: overrides.operationId ?? operationId,
    snapshotId: overrides.snapshotId ?? snapshotId,
  }
}

const captures = [
  {
    artifactSha256: "0".repeat(64),
    component: "console_database",
    ordinal: 0,
    revision: "db-1",
  },
  {
    artifactSha256: "1".repeat(64),
    component: "keycloak",
    ordinal: 1,
    revision: "keycloak-1",
  },
  {
    artifactSha256: "2".repeat(64),
    component: "litellm",
    ordinal: 2,
    revision: "litellm-1",
  },
  {
    artifactSha256: "3".repeat(64),
    component: "grafana",
    ordinal: 3,
    revision: "grafana-1",
  },
] as const
