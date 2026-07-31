import { describe, expect, it } from "vitest"
import {
  emergencyRecoveryActivationResultSchema,
  emergencyRecoveryActivationServiceInputSchema,
  emergencyRecoveryApprovedMfaMethods,
  emergencyRecoveryGrantSchema,
  emergencyRecoveryReasonCodeSchema,
  emergencyRecoveryStatusResultSchema,
} from "./index"

const factor = `llmr1_${"A".repeat(43)}`

describe("Inference Core emergency recovery contracts", () => {
  it("locks the bounded reason codes and approved AMR methods", () => {
    expect(emergencyRecoveryReasonCodeSchema.options).toEqual([
      "admin_lockout",
      "admin_role_repair",
      "admin_mfa_repair",
    ])
    expect(emergencyRecoveryApprovedMfaMethods).toEqual([
      "otp",
      "hwk",
      "webauthn",
      "webauthn-passwordless",
    ])
  })

  it("accepts explicit Keycloak authentication and live-role evidence", () => {
    expect(
      emergencyRecoveryActivationServiceInputSchema.parse({
        authentication: {
          acr: "urn:llm-machines:mfa",
          amr: ["pwd", "otp"],
          authTime: 1_785_500_000,
          keycloakSubjectId: "operator-1",
        },
        correlationId: "request-1",
        factor,
        liveIdentity: {
          enabled: true,
          keycloakSubjectId: "operator-1",
          role: "operator",
        },
        reasonCode: "admin_lockout",
      }),
    ).toMatchObject({ reasonCode: "admin_lockout" })
  })

  it("rejects arbitrary factors, reasons, and excess authentication fields", () => {
    const candidate = {
      authentication: {
        acr: "urn:llm-machines:mfa",
        amr: ["pwd"],
        authTime: 1_785_500_000,
        keycloakSubjectId: "operator-1",
        trusted: true,
      },
      correlationId: "request-1",
      factor: "invalid-recovery-factor",
      liveIdentity: {
        enabled: true,
        keycloakSubjectId: "operator-1",
        role: "operator",
      },
      reasonCode: "support_override",
    }

    expect(
      emergencyRecoveryActivationServiceInputSchema.safeParse(candidate)
        .success,
    ).toBe(false)
  })

  it("describes an overlay without representing a persistent or native role", () => {
    const grant = emergencyRecoveryGrantSchema.parse({
      activatedAt: "2026-07-31T12:00:00.000Z",
      expiresAt: "2026-07-31T12:15:00.000Z",
      keycloakSubjectId: "operator-1",
      nativeExpertAccess: false,
      reasonCode: "admin_role_repair",
      scope: "console_admin_capabilities",
      sessionId: "01234567-89ab-4def-8123-456789abcdef",
    })

    expect(grant).not.toHaveProperty("role")
    expect(grant).not.toHaveProperty("keycloakRole")
    expect(grant.nativeExpertAccess).toBe(false)
  })

  it("bounds activation throttling without accepting recovery material", () => {
    expect(
      emergencyRecoveryActivationResultSchema.parse({
        retryAfterSeconds: 60,
        status: "rate_limited",
      }),
    ).toEqual({ retryAfterSeconds: 60, status: "rate_limited" })
    expect(
      emergencyRecoveryActivationResultSchema.safeParse({
        factor,
        retryAfterSeconds: 61,
        status: "rate_limited",
      }).success,
    ).toBe(false)
  })

  it("keeps the Admin status projection free of verifier material", () => {
    const status = emergencyRecoveryStatusResultSchema.parse({
      activeGrant: null,
      factor: {
        commissionedAt: "2026-07-31T12:00:00.000Z",
        commissionedBy: "admin-1",
      },
      status: "ok",
    })

    expect(status).not.toHaveProperty("verifierHash")
    expect(status).not.toHaveProperty("salt")
    expect(JSON.stringify(status)).not.toMatch(/scrypt|verifier|salt/i)
  })
})
