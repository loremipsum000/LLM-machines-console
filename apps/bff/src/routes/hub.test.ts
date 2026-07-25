import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import {
  getAuditEventsForTest,
  resetAuditEventsForTest,
} from "../services/audit"
import { resetConnectorVettingDecisionsForTest } from "../services/admin-connector-registry"
import { resetHubStateForTest, subscribeHubEvents } from "../services/hub"
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

const consumerHeaders = {
  ...adminHeaders,
  "x-llm-machines-user-sub": "user-1",
  "x-llm-machines-user-email": "user@example.test",
  "x-llm-machines-user-roles": "consumer",
}

const completeConnectorReviewChecklist = {
  auditEventsReviewed: true,
  dataClassesReviewed: true,
  endpointsReviewed: true,
  licenseReviewed: true,
  runtimeSetupAcknowledged: true,
  scopesReviewed: true,
  secretsPlanReviewed: true,
  sourceIntegrityReviewed: true,
}

describe("Hub routes", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetAuditEventsForTest()
    resetConnectorVettingDecisionsForTest()
    resetHubStateForTest()
    resetIdempotencyForTest()
  })

  it("requires authentication for Hub home", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/hub/home",
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

  it("returns a consumer-scoped Hub home", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/hub/home",
      headers: consumerHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      persona: "consumer",
      capabilities: [],
    })
    expect(response.json().modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "recent_chats",
          threads: expect.arrayContaining([
            expect.objectContaining({
              href: expect.stringContaining("/chat"),
              title: "Builder Agent Studio runtime check",
            }),
          ]),
        }),
      ]),
    )
    expect(
      response.json().modules.map((module: { type: string }) => module.type),
    ).not.toContain("builder_status")
    expect(
      response.json().modules.map((module: { type: string }) => module.type),
    ).not.toContain("admin_attention")
    await server.close()
  })

  it("adds Builder workbench modules for builders", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/hub/home",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      persona: "builder",
      capabilities: expect.arrayContaining(["developer_workbench"]),
    })
    expect(
      response.json().modules.map((module: { type: string }) => module.type),
    ).toContain("developer_workbench")
    await server.close()
  })

  it("adds admin attention modules for admins", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/hub/home",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      persona: "admin",
      capabilities: expect.arrayContaining(["admin_summary", "org_usage"]),
    })
    expect(
      response.json().modules.map((module: { type: string }) => module.type),
    ).toContain("admin_attention")
    const adminModule = response
      .json()
      .modules.find(
        (module: { type: string }) => module.type === "admin_attention",
      )
    expect(adminModule.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "builder-review-queue",
          severity: "warning",
          href: "/applications",
        }),
      ]),
    )
    await server.close()
  })

  it("keeps removed connector decisions out of admin attention", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const approvalResponse = await server.inject({
      method: "POST",
      url: "/api/admin/connectors/mcp-slack/vetting",
      headers: {
        ...adminHeaders,
        "idempotency-key": "hub-attention-approve-slack",
      },
      payload: {
        checklist: completeConnectorReviewChecklist,
        decision: "approved_read_only",
        note: "Approved locally after review, pending runtime setup.",
      },
    })
    const blockResponse = await server.inject({
      method: "POST",
      url: "/api/admin/connectors/mcp-notion/vetting",
      headers: {
        ...adminHeaders,
        "idempotency-key": "hub-attention-block-notion",
      },
      payload: {
        decision: "blocked",
        note: "Blocked locally after admin review.",
      },
    })
    expect(approvalResponse.statusCode).toBe(404)
    expect(blockResponse.statusCode).toBe(404)

    const response = await server.inject({
      method: "GET",
      url: "/api/hub/home",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    const adminModule = response
      .json()
      .modules.find(
        (module: { type: string }) => module.type === "admin_attention",
      )
    expect(adminModule.criticalCount).toBe(0)
    expect(
      adminModule.items.find(
        (item: { id: string }) => item.id === "connector-vetting",
      ),
    ).toBeUndefined()
    expect(adminModule.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "builder-review-queue",
          severity: "warning",
        }),
      ]),
    )
    const resourcesResponse = await server.inject({
      method: "GET",
      url: "/api/hub/resources",
      headers: adminHeaders,
    })
    const resources = resourcesResponse.json()
    expect(
      resources.find((resource: { id: string }) => resource.id === "mcp-slack"),
    ).toBeUndefined()
    expect(
      resources.find((resource: { id: string }) => resource.id === "mcp-notion"),
    ).toBeUndefined()
    await server.close()
  })

  it("blocks non-admins from the admin summary", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/hub/admin-summary",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(403)
    await server.close()
  })

  it("exposes only the runnable internal-docs MCP connector", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/hub/resources",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    const connectorIds = response
      .json()
      .filter((resource: { type: string }) => resource.type === "mcp_connector")
      .map((resource: { id: string }) => resource.id)
    expect(connectorIds).toEqual(["internal-docs"])
    const internalDocs = response
      .json()
      .find((resource: { id: string }) => resource.id === "internal-docs")
    expect(internalDocs).toMatchObject({
      state: "available",
      connector: {
        vettingStatus: "approved_read_only",
      },
    })
    expect(internalDocs.actions[0]).toMatchObject({
      enabled: true,
    })
    await server.close()
  })

  it("returns a single resource detail by type and id", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/hub/resources/mcp_connector/internal-docs",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      id: "internal-docs",
      type: "mcp_connector",
      state: "available",
      connector: {
        vettingStatus: "approved_read_only",
      },
    })
    await server.close()
  })

  it("hides builder-only task and artifact details from consumers", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const taskResponse = await server.inject({
      method: "GET",
      url: "/api/hub/tasks/44444444-4444-4444-8444-444444444444",
      headers: consumerHeaders,
    })
    const artifactResponse = await server.inject({
      method: "GET",
      url: "/api/hub/artifacts/55555555-5555-4555-8555-555555555555",
      headers: consumerHeaders,
    })

    expect(taskResponse.statusCode).toBe(404)
    expect(artifactResponse.statusCode).toBe(404)
    await server.close()
  })

  it("returns builder task and artifact details", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const taskResponse = await server.inject({
      method: "GET",
      url: "/api/hub/tasks/44444444-4444-4444-8444-444444444444",
      headers: builderHeaders,
    })
    const artifactResponse = await server.inject({
      method: "GET",
      url: "/api/hub/artifacts/55555555-5555-4555-8555-555555555555",
      headers: builderHeaders,
    })

    expect(taskResponse.statusCode).toBe(200)
    expect(taskResponse.json()).toMatchObject({
      id: "44444444-4444-4444-8444-444444444444",
      status: "waiting",
    })
    expect(artifactResponse.statusCode).toBe(200)
    expect(artifactResponse.json()).toMatchObject({
      id: "55555555-5555-4555-8555-555555555555",
      kind: "markdown",
    })
    await server.close()
  })

  it("search only returns allowed, server-filtered results", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/hub/search?q=internal",
      headers: consumerHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "internal-docs",
          type: "resource",
          title: "Internal Docs",
        }),
      ]),
    )
    await server.close()
  })

  it("search returns mirrored recent chat threads", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/hub/search?q=studio",
      headers: consumerHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "chat-agent-studio-runtime",
          type: "thread",
          href: "https://librechat.example.test/c/chat-agent-studio-runtime",
        }),
      ]),
    )
    await server.close()
  })

  it("returns not-configured usage instead of static placeholders", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/hub/usage",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      scope: "admin",
      prompts: 0,
      tokens: 0,
      topModels: [],
      sourceStatus: "not_configured",
    })
    await server.close()
  })

  it("federates admin usage from LiteLLM when configured", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("ADMIN_LITELLM_BASE_URL", "http://litellm.test")
    vi.stubEnv("ADMIN_LITELLM_API_KEY", "litellm-key")
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        metadata: {
          total_api_requests: 12,
          total_tokens: 1800,
          total_failed_requests: 0,
        },
        results: [
          {
            breakdown: {
              model_groups: {
                "qwen3-35b-local": {
                  metrics: {
                    api_requests: 10,
                  },
                },
              },
            },
          },
        ],
      }),
    )
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/hub/usage",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      scope: "admin",
      prompts: 12,
      tokens: 1800,
      topModels: ["qwen3-35b-local"],
      sourceStatus: "ok",
    })
    await server.close()
  })

  it("requires an idempotency key when marking notifications read", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "PATCH",
      url: "/api/hub/notifications/11111111-1111-4111-8111-111111111111/read",
      headers: consumerHeaders,
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      title: "Idempotency key is required",
      status: 400,
    })
    await server.close()
  })

  it("persists notification read state per actor and emits audit", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "PATCH",
      url: "/api/hub/notifications/11111111-1111-4111-8111-111111111111/read",
      headers: {
        ...consumerHeaders,
        "idempotency-key": "read-base-notification",
      },
    })
    const notificationsResponse = await server.inject({
      method: "GET",
      url: "/api/hub/notifications",
      headers: consumerHeaders,
    })
    const otherActorResponse = await server.inject({
      method: "GET",
      url: "/api/hub/notifications",
      headers: {
        ...consumerHeaders,
        "x-llm-machines-user-sub": "user-2",
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      readAt: expect.any(String),
    })
    expect(notificationsResponse.statusCode).toBe(200)
    expect(
      notificationsResponse
        .json()
        .find(
          (notification: { id: string }) =>
            notification.id === "11111111-1111-4111-8111-111111111111",
        ),
    ).toMatchObject({
      readAt: response.json().readAt,
    })
    expect(
      otherActorResponse
        .json()
        .find(
          (notification: { id: string }) =>
            notification.id === "11111111-1111-4111-8111-111111111111",
        ),
    ).toMatchObject({
      readAt: null,
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: "user-1",
          action: "hub.notification.mark_read",
          targetId: "11111111-1111-4111-8111-111111111111",
        }),
      ]),
    )
    await server.close()
  })

  it("publishes notification read events to same-actor Hub subscribers", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const publishedEvents: string[] = []
    const unsubscribe = subscribeHubEvents(
      {
        authMode: "service-forwarded",
        email: "user@example.test",
        persona: "consumer",
        roles: ["consumer"],
        subject: "user-1",
      },
      (event) => {
        publishedEvents.push(event.type)
      },
    )

    const response = await server.inject({
      method: "PATCH",
      url: "/api/hub/notifications/11111111-1111-4111-8111-111111111111/read",
      headers: {
        ...consumerHeaders,
        "idempotency-key": "read-published-event",
      },
    })

    expect(response.statusCode).toBe(200)
    expect(publishedEvents).toEqual(["notification.read"])
    unsubscribe()
    await server.close()
  })

  it("replays duplicate notification reads with the same idempotency key", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const firstResponse = await server.inject({
      method: "PATCH",
      url: "/api/hub/notifications/11111111-1111-4111-8111-111111111111/read",
      headers: {
        ...consumerHeaders,
        "idempotency-key": "read-replay",
      },
    })
    const replayResponse = await server.inject({
      method: "PATCH",
      url: "/api/hub/notifications/11111111-1111-4111-8111-111111111111/read",
      headers: {
        ...consumerHeaders,
        "idempotency-key": "read-replay",
      },
    })

    expect(firstResponse.statusCode).toBe(200)
    expect(replayResponse.statusCode).toBe(200)
    expect(replayResponse.json()).toEqual(firstResponse.json())
    await server.close()
  })

  it("rejects notification read idempotency key reuse for a different notification", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    await server.inject({
      method: "PATCH",
      url: "/api/hub/notifications/11111111-1111-4111-8111-111111111111/read",
      headers: {
        ...adminHeaders,
        "idempotency-key": "read-conflict",
      },
    })
    const conflictResponse = await server.inject({
      method: "PATCH",
      url: "/api/hub/notifications/33333333-3333-4333-8333-333333333333/read",
      headers: {
        ...adminHeaders,
        "idempotency-key": "read-conflict",
      },
    })

    expect(conflictResponse.statusCode).toBe(409)
    expect(conflictResponse.json()).toMatchObject({
      title: "Idempotency key conflict",
    })
    await server.close()
  })

  it("streams consumer-scoped Hub events", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/hub/events?once=true",
      headers: consumerHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toContain("text/event-stream")
    expect(response.body).toContain("event: notification.created")
    expect(response.body).toContain("event: resource.lifecycle")
    expect(response.body).not.toContain("event: task.updated")
    await server.close()
  })

  it("includes notification read events in finite event snapshots", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    await server.inject({
      method: "PATCH",
      url: "/api/hub/notifications/11111111-1111-4111-8111-111111111111/read",
      headers: {
        ...consumerHeaders,
        "idempotency-key": "read-snapshot-event",
      },
    })
    const response = await server.inject({
      method: "GET",
      url: "/api/hub/events?once=true",
      headers: consumerHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain("event: notification.read")
    await server.close()
  })

  it("adds workbench events for builders", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/hub/events?once=true",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain("event: task.updated")
    expect(response.body).toContain("event: artifact.created")
    await server.close()
  })
})
