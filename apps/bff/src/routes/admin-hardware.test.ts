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

const builderHeaders = {
  ...adminHeaders,
  "x-llm-machines-user-sub": "builder-1",
  "x-llm-machines-user-email": "builder@example.test",
  "x-llm-machines-user-roles": "builder",
}

describe("Admin hardware", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetAuditEventsForTest()
    resetHubStateForTest()
  })

  it("returns seven curated hardware charts while native expert links remain disabled", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("ADMIN_PROMETHEUS_BASE_URL", "http://prometheus.test")
    vi.stubEnv("GRAFANA_PUBLIC_URL", "https://grafana.example")
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(input.toString())
      const query = url.searchParams.get("query") ?? ""
      if (url.pathname.endsWith("/query")) {
        return prometheusVectorResponse([
          prometheusVectorSample(
            {
              alertname: "InfraGpuTemperatureHigh",
              gpu: "0",
              host: "compute-node-b",
              severity: "warning",
            },
            "1",
          ),
        ])
      }
      return prometheusMatrixResponse(matrixSamplesForQuery(query))
    })
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/hardware?range=6h&step=auto",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body).toMatchObject({
      range: "6h",
      step: "180s",
      selectedHost: "all",
      sourceStatus: "ok",
      alertmanagerUrl: null,
      grafanaUrl: null,
      availableHosts: [
        "compute-node-a",
        "compute-node-b",
        "core-appliance",
        "inference-nat",
      ],
    })
    expect(body.charts).toHaveLength(7)
    expect(
      body.charts.every(
        (chart: { grafanaUrl: string | null }) => chart.grafanaUrl === null,
      ),
    ).toBe(true)
    expect(body.charts.map((chart: { id: string }) => chart.id)).toEqual([
      "cpu_utilization",
      "gpu_temperature",
      "gpu_utilization",
      "ram_usage",
      "filesystem_usage",
      "power_draw",
      "network_throughput",
    ])
    expect(
      body.charts.find((chart: { id: string }) => chart.id === "power_draw"),
    ).toMatchObject({
      description: "Live chassis power draw for compute-node-a from IPMI DCMI.",
      unit: "watt",
      series: [
        expect.objectContaining({
          host: "compute-node-a",
          label: "compute-node-a",
          metricSource: "ipmi_exporter",
        }),
      ],
    })
    expect(
      body.charts.find(
        (chart: { id: string }) => chart.id === "network_throughput",
      ).series,
    ).toHaveLength(2)
    const filesystem = body.charts.find(
      (chart: { id: string }) => chart.id === "filesystem_usage",
    )
    expect(filesystem.description).toBe(
      "Latest non-empty filesystem use by host, mountpoint, and device.",
    )
    expect(filesystem.promql).toContain(
      'fstype!~"tmpfs|devtmpfs|overlay|squashfs|fuse.*"',
    )
    expect(filesystem.promql).toContain('device!~"/dev/fuse"')
    expect(
      filesystem.series.map((series: { label: string }) => series.label),
    ).toEqual([
      "inference-nat · root (/dev/sda1)",
      "core-appliance · root (/dev/sda1)",
    ])
    expect(body.activeAlerts).toEqual([])
    await server.close()
  })

  it("blocks non-admin personas from hardware metrics", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/hardware",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
    await server.close()
  })

  it("returns not-configured charts when Prometheus is absent", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/hardware",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      sourceStatus: "not_configured",
      charts: expect.arrayContaining([
        expect.objectContaining({
          id: "cpu_utilization",
          series: [],
          sourceStatus: "not_configured",
        }),
      ]),
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    await server.close()
  })

  it("marks hardware unavailable for malformed Prometheus responses", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("ADMIN_PROMETHEUS_BASE_URL", "http://prometheus.test")
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: { resultType: "vector", result: [] },
        }),
      ),
    )
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/hardware",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      sourceStatus: "unavailable",
      charts: expect.arrayContaining([
        expect.objectContaining({ sourceStatus: "unavailable" }),
      ]),
    })
    await server.close()
  })

  it("does not expose Prometheus credentials in public hardware responses", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const username = ["prom", "user"].join("-")
    const password = ["prom", "secret"].join("-")
    const prometheusUrl = new URL("http://prometheus.test")
    prometheusUrl.username = username
    prometheusUrl.password = password
    vi.stubEnv("ADMIN_PROMETHEUS_BASE_URL", prometheusUrl.toString())
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(input.toString())
      return url.pathname.endsWith("/query")
        ? prometheusVectorResponse([])
        : prometheusMatrixResponse(matrixSamplesForQuery(""))
    })
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/hardware",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    const serialized = JSON.stringify(response.json())
    expect(serialized).not.toContain(password)
    expect(serialized).not.toContain(username)
    expect(serialized).not.toContain("prometheus.test")
    await server.close()
  })
})

function matrixSamplesForQuery(query: string): unknown[] {
  if (query.includes("node_cpu_seconds_total")) {
    return [
      prometheusMatrixSample(
        { __name__: "node_cpu_seconds_total", host: "core-appliance" },
        ["31", "38"],
      ),
    ]
  }
  if (query.includes("GPU_TEMP")) {
    return [
      prometheusMatrixSample(
        {
          __name__: "llmm_nvidia_gpu_temperature_celsius",
          gpu: "0",
          host: "compute-node-b",
        },
        ["62", "64"],
      ),
    ]
  }
  if (query.includes("GPU_UTIL")) {
    return [
      prometheusMatrixSample(
        {
          __name__: "llmm_nvidia_gpu_utilization_percent",
          gpu: "0",
          host: "compute-node-b",
        },
        ["52", "59"],
      ),
    ]
  }
  if (query.includes("node_memory_MemAvailable_bytes")) {
    return [
      prometheusMatrixSample(
        { __name__: "node_memory_MemAvailable_bytes", host: "core-appliance" },
        ["55", "57"],
      ),
    ]
  }
  if (query.includes("node_filesystem_avail_bytes")) {
    return [
      prometheusMatrixSample(
        {
          __name__: "node_filesystem_avail_bytes",
          host: "core-appliance",
          device: "/dev/sda1",
          mountpoint: "/",
        },
        ["63", "64"],
      ),
      prometheusMatrixSample(
        {
          __name__: "node_filesystem_avail_bytes",
          device: "/dev/sda1",
          host: "inference-nat",
          mountpoint: "/",
        },
        ["92", "94"],
      ),
      prometheusMatrixSample(
        {
          __name__: "node_filesystem_avail_bytes",
          device: "/dev/fuse",
          host: "compute-node-a",
          mountpoint: "/etc/pve",
        },
        ["0.021", "0.021"],
      ),
      prometheusMatrixSample(
        {
          __name__: "node_filesystem_avail_bytes",
          device: "lxcfs",
          host: "compute-node-a",
          mountpoint: "/var/lib/lxcfs",
        },
        ["NaN", "NaN"],
      ),
    ]
  }
  if (query.includes("node_network_receive_bytes_total")) {
    return [
      prometheusMatrixSample(
        {
          __name__: "node_network_receive_bytes_total",
          device: "eth0",
          direction: "RX",
          host: "core-appliance",
        },
        ["1000", "1200"],
      ),
      prometheusMatrixSample(
        {
          __name__: "node_network_transmit_bytes_total",
          device: "eth0",
          direction: "TX",
          host: "core-appliance",
        },
        ["900", "950"],
      ),
    ]
  }
  if (query.includes("ipmi_dcmi_power_consumption_watts")) {
    return [
      prometheusMatrixSample(
        {
          __name__: "ipmi_dcmi_power_consumption_watts",
          bmc: "compute-node-a-bmc",
          host: "compute-node-a",
        },
        ["101", "105"],
      ),
    ]
  }
  return [prometheusMatrixSample({ host: "core-appliance" }, ["1", "2"])]
}

function prometheusVectorResponse(samples: unknown[]): Response {
  return new Response(
    JSON.stringify({
      status: "success",
      data: {
        resultType: "vector",
        result: samples,
      },
    }),
    { headers: { "content-type": "application/json" } },
  )
}

function prometheusMatrixResponse(samples: unknown[]): Response {
  return new Response(
    JSON.stringify({
      status: "success",
      data: {
        resultType: "matrix",
        result: samples,
      },
    }),
    { headers: { "content-type": "application/json" } },
  )
}

function prometheusVectorSample(
  metric: Record<string, string>,
  value: string,
): unknown {
  return {
    metric,
    value: [Date.now() / 1000, value],
  }
}

function prometheusMatrixSample(
  metric: Record<string, string>,
  values: [string, string],
): unknown {
  return {
    metric,
    values: [
      [1_779_340_800, values[0]],
      [1_779_341_100, values[1]],
    ],
  }
}
