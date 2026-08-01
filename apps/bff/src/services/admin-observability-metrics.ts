import { type SQL, sql } from "drizzle-orm"
import { getInferenceCoreDb } from "../db/inference-core-client"

export interface ObservabilityMetricsExecutor {
  execute(statement: SQL): Promise<unknown>
}

export type ObservabilityMetricsResult =
  | { body: string; status: "ok" }
  | { status: "unavailable" }

interface AggregateRow {
  failures_5m?: unknown
  in_flight_requests?: unknown
  requests_5m?: unknown
  retained_failures?: unknown
  retained_input_tokens?: unknown
  retained_latency_ms_max?: unknown
  retained_latency_ms_sum?: unknown
  retained_output_tokens?: unknown
  retained_requests?: unknown
  retained_total_tokens?: unknown
  server_failures_5m?: unknown
}

export async function getObservabilityMetrics(
  executor: ObservabilityMetricsExecutor | null = defaultExecutor(),
): Promise<ObservabilityMetricsResult> {
  if (!executor) {
    return { status: "unavailable" }
  }

  try {
    const result = await executor.execute(sql`
      SELECT
        COALESCE(usage.retained_requests, 0)::text AS retained_requests,
        COALESCE(usage.retained_failures, 0)::text AS retained_failures,
        COALESCE(usage.retained_input_tokens, 0)::text
          AS retained_input_tokens,
        COALESCE(usage.retained_output_tokens, 0)::text
          AS retained_output_tokens,
        COALESCE(usage.retained_total_tokens, 0)::text
          AS retained_total_tokens,
        COALESCE(usage.retained_latency_ms_sum, 0)::text
          AS retained_latency_ms_sum,
        COALESCE(usage.retained_latency_ms_max, 0)::text
          AS retained_latency_ms_max,
        COALESCE(recent.failures_5m, 0)::text AS failures_5m,
        COALESCE(recent.server_failures_5m, 0)::text AS server_failures_5m,
        COALESCE(recent.requests_5m, 0)::text AS requests_5m,
        COALESCE(in_flight.in_flight_requests, 0)::text
          AS in_flight_requests
      FROM (
        SELECT
          COALESCE(sum(request_count), 0) AS retained_requests,
          COALESCE(sum(failure_count), 0) AS retained_failures,
          COALESCE(sum(input_tokens), 0) AS retained_input_tokens,
          COALESCE(sum(output_tokens), 0) AS retained_output_tokens,
          COALESCE(sum(total_tokens), 0) AS retained_total_tokens,
          COALESCE(sum(latency_ms_sum), 0) AS retained_latency_ms_sum,
          COALESCE(max(latency_ms_max), 0) AS retained_latency_ms_max
        FROM admin.application_usage_daily
      ) AS usage
      CROSS JOIN (
        SELECT
          count(*) AS requests_5m,
          count(*) FILTER (WHERE status_code >= 400) AS failures_5m,
          count(*) FILTER (WHERE status_code >= 500) AS server_failures_5m
        FROM admin.application_request_ledger
        WHERE state = 'settled'
          AND settled_at >= clock_timestamp() - interval '5 minutes'
      ) AS recent
      CROSS JOIN (
        SELECT count(*) AS in_flight_requests
        FROM admin.application_request_ledger
        WHERE state = 'active'
          AND lease_expires_at > clock_timestamp()
      ) AS in_flight
    `)
    const row = resultRows(result)[0] as AggregateRow | undefined
    if (!row) {
      return { status: "unavailable" }
    }
    return { body: renderOpenMetrics(row), status: "ok" }
  } catch {
    return { status: "unavailable" }
  }
}

function defaultExecutor(): ObservabilityMetricsExecutor | null {
  const database = getInferenceCoreDb()
  return database as unknown as ObservabilityMetricsExecutor | null
}

function renderOpenMetrics(row: AggregateRow): string {
  const values = {
    failures5m: nonNegativeInteger(row.failures_5m),
    inFlightRequests: nonNegativeInteger(row.in_flight_requests),
    requests5m: nonNegativeInteger(row.requests_5m),
    retainedFailures: nonNegativeInteger(row.retained_failures),
    retainedInputTokens: nonNegativeInteger(row.retained_input_tokens),
    retainedLatencyMsMax: nonNegativeInteger(row.retained_latency_ms_max),
    retainedLatencyMsSum: nonNegativeInteger(row.retained_latency_ms_sum),
    retainedOutputTokens: nonNegativeInteger(row.retained_output_tokens),
    retainedRequests: nonNegativeInteger(row.retained_requests),
    retainedTotalTokens: nonNegativeInteger(row.retained_total_tokens),
    serverFailures5m: nonNegativeInteger(row.server_failures_5m),
  }
  return [
    "# HELP llm_machines_inference_retained_requests Requests represented by the retained PR-07 accounting window.",
    "# TYPE llm_machines_inference_retained_requests gauge",
    `llm_machines_inference_retained_requests ${values.retainedRequests}`,
    "# HELP llm_machines_inference_retained_failures Failed requests represented by the retained PR-07 accounting window.",
    "# TYPE llm_machines_inference_retained_failures gauge",
    `llm_machines_inference_retained_failures ${values.retainedFailures}`,
    "# HELP llm_machines_inference_retained_input_tokens Input tokens represented by the retained PR-07 accounting window.",
    "# TYPE llm_machines_inference_retained_input_tokens gauge",
    `llm_machines_inference_retained_input_tokens ${values.retainedInputTokens}`,
    "# HELP llm_machines_inference_retained_output_tokens Output tokens represented by the retained PR-07 accounting window.",
    "# TYPE llm_machines_inference_retained_output_tokens gauge",
    `llm_machines_inference_retained_output_tokens ${values.retainedOutputTokens}`,
    "# HELP llm_machines_inference_retained_total_tokens Total tokens represented by the retained PR-07 accounting window.",
    "# TYPE llm_machines_inference_retained_total_tokens gauge",
    `llm_machines_inference_retained_total_tokens ${values.retainedTotalTokens}`,
    "# HELP llm_machines_inference_retained_latency_milliseconds_sum Summed request latency represented by the retained PR-07 accounting window.",
    "# TYPE llm_machines_inference_retained_latency_milliseconds_sum gauge",
    `llm_machines_inference_retained_latency_milliseconds_sum ${values.retainedLatencyMsSum}`,
    "# HELP llm_machines_inference_retained_latency_milliseconds_max Maximum request latency represented by the retained PR-07 accounting window.",
    "# TYPE llm_machines_inference_retained_latency_milliseconds_max gauge",
    `llm_machines_inference_retained_latency_milliseconds_max ${values.retainedLatencyMsMax}`,
    "# HELP llm_machines_inference_requests_5m Settled inference requests in the last five minutes.",
    "# TYPE llm_machines_inference_requests_5m gauge",
    `llm_machines_inference_requests_5m ${values.requests5m}`,
    "# HELP llm_machines_inference_failures_5m Failed settled inference requests in the last five minutes.",
    "# TYPE llm_machines_inference_failures_5m gauge",
    `llm_machines_inference_failures_5m ${values.failures5m}`,
    "# HELP llm_machines_inference_server_failures_5m Settled inference requests with server failures in the last five minutes.",
    "# TYPE llm_machines_inference_server_failures_5m gauge",
    `llm_machines_inference_server_failures_5m ${values.serverFailures5m}`,
    "# HELP llm_machines_inference_in_flight_requests Currently admitted inference requests with unexpired accounting leases; this is not queue depth.",
    "# TYPE llm_machines_inference_in_flight_requests gauge",
    `llm_machines_inference_in_flight_requests ${values.inFlightRequests}`,
    "# HELP llm_machines_inference_queue_depth_source_info Queue-depth source qualification state; no queue-depth value is emitted until a real runtime signal is qualified.",
    "# TYPE llm_machines_inference_queue_depth_source_info gauge",
    'llm_machines_inference_queue_depth_source_info{status="not_configured"} 1',
    "# EOF",
    "",
  ].join("\n")
}

function nonNegativeInteger(value: unknown): string {
  if (
    typeof value === "bigint" ||
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    (typeof value === "string" && /^\d+$/.test(value))
  ) {
    const parsed = BigInt(value)
    if (parsed >= 0n) {
      return parsed.toString()
    }
  }
  throw new Error("Observability aggregate was not a non-negative integer.")
}

function resultRows(result: unknown): unknown[] {
  if (Array.isArray(result)) {
    return result
  }
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray(result.rows)
  ) {
    return result.rows
  }
  return []
}
