import { createHash } from "node:crypto"
import type {
  AdminInferenceDashboard,
  AdminInferenceModel,
  AdminInferenceModelUpdate,
  AdminInferenceModelUpdateActionResponse,
  AdminInferenceModelUsage,
  AdminInferenceRange,
  AdminInferenceUsagePoint,
  AdminInferenceVirtualKey,
  ApplyAdminInferenceModelUpdateRequest,
  InferenceCoreSourceStatus,
} from "@llm-machines/contracts/inference-core"
import type { Actor } from "../auth/persona"
import { canUseBffFixtureData } from "../config/fixture-mode"
import {
  LiteLlmAdminClient,
  liteLlmConfig,
  liteLlmDateWindow,
} from "./admin-litellm-client"
import { emitAudit } from "./audit"
import { expertCapability } from "./expert-capabilities"

interface InferenceQueryOptions {
  range?: string
}

interface LiteLlmReadResult<T> {
  data: T | null
  status: InferenceCoreSourceStatus
}

interface ActivityReadModel {
  modelUsage: AdminInferenceModelUsage[]
  totals: AdminInferenceDashboard["totals"]
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

export async function getAdminInference(
  actor: Actor,
  options: InferenceQueryOptions = {},
): Promise<AdminInferenceDashboard> {
  const range = parseInferenceRange(options.range)
  const generatedAt = new Date()
  const config = liteLlmConfig()
  const modelUpdate = readModelUpdate()

  if (!config) {
    return emptyInferenceDashboard({
      generatedAt,
      modelUpdate,
      range,
      sourceStatus: "not_configured",
      summary:
        "LiteLLM Admin API is not configured for this BFF, so inference usage is unavailable.",
    })
  }

  const client = new LiteLlmAdminClient(config)
  const window = liteLlmDateWindow(RANGE_DAYS[range])
  const activity = await readActivity(client, window)
  const spendLogs = await readSpendLogs(client, window)
  const models = await readModels(client)
  const virtualKeys = await readVirtualKeys(client)
  const modelUsage = mergeModelUsage(
    activity.data?.modelUsage ?? [],
    spendLogs.data ?? [],
  )
  const availableModels = modelInventory(models.data, modelUsage)
  const sourceStatus = aggregateSourceStatus([
    activity.status,
    spendLogs.status,
    models.status,
    virtualKeys.status,
  ])
  const totals = activity.data?.totals ?? totalsFromModelUsage(modelUsage)

  return {
    generatedAt: generatedAt.toISOString(),
    liteLlmUrl: liteLlmPublicUrl(),
    modelUpdate,
    modelUsage,
    models: sortModelsByUsage(availableModels, modelUsage),
    range,
    sourceStatus,
    summary: inferenceSummary(totals, sourceStatus, range),
    totals,
    usagePoints: activity.data?.usagePoints ?? [],
    virtualKeys: virtualKeys.data ?? [],
  }
}

export async function applyAdminInferenceModelUpdate(
  actor: Actor,
  request: ApplyAdminInferenceModelUpdateRequest,
): Promise<AdminInferenceModelUpdateActionResponse> {
  if (request.confirmation !== "UPDATE MODEL") {
    return modelUpdateActionResponse({
      detail: "Model update confirmation is invalid.",
      modelUpdate: readModelUpdate(),
      status: "blocked",
    })
  }

  const modelUpdate = readModelUpdate()
  if (
    !modelUpdate ||
    !modelUpdate.updateActionEnabled ||
    modelUpdate.status !== "available"
  ) {
    await emitModelUpdateAudit(actor, "admin.inference.model_update.blocked", {
      reason: "not_available_or_unconfigured",
      status: modelUpdate?.status ?? "not_configured",
    })
    return modelUpdateActionResponse({
      detail:
        "No governed model update adapter is currently available for this appliance.",
      modelUpdate,
      status: "blocked",
    })
  }

  await emitModelUpdateAudit(actor, "admin.inference.model_update.started", {
    affectedModels: modelUpdate.affectedModels,
    availableVersion: modelUpdate.availableVersion,
    currentVersion: modelUpdate.currentVersion,
  })

  const outcome = configuredModelUpdateOutcome()
  if (outcome === "failed") {
    const failedUpdate: AdminInferenceModelUpdate = {
      ...modelUpdate,
      detail:
        "The governed model update adapter reported a failure. Review appliance updater logs for details.",
      status: "failed",
      updateActionEnabled: false,
    }
    await emitModelUpdateAudit(actor, "admin.inference.model_update.failed", {
      affectedModels: modelUpdate.affectedModels,
      availableVersion: modelUpdate.availableVersion,
      currentVersion: modelUpdate.currentVersion,
    })
    return modelUpdateActionResponse({
      detail: failedUpdate.detail,
      modelUpdate: failedUpdate,
      status: "failed",
    })
  }

  if (outcome === "blocked") {
    const blockedUpdate: AdminInferenceModelUpdate = {
      ...modelUpdate,
      detail:
        "The governed model update adapter blocked the request for this appliance.",
      status: "blocked",
      updateActionEnabled: false,
    }
    await emitModelUpdateAudit(actor, "admin.inference.model_update.blocked", {
      affectedModels: modelUpdate.affectedModels,
      availableVersion: modelUpdate.availableVersion,
      currentVersion: modelUpdate.currentVersion,
      reason: "adapter_blocked",
    })
    return modelUpdateActionResponse({
      detail: blockedUpdate.detail,
      modelUpdate: blockedUpdate,
      status: "blocked",
    })
  }

  if (outcome === "started") {
    const runningUpdate: AdminInferenceModelUpdate = {
      ...modelUpdate,
      detail: "The governed model update adapter started the update.",
      status: "running",
      updateActionEnabled: false,
    }
    return modelUpdateActionResponse({
      detail: runningUpdate.detail,
      modelUpdate: runningUpdate,
      status: "started",
    })
  }

  await emitModelUpdateAudit(actor, "admin.inference.model_update.completed", {
    affectedModels: modelUpdate.affectedModels,
    availableVersion: modelUpdate.availableVersion,
    currentVersion: modelUpdate.currentVersion,
  })
  return modelUpdateActionResponse({
    detail: "The governed model update completed.",
    modelUpdate: null,
    status: "completed",
  })
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
    return { data: parseActivity(payload, window), status: "ok" }
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
    return { data: null, status: "degraded" }
  }
}

async function readModels(
  client: LiteLlmAdminClient,
): Promise<LiteLlmReadResult<AdminInferenceModel[]>> {
  try {
    return { data: parseModels(await client.getJson("/model/info")), status: "ok" }
  } catch {
    try {
      return {
        data: parseModels(await client.getJson("/v1/model/info")),
        status: "ok",
      }
    } catch {
      return { data: null, status: "degraded" }
    }
  }
}

async function readVirtualKeys(
  client: LiteLlmAdminClient,
): Promise<LiteLlmReadResult<AdminInferenceVirtualKey[]>> {
  try {
    return { data: await readAllVirtualKeys(client), status: "ok" }
  } catch {
    return { data: null, status: "degraded" }
  }
}

async function readAllVirtualKeys(
  client: LiteLlmAdminClient,
): Promise<AdminInferenceVirtualKey[]> {
  const keys: AdminInferenceVirtualKey[] = []
  let page = 1
  let totalPages: number | null = null

  while (page <= (totalPages ?? VIRTUAL_KEY_MAX_PAGES)) {
    const payload = await client.getJson(
      "/key/list",
      new URLSearchParams({
        include_team_keys: "true",
        page: String(page),
        return_full_object: "true",
        size: String(VIRTUAL_KEY_PAGE_SIZE),
      }),
    )
    const pageRows = arrayPayload(payload)
    keys.push(...parseVirtualKeys(payload, keys.length))
    totalPages = totalPages ?? totalPagesFromPayload(payload)

    if (totalPages ? page >= totalPages : pageRows.length < VIRTUAL_KEY_PAGE_SIZE) {
      break
    }

    page += 1
    if (page > VIRTUAL_KEY_MAX_PAGES) {
      break
    }
  }

  return keys
}

function parseActivity(
  payload: unknown,
  window: { endDate: string; startDate: string },
): ActivityReadModel {
  if (!isRecord(payload)) {
    throw new Error("Invalid LiteLLM activity response.")
  }
  const metadata = isRecord(payload.metadata) ? payload.metadata : {}
  const totals = {
    requests: Math.trunc(
      numberField(metadata, "total_api_requests") ||
        numberField(metadata, "api_requests") ||
        numberField(metadata, "requests"),
    ),
    tokens: Math.trunc(
      numberField(metadata, "total_tokens") || numberField(metadata, "tokens"),
    ),
  }
  const results = Array.isArray(payload.results) ? payload.results : []
  const usagePoints = results
    .map((item) => activityPoint(item))
    .filter((item): item is AdminInferenceUsagePoint => Boolean(item))
  const modelUsage = mergeUsageMaps(
    results.map((item) => modelUsageFromActivityResult(item)),
  )

  return {
    modelUsage,
    totals,
    usagePoints:
      usagePoints.length > 0
        ? usagePoints
        : [
            {
              requests: totals.requests,
              timestamp: dateOnlyToIso(window.endDate),
              tokens: totals.tokens,
            },
          ],
  }
}

function activityPoint(value: unknown): AdminInferenceUsagePoint | null {
  if (!isRecord(value)) {
    return null
  }
  const metrics = isRecord(value.metrics) ? value.metrics : value
  const timestamp = timestampField(value) ?? timestampField(metrics)
  if (!timestamp) {
    return null
  }
  return {
    requests: Math.trunc(
      numberField(metrics, "total_api_requests") ||
        numberField(metrics, "api_requests") ||
        numberField(metrics, "successful_requests") ||
        numberField(metrics, "requests"),
    ),
    timestamp,
    tokens: Math.trunc(
      numberField(metrics, "total_tokens") || numberField(metrics, "tokens"),
    ),
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
      return {
        lastUsedAt,
        model,
        requests: Math.trunc(
          numberField(metrics, "api_requests") ||
            numberField(metrics, "successful_requests") ||
            numberField(metrics, "requests"),
        ),
        spendUsd: nullableNumber(
          numberField(metrics, "spend") ||
            numberField(metrics, "cost") ||
            numberField(metrics, "response_cost"),
        ),
        tokens: Math.trunc(
          numberField(metrics, "total_tokens") || numberField(metrics, "tokens"),
        ),
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
  const rows = arrayPayload(payload)
  return rows
    .map((row, index) => modelFromRow(row, index))
    .filter((item): item is AdminInferenceModel => Boolean(item))
}

function modelFromRow(
  row: unknown,
  index: number,
): AdminInferenceModel | null {
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

function parseVirtualKeys(
  payload: unknown,
  indexOffset = 0,
): AdminInferenceVirtualKey[] {
  return arrayPayload(payload)
    .map((row, index) => virtualKeyFromRow(row, index + indexOffset))
    .filter((item): item is AdminInferenceVirtualKey => Boolean(item))
}

function virtualKeyFromRow(
  row: unknown,
  index: number,
): AdminInferenceVirtualKey | null {
  if (!isRecord(row)) {
    return null
  }
  const keyHash =
    stringField(row, "key_hash") ??
    stringField(row, "token_id") ??
    stringField(row, "id") ??
    stringField(row, "token")
  const expiresAt = timestampFieldFromFields(row, [
    "expires",
    "expires_at",
    "expiration",
  ])
  return {
    alias:
      safeAlias(stringField(row, "key_alias") ?? stringField(row, "alias")) ??
      `Virtual key ${index + 1}`,
    budgetUsd: nullableNumber(
      numberField(row, "max_budget") || numberField(row, "budget"),
    ),
    expiresAt,
    id: safeKeyId(keyHash, index),
    lastUsedAt: timestampFieldFromFields(row, [
      "last_active",
      "last_used_at",
      "last_used",
      "updated_at",
    ]),
    models: stringArrayField(row.models),
    owner:
      stringField(row, "user_email") ??
      stringField(row, "user_id") ??
      stringField(row, "created_by"),
    spendUsd: nullableNumber(numberField(row, "spend")),
    status: virtualKeyStatus(row, expiresAt),
    team:
      stringField(row, "team_alias") ??
      stringField(row, "team_id") ??
      stringField(row, "organization_id"),
  }
}

function arrayPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload
  }
  if (!isRecord(payload)) {
    return []
  }
  for (const field of ["data", "keys", "models", "model_info"]) {
    const value = payload[field]
    if (Array.isArray(value)) {
      return value
    }
  }
  return []
}

function totalPagesFromPayload(payload: unknown): number | null {
  if (!isRecord(payload)) {
    return null
  }
  const direct =
    integerField(payload, "total_pages") ?? integerField(payload, "totalPages")
  if (direct) {
    return direct
  }
  const metadata = isRecord(payload.metadata) ? payload.metadata : null
  return metadata
    ? (integerField(metadata, "total_pages") ??
        integerField(metadata, "totalPages"))
    : null
}

function modelInventory(
  models: AdminInferenceModel[] | null,
  modelUsage: AdminInferenceModelUsage[],
): AdminInferenceModel[] {
  if (models && models.length > 0) {
    return models
  }
  return modelUsage.map((usage, index) => ({
    contextWindow: null,
    id: `inferred-${index + 1}`,
    mode: null,
    name: usage.model,
    outputCostPerMillionTokens: null,
    provider: null,
    sourceStatus: "degraded",
  }))
}

function mergeModelUsage(
  activityUsage: AdminInferenceModelUsage[],
  logUsage: AdminInferenceModelUsage[],
): AdminInferenceModelUsage[] {
  if (logUsage.length === 0) {
    return sortModelUsage(activityUsage)
  }
  if (activityUsage.length === 0) {
    return sortModelUsage(logUsage)
  }

  const merged = new Map(
    activityUsage.map((usage) => [usage.model, { ...usage }]),
  )
  for (const usage of logUsage) {
    const existing = merged.get(usage.model)
    if (!existing) {
      merged.set(usage.model, { ...usage })
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
    (a, b) => b.requests - a.requests || b.tokens - a.tokens || a.model.localeCompare(b.model),
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

function totalsFromModelUsage(
  modelUsage: AdminInferenceModelUsage[],
): AdminInferenceDashboard["totals"] {
  return {
    requests: modelUsage.reduce((sum, item) => sum + item.requests, 0),
    tokens: modelUsage.reduce((sum, item) => sum + item.tokens, 0),
  }
}

function aggregateSourceStatus(
  statuses: InferenceCoreSourceStatus[],
): InferenceCoreSourceStatus {
  if (statuses.every((status) => status === "unavailable")) {
    return "unavailable"
  }
  if (statuses.some((status) => status !== "ok")) {
    return "degraded"
  }
  return "ok"
}

function emptyInferenceDashboard({
  generatedAt,
  modelUpdate,
  range,
  sourceStatus,
  summary,
}: {
  generatedAt: Date
  modelUpdate: AdminInferenceModelUpdate | null
  range: AdminInferenceRange
  sourceStatus: InferenceCoreSourceStatus
  summary: string
}): AdminInferenceDashboard {
  return {
    generatedAt: generatedAt.toISOString(),
    liteLlmUrl: liteLlmPublicUrl(),
    modelUpdate,
    modelUsage: [],
    models: [],
    range,
    sourceStatus,
    summary,
    totals: {
      requests: 0,
      tokens: 0,
    },
    usagePoints: [],
    virtualKeys: [],
  }
}

function inferenceSummary(
  totals: AdminInferenceDashboard["totals"],
  sourceStatus: InferenceCoreSourceStatus,
  range: AdminInferenceRange,
): string {
  if (sourceStatus === "unavailable") {
    return "LiteLLM is configured, but the BFF could not read inference usage."
  }
  return `LiteLLM reports ${formatNumber(totals.requests)} requests and ${formatNumber(totals.tokens)} tokens in the last ${range}.`
}

function readModelUpdate(): AdminInferenceModelUpdate | null {
  const status = process.env.INFERENCE_MODEL_UPDATE_STATUS?.trim()
  if (
    status !== "available" &&
    status !== "running" &&
    status !== "failed" &&
    status !== "blocked"
  ) {
    return null
  }
  return {
    affectedModels: envList("INFERENCE_MODEL_UPDATE_AFFECTED_MODELS"),
    availableVersion:
      process.env.INFERENCE_MODEL_UPDATE_AVAILABLE_VERSION?.trim() ??
      "Unknown",
    currentVersion:
      process.env.INFERENCE_MODEL_UPDATE_CURRENT_VERSION?.trim() ?? "Unknown",
    detail:
      process.env.INFERENCE_MODEL_UPDATE_DETAIL?.trim() ??
      "A governed model update is available.",
    estimatedDowntime:
      process.env.INFERENCE_MODEL_UPDATE_ESTIMATED_DOWNTIME?.trim() || null,
    releaseNotes:
      process.env.INFERENCE_MODEL_UPDATE_RELEASE_NOTES?.trim() || null,
    status,
    updateActionEnabled:
      process.env.INFERENCE_MODEL_UPDATE_ACTION_ENABLED === "true",
  }
}

function configuredModelUpdateOutcome():
  | "blocked"
  | "completed"
  | "failed"
  | "started" {
  const configured = process.env.INFERENCE_MODEL_UPDATE_APPLY_RESULT?.trim()
  if (
    configured === "blocked" ||
    configured === "failed" ||
    configured === "started"
  ) {
    return configured
  }
  return "completed"
}

function modelUpdateActionResponse({
  detail,
  modelUpdate,
  status,
}: {
  detail: string
  modelUpdate: AdminInferenceModelUpdate | null
  status: AdminInferenceModelUpdateActionResponse["status"]
}): AdminInferenceModelUpdateActionResponse {
  return {
    detail,
    generatedAt: new Date().toISOString(),
    modelUpdate,
    status,
  }
}

async function emitModelUpdateAudit(
  actor: Actor,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await emitAudit({
    action,
    actorId: actor.subject,
    metadata: {
      authMode: actor.authMode,
      ...metadata,
    },
    targetId: "inference-model-update",
    targetType: "admin.inference",
  })
}

function liteLlmPublicUrl(): string | null {
  if (expertCapability("litellm").directAccess !== "enabled") {
    return null
  }
  const configured =
    process.env.LITELLM_PUBLIC_URL?.trim() ||
    process.env.LITELLM_PUBLIC_ORIGIN?.trim() ||
    (canUseBffFixtureData() ? "https://litellm.example.test" : "")
  if (!configured) {
    return null
  }
  try {
    const parsed = new URL(configured)
    if (parsed.pathname && parsed.pathname !== "/") {
      return parsed.toString()
    }
    return new URL("/ui/", parsed).toString()
  } catch {
    return configured
  }
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

function stringArrayField(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
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

function safeAlias(value: string | null): string | null {
  if (!value || looksSensitive(value)) {
    return null
  }
  return value
}

function safeKeyId(value: string | null, index: number): string {
  if (!value) {
    return `virtual-key-${index + 1}`
  }
  if (looksSensitive(value)) {
    return `sha256:${hashValue(value).slice(0, 16)}`
  }
  return value
}

function looksSensitive(value: string): boolean {
  return /^sk-[a-z0-9_-]+/i.test(value) || value.toLowerCase().includes("secret")
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function virtualKeyStatus(
  row: Record<string, unknown>,
  expiresAt: string | null,
): AdminInferenceVirtualKey["status"] {
  if (row.blocked === true || stringField(row, "status") === "blocked") {
    return "blocked"
  }
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    return "expired"
  }
  const status = stringField(row, "status")
  return status === "active" ? "active" : "unknown"
}

function envList(name: string): string[] {
  return (
    process.env[name]
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  )
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
