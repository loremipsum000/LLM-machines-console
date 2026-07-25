import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { desc, eq, sql } from "drizzle-orm"
import Redis from "ioredis"
import type {
  AdminConnectedApp,
  AdminConnectedAppAuthMethod,
  AdminConnectedAppCreateRequest,
  AdminConnectedAppCreateResponse,
  AdminConnectedAppCredential,
  AdminConnectedAppDetail,
  AdminConnectedAppEnvironment,
  AdminConnectedAppEnvironmentState,
  AdminConnectedAppsResponse,
  AdminConnectedAppPromotionResult,
  AdminConnectedAppRotateCredentialResult,
  AdminConnectedAppTestResult,
  AdminConnectedAppUpdateRequest,
  AdminConnectedAppUsageSummary,
} from "@llm-machines/contracts"
import {
  adminConnectedAppEnvironmentStateSchema,
  adminConnectedAppUsageSummarySchema,
} from "@llm-machines/contracts"
import type { Actor } from "../auth/persona"
import { canUseBffFixtureData } from "../config/fixture-mode"
import { getDb } from "../db/client"
import { connectedAppApiKeys, connectedApps } from "../db/schema"
import { emitAudit } from "./audit"
import {
  KeycloakAdminError,
  keycloakAdminClientFromEnv,
} from "./team-keycloak-admin"
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
  keycloakClientUuid: string | null
}

interface ConnectedAppApiKeyRecord {
  appId: string
  environment: AdminConnectedAppEnvironment
  id: string
  issuedAt: string
  keyHash: string
  keyPrefix: string
  lastUsedAt: string | null
  revokedAt: string | null
  rotatedAt: string | null
  status: "active" | "revoked"
}

export interface ConnectedAppRuntimeIdentity {
  allowedModels: string[]
  appId: string
  appName: string
  authMethod: AdminConnectedAppAuthMethod
  clientId: string
  environment: AdminConnectedAppEnvironment
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

export interface ConnectedAppGatewayReservation {
  appId: string
  environment: AdminConnectedAppEnvironment
  reservedTokens: number
}

const memoryConnectedApps: ConnectedAppRecord[] = []
const memoryConnectedAppApiKeys: ConnectedAppApiKeyRecord[] = []
const memoryRateLimitWindows = new Map<
  string,
  { count: number; startedAt: number }
>()
let redisRateLimitClient: Redis | null = null

export async function getAdminConnectedApps(
  actor: Actor,
): Promise<AdminConnectedAppsResponse> {
  const apps = (await getConnectedAppRecords()).map(toPublicApp)
  await emitAudit({
    actorId: actor.subject,
    action: "admin.connected_app.read",
    targetType: "connected_app",
    targetId: "list",
    metadata: { count: apps.length },
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
    actorId: actor.subject,
    action: "admin.connected_app.read",
    targetType: "connected_app",
    targetId: id,
    metadata: {},
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

  const record: ConnectedAppRecord = {
    allowedModels: normalizeList(request.allowedModels),
    createdAt: now,
    createdBy: actor.subject,
    description: request.description,
    environments: [
      {
        authMethods: [authMethod],
        clientId: authMethod === "oauth_client_credentials" ? oauthClientId : null,
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

  const saved = await saveConnectedAppRecord(actor, record)
  if (apiKey) {
    await saveConnectedAppApiKeyRecord(apiKey.record)
  }
  await emitAudit({
    actorId: actor.subject,
    action: "admin.connected_app.created",
    targetType: "connected_app",
    targetId: saved.id,
    metadata: {
      authMethod,
      environment: "staging",
      ownerGroup: saved.ownerGroup,
    },
  })
  const credential = apiKey?.credential ?? (oauth?.ok ? oauth.credential : null)
  if (!credential) {
    return {
      detail: "Connected app credential could not be created.",
      status: "blocked",
    }
  }
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
    actorId: actor.subject,
    action: "admin.connected_app.updated",
    targetType: "connected_app",
    targetId: saved.id,
    metadata: {},
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
  await emitAudit({
    actorId: actor.subject,
    action: "admin.connected_app.tested",
    targetType: "connected_app",
    targetId: id,
    metadata: { environment: "staging", status: "passed" },
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
  actor: Actor,
  id: string,
): Promise<ConnectedAppCredentialMutationResult> {
  const existing = await getConnectedAppRecord(id)
  if (!existing) {
    return { status: "not_found" }
  }
  const staging = environmentRecord(existing, "staging")
  if (!staging?.productionReady) {
    return {
      app: toPublicApp(existing),
      detail:
        "Run a successful staging connection test before creating production credentials.",
      status: "blocked",
    }
  }

  const now = new Date().toISOString()
  const authMethod = staging.primaryAuthMethod
  const apiKey =
    authMethod === "api_key"
      ? createStaticApiKeyRecord(
          existing.id,
          "production",
          now,
          existing.allowedModels[0] ?? null,
        )
      : null
  const clientId = connectedAppClientId(id, "production")
  const created =
    authMethod === "oauth_client_credentials"
      ? await createKeycloakCredential({
          appDescription: existing.description,
          appName: existing.name,
          clientId,
          environment: "production",
          model: existing.allowedModels[0] ?? null,
        })
      : null
  if (created && !created.ok) {
    return created
  }
  const production: ConnectedAppEnvironmentRecord = {
    authMethods: [authMethod],
    clientId: authMethod === "oauth_client_credentials" ? clientId : null,
    credentialIssuedAt: now,
    environment: "production",
    keyPrefix: apiKey?.record.keyPrefix ?? null,
    keycloakClientUuid: created?.ok ? created.keycloakClientUuid : null,
    lastUsedAt: null,
    lastTestedAt: now,
    primaryAuthMethod: authMethod,
    productionReady: true,
    testStatus: "passed",
  }
  const saved = await updateConnectedAppRecord(actor, {
    ...existing,
    environments: [
      ...existing.environments.filter(
        (item) => item.environment !== "production",
      ),
      production,
    ],
    updatedAt: now,
    updatedBy: actor.subject,
  })
  if (apiKey) {
    await saveConnectedAppApiKeyRecord(apiKey.record)
  }
  await emitAudit({
    actorId: actor.subject,
    action: "admin.connected_app.promoted",
    targetType: "connected_app",
    targetId: id,
    metadata: { authMethod, environment: "production" },
  })
  const credential = apiKey?.credential ?? (created?.ok ? created.credential : null)
  if (!credential) {
    return {
      detail: "Production credentials could not be created.",
      status: "blocked",
    }
  }
  return {
    app: toPublicApp(saved),
    credential,
    detail: "Production credentials created.",
    status: "promoted",
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
  const now = new Date().toISOString()
  const apiKey =
    environment.primaryAuthMethod === "api_key"
      ? createStaticApiKeyRecord(
          existing.id,
          "staging",
          now,
          existing.allowedModels[0] ?? null,
        )
      : null
  const rotated =
    environment.primaryAuthMethod === "oauth_client_credentials"
      ? await rotateKeycloakCredential(environment, existing.allowedModels[0] ?? null)
      : null
  if (rotated && !rotated.ok) {
    return rotated
  }
  if (apiKey) {
    await revokeActiveApiKeys(existing.id, "staging", now)
    await saveConnectedAppApiKeyRecord(apiKey.record)
  }
  const saved = await updateConnectedAppRecord(actor, {
    ...existing,
    environments: existing.environments.map((item) =>
      item.environment === "staging"
        ? {
            ...item,
            keyPrefix: apiKey?.record.keyPrefix ?? item.keyPrefix,
            credentialIssuedAt: now,
            lastTestedAt: null,
            productionReady: false,
            testStatus: "not_tested",
          }
        : item,
    ),
    updatedAt: now,
    updatedBy: actor.subject,
  })
  await emitAudit({
    actorId: actor.subject,
    action: "admin.connected_app.credentials_rotated",
    targetType: "connected_app",
    targetId: id,
    metadata: { authMethod: environment.primaryAuthMethod, environment: "staging" },
  })
  const credential =
    apiKey?.credential ?? (rotated?.ok ? rotated.credential : null)
  if (!credential) {
    return {
      detail: "Staging credentials could not be rotated.",
      status: "blocked",
    }
  }
  return {
    app: toPublicApp(saved),
    credential,
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
    actorId: actor.subject,
    action: "admin.connected_app.disabled",
    targetType: "connected_app",
    targetId: id,
    metadata: {},
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
    return {
      allowedModels: record.allowedModels,
      appId: record.id,
      appName: record.name,
      authMethod: "oauth_client_credentials",
      clientId,
      environment: environment.environment,
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
  const keys = await getConnectedAppApiKeyRecordsByPrefix(keyPrefix)
  const matched = keys.find(
    (key) =>
      key.status === "active" &&
      key.revokedAt === null &&
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
  await updateConnectedAppEnvironmentLastUsed(record, matched.environment, usedAt)
  return {
    allowedModels: record.allowedModels,
    appId: record.id,
    appName: record.name,
    authMethod: "api_key",
    clientId: matched.keyPrefix,
    environment: matched.environment,
    rateLimitRpm: record.rateLimitRpm,
    status: record.status,
    tokenBudget7d: record.tokenBudget7d,
    usage: record.usage,
  }
}

export async function recordConnectedAppGatewayUsage(
  appId: string,
  input: ConnectedAppGatewayUsageInput,
): Promise<void> {
  await reconcileConnectedAppGatewayUsage(appId, input, {
    appId,
    environment: input.environment,
    reservedTokens: 0,
  })
}

export async function consumeConnectedAppGatewayRateLimit(
  app: ConnectedAppRuntimeIdentity,
): Promise<
  | { ok: true }
  | { detail: string; ok: false; status: 429 | 503; title: string }
> {
  if (app.rateLimitRpm === null) {
    return { ok: true }
  }
  const redis = getRedisRateLimitClient()
  const key = connectedAppRateLimitKey(app)
  if (redis) {
    await redis.connect().catch(() => undefined)
    const count = await redis.incr(key)
    if (count === 1) {
      await redis.pexpire(key, 60_000)
    }
    return count <= app.rateLimitRpm
      ? { ok: true }
      : {
          detail: "The connected app has reached its request limit for this minute.",
          ok: false,
          status: 429,
          title: "Rate limit exceeded",
        }
  }

  if (!canUseBffFixtureData()) {
    return {
      detail:
        "Redis coordination is required before enforcing connected app rate limits.",
      ok: false,
      status: 503,
      title: "Rate limit backend unavailable",
    }
  }

  const now = Date.now()
  const existing = memoryRateLimitWindows.get(key)
  if (!existing || now - existing.startedAt >= 60_000) {
    memoryRateLimitWindows.set(key, { count: 1, startedAt: now })
    return { ok: true }
  }
  if (existing.count >= app.rateLimitRpm) {
    return {
      detail: "The connected app has reached its request limit for this minute.",
      ok: false,
      status: 429,
      title: "Rate limit exceeded",
    }
  }
  existing.count += 1
  return { ok: true }
}

export async function reserveConnectedAppGatewayTokens(
  app: ConnectedAppRuntimeIdentity,
  requestedTokens: number,
): Promise<
  | { ok: true; reservation: ConnectedAppGatewayReservation }
  | { detail: string; ok: false; status: 429; title: string }
> {
  if (app.tokenBudget7d === null) {
    return {
      ok: true,
      reservation: {
        appId: app.appId,
        environment: app.environment,
        reservedTokens: 0,
      },
    }
  }

  const reservedTokens = Math.max(1, Math.floor(requestedTokens))
  const db = getDb()
  if (db) {
    const actor = await upsertActorUser(gatewayActor())
    const now = new Date().toISOString()
    const rows = await db.execute(sql<{ usage_summary: unknown }>`
      UPDATE admin.connected_apps
      SET
        usage_summary = jsonb_set(
          usage_summary,
          '{tokens7d}',
          to_jsonb((
            COALESCE((usage_summary->>'tokens7d')::integer, 0)
            + ${reservedTokens}
          )::integer),
          true
        ),
        updated_at = ${now}::timestamptz,
        updated_by = ${actor.subject}
      WHERE id = ${app.appId}
        AND status = 'enabled'
        AND (
          token_budget_7d IS NULL
          OR COALESCE((usage_summary->>'tokens7d')::integer, 0)
            + ${reservedTokens} <= token_budget_7d
        )
      RETURNING usage_summary
    `)
    if (Array.isArray(rows) && rows.length > 0) {
      return {
        ok: true,
        reservation: {
          appId: app.appId,
          environment: app.environment,
          reservedTokens,
        },
      }
    }
    return tokenBudgetExceeded()
  }

  const record = memoryConnectedApps.find((item) => item.id === app.appId)
  if (!record || record.status !== "enabled") {
    return tokenBudgetExceeded()
  }
  if (record.usage.tokens7d + reservedTokens > app.tokenBudget7d) {
    return tokenBudgetExceeded()
  }
  const now = new Date().toISOString()
  record.usage = {
    ...record.usage,
    tokens7d: record.usage.tokens7d + reservedTokens,
  }
  record.updatedAt = now
  record.updatedBy = "connected-app-gateway"
  return {
    ok: true,
    reservation: {
      appId: app.appId,
      environment: app.environment,
      reservedTokens,
    },
  }
}

export async function reconcileConnectedAppGatewayUsage(
  appId: string,
  input: ConnectedAppGatewayUsageInput,
  reservation: ConnectedAppGatewayReservation,
): Promise<void> {
  const tokens = Math.max(0, Math.floor(input.tokens))
  const tokenDelta = tokens - Math.max(0, reservation.reservedTokens)
  const now = new Date().toISOString()
  const db = getDb()
  if (db) {
    const actor = await upsertActorUser(gatewayActor())
    await db.execute(sql`
      UPDATE admin.connected_apps
      SET
        usage_summary = jsonb_build_object(
          'failures7d',
            COALESCE((usage_summary->>'failures7d')::integer, 0)
            + ${input.status >= 400 ? 1 : 0},
          'lastUsedAt', ${now}::text,
          'requests7d',
            COALESCE((usage_summary->>'requests7d')::integer, 0) + 1,
          'tokens7d',
            GREATEST(
              0,
              COALESCE((usage_summary->>'tokens7d')::integer, 0)
              + ${tokenDelta}
            )
        ),
        updated_at = ${now}::timestamptz,
        updated_by = ${actor.subject}
      WHERE id = ${appId}
    `)
    return
  }

  const record = memoryConnectedApps.find((item) => item.id === appId)
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
    tokens7d: Math.max(0, record.usage.tokens7d + tokenDelta),
  }
}

export async function resetConnectedAppsForTest(): Promise<void> {
  memoryConnectedApps.splice(0)
  memoryConnectedAppApiKeys.splice(0)
  memoryRateLimitWindows.clear()
  redisRateLimitClient?.disconnect()
  redisRateLimitClient = null
}

async function getConnectedAppRecords(): Promise<ConnectedAppRecord[]> {
  const db = getDb()
  if (db) {
    const rows = await db
      .select()
      .from(connectedApps)
      .orderBy(desc(connectedApps.updatedAt))
    return rows.map(connectedAppRecordFromRow)
  }
  return memoryConnectedApps.map(cloneRecord)
}

async function saveConnectedAppRecord(
  actor: Actor,
  record: ConnectedAppRecord,
): Promise<ConnectedAppRecord> {
  const db = getDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    await db.insert(connectedApps).values({
      allowedModels: record.allowedModels,
      createdAt: new Date(record.createdAt),
      createdBy: storageActor.subject,
      description: record.description,
      displayName: record.name,
      environments: record.environments,
      id: record.id,
      ownerGroup: record.ownerGroup,
      rateLimitRpm: record.rateLimitRpm,
      status: record.status,
      tokenBudget7d: record.tokenBudget7d,
      updatedAt: new Date(record.updatedAt),
      updatedBy: storageActor.subject,
      usageSummary: record.usage,
    })
    return { ...record, createdBy: storageActor.subject, updatedBy: storageActor.subject }
  }
  memoryConnectedApps.unshift(cloneRecord(record))
  return cloneRecord(record)
}

async function updateConnectedAppRecord(
  actor: Actor,
  record: ConnectedAppRecord,
): Promise<ConnectedAppRecord> {
  const db = getDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    await db
      .update(connectedApps)
      .set({
        allowedModels: record.allowedModels,
        description: record.description,
        displayName: record.name,
        environments: record.environments,
        ownerGroup: record.ownerGroup,
        rateLimitRpm: record.rateLimitRpm,
        status: record.status,
        tokenBudget7d: record.tokenBudget7d,
        updatedAt: new Date(record.updatedAt),
        updatedBy: storageActor.subject,
        usageSummary: record.usage,
      })
      .where(eq(connectedApps.id, record.id))
    return { ...record, updatedBy: storageActor.subject }
  }
  const index = memoryConnectedApps.findIndex((item) => item.id === record.id)
  if (index >= 0) {
    memoryConnectedApps[index] = cloneRecord(record)
  }
  return cloneRecord(record)
}

async function saveConnectedAppApiKeyRecord(
  record: ConnectedAppApiKeyRecord,
): Promise<void> {
  const db = getDb()
  if (db) {
    await db.insert(connectedAppApiKeys).values({
      appId: record.appId,
      environment: record.environment,
      id: record.id,
      issuedAt: new Date(record.issuedAt),
      keyHash: record.keyHash,
      keyPrefix: record.keyPrefix,
      lastUsedAt: record.lastUsedAt ? new Date(record.lastUsedAt) : null,
      revokedAt: record.revokedAt ? new Date(record.revokedAt) : null,
      rotatedAt: record.rotatedAt ? new Date(record.rotatedAt) : null,
      status: record.status,
    })
    return
  }
  memoryConnectedAppApiKeys.unshift(cloneApiKeyRecord(record))
}

async function getConnectedAppApiKeyRecordsByPrefix(
  keyPrefix: string,
): Promise<ConnectedAppApiKeyRecord[]> {
  const db = getDb()
  if (db) {
    const rows = await db
      .select()
      .from(connectedAppApiKeys)
      .where(eq(connectedAppApiKeys.keyPrefix, keyPrefix))
    return rows.map(apiKeyRecordFromRow)
  }
  return memoryConnectedAppApiKeys
    .filter((record) => record.keyPrefix === keyPrefix)
    .map(cloneApiKeyRecord)
}

async function revokeActiveApiKeys(
  appId: string,
  environment: AdminConnectedAppEnvironment,
  revokedAt: string,
): Promise<void> {
  const db = getDb()
  if (db) {
    const rows = await db
      .select()
      .from(connectedAppApiKeys)
      .where(eq(connectedAppApiKeys.appId, appId))
    for (const row of rows) {
      if (row.environment !== environment || row.status !== "active") {
        continue
      }
      await db
        .update(connectedAppApiKeys)
        .set({
          revokedAt: new Date(revokedAt),
          rotatedAt: new Date(revokedAt),
          status: "revoked",
        })
        .where(eq(connectedAppApiKeys.id, row.id))
    }
    return
  }
  for (const record of memoryConnectedAppApiKeys) {
    if (
      record.appId === appId &&
      record.environment === environment &&
      record.status === "active"
    ) {
      record.revokedAt = revokedAt
      record.rotatedAt = revokedAt
      record.status = "revoked"
    }
  }
}

async function markApiKeyLastUsed(id: string, lastUsedAt: string): Promise<void> {
  const db = getDb()
  if (db) {
    await db
      .update(connectedAppApiKeys)
      .set({ lastUsedAt: new Date(lastUsedAt) })
      .where(eq(connectedAppApiKeys.id, id))
    return
  }
  const record = memoryConnectedAppApiKeys.find((item) => item.id === id)
  if (record) {
    record.lastUsedAt = lastUsedAt
  }
}

async function updateConnectedAppEnvironmentLastUsed(
  record: ConnectedAppRecord,
  environment: AdminConnectedAppEnvironment,
  lastUsedAt: string,
): Promise<void> {
  await updateConnectedAppRecord(
    {
      authMode: "service-forwarded",
      persona: "admin",
      roles: ["admin"],
      subject: "connected-app-gateway",
    },
    {
      ...record,
      environments: record.environments.map((item) =>
        item.environment === environment ? { ...item, lastUsedAt } : item,
      ),
      updatedAt: lastUsedAt,
      updatedBy: "connected-app-gateway",
    },
  )
}

function connectedAppRecordFromRow(row: typeof connectedApps.$inferSelect): ConnectedAppRecord {
  return {
    allowedModels: stringArray(row.allowedModels),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    description: row.description,
    environments: environmentRecords(row.environments),
    id: row.id,
    name: row.displayName,
    ownerGroup: row.ownerGroup,
    rateLimitRpm: row.rateLimitRpm,
    status: row.status === "disabled" ? "disabled" : "enabled",
    tokenBudget7d: row.tokenBudget7d,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    usage: adminConnectedAppUsageSummarySchema.parse(row.usageSummary),
  }
}

function apiKeyRecordFromRow(
  row: typeof connectedAppApiKeys.$inferSelect,
): ConnectedAppApiKeyRecord {
  return {
    appId: row.appId,
    environment:
      row.environment === "production" ? "production" : "staging",
    id: row.id,
    issuedAt: row.issuedAt.toISOString(),
    keyHash: row.keyHash,
    keyPrefix: row.keyPrefix,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    rotatedAt: row.rotatedAt?.toISOString() ?? null,
    status: row.status === "revoked" ? "revoked" : "active",
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
  return record.environments.find((item) => item.environment === environment) ?? null
}

async function createKeycloakCredential(input: {
  appDescription: string
  appName: string
  clientId: string
  environment: AdminConnectedAppEnvironment
  model: string | null
}): Promise<
  | { keycloakClientUuid: string; credential: AdminConnectedAppCredential; ok: true }
  | { detail: string; ok: false; status: "blocked" }
> {
  if (canUseBffFixtureData() && process.env.CONNECTED_APPS_KEYCLOAK_FIXTURE === "true") {
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
      detail: "Keycloak Admin API is not configured for connected app credentials.",
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

async function rotateKeycloakCredential(
  environment: ConnectedAppEnvironmentRecord,
  model: string | null,
): Promise<
  | { credential: AdminConnectedAppCredential; ok: true }
  | { detail: string; ok: false; status: "blocked" }
> {
  if (canUseBffFixtureData() && process.env.CONNECTED_APPS_KEYCLOAK_FIXTURE === "true") {
    return {
      credential: credentialPayload({
        clientId: environment.clientId ?? "fixture-client",
        clientSecret: `rotated-${environment.clientId}-secret`,
        environment: environment.environment,
        model,
        tokenUrl: fixtureTokenUrl(),
      }),
      ok: true,
    }
  }
  const keycloak = keycloakAdminClientFromEnv()
  if (keycloak.status !== "ok") {
    return {
      detail: "Keycloak Admin API is not configured for connected app credentials.",
      ok: false,
      status: "blocked",
    }
  }
  try {
    const credential = await keycloak.client.rotateConfidentialClientSecret(
      environment.keycloakClientUuid ?? "",
      environment.clientId ?? "",
    )
    return {
      credential: credentialPayload({
        clientId: credential.clientId,
        clientSecret: credential.clientSecret,
        environment: environment.environment,
        model,
        tokenUrl: credential.tokenUrl,
      }),
      ok: true,
    }
  } catch (error) {
    return keycloakBlocked(error)
  }
}

function keycloakBlocked(error: unknown): { detail: string; ok: false; status: "blocked" } {
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

function createStaticApiKeyRecord(
  appId: string,
  environment: AdminConnectedAppEnvironment,
  issuedAt: string,
  model: string | null,
): { credential: AdminConnectedAppCredential; record: ConnectedAppApiKeyRecord } {
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
      environment,
      id: `cak-${randomUUID()}`,
      issuedAt,
      keyHash: staticApiKeyHash(apiKey),
      keyPrefix,
      lastUsedAt: null,
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function environmentRecords(value: unknown): ConnectedAppEnvironmentRecord[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((item) => ({
    ...adminConnectedAppEnvironmentStateSchema.parse(item),
    keycloakClientUuid:
      typeof item === "object" &&
      item !== null &&
      typeof (item as { keycloakClientUuid?: unknown }).keycloakClientUuid === "string"
        ? (item as { keycloakClientUuid: string }).keycloakClientUuid
        : null,
  }))
}

function emptyUsage(): AdminConnectedAppUsageSummary {
  return {
    failures7d: 0,
    lastUsedAt: null,
    requests7d: 0,
    tokens7d: 0,
  }
}

function getRedisRateLimitClient(): Redis | null {
  const redisUrl = process.env.REDIS_URL?.trim()
  if (!redisUrl) {
    return null
  }
  redisRateLimitClient ??= new Redis(redisUrl, {
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  })
  return redisRateLimitClient
}

function connectedAppRateLimitKey(app: ConnectedAppRuntimeIdentity): string {
  return `connected-app:${app.appId}:${app.environment}:rpm:${minuteWindow()}`
}

function minuteWindow(): number {
  return Math.floor(Date.now() / 60_000)
}

function tokenBudgetExceeded(): {
  detail: string
  ok: false
  status: 429
  title: string
} {
  return {
    detail: "The connected app has reached its 7-day token budget.",
    ok: false,
    status: 429,
    title: "Token budget exceeded",
  }
}

function gatewayActor(): Actor {
  return {
    authMode: "service-forwarded",
    persona: "admin",
    roles: ["admin"],
    subject: "connected-app-gateway",
  }
}

function cloneRecord(record: ConnectedAppRecord): ConnectedAppRecord {
  return JSON.parse(JSON.stringify(record)) as ConnectedAppRecord
}

function cloneApiKeyRecord(
  record: ConnectedAppApiKeyRecord,
): ConnectedAppApiKeyRecord {
  return JSON.parse(JSON.stringify(record)) as ConnectedAppApiKeyRecord
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
