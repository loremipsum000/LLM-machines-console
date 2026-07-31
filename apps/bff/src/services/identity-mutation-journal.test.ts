import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  IDENTITY_MUTATION_JOURNAL_STORAGE,
  type IdentityMutationIntentInput,
  type IdentityMutationJournalRecord,
  type IdentityMutationJournalStore,
  IdentityMutationReconciliationRequiredError,
  type IdentityMutationState,
  type IdentityMutationTargetInput,
  type IdentityMutationTargetRecord,
  beginIdentityMutation,
  createDrizzleIdentityMutationJournalStore,
  executeJournaledIdentityMutation,
  finalizeIdentityMutation,
  recordIdentityMutationKeycloakApplied,
  recordIdentityMutationOutcomeUnknown,
  recordIdentityMutationRejected,
  resetIdentityMutationJournalForTest,
} from "./identity-mutation-journal"

describe("identity mutation journal", () => {
  beforeEach(() => {
    resetIdentityMutationJournalForTest()
  })

  it("has no production fallback when the database is unavailable", () => {
    expect(createDrizzleIdentityMutationJournalStore(null)).toBeNull()
  })

  it("defines the durable table and one-to-one idempotency link", () => {
    expect(IDENTITY_MUTATION_JOURNAL_STORAGE).toMatchObject({
      columns: {
        idempotencyLedgerId: "idempotency_ledger_id",
        reconciliationReason: "reconciliation_reason",
        state: "state",
      },
      table: "admin.identity_mutation_journal",
    })
  })

  it("never reserves an existing ambiguous mutation for re-execution", async () => {
    const store = new MemoryJournalStore()
    const first = await beginIdentityMutation(store, intentInput(), {
      now: instant(0),
      randomId: () => "journal-1",
    })
    const retry = await beginIdentityMutation(store, intentInput(), {
      now: instant(1),
      randomId: () => "journal-2",
    })

    expect(first).toMatchObject({
      intent: { id: "journal-1", state: "prepared" },
      status: "reserved",
    })
    expect(retry).toMatchObject({
      intent: { id: "journal-1" },
      status: "reconciliation_required",
    })
    expect(store.records).toHaveLength(1)
  })

  it("keeps one global unresolved slot across store recreation", async () => {
    const records: IdentityMutationJournalRecord[] = []
    const firstStore = new MemoryJournalStore(records)
    const first = await beginIdentityMutation(
      firstStore,
      intentInput({ idempotencyLedgerId: "ledger-first" }),
      { now: instant(0), randomId: () => "journal-first" },
    )
    if (first.status !== "reserved") {
      throw new Error("test reservation failed")
    }

    const restartedStore = new MemoryJournalStore(records)
    await expect(
      beginIdentityMutation(
        restartedStore,
        intentInput({ idempotencyLedgerId: "ledger-after-restart" }),
      ),
    ).resolves.toMatchObject({
      intent: { id: "journal-first" },
      status: "blocked_by_active_reconciliation",
    })

    await recordIdentityMutationRejected(restartedStore, first.intent)
    await expect(
      beginIdentityMutation(
        restartedStore,
        intentInput({ idempotencyLedgerId: "ledger-after-terminal" }),
        { randomId: () => "journal-next" },
      ),
    ).resolves.toMatchObject({
      intent: { id: "journal-next" },
      status: "reserved",
    })
  })

  it("preserves the PR-04 fingerprint conflict and finalized replay boundaries", async () => {
    const store = new MemoryJournalStore()
    const reservation = await reserve(store)
    const conflict = await beginIdentityMutation(store, {
      ...intentInput(),
      requestFingerprint: "b".repeat(64),
    })

    expect(conflict.status).toBe("conflict")

    await recordIdentityMutationRejected(store, reservation.intent, {
      now: instant(1),
    })
    const finalized = await beginIdentityMutation(store, intentInput())
    expect(finalized).toMatchObject({ status: "already_finalized" })
  })

  it("completes only after Keycloak applied and finalization succeeds", async () => {
    const store = new MemoryJournalStore()
    const reservation = await reserve(store)
    const applied = await recordIdentityMutationKeycloakApplied(
      store,
      reservation.intent,
      { now: instant(1), resourceId: "keycloak-user-1" },
    )
    const finalize = vi.fn(async () => "response")

    await expect(
      finalizeIdentityMutation(store, applied, finalize, {
        now: () => instant(2),
      }),
    ).resolves.toBe("response")
    expect(finalize).toHaveBeenCalledTimes(1)
    expect(store.records[0]).toMatchObject({
      completedAt: instant(2),
      resourceId: "keycloak-user-1",
      state: "completed",
    })
  })

  it("marks reconciliation required when audit or receipt finalization fails", async () => {
    const store = new MemoryJournalStore()
    const reservation = await reserve(store)
    const applied = await recordIdentityMutationKeycloakApplied(
      store,
      reservation.intent,
      { now: instant(1) },
    )

    await expect(
      finalizeIdentityMutation(
        store,
        applied,
        async () => {
          throw new Error("bounded-finalization-failure")
        },
        { now: () => instant(2) },
      ),
    ).rejects.toMatchObject({
      journalId: "journal-1",
      status: "reconciliation_required",
    })
    expect(store.records[0]).toMatchObject({
      reconciliationReason: "finalization_failed",
      reconciliationRequiredAt: instant(2),
      state: "reconciliation_required",
    })
    await expect(
      beginIdentityMutation(store, intentInput()),
    ).resolves.toMatchObject({ status: "reconciliation_required" })
  })

  it("fails closed when applied-state or completion persistence fails", async () => {
    const appliedStore = new MemoryJournalStore()
    const appliedReservation = await reserve(appliedStore)
    appliedStore.returnNullFor = "keycloak_applied"

    await expect(
      recordIdentityMutationKeycloakApplied(
        appliedStore,
        appliedReservation.intent,
        { now: instant(3), resourceId: "keycloak-user-known" },
      ),
    ).rejects.toBeInstanceOf(IdentityMutationReconciliationRequiredError)
    expect(appliedStore.records[0]).toMatchObject({
      keycloakAppliedAt: instant(3),
      reconciliationReason: "keycloak_applied_persistence_failed",
      resourceId: "keycloak-user-known",
      state: "reconciliation_required",
    })

    const completionStore = new MemoryJournalStore()
    const completionReservation = await reserve(completionStore)
    const applied = await recordIdentityMutationKeycloakApplied(
      completionStore,
      completionReservation.intent,
    )
    completionStore.returnNullFor = "completed"
    await expect(
      finalizeIdentityMutation(completionStore, applied, async () => true),
    ).rejects.toBeInstanceOf(IdentityMutationReconciliationRequiredError)
    expect(completionStore.records[0]).toMatchObject({
      reconciliationReason: "completion_persistence_failed",
      state: "reconciliation_required",
    })
  })

  it("retains a fail-closed phase marker even when reconciliation storage is unavailable", async () => {
    const store = new MemoryJournalStore()
    const reservation = await reserve(store)
    const applied = await recordIdentityMutationKeycloakApplied(
      store,
      reservation.intent,
    )
    store.returnNullFor = "completed"
    store.throwFor = "reconciliation_required"

    await expect(
      finalizeIdentityMutation(store, applied, async () => true),
    ).rejects.toBeInstanceOf(IdentityMutationReconciliationRequiredError)
    expect(store.records[0]?.state).toBe("keycloak_applied")
    await expect(
      beginIdentityMutation(store, intentInput()),
    ).resolves.toMatchObject({ status: "reconciliation_required" })
  })

  it("records an unknown Keycloak outcome as reconciliation required", async () => {
    const store = new MemoryJournalStore()
    const reservation = await reserve(store)

    await expect(
      recordIdentityMutationOutcomeUnknown(store, reservation.intent, {
        now: instant(1),
      }),
    ).rejects.toMatchObject({ status: "reconciliation_required" })
    expect(store.records[0]).toMatchObject({
      reconciliationReason: "keycloak_outcome_unknown",
      state: "reconciliation_required",
    })
  })

  it("records a confirmed first-write rejection without claiming applied state", async () => {
    const store = new MemoryJournalStore()
    const finalizeReceipt = vi.fn(async () => undefined)
    const rejection = Object.assign(new Error("confirmed rejection"), {
      mutationOutcome: "rejected" as const,
    })

    await expect(
      executeJournaledIdentityMutation({
        apply: async (_preflight, keycloak) => {
          await keycloak.firstWrite(async () => {
            throw rejection
          }, "user-1")
          return "unreachable"
        },
        context: executionContext("rejected", store, finalizeReceipt),
        finalize: async () => undefined,
        keycloakSubjectId: "admin-1",
        preflight: async () => true,
        targetIdentifier: "user-1",
        targetType: "user",
      }),
    ).rejects.toBe(rejection)
    expect(finalizeReceipt).not.toHaveBeenCalled()
    expect(store.records[0]).toMatchObject({ state: "failed" })
  })

  it("marks transport failure and post-write failure for reconciliation", async () => {
    const transportStore = new MemoryJournalStore()
    await expect(
      executeJournaledIdentityMutation({
        apply: async (_preflight, keycloak) => {
          await keycloak.firstWrite(async () => {
            throw new Error("transport failure")
          }, "user-1")
          return "unreachable"
        },
        context: executionContext("transport", transportStore),
        finalize: async () => undefined,
        keycloakSubjectId: "admin-1",
        preflight: async () => true,
        targetIdentifier: "user-1",
        targetType: "user",
      }),
    ).rejects.toMatchObject({ status: "reconciliation_required" })
    expect(transportStore.records[0]).toMatchObject({
      reconciliationReason: "keycloak_outcome_unknown",
      state: "reconciliation_required",
    })

    const partialStore = new MemoryJournalStore()
    await expect(
      executeJournaledIdentityMutation({
        apply: async (_preflight, keycloak) => {
          await keycloak.firstWrite(
            async () => "user-1",
            (id) => id,
          )
          await keycloak.writeAfterFirst(async () => {
            throw Object.assign(new Error("later rejection"), {
              mutationOutcome: "rejected" as const,
            })
          })
          return "unreachable"
        },
        context: executionContext("partial", partialStore),
        finalize: async () => undefined,
        keycloakSubjectId: "admin-1",
        preflight: async () => true,
        targetIdentifier: "user-1",
        targetType: "user",
      }),
    ).rejects.toMatchObject({ status: "reconciliation_required" })
    expect(partialStore.records[0]).toMatchObject({
      resourceId: "user-1",
      state: "reconciliation_required",
    })
  })

  it("serializes preflight through finalization before the next identity mutation", async () => {
    const store = new MemoryJournalStore()
    let enabledOperators = 2
    const operation = (id: string) =>
      executeJournaledIdentityMutation({
        apply: async (_preflight, keycloak) => {
          await keycloak.firstWrite(async () => {
            enabledOperators -= 1
          }, id)
          return id
        },
        context: executionContext(id, store),
        finalize: async () => undefined,
        keycloakSubjectId: "admin-1",
        preflight: async () => {
          if (enabledOperators <= 1) {
            throw new Error("last enabled operator")
          }
          return true
        },
        targetIdentifier: id,
        targetType: "user" as const,
      })

    const results = await Promise.allSettled([
      operation("operator-1"),
      operation("operator-2"),
    ])

    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ])
    expect(enabledOperators).toBe(1)
    expect(store.records.map((record) => record.state)).toEqual([
      "completed",
      "failed",
    ])
  })

  it("reserves before preflight and records a rejected preflight as failed", async () => {
    const store = new MemoryJournalStore()
    const preflightError = new Error("bounded-preflight-rejection")

    await expect(
      executeJournaledIdentityMutation({
        apply: async () => "unreachable",
        context: executionContext("preflight-rejected", store),
        finalize: async () => undefined,
        keycloakSubjectId: "admin-1",
        preflight: async () => {
          throw preflightError
        },
        targetIdentifier: "normalized@example.test",
        targetType: "user",
      }),
    ).rejects.toBe(preflightError)
    expect(store.records[0]).toMatchObject({
      state: "failed",
      targetIdentifier: "normalized@example.test",
    })
  })

  it("completes only after every durable child target is applied", async () => {
    const store = new MemoryJournalStore()
    const targets = [
      groupMembershipTarget("group-1", "member-1"),
      groupMembershipTarget("group-1", "member-2"),
    ]

    await expect(
      executeJournaledIdentityMutation({
        apply: async (_preflight, keycloak, childTargets) => {
          for (const [ordinal, target] of targets.entries()) {
            await childTargets.start(ordinal)
            if (ordinal === 0) {
              await keycloak.firstWrite(
                async () => target.targetIdentifier,
                "group-1",
              )
            } else {
              await keycloak.writeAfterFirst(
                async () => target.targetIdentifier,
              )
            }
            await childTargets.applied(ordinal)
          }
          return "assigned"
        },
        context: executionContext("children-applied", store),
        finalize: async () => undefined,
        keycloakSubjectId: "admin-1",
        preflight: async () => true,
        targetIdentifier: "group-1",
        targets: () => targets,
        targetType: "group",
      }),
    ).resolves.toBe("assigned")
    expect(store.records[0]?.state).toBe("completed")
    expect(store.targetRecords).toMatchObject([
      {
        intent: {
          groupId: "group-1",
          kind: "group_membership",
          memberId: "member-1",
        },
        state: "applied",
      },
      {
        intent: {
          groupId: "group-1",
          kind: "group_membership",
          memberId: "member-2",
        },
        state: "applied",
      },
    ])
  })

  it("retains applied, failed, and unattempted child outcomes after a partial batch", async () => {
    const store = new MemoryJournalStore()
    const targets = [
      groupMembershipTarget("group-1", "member-1"),
      groupMembershipTarget("group-1", "member-2"),
      groupMembershipTarget("group-1", "member-3"),
    ]
    const rejected = Object.assign(new Error("confirmed-later-rejection"), {
      mutationOutcome: "rejected" as const,
    })

    await expect(
      executeJournaledIdentityMutation({
        apply: async (_preflight, keycloak, childTargets) => {
          await childTargets.start(0)
          await keycloak.firstWrite(async () => undefined, "group-1")
          await childTargets.applied(0)

          await childTargets.start(1)
          try {
            await keycloak.writeAfterFirst(async () => {
              throw rejected
            })
          } catch (error) {
            await childTargets.settleFailure(1, error)
            throw error
          }
          return "unreachable"
        },
        context: executionContext("children-partial", store),
        finalize: async () => undefined,
        keycloakSubjectId: "admin-1",
        preflight: async () => true,
        targetIdentifier: "group-1",
        targets: () => targets,
        targetType: "group",
      }),
    ).rejects.toMatchObject({ status: "reconciliation_required" })
    expect(store.records[0]?.state).toBe("reconciliation_required")
    expect(store.targetRecords.map((target) => target.state)).toEqual([
      "applied",
      "failed",
      "unattempted",
    ])
  })

  it("atomically refuses parent completion when a child is no longer applied", async () => {
    const store = new MemoryJournalStore()
    const targets = [
      groupMembershipTarget("group-1", "member-1"),
      groupMembershipTarget("group-1", "member-2"),
    ]

    await expect(
      executeJournaledIdentityMutation({
        apply: async (_preflight, keycloak, childTargets) => {
          for (const ordinal of [0, 1]) {
            await childTargets.start(ordinal)
            if (ordinal === 0) {
              await keycloak.firstWrite(async () => undefined, "group-1")
            } else {
              await keycloak.writeAfterFirst(async () => undefined)
            }
            await childTargets.applied(ordinal)
          }
          return "assigned"
        },
        context: executionContext("children-cas", store),
        finalize: async () => {
          const child = store.targetRecords[1]
          if (child) {
            store.targetRecords[1] = {
              ...child,
              completedAt: null,
              state: "unknown",
            }
          }
        },
        keycloakSubjectId: "admin-1",
        preflight: async () => true,
        targetIdentifier: "group-1",
        targets: () => targets,
        targetType: "group",
      }),
    ).rejects.toMatchObject({ status: "reconciliation_required" })
    expect(store.records[0]?.state).toBe("reconciliation_required")
  })

  it("records a deadline before the first write as terminal failed", async () => {
    const store = new MemoryJournalStore()
    const write = vi.fn(async () => "user-1")

    await expect(
      executeJournaledIdentityMutation({
        apply: async (_preflight, keycloak) => {
          await wait(25)
          return keycloak.firstWrite(write, (id) => id)
        },
        context: executionContext("deadline-before-write", store, undefined, {
          deadlineMs: 5,
        }),
        finalize: async () => undefined,
        keycloakSubjectId: "admin-1",
        preflight: async () => true,
        targetIdentifier: "user-1",
        targetType: "user",
      }),
    ).rejects.toMatchObject({ status: "unavailable" })
    expect(write).not.toHaveBeenCalled()
    expect(store.records[0]?.state).toBe("failed")
  })

  it("keeps the queue held until a late successful write settles and preserves its evidence", async () => {
    const firstStore = new MemoryJournalStore()
    const secondStore = new MemoryJournalStore()
    const writeStarted = deferred<void>()
    const releaseWrite = deferred<void>()
    const events: string[] = []

    const first = executeJournaledIdentityMutation({
      apply: async (_preflight, keycloak) =>
        keycloak.firstWrite(
          async () => {
            events.push("first-write-started")
            writeStarted.resolve()
            await releaseWrite.promise
            events.push("first-write-settled")
            return "known-user-id"
          },
          (id) => id,
        ),
      context: executionContext(
        "deadline-during-write",
        firstStore,
        undefined,
        {
          deadlineMs: 5,
        },
      ),
      finalize: async () => undefined,
      keycloakSubjectId: "admin-1",
      preflight: async () => true,
      targetIdentifier: "known@example.test",
      targetType: "user",
    })
    await writeStarted.promise

    const second = executeJournaledIdentityMutation({
      apply: async (_preflight, keycloak) =>
        keycloak.firstWrite(async () => "user-2", "user-2"),
      context: executionContext("after-late-write", secondStore, undefined, {
        queueAcquireTimeoutMs: 200,
      }),
      finalize: async () => undefined,
      keycloakSubjectId: "admin-1",
      preflight: async () => {
        events.push("second-preflight")
        return true
      },
      targetIdentifier: "user-2",
      targetType: "user",
    })

    await wait(15)
    expect(events).toEqual(["first-write-started"])
    releaseWrite.resolve()
    await expect(first).rejects.toMatchObject({
      status: "reconciliation_required",
    })
    await expect(second).resolves.toBe("user-2")
    expect(events).toEqual([
      "first-write-started",
      "first-write-settled",
      "second-preflight",
    ])
    expect(firstStore.records[0]).toMatchObject({
      resourceId: "known-user-id",
      state: "reconciliation_required",
    })
    expect(firstStore.records[0]?.keycloakAppliedAt).toBeInstanceOf(Date)
  })

  it("removes a timed-out FIFO waiter before releasing the next mutation", async () => {
    const firstStore = new MemoryJournalStore()
    const secondStore = new MemoryJournalStore()
    const thirdStore = new MemoryJournalStore()
    const firstStarted = deferred<void>()
    const releaseFirst = deferred<void>()
    const secondPreflight = vi.fn(async () => true)
    const thirdPreflight = vi.fn(async () => true)

    const first = executeJournaledIdentityMutation({
      apply: async (_preflight, keycloak) =>
        keycloak.firstWrite(async () => {
          firstStarted.resolve()
          await releaseFirst.promise
          return "user-1"
        }, "user-1"),
      context: executionContext("queue-first", firstStore),
      finalize: async () => undefined,
      keycloakSubjectId: "admin-1",
      preflight: async () => true,
      targetIdentifier: "user-1",
      targetType: "user",
    })
    await firstStarted.promise

    const second = executeJournaledIdentityMutation({
      apply: async (_preflight, keycloak) =>
        keycloak.firstWrite(async () => "user-2", "user-2"),
      context: executionContext("queue-second", secondStore, undefined, {
        queueAcquireTimeoutMs: 5,
      }),
      finalize: async () => undefined,
      keycloakSubjectId: "admin-1",
      preflight: secondPreflight,
      targetIdentifier: "user-2",
      targetType: "user",
    })
    const third = executeJournaledIdentityMutation({
      apply: async (_preflight, keycloak) =>
        keycloak.firstWrite(async () => "user-3", "user-3"),
      context: executionContext("queue-third", thirdStore, undefined, {
        queueAcquireTimeoutMs: 200,
      }),
      finalize: async () => undefined,
      keycloakSubjectId: "admin-1",
      preflight: thirdPreflight,
      targetIdentifier: "user-3",
      targetType: "user",
    })

    await expect(second).rejects.toMatchObject({ status: "unavailable" })
    expect(secondPreflight).not.toHaveBeenCalled()
    releaseFirst.resolve()
    await expect(first).resolves.toBe("user-1")
    await expect(third).resolves.toBe("user-3")
    expect(thirdPreflight).toHaveBeenCalledTimes(1)
  })
})

class MemoryJournalStore implements IdentityMutationJournalStore {
  constructor(
    readonly records: IdentityMutationJournalRecord[] = [],
    readonly targetRecords: IdentityMutationTargetRecord[] = [],
  ) {}
  returnNullFor: IdentityMutationState | null = null
  throwFor: IdentityMutationState | null = null

  async insertPrepared(
    input: Parameters<IdentityMutationJournalStore["insertPrepared"]>[0],
  ): Promise<IdentityMutationJournalRecord | null> {
    if (
      this.records.some(
        (record) => record.idempotencyLedgerId === input.idempotencyLedgerId,
      ) ||
      (await this.findActive())
    ) {
      return null
    }
    const record: IdentityMutationJournalRecord = {
      ...input,
      completedAt: null,
      createdAt: input.now,
      keycloakAppliedAt: null,
      reconciliationReason: null,
      reconciliationRequiredAt: null,
      resourceId: null,
      state: "prepared",
      updatedAt: input.now,
    }
    this.records.push(record)
    return record
  }

  async findByIdempotencyLedgerId(
    idempotencyLedgerId: string,
  ): Promise<IdentityMutationJournalRecord | null> {
    return (
      this.records.find(
        (record) => record.idempotencyLedgerId === idempotencyLedgerId,
      ) ?? null
    )
  }

  async findActive(): Promise<IdentityMutationJournalRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.state === "prepared" ||
          record.state === "keycloak_applied" ||
          record.state === "reconciliation_required",
      ) ?? null
    )
  }

  async insertTargets(
    inputs: Parameters<IdentityMutationJournalStore["insertTargets"]>[0],
  ): Promise<IdentityMutationTargetRecord[]> {
    const records = inputs.map((input) => ({
      completedAt: null,
      createdAt: input.now,
      id: input.id,
      intent: input.intent,
      journalId: input.journalId,
      ordinal: input.ordinal,
      resourceId: null,
      startedAt: null,
      state: "unattempted" as const,
      targetIdentifier: input.targetIdentifier,
      targetType: input.targetType,
      updatedAt: input.now,
    }))
    this.targetRecords.push(...records)
    return records
  }

  async transitionTarget(
    input: Parameters<IdentityMutationJournalStore["transitionTarget"]>[0],
  ): Promise<IdentityMutationTargetRecord | null> {
    const index = this.targetRecords.findIndex(
      (record) =>
        record.id === input.id && input.expectedStates.includes(record.state),
    )
    const current = this.targetRecords[index]
    if (index < 0 || !current) {
      return null
    }
    const updated = {
      ...current,
      state: input.nextState,
      updatedAt: input.now,
    }
    assignTargetWhenPresent(updated, input, "completedAt")
    assignTargetWhenPresent(updated, input, "resourceId")
    assignTargetWhenPresent(updated, input, "startedAt")
    this.targetRecords[index] = updated
    return updated
  }

  async transition(
    input: Parameters<IdentityMutationJournalStore["transition"]>[0],
  ): Promise<IdentityMutationJournalRecord | null> {
    if (this.throwFor === input.nextState) {
      throw new Error("store unavailable")
    }
    if (this.returnNullFor === input.nextState) {
      this.returnNullFor = null
      return null
    }
    const index = this.records.findIndex(
      (record) =>
        record.id === input.id && input.expectedStates.includes(record.state),
    )
    if (index < 0) {
      return null
    }
    const current = this.records[index]
    if (!current) {
      return null
    }
    if (input.requiredAppliedTargetCount !== undefined) {
      const targets = this.targetRecords.filter(
        (record) => record.journalId === input.id,
      )
      if (
        targets.length !== input.requiredAppliedTargetCount ||
        targets.some((record) => record.state !== "applied")
      ) {
        return null
      }
    }
    const next: IdentityMutationJournalRecord = {
      ...current,
      state: input.nextState,
      updatedAt: input.now,
    }
    assignWhenPresent(next, input, "completedAt")
    assignWhenPresent(next, input, "keycloakAppliedAt")
    assignWhenPresent(next, input, "reconciliationReason")
    assignWhenPresent(next, input, "reconciliationRequiredAt")
    assignWhenPresent(next, input, "resourceId")
    this.records[index] = next
    return next
  }
}

function assignWhenPresent<
  Key extends
    | "completedAt"
    | "keycloakAppliedAt"
    | "reconciliationReason"
    | "reconciliationRequiredAt"
    | "resourceId",
>(
  target: IdentityMutationJournalRecord,
  source: Parameters<IdentityMutationJournalStore["transition"]>[0],
  key: Key,
): void {
  if (Object.hasOwn(source, key)) {
    target[key] = source[key] as IdentityMutationJournalRecord[Key]
  }
}

function assignTargetWhenPresent<
  Key extends "completedAt" | "resourceId" | "startedAt",
>(
  target: IdentityMutationTargetRecord,
  source: Parameters<IdentityMutationJournalStore["transitionTarget"]>[0],
  key: Key,
): void {
  if (Object.hasOwn(source, key)) {
    target[key] = source[key] as IdentityMutationTargetRecord[Key]
  }
}

async function reserve(store: MemoryJournalStore) {
  const result = await beginIdentityMutation(store, intentInput(), {
    now: instant(0),
    randomId: () => "journal-1",
  })
  if (result.status !== "reserved") {
    throw new Error("test reservation failed")
  }
  return result
}

function intentInput(
  overrides: Partial<IdentityMutationIntentInput> = {},
): IdentityMutationIntentInput {
  return {
    idempotencyLedgerId: "00000000-0000-4000-8000-000000000001",
    keycloakSubjectId: "admin-1",
    operationCode: "POST /api/admin/team/members",
    requestFingerprint: "a".repeat(64),
    targetIdentifier: "operator.one",
    targetType: "user" as const,
    ...overrides,
  }
}

function executionContext(
  id: string,
  store: IdentityMutationJournalStore,
  finalizeReceipt: (input: {
    resourceId: string | null
  }) => Promise<void> = async () => undefined,
  runtime: { deadlineMs?: number; queueAcquireTimeoutMs?: number } = {},
) {
  return {
    finalizeReceipt,
    idempotencyLedgerId: `ledger-${id}`,
    operationCode: `test:${id}`,
    requestFingerprint: "a".repeat(64),
    runtime: {
      ...runtime,
      store,
    },
  }
}

function groupMembershipTarget(
  groupId: string,
  memberId: string,
): IdentityMutationTargetInput {
  return {
    intent: { groupId, kind: "group_membership", memberId },
    targetIdentifier: `${groupId}:${memberId}`,
    targetType: "group_membership",
  }
}

function instant(offset: number): Date {
  return new Date(Date.UTC(2026, 6, 31, 10, offset, 0))
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}
