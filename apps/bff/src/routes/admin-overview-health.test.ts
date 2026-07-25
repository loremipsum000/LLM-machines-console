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

describe("Admin overview health federation", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetAuditEventsForTest()
    resetHubStateForTest()
  })

  it("federates Admin overview health from Prometheus when configured", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("ADMIN_PROMETHEUS_BASE_URL", "http://prometheus.test")
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(input.toString())
      const query = url.searchParams.get("query") ?? ""
      if (query.startsWith("up{")) {
        return prometheusResponse([
          prometheusSample({ host: "oss-stack", job: "node" }, "1"),
          prometheusSample({ host: "compute-node-a", job: "node" }, "1"),
          prometheusSample({ host: "agentic", job: "node" }, "0"),
        ])
      }
      if (query.startsWith("ALERTS{")) {
        return prometheusResponse([
          prometheusSample(
            { alertname: "InfraExporterDown", severity: "warning" },
            "1",
          ),
        ])
      }
      if (query === "max(DCGM_FI_DEV_GPU_UTIL)") {
        return prometheusResponse([prometheusSample({}, "72")])
      }
      if (query === "max(llmm_nvidia_gpu_utilization_percent)") {
        return prometheusResponse([])
      }
      if (query.includes("node_filesystem_avail_bytes")) {
        return prometheusResponse([prometheusSample({}, "63")])
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
    expect(healthTile(response.json())).toMatchObject({
      sourceStatus: "degraded",
      summary:
        "Prometheus reports 2/3 monitored targets up with 1 active alert.",
      metrics: expect.arrayContaining([
        expect.objectContaining({
          id: "gpu",
          value: "72%",
        }),
        expect.objectContaining({
          id: "alerts",
          tone: "warning",
          value: "1",
        }),
        expect.objectContaining({
          id: "uptime",
          tone: "warning",
          value: "2/3",
        }),
        expect.objectContaining({
          id: "storage",
          tone: "good",
          value: "63%",
        }),
      ]),
    })
    await server.close()
  })

  it("marks Admin overview health unavailable when Prometheus cannot be read", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("ADMIN_PROMETHEUS_BASE_URL", "http://prometheus.test")
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"))
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/overview",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(healthTile(response.json())).toMatchObject({
      sourceStatus: "unavailable",
      metrics: expect.arrayContaining([
        expect.objectContaining({
          id: "alerts",
          value: "Unavailable",
        }),
      ]),
    })
    await server.close()
  })
})

function healthTile(response: { tiles: Array<{ id: string }> }) {
  return response.tiles.find((tile) => tile.id === "health")
}

function prometheusResponse(samples: unknown[]): Response {
  return new Response(
    JSON.stringify({
      status: "success",
      data: {
        resultType: "vector",
        result: samples,
      },
    }),
    {
      headers: {
        "content-type": "application/json",
      },
    },
  )
}

function prometheusSample(
  metric: Record<string, string>,
  value: string,
): unknown {
  return {
    metric,
    value: [Date.now() / 1000, value],
  }
}
