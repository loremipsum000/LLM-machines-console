import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/authorization"
import { registerAuthorization } from "../auth/authorization"
import {
  getAuditEventsForTest,
  resetAuditEventsForTest,
} from "../services/audit"
import {
  EmergencyIsolationAtomicCommitError,
  EmergencyIsolationRecoveryRequiredError,
  EmergencyIsolationUnavailableError,
} from "../services/emergency-isolation"
import { resetIdempotencyForTest } from "../services/idempotency"
import {
  type AdminEmergencyIsolationService,
  registerAdminRoutes,
} from "./admin"

const timestamp = "2026-08-02T12:00:00.000Z"
const recoverySessionId = "01234567-89ab-4def-8123-456789abcdef"

describe("Admin Emergency Isolation routes", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.useRealTimers()
    resetAuditEventsForTest()
    resetIdempotencyForTest()
  })

  it("gives Operator the bounded operational view and fails closed on malformed state", async () => {
    const service = isolationService()
    vi.mocked(service.status)
      .mockResolvedValueOnce(inactiveStatus())
      .mockResolvedValueOnce({
        ...inactiveStatus(),
        internalFenceToken: "must-not-leak",
      } as never)
    const server = isolationRouteServer(operatorActor(), service)

    const available = await server.inject({
      method: "GET",
      url: "/api/admin/isolation",
    })
    const malformed = await server.inject({
      method: "GET",
      url: "/api/admin/isolation",
    })

    expect(available.statusCode).toBe(200)
    expect(available.json()).toEqual(inactiveStatus())
    expect(malformed.statusCode).toBe(503)
    expect(malformed.body).not.toContain("must-not-leak")
    await server.close()
  })

  it("rejects non-exact activation and deactivation bodies before the service", async () => {
    const service = isolationService()
    const server = isolationRouteServer(adminActor(), service)

    const activation = await server.inject({
      headers: { "idempotency-key": "isolation-invalid-activate" },
      method: "POST",
      payload: {
        confirmation: "ACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 0,
        force: true,
      },
      url: "/api/admin/isolation/activate",
    })
    const deactivation = await server.inject({
      headers: { "idempotency-key": "isolation-invalid-deactivate" },
      method: "POST",
      payload: {
        confirmation: "deactivate emergency isolation",
        expectedRevision: 1,
      },
      url: "/api/admin/isolation/deactivate",
    })

    expect([activation.statusCode, deactivation.statusCode]).toEqual([400, 400])
    expect(service.activate).not.toHaveBeenCalled()
    expect(service.deactivate).not.toHaveBeenCalled()
    expect(
      getAuditEventsForTest().map((event) => ({
        action: event.action,
        keycloakSubjectId: event.keycloakSubjectId,
        outcome: event.outcome,
      })),
    ).toEqual([
      {
        action: "admin.isolation.activate.denied",
        keycloakSubjectId: "admin-isolation",
        outcome: "denied",
      },
      {
        action: "admin.isolation.deactivate.denied",
        keycloakSubjectId: "admin-isolation",
        outcome: "denied",
      },
    ])
    expect(JSON.stringify(getAuditEventsForTest())).not.toMatch(
      /force|ACTIVATE EMERGENCY ISOLATION|isolation-invalid/,
    )
    await server.close()
  })

  it("activates at the inclusive 300-second Keycloak MFA boundary", async () => {
    const now = new Date(timestamp)
    vi.spyOn(Date, "now").mockReturnValue(now.getTime())
    const service = isolationService()
    const actor = adminActor(Math.floor(now.getTime() / 1000) - 300, [
      "pwd",
      "webauthn",
    ])
    const server = isolationRouteServer(actor, service)
    const body = {
      confirmation: "ACTIVATE EMERGENCY ISOLATION" as const,
      expectedRevision: 0,
    }

    const response = await server.inject({
      headers: { "idempotency-key": "isolation-activate-1" },
      method: "POST",
      payload: body,
      url: "/api/admin/isolation/activate",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(activeResult())
    expect(service.activate).toHaveBeenCalledWith(
      actor,
      expect.any(String),
      body,
      expect.any(Function),
    )
    await server.close()
  })

  it("deactivates with exact confirmation and server-derived Admin identity", async () => {
    const service = isolationService()
    const actor = adminActor()
    const server = isolationRouteServer(actor, service)
    const body = {
      confirmation: "DEACTIVATE EMERGENCY ISOLATION" as const,
      expectedRevision: 1,
    }

    const response = await server.inject({
      headers: { "idempotency-key": "isolation-deactivate-1" },
      method: "POST",
      payload: body,
      url: "/api/admin/isolation/deactivate",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(inactiveResult())
    expect(service.deactivate).toHaveBeenCalledWith(
      actor,
      expect.any(String),
      body,
      expect.any(Function),
    )
    await server.close()
  })

  it("rejects stale, future, non-Keycloak, and non-MFA authentication", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const service = isolationService()
    const actors: Actor[] = [
      adminActor(nowSeconds - 301),
      adminActor(nowSeconds + 301),
      { ...adminActor(nowSeconds - 30), authMode: "service-forwarded" },
      adminActor(nowSeconds - 30, ["pwd"]),
    ]

    for (const [index, actor] of actors.entries()) {
      const server = isolationRouteServer(actor, service)
      const response = await server.inject({
        headers: { "idempotency-key": `isolation-auth-denied-${index}` },
        method: "POST",
        payload: {
          confirmation: "ACTIVATE EMERGENCY ISOLATION",
          expectedRevision: 0,
        },
        url: "/api/admin/isolation/activate",
      })
      expect(response.statusCode).toBe(403)
      await server.close()
    }
    expect(service.activate).not.toHaveBeenCalled()
    expect(getAuditEventsForTest().map((event) => event.action)).toEqual([
      "admin.isolation.activate.denied",
      "admin.isolation.activate.denied",
      "admin.isolation.activate.denied",
      "admin.isolation.activate.denied",
    ])
  })

  it("requires an Idempotency-Key and replays a completed mutation once", async () => {
    const service = isolationService()
    const server = isolationRouteServer(adminActor(), service)
    const request = {
      method: "POST" as const,
      payload: {
        confirmation: "ACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 0,
      },
      url: "/api/admin/isolation/activate",
    }

    const missing = await server.inject(request)
    const first = await server.inject({
      ...request,
      headers: { "idempotency-key": "isolation-replay-1" },
    })
    const replay = await server.inject({
      ...request,
      headers: { "idempotency-key": "isolation-replay-1" },
    })

    expect(missing.statusCode).toBe(400)
    expect(first.statusCode).toBe(200)
    expect(replay.statusCode).toBe(200)
    expect(replay.json()).toMatchObject({
      outcome: "succeeded",
      resourceId: "appliance",
      status: "already_completed",
    })
    expect(service.activate).toHaveBeenCalledTimes(1)
    await server.close()
  })

  it("keeps an emergency-elevated Operator view-only on isolation mutations", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const service = isolationService()
    const resolveRecoverySession = vi.fn(async () => ({
      grant: {
        activatedAt: timestamp,
        expiresAt: "2026-08-02T12:15:00.000Z",
        keycloakSubjectId: "operator-isolation",
        reasonCode: "admin_lockout" as const,
        scope: "console_admin_capabilities" as const,
        sessionId: recoverySessionId,
      },
      status: "active" as const,
    }))
    const server = Fastify({ logger: false })
    registerAuthorization(server, {
      resolveCurrentIdentity: async (actor) => ({
        enabled: true,
        role: "operator",
        subject: actor.subject,
      }),
      resolveRecoverySession,
    })
    registerAdminRoutes(server, {
      emergencyIsolationService: service,
      emergencyRecoveryService: null,
    })
    const headers = {
      authorization: "Bearer test-service-key",
      "idempotency-key": "operator-isolation-1",
      "x-llm-machines-recovery-session-id": recoverySessionId,
      "x-llm-machines-user-roles": "operator",
      "x-llm-machines-user-sub": "operator-isolation",
    }

    const view = await server.inject({
      headers,
      method: "GET",
      url: "/api/admin/isolation",
    })
    const mutation = await server.inject({
      headers,
      method: "POST",
      payload: {
        confirmation: "ACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 0,
      },
      url: "/api/admin/isolation/activate",
    })

    expect(view.statusCode).toBe(200)
    expect(mutation.statusCode).toBe(403)
    expect(resolveRecoverySession).not.toHaveBeenCalled()
    expect(service.activate).not.toHaveBeenCalled()
    await server.close()
  })

  it("maps unavailable or invalid mutation state to a sealed 503 response", async () => {
    const service = isolationService()
    vi.mocked(service.activate)
      .mockRejectedValueOnce(new Error("internal fence address"))
      .mockResolvedValueOnce({
        state: "inactive",
        secret: "do-not-leak",
      } as never)
    const server = isolationRouteServer(adminActor(), service)

    for (const idempotencyKey of ["isolation-error-1", "isolation-error-2"]) {
      const response = await server.inject({
        headers: { "idempotency-key": idempotencyKey },
        method: "POST",
        payload: {
          confirmation: "ACTIVATE EMERGENCY ISOLATION",
          expectedRevision: 0,
        },
        url: "/api/admin/isolation/activate",
      })
      expect(response.statusCode).toBe(503)
      expect(response.body).toContain("T2 traffic must remain sealed")
      expect(response.body).not.toMatch(/internal fence address|do-not-leak/)
    }
    await server.close()
  })

  it("maps recovery-required deactivation to a refreshable 409", async () => {
    const service = isolationService()
    vi.mocked(service.deactivate).mockRejectedValueOnce(
      new EmergencyIsolationRecoveryRequiredError(recoveryRequiredStatus()),
    )
    const server = isolationRouteServer(adminActor(), service)

    const response = await server.inject({
      headers: { "idempotency-key": "isolation-recovery-required-1" },
      method: "POST",
      payload: {
        confirmation: "DEACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 2,
      },
      url: "/api/admin/isolation/deactivate",
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({
      status: 409,
      title: "Emergency Isolation recovery required",
    })
    await server.close()
  })

  it("replays an atomically committed failed isolation receipt as failed 503", async () => {
    const service = isolationService()
    vi.mocked(service.activate).mockImplementationOnce(
      async (_actor, _correlationId, _request, commitWithReceipt) => {
        if (!commitWithReceipt) {
          throw new Error("missing receipt callback")
        }
        await commitWithReceipt({
          outcome: "failed",
          resourceId: "appliance",
          run: async () => undefined,
          statusCode: 503,
        })
        throw new EmergencyIsolationUnavailableError()
      },
    )
    const server = isolationRouteServer(adminActor(), service)
    const request = {
      headers: { "idempotency-key": "isolation-failed-receipt-1" },
      method: "POST" as const,
      payload: {
        confirmation: "ACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 0,
      },
      url: "/api/admin/isolation/activate",
    }

    const first = await server.inject(request)
    const replay = await server.inject(request)

    expect(first.statusCode).toBe(503)
    expect(replay.statusCode).toBe(503)
    expect(replay.json()).toMatchObject({
      outcome: "failed",
      resourceId: "appliance",
      status: "already_completed",
    })
    expect(service.activate).toHaveBeenCalledTimes(1)
    await server.close()
  })

  it("leaves a failed atomic recovery transaction pending instead of creating a replay receipt", async () => {
    const service = isolationService()
    vi.mocked(service.activate).mockImplementationOnce(
      async (_actor, _correlationId, _request, commitWithReceipt) => {
        if (!commitWithReceipt) {
          throw new Error("missing receipt callback")
        }
        await expect(
          commitWithReceipt({
            outcome: "failed",
            resourceId: "appliance",
            run: async () => {
              throw new Error("recovery transaction failed")
            },
            statusCode: 503,
          }),
        ).rejects.toThrow("recovery transaction failed")
        throw new EmergencyIsolationAtomicCommitError()
      },
    )
    const server = isolationRouteServer(adminActor(), service)
    const request = {
      headers: { "idempotency-key": "isolation-atomic-failure-1" },
      method: "POST" as const,
      payload: {
        confirmation: "ACTIVATE EMERGENCY ISOLATION",
        expectedRevision: 0,
      },
      url: "/api/admin/isolation/activate",
    }

    const first = await server.inject(request)
    const replay = await server.inject(request)

    expect(first.statusCode).toBe(503)
    expect(first.json()).toMatchObject({
      status: 503,
      title: "Emergency Isolation requires reconciliation",
    })
    expect(replay.statusCode).toBe(409)
    expect(replay.json()).toMatchObject({
      status: 409,
      title: "Admin mutation is still in progress",
    })
    expect(replay.body).not.toContain("already_completed")
    expect(service.activate).toHaveBeenCalledTimes(1)
    await server.close()
  })
})

function isolationRouteServer(
  actor: Actor,
  service: AdminEmergencyIsolationService,
) {
  const server = Fastify({ logger: false })
  server.addHook("preHandler", async (request) => {
    request.actor = actor
  })
  registerAdminRoutes(server, {
    emergencyIsolationService: service,
    emergencyRecoveryService: null,
  })
  return server
}

function isolationService(): AdminEmergencyIsolationService {
  return {
    activate: vi.fn(async () => activeResult()),
    deactivate: vi.fn(async () => inactiveResult()),
    status: vi.fn(async () => inactiveStatus()),
  }
}

function adminActor(
  authTime = Math.floor(Date.now() / 1000) - 30,
  amr = ["pwd", "otp"],
): Actor {
  return {
    acr: "urn:llm-machines:mfa",
    amr,
    authMode: "keycloak",
    authTime,
    role: "admin",
    subject: "admin-isolation",
  }
}

function operatorActor(): Actor {
  return {
    ...adminActor(),
    role: "operator",
    subject: "operator-isolation",
  }
}

function inactiveStatus() {
  return {
    activatedAt: null,
    activatedBySubjectId: null,
    effectiveTrafficState: "open" as const,
    failureCode: null,
    revision: 0,
    runtimeQualified: false as const,
    state: "inactive" as const,
    updatedAt: timestamp,
    updatedBySubjectId: null,
  }
}

function activeResult() {
  return {
    activatedAt: timestamp,
    activatedBySubjectId: "admin-isolation",
    effectiveTrafficState: "sealed" as const,
    failureCode: null,
    result: "activated" as const,
    revision: 1,
    runtimeQualified: false as const,
    state: "active" as const,
    updatedAt: timestamp,
    updatedBySubjectId: "admin-isolation",
  }
}

function inactiveResult() {
  return {
    ...inactiveStatus(),
    result: "deactivated" as const,
    revision: 2,
    updatedBySubjectId: "admin-isolation",
  }
}

function recoveryRequiredStatus() {
  const { result: _result, ...active } = activeResult()
  return {
    ...active,
    failureCode: "verification_failed" as const,
    revision: 2,
    state: "recovery_required" as const,
  }
}
