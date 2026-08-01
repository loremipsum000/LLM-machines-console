import type {
  AdminOverviewMetric,
  InferenceCoreSourceStatus,
} from "@llm-machines/contracts/inference-core"
import {
  type AdminAlertmanagerSummary,
  getAdminAlertmanagerSummary,
} from "./admin-alertmanager"
import {
  PrometheusClient,
  type PrometheusVectorSample,
  firstFiniteValue,
} from "./admin-prometheus"

export interface AdminHealthSummary {
  metrics: AdminOverviewMetric[]
  sourceStatus: InferenceCoreSourceStatus
  summary: string
}

interface PrometheusHealthRead {
  gpuValue: number | null
  sourceStatus: InferenceCoreSourceStatus
  storageValue: number | null
  summary: string
  targets: { down: number; total: number; up: number } | null
}

const TARGET_UP_QUERY = 'up{job=~"node|dcgm|ipmi|infra_https_endpoint"}'
const DCGM_GPU_QUERY = "max(DCGM_FI_DEV_GPU_UTIL)"
const TEXTFILE_GPU_QUERY = "max(llmm_nvidia_gpu_utilization_percent)"
const STORAGE_QUERY =
  'max(100 * (1 - (node_filesystem_avail_bytes{job="node",fstype!~"tmpfs|devtmpfs|overlay|squashfs",mountpoint!~"/run.*|/var/lib/docker/.+"} / node_filesystem_size_bytes{job="node",fstype!~"tmpfs|devtmpfs|overlay|squashfs",mountpoint!~"/run.*|/var/lib/docker/.+"})))'

export async function getAdminHealthSummary(): Promise<AdminHealthSummary> {
  const [prometheus, alertmanager] = await Promise.all([
    readPrometheusHealth(),
    getAdminAlertmanagerSummary(),
  ])
  const targetValue = prometheus.targets
    ? `${prometheus.targets.up}/${prometheus.targets.total}`
    : sourceValue(prometheus.sourceStatus)
  const targetDetail = prometheus.targets
    ? `${prometheus.targets.down} down`
    : "Prometheus API"
  const alertValue =
    alertmanager.sourceStatus === "ok" ||
    alertmanager.sourceStatus === "degraded"
      ? alertmanager.alerts.length
      : sourceValue(alertmanager.sourceStatus)

  return {
    sourceStatus: combinedHealthStatus(prometheus, alertmanager),
    summary: `${prometheus.summary} ${alertmanager.summary}`,
    metrics: [
      metric(
        "gpu",
        "GPU utilization",
        prometheus.sourceStatus === "ok" ||
          prometheus.sourceStatus === "degraded"
          ? formatPercent(prometheus.gpuValue)
          : sourceValue(prometheus.sourceStatus),
        "Peak observed GPU",
        prometheus.gpuValue === null ? "neutral" : "good",
      ),
      metric(
        "alerts",
        "Alerts",
        alertValue,
        alertmanager.sourceStatus === "degraded"
          ? alertmanager.summary
          : "Alertmanager active alerts",
        alertTone(alertmanager),
      ),
      metric(
        "uptime",
        "Targets up",
        targetValue,
        targetDetail,
        targetTone(prometheus),
      ),
      metric(
        "storage",
        "Max disk used",
        prometheus.sourceStatus === "ok" ||
          prometheus.sourceStatus === "degraded"
          ? formatPercent(prometheus.storageValue)
          : sourceValue(prometheus.sourceStatus),
        "Node filesystems",
        storageTone(prometheus.storageValue),
      ),
    ],
  }
}

async function readPrometheusHealth(): Promise<PrometheusHealthRead> {
  const baseUrl = process.env.ADMIN_PROMETHEUS_BASE_URL?.trim()
  if (!baseUrl) {
    return {
      gpuValue: null,
      sourceStatus: "not_configured",
      storageValue: null,
      summary: "Prometheus health federation is not configured for this BFF.",
      targets: null,
    }
  }

  try {
    const client = new PrometheusClient(baseUrl)
    const [targets, dcgmGpu, textfileGpu, storage] = await Promise.all([
      client.query(TARGET_UP_QUERY),
      client.query(DCGM_GPU_QUERY),
      client.query(TEXTFILE_GPU_QUERY),
      client.query(STORAGE_QUERY),
    ])
    const targetSummary = summarizeTargets(targets)
    const gpuValue = firstFiniteValue(dcgmGpu) ?? firstFiniteValue(textfileGpu)
    const storageValue = firstFiniteValue(storage)
    return {
      gpuValue,
      sourceStatus:
        targetSummary.total === 0 ||
        targetSummary.down > 0 ||
        gpuValue === null ||
        storageValue === null
          ? "degraded"
          : "ok",
      storageValue,
      summary:
        targetSummary.total === 0
          ? "Prometheus is reachable, but no infrastructure targets are reporting yet."
          : `Prometheus reports ${targetSummary.up}/${targetSummary.total} monitored targets up.`,
      targets: targetSummary,
    }
  } catch {
    return {
      gpuValue: null,
      sourceStatus: "unavailable",
      storageValue: null,
      summary:
        "Prometheus health federation is configured, but the BFF could not read it.",
      targets: null,
    }
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

function combinedHealthStatus(
  prometheus: PrometheusHealthRead,
  alertmanager: AdminAlertmanagerSummary,
): InferenceCoreSourceStatus {
  const statuses = [prometheus.sourceStatus, alertmanager.sourceStatus]
  if (statuses.every((status) => status === "not_configured")) {
    return "not_configured"
  }
  if (prometheus.sourceStatus === "unavailable") {
    return "unavailable"
  }
  if (statuses.every((status) => status === "ok")) {
    return "ok"
  }
  return "degraded"
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

function alertTone(
  alertmanager: AdminAlertmanagerSummary,
): AdminOverviewMetric["tone"] {
  if (alertmanager.sourceStatus === "unavailable") {
    return "warning"
  }
  if (alertmanager.alerts.some((alert) => alert.severity === "critical")) {
    return "critical"
  }
  if (alertmanager.alerts.length > 0) {
    return "warning"
  }
  return alertmanager.sourceStatus === "ok" ? "good" : "neutral"
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

function targetTone(
  prometheus: PrometheusHealthRead,
): AdminOverviewMetric["tone"] {
  if (prometheus.sourceStatus === "unavailable") {
    return "warning"
  }
  if (!prometheus.targets) {
    return "neutral"
  }
  return prometheus.targets.total === 0 || prometheus.targets.down > 0
    ? "warning"
    : "good"
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "Pending"
  }
  return `${Math.round(value)}%`
}

function sourceValue(status: InferenceCoreSourceStatus): string {
  if (status === "not_configured") {
    return "Pending"
  }
  if (status === "unavailable") {
    return "Unavailable"
  }
  return "Pending"
}
