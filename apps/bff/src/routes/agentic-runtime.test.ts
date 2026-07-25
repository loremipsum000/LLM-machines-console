import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import {
  getAuditEventsForTest,
  resetAuditEventsForTest,
} from "../services/audit"
import { resetGovernanceForTest } from "../services/admin-governance"
import { resetAgenticRuntimeHistoryForTest } from "../services/agentic-runtime-history"
import { resetEgressApprovalsForTest } from "../services/egress-approvals"
import { resetIdempotencyForTest } from "../services/idempotency"

const adminHeaders = {
  authorization: "Bearer test-service-key",
  "x-llm-machines-keycloak-token": "",
  "x-llm-machines-user-sub": "admin-1",
  "x-llm-machines-user-email": "admin@example.test",
  "x-llm-machines-user-roles": "admin",
}

const consumerHeaders = {
  ...adminHeaders,
  "x-llm-machines-user-sub": "user-1",
  "x-llm-machines-user-email": "user@example.test",
  "x-llm-machines-user-roles": "consumer",
}

describe("Agentic runtime routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    resetAuditEventsForTest()
    resetEgressApprovalsForTest()
    resetAgenticRuntimeHistoryForTest()
    resetGovernanceForTest()
    resetIdempotencyForTest()
  })

  it("requires admin access for runtime status", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/agentic/status",
      headers: consumerHeaders,
    })

    expect(response.statusCode).toBe(403)
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "auth.denied",
        actorId: "user-1",
        reason: "insufficient_persona",
      }),
    ])
    await server.close()
  })

  it("rejects an invalid forwarded JWT instead of falling back to identity headers", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("KEYCLOAK_ISSUER_URL", "https://keycloak.example/realms/test")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/agentic/status",
      headers: {
        ...adminHeaders,
        "x-llm-machines-keycloak-token": "not-a-valid-jwt",
      },
    })

    expect(response.statusCode).toBe(401)
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "auth.denied",
        reason: "invalid_forwarded_token",
      }),
    ])
    await server.close()
  })

  it("reports unconfigured runtimes to admins", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/agentic/status",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      runtimes: [
        {
          runtime: "openclaw",
          profile: "openclaw-restricted",
          configured: false,
          healthy: false,
          baseUrl: null,
          detail: "Base URL is not configured.",
        },
        {
          runtime: "hermes",
          profile: "hermes-restricted",
          configured: false,
          healthy: false,
          baseUrl: null,
          detail: "Base URL is not configured.",
        },
      ],
    })
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "admin.agentic_runtime.status.read",
        actorId: "admin-1",
        metadata: expect.objectContaining({
          configuredRuntimes: 0,
          healthyRuntimes: 0,
        }),
      }),
    ])
    await server.close()
  })

  it("reports runtime history and SLOs from recorded status reads", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    await server.inject({
      method: "GET",
      url: "/api/admin/agentic/status",
      headers: adminHeaders,
    })

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/agentic/history?windowHours=6",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      windowHours: 6,
      samples: expect.arrayContaining([
        expect.objectContaining({
          runtime: "openclaw",
          configured: false,
          healthy: false,
        }),
        expect.objectContaining({
          runtime: "hermes",
          configured: false,
          healthy: false,
        }),
      ]),
      slos: expect.arrayContaining([
        expect.objectContaining({
          runtime: "openclaw",
          status: "not_configured",
          sampleCount: 1,
          uptimePercent: 0,
        }),
        expect.objectContaining({
          runtime: "hermes",
          status: "not_configured",
          sampleCount: 1,
          uptimePercent: 0,
        }),
      ]),
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "admin.agentic_runtime.history.read",
          actorId: "admin-1",
        }),
      ]),
    )
    await server.close()
  })

  it("validates egress approval shape before adapter work", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/agentic/egress-approvals",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
        "idempotency-key": "egress-shape-1",
      },
      payload: {
        sandboxName: "openclaw-restricted",
        profile: "openclaw-tools",
        endpointHost: "api.github.com",
        endpointPort: 443,
        accessMode: "read_only",
        reason: "Test read-only GitHub connector",
      },
    })

    expect(response.statusCode).toBe(501)
    expect(response.json()).toMatchObject({
      title: "Egress approval adapter is not configured",
    })
    await server.close()
  })

  it("requires an idempotency key for egress approvals", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/agentic/egress-approvals",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
      },
      payload: {
        sandboxName: "openclaw-restricted",
        profile: "openclaw-restricted",
        endpointHost: "api.github.com",
        endpointPort: 443,
        accessMode: "read_only",
        reason: "Test read-only GitHub connector",
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      title: "Idempotency key is required",
    })
    await server.close()
  })

  it("can restrict egress approval control to named admin subjects", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_RUNTIME_CONTROL_ADMIN_SUBJECTS", "runtime-admin")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/agentic/egress-approvals",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
        "idempotency-key": "egress-control-denied-1",
      },
      payload: {
        sandboxName: "openclaw-restricted",
        profile: "openclaw-restricted",
        endpointHost: "api.github.com",
        endpointPort: 443,
        accessMode: "read_only",
        reason: "Test read-only GitHub connector",
      },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({
      title: "Runtime control is restricted",
    })
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "admin.agentic_runtime.control.denied",
        actorId: "admin-1",
        reason: "runtime_control_not_allowed",
      }),
    ])
    await server.close()
  })

  it("sends valid egress approvals to the configured adapter", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_ADAPTER_BASE_URL", "http://agentic-adapter.test")
    vi.stubEnv("AGENTIC_ADAPTER_TOKEN", "adapter-token")
    vi.stubEnv("AGENTIC_APPROVAL_SIGNING_SECRET", "approval-secret")
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          approvalId: body.approvalId,
          sandboxName: "openclaw-restricted",
          endpoint: "api.github.com:443:read-only:rest:enforce",
          status: "dry_run",
          command: ["openshell", "policy", "update", "--dry-run"],
          rollbackCommand: ["openshell", "policy", "update"],
          stdout: "",
          stderr: "",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/agentic/egress-approvals",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
        "idempotency-key": "egress-valid-1",
      },
      payload: {
        sandboxName: "openclaw-restricted",
        profile: "openclaw-restricted",
        endpointHost: "api.github.com",
        endpointPort: 443,
        accessMode: "read_only",
        reason: "Test read-only GitHub connector",
      },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      sandboxName: "openclaw-restricted",
      status: "dry_run",
    })
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/v1/egress/approvals", "http://agentic-adapter.test"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer adapter-token",
          "X-LLM-Machines-Approval-Envelope": expect.any(String),
        }),
      }),
    )
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "egress_approval.requested",
        actorId: "admin-1",
      }),
      expect.objectContaining({
        action: "egress_approval.dry_run",
        actorId: "admin-1",
      }),
    ])
    await server.close()
  })

  it("revokes active egress approvals through the configured adapter", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_ADAPTER_BASE_URL", "http://agentic-adapter.test")
    vi.stubEnv("AGENTIC_ADAPTER_TOKEN", "adapter-token")
    vi.stubEnv("AGENTIC_APPROVAL_SIGNING_SECRET", "approval-secret")
    const fetchMock = vi.fn(async (url: URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      if (url.pathname === "/v1/egress/revocations") {
        return Response.json({
          approvalId: body.approvalId,
          sandboxName: "openclaw-restricted",
          endpoint: "api.github.com:443",
          status: "revoked",
          command: ["openshell", "policy", "update", "--remove-endpoint"],
          stdout: "",
          stderr: "",
        })
      }

      return Response.json({
        approvalId: body.approvalId,
        sandboxName: "openclaw-restricted",
        endpoint: "api.github.com:443:read-only:rest:enforce",
        status: "applied",
        command: ["openshell", "policy", "update", "--wait"],
        rollbackCommand: ["openshell", "policy", "update", "--remove-endpoint"],
        stdout: "",
        stderr: "",
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const approval = await server.inject({
      method: "POST",
      url: "/api/admin/agentic/egress-approvals",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
        "idempotency-key": "egress-apply-1",
      },
      payload: {
        sandboxName: "openclaw-restricted",
        profile: "openclaw-restricted",
        endpointHost: "api.github.com",
        endpointPort: 443,
        accessMode: "read_only",
        reason: "Test read-only GitHub connector",
      },
    })
    const approvalId = approval.json().approvalId

    const revocation = await server.inject({
      method: "POST",
      url: `/api/admin/agentic/egress-approvals/${approvalId}/revoke`,
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
        "idempotency-key": "egress-revoke-1",
      },
      payload: {
        reason: "Rollback test approval",
      },
    })

    expect(approval.statusCode).toBe(201)
    expect(revocation.statusCode).toBe(200)
    expect(revocation.json()).toMatchObject({
      approvalId,
      status: "revoked",
      endpoint: "api.github.com:443",
    })
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/v1/egress/revocations", "http://agentic-adapter.test"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer adapter-token",
          "X-LLM-Machines-Revocation-Envelope": expect.any(String),
        }),
      }),
    )
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "egress_approval.applied",
          targetId: approvalId,
        }),
        expect.objectContaining({
          action: "egress_approval.revoke_requested",
          targetId: approvalId,
        }),
        expect.objectContaining({
          action: "egress_approval.revoked",
          targetId: approvalId,
        }),
      ]),
    )
    await server.close()
  })

  it("replays duplicate egress approvals with the same idempotency key and body", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_ADAPTER_BASE_URL", "http://agentic-adapter.test")
    vi.stubEnv("AGENTIC_ADAPTER_TOKEN", "adapter-token")
    vi.stubEnv("AGENTIC_APPROVAL_SIGNING_SECRET", "approval-secret")
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          approvalId: body.approvalId,
          sandboxName: "openclaw-restricted",
          endpoint: "api.github.com:443:read-only:rest:enforce",
          status: "dry_run",
          command: ["openshell", "policy", "update", "--dry-run"],
          rollbackCommand: ["openshell", "policy", "update"],
          stdout: "",
          stderr: "",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const request = {
      method: "POST",
      url: "/api/admin/agentic/egress-approvals",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
        "idempotency-key": "egress-replay-1",
      },
      payload: {
        sandboxName: "openclaw-restricted",
        profile: "openclaw-restricted",
        endpointHost: "api.github.com",
        endpointPort: 443,
        accessMode: "read_only",
        reason: "Test read-only GitHub connector",
      },
    } as const

    const first = await server.inject(request)
    const second = await server.inject(request)

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect(second.json()).toEqual(first.json())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await server.close()
  })

  it("rejects idempotency key reuse with a different request body", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_ADAPTER_BASE_URL", "http://agentic-adapter.test")
    vi.stubEnv("AGENTIC_ADAPTER_TOKEN", "adapter-token")
    vi.stubEnv("AGENTIC_APPROVAL_SIGNING_SECRET", "approval-secret")
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          approvalId: body.approvalId,
          sandboxName: "openclaw-restricted",
          endpoint: "api.github.com:443:read-only:rest:enforce",
          status: "dry_run",
          command: ["openshell", "policy", "update", "--dry-run"],
          rollbackCommand: ["openshell", "policy", "update"],
          stdout: "",
          stderr: "",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    await server.inject({
      method: "POST",
      url: "/api/admin/agentic/egress-approvals",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
        "idempotency-key": "egress-conflict-1",
      },
      payload: {
        sandboxName: "openclaw-restricted",
        profile: "openclaw-restricted",
        endpointHost: "api.github.com",
        endpointPort: 443,
        accessMode: "read_only",
        reason: "Test read-only GitHub connector",
      },
    })
    const conflict = await server.inject({
      method: "POST",
      url: "/api/admin/agentic/egress-approvals",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
        "idempotency-key": "egress-conflict-1",
      },
      payload: {
        sandboxName: "openclaw-restricted",
        profile: "openclaw-restricted",
        endpointHost: "docs.github.com",
        endpointPort: 443,
        accessMode: "read_only",
        reason: "Test read-only GitHub connector",
      },
    })

    expect(conflict.statusCode).toBe(409)
    await server.close()
  })

  it("returns problem-details for non-JSON adapter failures", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_ADAPTER_BASE_URL", "http://agentic-adapter.test")
    vi.stubEnv("AGENTIC_ADAPTER_TOKEN", "adapter-token")
    vi.stubEnv("AGENTIC_APPROVAL_SIGNING_SECRET", "approval-secret")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("adapter down", { status: 502 })),
    )
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/agentic/egress-approvals",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
        "idempotency-key": "egress-non-json-1",
      },
      payload: {
        sandboxName: "openclaw-restricted",
        profile: "openclaw-restricted",
        endpointHost: "api.github.com",
        endpointPort: 443,
        accessMode: "read_only",
        reason: "Test read-only GitHub connector",
      },
    })

    expect(response.statusCode).toBe(502)
    expect(response.json()).toMatchObject({
      title: "Agentic adapter error",
      detail: "adapter down",
    })
    expect(getAuditEventsForTest()).toContainEqual(
      expect.objectContaining({
        action: "egress_approval.failed",
      }),
    )
    await server.close()
  })

  it("records policy violations when the egress adapter denies an approval", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_ADAPTER_BASE_URL", "http://agentic-adapter.test")
    vi.stubEnv("AGENTIC_ADAPTER_TOKEN", "adapter-token")
    vi.stubEnv("AGENTIC_APPROVAL_SIGNING_SECRET", "approval-secret")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            type: "about:blank",
            title: "Unsupported egress approval",
            status: 403,
            detail: "Profile openclaw-restricted may not reach slack.com.",
          },
          { status: 403 },
        ),
      ),
    )
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/agentic/egress-approvals",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
        "idempotency-key": "fx-deny",
      },
      payload: {
        sandboxName: "openclaw-restricted",
        profile: "openclaw-restricted",
        endpointHost: "slack.com",
        endpointPort: 443,
        accessMode: "read_only",
        reason: "Test Slack connector egress",
      },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({
      title: "Unsupported egress approval",
    })

    const violations = await server.inject({
      method: "GET",
      url: "/api/admin/policies/violations?q=slack",
      headers: adminHeaders,
    })

    expect(violations.statusCode).toBe(200)
    expect(violations.json()).toMatchObject({
      sourceStatus: "degraded",
      totalCount: 1,
      criticalCount: 1,
      violations: [
        {
          policyType: "data_governance",
          severity: "critical",
          actionTaken: "block",
          actorId: "admin-1",
          targetType: "admin.egress_approvals",
          message: "Sandbox egress approval was blocked by adapter policy.",
        },
      ],
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "admin.policy_violation.recorded",
          actorId: "admin-1",
          targetType: "admin.policy_violations",
        }),
      ]),
    )
    await server.close()
  })

  it("does not proxy Hermes before runtime URL is configured", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/agentic/hermes/v1/chat/completions",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
      },
      payload: {
        model: "qwen3-35b-local",
        messages: [{ role: "user", content: "ping" }],
      },
    })

    expect(response.statusCode).toBe(503)
    await server.close()
  })

  it("proxies configured Hermes requests with the runtime token", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_HERMES_BASE_URL", "http://hermes.test")
    vi.stubEnv("AGENTIC_HERMES_TOKEN", "hermes-token")
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: "Hermes ok",
            },
          },
        ],
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/agentic/hermes/v1/chat/completions",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
      },
      payload: {
        model: "qwen3-35b-local",
        messages: [{ role: "user", content: "ping" }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      choices: [{ message: { content: "Hermes ok" } }],
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.toString()).toBe("http://hermes.test/v1/chat/completions")
    expect(init.headers).toMatchObject({
      Authorization: "Bearer hermes-token",
      "X-LLM-Machines-Actor": "admin-1",
    })
    expect(response.body).not.toContain("hermes-token")
    await server.close()
  })

  it("returns OpenClaw access metadata without exposing the gateway token", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_OPENCLAW_BASE_URL", "http://127.0.0.1:18789")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/agentic/openclaw/access",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      runtime: "openclaw",
      profile: "openclaw-restricted",
      configured: true,
      dashboardUrl: "http://127.0.0.1:18789/",
      tokenRequired: true,
    })
    expect(response.body).not.toContain("gatewayToken")
    await server.close()
  })

  it("returns Hermes access metadata without exposing the runtime token", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_HERMES_BASE_URL", "http://127.0.0.1:8642")
    vi.stubEnv("AGENTIC_HERMES_TOKEN", "hermes-token")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/agentic/hermes/access",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      runtime: "hermes",
      profile: "hermes-restricted",
      configured: true,
      chatCompletionsProxyPath: "/api/admin/agentic/hermes/v1/chat/completions",
      tokenRequired: true,
    })
    expect(response.body).not.toContain("hermes-token")
    await server.close()
  })

  it("returns typed adapter diagnostics when the adapter is unconfigured", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_ADAPTER_BASE_URL", "")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/agentic/adapter/diagnostics",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      configured: false,
      healthy: false,
      service: "agentic-adapter",
      status: "not_configured",
      baseUrl: null,
      applyEnabled: null,
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: "admin-1",
          action: "admin.agentic_runtime.adapter_diagnostics.read",
          targetId: "diagnostics",
          targetType: "agentic.adapter",
        }),
      ]),
    )
    await server.close()
  })

  it("reads typed adapter diagnostics from a configured adapter", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_ADAPTER_BASE_URL", "http://agentic-adapter.test")
    vi.stubEnv("AGENTIC_ADAPTER_TOKEN", "adapter-token")
    const fetchMock = vi.fn(async () =>
      Response.json({
        service: "agentic-adapter",
        status: "ok",
        applyEnabled: false,
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/agentic/adapter/diagnostics",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      configured: true,
      healthy: true,
      service: "agentic-adapter",
      status: "ok",
      baseUrl: "http://agentic-adapter.test",
      applyEnabled: false,
      detail: "HTTP 200",
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.toString()).toBe("http://agentic-adapter.test/v1/diagnostics")
    expect(init.headers).toMatchObject({
      Authorization: "Bearer adapter-token",
    })
    expect(response.body).not.toContain("adapter-token")
    await server.close()
  })
})
