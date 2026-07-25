import { afterEach, describe, expect, it, vi } from "vitest"
import { builderAgentTestStreamEventSchema } from "@llm-machines/contracts"
import { buildServer } from "../index"
import {
  getAuditEventsForTest,
  resetAuditEventsForTest,
} from "../services/audit"
import { resetBuilderStateForTest } from "../services/builder"
import { resetHubStateForTest, subscribeHubEvents } from "../services/hub"
import { resetIdempotencyForTest } from "../services/idempotency"
import { resetKnowledgeStateForTest } from "../services/knowledge/admin"

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

function parseAgentTestEvents(body: string) {
  return body
    .split(/\r?\n\r?\n/)
    .map((frame) =>
      frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n")
        .trim(),
    )
    .filter(Boolean)
    .map((data) => builderAgentTestStreamEventSchema.parse(JSON.parse(data)))
}

describe("Builder routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    resetAuditEventsForTest()
    resetBuilderStateForTest()
    resetHubStateForTest()
    resetIdempotencyForTest()
    resetKnowledgeStateForTest()
  })

  it("requires authentication for builder templates", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/builder/templates",
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

  it("blocks consumers from builder resources", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/builder/resources",
      headers: consumerHeaders,
    })

    expect(response.statusCode).toBe(403)
    await server.close()
  })

  it("returns the starter template gallery for builders", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/builder/templates",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "template-summary-agent",
          type: "agent",
        }),
        expect.objectContaining({
          id: "template-internal-docs-corpus",
          type: "rag_corpus",
        }),
      ]),
    )
    await server.close()
  })

  it("returns a single template detail", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/builder/templates/template-summary-agent",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      id: "template-summary-agent",
      samplePrompts: expect.arrayContaining([
        "Summarize this incident report for an executive.",
      ]),
    })
    await server.close()
  })

  it("server-filters builder resources by owner", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/builder/resources",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toHaveLength(2)
    expect(
      response.json().every((resource: { ownerId: string }) => {
        return resource.ownerId === "builder-1"
      }),
    ).toBe(true)
    await server.close()
  })

  it("lets admins inspect all builder resources", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/builder/resources",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toHaveLength(3)
    await server.close()
  })

  it("hides another builder resource detail", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/builder/resources/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({
      title: "Resource not found",
      status: 404,
    })
    await server.close()
  })

  it("returns owner-scoped submissions", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/builder/submissions",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceName: "Internal Docs Corpus",
          state: "submitted",
        }),
        expect.objectContaining({
          resourceName: "Summary Agent",
          state: "rejected",
        }),
      ]),
    )
    await server.close()
  })

  it("lists only published allowed corpora and lets Builders attach them to agents", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const publishedId = await createPublishedKnowledgeCorpus(server, {
      name: "Published HR Corpus",
    })
    await createKnowledgeCorpus(server, {
      name: "Draft Corpus",
    })
    const restrictedId = await createPublishedKnowledgeCorpus(server, {
      accessGroups: ["security"],
      name: "Security Corpus",
    })

    const listResponse = await server.inject({
      method: "GET",
      url: "/api/builder/knowledge/corpora",
      headers: builderHeaders,
    })
    const attachResponse = await server.inject({
      method: "POST",
      url: `/api/builder/agents/66666666-6666-4666-8666-666666666666/corpora/${publishedId}`,
      headers: {
        ...builderHeaders,
        "idempotency-key": "attach-knowledge-corpus",
      },
    })
    const deniedAttachResponse = await server.inject({
      method: "POST",
      url: `/api/builder/agents/66666666-6666-4666-8666-666666666666/corpora/${restrictedId}`,
      headers: {
        ...builderHeaders,
        "idempotency-key": "attach-restricted-corpus",
      },
    })
    const bindingsResponse = await server.inject({
      method: "GET",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/corpora",
      headers: builderHeaders,
    })

    expect(listResponse.statusCode).toBe(200)
    expect(listResponse.json().corpora).toEqual([
      expect.objectContaining({
        id: publishedId,
        name: "Published HR Corpus",
        status: "published",
      }),
    ])
    expect(attachResponse.statusCode).toBe(200)
    expect(attachResponse.json()).toMatchObject({
      agentResourceId: "66666666-6666-4666-8666-666666666666",
      corpusId: publishedId,
    })
    expect(deniedAttachResponse.statusCode).toBe(404)
    expect(bindingsResponse.json()).toEqual([
      expect.objectContaining({ corpusId: publishedId }),
    ])
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "knowledge.agent_corpus.bound",
          targetId: "66666666-6666-4666-8666-666666666666",
        }),
      ]),
    )

    await server.close()
  })

  it("returns the owning builder's draft Agent Studio", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/studio",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      resource: {
        id: "66666666-6666-4666-8666-666666666666",
        type: "agent",
        state: "draft",
      },
      config: {
        model: "qwen3-35b-local",
        sandboxProfile: "openclaw-restricted",
      },
      editable: true,
      testable: true,
      quota: expect.objectContaining({
        period: "daily",
        timezone: "UTC",
        status: "unlimited",
        enforced: false,
        usedRuns: 0,
        usedTokens: 0,
      }),
      recentTestRuns: [],
    })
    await server.close()
  })

  it("does not expose Studio for connector resources", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/builder/agents/99999999-9999-4999-8999-999999999999/studio",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({
      title: "Agent Studio not found",
    })
    await server.close()
  })

  it("saves an owner-scoped draft Agent Studio", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/studio",
      headers: {
        ...builderHeaders,
        "idempotency-key": "save-agent-studio-1",
      },
      payload: {
        name: "Executive Summary Agent",
        description: "Draft prompt tuned for executive incident summaries.",
        model: "qwen3-35b-local",
        sandboxProfile: "openclaw-restricted",
        systemPrompt: "You summarize operational incidents.",
        instructions: "Return risks, decisions, and next actions.",
        temperature: 0.1,
        maxOutputTokens: 768,
        tools: ["hub.search"],
        sampleInput: "Summarize this outage note for leadership.",
      },
    })
    const resourceResponse = await server.inject({
      method: "GET",
      url: "/api/builder/resources/66666666-6666-4666-8666-666666666666",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      resource: {
        name: "Executive Summary Agent",
        description: "Draft prompt tuned for executive incident summaries.",
      },
      config: {
        systemPrompt: "You summarize operational incidents.",
        tools: ["hub.search"],
      },
    })
    expect(resourceResponse.json()).toMatchObject({
      name: "Executive Summary Agent",
    })
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "builder.agent_studio.update",
        targetType: "builder.agent_configs",
      }),
    ])
    await server.close()
  })

  it("resets an owner-scoped draft Agent Studio config", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const saveResponse = await server.inject({
      method: "POST",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/studio",
      headers: {
        ...builderHeaders,
        "idempotency-key": "save-agent-studio-before-reset",
      },
      payload: {
        name: "Executive Summary Agent",
        description: "Draft prompt tuned for executive incident summaries.",
        model: "qwen-runtime",
        sandboxProfile: "openclaw-tools",
        systemPrompt: "Custom system prompt.",
        instructions: "Custom instructions.",
        temperature: 0.7,
        maxOutputTokens: 2048,
        tools: ["hub.search"],
        sampleInput: "Custom sample input.",
      },
    })
    const resetResponse = await server.inject({
      method: "POST",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/studio/reset",
      headers: {
        ...builderHeaders,
        "idempotency-key": "reset-agent-studio-draft-1",
      },
      payload: {
        confirmation: "RESET",
      },
    })

    expect(saveResponse.statusCode).toBe(200)
    expect(resetResponse.statusCode).toBe(200)
    expect(resetResponse.json()).toMatchObject({
      resource: {
        name: "Executive Summary Agent",
      },
      config: {
        model: "qwen3-35b-local",
        sandboxProfile: "openclaw-restricted",
        systemPrompt:
          "You are a concise summarization agent for appliance-local work context.",
        instructions:
          "Summarize the provided context into the most important facts, decisions, risks, and next actions. Keep the response concise.",
        temperature: 0.2,
        maxOutputTokens: 1024,
        tools: [],
        sampleInput: "Summarize this incident report for an executive.",
      },
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "builder.agent_studio.update",
        }),
        expect.objectContaining({
          action: "builder.agent_studio.draft.reset",
          targetType: "builder.agent_configs",
        }),
      ]),
    )
    await server.close()
  })

  it("clears owner-scoped draft Agent Studio test history", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const testResponse = await server.inject({
      method: "POST",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/test",
      headers: {
        ...builderHeaders,
        "idempotency-key": "test-agent-studio-before-clear",
      },
      payload: {
        input: "Record a test before clearing history.",
      },
    })
    const clearResponse = await server.inject({
      method: "POST",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/test-runs/clear",
      headers: {
        ...builderHeaders,
        "idempotency-key": "clear-agent-studio-test-runs-1",
      },
      payload: {
        confirmation: "CLEAR",
      },
    })

    expect(testResponse.statusCode).toBe(200)
    expect(clearResponse.statusCode).toBe(200)
    expect(clearResponse.json()).toMatchObject({
      recentTestRuns: [],
      quota: expect.objectContaining({
        usedRuns: 0,
        usedTokens: 0,
      }),
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "builder.agent_studio.test",
        }),
        expect.objectContaining({
          action: "builder.agent_studio.test_runs.clear",
          metadata: {
            clearedCount: 1,
          },
        }),
      ]),
    )
    await server.close()
  })

  it("runs draft Agent Studio tests through the local preview fallback", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/test",
      headers: {
        ...builderHeaders,
        "idempotency-key": "test-agent-studio-1",
      },
      payload: {
        input: "Extract the risks from this release note.",
      },
    })

    expect(response.statusCode).toBe(200)
    const result = response.json()
    expect(result).toMatchObject({
      resourceId: "66666666-6666-4666-8666-666666666666",
      input: "Extract the risks from this release note.",
      source: "local_preview",
      status: "succeeded",
      model: "qwen3-35b-local",
      sandboxProfile: "openclaw-restricted",
      finishReason: null,
      runtimeTraceId: expect.any(String),
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      errorDetail: null,
      quota: expect.objectContaining({
        status: "unlimited",
        usedRuns: 1,
        usedTokens: 0,
      }),
    })
    expect(result.durationMs).toEqual(expect.any(Number))
    expect(result.output).toContain("Local Agent Studio preview.")
    const studioResponse = await server.inject({
      method: "GET",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/studio",
      headers: builderHeaders,
    })
    expect(studioResponse.json().recentTestRuns).toEqual([
      expect.objectContaining({
        input: "Extract the risks from this release note.",
        runtimeTraceId: result.runtimeTraceId,
        status: "succeeded",
        source: "local_preview",
        totalTokens: null,
      }),
    ])
    expect(studioResponse.json().quota).toEqual(
      expect.objectContaining({
        status: "unlimited",
        usedRuns: 1,
        usedTokens: 0,
      }),
    )
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "builder.agent_studio.test",
        metadata: expect.objectContaining({
          testRunId: result.id,
          runtimeTraceId: result.runtimeTraceId,
          durationMs: expect.any(Number),
        }),
      }),
    ])
    await server.close()
  })

  it("does not run Agent Studio local preview outside fixture mode", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_ALLOW_HEADER_ONLY_SERVICE_AUTH", "true")
    vi.stubEnv("BFF_REQUIRE_FORWARDED_KEYCLOAK_TOKEN", "false")
    vi.stubEnv("NODE_ENV", "production")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/test",
      headers: {
        ...builderHeaders,
        "idempotency-key": "test-agent-studio-no-fixture",
      },
      payload: {
        input: "This should not use local preview.",
      },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      title: "Agent Studio test failed",
      detail: "OpenClaw runtime is not configured.",
    })
    await server.close()
  })

  it("streams draft Agent Studio test output through SSE", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/test/stream",
      headers: {
        ...builderHeaders,
        "idempotency-key": "test-agent-studio-stream-local",
      },
      payload: {
        input: "Stream a local preview.",
      },
    })
    const events = parseAgentTestEvents(response.body)
    const started = events.find(
      (event) => event.type === "builder.agent_test.started",
    )
    const delta = events.find(
      (event) => event.type === "builder.agent_test.delta",
    )
    const completed = events.find(
      (event) => event.type === "builder.agent_test.completed",
    )
    const studioResponse = await server.inject({
      method: "GET",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/studio",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toContain("text/event-stream")
    expect(started).toMatchObject({
      type: "builder.agent_test.started",
      testRunId: expect.any(String),
      runtimeTraceId: expect.any(String),
    })
    expect(delta).toMatchObject({
      type: "builder.agent_test.delta",
      testRunId:
        started?.type === "builder.agent_test.started"
          ? started.testRunId
          : expect.any(String),
      runtimeTraceId:
        started?.type === "builder.agent_test.started"
          ? started.runtimeTraceId
          : expect.any(String),
      delta: expect.stringContaining("Local Agent Studio preview."),
    })
    expect(completed).toMatchObject({
      type: "builder.agent_test.completed",
      result: expect.objectContaining({
        input: "Stream a local preview.",
        source: "local_preview",
        status: "succeeded",
      }),
    })
    expect(studioResponse.json().recentTestRuns).toEqual([
      expect.objectContaining({
        id:
          completed?.type === "builder.agent_test.completed"
            ? completed.result.id
            : expect.any(String),
        source: "local_preview",
        status: "succeeded",
      }),
    ])
    await server.close()
  })

  it("records runtime-backed Agent Studio accounting metadata", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_OPENCLAW_BASE_URL", "http://openclaw.test")
    vi.stubEnv("AGENTIC_OPENCLAW_MODEL", "qwen-runtime")
    const fetchMock = vi.fn(
      async (..._args: Parameters<typeof fetch>) =>
        new Response(
          JSON.stringify({
            model: "qwen-runtime",
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "Runtime-backed Studio output.",
                },
              },
            ],
            usage: {
              prompt_tokens: 21,
              completion_tokens: 9,
              total_tokens: 30,
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/test",
      headers: {
        ...builderHeaders,
        "idempotency-key": "test-agent-studio-runtime-accounting",
      },
      payload: {
        input: "Exercise the runtime accounting path.",
      },
    })
    const result = response.json()
    const studioResponse = await server.inject({
      method: "GET",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/studio",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(result).toMatchObject({
      output: "Runtime-backed Studio output.",
      source: "agentic_runtime",
      status: "succeeded",
      model: "qwen-runtime",
      finishReason: "stop",
      runtimeTraceId: expect.any(String),
      promptTokens: 21,
      completionTokens: 9,
      totalTokens: 30,
      quota: expect.objectContaining({
        status: "unlimited",
        usedRuns: 1,
        usedTokens: 30,
      }),
    })
    expect(studioResponse.json().recentTestRuns).toEqual([
      expect.objectContaining({
        id: result.id,
        runtimeTraceId: result.runtimeTraceId,
        status: "succeeded",
        source: "agentic_runtime",
        model: "qwen-runtime",
        finishReason: "stop",
        totalTokens: 30,
      }),
    ])
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "builder.agent_studio.test",
        metadata: expect.objectContaining({
          testRunId: result.id,
          runtimeTraceId: result.runtimeTraceId,
          runtimeModel: "qwen-runtime",
          finishReason: "stop",
          totalTokens: 30,
        }),
      }),
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-LLM-Machines-Trace-Id": result.runtimeTraceId,
          "X-Request-Id": result.runtimeTraceId,
        }),
      }),
    )
    await server.close()
  })

  it("streams runtime-backed Agent Studio chunks and preserves accounting", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_OPENCLAW_BASE_URL", "http://openclaw.test")
    vi.stubEnv("AGENTIC_OPENCLAW_MODEL", "qwen-runtime")
    const fetchMock = vi.fn(
      async (..._args: Parameters<typeof fetch>) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              const encoder = new TextEncoder()
              controller.enqueue(
                encoder.encode(
                  [
                    'data: {"model":"qwen-runtime","choices":[{"delta":{"content":"Runtime "},"finish_reason":null}]}',
                    "",
                    'data: {"model":"qwen-runtime","choices":[{"delta":{"content":"stream."},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}',
                    "",
                    "data: [DONE]",
                    "",
                  ].join("\n"),
                ),
              )
              controller.close()
            },
          }),
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/test/stream",
      headers: {
        ...builderHeaders,
        "idempotency-key": "test-agent-studio-stream-runtime",
      },
      payload: {
        input: "Exercise the runtime streaming path.",
      },
    })
    const events = parseAgentTestEvents(response.body)
    const started = events.find(
      (event) => event.type === "builder.agent_test.started",
    )
    const completed = events.find(
      (event) => event.type === "builder.agent_test.completed",
    )

    expect(response.statusCode).toBe(200)
    expect(events.map((event) => event.type)).toEqual([
      "builder.agent_test.started",
      "builder.agent_test.delta",
      "builder.agent_test.delta",
      "builder.agent_test.completed",
    ])
    expect(completed).toMatchObject({
      type: "builder.agent_test.completed",
      result: expect.objectContaining({
        output: "Runtime stream.",
        source: "agentic_runtime",
        model: "qwen-runtime",
        finishReason: "stop",
        promptTokens: 7,
        completionTokens: 3,
        totalTokens: 10,
      }),
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-LLM-Machines-Trace-Id":
            started?.type === "builder.agent_test.started"
              ? started.runtimeTraceId
              : expect.any(String),
          "X-Request-Id":
            started?.type === "builder.agent_test.started"
              ? started.runtimeTraceId
              : expect.any(String),
        }),
      }),
    )
    await server.close()
  })

  it("captures runtime tool-call events in Agent Studio streams", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_OPENCLAW_BASE_URL", "http://openclaw.test")
    vi.stubEnv("AGENTIC_OPENCLAW_MODEL", "qwen-runtime")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                const encoder = new TextEncoder()
                controller.enqueue(
                  encoder.encode(
                    [
                      'data: {"model":"qwen-runtime","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"hub.search","arguments":"query="}}]},"finish_reason":null}]}',
                      "",
                      'data: {"model":"qwen-runtime","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"incident"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":8,"completion_tokens":4,"total_tokens":12}}',
                      "",
                      "data: [DONE]",
                      "",
                    ].join("\n"),
                  ),
                )
                controller.close()
              },
            }),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          ),
      ),
    )
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/test/stream",
      headers: {
        ...builderHeaders,
        "idempotency-key": "test-agent-studio-stream-tool-calls",
      },
      payload: {
        input: "Exercise the runtime tool-call path.",
      },
    })
    const events = parseAgentTestEvents(response.body)
    const toolCallEvents = events.filter(
      (event) => event.type === "builder.agent_test.tool_call",
    )
    const completed = events.find(
      (event) => event.type === "builder.agent_test.completed",
    )
    const studioResponse = await server.inject({
      method: "GET",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/studio",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(toolCallEvents).toHaveLength(2)
    expect(toolCallEvents[0]).toMatchObject({
      type: "builder.agent_test.tool_call",
      toolCall: {
        id: "call_1",
        index: 0,
        name: "hub.search",
        argumentsPreview: "query=",
      },
    })
    expect(completed).toMatchObject({
      type: "builder.agent_test.completed",
      result: expect.objectContaining({
        output: expect.stringContaining("Runtime requested tool calls."),
        finishReason: "tool_calls",
        totalTokens: 12,
        toolCalls: [
          expect.objectContaining({
            id: "call_1",
            index: 0,
            name: "hub.search",
            argumentsPreview: "query=incident",
          }),
        ],
      }),
    })
    expect(studioResponse.json().recentTestRuns).toEqual([
      expect.objectContaining({
        toolCalls: [
          expect.objectContaining({
            name: "hub.search",
          }),
        ],
      }),
    ])
    await server.close()
  })

  it("reports and enforces configured daily Agent Studio run quota", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BUILDER_AGENT_STUDIO_DAILY_RUN_LIMIT", "1")
    const server = buildServer()

    const initialStudioResponse = await server.inject({
      method: "GET",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/studio",
      headers: builderHeaders,
    })
    const firstRunResponse = await server.inject({
      method: "POST",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/test",
      headers: {
        ...builderHeaders,
        "idempotency-key": "test-agent-studio-quota-1",
      },
      payload: {
        input: "Consume the configured run quota.",
      },
    })
    const blockedRunResponse = await server.inject({
      method: "POST",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/test",
      headers: {
        ...builderHeaders,
        "idempotency-key": "test-agent-studio-quota-2",
      },
      payload: {
        input: "This run should be blocked by quota.",
      },
    })

    expect(initialStudioResponse.json().quota).toEqual(
      expect.objectContaining({
        status: "ok",
        enforced: true,
        usedRuns: 0,
        runLimit: 1,
        remainingRuns: 1,
      }),
    )
    expect(firstRunResponse.statusCode).toBe(200)
    expect(firstRunResponse.json().quota).toEqual(
      expect.objectContaining({
        status: "exhausted",
        enforced: true,
        usedRuns: 1,
        runLimit: 1,
        remainingRuns: 0,
      }),
    )
    expect(blockedRunResponse.statusCode).toBe(429)
    expect(blockedRunResponse.json()).toMatchObject({
      title: "Agent Studio quota reached",
      detail: expect.stringContaining("Daily Agent Studio test-run quota"),
      quota: expect.objectContaining({
        status: "exhausted",
        usedRuns: 1,
        remainingRuns: 0,
      }),
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "builder.agent_studio.test",
        }),
        expect.objectContaining({
          action: "builder.agent_studio.test_blocked",
          reason: expect.stringContaining("Daily Agent Studio test-run quota"),
        }),
      ]),
    )
    await server.close()
  })

  it("records failed runtime-backed Agent Studio diagnostics", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_OPENCLAW_BASE_URL", "http://openclaw.test")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("runtime offline", { status: 503 })),
    )
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/test",
      headers: {
        ...builderHeaders,
        "idempotency-key": "test-agent-studio-runtime-failure",
      },
      payload: {
        input: "Exercise the runtime failure path.",
      },
    })
    const studioResponse = await server.inject({
      method: "GET",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/studio",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(503)
    const failure = response.json()
    expect(response.json()).toMatchObject({
      title: "Agent Studio test failed",
      testRunId: expect.any(String),
      runtimeTraceId: expect.any(String),
    })
    expect(studioResponse.json().recentTestRuns).toEqual([
      expect.objectContaining({
        id: failure.testRunId,
        runtimeTraceId: failure.runtimeTraceId,
        input: "Exercise the runtime failure path.",
        output: null,
        status: "failed",
        source: "agentic_runtime",
        finishReason: null,
        totalTokens: null,
        errorDetail: expect.stringContaining("OpenClaw returned HTTP 503"),
      }),
    ])
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "builder.agent_studio.test_failed",
        metadata: expect.objectContaining({
          testRunId: failure.testRunId,
          runtimeTraceId: failure.runtimeTraceId,
          source: "agentic_runtime",
        }),
      }),
    ])
    await server.close()
  })

  it("explains runtime responses that exhaust tokens before visible output", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("AGENTIC_OPENCLAW_BASE_URL", "http://openclaw.test")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "length",
                  message: {
                    role: "assistant",
                    content: "",
                    reasoning_content: "Internal reasoning omitted.",
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
      ),
    )
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/test",
      headers: {
        ...builderHeaders,
        "idempotency-key": "test-agent-studio-token-exhaustion",
      },
      payload: {
        input: "Exercise the token exhaustion path.",
      },
    })
    const studioResponse = await server.inject({
      method: "GET",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/studio",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(503)
    const failure = response.json()
    expect(response.json()).toMatchObject({
      title: "Agent Studio test failed",
      detail: expect.stringContaining("reached max_tokens"),
      testRunId: expect.any(String),
      runtimeTraceId: expect.any(String),
    })
    expect(studioResponse.json().recentTestRuns).toEqual([
      expect.objectContaining({
        id: failure.testRunId,
        runtimeTraceId: failure.runtimeTraceId,
        input: "Exercise the token exhaustion path.",
        output: null,
        status: "failed",
        source: "agentic_runtime",
        finishReason: "length",
        errorDetail: expect.stringContaining("Increase max output tokens"),
      }),
    ])
    await server.close()
  })

  it("blocks admins from editing builder-owned draft Studio config", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/studio",
      headers: {
        ...adminHeaders,
        "idempotency-key": "save-agent-studio-admin-denied",
      },
      payload: {
        name: "Admin Edited Agent",
        description: "This edit should not land.",
        model: "qwen3-35b-local",
        sandboxProfile: "openclaw-restricted",
        systemPrompt: "You summarize operational incidents.",
        instructions: "Return risks, decisions, and next actions.",
        temperature: 0.1,
        maxOutputTokens: 768,
        tools: [],
        sampleInput: "Summarize this outage note for leadership.",
      },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({
      detail:
        "Agent Studio is only editable by the owning Builder while the agent is a draft.",
    })
    await server.close()
  })

  it("requires idempotency keys for template forks", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/builder/templates/template-summary-agent/fork",
      headers: builderHeaders,
      payload: {},
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      title: "Idempotency key is required",
    })
    await server.close()
  })

  it("forks a template into an owner-scoped draft", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/builder/templates/template-summary-agent/fork",
      headers: {
        ...builderHeaders,
        "idempotency-key": "fork-template-1",
      },
      payload: {
        name: "Executive Summary Agent",
      },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      name: "Executive Summary Agent",
      ownerId: "builder-1",
      state: "draft",
      templateId: "template-summary-agent",
    })
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "builder.template.fork",
        targetType: "builder.resources",
      }),
    ])
    await server.close()
  })

  it("cuts a version and submits a draft resource", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const lifecycleEvents: unknown[] = []
    const unsubscribe = subscribeHubEvents(
      {
        subject: "builder-1",
        email: "builder@example.test",
        persona: "builder",
        roles: ["builder"],
        authMode: "service-forwarded",
      },
      (event) => lifecycleEvents.push(event),
    )

    const versionResponse = await server.inject({
      method: "POST",
      url: "/api/builder/resources/66666666-6666-4666-8666-666666666666/versions",
      headers: {
        ...builderHeaders,
        "idempotency-key": "cut-version-1",
      },
      payload: {
        semver: "v0.2",
      },
    })
    const submitResponse = await server.inject({
      method: "POST",
      url: "/api/builder/resources/66666666-6666-4666-8666-666666666666/submit",
      headers: {
        ...builderHeaders,
        "idempotency-key": "submit-resource-1",
      },
    })

    expect(versionResponse.statusCode).toBe(201)
    expect(versionResponse.json()).toMatchObject({
      currentVersion: {
        semver: "v0.2",
      },
    })
    expect(submitResponse.statusCode).toBe(201)
    expect(submitResponse.json()).toMatchObject({
      resourceName: "Summary Agent",
      state: "submitted",
      submittedVersion: "v0.2",
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "builder.resource.version_cut",
        }),
        expect.objectContaining({
          action: "builder.resource.submit",
        }),
      ]),
    )
    expect(lifecycleEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "resource.lifecycle",
          payload: expect.objectContaining({
            transition: "version_cut",
          }),
        }),
        expect.objectContaining({
          type: "resource.lifecycle",
          payload: expect.objectContaining({
            transition: "submitted",
          }),
        }),
      ]),
    )
    unsubscribe()
    await server.close()
  })

  it("lets admins approve submitted builder resources", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/resources/99999999-9999-4999-8999-999999999999/approve",
      headers: {
        ...adminHeaders,
        "idempotency-key": "approve-resource-1",
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      resourceName: "Internal Docs Corpus",
      state: "published",
    })
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "admin.builder_resource.approve",
      }),
    ])
    await server.close()
  })

  it("lets builders withdraw their own submitted resources", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const lifecycleEvents: unknown[] = []
    const unsubscribe = subscribeHubEvents(
      {
        subject: "builder-1",
        email: "builder@example.test",
        persona: "builder",
        roles: ["builder"],
        authMode: "service-forwarded",
      },
      (event) => lifecycleEvents.push(event),
    )

    const response = await server.inject({
      method: "POST",
      url: "/api/builder/resources/99999999-9999-4999-8999-999999999999/withdraw",
      headers: {
        ...builderHeaders,
        "idempotency-key": "withdraw-resource-1",
      },
    })
    const resourceResponse = await server.inject({
      method: "GET",
      url: "/api/builder/resources/99999999-9999-4999-8999-999999999999",
      headers: builderHeaders,
    })
    const builderNotificationsResponse = await server.inject({
      method: "GET",
      url: "/api/hub/notifications",
      headers: builderHeaders,
    })
    const adminNotificationsResponse = await server.inject({
      method: "GET",
      url: "/api/hub/notifications",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      resourceName: "Internal Docs Corpus",
      state: "withdrawn",
      decidedAt: expect.any(String),
    })
    expect(resourceResponse.json()).toMatchObject({
      state: "draft",
    })
    expect(builderNotificationsResponse.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "builder",
          title: "Internal Docs Corpus returned to draft",
        }),
      ]),
    )
    expect(adminNotificationsResponse.json()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Internal Docs Corpus is awaiting review",
        }),
      ]),
    )
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "builder.resource.withdraw_submission",
      }),
    ])
    expect(lifecycleEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "resource.lifecycle",
          payload: expect.objectContaining({
            state: "draft",
            transition: "withdrawn",
            submission: expect.objectContaining({
              state: "withdrawn",
            }),
          }),
        }),
      ]),
    )
    unsubscribe()
    await server.close()
  })

  it("does not let admins withdraw builder-owned submissions", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/builder/resources/99999999-9999-4999-8999-999999999999/withdraw",
      headers: {
        ...adminHeaders,
        "idempotency-key": "withdraw-admin-denied",
      },
    })
    const resourceResponse = await server.inject({
      method: "GET",
      url: "/api/builder/resources/99999999-9999-4999-8999-999999999999",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({
      detail: "Resource is not pending withdrawal by this Builder.",
    })
    expect(resourceResponse.json()).toMatchObject({
      state: "submitted",
    })
    await server.close()
  })

  it("requires admin rejection comments and returns submitted resources to draft", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const missingComment = await server.inject({
      method: "POST",
      url: "/api/admin/resources/99999999-9999-4999-8999-999999999999/reject",
      headers: {
        ...adminHeaders,
        "idempotency-key": "reject-resource-missing-comment",
      },
      payload: {},
    })
    const response = await server.inject({
      method: "POST",
      url: "/api/admin/resources/99999999-9999-4999-8999-999999999999/reject",
      headers: {
        ...adminHeaders,
        "idempotency-key": "reject-resource-1",
      },
      payload: {
        comment: "Add scoped egress proof before publishing.",
      },
    })
    const resourceResponse = await server.inject({
      method: "GET",
      url: "/api/builder/resources/99999999-9999-4999-8999-999999999999",
      headers: builderHeaders,
    })

    expect(missingComment.statusCode).toBe(400)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      resourceName: "Internal Docs Corpus",
      state: "rejected",
      adminComment: "Add scoped egress proof before publishing.",
    })
    expect(resourceResponse.json()).toMatchObject({
      state: "draft",
    })
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "admin.builder_resource.reject",
        reason: "Add scoped egress proof before publishing.",
      }),
    ])
    await server.close()
  })
})

async function createKnowledgeCorpus(
  server: ReturnType<typeof buildServer>,
  input: {
    accessGroups?: string[]
    name: string
  },
) {
  const response = await server.inject({
    method: "POST",
    url: "/api/admin/knowledge/corpora",
    headers: {
      ...adminHeaders,
      "idempotency-key": `knowledge-create-${input.name}`,
    },
    payload: {
      accessGroups: input.accessGroups ?? [],
      name: input.name,
    },
  })
  expect(response.statusCode).toBe(201)
  return response.json().corpus.id as string
}

async function createPublishedKnowledgeCorpus(
  server: ReturnType<typeof buildServer>,
  input: {
    accessGroups?: string[]
    name: string
  },
) {
  const corpusId = await createKnowledgeCorpus(server, input)
  const uploadResponse = await server.inject({
    method: "POST",
    url: `/api/admin/knowledge/corpora/${corpusId}/sources/upload`,
    headers: {
      ...adminHeaders,
      "idempotency-key": `knowledge-upload-${input.name}`,
    },
    payload: {
      contentBase64: Buffer.from(`${input.name} searchable source`).toString(
        "base64",
      ),
      fileName: `${input.name}.txt`,
      mimeType: "text/plain",
    },
  })
  expect(uploadResponse.statusCode).toBe(200)
  const ingestResponse = await server.inject({
    method: "POST",
    url: `/api/admin/knowledge/corpora/${corpusId}/ingest`,
    headers: {
      ...adminHeaders,
      "idempotency-key": `knowledge-ingest-${input.name}`,
    },
  })
  expect(ingestResponse.statusCode).toBe(200)
  const snapshotId = ingestResponse.json().snapshot.id as string
  const publishResponse = await server.inject({
    method: "POST",
    url: `/api/admin/knowledge/corpora/${corpusId}/snapshots/${snapshotId}/publish`,
    headers: {
      ...adminHeaders,
      "idempotency-key": `knowledge-publish-${input.name}`,
    },
  })
  expect(publishResponse.statusCode).toBe(200)
  return corpusId
}
