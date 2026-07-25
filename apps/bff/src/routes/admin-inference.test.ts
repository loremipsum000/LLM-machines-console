import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import {
  getAuditEventsForTest,
  resetAuditEventsForTest,
} from "../services/audit"

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

describe("Admin Inference routes", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.useRealTimers()
    resetAuditEventsForTest()
  })

  it("returns LiteLLM-backed dashboard data without leaking secrets or raw prompts", async () => {
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
      liteLlmUrl: "https://litellm.example/ui/",
      modelUpdate: null,
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
          alias: "agentic-openclaw",
          id: "hash-openclaw",
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

  it("enforces Admin-only access for Inference dashboard reads", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const unauthenticated = await server.inject({
      method: "GET",
      url: "/api/admin/inference",
    })
    const builder = await server.inject({
      headers: builderHeaders,
      method: "GET",
      url: "/api/admin/inference",
    })

    expect(unauthenticated.statusCode).toBe(401)
    expect(builder.statusCode).toBe(403)
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
        requestedKeyPages.push(url.searchParams.get("page") ?? "")
        return jsonResponse({
          current_page: Number(url.searchParams.get("page") ?? "1"),
          keys: [
            {
              key_alias: `runtime-${url.searchParams.get("page")}`,
              key_hash: `hash-${url.searchParams.get("page")}`,
              models: ["qwen3-35b-local"],
              status: "active",
              user_id: `owner-${url.searchParams.get("page")}`,
            },
          ],
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
    expect(response.json()).toMatchObject({
      virtualKeys: [
        expect.objectContaining({ alias: "runtime-1", id: "hash-1" }),
        expect.objectContaining({ alias: "runtime-2", id: "hash-2" }),
      ],
    })
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
      modelUpdate: null,
      modelUsage: [],
      models: [],
      range: "90d",
      sourceStatus: "not_configured",
      totals: {
        requests: 0,
        tokens: 0,
      },
      usagePoints: [],
      virtualKeys: [],
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    await server.close()
  })

  it("surfaces an available model update in the dashboard", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("INFERENCE_MODEL_UPDATE_STATUS", "available")
    vi.stubEnv("INFERENCE_MODEL_UPDATE_ACTION_ENABLED", "true")
    vi.stubEnv("INFERENCE_MODEL_UPDATE_CURRENT_VERSION", "2026.05.01")
    vi.stubEnv("INFERENCE_MODEL_UPDATE_AVAILABLE_VERSION", "2026.05.30")
    vi.stubEnv("INFERENCE_MODEL_UPDATE_AFFECTED_MODELS", "qwen3-35b-local")
    const server = buildServer()

    const response = await server.inject({
      headers: adminHeaders,
      method: "GET",
      url: "/api/admin/inference",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      modelUpdate: {
        affectedModels: ["qwen3-35b-local"],
        availableVersion: "2026.05.30",
        currentVersion: "2026.05.01",
        status: "available",
        updateActionEnabled: true,
      },
    })
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
      modelUsage: expect.arrayContaining([
        expect.objectContaining({
          model: "qwen3-35b-local",
          requests: 10,
        }),
      ]),
      models: expect.arrayContaining([
        expect.objectContaining({
          name: "qwen3-35b-local",
          sourceStatus: "degraded",
        }),
      ]),
      sourceStatus: "degraded",
      virtualKeys: [],
    })
    await server.close()
  })

  it("rejects model update apply without exact confirmation", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      body: {
        confirmation: "UPDATE",
      },
      headers: {
        ...adminHeaders,
        "idempotency-key": "bad-confirmation",
      },
      method: "POST",
      url: "/api/admin/inference/model-updates/apply",
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      title: "Invalid model update request",
    })
    await server.close()
  })

  it("enforces Admin-only access for model update apply", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const unauthenticated = await server.inject({
      body: {
        confirmation: "UPDATE MODEL",
      },
      headers: {
        "idempotency-key": "unauthenticated-update",
      },
      method: "POST",
      url: "/api/admin/inference/model-updates/apply",
    })
    const builder = await server.inject({
      body: {
        confirmation: "UPDATE MODEL",
      },
      headers: {
        ...builderHeaders,
        "idempotency-key": "builder-update",
      },
      method: "POST",
      url: "/api/admin/inference/model-updates/apply",
    })

    expect(unauthenticated.statusCode).toBe(401)
    expect(builder.statusCode).toBe(403)
    await server.close()
  })

  it("applies a configured model update and emits started/completed audit events", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("INFERENCE_MODEL_UPDATE_STATUS", "available")
    vi.stubEnv("INFERENCE_MODEL_UPDATE_ACTION_ENABLED", "true")
    vi.stubEnv("INFERENCE_MODEL_UPDATE_CURRENT_VERSION", "2026.05.01")
    vi.stubEnv("INFERENCE_MODEL_UPDATE_AVAILABLE_VERSION", "2026.05.30")
    vi.stubEnv("INFERENCE_MODEL_UPDATE_AFFECTED_MODELS", "qwen3-35b-local")
    const server = buildServer()

    const response = await server.inject({
      body: {
        confirmation: "UPDATE MODEL",
      },
      headers: {
        ...adminHeaders,
        "idempotency-key": "model-update-success",
      },
      method: "POST",
      url: "/api/admin/inference/model-updates/apply",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      modelUpdate: null,
      status: "completed",
    })
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "admin.inference.model_update.started",
        actorId: "admin-1",
      }),
      expect.objectContaining({
        action: "admin.inference.model_update.completed",
        actorId: "admin-1",
      }),
    ])
    await server.close()
  })

  it("returns controlled failure and audit evidence when adapter fails", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("INFERENCE_MODEL_UPDATE_STATUS", "available")
    vi.stubEnv("INFERENCE_MODEL_UPDATE_ACTION_ENABLED", "true")
    vi.stubEnv("INFERENCE_MODEL_UPDATE_APPLY_RESULT", "failed")
    vi.stubEnv("INFERENCE_MODEL_UPDATE_CURRENT_VERSION", "2026.05.01")
    vi.stubEnv("INFERENCE_MODEL_UPDATE_AVAILABLE_VERSION", "2026.05.30")
    const server = buildServer()

    const response = await server.inject({
      body: {
        confirmation: "UPDATE MODEL",
      },
      headers: {
        ...adminHeaders,
        "idempotency-key": "model-update-failed",
      },
      method: "POST",
      url: "/api/admin/inference/model-updates/apply",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      modelUpdate: {
        status: "failed",
        updateActionEnabled: false,
      },
      status: "failed",
    })
    expect(response.body.toLowerCase()).not.toContain("command")
    expect(response.body.toLowerCase()).not.toContain("secret")
    expect(getAuditEventsForTest().map((event) => event.action)).toEqual([
      "admin.inference.model_update.started",
      "admin.inference.model_update.failed",
    ])
    await server.close()
  })

  it("blocks unconfigured model update apply without backend details", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("INFERENCE_MODEL_UPDATE_STATUS", "available")
    vi.stubEnv("INFERENCE_MODEL_UPDATE_ACTION_ENABLED", "false")
    const server = buildServer()

    const response = await server.inject({
      body: {
        confirmation: "UPDATE MODEL",
      },
      headers: {
        ...adminHeaders,
        "idempotency-key": "model-update-blocked",
      },
      method: "POST",
      url: "/api/admin/inference/model-updates/apply",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      modelUpdate: {
        status: "available",
        updateActionEnabled: false,
      },
      status: "blocked",
    })
    expect(response.body.toLowerCase()).not.toContain("command")
    expect(response.body.toLowerCase()).not.toContain("secret")
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "admin.inference.model_update.blocked",
      }),
    ])
    await server.close()
  })
})

async function mockLiteLlmFetch(input: string | URL | Request): Promise<Response> {
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
          user: "demo-builder",
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
      keys: [
        {
          key_alias: "agentic-openclaw",
          key_hash: "hash-openclaw",
          max_budget: 100,
          models: ["qwen3-35b-local"],
          spend: 4.25,
          status: "active",
          token: "sk-virtual-secret",
          user_id: "openclaw",
        },
      ],
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
