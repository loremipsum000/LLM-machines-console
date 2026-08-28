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

const unclassifiedHeaders = {
  ...adminHeaders,
  "x-llm-machines-user-sub": "unclassified-1",
  "x-llm-machines-user-email": "unclassified@example.test",
  "x-llm-machines-user-roles": "unclassified",
}

describe("Admin hardware", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetAuditEventsForTest()
  })

  it("returns genuine BMC and Intel XPU charts while native links remain disabled", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("ADMIN_PROMETHEUS_BASE_URL", "http://prometheus.test")
    vi.stubEnv("ADMIN_ALERTMANAGER_BASE_URL", "http://alertmanager.test")
    vi.stubEnv("GRAFANA_PUBLIC_URL", "https://grafana.example")
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(input.toString())
      const query = url.searchParams.get("query") ?? ""
      if (url.hostname === "alertmanager.test") {
        return Response.json([
          {
            labels: {
              alertname: "LLMMGpuSaturation",
              component: "inference",
              host_role: "inference",
              rule_id: "gpu-temperature-high",
              severity: "warning",
            },
            startsAt: "2026-08-01T08:00:00.000Z",
            status: { state: "active" },
          },
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
      alertSourceStatus: "ok",
      alertmanagerUrl: null,
      grafanaUrl: null,
      availableHosts: ["core-appliance", "inference-nat", "nihal01", "xpu-b50"],
    })
    expect(body.charts).toHaveLength(15)
    expect(
      body.charts.every(
        (chart: { grafanaUrl: string | null }) => chart.grafanaUrl === null,
      ),
    ).toBe(true)
    expect(body.charts.map((chart: { id: string }) => chart.id)).toEqual([
      "cpu_utilization",
      "xpu_temperature",
      "xpu_utilization",
      "xpu_memory_utilization",
      "xpu_device_health",
      "xpu_frequency_status",
      "ram_usage",
      "filesystem_usage",
      "bmc_sensor_health",
      "chassis_power_state",
      "chassis_temperature",
      "fan_speed",
      "power_draw",
      "monthly_energy_projection",
      "network_throughput",
    ])
    expect(
      body.charts.find((chart: { id: string }) => chart.id === "power_draw"),
    ).toMatchObject({
      description:
        "Live chassis input power from the BMC's genuine PW consumption sensor.",
      unit: "watt",
      series: [
        expect.objectContaining({
          host: "nihal01",
          label: "nihal01",
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
    expect(body.activeAlerts).toEqual([
      expect.objectContaining({
        alertName: "LLMMGpuSaturation",
        alertmanagerUrl: null,
        description: null,
        device: null,
        grafanaUrl: null,
        host: null,
        severity: "warning",
      }),
    ])
    await server.close()
  })

  it("rejects unclassified identities from hardware metrics", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/hardware",
      headers: unclassifiedHeaders,
    })

    expect(response.statusCode).toBe(401)
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
  if (query.includes("hw_temperature_celsius")) {
    return [
      prometheusMatrixSample(
        {
          __name__: "hw_temperature_celsius",
          host: "xpu-b50",
          hw_sensor_location: "gpu",
          pci_bdf: "0000:83:00.0",
        },
        ["62", "64"],
      ),
    ]
  }
  if (query.includes("hw_gpu_utilization_ratio")) {
    return [
      prometheusMatrixSample(
        {
          __name__: "hw_gpu_utilization_ratio",
          host: "xpu-b50",
          hw_gpu_task: "all",
          pci_bdf: "0000:83:00.0",
        },
        ["52", "59"],
      ),
    ]
  }
  if (query.includes("hw_memory_utilization_ratio")) {
    return [
      prometheusMatrixSample(
        {
          __name__: "hw_memory_utilization_ratio",
          host: "xpu-b50",
          hw_memory_location: "device",
          pci_bdf: "0000:83:00.0",
        },
        ["68", "69"],
      ),
    ]
  }
  if (query.includes('hw_type="gpu"')) {
    return [
      prometheusMatrixSample(
        {
          __name__: "hw_status",
          host: "xpu-b50",
          hw_state: "reset_needed",
          pci_bdf: "0000:83:00.0",
        },
        ["1", "1"],
      ),
    ]
  }
  if (query.includes('hw_type="frequency"')) {
    return [
      prometheusMatrixSample(
        {
          __name__: "hw_status",
          host: "xpu-b50",
          hw_state: "ok",
          pci_bdf: "0000:83:00.0",
        },
        ["1", "1"],
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
  if (query.includes("ipmi_power_watts")) {
    return [
      prometheusMatrixSample(
        {
          __name__: "ipmi_power_watts",
          host: "nihal01",
          name: "PW consumption",
        },
        ["101", "105"],
      ),
    ]
  }
  if (query.includes("ipmi_fan_speed_rpm")) {
    return [
      prometheusMatrixSample(
        { __name__: "ipmi_fan_speed_rpm", host: "nihal01", name: "FAN1" },
        ["4200", "4300"],
      ),
    ]
  }
  if (query.includes("ipmi_chassis_power_state")) {
    return [
      prometheusMatrixSample(
        { __name__: "ipmi_chassis_power_state", host: "nihal01" },
        ["1", "1"],
      ),
    ]
  }
  if (query.includes("ipmi_temperature_celsius")) {
    return [
      prometheusMatrixSample(
        {
          __name__: "ipmi_temperature_celsius",
          host: "nihal01",
          name: "Inlet Temp",
        },
        ["24", "25"],
      ),
    ]
  }
  if (query.includes("ipmi_temperature_state")) {
    return [
      prometheusMatrixSample(
        { __name__: "ipmi_temperature_state", host: "nihal01" },
        ["0", "0"],
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
