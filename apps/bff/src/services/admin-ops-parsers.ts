interface LiteLlmActivityPayload {
  metadata?: Record<string, unknown>
  results?: unknown[]
}

interface LiteLlmSpendLogsPayload {
  data?: unknown[]
}

export interface ActivitySummary {
  failedRequests: number
  requests: number
  tokens: number
  topModel: string | null
}

export interface LogSummary {
  p95LatencyMs: number | null
  sampleSize: number
  topUser: string | null
}

export interface UsageLogSummary {
  matchedRequests: number
  sampledRequests: number
  tokens: number
  topModels: string[]
}

export function summarizeLiteLlmActivity(payload: unknown): ActivitySummary {
  if (!isRecord(payload)) {
    throw new Error("Invalid LiteLLM activity response.")
  }
  const activity = payload as LiteLlmActivityPayload
  const metadata = isRecord(activity.metadata) ? activity.metadata : {}
  const requests = numberField(metadata, "total_api_requests")
  const tokens = numberField(metadata, "total_tokens")
  const failedRequests = numberField(metadata, "total_failed_requests")

  return {
    failedRequests,
    requests,
    tokens,
    topModel: topModel(activity.results ?? []),
  }
}

export function summarizeLiteLlmLogs(payload: unknown): LogSummary {
  if (!isRecord(payload)) {
    throw new Error("Invalid LiteLLM spend logs response.")
  }
  const logs = (payload as LiteLlmSpendLogsPayload).data
  if (!Array.isArray(logs)) {
    throw new Error("Invalid LiteLLM spend logs data.")
  }

  const latencies: number[] = []
  const users = new Map<string, number>()
  for (const log of logs) {
    if (!isRecord(log)) {
      continue
    }
    const latency = numberField(log, "request_duration_ms")
    if (latency > 0) {
      latencies.push(latency)
    }
    const user = normalizeUser(log.user) ?? normalizeUser(log.end_user)
    if (user) {
      users.set(user, (users.get(user) ?? 0) + 1)
    }
  }

  return {
    p95LatencyMs: percentile(latencies, 95),
    sampleSize: logs.length,
    topUser: [...users.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  }
}

export function summarizeLiteLlmUsageLogsForActor(
  payload: unknown,
  actorIdentities: string[],
): UsageLogSummary {
  if (!isRecord(payload)) {
    throw new Error("Invalid LiteLLM spend logs response.")
  }
  const logs = (payload as LiteLlmSpendLogsPayload).data
  if (!Array.isArray(logs)) {
    throw new Error("Invalid LiteLLM spend logs data.")
  }

  const normalizedIdentities = new Set(
    actorIdentities.map((identity) => identity.toLowerCase()),
  )
  const modelCounts = new Map<string, number>()
  let matchedRequests = 0
  let tokens = 0

  for (const log of logs) {
    if (!isRecord(log) || !logMatchesActor(log, normalizedIdentities)) {
      continue
    }

    matchedRequests += 1
    tokens += tokenCount(log)

    const model = stringField(log, "model") ?? stringField(log, "model_group")
    if (model) {
      modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1)
    }
  }

  return {
    matchedRequests,
    sampledRequests: logs.length,
    tokens,
    topModels: [...modelCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([model]) => model)
      .slice(0, 3),
  }
}

function topModel(results: unknown[]): string | null {
  const totals = new Map<string, number>()
  for (const result of results) {
    if (!isRecord(result) || !isRecord(result.breakdown)) {
      continue
    }
    const breakdown = result.breakdown
    const groups = isRecord(breakdown.model_groups)
      ? breakdown.model_groups
      : isRecord(breakdown.models)
        ? breakdown.models
        : {}
    for (const [model, value] of Object.entries(groups)) {
      if (!isRecord(value) || !isRecord(value.metrics)) {
        continue
      }
      const count =
        numberField(value.metrics, "api_requests") ||
        numberField(value.metrics, "successful_requests") ||
        numberField(value.metrics, "total_tokens")
      totals.set(model, (totals.get(model) ?? 0) + count)
    }
  }

  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

function percentile(values: number[], percentileRank: number): number | null {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    Math.ceil((percentileRank / 100) * sorted.length) - 1,
    sorted.length - 1,
  )
  return sorted[Math.max(index, 0)]
}

function normalizeUser(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  if (
    trimmed.length === 0 ||
    trimmed === "default_user_id" ||
    trimmed === "Unassigned"
  ) {
    return null
  }
  return trimmed
}

function logMatchesActor(
  log: Record<string, unknown>,
  identities: Set<string>,
): boolean {
  const candidates = [
    normalizeUser(log.user),
    normalizeUser(log.end_user),
    stringField(log, "user_id"),
    stringField(log, "session_id"),
  ].filter((value): value is string => Boolean(value))

  return candidates.some((candidate) => identities.has(candidate.toLowerCase()))
}

function tokenCount(log: Record<string, unknown>): number {
  const total = numberField(log, "total_tokens")
  if (total > 0) {
    return total
  }
  return (
    numberField(log, "prompt_tokens") + numberField(log, "completion_tokens")
  )
}

function stringField(
  record: Record<string, unknown>,
  field: string,
): string | null {
  const value = record[field]
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function numberField(record: Record<string, unknown>, field: string): number {
  const value = record[field]
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
