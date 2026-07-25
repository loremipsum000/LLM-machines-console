import type {
  AdminActivityEvent,
  AdminOverviewMetric,
  AdminOverviewResponse,
} from "@llm-machines/contracts"
import { personaCanAccess } from "@llm-machines/contracts"
import type { Actor } from "../auth/persona"
import { canUseBffFixtureData } from "../config/fixture-mode"
import { getAdminConnectorRegistryReadModel } from "./admin-connector-registry"
import { getAdminGovernanceSummary } from "./admin-governance"
import { getAdminHealthSummary } from "./admin-health"
import { getAdminOpsSummary } from "./admin-ops"
import type { AuditEventRecord } from "./audit"
import { getRecentAuditEvents } from "./audit"
import { getBuilderSubmissions } from "./builder"
import { getHubUsage } from "./hub"

export async function getAdminOverview(
  actor: Actor,
): Promise<AdminOverviewResponse> {
  if (!personaCanAccess(actor.persona, "admin")) {
    throw new Error("Admin overview requires admin persona.")
  }

  const generatedAt = new Date().toISOString()
  const usage = await getHubUsage(actor)
  const ops = await getAdminOpsSummary(usage)
  const health = await getAdminHealthSummary()
  const submissions = await getBuilderSubmissions(actor)
  const pendingSubmissions = submissions.filter(
    (submission) => submission.state === "submitted",
  )
  const connectorRegistry = await getAdminConnectorRegistryReadModel()
  const governance = await getAdminGovernanceSummary({
    connectorsAwaitingReview: connectorRegistry.summary.pendingCount,
    pendingSubmissions: pendingSubmissions.length,
  })
  const auditEvents = await getRecentAuditEvents(10)
  const activityEvents = auditEvents.map(toAdminActivityEvent)

  return {
    generatedAt,
    tiles: [
      {
        id: "ops",
        title: "LLM operations",
        summary: ops.summary,
        href: "/inference",
        sourceStatus: ops.sourceStatus,
        updatedAt: generatedAt,
        metrics: ops.metrics,
      },
      {
        id: "health",
        title: "Health",
        summary: health.summary,
        href: externalDashboardUrl(
          configuredExternalBaseUrl(
            "GRAFANA_PUBLIC_URL",
            "GRAFANA_PUBLIC_ORIGIN",
            "https://grafana.example.test",
          ),
          "/d/llmm-infra-overview/llm-machines-infrastructure-overview",
        ),
        sourceStatus: health.sourceStatus,
        updatedAt: generatedAt,
        metrics: health.metrics,
      },
      {
        id: "governance",
        title: "Governance",
        summary: governance.summary,
        href:
          pendingSubmissions.length > 0
            ? "/applications"
            : "/settings",
        sourceStatus: governance.sourceStatus,
        updatedAt: generatedAt,
        metrics: governance.metrics,
      },
      {
        id: "activity",
        title: "Activity",
        summary:
          "Recent Console audit rows are available; external audit sources remain future federators.",
        href: "#audit-log-deferred",
        sourceStatus: activityEvents.length > 0 ? "ok" : "degraded",
        updatedAt: generatedAt,
        metrics: [
          metric("events", "Audit events", activityEvents.length, "Latest 10"),
          metric(
            "last-action",
            "Last action",
            activityEvents[0]?.action ?? "No events",
            activityEvents[0]?.actorId ?? null,
          ),
          metric(
            "auth-denials",
            "Auth denials",
            auditEvents.filter((event) => event.action === "auth.denied")
              .length,
            "Latest 10",
            auditEvents.some((event) => event.action === "auth.denied")
              ? "warning"
              : "good",
          ),
        ],
      },
    ],
    activityEvents,
  }
}

function configuredExternalBaseUrl(
  primaryEnv: string,
  fallbackEnv: string,
  fixtureDefault: string,
): string {
  return (
    process.env[primaryEnv]?.trim() ||
    process.env[fallbackEnv]?.trim() ||
    (canUseBffFixtureData() ? fixtureDefault : "/hardware")
  )
}

function externalDashboardUrl(baseUrl: string, defaultPath: string): string {
  try {
    const parsed = new URL(baseUrl)
    if (parsed.pathname && parsed.pathname !== "/") {
      return parsed.toString()
    }
    return new URL(defaultPath, parsed).toString()
  } catch {
    return baseUrl
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

function toAdminActivityEvent(event: AuditEventRecord): AdminActivityEvent {
  return {
    id: event.id,
    actorId: event.actorId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    severity:
      event.action.includes("failed") || event.action.includes("denied")
        ? "warning"
        : "info",
    href: "#audit-log-deferred",
    createdAt: event.createdAt,
  }
}
