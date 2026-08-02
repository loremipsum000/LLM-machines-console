import { createHash } from "node:crypto"
import type {
  AdminInferenceDashboard,
  AdminInferenceModel,
  AdminInferenceModelUsage,
  AdminInferenceRange,
  AdminInferenceUsagePoint,
  AdminInferenceVirtualKey,
  InferenceCoreSourceStatus,
} from "@llm-machines/contracts/inference-core"
import type { Actor } from "../auth/authorization"
import {
  LiteLlmAdminClient,
  liteLlmConfig,
  liteLlmDateWindow,
} from "./admin-litellm-client"

interface InferenceQueryOptions {
  range?: string
}

interface LiteLlmReadResult<T> {
  data: T | null
  status: InferenceCoreSourceStatus
}

interface ActivityReadModel {
  modelUsage: AdminInferenceModelUsage[]
  totals: NonNullable<AdminInferenceDashboard["totals"]>
  usagePoints: AdminInferenceUsagePoint[]
}

const DEFAULT_RANGE: AdminInferenceRange = "30d"
const RANGE_DAYS: Record<AdminInferenceRange, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
}
const VIRTUAL_KEY_PAGE_SIZE = 100
const VIRTUAL_KEY_MAX_PAGES = 50
const VIRTUAL_KEY_MAX_COUNT = VIRTUAL_KEY_PAGE_SIZE * VIRTUAL_KEY_MAX_PAGES
const VIRTUAL_KEY_MAX_AGGREGATE_BYTES = 8 * 1024 * 1024
const VIRTUAL_KEY_READ_DEADLINE_MS = 10_000
const VIRTUAL_KEY_ID_DOMAIN =
  "llm-machines:admin-inference:litellm-virtual-key:v1\0"
const VIRTUAL_KEY_ALIAS_MAX_LENGTH = 160
const VIRTUAL_KEY_OWNER_MAX_LENGTH = 254
const VIRTUAL_KEY_TEAM_MAX_LENGTH = 160
const VIRTUAL_KEY_MODEL_MAX_LENGTH = 160
const VIRTUAL_KEY_MODEL_MAX_COUNT = 100

export async function getAdminInference(
  actor: Actor,
  options: InferenceQueryOptions = {},
): Promise<AdminInferenceDashboard> {
  if (actor.role !== "admin" && actor.role !== "operator") {
    throw new Error("Admin inference requires Admin or Operator access.")
  }
  const range = parseInferenceRange(options.range)
  const generatedAt = new Date()
  const config = liteLlmConfig()

  if (!config) {
    return emptyInferenceDashboard({
      generatedAt,
      range,
      sourceStatus: "not_configured",
      summary:
        "LiteLLM Admin API is not configured for this BFF, so inference usage is unavailable.",
    })
  }

  const client = new LiteLlmAdminClient(config)
  const window = liteLlmDateWindow(RANGE_DAYS[range])
  const [activity, models, virtualKeys] = await Promise.all([
    readActivity(client, window),
    readModels(client),
    readVirtualKeys(client),
  ])
  const spendLogs =
    activity.data && activity.data.modelUsage.length > 0
      ? await readSpendLogs(client, window)
      : null
  const modelUsage = mergeModelUsage(
    activity.data?.modelUsage ?? [],
    spendLogs?.data ?? [],
  )
  const sourceStatus = aggregateSourceStatus([
    activity.status,
    models.status,
    virtualKeys.status,
  ])
  const totals = activity.data?.totals ?? null

  return {
    aggregateUsageSourceStatus: activity.status,
    generatedAt: generatedAt.toISOString(),
    liteLlmUrl: null,
    modelInventorySourceStatus: models.status,
    modelUsage,
    models: sortModelsByUsage(models.data ?? [], modelUsage),
    range,
    sourceStatus,
    summary: inferenceSummary(totals, activity.status, range),
    totals,
    usagePoints: activity.data?.usagePoints ?? [],
    virtualKeys: virtualKeys.data ?? [],
    virtualKeysSourceStatus: virtualKeys.status,
  }
}

function parseInferenceRange(range?: string): AdminInferenceRange {
  return range === "7d" || range === "90d" ? range : DEFAULT_RANGE
}

async function readActivity(
  client: LiteLlmAdminClient,
  window: { endDate: string; startDate: string },
): Promise<LiteLlmReadResult<ActivityReadModel>> {
  try {
    const payload = await client.getJson(
      "/user/daily/activity/aggregated",
      new URLSearchParams({
        end_date: window.endDate,
        start_date: window.startDate,
      }),
    )
    return { data: parseActivity(payload), status: "ok" }
  } catch {
    return { data: null, status: "unavailable" }
  }
}

async function readSpendLogs(
  client: LiteLlmAdminClient,
  window: { endDate: string; startDate: string },
): Promise<LiteLlmReadResult<AdminInferenceModelUsage[]>> {
  try {
    const payload = await client.getJson(
      "/spend/logs/v2",
      new URLSearchParams({
        end_date: window.endDate,
        page: "1",
        page_size: "100",
        start_date: window.startDate,
        status_filter: "success",
      }),
    )
    return { data: parseSpendLogs(payload), status: "ok" }
  } catch {
    return { data: null, status: "unavailable" }
  }
}

async function readModels(
  client: LiteLlmAdminClient,
): Promise<LiteLlmReadResult<AdminInferenceModel[]>> {
  try {
    return {
      data: parseModels(await client.getJson("/model/info")),
      status: "ok",
    }
  } catch {
    try {
      return {
        data: parseModels(await client.getJson("/v1/model/info")),
        status: "ok",
      }
    } catch {
      return { data: null, status: "unavailable" }
    }
  }
}

async function readVirtualKeys(
  client: LiteLlmAdminClient,
): Promise<LiteLlmReadResult<AdminInferenceVirtualKey[]>> {
  try {
    return { data: await readAllVirtualKeys(client), status: "ok" }
  } catch {
    return { data: null, status: "unavailable" }
  }
}

async function readAllVirtualKeys(
  client: LiteLlmAdminClient,
): Promise<AdminInferenceVirtualKey[]> {
  const keys: AdminInferenceVirtualKey[] = []
  const seenIds = new Set<string>()
  const deadline = AbortSignal.timeout(VIRTUAL_KEY_READ_DEADLINE_MS)
  let aggregateBytes = 0
  let expectedTotalCount: number | null = null
  let expectedTotalPages: number | null = null

  for (let page = 1; page <= VIRTUAL_KEY_MAX_PAGES; page += 1) {
    const payload = await client.getJson(
      "/key/list",
      new URLSearchParams({
        include_team_keys: "true",
        page: String(page),
        return_full_object: "true",
        size: String(VIRTUAL_KEY_PAGE_SIZE),
      }),
      {
        onBytesRead(byteLength) {
          aggregateBytes += byteLength
          if (aggregateBytes > VIRTUAL_KEY_MAX_AGGREGATE_BYTES) {
            throw new Error(
              "LiteLLM virtual-key responses exceeded the aggregate read limit.",
            )
          }
        },
        signal: deadline,
      },
    )
    const parsedPage = parseVirtualKeyPage(payload, page)
    if (expectedTotalCount === null || expectedTotalPages === null) {
      expectedTotalCount = parsedPage.totalCount
      expectedTotalPages = parsedPage.totalPages
      validateVirtualKeyPagination(expectedTotalCount, expectedTotalPages)
    } else if (
      parsedPage.totalCount !== expectedTotalCount ||
      parsedPage.totalPages !== expectedTotalPages
    ) {
      throw new Error("LiteLLM virtual-key pagination changed while reading.")
    }

    for (const key of parseVirtualKeys(parsedPage.rows)) {
      if (seenIds.has(key.id)) {
        throw new Error("LiteLLM virtual-key pagination contained a duplicate.")
      }
      seenIds.add(key.id)
      keys.push(key)
    }
    if (keys.length > expectedTotalCount) {
      throw new Error("LiteLLM virtual-key pagination exceeded its total.")
    }

    if (expectedTotalPages === 0 || page === expectedTotalPages) {
      break
    }
  }

  if (expectedTotalCount === null || keys.length !== expectedTotalCount) {
    throw new Error("LiteLLM virtual-key pagination was incomplete.")
  }
  return keys
}

function parseActivity(payload: unknown): ActivityReadModel {
  if (
    !isRecord(payload) ||
    !isRecord(payload.metadata) ||
    !Array.isArray(payload.results)
  ) {
    throw new Error("Invalid LiteLLM activity response.")
  }
  const metadata = payload.metadata
  const requests = nonNegativeNumberFromFields(metadata, [
    "total_api_requests",
    "api_requests",
    "requests",
  ])
  const tokens = nonNegativeNumberFromFields(metadata, [
    "total_tokens",
    "tokens",
  ])
  if (requests === null || tokens === null) {
    throw new Error("Invalid LiteLLM activity totals.")
  }
  const totals = {
    requests: Math.trunc(requests),
    tokens: Math.trunc(tokens),
  }
  const results = payload.results
  const usagePoints = results
    .map((item) => activityPoint(item))
    .filter((item): item is AdminInferenceUsagePoint => Boolean(item))
  const modelUsage = mergeUsageMaps(
    results.map((item) => modelUsageFromActivityResult(item)),
  )

  return {
    modelUsage,
    totals,
    usagePoints,
  }
}

function activityPoint(value: unknown): AdminInferenceUsagePoint | null {
  if (!isRecord(value)) {
    return null
  }
  const metrics = isRecord(value.metrics) ? value.metrics : value
  const timestamp = timestampField(value) ?? timestampField(metrics)
  const requests = nonNegativeNumberFromFields(metrics, [
    "total_api_requests",
    "api_requests",
    "successful_requests",
    "requests",
  ])
  const tokens = nonNegativeNumberFromFields(metrics, [
    "total_tokens",
    "tokens",
  ])
  if (!timestamp || requests === null || tokens === null) {
    return null
  }
  return {
    requests: Math.trunc(requests),
    timestamp,
    tokens: Math.trunc(tokens),
  }
}

function modelUsageFromActivityResult(
  value: unknown,
): AdminInferenceModelUsage[] {
  if (!isRecord(value) || !isRecord(value.breakdown)) {
    return []
  }
  const groups = usageGroups(value.breakdown)
  const lastUsedAt = timestampField(value)
  return Object.entries(groups)
    .map(([model, group]) => {
      if (!isRecord(group)) {
        return null
      }
      const metrics = isRecord(group.metrics) ? group.metrics : group
      const requests = nonNegativeNumberFromFields(metrics, [
        "api_requests",
        "successful_requests",
        "requests",
      ])
      const tokens = nonNegativeNumberFromFields(metrics, [
        "total_tokens",
        "tokens",
      ])
      if (requests === null || tokens === null) {
        return null
      }
      return {
        lastUsedAt,
        model,
        requests: Math.trunc(requests),
        spendUsd: nullableNumber(
          numberField(metrics, "spend") ||
            numberField(metrics, "cost") ||
            numberField(metrics, "response_cost"),
        ),
        tokens: Math.trunc(tokens),
      }
    })
    .filter((item): item is AdminInferenceModelUsage => Boolean(item))
}

function usageGroups(
  breakdown: Record<string, unknown>,
): Record<string, unknown> {
  if (isRecord(breakdown.model_groups)) {
    return breakdown.model_groups
  }
  if (isRecord(breakdown.models)) {
    return breakdown.models
  }
  return {}
}

function parseSpendLogs(payload: unknown): AdminInferenceModelUsage[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("Invalid LiteLLM spend logs response.")
  }
  const usage = new Map<string, AdminInferenceModelUsage>()
  for (const log of payload.data) {
    if (!isRecord(log)) {
      continue
    }
    const model =
      stringField(log, "model_group") ??
      stringField(log, "model_id") ??
      stringField(log, "model")
    if (!model) {
      continue
    }
    const existing = usage.get(model) ?? {
      lastUsedAt: null,
      model,
      requests: 0,
      spendUsd: null,
      tokens: 0,
    }
    const lastUsedAt = timestampField(log)
    usage.set(model, {
      ...existing,
      lastUsedAt: maxTimestamp(existing.lastUsedAt, lastUsedAt),
      requests: existing.requests + 1,
      spendUsd: addNullable(
        existing.spendUsd,
        nullableNumber(
          numberField(log, "spend") ||
            numberField(log, "response_cost") ||
            numberField(log, "cost"),
        ),
      ),
      tokens: existing.tokens + tokenCount(log),
    })
  }
  return sortModelUsage([...usage.values()])
}

function parseModels(payload: unknown): AdminInferenceModel[] {
  const rows = strictArrayPayload(payload)
  const models: AdminInferenceModel[] = []
  for (const [index, row] of rows.entries()) {
    const model = modelFromRow(row, index)
    if (!model) {
      throw new Error("Invalid LiteLLM model inventory row.")
    }
    models.push(model)
  }
  return models
}

function modelFromRow(row: unknown, index: number): AdminInferenceModel | null {
  if (!isRecord(row)) {
    return null
  }
  const modelInfo = isRecord(row.model_info) ? row.model_info : row
  const liteLlmParams = isRecord(row.litellm_params) ? row.litellm_params : {}
  const name =
    stringField(row, "model_name") ??
    stringField(row, "model") ??
    stringField(modelInfo, "model_name") ??
    stringField(modelInfo, "base_model")
  if (!name) {
    return null
  }
  return {
    contextWindow:
      integerField(modelInfo, "max_context_tokens") ??
      integerField(modelInfo, "max_input_tokens") ??
      integerField(modelInfo, "max_tokens"),
    id:
      stringField(modelInfo, "id") ??
      stringField(row, "litellm_model_id") ??
      stringField(row, "model_id") ??
      `model-${index + 1}`,
    mode:
      stringField(row, "mode") ??
      stringField(modelInfo, "mode") ??
      stringField(liteLlmParams, "mode"),
    name,
    outputCostPerMillionTokens: perMillionCost(
      numberField(modelInfo, "output_cost_per_token") ||
        numberField(liteLlmParams, "output_cost_per_token"),
    ),
    provider:
      stringField(modelInfo, "litellm_provider") ??
      stringField(modelInfo, "provider") ??
      providerFromModel(stringField(liteLlmParams, "model")),
    sourceStatus: "ok",
  }
}

function parseVirtualKeys(rows: unknown[]): AdminInferenceVirtualKey[] {
  return rows.map(virtualKeyFromRow)
}

function virtualKeyFromRow(row: unknown): AdminInferenceVirtualKey {
  if (!isRecord(row)) {
    throw new Error("Invalid LiteLLM virtual-key row.")
  }
  const upstreamIdentifier = stringField(row, "token")
  if (
    !upstreamIdentifier ||
    (row.blocked !== null &&
      row.blocked !== undefined &&
      typeof row.blocked !== "boolean")
  ) {
    throw new Error("Invalid LiteLLM virtual-key identity or state.")
  }
  const expiresAt = strictOptionalTimestamp(row, "expires")
  return {
    alias:
      sanitizedDisplayField(
        stringField(row, "key_alias"),
        VIRTUAL_KEY_ALIAS_MAX_LENGTH,
      ) ?? "Unnamed virtual key",
    budgetUsd: optionalNonNegativeNumber(row, "max_budget"),
    expiresAt,
    id: opaqueVirtualKeyId(upstreamIdentifier),
    lastUsedAt: strictOptionalTimestamp(row, "last_active"),
    models: sanitizedModelAliases(row.models),
    owner: sanitizedDisplayField(
      stringField(row, "user_email"),
      VIRTUAL_KEY_OWNER_MAX_LENGTH,
    ),
    spendUsd: optionalNonNegativeNumber(row, "spend"),
    status: virtualKeyStatus(row, expiresAt),
    team: sanitizedDisplayField(
      stringField(row, "team_alias"),
      VIRTUAL_KEY_TEAM_MAX_LENGTH,
    ),
  }
}

function parseVirtualKeyPage(
  payload: unknown,
  expectedPage: number,
): {
  rows: unknown[]
  totalCount: number
  totalPages: number
} {
  if (!isRecord(payload) || !Array.isArray(payload.keys)) {
    throw new Error("Invalid LiteLLM virtual-key page.")
  }
  const currentPage = strictIntegerField(payload, "current_page", 1)
  const totalCount = strictIntegerField(payload, "total_count", 0)
  const totalPages = strictIntegerField(payload, "total_pages", 0)
  if (
    currentPage !== expectedPage ||
    payload.keys.length > VIRTUAL_KEY_PAGE_SIZE
  ) {
    throw new Error("Invalid LiteLLM virtual-key pagination metadata.")
  }
  return { rows: payload.keys, totalCount, totalPages }
}

function validateVirtualKeyPagination(
  totalCount: number,
  totalPages: number,
): void {
  const calculatedPages = Math.ceil(totalCount / VIRTUAL_KEY_PAGE_SIZE)
  const emptyPageCountIsValid = totalCount === 0 && totalPages === 1
  if (
    totalCount > VIRTUAL_KEY_MAX_COUNT ||
    totalPages > VIRTUAL_KEY_MAX_PAGES ||
    (totalPages !== calculatedPages && !emptyPageCountIsValid)
  ) {
    throw new Error("Invalid LiteLLM virtual-key pagination bounds.")
  }
}

function strictArrayPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload
  }
  if (!isRecord(payload)) {
    throw new Error("Invalid LiteLLM model inventory response.")
  }
  for (const field of ["data", "models", "model_info"]) {
    const value = payload[field]
    if (Array.isArray(value)) {
      return value
    }
  }
  throw new Error("Invalid LiteLLM model inventory response.")
}

function mergeModelUsage(
  activityUsage: AdminInferenceModelUsage[],
  logUsage: AdminInferenceModelUsage[],
): AdminInferenceModelUsage[] {
  if (logUsage.length === 0) {
    return sortModelUsage(activityUsage)
  }
  if (activityUsage.length === 0) {
    return []
  }

  const merged = new Map(
    activityUsage.map((usage) => [usage.model, { ...usage }]),
  )
  for (const usage of logUsage) {
    const existing = merged.get(usage.model)
    if (!existing) {
      continue
    }
    merged.set(usage.model, {
      ...existing,
      lastUsedAt: maxTimestamp(existing.lastUsedAt, usage.lastUsedAt),
      spendUsd: existing.spendUsd ?? usage.spendUsd,
    })
  }
  return sortModelUsage([...merged.values()])
}

function mergeUsageMaps(
  usageSets: AdminInferenceModelUsage[][],
): AdminInferenceModelUsage[] {
  const merged = new Map<string, AdminInferenceModelUsage>()
  for (const usageSet of usageSets) {
    for (const usage of usageSet) {
      const existing = merged.get(usage.model) ?? {
        lastUsedAt: null,
        model: usage.model,
        requests: 0,
        spendUsd: null,
        tokens: 0,
      }
      merged.set(usage.model, {
        ...existing,
        lastUsedAt: maxTimestamp(existing.lastUsedAt, usage.lastUsedAt),
        requests: existing.requests + usage.requests,
        spendUsd: addNullable(existing.spendUsd, usage.spendUsd),
        tokens: existing.tokens + usage.tokens,
      })
    }
  }
  return [...merged.values()]
}

function sortModelUsage(
  usage: AdminInferenceModelUsage[],
): AdminInferenceModelUsage[] {
  return [...usage].sort(
    (a, b) =>
      b.requests - a.requests ||
      b.tokens - a.tokens ||
      a.model.localeCompare(b.model),
  )
}

function sortModelsByUsage(
  models: AdminInferenceModel[],
  usage: AdminInferenceModelUsage[],
): AdminInferenceModel[] {
  const scores = new Map(usage.map((item) => [item.model, item.requests]))
  return [...models].sort(
    (a, b) =>
      (scores.get(b.name) ?? 0) - (scores.get(a.name) ?? 0) ||
      a.name.localeCompare(b.name),
  )
}

function aggregateSourceStatus(
  statuses: InferenceCoreSourceStatus[],
): InferenceCoreSourceStatus {
  if (statuses.every((status) => status === "unavailable")) {
    return "unavailable"
  }
  if (statuses.every((status) => status === "not_configured")) {
    return "not_configured"
  }
  if (statuses.some((status) => status !== "ok")) {
    return "degraded"
  }
  return "ok"
}

function emptyInferenceDashboard({
  generatedAt,
  range,
  sourceStatus,
  summary,
}: {
  generatedAt: Date
  range: AdminInferenceRange
  sourceStatus: InferenceCoreSourceStatus
  summary: string
}): AdminInferenceDashboard {
  return {
    aggregateUsageSourceStatus: sourceStatus,
    generatedAt: generatedAt.toISOString(),
    liteLlmUrl: null,
    modelInventorySourceStatus: sourceStatus,
    modelUsage: [],
    models: [],
    range,
    sourceStatus,
    summary,
    totals: null,
    usagePoints: [],
    virtualKeys: [],
    virtualKeysSourceStatus: sourceStatus,
  }
}

function inferenceSummary(
  totals: AdminInferenceDashboard["totals"],
  aggregateUsageSourceStatus: InferenceCoreSourceStatus,
  range: AdminInferenceRange,
): string {
  if (aggregateUsageSourceStatus === "not_configured") {
    return "LiteLLM aggregate usage is not configured for this BFF."
  }
  if (aggregateUsageSourceStatus !== "ok" || totals === null) {
    return "LiteLLM is configured, but aggregate inference usage is unavailable."
  }
  return `LiteLLM reports ${formatNumber(totals.requests)} requests and ${formatNumber(totals.tokens)} tokens in the last ${range}.`
}

function tokenCount(log: Record<string, unknown>): number {
  const total = numberField(log, "total_tokens")
  if (total > 0) {
    return Math.trunc(total)
  }
  return Math.trunc(
    numberField(log, "prompt_tokens") + numberField(log, "completion_tokens"),
  )
}

function numberField(record: Record<string, unknown>, field: string): number {
  const value = record[field]
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value)
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed)
    }
  }
  return 0
}

function nonNegativeNumberFromFields(
  record: Record<string, unknown>,
  fields: string[],
): number | null {
  for (const field of fields) {
    const value = record[field]
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed
      }
    }
  }
  return null
}

function integerField(
  record: Record<string, unknown>,
  field: string,
): number | null {
  const value = numberField(record, field)
  return value > 0 ? Math.trunc(value) : null
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

function timestampField(record: Record<string, unknown>): string | null {
  return timestampFieldFromFields(record, [
    "date",
    "day",
    "timestamp",
    "created_at",
    "createdAt",
    "start_time",
    "startTime",
    "end_time",
    "endTime",
  ])
}

function timestampFieldFromFields(
  record: Record<string, unknown>,
  fields: string[],
): string | null {
  for (const field of fields) {
    const normalized = normalizeTimestamp(record[field])
    if (normalized) {
      return normalized
    }
  }
  return null
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const timestamp = value > 10_000_000_000 ? value : value * 1000
    return new Date(timestamp).toISOString()
  }
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return dateOnlyToIso(trimmed)
  }
  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function dateOnlyToIso(value: string): string {
  return `${value}T00:00:00.000Z`
}

function maxTimestamp(
  left: string | null,
  right: string | null,
): string | null {
  if (!left) {
    return right
  }
  if (!right) {
    return left
  }
  return left.localeCompare(right) >= 0 ? left : right
}

function nullableNumber(value: number): number | null {
  return value > 0 ? value : null
}

function addNullable(left: number | null, right: number | null): number | null {
  const total = (left ?? 0) + (right ?? 0)
  return total > 0 ? Number(total.toFixed(6)) : null
}

function perMillionCost(value: number): number | null {
  return value > 0 ? Number((value * 1_000_000).toFixed(6)) : null
}

function providerFromModel(model: string | null): string | null {
  if (!model || !model.includes("/")) {
    return null
  }
  return model.split("/")[0] ?? null
}

function looksSensitive(value: string): boolean {
  return (
    /sk-[a-z0-9_-]{8,}/i.test(value) ||
    /\bauthorization\s*:\s*bearer\s+\S+/i.test(value) ||
    /\bbearer\s+[a-z0-9._~+/=-]{8,}/i.test(value) ||
    /(?:api[\s_-]*key|client[\s_-]*secret|password|secret|token)\s*[:=]\s*\S+/i.test(
      value,
    ) ||
    /(?:^|[^a-f0-9])[a-f0-9]{64}(?![a-f0-9])/i.test(value)
  )
}

function opaqueVirtualKeyId(upstreamIdentifier: string): string {
  const digest = createHash("sha256")
    .update(VIRTUAL_KEY_ID_DOMAIN)
    .update(upstreamIdentifier)
    .digest("hex")
  return `litellm-vk-${digest}`
}

function sanitizedDisplayField(
  value: string | null,
  maxLength: number,
): string | null {
  if (!value) {
    return null
  }
  const withoutControlCharacters = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)
      ? " "
      : character
  })
    .join("")
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
  const sanitized = withoutControlCharacters.replace(/\s+/g, " ").trim()
  if (!sanitized || looksSensitive(sanitized)) {
    return null
  }
  return Array.from(sanitized).slice(0, maxLength).join("")
}

function sanitizedModelAliases(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("Invalid LiteLLM virtual-key model list.")
  }
  return [
    ...new Set(
      value
        .map((item) =>
          sanitizedDisplayField(item, VIRTUAL_KEY_MODEL_MAX_LENGTH),
        )
        .filter((item): item is string => Boolean(item)),
    ),
  ].slice(0, VIRTUAL_KEY_MODEL_MAX_COUNT)
}

function strictIntegerField(
  record: Record<string, unknown>,
  field: string,
  minimum: number,
): number {
  const value = record[field]
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new Error(`Invalid LiteLLM ${field}.`)
  }
  return value
}

function strictOptionalTimestamp(
  record: Record<string, unknown>,
  field: string,
): string | null {
  const value = record[field]
  if (value === null || value === undefined || value === "") {
    return null
  }
  const normalized = normalizeTimestamp(value)
  if (!normalized) {
    throw new Error(`Invalid LiteLLM ${field}.`)
  }
  return normalized
}

function optionalNonNegativeNumber(
  record: Record<string, unknown>,
  field: string,
): number | null {
  const value = record[field]
  if (value === null || value === undefined || value === "") {
    return null
  }
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function virtualKeyStatus(
  row: Record<string, unknown>,
  expiresAt: string | null,
): AdminInferenceVirtualKey["status"] {
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    return "expired"
  }
  return row.blocked === true ? "blocked" : "active"
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
