import { z } from "zod"

export const emergencyRecoveryReasonCodes = [
  "admin_lockout",
  "admin_role_repair",
  "admin_mfa_repair",
] as const

export const emergencyRecoveryReasonCodeSchema = z.enum(
  emergencyRecoveryReasonCodes,
)
export type EmergencyRecoveryReasonCode = z.infer<
  typeof emergencyRecoveryReasonCodeSchema
>

export const emergencyRecoveryApprovedMfaMethods = [
  "otp",
  "hwk",
  "webauthn",
  "webauthn-passwordless",
] as const

export const emergencyRecoveryAuthenticationProofSchema = z
  .object({
    acr: z.string().min(1).max(255).optional(),
    amr: z.array(z.string().min(1).max(64)).max(16),
    authTime: z.number().int().nonnegative(),
    keycloakSubjectId: z.string().min(1).max(255),
  })
  .strict()
export type EmergencyRecoveryAuthenticationProof = z.infer<
  typeof emergencyRecoveryAuthenticationProofSchema
>

export const emergencyRecoveryLiveIdentitySchema = z
  .object({
    enabled: z.boolean(),
    keycloakSubjectId: z.string().min(1).max(255),
    role: z.enum(["admin", "operator"]),
  })
  .strict()
export type EmergencyRecoveryLiveIdentity = z.infer<
  typeof emergencyRecoveryLiveIdentitySchema
>

/** Internal input assembled only after server-side authentication and live identity resolution. */
export const emergencyRecoveryCommissionServiceInputSchema = z
  .object({
    authentication: emergencyRecoveryAuthenticationProofSchema,
    correlationId: z.string().min(1).max(128),
    liveIdentity: emergencyRecoveryLiveIdentitySchema,
  })
  .strict()
export type EmergencyRecoveryCommissionServiceInput = z.infer<
  typeof emergencyRecoveryCommissionServiceInputSchema
>

/** Internal input assembled only after server-side authentication and live identity resolution. */
export const emergencyRecoveryActivationServiceInputSchema = z
  .object({
    authentication: emergencyRecoveryAuthenticationProofSchema,
    correlationId: z.string().min(1).max(128),
    factor: z.string().regex(/^llmr1_[A-Za-z0-9_-]{43}$/),
    liveIdentity: emergencyRecoveryLiveIdentitySchema,
    reasonCode: emergencyRecoveryReasonCodeSchema,
  })
  .strict()
export type EmergencyRecoveryActivationServiceInput = z.infer<
  typeof emergencyRecoveryActivationServiceInputSchema
>

export const emergencyRecoveryGrantSchema = z
  .object({
    activatedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    keycloakSubjectId: z.string().min(1).max(255),
    nativeExpertAccess: z.literal(false),
    reasonCode: emergencyRecoveryReasonCodeSchema,
    scope: z.literal("console_admin_capabilities"),
    sessionId: z.string().uuid(),
  })
  .strict()
export type EmergencyRecoveryGrant = z.infer<
  typeof emergencyRecoveryGrantSchema
>

export const emergencyRecoveryCommissionResultSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        commissionedAt: z.string().datetime({ offset: true }),
        recoveryFactor: z.string().regex(/^llmr1_[A-Za-z0-9_-]{43}$/),
        status: z.literal("commissioned"),
      })
      .strict(),
    z.object({ status: z.literal("already_commissioned") }).strict(),
    z
      .object({
        reason: z.enum([
          "identity_not_admin",
          "identity_disabled",
          "identity_mismatch",
          "recent_authentication_required",
          "mfa_required",
        ]),
        status: z.literal("denied"),
      })
      .strict(),
    z.object({ status: z.literal("unavailable") }).strict(),
  ],
)
export type EmergencyRecoveryCommissionResult = z.infer<
  typeof emergencyRecoveryCommissionResultSchema
>

export const emergencyRecoveryActivationResultSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        grant: emergencyRecoveryGrantSchema,
        status: z.literal("activated"),
      })
      .strict(),
    z
      .object({
        reason: z.enum([
          "identity_not_operator",
          "identity_disabled",
          "identity_mismatch",
          "recent_authentication_required",
          "mfa_required",
          "invalid_factor",
        ]),
        status: z.literal("denied"),
      })
      .strict(),
    z.object({ status: z.literal("not_commissioned") }).strict(),
    z.object({ status: z.literal("active_session_exists") }).strict(),
    z
      .object({
        retryAfterSeconds: z.number().int().min(1).max(60),
        status: z.literal("rate_limited"),
      })
      .strict(),
    z.object({ status: z.literal("unavailable") }).strict(),
  ],
)
export type EmergencyRecoveryActivationResult = z.infer<
  typeof emergencyRecoveryActivationResultSchema
>

export const emergencyRecoveryResolutionSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        grant: emergencyRecoveryGrantSchema,
        status: z.literal("active"),
      })
      .strict(),
    z.object({ status: z.literal("inactive") }).strict(),
    z.object({ status: z.literal("unavailable") }).strict(),
  ],
)
export type EmergencyRecoveryResolution = z.infer<
  typeof emergencyRecoveryResolutionSchema
>

export const emergencyRecoveryStatusResultSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        activeGrant: emergencyRecoveryGrantSchema.nullable(),
        factor: z
          .object({
            commissionedAt: z.string().datetime({ offset: true }),
            commissionedBy: z.string().min(1).max(255),
          })
          .strict()
          .nullable(),
        status: z.literal("ok"),
      })
      .strict(),
    z.object({ status: z.literal("unavailable") }).strict(),
  ],
)
export type EmergencyRecoveryStatusResult = z.infer<
  typeof emergencyRecoveryStatusResultSchema
>

export const emergencyRecoveryRevocationResultSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        revokedAt: z.string().datetime({ offset: true }),
        sessionId: z.string().uuid(),
        status: z.literal("revoked"),
      })
      .strict(),
    z.object({ status: z.literal("not_found") }).strict(),
    z.object({ status: z.literal("unavailable") }).strict(),
  ],
)
export type EmergencyRecoveryRevocationResult = z.infer<
  typeof emergencyRecoveryRevocationResultSchema
>
