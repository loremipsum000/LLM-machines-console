import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/authorization"
import {
  type AdminEmergencyRecoveryService,
  registerAdminRoutes,
} from "./admin"

const recoveryFactor = `llmr1_${"A".repeat(43)}`
const recoverySessionId = "01234567-89ab-4def-8123-456789abcdef"
const recentAuthTime = Math.floor(Date.now() / 1000) - 30

const adminActor: Actor = {
  acr: "urn:llm-machines:mfa",
  amr: ["pwd", "otp"],
  authMode: "keycloak",
  authTime: recentAuthTime,
  role: "admin",
  subject: "admin-1",
}

const operatorActor: Actor = {
  ...adminActor,
  role: "operator",
  subject: "operator-1",
}

describe("Admin emergency recovery routes", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("commissions with server-derived identity and returns the factor once", async () => {
    const service = recoveryService()
    vi.mocked(service.commission).mockResolvedValueOnce({
      commissionedAt: "2026-07-31T12:00:00.000Z",
      recoveryFactor,
      status: "commissioned",
    })
    const server = recoveryRouteServer(adminActor, service)

    const response = await server.inject({
      body: {},
      method: "POST",
      url: "/api/admin/recovery/factor/commission",
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual({
      commissionedAt: "2026-07-31T12:00:00.000Z",
      recoveryFactor,
      status: "commissioned",
    })
    expect(service.commission).toHaveBeenCalledWith({
      authentication: {
        acr: "urn:llm-machines:mfa",
        amr: ["pwd", "otp"],
        authTime: recentAuthTime,
        keycloakSubjectId: "admin-1",
      },
      correlationId: expect.any(String),
      liveIdentity: {
        enabled: true,
        keycloakSubjectId: "admin-1",
        role: "admin",
      },
    })
    await server.close()
  })

  it("rejects body injection before commission, activation, or revocation", async () => {
    const service = recoveryService()
    const server = recoveryRouteServer(operatorActor, service)

    const commission = await server.inject({
      body: { keycloakSubjectId: "forged-admin" },
      method: "POST",
      url: "/api/admin/recovery/factor/commission",
    })
    const activation = await server.inject({
      body: {
        factor: recoveryFactor,
        keycloakSubjectId: "forged-operator",
        reasonCode: "admin_lockout",
      },
      method: "POST",
      url: "/api/admin/recovery/sessions",
    })
    const revocation = await server.inject({
      body: { allowAny: true },
      method: "POST",
      url: `/api/admin/recovery/sessions/${recoverySessionId}/revoke`,
    })

    expect([
      commission.statusCode,
      activation.statusCode,
      revocation.statusCode,
    ]).toEqual([400, 400, 400])
    expect(service.commission).not.toHaveBeenCalled()
    expect(service.activate).not.toHaveBeenCalled()
    expect(service.revoke).not.toHaveBeenCalled()
    await server.close()
  })

  it("activates only for a base Operator and passes recent MFA proof server-side", async () => {
    const service = recoveryService()
    vi.mocked(service.activate).mockResolvedValueOnce({
      grant: activeGrant(),
      status: "activated",
    })
    const operatorServer = recoveryRouteServer(operatorActor, service)

    const activated = await operatorServer.inject({
      body: { factor: recoveryFactor, reasonCode: "admin_role_repair" },
      method: "POST",
      url: "/api/admin/recovery/sessions",
    })

    expect(activated.statusCode).toBe(201)
    expect(service.activate).toHaveBeenCalledWith({
      authentication: {
        acr: "urn:llm-machines:mfa",
        amr: ["pwd", "otp"],
        authTime: recentAuthTime,
        keycloakSubjectId: "operator-1",
      },
      correlationId: expect.any(String),
      factor: recoveryFactor,
      liveIdentity: {
        enabled: true,
        keycloakSubjectId: "operator-1",
        role: "operator",
      },
      reasonCode: "admin_role_repair",
    })
    await operatorServer.close()

    const adminService = recoveryService()
    const adminServer = recoveryRouteServer(adminActor, adminService)
    const denied = await adminServer.inject({
      body: { factor: recoveryFactor, reasonCode: "admin_lockout" },
      method: "POST",
      url: "/api/admin/recovery/sessions",
    })
    expect(denied.statusCode).toBe(403)
    expect(adminService.activate).not.toHaveBeenCalled()
    await adminServer.close()
  })

  it("maps recent-authentication and MFA denial without exposing the factor", async () => {
    const service = recoveryService()
    vi.mocked(service.activate)
      .mockResolvedValueOnce({
        reason: "recent_authentication_required",
        status: "denied",
      })
      .mockResolvedValueOnce({ reason: "mfa_required", status: "denied" })
    const server = recoveryRouteServer(operatorActor, service)

    for (const reasonCode of ["admin_lockout", "admin_mfa_repair"] as const) {
      const response = await server.inject({
        body: { factor: recoveryFactor, reasonCode },
        method: "POST",
        url: "/api/admin/recovery/sessions",
      })
      expect(response.statusCode).toBe(403)
      expect(response.body).not.toContain(recoveryFactor)
    }
    await server.close()
  })

  it("maps bounded activation throttling to 429 without exposing the factor", async () => {
    const service = recoveryService()
    vi.mocked(service.activate).mockResolvedValueOnce({
      retryAfterSeconds: 7,
      status: "rate_limited",
    })
    const server = recoveryRouteServer(operatorActor, service)

    const response = await server.inject({
      body: { factor: recoveryFactor, reasonCode: "admin_lockout" },
      method: "POST",
      url: "/api/admin/recovery/sessions",
    })

    expect(response.statusCode).toBe(429)
    expect(response.headers["retry-after"]).toBe("7")
    expect(response.json()).toEqual({
      type: "about:blank",
      title: "Emergency recovery activation rate limited",
      status: 429,
      detail: "Retry the activation request after the indicated interval.",
    })
    expect(response.body).not.toContain(recoveryFactor)
    await server.close()
  })

  it("binds Operator revocation to ownership and gives standing Admin allowAny", async () => {
    const service = recoveryService()
    vi.mocked(service.revoke).mockResolvedValue({
      revokedAt: "2026-07-31T12:05:00.000Z",
      sessionId: recoverySessionId,
      status: "revoked",
    })
    const operatorServer = recoveryRouteServer(operatorActor, service)
    const operatorResponse = await operatorServer.inject({
      body: {},
      method: "POST",
      url: `/api/admin/recovery/sessions/${recoverySessionId}/revoke`,
    })
    expect(operatorResponse.statusCode).toBe(200)
    expect(service.revoke).toHaveBeenLastCalledWith({
      allowAny: false,
      correlationId: expect.any(String),
      requesterSubjectId: "operator-1",
      sessionId: recoverySessionId,
    })
    await operatorServer.close()

    const adminServer = recoveryRouteServer(adminActor, service)
    const adminResponse = await adminServer.inject({
      body: {},
      method: "POST",
      url: `/api/admin/recovery/sessions/${recoverySessionId}/revoke`,
    })
    expect(adminResponse.statusCode).toBe(200)
    expect(service.revoke).toHaveBeenLastCalledWith({
      allowAny: true,
      correlationId: expect.any(String),
      requesterSubjectId: "admin-1",
      sessionId: recoverySessionId,
    })
    await adminServer.close()
  })

  it("returns only bounded recovery status and fails closed when storage is unavailable", async () => {
    const service = recoveryService()
    vi.mocked(service.status)
      .mockResolvedValueOnce({
        activeGrant: activeGrant(),
        factor: {
          commissionedAt: "2026-07-31T12:00:00.000Z",
          commissionedBy: "admin-1",
        },
        status: "ok",
      })
      .mockResolvedValueOnce({ status: "unavailable" })
    const server = recoveryRouteServer(adminActor, service)

    const available = await server.inject({
      method: "GET",
      url: "/api/admin/recovery/status",
    })
    const unavailable = await server.inject({
      method: "GET",
      url: "/api/admin/recovery/status",
    })

    expect(available.statusCode).toBe(200)
    expect(available.body).not.toMatch(/factorHash|salt|verifier/i)
    expect(unavailable.statusCode).toBe(503)
    await server.close()
  })

  it("rejects an unbounded recovery service projection", async () => {
    const service = recoveryService()
    vi.mocked(service.status).mockResolvedValueOnce({
      activeGrant: null,
      factor: null,
      status: "ok",
      verifierHash: "must-not-leave-the-service",
    } as never)
    const server = recoveryRouteServer(adminActor, service)

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/recovery/status",
    })

    expect(response.statusCode).toBe(503)
    expect(response.body).not.toContain("must-not-leave-the-service")
    await server.close()
  })
})

function recoveryRouteServer(
  actor: Actor,
  service: AdminEmergencyRecoveryService,
) {
  const server = Fastify({ logger: false })
  server.addHook("preHandler", async (request) => {
    request.actor = actor
  })
  registerAdminRoutes(server, { emergencyRecoveryService: service })
  return server
}

function recoveryService(): AdminEmergencyRecoveryService {
  return {
    activate: vi.fn(async () => ({ status: "unavailable" as const })),
    commission: vi.fn(async () => ({ status: "unavailable" as const })),
    resolve: vi.fn(async () => ({ status: "inactive" as const })),
    revoke: vi.fn(async () => ({ status: "unavailable" as const })),
    status: vi.fn(async () => ({ status: "unavailable" as const })),
  }
}

function activeGrant() {
  return {
    activatedAt: "2026-07-31T12:00:00.000Z",
    expiresAt: "2026-07-31T12:15:00.000Z",
    keycloakSubjectId: "operator-1",
    nativeExpertAccess: false as const,
    reasonCode: "admin_role_repair" as const,
    scope: "console_admin_capabilities" as const,
    sessionId: recoverySessionId,
  }
}
