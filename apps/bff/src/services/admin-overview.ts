import type {
  AdminActivityEvent,
  AdminOverviewMetric,
  AdminOverviewResponse,
} from "@llm-machines/contracts/inference-core"
import type { Actor } from "../auth/authorization"
import { getAdminHealthSummary } from "./admin-health"
import { getAdminOpsSummary } from "./admin-ops"
import type { AuditEventRecord } from "./audit"
import { getRecentAuditEvents } from "./audit"

export async function getAdminOverview(
  actor: Actor,
): Promise<AdminOverviewResponse> {
  if (!canReadAdminOverview(actor)) {
    throw new Error("Admin overview requires Admin or Operator access.")
  }

  const generatedAt = new Date().toISOString()
  const [ops, health, auditEvents] = await Promise.all([
    getAdminOpsSummary(),
    getAdminHealthSummary(),
    getRecentAuditEvents(10),
  ])
  const activityEvents = auditEvents.map(toAdminActivityEvent)
  const applicationEvents = auditEvents.filter(isApplicationEvent)

  return {
    generatedAt,
    tiles: [
      {
        id: "applications",
        title: "Applications",
        summary:
          applicationEvents.length > 0
            ? `${applicationEvents.length} recent application event${applicationEvents.length === 1 ? "" : "s"} are visible in Console audit.`
            : "Application credentials and connection state are managed in Console.",
        href: "/applications",
        sourceStatus: "ok",
        updatedAt: generatedAt,
        metrics: [
          metric(
            "recent-events",
            "Recent events",
            applicationEvents.length,
            "Latest 10 Console audit rows",
          ),
          metric(
            "credential-rotations",
            "Credential rotations",
            applicationEvents.filter((event) =>
              event.action.includes("credential"),
            ).length,
            "Latest 10 Console audit rows",
          ),
        ],
      },
      {
        id: "inference",
        title: "Inference",
        summary: ops.summary,
        href: "/inference",
        sourceStatus: ops.sourceStatus,
        updatedAt: generatedAt,
        metrics: ops.metrics,
      },
      {
        id: "hardware",
        title: "Hardware",
        summary: health.summary,
        href: "/hardware",
        sourceStatus: health.sourceStatus,
        updatedAt: generatedAt,
        metrics: health.metrics,
      },
      {
        id: "system",
        title: "System",
        summary:
          "Console audit records retained control-plane activity. Native expert-service audit ingestion remains disabled.",
        href: "/activity",
        sourceStatus: "ok",
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

function canReadAdminOverview(actor: Actor): boolean {
  return actor.role === "admin" || actor.role === "operator"
}

function isApplicationEvent(event: AuditEventRecord): boolean {
  const scope = `${event.action} ${event.targetType}`.toLowerCase()
  return (
    scope.includes("application") ||
    scope.includes("connected_app") ||
    scope.includes("app_gateway")
  )
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
    href: `/activity?event=${encodeURIComponent(event.id)}`,
    createdAt: event.createdAt,
  }
}
