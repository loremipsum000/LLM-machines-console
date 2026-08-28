import { z } from "zod"

export const emergencyIsolationStates = [
  "inactive",
  "engaging",
  "active",
  "disengaging",
  "recovery_required",
] as const

export const emergencyIsolationStateSchema = z.enum(emergencyIsolationStates)
export type EmergencyIsolationState = z.infer<
  typeof emergencyIsolationStateSchema
>

export const emergencyIsolationEffectiveTrafficStates = [
  "open",
  "sealed",
] as const

export const emergencyIsolationEffectiveTrafficStateSchema = z.enum(
  emergencyIsolationEffectiveTrafficStates,
)
export type EmergencyIsolationEffectiveTrafficState = z.infer<
  typeof emergencyIsolationEffectiveTrafficStateSchema
>

export const emergencyIsolationFailureCodes = [
  "state_invalid",
  "admission_fence_failed",
  "inflight_abort_failed",
  "enforcement_failed",
  "verification_failed",
  "restore_reassertion_failed",
  "journal_failed",
] as const

export const emergencyIsolationFailureCodeSchema = z.enum(
  emergencyIsolationFailureCodes,
)
export type EmergencyIsolationFailureCode = z.infer<
  typeof emergencyIsolationFailureCodeSchema
>

export const emergencyIsolationActivationConfirmation =
  "ACTIVATE EMERGENCY ISOLATION" as const
export const emergencyIsolationDeactivationConfirmation =
  "DEACTIVATE EMERGENCY ISOLATION" as const

export const emergencyIsolationExpectedRevisionSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)

export const emergencyIsolationActivationRequestSchema = z
  .object({
    confirmation: z.literal(emergencyIsolationActivationConfirmation),
    expectedRevision: emergencyIsolationExpectedRevisionSchema,
  })
  .strict()
export type EmergencyIsolationActivationRequest = z.infer<
  typeof emergencyIsolationActivationRequestSchema
>

export const emergencyIsolationDeactivationRequestSchema = z
  .object({
    confirmation: z.literal(emergencyIsolationDeactivationConfirmation),
    expectedRevision: emergencyIsolationExpectedRevisionSchema,
  })
  .strict()
export type EmergencyIsolationDeactivationRequest = z.infer<
  typeof emergencyIsolationDeactivationRequestSchema
>

const emergencyIsolationSubjectIdSchema = z.string().min(1).max(255)

const emergencyIsolationStatusObjectSchema = z
  .object({
    activatedAt: z.string().datetime({ offset: true }).nullable(),
    activatedBySubjectId: emergencyIsolationSubjectIdSchema.nullable(),
    effectiveTrafficState: emergencyIsolationEffectiveTrafficStateSchema,
    failureCode: emergencyIsolationFailureCodeSchema.nullable(),
    revision: emergencyIsolationExpectedRevisionSchema,
    runtimeQualified: z.literal(false),
    state: emergencyIsolationStateSchema,
    updatedAt: z.string().datetime({ offset: true }),
    updatedBySubjectId: emergencyIsolationSubjectIdSchema.nullable(),
  })
  .strict()

type EmergencyIsolationStatusFields = z.infer<
  typeof emergencyIsolationStatusObjectSchema
>

const refineEmergencyIsolationStatus = (
  value: EmergencyIsolationStatusFields,
  context: z.RefinementCtx,
) => {
  const expectedTrafficState = value.state === "inactive" ? "open" : "sealed"

  if (value.effectiveTrafficState !== expectedTrafficState) {
    context.addIssue({
      code: "custom",
      message: `${value.state} isolation must report ${expectedTrafficState} traffic.`,
      path: ["effectiveTrafficState"],
    })
  }

  const hasActivatedAt = value.activatedAt !== null
  const hasActivatedBy = value.activatedBySubjectId !== null

  if (hasActivatedAt !== hasActivatedBy) {
    context.addIssue({
      code: "custom",
      message:
        "Isolation activation metadata must be present or absent together.",
      path: ["activatedAt"],
    })
  }

  if (
    (value.state === "inactive" || value.state === "engaging") &&
    (hasActivatedAt || hasActivatedBy)
  ) {
    context.addIssue({
      code: "custom",
      message: `${value.state} isolation cannot retain activation metadata.`,
      path: ["activatedAt"],
    })
  }

  if (
    (value.state === "active" || value.state === "disengaging") &&
    (!hasActivatedAt || !hasActivatedBy)
  ) {
    context.addIssue({
      code: "custom",
      message: `${value.state} isolation requires activation metadata.`,
      path: ["activatedAt"],
    })
  }

  if (value.state === "recovery_required" && value.failureCode === null) {
    context.addIssue({
      code: "custom",
      message:
        "Recovery-required isolation must identify a bounded failure code.",
      path: ["failureCode"],
    })
  }

  if (value.state !== "recovery_required" && value.failureCode !== null) {
    context.addIssue({
      code: "custom",
      message: `${value.state} isolation cannot report a failure code.`,
      path: ["failureCode"],
    })
  }

  if (
    value.revision === 0 &&
    (value.state !== "inactive" || value.updatedBySubjectId !== null)
  ) {
    context.addIssue({
      code: "custom",
      message: "Revision zero must be the pristine inactive authority.",
      path: ["revision"],
    })
  }

  if (
    value.revision > 0 &&
    value.state !== "recovery_required" &&
    value.updatedBySubjectId === null
  ) {
    context.addIssue({
      code: "custom",
      message: "Changed isolation authority requires an updater subject.",
      path: ["updatedBySubjectId"],
    })
  }
}

export const emergencyIsolationStatusSchema =
  emergencyIsolationStatusObjectSchema.superRefine(
    refineEmergencyIsolationStatus,
  )
export type EmergencyIsolationStatus = z.infer<
  typeof emergencyIsolationStatusSchema
>

export const emergencyIsolationActivationResults = [
  "activated",
  "already_active",
] as const

export const emergencyIsolationActivationResultSchema =
  emergencyIsolationStatusObjectSchema
    .extend({
      result: z.enum(emergencyIsolationActivationResults),
      state: z.literal("active"),
    })
    .strict()
    .superRefine(refineEmergencyIsolationStatus)
export type EmergencyIsolationActivationResult = z.infer<
  typeof emergencyIsolationActivationResultSchema
>

export const emergencyIsolationDeactivationResults = [
  "deactivated",
  "already_inactive",
] as const

export const emergencyIsolationDeactivationResultSchema =
  emergencyIsolationStatusObjectSchema
    .extend({
      result: z.enum(emergencyIsolationDeactivationResults),
      state: z.literal("inactive"),
    })
    .strict()
    .superRefine(refineEmergencyIsolationStatus)
export type EmergencyIsolationDeactivationResult = z.infer<
  typeof emergencyIsolationDeactivationResultSchema
>
