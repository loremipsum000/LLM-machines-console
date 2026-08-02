import type { EmergencyIsolationStatus } from "@llm-machines/contracts/inference-core"
import { describe, expect, it } from "vitest"
import {
  EmergencyIsolationAbortError,
  type IsolationTrafficAuthority,
  IsolationTrafficGate,
} from "./isolation-traffic-gate"

const context = {
  correlationId: "isolation-transition",
  transitionId: "10000000-0000-4000-8000-000000000001",
}

describe("IsolationTrafficGate", () => {
  it("starts sealed and requires explicit reconciliation before admission", async () => {
    const authority = new MutableAuthority(status("inactive"))
    const gate = new IsolationTrafficGate(authority)

    await expect(gate.admit(input("before-bootstrap"))).resolves.toEqual({
      ok: false,
    })
    expect(gate.stateForTest()).toEqual({
      activeLeases: 0,
      localState: "sealed",
      reconciled: false,
    })

    const prepared = await gate.prepareDisengage(context)
    expect(prepared.status).toBe("prepared")
    expect(gate.effectiveTrafficState()).toBe("sealed")
    await expect(gate.admit(input("during-reservation"))).resolves.toEqual({
      ok: false,
    })
    if (prepared.status !== "prepared") {
      throw new Error("Expected a deactivation commit reservation.")
    }
    expect(prepared.deactivationCommitReservation.enterCommitting()).toBe(true)
    prepared.deactivationCommitReservation.commit()
    expect(gate.effectiveTrafficState()).toBe("open")
    const admitted = await gate.admit(input("after-bootstrap"))
    expect(admitted.ok).toBe(true)
    if (admitted.ok) {
      admitted.lease.release()
    }
  })

  it("engages before aborting and waits for every lease to release", async () => {
    const gate = await reconciledGate(status("inactive"))
    const admitted = await gate.admit(input("request-1"))
    if (!admitted.ok) {
      throw new Error("Expected traffic admission.")
    }
    admitted.lease.signal.addEventListener(
      "abort",
      () => admitted.lease.release(),
      { once: true },
    )

    await expect(gate.engage(context)).resolves.toEqual({ status: "engaged" })
    expect(admitted.lease.signal.aborted).toBe(true)
    expect(admitted.lease.signal.reason).toBeInstanceOf(
      EmergencyIsolationAbortError,
    )
    expect(gate.stateForTest()).toEqual({
      activeLeases: 0,
      localState: "sealed",
      reconciled: true,
    })
  })

  it("refuses terminal finalization when engagement wins first", async () => {
    const gate = await reconciledGate(status("inactive"))
    const admitted = await gate.admit(input("engagement-wins"))
    if (!admitted.ok) {
      throw new Error("Expected traffic admission.")
    }
    admitted.lease.signal.addEventListener(
      "abort",
      () => admitted.lease.release(),
      { once: true },
    )

    const engagement = gate.engage(context)
    await expect(
      admitted.lease.finalize(async () => "must-not-run"),
    ).resolves.toEqual({ ok: false })
    await expect(engagement).resolves.toEqual({ status: "engaged" })
  })

  it("lets terminal finalization win and makes engagement wait for response release", async () => {
    const gate = await reconciledGate(status("inactive"))
    const admitted = await gate.admit(input("finalization-wins"))
    if (!admitted.ok) {
      throw new Error("Expected traffic admission.")
    }
    let finishFinalization: (() => void) | undefined
    const finalizationBlocked = new Promise<void>((resolve) => {
      finishFinalization = resolve
    })
    let markFinalizationStarted: (() => void) | undefined
    const finalizationStarted = new Promise<void>((resolve) => {
      markFinalizationStarted = resolve
    })
    const finalization = admitted.lease.finalize(async () => {
      markFinalizationStarted?.()
      await finalizationBlocked
      return "response-committed"
    })
    await finalizationStarted

    let engagementFinished = false
    const engagement = gate.engage(context).then((result) => {
      engagementFinished = true
      return result
    })
    expect(admitted.lease.signal.aborted).toBe(false)
    await Promise.resolve()
    expect(engagementFinished).toBe(false)

    finishFinalization?.()
    await expect(finalization).resolves.toEqual({
      ok: true,
      value: "response-committed",
    })
    expect(engagementFinished).toBe(false)
    admitted.lease.release()
    await expect(engagement).resolves.toEqual({ status: "engaged" })
  })

  it("keeps a finalizing lease active after caller abort until response release", async () => {
    const gate = await reconciledGate(status("inactive"))
    const caller = new AbortController()
    const admitted = await gate.admit({
      ...input("caller-aborts-finalization"),
      signal: caller.signal,
    })
    if (!admitted.ok) {
      throw new Error("Expected traffic admission.")
    }
    let finishFinalization: (() => void) | undefined
    const finalizationBlocked = new Promise<void>((resolve) => {
      finishFinalization = resolve
    })
    let markFinalizationStarted: (() => void) | undefined
    const finalizationStarted = new Promise<void>((resolve) => {
      markFinalizationStarted = resolve
    })
    const finalization = admitted.lease.finalize(async () => {
      markFinalizationStarted?.()
      await finalizationBlocked
      return "response-committed"
    })
    await finalizationStarted

    const callerAbortReason = new Error("caller closed")
    caller.abort(callerAbortReason)
    expect(admitted.lease.signal.aborted).toBe(true)
    expect(admitted.lease.signal.reason).toBe(callerAbortReason)
    expect(gate.stateForTest().activeLeases).toBe(1)

    let engagementFinished = false
    const engagement = gate.engage(context).then((result) => {
      engagementFinished = true
      return result
    })
    await Promise.resolve()
    expect(engagementFinished).toBe(false)

    finishFinalization?.()
    await expect(finalization).resolves.toEqual({
      ok: true,
      value: "response-committed",
    })
    expect(engagementFinished).toBe(false)
    expect(gate.stateForTest().activeLeases).toBe(1)

    admitted.lease.release()
    await expect(engagement).resolves.toEqual({ status: "engaged" })
  })

  it("reports an in-flight abort failure when a lease ignores cancellation", async () => {
    const gate = await reconciledGate(status("inactive"), {
      drainTimeoutMs: 5,
    })
    const admitted = await gate.admit(input("stuck-request"))
    if (!admitted.ok) {
      throw new Error("Expected traffic admission.")
    }

    await expect(gate.engage(context)).resolves.toEqual({
      failureCode: "inflight_abort_failed",
      status: "failed",
    })
    expect(admitted.lease.signal.aborted).toBe(true)
    admitted.lease.release()
  })

  it("globally seals on missing or malformed durable authority", async () => {
    const authority = new MutableAuthority(status("inactive"))
    const gate = await reconciledGate(authority)
    const admitted = await gate.admit(input("request-1"))
    if (!admitted.ok) {
      throw new Error("Expected traffic admission.")
    }
    admitted.lease.signal.addEventListener(
      "abort",
      () => admitted.lease.release(),
      { once: true },
    )

    authority.value = { state: "inactive" }
    await expect(gate.admit(input("request-2"))).resolves.toEqual({ ok: false })
    expect(admitted.lease.signal.aborted).toBe(true)
    expect(gate.stateForTest()).toMatchObject({
      activeLeases: 0,
      localState: "sealed",
      reconciled: false,
    })
  })

  it("denies invalid or already-aborted callers without aborting unrelated traffic", async () => {
    const gate = await reconciledGate(status("inactive"))
    const first = await gate.admit(input("request-1"))
    if (!first.ok) {
      throw new Error("Expected traffic admission.")
    }

    await expect(
      gate.admit({ ...input("invalid"), appId: "" }),
    ).resolves.toEqual({ ok: false })
    const caller = new AbortController()
    caller.abort(new Error("caller closed"))
    await expect(
      gate.admit({ ...input("cancelled"), signal: caller.signal }),
    ).resolves.toEqual({ ok: false })

    expect(first.lease.signal.aborted).toBe(false)
    expect(gate.stateForTest().activeLeases).toBe(1)
    first.lease.release()
  })

  it("abandons a blocked authority read promptly when the caller aborts", async () => {
    let markReadStarted: (() => void) | undefined
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve
    })
    let finishRead: (() => void) | undefined
    const readBlocked = new Promise<void>((resolve) => {
      finishRead = resolve
    })
    let markReadFinished: (() => void) | undefined
    const readFinished = new Promise<void>((resolve) => {
      markReadFinished = resolve
    })
    const gate = new IsolationTrafficGate({
      async read() {
        markReadStarted?.()
        await readBlocked
        markReadFinished?.()
        return status("inactive")
      },
    })
    const prepared = await gate.prepareDisengage(context)
    if (prepared.status !== "prepared") {
      throw new Error("Expected a deactivation commit reservation.")
    }
    expect(prepared.deactivationCommitReservation.enterCommitting()).toBe(true)
    prepared.deactivationCommitReservation.commit()
    const caller = new AbortController()
    const admission = gate.admit({
      ...input("blocked-authority-caller"),
      signal: caller.signal,
    })
    await readStarted

    caller.abort(new Error("caller closed"))
    await expect(admission).resolves.toEqual({ ok: false })
    expect(gate.stateForTest()).toEqual({
      activeLeases: 0,
      localState: "prepared",
      reconciled: true,
    })
    expect(gate.uncertaintyLatchedForTest()).toBe(false)

    finishRead?.()
    await readFinished
    expect(gate.effectiveTrafficState()).toBe("open")
  })

  it("binds caller cancellation to only that caller lease", async () => {
    const gate = await reconciledGate(status("inactive"))
    const firstCaller = new AbortController()
    const first = await gate.admit({
      ...input("request-1"),
      signal: firstCaller.signal,
    })
    const second = await gate.admit(input("request-2"))
    if (!first.ok || !second.ok) {
      throw new Error("Expected both traffic admissions.")
    }

    firstCaller.abort(new Error("caller closed"))

    expect(first.lease.signal.aborted).toBe(true)
    expect(second.lease.signal.aborted).toBe(false)
    expect(gate.stateForTest().activeLeases).toBe(1)
    second.lease.release()
  })

  it("allows only exact durable inactive and seals every other state", async () => {
    const authority = new MutableAuthority(status("inactive"))
    const gate = await reconciledGate(authority)
    const lease = await gate.admit(input("request-1"))
    if (!lease.ok) {
      throw new Error("Expected traffic admission.")
    }
    lease.lease.signal.addEventListener("abort", () => lease.lease.release(), {
      once: true,
    })

    authority.value = status("engaging")
    await expect(gate.refresh()).resolves.toMatchObject({ state: "engaging" })
    expect(lease.lease.signal.aborted).toBe(true)
    await expect(gate.admit(input("request-2"))).resolves.toEqual({ ok: false })
  })

  it("does not admit an authority read that began before a newer seal", async () => {
    const authority = new DeferredAuthority()
    const gate = new IsolationTrafficGate(authority)
    const admission = gate.admit(input("racing-request"))
    await gate.prepareDisengage(context)
    const engagement = gate.engage(context)
    expect(gate.stateForTest().localState).toBe("sealed")

    authority.resolve(status("inactive"))
    await expect(engagement).resolves.toEqual({ status: "engaged" })
    await expect(admission).resolves.toEqual({ ok: false })
    expect(gate.stateForTest()).toMatchObject({
      activeLeases: 0,
      localState: "sealed",
    })
  })

  it("holds traffic sealed across restored inactive authority until explicit release", async () => {
    const authority = new MutableAuthority(status("inactive"))
    const gate = await reconciledGate(authority)
    const admitted = await gate.admit(input("before-restore"))
    if (!admitted.ok) {
      throw new Error("Expected traffic admission.")
    }
    admitted.lease.signal.addEventListener(
      "abort",
      () => admitted.lease.release(),
      { once: true },
    )

    const hold = gate.acquireRestoreHold()
    expect(admitted.lease.signal.aborted).toBe(true)
    expect(gate.restoreHoldCountForTest()).toBe(1)
    await expect(gate.refresh()).resolves.toBeNull()
    await expect(gate.prepareDisengage(context)).resolves.toEqual({
      failureCode: "verification_failed",
      status: "failed",
    })
    await expect(gate.admit(input("during-restore"))).resolves.toEqual({
      ok: false,
    })

    hold.release()
    hold.release()
    expect(gate.restoreHoldCountForTest()).toBe(0)
    await expect(gate.admit(input("before-reconcile"))).resolves.toEqual({
      ok: false,
    })
    await expect(gate.refresh()).resolves.toMatchObject({ state: "inactive" })
    const after = await gate.admit(input("after-reconcile"))
    expect(after.ok).toBe(true)
    if (after.ok) {
      after.lease.release()
    }
  })

  it("keeps authority uncertainty sticky until engage and verification recover it", async () => {
    const authority = new MutableAuthority(status("inactive"))
    const gate = await reconciledGate(authority)

    authority.value = { malformed: true }
    await expect(gate.refresh()).resolves.toBeNull()
    expect(gate.uncertaintyLatchedForTest()).toBe(true)
    expect(gate.effectiveTrafficState()).toBe("sealed")

    authority.value = status("inactive")
    await expect(gate.refresh()).resolves.toBeNull()
    await expect(gate.prepareDisengage(context)).resolves.toEqual({
      failureCode: "verification_failed",
      status: "failed",
    })
    await expect(gate.admit(input("still-uncertain"))).resolves.toEqual({
      ok: false,
    })

    await expect(gate.engage(context)).resolves.toEqual({ status: "engaged" })
    expect(gate.uncertaintyLatchedForTest()).toBe(true)
    await expect(gate.verifyEngaged(context)).resolves.toEqual({
      status: "verified",
    })
    expect(gate.uncertaintyLatchedForTest()).toBe(false)
    expect(gate.effectiveTrafficState()).toBe("sealed")
    const prepared = await gate.prepareDisengage(context)
    if (prepared.status !== "prepared") {
      throw new Error("Expected a deactivation commit reservation.")
    }
    expect(prepared.deactivationCommitReservation.enterCommitting()).toBe(true)
    prepared.deactivationCommitReservation.commit()
    expect(gate.effectiveTrafficState()).toBe("open")
  })

  it("makes engagement wait for a committing deactivation reservation, then seal as a later action", async () => {
    const gate = new IsolationTrafficGate(
      new MutableAuthority(status("inactive")),
    )
    const prepared = await gate.prepareDisengage(context)
    if (prepared.status !== "prepared") {
      throw new Error("Expected a deactivation commit reservation.")
    }
    expect(prepared.deactivationCommitReservation.enterCommitting()).toBe(true)

    let engagementFinished = false
    const engagement = gate.engage(context).then((result) => {
      engagementFinished = true
      return result
    })
    await Promise.resolve()
    expect(engagementFinished).toBe(false)
    expect(gate.effectiveTrafficState()).toBe("sealed")

    prepared.deactivationCommitReservation.commit()
    await expect(engagement).resolves.toEqual({ status: "engaged" })
    expect(gate.effectiveTrafficState()).toBe("sealed")
  })

  it("keeps an aborted deactivation commit reservation sealed", async () => {
    const gate = new IsolationTrafficGate(
      new MutableAuthority(status("inactive")),
    )
    const prepared = await gate.prepareDisengage(context)
    if (prepared.status !== "prepared") {
      throw new Error("Expected a deactivation commit reservation.")
    }
    expect(prepared.deactivationCommitReservation.enterCommitting()).toBe(true)
    prepared.deactivationCommitReservation.abort()

    expect(gate.effectiveTrafficState()).toBe("sealed")
    await expect(gate.admit(input("after-abort"))).resolves.toEqual({
      ok: false,
    })
  })

  it("applies a restore hold acquired during commit as a later seal event", async () => {
    const gate = new IsolationTrafficGate(
      new MutableAuthority(status("inactive")),
    )
    const prepared = await gate.prepareDisengage(context)
    if (prepared.status !== "prepared") {
      throw new Error("Expected a deactivation commit reservation.")
    }
    expect(prepared.deactivationCommitReservation.enterCommitting()).toBe(true)

    const hold = gate.acquireRestoreHold()
    hold.release()
    prepared.deactivationCommitReservation.commit()

    expect(gate.restoreHoldCountForTest()).toBe(0)
    expect(gate.effectiveTrafficState()).toBe("sealed")
  })
})

class MutableAuthority implements IsolationTrafficAuthority {
  constructor(public value: unknown) {}

  async read(): Promise<unknown> {
    return this.value
  }
}

class DeferredAuthority implements IsolationTrafficAuthority {
  private resolveRead: ((value: unknown) => void) | null = null

  async read(): Promise<unknown> {
    return await new Promise((resolve) => {
      this.resolveRead = resolve
    })
  }

  resolve(value: unknown): void {
    const resolve = this.resolveRead
    if (!resolve) {
      throw new Error("No authority read is pending.")
    }
    this.resolveRead = null
    resolve(value)
  }
}

async function reconciledGate(
  statusOrAuthority: EmergencyIsolationStatus | MutableAuthority,
  options: { drainTimeoutMs?: number } = {},
): Promise<IsolationTrafficGate> {
  const authority =
    statusOrAuthority instanceof MutableAuthority
      ? statusOrAuthority
      : new MutableAuthority(statusOrAuthority)
  const gate = new IsolationTrafficGate(authority, options)
  const prepared = await gate.prepareDisengage(context)
  if (prepared.status !== "prepared") {
    throw new Error("Expected a deactivation commit reservation.")
  }
  if (!prepared.deactivationCommitReservation.enterCommitting()) {
    throw new Error("Expected deactivation commit entry.")
  }
  prepared.deactivationCommitReservation.commit()
  return gate
}

function input(correlationId: string) {
  return {
    appId: "app-1",
    correlationId,
    credentialRecordId: "credential-1",
    route: "chat_completions" as const,
  }
}

function status(
  state: EmergencyIsolationStatus["state"],
): EmergencyIsolationStatus {
  const active = state === "active" || state === "disengaging"
  const recovery = state === "recovery_required"
  return {
    activatedAt: active ? "2026-08-02T12:00:00.000Z" : null,
    activatedBySubjectId: active ? "admin-1" : null,
    effectiveTrafficState: state === "inactive" ? "open" : "sealed",
    failureCode: recovery ? "state_invalid" : null,
    revision: state === "inactive" ? 0 : 1,
    runtimeQualified: false,
    state,
    updatedAt: "2026-08-02T12:00:00.000Z",
    updatedBySubjectId: state === "inactive" ? null : "admin-1",
  }
}
