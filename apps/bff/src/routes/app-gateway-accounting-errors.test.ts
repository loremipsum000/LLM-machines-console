import { afterEach, describe, expect, it, vi } from "vitest"

const accountingMocks = vi.hoisted(() => ({
  admit: vi.fn(),
  recordModelsConnection: vi.fn(),
  recordUsage: vi.fn(),
  reconcile: vi.fn(),
}))

vi.mock("../services/admin-connected-apps", async () => {
  const actual = await vi.importActual<
    typeof import("../services/admin-connected-apps")
  >("../services/admin-connected-apps")
  accountingMocks.reconcile.mockImplementation(
    actual.reconcileConnectedAppGatewayUsage,
  )
  accountingMocks.admit.mockImplementation(actual.admitConnectedAppGatewayUsage)
  accountingMocks.recordModelsConnection.mockImplementation(
    actual.recordConnectedAppModelsConnection,
  )
  accountingMocks.recordUsage.mockImplementation(
    actual.recordConnectedAppGatewayUsage,
  )
  return {
    ...actual,
    admitConnectedAppGatewayUsage: accountingMocks.admit,
    recordConnectedAppGatewayUsage: accountingMocks.recordUsage,
    recordConnectedAppModelsConnection: accountingMocks.recordModelsConnection,
    reconcileConnectedAppGatewayUsage: accountingMocks.reconcile,
  }
})

import { buildServer } from "../index"
import { resetConnectedAppsForTest } from "../services/admin-connected-apps"
import {
  getAuditEventsForTest,
  resetAuditEventsForTest,
} from "../services/audit"
import { resetIdempotencyForTest } from "../services/idempotency"

const adminHeaders = {
  authorization: "Bearer test-service-key",
  "x-llm-machines-keycloak-token": "",
  "x-llm-machines-user-email": "admin@example.test",
  "x-llm-machines-user-roles": "admin",
  "x-llm-machines-user-sub": "admin-1",
}
let createCounter = 0

describe("connected app gateway accounting failures", () => {
  afterEach(async () => {
    accountingMocks.reconcile.mockClear()
    accountingMocks.admit.mockClear()
    accountingMocks.recordModelsConnection.mockClear()
    accountingMocks.recordUsage.mockClear()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    resetAuditEventsForTest()
    resetIdempotencyForTest()
    await resetConnectedAppsForTest()
  })

  it("fails closed with a sanitized correlated error when usage admission fails", async () => {
    configureGateway()
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const loggedErrors = captureRequestErrors(server)
    const created = await createBoundedApp(server)
    accountingMocks.admit.mockRejectedValueOnce(
      new Error(
        "connect ECONNREFUSED postgres://db.internal:5432 schema admin.application_usage_daily",
      ),
    )

    const response = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${created.apiKey}` },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "do not send upstream" }],
      },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      code: "accounting_unavailable",
      detail:
        "The Key request could not establish usage accounting. Retry later.",
      request_id: expect.any(String),
      title: "Key accounting unavailable",
    })
    expect(response.headers["x-llm-machines-request-id"]).toBe(
      response.json().request_id,
    )
    const serializedErrors = JSON.stringify(loggedErrors)
    expect(serializedErrors).toContain("accounting_admission_failed")
    expect(serializedErrors).toContain(response.json().request_id)
    expect(serializedErrors).not.toContain("db.internal")
    expect(serializedErrors).not.toContain("application_usage_daily")
    expect(serializedErrors).not.toContain("ECONNREFUSED")
    expect(response.body).not.toContain("db.internal")
    expect(fetchMock).not.toHaveBeenCalled()
    await server.close()
  })

  it("does not retain a caller-controlled model value rejected by the allowlist", async () => {
    configureGateway()
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createBoundedApp(server)
    const canary = "private-content-canary-not-a-model"

    const response = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${created.apiKey}` },
      payload: {
        model: canary,
        messages: [{ role: "user", content: "do not send upstream" }],
      },
    })

    expect(response.statusCode).toBe(403)
    expect(response.body).not.toContain(canary)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(accountingMocks.recordUsage).toHaveBeenCalledTimes(1)
    expect(accountingMocks.recordUsage.mock.calls[0]?.[1]).toMatchObject({
      model: null,
      route: "chat_completions",
      status: 403,
    })
    expect(
      JSON.stringify(accountingMocks.recordUsage.mock.calls),
    ).not.toContain(canary)
    await server.close()
  })

  it("preserves a successful completion when usage reconciliation fails", async () => {
    configureGateway()
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        choices: [
          {
            finish_reason: "stop",
            index: 0,
            message: { content: "completed", role: "assistant" },
          },
        ],
        usage: { total_tokens: 42 },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const loggedErrors = captureRequestErrors(server)
    const created = await createBoundedApp(server)
    accountingMocks.reconcile.mockRejectedValueOnce(
      new Error(
        "password authentication failed for db.internal schema admin.audit_events",
      ),
    )

    const response = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${created.apiKey}` },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "complete successfully" }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain("completed")
    expect(response.body).not.toContain("PostgreSQL")
    expect(response.headers["x-llm-machines-request-id"]).toEqual(
      expect.any(String),
    )
    const serializedErrors = JSON.stringify(loggedErrors)
    expect(serializedErrors).toContain("accounting_reconciliation_failed")
    expect(serializedErrors).toContain(
      response.headers["x-llm-machines-request-id"],
    )
    expect(serializedErrors).not.toContain("db.internal")
    expect(serializedErrors).not.toContain("admin.audit_events")
    expect(serializedErrors).not.toContain("password authentication")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(accountingMocks.reconcile).toHaveBeenCalledTimes(1)
    await server.close()
  })

  it("records a successful model connection independently when usage persistence fails", async () => {
    configureGateway()
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        data: [{ id: "local-a", object: "model", owned_by: "llm-machines" }],
        object: "list",
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const loggedErrors = captureRequestErrors(server)
    const created = await createBoundedApp(server)
    accountingMocks.reconcile.mockRejectedValueOnce(
      new Error("usage persistence failed at postgres://usage.internal:5432"),
    )

    const response = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${created.apiKey}` },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.appId}`,
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(detailResponse.json().app).toMatchObject({
      connectionStatus: "connected",
      lastConnectedAt: expect.any(String),
      usage: { requests7d: 0 },
    })
    expect(accountingMocks.recordModelsConnection).toHaveBeenCalledTimes(1)
    expect(loggedErrors).toContainEqual([
      {
        appId: created.appId,
        failureClass: "accounting_reconciliation_failed",
        requestId: response.headers["x-llm-machines-request-id"],
      },
      "Key gateway accounting failed",
    ])
    const serializedErrors = JSON.stringify(loggedErrors)
    expect(serializedErrors).not.toContain("usage.internal")
    expect(serializedErrors).not.toContain("environment")
    const successfulModelEvents = getAuditEventsForTest().filter(
      (event) =>
        event.action === "connected_app.gateway.models" &&
        event.metadata.outcome === "succeeded",
    )
    expect(successfulModelEvents).toHaveLength(1)
    expect(successfulModelEvents[0]?.metadata).not.toHaveProperty("environment")
    await server.close()
  })

  it("preserves a successful model list without claiming a connection when passive persistence fails", async () => {
    configureGateway()
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        data: [{ id: "local-a", object: "model", owned_by: "llm-machines" }],
        object: "list",
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const loggedErrors = captureRequestErrors(server)
    const created = await createBoundedApp(server)
    accountingMocks.recordModelsConnection.mockRejectedValueOnce(
      new Error(
        "passive recorder secret recorder-key failed at postgres://audit.internal:5432 admin.audit_events",
      ),
    )

    const response = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${created.apiKey}` },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.appId}`,
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      data: [{ id: "local-a", object: "model", owned_by: "llm-machines" }],
      object: "list",
    })
    expect(detailResponse.json().app).toMatchObject({
      connectionStatus: "not_connected",
      lastConnectedAt: null,
    })
    expect(accountingMocks.recordModelsConnection).toHaveBeenCalledTimes(1)
    expect(
      getAuditEventsForTest().filter(
        (event) =>
          event.action === "connected_app.gateway.models" &&
          event.metadata.outcome === "succeeded",
      ),
    ).toHaveLength(0)
    const serializedErrors = JSON.stringify(loggedErrors)
    expect(serializedErrors).toContain("connection_recording_failed")
    expect(serializedErrors).toContain(
      response.headers["x-llm-machines-request-id"],
    )
    expect(loggedErrors).toContainEqual([
      {
        appId: created.appId,
        failureClass: "connection_recording_failed",
        requestId: response.headers["x-llm-machines-request-id"],
      },
      "Key gateway accounting failed",
    ])
    expect(serializedErrors).not.toContain("recorder-key")
    expect(serializedErrors).not.toContain("audit.internal")
    expect(serializedErrors).not.toContain("admin.audit_events")
    expect(serializedErrors).not.toContain("environment")
    expect(response.body).not.toContain("recorder-key")
    expect(fetchMock).not.toHaveBeenCalled()
    await server.close()
  })

  it("diagnoses a stale passive connection without exposing credential details", async () => {
    configureGateway()
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        Response.json({
          data: [{ id: "local-a", object: "model", owned_by: "llm-machines" }],
          object: "list",
        }),
      ),
    )
    const server = buildServer()
    const loggedErrors = captureRequestErrors(server)
    const created = await createBoundedApp(server)
    accountingMocks.recordModelsConnection.mockResolvedValueOnce(false)

    const response = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${created.apiKey}` },
    })

    expect(response.statusCode).toBe(200)
    expect(loggedErrors).toContainEqual([
      {
        appId: created.appId,
        failureClass: "connection_recording_failed",
        requestId: response.headers["x-llm-machines-request-id"],
      },
      "Key gateway accounting failed",
    ])
    const serializedErrors = JSON.stringify(loggedErrors)
    expect(serializedErrors).not.toContain(created.apiKey)
    expect(serializedErrors).not.toContain("credential")
    expect(serializedErrors).not.toContain("environment")
    await server.close()
  })

  it("preserves a completed stream when usage reconciliation fails", async () => {
    configureGateway()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"streamed"}}]}\n\n',
          'data: {"choices":[],"usage":{"total_tokens":21}}\n\n',
          "data: [DONE]\n\n",
        ]),
      )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createBoundedApp(server)
    accountingMocks.reconcile.mockRejectedValueOnce(
      new Error("raw streaming reconciliation failure"),
    )

    const response = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${created.apiKey}` },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "complete the stream" }],
        stream: true,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain("streamed")
    expect(response.body).not.toContain("reconciliation failure")
    expect(response.headers["x-llm-machines-request-id"]).toEqual(
      expect.any(String),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(accountingMocks.reconcile).toHaveBeenCalledTimes(1)
    await server.close()
  })
})

function configureGateway(): void {
  vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
  vi.stubEnv("BFF_FALLBACK_MODELS", "local-a")
  vi.stubEnv("BFF_FIXTURE_MODE", "true")
  vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
  vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
  vi.stubEnv("LITELLM_URL", "http://litellm.test")
}

function captureRequestErrors(
  server: ReturnType<typeof buildServer>,
): unknown[][] {
  const loggedErrors: unknown[][] = []
  server.addHook("onRequest", async (request) => {
    vi.spyOn(request.log, "error").mockImplementation(((...args: unknown[]) => {
      loggedErrors.push(args)
    }) as typeof request.log.error)
  })
  return loggedErrors
}

async function createBoundedApp(server: ReturnType<typeof buildServer>) {
  const response = await server.inject({
    method: "POST",
    url: "/api/admin/applications/connected-apps",
    headers: {
      ...adminHeaders,
      "idempotency-key": `create-accounting-app-${createCounter++}`,
    },
    payload: {
      allowedModels: ["local-a"],
      authMethod: "api_key",
      description: "Bounded app used by accounting failure tests.",
      maxConcurrentRequests: null,
      maxContextBytes: null,
      name: "Accounting Failure Test",
      rateLimitRps: null,
      tokenAlertThreshold7d: null,
    },
  })
  expect(response.statusCode).toBe(201)
  const created = response.json() as {
    app: { id: string }
    credential: { apiKey: string }
  }
  return { apiKey: created.credential.apiKey, appId: created.app.id }
}

function sseResponse(chunks: string[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    }),
    {
      headers: { "content-type": "text/event-stream" },
      status: 200,
    },
  )
}
