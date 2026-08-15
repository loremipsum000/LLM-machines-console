import { z } from "zod"

export const consoleSessionPolicy = {
  absoluteLifetimeSeconds: 24 * 60 * 60,
  accessTokenLifetimeSeconds: 5 * 60,
  clockSkewSeconds: 60,
  idleLifetimeSeconds: 8 * 60 * 60,
  loginTransactionLifetimeSeconds: 2 * 60,
  maximumRefreshAttemptsPerRequest: 1,
  maximumRequestReplays: 1,
  pkceMethod: "S256",
} as const

export const consoleSessionCookieName = "__Host-llm-machines-session"
export const consoleLoginCookieName = "__Host-llm-machines-login"

export const consoleSessionRoleSchema = z.enum(["admin", "operator"])
export type ConsoleSessionRole = z.infer<typeof consoleSessionRoleSchema>

export const consoleSessionProjectionSchema = z
  .object({
    email: z.string().email().optional(),
    groups: z.array(z.string().min(1).max(255)).max(64),
    mfaVerifiedAt: z.string().datetime().nullable(),
    role: consoleSessionRoleSchema,
    subject: z.string().min(1).max(255),
  })
  .strict()
export type ConsoleSessionProjection = z.infer<
  typeof consoleSessionProjectionSchema
>

export const consoleHighRiskActions = [
  "activity_audit.export",
  "applications.create_delete",
  "applications.credentials.test_rotate_revoke",
  "applications.policy.change",
  "applications.reenable",
  "firecrawl.enable_reenable",
  "isolation.activate",
  "team.local_password.manage",
  "team.users_roles.manage",
  "updates.apply",
] as const
export const consoleHighRiskActionSchema = z.enum(consoleHighRiskActions)
export type ConsoleHighRiskAction = z.infer<typeof consoleHighRiskActionSchema>

export const consoleSessionResolveResponseSchema = z.discriminatedUnion(
  "state",
  [
    z
      .object({
        session: consoleSessionProjectionSchema,
        state: z.literal("active"),
      })
      .strict(),
    z
      .object({
        reason: z.enum([
          "absent",
          "expired",
          "invalid",
          "revoked",
          "reuse_detected",
        ]),
        state: z.literal("terminal"),
      })
      .strict(),
    z
      .object({
        reason: z.enum([
          "identity_restart",
          "identity_timeout",
          "identity_unavailable",
          "storage_unavailable",
        ]),
        retryable: z.literal(true),
        state: z.literal("unavailable"),
      })
      .strict(),
  ],
)
export type ConsoleSessionResolveResponse = z.infer<
  typeof consoleSessionResolveResponseSchema
>

export const consoleSessionFailureReasonSchema = z.enum([
  "expired",
  "identity_restart",
  "identity_timeout",
  "identity_unavailable",
  "invalid_grant",
  "malformed_response",
  "refresh_expired",
  "refresh_not_rotated",
  "reuse_detected",
  "revoked",
  "storage_unavailable",
])
export type ConsoleSessionFailureReason = z.infer<
  typeof consoleSessionFailureReasonSchema
>

export const consoleRefreshFailureTelemetrySchema = z
  .object({
    event: z.literal("console_session.refresh_failed"),
    reason: consoleSessionFailureReasonSchema,
    sessionReference: z.string().regex(/^[a-f0-9]{12}$/),
  })
  .strict()
export type ConsoleRefreshFailureTelemetry = z.infer<
  typeof consoleRefreshFailureTelemetrySchema
>

export const consoleSessionPublicPaths = {
  backchannelLogout: "/api/internal/console-session/backchannel-logout",
  callback: "/api/console/session/callback",
  elevate: "/api/console/session/elevate",
  login: "/api/console/session/login",
  logout: "/api/console/session/logout",
  resolve: "/api/internal/console-session/resolve",
} as const
