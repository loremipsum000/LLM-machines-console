import type {
  AdminOverviewMetric,
  HubSourceStatus,
} from "@llm-machines/contracts"
import type { PureModeRecord } from "./admin-governance-state"
import {
  readGovernanceState,
  resetGovernanceForTest,
  seedGovernanceForTest,
} from "./admin-governance-state"

export { resetGovernanceForTest, seedGovernanceForTest }

export interface AdminGovernanceSummary {
  metrics: AdminOverviewMetric[]
  sourceStatus: HubSourceStatus
  summary: string
}

export async function getAdminGovernanceSummary(input: {
  connectorsAwaitingReview: number
  pendingSubmissions: number
}): Promise<AdminGovernanceSummary> {
  const source = await readGovernanceState()

  if (source.sourceStatus === "not_configured") {
    return {
      sourceStatus: statusWithReviewQueues("not_configured", input),
      summary:
        "Publishing and connector gates are enforced; policy and Pure Mode federation is not configured for this BFF.",
      metrics: governanceMetrics(input, [
        metric(
          "policy-violations",
          "Policy violations",
          "Pending",
          "Console DB",
        ),
        metric("pure-mode", "Pure Mode", "Pending", "Console DB"),
      ]),
    }
  }

  if (source.sourceStatus === "unavailable") {
    return {
      sourceStatus: "unavailable",
      summary:
        "Governance federation is configured, but the BFF could not read policy violations or Pure Mode state.",
      metrics: governanceMetrics(input, [
        metric(
          "policy-violations",
          "Policy violations",
          "Unavailable",
          "Console DB",
          "warning",
        ),
        metric(
          "pure-mode",
          "Pure Mode",
          "Unavailable",
          "Console DB",
          "warning",
        ),
      ]),
    }
  }

  const violations = source.policyViolations
  const pureMode = source.pureMode
  return {
    sourceStatus: governanceSourceStatus(input, violations, pureMode),
    summary: `Governance DB reports ${violations.total} policy violation${violations.total === 1 ? "" : "s"} in 24h and Pure Mode ${pureMode.active ? "active" : "inactive"}.`,
    metrics: governanceMetrics(input, [
      metric(
        "policy-violations",
        "Policy violations",
        violations.total,
        `${violations.critical} critical in 24h`,
        policyTone(violations),
      ),
      metric(
        "pure-mode",
        "Pure Mode",
        pureMode.active ? "Active" : "Inactive",
        pureMode.active
          ? `${pureMode.affectedComponents.length} components affected`
          : "No activation recorded",
        pureMode.active ? "critical" : "good",
      ),
    ]),
  }
}

function governanceMetrics(
  input: { connectorsAwaitingReview: number; pendingSubmissions: number },
  federatedMetrics: AdminOverviewMetric[],
): AdminOverviewMetric[] {
  return [
    metric(
      "pending-submissions",
      "Submissions",
      input.pendingSubmissions,
      "Awaiting review",
      input.pendingSubmissions > 0 ? "warning" : "good",
    ),
    metric(
      "blocked-connectors",
      "Connector review",
      input.connectorsAwaitingReview,
      "Awaiting vetting",
      input.connectorsAwaitingReview > 0 ? "critical" : "good",
    ),
    ...federatedMetrics,
  ]
}

function governanceSourceStatus(
  input: { connectorsAwaitingReview: number; pendingSubmissions: number },
  violations: { critical: number; total: number },
  pureMode: PureModeRecord,
): HubSourceStatus {
  if (
    input.connectorsAwaitingReview > 0 ||
    input.pendingSubmissions > 0 ||
    violations.total > 0 ||
    pureMode.active
  ) {
    return "degraded"
  }
  return "ok"
}

function statusWithReviewQueues(
  status: HubSourceStatus,
  input: { connectorsAwaitingReview: number; pendingSubmissions: number },
): HubSourceStatus {
  if (input.connectorsAwaitingReview > 0 || input.pendingSubmissions > 0) {
    return "degraded"
  }
  return status
}

function policyTone(violations: {
  critical: number
  total: number
}): AdminOverviewMetric["tone"] {
  if (violations.critical > 0) {
    return "critical"
  }
  if (violations.total > 0) {
    return "warning"
  }
  return "good"
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
