import type {
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
import { canUseBffFixtureData } from "../config/fixture-mode"
import {
  PrometheusClient,
  type PrometheusMatrixSample,
} from "./admin-prometheus"
import { expertCapability } from "./expert-capabilities"

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
const HARDWARE_DASHBOARD_PATH =
  "/d/llmm-infra-overview/llm-machines-infrastructure-overview"

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
    id: "gpu_temperature",
    title: "GPU temperature",
    description: "GPU package temperature from DCGM or nvidia-smi fallback.",
    chartType: "line",
    unit: "celsius",
    emptyMessage: "No GPU temperature metrics are available.",
    thresholds: [threshold("Warning", "warning", 85, "celsius")],
    promql: (host) =>
      `DCGM_FI_DEV_GPU_TEMP${hostSelector(host)} or llmm_nvidia_gpu_temperature_celsius${hostSelector(
        host,
      )}`,
  },
  {
    id: "gpu_utilization",
    title: "GPU utilization",
    description: "GPU core utilization from DCGM or nvidia-smi fallback.",
    chartType: "area",
    unit: "percent",
    emptyMessage: "No GPU utilization metrics are available.",
    thresholds: [threshold("Sustained high", "warning", 90, "percent")],
    promql: (host) =>
      `DCGM_FI_DEV_GPU_UTIL${hostSelector(host)} or llmm_nvidia_gpu_utilization_percent${hostSelector(
        host,
      )}`,
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
    id: "power_draw",
    title: "Power draw",
    description: "Live chassis power draw for compute-node-a from IPMI DCMI.",
    chartType: "area",
    unit: "watt",
    emptyMessage: "No IPMI DCMI power draw metrics are available.",
    thresholds: [],
    promql: () => 'ipmi_dcmi_power_consumption_watts{host="compute-node-a"}',
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
  const grafanaUrl = grafanaDashboardUrl()
  const generatedAt = new Date()
  const stepSeconds = resolveStepSeconds(range, options.step)
  const step = `${stepSeconds}s`

  if (!baseUrl) {
    return emptyHardwareResponse({
      generatedAt,
      grafanaUrl,
      host,
      range,
      sourceStatus: "not_configured",
      step,
      summary:
        "Prometheus federation is not configured for this BFF, so live hardware graphs are unavailable.",
    })
  }

  const client = new PrometheusClient(baseUrl)
  const start = new Date(generatedAt.getTime() - RANGE_SECONDS[range] * 1000)

  try {
    const chartSamples = await Promise.all(
      chartDefinitions.map(async (definition) => ({
        definition,
        samples: await client.queryRange({
          end: generatedAt,
          query: definition.promql(host),
          start,
          step,
        }),
      })),
    )
    const charts = chartSamples.map(({ definition, samples }) =>
      toHardwareChart(definition, samples, host),
    )
    const availableHosts = collectAvailableHosts(charts, host)
    const sourceStatus = hardwareSourceStatus(charts)

    return {
      generatedAt: generatedAt.toISOString(),
      range,
      step,
      selectedHost: host,
      availableHosts,
      sourceStatus,
      summary: hardwareSummary(charts, sourceStatus),
      grafanaUrl,
      alertmanagerUrl: null,
      charts,
      activeAlerts: [],
    }
  } catch {
    return emptyHardwareResponse({
      generatedAt,
      grafanaUrl,
      host,
      range,
      sourceStatus: "unavailable",
      step,
      summary:
        "Prometheus federation is configured, but hardware metrics could not be read.",
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
  generatedAt,
  grafanaUrl,
  host,
  range,
  sourceStatus,
  step,
  summary,
}: {
  generatedAt: Date
  grafanaUrl: string | null
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
    summary,
    grafanaUrl,
    alertmanagerUrl: null,
    charts: chartDefinitions.map((definition) => ({
      id: definition.id,
      title: definition.title,
      description: definition.description,
      chartType: definition.chartType,
      unit: definition.unit,
      promql: definition.promql(host),
      sourceStatus,
      emptyMessage: definition.emptyMessage,
      grafanaUrl: null,
      thresholds: definition.thresholds,
      series: [],
    })),
    activeAlerts: [],
  }
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

function hostSelector(host: string): string {
  const matcher = hostMatcher(host)
  return matcher.length > 0 ? `{${matcher.join(",")}}` : ""
}

function hostMatcher(host: string): string[] {
  return host === DEFAULT_HOST ? [] : [`host="${escapeLabelValue(host)}"`]
}

function escapeLabelValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
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
  return trimmed && trimmed !== "" ? trimmed : DEFAULT_HOST
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
  if (unit === "h") {
    return value * 60 * 60
  }
  if (unit === "m") {
    return value * 60
  }
  return value
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
  if (chartId === "gpu_temperature" || chartId === "gpu_utilization") {
    return joinedSeriesLabel(
      [
        metric.host ?? metric.instance,
        metric.gpu ? `GPU ${metric.gpu}` : metric.device,
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
  if (metricName.startsWith("DCGM_")) {
    return "DCGM"
  }
  if (metricName.startsWith("llmm_nvidia")) {
    return "nvidia-smi"
  }
  if (metricName.startsWith("node_")) {
    return "node_exporter"
  }
  if (metricName.startsWith("ipmi_")) {
    return "ipmi_exporter"
  }
  return null
}

function grafanaDashboardUrl(): string | null {
  if (expertCapability("grafana").directAccess !== "enabled") {
    return null
  }
  return configuredExternalUrl("GRAFANA_PUBLIC_URL", "GRAFANA_PUBLIC_ORIGIN")
}

function configuredExternalUrl(
  primaryEnv: string,
  fallbackEnv?: string,
): string | null {
  const configured =
    process.env[primaryEnv]?.trim() ||
    (fallbackEnv ? process.env[fallbackEnv]?.trim() : "")
  if (configured) {
    return primaryEnv.startsWith("GRAFANA")
      ? withDashboardPath(configured)
      : configured
  }
  if (primaryEnv.startsWith("GRAFANA") && canUseBffFixtureData()) {
    return withDashboardPath("https://grafana.example.test")
  }
  return null
}

function withDashboardPath(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl)
    if (!parsed.pathname || parsed.pathname === "/") {
      return new URL(HARDWARE_DASHBOARD_PATH, parsed).toString()
    }
    return parsed.toString()
  } catch {
    return baseUrl
  }
}
