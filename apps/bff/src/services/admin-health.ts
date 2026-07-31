import type {
  AdminOverviewMetric,
  InferenceCoreSourceStatus,
} from "@llm-machines/contracts/inference-core"
import {
  firstFiniteValue,
  PrometheusClient,
  type PrometheusVectorSample,
} from "./admin-prometheus"

export interface AdminHealthSummary {
  metrics: AdminOverviewMetric[]
  sourceStatus: InferenceCoreSourceStatus
  summary: string
}

const TARGET_UP_QUERY = 'up{job=~"node|dcgm|ipmi|infra_https_endpoint"}'
const ACTIVE_ALERTS_QUERY = 'ALERTS{alertstate="firing"}'
const DCGM_GPU_QUERY = "max(DCGM_FI_DEV_GPU_UTIL)"
const TEXTFILE_GPU_QUERY = "max(llmm_nvidia_gpu_utilization_percent)"
const STORAGE_QUERY =
  'max(100 * (1 - (node_filesystem_avail_bytes{job="node",fstype!~"tmpfs|devtmpfs|overlay|squashfs",mountpoint!~"/run.*|/var/lib/docker/.+"} / node_filesystem_size_bytes{job="node",fstype!~"tmpfs|devtmpfs|overlay|squashfs",mountpoint!~"/run.*|/var/lib/docker/.+"})))'

export async function getAdminHealthSummary(): Promise<AdminHealthSummary> {
  const baseUrl = process.env.ADMIN_PROMETHEUS_BASE_URL?.trim()
  if (!baseUrl) {
    return notConfiguredHealth()
  }

  try {
    const client = new PrometheusClient(baseUrl)
    const [targets, alerts, dcgmGpu, textfileGpu, storage] = await Promise.all([
      client.query(TARGET_UP_QUERY),
      client.query(ACTIVE_ALERTS_QUERY),
      client.query(DCGM_GPU_QUERY),
      client.query(TEXTFILE_GPU_QUERY),
      client.query(STORAGE_QUERY),
    ])

    const targetSummary = summarizeTargets(targets)
    const alertSummary = summarizeAlerts(alerts)
    const gpuValue = firstFiniteValue(dcgmGpu) ?? firstFiniteValue(textfileGpu)
    const storageValue = firstFiniteValue(storage)

    return {
      sourceStatus: healthSourceStatus(targetSummary.down, alertSummary),
      summary: healthSummary(targetSummary, alertSummary),
      metrics: [
        metric(
          "gpu",
          "GPU utilization",
          formatPercent(gpuValue),
          "Peak observed GPU",
          gpuValue === null ? "neutral" : "good",
        ),
        metric(
          "alerts",
          "Alerts",
          alertSummary.total,
          alertSummary.critical > 0
            ? `${alertSummary.critical} critical`
            : "Active firing alerts",
          alertTone(alertSummary),
        ),
        metric(
          "uptime",
          "Targets up",
          `${targetSummary.up}/${targetSummary.total}`,
          `${targetSummary.down} down`,
          targetSummary.down > 0 ? "warning" : "good",
        ),
        metric(
          "storage",
          "Max disk used",
          formatPercent(storageValue),
          "Node filesystems",
          storageTone(storageValue),
        ),
      ],
    }
  } catch {
    return unavailableHealth()
  }
}

function summarizeTargets(samples: PrometheusVectorSample[]): {
  down: number
  total: number
  up: number
} {
  const total = samples.length
  const up = samples.filter((sample) => Number(sample.value[1]) === 1).length
  return {
    down: Math.max(total - up, 0),
    total,
    up,
  }
}

function summarizeAlerts(samples: PrometheusVectorSample[]): {
  critical: number
  total: number
  warning: number
} {
  return {
    critical: samples.filter((sample) => sample.metric.severity === "critical")
      .length,
    total: samples.length,
    warning: samples.filter((sample) => sample.metric.severity === "warning")
      .length,
  }
}

function healthSourceStatus(
  downTargets: number,
  alerts: { critical: number; total: number },
): InferenceCoreSourceStatus {
  if (downTargets > 0 || alerts.total > 0) {
    return "degraded"
  }
  return "ok"
}

function healthSummary(
  targets: { down: number; total: number; up: number },
  alerts: { total: number },
): string {
  if (targets.total === 0) {
    return "Prometheus is reachable, but no infrastructure targets are reporting yet."
  }
  return `Prometheus reports ${targets.up}/${targets.total} monitored targets up with ${alerts.total} active alert${alerts.total === 1 ? "" : "s"}.`
}

function notConfiguredHealth(): AdminHealthSummary {
  return {
    sourceStatus: "not_configured",
    summary:
      "Operational drilldowns are linked; Prometheus/Grafana summary federation is not configured for this BFF.",
    metrics: [
      metric("gpu", "GPU utilization", "Pending", "Prometheus API"),
      metric("alerts", "Alerts", 0, "No BFF alert feed", "good"),
      metric("uptime", "Targets up", "Pending", "Prometheus API"),
      metric("storage", "Max disk used", "Pending", "Prometheus API"),
    ],
  }
}

function unavailableHealth(): AdminHealthSummary {
  return {
    sourceStatus: "unavailable",
    summary:
      "Prometheus health federation is configured, but the BFF could not read it.",
    metrics: [
      metric("gpu", "GPU utilization", "Unavailable", "Prometheus API"),
      metric("alerts", "Alerts", "Unavailable", "Prometheus API", "warning"),
      metric("uptime", "Targets up", "Unavailable", "Prometheus API"),
      metric("storage", "Max disk used", "Unavailable", "Prometheus API"),
    ],
  }
}

function metric(
  id: string,
  label: string,
  value: number | string,
  detail: string | null = null,
  tone: AdminOverviewMetric["tone"] = "neutral",
): AdminOverviewMetric {
  return {
    id,
    label,
    value: typeof value === "number" ? value.toLocaleString("en-US") : value,
    detail,
    tone,
  }
}

function alertTone(alerts: {
  critical: number
  total: number
}): AdminOverviewMetric["tone"] {
  if (alerts.critical > 0) {
    return "critical"
  }
  if (alerts.total > 0) {
    return "warning"
  }
  return "good"
}

function storageTone(value: number | null): AdminOverviewMetric["tone"] {
  if (value === null) {
    return "neutral"
  }
  if (value >= 95) {
    return "critical"
  }
  if (value >= 85) {
    return "warning"
  }
  return "good"
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "Pending"
  }
  return `${Math.round(value)}%`
}
