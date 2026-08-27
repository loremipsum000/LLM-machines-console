import type {
  AdminHardwareAlert,
  AdminHardwareChart,
  AdminHardwareChartId,
  AdminHardwareChartType,
  AdminHardwareRange,
  AdminHardwareResponse,
  AdminHardwareSeries,
  AdminHardwareThreshold,
  AdminHardwareUnit,
  InferenceCoreSeverity,
  InferenceCoreSourceStatus,
} from "@llm-machines/contracts/inference-core"
import {
  type AdminAlertmanagerSummary,
  getAdminAlertmanagerSummary,
} from "./admin-alertmanager"
import {
  PrometheusClient,
  type PrometheusMatrixSample,
} from "./admin-prometheus"

interface HardwareQueryOptions {
  host?: string
  range?: string
  step?: string
}

interface HardwareChartDefinition {
  chartType: AdminHardwareChartType
  description: string
  emptyMessage: string
  id: AdminHardwareChartId
  promql: (host: string) => string
  thresholds: AdminHardwareThreshold[]
  title: string
  unit: AdminHardwareUnit
}

const DEFAULT_RANGE: AdminHardwareRange = "6h"
const DEFAULT_HOST = "all"

const RANGE_SECONDS: Record<AdminHardwareRange, number> = {
  "1h": 60 * 60,
  "6h": 6 * 60 * 60,
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
}

const chartDefinitions: HardwareChartDefinition[] = [
  {
    id: "cpu_utilization",
    title: "CPU utilization",
    description: "Average non-idle CPU time by host.",
    chartType: "area",
    unit: "percent",
    emptyMessage: "No node CPU utilization metrics are available.",
    thresholds: [
      threshold("High", "warning", 85, "percent"),
      threshold("Critical", "critical", 95, "percent"),
    ],
    promql: (host) =>
      `100 * (1 - avg by (host) (rate(node_cpu_seconds_total{${nodeSelector(
        host,
        'mode="idle"',
      )}}[5m])))`,
  },
  {
    id: "xpu_temperature",
    title: "XPU temperature",
    description: "Intel XPU GPU and device-memory temperatures from XPUM.",
    chartType: "line",
    unit: "celsius",
    emptyMessage: "No Intel XPU temperature metrics are available.",
    thresholds: [threshold("Warning", "warning", 85, "celsius")],
    promql: (host) =>
      metricSelector(
        "hw_temperature_celsius",
        host,
        'job="xpu"',
        'hw_sensor_location=~"gpu|memory"',
        'statistic="max"',
      ),
  },
  {
    id: "xpu_utilization",
    title: "XPU utilization",
    description: "Intel XPU all-engine utilization reported by XPUM.",
    chartType: "area",
    unit: "percent",
    emptyMessage: "No Intel XPU utilization metrics are available.",
    thresholds: [threshold("Sustained high", "warning", 90, "percent")],
    promql: (host) =>
      `100 * ${metricSelector(
        "hw_gpu_utilization_ratio",
        host,
        'job="xpu"',
        'hw_gpu_task="all"',
      )}`,
  },
  {
    id: "xpu_memory_utilization",
    title: "XPU memory utilization",
    description: "Intel XPU device-memory utilization reported by XPUM.",
    chartType: "area",
    unit: "percent",
    emptyMessage: "No Intel XPU memory metrics are available.",
    thresholds: [threshold("High", "warning", 90, "percent")],
    promql: (host) =>
      `100 * ${metricSelector(
        "hw_memory_utilization_ratio",
        host,
        'job="xpu"',
        'hw_memory_location="device"',
      )}`,
  },
  {
    id: "xpu_device_health",
    title: "XPU device health",
    description:
      "Derived directly from XPUM reset-needed state: 1 is healthy and 0 requires reset.",
    chartType: "line",
    unit: "state",
    emptyMessage: "No Intel XPU device-health state is available.",
    thresholds: [],
    promql: (host) =>
      `1 - ${metricSelector(
        "hw_status",
        host,
        'job="xpu"',
        'hw_type="gpu"',
        'hw_state="reset_needed"',
      )}`,
  },
  {
    id: "xpu_frequency_status",
    title: "XPU frequency status",
    description:
      "XPUM frequency-domain state. Throttle-reason series appear only after the driver reports a real throttle event.",
    chartType: "line",
    unit: "state",
    emptyMessage: "No Intel XPU frequency-status metrics are available.",
    thresholds: [],
    promql: (host) =>
      metricSelector(
        "hw_status",
        host,
        'job="xpu"',
        'hw_type="frequency"',
        'hw_state=~"ok|throttled"',
      ),
  },
  {
    id: "ram_usage",
    title: "RAM usage",
    description: "Memory pressure by host using MemAvailable over MemTotal.",
    chartType: "area",
    unit: "percent",
    emptyMessage: "No node memory metrics are available.",
    thresholds: [
      threshold("High", "warning", 85, "percent"),
      threshold("Critical", "critical", 95, "percent"),
    ],
    promql: (host) =>
      `100 * (1 - (node_memory_MemAvailable_bytes{${nodeSelector(
        host,
      )}} / node_memory_MemTotal_bytes{${nodeSelector(host)}}))`,
  },
  {
    id: "filesystem_usage",
    title: "Filesystem usage",
    description:
      "Latest non-empty filesystem use by host, mountpoint, and device.",
    chartType: "bar",
    unit: "percent",
    emptyMessage: "No filesystem capacity metrics are available.",
    thresholds: [
      threshold("High", "warning", 85, "percent"),
      threshold("Critical", "critical", 95, "percent"),
    ],
    promql: (host) =>
      `100 * (1 - (node_filesystem_avail_bytes{${nodeSelector(
        host,
        'fstype!~"tmpfs|devtmpfs|overlay|squashfs|fuse.*"',
        'device!~"/dev/fuse"',
        'mountpoint!~"/run.*|/var/lib/docker/.+"',
      )}} / node_filesystem_size_bytes{${nodeSelector(
        host,
        'fstype!~"tmpfs|devtmpfs|overlay|squashfs|fuse.*"',
        'device!~"/dev/fuse"',
        'mountpoint!~"/run.*|/var/lib/docker/.+"',
      )}}))`,
  },
  {
    id: "bmc_sensor_health",
    title: "BMC sensor health",
    description:
      "Maximum genuine IPMI sensor severity by host: 0 nominal, 1 warning, 2 critical.",
    chartType: "line",
    unit: "state",
    emptyMessage: "No BMC sensor-health metrics are available.",
    thresholds: [
      threshold("Warning", "warning", 1, "state"),
      threshold("Critical", "critical", 2, "state"),
    ],
    promql: (host) =>
      `max by (host) (${[
        "ipmi_temperature_state",
        "ipmi_fan_speed_state",
        "ipmi_voltage_state",
        "ipmi_current_state",
        "ipmi_power_state",
        "ipmi_sensor_state",
      ]
        .map((metric) => metricSelector(metric, host, 'job="ipmi"'))
        .join(" or ")})`,
  },
  {
    id: "chassis_power_state",
    title: "Chassis power state",
    description: "BMC chassis power state: 1 on, 0 otherwise.",
    chartType: "line",
    unit: "state",
    emptyMessage: "No BMC chassis power-state metric is available.",
    thresholds: [],
    promql: (host) =>
      metricSelector("ipmi_chassis_power_state", host, 'job="ipmi"'),
  },
  {
    id: "chassis_temperature",
    title: "Chassis temperatures",
    description: "Genuine temperature sensor readings reported by the BMC.",
    chartType: "line",
    unit: "celsius",
    emptyMessage: "No BMC temperature readings are available.",
    thresholds: [threshold("Warning", "warning", 70, "celsius")],
    promql: (host) =>
      metricSelector("ipmi_temperature_celsius", host, 'job="ipmi"'),
  },
  {
    id: "fan_speed",
    title: "Chassis fan speed",
    description: "Genuine fan speed readings reported by the BMC.",
    chartType: "line",
    unit: "rpm",
    emptyMessage: "No BMC fan-speed readings are available.",
    thresholds: [],
    promql: (host) => metricSelector("ipmi_fan_speed_rpm", host, 'job="ipmi"'),
  },
  {
    id: "psu_health",
    title: "PSU health",
    description:
      "Maximum genuine IPMI power-supply sensor severity: 0 nominal, 1 warning, 2 critical.",
    chartType: "line",
    unit: "state",
    emptyMessage: "No BMC power-supply state metrics are available.",
    thresholds: [
      threshold("Warning", "warning", 1, "state"),
      threshold("Critical", "critical", 2, "state"),
    ],
    promql: (host) =>
      `max by (host) (${metricSelector(
        "ipmi_sensor_state",
        host,
        'job="ipmi"',
        'type=~"Power Supply|Power Unit"',
      )} or ${metricSelector(
        "ipmi_power_state",
        host,
        'job="ipmi"',
        'name=~"(?i).*psu.*|.*power supply.*"',
      )})`,
  },
  {
    id: "power_draw",
    title: "Appliance power draw",
    description: "Live chassis power draw from the IPMI DCMI collector.",
    chartType: "area",
    unit: "watt",
    emptyMessage: "No IPMI DCMI power draw metrics are available.",
    thresholds: [],
    promql: (host) =>
      metricSelector(
        "ipmi_dcmi_power_consumption_current_watts",
        host,
        'job="ipmi"',
      ),
  },
  {
    id: "monthly_energy_projection",
    title: "Projected monthly energy",
    description:
      "Projected 30-day kWh from the genuine DCMI samples currently retained; this is not historical 30-day consumption until a full window exists.",
    chartType: "area",
    unit: "kilowatt_hour",
    emptyMessage: "No retained IPMI DCMI power samples are available.",
    thresholds: [],
    promql: (host) =>
      `avg_over_time(${metricSelector(
        "ipmi_dcmi_power_consumption_current_watts",
        host,
        'job="ipmi"',
      )}[30d]) * 24 * 30 / 1000`,
  },
  {
    id: "network_throughput",
    title: "Network throughput",
    description: "Receive and transmit rate by host and network device.",
    chartType: "line",
    unit: "bytes_per_second",
    emptyMessage: "No network throughput metrics are available.",
    thresholds: [],
    promql: (host) =>
      `label_replace(rate(node_network_receive_bytes_total{${nodeSelector(
        host,
        'device!~"lo|veth.*|br-.*|docker.*"',
      )}}[5m]), "direction", "RX", "__name__", ".*") or label_replace(rate(node_network_transmit_bytes_total{${nodeSelector(
        host,
        'device!~"lo|veth.*|br-.*|docker.*"',
      )}}[5m]), "direction", "TX", "__name__", ".*")`,
  },
]

export async function getAdminHardware(
  options: HardwareQueryOptions = {},
): Promise<AdminHardwareResponse> {
  const range = parseHardwareRange(options.range)
  const host = normalizeHost(options.host)
  const baseUrl = process.env.ADMIN_PROMETHEUS_BASE_URL?.trim()
  const generatedAt = new Date()
  const stepSeconds = resolveStepSeconds(range, options.step)
  const step = `${stepSeconds}s`
  const alertmanagerPromise = getAdminAlertmanagerSummary()

  if (!baseUrl) {
    const alertmanager = await alertmanagerPromise
    return emptyHardwareResponse({
      alertmanager,
      chartSourceStatus: "not_configured",
      generatedAt,
      host,
      range,
      sourceStatus: combinedHardwareSourceStatus(
        "not_configured",
        alertmanager.sourceStatus,
      ),
      step,
      summary: `Prometheus federation is not configured for this BFF, so live hardware graphs are unavailable. ${alertmanager.summary}`,
    })
  }

  const start = new Date(generatedAt.getTime() - RANGE_SECONDS[range] * 1000)

  try {
    const client = new PrometheusClient(baseUrl)
    const [chartSamples, alertmanager] = await Promise.all([
      Promise.all(
        chartDefinitions.map(async (definition) => ({
          definition,
          samples: await client.queryRange({
            end: generatedAt,
            query: definition.promql(host),
            start,
            step,
          }),
        })),
      ),
      alertmanagerPromise,
    ])
    const charts = chartSamples.map(({ definition, samples }) =>
      toHardwareChart(definition, samples, host),
    )
    const availableHosts = collectAvailableHosts(charts, host)
    const metricsSourceStatus = hardwareSourceStatus(charts)
    const sourceStatus = combinedHardwareSourceStatus(
      metricsSourceStatus,
      alertmanager.sourceStatus,
    )

    return {
      generatedAt: generatedAt.toISOString(),
      range,
      step,
      selectedHost: host,
      availableHosts,
      sourceStatus,
      alertSourceStatus: alertmanager.sourceStatus,
      summary: `${hardwareSummary(charts, metricsSourceStatus)} ${alertmanager.summary}`,
      grafanaUrl: null,
      alertmanagerUrl: null,
      charts,
      activeAlerts: alertLinks(alertmanager.alerts),
    }
  } catch {
    const alertmanager = await alertmanagerPromise
    return emptyHardwareResponse({
      alertmanager,
      chartSourceStatus: "unavailable",
      generatedAt,
      host,
      range,
      sourceStatus: combinedHardwareSourceStatus(
        "unavailable",
        alertmanager.sourceStatus,
      ),
      step,
      summary: `Prometheus federation is configured, but hardware metrics could not be read. ${alertmanager.summary}`,
    })
  }
}

function toHardwareChart(
  definition: HardwareChartDefinition,
  samples: PrometheusMatrixSample[],
  host: string,
): AdminHardwareChart {
  const series = samples
    .map((sample, index) => toHardwareSeries(definition.id, sample, index))
    .filter((item) => shouldRenderHardwareSeries(definition, item))
    .sort((first, second) => compareHardwareSeries(definition, first, second))
  return {
    id: definition.id,
    title: definition.title,
    description: definition.description,
    chartType: definition.chartType,
    unit: definition.unit,
    promql: definition.promql(host),
    sourceStatus: series.some((item) => item.points.length > 0)
      ? "ok"
      : "degraded",
    emptyMessage: definition.emptyMessage,
    grafanaUrl: null,
    thresholds: definition.thresholds,
    series,
  }
}

function toHardwareSeries(
  chartId: AdminHardwareChartId,
  sample: PrometheusMatrixSample,
  index: number,
): AdminHardwareSeries {
  const host = sample.metric.host ?? sample.metric.instance ?? null
  const device =
    sample.metric.gpu ??
    sample.metric.device ??
    sample.metric.pci_bdf ??
    sample.metric.hw_sensor_location ??
    sample.metric.hw_name ??
    sample.metric.mountpoint ??
    sample.metric.name ??
    null
  const direction = sample.metric.direction ?? null
  return {
    id: `${chartId}-${index + 1}`,
    label: seriesLabel(chartId, sample.metric, index),
    host,
    device,
    direction,
    metricSource: metricSource(sample.metric),
    points: sample.values.map(([timestamp, rawValue]) => ({
      timestamp: new Date(timestamp * 1000).toISOString(),
      value: finiteNumber(rawValue),
    })),
  }
}

function emptyHardwareResponse({
  alertmanager,
  chartSourceStatus,
  generatedAt,
  host,
  range,
  sourceStatus,
  step,
  summary,
}: {
  alertmanager: AdminAlertmanagerSummary
  chartSourceStatus: InferenceCoreSourceStatus
  generatedAt: Date
  host: string
  range: AdminHardwareRange
  sourceStatus: InferenceCoreSourceStatus
  step: string
  summary: string
}): AdminHardwareResponse {
  return {
    generatedAt: generatedAt.toISOString(),
    range,
    step,
    selectedHost: host,
    availableHosts: host === DEFAULT_HOST ? [] : [host],
    sourceStatus,
    alertSourceStatus: alertmanager.sourceStatus,
    summary,
    grafanaUrl: null,
    alertmanagerUrl: null,
    charts: chartDefinitions.map((definition) => ({
      id: definition.id,
      title: definition.title,
      description: definition.description,
      chartType: definition.chartType,
      unit: definition.unit,
      promql: definition.promql(host),
      sourceStatus: chartSourceStatus,
      emptyMessage: definition.emptyMessage,
      grafanaUrl: null,
      thresholds: definition.thresholds,
      series: [],
    })),
    activeAlerts: alertLinks(alertmanager.alerts),
  }
}

function alertLinks(alerts: AdminHardwareAlert[]): AdminHardwareAlert[] {
  return alerts.map((alert) => ({
    ...alert,
    grafanaUrl: null,
    alertmanagerUrl: null,
  }))
}

function combinedHardwareSourceStatus(
  metricsStatus: InferenceCoreSourceStatus,
  alertStatus: InferenceCoreSourceStatus,
): InferenceCoreSourceStatus {
  if (metricsStatus === "not_configured" && alertStatus === "not_configured") {
    return "not_configured"
  }
  if (metricsStatus === "unavailable") {
    return "unavailable"
  }
  if (metricsStatus === "ok" && alertStatus === "ok") {
    return "ok"
  }
  return "degraded"
}

function collectAvailableHosts(
  charts: AdminHardwareChart[],
  selectedHost: string,
): string[] {
  const hosts = new Set<string>()
  if (selectedHost !== DEFAULT_HOST) {
    hosts.add(selectedHost)
  }
  for (const chart of charts) {
    for (const series of chart.series) {
      if (series.host) {
        hosts.add(series.host)
      }
    }
  }
  return Array.from(hosts).sort((a, b) => a.localeCompare(b))
}

function hardwareSourceStatus(
  charts: AdminHardwareChart[],
): InferenceCoreSourceStatus {
  if (charts.every((chart) => chart.series.length === 0)) {
    return "degraded"
  }
  if (charts.some((chart) => chart.series.length === 0)) {
    return "degraded"
  }
  return "ok"
}

function hardwareSummary(
  charts: AdminHardwareChart[],
  sourceStatus: InferenceCoreSourceStatus,
): string {
  if (sourceStatus === "ok") {
    return `Prometheus is returning all ${chartDefinitions.length} curated hardware signals.`
  }
  const populatedCharts = charts.filter(
    (chart) => chart.series.length > 0,
  ).length
  return `Prometheus returned ${populatedCharts}/${chartDefinitions.length} curated hardware signals.`
}

function nodeSelector(host: string, ...extra: string[]): string {
  return ['job="node"', ...hostMatcher(host), ...extra].join(",")
}

function metricSelector(
  metric: string,
  host: string,
  ...extra: string[]
): string {
  return `${metric}{${[...hostMatcher(host), ...extra].join(",")}}`
}

function hostMatcher(host: string): string[] {
  return host === DEFAULT_HOST ? [] : [`host="${escapeLabelValue(host)}"`]
}

function escapeLabelValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t")
    .replaceAll('"', '\\"')
}

function threshold(
  label: string,
  severity: InferenceCoreSeverity,
  value: number,
  unit: AdminHardwareUnit,
): AdminHardwareThreshold {
  return {
    label,
    severity,
    value,
    unit,
  }
}

function parseHardwareRange(range?: string): AdminHardwareRange {
  return range === "1h" || range === "24h" || range === "7d"
    ? range
    : DEFAULT_RANGE
}

function normalizeHost(host?: string): string {
  const trimmed = host?.trim()
  return trimmed &&
    trimmed !== "" &&
    trimmed.length <= 255 &&
    hasNoControlCharacters(trimmed)
    ? trimmed
    : DEFAULT_HOST
}

function hasNoControlCharacters(value: string): boolean {
  return Array.from(value).every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint >= 32 && codePoint !== 127
  })
}

function resolveStepSeconds(
  range: AdminHardwareRange,
  requestedStep?: string,
): number {
  const parsed = parseStepSeconds(requestedStep)
  if (parsed !== null) {
    return parsed
  }
  const autoStep = Math.ceil(RANGE_SECONDS[range] / 120)
  return Math.min(Math.max(autoStep, 30), 300)
}

function parseStepSeconds(step?: string): number | null {
  if (!step || step === "auto") {
    return null
  }
  const match = /^(\d+)(s|m|h)$/.exec(step)
  if (!match) {
    return null
  }
  const value = Number.parseInt(match[1] ?? "", 10)
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }
  const unit = match[2]
  const seconds =
    unit === "h" ? value * 60 * 60 : unit === "m" ? value * 60 : value
  return seconds >= 30 && seconds <= 86_400 ? seconds : null
}

function finiteNumber(rawValue: string): number | null {
  const parsed = Number.parseFloat(rawValue)
  return Number.isFinite(parsed) ? parsed : null
}

function shouldRenderHardwareSeries(
  definition: HardwareChartDefinition,
  series: AdminHardwareSeries,
): boolean {
  if (definition.chartType !== "bar") {
    return series.points.length > 0
  }
  const value = latestSeriesValue(series.points)
  if (value === null) {
    return false
  }
  if (definition.unit === "percent") {
    return Math.round(value) > 0
  }
  return value > 0
}

function compareHardwareSeries(
  definition: HardwareChartDefinition,
  first: AdminHardwareSeries,
  second: AdminHardwareSeries,
): number {
  if (definition.chartType !== "bar") {
    return 0
  }
  return (
    (latestSeriesValue(second.points) ?? Number.NEGATIVE_INFINITY) -
    (latestSeriesValue(first.points) ?? Number.NEGATIVE_INFINITY)
  )
}

function latestSeriesValue(
  points: AdminHardwareSeries["points"],
): number | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = points[index]?.value
    if (value !== null && value !== undefined) {
      return value
    }
  }
  return null
}

function seriesLabel(
  chartId: AdminHardwareChartId,
  metric: Record<string, string>,
  index: number,
): string {
  if (chartId === "filesystem_usage") {
    return filesystemSeriesLabel(metric, index)
  }
  if (chartId === "network_throughput") {
    return joinedSeriesLabel(
      [metric.host ?? metric.instance, metric.device, metric.direction],
      index,
    )
  }
  if (chartId.startsWith("xpu_")) {
    return joinedSeriesLabel(
      [
        metric.host ?? metric.instance,
        metric.pci_bdf,
        metric.hw_sensor_location,
        metric.hw_gpu_task,
        metric.hw_memory_location,
        metric.hw_state,
      ],
      index,
    )
  }
  const parts = [
    metric.host ?? metric.instance,
    metric.gpu ? `GPU ${metric.gpu}` : undefined,
    metric.device,
    metric.mountpoint,
    metric.direction,
  ]
  return joinedSeriesLabel(parts, index)
}

function filesystemSeriesLabel(
  metric: Record<string, string>,
  index: number,
): string {
  const host = metric.host ?? metric.instance ?? `Series ${index + 1}`
  const mountpoint = metric.mountpoint
  const device = metric.device
  const mountLabel = mountpoint === "/" ? "root" : mountpoint

  if (mountLabel && device && mountLabel !== device) {
    return `${host} · ${mountLabel} (${device})`
  }
  if (mountLabel) {
    return `${host} · ${mountLabel}`
  }
  if (device) {
    return `${host} · ${device}`
  }
  return host
}

function joinedSeriesLabel(
  parts: Array<string | undefined>,
  index: number,
): string {
  const filteredParts = parts.filter((part): part is string => Boolean(part))
  return filteredParts.length > 0
    ? filteredParts.join(" · ")
    : `Series ${index + 1}`
}

function metricSource(metric: Record<string, string>): string | null {
  const metricName = metric.__name__ ?? ""
  if (metricName.startsWith("hw_") || metric.job === "xpu") {
    return "Intel XPUM"
  }
  if (metricName.startsWith("node_")) {
    return "node_exporter"
  }
  if (metricName.startsWith("ipmi_") || metric.job === "ipmi") {
    return "ipmi_exporter"
  }
  return null
}
