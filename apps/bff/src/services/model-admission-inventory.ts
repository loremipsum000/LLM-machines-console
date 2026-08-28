import type { Dirent } from "node:fs"
import { readFile, readdir } from "node:fs/promises"
import { isAbsolute } from "node:path"
import { inferenceCoreCompatibilityFingerprint } from "@llm-machines/contracts/inference-core"
import { canUseBffFixtureData, isBffFixtureMode } from "../config/fixture-mode"
import { LiteLlmAdminClient, liteLlmConfig } from "./admin-litellm-client"

const PROFILE_FILE_MAX_BYTES = 1024 * 1024
const PROFILE_DIRECTORY_MAX_FILES = 64
const PROFILE_DIRECTORY_MAX_BYTES = 4 * 1024 * 1024
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{2,62}$/
const MODEL_ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/

export interface AuthoritativeModelInventory {
  aliases: string[]
  liteLlmModelInfo: unknown
  observedAt: string
  validUntil: string
}

export type AuthoritativeModelInventoryFailureReason =
  | "inconsistent"
  | "not_configured"
  | "stale"
  | "unavailable"

export type AuthoritativeModelInventoryResult =
  | ({ ok: true } & AuthoritativeModelInventory)
  | {
      detail: string
      ok: false
      reason: AuthoritativeModelInventoryFailureReason
    }

interface AdmittedCapability {
  alias: string
  validUntil: string
}

export async function getAuthoritativeModelInventory(
  options: { now?: Date; signal?: AbortSignal } = {},
): Promise<AuthoritativeModelInventoryResult> {
  const now = options.now ?? new Date()
  if (!Number.isFinite(now.getTime())) {
    return inventoryFailure("inconsistent")
  }

  if (
    !process.env.INFERENCE_MODEL_ADMISSION_DIR?.trim() &&
    isBffFixtureMode()
  ) {
    return fixtureInventory(now)
  }

  const capabilities = await readAdmittedCapabilities(now)
  if (!capabilities.ok) return capabilities

  const config = liteLlmConfig()
  if (!config) return inventoryFailure("not_configured")

  const client = new LiteLlmAdminClient(config)
  let payload: unknown
  try {
    payload = await readModelInfo(client, options.signal)
  } catch {
    return inventoryFailure("unavailable")
  }
  const configuredAliases = modelInfoAliases(payload)
  if (!configuredAliases) return inventoryFailure("inconsistent")

  const admittedAliases = capabilities.capabilities.map(({ alias }) => alias)
  if (admittedAliases.some((alias) => !configuredAliases.has(alias))) {
    return inventoryFailure("inconsistent")
  }

  return {
    aliases: [...admittedAliases].sort((left, right) =>
      left.localeCompare(right),
    ),
    liteLlmModelInfo: payload,
    observedAt: now.toISOString(),
    ok: true,
    validUntil: capabilities.capabilities
      .map(({ validUntil }) => validUntil)
      .sort()[0],
  }
}

async function readAdmittedCapabilities(
  now: Date,
): Promise<
  | { capabilities: AdmittedCapability[]; ok: true }
  | Extract<AuthoritativeModelInventoryResult, { ok: false }>
> {
  const directory = process.env.INFERENCE_MODEL_ADMISSION_DIR?.trim()
  if (!directory) {
    if (!canUseBffFixtureData()) return inventoryFailure("not_configured")
    const aliases = fixtureAliases()
    if (!aliases) return inventoryFailure("not_configured")
    return {
      capabilities: aliases.map((alias) => ({
        alias,
        validUntil: "9999-12-31T23:59:59.999Z",
      })),
      ok: true,
    }
  }
  if (!isAbsolute(directory) || directory.includes("\0")) {
    return inventoryFailure("not_configured")
  }

  let entries: Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return inventoryFailure("unavailable")
  }
  if (
    entries.length === 0 ||
    entries.length > PROFILE_DIRECTORY_MAX_FILES ||
    entries.some(
      (entry) =>
        !entry.isFile() || !/^[a-z0-9][a-z0-9._-]*\.json$/.test(entry.name),
    )
  ) {
    return inventoryFailure("inconsistent")
  }

  const capabilities: AdmittedCapability[] = []
  const aliases = new Set<string>()
  const profileIds = new Set<string>()
  let aggregateBytes = 0
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    let contents: Buffer
    try {
      contents = await readFile(`${directory}/${entry.name}`)
    } catch {
      return inventoryFailure("unavailable")
    }
    aggregateBytes += contents.byteLength
    if (
      contents.byteLength === 0 ||
      contents.byteLength > PROFILE_FILE_MAX_BYTES ||
      aggregateBytes > PROFILE_DIRECTORY_MAX_BYTES
    ) {
      return inventoryFailure("inconsistent")
    }
    let profile: unknown
    try {
      profile = JSON.parse(contents.toString("utf8"))
    } catch {
      return inventoryFailure("inconsistent")
    }
    const parsed = admittedCapability(profile, now)
    if (!parsed.ok) return parsed
    if (
      aliases.has(parsed.capability.alias) ||
      profileIds.has(parsed.profileId)
    ) {
      return inventoryFailure("inconsistent")
    }
    aliases.add(parsed.capability.alias)
    profileIds.add(parsed.profileId)
    capabilities.push(parsed.capability)
  }
  return { capabilities, ok: true }
}

function admittedCapability(
  value: unknown,
  now: Date,
):
  | { capability: AdmittedCapability; ok: true; profileId: string }
  | Extract<AuthoritativeModelInventoryResult, { ok: false }> {
  const profile = recordWithExactKeys(value, [
    "apiVersion",
    "capabilityAdvertisement",
    "coreCompatibilityFingerprint",
    "engine",
    "kind",
    "model",
    "network",
    "probes",
    "qualification",
    "rollback",
    "source",
  ])
  if (!profile) return inventoryFailure("inconsistent")
  const source = recordWithExactKeys(profile.source, ["profileId", "revision"])
  const advertisement = recordWithExactKeys(profile.capabilityAdvertisement, [
    "freshness",
    "models",
    "state",
  ])
  const qualification = recordWithExactKeys(profile.qualification, [
    "evidenceDigest",
    "productionCapacityClaim",
    "qualifiedProfileDigest",
    "scope",
  ])
  if (
    profile.apiVersion !== "inference-core.llm-machines/v1" ||
    profile.kind !== "RenderedInferenceDeliveryProfile" ||
    profile.coreCompatibilityFingerprint !==
      inferenceCoreCompatibilityFingerprint ||
    !source ||
    !PROFILE_ID_PATTERN.test(stringValue(source.profileId)) ||
    !Number.isSafeInteger(source.revision) ||
    Number(source.revision) < 1 ||
    !advertisement ||
    advertisement.state !== "ACTIVE_MEASURED" ||
    !qualification ||
    !SHA256_PATTERN.test(stringValue(qualification.evidenceDigest)) ||
    !SHA256_PATTERN.test(stringValue(qualification.qualifiedProfileDigest)) ||
    !admissionScopeAllowed(qualification)
  ) {
    return inventoryFailure("inconsistent")
  }

  const freshness = recordWithExactKeys(advertisement.freshness, [
    "measuredAt",
    "validUntil",
  ])
  const measuredAt = isoDateTime(freshness?.measuredAt)
  const validUntil = isoDateTime(freshness?.validUntil)
  if (
    !measuredAt ||
    !validUntil ||
    Date.parse(validUntil) <= Date.parse(measuredAt)
  ) {
    return inventoryFailure("inconsistent")
  }
  if (now.getTime() < Date.parse(measuredAt)) {
    return inventoryFailure("inconsistent")
  }
  if (now.getTime() >= Date.parse(validUntil)) {
    return inventoryFailure("stale")
  }

  if (
    !Array.isArray(advertisement.models) ||
    advertisement.models.length !== 1
  ) {
    return inventoryFailure("inconsistent")
  }
  const model = recordWithExactKeys(advertisement.models[0], [
    "alias",
    "contextTokens",
    "maxConcurrentRequests",
    "maxOutputTokens",
    "p95LatencyMilliseconds",
    "queue",
    "throughputTokensPerSecond",
  ])
  const alias = stringValue(model?.alias)
  if (
    !model ||
    !MODEL_ALIAS_PATTERN.test(alias) ||
    !positiveInteger(model.contextTokens) ||
    !positiveInteger(model.maxConcurrentRequests) ||
    !positiveInteger(model.maxOutputTokens) ||
    !positiveNumber(model.p95LatencyMilliseconds) ||
    !positiveNumber(model.throughputTokensPerSecond)
  ) {
    return inventoryFailure("inconsistent")
  }
  return {
    capability: { alias, validUntil },
    ok: true,
    profileId: stringValue(source.profileId),
  }
}

function admissionScopeAllowed(qualification: Record<string, unknown>) {
  if (
    qualification.scope === "PRODUCTION_DELIVERY" &&
    qualification.productionCapacityClaim === true
  ) {
    return true
  }
  return (
    qualification.scope === "INTERNAL_TEST_ONLY" &&
    qualification.productionCapacityClaim === false &&
    process.env.INFERENCE_ALLOW_INTERNAL_TEST_PROFILES === "true"
  )
}

async function readModelInfo(
  client: LiteLlmAdminClient,
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    return await client.getJson("/model/info", new URLSearchParams(), {
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    return client.getJson("/v1/model/info", new URLSearchParams(), { signal })
  }
}

function modelInfoAliases(payload: unknown): Set<string> | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : null
  if (!rows) return null
  const aliases = new Set<string>()
  for (const row of rows) {
    if (!isRecord(row)) return null
    const alias = optionalString(row.model_name)
    if (!alias || !MODEL_ALIAS_PATTERN.test(alias) || aliases.has(alias)) {
      return null
    }
    aliases.add(alias)
  }
  return aliases
}

function fixtureInventory(now: Date): AuthoritativeModelInventoryResult {
  const aliases = fixtureAliases()
  if (!aliases) return inventoryFailure("not_configured")
  return {
    aliases,
    liteLlmModelInfo: {
      data: aliases.map((modelName) => ({ model_name: modelName })),
    },
    observedAt: now.toISOString(),
    ok: true,
    validUntil: "9999-12-31T23:59:59.999Z",
  }
}

function fixtureAliases(): string[] | null {
  const configured = process.env.BFF_FALLBACK_MODELS
  if (configured === undefined) return null
  const aliases = configured
    .split(",")
    .map((alias) => alias.trim())
    .filter(Boolean)
  if (aliases.some((alias) => !MODEL_ALIAS_PATTERN.test(alias))) return null
  return [...new Set(aliases)].sort((left, right) => left.localeCompare(right))
}

function inventoryFailure(
  reason: AuthoritativeModelInventoryFailureReason,
): Extract<AuthoritativeModelInventoryResult, { ok: false }> {
  const details: Record<AuthoritativeModelInventoryFailureReason, string> = {
    inconsistent:
      "The active measured model admission and LiteLLM configuration do not agree.",
    not_configured:
      "The active measured model admission projection is not configured.",
    stale: "The active measured model admission evidence has expired.",
    unavailable:
      "The active measured model admission projection is temporarily unavailable.",
  }
  return { detail: details[reason], ok: false, reason }
}

function recordWithExactKeys(
  value: unknown,
  keys: string[],
): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  return JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort())
    ? value
    : null
}

function isoDateTime(value: unknown): string | null {
  if (typeof value !== "string") return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString() === value
    ? value
    : null
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function positiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
