import type {
  AdminOverviewMetric,
  HubSourceStatus,
  HubUsageSummary,
} from "@llm-machines/contracts"
import {
  LITE_LLM_LOG_SAMPLE_SIZE,
  LiteLlmAdminClient,
  liteLlmConfig,
  liteLlmDateWindow,
} from "./admin-litellm-client"
import type { LogSummary } from "./admin-ops-parsers"
import {
  summarizeLiteLlmActivity,
  summarizeLiteLlmLogs,
} from "./admin-ops-parsers"

export interface AdminOpsSummary {
  metrics: AdminOverviewMetric[]
  sourceStatus: HubSourceStatus
  summary: string
}

export async function getAdminOpsSummary(
  usage: HubUsageSummary,
): Promise<AdminOpsSummary> {
  const config = liteLlmConfig()
  if (!config) {
    return fallbackOps(
      usage,
      "Gateway usage is available; LiteLLM operational federation is not configured for this BFF.",
    )
  }

  const window = liteLlmDateWindow()
  const client = new LiteLlmAdminClient(config)

  try {
    const activity = summarizeLiteLlmActivity(
      await client.getJson(
        "/user/daily/activity/aggregated",
        new URLSearchParams({
          start_date: window.startDate,
          end_date: window.endDate,
        }),
      ),
    )
    const logs = await readLogs(client, window)

    return {
      sourceStatus: opsSourceStatus(activity.failedRequests, logs === null),
      summary: `LiteLLM reports ${formatNumber(activity.requests)} requests, ${formatNumber(activity.tokens)} tokens, and ${formatNumber(activity.failedRequests)} failed request${activity.failedRequests === 1 ? "" : "s"} in the last 30 days.`,
      metrics: [
        metric("requests", "Requests", activity.requests, "LiteLLM 30d"),
        metric("tokens", "Tokens", activity.tokens, "LiteLLM 30d"),
        metric(
          "top-model",
          "Top model",
          activity.topModel ?? fallbackTopModel(usage),
          activity.topModel ? "By request count" : "Hub fallback",
        ),
        metric(
          "p95-latency",
          "p95 latency",
          logs ? formatLatency(logs.p95LatencyMs) : "Unavailable",
          logs ? `Latest ${logs.sampleSize} successful requests` : "Spend logs",
          latencyTone(logs?.p95LatencyMs ?? null),
        ),
        metric(
          "top-user",
          "Top user",
          logs?.topUser ?? "Unavailable",
          logs?.topUser ? "Latest successful requests" : "Spend logs",
          logs?.topUser ? "neutral" : "warning",
        ),
      ],
    }
  } catch {
    return unavailableOps(usage)
  }
}

async function readLogs(
  client: LiteLlmAdminClient,
  window: { endDate: string; startDate: string },
): Promise<LogSummary | null> {
  try {
    return summarizeLiteLlmLogs(
      await client.getJson(
        "/spend/logs/v2",
        new URLSearchParams({
          start_date: window.startDate,
          end_date: window.endDate,
          page: "1",
          page_size: String(LITE_LLM_LOG_SAMPLE_SIZE),
          status_filter: "success",
        }),
      ),
    )
  } catch {
    return null
  }
}

function fallbackOps(usage: HubUsageSummary, summary: string): AdminOpsSummary {
  return {
    sourceStatus: usage.sourceStatus,
    summary,
    metrics: [
      metric("requests", "Requests", usage.prompts, "Hub usage fallback"),
      metric("tokens", "Tokens", usage.tokens, "Hub usage fallback"),
      metric("top-model", "Top model", fallbackTopModel(usage), null),
      metric("p95-latency", "p95 latency", "Pending", "LiteLLM API"),
      metric("top-user", "Top user", "Pending", "LiteLLM API"),
    ],
  }
}

function unavailableOps(usage: HubUsageSummary): AdminOpsSummary {
  return {
    sourceStatus: "unavailable",
    summary:
      "LiteLLM operational federation is configured, but the BFF could not read it.",
    metrics: [
      metric("requests", "Requests", usage.prompts, "Hub usage fallback"),
      metric("tokens", "Tokens", usage.tokens, "Hub usage fallback"),
      metric("top-model", "Top model", fallbackTopModel(usage), "Hub fallback"),
      metric("p95-latency", "p95 latency", "Unavailable", "LiteLLM API"),
      metric("top-user", "Top user", "Unavailable", "LiteLLM API", "warning"),
    ],
  }
}

function opsSourceStatus(
  failedRequests: number,
  partialLogs: boolean,
): HubSourceStatus {
  if (failedRequests > 0 || partialLogs) {
    return "degraded"
  }
  return "ok"
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
    value: typeof value === "number" ? formatNumber(value) : value,
    detail,
    tone,
  }
}

function fallbackTopModel(usage: HubUsageSummary): string {
  return usage.topModels[0] ?? "Unknown"
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US")
}

function formatLatency(value: number | null): string {
  if (value === null) {
    return "Pending"
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}s`
  }
  return `${Math.round(value)}ms`
}

function latencyTone(value: number | null): AdminOverviewMetric["tone"] {
  if (value === null) {
    return "neutral"
  }
  if (value >= 30_000) {
    return "critical"
  }
  if (value >= 10_000) {
    return "warning"
  }
  return "good"
}
