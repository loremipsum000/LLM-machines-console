import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import { resetAuditEventsForTest } from "../services/audit"
import { resetHubStateForTest } from "../services/hub"

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
    resetHubStateForTest()
  })

  it("federates Admin overview ops from LiteLLM when configured", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("ADMIN_LITELLM_BASE_URL", "http://litellm.test")
    vi.stubEnv("ADMIN_LITELLM_API_KEY", "litellm-key")
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
              user: "demo-builder",
            },
            {
              request_duration_ms: 5500,
              status: "success",
              user: "demo-admin",
            },
          ],
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
      summary:
        "LiteLLM reports 12 requests, 1,800 tokens, and 0 failed requests in the last 30 days.",
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
          id: "p95-latency",
          tone: "good",
          value: "5.5s",
        }),
        expect.objectContaining({
          id: "top-user",
          value: "demo-admin",
        }),
      ]),
    })
    await server.close()
  })

  it("marks Admin overview ops unavailable when LiteLLM cannot be read", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("ADMIN_LITELLM_BASE_URL", "http://litellm.test")
    vi.stubEnv("ADMIN_LITELLM_API_KEY", "litellm-key")
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
          id: "p95-latency",
          value: "Unavailable",
        }),
        expect.objectContaining({
          id: "top-user",
          value: "Unavailable",
        }),
      ]),
    })
    await server.close()
  })
})

function opsTile(response: { tiles: Array<{ id: string }> }) {
  return response.tiles.find((tile) => tile.id === "ops")
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json",
    },
  })
}
