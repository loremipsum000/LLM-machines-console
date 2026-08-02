import { randomUUID } from "node:crypto"
import {
  type LifecycleOperationState,
  lifecycleOperationStateSchema,
} from "@llm-machines/contracts"
import {
  type EmergencyIsolationActivationRequest,
  type EmergencyIsolationActivationResult,
  type EmergencyIsolationDeactivationRequest,
  type EmergencyIsolationDeactivationResult,
  type EmergencyIsolationFailureCode,
  type EmergencyIsolationState,
  type EmergencyIsolationStatus,
  emergencyIsolationActivationConfirmation,
  emergencyIsolationActivationRequestSchema,
  emergencyIsolationDeactivationConfirmation,
  emergencyIsolationDeactivationRequestSchema,
  emergencyIsolationFailureCodeSchema,
  emergencyIsolationStateSchema,
  emergencyIsolationStatusSchema,
  emergencyRecoveryApprovedMfaMethods,
} from "@llm-machines/contracts/inference-core"
import { eq, sql } from "drizzle-orm"
import type { Actor } from "../auth/authorization"
import {
  type InferenceCoreDatabase,
  type InferenceCoreQueryExecutor,
  type InferenceCoreTransaction,
  getInferenceCoreDb,
} from "../db/inference-core-client"
import {
  auditEvents,
  emergencyIsolationState,
} from "../db/inference-core-schema"
import type { IdentityMutationRouteContext } from "./identity-mutation-journal"
import type {
  LifecycleRestoreIsolationRecoveryAuthority,
  LifecycleRestoreOperationStatus,
  LifecycleUnfencedRestoreOperation,
} from "./lifecycle-operation-journal"
import type {
  LifecycleEmergencyIsolationRestoreFence,
  LifecycleRestoreSafety,
} from "./lifecycle-orchestration"

const isolationResourceId = "appliance"
const recentAuthenticationWindowSeconds = 300
const terminalLifecycleRestoreStates = new Set<LifecycleOperationState>([
  "succeeded",
  "rolled_back",
  "failed",
  "recovery_required",
])

export type EmergencyIsolationCommitWithReceipt = NonNullable<
  IdentityMutationRouteContext["commitWithReceipt"]
>

export interface EmergencyIsolationAuthenticationProof {
  acr?: string
  amr: string[]
  authMode: Actor["authMode"]
  authTime: number
  keycloakSubjectId: string
}

export interface EmergencyIsolationLiveIdentity {
  enabled: boolean
  keycloakSubjectId: string
  role: Actor["role"]
}

export interface EmergencyIsolationEnforcementContext {
  correlationId: string
  transitionId: string
}

export type EmergencyIsolationEngagementResult =
  | { status: "engaged" }
  | {
      failureCode:
        | "admission_fence_failed"
        | "enforcement_failed"
        | "inflight_abort_failed"
      status: "failed"
    }

export type EmergencyIsolationVerificationResult =
  | { status: "verified" }
  | {
      failureCode: "enforcement_failed" | "verification_failed"
      status: "failed"
    }

export interface EmergencyIsolationDeactivationCommitReservation {
  /** Leaves the reserved generation sealed after a failed durable commit. */
  abort(): void
  /** Opens the reserved generation after the durable transaction resolves. */
  commit(): void
  /** Synchronously linearizes local commit immediately before durable commit. */
  enterCommitting(): boolean
}

export type EmergencyIsolationDisengagementPreparationResult =
  | {
      deactivationCommitReservation: EmergencyIsolationDeactivationCommitReservation
      status: "prepared"
    }
  | {
      failureCode: "enforcement_failed" | "verification_failed"
      status: "failed"
    }

/**
 * Runtime and gateway effects stay behind this explicit source-only boundary.
 * PR-12 must bind and qualify the implementation on the appliance.
 */
export interface EmergencyIsolationEnforcement {
  effectiveTrafficState(): "open" | "sealed" | "uncertain"
  engage(
    context: EmergencyIsolationEnforcementContext,
  ): Promise<EmergencyIsolationEngagementResult>
  prepareDisengage(
    context: EmergencyIsolationEnforcementContext,
  ): Promise<EmergencyIsolationDisengagementPreparationResult>
  verifyEngaged(
    context: EmergencyIsolationEnforcementContext,
  ): Promise<EmergencyIsolationVerificationResult>
}

export interface EmergencyIsolationRestoreHold {
  release(): void
}

export interface EmergencyIsolationRestoreHoldSource {
  acquireRestoreHold(): EmergencyIsolationRestoreHold
}

export interface EmergencyIsolationRecoveryMarker {
  operationId: string
  state: "recovery_required"
}

/**
 * Authority stored outside every component covered by a Console restore.
 * Implementations must compare-and-set by operationId so an older restore
 * fence can never replace or clear a newer marker.
 */
export interface EmergencyIsolationNonRestorableAuthority {
  /** Atomically compare-clears and durably confirms absence before true. */
  clearRecoveryRequiredAndConfirm(operationId: string): Promise<boolean>
  persistRecoveryRequired(operationId: string): Promise<boolean>
  readRecoveryRequired(): Promise<unknown>
}

export interface StoredEmergencyIsolationState {
  activatedAt: Date | null
  activatedBySubjectId: string | null
  changedBySubjectId: string | null
  correlationId: string | null
  failureCode: EmergencyIsolationFailureCode | null
  id: "appliance"
  revision: number
  state: EmergencyIsolationState
  transitionId: string | null
  transitionStartedAt: Date | null
  updatedAt: Date
}

export interface EmergencyIsolationBeginInput {
  actorSubjectId: string
  at: Date
  correlationId: string
  expectedRevision: number
  expectedStates: readonly ("active" | "inactive" | "recovery_required")[]
  nextState: "disengaging" | "engaging"
  transitionId: string
}

export interface EmergencyIsolationCompleteInput {
  at: Date
  beforeCommit?: () => boolean
  expectedRevision: number
  expectedState: "disengaging" | "engaging"
  nextState: "active" | "inactive"
  transitionId: string
}

export interface EmergencyIsolationRecoveryInput {
  actorSubjectId: string | null
  at: Date
  correlationId: string
  failureCode: EmergencyIsolationFailureCode
  transitionId: string
}

export type EmergencyIsolationBeginResult =
  | { state: StoredEmergencyIsolationState; status: "changed" }
  | { state: StoredEmergencyIsolationState; status: "unchanged" }
  | { status: "unavailable" }

export interface EmergencyIsolationStore {
  begin(
    input: EmergencyIsolationBeginInput,
  ): Promise<EmergencyIsolationBeginResult>
  complete(
    input: EmergencyIsolationCompleteInput,
    transaction?: InferenceCoreTransaction | null,
  ): Promise<StoredEmergencyIsolationState | null>
  forceRecoveryRequired(
    input: EmergencyIsolationRecoveryInput,
    transaction?: InferenceCoreTransaction | null,
  ): Promise<StoredEmergencyIsolationState | null>
  read(): Promise<StoredEmergencyIsolationState | null>
}

export type EmergencyIsolationDenialReason =
  | "identity_disabled"
  | "identity_mismatch"
  | "identity_not_admin"
  | "keycloak_authentication_required"
  | "mfa_required"
  | "recent_authentication_required"

export class EmergencyIsolationDeniedError extends Error {
  constructor(readonly reason: EmergencyIsolationDenialReason) {
    super("Emergency isolation mutation was denied.")
    this.name = "EmergencyIsolationDeniedError"
  }
}

export class EmergencyIsolationConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super("Emergency isolation state changed. Refresh before retrying.")
    this.name = "EmergencyIsolationConflictError"
  }
}

export class EmergencyIsolationBusyError extends Error {
  constructor() {
    super("An emergency isolation transition is already in progress.")
    this.name = "EmergencyIsolationBusyError"
  }
}

export class EmergencyIsolationRecoveryRequiredError extends Error {
  constructor(readonly status: EmergencyIsolationStatus) {
    super("Emergency isolation requires recovery before it can change.")
    this.name = "EmergencyIsolationRecoveryRequiredError"
  }
}

export class EmergencyIsolationUnavailableError extends Error {
  constructor() {
    super("Emergency isolation authority is unavailable.")
    this.name = "EmergencyIsolationUnavailableError"
  }
}

export class EmergencyIsolationAtomicCommitError extends Error {
  constructor() {
    super(
      "Emergency isolation terminal state and receipt did not commit atomically.",
    )
    this.name = "EmergencyIsolationAtomicCommitError"
  }
}

export interface EmergencyIsolationServiceOptions {
  lifecycleRestoreIsolationRecoveryAuthority?: LifecycleRestoreIsolationRecoveryAuthority | null
  nonRestorableAuthority?: EmergencyIsolationNonRestorableAuthority | null
  now?: () => Date
  randomId?: () => string
}

export class EmergencyIsolationService {
  private readonly lifecycleRestoreIsolationRecoveryAuthority: LifecycleRestoreIsolationRecoveryAuthority | null
  private readonly nonRestorableAuthority: EmergencyIsolationNonRestorableAuthority | null
  private readonly now: () => Date
  private readonly randomId: () => string

  constructor(
    private readonly store: EmergencyIsolationStore,
    private readonly enforcement: EmergencyIsolationEnforcement,
    options: EmergencyIsolationServiceOptions = {},
  ) {
    this.lifecycleRestoreIsolationRecoveryAuthority =
      options.lifecycleRestoreIsolationRecoveryAuthority ?? null
    this.nonRestorableAuthority = options.nonRestorableAuthority ?? null
    this.now = options.now ?? (() => new Date())
    this.randomId = options.randomId ?? randomUUID
  }

  async status(): Promise<EmergencyIsolationStatus> {
    const status = await this.durableAdmissionStatus()
    if (this.localTrafficState() !== status.effectiveTrafficState) {
      throw new EmergencyIsolationUnavailableError()
    }
    return status
  }

  async durableStatus(): Promise<EmergencyIsolationStatus> {
    return projectStatus(await this.requireState())
  }

  async durableAdmissionStatus(): Promise<EmergencyIsolationStatus> {
    const marker = await this.readNonRestorableRecoveryMarker()
    if (marker) {
      throw new EmergencyIsolationUnavailableError()
    }
    if (await this.readUnfencedRestore()) {
      throw new EmergencyIsolationUnavailableError()
    }
    return await this.durableStatus()
  }

  async activate(
    actor: Actor,
    correlationId: string,
    request: EmergencyIsolationActivationRequest,
    commitWithReceipt?: EmergencyIsolationCommitWithReceipt,
  ): Promise<EmergencyIsolationActivationResult> {
    const parsed = emergencyIsolationActivationRequestSchema.safeParse(request)
    if (
      !parsed.success ||
      parsed.data.confirmation !== emergencyIsolationActivationConfirmation
    ) {
      throw new EmergencyIsolationUnavailableError()
    }
    this.requireStandingAdmin(actor)
    requireCorrelationId(correlationId)

    const transitionId = this.allocateTransitionId()
    try {
      await this.requireNoRestoreIsolationRecovery()
    } catch {
      return await this.failClosed(
        actor.subject,
        correlationId,
        transitionId,
        "journal_failed",
        commitWithReceipt,
      )
    }
    const at = this.now()
    const begin = await this.safeBegin({
      actorSubjectId: actor.subject,
      at,
      correlationId,
      expectedRevision: parsed.data.expectedRevision,
      expectedStates: ["inactive", "recovery_required"],
      nextState: "engaging",
      transitionId,
    })
    if (begin.status === "unavailable") {
      return await this.failClosed(
        actor.subject,
        correlationId,
        transitionId,
        "journal_failed",
        commitWithReceipt,
      )
    }
    if (begin.status !== "changed") {
      return await this.classifyActivationNoChange(
        begin,
        parsed.data.expectedRevision,
        actor.subject,
        correlationId,
        transitionId,
        commitWithReceipt,
      )
    }

    const context = { correlationId, transitionId }
    const engagement = await this.safeEngage(context)
    if (engagement.status !== "engaged") {
      return await this.failClosed(
        actor.subject,
        correlationId,
        transitionId,
        engagement.failureCode,
        commitWithReceipt,
      )
    }
    const verification = await this.safeVerify(context)
    if (verification.status !== "verified") {
      return await this.failClosed(
        actor.subject,
        correlationId,
        transitionId,
        verification.failureCode,
        commitWithReceipt,
      )
    }

    const completed = await this.completeWithOptionalReceipt(
      {
        at: this.now(),
        expectedRevision: begin.state.revision,
        expectedState: "engaging",
        nextState: "active",
        transitionId,
      },
      commitWithReceipt,
    )
    if (!completed || completed.state !== "active") {
      return await this.failClosed(
        actor.subject,
        correlationId,
        transitionId,
        "journal_failed",
        commitWithReceipt,
      )
    }
    return {
      ...projectStatus(completed),
      result: "activated",
      state: "active",
    }
  }

  async deactivate(
    actor: Actor,
    correlationId: string,
    request: EmergencyIsolationDeactivationRequest,
    commitWithReceipt?: EmergencyIsolationCommitWithReceipt,
  ): Promise<EmergencyIsolationDeactivationResult> {
    const parsed =
      emergencyIsolationDeactivationRequestSchema.safeParse(request)
    if (
      !parsed.success ||
      parsed.data.confirmation !== emergencyIsolationDeactivationConfirmation
    ) {
      throw new EmergencyIsolationUnavailableError()
    }
    this.requireStandingAdmin(actor)
    requireCorrelationId(correlationId)

    const transitionId = this.allocateTransitionId()
    try {
      await this.requireNoRestoreIsolationRecovery()
    } catch {
      return await this.failClosed(
        actor.subject,
        correlationId,
        transitionId,
        "journal_failed",
        commitWithReceipt,
      )
    }

    const current = await this.requireState()
    if (current.revision !== parsed.data.expectedRevision) {
      throw new EmergencyIsolationConflictError(current.revision)
    }
    if (current.state === "inactive") {
      if (this.localTrafficState() !== "open") {
        return await this.failClosed(
          actor.subject,
          correlationId,
          transitionId,
          "journal_failed",
          commitWithReceipt,
        )
      }
      return {
        ...projectStatus(current),
        result: "already_inactive",
        state: "inactive",
      }
    }
    if (current.state === "engaging" || current.state === "disengaging") {
      throw new EmergencyIsolationBusyError()
    }
    if (current.state === "recovery_required") {
      throw new EmergencyIsolationRecoveryRequiredError(projectStatus(current))
    }

    const context = { correlationId, transitionId }
    const engagement = await this.safeEngage(context)
    if (engagement.status !== "engaged") {
      return await this.failClosed(
        actor.subject,
        correlationId,
        transitionId,
        engagement.failureCode,
        commitWithReceipt,
      )
    }
    const verification = await this.safeVerify(context)
    if (verification.status !== "verified") {
      return await this.failClosed(
        actor.subject,
        correlationId,
        transitionId,
        verification.failureCode,
        commitWithReceipt,
      )
    }

    const begin = await this.safeBegin({
      actorSubjectId: actor.subject,
      at: this.now(),
      correlationId,
      expectedRevision: current.revision,
      expectedStates: ["active"],
      nextState: "disengaging",
      transitionId,
    })
    if (begin.status === "unavailable") {
      return await this.failClosed(
        actor.subject,
        correlationId,
        transitionId,
        "journal_failed",
        commitWithReceipt,
      )
    }
    if (begin.status !== "changed") {
      return await this.classifyDeactivationNoChange(
        begin,
        parsed.data.expectedRevision,
        actor.subject,
        correlationId,
        transitionId,
        commitWithReceipt,
      )
    }

    const prepared = await this.safePrepareDisengage(context)
    if (prepared.status !== "prepared") {
      return await this.failClosed(
        actor.subject,
        correlationId,
        transitionId,
        prepared.failureCode,
        commitWithReceipt,
      )
    }

    const completed = await this.completeWithOptionalReceipt(
      {
        at: this.now(),
        beforeCommit: () =>
          this.safeEnterDeactivationCommit(
            prepared.deactivationCommitReservation,
          ),
        expectedRevision: begin.state.revision,
        expectedState: "disengaging",
        nextState: "inactive",
        transitionId,
      },
      commitWithReceipt,
    )
    if (!completed || completed.state !== "inactive") {
      this.safeAbortDeactivationCommit(prepared.deactivationCommitReservation)
      return await this.failClosed(
        actor.subject,
        correlationId,
        transitionId,
        "journal_failed",
        commitWithReceipt,
      )
    }
    // This is the infallible local half of the reservation after durable
    // inactive plus its receipt have committed. It must never start a second
    // terminalization attempt.
    prepared.deactivationCommitReservation.commit()
    return {
      ...projectStatus(completed),
      result: "deactivated",
      state: "inactive",
    }
  }

  async bootstrap(): Promise<EmergencyIsolationStatus> {
    const transitionId = this.allocateTransitionId()
    const correlationId = `isolation-bootstrap:${transitionId}`
    const context = { correlationId, transitionId }
    let marker: EmergencyIsolationRecoveryMarker | null
    try {
      marker = await this.readNonRestorableRecoveryMarker()
    } catch {
      await this.safeEngage(context)
      throw new EmergencyIsolationUnavailableError()
    }
    if (marker) {
      return await this.reconcileSurvivingRecoveryMarker(marker, context)
    }

    let unfenced: LifecycleUnfencedRestoreOperation | null
    try {
      unfenced = await this.readUnfencedRestore()
    } catch {
      await this.safeEngage(context)
      throw new EmergencyIsolationUnavailableError()
    }
    if (unfenced) {
      return await this.reconcileUnfencedRestore(unfenced, context)
    }

    const current = await this.requireState()

    if (current.state === "inactive") {
      const prepared = await this.safePrepareDisengage(context)
      if (prepared.status === "prepared") {
        const entered = this.safeEnterDeactivationCommit(
          prepared.deactivationCommitReservation,
        )
        if (
          entered &&
          this.tryCommitBootstrapReservation(
            prepared.deactivationCommitReservation,
          )
        ) {
          return projectStatus(current)
        }
        this.safeAbortDeactivationCommit(prepared.deactivationCommitReservation)
        return await this.failClosedSystem(
          correlationId,
          transitionId,
          "enforcement_failed",
        )
      }
      return await this.failClosedSystem(
        correlationId,
        transitionId,
        prepared.failureCode,
      )
    }
    if (current.state === "engaging" || current.state === "disengaging") {
      await this.safeEngage(context)
      return await this.failClosedSystem(
        correlationId,
        transitionId,
        "state_invalid",
      )
    }

    const engagement = await this.safeEngage(context)
    if (engagement.status !== "engaged") {
      return await this.failClosedSystem(
        correlationId,
        transitionId,
        engagement.failureCode,
      )
    }
    const verified = await this.safeVerify(context)
    if (verified.status !== "verified") {
      return await this.failClosedSystem(
        correlationId,
        transitionId,
        verified.failureCode,
      )
    }
    return projectStatus(current)
  }

  async requireRecoveryAfterRestore(
    correlationId: string,
  ): Promise<EmergencyIsolationStatus> {
    requireCorrelationId(correlationId)
    const transitionId = this.allocateTransitionId()
    const context = { correlationId, transitionId }
    const engagement = await this.safeEngage(context)
    let recovered: StoredEmergencyIsolationState | null = null
    try {
      recovered = await this.store.forceRecoveryRequired({
        actorSubjectId: null,
        at: this.now(),
        correlationId,
        failureCode: "restore_reassertion_failed",
        transitionId,
      })
    } catch {
      // The local traffic fence stays closed when reassertion cannot persist.
    }
    if (
      engagement.status !== "engaged" ||
      !recovered ||
      recovered.state !== "recovery_required" ||
      recovered.failureCode !== "restore_reassertion_failed"
    ) {
      throw new EmergencyIsolationUnavailableError()
    }
    let readBack: StoredEmergencyIsolationState | null = null
    try {
      readBack = await this.store.read()
    } catch {
      // The non-restorable hold remains active on uncertain readback.
    }
    if (
      !readBack ||
      readBack.state !== "recovery_required" ||
      readBack.failureCode !== "restore_reassertion_failed" ||
      readBack.revision !== recovered.revision
    ) {
      throw new EmergencyIsolationUnavailableError()
    }
    const verification = await this.safeVerify(context)
    if (verification.status !== "verified") {
      throw new EmergencyIsolationUnavailableError()
    }
    return projectStatus(readBack)
  }

  async verifyRecoveryAfterRestore(): Promise<EmergencyIsolationStatus> {
    const current = await this.requireState()
    if (
      current.state !== "recovery_required" ||
      current.failureCode !== "restore_reassertion_failed" ||
      this.localTrafficState() !== "sealed"
    ) {
      throw new EmergencyIsolationUnavailableError()
    }
    return projectStatus(current)
  }

  private async requireNoRestoreIsolationRecovery(): Promise<void> {
    if (await this.readNonRestorableRecoveryMarker()) {
      throw new EmergencyIsolationUnavailableError()
    }
    if (await this.readUnfencedRestore()) {
      throw new EmergencyIsolationUnavailableError()
    }
  }

  private async reconcileSurvivingRecoveryMarker(
    marker: EmergencyIsolationRecoveryMarker,
    context: EmergencyIsolationEnforcementContext,
  ): Promise<EmergencyIsolationStatus> {
    let operation: LifecycleRestoreOperationStatus | null = null
    try {
      operation = await this.readRestoreOperation(marker.operationId)
    } catch {
      // The marker remains authoritative when lifecycle ownership is unknown.
    }
    if (!operation || !terminalLifecycleRestoreStates.has(operation.state)) {
      try {
        await this.requireRecoveryAfterRestore(marker.operationId)
      } catch {
        await this.safeEngage(context)
      }
      throw new EmergencyIsolationUnavailableError()
    }

    let unfenced: LifecycleUnfencedRestoreOperation | null
    try {
      unfenced = await this.readUnfencedRestore()
    } catch {
      try {
        await this.requireRecoveryAfterRestore(marker.operationId)
      } catch {
        await this.safeEngage(context)
      }
      throw new EmergencyIsolationUnavailableError()
    }
    if (
      unfenced &&
      (operation.state !== "recovery_required" ||
        unfenced.operationId !== marker.operationId ||
        unfenced.state !== "recovery_required")
    ) {
      try {
        await this.requireRecoveryAfterRestore(marker.operationId)
      } catch {
        await this.safeEngage(context)
      }
      throw new EmergencyIsolationUnavailableError()
    }

    const recovered = await this.requireRecoveryAfterRestore(marker.operationId)
    if (unfenced) {
      let reconciled = false
      try {
        reconciled =
          (await requireLifecycleRestoreIsolationRecoveryAuthority(
            this.lifecycleRestoreIsolationRecoveryAuthority,
          ).recordIsolationReconciled(marker.operationId, this.now())) === true
      } catch {
        // The marker remains authoritative until reconciliation is proven.
      }
      if (!reconciled) {
        throw new EmergencyIsolationUnavailableError()
      }
    }
    if (await this.readUnfencedRestore()) {
      throw new EmergencyIsolationUnavailableError()
    }
    const markerAuthority = requireNonRestorableAuthority(
      this.nonRestorableAuthority,
    )
    // Re-read terminal lifecycle ownership immediately before clearing the
    // operation-scoped non-restorable marker.
    await requireTerminalLifecycleRestore(
      requireLifecycleRestoreIsolationRecoveryAuthority(
        this.lifecycleRestoreIsolationRecoveryAuthority,
      ),
      marker.operationId,
    )
    const cleared = await safeClearRecoveryMarker(
      markerAuthority,
      marker.operationId,
    )
    if (!cleared) {
      throw new EmergencyIsolationUnavailableError()
    }
    return recovered
  }

  private async reconcileUnfencedRestore(
    operation: LifecycleUnfencedRestoreOperation,
    context: EmergencyIsolationEnforcementContext,
  ): Promise<EmergencyIsolationStatus> {
    const engagement = await this.safeEngage(context)
    if (engagement.status !== "engaged") {
      throw new EmergencyIsolationUnavailableError()
    }
    const authority = requireLifecycleRestoreIsolationRecoveryAuthority(
      this.lifecycleRestoreIsolationRecoveryAuthority,
    )
    let terminalized = false
    try {
      terminalized =
        (await authority.terminalizeUnfencedRestore(
          operation.operationId,
          this.now(),
        )) === true
    } catch {
      // The local traffic fence remains sealed when lifecycle CAS is unknown.
    }
    if (!terminalized) {
      try {
        await this.requireRecoveryAfterRestore(operation.operationId)
      } catch {
        // Local engagement above remains the last known safe state.
      }
      throw new EmergencyIsolationUnavailableError()
    }

    const recovered = await this.requireRecoveryAfterRestore(
      operation.operationId,
    )
    let reconciled = false
    try {
      reconciled =
        (await authority.recordIsolationReconciled(
          operation.operationId,
          this.now(),
        )) === true
    } catch {
      // The Console recovery state remains sealed when journal proof fails.
    }
    if (!reconciled) {
      throw new EmergencyIsolationUnavailableError()
    }
    if (await this.readUnfencedRestore()) {
      throw new EmergencyIsolationUnavailableError()
    }
    return recovered
  }

  private async readRestoreOperation(
    operationId: string,
  ): Promise<LifecycleRestoreOperationStatus | null> {
    const authority = requireLifecycleRestoreIsolationRecoveryAuthority(
      this.lifecycleRestoreIsolationRecoveryAuthority,
    )
    let raw: unknown
    try {
      raw = await authority.readRestoreOperation(operationId)
    } catch {
      throw new EmergencyIsolationUnavailableError()
    }
    const parsed = parseLifecycleRestoreOperation(raw)
    if (parsed === undefined) {
      throw new EmergencyIsolationUnavailableError()
    }
    if (parsed && parsed.operationId !== operationId) {
      throw new EmergencyIsolationUnavailableError()
    }
    return parsed
  }

  private async readUnfencedRestore(): Promise<LifecycleUnfencedRestoreOperation | null> {
    const authority = requireLifecycleRestoreIsolationRecoveryAuthority(
      this.lifecycleRestoreIsolationRecoveryAuthority,
    )
    let raw: unknown
    try {
      raw = await authority.readUnfencedRestore()
    } catch {
      throw new EmergencyIsolationUnavailableError()
    }
    const parsed = parseLifecycleUnfencedRestore(raw)
    if (parsed === undefined) {
      throw new EmergencyIsolationUnavailableError()
    }
    return parsed
  }

  private async readNonRestorableRecoveryMarker(): Promise<EmergencyIsolationRecoveryMarker | null> {
    if (!this.nonRestorableAuthority) {
      throw new EmergencyIsolationUnavailableError()
    }
    let raw: unknown
    try {
      raw = await this.nonRestorableAuthority.readRecoveryRequired()
    } catch {
      throw new EmergencyIsolationUnavailableError()
    }
    const marker = parseRecoveryMarker(raw)
    if (marker === undefined) {
      throw new EmergencyIsolationUnavailableError()
    }
    return marker
  }

  private requireStandingAdmin(actor: Actor): void {
    const proof: EmergencyIsolationAuthenticationProof = {
      ...(actor.acr ? { acr: actor.acr } : {}),
      amr: actor.amr ?? [],
      authMode: actor.authMode,
      authTime: actor.authTime ?? 0,
      keycloakSubjectId: actor.subject,
    }
    const liveIdentity: EmergencyIsolationLiveIdentity = {
      enabled: true,
      keycloakSubjectId: actor.subject,
      role: actor.role,
    }
    const denial = standingAdminDenial(proof, liveIdentity, this.now())
    if (denial) {
      throw new EmergencyIsolationDeniedError(denial)
    }
  }

  private async requireState(): Promise<StoredEmergencyIsolationState> {
    try {
      const state = await this.store.read()
      if (state) {
        return state
      }
    } catch {
      // Converted to the same fail-closed public result below.
    }
    throw new EmergencyIsolationUnavailableError()
  }

  private allocateTransitionId(): string {
    let value: string
    try {
      value = this.randomId()
    } catch {
      throw new EmergencyIsolationUnavailableError()
    }
    if (!uuid(value)) {
      throw new EmergencyIsolationUnavailableError()
    }
    return value
  }

  private async safeBegin(
    input: EmergencyIsolationBeginInput,
  ): Promise<EmergencyIsolationBeginResult> {
    try {
      return await this.store.begin(input)
    } catch {
      return { status: "unavailable" }
    }
  }

  private async safeEngage(
    context: EmergencyIsolationEnforcementContext,
  ): Promise<EmergencyIsolationEngagementResult> {
    try {
      const result: unknown = await this.enforcement.engage(context)
      return validEngagementResult(result)
        ? result
        : { failureCode: "enforcement_failed", status: "failed" }
    } catch {
      return { failureCode: "admission_fence_failed", status: "failed" }
    }
  }

  private async safeVerify(
    context: EmergencyIsolationEnforcementContext,
  ): Promise<EmergencyIsolationVerificationResult> {
    try {
      const result: unknown = await this.enforcement.verifyEngaged(context)
      return validVerificationResult(result)
        ? result
        : { failureCode: "verification_failed", status: "failed" }
    } catch {
      return { failureCode: "verification_failed", status: "failed" }
    }
  }

  private async safePrepareDisengage(
    context: EmergencyIsolationEnforcementContext,
  ): Promise<EmergencyIsolationDisengagementPreparationResult> {
    try {
      const result: unknown = await this.enforcement.prepareDisengage(context)
      return validDisengagementResult(result)
        ? result
        : { failureCode: "enforcement_failed", status: "failed" }
    } catch {
      return { failureCode: "enforcement_failed", status: "failed" }
    }
  }

  private localTrafficState(): "open" | "sealed" | "uncertain" {
    try {
      const state = this.enforcement.effectiveTrafficState()
      return state === "open" || state === "sealed" ? state : "uncertain"
    } catch {
      return "uncertain"
    }
  }

  private safeAbortDeactivationCommit(
    reservation: EmergencyIsolationDeactivationCommitReservation,
  ): void {
    try {
      reservation.abort()
    } catch {
      // Fail-closed recovery engages the traffic fence below.
    }
  }

  private tryCommitBootstrapReservation(
    reservation: EmergencyIsolationDeactivationCommitReservation,
  ): boolean {
    try {
      reservation.commit()
      return true
    } catch {
      return false
    }
  }

  private safeEnterDeactivationCommit(
    reservation: EmergencyIsolationDeactivationCommitReservation,
  ): boolean {
    try {
      return reservation.enterCommitting() === true
    } catch {
      return false
    }
  }

  private async completeWithOptionalReceipt(
    input: EmergencyIsolationCompleteInput,
    commitWithReceipt?: EmergencyIsolationCommitWithReceipt,
  ): Promise<StoredEmergencyIsolationState | null> {
    try {
      if (!commitWithReceipt) {
        return await this.store.complete(input)
      }
      return await commitWithReceipt({
        resourceId: isolationResourceId,
        run: async (transaction) => {
          const completed = await this.store.complete(input, transaction)
          if (!completed || completed.state !== input.nextState) {
            throw new EmergencyIsolationTerminalizationError()
          }
          return completed
        },
      })
    } catch {
      return null
    }
  }

  private async failClosed(
    actorSubjectId: string,
    correlationId: string,
    transitionId: string,
    failureCode: EmergencyIsolationFailureCode,
    commitWithReceipt?: EmergencyIsolationCommitWithReceipt,
  ): Promise<never> {
    const context = { correlationId, transitionId }
    const engagement = await this.safeEngage(context)
    if (engagement.status === "engaged") {
      await this.safeVerify(context)
    }
    let recovered: StoredEmergencyIsolationState | null = null
    let atomicCommitFailed = false
    try {
      const input = {
        actorSubjectId,
        at: this.now(),
        correlationId,
        failureCode,
        transitionId,
      } satisfies EmergencyIsolationRecoveryInput
      recovered = commitWithReceipt
        ? await commitWithReceipt({
            outcome: "failed",
            resourceId: isolationResourceId,
            run: async (transaction) => {
              const terminal = await this.store.forceRecoveryRequired(
                input,
                transaction,
              )
              if (!terminal || terminal.state !== "recovery_required") {
                throw new EmergencyIsolationTerminalizationError()
              }
              return terminal
            },
            statusCode: 503,
          })
        : await this.store.forceRecoveryRequired(input)
    } catch {
      // The traffic fence remains engaged even when the journal is unavailable.
      atomicCommitFailed = Boolean(commitWithReceipt)
    }
    if (atomicCommitFailed) {
      throw new EmergencyIsolationAtomicCommitError()
    }
    if (!recovered || recovered.state !== "recovery_required") {
      throw new EmergencyIsolationUnavailableError()
    }
    throw new EmergencyIsolationUnavailableError()
  }

  private async failClosedSystem(
    correlationId: string,
    transitionId: string,
    failureCode: EmergencyIsolationFailureCode,
  ): Promise<never> {
    const context = { correlationId, transitionId }
    const engagement = await this.safeEngage(context)
    if (engagement.status === "engaged") {
      await this.safeVerify(context)
    }
    let recovered: StoredEmergencyIsolationState | null = null
    try {
      recovered = await this.store.forceRecoveryRequired({
        actorSubjectId: null,
        at: this.now(),
        correlationId,
        failureCode,
        transitionId,
      })
    } catch {
      // The caller must keep its local fence closed when persistence fails.
    }
    if (!recovered || recovered.state !== "recovery_required") {
      throw new EmergencyIsolationUnavailableError()
    }
    throw new EmergencyIsolationRecoveryRequiredError(projectStatus(recovered))
  }

  private async classifyActivationNoChange(
    begin: Exclude<EmergencyIsolationBeginResult, { status: "changed" }>,
    expectedRevision: number,
    actorSubjectId: string,
    correlationId: string,
    transitionId: string,
    commitWithReceipt?: EmergencyIsolationCommitWithReceipt,
  ): Promise<EmergencyIsolationActivationResult> {
    if (begin.status === "unavailable") {
      throw new EmergencyIsolationUnavailableError()
    }
    if (begin.state.revision !== expectedRevision) {
      throw new EmergencyIsolationConflictError(begin.state.revision)
    }
    if (begin.state.state === "active") {
      const context = { correlationId, transitionId }
      const engagement = await this.safeEngage(context)
      if (engagement.status !== "engaged") {
        return await this.failClosed(
          actorSubjectId,
          correlationId,
          transitionId,
          engagement.failureCode,
          commitWithReceipt,
        )
      }
      const verification = await this.safeVerify(context)
      if (verification.status !== "verified") {
        return await this.failClosed(
          actorSubjectId,
          correlationId,
          transitionId,
          verification.failureCode,
          commitWithReceipt,
        )
      }
      return {
        ...projectStatus(begin.state),
        result: "already_active",
        state: "active",
      }
    }
    if (
      begin.state.state === "engaging" ||
      begin.state.state === "disengaging"
    ) {
      throw new EmergencyIsolationBusyError()
    }
    if (begin.state.state === "recovery_required") {
      throw new EmergencyIsolationRecoveryRequiredError(
        projectStatus(begin.state),
      )
    }
    return await this.failClosed(
      actorSubjectId,
      correlationId,
      transitionId,
      "journal_failed",
      commitWithReceipt,
    )
  }

  private async classifyDeactivationNoChange(
    begin: Exclude<EmergencyIsolationBeginResult, { status: "changed" }>,
    expectedRevision: number,
    actorSubjectId: string,
    correlationId: string,
    transitionId: string,
    commitWithReceipt?: EmergencyIsolationCommitWithReceipt,
  ): Promise<EmergencyIsolationDeactivationResult> {
    if (begin.status === "unavailable") {
      throw new EmergencyIsolationUnavailableError()
    }
    if (begin.state.revision !== expectedRevision) {
      throw new EmergencyIsolationConflictError(begin.state.revision)
    }
    if (begin.state.state === "inactive") {
      if (this.localTrafficState() !== "open") {
        return await this.failClosed(
          actorSubjectId,
          correlationId,
          transitionId,
          "journal_failed",
          commitWithReceipt,
        )
      }
      return {
        ...projectStatus(begin.state),
        result: "already_inactive",
        state: "inactive",
      }
    }
    if (
      begin.state.state === "engaging" ||
      begin.state.state === "disengaging"
    ) {
      throw new EmergencyIsolationBusyError()
    }
    if (begin.state.state === "recovery_required") {
      throw new EmergencyIsolationRecoveryRequiredError(
        projectStatus(begin.state),
      )
    }
    return await this.failClosed(
      actorSubjectId,
      correlationId,
      transitionId,
      "journal_failed",
      commitWithReceipt,
    )
  }
}

class EmergencyIsolationTerminalizationError extends Error {
  constructor() {
    super(
      "Emergency isolation terminalization did not match its CAS precondition.",
    )
    this.name = "EmergencyIsolationTerminalizationError"
  }
}

export function emergencyIsolationServiceFromRuntime(
  enforcement: EmergencyIsolationEnforcement,
  options: EmergencyIsolationServiceOptions = {},
): EmergencyIsolationService | null {
  const store = createDrizzleEmergencyIsolationStore()
  return store
    ? new EmergencyIsolationService(store, enforcement, options)
    : null
}

export function createEmergencyIsolationRestoreFenceOpener(
  service: EmergencyIsolationService,
  holdSource: EmergencyIsolationRestoreHoldSource,
  nonRestorableAuthority: EmergencyIsolationNonRestorableAuthority,
  lifecycleRestoreIsolationRecoveryAuthority: LifecycleRestoreIsolationRecoveryAuthority,
): Pick<LifecycleRestoreSafety, "openEmergencyIsolationRestoreFence"> {
  return {
    openEmergencyIsolationRestoreFence(context) {
      // Acquisition is intentionally synchronous and occurs before any await.
      const hold = holdSource.acquireRestoreHold()
      let recoveryReadBack = false
      let closed = false
      let localHoldReleased = false
      const fence: LifecycleEmergencyIsolationRestoreFence = {
        async closeAfterRecoveryRequired() {
          if (closed) {
            return
          }
          if (!recoveryReadBack) {
            throw new EmergencyIsolationUnavailableError()
          }
          await requireMatchingRecoveryMarker(
            nonRestorableAuthority,
            context.operationId,
          )
          await service.verifyRecoveryAfterRestore()
          await requireTerminalLifecycleRestore(
            lifecycleRestoreIsolationRecoveryAuthority,
            context.operationId,
          )
          if (!localHoldReleased) {
            hold.release()
            localHoldReleased = true
          }
          const cleared = await safeClearRecoveryMarker(
            nonRestorableAuthority,
            context.operationId,
          )
          if (!cleared) {
            throw new EmergencyIsolationUnavailableError()
          }
          closed = true
        },
        async reassertRecoveryRequired() {
          await requireMatchingRecoveryMarker(
            nonRestorableAuthority,
            context.operationId,
          )
          await service.requireRecoveryAfterRestore(context.operationId)
          await requireMatchingRecoveryMarker(
            nonRestorableAuthority,
            context.operationId,
          )
          recoveryReadBack = true
        },
      }
      return (async () => {
        try {
          await persistAndReadBackRecoveryMarker(
            nonRestorableAuthority,
            context.operationId,
          )
        } catch {
          try {
            await service.requireRecoveryAfterRestore(context.operationId)
          } catch {
            // The process hold remains sealed when neither authority confirms.
          }
          throw new EmergencyIsolationUnavailableError()
        }
        await service.requireRecoveryAfterRestore(context.operationId)
        return fence
      })()
    },
  }
}

export function createDrizzleEmergencyIsolationStore(
  database: InferenceCoreDatabase | null = getInferenceCoreDb(),
): EmergencyIsolationStore | null {
  return database ? new DrizzleEmergencyIsolationStore(database) : null
}

class DrizzleEmergencyIsolationStore implements EmergencyIsolationStore {
  constructor(private readonly database: InferenceCoreDatabase) {}

  async read(): Promise<StoredEmergencyIsolationState | null> {
    return await readStoredState(this.database)
  }

  async begin(
    input: EmergencyIsolationBeginInput,
  ): Promise<EmergencyIsolationBeginResult> {
    assertBeginInput(input)
    return await this.database.transaction(async (transaction) => {
      await lockState(transaction)
      const current = await readStoredState(transaction)
      if (!current) {
        return { status: "unavailable" }
      }
      if (
        current.revision !== input.expectedRevision ||
        !input.expectedStates.includes(
          current.state as EmergencyIsolationBeginInput["expectedStates"][number],
        )
      ) {
        return { state: current, status: "unchanged" }
      }
      assertRevisionCanAdvance(current.revision)

      const activatedAt =
        input.nextState === "engaging" ? null : current.activatedAt
      const activatedBySubjectId =
        input.nextState === "engaging" ? null : current.activatedBySubjectId
      const rows = await transaction
        .update(emergencyIsolationState)
        .set({
          activatedAt,
          activatedBySubjectId,
          changedBySubjectId: input.actorSubjectId,
          correlationId: input.correlationId,
          failureCode: null,
          revision: current.revision + 1,
          status: input.nextState,
          transitionId: input.transitionId,
          transitionStartedAt: input.at,
          updatedAt: input.at,
        })
        .where(eq(emergencyIsolationState.id, isolationResourceId))
        .returning()
      const next = storedStateFromRow(rows[0])
      if (!next) {
        throw new Error("Isolation transition was not persisted.")
      }
      await insertIsolationAudit(transaction, {
        action:
          input.nextState === "engaging"
            ? "emergency_isolation.activation.started"
            : "emergency_isolation.deactivation.started",
        actorSubjectId: input.actorSubjectId,
        at: input.at,
        correlationId: input.correlationId,
        outcome: "succeeded",
      })
      return { state: next, status: "changed" }
    })
  }

  async complete(
    input: EmergencyIsolationCompleteInput,
    transaction?: InferenceCoreTransaction | null,
  ): Promise<StoredEmergencyIsolationState | null> {
    assertCompleteInput(input)
    if (transaction) {
      return await this.completeInTransaction(input, transaction)
    }
    return await this.database.transaction(async (candidate) =>
      this.completeInTransaction(input, candidate),
    )
  }

  async forceRecoveryRequired(
    input: EmergencyIsolationRecoveryInput,
    transaction?: InferenceCoreTransaction | null,
  ): Promise<StoredEmergencyIsolationState | null> {
    assertRecoveryInput(input)
    if (transaction) {
      return await this.forceRecoveryInTransaction(input, transaction)
    }
    return await this.database.transaction(async (candidate) =>
      this.forceRecoveryInTransaction(input, candidate),
    )
  }

  private async forceRecoveryInTransaction(
    input: EmergencyIsolationRecoveryInput,
    transaction: InferenceCoreTransaction,
  ): Promise<StoredEmergencyIsolationState | null> {
    await lockState(transaction)
    const current = await readStoredState(transaction)
    if (!current) {
      return null
    }
    if (
      current.state === "recovery_required" &&
      input.failureCode !== "restore_reassertion_failed"
    ) {
      return current
    }
    assertRevisionCanAdvance(current.revision)
    const rows = await transaction
      .update(emergencyIsolationState)
      .set({
        changedBySubjectId: input.actorSubjectId,
        correlationId: null,
        failureCode: input.failureCode,
        revision: current.revision + 1,
        status: "recovery_required",
        transitionId: null,
        transitionStartedAt: null,
        updatedAt: input.at,
      })
      .where(eq(emergencyIsolationState.id, isolationResourceId))
      .returning()
    const recovered = storedStateFromRow(rows[0])
    if (!recovered) {
      throw new Error("Isolation recovery state was not persisted.")
    }
    await insertIsolationAudit(transaction, {
      action: "emergency_isolation.recovery_required",
      actorSubjectId: input.actorSubjectId,
      at: input.at,
      correlationId: input.correlationId,
      failureCode: input.failureCode,
      outcome: "failed",
    })
    return recovered
  }

  private async completeInTransaction(
    input: EmergencyIsolationCompleteInput,
    transaction: InferenceCoreTransaction,
  ): Promise<StoredEmergencyIsolationState | null> {
    await lockState(transaction)
    const current = await readStoredState(transaction)
    if (
      !current ||
      current.state !== input.expectedState ||
      current.revision !== input.expectedRevision ||
      current.transitionId !== input.transitionId
    ) {
      return null
    }
    assertRevisionCanAdvance(current.revision)

    const activatedAt = input.nextState === "active" ? input.at : null
    const activatedBySubjectId =
      input.nextState === "active" ? current.changedBySubjectId : null
    const rows = await transaction
      .update(emergencyIsolationState)
      .set({
        activatedAt,
        activatedBySubjectId,
        correlationId: null,
        failureCode: null,
        revision: current.revision + 1,
        status: input.nextState,
        transitionId: null,
        transitionStartedAt: null,
        updatedAt: input.at,
      })
      .where(eq(emergencyIsolationState.id, isolationResourceId))
      .returning()
    const completed = storedStateFromRow(rows[0])
    if (!completed) {
      throw new Error("Isolation completion was not persisted.")
    }
    await insertIsolationAudit(transaction, {
      action:
        input.nextState === "active"
          ? "emergency_isolation.activated"
          : "emergency_isolation.deactivated",
      actorSubjectId: current.changedBySubjectId,
      at: input.at,
      correlationId: current.correlationId ?? input.transitionId,
      outcome: "succeeded",
    })
    if (input.beforeCommit && input.beforeCommit() !== true) {
      throw new EmergencyIsolationTerminalizationError()
    }
    return completed
  }
}

export class InMemoryEmergencyIsolationStore
  implements EmergencyIsolationStore
{
  readonly audits: Array<{
    action: string
    actorSubjectId: string | null
    correlationId: string
    failureCode: EmergencyIsolationFailureCode | null
    outcome: "failed" | "succeeded"
  }> = []
  state: StoredEmergencyIsolationState | null

  constructor(initial: StoredEmergencyIsolationState | null = initialState()) {
    this.state = initial ? cloneStoredState(initial) : null
  }

  async read(): Promise<StoredEmergencyIsolationState | null> {
    return this.state ? cloneStoredState(this.state) : null
  }

  async begin(
    input: EmergencyIsolationBeginInput,
  ): Promise<EmergencyIsolationBeginResult> {
    assertBeginInput(input)
    const current = this.state
    if (!current) {
      return { status: "unavailable" }
    }
    if (
      current.revision !== input.expectedRevision ||
      !input.expectedStates.includes(
        current.state as EmergencyIsolationBeginInput["expectedStates"][number],
      )
    ) {
      return { state: cloneStoredState(current), status: "unchanged" }
    }
    assertRevisionCanAdvance(current.revision)
    this.state = {
      ...current,
      activatedAt: input.nextState === "engaging" ? null : current.activatedAt,
      activatedBySubjectId:
        input.nextState === "engaging" ? null : current.activatedBySubjectId,
      changedBySubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      failureCode: null,
      revision: current.revision + 1,
      state: input.nextState,
      transitionId: input.transitionId,
      transitionStartedAt: input.at,
      updatedAt: input.at,
    }
    this.audits.push({
      action:
        input.nextState === "engaging"
          ? "emergency_isolation.activation.started"
          : "emergency_isolation.deactivation.started",
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      failureCode: null,
      outcome: "succeeded",
    })
    return { state: cloneStoredState(this.state), status: "changed" }
  }

  async complete(
    input: EmergencyIsolationCompleteInput,
    _transaction?: InferenceCoreTransaction | null,
  ): Promise<StoredEmergencyIsolationState | null> {
    assertCompleteInput(input)
    const current = this.state
    if (
      !current ||
      current.state !== input.expectedState ||
      current.revision !== input.expectedRevision ||
      current.transitionId !== input.transitionId
    ) {
      return null
    }
    assertRevisionCanAdvance(current.revision)
    const completed: StoredEmergencyIsolationState = {
      ...current,
      activatedAt: input.nextState === "active" ? input.at : null,
      activatedBySubjectId:
        input.nextState === "active" ? current.changedBySubjectId : null,
      correlationId: null,
      failureCode: null,
      revision: current.revision + 1,
      state: input.nextState,
      transitionId: null,
      transitionStartedAt: null,
      updatedAt: input.at,
    }
    const audit = {
      action:
        input.nextState === "active"
          ? "emergency_isolation.activated"
          : "emergency_isolation.deactivated",
      actorSubjectId: current.changedBySubjectId,
      correlationId: current.correlationId ?? input.transitionId,
      failureCode: null,
      outcome: "succeeded",
    } as const
    if (input.beforeCommit && input.beforeCommit() !== true) {
      throw new EmergencyIsolationTerminalizationError()
    }
    this.state = completed
    this.audits.push(audit)
    return cloneStoredState(completed)
  }

  async forceRecoveryRequired(
    input: EmergencyIsolationRecoveryInput,
    _transaction?: InferenceCoreTransaction | null,
  ): Promise<StoredEmergencyIsolationState | null> {
    assertRecoveryInput(input)
    const current = this.state
    if (!current) {
      return null
    }
    if (
      current.state === "recovery_required" &&
      input.failureCode !== "restore_reassertion_failed"
    ) {
      return cloneStoredState(current)
    }
    assertRevisionCanAdvance(current.revision)
    this.state = {
      ...current,
      changedBySubjectId: input.actorSubjectId,
      correlationId: null,
      failureCode: input.failureCode,
      revision: current.revision + 1,
      state: "recovery_required",
      transitionId: null,
      transitionStartedAt: null,
      updatedAt: input.at,
    }
    this.audits.push({
      action: "emergency_isolation.recovery_required",
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      failureCode: input.failureCode,
      outcome: "failed",
    })
    return cloneStoredState(this.state)
  }
}

export class InMemoryEmergencyIsolationNonRestorableAuthority
  implements EmergencyIsolationNonRestorableAuthority
{
  marker: unknown

  constructor(marker: unknown = null) {
    this.marker = cloneRecoveryMarker(marker)
  }

  async clearRecoveryRequiredAndConfirm(operationId: string): Promise<boolean> {
    if (!uuid(operationId)) {
      return false
    }
    const current = parseRecoveryMarker(this.marker)
    if (current === undefined) {
      return false
    }
    if (!current || current.operationId !== operationId) {
      return false
    }
    this.marker = null
    return true
  }

  async persistRecoveryRequired(operationId: string): Promise<boolean> {
    if (!uuid(operationId)) {
      return false
    }
    const current = parseRecoveryMarker(this.marker)
    if (current === undefined) {
      return false
    }
    if (current && current.operationId !== operationId) {
      return false
    }
    this.marker = { operationId, state: "recovery_required" }
    return true
  }

  async readRecoveryRequired(): Promise<unknown> {
    return cloneRecoveryMarker(this.marker)
  }
}

export function initialState(): StoredEmergencyIsolationState {
  return {
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
    updatedAt: new Date(0),
  }
}

function standingAdminDenial(
  authentication: EmergencyIsolationAuthenticationProof,
  liveIdentity: EmergencyIsolationLiveIdentity,
  now: Date,
): EmergencyIsolationDenialReason | null {
  if (!liveIdentity.enabled) {
    return "identity_disabled"
  }
  if (liveIdentity.role !== "admin") {
    return "identity_not_admin"
  }
  if (
    authentication.keycloakSubjectId !== liveIdentity.keycloakSubjectId ||
    !validSubject(authentication.keycloakSubjectId)
  ) {
    return "identity_mismatch"
  }
  if (authentication.authMode !== "keycloak") {
    return "keycloak_authentication_required"
  }
  const nowSeconds = Math.floor(now.getTime() / 1000)
  if (
    !Number.isSafeInteger(authentication.authTime) ||
    authentication.authTime > nowSeconds ||
    nowSeconds - authentication.authTime > recentAuthenticationWindowSeconds
  ) {
    return "recent_authentication_required"
  }
  const approved = new Set<string>(emergencyRecoveryApprovedMfaMethods)
  return authentication.amr.some((method) => approved.has(method))
    ? null
    : "mfa_required"
}

function projectStatus(
  state: StoredEmergencyIsolationState,
): EmergencyIsolationStatus {
  return emergencyIsolationStatusSchema.parse({
    activatedAt: state.activatedAt?.toISOString() ?? null,
    activatedBySubjectId: state.activatedBySubjectId,
    effectiveTrafficState: state.state === "inactive" ? "open" : "sealed",
    failureCode: state.failureCode,
    revision: state.revision,
    runtimeQualified: false,
    state: state.state,
    updatedAt: state.updatedAt.toISOString(),
    updatedBySubjectId: state.changedBySubjectId,
  })
}

async function lockState(transaction: InferenceCoreTransaction): Promise<void> {
  await transaction.execute(sql`
    SELECT id
    FROM ${emergencyIsolationState}
    WHERE ${emergencyIsolationState.id} = ${isolationResourceId}
    FOR UPDATE
  `)
}

async function readStoredState(
  executor: InferenceCoreQueryExecutor,
): Promise<StoredEmergencyIsolationState | null> {
  const rows = await executor.select().from(emergencyIsolationState)
  return rows.length === 1 ? storedStateFromRow(rows[0]) : null
}

function storedStateFromRow(
  row: typeof emergencyIsolationState.$inferSelect | undefined,
): StoredEmergencyIsolationState | null {
  const parsedState = emergencyIsolationStateSchema.safeParse(row?.status)
  const parsedFailure =
    row?.failureCode === null
      ? { data: null, success: true as const }
      : emergencyIsolationFailureCodeSchema.safeParse(row?.failureCode)
  if (
    !row ||
    row.id !== isolationResourceId ||
    !parsedState.success ||
    !parsedFailure.success ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 0 ||
    !validDate(row.updatedAt) ||
    !nullableDate(row.activatedAt) ||
    !nullableDate(row.transitionStartedAt)
  ) {
    return null
  }
  const candidate: StoredEmergencyIsolationState = {
    activatedAt: row.activatedAt,
    activatedBySubjectId: row.activatedBySubjectId,
    changedBySubjectId: row.changedBySubjectId,
    correlationId: row.correlationId,
    failureCode: parsedFailure.data,
    id: "appliance",
    revision: row.revision,
    state: parsedState.data,
    transitionId: row.transitionId,
    transitionStartedAt: row.transitionStartedAt,
    updatedAt: row.updatedAt,
  }
  try {
    projectStatus(candidate)
    assertInternalMetadata(candidate)
    return candidate
  } catch {
    return null
  }
}

async function insertIsolationAudit(
  transaction: InferenceCoreTransaction,
  input: {
    action: string
    actorSubjectId: string | null
    at: Date
    correlationId: string
    failureCode?: EmergencyIsolationFailureCode
    outcome: "failed" | "succeeded"
  },
): Promise<void> {
  await transaction.insert(auditEvents).values({
    action: input.action,
    applicationId: null,
    correlationId: input.correlationId,
    credentialPrefix: null,
    credentialRecordId: null,
    id: randomUUID(),
    keycloakSubjectId: input.actorSubjectId,
    occurredAt: input.at,
    outcome: input.outcome,
    recoveryReasonCode: input.failureCode ?? null,
    sourceSystem: "lifecycle",
  })
}

function assertInternalMetadata(state: StoredEmergencyIsolationState): void {
  const transitioning =
    state.state === "engaging" || state.state === "disengaging"
  if (state.revision === 0) {
    if (
      state.state !== "inactive" ||
      state.changedBySubjectId !== null ||
      state.failureCode !== null ||
      state.activatedAt !== null ||
      state.activatedBySubjectId !== null ||
      state.transitionId !== null ||
      state.correlationId !== null ||
      state.transitionStartedAt !== null
    ) {
      throw new Error("Invalid isolation seed metadata.")
    }
    return
  }
  if (
    state.revision < 1 ||
    (state.state !== "recovery_required" &&
      state.changedBySubjectId === null) ||
    (state.activatedAt !== null &&
      state.activatedAt.getTime() > state.updatedAt.getTime())
  ) {
    throw new Error("Invalid isolation revision metadata.")
  }
  if (
    transitioning !==
      Boolean(
        state.transitionId && state.correlationId && state.transitionStartedAt,
      ) ||
    (transitioning &&
      (!uuid(state.transitionId ?? "") ||
        !validCorrelationId(state.correlationId ?? "") ||
        (state.transitionStartedAt?.getTime() ?? Number.POSITIVE_INFINITY) >
          state.updatedAt.getTime())) ||
    (!transitioning &&
      (state.transitionId !== null ||
        state.correlationId !== null ||
        state.transitionStartedAt !== null))
  ) {
    throw new Error("Invalid isolation transition metadata.")
  }
}

function assertBeginInput(input: EmergencyIsolationBeginInput): void {
  const expectedStates = new Set(input.expectedStates)
  const legalActivation =
    input.nextState === "engaging" &&
    input.expectedStates.length === 2 &&
    expectedStates.size === 2 &&
    expectedStates.has("inactive") &&
    expectedStates.has("recovery_required")
  const legalDeactivation =
    input.nextState === "disengaging" &&
    input.expectedStates.length === 1 &&
    expectedStates.size === 1 &&
    expectedStates.has("active")
  if (
    !validSubject(input.actorSubjectId) ||
    !validDate(input.at) ||
    !validCorrelationId(input.correlationId) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    !uuid(input.transitionId) ||
    (!legalActivation && !legalDeactivation)
  ) {
    throw new Error("Invalid isolation transition input.")
  }
}

function assertRevisionCanAdvance(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Isolation revision cannot advance safely.")
  }
}

function assertCompleteInput(input: EmergencyIsolationCompleteInput): void {
  if (
    !validDate(input.at) ||
    (input.beforeCommit !== undefined &&
      typeof input.beforeCommit !== "function") ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 1 ||
    !uuid(input.transitionId) ||
    !(
      (input.expectedState === "engaging" && input.nextState === "active") ||
      (input.expectedState === "disengaging" && input.nextState === "inactive")
    )
  ) {
    throw new Error("Invalid isolation completion input.")
  }
}

function assertRecoveryInput(input: EmergencyIsolationRecoveryInput): void {
  if (
    (input.actorSubjectId !== null && !validSubject(input.actorSubjectId)) ||
    !validDate(input.at) ||
    !validCorrelationId(input.correlationId) ||
    !emergencyIsolationFailureCodeSchema.safeParse(input.failureCode).success ||
    !uuid(input.transitionId)
  ) {
    throw new Error("Invalid isolation recovery input.")
  }
}

function validEngagementResult(
  value: unknown,
): value is EmergencyIsolationEngagementResult {
  return (
    isExactStatus(value, "engaged") ||
    (isExactFailed(value) &&
      (value.failureCode === "admission_fence_failed" ||
        value.failureCode === "enforcement_failed" ||
        value.failureCode === "inflight_abort_failed"))
  )
}

function validVerificationResult(
  value: unknown,
): value is EmergencyIsolationVerificationResult {
  return (
    isExactStatus(value, "verified") ||
    (isExactFailed(value) &&
      (value.failureCode === "enforcement_failed" ||
        value.failureCode === "verification_failed"))
  )
}

function validDisengagementResult(
  value: unknown,
): value is EmergencyIsolationDisengagementPreparationResult {
  return (
    (isRecord(value) &&
      Object.keys(value).sort().join(",") ===
        "deactivationCommitReservation,status" &&
      value.status === "prepared" &&
      validDeactivationCommitReservation(
        value.deactivationCommitReservation,
      )) ||
    (isExactFailed(value) &&
      (value.failureCode === "enforcement_failed" ||
        value.failureCode === "verification_failed"))
  )
}

function validDeactivationCommitReservation(
  value: unknown,
): value is EmergencyIsolationDeactivationCommitReservation {
  return (
    isRecord(value) &&
    typeof value.abort === "function" &&
    typeof value.commit === "function" &&
    typeof value.enterCommitting === "function"
  )
}

function isExactStatus(value: unknown, status: string): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    value.status === status
  )
}

function isExactFailed(
  value: unknown,
): value is { failureCode: unknown; status: "failed" } {
  return (
    isRecord(value) &&
    Object.keys(value).sort().join(",") === "failureCode,status" &&
    value.status === "failed"
  )
}

function cloneStoredState(
  state: StoredEmergencyIsolationState,
): StoredEmergencyIsolationState {
  return {
    ...state,
    activatedAt: state.activatedAt ? new Date(state.activatedAt) : null,
    transitionStartedAt: state.transitionStartedAt
      ? new Date(state.transitionStartedAt)
      : null,
    updatedAt: new Date(state.updatedAt),
  }
}

async function persistAndReadBackRecoveryMarker(
  authority: EmergencyIsolationNonRestorableAuthority,
  operationId: string,
): Promise<void> {
  if (!uuid(operationId)) {
    throw new EmergencyIsolationUnavailableError()
  }
  let persisted = false
  try {
    persisted = await authority.persistRecoveryRequired(operationId)
  } catch {
    // The process-local hold remains active when the durable marker is unknown.
  }
  if (!persisted) {
    throw new EmergencyIsolationUnavailableError()
  }
  await requireMatchingRecoveryMarker(authority, operationId)
}

function requireNonRestorableAuthority(
  authority: EmergencyIsolationNonRestorableAuthority | null,
): EmergencyIsolationNonRestorableAuthority {
  if (!authority) {
    throw new EmergencyIsolationUnavailableError()
  }
  return authority
}

function requireLifecycleRestoreIsolationRecoveryAuthority(
  authority: LifecycleRestoreIsolationRecoveryAuthority | null,
): LifecycleRestoreIsolationRecoveryAuthority {
  if (!authority) {
    throw new EmergencyIsolationUnavailableError()
  }
  return authority
}

async function requireTerminalLifecycleRestore(
  authority: LifecycleRestoreIsolationRecoveryAuthority,
  operationId: string,
): Promise<void> {
  let raw: unknown
  try {
    raw = await authority.readRestoreOperation(operationId)
  } catch {
    throw new EmergencyIsolationUnavailableError()
  }
  const operation = parseLifecycleRestoreOperation(raw)
  if (
    !operation ||
    operation.operationId !== operationId ||
    !terminalLifecycleRestoreStates.has(operation.state)
  ) {
    throw new EmergencyIsolationUnavailableError()
  }
}

function parseLifecycleRestoreOperation(
  value: unknown,
): LifecycleRestoreOperationStatus | null | undefined {
  if (value === null) {
    return null
  }
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(",") !== "kind,operationId,state" ||
    value.kind !== "restore" ||
    typeof value.operationId !== "string" ||
    !uuid(value.operationId)
  ) {
    return undefined
  }
  const state = lifecycleOperationStateSchema.safeParse(value.state)
  if (!state.success) {
    return undefined
  }
  return {
    kind: "restore",
    operationId: value.operationId,
    state: state.data,
  }
}

function parseLifecycleUnfencedRestore(
  value: unknown,
): LifecycleUnfencedRestoreOperation | null | undefined {
  const operation = parseLifecycleRestoreOperation(value)
  if (operation === null || operation === undefined) {
    return operation
  }
  if (
    operation.state !== "prepared" &&
    operation.state !== "recovery_required"
  ) {
    return undefined
  }
  return { ...operation, state: operation.state }
}

async function requireMatchingRecoveryMarker(
  authority: EmergencyIsolationNonRestorableAuthority,
  operationId: string,
): Promise<void> {
  const marker = await safeReadRecoveryMarker(authority)
  if (!marker || marker.operationId !== operationId) {
    throw new EmergencyIsolationUnavailableError()
  }
}

async function safeClearRecoveryMarker(
  authority: EmergencyIsolationNonRestorableAuthority,
  operationId: string,
): Promise<boolean> {
  try {
    return await authority.clearRecoveryRequiredAndConfirm(operationId)
  } catch {
    return false
  }
}

async function safeReadRecoveryMarker(
  authority: EmergencyIsolationNonRestorableAuthority,
): Promise<EmergencyIsolationRecoveryMarker | null> {
  let raw: unknown
  try {
    raw = await authority.readRecoveryRequired()
  } catch {
    throw new EmergencyIsolationUnavailableError()
  }
  const marker = parseRecoveryMarker(raw)
  if (marker === undefined) {
    throw new EmergencyIsolationUnavailableError()
  }
  return marker
}

function parseRecoveryMarker(
  value: unknown,
): EmergencyIsolationRecoveryMarker | null | undefined {
  if (value === null) {
    return null
  }
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(",") !== "operationId,state" ||
    value.state !== "recovery_required" ||
    typeof value.operationId !== "string" ||
    !uuid(value.operationId)
  ) {
    return undefined
  }
  return {
    operationId: value.operationId,
    state: "recovery_required",
  }
}

function cloneRecoveryMarker(value: unknown): unknown {
  if (Array.isArray(value)) {
    return [...value]
  }
  return isRecord(value) ? { ...value } : value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nullableDate(value: Date | null | undefined): boolean {
  return value === null || validDate(value)
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime())
}

function validSubject(value: string): boolean {
  return value.length >= 1 && value.length <= 255
}

function validCorrelationId(value: string): boolean {
  return value.length >= 1 && value.length <= 128
}

function requireCorrelationId(value: string): void {
  if (!validCorrelationId(value)) {
    throw new EmergencyIsolationUnavailableError()
  }
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}
