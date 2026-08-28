import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"

const adminHeaders = {
  authorization: "Bearer test-service-key",
  "x-llm-machines-keycloak-token": "",
  "x-llm-machines-user-sub": "admin-1",
  "x-llm-machines-user-email": "admin@example.test",
  "x-llm-machines-user-roles": "admin",
}

const operatorHeaders = {
  ...adminHeaders,
  "x-llm-machines-user-sub": "operator-1",
  "x-llm-machines-user-email": "operator@example.test",
  "x-llm-machines-user-roles": "operator",
}

const unclassifiedHeaders = {
  ...adminHeaders,
  "x-llm-machines-user-sub": "unclassified-1",
  "x-llm-machines-user-email": "unclassified@example.test",
  "x-llm-machines-user-roles": "unclassified",
}

describe("Admin Inference routes", () => {
  beforeEach(() => {
    vi.stubEnv("BFF_FALLBACK_MODELS", "qwen3-35b-local,gemma4")
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it("returns LiteLLM-backed data without exposing a native admin link", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("ADMIN_LITELLM_BASE_URL", "http://litellm.test")
    vi.stubEnv("ADMIN_LITELLM_API_KEY", "litellm-key")
    vi.stubEnv("LITELLM_PUBLIC_URL", "https://litellm.example")
    vi.spyOn(globalThis, "fetch").mockImplementation(mockLiteLlmFetch)
    const server = buildServer()

    const response = await server.inject({
      headers: adminHeaders,
      method: "GET",
      url: "/api/admin/inference",
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body).toMatchObject({
      liteLlmUrl: null,
      modelUsage: [
        expect.objectContaining({
          model: "qwen3-35b-local",
          requests: 10,
          tokens: 1600,
        }),
        expect.objectContaining({
          model: "gemma4",
          requests: 2,
          tokens: 200,
        }),
      ],
      models: [
        expect.objectContaining({
          name: "qwen3-35b-local",
          provider: "llama.cpp",
        }),
        expect.objectContaining({
          name: "gemma4",
        }),
      ],
      range: "30d",
      sourceStatus: "ok",
      totals: {
        requests: 12,
        tokens: 1800,
      },
      virtualKeys: [
        expect.objectContaining({
          alias: "design-workstation",
          id: expect.stringMatching(/^litellm-vk-[0-9a-f]{64}$/),
          status: "active",
        }),
      ],
    })
    expect(body.modelUsage.map((row: { model: string }) => row.model)).toEqual([
      "qwen3-35b-local",
      "gemma4",
    ])
    const serialized = response.body
    expect(serialized).not.toContain("litellm-key")
    expect(serialized).not.toContain("provider-secret")
    expect(serialized).not.toContain("sk-virtual-secret")
    expect(serialized).not.toContain("secret prompt")
    expect(serialized).not.toContain("completion text")
    await server.close()
  })

  it("allows classified dashboard readers and hides native access from Operators", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const unauthenticated = await server.inject({
      method: "GET",
      url: "/api/admin/inference",
    })
    const unclassified = await server.inject({
      headers: unclassifiedHeaders,
      method: "GET",
      url: "/api/admin/inference",
    })
    const operator = await server.inject({
      headers: operatorHeaders,
      method: "GET",
      url: "/api/admin/inference",
    })

    expect(unauthenticated.statusCode).toBe(401)
    expect(unclassified.statusCode).toBe(401)
    expect(operator.statusCode).toBe(200)
    expect(operator.json()).toMatchObject({ liteLlmUrl: null })
    await server.close()
  })

  it("passes selected range dates to LiteLLM", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-30T12:00:00.000Z"))
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("ADMIN_LITELLM_BASE_URL", "http://litellm.test")
    vi.stubEnv("ADMIN_LITELLM_API_KEY", "litellm-key")
    const requestedUrls: string[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      requestedUrls.push(input.toString())
      return mockLiteLlmFetch(input)
    })
    const server = buildServer()

    const response = await server.inject({
      headers: adminHeaders,
      method: "GET",
      url: "/api/admin/inference?range=7d",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ range: "7d" })
    const activityUrl = new URL(
      requestedUrls.find((url) =>
        url.includes("/user/daily/activity/aggregated"),
      ) ?? "",
    )
    expect(activityUrl.searchParams.get("start_date")).toBe("2026-05-23")
    expect(activityUrl.searchParams.get("end_date")).toBe("2026-05-30")
    await server.close()
  })

  it("retrieves all paginated LiteLLM virtual keys", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("ADMIN_LITELLM_BASE_URL", "http://litellm.test")
    vi.stubEnv("ADMIN_LITELLM_API_KEY", "litellm-key")
    const requestedKeyPages: string[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(input.toString())
      if (url.pathname === "/key/list") {
        expect(url.searchParams.get("include_team_keys")).toBe("true")
        expect(url.searchParams.get("return_full_object")).toBe("true")
        const page = Number(url.searchParams.get("page") ?? "1")
        requestedKeyPages.push(String(page))
        const rowCount = page === 1 ? 100 : 1
        return jsonResponse({
          current_page: page,
          keys: Array.from({ length: rowCount }, (_, index) => ({
            blocked: false,
            key_alias: `runtime-${page}-${index + 1}`,
            models: ["qwen3-35b-local"],
            token: `upstream-token-${page}-${index + 1}`,
          })),
          total_count: 101,
          total_pages: 2,
        })
      }
      return mockLiteLlmFetch(input)
    })
    const server = buildServer()

    const response = await server.inject({
      headers: adminHeaders,
      method: "GET",
      url: "/api/admin/inference",
    })

    expect(response.statusCode).toBe(200)
    const virtualKeys = response.json().virtualKeys
    expect(virtualKeys).toHaveLength(101)
    expect(virtualKeys[0]).toMatchObject({
      alias: "runtime-1-1",
      id: expect.stringMatching(/^litellm-vk-[0-9a-f]{64}$/),
    })
    expect(virtualKeys[100]).toMatchObject({
      alias: "runtime-2-1",
      id: expect.stringMatching(/^litellm-vk-[0-9a-f]{64}$/),
    })
    expect(response.body).not.toContain("upstream-token-")
    expect(requestedKeyPages).toEqual(["1", "2"])
    await server.close()
  })

  it("returns a controlled not-configured dashboard when LiteLLM is absent", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const server = buildServer()

    const response = await server.inject({
      headers: adminHeaders,
      method: "GET",
      url: "/api/admin/inference?range=90d",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      aggregateUsageSourceStatus: "not_configured",
      modelInventorySourceStatus: "not_configured",
      modelUsage: [],
      models: [],
      range: "90d",
      sourceStatus: "not_configured",
      totals: null,
      usagePoints: [],
      virtualKeys: [],
      virtualKeysSourceStatus: "not_configured",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    await server.close()
  })

  it("degrades individual LiteLLM sections without failing the dashboard", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("ADMIN_LITELLM_BASE_URL", "http://litellm.test")
    vi.stubEnv("ADMIN_LITELLM_API_KEY", "litellm-key")
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(input.toString())
      if (url.pathname === "/user/daily/activity/aggregated") {
        return jsonResponse(activityPayload())
      }
      return jsonResponse({ error: "unavailable" }, 500)
    })
    const server = buildServer()

    const response = await server.inject({
      headers: adminHeaders,
      method: "GET",
      url: "/api/admin/inference",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      aggregateUsageSourceStatus: "ok",
      modelInventorySourceStatus: "unavailable",
      modelUsage: expect.arrayContaining([
        expect.objectContaining({
          model: "qwen3-35b-local",
          requests: 10,
        }),
      ]),
      models: [],
      sourceStatus: "degraded",
      virtualKeys: [],
      virtualKeysSourceStatus: "unavailable",
    })
    await server.close()
  })

  it("does not expose the simulated model-update mutation", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      body: { confirmation: "UPDATE MODEL" },
      headers: {
        ...adminHeaders,
        "idempotency-key": "removed-model-update",
      },
      method: "POST",
      url: "/api/admin/inference/model-updates/apply",
    })

    expect(response.statusCode).toBe(404)
    await server.close()
  })
})

async function mockLiteLlmFetch(
  input: string | URL | Request,
): Promise<Response> {
  const url = new URL(input.toString())
  if (url.pathname === "/user/daily/activity/aggregated") {
    return jsonResponse(activityPayload())
  }
  if (url.pathname === "/spend/logs/v2") {
    return jsonResponse({
      data: [
        {
          completion: "completion text",
          model: "qwen3-35b-local",
          prompt: "secret prompt",
          response_cost: 0.01,
          startTime: "2026-05-30T11:59:00.000Z",
          total_tokens: 300,
          user: "demo-admin",
        },
        {
          model: "qwen3-35b-local",
          response_cost: 0.02,
          startTime: "2026-05-30T11:58:00.000Z",
          total_tokens: 500,
          user: "app-user",
        },
        {
          model: "openai/gemma4",
          model_group: "gemma4",
          response_cost: 0.005,
          startTime: "2026-05-30T11:50:00.000Z",
          total_tokens: 50,
          user: "demo-admin",
        },
      ],
    })
  }
  if (url.pathname === "/model/info") {
    return jsonResponse({
      data: [
        {
          litellm_params: {
            api_key: "provider-secret",
            model: "llama.cpp/qwen3-35b-local",
          },
          model_info: {
            id: "model-qwen",
            litellm_provider: "llama.cpp",
            max_input_tokens: 32768,
            mode: "chat",
            output_cost_per_token: 0,
          },
          model_name: "qwen3-35b-local",
        },
        {
          litellm_params: {
            model: "llama.cpp/gemma4",
          },
          model_info: {
            id: "model-gemma",
            litellm_provider: "llama.cpp",
            mode: "chat",
          },
          model_name: "gemma4",
        },
      ],
    })
  }
  if (url.pathname === "/key/list") {
    return jsonResponse({
      current_page: 1,
      keys: [
        {
          blocked: false,
          key_alias: "design-workstation",
          max_budget: 100,
          models: ["qwen3-35b-local"],
          spend: 4.25,
          token: "sk-virtual-secret",
          user_id: "design-workstation",
        },
      ],
      total_count: 1,
      total_pages: 1,
    })
  }
  return jsonResponse({ error: "unexpected" }, 500)
}

function activityPayload() {
  return {
    metadata: {
      total_api_requests: 12,
      total_tokens: 1800,
    },
    results: [
      {
        breakdown: {
          model_groups: {
            gemma4: {
              metrics: {
                api_requests: 2,
                total_tokens: 200,
              },
            },
            "qwen3-35b-local": {
              metrics: {
                api_requests: 10,
                total_tokens: 1600,
              },
            },
          },
        },
        date: "2026-05-30",
        metrics: {
          api_requests: 12,
          total_tokens: 1800,
        },
      },
    ],
  }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json",
    },
    status,
  })
}
