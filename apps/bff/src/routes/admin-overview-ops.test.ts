import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import { resetAuditEventsForTest } from "../services/audit"

const adminHeaders = {
  authorization: "Bearer test-service-key",
  "x-llm-machines-keycloak-token": "",
  "x-llm-machines-user-sub": "admin-1",
  "x-llm-machines-user-email": "admin@example.test",
  "x-llm-machines-user-roles": "admin",
}

describe("Admin overview LiteLLM ops federation", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetAuditEventsForTest()
  })

  it("federates Admin overview ops from LiteLLM when configured", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("ADMIN_LITELLM_BASE_URL", "http://litellm.test")
    vi.stubEnv("ADMIN_LITELLM_API_KEY", "litellm-key")
    vi.stubEnv("BFF_FALLBACK_MODELS", "qwen3-35b-local,gemma4")
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(input.toString())
      if (url.pathname === "/user/daily/activity/aggregated") {
        return jsonResponse({
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
                      total_tokens: 1600,
                    },
                  },
                  gemma4: {
                    metrics: {
                      api_requests: 2,
                      total_tokens: 200,
                    },
                  },
                },
              },
            },
          ],
        })
      }
      if (url.pathname === "/spend/logs/v2") {
        return jsonResponse({
          data: [
            {
              request_duration_ms: 500,
              status: "success",
              user: "demo-admin",
            },
            {
              request_duration_ms: 1800,
              status: "success",
              user: "app-user",
            },
            {
              request_duration_ms: 5500,
              status: "success",
              user: "demo-admin",
            },
          ],
        })
      }
      if (url.pathname === "/model/info") {
        return jsonResponse({
          data: [
            { model_info: { id: "model-1" }, model_name: "qwen3-35b-local" },
            { model_info: { id: "model-2" }, model_name: "gemma4" },
          ],
        })
      }
      if (url.pathname === "/key/list") {
        return jsonResponse({
          current_page: 1,
          keys: [],
          total_count: 0,
          total_pages: 0,
        })
      }
      return new Response("{}", { status: 500 })
    })
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/overview",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(opsTile(response.json())).toMatchObject({
      href: "/inference",
      sourceStatus: "ok",
      summary: "LiteLLM reports 12 requests and 1,800 tokens in the last 90d.",
      metrics: expect.arrayContaining([
        expect.objectContaining({
          id: "requests",
          value: "12",
        }),
        expect.objectContaining({
          id: "tokens",
          value: "1,800",
        }),
        expect.objectContaining({
          id: "top-model",
          value: "qwen3-35b-local",
        }),
        expect.objectContaining({
          id: "models",
          value: "2",
        }),
      ]),
    })
    await server.close()
  })

  it("marks Admin overview ops unavailable when LiteLLM cannot be read", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("ADMIN_LITELLM_BASE_URL", "http://litellm.test")
    vi.stubEnv("ADMIN_LITELLM_API_KEY", "litellm-key")
    vi.stubEnv("BFF_FALLBACK_MODELS", "qwen3-35b-local,gemma4")
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"))
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/overview",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(opsTile(response.json())).toMatchObject({
      sourceStatus: "unavailable",
      metrics: expect.arrayContaining([
        expect.objectContaining({
          id: "requests",
          value: "Unavailable",
        }),
        expect.objectContaining({
          id: "models",
          value: "Unavailable",
        }),
      ]),
    })
    await server.close()
  })
})

function opsTile(response: { tiles: Array<{ id: string }> }) {
  return response.tiles.find((tile) => tile.id === "inference")
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json",
    },
  })
}
