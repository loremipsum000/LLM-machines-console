import type {
  LifecycleComponent,
  LifecycleSnapshotComponent,
} from "@llm-machines/contracts"
import { describe, expect, it } from "vitest"
import {
  type LifecycleAdapterContext,
  type LifecycleComponentDriver,
  createLifecycleComponentAdapters,
} from "./lifecycle-component-adapters"
import {
  InMemoryLifecycleOperationJournal,
  type TransitionLifecycleOperationInput,
} from "./lifecycle-operation-journal"
import {
  LifecycleOrchestrator,
  type LifecycleRestoreSafety,
} from "./lifecycle-orchestration"
import { createLifecycleSnapshotManifest } from "./lifecycle-snapshot-manifest"

const at = new Date("2026-08-01T12:00:00.000Z")
const snapshotOperationId = "11111111-1111-4111-8111-111111111111"
const snapshotId = "22222222-2222-4222-8222-222222222222"
const restoreOperationId = "33333333-3333-4333-8333-333333333333"
const sourceOperationId = "44444444-4444-4444-8444-444444444444"
const sourceSnapshotId = "55555555-5555-4555-8555-555555555555"

describe("lifecycle orchestration", () => {
  it("creates one deterministic coordinated snapshot and resumes in reverse", async () => {
    const fixture = snapshotFixture()

    const result = await fixture.orchestrator.createSnapshot(request)

    expect(result.status).toBe("succeeded")
    if (result.status !== "succeeded") {
      return
    }
    expect(
      result.manifest.components.map(({ component }) => component),
    ).toEqual(components)
    expect(result.manifest).toMatchObject({
      contentFree: true,
      emergencySessionsIncluded: false,
      plaintextSecretsIncluded: false,
      workloadContentIncluded: false,
    })
    expect(fixture.calls).toEqual([
      ...components.map((component) => `quiesce:${component}`),
      ...components.map((component) => `capture:${component}`),
      ...components.map((component) => `validate_capture:${component}`),
      ...[...components].reverse().map((component) => `resume:${component}`),
    ])
    expect(fixture.journal.operations.get(snapshotOperationId)?.state).toBe(
      "succeeded",
    )
  })

  it("resumes every possibly quiesced component after quiesce failure", async () => {
    const fixture = snapshotFixture(new Set(["quiesce:keycloak"]))

    const result = await fixture.orchestrator.createSnapshot(request)

    expect(result).toMatchObject({
      failureCode: "quiesce_failed",
      status: "failed",
    })
    expect(fixture.calls).toEqual([
      "quiesce:console_database",
      "quiesce:keycloak",
      "resume:keycloak",
      "resume:console_database",
    ])
  })

  it("cleans up quiescence after capture failure without exposing raw errors", async () => {
    const fixture = snapshotFixture(new Set(["capture:litellm"]))

    const result = await fixture.orchestrator.createSnapshot(request)

    expect(result).toMatchObject({
      failureCode: "capture_failed",
      status: "failed",
    })
    expect(JSON.stringify(result)).not.toContain("private-runtime-address")
    expect(fixture.calls.slice(-4)).toEqual(
      [...components].reverse().map((component) => `resume:${component}`),
    )
  })

  it("marks resume failure as recovery-required", async () => {
    const fixture = snapshotFixture(new Set(["resume:grafana"]))

    const result = await fixture.orchestrator.createSnapshot(request)

    expect(result).toMatchObject({
      failureCode: "resume_failed",
      status: "recovery_required",
    })
    expect(fixture.journal.operations.get(snapshotOperationId)?.state).toBe(
      "recovery_required",
    )
  })

  it("rejects a tampered restore manifest before any adapter or safety call", async () => {
    const fixture = restoreFixture()
    const manifest = sourceManifest()

    const result = await fixture.orchestrator.restore({
      ...request,
      manifest: {
        ...manifest,
        components: manifest.components.map((component) =>
          component.component === "grafana"
            ? { ...component, revision: "tampered" }
            : component,
        ),
      },
    })

    expect(result).toMatchObject({
      failureCode: "manifest_invalid",
      snapshotId: null,
      status: "failed",
    })
    expect(fixture.calls).toEqual([])
    expect(fixture.journal.operations.size).toBe(0)
  })

  it("restores in fixed order with zero emergency sessions before and after", async () => {
    const fixture = restoreFixture()

    const result = await fixture.orchestrator.restore({
      ...request,
      manifest: sourceManifest(),
    })

    expect(result.status).toBe("succeeded")
    expect(fixture.calls).toEqual([
      ...components.map((component) => `prepare_restore:${component}`),
      ...components.map((component) => `quiesce:${component}`),
      "open_emergency_session_fence",
      "reset_emergency_sessions",
      ...components.map((component) => `restore:${component}`),
      "reset_emergency_sessions",
      ...components.map((component) => `validate_restore:${component}`),
      "verify_credential_consistency",
      ...[...components]
        .reverse()
        .map((component) => `discard_restore_preparation:${component}`),
      ...[...components].reverse().map((component) => `resume:${component}`),
      "close_emergency_session_fence",
    ])
    expect(fixture.journal.operations.get(restoreOperationId)?.state).toBe(
      "succeeded",
    )
  })

  it("rolls back every attempted active restore in reverse order", async () => {
    const fixture = restoreFixture(new Set(["restore:litellm"]))

    const result = await fixture.orchestrator.restore({
      ...request,
      manifest: sourceManifest(),
    })

    expect(result).toMatchObject({
      failureCode: "restore_failed",
      status: "rolled_back",
    })
    expect(
      fixture.calls.filter((call) => call.startsWith("rollback_restore:")),
    ).toEqual([
      "rollback_restore:litellm",
      "rollback_restore:keycloak",
      "rollback_restore:console_database",
    ])
    expect(
      fixture.calls.filter((call) => call === "reset_emergency_sessions"),
    ).toHaveLength(2)
  })

  it("discards earlier staged preparations in reverse when a later preparation fails", async () => {
    const fixture = restoreFixture(new Set(["prepare_restore:litellm"]))

    const result = await fixture.orchestrator.restore({
      ...request,
      manifest: sourceManifest(),
    })

    expect(result).toMatchObject({
      failureCode: "restore_failed",
      status: "failed",
    })
    expect(fixture.calls).toEqual([
      "prepare_restore:console_database",
      "prepare_restore:keycloak",
      "prepare_restore:litellm",
      "discard_restore_preparation:keycloak",
      "discard_restore_preparation:console_database",
    ])
  })

  it("rolls back on credential inconsistency and leaves emergency sessions zero", async () => {
    const fixture = restoreFixture(new Set(["credentials:inconsistent"]))

    const result = await fixture.orchestrator.restore({
      ...request,
      manifest: sourceManifest(),
    })

    expect(result).toMatchObject({
      failureCode: "consistency_mismatch",
      status: "rolled_back",
    })
    expect(
      fixture.calls.filter((call) => call.startsWith("rollback_restore:")),
    ).toEqual(
      [...components]
        .reverse()
        .map((component) => `rollback_restore:${component}`),
    )
    expect(
      fixture.calls.filter((call) => call === "reset_emergency_sessions"),
    ).toHaveLength(3)
  })

  it("distinguishes unavailable credential verification from inconsistency", async () => {
    const fixture = restoreFixture(new Set(["credentials:unavailable"]))

    const result = await fixture.orchestrator.restore({
      ...request,
      manifest: sourceManifest(),
    })

    expect(result).toMatchObject({
      failureCode: "verification_failed",
      status: "rolled_back",
    })
  })

  it("rejects a malformed credential verification result", async () => {
    const fixture = restoreFixture(new Set(["credentials:malformed"]))

    const result = await fixture.orchestrator.restore({
      ...request,
      manifest: sourceManifest(),
    })

    expect(result).toMatchObject({
      failureCode: "verification_failed",
      status: "rolled_back",
    })
  })

  it("continues compensation but requires recovery when rollback fails", async () => {
    const fixture = restoreFixture(
      new Set(["restore:litellm", "rollback_restore:keycloak"]),
    )

    const result = await fixture.orchestrator.restore({
      ...request,
      manifest: sourceManifest(),
    })

    expect(result).toMatchObject({
      failureCode: "rollback_failed",
      status: "recovery_required",
    })
    expect(
      fixture.calls.filter((call) => call.startsWith("rollback_restore:")),
    ).toEqual([
      "rollback_restore:litellm",
      "rollback_restore:keycloak",
      "rollback_restore:console_database",
    ])
    expect(fixture.journal.operations.get(restoreOperationId)?.state).toBe(
      "recovery_required",
    )
    expect(fixture.calls.filter((call) => call.startsWith("resume:"))).toEqual(
      [],
    )
    expect(
      fixture.calls.filter((call) => call === "close_emergency_session_fence"),
    ).toEqual([])
  })

  it("compensates an active restore when normal resume fails", async () => {
    const fixture = restoreFixture(new Set(["resume:grafana"]))

    const result = await fixture.orchestrator.restore({
      ...request,
      manifest: sourceManifest(),
    })

    expect(result).toMatchObject({ status: "recovery_required" })
    expect(
      fixture.calls.filter((call) => call.startsWith("rollback_restore:")),
    ).toEqual(
      [...components]
        .reverse()
        .map((component) => `rollback_restore:${component}`),
    )
    expect(
      fixture.calls.filter((call) => call === "quiesce:grafana"),
    ).toHaveLength(2)
  })

  it("re-quiesces resumed components before compensating a failed success journal transition", async () => {
    const journal = new OneShotTransitionFailureJournal(
      (input) => input.nextState === "succeeded",
    )
    const fixture = restoreFixture(new Set(), journal)

    const result = await fixture.orchestrator.restore({
      ...request,
      manifest: sourceManifest(),
    })

    expect(result).toMatchObject({
      failureCode: "journal_failed",
      status: "rolled_back",
    })
    const secondFence = fixture.calls.lastIndexOf(
      "open_emergency_session_fence",
    )
    const firstRollback = fixture.calls.findIndex((call) =>
      call.startsWith("rollback_restore:"),
    )
    expect(secondFence).toBeGreaterThan(
      fixture.calls.indexOf("close_emergency_session_fence"),
    )
    expect(fixture.calls.slice(secondFence + 1, firstRollback)).toEqual([
      "reset_emergency_sessions",
      ...components.map((component) => `quiesce:${component}`),
    ])
  })

  it("does not rollback live state when compensation re-quiescence fails", async () => {
    const fixture = restoreFixture(
      new Set(["resume:grafana", "quiesce:keycloak#2"]),
    )

    const result = await fixture.orchestrator.restore({
      ...request,
      manifest: sourceManifest(),
    })

    expect(result).toMatchObject({ status: "recovery_required" })
    expect(
      fixture.calls.filter((call) => call.startsWith("rollback_restore:")),
    ).toEqual([])
    expect(fixture.calls.filter((call) => call.startsWith("resume:"))).toEqual(
      [...components].reverse().map((component) => `resume:${component}`),
    )
    expect(
      fixture.calls.filter((call) => call === "close_emergency_session_fence"),
    ).toEqual([])
  })

  it("keeps quiescence and the activation fence when rollback admission fails", async () => {
    const journal = new OneShotTransitionFailureJournal(
      (input) => input.nextState === "rolling_back",
    )
    const fixture = restoreFixture(new Set(["resume:grafana"]), journal)

    const result = await fixture.orchestrator.restore({
      ...request,
      manifest: sourceManifest(),
    })

    expect(result).toMatchObject({
      failureCode: "journal_failed",
      status: "recovery_required",
    })
    expect(
      fixture.calls.filter((call) => call.startsWith("rollback_restore:")),
    ).toEqual([])
    expect(
      fixture.calls.filter((call) => call === "close_emergency_session_fence"),
    ).toEqual([])
  })

  it("reopens and clears the session gap when rollback admission fails after normal close", async () => {
    const journal = new MatchingTransitionFailureJournal(
      (input) =>
        input.nextState === "succeeded" || input.nextState === "rolling_back",
    )
    const fixture = restoreFixture(new Set(), journal)

    const result = await fixture.orchestrator.restore({
      ...request,
      manifest: sourceManifest(),
    })

    expect(result).toMatchObject({
      failureCode: "journal_failed",
      status: "recovery_required",
    })
    expect(
      fixture.calls.filter((call) => call === "open_emergency_session_fence"),
    ).toHaveLength(2)
    expect(fixture.calls.slice(-2)).toEqual([
      "open_emergency_session_fence",
      "reset_emergency_sessions",
    ])
    expect(
      fixture.calls.filter((call) => call.startsWith("rollback_restore:")),
    ).toEqual([])
  })

  it("surfaces recovery-state persistence failure as journal_failed", async () => {
    const journal = new OneShotTransitionFailureJournal(
      (input) => input.nextState === "recovery_required",
    )
    const fixture = snapshotFixture(new Set(["resume:grafana"]), journal)

    const result = await fixture.orchestrator.createSnapshot(request)

    expect(result).toMatchObject({
      failureCode: "journal_failed",
      status: "recovery_required",
    })
  })

  it("bounds identifier generation failures without adapter or journal activity", async () => {
    const calls: string[] = []
    const journal = new InMemoryLifecycleOperationJournal()
    const orchestrator = new LifecycleOrchestrator(
      createLifecycleComponentAdapters(driverMap(calls, new Set())),
      journal,
      restoreSafety(calls, new Set()),
      {
        randomId: () => {
          throw new Error("private-runtime-address")
        },
      },
    )

    const snapshot = await orchestrator.createSnapshot(request)
    const restored = await orchestrator.restore({
      ...request,
      manifest: sourceManifest(),
    })

    expect(snapshot).toEqual({
      failureCode: "journal_failed",
      operationId: "00000000-0000-4000-8000-000000000000",
      snapshotId: "00000000-0000-4000-8000-000000000000",
      status: "failed",
    })
    expect(restored).toEqual({
      failureCode: "journal_failed",
      operationId: "00000000-0000-4000-8000-000000000000",
      snapshotId: null,
      status: "failed",
    })
    expect(calls).toEqual([])
    expect(journal.operations.size).toBe(0)
  })
})

function snapshotFixture(
  failures = new Set<string>(),
  journal = new InMemoryLifecycleOperationJournal(),
) {
  const calls: string[] = []
  const orchestrator = new LifecycleOrchestrator(
    createLifecycleComponentAdapters(driverMap(calls, failures)),
    journal,
    restoreSafety(calls, failures),
    fixedOptions([snapshotOperationId, snapshotId]),
  )
  return { calls, journal, orchestrator }
}

function restoreFixture(
  failures = new Set<string>(),
  journal = new InMemoryLifecycleOperationJournal(),
) {
  const calls: string[] = []
  const orchestrator = new LifecycleOrchestrator(
    createLifecycleComponentAdapters(driverMap(calls, failures)),
    journal,
    restoreSafety(calls, failures),
    fixedOptions([restoreOperationId]),
  )
  return { calls, journal, orchestrator }
}

function driverMap(calls: string[], failures: Set<string>) {
  return Object.fromEntries(
    components.map((component) => [
      component,
      driver(component, calls, failures),
    ]),
  ) as Record<LifecycleComponent, LifecycleComponentDriver>
}

function driver(
  component: LifecycleComponent,
  calls: string[],
  failures: Set<string>,
): LifecycleComponentDriver {
  const execute = <T>(method: string, result: T): T => {
    const call = `${method}:${component}`
    calls.push(call)
    const occurrence = calls.filter((candidate) => candidate === call).length
    if (failures.has(call) || failures.has(`${call}#${occurrence}`)) {
      throw new Error("private-runtime-address")
    }
    return result
  }
  return {
    capture: async () => execute("capture", captures[component]),
    prepareRestore: async () =>
      execute("prepare_restore", {
        activeStateMutated: false as const,
        component,
        preparationId: `${component}-preparation`,
        rollbackCapability: "established" as const,
      }),
    discardRestorePreparation: async () =>
      execute("discard_restore_preparation", undefined),
    quiesce: async () => execute("quiesce", undefined),
    restore: async () => execute("restore", undefined),
    resume: async () => execute("resume", undefined),
    rollbackRestore: async () => execute("rollback_restore", undefined),
    validateCapture: async () => execute("validate_capture", undefined),
    validateRestore: async () => execute("validate_restore", undefined),
  }
}

function restoreSafety(
  calls: string[],
  failures: Set<string>,
): LifecycleRestoreSafety {
  return {
    openEmergencySessionActivationFence: async () => {
      calls.push("open_emergency_session_fence")
      if (failures.has("open_emergency_session_fence")) {
        throw new Error("private-runtime-address")
      }
      return {
        closeWithZeroSessions: async () => {
          calls.push("close_emergency_session_fence")
          if (failures.has("close_emergency_session_fence")) {
            throw new Error("private-runtime-address")
          }
        },
      }
    },
    resetEmergencySessions: async (_context: LifecycleAdapterContext) => {
      calls.push("reset_emergency_sessions")
      if (failures.has("reset_emergency_sessions")) {
        throw new Error("private-runtime-address")
      }
    },
    verifyCredentialConsistency: async () => {
      calls.push("verify_credential_consistency")
      if (failures.has("credentials:unavailable")) {
        throw new Error("private-runtime-address")
      }
      if (failures.has("credentials:malformed")) {
        return undefined as never
      }
      return failures.has("credentials:inconsistent")
        ? "inconsistent"
        : "consistent"
    },
  }
}

class OneShotTransitionFailureJournal extends InMemoryLifecycleOperationJournal {
  private failed = false

  constructor(
    private readonly shouldFail: (
      input: TransitionLifecycleOperationInput,
    ) => boolean,
  ) {
    super()
  }

  override async transition(
    input: TransitionLifecycleOperationInput,
  ): Promise<boolean> {
    if (!this.failed && this.shouldFail(input)) {
      this.failed = true
      return false
    }
    return super.transition(input)
  }
}

class MatchingTransitionFailureJournal extends InMemoryLifecycleOperationJournal {
  constructor(
    private readonly shouldFail: (
      input: TransitionLifecycleOperationInput,
    ) => boolean,
  ) {
    super()
  }

  override async transition(
    input: TransitionLifecycleOperationInput,
  ): Promise<boolean> {
    return this.shouldFail(input) ? false : super.transition(input)
  }
}

function fixedOptions(ids: string[]) {
  let index = 0
  return {
    now: () => at,
    randomId: () => {
      const id = ids[index]
      index += 1
      if (!id) {
        throw new Error("Test ID sequence exhausted.")
      }
      return id
    },
  }
}

function sourceManifest() {
  return createLifecycleSnapshotManifest({
    capturedAt: at.toISOString(),
    captures: components.map((component) => captures[component]),
    operationId: sourceOperationId,
    snapshotId: sourceSnapshotId,
  })
}

const request = {
  actorSubjectId: "admin-1",
  correlationId: "correlation-1",
}

const components = [
  "console_database",
  "keycloak",
  "litellm",
  "grafana",
] as const satisfies readonly LifecycleComponent[]

const captures: Record<LifecycleComponent, LifecycleSnapshotComponent> = {
  console_database: {
    artifactSha256: "0".repeat(64),
    component: "console_database",
    ordinal: 0,
    revision: "db-1",
  },
  keycloak: {
    artifactSha256: "1".repeat(64),
    component: "keycloak",
    ordinal: 1,
    revision: "keycloak-1",
  },
  litellm: {
    artifactSha256: "2".repeat(64),
    component: "litellm",
    ordinal: 2,
    revision: "litellm-1",
  },
  grafana: {
    artifactSha256: "3".repeat(64),
    component: "grafana",
    ordinal: 3,
    revision: "grafana-1",
  },
}
