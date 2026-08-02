import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"
import type {
  AdminConnectedApp,
  AdminConnectedAppAuthMethod,
  AdminConnectedAppConnectionStatus,
  AdminConnectedAppCreateRequest,
  AdminConnectedAppCreateResponse,
  AdminConnectedAppCredential,
  AdminConnectedAppCredentialMetadata,
  AdminConnectedAppDetail,
  AdminConnectedAppFirecrawl,
  AdminConnectedAppLifecycleResult,
  AdminConnectedAppRotateCredentialResult,
  AdminConnectedAppTestResult,
  AdminConnectedAppUpdateRequest,
  AdminConnectedAppUsageSummary,
  AdminConnectedAppsResponse,
} from "@llm-machines/contracts/inference-core"
import {
  adminConnectedAppCreateResponseSchema,
  adminConnectedAppRotateCredentialResultSchema,
  adminConnectedAppUsageSummarySchema,
} from "@llm-machines/contracts/inference-core"
import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm"
import type { Actor } from "../auth/authorization"
import {
  canUseBffFixtureData,
  isProductionRuntime,
} from "../config/fixture-mode"
import {
  type InferenceCoreQueryExecutor,
  type InferenceCoreTransaction,
  getInferenceCoreDb,
  runInferenceCoreReadSnapshot,
} from "../db/inference-core-client"
import {
  applicationCredentials,
  applicationLimits,
  applicationModelAllowlists,
  applicationUsageDaily,
  applications,
  auditEvents,
} from "../db/inference-core-schema"
import {
  deleteAdminConnectedAppFirecrawlForParent,
  disableAdminConnectedAppFirecrawlForParent,
  getAdminConnectedAppFirecrawlProjection,
  initializeAdminConnectedAppFirecrawlForParent,
  markAdminConnectedAppFirecrawlParentEnabled,
  resetAdminConnectedAppFirecrawlForTest,
} from "./admin-connected-apps-firecrawl"
import { emitAudit } from "./audit"
import {
  type IdentityMutationRouteContext,
  executeJournaledIdentityMutation,
  hasUnresolvedOAuthClientMutation,
} from "./identity-mutation-journal"
import {
  KeycloakAdminError,
  type KeycloakApplicationAdminClient,
  keycloakApplicationAdminClientFromEnv,
  keycloakApplicationAdminConfigFromEnv,
} from "./inference-core-keycloak-admin"
import { upsertActorUser } from "./users"

export type ConnectedAppCreateResult =
  | AdminConnectedAppCreateResponse
  | { detail: string; status: "blocked" }

export type ConnectedAppMutationResult =
  | { app: AdminConnectedApp; status: "updated" }
  | { status: "not_found" }

export type ConnectedAppCredentialMutationResult =
  | AdminConnectedAppRotateCredentialResult
  | { detail: string; status: "blocked" }
  | { status: "not_found" }

export type ConnectedAppLifecycleMutationResult =
  | AdminConnectedAppLifecycleResult
  | { detail: string; status: "blocked" }
  | { status: "not_found" }

export type ConnectedAppRevocationResult =
  | { app: AdminConnectedApp; status: "revoked" }
  | { detail: string; status: "blocked" }
  | { status: "not_found" }

interface ConnectedAppRecord {
  allowedModels: string[]
  authMethod: AdminConnectedAppAuthMethod
  connectionStatus: AdminConnectedAppConnectionStatus
  createdAt: string
  createdBy: string
  description: string
  id: string
  lastConnectedAt: string | null
  maxConcurrentRequests: number | null
  maxContextBytes: number | null
  name: string
  rateLimitRps: number | null
  status: "deleted" | "disabled" | "enabled"
  tokenAlertThreshold7d: number | null
  updatedAt: string
  updatedBy: string
  usage: AdminConnectedAppUsageSummary
}

interface ConnectedAppCredentialRecord {
  appId: string
  authMethod: AdminConnectedAppAuthMethod
  clientId: string | null
  externalCredentialId: string | null
  id: string
  issuedAt: string
  keyHash: string | null
  keyPrefix: string | null
  lastUsedAt: string | null
  overlapExpiresAt: string | null
  revokedAt: string | null
  rotatedAt: string | null
  status: "active" | "retiring" | "revoked"
}

interface ConnectedAppBundle {
  credentials: ConnectedAppCredentialRecord[]
  firecrawl: AdminConnectedAppFirecrawl
  record: ConnectedAppRecord
}

interface ConnectedAppGatewayCurrentPolicy {
  maxConcurrentRequests: number | null
  maxContextBytes: number | null
  requestsPerSecond: number | null
}

export interface ConnectedAppRuntimeIdentity {
  allowedModels: string[]
  appId: string
  appName: string
  authMethod: AdminConnectedAppAuthMethod
  clientId: string
  credentialRecordId: string
  keycloakSubjectId: string | null
  maxConcurrentRequests: number | null
  maxContextBytes: number | null
  rateLimitRps: number | null
  status: "disabled" | "enabled"
  tokenAlertState: "below" | "reached" | null
  tokenAlertThreshold7d: number | null
  usage: AdminConnectedAppUsageSummary
}

export type ConnectedAppGatewayRoute = "chat_completions" | "models"

export interface ConnectedAppGatewayAdmissionInput {
  contextBytes: number
  model: string | null
  route: ConnectedAppGatewayRoute
}

export interface ConnectedAppGatewayUsageInput {
  inputTokens: number
  latencyMs: number
  model: string | null
  outputTokens: number
  route: ConnectedAppGatewayRoute
  status: number
  totalTokens: number
}

export interface ConnectedAppGatewayUsageContext {
  appId: string
  bucketDate: string
  contextBytes: number
  credentialId: string
  leaseExpiresAt: string
  model: string | null
  requestId: string
  route: ConnectedAppGatewayRoute
  startedAt: string
}

export interface ConnectedAppCredentialRevealEndpoints {
  bffBaseUrl: string
  openAiBaseUrl: string
  tokenUrl: string | null
}

export type ConnectedAppCredentialRevealPreflight =
  | {
      endpoints: ConnectedAppCredentialRevealEndpoints
      status: "ready"
    }
  | { detail: string; status: "blocked" }

export type ConnectedAppCredentialRotationPreflight =
  | ConnectedAppCredentialRevealPreflight
  | { status: "not_found" }

const STATIC_KEY_OVERLAP_SECONDS = 86_400
const GATEWAY_REQUEST_LEASE_SECONDS = 15 * 60

const memoryConnectedApps: ConnectedAppRecord[] = []
const memoryConnectedAppCredentials: ConnectedAppCredentialRecord[] = []
const memoryRateLimitWindows = new Map<
  string,
  { count: number; startedAt: number }
>()
const memoryGatewayRequests = new Map<
  string,
  {
    appId: string
    credentialId: string
    leaseExpiresAt: number
    settled: boolean
  }
>()

export async function getAdminConnectedApps(
  actor: Actor,
): Promise<AdminConnectedAppsResponse> {
  const apps = (await getConnectedAppBundles()).map(toPublicApp)
  await emitAudit({
    action: "admin.connected_app.read",
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  return {
    apps,
    generatedAt: new Date().toISOString(),
    sourceStatus: "ok",
  }
}

export async function getAdminConnectedAppDetail(
  actor: Actor,
  id: string,
): Promise<AdminConnectedAppDetail | null> {
  const bundle = await getConnectedAppBundle(id)
  if (!bundle) {
    return null
  }
  await emitAudit({
    action: "admin.connected_app.read",
    applicationId: id,
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  return { app: toPublicApp(bundle) }
}

export async function getAdminConnectedAppProjection(
  id: string,
  executor?: InferenceCoreQueryExecutor | null,
): Promise<AdminConnectedApp | null> {
  const bundle = await getConnectedAppBundle(id, executor)
  return bundle ? toPublicApp(bundle) : null
}

export async function createAdminConnectedApp(
  actor: Actor,
  request: AdminConnectedAppCreateRequest,
  identityContext?: IdentityMutationRouteContext,
  revealEndpoints?: ConnectedAppCredentialRevealEndpoints,
): Promise<ConnectedAppCreateResult> {
  const authMethod = request.authMethod ?? "api_key"
  const revealPreflight = resolveConnectedAppCredentialRevealPreflight(
    authMethod,
    revealEndpoints,
  )
  if (revealPreflight.status === "blocked") {
    return revealPreflight
  }
  const endpoints = revealPreflight.endpoints
  const now = new Date().toISOString()
  const id = uniqueConnectedAppId(request.name)
  const record: ConnectedAppRecord = {
    allowedModels: normalizeList(request.allowedModels),
    authMethod,
    connectionStatus: "not_connected",
    createdAt: now,
    createdBy: actor.subject,
    description: request.description,
    id,
    lastConnectedAt: null,
    maxConcurrentRequests: request.maxConcurrentRequests,
    maxContextBytes: request.maxContextBytes,
    name: request.name,
    rateLimitRps: request.rateLimitRps,
    status: "enabled",
    tokenAlertThreshold7d: request.tokenAlertThreshold7d,
    updatedAt: now,
    updatedBy: actor.subject,
    usage: emptyUsage(),
  }

  if (authMethod === "api_key") {
    const generated = createStaticApiKeyRecord(
      id,
      now,
      request.allowedModels[0] ?? null,
      endpoints,
    )
    return commitConnectedAppCredentialReveal(
      identityContext,
      id,
      async (transaction) => {
        const saved = await saveConnectedAppRecord(
          actor,
          record,
          generated.record,
          "admin.connected_app.created",
          transaction,
        )
        return adminConnectedAppCreateResponseSchema.parse({
          app: toPublicApp(saved),
          credential: generated.credential,
          status: "created",
        })
      },
    )
  }

  if (!identityContext) {
    return {
      detail: "Durable OAuth identity mutation state is unavailable.",
      status: "blocked",
    }
  }

  const tokenUrl = endpoints.tokenUrl
  if (tokenUrl === null) {
    return connectedAppRevealConfigurationBlocked()
  }

  if (!applicationIdentityProvider()) {
    return {
      detail:
        "The dedicated Keycloak Application administration client is unavailable.",
      status: "blocked",
    }
  }

  const clientId = connectedAppClientId(id)
  let response!: AdminConnectedAppCreateResponse
  await executeJournaledIdentityMutation({
    apply: async (
      preflight: { provider: ApplicationIdentityProvider },
      keycloak,
    ) =>
      keycloak.firstWrite(
        () =>
          preflight.provider.createConfidentialClient({
            clientId,
            description: request.description,
            name: request.name,
          }),
        (credential) => credential.id,
      ),
    atomicFinalization: true,
    context: identityContext,
    finalize: async (credential, transaction) => {
      const credentialRecord = createOAuthCredentialRecord(
        id,
        credential.clientId,
        credential.id,
        now,
      )
      const saved = await saveConnectedAppRecord(
        actor,
        record,
        credentialRecord,
        "admin.connected_app.created",
        transaction,
      )
      response = adminConnectedAppCreateResponseSchema.parse({
        app: toPublicApp(saved),
        credential: oauthCredentialPayload({
          clientId: credential.clientId,
          clientSecret: credential.clientSecret,
          credentialId: activeCredential(saved).id,
          issuedAt: now,
          model: request.allowedModels[0] ?? null,
          tokenUrl,
          endpoints,
        }),
        status: "created",
      })
    },
    keycloakSubjectId: actor.subject,
    preflight: async (signal) => {
      const provider = requireApplicationIdentityProvider(signal)
      if (await provider.findConfidentialClient(clientId)) {
        throw new KeycloakAdminError(
          "invalid",
          "The Application OAuth client already exists.",
          "rejected",
        )
      }
      return { clientId, provider }
    },
    receiptResourceId: id,
    targetIdentifier: clientId,
    targetType: "oauth_client",
  })
  return response
}

export async function updateAdminConnectedApp(
  actor: Actor,
  id: string,
  request: AdminConnectedAppUpdateRequest,
): Promise<ConnectedAppMutationResult> {
  const saved = await updateConnectedAppPolicy(actor, id, request)
  if (!saved) {
    return { status: "not_found" }
  }
  return { app: toPublicApp(saved), status: "updated" }
}

export async function testAdminConnectedApp(
  actor: Actor,
  id: string,
): Promise<AdminConnectedAppTestResult | { status: "not_found" }> {
  const existing = await getConnectedAppBundle(id)
  if (!existing) {
    return { status: "not_found" }
  }
  const app = toPublicApp(existing)
  const credential = activeCredentialOrNull(existing)
  await emitAudit({
    action: "admin.connected_app.connection_evidence_read",
    applicationId: id,
    credentialRecordId: credential?.id,
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  const status =
    app.connectionStatus === "connected"
      ? ("passed" as const)
      : app.connectionStatus === "degraded"
        ? ("degraded" as const)
        : ("waiting" as const)
  return {
    app,
    connectionStatus: app.connectionStatus,
    detail:
      status === "passed"
        ? "A real authenticated client reached the Application models endpoint."
        : status === "degraded"
          ? "The latest recorded Application connection evidence is degraded."
          : "No authenticated client has reached the Application models endpoint yet.",
    observedAt: app.lastConnectedAt,
    status,
  }
}

export async function rotateAdminConnectedAppCredentials(
  actor: Actor,
  id: string,
  identityContext?: IdentityMutationRouteContext,
  revealEndpoints?: ConnectedAppCredentialRevealEndpoints,
): Promise<ConnectedAppCredentialMutationResult> {
  const existing = await getConnectedAppBundle(id)
  if (!existing) {
    return { status: "not_found" }
  }
  const revealPreflight = resolveConnectedAppCredentialRevealPreflight(
    existing.record.authMethod,
    revealEndpoints,
  )
  if (revealPreflight.status === "blocked") {
    return revealPreflight
  }
  return existing.record.authMethod === "api_key"
    ? rotateStaticConnectedAppCredential(
        actor,
        existing,
        identityContext,
        revealPreflight.endpoints,
      )
    : rotateOAuthConnectedAppCredential(
        actor,
        existing,
        identityContext,
        revealPreflight.endpoints,
      )
}

export function preflightConnectedAppCredentialReveal(
  authMethod: AdminConnectedAppAuthMethod,
): ConnectedAppCredentialRevealPreflight {
  return resolveConnectedAppCredentialRevealPreflight(authMethod)
}

export async function preflightAdminConnectedAppCredentialRotation(
  id: string,
): Promise<ConnectedAppCredentialRotationPreflight> {
  const existing = await getConnectedAppBundle(id)
  return existing
    ? resolveConnectedAppCredentialRevealPreflight(existing.record.authMethod)
    : { status: "not_found" }
}

export function assertProductionConnectedAppRevealEndpoints(): void {
  if (!isProductionRuntime()) {
    return
  }
  const staticPreflight = preflightConnectedAppCredentialReveal("api_key")
  if (staticPreflight.status === "blocked") {
    throw new Error("Connected app reveal endpoint configuration is invalid.")
  }
  const keycloakConfig = keycloakApplicationAdminConfigFromEnv(process.env)
  if (keycloakConfig.status === "not_configured") {
    return
  }
  if (keycloakConfig.status === "invalid") {
    throw new Error(
      "Connected app OAuth reveal endpoint configuration is invalid.",
    )
  }
  const oauthPreflight = preflightConnectedAppCredentialReveal(
    "oauth_client_credentials",
  )
  if (oauthPreflight.status === "blocked") {
    throw new Error(
      "Connected app OAuth reveal endpoint configuration is invalid.",
    )
  }
}

export async function disableAdminConnectedApp(
  actor: Actor,
  id: string,
): Promise<ConnectedAppLifecycleMutationResult> {
  const saved = await setConnectedAppLifecycleStatus(actor, id, "disabled")
  if (saved.status === "not_found") {
    return { status: "not_found" }
  }
  if (saved.status === "blocked") {
    return {
      detail: "The Application could not be disabled in its current state.",
      status: "blocked",
    }
  }
  return lifecycleResult(saved.bundle, "disabled", "Application disabled.")
}

export async function enableAdminConnectedApp(
  actor: Actor,
  id: string,
): Promise<ConnectedAppLifecycleMutationResult> {
  const saved = await setConnectedAppLifecycleStatus(actor, id, "enabled")
  if (saved.status === "not_found") {
    return { status: "not_found" }
  }
  if (saved.status === "blocked") {
    return {
      detail:
        "An active credential is required before enabling the Application.",
      status: "blocked",
    }
  }
  return lifecycleResult(saved.bundle, "reenabled", "Application re-enabled.")
}

export async function revokeAdminConnectedAppCredential(
  actor: Actor,
  id: string,
  credentialId: string,
  identityContext?: IdentityMutationRouteContext,
): Promise<ConnectedAppRevocationResult> {
  const existing = await getConnectedAppBundle(id)
  const credential = existing?.credentials.find(
    (candidate) => candidate.id === credentialId,
  )
  if (!existing || !credential) {
    return { status: "not_found" }
  }
  if (credential.status === "revoked") {
    return { app: toPublicApp(existing), status: "revoked" }
  }
  return credential.authMethod === "api_key"
    ? revokeStaticConnectedAppCredential(actor, existing, credential)
    : revokeOAuthConnectedAppCredential(
        actor,
        existing,
        credential,
        identityContext,
      )
}

export async function deleteAdminConnectedApp(
  actor: Actor,
  id: string,
  identityContext?: IdentityMutationRouteContext,
): Promise<ConnectedAppLifecycleMutationResult> {
  const existing = await getConnectedAppBundle(id)
  if (!existing) {
    return { status: "not_found" }
  }
  return existing.record.authMethod === "api_key"
    ? softDeleteStaticConnectedApp(actor, existing)
    : softDeleteOAuthConnectedApp(actor, existing, identityContext)
}

export async function getConnectedAppRecord(
  id: string,
): Promise<ConnectedAppRecord | null> {
  return (await getConnectedAppBundle(id))?.record ?? null
}

export async function resolveConnectedAppRuntimeIdentity(
  clientId: string,
): Promise<ConnectedAppRuntimeIdentity | null> {
  if ((await hasUnresolvedOAuthClientMutation()) !== false) {
    return null
  }
  const bundles = await getConnectedAppBundles()
  for (const bundle of bundles) {
    const credential = bundle.credentials.find(
      (candidate) =>
        candidate.authMethod === "oauth_client_credentials" &&
        candidate.clientId === clientId &&
        candidate.status === "active",
    )
    if (!credential) {
      continue
    }
    return runtimeIdentity(bundle, credential, clientId)
  }
  return null
}

export async function resolveConnectedAppRuntimeIdentityByApiKey(
  apiKey: string,
): Promise<ConnectedAppRuntimeIdentity | null> {
  const keyPrefix = staticApiKeyPrefix(apiKey)
  if (!keyPrefix) {
    return null
  }
  const keys = await getConnectedAppCredentialRecordsByPrefix(keyPrefix)
  const matched = keys.find(
    (key) =>
      key.authMethod === "api_key" &&
      credentialIsUsable(key) &&
      key.keyHash !== null &&
      safeHashEqual(staticApiKeyHash(apiKey), key.keyHash),
  )
  if (!matched) {
    return null
  }
  const bundle = await getConnectedAppBundle(matched.appId)
  if (!bundle) {
    return null
  }
  return runtimeIdentity(bundle, matched, matched.keyPrefix ?? keyPrefix)
}

export async function recordConnectedAppModelsConnection(
  identity: ConnectedAppRuntimeIdentity,
  correlationId: string,
): Promise<boolean> {
  const now = new Date()
  const db = getInferenceCoreDb()
  if (db) {
    try {
      await db.transaction(async (transaction) => {
        const locked = await lockConnectedAppForMutation(
          transaction,
          identity.appId,
          identity.authMethod,
          "enabled",
        )
        if (!locked) {
          throw new StaleConnectedAppIdentityError()
        }
        const credentialStatusCondition =
          identity.authMethod === "api_key"
            ? or(
                eq(applicationCredentials.status, "active"),
                and(
                  eq(applicationCredentials.status, "retiring"),
                  isNull(applicationCredentials.revokedAt),
                  gt(applicationCredentials.overlapExpiresAt, now),
                ),
              )
            : eq(applicationCredentials.status, "active")
        const credentialConditions = [
          eq(applicationCredentials.id, identity.credentialRecordId),
          eq(applicationCredentials.appId, identity.appId),
          eq(applicationCredentials.kind, identity.authMethod),
          isNull(applicationCredentials.revokedAt),
          credentialStatusCondition,
          identity.authMethod === "api_key"
            ? eq(applicationCredentials.keyPrefix, identity.clientId)
            : eq(applicationCredentials.clientIdentifier, identity.clientId),
        ]
        const credentialRows = await transaction
          .update(applicationCredentials)
          .set({ lastUsedAt: now })
          .where(and(...credentialConditions))
          .returning({ id: applicationCredentials.id })
        if (credentialRows.length !== 1) {
          throw new StaleConnectedAppIdentityError()
        }
        const applicationRows = await transaction
          .update(applications)
          .set({ connectionStatus: "connected", lastConnectedAt: now })
          .where(
            and(
              eq(applications.id, identity.appId),
              eq(applications.authMode, identity.authMethod),
              eq(applications.status, "enabled"),
            ),
          )
          .returning({ id: applications.id })
        if (applicationRows.length !== 1) {
          throw new StaleConnectedAppIdentityError()
        }
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "connected_app.gateway.models",
            applicationId: identity.appId,
            correlationId,
            credentialRecordId: identity.credentialRecordId,
            keycloakSubjectId: identity.keycloakSubjectId,
            occurredAt: now,
          }),
        )
      })
      return true
    } catch (error) {
      if (error instanceof StaleConnectedAppIdentityError) {
        return false
      }
      throw error
    }
  }
  if (!canUseBffFixtureData()) {
    throw new Error("PostgreSQL Application connection storage is unavailable.")
  }
  const record = memoryConnectedApps.find(
    (candidate) =>
      candidate.id === identity.appId &&
      candidate.authMethod === identity.authMethod &&
      candidate.status === "enabled",
  )
  const credential = memoryConnectedAppCredentials.find(
    (candidate) =>
      candidate.id === identity.credentialRecordId &&
      candidate.appId === identity.appId &&
      candidate.authMethod === identity.authMethod &&
      credentialIsUsable(candidate) &&
      (identity.authMethod === "api_key"
        ? candidate.keyPrefix === identity.clientId
        : candidate.clientId === identity.clientId),
  )
  if (!record || !credential) {
    return false
  }
  await emitAudit({
    action: "connected_app.gateway.models",
    applicationId: identity.appId,
    correlationId,
    credentialRecordId: identity.credentialRecordId,
    keycloakSubjectId: identity.keycloakSubjectId ?? undefined,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  const timestamp = now.toISOString()
  record.connectionStatus = "connected"
  record.lastConnectedAt = timestamp
  credential.lastUsedAt = timestamp
  return true
}

export async function recordConnectedAppGatewayAccountingDegraded(
  identity: ConnectedAppRuntimeIdentity,
): Promise<boolean> {
  const now = new Date()
  const db = getInferenceCoreDb()
  if (db) {
    try {
      return await db.transaction(async (transaction) => {
        const locked = await lockConnectedAppForMutation(
          transaction,
          identity.appId,
          identity.authMethod,
          "enabled",
        )
        if (!locked) {
          return false
        }
        const credentialStatusCondition =
          identity.authMethod === "api_key"
            ? or(
                eq(applicationCredentials.status, "active"),
                and(
                  eq(applicationCredentials.status, "retiring"),
                  isNull(applicationCredentials.revokedAt),
                  gt(applicationCredentials.overlapExpiresAt, now),
                ),
              )
            : eq(applicationCredentials.status, "active")
        const credential = await transaction
          .select({ id: applicationCredentials.id })
          .from(applicationCredentials)
          .where(
            and(
              eq(applicationCredentials.id, identity.credentialRecordId),
              eq(applicationCredentials.appId, identity.appId),
              eq(applicationCredentials.kind, identity.authMethod),
              isNull(applicationCredentials.revokedAt),
              credentialStatusCondition,
              identity.authMethod === "api_key"
                ? eq(applicationCredentials.keyPrefix, identity.clientId)
                : eq(
                    applicationCredentials.clientIdentifier,
                    identity.clientId,
                  ),
            ),
          )
          .limit(1)
        if (credential.length !== 1) {
          return false
        }
        const updated = await transaction
          .update(applications)
          .set({ connectionStatus: "degraded" })
          .where(
            and(
              eq(applications.id, identity.appId),
              eq(applications.authMode, identity.authMethod),
              eq(applications.status, "enabled"),
            ),
          )
          .returning({ id: applications.id })
        return updated.length === 1
      })
    } catch (error) {
      if (error instanceof StaleConnectedAppIdentityError) {
        return false
      }
      throw error
    }
  }
  if (!canUseBffFixtureData()) {
    throw new Error("PostgreSQL Application connection storage is unavailable.")
  }
  const record = memoryConnectedApps.find(
    (candidate) =>
      candidate.id === identity.appId &&
      candidate.authMethod === identity.authMethod &&
      candidate.status === "enabled",
  )
  const credential = memoryConnectedAppCredentials.find(
    (candidate) =>
      candidate.id === identity.credentialRecordId &&
      candidate.appId === identity.appId &&
      candidate.authMethod === identity.authMethod &&
      credentialIsUsable(candidate) &&
      (identity.authMethod === "api_key"
        ? candidate.keyPrefix === identity.clientId
        : candidate.clientId === identity.clientId),
  )
  if (!record || !credential) {
    return false
  }
  record.connectionStatus = "degraded"
  return true
}

export async function recordConnectedAppGatewayUsage(
  app: ConnectedAppRuntimeIdentity,
  input: ConnectedAppGatewayUsageInput,
): Promise<void> {
  await reconcileConnectedAppGatewayUsageInternal(
    app,
    input,
    gatewayUsageContext(app, {
      contextBytes: 0,
      model: input.model,
      route: input.route,
    }),
    "database",
  )
}

export async function consumeConnectedAppGatewayRateLimit(
  app: ConnectedAppRuntimeIdentity,
): Promise<
  { ok: true } | { detail: string; ok: false; status: 429 | 503; title: string }
> {
  const db = getInferenceCoreDb()
  if (db) {
    try {
      return await db.transaction(async (transaction) => {
        const current = await lockConnectedAppGatewayPolicy(transaction, app)
        if (!current) {
          return rateLimitUnavailable()
        }
        if (current.requestsPerSecond === null) {
          return { ok: true } as const
        }
        const rows = await transaction.execute(sql<{
          request_count: number
        }>`
          WITH expired_windows AS (
            DELETE FROM admin.application_rate_limit_windows
            WHERE app_id = ${app.appId}
              AND expires_at <= clock_timestamp()
            RETURNING app_id
          )
          INSERT INTO admin.application_rate_limit_windows (
            app_id,
            window_started_at,
            request_count,
            expires_at
          )
          VALUES (
            ${app.appId},
            date_trunc('second', statement_timestamp()),
            1,
            date_trunc('second', statement_timestamp()) + interval '2 seconds'
          )
          ON CONFLICT (app_id, window_started_at)
          DO UPDATE SET
            request_count =
              admin.application_rate_limit_windows.request_count + 1,
            expires_at = EXCLUDED.expires_at
          WHERE admin.application_rate_limit_windows.request_count
            < ${current.requestsPerSecond}
          RETURNING request_count
        `)
        return resultRows(rows).length > 0
          ? ({ ok: true } as const)
          : rateLimitExceeded()
      })
    } catch {
      return rateLimitUnavailable()
    }
  }

  if (!canUseBffFixtureData()) {
    return rateLimitUnavailable()
  }

  const record = memoryConnectedApps.find(
    (candidate) =>
      candidate.id === app.appId &&
      candidate.authMethod === app.authMethod &&
      candidate.status === "enabled",
  )
  const credential = memoryConnectedAppCredentials.find(
    (candidate) =>
      candidate.id === app.credentialRecordId &&
      candidate.appId === app.appId &&
      candidate.authMethod === app.authMethod &&
      credentialIsUsable(candidate) &&
      (app.authMethod === "api_key"
        ? candidate.keyPrefix === app.clientId
        : candidate.clientId === app.clientId),
  )
  if (!record || !credential) {
    return rateLimitUnavailable()
  }
  if (record.rateLimitRps === null) {
    return { ok: true }
  }

  const now = Date.now()
  const existing = memoryRateLimitWindows.get(app.appId)
  if (!existing || now - existing.startedAt >= 1_000) {
    memoryRateLimitWindows.set(app.appId, { count: 1, startedAt: now })
    return { ok: true }
  }
  if (existing.count >= record.rateLimitRps) {
    return rateLimitExceeded()
  }
  existing.count += 1
  return { ok: true }
}

export async function admitConnectedAppGatewayUsage(
  app: ConnectedAppRuntimeIdentity,
  input: ConnectedAppGatewayAdmissionInput,
): Promise<
  | { context: ConnectedAppGatewayUsageContext; ok: true }
  | {
      detail: string
      ok: false
      status: 413 | 429 | 503
      title: string
    }
> {
  assertGatewayAdmissionInput(input)
  let context = gatewayUsageContext(app, input)

  const db = getInferenceCoreDb()
  if (db) {
    try {
      return await db.transaction(async (transaction) => {
        const current = await lockConnectedAppGatewayPolicy(transaction, app)
        if (!current) {
          return gatewayAdmissionStateChanged()
        }

        const maxContextBytes = current.maxContextBytes
        if (maxContextBytes !== null && input.contextBytes > maxContextBytes) {
          return contextLimitExceeded()
        }

        const maxConcurrentRequests = current.maxConcurrentRequests
        if (maxConcurrentRequests !== null) {
          const activeRows = await transaction.execute(sql<{
            active_count: number
          }>`
            SELECT count(*)::integer AS active_count
            FROM admin.application_request_ledger
            WHERE app_id = ${app.appId}
              AND state = 'active'
              AND lease_expires_at > clock_timestamp()
          `)
          const active = Number(
            (
              resultRows(activeRows)[0] as
                | { active_count?: unknown }
                | undefined
            )?.active_count,
          )
          if (!Number.isSafeInteger(active) || active < 0) {
            throw new Error("Invalid connected app concurrency count.")
          }
          if (active >= maxConcurrentRequests) {
            return concurrencyLimitExceeded()
          }
        }

        const insertedRows = await transaction.execute(sql<{
          lease_expires_at: Date | string
          started_at: Date | string
        }>`
          INSERT INTO admin.application_request_ledger (
            id,
            app_id,
            credential_id,
            route_kind,
            model_alias,
            context_bytes,
            state,
            started_at,
            lease_expires_at
          )
          VALUES (
            ${context.requestId}::uuid,
            ${app.appId},
            ${app.credentialRecordId},
            ${input.route},
            ${input.model},
            ${input.contextBytes},
            'active',
            statement_timestamp(),
            statement_timestamp()
              + ${GATEWAY_REQUEST_LEASE_SECONDS} * interval '1 second'
          )
          RETURNING started_at, lease_expires_at
        `)
        const inserted = resultRows(insertedRows)[0] as
          | { lease_expires_at?: unknown; started_at?: unknown }
          | undefined
        if (!inserted) {
          throw new Error("Connected app request lease was not persisted.")
        }
        const startedAt = storedTimestamp(inserted.started_at)
        context = {
          ...context,
          bucketDate: startedAt.slice(0, 10),
          leaseExpiresAt: storedTimestamp(inserted.lease_expires_at),
          startedAt,
        }
        return { context, ok: true } as const
      })
    } catch {
      return gatewayAdmissionUnavailable()
    }
  }

  if (!canUseBffFixtureData()) {
    return gatewayAdmissionUnavailable()
  }

  const record = memoryConnectedApps.find(
    (candidate) => candidate.id === app.appId && candidate.status === "enabled",
  )
  const credential = memoryConnectedAppCredentials.find(
    (candidate) =>
      candidate.id === app.credentialRecordId &&
      candidate.appId === app.appId &&
      credentialIsUsable(candidate),
  )
  if (!record || !credential) {
    return gatewayAdmissionStateChanged()
  }
  if (
    record.maxContextBytes !== null &&
    input.contextBytes > record.maxContextBytes
  ) {
    return contextLimitExceeded()
  }
  if (record.maxConcurrentRequests !== null) {
    const now = Date.now()
    const active = [...memoryGatewayRequests.values()].filter(
      (request) =>
        request.appId === app.appId &&
        !request.settled &&
        request.leaseExpiresAt > now,
    ).length
    if (active >= record.maxConcurrentRequests) {
      return concurrencyLimitExceeded()
    }
  }
  memoryGatewayRequests.set(context.requestId, {
    appId: app.appId,
    credentialId: app.credentialRecordId,
    leaseExpiresAt: new Date(context.leaseExpiresAt).getTime(),
    settled: false,
  })
  return { context, ok: true }
}

export async function reconcileConnectedAppGatewayUsage(
  app: ConnectedAppRuntimeIdentity,
  input: ConnectedAppGatewayUsageInput,
  context: ConnectedAppGatewayUsageContext,
): Promise<void> {
  return reconcileConnectedAppGatewayUsageInternal(
    app,
    input,
    context,
    "context",
  )
}

async function reconcileConnectedAppGatewayUsageInternal(
  app: ConnectedAppRuntimeIdentity,
  input: ConnectedAppGatewayUsageInput,
  context: ConnectedAppGatewayUsageContext,
  clockSource: "context" | "database",
): Promise<void> {
  assertGatewayUsageInput(app, input, context)
  const db = getInferenceCoreDb()
  if (db) {
    const startedAt =
      clockSource === "database"
        ? sql`clock_timestamp()`
        : sql`${context.startedAt}::timestamptz`
    const leaseExpiresAt =
      clockSource === "database"
        ? sql`request_clock.started_at
            + ${GATEWAY_REQUEST_LEASE_SECONDS} * interval '1 second'`
        : sql`${context.leaseExpiresAt}::timestamptz`
    await db.execute(sql`
      WITH request_clock AS (
        SELECT ${startedAt} AS started_at
      ),
      settled_request AS (
        INSERT INTO admin.application_request_ledger (
          id,
          app_id,
          credential_id,
          route_kind,
          model_alias,
          context_bytes,
          state,
          status_code,
          input_tokens,
          output_tokens,
          total_tokens,
          latency_ms,
          started_at,
          lease_expires_at,
          settled_at
        )
        SELECT
          ${context.requestId}::uuid,
          ${context.appId},
          ${context.credentialId},
          ${context.route},
          ${context.model},
          ${context.contextBytes},
          'settled',
          ${input.status},
          ${input.inputTokens},
          ${input.outputTokens},
          ${input.totalTokens},
          ${input.latencyMs},
          request_clock.started_at,
          ${leaseExpiresAt},
          clock_timestamp()
        FROM request_clock
        ON CONFLICT (id)
        DO UPDATE SET
          state = 'settled',
          status_code = EXCLUDED.status_code,
          input_tokens = EXCLUDED.input_tokens,
          output_tokens = EXCLUDED.output_tokens,
          total_tokens = EXCLUDED.total_tokens,
          latency_ms = EXCLUDED.latency_ms,
          settled_at = EXCLUDED.settled_at
        WHERE admin.application_request_ledger.state = 'active'
          AND admin.application_request_ledger.app_id = EXCLUDED.app_id
          AND admin.application_request_ledger.credential_id =
            EXCLUDED.credential_id
          AND admin.application_request_ledger.route_kind =
            EXCLUDED.route_kind
          AND admin.application_request_ledger.model_alias
            IS NOT DISTINCT FROM EXCLUDED.model_alias
        RETURNING
          app_id,
          credential_id,
          route_kind,
          COALESCE(model_alias, '') AS model_alias,
          status_code,
          input_tokens,
          output_tokens,
          total_tokens,
          latency_ms,
          (started_at AT TIME ZONE 'UTC')::date AS bucket_date
      ),
      usage_row AS (
        INSERT INTO admin.application_usage_daily (
          app_id,
          credential_id,
          bucket_date,
          route_kind,
          model_alias,
          request_count,
          failure_count,
          input_tokens,
          output_tokens,
          total_tokens,
          latency_ms_sum,
          latency_ms_max,
          updated_at
        )
        SELECT
          app_id,
          credential_id,
          bucket_date,
          route_kind,
          model_alias,
          1,
          CASE WHEN status_code >= 400 THEN 1 ELSE 0 END,
          input_tokens,
          output_tokens,
          total_tokens,
          latency_ms,
          latency_ms,
          clock_timestamp()
        FROM settled_request
        ON CONFLICT (
          app_id,
          credential_id,
          bucket_date,
          route_kind,
          model_alias
        )
        DO UPDATE SET
          request_count =
            admin.application_usage_daily.request_count + 1,
          failure_count =
            admin.application_usage_daily.failure_count
            + EXCLUDED.failure_count,
          total_tokens =
            admin.application_usage_daily.total_tokens
            + EXCLUDED.total_tokens,
          input_tokens =
            admin.application_usage_daily.input_tokens
            + EXCLUDED.input_tokens,
          output_tokens =
            admin.application_usage_daily.output_tokens
            + EXCLUDED.output_tokens,
          latency_ms_sum =
            admin.application_usage_daily.latency_ms_sum
            + EXCLUDED.latency_ms_sum,
          latency_ms_max = GREATEST(
            admin.application_usage_daily.latency_ms_max,
            EXCLUDED.latency_ms_max
          ),
          updated_at = EXCLUDED.updated_at
        RETURNING app_id
      )
      UPDATE admin.application_credentials
      SET last_used_at = GREATEST(
        COALESCE(last_used_at, '-infinity'::timestamptz),
        clock_timestamp()
      )
      WHERE id = ${context.credentialId}
        AND EXISTS (SELECT 1 FROM settled_request)
    `)
    return
  }
  if (!canUseBffFixtureData()) {
    throw new Error("PostgreSQL usage accounting is unavailable.")
  }
  const now = new Date().toISOString()

  const existingRequest = memoryGatewayRequests.get(context.requestId)
  if (existingRequest?.settled) {
    return
  }
  if (
    existingRequest &&
    (existingRequest.appId !== context.appId ||
      existingRequest.credentialId !== context.credentialId)
  ) {
    throw new Error("Connected app usage context does not match its lease.")
  }
  memoryGatewayRequests.set(context.requestId, {
    appId: context.appId,
    credentialId: context.credentialId,
    leaseExpiresAt: new Date(context.leaseExpiresAt).getTime(),
    settled: true,
  })

  const record = memoryConnectedApps.find((item) => item.id === app.appId)
  if (!record) {
    return
  }
  record.updatedAt = now
  record.updatedBy = "connected-app-gateway"
  record.usage = {
    failures7d:
      input.status >= 400
        ? record.usage.failures7d + 1
        : record.usage.failures7d,
    lastUsedAt: now,
    requests7d: record.usage.requests7d + 1,
    tokens7d: record.usage.tokens7d + input.totalTokens,
  }
  const credential = memoryConnectedAppCredentials.find(
    (candidate) => candidate.id === context.credentialId,
  )
  if (credential && credentialIsUsable(credential)) {
    credential.lastUsedAt = now
  }
}

export async function resetConnectedAppsForTest(): Promise<void> {
  memoryConnectedApps.splice(0)
  memoryConnectedAppCredentials.splice(0)
  memoryOAuthClients.clear()
  memoryRateLimitWindows.clear()
  memoryGatewayRequests.clear()
  resetAdminConnectedAppFirecrawlForTest()
}

async function commitConnectedAppCredentialReveal<T>(
  context: IdentityMutationRouteContext | undefined,
  resourceId: string,
  run: (transaction?: InferenceCoreTransaction | null) => Promise<T>,
): Promise<T> {
  return context?.commitWithReceipt
    ? context.commitWithReceipt({ resourceId, run })
    : run()
}

type ApplicationIdentityProvider = Pick<
  KeycloakApplicationAdminClient,
  | "createConfidentialClient"
  | "deleteConfidentialClient"
  | "findConfidentialClient"
  | "rotateConfidentialClientSecret"
>

const memoryOAuthClients = new Map<string, { clientId: string; id: string }>()

class StaleConnectedAppIdentityError extends Error {
  constructor() {
    super("The Application runtime identity is no longer current.")
    this.name = "StaleConnectedAppIdentityError"
  }
}

async function getConnectedAppBundles(): Promise<ConnectedAppBundle[]> {
  const db = getInferenceCoreDb()
  if (db) {
    return runInferenceCoreReadSnapshot(db, async (transaction) => {
      const rows = await transaction
        .select()
        .from(applications)
        .where(ne(applications.status, "deleted"))
        .orderBy(desc(applications.updatedAt))
      return Promise.all(
        rows.map((row) => loadConnectedAppBundle(row, transaction)),
      )
    })
  }
  assertFixtureApplicationStorage()
  return Promise.all(
    memoryConnectedApps
      .filter((record) => record.status !== "deleted")
      .map(memoryBundle),
  )
}

async function getConnectedAppBundle(
  id: string,
  executor?: InferenceCoreQueryExecutor | null,
): Promise<ConnectedAppBundle | null> {
  const load = async (database: InferenceCoreQueryExecutor) => {
    const rows = await database
      .select()
      .from(applications)
      .where(and(eq(applications.id, id), ne(applications.status, "deleted")))
      .limit(1)
    return rows[0] ? loadConnectedAppBundle(rows[0], database) : null
  }
  if (executor) {
    return load(executor)
  }
  const db = getInferenceCoreDb()
  if (db) {
    return runInferenceCoreReadSnapshot(db, load)
  }
  assertFixtureApplicationStorage()
  const record = memoryConnectedApps.find(
    (candidate) => candidate.id === id && candidate.status !== "deleted",
  )
  return record ? await memoryBundle(record) : null
}

async function lockConnectedAppForMutation(
  transaction: InferenceCoreTransaction,
  id: string,
  expectedAuthMethod?: AdminConnectedAppAuthMethod,
  expectedStatus?: "enabled",
): Promise<typeof applications.$inferSelect | null> {
  const rows = await transaction
    .select()
    .from(applications)
    .where(eq(applications.id, id))
    .limit(1)
    .for("update")
  const current = rows[0]
  if (
    !current ||
    current.status === "deleted" ||
    (expectedAuthMethod !== undefined &&
      current.authMode !== expectedAuthMethod) ||
    (expectedStatus !== undefined && current.status !== expectedStatus)
  ) {
    return null
  }
  return current
}

async function lockConnectedAppGatewayPolicy(
  transaction: InferenceCoreTransaction,
  app: ConnectedAppRuntimeIdentity,
): Promise<ConnectedAppGatewayCurrentPolicy | null> {
  const lockedRows = await transaction.execute(sql<{ id: string }>`
    SELECT application.id
    FROM admin.applications AS application
    JOIN admin.emergency_isolation_state AS isolation
      ON isolation.id = 'appliance'
      AND isolation.status = 'inactive'
    WHERE application.id = ${app.appId}
      AND application.auth_mode = ${app.authMethod}
      AND application.status = 'enabled'
    FOR UPDATE OF application, isolation
  `)
  if (resultRows(lockedRows).length !== 1) {
    return null
  }

  const policyRows = await transaction.execute(sql<{
    max_concurrent_requests: number | null
    max_context_bytes: number | string | null
    requests_per_second: number | null
  }>`
    SELECT
      limits.max_concurrent_requests,
      limits.max_context_bytes,
      limits.requests_per_second
    FROM admin.application_limits AS limits
    JOIN admin.application_credentials AS credential
      ON credential.app_id = limits.app_id
    WHERE limits.app_id = ${app.appId}
      AND credential.id = ${app.credentialRecordId}
      AND credential.kind = ${app.authMethod}
      AND credential.revoked_at IS NULL
      AND (
        credential.status = 'active'
        OR (
          credential.kind = 'api_key'
          AND credential.status = 'retiring'
          AND credential.overlap_expires_at > clock_timestamp()
        )
      )
      AND (
        (
          ${app.authMethod} = 'api_key'
          AND credential.key_prefix = ${app.clientId}
        )
        OR (
          ${app.authMethod} = 'oauth_client_credentials'
          AND credential.client_identifier = ${app.clientId}
        )
      )
  `)
  const policy = resultRows(policyRows)[0] as
    | {
        max_concurrent_requests?: unknown
        max_context_bytes?: unknown
        requests_per_second?: unknown
      }
    | undefined
  if (!policy) {
    return null
  }
  return {
    maxConcurrentRequests: storedOptionalPositiveInteger(
      policy.max_concurrent_requests,
    ),
    maxContextBytes: storedOptionalPositiveInteger(policy.max_context_bytes),
    requestsPerSecond: storedOptionalPositiveInteger(
      policy.requests_per_second,
    ),
  }
}

async function saveConnectedAppRecord(
  actor: Actor,
  record: ConnectedAppRecord,
  credential: ConnectedAppCredentialRecord,
  auditAction: string,
  transaction?: InferenceCoreTransaction | null,
): Promise<ConnectedAppBundle> {
  const db = transaction ?? getInferenceCoreDb()
  if (db) {
    const persist = async (executor: InferenceCoreTransaction) => {
      const storageActor = await upsertActorUser(actor, executor)
      const storedRecord = {
        ...record,
        createdBy: storageActor.subject,
        updatedBy: storageActor.subject,
      }
      const occurredAt = new Date(record.createdAt)
      const inserted = await executor
        .insert(applications)
        .values({
          authMode: storedRecord.authMethod,
          connectionStatus: storedRecord.connectionStatus,
          createdAt: occurredAt,
          createdBy: storageActor.subject,
          description: storedRecord.description,
          id: storedRecord.id,
          lastConnectedAt: null,
          name: storedRecord.name,
          status: storedRecord.status,
          updatedAt: occurredAt,
          updatedBy: storageActor.subject,
        })
        .returning()
      const storedApplication = inserted[0]
      if (!storedApplication) {
        throw new Error("Created Application could not be persisted.")
      }
      await executor.insert(applicationModelAllowlists).values(
        storedRecord.allowedModels.map((modelAlias) => ({
          appId: storedRecord.id,
          createdAt: occurredAt,
          modelAlias,
        })),
      )
      await executor.insert(applicationLimits).values({
        appId: storedRecord.id,
        maxConcurrentRequests: storedRecord.maxConcurrentRequests,
        maxContextBytes: storedRecord.maxContextBytes,
        requestsPerSecond: storedRecord.rateLimitRps,
        tokenAlertThreshold7d: storedRecord.tokenAlertThreshold7d,
        updatedAt: occurredAt,
      })
      await executor
        .insert(applicationCredentials)
        .values(credentialInsertValues(credential))
      await initializeAdminConnectedAppFirecrawlForParent(
        actor,
        storedRecord.id,
        executor,
      )
      await executor.insert(auditEvents).values(
        auditValues({
          action: auditAction,
          applicationId: storedRecord.id,
          credentialRecordId: credential.id,
          keycloakSubjectId: storageActor.subject,
          occurredAt,
        }),
      )
      return loadConnectedAppBundle(storedApplication, executor)
    }
    const saved = transaction
      ? await persist(transaction)
      : await db.transaction(persist)
    if (!saved) {
      throw new Error("Created Application could not be read back.")
    }
    return saved
  }

  assertFixtureApplicationStorage()
  await emitAudit({
    action: auditAction,
    applicationId: record.id,
    credentialRecordId: credential.id,
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  memoryConnectedApps.unshift(cloneRecord(record))
  memoryConnectedAppCredentials.unshift(cloneCredentialRecord(credential))
  await initializeAdminConnectedAppFirecrawlForParent(actor, record.id)
  return memoryBundle(record)
}

async function updateConnectedAppPolicy(
  actor: Actor,
  id: string,
  request: AdminConnectedAppUpdateRequest,
): Promise<ConnectedAppBundle | null> {
  const allowedModels = normalizeList(request.allowedModels)
  const occurredAt = new Date()
  const db = getInferenceCoreDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    const updated = await db.transaction(async (transaction) => {
      const locked = await lockConnectedAppForMutation(transaction, id)
      if (!locked) {
        return false
      }
      const updated = await transaction
        .update(applications)
        .set({
          description: request.description,
          name: request.name,
          updatedAt: occurredAt,
          updatedBy: storageActor.subject,
        })
        .where(
          and(
            eq(applications.id, id),
            eq(applications.authMode, locked.authMode),
            ne(applications.status, "deleted"),
          ),
        )
        .returning({ id: applications.id })
      if (updated.length === 0) {
        return false
      }
      await transaction
        .delete(applicationModelAllowlists)
        .where(eq(applicationModelAllowlists.appId, id))
      await transaction.insert(applicationModelAllowlists).values(
        allowedModels.map((modelAlias) => ({
          appId: id,
          createdAt: occurredAt,
          modelAlias,
        })),
      )
      await transaction
        .insert(applicationLimits)
        .values({
          appId: id,
          maxConcurrentRequests: request.maxConcurrentRequests,
          maxContextBytes: request.maxContextBytes,
          requestsPerSecond: request.rateLimitRps,
          tokenAlertThreshold7d: request.tokenAlertThreshold7d,
          updatedAt: occurredAt,
        })
        .onConflictDoUpdate({
          target: applicationLimits.appId,
          set: {
            maxConcurrentRequests: request.maxConcurrentRequests,
            maxContextBytes: request.maxContextBytes,
            requestsPerSecond: request.rateLimitRps,
            tokenAlertThreshold7d: request.tokenAlertThreshold7d,
            updatedAt: occurredAt,
          },
        })
      const active = await transaction
        .select({ id: applicationCredentials.id })
        .from(applicationCredentials)
        .where(
          and(
            eq(applicationCredentials.appId, id),
            eq(applicationCredentials.status, "active"),
          ),
        )
        .limit(1)
      await transaction.insert(auditEvents).values(
        auditValues({
          action: "admin.connected_app.updated",
          applicationId: id,
          credentialRecordId: active[0]?.id,
          keycloakSubjectId: storageActor.subject,
          occurredAt,
        }),
      )
      return true
    })
    return updated ? getConnectedAppBundle(id) : null
  }

  assertFixtureApplicationStorage()
  const index = memoryConnectedApps.findIndex(
    (candidate) => candidate.id === id && candidate.status !== "deleted",
  )
  if (index < 0) {
    return null
  }
  const active = memoryConnectedAppCredentials.find(
    (credential) => credential.appId === id && credential.status === "active",
  )
  await emitAudit({
    action: "admin.connected_app.updated",
    applicationId: id,
    credentialRecordId: active?.id,
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  const stored = memoryConnectedApps[index]
  if (!stored || stored.status === "deleted") {
    return null
  }
  stored.allowedModels = allowedModels
  stored.description = request.description
  stored.maxConcurrentRequests = request.maxConcurrentRequests
  stored.maxContextBytes = request.maxContextBytes
  stored.name = request.name
  stored.rateLimitRps = request.rateLimitRps
  stored.tokenAlertThreshold7d = request.tokenAlertThreshold7d
  stored.updatedAt = occurredAt.toISOString()
  stored.updatedBy = actor.subject
  return memoryBundle(stored)
}

type ConnectedAppLifecycleStorageResult =
  | { bundle: ConnectedAppBundle; status: "updated" }
  | { status: "blocked" }
  | { status: "not_found" }

async function setConnectedAppLifecycleStatus(
  actor: Actor,
  id: string,
  targetStatus: "disabled" | "enabled",
): Promise<ConnectedAppLifecycleStorageResult> {
  const occurredAt = new Date()
  const auditAction =
    targetStatus === "enabled"
      ? "admin.connected_app.reenabled"
      : "admin.connected_app.disabled"
  const db = getInferenceCoreDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    const result = await db.transaction(async (transaction) => {
      const locked = await lockConnectedAppForMutation(transaction, id)
      if (!locked) {
        return { status: "not_found" } as const
      }
      const active = await transaction
        .select({ id: applicationCredentials.id })
        .from(applicationCredentials)
        .where(
          and(
            eq(applicationCredentials.appId, id),
            eq(applicationCredentials.kind, locked.authMode),
            eq(applicationCredentials.status, "active"),
            isNull(applicationCredentials.revokedAt),
          ),
        )
        .limit(1)
      if (targetStatus === "enabled" && active.length === 0) {
        return { status: "blocked" } as const
      }
      const changed = await transaction
        .update(applications)
        .set({
          status: targetStatus,
          updatedAt: occurredAt,
          updatedBy: storageActor.subject,
        })
        .where(
          and(
            eq(applications.id, id),
            eq(applications.authMode, locked.authMode),
            ne(applications.status, "deleted"),
          ),
        )
        .returning({ id: applications.id })
      if (changed.length === 0) {
        return { status: "not_found" } as const
      }
      if (targetStatus === "disabled") {
        await disableAdminConnectedAppFirecrawlForParent(actor, id, transaction)
      }
      await transaction.insert(auditEvents).values(
        auditValues({
          action: auditAction,
          applicationId: id,
          credentialRecordId: active[0]?.id,
          keycloakSubjectId: storageActor.subject,
          occurredAt,
        }),
      )
      return { status: "updated" } as const
    })
    if (result.status !== "updated") {
      return result
    }
    const saved = await getConnectedAppBundle(id)
    return saved
      ? { bundle: saved, status: "updated" }
      : { status: "not_found" }
  }

  assertFixtureApplicationStorage()
  const stored = memoryConnectedApps.find(
    (candidate) => candidate.id === id && candidate.status !== "deleted",
  )
  if (!stored) {
    return { status: "not_found" }
  }
  const active = memoryConnectedAppCredentials.find(
    (credential) =>
      credential.appId === id &&
      credential.status === "active" &&
      credential.revokedAt === null,
  )
  if (targetStatus === "enabled" && !active) {
    return { status: "blocked" }
  }
  await emitAudit({
    action: auditAction,
    applicationId: id,
    credentialRecordId: active?.id,
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  const current = memoryConnectedApps.find(
    (candidate) => candidate.id === id && candidate.status !== "deleted",
  )
  const currentActive = memoryConnectedAppCredentials.find(
    (credential) =>
      credential.appId === id &&
      credential.status === "active" &&
      credential.revokedAt === null,
  )
  if (!current) {
    return { status: "not_found" }
  }
  if (targetStatus === "enabled" && !currentActive) {
    return { status: "blocked" }
  }
  current.status = targetStatus
  current.updatedAt = occurredAt.toISOString()
  current.updatedBy = actor.subject
  if (targetStatus === "disabled") {
    await disableAdminConnectedAppFirecrawlForParent(actor, id)
  } else {
    await markAdminConnectedAppFirecrawlParentEnabled(id)
  }
  return { bundle: await memoryBundle(current), status: "updated" }
}

async function rotateStaticConnectedAppCredential(
  actor: Actor,
  existing: ConnectedAppBundle,
  identityContext: IdentityMutationRouteContext | undefined,
  revealEndpoints: ConnectedAppCredentialRevealEndpoints,
): Promise<ConnectedAppCredentialMutationResult> {
  const active = activeCredentialOrNull(existing)
  if (!active || active.authMethod !== "api_key") {
    return {
      detail: "An active static credential is required before rotation.",
      status: "blocked",
    }
  }
  const now = new Date()
  const issuedAt = now.toISOString()
  const overlapExpiresAt = new Date(
    now.getTime() + STATIC_KEY_OVERLAP_SECONDS * 1000,
  ).toISOString()
  const generated = createStaticApiKeyRecord(
    existing.record.id,
    issuedAt,
    existing.record.allowedModels[0] ?? null,
    revealEndpoints,
  )
  const updatedRecord: ConnectedAppRecord = {
    ...existing.record,
    connectionStatus: "not_connected",
    lastConnectedAt: null,
    updatedAt: issuedAt,
    updatedBy: actor.subject,
  }
  return commitConnectedAppCredentialReveal(
    identityContext,
    existing.record.id,
    async (transaction) => {
      const saved = await persistStaticCredentialRotation(
        actor,
        updatedRecord,
        active,
        generated.record,
        issuedAt,
        overlapExpiresAt,
        transaction,
      )
      return adminConnectedAppRotateCredentialResultSchema.parse({
        app: toPublicApp(saved),
        credential: generated.credential,
        detail:
          "Credential rotated. The previous key remains valid for exactly 86400 seconds unless revoked sooner.",
        status: "rotated",
      })
    },
  )
}

async function persistStaticCredentialRotation(
  actor: Actor,
  record: ConnectedAppRecord,
  active: ConnectedAppCredentialRecord,
  replacement: ConnectedAppCredentialRecord,
  rotatedAt: string,
  overlapExpiresAt: string,
  transaction?: InferenceCoreTransaction | null,
): Promise<ConnectedAppBundle> {
  const db = transaction ?? getInferenceCoreDb()
  if (db) {
    const occurredAt = new Date(rotatedAt)
    const persist = async (executor: InferenceCoreTransaction) => {
      const storageActor = await upsertActorUser(actor, executor)
      const locked = await lockConnectedAppForMutation(
        executor,
        record.id,
        "api_key",
      )
      if (!locked) {
        throw new Error("Application could not be updated during rotation.")
      }
      await executor
        .update(applicationCredentials)
        .set({ revokedAt: occurredAt, status: "revoked" })
        .where(
          and(
            eq(applicationCredentials.appId, record.id),
            eq(applicationCredentials.kind, "api_key"),
            eq(applicationCredentials.status, "retiring"),
          ),
        )
      const retired = await executor
        .update(applicationCredentials)
        .set({
          overlapExpiresAt: new Date(overlapExpiresAt),
          rotatedAt: occurredAt,
          status: "retiring",
        })
        .where(
          and(
            eq(applicationCredentials.id, active.id),
            eq(applicationCredentials.appId, record.id),
            eq(applicationCredentials.kind, "api_key"),
            eq(applicationCredentials.status, "active"),
          ),
        )
        .returning({ id: applicationCredentials.id })
      if (retired.length !== 1) {
        throw new Error("Active Application credential could not be retired.")
      }
      await executor
        .insert(applicationCredentials)
        .values(credentialInsertValues(replacement))
      const updated = await executor
        .update(applications)
        .set({
          connectionStatus: "not_connected",
          lastConnectedAt: null,
          updatedAt: occurredAt,
          updatedBy: storageActor.subject,
        })
        .where(
          and(
            eq(applications.id, record.id),
            eq(applications.authMode, "api_key"),
            ne(applications.status, "deleted"),
          ),
        )
        .returning({ id: applications.id })
      if (updated.length !== 1) {
        throw new Error("Application could not be updated during rotation.")
      }
      await executor.insert(auditEvents).values(
        auditValues({
          action: "admin.connected_app.credentials_rotated",
          applicationId: record.id,
          credentialRecordId: replacement.id,
          keycloakSubjectId: storageActor.subject,
          occurredAt,
        }),
      )
      const rows = await executor
        .select()
        .from(applications)
        .where(eq(applications.id, record.id))
        .limit(1)
      return rows[0] ? loadConnectedAppBundle(rows[0], executor) : null
    }
    const saved = transaction
      ? await persist(transaction)
      : await db.transaction(persist)
    if (!saved) {
      throw new Error("Rotated Application could not be read back.")
    }
    return saved
  }

  assertFixtureApplicationStorage()
  const appIndex = memoryConnectedApps.findIndex(
    (candidate) => candidate.id === record.id && candidate.status !== "deleted",
  )
  const activeStored = memoryConnectedAppCredentials.find(
    (credential) =>
      credential.id === active.id &&
      credential.appId === record.id &&
      credential.authMethod === "api_key" &&
      credential.status === "active",
  )
  if (appIndex < 0 || !activeStored) {
    throw new Error("Active Application credential could not be retired.")
  }
  await emitAudit({
    action: "admin.connected_app.credentials_rotated",
    applicationId: record.id,
    credentialRecordId: replacement.id,
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  for (const credential of memoryConnectedAppCredentials) {
    if (
      credential.appId === record.id &&
      credential.authMethod === "api_key" &&
      credential.status === "retiring"
    ) {
      credential.revokedAt = rotatedAt
      credential.status = "revoked"
    }
  }
  activeStored.overlapExpiresAt = overlapExpiresAt
  activeStored.rotatedAt = rotatedAt
  activeStored.status = "retiring"
  memoryConnectedAppCredentials.unshift(cloneCredentialRecord(replacement))
  memoryConnectedApps[appIndex] = cloneRecord(record)
  return memoryBundle(record)
}

async function rotateOAuthConnectedAppCredential(
  actor: Actor,
  existing: ConnectedAppBundle,
  identityContext?: IdentityMutationRouteContext,
  revealEndpoints?: ConnectedAppCredentialRevealEndpoints,
): Promise<ConnectedAppCredentialMutationResult> {
  const active = activeCredentialOrNull(existing)
  if (
    !active ||
    active.authMethod !== "oauth_client_credentials" ||
    !active.clientId ||
    !active.externalCredentialId
  ) {
    return {
      detail: "An active OAuth client is required before rotation.",
      status: "blocked",
    }
  }
  if (!identityContext) {
    return {
      detail: "Durable OAuth identity mutation state is unavailable.",
      status: "blocked",
    }
  }
  const endpoints = revealEndpoints
  if (!endpoints || endpoints.tokenUrl === null) {
    return connectedAppRevealConfigurationBlocked()
  }
  const tokenUrl = endpoints.tokenUrl
  if (!applicationIdentityProvider()) {
    return {
      detail:
        "The dedicated Keycloak Application administration client is unavailable.",
      status: "blocked",
    }
  }

  const clientId = active.clientId
  const externalCredentialId = active.externalCredentialId
  const rotatedAt = new Date().toISOString()
  let response!: AdminConnectedAppRotateCredentialResult
  await executeJournaledIdentityMutation({
    apply: async (
      preflight: { provider: ApplicationIdentityProvider },
      keycloak,
    ) => {
      const rotated = await keycloak.firstWrite(
        () =>
          preflight.provider.rotateConfidentialClientSecret(
            externalCredentialId,
            clientId,
          ),
        externalCredentialId,
      )
      if (
        rotated.id !== externalCredentialId ||
        rotated.clientId !== clientId
      ) {
        throw new Error("Keycloak returned a different OAuth client identity.")
      }
      return rotated
    },
    atomicFinalization: true,
    context: identityContext,
    finalize: async (credential, transaction) => {
      const saved = await persistOAuthCredentialRotation(
        actor,
        existing,
        active,
        rotatedAt,
        transaction,
      )
      response = adminConnectedAppRotateCredentialResultSchema.parse({
        app: toPublicApp(saved),
        credential: oauthCredentialPayload({
          clientId: credential.clientId,
          clientSecret: credential.clientSecret,
          credentialId: active.id,
          issuedAt: rotatedAt,
          model: existing.record.allowedModels[0] ?? null,
          tokenUrl,
          endpoints,
        }),
        detail:
          "OAuth client secret rotated. The previous secret is invalid immediately.",
        status: "rotated",
      })
    },
    keycloakSubjectId: actor.subject,
    preflight: async (signal) =>
      preflightExactOAuthClient(
        requireApplicationIdentityProvider(signal),
        clientId,
        externalCredentialId,
        "rotation",
      ),
    receiptResourceId: existing.record.id,
    targetIdentifier: clientId,
    targetType: "oauth_client",
  })
  return response
}

async function persistOAuthCredentialRotation(
  actor: Actor,
  existing: ConnectedAppBundle,
  active: ConnectedAppCredentialRecord,
  rotatedAt: string,
  transaction?: InferenceCoreTransaction | null,
): Promise<ConnectedAppBundle> {
  const db = transaction ?? getInferenceCoreDb()
  if (db) {
    const occurredAt = new Date(rotatedAt)
    const persist = async (executor: InferenceCoreTransaction) => {
      const storageActor = await upsertActorUser(actor, executor)
      const locked = await lockConnectedAppForMutation(
        executor,
        existing.record.id,
        "oauth_client_credentials",
      )
      if (!locked) {
        throw new Error("OAuth Application changed before finalization.")
      }
      const rotated = await executor
        .update(applicationCredentials)
        .set({
          issuedAt: occurredAt,
          lastUsedAt: null,
          overlapExpiresAt: null,
          revokedAt: null,
          rotatedAt: occurredAt,
          status: "active",
        })
        .where(
          and(
            eq(applicationCredentials.id, active.id),
            eq(applicationCredentials.appId, existing.record.id),
            eq(applicationCredentials.kind, "oauth_client_credentials"),
            eq(applicationCredentials.status, "active"),
            eq(
              applicationCredentials.clientIdentifier,
              active.clientId as string,
            ),
            eq(
              applicationCredentials.externalCredentialId,
              active.externalCredentialId as string,
            ),
          ),
        )
        .returning({ id: applicationCredentials.id })
      if (rotated.length !== 1) {
        throw new Error("Active OAuth credential changed before finalization.")
      }
      const updated = await executor
        .update(applications)
        .set({
          connectionStatus: "not_connected",
          lastConnectedAt: null,
          updatedAt: occurredAt,
          updatedBy: storageActor.subject,
        })
        .where(
          and(
            eq(applications.id, existing.record.id),
            eq(applications.authMode, "oauth_client_credentials"),
            ne(applications.status, "deleted"),
          ),
        )
        .returning({ id: applications.id })
      if (updated.length !== 1) {
        throw new Error("OAuth Application changed before finalization.")
      }
      await executor.insert(auditEvents).values(
        auditValues({
          action: "admin.connected_app.credentials_rotated",
          applicationId: existing.record.id,
          credentialRecordId: active.id,
          keycloakSubjectId: storageActor.subject,
          occurredAt,
        }),
      )
      const rows = await executor
        .select()
        .from(applications)
        .where(eq(applications.id, existing.record.id))
        .limit(1)
      return rows[0] ? loadConnectedAppBundle(rows[0], executor) : null
    }
    const saved = transaction
      ? await persist(transaction)
      : await db.transaction(persist)
    if (!saved) {
      throw new Error("Rotated OAuth Application could not be read back.")
    }
    return saved
  }

  assertFixtureApplicationStorage()
  const storedApp = memoryConnectedApps.find(
    (candidate) =>
      candidate.id === existing.record.id && candidate.status !== "deleted",
  )
  const storedCredential = memoryConnectedAppCredentials.find(
    (candidate) =>
      candidate.id === active.id &&
      candidate.appId === existing.record.id &&
      candidate.status === "active" &&
      candidate.clientId === active.clientId &&
      candidate.externalCredentialId === active.externalCredentialId,
  )
  if (!storedApp || !storedCredential) {
    throw new Error("OAuth Application changed before finalization.")
  }
  await emitAudit({
    action: "admin.connected_app.credentials_rotated",
    applicationId: existing.record.id,
    credentialRecordId: active.id,
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  storedCredential.issuedAt = rotatedAt
  storedCredential.lastUsedAt = null
  storedCredential.rotatedAt = rotatedAt
  storedApp.connectionStatus = "not_connected"
  storedApp.lastConnectedAt = null
  storedApp.updatedAt = rotatedAt
  storedApp.updatedBy = actor.subject
  return memoryBundle(storedApp)
}

async function revokeStaticConnectedAppCredential(
  actor: Actor,
  existing: ConnectedAppBundle,
  credential: ConnectedAppCredentialRecord,
): Promise<ConnectedAppRevocationResult> {
  const saved = await persistCredentialRevocation(actor, existing, credential)
  return { app: toPublicApp(saved), status: "revoked" }
}

async function revokeOAuthConnectedAppCredential(
  actor: Actor,
  existing: ConnectedAppBundle,
  credential: ConnectedAppCredentialRecord,
  identityContext?: IdentityMutationRouteContext,
): Promise<ConnectedAppRevocationResult> {
  if (
    credential.status !== "active" ||
    !credential.clientId ||
    !credential.externalCredentialId
  ) {
    return {
      detail: "Only the active OAuth credential can be revoked.",
      status: "blocked",
    }
  }
  if (!identityContext) {
    return {
      detail: "Durable OAuth identity mutation state is unavailable.",
      status: "blocked",
    }
  }
  if (!applicationIdentityProvider()) {
    return {
      detail:
        "The dedicated Keycloak Application administration client is unavailable.",
      status: "blocked",
    }
  }
  const clientId = credential.clientId
  const externalCredentialId = credential.externalCredentialId
  await executeJournaledIdentityMutation({
    apply: async (
      preflight: { provider: ApplicationIdentityProvider },
      keycloak,
    ) =>
      keycloak.firstWrite(
        () =>
          preflight.provider.deleteConfidentialClient(
            externalCredentialId,
            clientId,
          ),
        externalCredentialId,
      ),
    context: identityContext,
    finalize: async () => {
      await persistCredentialRevocation(actor, existing, credential)
    },
    keycloakSubjectId: actor.subject,
    preflight: async (signal) =>
      preflightExactOAuthClient(
        requireApplicationIdentityProvider(signal),
        clientId,
        externalCredentialId,
        "revocation",
      ),
    receiptResourceId: existing.record.id,
    targetIdentifier: clientId,
    targetType: "oauth_client",
  })
  const saved = await getConnectedAppBundle(existing.record.id)
  if (!saved) {
    throw new Error("Revoked OAuth Application could not be read back.")
  }
  return { app: toPublicApp(saved), status: "revoked" }
}

async function persistCredentialRevocation(
  actor: Actor,
  existing: ConnectedAppBundle,
  credential: ConnectedAppCredentialRecord,
): Promise<ConnectedAppBundle> {
  const now = new Date()
  const timestamp = now.toISOString()
  const db = getInferenceCoreDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    await db.transaction(async (transaction) => {
      const locked = await lockConnectedAppForMutation(
        transaction,
        existing.record.id,
        credential.authMethod,
      )
      if (!locked) {
        throw new Error("Application changed before credential revocation.")
      }
      const currentCredentials = await transaction
        .select({
          kind: applicationCredentials.kind,
          revokedAt: applicationCredentials.revokedAt,
          status: applicationCredentials.status,
        })
        .from(applicationCredentials)
        .where(
          and(
            eq(applicationCredentials.id, credential.id),
            eq(applicationCredentials.appId, existing.record.id),
          ),
        )
        .limit(1)
      const currentCredential = currentCredentials[0]
      if (
        !currentCredential ||
        currentCredential.kind !== credential.authMethod ||
        currentCredential.revokedAt !== null ||
        (currentCredential.status !== "active" &&
          currentCredential.status !== "retiring")
      ) {
        throw new Error("Application credential changed before revocation.")
      }
      const disablesApplication = currentCredential.status === "active"
      const revoked = await transaction
        .update(applicationCredentials)
        .set({ revokedAt: now, status: "revoked" })
        .where(
          and(
            eq(applicationCredentials.id, credential.id),
            eq(applicationCredentials.appId, existing.record.id),
            eq(applicationCredentials.kind, credential.authMethod),
            eq(applicationCredentials.status, currentCredential.status),
            isNull(applicationCredentials.revokedAt),
          ),
        )
        .returning({ id: applicationCredentials.id })
      if (revoked.length !== 1) {
        throw new Error("Application credential changed before revocation.")
      }
      if (disablesApplication) {
        const disabled = await transaction
          .update(applications)
          .set({
            connectionStatus: "not_connected",
            lastConnectedAt: null,
            status: "disabled",
            updatedAt: now,
            updatedBy: storageActor.subject,
          })
          .where(
            and(
              eq(applications.id, existing.record.id),
              eq(applications.authMode, credential.authMethod),
              ne(applications.status, "deleted"),
            ),
          )
          .returning({ id: applications.id })
        if (disabled.length !== 1) {
          throw new Error("Application changed before credential revocation.")
        }
        await disableAdminConnectedAppFirecrawlForParent(
          actor,
          existing.record.id,
          transaction,
        )
      }
      await transaction.insert(auditEvents).values(
        auditValues({
          action: "admin.connected_app.credential.revoked",
          applicationId: existing.record.id,
          credentialRecordId: credential.id,
          keycloakSubjectId: storageActor.subject,
          occurredAt: now,
        }),
      )
    })
    const saved = await getConnectedAppBundle(existing.record.id)
    if (!saved) {
      throw new Error("Revoked Application could not be read back.")
    }
    return saved
  }

  assertFixtureApplicationStorage()
  const storedApp = memoryConnectedApps.find(
    (candidate) =>
      candidate.id === existing.record.id && candidate.status !== "deleted",
  )
  const storedCredential = memoryConnectedAppCredentials.find(
    (candidate) =>
      candidate.id === credential.id &&
      candidate.appId === existing.record.id &&
      candidate.status !== "revoked",
  )
  if (!storedApp || !storedCredential) {
    throw new Error("Application credential changed before revocation.")
  }
  const disablesApplication = storedCredential.status === "active"
  await emitAudit({
    action: "admin.connected_app.credential.revoked",
    applicationId: existing.record.id,
    credentialRecordId: credential.id,
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  storedCredential.revokedAt = timestamp
  storedCredential.status = "revoked"
  if (disablesApplication) {
    storedApp.connectionStatus = "not_connected"
    storedApp.lastConnectedAt = null
    storedApp.status = "disabled"
    storedApp.updatedAt = timestamp
    storedApp.updatedBy = actor.subject
    await disableAdminConnectedAppFirecrawlForParent(actor, existing.record.id)
  }
  return memoryBundle(storedApp)
}

async function softDeleteStaticConnectedApp(
  actor: Actor,
  existing: ConnectedAppBundle,
): Promise<ConnectedAppLifecycleMutationResult> {
  await persistSoftDelete(actor, existing)
  return {
    app: null,
    applicationId: existing.record.id,
    detail: "Application deleted. Its identifiers and audit history remain.",
    status: "deleted",
  }
}

async function softDeleteOAuthConnectedApp(
  actor: Actor,
  existing: ConnectedAppBundle,
  identityContext?: IdentityMutationRouteContext,
): Promise<ConnectedAppLifecycleMutationResult> {
  const active = activeCredentialOrNull(existing)
  if (!active) {
    return softDeleteStaticConnectedApp(actor, existing)
  }
  if (!active.clientId || !active.externalCredentialId) {
    return {
      detail: "The OAuth client identity is incomplete.",
      status: "blocked",
    }
  }
  if (!identityContext) {
    return {
      detail: "Durable OAuth identity mutation state is unavailable.",
      status: "blocked",
    }
  }
  if (!applicationIdentityProvider()) {
    return {
      detail:
        "The dedicated Keycloak Application administration client is unavailable.",
      status: "blocked",
    }
  }
  const clientId = active.clientId
  const externalCredentialId = active.externalCredentialId
  await executeJournaledIdentityMutation({
    apply: async (
      preflight: { provider: ApplicationIdentityProvider },
      keycloak,
    ) =>
      keycloak.firstWrite(
        () =>
          preflight.provider.deleteConfidentialClient(
            externalCredentialId,
            clientId,
          ),
        externalCredentialId,
      ),
    context: identityContext,
    finalize: async () => {
      await persistSoftDelete(actor, existing)
    },
    keycloakSubjectId: actor.subject,
    preflight: async (signal) =>
      preflightExactOAuthClient(
        requireApplicationIdentityProvider(signal),
        clientId,
        externalCredentialId,
        "deletion",
      ),
    receiptResourceId: existing.record.id,
    targetIdentifier: clientId,
    targetType: "oauth_client",
  })
  return {
    app: null,
    applicationId: existing.record.id,
    detail: "Application deleted. Its identifiers and audit history remain.",
    status: "deleted",
  }
}

async function persistSoftDelete(
  actor: Actor,
  existing: ConnectedAppBundle,
): Promise<void> {
  const now = new Date()
  const timestamp = now.toISOString()
  const staleAuditCredential =
    activeCredentialOrNull(existing) ?? existing.credentials[0]
  const db = getInferenceCoreDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    await db.transaction(async (transaction) => {
      const locked = await lockConnectedAppForMutation(
        transaction,
        existing.record.id,
        existing.record.authMethod,
      )
      if (!locked) {
        throw new Error("Application changed before deletion.")
      }
      const currentActive = await transaction
        .select({ id: applicationCredentials.id })
        .from(applicationCredentials)
        .where(
          and(
            eq(applicationCredentials.appId, existing.record.id),
            eq(applicationCredentials.kind, existing.record.authMethod),
            eq(applicationCredentials.status, "active"),
            isNull(applicationCredentials.revokedAt),
          ),
        )
        .limit(1)
      await transaction
        .update(applicationCredentials)
        .set({ revokedAt: now, status: "revoked" })
        .where(
          and(
            eq(applicationCredentials.appId, existing.record.id),
            inArray(applicationCredentials.status, ["active", "retiring"]),
          ),
        )
      const deleted = await transaction
        .update(applications)
        .set({
          connectionStatus: "not_connected",
          lastConnectedAt: null,
          status: "deleted",
          updatedAt: now,
          updatedBy: storageActor.subject,
        })
        .where(
          and(
            eq(applications.id, existing.record.id),
            eq(applications.authMode, existing.record.authMethod),
            ne(applications.status, "deleted"),
          ),
        )
        .returning({ id: applications.id })
      if (deleted.length !== 1) {
        throw new Error("Application changed before deletion.")
      }
      await deleteAdminConnectedAppFirecrawlForParent(
        actor,
        existing.record.id,
        transaction,
      )
      await transaction.insert(auditEvents).values(
        auditValues({
          action: "admin.connected_app.deleted",
          applicationId: existing.record.id,
          credentialRecordId: currentActive[0]?.id ?? staleAuditCredential?.id,
          keycloakSubjectId: storageActor.subject,
          occurredAt: now,
        }),
      )
    })
    return
  }

  assertFixtureApplicationStorage()
  const storedApp = memoryConnectedApps.find(
    (candidate) =>
      candidate.id === existing.record.id && candidate.status !== "deleted",
  )
  if (!storedApp) {
    throw new Error("Application changed before deletion.")
  }
  await emitAudit({
    action: "admin.connected_app.deleted",
    applicationId: existing.record.id,
    credentialRecordId: staleAuditCredential?.id,
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  for (const credential of memoryConnectedAppCredentials) {
    if (
      credential.appId === existing.record.id &&
      credential.status !== "revoked"
    ) {
      credential.revokedAt = timestamp
      credential.status = "revoked"
    }
  }
  storedApp.connectionStatus = "not_connected"
  storedApp.lastConnectedAt = null
  storedApp.status = "deleted"
  storedApp.updatedAt = timestamp
  storedApp.updatedBy = actor.subject
  await deleteAdminConnectedAppFirecrawlForParent(actor, existing.record.id)
}

async function loadConnectedAppBundle(
  row: typeof applications.$inferSelect,
  database: InferenceCoreQueryExecutor | null = getInferenceCoreDb(),
): Promise<ConnectedAppBundle> {
  if (!database) {
    throw new Error("PostgreSQL Application storage is unavailable.")
  }
  const [modelRows, limitRows, credentialRows, usageRows, firecrawl] =
    await Promise.all([
      database
        .select()
        .from(applicationModelAllowlists)
        .where(eq(applicationModelAllowlists.appId, row.id)),
      database
        .select()
        .from(applicationLimits)
        .where(eq(applicationLimits.appId, row.id))
        .limit(1),
      database
        .select()
        .from(applicationCredentials)
        .where(eq(applicationCredentials.appId, row.id))
        .orderBy(desc(applicationCredentials.issuedAt)),
      database
        .select()
        .from(applicationUsageDaily)
        .where(
          and(
            eq(applicationUsageDaily.appId, row.id),
            gte(applicationUsageDaily.bucketDate, utcDate(-6)),
          ),
        ),
      getAdminConnectedAppFirecrawlProjection(row.id, database),
    ])
  const credentials = credentialRows.map(credentialRecordFromRow)
  const limits = limitRows[0]
  if (!limits) {
    throw new Error("Application protection policy storage is incomplete.")
  }
  if (!firecrawl) {
    throw new Error("Application Firecrawl projection is unavailable.")
  }
  const lastUsedAt = latestTimestamp(
    credentials.map((credential) => credential.lastUsedAt),
  )
  const usage = adminConnectedAppUsageSummarySchema.parse({
    failures7d: usageRows.reduce((total, item) => total + item.failureCount, 0),
    lastUsedAt,
    requests7d: usageRows.reduce((total, item) => total + item.requestCount, 0),
    tokens7d: usageRows.reduce((total, item) => total + item.totalTokens, 0),
  })
  return {
    credentials,
    firecrawl,
    record: {
      allowedModels: normalizeList(
        modelRows.map((modelRow) => modelRow.modelAlias),
      ),
      authMethod: authMethodFromStorage(row.authMode),
      connectionStatus: connectionStatusFromStorage(row.connectionStatus),
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
      description: row.description,
      id: row.id,
      lastConnectedAt: row.lastConnectedAt?.toISOString() ?? null,
      maxConcurrentRequests: limits.maxConcurrentRequests,
      maxContextBytes: limits.maxContextBytes,
      name: row.name,
      rateLimitRps: limits.requestsPerSecond,
      status: applicationStatusFromStorage(row.status),
      tokenAlertThreshold7d: limits.tokenAlertThreshold7d,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
      usage,
    },
  }
}

function credentialRecordFromRow(
  row: typeof applicationCredentials.$inferSelect,
): ConnectedAppCredentialRecord {
  return {
    appId: row.appId,
    authMethod: authMethodFromStorage(row.kind),
    clientId: row.clientIdentifier,
    externalCredentialId: row.externalCredentialId,
    id: row.id,
    issuedAt: row.issuedAt.toISOString(),
    keyHash: row.verifierHash,
    keyPrefix: row.keyPrefix,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    overlapExpiresAt: row.overlapExpiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    rotatedAt: row.rotatedAt?.toISOString() ?? null,
    status: credentialStatusFromStorage(row.status),
  }
}

function credentialInsertValues(record: ConnectedAppCredentialRecord) {
  return {
    appId: record.appId,
    clientIdentifier: record.clientId,
    externalCredentialId: record.externalCredentialId,
    id: record.id,
    issuedAt: new Date(record.issuedAt),
    keyPrefix: record.keyPrefix,
    kind: record.authMethod,
    lastUsedAt: record.lastUsedAt ? new Date(record.lastUsedAt) : null,
    overlapExpiresAt: record.overlapExpiresAt
      ? new Date(record.overlapExpiresAt)
      : null,
    revokedAt: record.revokedAt ? new Date(record.revokedAt) : null,
    rotatedAt: record.rotatedAt ? new Date(record.rotatedAt) : null,
    status: record.status,
    verifierHash: record.keyHash,
  }
}

async function getConnectedAppCredentialRecordsByPrefix(
  keyPrefix: string,
): Promise<ConnectedAppCredentialRecord[]> {
  const db = getInferenceCoreDb()
  if (db) {
    const rows = await db
      .select()
      .from(applicationCredentials)
      .where(eq(applicationCredentials.keyPrefix, keyPrefix))
    return rows.map(credentialRecordFromRow)
  }
  assertFixtureApplicationStorage()
  return memoryConnectedAppCredentials
    .filter((record) => record.keyPrefix === keyPrefix)
    .map(cloneCredentialRecord)
}

function toPublicApp(bundle: ConnectedAppBundle): AdminConnectedApp {
  const { record } = bundle
  if (record.status === "deleted") {
    throw new Error("Deleted Applications cannot be projected publicly.")
  }
  return {
    allowedModels: [...record.allowedModels],
    auditHref: `/activity?applicationId=${encodeURIComponent(record.id)}`,
    authMethod: record.authMethod,
    connectionStatus: record.connectionStatus,
    createdAt: record.createdAt,
    credentials: bundle.credentials.map(credentialMetadata),
    description: record.description,
    detailHref: `/applications/apps/${encodeURIComponent(record.id)}`,
    firecrawl: bundle.firecrawl,
    id: record.id,
    lastConnectedAt: record.lastConnectedAt,
    maxConcurrentRequests: record.maxConcurrentRequests,
    maxContextBytes: record.maxContextBytes,
    name: record.name,
    rateLimitRps: record.rateLimitRps,
    status: record.status,
    tokenAlertState: tokenAlertState(record),
    tokenAlertThreshold7d: record.tokenAlertThreshold7d,
    updatedAt: record.updatedAt,
    usage: { ...record.usage },
  }
}

function credentialMetadata(
  credential: ConnectedAppCredentialRecord,
): AdminConnectedAppCredentialMetadata {
  return {
    authMethod: credential.authMethod,
    clientId: credential.clientId,
    id: credential.id,
    issuedAt: credential.issuedAt,
    keyPrefix: credential.keyPrefix,
    lastUsedAt: credential.lastUsedAt,
    overlapExpiresAt: credential.overlapExpiresAt,
    revokedAt: credential.revokedAt,
    rotatedAt: credential.rotatedAt,
    status: credential.status,
  }
}

function runtimeIdentity(
  bundle: ConnectedAppBundle,
  credential: ConnectedAppCredentialRecord,
  clientId: string,
): ConnectedAppRuntimeIdentity {
  if (bundle.record.status === "deleted") {
    throw new Error("Deleted Applications cannot resolve runtime identities.")
  }
  return {
    allowedModels: [...bundle.record.allowedModels],
    appId: bundle.record.id,
    appName: bundle.record.name,
    authMethod: bundle.record.authMethod,
    clientId,
    credentialRecordId: credential.id,
    keycloakSubjectId: null,
    maxConcurrentRequests: bundle.record.maxConcurrentRequests,
    maxContextBytes: bundle.record.maxContextBytes,
    rateLimitRps: bundle.record.rateLimitRps,
    status: bundle.record.status,
    tokenAlertState: tokenAlertState(bundle.record),
    tokenAlertThreshold7d: bundle.record.tokenAlertThreshold7d,
    usage: { ...bundle.record.usage },
  }
}

function activeCredential(
  bundle: ConnectedAppBundle,
): ConnectedAppCredentialRecord {
  const credential = activeCredentialOrNull(bundle)
  if (!credential) {
    throw new Error("Application has no active credential.")
  }
  return credential
}

function activeCredentialOrNull(
  bundle: ConnectedAppBundle,
): ConnectedAppCredentialRecord | null {
  return (
    bundle.credentials.find((credential) => credential.status === "active") ??
    null
  )
}

function lifecycleResult(
  bundle: ConnectedAppBundle,
  status: "disabled" | "reenabled",
  detail: string,
): AdminConnectedAppLifecycleResult {
  return {
    app: toPublicApp(bundle),
    applicationId: bundle.record.id,
    detail,
    status,
  }
}

function applicationIdentityProvider(
  signal?: AbortSignal,
): ApplicationIdentityProvider | null {
  if (
    canUseBffFixtureData() &&
    process.env.CONNECTED_APPS_KEYCLOAK_FIXTURE === "true"
  ) {
    return fixtureApplicationIdentityProvider
  }
  const result = keycloakApplicationAdminClientFromEnv(process.env, signal)
  return result.status === "ok" ? result.client : null
}

function requireApplicationIdentityProvider(
  signal: AbortSignal,
): ApplicationIdentityProvider {
  const provider = applicationIdentityProvider(signal)
  if (!provider) {
    throw new KeycloakAdminError(
      "unavailable",
      "The dedicated Keycloak Application administration client is unavailable.",
    )
  }
  return provider
}

const fixtureApplicationIdentityProvider: ApplicationIdentityProvider = {
  async createConfidentialClient(input) {
    if (memoryOAuthClients.has(input.clientId)) {
      throw new KeycloakAdminError(
        "invalid",
        `Keycloak client ${input.clientId} already exists.`,
        "rejected",
      )
    }
    const client = {
      clientId: input.clientId,
      id: `fixture-${randomUUID()}`,
    }
    memoryOAuthClients.set(client.clientId, client)
    return {
      ...client,
      clientSecret: fixtureSecret(),
      tokenUrl: fixtureTokenUrl(),
    }
  },
  async deleteConfidentialClient(id, clientId) {
    const current = memoryOAuthClients.get(clientId)
    if (!current || current.id !== id) {
      throw fixtureIdentityMismatch(clientId, "deletion")
    }
    memoryOAuthClients.delete(clientId)
  },
  async findConfidentialClient(clientId) {
    return memoryOAuthClients.get(clientId) ?? null
  },
  async rotateConfidentialClientSecret(id, clientId) {
    const current = memoryOAuthClients.get(clientId)
    if (!current || current.id !== id) {
      throw fixtureIdentityMismatch(clientId, "secret rotation")
    }
    return {
      ...current,
      clientSecret: fixtureSecret(),
      tokenUrl: fixtureTokenUrl(),
    }
  },
}

async function preflightExactOAuthClient(
  provider: ApplicationIdentityProvider,
  clientId: string,
  externalCredentialId: string,
  operation: string,
): Promise<{
  clientId: string
  id: string
  provider: ApplicationIdentityProvider
}> {
  const client = await provider.findConfidentialClient(clientId)
  if (
    !client ||
    client.clientId !== clientId ||
    client.id !== externalCredentialId
  ) {
    throw new KeycloakAdminError(
      "invalid",
      `Keycloak client ${operation} was rejected because the exact client ID and internal ID did not match.`,
      "rejected",
    )
  }
  return { ...client, provider }
}

function fixtureIdentityMismatch(
  clientId: string,
  operation: string,
): KeycloakAdminError {
  return new KeycloakAdminError(
    "invalid",
    `Keycloak client ${operation} was rejected for ${clientId}.`,
    "rejected",
  )
}

function oauthCredentialPayload(input: {
  clientId: string
  clientSecret: string
  credentialId: string
  endpoints: ConnectedAppCredentialRevealEndpoints
  issuedAt: string
  model: string | null
  tokenUrl: string
}): AdminConnectedAppCredential {
  return {
    authMethod: "oauth_client_credentials",
    bffBaseUrl: input.endpoints.bffBaseUrl,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    credentialId: input.credentialId,
    exampleCurl: `curl -H "Authorization: Bearer <token>" ${input.endpoints.openAiBaseUrl}/models`,
    issuedAt: input.issuedAt,
    keyPrefix: null,
    model: input.model,
    openAiBaseUrl: input.endpoints.openAiBaseUrl,
    tokenUrl: input.tokenUrl,
  }
}

function createOAuthCredentialRecord(
  appId: string,
  clientId: string,
  externalCredentialId: string,
  issuedAt: string,
): ConnectedAppCredentialRecord {
  return {
    appId,
    authMethod: "oauth_client_credentials",
    clientId,
    externalCredentialId,
    id: `coc-${randomUUID()}`,
    issuedAt,
    keyHash: null,
    keyPrefix: null,
    lastUsedAt: null,
    overlapExpiresAt: null,
    revokedAt: null,
    rotatedAt: null,
    status: "active",
  }
}

function createStaticApiKeyRecord(
  appId: string,
  issuedAt: string,
  model: string | null,
  revealEndpoints: ConnectedAppCredentialRevealEndpoints,
): {
  credential: AdminConnectedAppCredential
  record: ConnectedAppCredentialRecord
} {
  const apiKey = generateStaticApiKey()
  const keyPrefix = staticApiKeyPrefix(apiKey) ?? apiKey.slice(0, 18)
  const id = `cak-${randomUUID()}`
  return {
    credential: apiKeyCredentialPayload({
      apiKey,
      credentialId: id,
      issuedAt,
      keyPrefix,
      model,
      endpoints: revealEndpoints,
    }),
    record: {
      appId,
      authMethod: "api_key",
      clientId: null,
      externalCredentialId: null,
      id,
      issuedAt,
      keyHash: staticApiKeyHash(apiKey),
      keyPrefix,
      lastUsedAt: null,
      overlapExpiresAt: null,
      revokedAt: null,
      rotatedAt: null,
      status: "active",
    },
  }
}

function apiKeyCredentialPayload(input: {
  apiKey: string
  credentialId: string
  endpoints: ConnectedAppCredentialRevealEndpoints
  issuedAt: string
  keyPrefix: string
  model: string | null
}): AdminConnectedAppCredential {
  return {
    apiKey: input.apiKey,
    authMethod: "api_key",
    bffBaseUrl: input.endpoints.bffBaseUrl,
    credentialId: input.credentialId,
    exampleCurl: `curl -H "Authorization: Bearer ${input.apiKey}" ${input.endpoints.openAiBaseUrl}/models`,
    issuedAt: input.issuedAt,
    keyPrefix: input.keyPrefix,
    model: input.model,
    openAiBaseUrl: input.endpoints.openAiBaseUrl,
  }
}

function auditValues(input: {
  action: string
  applicationId: string
  correlationId?: string
  credentialRecordId?: string
  keycloakSubjectId?: string | null
  occurredAt: Date
}) {
  return {
    action: input.action,
    applicationId: input.applicationId,
    correlationId: input.correlationId ?? randomUUID(),
    credentialPrefix: null,
    credentialRecordId: input.credentialRecordId ?? null,
    id: randomUUID(),
    keycloakSubjectId: input.keycloakSubjectId ?? null,
    occurredAt: input.occurredAt,
    outcome: "succeeded" as const,
    recoveryReasonCode: null,
    sourceSystem: "console" as const,
  }
}

async function memoryBundle(
  record: ConnectedAppRecord,
): Promise<ConnectedAppBundle> {
  const firecrawl = await getAdminConnectedAppFirecrawlProjection(record.id)
  if (!firecrawl) {
    throw new Error("Application Firecrawl projection is unavailable.")
  }
  return {
    credentials: memoryConnectedAppCredentials
      .filter((credential) => credential.appId === record.id)
      .map(cloneCredentialRecord)
      .sort((left, right) => right.issuedAt.localeCompare(left.issuedAt)),
    firecrawl,
    record: cloneRecord(record),
  }
}

function assertFixtureApplicationStorage(): void {
  if (!canUseBffFixtureData()) {
    throw new Error("PostgreSQL Application storage is unavailable.")
  }
}

function authMethodFromStorage(value: string): AdminConnectedAppAuthMethod {
  if (value === "api_key" || value === "oauth_client_credentials") {
    return value
  }
  throw new Error("Application storage contains an invalid auth method.")
}

function applicationStatusFromStorage(
  value: string,
): ConnectedAppRecord["status"] {
  if (value === "enabled" || value === "disabled" || value === "deleted") {
    return value
  }
  throw new Error("Application storage contains an invalid lifecycle status.")
}

function connectionStatusFromStorage(
  value: string,
): AdminConnectedAppConnectionStatus {
  if (
    value === "not_connected" ||
    value === "connected" ||
    value === "degraded"
  ) {
    return value
  }
  throw new Error("Application storage contains an invalid connection status.")
}

function credentialStatusFromStorage(
  value: string,
): ConnectedAppCredentialRecord["status"] {
  if (value === "active" || value === "retiring" || value === "revoked") {
    return value
  }
  throw new Error("Application storage contains an invalid credential status.")
}

function latestTimestamp(values: Array<string | null>): string | null {
  return (
    values
      .filter((value): value is string => value !== null)
      .sort((left, right) => right.localeCompare(left))[0] ?? null
  )
}

function generateStaticApiKey(): string {
  const prefix = randomBytes(9).toString("hex")
  const secret = randomBytes(32).toString("base64url")
  return `llmm_t4_${prefix}_${secret}`
}

function staticApiKeyPrefix(apiKey: string): string | null {
  const match = /^llmm_t4_([0-9a-f]{18})_[A-Za-z0-9_-]{43}$/u.exec(apiKey)
  return match?.[1] ? `llmm_t4_${match[1]}` : null
}

function staticApiKeyHash(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex")
}

function credentialIsUsable(record: ConnectedAppCredentialRecord): boolean {
  if (record.revokedAt !== null) {
    return false
  }
  if (record.status === "active") {
    return true
  }
  return (
    record.status === "retiring" &&
    record.overlapExpiresAt !== null &&
    new Date(record.overlapExpiresAt).getTime() > Date.now()
  )
}

function safeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex")
  const rightBuffer = Buffer.from(right, "hex")
  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }
  return timingSafeEqual(leftBuffer, rightBuffer)
}

function uniqueConnectedAppId(_name: string): string {
  return `app-${randomUUID()}`
}

function connectedAppClientId(id: string): string {
  return `llmm-${id}`
}

function resolveConnectedAppCredentialRevealPreflight(
  authMethod: AdminConnectedAppAuthMethod,
  supplied?: ConnectedAppCredentialRevealEndpoints,
): ConnectedAppCredentialRevealPreflight {
  try {
    return {
      endpoints: normalizedConnectedAppCredentialRevealEndpoints(
        authMethod,
        supplied,
      ),
      status: "ready",
    }
  } catch {
    return connectedAppRevealConfigurationBlocked()
  }
}

function connectedAppRevealConfigurationBlocked(): {
  detail: string
  status: "blocked"
} {
  return {
    detail:
      "Application credential reveal endpoints are unavailable or invalid.",
    status: "blocked",
  }
}

function normalizedConnectedAppCredentialRevealEndpoints(
  authMethod: AdminConnectedAppAuthMethod,
  supplied?: ConnectedAppCredentialRevealEndpoints,
): ConnectedAppCredentialRevealEndpoints {
  const bffBaseUrl = normalizeConnectedAppEndpointUrl(
    supplied?.bffBaseUrl ?? connectedAppBffBaseUrl(),
    true,
    isProductionRuntime(),
  )
  const openAiBaseUrl = normalizeConnectedAppEndpointUrl(
    `${bffBaseUrl}/api/app-gateway/v1`,
  )
  if (
    supplied &&
    normalizeConnectedAppEndpointUrl(supplied.openAiBaseUrl) !== openAiBaseUrl
  ) {
    throw new Error(
      "The supplied Application gateway endpoint is inconsistent.",
    )
  }
  if (authMethod === "api_key") {
    if (supplied && supplied.tokenUrl !== null) {
      throw new Error(
        "Static Application credentials cannot reveal a token URL.",
      )
    }
    return { bffBaseUrl, openAiBaseUrl, tokenUrl: null }
  }
  const tokenUrl = normalizeConnectedAppEndpointUrl(
    supplied?.tokenUrl ?? connectedAppOAuthTokenUrl(),
  )
  return { bffBaseUrl, openAiBaseUrl, tokenUrl }
}

function normalizeConnectedAppEndpointUrl(
  value: string,
  removeTrailingSlash = false,
  rejectLoopback = false,
): string {
  const candidate = value.trim()
  if (!candidate || candidate.includes("?") || candidate.includes("#")) {
    throw new Error("Application endpoint URL is invalid.")
  }
  const endpoint = new URL(candidate)
  if (
    (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    !endpoint.hostname ||
    (rejectLoopback && isLoopbackHostname(endpoint.hostname)) ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    throw new Error("Application endpoint URL is invalid.")
  }
  const normalized = endpoint.toString()
  return removeTrailingSlash ? normalized.replace(/\/+$/, "") : normalized
}

function connectedAppBffBaseUrl(): string {
  const configured = configuredConnectedAppBffBaseUrl()
  if (configured !== null) {
    return configured
  }
  if (isProductionRuntime()) {
    throw new Error("Application BFF base URL is required in production.")
  }
  return "http://localhost:4001"
}

function configuredConnectedAppBffBaseUrl(): string | null {
  for (const value of [
    process.env.CONNECTED_APPS_BFF_BASE_URL,
    process.env.PUBLIC_BFF_BASE_URL,
  ]) {
    const candidate = value?.trim()
    if (candidate) {
      return candidate
    }
  }
  return null
}

function isLoopbackHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/\.$/, "")
  const mappedIpv4HighWord =
    /^\[?::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}\]?$/.exec(hostname)?.[1]
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.startsWith("127.") ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    (mappedIpv4HighWord !== undefined &&
      Number.parseInt(mappedIpv4HighWord, 16) >>> 8 === 127)
  )
}

function connectedAppOAuthTokenUrl(): string {
  if (
    canUseBffFixtureData() &&
    process.env.CONNECTED_APPS_KEYCLOAK_FIXTURE === "true"
  ) {
    return fixtureTokenUrl()
  }
  const result = keycloakApplicationAdminConfigFromEnv(process.env)
  if (result.status !== "ok") {
    throw new Error("Application OAuth identity configuration is unavailable.")
  }
  return `${result.config.baseUrl}/realms/${encodeURIComponent(result.config.realm)}/protocol/openid-connect/token`
}

function fixtureTokenUrl(): string {
  return (
    process.env.CONNECTED_APPS_TOKEN_URL ??
    "https://keycloak.example.test/realms/llm-machines-applications/protocol/openid-connect/token"
  )
}

function fixtureSecret(): string {
  return `fixture-${randomBytes(32).toString("base64url")}`
}

function normalizeList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function gatewayUsageContext(
  app: ConnectedAppRuntimeIdentity,
  input: ConnectedAppGatewayAdmissionInput,
): ConnectedAppGatewayUsageContext {
  const startedAt = new Date()
  return {
    appId: app.appId,
    bucketDate: startedAt.toISOString().slice(0, 10),
    contextBytes: input.contextBytes,
    credentialId: app.credentialRecordId,
    leaseExpiresAt: new Date(
      startedAt.getTime() + GATEWAY_REQUEST_LEASE_SECONDS * 1_000,
    ).toISOString(),
    model: input.model,
    requestId: randomUUID(),
    route: input.route,
    startedAt: startedAt.toISOString(),
  }
}

function assertGatewayAdmissionInput(
  input: ConnectedAppGatewayAdmissionInput,
): void {
  if (!isNonNegativeSafeInteger(input.contextBytes)) {
    throw new Error("Connected app context bytes must be an exact integer.")
  }
  assertGatewayRouteModel(input.route, input.model, false)
}

function assertGatewayUsageInput(
  app: ConnectedAppRuntimeIdentity,
  input: ConnectedAppGatewayUsageInput,
  context: ConnectedAppGatewayUsageContext,
): void {
  if (
    context.appId !== app.appId ||
    context.credentialId !== app.credentialRecordId ||
    context.appId.length === 0 ||
    context.credentialId.length === 0 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      context.requestId,
    ) ||
    !isNonNegativeSafeInteger(context.contextBytes)
  ) {
    throw new Error("Connected app usage context is invalid.")
  }
  const allowRejectedChatWithoutModel = input.status >= 400
  assertGatewayRouteModel(
    context.route,
    context.model,
    allowRejectedChatWithoutModel,
  )
  assertGatewayRouteModel(
    input.route,
    input.model,
    allowRejectedChatWithoutModel,
  )
  if (input.route !== context.route || input.model !== context.model) {
    throw new Error("Connected app usage metadata changed after admission.")
  }
  const startedAt = new Date(context.startedAt)
  const leaseExpiresAt = new Date(context.leaseExpiresAt)
  const componentTokens = input.inputTokens + input.outputTokens
  if (
    !Number.isFinite(startedAt.getTime()) ||
    !Number.isFinite(leaseExpiresAt.getTime()) ||
    leaseExpiresAt <= startedAt ||
    context.bucketDate !== startedAt.toISOString().slice(0, 10)
  ) {
    throw new Error("Connected app usage timestamps are invalid.")
  }
  if (
    !Number.isInteger(input.status) ||
    input.status < 100 ||
    input.status > 599 ||
    !isNonNegativeSafeInteger(input.inputTokens) ||
    !isNonNegativeSafeInteger(input.outputTokens) ||
    !isNonNegativeSafeInteger(input.totalTokens) ||
    !isNonNegativeSafeInteger(input.latencyMs) ||
    !Number.isSafeInteger(componentTokens) ||
    input.totalTokens < componentTokens
  ) {
    throw new Error("Connected app usage counters are invalid.")
  }
}

function assertGatewayRouteModel(
  route: ConnectedAppGatewayRoute,
  model: string | null,
  allowRejectedChatWithoutModel: boolean,
): void {
  if (
    (route === "models" && model === null) ||
    (route === "chat_completions" &&
      ((typeof model === "string" &&
        model.length >= 1 &&
        model.length <= 160) ||
        (allowRejectedChatWithoutModel && model === null)))
  ) {
    return
  }
  throw new Error("Connected app route metadata is invalid.")
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function storedOptionalPositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }
  const parsed = typeof value === "string" ? Number(value) : value
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed <= 0
  ) {
    throw new Error("Connected app limits storage returned an invalid value.")
  }
  return parsed
}

function storedTimestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value))
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Connected app request storage returned an invalid clock.")
  }
  return date.toISOString()
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

function tokenAlertState(
  record: ConnectedAppRecord,
): "below" | "reached" | null {
  if (record.tokenAlertThreshold7d === null) {
    return null
  }
  return record.usage.tokens7d >= record.tokenAlertThreshold7d
    ? "reached"
    : "below"
}

function emptyUsage(): AdminConnectedAppUsageSummary {
  return {
    failures7d: 0,
    lastUsedAt: null,
    requests7d: 0,
    tokens7d: 0,
  }
}

function rateLimitExceeded(): {
  detail: string
  ok: false
  status: 429
  title: string
} {
  return {
    detail: "The connected app has reached its requests-per-second limit.",
    ok: false,
    status: 429,
    title: "Rate limit exceeded",
  }
}

function rateLimitUnavailable(): {
  detail: string
  ok: false
  status: 503
  title: string
} {
  return {
    detail:
      "PostgreSQL coordination is required before enforcing Application rate limits.",
    ok: false,
    status: 503,
    title: "Rate limit backend unavailable",
  }
}

function contextLimitExceeded(): {
  detail: string
  ok: false
  status: 413
  title: string
} {
  return {
    detail:
      "The request exceeds this connected app's maximum context size in bytes.",
    ok: false,
    status: 413,
    title: "Context limit exceeded",
  }
}

function concurrencyLimitExceeded(): {
  detail: string
  ok: false
  status: 429
  title: string
} {
  return {
    detail:
      "The connected app has reached its concurrent request limit. Retry after an active request completes.",
    ok: false,
    status: 429,
    title: "Concurrency limit exceeded",
  }
}

function gatewayAdmissionUnavailable(): {
  detail: string
  ok: false
  status: 503
  title: string
} {
  return {
    detail:
      "PostgreSQL coordination is required before enforcing connected app request protection.",
    ok: false,
    status: 503,
    title: "Request protection backend unavailable",
  }
}

function gatewayAdmissionStateChanged(): {
  detail: string
  ok: false
  status: 503
  title: string
} {
  return {
    detail:
      "The connected app or credential changed during request admission. Authenticate again.",
    ok: false,
    status: 503,
    title: "Connected app state changed",
  }
}

function utcDate(offsetDays = 0): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

function cloneRecord(record: ConnectedAppRecord): ConnectedAppRecord {
  return JSON.parse(JSON.stringify(record)) as ConnectedAppRecord
}

function cloneCredentialRecord(
  record: ConnectedAppCredentialRecord,
): ConnectedAppCredentialRecord {
  return JSON.parse(JSON.stringify(record)) as ConnectedAppCredentialRecord
}
