import { describe, expect, it } from "vitest"
import {
  emergencyIsolationActivationConfirmation,
  emergencyIsolationActivationRequestSchema,
  emergencyIsolationActivationResultSchema,
  emergencyIsolationDeactivationConfirmation,
  emergencyIsolationDeactivationRequestSchema,
  emergencyIsolationDeactivationResultSchema,
  emergencyIsolationEffectiveTrafficStates,
  emergencyIsolationFailureCodes,
  emergencyIsolationStates,
  emergencyIsolationStatusSchema,
} from "./index"

const timestamp = "2026-08-02T12:00:00.000Z"

const inactiveStatus = {
  activatedAt: null,
  activatedBySubjectId: null,
  effectiveTrafficState: "open",
  failureCode: null,
  revision: 0,
  runtimeQualified: false,
  state: "inactive",
  updatedAt: timestamp,
  updatedBySubjectId: null,
} as const

const activeStatus = {
  ...inactiveStatus,
  activatedAt: timestamp,
  activatedBySubjectId: "admin-subject-1",
  effectiveTrafficState: "sealed",
  revision: 2,
  state: "active",
  updatedBySubjectId: "admin-subject-1",
} as const

describe("Inference Core emergency-isolation contracts", () => {
  it("locks the states, traffic states, failure codes, and confirmations", () => {
    expect(emergencyIsolationStates).toEqual([
      "inactive",
      "engaging",
      "active",
      "disengaging",
      "recovery_required",
    ])
    expect(emergencyIsolationEffectiveTrafficStates).toEqual(["open", "sealed"])
    expect(emergencyIsolationFailureCodes).toEqual([
      "state_invalid",
      "admission_fence_failed",
      "inflight_abort_failed",
      "enforcement_failed",
      "verification_failed",
      "restore_reassertion_failed",
      "journal_failed",
    ])
    expect(emergencyIsolationActivationConfirmation).toBe(
      "ACTIVATE EMERGENCY ISOLATION",
    )
    expect(emergencyIsolationDeactivationConfirmation).toBe(
      "DEACTIVATE EMERGENCY ISOLATION",
    )
  })

  it("accepts only strict activation and deactivation requests", () => {
    expect(
      emergencyIsolationActivationRequestSchema.safeParse({
        confirmation: "ACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 0,
      }).success,
    ).toBe(true)
    expect(
      emergencyIsolationDeactivationRequestSchema.safeParse({
        confirmation: "DEACTIVATE EMERGENCY ISOLATION",
        expectedRevision: Number.MAX_SAFE_INTEGER,
      }).success,
    ).toBe(true)

    for (const candidate of [
      {
        confirmation: "activate emergency isolation",
        expectedRevision: 0,
      },
      {
        confirmation: "ACTIVATE EMERGENCY ISOLATION",
        expectedRevision: -1,
      },
      {
        confirmation: "ACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 1.5,
      },
      {
        confirmation: "ACTIVATE EMERGENCY ISOLATION",
        expectedRevision: Number.MAX_SAFE_INTEGER + 1,
      },
      {
        confirmation: "ACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 0,
        force: true,
      },
    ]) {
      expect(
        emergencyIsolationActivationRequestSchema.safeParse(candidate).success,
      ).toBe(false)
    }
  })

  it("accepts every valid state while keeping all non-inactive states sealed", () => {
    const statuses = [
      inactiveStatus,
      {
        ...inactiveStatus,
        effectiveTrafficState: "sealed",
        revision: 1,
        state: "engaging",
        updatedBySubjectId: "admin-subject-1",
      },
      activeStatus,
      {
        ...activeStatus,
        revision: 3,
        state: "disengaging",
      },
      {
        ...activeStatus,
        failureCode: "verification_failed",
        revision: 4,
        state: "recovery_required",
      },
    ]

    for (const status of statuses) {
      expect(emergencyIsolationStatusSchema.safeParse(status).success).toBe(
        true,
      )
    }
  })

  it("requires runtime qualification to remain false", () => {
    expect(
      emergencyIsolationStatusSchema.safeParse({
        ...inactiveStatus,
        runtimeQualified: true,
      }).success,
    ).toBe(false)
  })

  it("enforces state-specific traffic, activation, and failure metadata", () => {
    for (const candidate of [
      { ...inactiveStatus, effectiveTrafficState: "sealed" },
      { ...activeStatus, effectiveTrafficState: "open" },
      {
        ...activeStatus,
        activatedAt: null,
        activatedBySubjectId: null,
      },
      {
        ...inactiveStatus,
        activatedAt: timestamp,
        activatedBySubjectId: "admin-subject-1",
      },
      { ...inactiveStatus, failureCode: "state_invalid" },
      {
        ...activeStatus,
        failureCode: null,
        state: "recovery_required",
      },
      {
        ...activeStatus,
        activatedBySubjectId: null,
      },
      { ...inactiveStatus, updatedBySubjectId: "admin-subject-1" },
      {
        ...inactiveStatus,
        effectiveTrafficState: "sealed",
        state: "engaging",
      },
      { ...inactiveStatus, revision: 1 },
      { ...inactiveStatus, secret: "forbidden" },
    ]) {
      expect(emergencyIsolationStatusSchema.safeParse(candidate).success).toBe(
        false,
      )
    }

    expect(
      emergencyIsolationStatusSchema.safeParse({
        ...inactiveStatus,
        effectiveTrafficState: "sealed",
        failureCode: "state_invalid",
        revision: 1,
        state: "recovery_required",
      }).success,
    ).toBe(true)
  })

  it("locks successful mutation results to their terminal states", () => {
    expect(
      emergencyIsolationActivationResultSchema.safeParse({
        ...activeStatus,
        result: "activated",
      }).success,
    ).toBe(true)
    expect(
      emergencyIsolationActivationResultSchema.safeParse({
        ...activeStatus,
        result: "already_active",
      }).success,
    ).toBe(true)
    expect(
      emergencyIsolationActivationResultSchema.safeParse({
        ...inactiveStatus,
        result: "activated",
      }).success,
    ).toBe(false)

    expect(
      emergencyIsolationDeactivationResultSchema.safeParse({
        ...inactiveStatus,
        result: "deactivated",
      }).success,
    ).toBe(true)
    expect(
      emergencyIsolationDeactivationResultSchema.safeParse({
        ...inactiveStatus,
        result: "already_inactive",
      }).success,
    ).toBe(true)
    expect(
      emergencyIsolationDeactivationResultSchema.safeParse({
        ...activeStatus,
        result: "deactivated",
      }).success,
    ).toBe(false)
  })
})
