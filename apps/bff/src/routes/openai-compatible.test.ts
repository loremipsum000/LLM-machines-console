import { randomUUID } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import {
  getAuditEventsForTest,
  resetAuditEventsForTest,
} from "../services/audit"
import { resetGovernanceForTest } from "../services/admin-governance"
import { resetHubStateForTest } from "../services/hub"
import { resetIdempotencyForTest } from "../services/idempotency"
import { resetKnowledgeStateForTest } from "../services/knowledge/admin"

const serviceHeaders = {
  authorization: "Bearer test-service-key",
  "x-llm-machines-keycloak-token": "",
  "x-llm-machines-user-sub": "user-1",
  "x-llm-machines-user-email": "user@example.test",
  "x-llm-machines-user-roles": "consumer",
}

const adminHeaders = {
  ...serviceHeaders,
  "x-llm-machines-user-sub": "admin-1",
  "x-llm-machines-user-email": "admin@example.test",
  "x-llm-machines-user-roles": "admin",
}

describe("OpenAI-compatible routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    resetAuditEventsForTest()
    resetGovernanceForTest()
    resetHubStateForTest()
    resetIdempotencyForTest()
    resetKnowledgeStateForTest()
  })

  it("requires authentication for model listing", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/v1/models",
    })

    expect(response.statusCode).toBe(401)
    await server.close()
  })

  it("returns fallback models for an authenticated consumer", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_FIXTURE_MODE", "true")
    vi.stubEnv("BFF_FALLBACK_MODELS", "local-a,local-b")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/v1/models",
      headers: serviceHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      object: "list",
      data: [
        { id: "local-a", object: "model", owned_by: "llm-machines" },
        { id: "local-b", object: "model", owned_by: "llm-machines" },
      ],
    })
    await server.close()
  })

  it("does not list fallback models outside fixture mode when LiteLLM is missing", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_ALLOW_HEADER_ONLY_SERVICE_AUTH", "true")
    vi.stubEnv("BFF_REQUIRE_FORWARDED_KEYCLOAK_TOKEN", "false")
    vi.stubEnv("NODE_ENV", "production")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/v1/models",
      headers: serviceHeaders,
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      title: "LiteLLM is not configured",
    })
    await server.close()
  })

  it("sanitizes LiteLLM model-list fetch exceptions", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("LITELLM_URL", "http://internal-litellm.secret")
    vi.stubEnv("LITELLM_KEY", "litellm-key")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(
          "dial tcp internal-litellm.secret with token sk-live-models",
        )
      }),
    )
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/v1/models",
      headers: serviceHeaders,
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      title: "LiteLLM model list unavailable",
      status: 503,
      request_id: expect.any(String),
    })
    expect(response.body).not.toContain("internal-litellm.secret")
    expect(response.body).not.toContain("sk-live-models")
    await server.close()
  })

  it("invokes a visible agent slash command with audit and an OpenAI-shaped stream", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...serviceHeaders,
        "content-type": "application/json",
      },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "@summary-agent summarize this" }],
        stream: true,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toBe("text/event-stream")
    expect(response.body).toContain("data: {")
    expect(response.body).toContain("Summary Agent ran on the local appliance")
    expect(response.body).toContain("Task: /tasks/")
    expect(response.body).toContain("Artifact: /artifacts/")
    expect(response.body).toContain("data: [DONE]\n\n")
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: "user-1",
          action: "hub.agent.invoke",
          targetId: "agent-summary",
          targetType: "hub.resources",
        }),
      ]),
    )

    const tasksResponse = await server.inject({
      method: "GET",
      url: "/api/hub/tasks",
      headers: serviceHeaders,
    })
    const artifactsResponse = await server.inject({
      method: "GET",
      url: "/api/hub/artifacts",
      headers: serviceHeaders,
    })

    expect(tasksResponse.statusCode).toBe(200)
    expect(tasksResponse.json()).toEqual([
      expect.objectContaining({
        title: "Run Summary Agent",
        status: "completed",
      }),
    ])
    expect(artifactsResponse.statusCode).toBe(200)
    expect(artifactsResponse.json()).toEqual([
      expect.objectContaining({
        title: "Summary Agent output",
        kind: "markdown",
        preview: expect.stringContaining("## Response"),
      }),
    ])
    await server.close()
  })

  it("returns an OpenAI-shaped non-stream response for agent slash commands", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...serviceHeaders,
        "content-type": "application/json",
      },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "@summary-agent summarize this" }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      object: "chat.completion",
      model: "local-a",
      choices: [
        {
          message: {
            role: "assistant",
            content: expect.stringContaining(
              "Summary Agent ran on the local appliance",
            ),
          },
          finish_reason: "stop",
        },
      ],
    })
    await server.close()
  })

  it("does not run slash-command local fallback outside fixture mode", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_ALLOW_HEADER_ONLY_SERVICE_AUTH", "true")
    vi.stubEnv("BFF_REQUIRE_FORWARDED_KEYCLOAK_TOKEN", "false")
    vi.stubEnv("NODE_ENV", "production")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...serviceHeaders,
        "content-type": "application/json",
      },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "@summary-agent summarize this" }],
      },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({
      title: "Agent is not runnable",
    })
    await server.close()
  })

  it("routes configured agent slash commands to OpenClaw and stores the runtime output", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_OPENCLAW_BASE_URL", "http://openclaw.test")
    vi.stubEnv("AGENTIC_OPENCLAW_TOKEN", "runtime-token")
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "chatcmpl-runtime",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Runtime summary from OpenClaw.",
            },
            finish_reason: "stop",
          },
        ],
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...serviceHeaders,
        "content-type": "application/json",
      },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "@summary-agent summarize this" }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      choices: [
        {
          message: {
            content: expect.stringContaining("Runtime summary from OpenClaw."),
          },
        },
      ],
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.toString()).toBe("http://openclaw.test/v1/chat/completions")
    expect(init.headers).toMatchObject({
      Authorization: "Bearer runtime-token",
      "X-LLM-Machines-Actor": "user-1",
    })
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "local-a",
      stream: false,
    })

    const artifactsResponse = await server.inject({
      method: "GET",
      url: "/api/hub/artifacts",
      headers: serviceHeaders,
    })
    expect(artifactsResponse.json()).toEqual([
      expect.objectContaining({
        preview: expect.stringContaining("Runtime summary from OpenClaw."),
      }),
    ])
    await server.close()
  })

  it("supports a custom OpenClaw chat-completions path", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_OPENCLAW_BASE_URL", "https://openclaw.test")
    vi.stubEnv(
      "AGENTIC_OPENCLAW_CHAT_COMPLETIONS_PATH",
      "/custom/chat/completions",
    )
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: "Runtime summary from custom API path.",
            },
          },
        ],
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...serviceHeaders,
        "content-type": "application/json",
      },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "@summary-agent summarize this" }],
      },
    })

    expect(response.statusCode).toBe(200)
    const [url] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.toString()).toBe("https://openclaw.test/custom/chat/completions")
    await server.close()
  })

  it("relays configured OpenClaw slash streams and persists the accumulated output", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_OPENCLAW_BASE_URL", "http://openclaw.test")
    const fetchMock = vi.fn(async () =>
      streamingResponse([
        'data: {"choices":[{"delta":{"content":"Runtime "},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"content":"summary."},"finish_reason":null}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...serviceHeaders,
        "content-type": "application/json",
      },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "@summary-agent summarize this" }],
        stream: true,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toBe("text/event-stream")
    expect(response.body).toContain("Runtime ")
    expect(response.body).toContain("summary.")
    expect(response.body).toContain("Task: /tasks/")
    expect(response.body).toContain("Artifact: /artifacts/")
    expect(response.body).toContain("data: [DONE]\n\n")
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "local-a",
      stream: true,
    })

    const artifactsResponse = await server.inject({
      method: "GET",
      url: "/api/hub/artifacts",
      headers: serviceHeaders,
    })
    expect(artifactsResponse.json()).toEqual([
      expect.objectContaining({
        preview: expect.stringContaining("Runtime summary."),
      }),
    ])
    await server.close()
  })

  it("mirrors observed LibreChat thread headers into Hub recents", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "litellm-key")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          id: "chatcmpl-pass-through",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Rollout notes drafted.",
              },
              finish_reason: "stop",
            },
          ],
        }),
      ),
    )
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...serviceHeaders,
        "content-type": "application/json",
        "x-librechat-thread-id": "real-thread-1",
        "x-librechat-message-id": "message-1",
      },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "Draft the rollout notes" }],
      },
    })

    expect(response.statusCode).toBe(200)

    const homeResponse = await server.inject({
      method: "GET",
      url: "/api/hub/home",
      headers: serviceHeaders,
    })
    const searchResponse = await server.inject({
      method: "GET",
      url: "/api/hub/search?q=rollout",
      headers: serviceHeaders,
    })

    expect(homeResponse.statusCode).toBe(200)
    expect(homeResponse.json().modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "recent_chats",
          threads: [
            expect.objectContaining({
              id: "real-thread-1",
              title: "Draft the rollout notes",
              preview: "Draft the rollout notes",
              href: "https://librechat.example.test/c/real-thread-1",
              model: "local-a",
            }),
          ],
        }),
      ]),
    )
    expect(searchResponse.json()).toEqual([
      expect.objectContaining({
        id: "real-thread-1",
        type: "thread",
        href: "https://librechat.example.test/c/real-thread-1",
      }),
    ])
    await server.close()
  })

  it("preflights named corpus prompts and injects governed context before LiteLLM", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "litellm-key")
    const server = buildServer()
    await createPublishedTextCorpus(server, {
      content:
        "Supervisory Board meeting attendance overview. The attendance rate for the Supervisory Board meeting was 97%. Attendance data are reported from each member's formal date of appointment.",
      fileName: "asml-board-attendance.txt",
      name: "ASML",
    })
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        id: "chatcmpl-preflight",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "The attendance rate was 97%.",
            },
            finish_reason: "stop",
          },
        ],
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...serviceHeaders,
        "content-type": "application/json",
        "x-librechat-thread-id": "asml-thread-1",
        "x-librechat-message-id": "message-1",
      },
      payload: {
        model: "local-a",
        messages: [
          {
            role: "user",
            content:
              "check the ASML corpora and retrieve the attendance rate for the Supervisory Board meeting",
          },
        ],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const upstreamBody = JSON.parse(String(init.body)) as {
      messages: Array<{ content: string; role: string }>
    }
    expect(upstreamBody.messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining('Governed corpus context for "ASML"'),
    })
    expect(upstreamBody.messages[0].content).toContain("97%")
    expect(upstreamBody.messages[0].content).toContain(
      "asml-board-attendance.txt",
    )
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: "user-1",
          action: "knowledge_intent.detected",
          targetType: "knowledge.corpus",
        }),
        expect.objectContaining({
          actorId: "user-1",
          action: "knowledge_preflight.retrieved",
          targetType: "knowledge.corpus",
        }),
      ]),
    )
    await server.close()
  })

  it("returns a deterministic clarification when a named corpus prompt is ambiguous", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "litellm-key")
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ choices: [] }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    await createPublishedTextCorpus(server, {
      content: "Primary ASML corpus.",
      fileName: "asml.txt",
      name: "ASML",
    })
    await createPublishedTextCorpus(server, {
      content: "Archived ASML corpus.",
      fileName: "asml-archive.txt",
      name: "ASML Archive",
    })

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...serviceHeaders,
        "content-type": "application/json",
      },
      payload: {
        model: "local-a",
        messages: [
          {
            role: "user",
            content: "check ASML corpus for attendance",
          },
        ],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(response.json()).toMatchObject({
      choices: [
        {
          message: {
            content: expect.stringContaining("Multiple accessible corpora"),
          },
        },
      ],
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "knowledge_preflight.ambiguous",
          actorId: "user-1",
        }),
      ]),
    )
    await server.close()
  })

  it("does not fall through to LiteLLM when a named corpus is not accessible", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "litellm-key")
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ choices: [] }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...serviceHeaders,
        "content-type": "application/json",
      },
      payload: {
        model: "local-a",
        messages: [
          {
            role: "user",
            content: "check MISSING corpora for attendance",
          },
        ],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(response.json()).toMatchObject({
      choices: [
        {
          message: {
            content: expect.stringContaining(
              'I could not find an accessible published corpus matching "MISSING"',
            ),
          },
        },
      ],
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "knowledge_intent.unfulfilled",
          actorId: "user-1",
          reason: "no_accessible_corpus_match",
        }),
      ]),
    )
    await server.close()
  })

  it("bypasses slash parsing for native LibreChat agent endpoint calls and audits usage", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "litellm-key")
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "chatcmpl-native-agent",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Native LibreChat agent response.",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 5,
          total_tokens: 17,
        },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...serviceHeaders,
        "content-type": "application/json",
        "x-librechat-thread-id": "native-agent-thread-1",
        "x-librechat-message-id": "message-1",
        "x-llm-machines-agent-runtime": "librechat-native",
      },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "@summary-agent do not parse" }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      messages: [{ role: "user", content: "@summary-agent do not parse" }],
    })
    expect(response.json()).toMatchObject({
      choices: [
        {
          message: {
            content: "Native LibreChat agent response.",
          },
        },
      ],
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: "user-1",
          action: "librechat_native_agent.model_call",
          targetId: "native-agent-thread-1",
          metadata: expect.objectContaining({
            model: "local-a",
            source: "librechat_native_agent",
            usage: {
              prompt_tokens: 12,
              completion_tokens: 5,
              total_tokens: 17,
            },
          }),
        }),
      ]),
    )
    await server.close()
  })

  it("normalizes LibreChat content blocks before forwarding to text-only local models", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "litellm-key")
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        id: "chatcmpl-normalized",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...serviceHeaders,
        "content-type": "application/json",
      },
      payload: {
        model: "gemma-4-12B-it-Q4_K_M",
        messages: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "Reply with exactly pong." },
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,AA==" },
              },
            ],
          },
          {
            role: "assistant",
            content: [{ type: "error", error: "unsupported content[].type" }],
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
          content:
            "Reply with exactly pong.\n[image input omitted: this model path is text-only]",
        },
        {
          role: "assistant",
          content: "Previous model error: unsupported content[].type",
        },
      ],
    })
    await server.close()
  })

  it("sanitizes non-stream LiteLLM chat failures before returning them", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "litellm-key")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          "upstream failure on host inference.example.test with token sk-live-chat",
          { status: 502 },
        ),
      ),
    )
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...serviceHeaders,
        "content-type": "application/json",
      },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "hello" }],
      },
    })

    expect(response.statusCode).toBe(502)
    expect(response.json()).toMatchObject({
      title: "LiteLLM chat completion failed",
      status: 502,
      detail: expect.stringContaining("Reference request_id"),
      request_id: expect.any(String),
    })
    expect(response.body).not.toContain("inference.example.test")
    expect(response.body).not.toContain("sk-live-chat")
    await server.close()
  })

  it("sanitizes stream-mode LiteLLM chat failures before returning them", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "litellm-key")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          "stream failure from litellm.example.test with secret upstream-token",
          { status: 503 },
        ),
      ),
    )
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...serviceHeaders,
        "content-type": "application/json",
      },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
      },
    })

    expect(response.statusCode).toBe(503)
    expect(response.headers["content-type"]).toContain("application/json")
    expect(response.json()).toMatchObject({
      title: "LiteLLM chat completion failed",
      status: 503,
      request_id: expect.any(String),
    })
    expect(response.body).not.toContain("litellm.example.test")
    expect(response.body).not.toContain("upstream-token")
    await server.close()
  })

  it("fails closed when a configured slash agent runtime errors", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_OPENCLAW_BASE_URL", "http://openclaw.test")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ detail: "runtime unavailable" }, { status: 502 }),
      ),
    )
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...serviceHeaders,
        "content-type": "application/json",
      },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "@summary-agent summarize this" }],
      },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      title: "Agentic runtime failed",
      status: 503,
      detail: expect.stringContaining("runtime unavailable"),
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: "user-1",
          action: "hub.agent.invoke_failed",
          targetId: "agent-summary",
        }),
      ]),
    )

    const tasksResponse = await server.inject({
      method: "GET",
      url: "/api/hub/tasks",
      headers: serviceHeaders,
    })
    expect(tasksResponse.json()).toEqual([])
    await server.close()
  })

  it("denies unknown agent slash commands without falling through to LiteLLM", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...serviceHeaders,
        "content-type": "application/json",
      },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "@unknown-agent summarize this" }],
        stream: true,
      },
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({
      title: "Agent not found",
      status: 404,
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: "user-1",
          action: "hub.agent.invoke_denied",
          targetId: "unknown-agent",
        }),
      ]),
    )
    await server.close()
  })

  it("blocks workflow slash commands until the workflow runtime exists", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...serviceHeaders,
        "content-type": "application/json",
      },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "/review summarize this" }],
        stream: true,
      },
    })

    expect(response.statusCode).toBe(501)
    expect(response.json()).toMatchObject({
      title: "Workflow runtime is not available",
      status: 501,
    })

    const violations = await server.inject({
      method: "GET",
      url: "/api/admin/policies/violations?q=workflow",
      headers: adminHeaders,
    })

    expect(violations.statusCode).toBe(200)
    expect(violations.json()).toMatchObject({
      sourceStatus: "degraded",
      totalCount: 1,
      warningCount: 1,
      criticalCount: 0,
      violations: [
        {
          policyType: "access_control",
          severity: "warning",
          actionTaken: "block",
          actorId: "user-1",
          targetType: "hub.workflow",
          targetId: "review",
          message:
            "Workflow slash command blocked because the workflow runtime is unavailable.",
        },
      ],
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "admin.policy_violation.recorded",
          actorId: "user-1",
          targetType: "admin.policy_violations",
        }),
      ]),
    )
    await server.close()
  })

  it("returns 503 for pass-through chat when LiteLLM is not configured", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...serviceHeaders,
        "content-type": "application/json",
      },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
      },
    })

    expect(response.statusCode).toBe(503)
    await server.close()
  })
})

async function createPublishedTextCorpus(
  server: ReturnType<typeof buildServer>,
  input: {
    content: string
    fileName: string
    name: string
  },
) {
  const corpusResponse = await server.inject({
    method: "POST",
    url: "/api/admin/knowledge/corpora",
    headers: {
      ...adminHeaders,
      "idempotency-key": randomUUID(),
    },
    payload: {
      accessGroups: [],
      name: input.name,
    },
  })
  expect(corpusResponse.statusCode).toBe(201)
  const corpusId = corpusResponse.json().corpus.id as string

  const uploadResponse = await server.inject({
    method: "POST",
    url: `/api/admin/knowledge/corpora/${corpusId}/sources/upload`,
    headers: {
      ...adminHeaders,
      "idempotency-key": randomUUID(),
    },
    payload: {
      contentBase64: Buffer.from(input.content).toString("base64"),
      fileName: input.fileName,
      mimeType: "text/plain",
    },
  })
  expect(uploadResponse.statusCode).toBe(200)

  const ingestResponse = await server.inject({
    method: "POST",
    url: `/api/admin/knowledge/corpora/${corpusId}/ingest`,
    headers: {
      ...adminHeaders,
      "idempotency-key": randomUUID(),
    },
  })
  expect(ingestResponse.statusCode).toBe(200)

  const snapshotId = ingestResponse.json().snapshot.id as string
  const publishResponse = await server.inject({
    method: "POST",
    url: `/api/admin/knowledge/corpora/${corpusId}/snapshots/${snapshotId}/publish`,
    headers: {
      ...adminHeaders,
      "idempotency-key": randomUUID(),
    },
  })
  expect(publishResponse.statusCode).toBe(200)
  return corpusId
}

function streamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
      },
    },
  )
}
