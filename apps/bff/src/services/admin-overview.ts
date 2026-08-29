import {
  type AdminConnectedAppsResponse,
  type AdminInferenceDashboard,
  type AdminOverviewMetric,
  type AdminOverviewResponse,
  type AdminOverviewTile,
  type AdminOverviewTokenUsage,
  type InferenceCoreSourceStatus,
  aggregateInferenceCoreSourceStatus,
  inferenceCoreCustomerVocabulary,
} from "@llm-machines/contracts/inference-core"
import type { Actor } from "../auth/authorization"
import { getAdminConnectedAppsProjection } from "./admin-connected-apps"
import { type AdminHealthSummary, getAdminHealthSummary } from "./admin-health"
import { getAdminInference } from "./admin-inference"

interface SourceRead<T> {
  data: T | null
  sourceStatus: InferenceCoreSourceStatus
}

export async function getAdminOverview(
  actor: Actor,
): Promise<AdminOverviewResponse> {
  if (!canReadAdminOverview(actor)) {
    throw new Error("Admin overview requires Admin or Operator access.")
  }

  const generatedAt = new Date().toISOString()
  const [applications, inference, health] = await Promise.all([
    readSource(() => getAdminConnectedAppsProjection()),
    readSource(() => getAdminInference(actor, { range: "90d" })),
    readSource(() => getAdminHealthSummary()),
  ])
  const tiles = [
    applicationsTile(applications, generatedAt),
    inferenceTile(inference, generatedAt),
    hardwareTile(health, generatedAt),
    systemTile(
      [applications.sourceStatus, inference.sourceStatus, health.sourceStatus],
      generatedAt,
    ),
  ] satisfies AdminOverviewTile[]

  return {
    generatedAt,
    tiles,
    tokenUsage: tokenUsageProjection(inference, generatedAt),
  }
}

function applicationsTile(
  applications: SourceRead<AdminConnectedAppsResponse>,
  generatedAt: string,
): AdminOverviewTile {
  if (!applications.data) {
    return unavailableTile({
      generatedAt,
      href: inferenceCoreCustomerVocabulary.primaryIntegration.href,
      id: "applications",
      metricLabels: ["Keys", "Connected", "Firecrawl enabled"],
      summary: "Key state is unavailable. Open Keys after the source recovers.",
      title: "Keys",
    })
  }

  const apps = applications.data.apps
  const connected = apps.filter(
    (application) => application.connectionStatus === "connected",
  ).length
  const firecrawlEnabled = apps.filter(
    (application) => application.firecrawl.status === "enabled",
  ).length
  const attentionRequired = apps.filter(
    (application) =>
      application.status === "disabled" ||
      application.connectionStatus !== "connected",
  ).length

  return {
    href: inferenceCoreCustomerVocabulary.primaryIntegration.href,
    id: "applications",
    metrics: [
      metric("applications", "Keys", apps.length, "Current registry"),
      metric(
        "connected",
        "Connected",
        connected,
        "Latest connection evidence",
        connected === apps.length && apps.length > 0 ? "good" : "neutral",
      ),
      metric(
        "firecrawl-enabled",
        "Firecrawl enabled",
        firecrawlEnabled,
        "Per-Key access",
      ),
    ],
    sourceStatus: applications.data.sourceStatus,
    summary:
      apps.length === 0
        ? "No inference Keys are registered yet."
        : `${apps.length} Key${apps.length === 1 ? "" : "s"} registered; ${attentionRequired} require${attentionRequired === 1 ? "s" : ""} attention.`,
    title: "Keys",
    updatedAt: applications.data.generatedAt,
  }
}

function inferenceTile(
  inference: SourceRead<AdminInferenceDashboard>,
  generatedAt: string,
): AdminOverviewTile {
  if (!inference.data) {
    return unavailableTile({
      generatedAt,
      href: "/inference",
      id: "inference",
      metricLabels: ["Requests", "Tokens", "Models served", "Top model"],
      summary:
        "Inference usage and model inventory are unavailable from LiteLLM.",
      title: "Inference",
    })
  }

  const dashboard = inference.data
  const topModel =
    dashboard.modelUsage.reduce<(typeof dashboard.modelUsage)[number] | null>(
      (top, current) =>
        !top || current.requests > top.requests ? current : top,
      null,
    )?.model ?? null

  return {
    href: "/inference",
    id: "inference",
    metrics: [
      metric(
        "requests",
        "Requests",
        sourceMetricValue(
          dashboard.aggregateUsageSourceStatus,
          dashboard.totals?.requests ?? null,
        ),
        `LiteLLM ${dashboard.range}`,
      ),
      metric(
        "tokens",
        "Tokens",
        sourceMetricValue(
          dashboard.aggregateUsageSourceStatus,
          dashboard.totals?.tokens ?? null,
        ),
        `LiteLLM ${dashboard.range}`,
      ),
      metric(
        "models",
        "Models served",
        sourceMetricValue(
          dashboard.modelInventorySourceStatus,
          dashboard.models.length,
        ),
        "LiteLLM model inventory",
      ),
      metric(
        "top-model",
        "Top model",
        sourceTextValue(
          dashboard.aggregateUsageSourceStatus,
          topModel ?? "None reported",
        ),
        topModel ? "By aggregate request count" : "LiteLLM aggregate usage",
      ),
    ],
    sourceStatus: dashboard.sourceStatus,
    summary: dashboard.summary,
    title: "Inference",
    updatedAt: dashboard.generatedAt,
  }
}

function hardwareTile(
  health: SourceRead<AdminHealthSummary>,
  generatedAt: string,
): AdminOverviewTile {
  if (!health.data) {
    return unavailableTile({
      generatedAt,
      href: "/hardware",
      id: "hardware",
      metricLabels: [
        "GPU utilization",
        "Alerts",
        "Targets up",
        "Max disk used",
      ],
      summary:
        "Hardware, service-target, and alert status are unavailable from the observability sources.",
      title: "Hardware",
    })
  }

  return {
    href: "/hardware",
    id: "hardware",
    metrics: health.data.metrics,
    sourceStatus: health.data.sourceStatus,
    summary: health.data.summary,
    title: "Hardware",
    updatedAt: generatedAt,
  }
}

function systemTile(
  sourceStatuses: InferenceCoreSourceStatus[],
  generatedAt: string,
): AdminOverviewTile {
  const sourceStatus = aggregateInferenceCoreSourceStatus(sourceStatuses)

  return {
    href: "/settings",
    id: "system",
    metrics: [
      metric(
        "system-status",
        "System status",
        sourceStatusLabel(sourceStatus),
        "Combined Console source preview",
        sourceStatusTone(sourceStatus),
      ),
      metric(
        "update-status",
        "Update status",
        "Unavailable",
        "Update status is not available in Overview.",
        "neutral",
      ),
    ],
    sourceStatus,
    summary: systemSummary(sourceStatus),
    title: "System",
    updatedAt: generatedAt,
  }
}

function unavailableTile({
  generatedAt,
  href,
  id,
  metricLabels,
  summary,
  title,
}: {
  generatedAt: string
  href: AdminOverviewTile["href"]
  id: AdminOverviewTile["id"]
  metricLabels: string[]
  summary: string
  title: string
}): AdminOverviewTile {
  return {
    href,
    id,
    metrics: metricLabels.map((label) =>
      metric(
        slugify(label),
        label,
        "Unavailable",
        "Source unavailable",
        "warning",
      ),
    ),
    sourceStatus: "unavailable",
    summary,
    title,
    updatedAt: generatedAt,
  }
}

async function readSource<T>(
  read: () => Promise<T>,
  successStatus?: InferenceCoreSourceStatus,
): Promise<SourceRead<T>> {
  try {
    const data = await read()
    return {
      data,
      sourceStatus:
        successStatus ?? sourceStatusFromData(data) ?? "unavailable",
    }
  } catch {
    return { data: null, sourceStatus: "unavailable" }
  }
}

function sourceStatusFromData(
  value: unknown,
): InferenceCoreSourceStatus | null {
  if (!value || typeof value !== "object" || !("sourceStatus" in value)) {
    return null
  }
  const status = value.sourceStatus
  return status === "ok" ||
    status === "degraded" ||
    status === "unavailable" ||
    status === "not_configured"
    ? status
    : null
}

function systemSummary(sourceStatus: InferenceCoreSourceStatus): string {
  if (sourceStatus === "unavailable") {
    return "Console cannot currently read its operational source previews."
  }
  if (sourceStatus === "not_configured") {
    return "Operational source previews are not configured for this BFF."
  }
  if (sourceStatus === "degraded") {
    return "One or more operational source previews require attention."
  }
  return "Keys, inference, and hardware sources are reporting normally."
}

function tokenUsageProjection(
  inference: SourceRead<AdminInferenceDashboard>,
  generatedAt: string,
): AdminOverviewTokenUsage {
  const dashboard = inference.data
  if (!dashboard || dashboard.aggregateUsageSourceStatus !== "ok") {
    return {
      points: [],
      range: "90d",
      sourceStatus:
        dashboard?.aggregateUsageSourceStatus ?? inference.sourceStatus,
    }
  }

  const endDate = utcDateStart(generatedAt)
  const firstDate = new Date(endDate.getTime() - 89 * 24 * 60 * 60 * 1000)
  const totalsByDate = new Map<string, number>()
  for (const point of dashboard.usagePoints) {
    const pointDate = utcDateStart(point.timestamp)
    if (pointDate < firstDate || pointDate > endDate) {
      continue
    }
    const date = pointDate.toISOString().slice(0, 10)
    totalsByDate.set(date, (totalsByDate.get(date) ?? 0) + point.tokens)
  }

  return {
    points: [...totalsByDate.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, tokens]) => ({ date, tokens })),
    range: "90d",
    sourceStatus: "ok",
  }
}

function utcDateStart(value: string): Date {
  const parsed = new Date(value)
  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ),
  )
}

function sourceMetricValue(
  status: InferenceCoreSourceStatus,
  value: number | null,
): number | string {
  if (status === "not_configured") {
    return "Not configured"
  }
  if (status !== "ok" || value === null) {
    return "Unavailable"
  }
  return value
}

function sourceTextValue(
  status: InferenceCoreSourceStatus,
  value: string,
): string {
  if (status === "not_configured") {
    return "Not configured"
  }
  if (status !== "ok") {
    return "Unavailable"
  }
  return value
}

function sourceStatusLabel(status: InferenceCoreSourceStatus): string {
  return {
    degraded: "Needs attention",
    not_configured: "Not configured",
    ok: "Operational",
    unavailable: "Unavailable",
  }[status]
}

function sourceStatusTone(
  status: InferenceCoreSourceStatus,
): AdminOverviewMetric["tone"] {
  if (status === "ok") {
    return "good"
  }
  if (status === "unavailable") {
    return "critical"
  }
  return status === "degraded" ? "warning" : "neutral"
}

function canReadAdminOverview(actor: Actor): boolean {
  return actor.role === "admin" || actor.role === "operator"
}

function metric(
  id: string,
  label: string,
  value: number | string,
  detail: string | null = null,
  tone: AdminOverviewMetric["tone"] = "neutral",
): AdminOverviewMetric {
  return {
    detail,
    id,
    label,
    tone,
    value: typeof value === "number" ? value.toLocaleString("en-US") : value,
  }
}

function slugify(value: string): string {
  return value.toLowerCase().replaceAll(" ", "-")
}
