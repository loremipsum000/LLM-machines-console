import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import { setPureModeExecutorForTest } from "../services/admin/pure-mode-executor"
import {
  resetGovernanceForTest,
  seedGovernanceForTest,
} from "../services/admin-governance"
import {
  emitAudit,
  getAuditEventsForTest,
  resetAuditEventsForTest,
} from "../services/audit"
import { resetHubStateForTest } from "../services/hub"
import { resetIdempotencyForTest } from "../services/idempotency"

const adminHeaders = {
  authorization: "Bearer test-service-key",
  "x-llm-machines-keycloak-token": "",
  "x-llm-machines-user-sub": "admin-1",
  "x-llm-machines-user-email": "admin@example.test",
  "x-llm-machines-user-roles": "admin",
}

const builderHeaders = {
  ...adminHeaders,
  "x-llm-machines-user-sub": "builder-1",
  "x-llm-machines-user-email": "builder@example.test",
  "x-llm-machines-user-roles": "builder",
}

describe("Admin governance drilldown routes", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetAuditEventsForTest()
    setPureModeExecutorForTest(null)
    resetGovernanceForTest()
    resetHubStateForTest()
    resetIdempotencyForTest()
  })

  it.each(["/api/admin/policies/violations", "/api/admin/sandbox/pure-mode"])(
    "requires authentication for %s",
    async (url) => {
      vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
      const server = buildServer()

      const response = await server.inject({
        method: "GET",
        url,
      })

      expect(response.statusCode).toBe(401)
      expect(getAuditEventsForTest()).toEqual([
        expect.objectContaining({
          action: "auth.denied",
          reason: "missing_token",
        }),
      ])
      await server.close()
    },
  )

  it("requires authentication for policy remediation mutations", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/policies/violations/11111111-1111-4111-8111-111111111111/remediation",
      headers: {
        "idempotency-key": "policy-remediation-auth",
      },
      payload: {
        note: "Review started.",
        status: "acknowledged",
      },
    })

    expect(response.statusCode).toBe(401)
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "auth.denied",
        reason: "missing_token",
      }),
    ])
    await server.close()
  })

  it("requires authentication for Pure Mode mutations", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/sandbox/pure-mode/toggle",
      headers: {
        "idempotency-key": "pure-mode-auth",
      },
      payload: {
        action: "activate",
        confirmation: "PURE",
        reason: "Incident isolation.",
      },
    })

    expect(response.statusCode).toBe(401)
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "auth.denied",
        reason: "missing_token",
      }),
    ])
    await server.close()
  })

  it("blocks non-admin personas from policy remediation mutations", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/policies/violations/11111111-1111-4111-8111-111111111111/remediation",
      headers: {
        ...builderHeaders,
        "idempotency-key": "policy-remediation-denied",
      },
      payload: {
        note: "Review started.",
        status: "acknowledged",
      },
    })

    expect(response.statusCode).toBe(403)
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "auth.denied",
        actorId: "builder-1",
        reason: "insufficient_persona",
      }),
    ])
    await server.close()
  })

  it("blocks non-admin personas from Pure Mode mutations", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/sandbox/pure-mode/toggle",
      headers: {
        ...builderHeaders,
        "idempotency-key": "pure-mode-denied",
      },
      payload: {
        action: "activate",
        confirmation: "PURE",
        reason: "Incident isolation.",
      },
    })

    expect(response.statusCode).toBe(403)
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "auth.denied",
        actorId: "builder-1",
        reason: "insufficient_persona",
      }),
    ])
    await server.close()
  })

  it.each(["/api/admin/policies/violations", "/api/admin/sandbox/pure-mode"])(
    "blocks non-admin personas from %s",
    async (url) => {
      vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
      const server = buildServer()

      const response = await server.inject({
        method: "GET",
        url,
        headers: builderHeaders,
      })

      expect(response.statusCode).toBe(403)
      expect(getAuditEventsForTest()).toEqual([
        expect.objectContaining({
          action: "auth.denied",
          actorId: "builder-1",
          reason: "insufficient_persona",
        }),
      ])
      await server.close()
    },
  )

  it("returns Admin policy violations and audits the read", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    seedGovernanceForTest({
      policyViolations: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          actionTaken: "block",
          actorId: "consumer-1",
          createdAt: new Date().toISOString(),
          message: "PII egress blocked.",
          metadata: {
            entity: "email",
          },
          policyType: "content_safety",
          severity: "critical",
          targetId: "thread-pii",
          targetType: "chat.thread",
        },
      ],
    })
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/policies/violations?q=pii",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      criticalCount: 1,
      query: "pii",
      sourceStatus: "degraded",
      totalCount: 1,
      violations: [
        expect.objectContaining({
          actionTaken: "block",
          actorId: "consumer-1",
          auditHref: "#audit-log-deferred",
          message: "PII egress blocked.",
        }),
      ],
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "admin.policy_violations.read",
          actorId: "admin-1",
          targetType: "admin.policy_violations",
        }),
      ]),
    )
    await server.close()
  })

  it("records policy violation remediation actions and audits them", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    seedGovernanceForTest({
      policyViolations: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          actionTaken: "block",
          actorId: "consumer-1",
          createdAt: new Date().toISOString(),
          message: "PII egress blocked.",
          policyType: "content_safety",
          severity: "critical",
          targetId: "thread-pii",
          targetType: "chat.thread",
        },
      ],
    })
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/policies/violations/11111111-1111-4111-8111-111111111111/remediation",
      headers: {
        ...adminHeaders,
        "idempotency-key": "policy-remediation-1",
      },
      payload: {
        note: "Owner notified and ticket opened.",
        status: "acknowledged",
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      remediationActorId: "admin-1",
      remediationNote: "Owner notified and ticket opened.",
      remediationStatus: "acknowledged",
    })

    const replay = await server.inject({
      method: "POST",
      url: "/api/admin/policies/violations/11111111-1111-4111-8111-111111111111/remediation",
      headers: {
        ...adminHeaders,
        "idempotency-key": "policy-remediation-1",
      },
      payload: {
        note: "Owner notified and ticket opened.",
        status: "acknowledged",
      },
    })

    expect(replay.statusCode).toBe(200)
    expect(replay.json()).toMatchObject({
      remediationStatus: "acknowledged",
    })

    const list = await server.inject({
      method: "GET",
      url: "/api/admin/policies/violations?q=owner",
      headers: adminHeaders,
    })

    expect(list.statusCode).toBe(200)
    expect(list.json()).toMatchObject({
      totalCount: 1,
      violations: [
        expect.objectContaining({
          remediationActorId: "admin-1",
          remediationStatus: "acknowledged",
        }),
      ],
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "admin.policy_violation.acknowledged",
          actorId: "admin-1",
          reason: "Owner notified and ticket opened.",
          targetId: "11111111-1111-4111-8111-111111111111",
        }),
      ]),
    )
    await server.close()
  })

  it("requires idempotency keys for policy remediation mutations", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/policies/violations/11111111-1111-4111-8111-111111111111/remediation",
      headers: adminHeaders,
      payload: {
        note: "Review started.",
        status: "acknowledged",
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      title: "Idempotency key is required",
    })
    await server.close()
  })

  it("requires idempotency keys for Pure Mode mutations", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/sandbox/pure-mode/toggle",
      headers: adminHeaders,
      payload: {
        action: "activate",
        confirmation: "PURE",
        reason: "Incident isolation.",
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      title: "Idempotency key is required",
    })
    await server.close()
  })

  it("requires exact typed confirmation for Pure Mode mutations", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/sandbox/pure-mode/toggle",
      headers: {
        ...adminHeaders,
        "idempotency-key": "pure-mode-invalid-confirmation",
      },
      payload: {
        action: "activate",
        confirmation: "pure",
        reason: "Incident isolation.",
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      title: "Invalid Pure Mode transition request",
    })
    await server.close()
  })

  it("activates and restores Pure Mode with audit events", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const activate = await server.inject({
      method: "POST",
      url: "/api/admin/sandbox/pure-mode/toggle",
      headers: {
        ...adminHeaders,
        "idempotency-key": "pure-mode-activate",
      },
      payload: {
        action: "activate",
        confirmation: "PURE",
        reason: "Incident isolation for custom workloads.",
      },
    })

    expect(activate.statusCode).toBe(200)
    expect(activate.json()).toMatchObject({
      active: true,
      affectedComponents: expect.arrayContaining(["t3-client-agents"]),
      control: {
        enabled: true,
      },
      reason: "Incident isolation for custom workloads.",
      recentEvents: [
        expect.objectContaining({
          action: "admin.pure_mode.activate",
          reason: "Incident isolation for custom workloads.",
          severity: "critical",
        }),
      ],
      sourceStatus: "degraded",
    })

    const replay = await server.inject({
      method: "POST",
      url: "/api/admin/sandbox/pure-mode/toggle",
      headers: {
        ...adminHeaders,
        "idempotency-key": "pure-mode-activate",
      },
      payload: {
        action: "activate",
        confirmation: "PURE",
        reason: "Incident isolation for custom workloads.",
      },
    })

    expect(replay.statusCode).toBe(200)
    expect(replay.json()).toMatchObject({
      active: true,
    })

    const restore = await server.inject({
      method: "POST",
      url: "/api/admin/sandbox/pure-mode/toggle",
      headers: {
        ...adminHeaders,
        "idempotency-key": "pure-mode-restore",
      },
      payload: {
        action: "restore",
        confirmation: "PURE",
        reason: "Incident cleared after review.",
      },
    })

    expect(restore.statusCode).toBe(200)
    expect(restore.json()).toMatchObject({
      active: false,
      affectedComponents: [],
      reason: "Incident cleared after review.",
      recentEvents: expect.arrayContaining([
        expect.objectContaining({
          action: "admin.pure_mode.restore",
          reason: "Incident cleared after review.",
        }),
      ]),
      sourceStatus: "ok",
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "admin.pure_mode.activate",
          actorId: "admin-1",
          metadata: expect.objectContaining({
            confirmation: "PURE",
            executorStatus: "state_only",
            previousActive: false,
          }),
        }),
        expect.objectContaining({
          action: "admin.pure_mode.restore",
          actorId: "admin-1",
          metadata: expect.objectContaining({
            nextActive: false,
            previousActive: true,
          }),
        }),
      ]),
    )
    await server.close()
  })

  it("persists Docker executor targets and writes executor metadata", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const activateExecutor = vi.fn(async () => ({
      affectedComponents: ["docker:t3-client-agent"],
      executorStatus: "docker" as const,
      metadata: {
        dockerTargetCount: 1,
      },
    }))
    const restoreExecutor = vi.fn(async () => ({
      affectedComponents: [],
      executorStatus: "docker" as const,
      metadata: {
        dockerRestoredCount: 1,
      },
    }))
    setPureModeExecutorForTest({
      activate: activateExecutor,
      restore: restoreExecutor,
    })
    const server = buildServer()

    const activate = await server.inject({
      method: "POST",
      url: "/api/admin/sandbox/pure-mode/toggle",
      headers: {
        ...adminHeaders,
        "idempotency-key": "pure-mode-docker-activate",
      },
      payload: {
        action: "activate",
        confirmation: "PURE",
        reason: "Isolate Docker-backed client workload.",
      },
    })

    expect(activate.statusCode).toBe(200)
    expect(activate.json()).toMatchObject({
      active: true,
      affectedComponents: ["docker:t3-client-agent"],
    })

    const restore = await server.inject({
      method: "POST",
      url: "/api/admin/sandbox/pure-mode/toggle",
      headers: {
        ...adminHeaders,
        "idempotency-key": "pure-mode-docker-restore",
      },
      payload: {
        action: "restore",
        confirmation: "PURE",
        reason: "Docker-backed client workload cleared.",
      },
    })

    expect(restore.statusCode).toBe(200)
    expect(restore.json()).toMatchObject({
      active: false,
      affectedComponents: [],
    })
    expect(restoreExecutor).toHaveBeenCalledWith(["docker:t3-client-agent"])
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "admin.pure_mode.activate",
          metadata: expect.objectContaining({
            dockerTargetCount: 1,
            executorStatus: "docker",
          }),
        }),
        expect.objectContaining({
          action: "admin.pure_mode.restore",
          metadata: expect.objectContaining({
            dockerRestoredCount: 1,
            executorStatus: "docker",
          }),
        }),
      ]),
    )
    await server.close()
  })

  it("returns unavailable when the Pure Mode executor fails", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    setPureModeExecutorForTest({
      async activate() {
        throw new Error("Docker socket unavailable")
      },
      async restore() {
        throw new Error("restore was not expected")
      },
    })
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/sandbox/pure-mode/toggle",
      headers: {
        ...adminHeaders,
        "idempotency-key": "pure-mode-executor-failure",
      },
      payload: {
        action: "activate",
        confirmation: "PURE",
        reason: "Incident isolation with executor failure.",
      },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      detail: "Docker socket unavailable",
      title: "Pure Mode executor failed",
    })

    const status = await server.inject({
      method: "GET",
      url: "/api/admin/sandbox/pure-mode",
      headers: adminHeaders,
    })

    expect(status.statusCode).toBe(200)
    expect(status.json()).toMatchObject({
      active: false,
      affectedComponents: [],
    })
    await server.close()
  })

  it("rejects Pure Mode restore when Pure Mode is inactive", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/sandbox/pure-mode/toggle",
      headers: {
        ...adminHeaders,
        "idempotency-key": "pure-mode-restore-inactive",
      },
      payload: {
        action: "restore",
        confirmation: "PURE",
        reason: "No active incident.",
      },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({
      title: "Pure Mode is not active",
    })
    await server.close()
  })

  it("returns Pure Mode status and recent Pure Mode audit events", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    seedGovernanceForTest({
      pureMode: {
        active: true,
        affectedComponents: ["builder-worker", "client-agent"],
        reason: "Incident isolation",
        updatedAt: new Date().toISOString(),
      },
    })
    await emitAudit({
      actorId: "admin-1",
      action: "admin.pure_mode.activate",
      targetType: "admin.pure_mode_state",
      targetId: "singleton",
      reason: "Incident isolation",
    })
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/sandbox/pure-mode",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      active: true,
      affectedComponents: ["builder-worker", "client-agent"],
      control: {
        enabled: true,
      },
      reason: "Incident isolation",
      recentEvents: [
        expect.objectContaining({
          action: "admin.pure_mode.activate",
          severity: "critical",
        }),
      ],
      sourceStatus: "degraded",
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "admin.pure_mode.read",
          actorId: "admin-1",
          targetType: "admin.pure_mode_state",
        }),
      ]),
    )
    await server.close()
  })
})
