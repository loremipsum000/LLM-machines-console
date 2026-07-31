import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"
import type {
  AdminConnectedApp,
  AdminConnectedAppAuthMethod,
  AdminConnectedAppCreateRequest,
  AdminConnectedAppCreateResponse,
  AdminConnectedAppCredential,
  AdminConnectedAppDetail,
  AdminConnectedAppEnvironment,
  AdminConnectedAppEnvironmentState,
  AdminConnectedAppRotateCredentialResult,
  AdminConnectedAppTestResult,
  AdminConnectedAppUpdateRequest,
  AdminConnectedAppUsageSummary,
  AdminConnectedAppsResponse,
} from "@llm-machines/contracts/inference-core"
import { adminConnectedAppUsageSummarySchema } from "@llm-machines/contracts/inference-core"
import { and, desc, eq, gte, lte, sql } from "drizzle-orm"
import type { Actor } from "../auth/persona"
import { canUseBffFixtureData } from "../config/fixture-mode"
import { getInferenceCoreDb } from "../db/inference-core-client"
import {
  applicationCredentials,
  applicationLimits,
  applicationModelAllowlists,
  applicationUsageDaily,
  applications,
} from "../db/inference-core-schema"
import { emitAudit } from "./audit"
import {
  KeycloakAdminError,
  keycloakAdminClientFromEnv,
} from "./inference-core-keycloak-admin"
import { upsertActorUser } from "./users"

export type ConnectedAppCreateResult =
  | AdminConnectedAppCreateResponse
  | { detail: string; status: "blocked" }

export type ConnectedAppMutationResult =
  | { app: AdminConnectedApp; status: "updated" | "disabled" }
  | { status: "not_found" }

export type ConnectedAppCredentialMutationResult =
  | AdminConnectedAppPromotionResult
  | AdminConnectedAppRotateCredentialResult
  | { detail: string; status: "blocked" }
  | { status: "not_found" }

interface AdminConnectedAppPromotionResult {
  app: AdminConnectedApp
  credential?: AdminConnectedAppCredential
  detail: string
  status: "blocked" | "promoted"
}

interface ConnectedAppRecord {
  allowedModels: string[]
  createdAt: string
  createdBy: string
  description: string
  environments: ConnectedAppEnvironmentRecord[]
  id: string
  name: string
  ownerGroup: string
  rateLimitRpm: number | null
  status: "disabled" | "enabled"
  tokenBudget7d: number | null
  updatedAt: string
  updatedBy: string
  usage: AdminConnectedAppUsageSummary
}

interface ConnectedAppEnvironmentRecord
  extends AdminConnectedAppEnvironmentState {
  credentialRecordId: string
  keycloakClientUuid: string | null
}

interface ConnectedAppCredentialRecord {
  appId: string
  authMethod: AdminConnectedAppAuthMethod
  clientId: string | null
  environment: AdminConnectedAppEnvironment
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

export interface ConnectedAppRuntimeIdentity {
  allowedModels: string[]
  appId: string
  appName: string
  authMethod: AdminConnectedAppAuthMethod
  clientId: string
  credentialRecordId: string
  environment: AdminConnectedAppEnvironment
  keycloakSubjectId: string | null
  rateLimitRpm: number | null
  status: "disabled" | "enabled"
  tokenBudget7d: number | null
  usage: AdminConnectedAppUsageSummary
}

export interface ConnectedAppGatewayUsageInput {
  environment: AdminConnectedAppEnvironment
  latencyMs: number
  model: string | null
  status: number
  tokens: number
}

export interface ConnectedAppGatewayUsageContext {
  appId: string
  bucketDate: string
  credentialId: string
  environment: AdminConnectedAppEnvironment
}

const memoryConnectedApps: ConnectedAppRecord[] = []
const memoryConnectedAppCredentials: ConnectedAppCredentialRecord[] = []
const memoryRateLimitWindows = new Map<
  string,
  { count: number; startedAt: number }
>()

export async function getAdminConnectedApps(
  actor: Actor,
): Promise<AdminConnectedAppsResponse> {
  const apps = (await getConnectedAppRecords()).map(toPublicApp)
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
  const record = await getConnectedAppRecord(id)
  if (!record) {
    return null
  }
  await emitAudit({
    action: "admin.connected_app.read",
    applicationId: id,
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  return { app: toPublicApp(record) }
}

export async function createAdminConnectedApp(
  actor: Actor,
  request: AdminConnectedAppCreateRequest,
): Promise<ConnectedAppCreateResult> {
  const now = new Date().toISOString()
  const id = uniqueConnectedAppId(request.name)
  const authMethod = request.authMethod
  const apiKey =
    authMethod === "api_key"
      ? createStaticApiKeyRecord(
          id,
          "staging",
          now,
          request.allowedModels[0] ?? null,
        )
      : null
  const oauthClientId = connectedAppClientId(id, "staging")
  const oauth =
    authMethod === "oauth_client_credentials"
      ? await createKeycloakCredential({
          appDescription: request.description,
          appName: request.name,
          clientId: oauthClientId,
          environment: "staging",
          model: request.allowedModels[0] ?? null,
        })
      : null
  if (oauth && !oauth.ok) {
    return oauth
  }
  const oauthRecord = oauth?.ok
    ? createOAuthCredentialRecord(
        id,
        oauthClientId,
        oauth.keycloakClientUuid,
        now,
      )
    : null

  const record: ConnectedAppRecord = {
    allowedModels: normalizeList(request.allowedModels),
    createdAt: now,
    createdBy: actor.subject,
    description: request.description,
    environments: [
      {
        authMethods: [authMethod],
        clientId:
          authMethod === "oauth_client_credentials" ? oauthClientId : null,
        credentialRecordId: apiKey?.record.id ?? oauthRecord?.id ?? "",
        credentialIssuedAt: now,
        environment: "staging",
        keyPrefix: apiKey?.record.keyPrefix ?? null,
        keycloakClientUuid: oauth?.ok ? oauth.keycloakClientUuid : null,
        lastUsedAt: null,
        lastTestedAt: null,
        primaryAuthMethod: authMethod,
        productionReady: false,
        testStatus: "not_tested",
      },
    ],
    id,
    name: request.name,
    ownerGroup: request.ownerGroup,
    rateLimitRpm: request.rateLimitRpm,
    status: "enabled",
    tokenBudget7d: request.tokenBudget7d,
    updatedAt: now,
    updatedBy: actor.subject,
    usage: emptyUsage(),
  }

  const credentialRecord = apiKey?.record ?? oauthRecord
  const credential = apiKey?.credential ?? (oauth?.ok ? oauth.credential : null)
  if (!credentialRecord || !credential) {
    return {
      detail: "Connected app credential could not be created.",
      status: "blocked",
    }
  }
  let saved: ConnectedAppRecord
  try {
    saved = await saveConnectedAppRecord(actor, record, credentialRecord)
  } catch (error) {
    if (oauth?.ok) {
      const compensated = await deleteKeycloakCredential(
        oauth.keycloakClientUuid,
      )
      if (!compensated) {
        return {
          detail: `Connected app persistence failed and Keycloak cleanup did not complete. Reconcile client ${oauthClientId} before retrying; do not use a new idempotency key until Keycloak is checked.`,
          status: "blocked",
        }
      }
      return {
        detail:
          "Connected app persistence failed. The temporary Keycloak client was removed; retry the request.",
        status: "blocked",
      }
    }
    throw error
  }
  const credentialMetadata = await connectedAppAuditCredentialMetadata(
    saved,
    "staging",
  )
  await emitAudit({
    action: "admin.connected_app.created",
    applicationId: saved.id,
    credentialRecordId: credentialMetadata.credentialRecordId ?? undefined,
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  return {
    app: toPublicApp(saved),
    credential,
    status: "created",
  }
}

export async function updateAdminConnectedApp(
  actor: Actor,
  id: string,
  request: AdminConnectedAppUpdateRequest,
): Promise<ConnectedAppMutationResult> {
  const existing = await getConnectedAppRecord(id)
  if (!existing) {
    return { status: "not_found" }
  }
  const now = new Date().toISOString()
  const updated: ConnectedAppRecord = {
    ...existing,
    allowedModels: normalizeList(request.allowedModels),
    description: request.description,
    environments: existing.environments.map((environment) => ({
      ...environment,
      productionReady: false,
      testStatus:
        environment.testStatus === "passed" ? "stale" : environment.testStatus,
    })),
    name: request.name,
    ownerGroup: request.ownerGroup,
    rateLimitRpm: request.rateLimitRpm,
    status: request.status,
    tokenBudget7d: request.tokenBudget7d,
    updatedAt: now,
    updatedBy: actor.subject,
  }
  const saved = await updateConnectedAppRecord(actor, updated)
  await emitAudit({
    action: "admin.connected_app.updated",
    applicationId: saved.id,
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  return { app: toPublicApp(saved), status: "updated" }
}

export async function testAdminConnectedApp(
  actor: Actor,
  id: string,
): Promise<AdminConnectedAppTestResult | { status: "not_found" }> {
  const existing = await getConnectedAppRecord(id)
  if (!existing) {
    return { status: "not_found" }
  }
  const now = new Date().toISOString()
  const updated = {
    ...existing,
    environments: existing.environments.map((environment) =>
      environment.environment === "staging"
        ? {
            ...environment,
            lastTestedAt: now,
            productionReady: true,
            testStatus: "passed" as const,
          }
        : environment,
    ),
    updatedAt: now,
    updatedBy: actor.subject,
  }
  const saved = await updateConnectedAppRecord(actor, updated)
  const credentialMetadata = await connectedAppAuditCredentialMetadata(
    saved,
    "staging",
  )
  await emitAudit({
    action: "admin.connected_app.tested",
    applicationId: id,
    credentialRecordId: credentialMetadata.credentialRecordId ?? undefined,
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  return {
    app: toPublicApp(saved),
    detail: "Staging credentials can reach the BFF app gateway.",
    environment: "staging",
    status: "passed",
    testedAt: now,
  }
}

export async function promoteAdminConnectedAppToProduction(
  _actor: Actor,
  id: string,
): Promise<ConnectedAppCredentialMutationResult> {
  const existing = await getConnectedAppRecord(id)
  if (!existing) {
    return { status: "not_found" }
  }
  return {
    app: toPublicApp(existing),
    detail:
      "Environment-qualified production credentials are not part of the Inference Core Application model.",
    status: "blocked",
  }
}

export async function rotateAdminConnectedAppCredentials(
  actor: Actor,
  id: string,
): Promise<ConnectedAppCredentialMutationResult> {
  const existing = await getConnectedAppRecord(id)
  if (!existing) {
    return { status: "not_found" }
  }
  const environment = environmentRecord(existing, "staging")
  if (!environment) {
    return {
      detail: "Staging credentials are not available for rotation.",
      status: "blocked",
    }
  }
  if (environment.primaryAuthMethod === "oauth_client_credentials") {
    return {
      app: toPublicApp(existing),
      detail:
        "OAuth client-secret rotation remains disabled until durable identity reconciliation is available.",
      status: "blocked",
    }
  }
  const now = new Date().toISOString()
  const apiKey = createStaticApiKeyRecord(
    existing.id,
    "staging",
    now,
    existing.allowedModels[0] ?? null,
  )
  const updated: ConnectedAppRecord = {
    ...existing,
    environments: existing.environments.map((item) =>
      item.environment === "staging"
        ? {
            ...item,
            credentialRecordId: apiKey.record.id,
            keyPrefix: apiKey.record.keyPrefix,
            credentialIssuedAt: now,
            lastUsedAt: null,
            lastTestedAt: null,
            productionReady: false,
            testStatus: "not_tested",
          }
        : item,
    ),
    updatedAt: now,
    updatedBy: actor.subject,
  }
  const saved = await replaceActiveConnectedAppCredential(
    actor,
    updated,
    apiKey.record,
    now,
  )
  const credentialMetadata = await connectedAppAuditCredentialMetadata(
    saved,
    "staging",
  )
  await emitAudit({
    action: "admin.connected_app.credentials_rotated",
    applicationId: id,
    credentialRecordId: credentialMetadata.credentialRecordId ?? undefined,
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  return {
    app: toPublicApp(saved),
    credential: apiKey.credential,
    detail: "Staging credentials rotated.",
    status: "rotated",
  }
}

export async function disableAdminConnectedApp(
  actor: Actor,
  id: string,
): Promise<ConnectedAppMutationResult> {
  const existing = await getConnectedAppRecord(id)
  if (!existing) {
    return { status: "not_found" }
  }
  const saved = await updateConnectedAppRecord(actor, {
    ...existing,
    status: "disabled",
    updatedAt: new Date().toISOString(),
    updatedBy: actor.subject,
  })
  await emitAudit({
    action: "admin.connected_app.disabled",
    applicationId: id,
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  return { app: toPublicApp(saved), status: "disabled" }
}

export async function getConnectedAppRecord(
  id: string,
): Promise<ConnectedAppRecord | null> {
  const records = await getConnectedAppRecords()
  return records.find((record) => record.id === id) ?? null
}

export async function resolveConnectedAppRuntimeIdentity(
  clientId: string,
): Promise<ConnectedAppRuntimeIdentity | null> {
  const records = await getConnectedAppRecords()
  for (const record of records) {
    const environment = record.environments.find(
      (item) => item.clientId === clientId,
    )
    if (!environment) {
      continue
    }
    const usedAt = new Date().toISOString()
    await markApiKeyLastUsed(environment.credentialRecordId, usedAt)
    await updateConnectedAppEnvironmentLastUsed(
      record,
      environment.environment,
      usedAt,
    )
    return {
      allowedModels: record.allowedModels,
      appId: record.id,
      appName: record.name,
      authMethod: "oauth_client_credentials",
      clientId,
      credentialRecordId: environment.credentialRecordId,
      environment: environment.environment,
      keycloakSubjectId: null,
      rateLimitRpm: record.rateLimitRpm,
      status: record.status,
      tokenBudget7d: record.tokenBudget7d,
      usage: record.usage,
    }
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
  const record = await getConnectedAppRecord(matched.appId)
  const environment = record
    ? environmentRecord(record, matched.environment)
    : null
  if (!record || !environment) {
    return null
  }
  const usedAt = new Date().toISOString()
  await markApiKeyLastUsed(matched.id, usedAt)
  await updateConnectedAppEnvironmentLastUsed(
    record,
    matched.environment,
    usedAt,
  )
  return {
    allowedModels: record.allowedModels,
    appId: record.id,
    appName: record.name,
    authMethod: "api_key",
    clientId: matched.keyPrefix ?? keyPrefix,
    credentialRecordId: matched.id,
    environment: matched.environment,
    keycloakSubjectId: null,
    rateLimitRpm: record.rateLimitRpm,
    status: record.status,
    tokenBudget7d: record.tokenBudget7d,
    usage: record.usage,
  }
}

export async function recordConnectedAppGatewayUsage(
  app: ConnectedAppRuntimeIdentity,
  input: ConnectedAppGatewayUsageInput,
): Promise<void> {
  await reconcileConnectedAppGatewayUsage(app, input, {
    appId: app.appId,
    bucketDate: utcDate(),
    credentialId: app.credentialRecordId,
    environment: input.environment,
  })
}

export async function consumeConnectedAppGatewayRateLimit(
  app: ConnectedAppRuntimeIdentity,
): Promise<
  { ok: true } | { detail: string; ok: false; status: 429 | 503; title: string }
> {
  if (app.rateLimitRpm === null) {
    return { ok: true }
  }
  const db = getInferenceCoreDb()
  if (!db && !canUseBffFixtureData()) {
    return rateLimitUnavailable()
  }

  if (db) {
    try {
      const rows = await db.execute(sql<{ request_count: number }>`
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
          date_trunc('minute', clock_timestamp()),
          1,
          date_trunc('minute', clock_timestamp()) + interval '2 minutes'
        )
        ON CONFLICT (app_id, window_started_at)
        DO UPDATE SET
          request_count =
            admin.application_rate_limit_windows.request_count + 1,
          expires_at = EXCLUDED.expires_at
        WHERE admin.application_rate_limit_windows.request_count
          < ${app.rateLimitRpm}
        RETURNING request_count
      `)
      return Array.isArray(rows) && rows.length > 0
        ? { ok: true }
        : rateLimitExceeded()
    } catch {
      return rateLimitUnavailable()
    }
  }

  const now = Date.now()
  const existing = memoryRateLimitWindows.get(app.appId)
  if (!existing || now - existing.startedAt >= 60_000) {
    memoryRateLimitWindows.set(app.appId, { count: 1, startedAt: now })
    return { ok: true }
  }
  if (existing.count >= app.rateLimitRpm) {
    return rateLimitExceeded()
  }
  existing.count += 1
  return { ok: true }
}

export async function admitConnectedAppGatewayUsage(
  app: ConnectedAppRuntimeIdentity,
): Promise<
  | { context: ConnectedAppGatewayUsageContext; ok: true }
  | { detail: string; ok: false; status: 503; title: string }
> {
  if (app.tokenBudget7d !== null) {
    return tokenBudgetNotQualified()
  }
  return {
    context: {
      appId: app.appId,
      bucketDate: utcDate(),
      credentialId: app.credentialRecordId,
      environment: app.environment,
    },
    ok: true,
  }
}

export async function reconcileConnectedAppGatewayUsage(
  app: ConnectedAppRuntimeIdentity,
  input: ConnectedAppGatewayUsageInput,
  context: ConnectedAppGatewayUsageContext,
): Promise<void> {
  const tokens = Math.max(0, Math.floor(input.tokens))
  const now = new Date().toISOString()
  const db = getInferenceCoreDb()
  if (db) {
    await db.execute(sql`
      WITH usage_row AS (
        INSERT INTO admin.application_usage_daily (
          app_id,
          credential_id,
          bucket_date,
          request_count,
          failure_count,
          input_tokens,
          output_tokens,
          total_tokens,
          updated_at
        )
        VALUES (
          ${app.appId},
          ${context.credentialId},
          ${context.bucketDate}::date,
          1,
          ${input.status >= 400 ? 1 : 0},
          0,
          0,
          ${tokens},
          ${now}::timestamptz
        )
        ON CONFLICT (app_id, credential_id, bucket_date)
        DO UPDATE SET
          request_count =
            admin.application_usage_daily.request_count + 1,
          failure_count =
            admin.application_usage_daily.failure_count
            + EXCLUDED.failure_count,
          total_tokens =
            admin.application_usage_daily.total_tokens
            + EXCLUDED.total_tokens,
          updated_at = EXCLUDED.updated_at
        RETURNING app_id
      ),
      application_state AS (
        UPDATE admin.applications
        SET
          connection_status =
            ${input.status < 500 ? "connected" : "degraded"},
          last_connected_at = ${now}::timestamptz
        FROM usage_row
        WHERE admin.applications.id = usage_row.app_id
      )
      UPDATE admin.application_credentials
      SET last_used_at = ${now}::timestamptz
      WHERE id = ${context.credentialId}
    `)
    return
  }
  if (!canUseBffFixtureData()) {
    throw new Error("PostgreSQL usage accounting is unavailable.")
  }

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
    tokens7d: record.usage.tokens7d + tokens,
  }
}

export async function resetConnectedAppsForTest(): Promise<void> {
  memoryConnectedApps.splice(0)
  memoryConnectedAppCredentials.splice(0)
  memoryRateLimitWindows.clear()
}

async function getConnectedAppRecords(): Promise<ConnectedAppRecord[]> {
  const db = getInferenceCoreDb()
  if (db) {
    const rows = await db
      .select()
      .from(applications)
      .orderBy(desc(applications.updatedAt))
    return Promise.all(rows.map(loadConnectedAppRecord))
  }
  if (!canUseBffFixtureData()) {
    throw new Error("PostgreSQL Application storage is unavailable.")
  }
  return memoryConnectedApps.map(cloneRecord)
}

async function saveConnectedAppRecord(
  actor: Actor,
  record: ConnectedAppRecord,
  credential: ConnectedAppCredentialRecord,
): Promise<ConnectedAppRecord> {
  const db = getInferenceCoreDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    const environment = environmentRecord(record, "staging")
    await db.transaction(async (transaction) => {
      await transaction.insert(applications).values({
        authMode: environment?.primaryAuthMethod ?? "api_key",
        connectionStatus: connectionStatus(environment),
        createdAt: new Date(record.createdAt),
        createdBy: storageActor.subject,
        description: record.description,
        id: record.id,
        lastConnectedAt: environment?.lastUsedAt
          ? new Date(environment.lastUsedAt)
          : null,
        lastTestedAt: environment?.lastTestedAt
          ? new Date(environment.lastTestedAt)
          : null,
        name: record.name,
        status: record.status,
        updatedAt: new Date(record.updatedAt),
        updatedBy: storageActor.subject,
      })
      if (record.allowedModels.length > 0) {
        await transaction.insert(applicationModelAllowlists).values(
          record.allowedModels.map((modelAlias) => ({
            appId: record.id,
            createdAt: new Date(record.createdAt),
            modelAlias,
          })),
        )
      }
      await transaction.insert(applicationLimits).values({
        appId: record.id,
        requestsPerMinute: record.rateLimitRpm,
        tokensPer7d: record.tokenBudget7d,
        updatedAt: new Date(record.updatedAt),
      })
      await transaction
        .insert(applicationCredentials)
        .values(credentialInsertValues(credential))
    })
    return {
      ...record,
      createdBy: storageActor.subject,
      updatedBy: storageActor.subject,
    }
  }
  if (!canUseBffFixtureData()) {
    throw new Error("PostgreSQL Application storage is unavailable.")
  }
  memoryConnectedApps.unshift(cloneRecord(record))
  memoryConnectedAppCredentials.unshift(cloneCredentialRecord(credential))
  return cloneRecord(record)
}

async function updateConnectedAppRecord(
  actor: Actor,
  record: ConnectedAppRecord,
): Promise<ConnectedAppRecord> {
  const db = getInferenceCoreDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    const environment = environmentRecord(record, "staging")
    await db.transaction(async (transaction) => {
      await transaction
        .update(applications)
        .set({
          connectionStatus: connectionStatus(environment),
          description: record.description,
          lastConnectedAt: environment?.lastUsedAt
            ? new Date(environment.lastUsedAt)
            : null,
          lastTestedAt: environment?.lastTestedAt
            ? new Date(environment.lastTestedAt)
            : null,
          name: record.name,
          status: record.status,
          updatedAt: new Date(record.updatedAt),
          updatedBy: storageActor.subject,
        })
        .where(eq(applications.id, record.id))
      await transaction
        .delete(applicationModelAllowlists)
        .where(eq(applicationModelAllowlists.appId, record.id))
      if (record.allowedModels.length > 0) {
        await transaction.insert(applicationModelAllowlists).values(
          record.allowedModels.map((modelAlias) => ({
            appId: record.id,
            createdAt: new Date(record.updatedAt),
            modelAlias,
          })),
        )
      }
      await transaction
        .insert(applicationLimits)
        .values({
          appId: record.id,
          requestsPerMinute: record.rateLimitRpm,
          tokensPer7d: record.tokenBudget7d,
          updatedAt: new Date(record.updatedAt),
        })
        .onConflictDoUpdate({
          target: applicationLimits.appId,
          set: {
            requestsPerMinute: record.rateLimitRpm,
            tokensPer7d: record.tokenBudget7d,
            updatedAt: new Date(record.updatedAt),
          },
        })
    })
    return { ...record, updatedBy: storageActor.subject }
  }
  if (!canUseBffFixtureData()) {
    throw new Error("PostgreSQL Application storage is unavailable.")
  }
  const index = memoryConnectedApps.findIndex((item) => item.id === record.id)
  if (index >= 0) {
    memoryConnectedApps[index] = cloneRecord(record)
  }
  return cloneRecord(record)
}

function credentialInsertValues(record: ConnectedAppCredentialRecord) {
  return {
    appId: record.appId,
    clientIdentifier: record.clientId,
    externalCredentialId: record.externalCredentialId,
    id: record.id,
    issuedAt: new Date(record.issuedAt),
    keyPrefix: record.keyPrefix,
    kind:
      record.authMethod === "api_key"
        ? ("api_key" as const)
        : ("oauth_client_credentials" as const),
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
    const now = new Date()
    await db
      .update(applicationCredentials)
      .set({ revokedAt: now, status: "revoked" })
      .where(
        and(
          eq(applicationCredentials.keyPrefix, keyPrefix),
          eq(applicationCredentials.status, "retiring"),
          lte(applicationCredentials.overlapExpiresAt, now),
        ),
      )
    const rows = await db
      .select()
      .from(applicationCredentials)
      .where(eq(applicationCredentials.keyPrefix, keyPrefix))
    return rows.map(credentialRecordFromRow)
  }
  if (!canUseBffFixtureData()) {
    throw new Error("PostgreSQL Application credential storage is unavailable.")
  }
  const now = Date.now()
  for (const record of memoryConnectedAppCredentials) {
    if (
      record.keyPrefix === keyPrefix &&
      record.status === "retiring" &&
      record.overlapExpiresAt &&
      new Date(record.overlapExpiresAt).getTime() <= now
    ) {
      record.revokedAt = new Date(now).toISOString()
      record.status = "revoked"
    }
  }
  return memoryConnectedAppCredentials
    .filter((record) => record.keyPrefix === keyPrefix)
    .map(cloneCredentialRecord)
}

async function connectedAppAuditCredentialMetadata(
  record: ConnectedAppRecord,
  environment: AdminConnectedAppEnvironment,
): Promise<{
  credentialRecordId: string | null
  keyPrefix: string | null
}> {
  const state = environmentRecord(record, environment)
  return {
    credentialRecordId: state?.credentialRecordId || null,
    keyPrefix: state?.keyPrefix ?? null,
  }
}

async function replaceActiveConnectedAppCredential(
  actor: Actor,
  record: ConnectedAppRecord,
  replacement: ConnectedAppCredentialRecord,
  rotatedAt: string,
): Promise<ConnectedAppRecord> {
  const overlapExpiresAt = new Date(
    new Date(rotatedAt).getTime() + 24 * 60 * 60 * 1000,
  ).toISOString()
  const db = getInferenceCoreDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    return db.transaction(async (transaction) => {
      await transaction
        .update(applicationCredentials)
        .set({
          revokedAt: new Date(rotatedAt),
          status: "revoked",
        })
        .where(
          and(
            eq(applicationCredentials.appId, replacement.appId),
            eq(applicationCredentials.kind, "api_key"),
            eq(applicationCredentials.status, "retiring"),
          ),
        )
      const retiring = await transaction
        .update(applicationCredentials)
        .set({
          overlapExpiresAt: new Date(overlapExpiresAt),
          rotatedAt: new Date(rotatedAt),
          status: "retiring",
        })
        .where(
          and(
            eq(applicationCredentials.appId, replacement.appId),
            eq(applicationCredentials.kind, "api_key"),
            eq(applicationCredentials.status, "active"),
          ),
        )
        .returning({ id: applicationCredentials.id })
      if (retiring.length !== 1) {
        throw new Error("Active Application credential could not be retired.")
      }
      await transaction
        .insert(applicationCredentials)
        .values(credentialInsertValues(replacement))
      const updated = await transaction
        .update(applications)
        .set({
          connectionStatus: "not_connected",
          lastConnectedAt: null,
          lastTestedAt: null,
          updatedAt: new Date(record.updatedAt),
          updatedBy: storageActor.subject,
        })
        .where(eq(applications.id, record.id))
        .returning({ id: applications.id })
      if (updated.length !== 1) {
        throw new Error("Application could not be updated during rotation.")
      }
      return { ...record, updatedBy: storageActor.subject }
    })
  }
  if (!canUseBffFixtureData()) {
    throw new Error("PostgreSQL Application credential storage is unavailable.")
  }
  const active = memoryConnectedAppCredentials.find(
    (record) =>
      record.appId === replacement.appId &&
      record.authMethod === "api_key" &&
      record.status === "active",
  )
  const appIndex = memoryConnectedApps.findIndex(
    (item) => item.id === replacement.appId,
  )
  if (!active || appIndex < 0) {
    throw new Error("Active Application credential could not be retired.")
  }
  for (const record of memoryConnectedAppCredentials) {
    if (
      record.appId === replacement.appId &&
      record.authMethod === "api_key" &&
      record.status === "retiring"
    ) {
      record.revokedAt = rotatedAt
      record.status = "revoked"
    }
  }
  active.overlapExpiresAt = overlapExpiresAt
  active.rotatedAt = rotatedAt
  active.status = "retiring"
  memoryConnectedAppCredentials.unshift(cloneCredentialRecord(replacement))
  memoryConnectedApps[appIndex] = cloneRecord(record)
  return cloneRecord(record)
}

async function markApiKeyLastUsed(
  id: string,
  lastUsedAt: string,
): Promise<void> {
  const db = getInferenceCoreDb()
  if (db) {
    await db
      .update(applicationCredentials)
      .set({ lastUsedAt: new Date(lastUsedAt) })
      .where(eq(applicationCredentials.id, id))
    return
  }
  if (!canUseBffFixtureData()) {
    throw new Error("PostgreSQL Application credential storage is unavailable.")
  }
  const record = memoryConnectedAppCredentials.find((item) => item.id === id)
  if (record) {
    record.lastUsedAt = lastUsedAt
  }
}

async function updateConnectedAppEnvironmentLastUsed(
  record: ConnectedAppRecord,
  environment: AdminConnectedAppEnvironment,
  lastUsedAt: string,
): Promise<void> {
  const db = getInferenceCoreDb()
  if (db) {
    await db
      .update(applications)
      .set({
        connectionStatus: "connected",
        lastConnectedAt: new Date(lastUsedAt),
      })
      .where(eq(applications.id, record.id))
    return
  }
  if (!canUseBffFixtureData()) {
    throw new Error("PostgreSQL Application storage is unavailable.")
  }
  const stored = memoryConnectedApps.find((item) => item.id === record.id)
  if (stored) {
    stored.environments = stored.environments.map((item) =>
      item.environment === environment ? { ...item, lastUsedAt } : item,
    )
    stored.usage = { ...stored.usage, lastUsedAt }
  }
}

async function loadConnectedAppRecord(
  row: typeof applications.$inferSelect,
): Promise<ConnectedAppRecord> {
  const db = getInferenceCoreDb()
  if (!db) {
    throw new Error("PostgreSQL Application storage is unavailable.")
  }
  const usageCutoff = utcDate(-6)
  const [modelRows, limitRows, credentialRows, usageRows] = await Promise.all([
    db
      .select()
      .from(applicationModelAllowlists)
      .where(eq(applicationModelAllowlists.appId, row.id)),
    db
      .select()
      .from(applicationLimits)
      .where(eq(applicationLimits.appId, row.id))
      .limit(1),
    db
      .select()
      .from(applicationCredentials)
      .where(eq(applicationCredentials.appId, row.id))
      .orderBy(desc(applicationCredentials.issuedAt)),
    db
      .select()
      .from(applicationUsageDaily)
      .where(
        and(
          eq(applicationUsageDaily.appId, row.id),
          gte(applicationUsageDaily.bucketDate, usageCutoff),
        ),
      ),
  ])
  const credential = credentialRows.find((item) => item.status === "active")
  const limit = limitRows[0]
  const usage = adminConnectedAppUsageSummarySchema.parse({
    failures7d: usageRows.reduce((total, item) => total + item.failureCount, 0),
    lastUsedAt:
      credential?.lastUsedAt?.toISOString() ??
      row.lastConnectedAt?.toISOString() ??
      null,
    requests7d: usageRows.reduce((total, item) => total + item.requestCount, 0),
    tokens7d: usageRows.reduce((total, item) => total + item.totalTokens, 0),
  })
  const environment = credential
    ? synthesizedEnvironment(row, credential)
    : null
  return {
    allowedModels: modelRows.map((item) => item.modelAlias),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    description: row.description,
    environments: environment ? [environment] : [],
    id: row.id,
    name: row.name,
    ownerGroup: row.createdBy,
    rateLimitRpm: limit?.requestsPerMinute ?? null,
    status: row.status === "enabled" ? "enabled" : "disabled",
    tokenBudget7d: limit?.tokensPer7d ?? null,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    usage,
  }
}

function synthesizedEnvironment(
  application: typeof applications.$inferSelect,
  credential: typeof applicationCredentials.$inferSelect,
): ConnectedAppEnvironmentRecord {
  const authMethod =
    credential.kind === "oauth_client_credentials"
      ? "oauth_client_credentials"
      : "api_key"
  return {
    authMethods: [authMethod],
    clientId: credential.clientIdentifier,
    credentialIssuedAt: credential.issuedAt.toISOString(),
    credentialRecordId: credential.id,
    environment: "staging",
    keyPrefix: credential.keyPrefix,
    keycloakClientUuid: credential.externalCredentialId,
    lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
    lastTestedAt: application.lastTestedAt?.toISOString() ?? null,
    primaryAuthMethod: authMethod,
    productionReady: false,
    testStatus:
      application.connectionStatus === "connected"
        ? "passed"
        : application.connectionStatus === "degraded"
          ? "stale"
          : "not_tested",
  }
}

function credentialRecordFromRow(
  row: typeof applicationCredentials.$inferSelect,
): ConnectedAppCredentialRecord {
  return {
    appId: row.appId,
    authMethod:
      row.kind === "oauth_client_credentials"
        ? "oauth_client_credentials"
        : "api_key",
    clientId: row.clientIdentifier,
    environment: "staging",
    externalCredentialId: row.externalCredentialId,
    id: row.id,
    issuedAt: row.issuedAt.toISOString(),
    keyHash: row.verifierHash,
    keyPrefix: row.keyPrefix,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    overlapExpiresAt: row.overlapExpiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    rotatedAt: row.rotatedAt?.toISOString() ?? null,
    status:
      row.status === "retiring"
        ? "retiring"
        : row.status === "revoked"
          ? "revoked"
          : "active",
  }
}

function toPublicApp(record: ConnectedAppRecord): AdminConnectedApp {
  return {
    allowedModels: record.allowedModels,
    auditHref: "#audit-log-deferred",
    createdAt: record.createdAt,
    description: record.description,
    detailHref: `/applications/apps/${encodeURIComponent(record.id)}`,
    environments: record.environments.map(publicEnvironment),
    id: record.id,
    name: record.name,
    ownerGroup: record.ownerGroup,
    rateLimitRpm: record.rateLimitRpm,
    status: record.status,
    tokenBudget7d: record.tokenBudget7d,
    updatedAt: record.updatedAt,
    usage: record.usage,
  }
}

function publicEnvironment(
  environment: ConnectedAppEnvironmentRecord,
): AdminConnectedAppEnvironmentState {
  return {
    authMethods: environment.authMethods,
    clientId: environment.clientId,
    credentialIssuedAt: environment.credentialIssuedAt,
    environment: environment.environment,
    keyPrefix: environment.keyPrefix,
    lastUsedAt: environment.lastUsedAt,
    lastTestedAt: environment.lastTestedAt,
    primaryAuthMethod: environment.primaryAuthMethod,
    productionReady: environment.productionReady,
    testStatus: environment.testStatus,
  }
}

function environmentRecord(
  record: ConnectedAppRecord,
  environment: AdminConnectedAppEnvironment,
): ConnectedAppEnvironmentRecord | null {
  return (
    record.environments.find((item) => item.environment === environment) ?? null
  )
}

async function createKeycloakCredential(input: {
  appDescription: string
  appName: string
  clientId: string
  environment: AdminConnectedAppEnvironment
  model: string | null
}): Promise<
  | {
      keycloakClientUuid: string
      credential: AdminConnectedAppCredential
      ok: true
    }
  | { detail: string; ok: false; status: "blocked" }
> {
  if (
    canUseBffFixtureData() &&
    process.env.CONNECTED_APPS_KEYCLOAK_FIXTURE === "true"
  ) {
    const secret = `fixture-${input.clientId}-secret`
    return {
      keycloakClientUuid: `${input.clientId}-uuid`,
      credential: credentialPayload({
        clientId: input.clientId,
        clientSecret: secret,
        environment: input.environment,
        model: input.model,
        tokenUrl: fixtureTokenUrl(),
      }),
      ok: true,
    }
  }

  const keycloak = keycloakAdminClientFromEnv()
  if (keycloak.status !== "ok") {
    return {
      detail:
        "Keycloak Admin API is not configured for connected app credentials.",
      ok: false,
      status: "blocked",
    }
  }

  try {
    const credential = await keycloak.client.createConfidentialClient({
      clientId: input.clientId,
      description: input.appDescription,
      name: `${input.appName} (${input.environment})`,
    })
    return {
      keycloakClientUuid: credential.id,
      credential: credentialPayload({
        clientId: credential.clientId,
        clientSecret: credential.clientSecret,
        environment: input.environment,
        model: input.model,
        tokenUrl: credential.tokenUrl,
      }),
      ok: true,
    }
  } catch (error) {
    return keycloakBlocked(error)
  }
}

async function deleteKeycloakCredential(id: string): Promise<boolean> {
  const keycloak = keycloakAdminClientFromEnv()
  if (keycloak.status !== "ok") {
    return false
  }
  try {
    await keycloak.client.deleteConfidentialClient(id)
    return true
  } catch {
    return false
  }
}

function keycloakBlocked(error: unknown): {
  detail: string
  ok: false
  status: "blocked"
} {
  return {
    detail:
      error instanceof KeycloakAdminError
        ? error.message
        : "Keycloak Admin API request failed.",
    ok: false,
    status: "blocked",
  }
}

function credentialPayload(input: {
  clientId: string
  clientSecret: string
  environment: AdminConnectedAppEnvironment
  model: string | null
  tokenUrl: string
}): AdminConnectedAppCredential {
  const bffBaseUrl = connectedAppBffBaseUrl()
  const openAiBaseUrl = `${bffBaseUrl}/api/app-gateway/v1`
  return {
    authMethod: "oauth_client_credentials",
    bffBaseUrl,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    environment: input.environment,
    exampleCurl: `curl -H "Authorization: Bearer <token>" ${openAiBaseUrl}/models`,
    keyPrefix: null,
    model: input.model,
    openAiBaseUrl,
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
    environment: "staging",
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
  environment: AdminConnectedAppEnvironment,
  issuedAt: string,
  model: string | null,
): {
  credential: AdminConnectedAppCredential
  record: ConnectedAppCredentialRecord
} {
  const apiKey = generateStaticApiKey()
  const keyPrefix = staticApiKeyPrefix(apiKey) ?? apiKey.slice(0, 18)
  return {
    credential: apiKeyCredentialPayload({
      apiKey,
      environment,
      keyPrefix,
      model,
    }),
    record: {
      appId,
      authMethod: "api_key",
      clientId: null,
      environment,
      externalCredentialId: null,
      id: `cak-${randomUUID()}`,
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
  environment: AdminConnectedAppEnvironment
  keyPrefix: string
  model: string | null
}): AdminConnectedAppCredential {
  const bffBaseUrl = connectedAppBffBaseUrl()
  const openAiBaseUrl = `${bffBaseUrl}/api/app-gateway/v1`
  return {
    apiKey: input.apiKey,
    authMethod: "api_key",
    bffBaseUrl,
    environment: input.environment,
    exampleCurl: `curl -H "Authorization: Bearer ${input.apiKey}" ${openAiBaseUrl}/models`,
    keyPrefix: input.keyPrefix,
    model: input.model,
    openAiBaseUrl,
  }
}

function generateStaticApiKey(): string {
  const prefix = randomBytes(9).toString("hex")
  const secret = randomBytes(32).toString("base64url")
  return `llmm_t4_${prefix}_${secret}`
}

function staticApiKeyPrefix(apiKey: string): string | null {
  const parts = apiKey.split("_")
  if (parts.length < 4 || parts[0] !== "llmm" || parts[1] !== "t4") {
    return null
  }
  return parts.slice(0, 3).join("_")
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

function uniqueConnectedAppId(name: string): string {
  return `app-${slugify(name)}-${randomUUID().slice(0, 8)}`
}

function connectedAppClientId(
  id: string,
  environment: AdminConnectedAppEnvironment,
): string {
  return `llmm-${id}-${environment}`
}

function connectedAppBffBaseUrl(): string {
  return (
    process.env.CONNECTED_APPS_BFF_BASE_URL ??
    process.env.PUBLIC_BFF_BASE_URL ??
    "http://localhost:4001"
  ).replace(/\/+$/, "")
}

function fixtureTokenUrl(): string {
  return (
    process.env.CONNECTED_APPS_TOKEN_URL ??
    "https://keycloak.example.test/realms/llm-machines/protocol/openid-connect/token"
  )
}

function normalizeList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function emptyUsage(): AdminConnectedAppUsageSummary {
  return {
    failures7d: 0,
    lastUsedAt: null,
    requests7d: 0,
    tokens7d: 0,
  }
}

function connectionStatus(
  environment: ConnectedAppEnvironmentRecord | null,
): "connected" | "degraded" | "not_connected" {
  if (environment?.lastUsedAt || environment?.testStatus === "passed") {
    return "connected"
  }
  return environment?.testStatus === "stale" ? "degraded" : "not_connected"
}

function rateLimitExceeded(): {
  detail: string
  ok: false
  status: 429
  title: string
} {
  return {
    detail: "The connected app has reached its requests-per-minute limit.",
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

function tokenBudgetNotQualified(): {
  detail: string
  ok: false
  status: 503
  title: string
} {
  return {
    detail:
      "Seven-day token-budget enforcement is unavailable until total-token admission and streaming reconciliation are qualified.",
    ok: false,
    status: 503,
    title: "Token budget enforcement not qualified",
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

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "connected-app"
  )
}
