import {
  type EmergencyIsolationStatus,
  emergencyIsolationStatusSchema,
} from "@llm-machines/contracts/inference-core"
import type {
  EmergencyIsolationDeactivationCommitReservation,
  EmergencyIsolationDisengagementPreparationResult,
  EmergencyIsolationEnforcement,
  EmergencyIsolationEnforcementContext,
  EmergencyIsolationEngagementResult,
  EmergencyIsolationRestoreHold,
  EmergencyIsolationVerificationResult,
} from "./emergency-isolation"

const defaultDrainTimeoutMs = 5_000

export interface IsolationTrafficAdmissionInput {
  appId: string
  correlationId: string
  credentialRecordId: string
  route: "chat_completions" | "firecrawl_scrape" | "firecrawl_search" | "models"
  signal?: AbortSignal
}

export interface IsolationTrafficLease {
  /** Reserves one terminal accounting and response commit against engagement. */
  finalize<T>(
    operation: () => Promise<T>,
  ): Promise<IsolationTrafficFinalizationResult<T>>
  release(): void
  signal: AbortSignal
}

export type IsolationTrafficFinalizationResult<T> =
  | { ok: false }
  | { ok: true; value: T }

export type IsolationTrafficAdmissionResult =
  | { lease: IsolationTrafficLease; ok: true }
  | { ok: false }

export interface IsolationTrafficAuthority {
  read(): Promise<unknown>
}

export interface IsolationTrafficGateOptions {
  drainTimeoutMs?: number
}

interface ActiveTrafficLease {
  controller: AbortController
  detachCallerAbort: () => void
  finalizing: boolean
  id: symbol
}

interface DeactivationCommitReservationState {
  generation: number
  phase: "committing" | "reserved"
  resolve: () => void
  resolved: Promise<void>
  restoreSealPending: boolean
}

/** A fixed, content-free abort reason shared by inference and Firecrawl. */
export class EmergencyIsolationAbortError extends Error {
  constructor() {
    super("Emergency isolation sealed third-party traffic.")
    this.name = "EmergencyIsolationAbortError"
  }
}

/**
 * Process-local admission and abort registry. Durable authority is consulted
 * for every admission; a runtime watcher may also call refresh after state or
 * database-health changes. The local default is sealed.
 */
export class IsolationTrafficGate implements EmergencyIsolationEnforcement {
  private readonly active = new Map<symbol, ActiveTrafficLease>()
  private readonly drainTimeoutMs: number
  private readonly restoreHolds = new Set<symbol>()
  private readonly zeroWaiters = new Set<() => void>()
  private deactivationCommitReservation: DeactivationCommitReservationState | null =
    null
  private localState: "prepared" | "sealed" = "sealed"
  private pendingUncertaintyRecoveryGeneration: number | null = null
  private preparedGeneration: number | null = null
  private reconciled = false
  private sealGeneration = 0
  private uncertaintyLatched = false

  constructor(
    private readonly authority: IsolationTrafficAuthority,
    options: IsolationTrafficGateOptions = {},
  ) {
    this.drainTimeoutMs = boundedDrainTimeout(options.drainTimeoutMs)
  }

  async admit(
    input: IsolationTrafficAdmissionInput,
  ): Promise<IsolationTrafficAdmissionResult> {
    if (
      this.deactivationCommitReservation ||
      this.restoreHolds.size !== 0 ||
      !validAdmissionInput(input)
    ) {
      return { ok: false }
    }

    const admissionGeneration = this.sealGeneration
    const authorityRead = await readAuthorityUnlessCallerAborted(
      () => this.readAuthority(),
      input.signal,
    )
    if (authorityRead.aborted) {
      return { ok: false }
    }
    const authority = authorityRead.value
    if (this.deactivationCommitReservation) {
      return { ok: false }
    }
    if (!authority || !trafficIsOpen(authority)) {
      const sealed = authority ? this.seal() : this.latchUncertainty()
      const drained = await this.drain()
      if (sealed === this.sealGeneration) {
        this.reconciled = Boolean(authority) && drained
      }
      return { ok: false }
    }
    if (this.uncertaintyLatched) {
      return { ok: false }
    }
    if (!this.canAdmit(admissionGeneration)) {
      return { ok: false }
    }

    const id = Symbol(input.correlationId)
    const controller = new AbortController()
    const detachCallerAbort = bindCallerAbort(input.signal, controller, () => {
      const active = this.active.get(id)
      if (!active?.finalizing) {
        this.release(id)
      }
    })
    if (!this.canAdmit(admissionGeneration)) {
      detachCallerAbort()
      return { ok: false }
    }
    this.active.set(id, {
      controller,
      detachCallerAbort,
      finalizing: false,
      id,
    })
    if (input.signal?.aborted || !this.canAdmit(admissionGeneration)) {
      if (input.signal?.aborted && !controller.signal.aborted) {
        controller.abort(input.signal.reason)
      }
      this.release(id)
      return { ok: false }
    }
    let released = false
    let finalizationStarted = false
    return {
      lease: {
        finalize: async <T>(
          operation: () => Promise<T>,
        ): Promise<IsolationTrafficFinalizationResult<T>> => {
          const active = this.active.get(id)
          if (
            released ||
            finalizationStarted ||
            !active ||
            active.controller.signal.aborted ||
            !this.canAdmit(admissionGeneration)
          ) {
            return { ok: false }
          }
          finalizationStarted = true
          active.finalizing = true
          return { ok: true, value: await operation() }
        },
        release: () => {
          if (released) {
            return
          }
          released = true
          this.release(id)
        },
        signal: controller.signal,
      },
      ok: true,
    }
  }

  async refresh(): Promise<EmergencyIsolationStatus | null> {
    if (this.deactivationCommitReservation || this.restoreHolds.size !== 0) {
      return null
    }
    const refreshGeneration = this.sealGeneration
    const authority = await this.readAuthority()
    if (this.deactivationCommitReservation) {
      return null
    }
    if (!authority || !trafficIsOpen(authority)) {
      const sealed = authority ? this.seal() : this.latchUncertainty()
      const drained = await this.drain()
      if (sealed === this.sealGeneration) {
        this.reconciled = Boolean(authority) && drained
      }
      return authority
    }
    if (this.uncertaintyLatched) {
      return null
    }
    if (refreshGeneration !== this.sealGeneration) {
      return null
    }
    return this.openForGeneration(internalContext, refreshGeneration)
      ? authority
      : null
  }

  async engage(
    context: EmergencyIsolationEnforcementContext,
  ): Promise<EmergencyIsolationEngagementResult> {
    while (this.deactivationCommitReservation) {
      const reservation = this.deactivationCommitReservation
      if (reservation.phase === "reserved") {
        this.abortDeactivationCommitReservation(reservation)
        break
      }
      await reservation.resolved
    }
    // Invalidate every outstanding authority read before this method can yield.
    const engagementGeneration = this.seal()
    if (!validContext(context)) {
      await this.drain()
      return { failureCode: "admission_fence_failed", status: "failed" }
    }
    const engaged = await this.drain()
    if (engagementGeneration === this.sealGeneration) {
      this.reconciled = engaged
      this.pendingUncertaintyRecoveryGeneration =
        engaged && this.uncertaintyLatched ? engagementGeneration : null
    }
    return engaged
      ? { status: "engaged" }
      : { failureCode: "inflight_abort_failed", status: "failed" }
  }

  async verifyEngaged(
    context: EmergencyIsolationEnforcementContext,
  ): Promise<EmergencyIsolationVerificationResult> {
    const verified =
      validContext(context) &&
      this.localState === "sealed" &&
      this.active.size === 0
    if (
      verified &&
      this.pendingUncertaintyRecoveryGeneration === this.sealGeneration
    ) {
      this.uncertaintyLatched = false
      this.pendingUncertaintyRecoveryGeneration = null
    }
    return verified
      ? { status: "verified" }
      : { failureCode: "verification_failed", status: "failed" }
  }

  async prepareDisengage(
    context: EmergencyIsolationEnforcementContext,
  ): Promise<EmergencyIsolationDisengagementPreparationResult> {
    if (
      !validContext(context) ||
      this.active.size !== 0 ||
      this.deactivationCommitReservation ||
      this.localState !== "sealed" ||
      this.restoreHolds.size !== 0 ||
      this.uncertaintyLatched
    ) {
      return { failureCode: "verification_failed", status: "failed" }
    }

    const generation = this.seal()
    let resolveReservation: (() => void) | undefined
    const resolved = new Promise<void>((resolve) => {
      resolveReservation = resolve
    })
    if (!resolveReservation) {
      return { failureCode: "enforcement_failed", status: "failed" }
    }
    const state: DeactivationCommitReservationState = {
      generation,
      phase: "reserved",
      resolve: resolveReservation,
      resolved,
      restoreSealPending: false,
    }
    this.deactivationCommitReservation = state
    const deactivationCommitReservation: EmergencyIsolationDeactivationCommitReservation =
      {
        abort: () => this.abortDeactivationCommitReservation(state),
        commit: () => this.commitDeactivationCommitReservation(state),
        enterCommitting: () =>
          this.enterCommittingDeactivationReservation(state),
      }
    return { deactivationCommitReservation, status: "prepared" }
  }

  acquireRestoreHold(): EmergencyIsolationRestoreHold {
    const id = Symbol("emergency-isolation-restore-hold")
    this.restoreHolds.add(id)
    const reservation = this.deactivationCommitReservation
    if (reservation?.phase === "committing") {
      reservation.restoreSealPending = true
    } else {
      if (reservation) {
        this.abortDeactivationCommitReservation(reservation)
      }
      this.seal()
    }
    let released = false
    return {
      release: () => {
        if (released) {
          return
        }
        released = true
        this.restoreHolds.delete(id)
      },
    }
  }

  effectiveTrafficState(): "open" | "sealed" | "uncertain" {
    if (this.localState === "sealed" && this.active.size === 0) {
      return "sealed"
    }
    if (
      this.localState === "prepared" &&
      this.restoreHolds.size === 0 &&
      !this.uncertaintyLatched
    ) {
      return "open"
    }
    return "uncertain"
  }

  restoreHoldCountForTest(): number {
    return this.restoreHolds.size
  }

  uncertaintyLatchedForTest(): boolean {
    return this.uncertaintyLatched
  }

  stateForTest(): {
    activeLeases: number
    localState: "prepared" | "sealed"
    reconciled: boolean
  } {
    return {
      activeLeases: this.active.size,
      localState: this.localState,
      reconciled: this.reconciled,
    }
  }

  private async readAuthority(): Promise<EmergencyIsolationStatus | null> {
    try {
      const parsed = emergencyIsolationStatusSchema.safeParse(
        await this.authority.read(),
      )
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  private canAdmit(generation: number): boolean {
    return (
      generation === this.sealGeneration &&
      this.preparedGeneration === generation &&
      this.reconciled &&
      this.localState === "prepared"
    )
  }

  private async drain(): Promise<boolean> {
    return this.active.size === 0
      ? true
      : await this.waitForZero(this.drainTimeoutMs)
  }

  private openForGeneration(
    context: EmergencyIsolationEnforcementContext,
    generation: number,
  ): boolean {
    if (
      !validContext(context) ||
      this.active.size !== 0 ||
      this.deactivationCommitReservation ||
      this.uncertaintyLatched ||
      generation !== this.sealGeneration
    ) {
      return false
    }
    this.reconciled = true
    this.localState = "prepared"
    this.preparedGeneration = generation
    return true
  }

  private abortDeactivationCommitReservation(
    reservation: DeactivationCommitReservationState,
  ): void {
    if (this.deactivationCommitReservation !== reservation) {
      return
    }
    this.localState = "sealed"
    this.preparedGeneration = null
    this.reconciled = false
    this.deactivationCommitReservation = null
    reservation.resolve()
  }

  private commitDeactivationCommitReservation(
    reservation: DeactivationCommitReservationState,
  ): void {
    if (
      this.deactivationCommitReservation !== reservation ||
      reservation.phase !== "committing" ||
      reservation.generation !== this.sealGeneration ||
      this.active.size !== 0 ||
      this.localState !== "sealed" ||
      this.uncertaintyLatched
    ) {
      this.abortDeactivationCommitReservation(reservation)
      throw new Error(
        "Deactivation commit reservation invariant was violated after durable commit.",
      )
    }

    this.localState = "prepared"
    this.preparedGeneration = reservation.generation
    this.reconciled = true
    this.deactivationCommitReservation = null
    reservation.resolve()
    if (reservation.restoreSealPending || this.restoreHolds.size !== 0) {
      this.seal()
    }
  }

  private enterCommittingDeactivationReservation(
    reservation: DeactivationCommitReservationState,
  ): boolean {
    if (
      this.deactivationCommitReservation !== reservation ||
      reservation.phase !== "reserved" ||
      reservation.generation !== this.sealGeneration ||
      this.active.size !== 0 ||
      this.localState !== "sealed" ||
      this.restoreHolds.size !== 0 ||
      this.uncertaintyLatched
    ) {
      return false
    }
    reservation.phase = "committing"
    return true
  }

  private seal(): number {
    this.sealGeneration += 1
    this.localState = "sealed"
    this.pendingUncertaintyRecoveryGeneration = null
    this.preparedGeneration = null
    this.reconciled = false
    for (const lease of this.active.values()) {
      // A terminal commit that won first must finish before engagement can drain.
      if (!lease.finalizing && !lease.controller.signal.aborted) {
        lease.controller.abort(new EmergencyIsolationAbortError())
      }
    }
    return this.sealGeneration
  }

  private latchUncertainty(): number {
    this.uncertaintyLatched = true
    this.pendingUncertaintyRecoveryGeneration = null
    return this.seal()
  }

  private waitForZero(timeoutMs: number): Promise<boolean> {
    if (this.active.size === 0) {
      return Promise.resolve(true)
    }
    return new Promise((resolve) => {
      let settled = false
      const finish = (result: boolean) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        this.zeroWaiters.delete(onZero)
        resolve(result)
      }
      const onZero = () => finish(true)
      const timeout = setTimeout(() => finish(false), timeoutMs)
      this.zeroWaiters.add(onZero)
      if (this.active.size === 0) {
        finish(true)
      }
    })
  }

  private release(id: symbol): void {
    const lease = this.active.get(id)
    if (!lease) {
      return
    }
    lease.detachCallerAbort()
    this.active.delete(id)
    if (this.active.size !== 0) {
      return
    }
    for (const resolve of [...this.zeroWaiters]) {
      resolve()
    }
  }
}

const internalContext = {
  correlationId: "isolation-traffic-gate",
  transitionId: "00000000-0000-4000-8000-000000000000",
} satisfies EmergencyIsolationEnforcementContext

function trafficIsOpen(status: EmergencyIsolationStatus): boolean {
  return status.state === "inactive" && status.effectiveTrafficState === "open"
}

function validAdmissionInput(input: IsolationTrafficAdmissionInput): boolean {
  return (
    boundedText(input.appId, 128) &&
    boundedText(input.correlationId, 128) &&
    boundedText(input.credentialRecordId, 128) &&
    [
      "models",
      "chat_completions",
      "firecrawl_search",
      "firecrawl_scrape",
    ].includes(input.route) &&
    !input.signal?.aborted
  )
}

function validContext(context: EmergencyIsolationEnforcementContext): boolean {
  return (
    boundedText(context.correlationId, 128) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      context.transitionId,
    )
  )
}

function boundedText(value: string, maximum: number): boolean {
  return value.length >= 1 && value.length <= maximum
}

function boundedDrainTimeout(value?: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) >= 1
    ? Math.min(value ?? defaultDrainTimeoutMs, 60_000)
    : defaultDrainTimeoutMs
}

async function readAuthorityUnlessCallerAborted(
  readAuthority: () => Promise<EmergencyIsolationStatus | null>,
  signal?: AbortSignal,
): Promise<
  { aborted: false; value: EmergencyIsolationStatus | null } | { aborted: true }
> {
  if (!signal) {
    return { aborted: false, value: await readAuthority() }
  }
  if (signal.aborted) {
    return { aborted: true }
  }

  let onAbort: (() => void) | undefined
  const callerAbort = new Promise<{ aborted: true }>((resolve) => {
    onAbort = () => resolve({ aborted: true })
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
    }
  })
  try {
    return await Promise.race([
      readAuthority().then((value) => ({ aborted: false as const, value })),
      callerAbort,
    ])
  } finally {
    if (onAbort) {
      signal.removeEventListener("abort", onAbort)
    }
  }
}

function bindCallerAbort(
  signal: AbortSignal | undefined,
  controller: AbortController,
  release: () => void,
): () => void {
  if (!signal) {
    return () => undefined
  }
  const onAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason)
    }
    release()
  }
  signal.addEventListener("abort", onAbort, { once: true })
  return () => signal.removeEventListener("abort", onAbort)
}
