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
    resetAuditEventsForTest()
    resetIdempotencyForTest()
    await resetConnectedAppsForTest()
  })

  it("routes staging app model and chat calls to LiteLLM through BFF policy without leaking secrets or prompts", async () => {
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
    const auditText = JSON.stringify(getAuditEventsForTest())
    expect(auditText).toContain("connected_app.gateway.models")
    expect(auditText).toContain("connected_app.gateway.chat_completions")
    expect(auditText).toContain("\"tokens\":42")
    expect(auditText).not.toContain("private prompt")
    expect(auditText).not.toContain("private completion")
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

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      title: "LiteLLM model list unavailable",
      detail: "LiteLLM model list request failed.",
    })
    expect(response.body).not.toContain("litellm.example.test")
    expect(response.body).not.toContain("internal-litellm-key")
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

    expect(disallowedModel.statusCode).toBe(403)
    expect(disallowedModel.json()).toMatchObject({ title: "Model not allowed" })
    expect(disabled.statusCode).toBe(403)
    expect(disabled.json()).toMatchObject({ title: "Connected app disabled" })
    expect(unknown.statusCode).toBe(401)
    expect(unknown.json()).toMatchObject({ title: "Invalid connected app token" })
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

    expect(created.credential.authMethod).toBe("oauth_client_credentials")
    expect(models.statusCode).toBe(200)
    expect(models.json()).toEqual({
      object: "list",
      data: [{ id: "local-a", object: "model", owned_by: "llm-machines" }],
    })
    await server.close()
  })

  it("keeps production gateway credentials locked until promotion creates a production client", async () => {
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
    await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${created.app.id}/test`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "connected-app-gateway-test-before-prod",
      },
    })
    const promoted = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${created.app.id}/promote-production`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "connected-app-gateway-promote",
      },
    })
    const productionToken = bearerForCredential(promoted.json().credential)
    const productionModels = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${productionToken}` },
    })

    expect(locked.statusCode).toBe(401)
    expect(locked.json()).toMatchObject({ title: "Invalid connected app token" })
    expect(promoted.statusCode).toBe(200)
    expect(promoted.json()).toMatchObject({
      credential: expect.objectContaining({ environment: "production" }),
      status: "promoted",
    })
    expect(productionModels.statusCode).toBe(200)
    expect(productionModels.json()).toEqual({
      object: "list",
      data: [{ id: "local-a", object: "model", owned_by: "llm-machines" }],
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

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({
      title: "Invalid connected app token",
    })
    await server.close()
  })

  it("rejects rotated static API keys and accepts the replacement key", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_FALLBACK_MODELS", "local-a")
    const server = buildServer()
    const created = await createApp(server, ["local-a"])
    const oldToken = bearerForCredential(created.credential)
    const rotated = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${created.app.id}/rotate-credentials`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "connected-app-static-key-rotate",
      },
    })
    const oldKeyResponse = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${oldToken}` },
    })
    const newKeyResponse = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${bearerForCredential(rotated.json().credential)}` },
    })

    expect(rotated.statusCode).toBe(200)
    expect(rotated.json()).toMatchObject({
      credential: expect.objectContaining({ authMethod: "api_key" }),
      status: "rotated",
    })
    expect(oldKeyResponse.statusCode).toBe(401)
    expect(oldKeyResponse.json()).toMatchObject({
      title: "Invalid connected app token",
    })
    expect(newKeyResponse.statusCode).toBe(200)
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
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
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
    expect(auditText).toContain("\"tokens\":17")
    expect(auditText).not.toContain("streamed private prompt")
    expect(auditText).not.toContain("streamed private completion")
    await server.close()
  })

  it("enforces request and token limits before forwarding app traffic", async () => {
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
      tokenBudget7d: 500_000,
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
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${rateLimitedToken}` },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "second" }],
      },
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
    expect(budgetPrimer.statusCode).toBe(200)
    expect(overBudget.statusCode).toBe(429)
    expect(overBudget.json()).toMatchObject({ title: "Token budget exceeded" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
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

  it("does not exceed token budget under concurrent connected-app completions", async () => {
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
      200, 429,
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(detailResponse.json().app.usage).toMatchObject({
      failures7d: 1,
      requests7d: 2,
      tokens7d: 4,
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

  it("fails closed for rate-limited production apps when Redis is unavailable", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"], {
      rateLimitRpm: 1,
      tokenBudget7d: null,
    })
    const token = bearerForCredential(created.credential)
    vi.stubEnv("BFF_FIXTURE_MODE", "false")
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("REDIS_URL", "")

    const response = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      title: "Rate limit backend unavailable",
    })
    expect(fetchMock).not.toHaveBeenCalled()
    await server.close()
  })

  it("allows production apps without rate limits when Redis is unavailable", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        data: [{ id: "local-a", object: "model", owned_by: "llm-machines" }],
        object: "list",
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"], {
      rateLimitRpm: null,
      tokenBudget7d: null,
    })
    const token = bearerForCredential(created.credential)
    vi.stubEnv("BFF_FIXTURE_MODE", "false")
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("REDIS_URL", "")

    const response = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await server.close()
  })

  it("releases reserved token budget when the upstream completion fails", async () => {
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
      tokenBudget7d: 4,
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
      ownerGroup: "Everyone",
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
