import { afterEach, describe, expect, it, vi } from "vitest"

const accountingMocks = vi.hoisted(() => ({
  reconcile: vi.fn(),
  reserve: vi.fn(),
}))

vi.mock("../services/admin-connected-apps", async () => {
  const actual = await vi.importActual<
    typeof import("../services/admin-connected-apps")
  >("../services/admin-connected-apps")
  accountingMocks.reconcile.mockImplementation(
    actual.reconcileConnectedAppGatewayUsage,
  )
  accountingMocks.reserve.mockImplementation(
    actual.reserveConnectedAppGatewayTokens,
  )
  return {
    ...actual,
    reconcileConnectedAppGatewayUsage: accountingMocks.reconcile,
    reserveConnectedAppGatewayTokens: accountingMocks.reserve,
  }
})

import { buildServer } from "../index"
import { resetConnectedAppsForTest } from "../services/admin-connected-apps"
import { resetAuditEventsForTest } from "../services/audit"
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
    accountingMocks.reserve.mockClear()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    resetAuditEventsForTest()
    resetIdempotencyForTest()
    await resetConnectedAppsForTest()
  })

  it("fails closed with a sanitized correlated error when reservation persistence fails", async () => {
    configureGateway()
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createBoundedApp(server)
    accountingMocks.reserve.mockRejectedValueOnce(
      new Error(
        'The "string" argument must be of type string. Received an instance of Date',
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
        "The connected app request could not reserve its token budget. Retry later.",
      request_id: expect.any(String),
      title: "Connected app accounting unavailable",
    })
    expect(response.headers["x-llm-machines-request-id"]).toBe(
      response.json().request_id,
    )
    expect(response.body).not.toContain("instance of Date")
    expect(fetchMock).not.toHaveBeenCalled()
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
    const created = await createBoundedApp(server)
    accountingMocks.reconcile.mockRejectedValueOnce(
      new Error("raw PostgreSQL reconciliation failure"),
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
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(accountingMocks.reconcile).toHaveBeenCalledTimes(1)
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
  vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
  vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
  vi.stubEnv("LITELLM_URL", "http://litellm.test")
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
      name: "Accounting Failure Test",
      ownerGroup: "Everyone",
      rateLimitRpm: null,
      tokenBudget7d: 100_000,
    },
  })
  expect(response.statusCode).toBe(201)
  const created = response.json() as {
    credential: { apiKey: string }
  }
  return { apiKey: created.credential.apiKey }
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
