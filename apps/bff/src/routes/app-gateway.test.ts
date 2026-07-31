import { afterEach, describe, expect, it, vi } from "vitest"
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
  "x-llm-machines-user-sub": "admin-1",
  "x-llm-machines-user-email": "admin@example.test",
  "x-llm-machines-user-roles": "admin",
}
let createCounter = 0

describe("Connected app gateway routes", () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    resetAuditEventsForTest()
    resetIdempotencyForTest()
    await resetConnectedAppsForTest()
  })

  it("routes connected app model and chat calls through policy and records only the model-list connection", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          object: "list",
          data: [
            { id: "local-a", object: "model", owned_by: "llm-machines" },
            { id: "local-b", object: "model", owned_by: "llm-machines" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "chatcmpl-app",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "private completion",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 30, total_tokens: 42 },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"])
    const token = bearerForCredential(created.credential)

    const modelsResponse = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${token}` },
    })
    const chatResponse = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "private prompt" }],
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })

    expect(modelsResponse.statusCode).toBe(200)
    expect(modelsResponse.json()).toEqual({
      object: "list",
      data: [{ id: "local-a", object: "model", owned_by: "llm-machines" }],
    })
    expect(chatResponse.statusCode).toBe(200)
    expect(chatResponse.body).toContain("private completion")
    expect(chatResponse.body).not.toContain("internal-litellm-key")
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://litellm.test/v1/models")
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://litellm.test/v1/chat/completions",
    )
    expect(
      (fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>)
        .Authorization,
    ).toBe("Bearer internal-litellm-key")
    expect(detailResponse.json().app.usage).toMatchObject({
      requests7d: 2,
      tokens7d: 42,
    })
    expect(detailResponse.json().app).toMatchObject({
      connectionStatus: "connected",
      lastConnectedAt: expect.any(String),
    })
    const auditEvents = getAuditEventsForTest()
    const gatewayEvents = auditEvents.filter((event) =>
      event.action.startsWith("connected_app.gateway."),
    )
    const auditText = JSON.stringify(auditEvents)
    const gatewayAuditText = JSON.stringify(gatewayEvents)
    expect(auditText).toContain("connected_app.gateway.models")
    expect(auditText).toContain("connected_app.gateway.chat_completions")
    expect(gatewayEvents).toHaveLength(2)
    for (const event of gatewayEvents) {
      expect(event.actorId).toBe("system")
      expect(event.metadata).toMatchObject({
        applicationId: created.app.id,
        correlationId: expect.any(String),
        credentialRecordId: expect.stringMatching(/^cak-/),
        outcome: "succeeded",
        sourceSystem: "console",
      })
      expect(event.metadata).not.toHaveProperty("authMethod")
      expect(event.metadata).not.toHaveProperty("environment")
    }
    expect(
      auditEvents.find(
        (event) => event.action === "admin.connected_app.created",
      ),
    ).toMatchObject({
      actorId: "admin-1",
      metadata: {
        applicationId: created.app.id,
        credentialRecordId: expect.stringMatching(/^cak-/),
        keycloakSubjectId: "admin-1",
      },
    })
    expect(gatewayAuditText).not.toContain('"tokens"')
    expect(gatewayAuditText).not.toContain('"model"')
    expect(gatewayAuditText).not.toContain("local-a")
    expect(gatewayAuditText).not.toContain("local-b")
    expect(gatewayAuditText).not.toContain("owned_by")
    expect(gatewayAuditText).not.toContain("private prompt")
    expect(gatewayAuditText).not.toContain("private completion")
    expect(gatewayAuditText).not.toContain(created.credential.apiKey)
    expect(auditText).not.toContain('"environment"')
    await server.close()
  })

  it("normalizes connected-app content blocks before proxying to LiteLLM", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        id: "chatcmpl-normalized-app",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["gemma-4-12B-it-Q4_K_M"])
    const token = bearerForCredential(created.credential)

    const response = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        model: "gemma-4-12B-it-Q4_K_M",
        messages: [
          {
            role: "user",
            content: [
              { type: "output_text", text: "Reply with exactly pong." },
              { type: "tool_call", tool_call: { name: "noop" } },
            ],
          },
        ],
      },
    })

    expect(response.statusCode).toBe(200)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "gemma-4-12B-it-Q4_K_M",
      messages: [
        {
          role: "user",
          content: "Reply with exactly pong.\n[tool call content omitted]",
        },
      ],
    })
    await server.close()
  })

  it("passes standard non-streaming tool definitions and tool calls through without executing them", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const upstreamResponse = {
      choices: [
        {
          finish_reason: "tool_calls",
          index: 0,
          message: {
            content: null,
            role: "assistant",
            tool_calls: [
              {
                function: {
                  arguments: '{"city":"Zagreb"}',
                  name: "lookup_weather",
                },
                id: "call_weather_1",
                type: "function",
              },
            ],
          },
        },
      ],
      id: "chatcmpl-tool-call",
      object: "chat.completion",
      usage: { completion_tokens: 8, prompt_tokens: 12, total_tokens: 20 },
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(upstreamResponse))
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"])
    const token = bearerForCredential(created.credential)
    const tools = [
      {
        function: {
          description: "Look up the weather for a city.",
          name: "lookup_weather",
          parameters: {
            additionalProperties: false,
            properties: { city: { type: "string" } },
            required: ["city"],
            type: "object",
          },
          strict: true,
        },
        type: "function",
      },
    ]
    const messages = [
      { content: "What is the weather?", role: "user" },
      {
        content: null,
        role: "assistant",
        tool_calls: [
          {
            function: {
              arguments: '{"city":"Zagreb"}',
              name: "lookup_weather",
            },
            id: "call_weather_prior",
            type: "function",
          },
        ],
      },
      {
        content: '{"condition":"sunny"}',
        role: "tool",
        tool_call_id: "call_weather_prior",
      },
    ]

    const response = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        messages,
        model: "local-a",
        parallel_tool_calls: false,
        tool_choice: "auto",
        tools,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(upstreamResponse)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const upstreamBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(upstreamBody).toMatchObject({
      messages,
      parallel_tool_calls: false,
      tool_choice: "auto",
      tools,
    })
    await server.close()
  })

  it("passes streaming tool-call deltas through without executing them", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        sseResponse([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_weather_2","type":"function","function":{"name":"lookup_weather","arguments":"{\\"city\\":\\"Zagreb\\"}"}}]},"finish_reason":"tool_calls","index":0}]}\n\n',
          'data: {"choices":[],"usage":{"total_tokens":21}}\n\n',
          "data: [DONE]\n\n",
        ]),
      )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"])
    const token = bearerForCredential(created.credential)
    const tools = [
      {
        function: {
          name: "lookup_weather",
          parameters: {
            properties: { city: { type: "string" } },
            required: ["city"],
            type: "object",
          },
        },
        type: "function",
      },
    ]

    const response = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        messages: [{ content: "What is the weather?", role: "user" }],
        model: "local-a",
        stream: true,
        tool_choice: "auto",
        tools,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('"tool_calls"')
    expect(response.body).toContain('"lookup_weather"')
    expect(response.body).toContain("data: [DONE]")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const upstreamBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(upstreamBody).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
      tool_choice: "auto",
      tools,
    })
    await server.close()
  })

  it("sanitizes connected-app model-list fetch exceptions", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.example.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(
          "dial tcp litellm.example.test with token internal-litellm-key",
        )
      }),
    )
    const server = buildServer()
    const created = await createApp(server, ["local-a"])
    const token = bearerForCredential(created.credential)

    const response = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${token}` },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      title: "LiteLLM model list unavailable",
      detail: "LiteLLM model list request failed.",
    })
    expect(response.body).not.toContain("litellm.example.test")
    expect(response.body).not.toContain("internal-litellm-key")
    expect(detailResponse.json().app).toMatchObject({
      connectionStatus: "not_connected",
      lastConnectedAt: null,
    })
    const modelEvents = getAuditEventsForTest().filter(
      (event) => event.action === "connected_app.gateway.models",
    )
    expect(modelEvents).toHaveLength(1)
    expect(modelEvents[0]?.metadata).toMatchObject({ outcome: "failed" })
    expect(modelEvents[0]?.metadata).not.toHaveProperty("environment")
    await server.close()
  })

  it("keeps authentication resolution side-effect-free when the request is rejected before accounting", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    const server = buildServer()
    const created = await createApp(server, ["local-a"])
    const token = bearerForCredential(created.credential)

    const rejected = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: { model: "local-a" },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })

    expect(rejected.statusCode).toBe(400)
    expect(detailResponse.json().app).toMatchObject({
      connectionStatus: "not_connected",
      lastConnectedAt: null,
      usage: {
        failures7d: 0,
        lastUsedAt: null,
        requests7d: 0,
        tokens7d: 0,
      },
    })
    expect(
      detailResponse
        .json()
        .app.credentials.find(
          (credential: { status: string }) => credential.status === "active",
        ),
    ).toMatchObject({ lastUsedAt: null })
    expect(
      getAuditEventsForTest().filter((event) =>
        event.action.startsWith("connected_app.gateway."),
      ),
    ).toHaveLength(0)
    await server.close()
  })

  it("blocks disabled, unknown, and disallowed connected app runtime calls before LiteLLM", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"])
    const token = bearerForCredential(created.credential)

    const disallowedModel = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        model: "local-b",
        messages: [{ role: "user", content: "do not forward" }],
      },
    })
    const deniedDetail = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })
    await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${created.app.id}/disable`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "disable-app-gateway-test",
      },
    })
    const disabled = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${token}` },
    })
    const unknown = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: {
        authorization: "Bearer llmm_t4_unknown_unknown-secret",
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })

    expect(disallowedModel.statusCode).toBe(403)
    expect(disallowedModel.json()).toMatchObject({ title: "Model not allowed" })
    expect(deniedDetail.json().app).toMatchObject({
      connectionStatus: "not_connected",
      lastConnectedAt: null,
    })
    expect(disabled.statusCode).toBe(403)
    expect(disabled.json()).toMatchObject({ title: "Connected app disabled" })
    expect(unknown.statusCode).toBe(401)
    expect(unknown.json()).toMatchObject({
      title: "Invalid connected app token",
    })
    expect(detailResponse.json().app).toMatchObject({
      connectionStatus: "not_connected",
      lastConnectedAt: null,
    })
    expect(
      getAuditEventsForTest().filter(
        (event) =>
          event.action === "connected_app.gateway.models" &&
          event.metadata.outcome === "succeeded",
      ),
    ).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
    await server.close()
  })

  it("keeps existing OAuth connected app tokens working through the gateway", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_FALLBACK_MODELS", "local-a")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    const server = buildServer()
    const created = await createApp(server, ["local-a"], {
      authMethod: "oauth_client_credentials",
    })

    const models = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: {
        authorization: `Bearer fixture-connected-app:${created.credential.clientId}`,
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })

    expect(created.credential.authMethod).toBe("oauth_client_credentials")
    expect(models.statusCode).toBe(200)
    expect(models.json()).toEqual({
      object: "list",
      data: [{ id: "local-a", object: "model", owned_by: "llm-machines" }],
    })
    expect(detailResponse.json().app).toMatchObject({
      connectionStatus: "connected",
      lastConnectedAt: expect.any(String),
    })
    const modelsEvents = getAuditEventsForTest().filter(
      (candidate) =>
        candidate.action === "connected_app.gateway.models" &&
        candidate.metadata.outcome === "succeeded",
    )
    expect(modelsEvents).toHaveLength(1)
    const event = modelsEvents[0]
    expect(event).toMatchObject({
      actorId: `fixture-subject:${created.credential.clientId}`,
      metadata: {
        applicationId: created.app.id,
        correlationId: expect.any(String),
        credentialRecordId: expect.any(String),
        keycloakSubjectId: `fixture-subject:${created.credential.clientId}`,
        outcome: "succeeded",
        sourceSystem: "console",
      },
    })
    expect(event?.metadata).not.toHaveProperty("environment")
    expect(
      getAuditEventsForTest().find(
        (candidate) => candidate.action === "admin.connected_app.created",
      ),
    ).toMatchObject({
      actorId: "admin-1",
      metadata: {
        applicationId: created.app.id,
        credentialRecordId: expect.any(String),
        keycloakSubjectId: "admin-1",
      },
    })
    expect(JSON.stringify(getAuditEventsForTest())).not.toContain(
      created.credential.clientSecret,
    )
    await server.close()
  })

  it("keeps connection testing passive before client authentication", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_FALLBACK_MODELS", "local-a")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    const server = buildServer()
    const created = await createApp(server, ["local-a"])

    const locked = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: {
        authorization: "Bearer llmm_t4_locked_locked-secret",
      },
    })
    const tested = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${created.app.id}/test`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "connected-app-gateway-passive-test",
      },
    })
    expect(locked.statusCode).toBe(401)
    expect(locked.json()).toMatchObject({
      title: "Invalid connected app token",
    })
    expect(tested.statusCode).toBe(200)
    expect(tested.json()).toMatchObject({
      app: {
        connectionStatus: "not_connected",
        lastConnectedAt: null,
      },
      connectionStatus: "not_connected",
    })
    expect(
      getAuditEventsForTest().find(
        (event) =>
          event.action === "admin.connected_app.connection_evidence_read",
      ),
    ).toMatchObject({
      actorId: "admin-1",
      metadata: {
        applicationId: created.app.id,
        credentialRecordId: expect.stringMatching(/^cak-/),
        keycloakSubjectId: "admin-1",
      },
    })
    await server.close()
  })

  it("rejects fixture connected app tokens outside test runtime even when fixture mode is enabled", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_FIXTURE_MODE", "true")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    const server = buildServer()
    const created = await createApp(server, ["local-a"], {
      authMethod: "oauth_client_credentials",
    })
    vi.stubEnv("NODE_ENV", "production")

    const response = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: {
        authorization: `Bearer fixture-connected-app:${created.credential.clientId}`,
      },
    })
    vi.stubEnv("NODE_ENV", "test")
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({
      title: "Invalid connected app token",
    })
    expect(detailResponse.json().app).toMatchObject({
      connectionStatus: "not_connected",
      lastConnectedAt: null,
    })
    expect(
      getAuditEventsForTest().filter(
        (event) => event.action === "connected_app.gateway.models",
      ),
    ).toHaveLength(0)
    await server.close()
  })

  it("records passive connection evidence for an unexpired retiring key", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-07-31T12:00:00.000Z"))
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          data: [{ id: "local-a", object: "model", owned_by: "llm-machines" }],
          object: "list",
        }),
      ),
    )
    const server = buildServer()
    const created = await createApp(server, ["local-a"])
    const rotated = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${created.app.id}/rotate-credentials`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "retiring-key-evidence-rotation",
      },
    })

    const models = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: {
        authorization: `Bearer ${bearerForCredential(created.credential)}`,
      },
    })
    const detail = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })

    expect(rotated.statusCode).toBe(200)
    expect(models.statusCode).toBe(200)
    expect(detail.json().app).toMatchObject({
      connectionStatus: "connected",
      lastConnectedAt: "2026-07-31T12:00:00.000Z",
    })
    expect(
      detail
        .json()
        .app.credentials.find(
          (credential: { id: string }) =>
            credential.id === created.credential.credentialId,
        ),
    ).toMatchObject({
      lastUsedAt: "2026-07-31T12:00:00.000Z",
      status: "retiring",
    })
    expect(
      getAuditEventsForTest().filter(
        (event) =>
          event.action === "connected_app.gateway.models" &&
          event.metadata.outcome === "succeeded",
      ),
    ).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          applicationId: created.app.id,
          credentialRecordId: created.credential.credentialId,
        }),
      }),
    ])
    expect(JSON.stringify(getAuditEventsForTest())).not.toContain(
      created.credential.apiKey,
    )
    await server.close()
  })

  it("does not connect a credential revoked while its model request is in flight", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-07-31T12:00:00.000Z"))
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    let signalModelRequestStarted: (() => void) | undefined
    let releaseModelRequest: ((response: Response) => void) | undefined
    const modelRequestStarted = new Promise<void>((resolve) => {
      signalModelRequestStarted = resolve
    })
    const pendingModelResponse = new Promise<Response>((resolve) => {
      releaseModelRequest = resolve
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => {
        signalModelRequestStarted?.()
        return pendingModelResponse
      })
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: "local-a", object: "model", owned_by: "llm-machines" }],
          object: "list",
        }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"])
    const oldToken = bearerForCredential(created.credential)
    const oldKeyRequest = server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${oldToken}` },
    })

    await modelRequestStarted
    const rotated = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${created.app.id}/rotate-credentials`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "connected-app-static-key-rotate",
      },
    })
    const revoked = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${created.app.id}/credentials/${created.credential.credentialId}/revoke`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "connected-app-stale-key-revoke",
      },
    })
    releaseModelRequest?.(
      Response.json({
        data: [{ id: "local-a", object: "model", owned_by: "llm-machines" }],
        object: "list",
      }),
    )
    const oldKeyResponse = await oldKeyRequest
    const staleDetail = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })
    const staleSucceededModelsEvents = getAuditEventsForTest().filter(
      (event) =>
        event.action === "connected_app.gateway.models" &&
        event.metadata.outcome === "succeeded",
    )
    const newKeyResponse = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: {
        authorization: `Bearer ${bearerForCredential(rotated.json().credential)}`,
      },
    })
    const connectedDetail = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })

    expect(rotated.statusCode).toBe(200)
    expect(revoked.statusCode).toBe(200)
    expect(rotated.json()).toMatchObject({
      credential: expect.objectContaining({ authMethod: "api_key" }),
      status: "rotated",
    })
    expect(oldKeyResponse.statusCode).toBe(200)
    expect(staleDetail.json().app).toMatchObject({
      connectionStatus: "not_connected",
      lastConnectedAt: null,
    })
    expect(staleSucceededModelsEvents).toHaveLength(0)
    expect(newKeyResponse.statusCode).toBe(200)
    expect(connectedDetail.json().app).toMatchObject({
      connectionStatus: "connected",
      lastConnectedAt: expect.any(String),
    })
    const activeCredential = rotated
      .json()
      .app.credentials.find(
        (credential: { status: string }) => credential.status === "active",
      )
    const successfulModelsEvents = getAuditEventsForTest().filter(
      (event) =>
        event.action === "connected_app.gateway.models" &&
        event.metadata.outcome === "succeeded",
    )
    expect(activeCredential).toBeDefined()
    expect(successfulModelsEvents).toHaveLength(1)
    expect(successfulModelsEvents[0]?.metadata.credentialRecordId).toBe(
      activeCredential?.id,
    )
    expect(
      getAuditEventsForTest().find(
        (event) => event.action === "admin.connected_app.credentials_rotated",
      ),
    ).toMatchObject({
      actorId: "admin-1",
      metadata: {
        applicationId: created.app.id,
        credentialRecordId: expect.stringMatching(/^cak-/),
        keycloakSubjectId: "admin-1",
      },
    })
    expect(JSON.stringify(getAuditEventsForTest())).not.toContain(oldToken)
    expect(JSON.stringify(getAuditEventsForTest())).not.toContain(
      rotated.json().credential.apiKey,
    )
    const revokedOldKeyResponse = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${oldToken}` },
    })
    expect(revokedOldKeyResponse.statusCode).toBe(401)
    expect(
      getAuditEventsForTest().filter(
        (event) =>
          event.action === "connected_app.gateway.models" &&
          event.metadata.outcome === "succeeded",
      ),
    ).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await server.close()
  })

  it("sanitizes upstream LiteLLM chat failures before returning them to apps", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("upstream leaked internal-litellm-key", { status: 502 }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"])
    const token = bearerForCredential(created.credential)

    const response = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "private prompt" }],
      },
    })

    expect(response.statusCode).toBe(502)
    expect(response.json()).toMatchObject({
      title: "LiteLLM chat completion failed",
    })
    expect(response.body).not.toContain("internal-litellm-key")
    expect(response.body).not.toContain("private prompt")
    await server.close()
  })

  it("records streamed usage tokens without storing streamed prompts or completions", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"streamed private completion"}}]}\n\n',
          'data: {"choices":[],"usage":',
          '{"total_tokens":17}}\n\n',
          "data: [DONE]\n\n",
        ]),
      )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"])
    const token = bearerForCredential(created.credential)

    const response = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "streamed private prompt" }],
        stream: true,
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })
    const upstreamBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain("streamed private completion")
    expect(upstreamBody).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    })
    expect(detailResponse.json().app.usage).toMatchObject({
      requests7d: 1,
      tokens7d: 17,
    })
    const auditText = JSON.stringify(getAuditEventsForTest())
    expect(auditText).not.toContain('"tokens"')
    expect(auditText).not.toContain('"model"')
    expect(auditText).not.toContain("streamed private prompt")
    expect(auditText).not.toContain("streamed private completion")
    await server.close()
  })

  it("enforces RPM and fails closed for unqualified token budgets", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      Response.json({
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { total_tokens: 4 },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const rateLimitedApp = await createApp(server, ["local-a"], {
      rateLimitRpm: 1,
      tokenBudget7d: null,
    })
    const rateLimitedToken = bearerForCredential(rateLimitedApp.credential)

    const first = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${rateLimitedToken}` },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "first" }],
      },
    })
    const rateLimited = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${rateLimitedToken}` },
    })
    const rateLimitedDetail = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${rateLimitedApp.app.id}`,
      headers: adminHeaders,
    })
    const budgetedApp = await createApp(server, ["local-a"], {
      rateLimitRpm: 10,
      tokenBudget7d: 4,
    })
    const budgetedToken = bearerForCredential(budgetedApp.credential)
    const budgetPrimer = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${budgetedToken}` },
      payload: {
        model: "local-a",
        max_tokens: 4,
        messages: [{ role: "user", content: "budget primer" }],
      },
    })
    const overBudget = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${budgetedToken}` },
      payload: {
        model: "local-a",
        max_tokens: 4,
        messages: [{ role: "user", content: "over budget" }],
      },
    })

    expect(first.statusCode).toBe(200)
    expect(rateLimited.statusCode).toBe(429)
    expect(rateLimited.json()).toMatchObject({ title: "Rate limit exceeded" })
    expect(rateLimitedDetail.json().app).toMatchObject({
      connectionStatus: "not_connected",
      lastConnectedAt: null,
    })
    expect(budgetPrimer.statusCode).toBe(503)
    expect(budgetPrimer.json()).toMatchObject({
      title: "Token budget enforcement not qualified",
    })
    expect(overBudget.statusCode).toBe(503)
    expect(overBudget.json()).toMatchObject({
      title: "Token budget enforcement not qualified",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await server.close()
  })

  it("does not exceed RPM under concurrent connected-app traffic", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              Response.json({
                choices: [
                  {
                    finish_reason: "stop",
                    index: 0,
                    message: { content: "ok", role: "assistant" },
                  },
                ],
                usage: { total_tokens: 1 },
              }),
            )
          }, 15)
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"], {
      rateLimitRpm: 1,
      tokenBudget7d: null,
    })
    const token = bearerForCredential(created.credential)
    const request = {
      method: "POST" as const,
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "concurrent" }],
      },
    }

    const responses = await Promise.all([
      server.inject(request),
      server.inject(request),
    ])

    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 429,
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await server.close()
  })

  it("does not forward concurrent traffic with an unqualified token budget", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              Response.json({
                choices: [
                  {
                    finish_reason: "stop",
                    index: 0,
                    message: { content: "ok", role: "assistant" },
                  },
                ],
                usage: { total_tokens: 4 },
              }),
            )
          }, 15)
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"], {
      rateLimitRpm: 10,
      tokenBudget7d: 4,
    })
    const token = bearerForCredential(created.credential)
    const request = {
      method: "POST" as const,
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        model: "local-a",
        max_tokens: 4,
        messages: [{ role: "user", content: "budget concurrent" }],
      },
    }

    const responses = await Promise.all([
      server.inject(request),
      server.inject(request),
    ])
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })

    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      503, 503,
    ])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(detailResponse.json().app.usage).toMatchObject({
      failures7d: 2,
      requests7d: 2,
      tokens7d: 0,
    })
    await server.close()
  })

  it("preserves request counters across gateway server instances in the same process", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_FALLBACK_MODELS", "local-a")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    const firstServer = buildServer()
    const created = await createApp(firstServer, ["local-a"], {
      rateLimitRpm: 1,
      tokenBudget7d: null,
    })
    const token = bearerForCredential(created.credential)

    const first = await firstServer.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${token}` },
    })
    const secondServer = buildServer()
    const second = await secondServer.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${token}` },
    })

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(429)
    expect(second.json()).toMatchObject({ title: "Rate limit exceeded" })
    await firstServer.close()
    await secondServer.close()
  })

  it("records known usage when token limits are disabled", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("provider failed", { status: 500 }))
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              finish_reason: "stop",
              index: 0,
              message: { content: "ok", role: "assistant" },
            },
          ],
          usage: { total_tokens: 4 },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"], {
      rateLimitRpm: 10,
      tokenBudget7d: null,
    })
    const token = bearerForCredential(created.credential)
    const payload = {
      model: "local-a",
      max_tokens: 4,
      messages: [{ role: "user", content: "budget release" }],
    }

    const failed = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload,
    })
    const retried = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload,
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })

    expect(failed.statusCode).toBe(500)
    expect(failed.json()).toMatchObject({
      title: "LiteLLM chat completion failed",
    })
    expect(retried.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(detailResponse.json().app.usage).toMatchObject({
      failures7d: 1,
      requests7d: 2,
      tokens7d: 4,
    })
    await server.close()
  })
})

async function createApp(
  server: ReturnType<typeof buildServer>,
  models: string[],
  overrides: {
    authMethod?: "api_key" | "oauth_client_credentials"
    rateLimitRpm?: number | null
    tokenBudget7d?: number | null
  } = {},
) {
  const limitPayload: {
    authMethod?: "api_key" | "oauth_client_credentials"
    rateLimitRpm?: number | null
    tokenBudget7d?: number | null
  } = {}
  if (overrides.authMethod !== undefined) {
    limitPayload.authMethod = overrides.authMethod
  }
  if (overrides.rateLimitRpm !== undefined) {
    limitPayload.rateLimitRpm = overrides.rateLimitRpm
  }
  if (overrides.tokenBudget7d !== undefined) {
    limitPayload.tokenBudget7d = overrides.tokenBudget7d
  }
  const response = await server.inject({
    method: "POST",
    url: "/api/admin/applications/connected-apps",
    headers: {
      ...adminHeaders,
      "idempotency-key": `create-connected-app-${models.join("-")}-${createCounter++}`,
    },
    payload: {
      allowedModels: models,
      description: "Integration used by app gateway tests.",
      name: `Gateway Test ${models.join(" ")}`,
      ...limitPayload,
    },
  })
  expect(response.statusCode).toBe(201)
  return response.json() as {
    app: { id: string }
    credential: {
      apiKey?: string
      authMethod: "api_key" | "oauth_client_credentials"
      clientId?: string
      clientSecret?: string
      credentialId: string
      keyPrefix: string | null
    }
  }
}

function bearerForCredential(credential: {
  apiKey?: string
  authMethod: "api_key" | "oauth_client_credentials"
  clientId?: string
}): string {
  if (credential.authMethod === "api_key" && credential.apiKey) {
    return credential.apiKey
  }
  return `fixture-connected-app:${credential.clientId ?? ""}`
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
