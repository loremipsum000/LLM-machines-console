import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Actor } from "../../../apps/bff/src/auth/authorization"
import type { InferenceCoreDatabase } from "../../../apps/bff/src/db/inference-core-client"
import * as schema from "../../../apps/bff/src/db/inference-core-schema"
import {
  EmergencyIsolationAtomicCommitError,
  type EmergencyIsolationCommitWithReceipt,
  type EmergencyIsolationEnforcement,
  EmergencyIsolationService,
  InMemoryEmergencyIsolationNonRestorableAuthority,
  createDrizzleEmergencyIsolationStore,
} from "../../../apps/bff/src/services/emergency-isolation"
import type { LifecycleRestoreIsolationRecoveryAuthority } from "../../../apps/bff/src/services/lifecycle-operation-journal"

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../infra/migrations/0000_inference_core.sql",
      import.meta.url,
    ),
  ),
  "utf8",
)
const at = new Date("2026-08-02T12:00:00.000Z")
const transitionId = "10000000-0000-4000-8000-000000000001"

describe("PR-10C PostgreSQL Emergency Isolation authority", () => {
  let client: PGlite
  let database: InferenceCoreDatabase
  let store: NonNullable<
    ReturnType<typeof createDrizzleEmergencyIsolationStore>
  >

  beforeEach(async () => {
    client = await PGlite.create()
    await client.exec(migration)
    database = drizzle(client, {
      schema,
    }) as unknown as InferenceCoreDatabase
    const candidate = createDrizzleEmergencyIsolationStore(database)
    if (!candidate) {
      throw new Error("Emergency Isolation store was not created.")
    }
    store = candidate
  })

  afterEach(async () => {
    await client.close()
  })

  it("seeds exactly one pristine appliance authority and rejects other singleton ids", async () => {
    await expect(store.read()).resolves.toMatchObject({
      activatedAt: null,
      activatedBySubjectId: null,
      changedBySubjectId: null,
      correlationId: null,
      failureCode: null,
      id: "appliance",
      revision: 0,
      state: "inactive",
      transitionId: null,
      transitionStartedAt: null,
    })
    await expect(
      client.exec(
        "INSERT INTO admin.emergency_isolation_state (id) VALUES ('appliance')",
      ),
    ).rejects.toThrow()
    await expect(
      client.exec(
        "INSERT INTO admin.emergency_isolation_state (id) VALUES ('other')",
      ),
    ).rejects.toThrow()
  })

  it.each([
    ["unknown state", "SET status = 'unknown'"],
    ["negative revision", "SET revision = -1"],
    ["unsafe revision", "SET revision = 9007199254740992"],
    [
      "unknown failure code",
      "SET revision = 1, status = 'recovery_required', failure_code = 'unknown'",
    ],
    ["non-pristine revision zero", "SET changed_by_subject_id = 'admin-1'"],
    [
      "missing transition metadata",
      "SET revision = 1, status = 'engaging', changed_by_subject_id = 'admin-1'",
    ],
    [
      "terminal transition metadata",
      `SET revision = 1,
           status = 'inactive',
           changed_by_subject_id = 'admin-1',
           transition_id = '${transitionId}',
           correlation_id = 'correlation-1',
           transition_started_at = TIMESTAMPTZ '2026-08-02T12:00:00Z'`,
    ],
    [
      "active without activation provenance",
      "SET revision = 1, status = 'active', changed_by_subject_id = 'admin-1'",
    ],
    [
      "half activation provenance",
      `SET revision = 1,
           status = 'active',
           changed_by_subject_id = 'admin-1',
           activated_at = TIMESTAMPTZ '2026-08-02T12:00:00Z'`,
    ],
    [
      "recovery without failure code",
      "SET revision = 1, status = 'recovery_required'",
    ],
    [
      "future activation timestamp",
      `SET revision = 1,
           status = 'active',
           changed_by_subject_id = 'admin-1',
           activated_by_subject_id = 'admin-1',
           activated_at = updated_at + INTERVAL '1 second'`,
    ],
  ])("rejects %s in PostgreSQL", async (_name, mutation) => {
    await expect(
      client.exec(`
        UPDATE admin.emergency_isolation_state
        ${mutation}
        WHERE id = 'appliance'
      `),
    ).rejects.toThrow()
  })

  it("durably persists and reads back recovery_required with metadata-only audit", async () => {
    const recovered = await store.forceRecoveryRequired({
      actorSubjectId: null,
      at,
      correlationId: "restore-1",
      failureCode: "restore_reassertion_failed",
      transitionId,
    })
    expect(recovered).toMatchObject({
      failureCode: "restore_reassertion_failed",
      revision: 1,
      state: "recovery_required",
    })
    await expect(store.read()).resolves.toEqual(recovered)

    const rows = await client.query<{
      action: string
      correlation_id: string
      keycloak_subject_id: string | null
      outcome: string
      recovery_reason_code: string
    }>(`
      SELECT
        action,
        correlation_id,
        keycloak_subject_id,
        outcome,
        recovery_reason_code
      FROM common.audit_events
      WHERE action = 'emergency_isolation.recovery_required'
    `)
    expect(rows.rows).toEqual([
      {
        action: "emergency_isolation.recovery_required",
        correlation_id: "restore-1",
        keycloak_subject_id: null,
        outcome: "failed",
        recovery_reason_code: "restore_reassertion_failed",
      },
    ])
  })

  it("rolls recovery and audit back when the failed receipt transaction cannot commit", async () => {
    const service = new EmergencyIsolationService(store, failingEnforcement, {
      lifecycleRestoreIsolationRecoveryAuthority:
        emptyLifecycleRestoreIsolationRecoveryAuthority(),
      nonRestorableAuthority:
        new InMemoryEmergencyIsolationNonRestorableAuthority(),
      now: () => at,
      randomId: () => transitionId,
    })
    const commitWithReceipt: EmergencyIsolationCommitWithReceipt = async (
      input,
    ) =>
      await database.transaction(async (transaction) => {
        await input.run(transaction)
        throw new Error("receipt commit failed")
      })

    await expect(
      service.activate(
        adminActor,
        "atomic-recovery-1",
        {
          confirmation: "ACTIVATE EMERGENCY ISOLATION",
          expectedRevision: 0,
        },
        commitWithReceipt,
      ),
    ).rejects.toBeInstanceOf(EmergencyIsolationAtomicCommitError)

    await expect(store.read()).resolves.toMatchObject({
      failureCode: null,
      revision: 1,
      state: "engaging",
    })
    const audits = await client.query<{ action: string }>(`
      SELECT action
      FROM common.audit_events
      WHERE action LIKE 'emergency_isolation.%'
      ORDER BY action
    `)
    expect(audits.rows).toEqual([
      { action: "emergency_isolation.activation.started" },
    ])
  })

  it("accepts only the exact legal begin transition pairs", async () => {
    const base = {
      actorSubjectId: "admin-1",
      at,
      correlationId: "transition-1",
      expectedRevision: 0,
      transitionId,
    }
    for (const input of [
      {
        ...base,
        expectedStates: ["active"] as const,
        nextState: "engaging" as const,
      },
      {
        ...base,
        expectedStates: ["inactive"] as const,
        nextState: "engaging" as const,
      },
      {
        ...base,
        expectedStates: ["inactive", "active"] as const,
        nextState: "disengaging" as const,
      },
    ]) {
      await expect(store.begin(input)).rejects.toThrow(
        "Invalid isolation transition input.",
      )
    }

    await expect(
      store.begin({
        ...base,
        expectedStates: ["inactive", "recovery_required"],
        nextState: "engaging",
      }),
    ).resolves.toMatchObject({ status: "changed" })
  })

  it("runs the deactivation commit reservation callback inside the terminal transaction", async () => {
    const activation = await store.begin({
      actorSubjectId: "admin-1",
      at,
      correlationId: "activation-setup",
      expectedRevision: 0,
      expectedStates: ["inactive", "recovery_required"],
      nextState: "engaging",
      transitionId,
    })
    if (activation.status !== "changed") {
      throw new Error("Activation setup did not begin.")
    }
    await expect(
      store.complete({
        at,
        expectedRevision: activation.state.revision,
        expectedState: "engaging",
        nextState: "active",
        transitionId,
      }),
    ).resolves.toMatchObject({ revision: 2, state: "active" })
    const deactivation = await store.begin({
      actorSubjectId: "admin-1",
      at,
      correlationId: "deactivation-reservation",
      expectedRevision: 2,
      expectedStates: ["active"],
      nextState: "disengaging",
      transitionId,
    })
    if (deactivation.status !== "changed") {
      throw new Error("Deactivation setup did not begin.")
    }

    let callbackCalls = 0
    await expect(
      store.complete({
        at,
        beforeCommit: () => {
          callbackCalls += 1
          return false
        },
        expectedRevision: deactivation.state.revision,
        expectedState: "disengaging",
        nextState: "inactive",
        transitionId,
      }),
    ).rejects.toThrow()
    expect(callbackCalls).toBe(1)
    await expect(store.read()).resolves.toMatchObject({
      revision: 3,
      state: "disengaging",
    })
    const rolledBack = await client.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM common.audit_events
      WHERE action = 'emergency_isolation.deactivated'
    `)
    expect(rolledBack.rows).toEqual([{ count: "0" }])

    await expect(
      store.complete({
        at,
        beforeCommit: () => {
          callbackCalls += 1
          return true
        },
        expectedRevision: deactivation.state.revision,
        expectedState: "disengaging",
        nextState: "inactive",
        transitionId,
      }),
    ).resolves.toMatchObject({ revision: 4, state: "inactive" })
    expect(callbackCalls).toBe(2)
  })

  it("fails authority reads closed when a damaged restored schema contains multiple rows", async () => {
    await client.exec(`
      ALTER TABLE admin.emergency_isolation_state
        DROP CONSTRAINT emergency_isolation_state_pkey,
        DROP CONSTRAINT emergency_isolation_state_id_check;
      INSERT INTO admin.emergency_isolation_state (id) VALUES ('other');
    `)

    await expect(store.read()).resolves.toBeNull()
  })

  it.each([
    ["non-pristine seed", "revision = 0, changed_by_subject_id = 'admin-1'"],
    ["missing changed subject", "revision = 1, status = 'inactive'"],
    [
      "missing engaging metadata",
      "revision = 1, status = 'engaging', changed_by_subject_id = 'admin-1'",
    ],
    [
      "terminal transition metadata",
      `revision = 1,
       status = 'inactive',
       changed_by_subject_id = 'admin-1',
       transition_id = '${transitionId}',
       correlation_id = 'correlation-1',
       transition_started_at = TIMESTAMPTZ '2026-08-02T12:00:00Z'`,
    ],
    [
      "active without activation metadata",
      "revision = 1, status = 'active', changed_by_subject_id = 'admin-1'",
    ],
    [
      "recovery without a failure code",
      "revision = 1, status = 'recovery_required'",
    ],
    [
      "future activation timestamp",
      `revision = 1,
       status = 'active',
       changed_by_subject_id = 'admin-1',
       activated_by_subject_id = 'admin-1',
       activated_at = updated_at + INTERVAL '1 second'`,
    ],
    ["unsafe revision", "revision = 9007199254740992"],
    ["unknown state", "status = 'unknown'"],
    [
      "unknown failure",
      "revision = 1, status = 'recovery_required', failure_code = 'unknown'",
    ],
  ])("rejects %s during runtime wire validation", async (_name, mutation) => {
    await dropIsolationChecks(client)
    await client.exec(`
      UPDATE admin.emergency_isolation_state
      SET ${mutation}
      WHERE id = 'appliance'
    `)

    await expect(store.read()).resolves.toBeNull()
  })
})

function emptyLifecycleRestoreIsolationRecoveryAuthority(): LifecycleRestoreIsolationRecoveryAuthority {
  return {
    async readRestoreOperation() {
      return null
    },
    async readUnfencedRestore() {
      return null
    },
    async recordIsolationReconciled() {
      return false
    },
    async terminalizeUnfencedRestore() {
      return false
    },
  }
}

const adminActor = {
  acr: "urn:llm-machines:mfa",
  amr: ["otp"],
  authMode: "keycloak",
  authTime: Math.floor(at.getTime() / 1000),
  role: "admin",
  subject: "admin-1",
} satisfies Actor

const failingEnforcement: EmergencyIsolationEnforcement = {
  effectiveTrafficState: () => "sealed",
  engage: async () => ({
    failureCode: "admission_fence_failed",
    status: "failed",
  }),
  prepareDisengage: async () => ({
    deactivationCommitReservation: {
      abort: () => undefined,
      commit: () => undefined,
      enterCommitting: () => true,
    },
    status: "prepared",
  }),
  verifyEngaged: async () => ({ status: "verified" }),
}

async function dropIsolationChecks(client: PGlite): Promise<void> {
  const constraints = await client.query<{ conname: string }>(`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'admin.emergency_isolation_state'::regclass
      AND contype = 'c'
    ORDER BY conname
  `)
  for (const { conname } of constraints.rows) {
    await client.exec(
      `ALTER TABLE admin.emergency_isolation_state DROP CONSTRAINT ${conname}`,
    )
  }
}
