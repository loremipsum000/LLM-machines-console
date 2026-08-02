import { describe, expect, it } from "vitest"
import type { Actor } from "../auth/authorization"
import {
  EmergencyIsolationAtomicCommitError,
  type EmergencyIsolationCommitWithReceipt,
  EmergencyIsolationDeniedError,
  type EmergencyIsolationDisengagementPreparationResult,
  type EmergencyIsolationEnforcement,
  type EmergencyIsolationEnforcementContext,
  type EmergencyIsolationEngagementResult,
  type EmergencyIsolationNonRestorableAuthority,
  EmergencyIsolationRecoveryRequiredError,
  EmergencyIsolationService,
  EmergencyIsolationUnavailableError,
  type EmergencyIsolationVerificationResult,
  InMemoryEmergencyIsolationNonRestorableAuthority,
  InMemoryEmergencyIsolationStore,
  type StoredEmergencyIsolationState,
  createEmergencyIsolationRestoreFenceOpener,
  initialState,
} from "./emergency-isolation"
import { IsolationTrafficGate } from "./isolation-traffic-gate"
import type {
  LifecycleRestoreIsolationRecoveryAuthority,
  LifecycleRestoreOperationStatus,
  LifecycleUnfencedRestoreOperation,
} from "./lifecycle-operation-journal"

const now = new Date("2026-08-02T12:00:00.000Z")
const transitionId = "10000000-0000-4000-8000-000000000001"
const correlationId = "isolation-test"

describe("EmergencyIsolationService", () => {
  it("engages from inactive and retains exact activation provenance", async () => {
    const store = new InMemoryEmergencyIsolationStore()
    const enforcement = new FakeEnforcement()
    const service = fixture(store, enforcement)

    const result = await service.activate(adminActor(), correlationId, {
      confirmation: "ACTIVATE EMERGENCY ISOLATION",
      expectedRevision: 0,
    })

    expect(result).toEqual({
      activatedAt: now.toISOString(),
      activatedBySubjectId: "admin-1",
      effectiveTrafficState: "sealed",
      failureCode: null,
      result: "activated",
      revision: 2,
      runtimeQualified: false,
      state: "active",
      updatedAt: now.toISOString(),
      updatedBySubjectId: "admin-1",
    })
    expect(enforcement.calls).toEqual(["engage", "verify"])
    expect(store.audits.map(({ action }) => action)).toEqual([
      "emergency_isolation.activation.started",
      "emergency_isolation.activated",
    ])
  })

  it("requires recovery to re-engage before any later deactivation", async () => {
    const store = new InMemoryEmergencyIsolationStore(recoveryState())
    const enforcement = new FakeEnforcement()
    const service = fixture(store, enforcement)

    await expect(
      service.deactivate(adminActor(), correlationId, {
        confirmation: "DEACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 3,
      }),
    ).rejects.toBeInstanceOf(EmergencyIsolationRecoveryRequiredError)
    expect(enforcement.calls).toEqual([])

    const activated = await service.activate(adminActor(), correlationId, {
      confirmation: "ACTIVATE EMERGENCY ISOLATION",
      expectedRevision: 3,
    })
    expect(activated.state).toBe("active")
    expect(activated.revision).toBe(5)

    const deactivated = await service.deactivate(adminActor(), correlationId, {
      confirmation: "DEACTIVATE EMERGENCY ISOLATION",
      expectedRevision: 5,
    })
    expect(deactivated).toMatchObject({
      activatedAt: null,
      activatedBySubjectId: null,
      effectiveTrafficState: "open",
      result: "deactivated",
      revision: 7,
      state: "inactive",
    })
  })

  it("accepts exact 300-second Keycloak MFA and denies every weaker authority", async () => {
    const accepted = fixture(
      new InMemoryEmergencyIsolationStore(),
      new FakeEnforcement(),
    )
    await expect(
      accepted.activate(adminActor(), correlationId, {
        confirmation: "ACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 0,
      }),
    ).resolves.toMatchObject({ result: "activated" })

    for (const actor of [
      adminActor({ authTime: unixSeconds(now) - 301 }),
      adminActor({ amr: ["pwd"] }),
      adminActor({ authMode: "service-forwarded" }),
      adminActor({ authTime: unixSeconds(now) + 1 }),
      adminActor({ effectiveRole: "admin", role: "operator" }),
    ]) {
      const service = fixture(
        new InMemoryEmergencyIsolationStore(),
        new FakeEnforcement(),
      )
      await expect(
        service.activate(actor, correlationId, {
          confirmation: "ACTIVATE EMERGENCY ISOLATION",
          expectedRevision: 0,
        }),
      ).rejects.toBeInstanceOf(EmergencyIsolationDeniedError)
    }
  })

  it("atomically terminalizes enforcement uncertainty as failed 503", async () => {
    const store = new InMemoryEmergencyIsolationStore()
    const enforcement = new FakeEnforcement()
    enforcement.engagement = {
      failureCode: "admission_fence_failed",
      status: "failed",
    }
    const service = fixture(store, enforcement)
    const receipts: Array<{ outcome?: string; statusCode?: number }> = []
    const commitWithReceipt: EmergencyIsolationCommitWithReceipt = async (
      input,
    ) => {
      receipts.push({ outcome: input.outcome, statusCode: input.statusCode })
      return await input.run(null)
    }

    await expect(
      service.activate(
        adminActor(),
        correlationId,
        {
          confirmation: "ACTIVATE EMERGENCY ISOLATION",
          expectedRevision: 0,
        },
        commitWithReceipt,
      ),
    ).rejects.toBeInstanceOf(EmergencyIsolationUnavailableError)

    expect(receipts).toEqual([{ outcome: "failed", statusCode: 503 }])
    expect(store.state).toMatchObject({
      failureCode: "admission_fence_failed",
      revision: 2,
      state: "recovery_required",
    })
    expect(store.audits.at(-1)).toMatchObject({
      action: "emergency_isolation.recovery_required",
      outcome: "failed",
    })
  })

  it("rolls back a success receipt on terminal CAS miss before recording failed recovery", async () => {
    const store = new InMemoryEmergencyIsolationStore()
    store.complete = async () => null
    const service = fixture(store, new FakeEnforcement())
    const committed: Array<{ outcome: string; statusCode: number }> = []
    const commitWithReceipt: EmergencyIsolationCommitWithReceipt = async (
      input,
    ) => {
      const value = await input.run(null)
      committed.push({
        outcome: input.outcome ?? "succeeded",
        statusCode: input.statusCode ?? 200,
      })
      return value
    }

    await expect(
      service.activate(
        adminActor(),
        correlationId,
        {
          confirmation: "ACTIVATE EMERGENCY ISOLATION",
          expectedRevision: 0,
        },
        commitWithReceipt,
      ),
    ).rejects.toBeInstanceOf(EmergencyIsolationUnavailableError)

    expect(committed).toEqual([{ outcome: "failed", statusCode: 503 }])
    expect(store.state).toMatchObject({
      failureCode: "journal_failed",
      state: "recovery_required",
    })
  })

  it("signals reconciliation when failed recovery and receipt cannot commit atomically", async () => {
    const store = new InMemoryEmergencyIsolationStore()
    const enforcement = new FakeEnforcement()
    enforcement.engagement = {
      failureCode: "admission_fence_failed",
      status: "failed",
    }
    const service = fixture(store, enforcement)
    const commitWithReceipt: EmergencyIsolationCommitWithReceipt = async (
      input,
    ) => {
      await input.run(null)
      throw new Error("receipt unavailable")
    }

    await expect(
      service.activate(
        adminActor(),
        correlationId,
        {
          confirmation: "ACTIVATE EMERGENCY ISOLATION",
          expectedRevision: 0,
        },
        commitWithReceipt,
      ),
    ).rejects.toBeInstanceOf(EmergencyIsolationAtomicCommitError)
  })

  it("rejects inverted and broadened store transition origins", async () => {
    const store = new InMemoryEmergencyIsolationStore()
    const base = {
      actorSubjectId: "admin-1",
      at: now,
      correlationId,
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
  })

  it("serializes distinct concurrent activation attempts", async () => {
    const store = new InMemoryEmergencyIsolationStore()
    const enforcement = new FakeEnforcement()
    let identifier = 1
    const service = new EmergencyIsolationService(store, enforcement, {
      lifecycleRestoreIsolationRecoveryAuthority:
        new FakeLifecycleRecoveryAuthority(),
      nonRestorableAuthority:
        new InMemoryEmergencyIsolationNonRestorableAuthority(),
      now: () => now,
      randomId: () =>
        `10000000-0000-4000-8000-${String(identifier++).padStart(12, "0")}`,
    })

    const results = await Promise.allSettled([
      service.activate(adminActor(), "concurrent-1", {
        confirmation: "ACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 0,
      }),
      service.activate(adminActor(), "concurrent-2", {
        confirmation: "ACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 0,
      }),
    ])

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    )
    const rejected = results.find(({ status }) => status === "rejected")
    expect(rejected).toMatchObject({ status: "rejected" })
    expect(
      (rejected as PromiseRejectedResult).reason instanceof Error
        ? (rejected as PromiseRejectedResult).reason.name
        : null,
    ).toMatch(/EmergencyIsolation(?:Busy|Conflict)Error/)
    expect(store.state?.state).toBe("active")
  })

  it("fails closed on interrupted boot state and never recreates a missing row", async () => {
    const interrupted = engagingState()
    const store = new InMemoryEmergencyIsolationStore(interrupted)
    const service = fixture(store, new FakeEnforcement())

    await expect(service.bootstrap()).rejects.toBeInstanceOf(
      EmergencyIsolationRecoveryRequiredError,
    )
    expect(store.state).toMatchObject({
      failureCode: "state_invalid",
      state: "recovery_required",
    })

    const missing = new InMemoryEmergencyIsolationStore(null)
    await expect(
      fixture(missing, new FakeEnforcement()).bootstrap(),
    ).rejects.toBeInstanceOf(EmergencyIsolationUnavailableError)
    expect(missing.state).toBeNull()
  })

  it("keeps startup sealed when the non-restorable authority is missing or malformed", async () => {
    for (const authority of [
      null,
      new InMemoryEmergencyIsolationNonRestorableAuthority({
        operationId: transitionId,
        state: "inactive",
      }),
    ]) {
      const store = new InMemoryEmergencyIsolationStore()
      const enforcement = new FakeEnforcement()
      enforcement.trafficState = "open"
      const service = new EmergencyIsolationService(store, enforcement, {
        nonRestorableAuthority: authority,
        now: () => now,
        randomId: () => transitionId,
      })

      await expect(service.bootstrap()).rejects.toBeInstanceOf(
        EmergencyIsolationUnavailableError,
      )
      expect(enforcement.trafficState).toBe("sealed")
      expect(store.state?.state).toBe("inactive")
    }
  })

  it.each(["prepared", "recovery_required"] as const)(
    "terminalizes and reconciles an unfenced %s restore before startup can continue",
    async (state) => {
      const operation = {
        kind: "restore",
        operationId: transitionId,
        state,
      } satisfies LifecycleUnfencedRestoreOperation
      const lifecycle = new FakeLifecycleRecoveryAuthority({
        operation,
        unfenced: operation,
      })
      const store = new InMemoryEmergencyIsolationStore()
      const originalForceRecovery = store.forceRecoveryRequired.bind(store)
      const callsAtConsoleRecovery: string[][] = []
      store.forceRecoveryRequired = async (...args) => {
        callsAtConsoleRecovery.push([...lifecycle.calls])
        return await originalForceRecovery(...args)
      }
      const enforcement = new FakeEnforcement()
      enforcement.trafficState = "open"
      const service = fixture(
        store,
        enforcement,
        new InMemoryEmergencyIsolationNonRestorableAuthority(),
        lifecycle,
      )

      await expect(service.bootstrap()).resolves.toMatchObject({
        effectiveTrafficState: "sealed",
        failureCode: "restore_reassertion_failed",
        state: "recovery_required",
      })
      expect(callsAtConsoleRecovery[0]).toContain(`terminalize:${transitionId}`)
      expect(lifecycle.calls).toEqual([
        "read_unfenced",
        `terminalize:${transitionId}`,
        `reconcile:${transitionId}`,
        "read_unfenced",
      ])
      expect(lifecycle.unfenced).toBeNull()
      expect(enforcement.trafficState).toBe("sealed")
    },
  )

  it("fails closed when lifecycle recovery authority is unavailable", async () => {
    const lifecycle = new FakeLifecycleRecoveryAuthority()
    lifecycle.readUnfencedRestore = async () => {
      throw new Error("lifecycle unavailable")
    }
    const store = new InMemoryEmergencyIsolationStore()
    const enforcement = new FakeEnforcement()
    enforcement.trafficState = "open"
    const service = fixture(
      store,
      enforcement,
      new InMemoryEmergencyIsolationNonRestorableAuthority(),
      lifecycle,
    )

    await expect(service.status()).rejects.toBeInstanceOf(
      EmergencyIsolationUnavailableError,
    )
    await expect(service.durableAdmissionStatus()).rejects.toBeInstanceOf(
      EmergencyIsolationUnavailableError,
    )
    await expect(
      service.activate(adminActor(), correlationId, {
        confirmation: "ACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 0,
      }),
    ).rejects.toBeInstanceOf(EmergencyIsolationUnavailableError)
    expect(enforcement.trafficState).toBe("sealed")
    expect(store.state).toMatchObject({
      failureCode: "journal_failed",
      state: "recovery_required",
    })
    await expect(
      service.deactivate(adminActor(), correlationId, {
        confirmation: "DEACTIVATE EMERGENCY ISOLATION",
        expectedRevision: store.state?.revision ?? -1,
      }),
    ).rejects.toBeInstanceOf(EmergencyIsolationUnavailableError)
  })

  it("seals active traffic when activation cannot read the marker authority", async () => {
    const authority = new InMemoryEmergencyIsolationNonRestorableAuthority({
      operationId: transitionId,
      state: "malformed",
    })
    const store = new InMemoryEmergencyIsolationStore()
    const enforcement = new FakeEnforcement()
    enforcement.trafficState = "open"
    const service = fixture(
      store,
      enforcement,
      authority,
      terminalLifecycleAuthority(transitionId),
    )

    await expect(service.status()).rejects.toBeInstanceOf(
      EmergencyIsolationUnavailableError,
    )
    await expect(
      service.activate(adminActor(), correlationId, {
        confirmation: "ACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 0,
      }),
    ).rejects.toBeInstanceOf(EmergencyIsolationUnavailableError)
    expect(enforcement.calls).toEqual(["engage", "verify"])
    expect(enforcement.trafficState).toBe("sealed")
    expect(store.state).toMatchObject({
      failureCode: "journal_failed",
      state: "recovery_required",
    })
  })

  it("reconciles the exact marker only after restored inactive state becomes recovery", async () => {
    const authority = new InMemoryEmergencyIsolationNonRestorableAuthority({
      operationId: transitionId,
      state: "recovery_required",
    })
    const store = new InMemoryEmergencyIsolationStore()
    const enforcement = new FakeEnforcement()
    const lifecycle = terminalLifecycleAuthority(transitionId)
    const service = fixture(store, enforcement, authority, lifecycle)

    await expect(service.bootstrap()).resolves.toMatchObject({
      effectiveTrafficState: "sealed",
      failureCode: "restore_reassertion_failed",
      state: "recovery_required",
    })
    await expect(service.durableAdmissionStatus()).resolves.toMatchObject({
      effectiveTrafficState: "sealed",
      state: "recovery_required",
    })
    expect(authority.marker).toBeNull()
    expect(lifecycle.calls).not.toContain(`reconcile:${transitionId}`)
  })

  it("reconciles a matching terminal recovery obligation before clearing its surviving marker", async () => {
    const marker = {
      operationId: transitionId,
      state: "recovery_required" as const,
    }
    const operation = {
      kind: "restore",
      operationId: transitionId,
      state: "recovery_required",
    } satisfies LifecycleUnfencedRestoreOperation
    const authority = new InMemoryEmergencyIsolationNonRestorableAuthority(
      marker,
    )
    const lifecycle = new FakeLifecycleRecoveryAuthority({
      operation,
      unfenced: operation,
    })
    const service = fixture(
      new InMemoryEmergencyIsolationStore(),
      new FakeEnforcement(),
      authority,
      lifecycle,
    )

    await expect(service.bootstrap()).resolves.toMatchObject({
      effectiveTrafficState: "sealed",
      failureCode: "restore_reassertion_failed",
      state: "recovery_required",
    })
    expect(authority.marker).toBeNull()
    expect(lifecycle.unfenced).toBeNull()
    expect(lifecycle.calls).toEqual([
      `read:${transitionId}`,
      "read_unfenced",
      `reconcile:${transitionId}`,
      "read_unfenced",
      `read:${transitionId}`,
    ])
    await expect(service.durableAdmissionStatus()).resolves.toMatchObject({
      effectiveTrafficState: "sealed",
      failureCode: "restore_reassertion_failed",
      state: "recovery_required",
    })
  })

  it("retains a terminal marker when another unfenced restore is returned", async () => {
    const marker = {
      operationId: transitionId,
      state: "recovery_required" as const,
    }
    const otherOperationId = "20000000-0000-4000-8000-000000000002"
    const authority = new InMemoryEmergencyIsolationNonRestorableAuthority(
      marker,
    )
    const lifecycle = terminalLifecycleAuthority(transitionId)
    lifecycle.unfenced = {
      kind: "restore",
      operationId: otherOperationId,
      state: "recovery_required",
    } satisfies LifecycleUnfencedRestoreOperation
    const store = new InMemoryEmergencyIsolationStore()
    const enforcement = new FakeEnforcement()

    await expect(
      fixture(store, enforcement, authority, lifecycle).bootstrap(),
    ).rejects.toBeInstanceOf(EmergencyIsolationUnavailableError)
    expect(authority.marker).toEqual(marker)
    expect(store.state).toMatchObject({
      failureCode: "restore_reassertion_failed",
      state: "recovery_required",
    })
  })

  it("retains a terminal marker when unfenced restore ownership is unavailable", async () => {
    const marker = {
      operationId: transitionId,
      state: "recovery_required" as const,
    }
    const authority = new InMemoryEmergencyIsolationNonRestorableAuthority(
      marker,
    )
    const lifecycle = terminalLifecycleAuthority(transitionId)
    lifecycle.readUnfencedRestore = async () => {
      throw new Error("unfenced restore ownership is ambiguous")
    }
    const store = new InMemoryEmergencyIsolationStore()

    await expect(
      fixture(store, new FakeEnforcement(), authority, lifecycle).bootstrap(),
    ).rejects.toBeInstanceOf(EmergencyIsolationUnavailableError)
    expect(authority.marker).toEqual(marker)
    expect(store.state?.state).toBe("recovery_required")
  })

  it.each([
    ["missing", null],
    [
      "nonterminal",
      {
        kind: "restore",
        operationId: transitionId,
        state: "resuming",
      },
    ],
    [
      "invalid",
      {
        kind: "restore",
        operationId: transitionId,
        state: "unknown",
      },
    ],
  ] as const)(
    "retains a surviving marker when its lifecycle owner is %s",
    async (_label, operation) => {
      const marker = {
        operationId: transitionId,
        state: "recovery_required" as const,
      }
      const authority = new InMemoryEmergencyIsolationNonRestorableAuthority(
        marker,
      )
      const lifecycle = new FakeLifecycleRecoveryAuthority({ operation })
      const store = new InMemoryEmergencyIsolationStore()
      const enforcement = new FakeEnforcement()
      enforcement.trafficState = "open"
      const service = fixture(store, enforcement, authority, lifecycle)

      await expect(service.bootstrap()).rejects.toBeInstanceOf(
        EmergencyIsolationUnavailableError,
      )
      expect(authority.marker).toEqual(marker)
      expect(enforcement.trafficState).toBe("sealed")
      expect(store.state).toMatchObject({
        failureCode: "restore_reassertion_failed",
        state: "recovery_required",
      })
    },
  )

  it("retains a surviving marker when its lifecycle owner cannot be read", async () => {
    const marker = {
      operationId: transitionId,
      state: "recovery_required" as const,
    }
    const authority = new InMemoryEmergencyIsolationNonRestorableAuthority(
      marker,
    )
    const lifecycle = new FakeLifecycleRecoveryAuthority()
    lifecycle.readRestoreOperation = async () => {
      throw new Error("lifecycle unavailable")
    }
    const store = new InMemoryEmergencyIsolationStore()
    const enforcement = new FakeEnforcement()
    enforcement.trafficState = "open"

    await expect(
      fixture(store, enforcement, authority, lifecycle).bootstrap(),
    ).rejects.toBeInstanceOf(EmergencyIsolationUnavailableError)
    expect(authority.marker).toEqual(marker)
    expect(enforcement.trafficState).toBe("sealed")
    expect(store.state?.state).toBe("recovery_required")
  })

  it("reasserts and audits recovery_required after restore without failing", async () => {
    const store = new InMemoryEmergencyIsolationStore(recoveryState())
    const service = fixture(store, new FakeEnforcement())

    const status = await service.requireRecoveryAfterRestore("restore-1")

    expect(status).toMatchObject({
      effectiveTrafficState: "sealed",
      failureCode: "restore_reassertion_failed",
      revision: 4,
      state: "recovery_required",
    })
    expect(store.audits.at(-1)).toMatchObject({
      action: "emergency_isolation.recovery_required",
      correlationId: "restore-1",
    })
  })

  it("does not report durable inactive as open while local authority is uncertain", async () => {
    const store = new InMemoryEmergencyIsolationStore()
    const enforcement = new FakeEnforcement()
    enforcement.trafficState = "uncertain"
    const service = fixture(store, enforcement)

    await expect(service.status()).rejects.toBeInstanceOf(
      EmergencyIsolationUnavailableError,
    )
    await expect(
      service.deactivate(adminActor(), correlationId, {
        confirmation: "DEACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 0,
      }),
    ).rejects.toBeInstanceOf(EmergencyIsolationUnavailableError)
    expect(store.state).toMatchObject({
      failureCode: "journal_failed",
      state: "recovery_required",
    })
  })

  it("keeps durable recovery status readable while local traffic is proven sealed", async () => {
    const store = new InMemoryEmergencyIsolationStore(recoveryState())
    const enforcement = new FakeEnforcement()
    enforcement.trafficState = "sealed"

    await expect(fixture(store, enforcement).status()).resolves.toMatchObject({
      effectiveTrafficState: "sealed",
      revision: 3,
      state: "recovery_required",
    })
  })

  it("re-engages and verifies local enforcement before returning already active", async () => {
    const store = new InMemoryEmergencyIsolationStore(activeState())
    const enforcement = new FakeEnforcement()
    enforcement.trafficState = "open"
    const service = fixture(store, enforcement)

    await expect(
      service.activate(adminActor(), correlationId, {
        confirmation: "ACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 2,
      }),
    ).resolves.toMatchObject({ result: "already_active", state: "active" })
    expect(enforcement.calls).toEqual(["engage", "verify"])
    expect(enforcement.trafficState).toBe("sealed")
  })

  it("engages locally and leaves no receipt when begin and recovery persistence fail", async () => {
    const store = new InMemoryEmergencyIsolationStore()
    store.begin = async () => {
      throw new Error("authority unavailable")
    }
    store.forceRecoveryRequired = async () => {
      throw new Error("authority unavailable")
    }
    const enforcement = new FakeEnforcement()
    enforcement.trafficState = "open"
    const service = fixture(store, enforcement)
    const receipts: string[] = []
    const commitWithReceipt: EmergencyIsolationCommitWithReceipt = async (
      input,
    ) => {
      const value = await input.run(null)
      receipts.push(input.outcome ?? "succeeded")
      return value
    }

    await expect(
      service.activate(
        adminActor(),
        correlationId,
        {
          confirmation: "ACTIVATE EMERGENCY ISOLATION",
          expectedRevision: 0,
        },
        commitWithReceipt,
      ),
    ).rejects.toBeInstanceOf(EmergencyIsolationAtomicCommitError)
    expect(enforcement.calls).toContain("engage")
    expect(enforcement.trafficState).toBe("sealed")
    expect(receipts).toEqual([])
  })

  it("keeps deactivation begin failure sealed and atomically unresolved", async () => {
    const store = new InMemoryEmergencyIsolationStore(activeState())
    store.begin = async () => {
      throw new Error("authority unavailable")
    }
    store.forceRecoveryRequired = async () => {
      throw new Error("authority unavailable")
    }
    const enforcement = new FakeEnforcement()
    const service = fixture(store, enforcement)
    const receipts: string[] = []
    const commitWithReceipt: EmergencyIsolationCommitWithReceipt = async (
      input,
    ) => {
      const value = await input.run(null)
      receipts.push(input.outcome ?? "succeeded")
      return value
    }

    await expect(
      service.deactivate(
        adminActor(),
        correlationId,
        {
          confirmation: "DEACTIVATE EMERGENCY ISOLATION",
          expectedRevision: 2,
        },
        commitWithReceipt,
      ),
    ).rejects.toBeInstanceOf(EmergencyIsolationAtomicCommitError)
    expect(enforcement.calls).toEqual(["engage", "verify", "engage", "verify"])
    expect(enforcement.trafficState).toBe("sealed")
    expect(receipts).toEqual([])
  })

  it("ensures admissions cannot invalidate prepared deactivation and opens only after durable inactive commit", async () => {
    const store = new InMemoryEmergencyIsolationStore(activeState())
    const originalComplete = store.complete.bind(store)
    let markCompletionStarted: (() => void) | undefined
    const completionStarted = new Promise<void>((resolve) => {
      markCompletionStarted = resolve
    })
    let resumeCompletion: (() => void) | undefined
    const completionBlocked = new Promise<void>((resolve) => {
      resumeCompletion = resolve
    })
    store.complete = async (input, transaction) => {
      markCompletionStarted?.()
      await completionBlocked
      return await originalComplete(input, transaction)
    }

    const gate = new IsolationTrafficGate({
      async read() {
        return await service.durableStatus()
      },
    })
    const service = serviceWithEnforcement(store, gate)

    const deactivation = service.deactivate(adminActor(), correlationId, {
      confirmation: "DEACTIVATE EMERGENCY ISOLATION",
      expectedRevision: 2,
    })
    await completionStarted

    expect(store.state?.state).toBe("disengaging")
    expect(gate.effectiveTrafficState()).toBe("sealed")
    await expect(
      gate.admit(isolationAdmission("during-prepared-deactivation")),
    ).resolves.toEqual({ ok: false })

    resumeCompletion?.()
    await expect(deactivation).resolves.toMatchObject({
      result: "deactivated",
      state: "inactive",
    })
    expect(gate.effectiveTrafficState()).toBe("open")
    const admitted = await gate.admit(isolationAdmission("after-deactivation"))
    expect(admitted.ok).toBe(true)
    if (admitted.ok) {
      admitted.lease.release()
    }
  })

  it("aborts a committing deactivation reservation and stays sealed on DB failure", async () => {
    const store = new InMemoryEmergencyIsolationStore(activeState())
    store.complete = async (input) => {
      if (!input.beforeCommit?.()) {
        throw new Error("Reservation did not enter committing.")
      }
      throw new Error("DB commit failed")
    }
    const gate = new IsolationTrafficGate({
      async read() {
        return await service.durableStatus()
      },
    })
    const service = serviceWithEnforcement(store, gate)

    await expect(
      service.deactivate(adminActor(), correlationId, {
        confirmation: "DEACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 2,
      }),
    ).rejects.toBeInstanceOf(EmergencyIsolationUnavailableError)

    expect(gate.effectiveTrafficState()).toBe("sealed")
    expect(store.state).toMatchObject({
      failureCode: "journal_failed",
      state: "recovery_required",
    })
    await expect(
      gate.admit(isolationAdmission("after-db-failure")),
    ).resolves.toEqual({ ok: false })
  })

  it("orders engagement started during commit after durable deactivation", async () => {
    const store = new InMemoryEmergencyIsolationStore(activeState())
    const originalComplete = store.complete.bind(store)
    let markCommitting: (() => void) | undefined
    const committing = new Promise<void>((resolve) => {
      markCommitting = resolve
    })
    let resumeCommit: (() => void) | undefined
    const commitBlocked = new Promise<void>((resolve) => {
      resumeCommit = resolve
    })
    store.complete = async (input, transaction) => {
      if (!input.beforeCommit?.()) {
        throw new Error("Reservation did not enter committing.")
      }
      markCommitting?.()
      await commitBlocked
      return await originalComplete(
        { ...input, beforeCommit: undefined },
        transaction,
      )
    }
    const gate = new IsolationTrafficGate({
      async read() {
        return await service.durableStatus()
      },
    })
    const service = serviceWithEnforcement(store, gate)

    const deactivation = service.deactivate(adminActor(), correlationId, {
      confirmation: "DEACTIVATE EMERGENCY ISOLATION",
      expectedRevision: 2,
    })
    await committing
    let engagementFinished = false
    const engagement = gate
      .engage({
        correlationId: "later-engagement",
        transitionId: "20000000-0000-4000-8000-000000000002",
      })
      .then((result) => {
        engagementFinished = true
        return result
      })
    await Promise.resolve()
    expect(engagementFinished).toBe(false)
    expect(store.state?.state).toBe("disengaging")
    expect(gate.effectiveTrafficState()).toBe("sealed")

    resumeCommit?.()
    await expect(deactivation).resolves.toMatchObject({
      result: "deactivated",
      state: "inactive",
    })
    await expect(engagement).resolves.toEqual({ status: "engaged" })
    expect(store.state?.state).toBe("inactive")
    expect(gate.effectiveTrafficState()).toBe("sealed")
  })

  it("never attempts a second receipt after the durable deactivation commit", async () => {
    const store = new InMemoryEmergencyIsolationStore(activeState())
    const enforcement = new FakeEnforcement()
    enforcement.commitError = new Error("Impossible local commit invariant")
    const service = fixture(store, enforcement)
    const receipts: string[] = []
    const commitWithReceipt: EmergencyIsolationCommitWithReceipt = async (
      input,
    ) => {
      const completed = await input.run(null)
      receipts.push(input.outcome ?? "succeeded")
      return completed
    }

    await expect(
      service.deactivate(
        adminActor(),
        correlationId,
        {
          confirmation: "DEACTIVATE EMERGENCY ISOLATION",
          expectedRevision: 2,
        },
        commitWithReceipt,
      ),
    ).rejects.toThrow("Impossible local commit invariant")

    expect(receipts).toEqual(["succeeded"])
    expect(store.state).toMatchObject({ state: "inactive" })
    expect(store.audits.at(-1)?.action).toBe("emergency_isolation.deactivated")
  })

  it("terminalizes impossible same-revision unchanged states as journal uncertainty", async () => {
    const activationStore = new InMemoryEmergencyIsolationStore()
    activationStore.begin = async () => ({
      state: initialState(),
      status: "unchanged",
    })
    const activation = fixture(activationStore, new FakeEnforcement())
    await expect(
      activation.activate(adminActor(), correlationId, {
        confirmation: "ACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 0,
      }),
    ).rejects.toBeInstanceOf(EmergencyIsolationUnavailableError)
    expect(activationStore.state).toMatchObject({
      failureCode: "journal_failed",
      state: "recovery_required",
    })

    const active = activeState()
    const deactivationStore = new InMemoryEmergencyIsolationStore(active)
    deactivationStore.begin = async () => ({
      state: active,
      status: "unchanged",
    })
    const deactivation = fixture(deactivationStore, new FakeEnforcement())
    await expect(
      deactivation.deactivate(adminActor(), correlationId, {
        confirmation: "DEACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 2,
      }),
    ).rejects.toBeInstanceOf(EmergencyIsolationUnavailableError)
    expect(deactivationStore.state).toMatchObject({
      failureCode: "journal_failed",
      state: "recovery_required",
    })
  })

  it("retains the restore hold until both reassertion and explicit close succeed", async () => {
    const store = new InMemoryEmergencyIsolationStore()
    const enforcement = new FakeEnforcement()
    const authority = new InMemoryEmergencyIsolationNonRestorableAuthority()
    const service = fixture(store, enforcement, authority)
    await expect(
      authority.clearRecoveryRequiredAndConfirm(transitionId),
    ).resolves.toBe(false)
    const originalForceRecovery = store.forceRecoveryRequired.bind(store)
    const markerAtConsoleRecovery: unknown[] = []
    store.forceRecoveryRequired = async (...args) => {
      markerAtConsoleRecovery.push(await authority.readRecoveryRequired())
      return await originalForceRecovery(...args)
    }
    let held = 0
    const opener = createEmergencyIsolationRestoreFenceOpener(
      service,
      {
        acquireRestoreHold: () => {
          held += 1
          let released = false
          return {
            release: () => {
              if (!released) {
                released = true
                held -= 1
              }
            },
          }
        },
      },
      authority,
      terminalLifecycleAuthority(transitionId),
    )

    const opening = opener.openEmergencyIsolationRestoreFence({
      operationId: transitionId,
      operationKind: "restore",
    })
    expect(held).toBe(1)
    const fence = await opening
    expect(held).toBe(1)
    await fence.reassertRecoveryRequired()
    expect(held).toBe(1)
    await expect(
      service.activate(adminActor(), correlationId, {
        confirmation: "ACTIVATE EMERGENCY ISOLATION",
        expectedRevision: store.state?.revision ?? -1,
      }),
    ).rejects.toBeInstanceOf(EmergencyIsolationUnavailableError)
    await fence.closeAfterRecoveryRequired()
    await fence.closeAfterRecoveryRequired()
    expect(held).toBe(0)
    expect(authority.marker).toBeNull()
    expect(store.state).toMatchObject({
      failureCode: "restore_reassertion_failed",
      state: "recovery_required",
    })
    expect(markerAtConsoleRecovery).toEqual([
      { operationId: transitionId, state: "recovery_required" },
      { operationId: transitionId, state: "recovery_required" },
      { operationId: transitionId, state: "recovery_required" },
    ])
  })

  it("retains the restore hold when pre-restore durable recovery cannot be read back", async () => {
    const store = new InMemoryEmergencyIsolationStore()
    store.forceRecoveryRequired = async () => null
    const authority = new InMemoryEmergencyIsolationNonRestorableAuthority()
    const service = fixture(store, new FakeEnforcement(), authority)
    let held = 0
    const opener = createEmergencyIsolationRestoreFenceOpener(
      service,
      {
        acquireRestoreHold: () => {
          held += 1
          return {
            release: () => {
              held -= 1
            },
          }
        },
      },
      authority,
      terminalLifecycleAuthority(transitionId),
    )

    const opening = opener.openEmergencyIsolationRestoreFence({
      operationId: transitionId,
      operationKind: "restore",
    })
    expect(held).toBe(1)
    await expect(opening).rejects.toBeInstanceOf(
      EmergencyIsolationUnavailableError,
    )
    expect(held).toBe(1)
    expect(authority.marker).toEqual({
      operationId: transitionId,
      state: "recovery_required",
    })

    const restoredStore = new InMemoryEmergencyIsolationStore()
    const restarted = fixture(
      restoredStore,
      new FakeEnforcement(),
      authority,
      terminalLifecycleAuthority(transitionId),
    )
    await expect(restarted.bootstrap()).resolves.toMatchObject({
      state: "recovery_required",
    })
    expect(restoredStore.state?.state).toBe("recovery_required")
    expect(authority.marker).toBeNull()
  })

  it("persists Console recovery before rejecting a non-restorable marker acquisition failure", async () => {
    const authority = new InMemoryEmergencyIsolationNonRestorableAuthority()
    authority.persistRecoveryRequired = async () => false
    const store = new InMemoryEmergencyIsolationStore()
    const service = fixture(store, new FakeEnforcement(), authority)
    let held = 0
    const opener = createEmergencyIsolationRestoreFenceOpener(
      service,
      {
        acquireRestoreHold: () => {
          held += 1
          return {
            release: () => {
              held -= 1
            },
          }
        },
      },
      authority,
      terminalLifecycleAuthority(transitionId),
    )

    await expect(
      opener.openEmergencyIsolationRestoreFence({
        operationId: transitionId,
        operationKind: "restore",
      }),
    ).rejects.toBeInstanceOf(EmergencyIsolationUnavailableError)
    expect(held).toBe(1)
    expect(authority.marker).toBeNull()
    expect(store.state).toMatchObject({
      failureCode: "restore_reassertion_failed",
      state: "recovery_required",
    })

    await expect(
      fixture(store, new FakeEnforcement(), authority).bootstrap(),
    ).resolves.toMatchObject({
      effectiveTrafficState: "sealed",
      state: "recovery_required",
    })
  })

  it("does not let a stale restore fence clear a newer marker", async () => {
    const authority = new InMemoryEmergencyIsolationNonRestorableAuthority()
    const service = fixture(
      new InMemoryEmergencyIsolationStore(),
      new FakeEnforcement(),
      authority,
      terminalLifecycleAuthority(transitionId),
    )
    let held = 0
    const opener = createEmergencyIsolationRestoreFenceOpener(
      service,
      {
        acquireRestoreHold: () => {
          held += 1
          return {
            release: () => {
              held -= 1
            },
          }
        },
      },
      authority,
      terminalLifecycleAuthority(transitionId),
    )
    const fence = await opener.openEmergencyIsolationRestoreFence({
      operationId: transitionId,
      operationKind: "restore",
    })
    await fence.reassertRecoveryRequired()
    const newerOperationId = "20000000-0000-4000-8000-000000000002"
    authority.marker = {
      operationId: newerOperationId,
      state: "recovery_required",
    }

    await expect(fence.closeAfterRecoveryRequired()).rejects.toBeInstanceOf(
      EmergencyIsolationUnavailableError,
    )
    expect(held).toBe(1)
    expect(authority.marker).toEqual({
      operationId: newerOperationId,
      state: "recovery_required",
    })
  })

  it("retains the restore hold and marker while the matching lifecycle operation is nonterminal", async () => {
    const authority = new InMemoryEmergencyIsolationNonRestorableAuthority()
    const lifecycle = new FakeLifecycleRecoveryAuthority({
      operation: {
        kind: "restore",
        operationId: transitionId,
        state: "resuming",
      } satisfies LifecycleRestoreOperationStatus,
    })
    const service = fixture(
      new InMemoryEmergencyIsolationStore(),
      new FakeEnforcement(),
      authority,
      lifecycle,
    )
    let held = 0
    const opener = createEmergencyIsolationRestoreFenceOpener(
      service,
      {
        acquireRestoreHold: () => {
          held += 1
          return {
            release: () => {
              held -= 1
            },
          }
        },
      },
      authority,
      lifecycle,
    )
    const fence = await opener.openEmergencyIsolationRestoreFence({
      operationId: transitionId,
      operationKind: "restore",
    })
    await fence.reassertRecoveryRequired()

    await expect(fence.closeAfterRecoveryRequired()).rejects.toBeInstanceOf(
      EmergencyIsolationUnavailableError,
    )
    expect(held).toBe(1)
    expect(authority.marker).toEqual({
      operationId: transitionId,
      state: "recovery_required",
    })
  })
})

class FakeEnforcement implements EmergencyIsolationEnforcement {
  calls: string[] = []
  commitError: Error | null = null
  engagement: EmergencyIsolationEngagementResult = { status: "engaged" }
  preparationFailure: Extract<
    EmergencyIsolationDisengagementPreparationResult,
    { status: "failed" }
  > | null = null
  verification: EmergencyIsolationVerificationResult = { status: "verified" }
  trafficState: "open" | "sealed" | "uncertain" = "sealed"

  effectiveTrafficState(): "open" | "sealed" | "uncertain" {
    return this.trafficState
  }

  async engage(
    _context: EmergencyIsolationEnforcementContext,
  ): Promise<EmergencyIsolationEngagementResult> {
    this.calls.push("engage")
    if (this.engagement.status === "engaged") {
      this.trafficState = "sealed"
    }
    return this.engagement
  }

  async prepareDisengage(
    _context: EmergencyIsolationEnforcementContext,
  ): Promise<EmergencyIsolationDisengagementPreparationResult> {
    this.calls.push("prepare_disengage")
    if (this.preparationFailure) {
      return this.preparationFailure
    }
    let phase: "aborted" | "committed" | "committing" | "reserved" = "reserved"
    return {
      deactivationCommitReservation: {
        abort: () => {
          if (phase === "committed") {
            return
          }
          phase = "aborted"
          this.trafficState = "sealed"
        },
        commit: () => {
          this.calls.push("commit_deactivation")
          if (phase !== "committing") {
            throw new Error("Deactivation was not ready to commit.")
          }
          if (this.commitError) {
            throw this.commitError
          }
          phase = "committed"
          this.trafficState = "open"
        },
        enterCommitting: () => {
          this.calls.push("enter_deactivation_commit")
          if (phase !== "reserved") {
            return false
          }
          phase = "committing"
          return true
        },
      },
      status: "prepared",
    }
  }

  async verifyEngaged(
    _context: EmergencyIsolationEnforcementContext,
  ): Promise<EmergencyIsolationVerificationResult> {
    this.calls.push("verify")
    return this.verification
  }
}

class FakeLifecycleRecoveryAuthority
  implements LifecycleRestoreIsolationRecoveryAuthority
{
  calls: string[] = []
  operation: unknown
  unfenced: unknown

  constructor(input: { operation?: unknown; unfenced?: unknown } = {}) {
    this.operation = input.operation ?? null
    this.unfenced = input.unfenced ?? null
  }

  async readRestoreOperation(
    operationId: string,
  ): Promise<LifecycleRestoreOperationStatus | null> {
    this.calls.push(`read:${operationId}`)
    return this.operation as LifecycleRestoreOperationStatus | null
  }

  async readUnfencedRestore(): Promise<LifecycleUnfencedRestoreOperation | null> {
    this.calls.push("read_unfenced")
    return this.unfenced as LifecycleUnfencedRestoreOperation | null
  }

  async recordIsolationReconciled(
    operationId: string,
    _at: Date,
  ): Promise<boolean> {
    this.calls.push(`reconcile:${operationId}`)
    const operation = this.operation as LifecycleRestoreOperationStatus | null
    if (
      !operation ||
      operation.operationId !== operationId ||
      operation.state !== "recovery_required"
    ) {
      return false
    }
    this.unfenced = null
    return true
  }

  async terminalizeUnfencedRestore(
    operationId: string,
    _at: Date,
  ): Promise<boolean> {
    this.calls.push(`terminalize:${operationId}`)
    const unfenced = this.unfenced as LifecycleUnfencedRestoreOperation | null
    if (!unfenced || unfenced.operationId !== operationId) {
      return false
    }
    this.operation = {
      kind: "restore",
      operationId,
      state: "recovery_required",
    } satisfies LifecycleRestoreOperationStatus
    this.unfenced = this.operation
    return true
  }
}

function terminalLifecycleAuthority(
  operationId: string,
): FakeLifecycleRecoveryAuthority {
  return new FakeLifecycleRecoveryAuthority({
    operation: {
      kind: "restore",
      operationId,
      state: "succeeded",
    } satisfies LifecycleRestoreOperationStatus,
  })
}

function fixture(
  store: InMemoryEmergencyIsolationStore,
  enforcement: FakeEnforcement,
  nonRestorableAuthority: EmergencyIsolationNonRestorableAuthority = new InMemoryEmergencyIsolationNonRestorableAuthority(),
  lifecycleRestoreIsolationRecoveryAuthority: LifecycleRestoreIsolationRecoveryAuthority = new FakeLifecycleRecoveryAuthority(),
): EmergencyIsolationService {
  return new EmergencyIsolationService(store, enforcement, {
    lifecycleRestoreIsolationRecoveryAuthority,
    nonRestorableAuthority,
    now: () => now,
    randomId: () => transitionId,
  })
}

function serviceWithEnforcement(
  store: InMemoryEmergencyIsolationStore,
  enforcement: EmergencyIsolationEnforcement,
): EmergencyIsolationService {
  return new EmergencyIsolationService(store, enforcement, {
    lifecycleRestoreIsolationRecoveryAuthority:
      new FakeLifecycleRecoveryAuthority(),
    nonRestorableAuthority:
      new InMemoryEmergencyIsolationNonRestorableAuthority(),
    now: () => now,
    randomId: () => transitionId,
  })
}

function isolationAdmission(correlationIdValue: string) {
  return {
    appId: "app-1",
    correlationId: correlationIdValue,
    credentialRecordId: "credential-1",
    route: "chat_completions" as const,
  }
}

function adminActor(overrides: Partial<Actor> = {}): Actor {
  return {
    acr: "urn:llm-machines:mfa",
    amr: ["pwd", "otp"],
    authMode: "keycloak",
    authTime: unixSeconds(now) - 300,
    role: "admin",
    subject: "admin-1",
    ...overrides,
  }
}

function recoveryState(): StoredEmergencyIsolationState {
  return {
    ...initialState(),
    changedBySubjectId: "admin-1",
    failureCode: "state_invalid",
    revision: 3,
    state: "recovery_required",
    updatedAt: now,
  }
}

function engagingState(): StoredEmergencyIsolationState {
  return {
    ...initialState(),
    changedBySubjectId: "admin-1",
    correlationId,
    revision: 1,
    state: "engaging",
    transitionId,
    transitionStartedAt: now,
    updatedAt: now,
  }
}

function activeState(): StoredEmergencyIsolationState {
  return {
    ...initialState(),
    activatedAt: now,
    activatedBySubjectId: "admin-1",
    changedBySubjectId: "admin-1",
    revision: 2,
    state: "active",
    updatedAt: now,
  }
}

function unixSeconds(value: Date): number {
  return Math.floor(value.getTime() / 1000)
}
