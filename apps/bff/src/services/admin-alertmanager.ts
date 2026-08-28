import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { open } from "node:fs/promises"
import { isAbsolute } from "node:path"
import {
  type AdminHardwareAlert,
  type InferenceCoreSeverity,
  type InferenceCoreSourceStatus,
  inferenceCoreAlertNames,
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

const ALLOWED_ALERT_NAMES = new Set(inferenceCoreAlertNames)
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
    url.searchParams.append("filter", 'component="inference"')
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
    const omitted = parsed.malformed + parsed.unsupported + parsed.truncated
    const sourceStatus: InferenceCoreSourceStatus =
      omitted > 0 ? "degraded" : "ok"
    return {
      alerts: parsed.alerts,
      sourceStatus,
      summary: alertmanagerSummary(parsed),
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
  malformed: number
  unsupported: number
  truncated: number
} {
  if (!Array.isArray(payload)) {
    throw new Error("Invalid Alertmanager active-alert response.")
  }
  const alerts: AdminHardwareAlert[] = []
  let malformed = 0
  let unsupported = 0
  for (const value of payload) {
    const result = parseActiveAlert(value)
    if (result.kind === "accepted") {
      alerts.push(result.alert)
    } else if (result.kind === "unsupported") {
      unsupported += 1
    } else {
      malformed += 1
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
  const truncated = Math.max(0, alerts.length - MAX_ALERTS)
  return {
    alerts: alerts.slice(0, MAX_ALERTS),
    malformed,
    unsupported,
    truncated,
  }
}

type ParsedActiveAlert =
  | { alert: AdminHardwareAlert; kind: "accepted" }
  | { kind: "malformed" }
  | { kind: "unsupported" }

function parseActiveAlert(value: unknown): ParsedActiveAlert {
  if (!isRecord(value) || !isRecord(value.labels)) {
    return { kind: "malformed" }
  }
  if (!isRecord(value.status) || value.status.state !== "active") {
    return { kind: "malformed" }
  }
  const alertName = requiredSafeLabelValue(value.labels.alertname)
  const component = requiredSafeLabelValue(value.labels.component)
  const severity = parsedSeverity(value.labels.severity)
  if (!alertName || !component || !severity) {
    return { kind: "malformed" }
  }
  if (!/^[A-Za-z][A-Za-z0-9]{0,127}$/.test(alertName)) {
    return { kind: "malformed" }
  }
  if (component !== "inference" || !ALLOWED_ALERT_NAMES.has(alertName)) {
    return { kind: "unsupported" }
  }
  const startedAt = normalizedDate(value.startsAt)
  const labels = { alertname: alertName, component, severity }

  return {
    kind: "accepted",
    alert: {
      id: stableAlertId(labels, startedAt),
      alertName,
      severity,
      host: null,
      device: null,
      summary: `Alert ${alertName} is firing.`,
      description: null,
      startedAt,
      grafanaUrl: null,
      alertmanagerUrl: null,
      labels,
    },
  }
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

function parsedSeverity(value: unknown): InferenceCoreSeverity | null {
  return value === "critical" || value === "warning" || value === "info"
    ? value
    : null
}

function normalizedDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function alertmanagerSummary(parsed: {
  alerts: AdminHardwareAlert[]
  malformed: number
  unsupported: number
  truncated: number
}): string {
  const alertCount = parsed.alerts.length
  const alertLabel = `${alertCount} active alert${alertCount === 1 ? "" : "s"}`
  const omissions = [
    omissionSummary(parsed.malformed, "malformed or unsafe"),
    omissionSummary(parsed.unsupported, "unsupported-contract"),
    omissionSummary(parsed.truncated, "additional admitted", "truncated"),
  ].filter((value): value is string => value !== null)
  if (omissions.length > 0) {
    return `Alertmanager reports ${alertLabel}; ${omissions.join("; ")}.`
  }
  return `Alertmanager reports ${alertLabel}.`
}

function omissionSummary(
  count: number,
  classification: string,
  action = "omitted",
): string | null {
  return count > 0
    ? `${count} ${classification} alert${count === 1 ? " was" : "s were"} ${action}`
    : null
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

function requiredSafeLabelValue(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_LABEL_VALUE_LENGTH
  ) {
    return null
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
