import {
  adminSettingsLogoAssetSchema,
  adminSettingsResponseSchema,
  adminSettingsTelemetryPayloadPreviewSchema,
  type AdminSettingsLicenseState,
  type AdminSettingsOrganization,
  type AdminSettingsPrivacy,
  type AdminSettingsResponse,
  type UpdateAdminSettingsOrganizationRequest,
  type UpdateAdminSettingsTelemetryRequest,
} from "@llm-machines/contracts/inference-core"
import { eq } from "drizzle-orm"
import type { Actor } from "../auth/persona"
import { getInferenceCoreDb } from "../db/inference-core-client"
import { consoleSettings, licenseState } from "../db/inference-core-schema"
import {
  LiteLlmAdminClient,
  liteLlmConfig,
} from "./admin-litellm-client"
import { PrometheusClient } from "./admin-prometheus"
import { emitAudit } from "./audit"
import { keycloakAdminConfigFromEnv } from "./inference-core-keycloak-admin"
import {
  type SettingsLogoKind,
  validateSettingsLogoAsset,
} from "./admin-settings-validation"
import { upsertActorUser } from "./users"

const singletonSettingsId = "singleton"
const singletonLicenseId = "singleton"

type SettingsMutationResult =
  | { settings: AdminSettingsResponse; status: "ok" }
  | { detail: string; status: "invalid" }

type ReachabilityService = AdminSettingsResponse["reachability"][number]
type ReachabilityCheck = Pick<
  ReachabilityService,
  "detail" | "lastCheckedAt" | "status"
>

let memoryOrganization = defaultSettings().organization
let memoryPrivacy = defaultSettings().privacy
let memoryLicense = defaultSettings().license

export async function getAdminSettings(
  actor: Actor,
): Promise<AdminSettingsResponse> {
  const settings = await readSettings()
  await emitAudit({
    action: "admin.settings.read",
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  return settings
}

export async function updateAdminSettingsOrganization(
  actor: Actor,
  request: UpdateAdminSettingsOrganizationRequest,
): Promise<SettingsMutationResult> {
  const fullLogo = validateOptionalLogo(request.fullLogo, "full")
  if (!fullLogo.valid) {
    return { status: "invalid", detail: fullLogo.detail }
  }
  const iconLogo = validateOptionalLogo(request.iconLogo, "icon")
  if (!iconLogo.valid) {
    return { status: "invalid", detail: iconLogo.detail }
  }

  const existing = await readSettings()
  const now = new Date()
  const organization: AdminSettingsOrganization = {
    organizationName: request.organizationName,
    defaultLanguage: request.defaultLanguage,
    fullLogo:
      request.fullLogo === undefined
        ? existing.organization.fullLogo
        : fullLogo.asset,
    iconLogo:
      request.iconLogo === undefined
        ? existing.organization.iconLogo
        : iconLogo.asset,
    updatedAt: now.toISOString(),
    updatedBy: actor.subject,
  }

  const db = getInferenceCoreDb()
  if (db) {
    const actorId = (await upsertActorUser(actor)).subject
    await db
      .insert(consoleSettings)
      .values({
        id: singletonSettingsId,
        organizationName: organization.organizationName,
        defaultLanguage: organization.defaultLanguage,
        fullLogo: organization.fullLogo,
        iconLogo: organization.iconLogo,
        telemetryEnabled: existing.privacy.telemetryEnabled,
        telemetryPayloadPreview: existing.privacy.telemetryPayloadPreview,
        privacyPolicyHref: existing.privacy.privacyPolicyHref,
        dataResidencyStatement: existing.privacy.dataResidencyStatement,
        updatedBy: actorId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: consoleSettings.id,
        set: {
          organizationName: organization.organizationName,
          defaultLanguage: organization.defaultLanguage,
          fullLogo: organization.fullLogo,
          iconLogo: organization.iconLogo,
          updatedBy: actorId,
          updatedAt: now,
        },
      })
  } else {
    memoryOrganization = organization
  }

  await emitAudit({
    action: "admin.settings.organization.updated",
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  return { status: "ok", settings: await readSettings() }
}

export async function updateAdminSettingsTelemetry(
  actor: Actor,
  request: UpdateAdminSettingsTelemetryRequest,
): Promise<SettingsMutationResult> {
  const existing = await readSettings()
  const now = new Date()
  const privacy: AdminSettingsPrivacy = {
    ...existing.privacy,
    telemetryEnabled: request.enabled,
    updatedAt: now.toISOString(),
    updatedBy: actor.subject,
  }
  const license: AdminSettingsLicenseState = {
    ...existing.license,
    telemetryOptIn: request.enabled,
  }

  const db = getInferenceCoreDb()
  if (db) {
    const actorId = (await upsertActorUser(actor)).subject
    await db.transaction(async (transaction) => {
      await transaction
        .insert(consoleSettings)
        .values({
          id: singletonSettingsId,
          organizationName: existing.organization.organizationName,
          defaultLanguage: existing.organization.defaultLanguage,
          fullLogo: existing.organization.fullLogo,
          iconLogo: existing.organization.iconLogo,
          telemetryEnabled: request.enabled,
          telemetryPayloadPreview: privacy.telemetryPayloadPreview,
          privacyPolicyHref: privacy.privacyPolicyHref,
          dataResidencyStatement: privacy.dataResidencyStatement,
          updatedBy: actorId,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: consoleSettings.id,
          set: {
            telemetryEnabled: request.enabled,
            updatedBy: actorId,
            updatedAt: now,
          },
        })

      await transaction
        .insert(licenseState)
        .values({
          id: singletonLicenseId,
          sourceStatus: license.sourceStatus,
          subscriptionState: license.subscriptionState,
          supportState: license.supportState,
          applianceId: license.applianceId,
          certificateExpiresAt: dateOrNull(license.certificateExpiresAt),
          lastEntitlementCheckAt: dateOrNull(
            license.lastEntitlementCheckAt,
          ),
          offlineMode: license.offlineMode,
          telemetryOptIn: license.telemetryOptIn,
          allowedUpdateChannels: license.allowedUpdateChannels,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: licenseState.id,
          set: {
            telemetryOptIn: license.telemetryOptIn,
            updatedAt: now,
          },
        })
    })
  } else {
    memoryPrivacy = privacy
    memoryLicense = license
  }

  await emitAudit({
    action: request.enabled
      ? "admin.settings.telemetry.enabled"
      : "admin.settings.telemetry.disabled",
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  return { status: "ok", settings: await readSettings() }
}

export function resetAdminSettingsCoreForTest(): void {
  const defaults = defaultSettings()
  memoryOrganization = defaults.organization
  memoryPrivacy = defaults.privacy
  memoryLicense = defaults.license
}

async function readSettings(): Promise<AdminSettingsResponse> {
  const defaults = defaultSettings()
  const db = getInferenceCoreDb()
  if (!db) {
    return adminSettingsResponseSchema.parse({
      ...defaults,
      organization: memoryOrganization,
      privacy: memoryPrivacy,
      license: memoryLicense,
      reachability: await resolveReachability(defaults.reachability, false),
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
    reachability: await resolveReachability(defaults.reachability, true),
  })
}

async function resolveReachability(
  services: ReachabilityService[],
  postgresReachable: boolean,
): Promise<ReachabilityService[]> {
  const checkedAt = new Date().toISOString()
  const checks = new Map<string, ReachabilityCheck>([
    [
      "web",
      checked(
        "ok",
        "Console web rendered this BFF-backed Settings response.",
        checkedAt,
      ),
    ],
    [
      "bff",
      checked(
        "ok",
        "BFF Settings API handled this authenticated request.",
        checkedAt,
      ),
    ],
    [
      "postgres",
      postgresReachable
        ? checked(
            "ok",
            "Product metadata persistence is reachable.",
            checkedAt,
          )
        : notConfigured("Product metadata persistence is not configured."),
    ],
  ])

  const remoteChecks = await Promise.all([
    checkKeycloak(checkedAt),
    checkLiteLlm(checkedAt),
    checkHttpService(
      "ADMIN_GRAFANA_BASE_URL",
      "/api/health",
      "Grafana",
      checkedAt,
    ),
    checkPrometheus(checkedAt),
    checkHttpService(
      "ADMIN_ALERTMANAGER_BASE_URL",
      "/-/ready",
      "Alertmanager",
      checkedAt,
    ),
    checkFirecrawl(checkedAt),
    checkHttpService(
      "LIFECYCLE_SERVICE_BASE_URL",
      "/healthz",
      "Lifecycle service",
      checkedAt,
    ),
  ])
  for (const [id, check] of remoteChecks) {
    checks.set(id, check)
  }

  return services.map((service) => ({
    ...service,
    ...(checks.get(service.id) ?? {}),
  }))
}

async function checkKeycloak(
  checkedAt: string,
): Promise<readonly ["keycloak", ReachabilityCheck]> {
  const result = keycloakAdminConfigFromEnv()
  if (result.status !== "ok") {
    return [
      "keycloak",
      result.status === "invalid"
        ? checked(
            "degraded",
            "Keycloak appliance-realm configuration is invalid.",
            checkedAt,
          )
        : notConfigured("Keycloak appliance-realm API is not configured."),
    ]
  }
  const realmUrl = appendPath(
    result.config.baseUrl,
    `realms/${encodeURIComponent(result.config.realm)}`,
  )
  return [
    "keycloak",
    realmUrl
      ? await probeUrl(
          realmUrl,
          "Keycloak appliance realm is reachable.",
          "Keycloak appliance realm did not respond.",
          checkedAt,
        )
      : checked(
          "degraded",
          "Keycloak appliance-realm configuration is invalid.",
          checkedAt,
        ),
  ]
}

async function checkLiteLlm(
  checkedAt: string,
): Promise<readonly ["litellm", ReachabilityCheck]> {
  const config = liteLlmConfig()
  if (!config) {
    return [
      "litellm",
      notConfigured("LiteLLM read-only projection is not configured."),
    ]
  }
  try {
    await new LiteLlmAdminClient(config).getJson("/v1/models")
    return [
      "litellm",
      checked("ok", "LiteLLM model inventory is reachable.", checkedAt),
    ]
  } catch {
    return [
      "litellm",
      checked("unavailable", "LiteLLM did not respond.", checkedAt),
    ]
  }
}

async function checkPrometheus(
  checkedAt: string,
): Promise<readonly ["prometheus", ReachabilityCheck]> {
  const baseUrl = process.env.ADMIN_PROMETHEUS_BASE_URL?.trim()
  if (!baseUrl) {
    return [
      "prometheus",
      notConfigured("Prometheus read-only projection is not configured."),
    ]
  }
  try {
    await new PrometheusClient(baseUrl).query("up")
    return [
      "prometheus",
      checked("ok", "Prometheus query API is reachable.", checkedAt),
    ]
  } catch {
    return [
      "prometheus",
      checked("unavailable", "Prometheus did not respond.", checkedAt),
    ]
  }
}

async function checkFirecrawl(
  checkedAt: string,
): Promise<readonly ["firecrawl", ReachabilityCheck]> {
  if (process.env.FIRECRAWL_ENABLED?.trim().toLowerCase() !== "true") {
    return [
      "firecrawl",
      notConfigured("Firecrawl is installed and disabled by default."),
    ]
  }
  return checkHttpService(
    "FIRECRAWL_API_URL",
    "/",
    "Firecrawl",
    checkedAt,
    "firecrawl",
  )
}

async function checkHttpService<T extends string>(
  envName: string,
  path: string,
  label: string,
  checkedAt: string,
  id?: T,
): Promise<readonly [T extends string ? T : string, ReachabilityCheck]> {
  const baseUrl = process.env[envName]?.trim()
  const serviceId = (id ?? serviceIdForEnv(envName)) as T extends string
    ? T
    : string
  if (!baseUrl) {
    return [
      serviceId,
      notConfigured(`${label} internal health endpoint is not configured.`),
    ]
  }
  const url = appendPath(baseUrl, path)
  return [
    serviceId,
    url
      ? await probeUrl(
          url,
          `${label} is reachable.`,
          `${label} did not respond.`,
          checkedAt,
        )
      : checked(
          "degraded",
          `${label} internal health endpoint is invalid.`,
          checkedAt,
        ),
  ]
}

function serviceIdForEnv(envName: string): string {
  const ids: Record<string, string> = {
    ADMIN_ALERTMANAGER_BASE_URL: "alertmanager",
    ADMIN_GRAFANA_BASE_URL: "grafana",
    LIFECYCLE_SERVICE_BASE_URL: "lifecycle",
  }
  return ids[envName] ?? envName.toLowerCase()
}

async function probeUrl(
  url: URL,
  successDetail: string,
  failureDetail: string,
  checkedAt: string,
): Promise<ReachabilityCheck> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(reachabilityTimeoutMs()),
    })
    return response.ok
      ? checked("ok", successDetail, checkedAt)
      : checked("unavailable", failureDetail, checkedAt)
  } catch {
    return checked("unavailable", failureDetail, checkedAt)
  }
}

function defaultSettings(
  generatedAt = new Date().toISOString(),
): AdminSettingsResponse {
  return {
    generatedAt,
    sourceStatus: "not_configured",
    organization: {
      organizationName: "LLM Machines",
      defaultLanguage: "en",
      fullLogo: null,
      iconLogo: null,
      updatedAt: null,
      updatedBy: null,
    },
    reachability: [
      service("web", "Web/Console", "settings"),
      service("bff", "BFF/API", "settings"),
      service("postgres", "Postgres", "settings"),
      service("keycloak", "Keycloak", "team"),
      service("litellm", "LiteLLM", "inference"),
      service("grafana", "Grafana", "hardware"),
      service("prometheus", "Prometheus", "hardware"),
      service("alertmanager", "Alertmanager", "hardware"),
      service("firecrawl", "Firecrawl", "applications"),
      service("lifecycle", "Lifecycle", "settings"),
    ],
    license: {
      sourceStatus: "not_configured",
      subscriptionState: "not_configured",
      supportState: "License service is not connected.",
      applianceId: null,
      certificateExpiresAt: null,
      lastEntitlementCheckAt: null,
      offlineMode: true,
      telemetryOptIn: false,
      allowedUpdateChannels: [],
    },
    systemUpdate: {
      sourceStatus: "not_configured",
      status: "not_configured",
      updateActionEnabled: false,
      detail: "Lifecycle update status is not configured.",
      availableVersion: null,
      expectedDowntime: null,
      affectedComponents: [],
    },
    privacy: {
      telemetryEnabled: false,
      privacyPolicyHref: "/privacy",
      dataResidencyStatement:
        "LLM Machines managed components do not retain inference request or response content.",
      telemetryDescription:
        "Telemetry is off by default and is limited to reviewed appliance metadata when enabled.",
      telemetryPayloadPreview: {
        applianceId: null,
        installedVersion: null,
        updateAgentVersion: null,
        lastUpdateCheck: null,
        lastAppliedUpdate: null,
        subscriptionStateSeenByAppliance: "not_configured",
      },
      updatedAt: null,
      updatedBy: null,
    },
  }
}

function service(
  id: ReachabilityService["id"],
  label: string,
  owningSection: ReachabilityService["owningSection"],
): ReachabilityService {
  return {
    id,
    label,
    owningSection,
    status: "not_configured",
    detail: `${label} internal health endpoint is not configured.`,
    lastCheckedAt: null,
  }
}

function checked(
  status: ReachabilityService["status"],
  detail: string,
  lastCheckedAt: string,
): ReachabilityCheck {
  return { status, detail, lastCheckedAt }
}

function notConfigured(detail: string): ReachabilityCheck {
  return { status: "not_configured", detail, lastCheckedAt: null }
}

function appendPath(baseUrl: string, path: string): URL | null {
  try {
    const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
    return new URL(path.replace(/^\/+/, ""), root)
  } catch {
    return null
  }
}

function reachabilityTimeoutMs(): number {
  const value = Number.parseInt(
    process.env.ADMIN_SETTINGS_REACHABILITY_TIMEOUT_MS ?? "",
    10,
  )
  return Number.isFinite(value) && value > 0 ? value : 2500
}

function validateOptionalLogo(
  logo: UpdateAdminSettingsOrganizationRequest["fullLogo"],
  kind: SettingsLogoKind,
):
  | { asset: AdminSettingsOrganization["fullLogo"]; valid: true }
  | { detail: string; valid: false } {
  if (logo === undefined || logo === null) {
    return { asset: null, valid: true }
  }
  const result = validateSettingsLogoAsset(logo, kind)
  return result.valid ? { asset: result.asset, valid: true } : result
}

function parseLogo(value: unknown): AdminSettingsOrganization["fullLogo"] {
  return value === null || value === undefined
    ? null
    : adminSettingsLogoAssetSchema.parse(value)
}

function dateOrNull(value: string | null): Date | null {
  return value ? new Date(value) : null
}
