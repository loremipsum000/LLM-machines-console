import { randomUUID } from "node:crypto"
import { isIP } from "node:net"
import {
  adminSettingsLogoAssetSchema,
  adminSettingsResponseSchema,
  adminSettingsTelemetryPayloadPreviewSchema,
  adminUrlPolicyRuleSchema,
  type AdminSettingsLicenseState,
  type AdminSettingsOrganization,
  type AdminSettingsPrivacy,
  type AdminSettingsResponse,
  type AdminUrlPolicyRule,
  type AdminUrlPolicyRuleScope,
  type CreateAdminUrlPolicyRuleRequest,
  type UpdateAdminSettingsOrganizationRequest,
  type UpdateAdminSettingsTelemetryRequest,
  type UpdateAdminUrlPolicyRuleRequest,
} from "@llm-machines/contracts"
import { and, desc, eq } from "drizzle-orm"
import Redis from "ioredis"
import { Client as MinioClient } from "minio"
import type { Actor } from "../auth/persona"
import { getDb } from "../db/client"
import {
  consoleSettings,
  licenseState,
  urlPolicyRules,
} from "../db/schema"
import {
  LiteLlmAdminClient,
  liteLlmConfig,
} from "./admin-litellm-client"
import { PrometheusClient } from "./admin-prometheus"
import { emitAudit } from "./audit"
import { defaultAdminSettingsResponse } from "./admin-settings-fixtures"
import {
  type SettingsLogoKind,
  validateSettingsLogoAsset,
} from "./admin-settings-validation"
import { getKnowledgeObjectStoreConfig } from "./knowledge/object-store"
import { upsertActorUser } from "./users"

const singletonSettingsId = "singleton"
const singletonLicenseId = "singleton"

type SettingsMutationResult =
  | { settings: AdminSettingsResponse; status: "ok" }
  | { detail: string; status: "invalid" | "duplicate" | "not_found" }

type ReachabilityService = AdminSettingsResponse["reachability"][number]
type ReachabilityStatus = ReachabilityService["status"]
type ReachabilityCheck = Pick<
  ReachabilityService,
  "detail" | "lastCheckedAt" | "status"
>

export type AdminUrlPolicyDecision =
  | {
      matchedRuleIds: string[]
      mode: "trusted" | "default_allow"
      normalizedUrl: string
      status: "allowed"
    }
  | {
      detail: string
      matchedRuleIds: string[]
      mode: "forbidden"
      normalizedUrl: string
      status: "blocked"
    }

let memoryOrganization = defaultAdminSettingsResponse().organization
let memoryPrivacy = defaultAdminSettingsResponse().privacy
let memoryLicense = defaultAdminSettingsResponse().license
let memoryUrlPolicyRules: AdminUrlPolicyRule[] = []

export async function getAdminSettings(
  actor: Actor,
): Promise<AdminSettingsResponse> {
  const settings = await readSettings()
  await emitAudit({
    actorId: actor.subject,
    action: "admin.settings.read",
    targetType: "admin.settings",
    targetId: singletonSettingsId,
    metadata: {
      urlPolicyRuleCount: settings.urlPolicyRules.length,
    },
  })
  return settings
}

export async function updateAdminSettingsOrganization(
  actor: Actor,
  request: UpdateAdminSettingsOrganizationRequest,
): Promise<SettingsMutationResult> {
  const fullLogoValidation = validateOptionalLogo(request.fullLogo, "full")
  if (!fullLogoValidation.valid) {
    return { status: "invalid", detail: fullLogoValidation.detail }
  }
  const iconLogoValidation = validateOptionalLogo(request.iconLogo, "icon")
  if (!iconLogoValidation.valid) {
    return { status: "invalid", detail: iconLogoValidation.detail }
  }

  const now = new Date()
  const updatedOrganization: AdminSettingsOrganization = {
    organizationName: request.organizationName,
    defaultLanguage: request.defaultLanguage,
    fullLogo:
      request.fullLogo === undefined
        ? (await readSettings()).organization.fullLogo
        : fullLogoValidation.asset,
    iconLogo:
      request.iconLogo === undefined
        ? (await readSettings()).organization.iconLogo
        : iconLogoValidation.asset,
    updatedAt: now.toISOString(),
    updatedBy: actor.subject,
  }

  const db = getDb()
  if (db) {
    const persistedActor = await upsertActorUser(actor)
    const existingSettings = await readSettings()
    await db
      .insert(consoleSettings)
      .values({
        id: singletonSettingsId,
        organizationName: updatedOrganization.organizationName,
        defaultLanguage: updatedOrganization.defaultLanguage,
        fullLogo: updatedOrganization.fullLogo,
        iconLogo: updatedOrganization.iconLogo,
        telemetryEnabled: existingSettings.privacy.telemetryEnabled,
        telemetryPayloadPreview:
          existingSettings.privacy.telemetryPayloadPreview,
        privacyPolicyHref: existingSettings.privacy.privacyPolicyHref,
        dataResidencyStatement:
          existingSettings.privacy.dataResidencyStatement,
        updatedBy: persistedActor.subject,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: consoleSettings.id,
        set: {
          organizationName: updatedOrganization.organizationName,
          defaultLanguage: updatedOrganization.defaultLanguage,
          fullLogo: updatedOrganization.fullLogo,
          iconLogo: updatedOrganization.iconLogo,
          updatedBy: persistedActor.subject,
          updatedAt: now,
        },
      })
  } else {
    memoryOrganization = updatedOrganization
  }

  await emitAudit({
    actorId: actor.subject,
    action: "admin.settings.organization.updated",
    targetType: "admin.settings",
    targetId: singletonSettingsId,
    metadata: {
      defaultLanguage: updatedOrganization.defaultLanguage,
      fullLogoPresent: Boolean(updatedOrganization.fullLogo),
      iconLogoPresent: Boolean(updatedOrganization.iconLogo),
    },
  })

  return { status: "ok", settings: await readSettings() }
}

export async function createAdminUrlPolicyRule(
  actor: Actor,
  request: CreateAdminUrlPolicyRuleRequest,
): Promise<SettingsMutationResult> {
  const normalized = normalizeUrlPolicyPattern(request.pattern)
  if (!normalized.valid) {
    return { status: "invalid", detail: normalized.detail }
  }

  const existing = await findUrlPolicyRule(
    request.type,
    normalized.pattern,
    request.scope,
  )
  if (existing) {
    return {
      status: "duplicate",
      detail: "A URL policy rule with the same type, pattern, and scope already exists.",
    }
  }

  const now = new Date()
  const rule: AdminUrlPolicyRule = {
    id: randomUUID(),
    type: request.type,
    pattern: request.pattern.trim(),
    normalizedPattern: normalized.pattern,
    scope: request.scope,
    reason: request.reason,
    status: "active",
    createdBy: actor.subject,
    updatedBy: actor.subject,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }

  const db = getDb()
  if (db) {
    const persistedActor = await upsertActorUser(actor)
    await db.insert(urlPolicyRules).values({
      id: rule.id,
      ruleType: rule.type,
      pattern: rule.pattern,
      normalizedPattern: rule.normalizedPattern,
      scope: rule.scope,
      reason: rule.reason,
      status: rule.status,
      createdBy: persistedActor.subject,
      updatedBy: persistedActor.subject,
      createdAt: now,
      updatedAt: now,
    })
  } else {
    memoryUrlPolicyRules = [rule, ...memoryUrlPolicyRules]
  }

  await emitAudit({
    actorId: actor.subject,
    action: `admin.url_policy.${request.type}.created`,
    targetType: "admin.url_policy_rule",
    targetId: rule.id,
    reason: rule.reason,
    metadata: {
      normalizedPattern: rule.normalizedPattern,
      scope: rule.scope,
      status: rule.status,
      type: rule.type,
    },
  })

  return { status: "ok", settings: await readSettings() }
}

export async function updateAdminUrlPolicyRule(
  actor: Actor,
  id: string,
  request: UpdateAdminUrlPolicyRuleRequest,
): Promise<SettingsMutationResult> {
  const existing = await findUrlPolicyRuleById(id)
  if (!existing) {
    return { status: "not_found", detail: "URL policy rule not found." }
  }

  const normalized = normalizeUrlPolicyPattern(request.pattern)
  if (!normalized.valid) {
    return { status: "invalid", detail: normalized.detail }
  }

  const duplicate = await findUrlPolicyRule(
    request.type,
    normalized.pattern,
    request.scope,
  )
  if (duplicate && duplicate.id !== id) {
    return {
      status: "duplicate",
      detail: "A URL policy rule with the same type, pattern, and scope already exists.",
    }
  }

  const now = new Date()
  const updatedRule: AdminUrlPolicyRule = {
    ...existing,
    type: request.type,
    pattern: request.pattern.trim(),
    normalizedPattern: normalized.pattern,
    scope: request.scope,
    reason: request.reason,
    status: request.status,
    updatedAt: now.toISOString(),
    updatedBy: actor.subject,
  }

  const db = getDb()
  if (db) {
    const persistedActor = await upsertActorUser(actor)
    await db
      .update(urlPolicyRules)
      .set({
        ruleType: updatedRule.type,
        pattern: updatedRule.pattern,
        normalizedPattern: updatedRule.normalizedPattern,
        scope: updatedRule.scope,
        reason: updatedRule.reason,
        status: updatedRule.status,
        updatedBy: persistedActor.subject,
        updatedAt: now,
      })
      .where(eq(urlPolicyRules.id, id))
  } else {
    memoryUrlPolicyRules = memoryUrlPolicyRules.map((rule) =>
      rule.id === id ? updatedRule : rule,
    )
  }

  await emitAudit({
    actorId: actor.subject,
    action: "admin.url_policy.updated",
    targetType: "admin.url_policy_rule",
    targetId: id,
    reason: updatedRule.reason,
    metadata: {
      normalizedPattern: updatedRule.normalizedPattern,
      scope: updatedRule.scope,
      status: updatedRule.status,
      type: updatedRule.type,
    },
  })

  return { status: "ok", settings: await readSettings() }
}

export async function disableAdminUrlPolicyRule(
  actor: Actor,
  id: string,
): Promise<SettingsMutationResult> {
  const existing = await findUrlPolicyRuleById(id)
  if (!existing) {
    return { status: "not_found", detail: "URL policy rule not found." }
  }

  const now = new Date()
  const updatedRule: AdminUrlPolicyRule = {
    ...existing,
    status: "disabled",
    updatedAt: now.toISOString(),
    updatedBy: actor.subject,
  }

  const db = getDb()
  if (db) {
    const persistedActor = await upsertActorUser(actor)
    await db
      .update(urlPolicyRules)
      .set({
        status: "disabled",
        updatedBy: persistedActor.subject,
        updatedAt: now,
      })
      .where(eq(urlPolicyRules.id, id))
  } else {
    memoryUrlPolicyRules = memoryUrlPolicyRules.map((rule) =>
      rule.id === id ? updatedRule : rule,
    )
  }

  await emitAudit({
    actorId: actor.subject,
    action: "admin.url_policy.disabled",
    targetType: "admin.url_policy_rule",
    targetId: id,
    reason: existing.reason,
    metadata: {
      normalizedPattern: existing.normalizedPattern,
      scope: existing.scope,
      type: existing.type,
    },
  })

  return { status: "ok", settings: await readSettings() }
}

export async function deleteAdminUrlPolicyRule(
  actor: Actor,
  id: string,
): Promise<SettingsMutationResult> {
  const existing = await findUrlPolicyRuleById(id)
  if (!existing) {
    return { status: "not_found", detail: "URL policy rule not found." }
  }

  const db = getDb()
  if (db) {
    await db.delete(urlPolicyRules).where(eq(urlPolicyRules.id, id))
  } else {
    memoryUrlPolicyRules = memoryUrlPolicyRules.filter((rule) => rule.id !== id)
  }

  await emitAudit({
    actorId: actor.subject,
    action: "admin.url_policy.deleted",
    targetType: "admin.url_policy_rule",
    targetId: id,
    reason: existing.reason,
    metadata: {
      normalizedPattern: existing.normalizedPattern,
      scope: existing.scope,
      status: existing.status,
      type: existing.type,
    },
  })

  return { status: "ok", settings: await readSettings() }
}

export async function updateAdminSettingsTelemetry(
  actor: Actor,
  request: UpdateAdminSettingsTelemetryRequest,
): Promise<SettingsMutationResult> {
  const now = new Date()
  const existingSettings = await readSettings()
  const updatedPrivacy: AdminSettingsPrivacy = {
    ...existingSettings.privacy,
    telemetryEnabled: request.enabled,
    updatedAt: now.toISOString(),
    updatedBy: actor.subject,
  }
  const updatedLicense: AdminSettingsLicenseState = {
    ...existingSettings.license,
    telemetryOptIn: request.enabled,
  }

  const db = getDb()
  if (db) {
    const persistedActor = await upsertActorUser(actor)
    await db.transaction(async (tx) => {
      await tx
        .insert(consoleSettings)
        .values({
          id: singletonSettingsId,
          organizationName: existingSettings.organization.organizationName,
          defaultLanguage: existingSettings.organization.defaultLanguage,
          fullLogo: existingSettings.organization.fullLogo,
          iconLogo: existingSettings.organization.iconLogo,
          telemetryEnabled: request.enabled,
          telemetryPayloadPreview: updatedPrivacy.telemetryPayloadPreview,
          privacyPolicyHref: updatedPrivacy.privacyPolicyHref,
          dataResidencyStatement: updatedPrivacy.dataResidencyStatement,
          updatedBy: persistedActor.subject,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: consoleSettings.id,
          set: {
            telemetryEnabled: request.enabled,
            updatedBy: persistedActor.subject,
            updatedAt: now,
          },
        })

      await tx
        .insert(licenseState)
        .values({
          id: singletonLicenseId,
          sourceStatus: updatedLicense.sourceStatus,
          subscriptionState: updatedLicense.subscriptionState,
          supportState: updatedLicense.supportState,
          applianceId: updatedLicense.applianceId,
          certificateExpiresAt: dateOrNull(
            updatedLicense.certificateExpiresAt,
          ),
          lastEntitlementCheckAt: dateOrNull(
            updatedLicense.lastEntitlementCheckAt,
          ),
          offlineMode: updatedLicense.offlineMode,
          telemetryOptIn: updatedLicense.telemetryOptIn,
          allowedUpdateChannels: updatedLicense.allowedUpdateChannels,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: licenseState.id,
          set: {
            telemetryOptIn: updatedLicense.telemetryOptIn,
            updatedAt: now,
          },
        })
    })
  } else {
    memoryPrivacy = updatedPrivacy
    memoryLicense = updatedLicense
  }

  await emitAudit({
    actorId: actor.subject,
    action: request.enabled
      ? "admin.settings.telemetry.enabled"
      : "admin.settings.telemetry.disabled",
    targetType: "admin.settings",
    targetId: singletonSettingsId,
    metadata: {
      enabled: request.enabled,
    },
  })

  return { status: "ok", settings: await readSettings() }
}

export async function evaluateAdminUrlPolicyForScope(
  rawUrl: string,
  scope: AdminUrlPolicyRuleScope,
): Promise<AdminUrlPolicyDecision> {
  const normalized = normalizeUrlPolicyPattern(rawUrl)
  if (!normalized.valid) {
    return {
      status: "blocked",
      mode: "forbidden",
      detail: normalized.detail,
      normalizedUrl: rawUrl,
      matchedRuleIds: [],
    }
  }

  const candidateUrl = new URL(normalized.pattern)
  const rules = (await readSettings()).urlPolicyRules.filter(
    (rule) =>
      rule.status === "active" &&
      (rule.scope === scope || rule.scope === "all") &&
      urlPolicyRuleMatches(rule, candidateUrl),
  )
  const forbiddenRules = rules.filter((rule) => rule.type === "forbidden")
  if (forbiddenRules.length > 0) {
    return {
      status: "blocked",
      mode: "forbidden",
      detail: "URL is blocked by URL governance policy.",
      normalizedUrl: normalized.pattern,
      matchedRuleIds: forbiddenRules.map((rule) => rule.id),
    }
  }

  const trustedRules = rules.filter((rule) => rule.type === "trusted")
  return {
    status: "allowed",
    mode: trustedRules.length > 0 ? "trusted" : "default_allow",
    normalizedUrl: normalized.pattern,
    matchedRuleIds: trustedRules.map((rule) => rule.id),
  }
}

export function resetAdminSettingsForTest(): void {
  const defaults = defaultAdminSettingsResponse()
  memoryOrganization = defaults.organization
  memoryPrivacy = defaults.privacy
  memoryLicense = defaults.license
  memoryUrlPolicyRules = []
}

async function resolveSettingsReachability(
  services: ReachabilityService[],
  postgresReachable: boolean,
): Promise<ReachabilityService[]> {
  const checkedAt = new Date().toISOString()
  const checks = await Promise.all([
    Promise.resolve([
      "web",
      checked(
        "ok",
        "Console web rendered this BFF-backed Settings response.",
        checkedAt,
      ),
    ] as const),
    Promise.resolve([
      "bff",
      checked(
        "ok",
        "BFF Settings API handled this authenticated request.",
        checkedAt,
      ),
    ] as const),
    Promise.resolve([
      "postgres",
      postgresReachable
        ? checked("ok", "Postgres settings persistence is reachable.", checkedAt)
        : notConfigured("Database persistence is not configured."),
    ] as const),
    checkRedis(checkedAt).then((check) => ["redis", check] as const),
    checkMinio(checkedAt).then((check) => ["minio", check] as const),
    checkKeycloak(checkedAt).then((check) => ["keycloak", check] as const),
    checkLiteLlm(checkedAt).then((check) => ["litellm", check] as const),
    checkLibreChat(checkedAt).then((check) => ["librechat", check] as const),
    checkHardwareTelemetry(checkedAt).then(
      (check) => ["grafana", check] as const,
    ),
    checkAgenticAdapter(checkedAt).then(
      (check) => ["agentic_adapter", check] as const,
    ),
  ])
  const checksById = new Map(checks)

  return services.map((service) => ({
    ...service,
    ...(checksById.get(service.id) ?? {}),
  }))
}

async function checkRedis(checkedAt: string): Promise<ReachabilityCheck> {
  const redisUrl = process.env.REDIS_URL?.trim()
  if (!redisUrl) {
    return notConfigured("Redis coordination backend is not configured.")
  }

  const client = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: reachabilityTimeoutMs(),
  })
  try {
    if (client.status === "wait") {
      await client.connect()
    }
    const pong = await withTimeout(client.ping(), reachabilityTimeoutMs())
    return pong === "PONG"
      ? checked("ok", "Redis coordination backend responded to ping.", checkedAt)
      : checked(
          "degraded",
          "Redis coordination backend responded unexpectedly.",
          checkedAt,
        )
  } catch {
    return checked(
      "unavailable",
      "Redis coordination backend did not respond.",
      checkedAt,
    )
  } finally {
    client.disconnect()
  }
}

async function checkMinio(checkedAt: string): Promise<ReachabilityCheck> {
  if (
    !requiredEnvPresent([
      "MINIO_ENDPOINT",
      "MINIO_ACCESS_KEY",
      "MINIO_SECRET_KEY",
      "KNOWLEDGE_MINIO_BUCKET",
    ])
  ) {
    return notConfigured("Knowledge object storage is not configured.")
  }

  try {
    const config = getKnowledgeObjectStoreConfig()
    const client = new MinioClient({
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    })
    const exists = await withTimeout(
      client.bucketExists(config.bucket),
      reachabilityTimeoutMs(),
    )
    return exists
      ? checked("ok", "Knowledge object storage bucket is reachable.", checkedAt)
      : checked(
          "degraded",
          "Knowledge object storage is configured but the bucket is missing.",
          checkedAt,
        )
  } catch {
    return checked(
      "unavailable",
      "Knowledge object storage did not respond.",
      checkedAt,
    )
  }
}

async function checkKeycloak(checkedAt: string): Promise<ReachabilityCheck> {
  if (
    !requiredEnvPresent([
      "KEYCLOAK_ADMIN_BASE_URL",
      "KEYCLOAK_ADMIN_REALM",
      "KEYCLOAK_ADMIN_CLIENT_ID",
      "KEYCLOAK_ADMIN_CLIENT_SECRET",
    ])
  ) {
    return notConfigured("Keycloak Admin API is not configured.")
  }

  const realmUrl = appendPath(
    process.env.KEYCLOAK_ADMIN_BASE_URL ?? "",
    `realms/${encodeURIComponent(process.env.KEYCLOAK_ADMIN_REALM ?? "")}`,
  )
  if (!realmUrl) {
    return checked(
      "degraded",
      "Keycloak Admin API configuration is invalid.",
      checkedAt,
    )
  }

  try {
    const response = await fetch(realmUrl, {
      signal: AbortSignal.timeout(reachabilityTimeoutMs()),
    })
    return response.ok
      ? checked("ok", "Keycloak realm metadata is reachable.", checkedAt)
      : checked("unavailable", "Keycloak realm metadata is not reachable.", checkedAt)
  } catch {
    return checked(
      "unavailable",
      "Keycloak Admin API did not respond.",
      checkedAt,
    )
  }
}

async function checkLiteLlm(checkedAt: string): Promise<ReachabilityCheck> {
  const config = liteLlmConfig()
  if (!config) {
    return notConfigured("LiteLLM Admin API is not configured.")
  }

  try {
    await new LiteLlmAdminClient(config).getJson("/v1/models")
    return checked("ok", "LiteLLM model inventory is reachable.", checkedAt)
  } catch {
    return checked("unavailable", "LiteLLM Admin API did not respond.", checkedAt)
  }
}

async function checkLibreChat(checkedAt: string): Promise<ReachabilityCheck> {
  const libreChatUrl = configuredUrl(
    "LIBRECHAT_PUBLIC_URL",
    "LIBRECHAT_PUBLIC_ORIGIN",
  )
  if (!libreChatUrl) {
    return notConfigured("LibreChat public route is not configured.")
  }

  const url = parseUrl(libreChatUrl)
  if (!url) {
    return checked(
      "degraded",
      "LibreChat public route configuration is invalid.",
      checkedAt,
    )
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(reachabilityTimeoutMs()),
    })
    return response.ok
      ? checked("ok", "LibreChat public route is reachable.", checkedAt)
      : checked("unavailable", "LibreChat public route is not reachable.", checkedAt)
  } catch {
    return checked(
      "unavailable",
      "LibreChat public route did not respond.",
      checkedAt,
    )
  }
}

async function checkHardwareTelemetry(
  checkedAt: string,
): Promise<ReachabilityCheck> {
  const prometheusBaseUrl = process.env.ADMIN_PROMETHEUS_BASE_URL?.trim()
  if (prometheusBaseUrl) {
    try {
      const samples = await new PrometheusClient(prometheusBaseUrl).query(
        'up{job=~"node|dcgm|ipmi|infra_https_endpoint"}',
      )
      return samples.length > 0
        ? checked("ok", "Hardware telemetry backend is reachable.", checkedAt)
        : checked(
            "degraded",
            "Hardware telemetry backend responded without target data.",
            checkedAt,
          )
    } catch {
      return checked(
        "unavailable",
        "Hardware telemetry backend did not respond.",
        checkedAt,
      )
    }
  }

  const grafanaUrl = configuredUrl("GRAFANA_PUBLIC_URL", "GRAFANA_PUBLIC_ORIGIN")
  if (!grafanaUrl) {
    return notConfigured("Hardware telemetry backend is not configured.")
  }

  const url = parseUrl(grafanaUrl)
  if (!url) {
    return checked(
      "degraded",
      "Hardware telemetry link configuration is invalid.",
      checkedAt,
    )
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(reachabilityTimeoutMs()),
    })
    return response.ok
      ? checked("ok", "Hardware telemetry link is reachable.", checkedAt)
      : checked("unavailable", "Hardware telemetry link is not reachable.", checkedAt)
  } catch {
    return checked(
      "unavailable",
      "Hardware telemetry link did not respond.",
      checkedAt,
    )
  }
}

async function checkAgenticAdapter(
  checkedAt: string,
): Promise<ReachabilityCheck> {
  const adapterBaseUrl = configuredUrl("AGENTIC_ADAPTER_BASE_URL")
  const adapterToken = process.env.AGENTIC_ADAPTER_TOKEN?.trim()
  if (!adapterBaseUrl || !adapterToken) {
    return notConfigured("Agentic adapter diagnostics are not configured.")
  }

  const diagnosticsUrl = appendPath(adapterBaseUrl, "v1/diagnostics")
  if (!diagnosticsUrl) {
    return checked(
      "degraded",
      "Agentic adapter configuration is invalid.",
      checkedAt,
    )
  }

  try {
    const response = await fetch(diagnosticsUrl, {
      headers: {
        Authorization: `Bearer ${adapterToken}`,
      },
      signal: AbortSignal.timeout(reachabilityTimeoutMs()),
    })
    if (!response.ok) {
      return checked(
        "unavailable",
        "Agentic adapter diagnostics are not reachable.",
        checkedAt,
      )
    }

    const body = await response.json().catch(() => null)
    const status =
      typeof body === "object" &&
      body !== null &&
      "status" in body &&
      typeof body.status === "string"
        ? body.status
        : null
    return status === "ok"
      ? checked("ok", "Agentic adapter diagnostics are reachable.", checkedAt)
      : checked(
          "degraded",
          "Agentic adapter diagnostics responded with a degraded state.",
          checkedAt,
        )
  } catch {
    return checked(
      "unavailable",
      "Agentic adapter diagnostics did not respond.",
      checkedAt,
    )
  }
}

function checked(
  status: ReachabilityStatus,
  detail: string,
  lastCheckedAt: string,
): ReachabilityCheck {
  return { status, detail, lastCheckedAt }
}

function notConfigured(detail: string): ReachabilityCheck {
  return { status: "not_configured", detail, lastCheckedAt: null }
}

function configuredUrl(
  primaryEnv: string,
  fallbackEnv?: string,
): string | null {
  return (
    process.env[primaryEnv]?.trim() ||
    (fallbackEnv ? process.env[fallbackEnv]?.trim() : "") ||
    null
  )
}

function appendPath(baseUrl: string, path: string): URL | null {
  try {
    const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
    return new URL(path.replace(/^\/+/, ""), root)
  } catch {
    return null
  }
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function requiredEnvPresent(names: string[]): boolean {
  return names.every((name) => Boolean(process.env[name]?.trim()))
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out.")), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

function reachabilityTimeoutMs(): number {
  const parsed = Number.parseInt(
    process.env.ADMIN_SETTINGS_REACHABILITY_TIMEOUT_MS ?? "",
    10,
  )
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2500
}

async function readSettings(): Promise<AdminSettingsResponse> {
  const db = getDb()
  const defaults = defaultAdminSettingsResponse()
  if (!db) {
    return adminSettingsResponseSchema.parse({
      ...defaults,
      organization: memoryOrganization,
      urlPolicyRules: memoryUrlPolicyRules,
      reachability: await resolveSettingsReachability(
        defaults.reachability,
        false,
      ),
      license: memoryLicense,
      privacy: memoryPrivacy,
    })
  }

  const [settingsRow] = await db
    .select()
    .from(consoleSettings)
    .where(eq(consoleSettings.id, singletonSettingsId))
    .limit(1)
  const [licenseRow] = await db
    .select()
    .from(licenseState)
    .where(eq(licenseState.id, singletonLicenseId))
    .limit(1)
  const ruleRows = await db
    .select()
    .from(urlPolicyRules)
    .orderBy(desc(urlPolicyRules.updatedAt))

  return adminSettingsResponseSchema.parse({
    ...defaults,
    sourceStatus: "ok",
    organization: settingsRow
      ? {
          organizationName: settingsRow.organizationName,
          defaultLanguage: settingsRow.defaultLanguage,
          fullLogo: parseLogo(settingsRow.fullLogo),
          iconLogo: parseLogo(settingsRow.iconLogo),
          updatedAt: settingsRow.updatedAt.toISOString(),
          updatedBy: settingsRow.updatedBy,
        }
      : defaults.organization,
    urlPolicyRules: ruleRows.map((row) => ({
      id: row.id,
      type: row.ruleType,
      pattern: row.pattern,
      normalizedPattern: row.normalizedPattern,
      scope: row.scope,
      reason: row.reason,
      status: row.status,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    reachability: await resolveSettingsReachability(defaults.reachability, true),
    license: licenseRow
      ? {
          sourceStatus: licenseRow.sourceStatus,
          subscriptionState: licenseRow.subscriptionState,
          supportState: licenseRow.supportState,
          applianceId: licenseRow.applianceId,
          certificateExpiresAt:
            licenseRow.certificateExpiresAt?.toISOString() ?? null,
          lastEntitlementCheckAt:
            licenseRow.lastEntitlementCheckAt?.toISOString() ?? null,
          offlineMode: licenseRow.offlineMode,
          telemetryOptIn: licenseRow.telemetryOptIn,
          allowedUpdateChannels: Array.isArray(
            licenseRow.allowedUpdateChannels,
          )
            ? licenseRow.allowedUpdateChannels
            : [],
        }
      : defaults.license,
    privacy: settingsRow
      ? {
          ...defaults.privacy,
          telemetryEnabled: settingsRow.telemetryEnabled,
          telemetryPayloadPreview:
            adminSettingsTelemetryPayloadPreviewSchema.parse(
              settingsRow.telemetryPayloadPreview,
            ),
          privacyPolicyHref: settingsRow.privacyPolicyHref,
          dataResidencyStatement: settingsRow.dataResidencyStatement,
          updatedAt: settingsRow.updatedAt.toISOString(),
          updatedBy: settingsRow.updatedBy,
        }
      : defaults.privacy,
  })
}

async function findUrlPolicyRuleById(
  id: string,
): Promise<AdminUrlPolicyRule | null> {
  const db = getDb()
  if (!db) {
    return memoryUrlPolicyRules.find((rule) => rule.id === id) ?? null
  }

  const [row] = await db
    .select()
    .from(urlPolicyRules)
    .where(eq(urlPolicyRules.id, id))
    .limit(1)
  if (!row) {
    return null
  }
  return rowToUrlPolicyRule(row)
}

function rowToUrlPolicyRule(row: typeof urlPolicyRules.$inferSelect): AdminUrlPolicyRule {
  return adminUrlPolicyRuleSchema.parse({
    id: row.id,
    type: row.ruleType,
    pattern: row.pattern,
    normalizedPattern: row.normalizedPattern,
    scope: row.scope,
    reason: row.reason,
    status: row.status,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}

async function findUrlPolicyRule(
  type: AdminUrlPolicyRule["type"],
  normalizedPattern: string,
  scope: AdminUrlPolicyRule["scope"],
): Promise<AdminUrlPolicyRule | null> {
  const db = getDb()
  if (!db) {
    return (
      memoryUrlPolicyRules.find(
        (rule) =>
          rule.type === type &&
          rule.normalizedPattern === normalizedPattern &&
          rule.scope === scope,
      ) ?? null
    )
  }

  const [row] = await db
    .select()
    .from(urlPolicyRules)
    .where(
      and(
        eq(urlPolicyRules.ruleType, type),
        eq(urlPolicyRules.normalizedPattern, normalizedPattern),
        eq(urlPolicyRules.scope, scope),
      ),
    )
    .limit(1)
  if (!row) {
    return null
  }
  return rowToUrlPolicyRule(row)
}

function validateOptionalLogo(
  logo: UpdateAdminSettingsOrganizationRequest["fullLogo"],
  kind: SettingsLogoKind,
):
  | { asset: AdminSettingsOrganization["fullLogo"]; valid: true }
  | {
      detail: string
      valid: false
    } {
  if (logo === undefined || logo === null) {
    return { asset: null, valid: true }
  }
  const result = validateSettingsLogoAsset(logo, kind)
  return result.valid ? { asset: result.asset, valid: true } : result
}

function parseLogo(value: unknown): AdminSettingsOrganization["fullLogo"] {
  if (value === null || value === undefined) {
    return null
  }
  return adminSettingsLogoAssetSchema.parse(value)
}

function dateOrNull(value: string | null): Date | null {
  return value ? new Date(value) : null
}

function normalizeUrlPolicyPattern(
  pattern: string,
): { pattern: string; valid: true } | { detail: string; valid: false } {
  const trimmed = pattern.trim()
  if (/^https?:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed)
    if (parsed.username || parsed.password) {
      return {
        valid: false,
        detail: "URL policy rules cannot contain embedded credentials.",
      }
    }
    const hostDecision = validatePolicyHost(parsed.hostname)
    if (!hostDecision.valid) {
      return hostDecision
    }
    parsed.protocol = parsed.protocol.toLowerCase()
    parsed.hostname = parsed.hostname.toLowerCase()
    parsed.hash = ""
    if (
      (parsed.protocol === "https:" && parsed.port === "443") ||
      (parsed.protocol === "http:" && parsed.port === "80")
    ) {
      parsed.port = ""
    }
    return { valid: true, pattern: parsed.toString() }
  }

  const normalizedDomain = trimmed.toLowerCase()
  const domain = normalizedDomain.startsWith("*.")
    ? normalizedDomain.slice(2)
    : normalizedDomain
  const hostDecision = validatePolicyHost(domain)
  if (!hostDecision.valid) {
    return hostDecision
  }
  return { valid: true, pattern: normalizedDomain }
}

function urlPolicyRuleMatches(
  rule: AdminUrlPolicyRule,
  candidateUrl: URL,
): boolean {
  if (/^https?:\/\//i.test(rule.normalizedPattern)) {
    return urlPatternMatches(rule.normalizedPattern, candidateUrl)
  }
  return domainPatternMatches(rule.normalizedPattern, candidateUrl.hostname)
}

function urlPatternMatches(pattern: string, candidateUrl: URL): boolean {
  const ruleUrl = new URL(pattern)
  if (
    ruleUrl.protocol !== candidateUrl.protocol ||
    ruleUrl.hostname.toLowerCase() !== candidateUrl.hostname.toLowerCase()
  ) {
    return false
  }
  if (ruleUrl.port !== candidateUrl.port) {
    return false
  }
  const rulePath = stripTrailingSlashes(ruleUrl.pathname)
  const candidatePath = stripTrailingSlashes(candidateUrl.pathname)
  if (rulePath !== "/" && !candidatePath.startsWith(`${rulePath}/`)) {
    return candidatePath === rulePath
  }
  if (ruleUrl.search && ruleUrl.search !== candidateUrl.search) {
    return false
  }
  return true
}

function domainPatternMatches(pattern: string, hostname: string): boolean {
  const normalizedHost = hostname.toLowerCase()
  if (pattern.startsWith("*.")) {
    const domain = pattern.slice(2)
    return normalizedHost !== domain && normalizedHost.endsWith(`.${domain}`)
  }
  return normalizedHost === pattern || normalizedHost.endsWith(`.${pattern}`)
}

function stripTrailingSlashes(pathname: string): string {
  if (pathname === "/") {
    return pathname
  }
  return pathname.replace(/\/+$/g, "")
}

function validatePolicyHost(
  host: string,
): { valid: true } | { detail: string; valid: false } {
  const normalizedHost = host.toLowerCase()
  if (
    normalizedHost === "localhost" ||
    normalizedHost.endsWith(".localhost") ||
    normalizedHost.endsWith(".local")
  ) {
    return {
      valid: false,
      detail: "Localhost and local-only hosts cannot be added to URL policy.",
    }
  }

  const ipVersion = isIP(normalizedHost)
  if (ipVersion === 4 && isBlockedIpv4(normalizedHost)) {
    return {
      valid: false,
      detail: "Private, loopback, and link-local IP ranges cannot be added to URL policy.",
    }
  }
  if (ipVersion === 6 && isBlockedIpv6(normalizedHost)) {
    return {
      valid: false,
      detail: "Private, loopback, and link-local IP ranges cannot be added to URL policy.",
    }
  }

  return { valid: true }
}

function isBlockedIpv4(value: string): boolean {
  const [first, second] = value.split(".").map((part) => Number(part))
  return (
    first === 10 ||
    first === 127 ||
    first === 0 ||
    first === 169 && second === 254 ||
    first === 172 && second >= 16 && second <= 31 ||
    first === 192 && second === 168
  )
}

function isBlockedIpv6(value: string): boolean {
  const normalized = value.toLowerCase()
  return (
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  )
}
