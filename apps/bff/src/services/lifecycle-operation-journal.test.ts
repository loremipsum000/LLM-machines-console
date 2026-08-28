import {
  type LifecycleOperationKind,
  type LifecycleOperationState,
  type LifecycleSnapshotComponent,
  lifecycleOperationStates,
} from "@llm-machines/contracts"
import { describe, expect, it } from "vitest"
import type { InferenceCoreDatabase } from "../db/inference-core-client"
import {
  InMemoryLifecycleOperationJournal,
  createDrizzleLifecycleRestoreIsolationRecoveryAuthority,
  lifecycleOperationPhases,
  lifecyclePhaseOutcomes,
} from "./lifecycle-operation-journal"
import { createLifecycleSnapshotManifest } from "./lifecycle-snapshot-manifest"

const operationId = "11111111-1111-4111-8111-111111111111"
const secondOperationId = "22222222-2222-4222-8222-222222222222"
const snapshotId = "33333333-3333-4333-8333-333333333333"
const secondSnapshotId = "44444444-4444-4444-8444-444444444444"
const at = new Date("2026-08-01T12:00:00.000Z")

describe("lifecycle operation journal", () => {
  it("bounds phases and outcomes", () => {
    expect(lifecycleOperationPhases).toEqual([
      "operation",
      "quiesce",
      "capture",
      "validate",
      "restore",
      "verify",
      "resume",
      "rollback",
      "emergency_isolation_fence",
      "emergency_isolation_reassertion",
      "emergency_session_fence",
      "emergency_session_reset",
      "credential_consistency",
      "discard_preparation",
    ])
    expect(lifecyclePhaseOutcomes).toEqual(["started", "succeeded", "failed"])
  })

  it("bounds restore-isolation recovery authority construction and inputs", async () => {
    expect(
      createDrizzleLifecycleRestoreIsolationRecoveryAuthority(null),
    ).toBeNull()
    const authority = createDrizzleLifecycleRestoreIsolationRecoveryAuthority(
      {} as InferenceCoreDatabase,
    )
    if (!authority) {
      throw new Error("Restore isolation recovery authority was not created.")
    }

    await expect(authority.readRestoreOperation("invalid")).rejects.toThrow(
      "Invalid lifecycle restore isolation recovery input",
    )
    await expect(
      authority.terminalizeUnfencedRestore(operationId, new Date(Number.NaN)),
    ).rejects.toThrow("Invalid lifecycle restore isolation recovery input")
    await expect(
      authority.recordIsolationReconciled("invalid", at),
    ).rejects.toThrow("Invalid lifecycle restore isolation recovery input")

    const malformed = createDrizzleLifecycleRestoreIsolationRecoveryAuthority({
      execute: async () => ({
        rows: [
          { kind: "restore", operation_id: operationId, state: "unknown" },
        ],
      }),
    } as unknown as InferenceCoreDatabase)
    if (!malformed) {
      throw new Error("Malformed recovery authority fixture was not created.")
    }
    await expect(malformed.readRestoreOperation(operationId)).rejects.toThrow(
      "Lifecycle restore isolation recovery storage returned invalid data",
    )
    await expect(malformed.readUnfencedRestore()).rejects.toThrow(
      "Lifecycle restore isolation recovery storage returned invalid data",
    )
  })

  it("records state transitions and component phases in order", async () => {
    const journal = new InMemoryLifecycleOperationJournal()
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

    expect(journal.operations.get(operationId)?.state).toBe("quiescing")
    expect(
      journal.events.get(operationId)?.map(({ sequence }) => sequence),
    ).toEqual([0, 1, 2])
  })

  it("blocks concurrent work and keeps recovery-required unresolved", async () => {
    const journal = new InMemoryLifecycleOperationJournal()
    await journal.begin(beginInput())
    await expect(
      journal.begin(
        beginInput({
          operationId: secondOperationId,
          snapshotId: secondSnapshotId,
        }),
      ),
    ).resolves.toBe("busy")
    await journal.transition({
      at,
      expectedState: "prepared",
      failureCode: "journal_failed",
      nextState: "recovery_required",
      operationId,
    })
    await expect(
      journal.begin(
        beginInput({
          operationId: secondOperationId,
          snapshotId: secondSnapshotId,
        }),
      ),
    ).resolves.toBe("busy")
  })

  it("projects identities before busy results without decreasing last seen time", async () => {
    const journal = new InMemoryLifecycleOperationJournal()
    const later = new Date("2026-08-01T12:05:00.000Z")
    const earlier = new Date("2026-08-01T11:55:00.000Z")

    await expect(journal.begin(beginInput())).resolves.toBe("created")
    await expect(
      journal.begin({
        ...beginInput({
          operationId: secondOperationId,
          snapshotId: secondSnapshotId,
        }),
        at: later,
      }),
    ).resolves.toBe("busy")
    await expect(
      journal.begin({
        ...beginInput({
          operationId: secondOperationId,
          snapshotId: secondSnapshotId,
        }),
        at: earlier,
      }),
    ).resolves.toBe("busy")
    await expect(
      journal.begin({
        ...beginInput({
          operationId: secondOperationId,
          snapshotId: secondSnapshotId,
        }),
        actorSubjectId: "operator-1",
      }),
    ).resolves.toBe("busy")

    expect(journal.humanIdentities.get("admin-1")).toEqual({
      firstSeenAt: at,
      lastSeenAt: later,
      subjectId: "admin-1",
    })
    expect(journal.humanIdentities.get("operator-1")).toEqual({
      firstSeenAt: at,
      lastSeenAt: at,
      subjectId: "operator-1",
    })
  })

  it("saves only a verified manifest for its validating snapshot operation", async () => {
    const journal = new InMemoryLifecycleOperationJournal()
    await journal.begin(beginInput())
    await journal.transition({
      at,
      expectedState: "prepared",
      nextState: "quiescing",
      operationId,
    })
    await journal.transition({
      at,
      expectedState: "quiescing",
      nextState: "capturing",
      operationId,
    })
    await journal.transition({
      at,
      expectedState: "capturing",
      nextState: "validating",
      operationId,
    })
    const manifest = createLifecycleSnapshotManifest({
      capturedAt: at.toISOString(),
      captures,
      operationId,
      snapshotId,
    })

    await expect(journal.saveManifest(manifest)).resolves.toBe(true)
    await expect(journal.saveManifest(manifest)).resolves.toBe(false)
    await expect(
      journal.saveManifest({
        ...manifest,
        manifestSha256: "f".repeat(64),
      }),
    ).resolves.toBe(false)
  })

  it("rejects state, phase, and failure mismatches", async () => {
    const journal = new InMemoryLifecycleOperationJournal()
    await journal.begin(beginInput())
    await expect(
      journal.transition({
        at,
        expectedState: "capturing",
        nextState: "validating",
        operationId,
      }),
    ).resolves.toBe(false)
    await expect(
      journal.recordPhase({
        at,
        component: "grafana",
        operationId,
        operationState: "capturing",
        outcome: "succeeded",
        phase: "capture",
      }),
    ).resolves.toBe(false)
    await expect(
      journal.recordPhase({
        at,
        component: "grafana",
        failureCode: "capture_failed",
        operationId,
        operationState: "prepared",
        outcome: "succeeded",
        phase: "capture",
      }),
    ).rejects.toThrow("Invalid lifecycle operation phase event")
  })

  it("enforces the exact kind-specific transition graphs", async () => {
    for (const kind of ["snapshot", "restore"] as const) {
      for (const currentState of lifecycleOperationStates) {
        for (const nextState of lifecycleOperationStates) {
          const journal = await journalAtState(kind, currentState)
          const expected =
            operationEdges[kind][currentState]?.includes(nextState) ?? false

          await expect(
            journal.transition({
              at,
              expectedState: currentState,
              failureCode: failureStates.has(nextState)
                ? "journal_failed"
                : undefined,
              nextState,
              operationId,
            }),
          ).resolves.toBe(expected)
        }
      }
    }
  })

  it("enforces phase-state mapping and reserves operation events", async () => {
    const componentPhases = new Set([
      "quiesce",
      "capture",
      "validate",
      "restore",
      "verify",
      "resume",
      "rollback",
      "discard_preparation",
    ])

    for (const [phase, allowedStates] of Object.entries(phaseStates)) {
      for (const operationState of lifecycleOperationStates) {
        const journal = await journalAtState("restore", operationState)
        const event = {
          at,
          component: componentPhases.has(phase)
            ? ("console_database" as const)
            : undefined,
          operationId,
          operationState,
          outcome: "succeeded" as const,
          phase: phase as Exclude<
            (typeof lifecycleOperationPhases)[number],
            "operation"
          >,
        }

        if (allowedStates.includes(operationState)) {
          await expect(journal.recordPhase(event)).resolves.toBe(true)
        } else {
          await expect(journal.recordPhase(event)).rejects.toThrow(
            "Invalid lifecycle operation phase event",
          )
        }
      }
    }

    const journal = await journalAtState("snapshot", "prepared")
    await expect(
      journal.recordPhase({
        at,
        operationId,
        operationState: "prepared",
        outcome: "started",
        phase: "operation",
      }),
    ).rejects.toThrow("Invalid lifecycle operation phase event")
  })
})

function beginInput(
  overrides: Partial<{
    operationId: string
    snapshotId: string
  }> = {},
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

const failureStates = new Set<LifecycleOperationState>([
  "rolling_back",
  "rolled_back",
  "failed",
  "recovery_required",
])

const operationEdges: Record<
  LifecycleOperationKind,
  Partial<Record<LifecycleOperationState, readonly LifecycleOperationState[]>>
> = {
  restore: {
    prepared: ["validating", "failed", "recovery_required"],
    quiescing: ["restoring", "resuming", "failed", "recovery_required"],
    restoring: ["verifying", "rolling_back", "recovery_required"],
    resuming: [
      "succeeded",
      "rolling_back",
      "rolled_back",
      "failed",
      "recovery_required",
    ],
    rolling_back: ["resuming", "recovery_required"],
    validating: ["quiescing", "failed", "recovery_required"],
    verifying: ["resuming", "rolling_back", "recovery_required"],
  },
  snapshot: {
    capturing: ["validating", "resuming", "failed", "recovery_required"],
    prepared: ["quiescing", "failed", "recovery_required"],
    quiescing: ["capturing", "resuming", "failed", "recovery_required"],
    resuming: ["succeeded", "failed", "recovery_required"],
    validating: ["resuming", "failed", "recovery_required"],
  },
}

const phaseStates: Record<
  Exclude<(typeof lifecycleOperationPhases)[number], "operation">,
  readonly LifecycleOperationState[]
> = {
  capture: ["capturing"],
  credential_consistency: ["verifying"],
  discard_preparation: ["validating", "verifying", "rolling_back"],
  emergency_isolation_fence: ["prepared", "quiescing", "resuming"],
  emergency_isolation_reassertion: [
    "prepared",
    "validating",
    "quiescing",
    "restoring",
    "verifying",
    "rolling_back",
    "resuming",
    "recovery_required",
  ],
  emergency_session_fence: ["quiescing", "resuming", "rolling_back"],
  emergency_session_reset: [
    "quiescing",
    "restoring",
    "resuming",
    "rolling_back",
  ],
  quiesce: ["quiescing", "rolling_back"],
  restore: ["restoring"],
  resume: ["resuming"],
  rollback: ["rolling_back"],
  validate: ["validating"],
  verify: ["verifying"],
}

async function journalAtState(
  kind: LifecycleOperationKind,
  state: LifecycleOperationState,
): Promise<InMemoryLifecycleOperationJournal> {
  const journal = new InMemoryLifecycleOperationJournal()
  await journal.begin({ ...beginInput(), kind })
  const operation = journal.operations.get(operationId)
  if (!operation) {
    throw new Error("Lifecycle operation fixture was not created.")
  }
  journal.operations.set(operationId, {
    ...operation,
    completedAt: [
      "succeeded",
      "rolled_back",
      "failed",
      "recovery_required",
    ].includes(state)
      ? at
      : null,
    failureCode: failureStates.has(state) ? "journal_failed" : null,
    state,
  })
  return journal
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
] as const satisfies readonly LifecycleSnapshotComponent[]
