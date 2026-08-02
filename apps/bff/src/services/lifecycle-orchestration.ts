import { randomUUID } from "node:crypto"
import type {
  LifecycleComponent,
  LifecycleFailureCode,
  LifecycleOperationState,
  LifecycleSnapshotComponent,
  LifecycleSnapshotManifest,
} from "@llm-machines/contracts"
import type {
  LifecycleAdapterContext,
  LifecycleComponentAdapter,
  LifecycleComponentAdapters,
  LifecyclePreparedRestore,
} from "./lifecycle-component-adapters"
import type {
  LifecycleOperationJournal,
  LifecycleOperationPhase,
  LifecyclePhaseOutcome,
} from "./lifecycle-operation-journal"
import {
  createLifecycleSnapshotManifest,
  verifyLifecycleSnapshotManifestDigest,
} from "./lifecycle-snapshot-manifest"

const unallocatedId = "00000000-0000-4000-8000-000000000000"
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface LifecycleOperationRequest {
  actorSubjectId: string
  correlationId: string
}

export interface LifecycleRestoreRequest extends LifecycleOperationRequest {
  manifest: unknown
}

export interface LifecycleEmergencySessionActivationFence {
  /** A failure must leave the fence held so recovery remains fail-closed. */
  closeWithZeroSessions(): Promise<void>
}

export interface LifecycleEmergencyIsolationRestoreFence {
  /**
   * Reasserts and reads back recovery_required after component restore. The
   * fence remains held when this call fails.
   */
  reassertRecoveryRequired(): Promise<void>
  /**
   * Releases the process hold only after Console recovery readback, then
   * compare-clears the operation marker. Durable isolation stays sealed.
   */
  closeAfterRecoveryRequired(): Promise<void>
}

export interface LifecycleRestoreSafety {
  /**
   * Seals T2 traffic and persists then reads back recovery_required through a
   * non-restorable authority before active restore. Acquisition must fail
   * closed and must not rely only on the database being restored.
   */
  openEmergencyIsolationRestoreFence(
    context: LifecycleAdapterContext,
  ): Promise<LifecycleEmergencyIsolationRestoreFence>
  /** Resolves with one held fence or rejects without acquiring a fence. */
  openEmergencySessionActivationFence(
    context: LifecycleAdapterContext,
  ): Promise<LifecycleEmergencySessionActivationFence>
  resetEmergencySessions(context: LifecycleAdapterContext): Promise<void>
  verifyCredentialConsistency(
    manifest: LifecycleSnapshotManifest,
    context: LifecycleAdapterContext,
  ): Promise<"consistent" | "inconsistent">
}

export interface LifecycleOrchestrationOptions {
  now?: () => Date
  randomId?: () => string
}

export type LifecycleSnapshotResult =
  | {
      manifest: LifecycleSnapshotManifest
      operationId: string
      snapshotId: string
      status: "succeeded"
    }
  | {
      operationId: string
      snapshotId: string
      status: "busy"
    }
  | {
      failureCode: LifecycleFailureCode
      operationId: string
      snapshotId: string
      status: "failed" | "recovery_required"
    }

export type LifecycleRestoreResult =
  | {
      operationId: string
      snapshotId: string
      status: "succeeded"
    }
  | {
      operationId: string
      snapshotId: string | null
      status: "busy"
    }
  | {
      failureCode: LifecycleFailureCode
      operationId: string
      snapshotId: string | null
      status: "failed" | "recovery_required" | "rolled_back"
    }

class LifecycleJournalFailure extends Error {
  constructor() {
    super("Lifecycle journal operation failed.")
    this.name = "LifecycleJournalFailure"
  }
}

class LifecycleStepFailure extends Error {
  constructor(readonly failureCode: LifecycleFailureCode) {
    super(`Lifecycle step failed: ${failureCode}.`)
    this.name = "LifecycleStepFailure"
  }
}

interface CleanupResult {
  actionFailed: boolean
  journalFailed: boolean
}

interface FenceOpenResult extends CleanupResult {
  fence: LifecycleEmergencySessionActivationFence | null
}

interface RestoreSettlementInput {
  applied: LifecycleComponentAdapter[]
  context: LifecycleAdapterContext
  discarded: Set<LifecycleComponent>
  error: unknown
  fence: LifecycleEmergencySessionActivationFence | null
  fenceCloseUncertain: boolean
  isolationFence: LifecycleEmergencyIsolationRestoreFence | null
  isolationFenceAcquisitionAttempted: boolean
  operationId: string
  preparations: Map<LifecycleComponent, LifecyclePreparedRestore>
  quiesced: LifecycleComponentAdapter[]
  resumed: LifecycleComponentAdapter[]
  snapshotId: string
  state: LifecycleOperationState
}

/**
 * Coordinates deterministic consistency points. Live cross-service atomicity
 * is deliberately not claimed by this source-only foundation.
 */
export class LifecycleOrchestrator {
  private readonly now: () => Date
  private readonly randomId: () => string

  constructor(
    private readonly adapters: LifecycleComponentAdapters,
    private readonly journal: LifecycleOperationJournal,
    private readonly restoreSafety: LifecycleRestoreSafety,
    options: LifecycleOrchestrationOptions = {},
  ) {
    assertExactAdapterOrder(adapters)
    this.now = options.now ?? (() => new Date())
    this.randomId = options.randomId ?? randomUUID
  }

  async createSnapshot(
    request: LifecycleOperationRequest,
  ): Promise<LifecycleSnapshotResult> {
    const identifiers = this.allocateIdentifiers(2)
    if (!identifiers) {
      return failedSnapshot(
        unallocatedId,
        unallocatedId,
        "failed",
        "journal_failed",
      )
    }
    const [operationId, snapshotId] = identifiers
    const context: LifecycleAdapterContext = {
      operationId,
      operationKind: "snapshot",
    }
    let state: LifecycleOperationState = "prepared"
    const quiesced: LifecycleComponentAdapter[] = []

    let admission: "busy" | "created"
    try {
      admission = await this.journal.begin({
        actorSubjectId: request.actorSubjectId,
        at: this.now(),
        correlationId: request.correlationId,
        kind: "snapshot",
        operationId,
        snapshotId,
      })
    } catch {
      return failedSnapshot(operationId, snapshotId, "failed", "journal_failed")
    }
    if (admission === "busy") {
      return { operationId, snapshotId, status: "busy" }
    }

    try {
      await this.transition(operationId, state, "quiescing")
      state = "quiescing"
      for (const adapter of this.adapters) {
        await this.runPhase(
          context,
          state,
          "quiesce",
          adapter.component,
          "quiesce_failed",
          () => adapter.quiesce(context),
          () => addUnique(quiesced, adapter),
        )
      }

      const capturedAt = this.now()
      await this.transition(operationId, state, "capturing")
      state = "capturing"
      const captures: LifecycleSnapshotComponent[] = []
      for (const adapter of this.adapters) {
        await this.runPhase(
          context,
          state,
          "capture",
          adapter.component,
          "capture_failed",
          () => adapter.capture(context),
          undefined,
          (capture) => captures.push(capture),
        )
      }

      await this.transition(operationId, state, "validating")
      state = "validating"
      for (const [index, adapter] of this.adapters.entries()) {
        const capture = captures[index]
        if (!capture) {
          throw new LifecycleStepFailure("consistency_mismatch")
        }
        await this.runPhase(
          context,
          state,
          "validate",
          adapter.component,
          "consistency_mismatch",
          () => adapter.validateCapture(capture, context),
        )
      }

      let manifest: LifecycleSnapshotManifest
      try {
        manifest = createLifecycleSnapshotManifest({
          capturedAt: capturedAt.toISOString(),
          captures,
          operationId,
          snapshotId,
        })
      } catch {
        throw new LifecycleStepFailure("manifest_invalid")
      }
      if (!(await this.safeSaveManifest(manifest))) {
        throw new LifecycleJournalFailure()
      }

      await this.transition(operationId, state, "resuming")
      state = "resuming"
      const resumed = await this.resumeComponents(context, state, quiesced)
      if (resumed.actionFailed || resumed.journalFailed) {
        return this.finishSnapshotRecoveryRequired(
          operationId,
          snapshotId,
          state,
          resumed.journalFailed ? "journal_failed" : "resume_failed",
        )
      }

      await this.transition(operationId, state, "succeeded")
      return { manifest, operationId, snapshotId, status: "succeeded" }
    } catch (error) {
      return this.settleSnapshotFailure({
        context,
        error,
        operationId,
        quiesced,
        snapshotId,
        state,
      })
    }
  }

  async restore(
    request: LifecycleRestoreRequest,
  ): Promise<LifecycleRestoreResult> {
    const identifiers = this.allocateIdentifiers(1)
    if (!identifiers) {
      return failedRestore(unallocatedId, null, "failed", "journal_failed")
    }
    const [operationId] = identifiers
    if (!verifyLifecycleSnapshotManifestDigest(request.manifest)) {
      return {
        failureCode: "manifest_invalid",
        operationId,
        snapshotId: null,
        status: "failed",
      }
    }
    const manifest = request.manifest
    const snapshotId = manifest.snapshotId
    const context: LifecycleAdapterContext = {
      operationId,
      operationKind: "restore",
    }
    let state: LifecycleOperationState = "prepared"
    const preparations = new Map<LifecycleComponent, LifecyclePreparedRestore>()
    const discarded = new Set<LifecycleComponent>()
    const quiesced: LifecycleComponentAdapter[] = []
    const resumed: LifecycleComponentAdapter[] = []
    const applied: LifecycleComponentAdapter[] = []
    let isolationFence: LifecycleEmergencyIsolationRestoreFence | null = null
    let isolationFenceAcquisitionAttempted = false
    let fence: LifecycleEmergencySessionActivationFence | null = null
    let fenceCloseUncertain = false

    let admission: "busy" | "created"
    try {
      admission = await this.journal.begin({
        actorSubjectId: request.actorSubjectId,
        at: this.now(),
        correlationId: request.correlationId,
        kind: "restore",
        operationId,
        snapshotId,
      })
    } catch {
      return failedRestore(operationId, snapshotId, "failed", "journal_failed")
    }
    if (admission === "busy") {
      return { operationId, snapshotId, status: "busy" }
    }

    try {
      isolationFenceAcquisitionAttempted = true
      await this.openIsolationFenceImmediatelyAfterAdmission(
        context,
        state,
        (openedFence) => {
          isolationFence = openedFence
        },
      )

      await this.transition(operationId, state, "validating")
      state = "validating"
      for (const [index, adapter] of this.adapters.entries()) {
        const capture = manifest.components[index]
        if (!capture || capture.component !== adapter.component) {
          throw new LifecycleStepFailure("manifest_invalid")
        }
        await this.runPhase(
          context,
          state,
          "validate",
          adapter.component,
          "restore_failed",
          () => adapter.prepareRestore(capture, context),
          undefined,
          (preparation) => preparations.set(adapter.component, preparation),
        )
      }

      await this.transition(operationId, state, "quiescing")
      state = "quiescing"
      for (const adapter of this.adapters) {
        await this.runPhase(
          context,
          state,
          "quiesce",
          adapter.component,
          "quiesce_failed",
          () => adapter.quiesce(context),
          () => addUnique(quiesced, adapter),
        )
      }

      await this.runPhase(
        context,
        state,
        "emergency_session_fence",
        undefined,
        "restore_failed",
        () => this.openActivationFence(context),
        undefined,
        (openedFence) => {
          fence = openedFence
        },
      )
      await this.runPhase(
        context,
        state,
        "emergency_session_reset",
        undefined,
        "restore_failed",
        () => this.restoreSafety.resetEmergencySessions(context),
      )

      await this.transition(operationId, state, "restoring")
      state = "restoring"
      for (const adapter of this.adapters) {
        const preparation = preparations.get(adapter.component)
        if (!preparation) {
          throw new LifecycleStepFailure("restore_failed")
        }
        await this.runPhase(
          context,
          state,
          "restore",
          adapter.component,
          "restore_failed",
          () => adapter.restore(preparation, context),
          () => addUnique(applied, adapter),
        )
      }
      await this.runPhase(
        context,
        state,
        "emergency_session_reset",
        undefined,
        "restore_failed",
        () => this.restoreSafety.resetEmergencySessions(context),
      )

      await this.transition(operationId, state, "verifying")
      state = "verifying"
      for (const [index, adapter] of this.adapters.entries()) {
        const capture = manifest.components[index]
        if (!capture) {
          throw new LifecycleStepFailure("verification_failed")
        }
        await this.runPhase(
          context,
          state,
          "verify",
          adapter.component,
          "verification_failed",
          () => adapter.validateRestore(capture, context),
        )
      }
      await this.runPhase(
        context,
        state,
        "credential_consistency",
        undefined,
        "consistency_mismatch",
        async () => {
          let result: unknown
          try {
            result = await this.restoreSafety.verifyCredentialConsistency(
              manifest,
              context,
            )
          } catch {
            throw new LifecycleStepFailure("verification_failed")
          }
          if (result === "inconsistent") {
            throw new LifecycleStepFailure("consistency_mismatch")
          }
          if (result !== "consistent") {
            throw new LifecycleStepFailure("verification_failed")
          }
        },
      )

      const heldIsolationFence = requireIsolationRestoreFence(isolationFence)
      await this.runPhase(
        context,
        state,
        "emergency_isolation_reassertion",
        undefined,
        "restore_failed",
        () => heldIsolationFence.reassertRecoveryRequired(),
      )

      const discardedPreparations = await this.discardPreparations(
        context,
        state,
        preparations,
        discarded,
      )
      if (discardedPreparations.journalFailed) {
        throw new LifecycleJournalFailure()
      }
      if (discardedPreparations.actionFailed) {
        throw new LifecycleStepFailure("restore_failed")
      }

      await this.transition(operationId, state, "resuming")
      state = "resuming"
      const resumedComponents = await this.resumeComponents(
        context,
        state,
        quiesced,
        resumed,
      )
      if (resumedComponents.journalFailed) {
        throw new LifecycleJournalFailure()
      }
      if (resumedComponents.actionFailed) {
        throw new LifecycleStepFailure("resume_failed")
      }

      const heldFence = requireActivationFence(fence)
      fenceCloseUncertain = true
      await this.runPhase(
        context,
        state,
        "emergency_session_fence",
        undefined,
        "restore_failed",
        () => heldFence.closeWithZeroSessions(),
        undefined,
        () => {
          fence = null
          fenceCloseUncertain = false
        },
      )

      await this.transition(operationId, state, "succeeded")
      try {
        await heldIsolationFence.closeAfterRecoveryRequired()
        isolationFence = null
      } catch {
        // The succeeded lifecycle record is terminal, but durable
        // recovery_required remains authoritative and the local hold stays held.
        return failedRestore(
          operationId,
          snapshotId,
          "recovery_required",
          "restore_failed",
        )
      }
      return { operationId, snapshotId, status: "succeeded" }
    } catch (error) {
      return this.settleRestoreFailure({
        applied,
        context,
        discarded,
        error,
        fence,
        fenceCloseUncertain,
        isolationFence,
        isolationFenceAcquisitionAttempted,
        operationId,
        preparations,
        quiesced,
        resumed,
        snapshotId,
        state,
      })
    }
  }

  private allocateIdentifiers(count: number): string[] | null {
    try {
      const identifiers = Array.from({ length: count }, () => this.randomId())
      return identifiers.every((identifier) => uuidPattern.test(identifier))
        ? identifiers
        : null
    } catch {
      return null
    }
  }

  private async openActivationFence(
    context: LifecycleAdapterContext,
  ): Promise<LifecycleEmergencySessionActivationFence> {
    const fence =
      await this.restoreSafety.openEmergencySessionActivationFence(context)
    if (!fence || typeof fence.closeWithZeroSessions !== "function") {
      throw new Error("Invalid emergency-session activation fence.")
    }
    return fence
  }

  private async openIsolationRestoreFence(
    context: LifecycleAdapterContext,
  ): Promise<LifecycleEmergencyIsolationRestoreFence> {
    const fence =
      await this.restoreSafety.openEmergencyIsolationRestoreFence(context)
    if (
      !fence ||
      typeof fence.reassertRecoveryRequired !== "function" ||
      typeof fence.closeAfterRecoveryRequired !== "function"
    ) {
      throw new Error("Invalid emergency-isolation restore fence.")
    }
    return fence
  }

  private async openIsolationFenceImmediatelyAfterAdmission(
    context: LifecycleAdapterContext,
    state: LifecycleOperationState,
    onOpened: (fence: LifecycleEmergencyIsolationRestoreFence) => void,
  ): Promise<void> {
    const opening = this.openIsolationRestoreFence(context).then(
      (fence) => ({ fence, succeeded: true as const }),
      () => ({ succeeded: false as const }),
    )
    let journalFailed = false
    try {
      await this.requirePhase({
        at: this.now(),
        operationId: context.operationId,
        operationState: state,
        outcome: "started",
        phase: "emergency_isolation_fence",
      })
    } catch {
      journalFailed = true
    }

    const result = await opening
    if (result.succeeded) {
      onOpened(result.fence)
    }
    try {
      await this.requirePhase({
        at: this.now(),
        failureCode: result.succeeded ? undefined : "restore_failed",
        operationId: context.operationId,
        operationState: state,
        outcome: result.succeeded ? "succeeded" : "failed",
        phase: "emergency_isolation_fence",
      })
    } catch {
      journalFailed = true
    }
    if (journalFailed) {
      throw new LifecycleJournalFailure()
    }
    if (!result.succeeded) {
      throw new LifecycleStepFailure("restore_failed")
    }
  }

  private async transition(
    operationId: string,
    expectedState: LifecycleOperationState,
    nextState: LifecycleOperationState,
    failureCode?: LifecycleFailureCode,
  ): Promise<void> {
    try {
      const transitioned = await this.journal.transition({
        at: this.now(),
        expectedState,
        failureCode,
        nextState,
        operationId,
      })
      if (!transitioned) {
        throw new LifecycleJournalFailure()
      }
    } catch (error) {
      if (error instanceof LifecycleJournalFailure) {
        throw error
      }
      throw new LifecycleJournalFailure()
    }
  }

  private async runPhase<T>(
    context: LifecycleAdapterContext,
    operationState: LifecycleOperationState,
    phase: LifecycleOperationPhase,
    component: LifecycleComponent | undefined,
    failureCode: LifecycleFailureCode,
    run: () => Promise<T>,
    onAttempted?: () => void,
    onSucceeded?: (result: T) => void,
  ): Promise<T> {
    await this.requirePhase({
      at: this.now(),
      component,
      operationId: context.operationId,
      operationState,
      outcome: "started",
      phase,
    })
    try {
      onAttempted?.()
      const result = await run()
      onSucceeded?.(result)
      await this.requirePhase({
        at: this.now(),
        component,
        operationId: context.operationId,
        operationState,
        outcome: "succeeded",
        phase,
      })
      return result
    } catch (error) {
      if (error instanceof LifecycleJournalFailure) {
        throw error
      }
      const boundedFailureCode =
        error instanceof LifecycleStepFailure ? error.failureCode : failureCode
      await this.requirePhase({
        at: this.now(),
        component,
        failureCode: boundedFailureCode,
        operationId: context.operationId,
        operationState,
        outcome: "failed",
        phase,
      })
      if (error instanceof LifecycleStepFailure) {
        throw error
      }
      throw new LifecycleStepFailure(boundedFailureCode)
    }
  }

  private async requirePhase(input: {
    at: Date
    component?: LifecycleComponent
    failureCode?: LifecycleFailureCode
    operationId: string
    operationState: LifecycleOperationState
    outcome: LifecyclePhaseOutcome
    phase: LifecycleOperationPhase
  }): Promise<void> {
    try {
      if (!(await this.journal.recordPhase(input))) {
        throw new LifecycleJournalFailure()
      }
    } catch (error) {
      if (error instanceof LifecycleJournalFailure) {
        throw error
      }
      throw new LifecycleJournalFailure()
    }
  }

  private async safeSaveManifest(
    manifest: LifecycleSnapshotManifest,
  ): Promise<boolean> {
    try {
      return await this.journal.saveManifest(manifest)
    } catch {
      return false
    }
  }

  private async resumeComponents(
    context: LifecycleAdapterContext,
    state: LifecycleOperationState,
    quiesced: LifecycleComponentAdapter[],
    resumed?: LifecycleComponentAdapter[],
  ): Promise<CleanupResult> {
    let actionFailed = false
    let journalFailed = false
    for (const adapter of [...quiesced].reverse()) {
      const result = await this.bestEffortPhase(
        context,
        state,
        "resume",
        adapter.component,
        "resume_failed",
        () => adapter.resume(context),
        () => {
          if (resumed) {
            addUnique(resumed, adapter)
          }
        },
      )
      actionFailed ||= result.actionFailed
      journalFailed ||= result.journalFailed
      if (!result.actionFailed) {
        removeItem(quiesced, adapter)
      }
    }
    return { actionFailed, journalFailed }
  }

  private async reQuiesceResumedComponents(
    context: LifecycleAdapterContext,
    resumed: LifecycleComponentAdapter[],
    quiesced: LifecycleComponentAdapter[],
  ): Promise<CleanupResult> {
    let actionFailed = false
    let journalFailed = false
    const resumedSet = new Set(resumed)
    for (const adapter of this.adapters) {
      if (!resumedSet.has(adapter)) {
        continue
      }
      const result = await this.bestEffortPhase(
        context,
        "rolling_back",
        "quiesce",
        adapter.component,
        "quiesce_failed",
        () => adapter.quiesce(context),
        () => addUnique(quiesced, adapter),
      )
      actionFailed ||= result.actionFailed
      journalFailed ||= result.journalFailed
      removeItem(resumed, adapter)
    }
    return { actionFailed, journalFailed }
  }

  private async rollbackComponents(
    context: LifecycleAdapterContext,
    applied: LifecycleComponentAdapter[],
    preparations: Map<LifecycleComponent, LifecyclePreparedRestore>,
  ): Promise<CleanupResult> {
    let actionFailed = false
    let journalFailed = false
    for (const adapter of [...applied].reverse()) {
      const preparation = preparations.get(adapter.component)
      if (!preparation) {
        actionFailed = true
        continue
      }
      const result = await this.bestEffortPhase(
        context,
        "rolling_back",
        "rollback",
        adapter.component,
        "rollback_failed",
        () => adapter.rollbackRestore(preparation, context),
      )
      actionFailed ||= result.actionFailed
      journalFailed ||= result.journalFailed
    }
    return { actionFailed, journalFailed }
  }

  private async discardPreparations(
    context: LifecycleAdapterContext,
    state: LifecycleOperationState,
    preparations: Map<LifecycleComponent, LifecyclePreparedRestore>,
    discarded: Set<LifecycleComponent>,
  ): Promise<CleanupResult> {
    let actionFailed = false
    let journalFailed = false
    for (const adapter of [...this.adapters].reverse()) {
      const preparation = preparations.get(adapter.component)
      if (!preparation || discarded.has(adapter.component)) {
        continue
      }
      const result = await this.bestEffortPhase(
        context,
        state,
        "discard_preparation",
        adapter.component,
        "restore_failed",
        () => adapter.discardRestorePreparation(preparation, context),
      )
      actionFailed ||= result.actionFailed
      journalFailed ||= result.journalFailed
      if (!result.actionFailed) {
        discarded.add(adapter.component)
      }
    }
    return { actionFailed, journalFailed }
  }

  private async bestEffortPhase(
    context: LifecycleAdapterContext,
    operationState: LifecycleOperationState,
    phase: LifecycleOperationPhase,
    component: LifecycleComponent | undefined,
    failureCode: LifecycleFailureCode,
    run: () => Promise<void>,
    onAttempted?: () => void,
  ): Promise<CleanupResult> {
    let actionFailed = false
    let journalFailed = false
    try {
      await this.requirePhase({
        at: this.now(),
        component,
        operationId: context.operationId,
        operationState,
        outcome: "started",
        phase,
      })
    } catch {
      journalFailed = true
    }
    try {
      onAttempted?.()
      await run()
    } catch {
      actionFailed = true
    }
    try {
      await this.requirePhase({
        at: this.now(),
        component,
        failureCode: actionFailed ? failureCode : undefined,
        operationId: context.operationId,
        operationState,
        outcome: actionFailed ? "failed" : "succeeded",
        phase,
      })
    } catch {
      journalFailed = true
    }
    return { actionFailed, journalFailed }
  }

  private async bestEffortOpenFence(
    context: LifecycleAdapterContext,
    state: "resuming" | "rolling_back",
  ): Promise<FenceOpenResult> {
    let fence: LifecycleEmergencySessionActivationFence | null = null
    let actionFailed = false
    let journalFailed = false
    try {
      await this.requirePhase({
        at: this.now(),
        operationId: context.operationId,
        operationState: state,
        outcome: "started",
        phase: "emergency_session_fence",
      })
    } catch {
      journalFailed = true
    }
    try {
      fence = await this.openActivationFence(context)
    } catch {
      actionFailed = true
    }
    try {
      await this.requirePhase({
        at: this.now(),
        failureCode: actionFailed ? "restore_failed" : undefined,
        operationId: context.operationId,
        operationState: state,
        outcome: actionFailed ? "failed" : "succeeded",
        phase: "emergency_session_fence",
      })
    } catch {
      journalFailed = true
    }
    return { actionFailed, fence, journalFailed }
  }

  private async bestEffortCloseFence(
    context: LifecycleAdapterContext,
    state: LifecycleOperationState,
    fence: LifecycleEmergencySessionActivationFence,
  ): Promise<CleanupResult> {
    return this.bestEffortPhase(
      context,
      state,
      "emergency_session_fence",
      undefined,
      "restore_failed",
      () => fence.closeWithZeroSessions(),
    )
  }

  private async bestEffortReassertIsolation(
    context: LifecycleAdapterContext,
    state: LifecycleOperationState,
    fence: LifecycleEmergencyIsolationRestoreFence,
  ): Promise<CleanupResult> {
    return this.bestEffortPhase(
      context,
      state,
      "emergency_isolation_reassertion",
      undefined,
      "restore_failed",
      () => fence.reassertRecoveryRequired(),
    )
  }

  private async bestEffortTransition(
    operationId: string,
    expectedState: LifecycleOperationState,
    nextState: LifecycleOperationState,
    failureCode?: LifecycleFailureCode,
  ): Promise<boolean> {
    try {
      await this.transition(operationId, expectedState, nextState, failureCode)
      return true
    } catch {
      return false
    }
  }

  private async settleSnapshotFailure(input: {
    context: LifecycleAdapterContext
    error: unknown
    operationId: string
    quiesced: LifecycleComponentAdapter[]
    snapshotId: string
    state: LifecycleOperationState
  }): Promise<LifecycleSnapshotResult> {
    const originalCode = failureCode(input.error)
    let state = input.state
    let journalFailed = input.error instanceof LifecycleJournalFailure
    let resumeFailed = false

    if (input.quiesced.length > 0) {
      const enteredResuming = await this.bestEffortTransition(
        input.operationId,
        state,
        "resuming",
      )
      journalFailed ||= !enteredResuming
      if (enteredResuming) {
        state = "resuming"
      }
      const resumed = await this.resumeComponents(
        input.context,
        state,
        input.quiesced,
      )
      journalFailed ||= resumed.journalFailed
      resumeFailed ||= resumed.actionFailed
    }

    if (journalFailed || resumeFailed) {
      return this.finishSnapshotRecoveryRequired(
        input.operationId,
        input.snapshotId,
        state,
        journalFailed ? "journal_failed" : "resume_failed",
      )
    }
    if (
      !(await this.bestEffortTransition(
        input.operationId,
        state,
        "failed",
        originalCode,
      ))
    ) {
      return failedSnapshot(
        input.operationId,
        input.snapshotId,
        "recovery_required",
        "journal_failed",
      )
    }
    return failedSnapshot(
      input.operationId,
      input.snapshotId,
      "failed",
      originalCode,
    )
  }

  private async finishSnapshotRecoveryRequired(
    operationId: string,
    snapshotId: string,
    state: LifecycleOperationState,
    failureCode: LifecycleFailureCode,
  ): Promise<LifecycleSnapshotResult> {
    const persisted = await this.bestEffortTransition(
      operationId,
      state,
      "recovery_required",
      failureCode,
    )
    return failedSnapshot(
      operationId,
      snapshotId,
      "recovery_required",
      persisted ? failureCode : "journal_failed",
    )
  }

  private async settleRestoreFailure(
    input: RestoreSettlementInput,
  ): Promise<LifecycleRestoreResult> {
    if (input.applied.length === 0) {
      return this.settleUnappliedRestoreFailure(input)
    }
    if (input.fenceCloseUncertain) {
      const reassertionFailure = await this.appliedRestoreReassertionFailure(
        input.context,
        input.state,
        input.isolationFence,
      )
      return this.finishRestoreRecoveryRequired(
        input.operationId,
        input.snapshotId,
        input.state,
        reassertionFailure ??
          (input.error instanceof LifecycleJournalFailure
            ? "journal_failed"
            : "restore_failed"),
      )
    }
    return this.compensateAppliedRestore(input)
  }

  private async settleUnappliedRestoreFailure(
    input: RestoreSettlementInput,
  ): Promise<LifecycleRestoreResult> {
    const originalCode = failureCode(input.error)
    let state = input.state
    let journalFailed = input.error instanceof LifecycleJournalFailure
    let cleanupFailed = false

    if (state === "validating") {
      const discarded = await this.discardPreparations(
        input.context,
        state,
        input.preparations,
        input.discarded,
      )
      cleanupFailed ||= discarded.actionFailed
      journalFailed ||= discarded.journalFailed
    } else if (state === "quiescing") {
      const enteredResuming = await this.bestEffortTransition(
        input.operationId,
        state,
        "resuming",
      )
      journalFailed ||= !enteredResuming
      if (enteredResuming) {
        state = "resuming"
      }
      const resumed = await this.resumeComponents(
        input.context,
        state,
        input.quiesced,
        input.resumed,
      )
      cleanupFailed ||= resumed.actionFailed
      journalFailed ||= resumed.journalFailed

      const enteredCleanup = await this.bestEffortTransition(
        input.operationId,
        state,
        "rolling_back",
        originalCode,
      )
      journalFailed ||= !enteredCleanup
      if (enteredCleanup) {
        state = "rolling_back"
      }
      const discarded = await this.discardPreparations(
        input.context,
        state,
        input.preparations,
        input.discarded,
      )
      cleanupFailed ||= discarded.actionFailed
      journalFailed ||= discarded.journalFailed
      if (state === "rolling_back") {
        const returnedToResuming = await this.bestEffortTransition(
          input.operationId,
          state,
          "resuming",
        )
        journalFailed ||= !returnedToResuming
        if (returnedToResuming) {
          state = "resuming"
        }
      }
    } else if (state === "restoring") {
      const enteredCleanup = await this.bestEffortTransition(
        input.operationId,
        state,
        "rolling_back",
        originalCode,
      )
      journalFailed ||= !enteredCleanup
      if (enteredCleanup) {
        state = "rolling_back"
      }
      if (input.fence) {
        const reset = await this.bestEffortPhase(
          input.context,
          state,
          "emergency_session_reset",
          undefined,
          "rollback_failed",
          () => this.restoreSafety.resetEmergencySessions(input.context),
        )
        cleanupFailed ||= reset.actionFailed
        journalFailed ||= reset.journalFailed
      }
      const discarded = await this.discardPreparations(
        input.context,
        state,
        input.preparations,
        input.discarded,
      )
      cleanupFailed ||= discarded.actionFailed
      journalFailed ||= discarded.journalFailed
      if (state === "rolling_back") {
        const enteredResuming = await this.bestEffortTransition(
          input.operationId,
          state,
          "resuming",
        )
        journalFailed ||= !enteredResuming
        if (enteredResuming) {
          state = "resuming"
        }
      }
      const resumed = await this.resumeComponents(
        input.context,
        state,
        input.quiesced,
        input.resumed,
      )
      cleanupFailed ||= resumed.actionFailed
      journalFailed ||= resumed.journalFailed
    }

    if (input.fence) {
      const closed = await this.bestEffortCloseFence(
        input.context,
        state,
        input.fence,
      )
      cleanupFailed ||= closed.actionFailed
      journalFailed ||= closed.journalFailed
    }

    let reassertionSucceeded = false
    if (input.isolationFence) {
      const reasserted = await this.bestEffortReassertIsolation(
        input.context,
        state,
        input.isolationFence,
      )
      reassertionSucceeded =
        !reasserted.actionFailed && !reasserted.journalFailed
      cleanupFailed ||= reasserted.actionFailed
      journalFailed ||= reasserted.journalFailed
    }

    const isolationFenceUnavailable =
      input.isolationFenceAcquisitionAttempted && !input.isolationFence
    const recoveryCode: LifecycleFailureCode = journalFailed
      ? "journal_failed"
      : cleanupFailed || isolationFenceUnavailable
        ? "restore_failed"
        : originalCode
    const terminalPersisted = await this.bestEffortTransition(
      input.operationId,
      state,
      "recovery_required",
      recoveryCode,
    )
    if (!terminalPersisted) {
      return failedRestore(
        input.operationId,
        input.snapshotId,
        "recovery_required",
        "journal_failed",
      )
    }

    const releaseIsSafe =
      reassertionSucceeded && !journalFailed && !cleanupFailed
    if (releaseIsSafe && input.isolationFence) {
      try {
        await input.isolationFence.closeAfterRecoveryRequired()
      } catch {
        // Durable recovery_required is terminal, but local hold release is
        // uncertain. Keep the hold and report the fail-closed disposition.
        return failedRestore(
          input.operationId,
          input.snapshotId,
          "recovery_required",
          "restore_failed",
        )
      }
    }
    return failedRestore(
      input.operationId,
      input.snapshotId,
      "recovery_required",
      recoveryCode,
    )
  }

  private async compensateAppliedRestore(
    input: RestoreSettlementInput,
  ): Promise<LifecycleRestoreResult> {
    const originalCode = failureCode(input.error)
    let state = input.state
    let fence = input.fence
    let journalFailed = false
    let rollbackFailed = false
    let cleanupFailed = false
    let recoveryCode: LifecycleFailureCode | null = null

    if (state !== "rolling_back") {
      const enteredRollback = await this.bestEffortTransition(
        input.operationId,
        state,
        "rolling_back",
        originalCode,
      )
      if (!enteredRollback) {
        // Compensation was not durably admitted. Preserve quiescence and any
        // held fence for explicit recovery instead of making partial state live.
        if (!fence && state === "resuming") {
          const reopened = await this.bestEffortOpenFence(input.context, state)
          fence = reopened.fence
          if (fence) {
            await this.bestEffortPhase(
              input.context,
              state,
              "emergency_session_reset",
              undefined,
              "rollback_failed",
              () => this.restoreSafety.resetEmergencySessions(input.context),
            )
          }
        }
        recoveryCode = "journal_failed"
      } else {
        state = "rolling_back"
      }
    }

    if (!recoveryCode && !fence) {
      if (state !== "rolling_back") {
        recoveryCode = "journal_failed"
      } else {
        const reopened = await this.bestEffortOpenFence(input.context, state)
        fence = reopened.fence
        if (reopened.actionFailed || !fence) {
          recoveryCode = "restore_failed"
        } else {
          const resetAfterReopen = await this.bestEffortPhase(
            input.context,
            state,
            "emergency_session_reset",
            undefined,
            "rollback_failed",
            () => this.restoreSafety.resetEmergencySessions(input.context),
          )
          if (
            reopened.journalFailed ||
            resetAfterReopen.actionFailed ||
            resetAfterReopen.journalFailed
          ) {
            // The reopened fence stays held until explicit recovery clears the gap.
            recoveryCode =
              reopened.journalFailed || resetAfterReopen.journalFailed
                ? "journal_failed"
                : "rollback_failed"
          }
        }
      }
    }

    if (!recoveryCode) {
      const requiesced = await this.reQuiesceResumedComponents(
        input.context,
        input.resumed,
        input.quiesced,
      )
      if (requiesced.actionFailed || requiesced.journalFailed) {
        // A failed re-quiesce leaves component liveness uncertain. Keep every
        // known quiescence and the activation fence in place for explicit
        // recovery instead of attempting resume under rolling_back.
        recoveryCode = requiesced.journalFailed
          ? "journal_failed"
          : "quiesce_failed"
      }
    }

    if (!recoveryCode) {
      const rolledBack = await this.rollbackComponents(
        input.context,
        input.applied,
        input.preparations,
      )
      rollbackFailed ||= rolledBack.actionFailed
      journalFailed ||= rolledBack.journalFailed

      const reset = await this.bestEffortPhase(
        input.context,
        state,
        "emergency_session_reset",
        undefined,
        "rollback_failed",
        () => this.restoreSafety.resetEmergencySessions(input.context),
      )
      rollbackFailed ||= reset.actionFailed
      journalFailed ||= reset.journalFailed

      const discarded = await this.discardPreparations(
        input.context,
        state,
        input.preparations,
        input.discarded,
      )
      cleanupFailed ||= discarded.actionFailed
      journalFailed ||= discarded.journalFailed

      recoveryCode = journalFailed
        ? "journal_failed"
        : rollbackFailed
          ? "rollback_failed"
          : cleanupFailed
            ? "restore_failed"
            : null
    }

    const reassertionFailure = await this.appliedRestoreReassertionFailure(
      input.context,
      state,
      input.isolationFence,
    )
    recoveryCode = reassertionFailure ?? recoveryCode
    if (recoveryCode) {
      return this.finishRestoreRecoveryRequired(
        input.operationId,
        input.snapshotId,
        state,
        recoveryCode,
      )
    }
    const isolationFence = input.isolationFence
    if (!isolationFence) {
      return this.finishRestoreRecoveryRequired(
        input.operationId,
        input.snapshotId,
        state,
        "restore_failed",
      )
    }
    if (!fence) {
      return this.finishRestoreRecoveryRequired(
        input.operationId,
        input.snapshotId,
        state,
        "restore_failed",
      )
    }

    const enteredResuming = await this.bestEffortTransition(
      input.operationId,
      state,
      "resuming",
    )
    if (!enteredResuming) {
      return this.finishRestoreRecoveryRequired(
        input.operationId,
        input.snapshotId,
        state,
        "journal_failed",
      )
    }
    state = "resuming"
    const resumed = await this.resumeComponents(
      input.context,
      state,
      input.quiesced,
      input.resumed,
    )
    if (resumed.actionFailed || resumed.journalFailed) {
      return this.finishRestoreRecoveryRequired(
        input.operationId,
        input.snapshotId,
        state,
        resumed.journalFailed ? "journal_failed" : "resume_failed",
      )
    }

    const closed = await this.bestEffortCloseFence(input.context, state, fence)
    if (closed.actionFailed || closed.journalFailed) {
      return this.finishRestoreRecoveryRequired(
        input.operationId,
        input.snapshotId,
        state,
        closed.journalFailed ? "journal_failed" : "restore_failed",
      )
    }

    if (
      !(await this.bestEffortTransition(
        input.operationId,
        state,
        "rolled_back",
        originalCode,
      ))
    ) {
      return failedRestore(
        input.operationId,
        input.snapshotId,
        "recovery_required",
        "journal_failed",
      )
    }
    try {
      await isolationFence.closeAfterRecoveryRequired()
    } catch {
      // Durable recovery_required remains authoritative. A local hold release
      // failure is reported as recovery-required and left held.
      return failedRestore(
        input.operationId,
        input.snapshotId,
        "recovery_required",
        "restore_failed",
      )
    }
    return failedRestore(
      input.operationId,
      input.snapshotId,
      "rolled_back",
      originalCode,
    )
  }

  private async appliedRestoreReassertionFailure(
    context: LifecycleAdapterContext,
    state: LifecycleOperationState,
    isolationFence: LifecycleEmergencyIsolationRestoreFence | null,
  ): Promise<LifecycleFailureCode | null> {
    if (!isolationFence) {
      return "restore_failed"
    }
    const reasserted = await this.bestEffortReassertIsolation(
      context,
      state,
      isolationFence,
    )
    if (reasserted.journalFailed) {
      return "journal_failed"
    }
    return reasserted.actionFailed ? "restore_failed" : null
  }

  private async finishRestoreRecoveryRequired(
    operationId: string,
    snapshotId: string,
    state: LifecycleOperationState,
    failureCode: LifecycleFailureCode,
  ): Promise<LifecycleRestoreResult> {
    const persisted = await this.bestEffortTransition(
      operationId,
      state,
      "recovery_required",
      failureCode,
    )
    return failedRestore(
      operationId,
      snapshotId,
      "recovery_required",
      persisted ? failureCode : "journal_failed",
    )
  }
}

function assertExactAdapterOrder(adapters: LifecycleComponentAdapters): void {
  const expected: LifecycleComponent[] = [
    "console_database",
    "keycloak",
    "litellm",
    "grafana",
  ]
  if (
    adapters.length !== expected.length ||
    adapters.some((adapter, index) => adapter.component !== expected[index])
  ) {
    throw new Error("Lifecycle adapters are incomplete or out of order.")
  }
}

function failureCode(error: unknown): LifecycleFailureCode {
  if (error instanceof LifecycleJournalFailure) {
    return "journal_failed"
  }
  if (error instanceof LifecycleStepFailure) {
    return error.failureCode
  }
  return "adapter_unavailable"
}

function requireActivationFence(
  fence: LifecycleEmergencySessionActivationFence | null,
): LifecycleEmergencySessionActivationFence {
  if (!fence) {
    throw new LifecycleStepFailure("restore_failed")
  }
  return fence
}

function requireIsolationRestoreFence(
  fence: LifecycleEmergencyIsolationRestoreFence | null,
): LifecycleEmergencyIsolationRestoreFence {
  if (!fence) {
    throw new LifecycleStepFailure("restore_failed")
  }
  return fence
}

function addUnique(
  items: LifecycleComponentAdapter[],
  adapter: LifecycleComponentAdapter,
): void {
  if (!items.includes(adapter)) {
    items.push(adapter)
  }
}

function removeItem(
  items: LifecycleComponentAdapter[],
  adapter: LifecycleComponentAdapter,
): void {
  const index = items.indexOf(adapter)
  if (index >= 0) {
    items.splice(index, 1)
  }
}

function failedSnapshot(
  operationId: string,
  snapshotId: string,
  status: "failed" | "recovery_required",
  failureCode: LifecycleFailureCode,
): LifecycleSnapshotResult {
  return { failureCode, operationId, snapshotId, status }
}

function failedRestore(
  operationId: string,
  snapshotId: string | null,
  status: "failed" | "recovery_required" | "rolled_back",
  failureCode: LifecycleFailureCode,
): LifecycleRestoreResult {
  return { failureCode, operationId, snapshotId, status }
}
