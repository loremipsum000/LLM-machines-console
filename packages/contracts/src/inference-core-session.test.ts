import { describe, expect, it } from "vitest"
import {
  consoleHighRiskActions,
  consoleRefreshFailureTelemetrySchema,
  consoleSessionCookieName,
  consoleSessionPolicy,
  consoleSessionPublicPaths,
  consoleSessionResolveResponseSchema,
} from "./inference-core-session"

describe("Inference Core Console session contract", () => {
  it("pins the accepted session and replay policy", () => {
    expect(consoleSessionPolicy).toEqual({
      absoluteLifetimeSeconds: 28_800,
      accessTokenLifetimeSeconds: 300,
      clockSkewSeconds: 60,
      idleLifetimeSeconds: 1_800,
      loginTransactionLifetimeSeconds: 120,
      maximumRefreshAttemptsPerRequest: 1,
      maximumRequestReplays: 1,
      pkceMethod: "S256",
    })
    expect(consoleSessionCookieName).toMatch(/^__Host-/)
    expect(consoleHighRiskActions).toHaveLength(10)
    expect(consoleHighRiskActions).toContain(
      "applications.credentials.test_rotate_revoke",
    )
    expect(consoleSessionPublicPaths.elevate).toBe(
      "/api/console/session/elevate",
    )
    expect(consoleHighRiskActions).not.toContain("litellm.routes_keys.edit")
    expect(consoleHighRiskActions).not.toContain("expert_access.admin_mutation")
  })

  it("separates terminal sessions from retryable identity outages", () => {
    expect(
      consoleSessionResolveResponseSchema.parse({
        reason: "revoked",
        state: "terminal",
      }),
    ).toEqual({ reason: "revoked", state: "terminal" })
    expect(
      consoleSessionResolveResponseSchema.parse({
        reason: "identity_unavailable",
        retryable: true,
        state: "unavailable",
      }),
    ).toMatchObject({ state: "unavailable" })
  })

  it("rejects token-shaped or unbounded refresh telemetry", () => {
    expect(() =>
      consoleRefreshFailureTelemetrySchema.parse({
        event: "console_session.refresh_failed",
        reason: "reuse_detected",
        sessionReference: "0123456789ab",
        refreshToken: "must-never-be-observable",
      }),
    ).toThrow()
  })
})
