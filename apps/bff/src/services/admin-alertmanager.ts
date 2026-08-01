import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { open } from "node:fs/promises"
import { isAbsolute } from "node:path"
import type {
  AdminHardwareAlert,
  InferenceCoreSourceStatus,
} from "@llm-machines/contracts/inference-core"
import {
  fetchBoundedJson,
  serviceApiUrl,
  validatedHttpBaseUrl,
} from "./admin-prometheus"

export interface AdminAlertmanagerSummary {
  alerts: AdminHardwareAlert[]
  sourceStatus: InferenceCoreSourceStatus
  summary: string
}

const ALLOWED_LABELS = ["alertname", "severity", "component"] as const
const ALLOWED_LABEL_SET = new Set<string>(ALLOWED_LABELS)
const ALLOWED_ALERT_NAMES = new Set([
  "LLMMGpuSaturation",
  "LLMMInferenceFailureRatioHigh",
  "LLMMInferenceQueueDepthPersisting",
  "LLMMInferenceQueueDepthSignalMissing",
])
const DEFAULT_TIMEOUT_MS = 2000
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024
const MAX_ALERTS = 200
const MAX_LABEL_VALUE_LENGTH = 512
const MAX_TOKEN_FILE_BYTES = 4096

export async function getAdminAlertmanagerSummary(): Promise<AdminAlertmanagerSummary> {
  const configuredBaseUrl = process.env.ADMIN_ALERTMANAGER_BASE_URL?.trim()
  if (!configuredBaseUrl) {
    return {
      alerts: [],
      sourceStatus: "not_configured",
      summary: "Alertmanager federation is not configured for this BFF.",
    }
  }

  try {
    const baseUrl = validatedHttpBaseUrl(configuredBaseUrl, "Alertmanager")
    const url = serviceApiUrl(baseUrl, "/api/v2/alerts")
    url.searchParams.set("active", "true")
    url.searchParams.set("silenced", "false")
    url.searchParams.set("inhibited", "false")
    const payload = await fetchBoundedJson(url, {
      bearerToken: await alertmanagerBearerToken(),
      maxResponseBytes: boundedEnvInteger(
        "ADMIN_ALERTMANAGER_MAX_RESPONSE_BYTES",
        1024,
        8 * 1024 * 1024,
        DEFAULT_MAX_RESPONSE_BYTES,
      ),
      timeoutMs: boundedEnvInteger(
        "ADMIN_ALERTMANAGER_TIMEOUT_MS",
        100,
        30_000,
        DEFAULT_TIMEOUT_MS,
      ),
    })
    const parsed = parseActiveAlerts(payload)
    const sourceStatus: InferenceCoreSourceStatus =
      parsed.rejected > 0 ? "degraded" : "ok"
    return {
      alerts: parsed.alerts,
      sourceStatus,
      summary: alertmanagerSummary(parsed.alerts.length, parsed.rejected),
    }
  } catch {
    return {
      alerts: [],
      sourceStatus: "unavailable",
      summary:
        "Alertmanager federation is configured, but active alerts could not be read.",
    }
  }
}

function parseActiveAlerts(payload: unknown): {
  alerts: AdminHardwareAlert[]
  rejected: number
} {
  if (!Array.isArray(payload) || payload.length > MAX_ALERTS) {
    throw new Error("Invalid Alertmanager active-alert response.")
  }
  const alerts: AdminHardwareAlert[] = []
  let rejected = 0
  for (const value of payload) {
    const alert = parseActiveAlert(value)
    if (alert) {
      alerts.push(alert)
    } else {
      rejected += 1
    }
  }
  alerts.sort((first, second) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 } as const
    return (
      severityOrder[first.severity] - severityOrder[second.severity] ||
      first.alertName.localeCompare(second.alertName) ||
      first.id.localeCompare(second.id)
    )
  })
  return { alerts, rejected }
}

function parseActiveAlert(value: unknown): AdminHardwareAlert | null {
  if (!isRecord(value) || !isRecord(value.labels)) {
    return null
  }
  if (!isRecord(value.status) || value.status.state !== "active") {
    return null
  }
  const labels = projectLabels(value.labels)
  const alertName = labels.alertname
  if (!alertName || !labels.severity || labels.component !== "inference") {
    return null
  }
  const startedAt = normalizedDate(value.startsAt)

  return {
    id: stableAlertId(labels, startedAt),
    alertName,
    severity: normalizedSeverity(labels.severity),
    host: null,
    device: null,
    summary: `Alert ${alertName} is firing.`,
    description: null,
    startedAt,
    grafanaUrl: null,
    alertmanagerUrl: null,
    labels,
  }
}

function projectLabels(value: Record<string, unknown>): Record<string, string> {
  const projected: Record<string, string> = {}
  for (const [key, labelValue] of Object.entries(value)) {
    if (!ALLOWED_LABEL_SET.has(key)) {
      continue
    }
    if (!isSafeLabelValue(key, labelValue)) {
      continue
    }
    projected[key] = labelValue
  }
  return projected
}

function stableAlertId(
  labels: Record<string, string>,
  startedAt: string | null,
): string {
  const canonicalLabels = Object.entries(labels).sort(([first], [second]) =>
    first.localeCompare(second),
  )
  return `alert-${createHash("sha256")
    .update(JSON.stringify([canonicalLabels, startedAt]))
    .digest("hex")
    .slice(0, 24)}`
}

function normalizedSeverity(
  value: string | undefined,
): AdminHardwareAlert["severity"] {
  if (value === "critical" || value === "warning") {
    return value
  }
  return "info"
}

function normalizedDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function alertmanagerSummary(alertCount: number, rejected: number): string {
  const alertLabel = `${alertCount} active alert${alertCount === 1 ? "" : "s"}`
  if (rejected > 0) {
    return `Alertmanager reports ${alertLabel}; ${rejected} malformed alert${rejected === 1 ? " was" : "s were"} omitted.`
  }
  return `Alertmanager reports ${alertLabel}.`
}

function boundedEnvInteger(
  name: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback
}

async function alertmanagerBearerToken(): Promise<string | undefined> {
  const configuredPath =
    process.env.ADMIN_ALERTMANAGER_BEARER_TOKEN_FILE?.trim()
  if (!configuredPath) {
    return undefined
  }
  if (!isAbsolute(configuredPath)) {
    throw new Error("Alertmanager bearer token file path is invalid.")
  }

  const file = await open(
    configuredPath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  )
  try {
    const metadata = await file.stat()
    if (
      !metadata.isFile() ||
      metadata.size === 0 ||
      metadata.size > MAX_TOKEN_FILE_BYTES ||
      (metadata.mode & 0o077) !== 0
    ) {
      throw new Error("Alertmanager bearer token file is not private.")
    }
    const raw = await file.readFile({ encoding: "utf8" })
    const token = raw.endsWith("\r\n")
      ? raw.slice(0, -2)
      : raw.endsWith("\n")
        ? raw.slice(0, -1)
        : raw
    if (!/^[!-~]{32,4096}$/.test(token)) {
      throw new Error("Alertmanager bearer token file is invalid.")
    }
    return token
  } finally {
    await file.close()
  }
}

function isSafeLabelValue(key: string, value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_LABEL_VALUE_LENGTH
  ) {
    return false
  }
  if (key === "severity") {
    return value === "critical" || value === "warning" || value === "info"
  }
  if (key === "alertname") {
    return ALLOWED_ALERT_NAMES.has(value)
  }
  return key === "component" && value === "inference"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
