import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"
import type {
  AdminConnectedAppConnectionStatus,
  AdminConnectedAppFirecrawl,
  AdminConnectedAppFirecrawlCredential,
  AdminConnectedAppFirecrawlEnableRequest,
  FirecrawlScope,
} from "@llm-machines/contracts/inference-core"
import {
  adminConnectedAppFirecrawlEnableRequestSchema,
  adminConnectedAppFirecrawlSchema,
} from "@llm-machines/contracts/inference-core"
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm"
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
  applicationFirecrawlAccess,
  applicationFirecrawlCredentials,
  applicationFirecrawlRequestLedger,
  applicationFirecrawlUsageDaily,
  applications,
  auditEvents,
} from "../db/inference-core-schema"
import { emitAudit } from "./audit"
import { parseFirecrawlEgressAllowedHosts } from "./firecrawl-url-safety"
import type { IdentityMutationRouteContext } from "./identity-mutation-journal"
import { upsertActorUser } from "./users"

export const FIRECRAWL_DISCLAIMER_VERSION = "firecrawl-outbound-v1"

// The longest gateway route is 50 seconds; ten seconds bounds cleanup drift.
const FIRECRAWL_REQUEST_LEASE_SECONDS = 60
const FIRECRAWL_SCOPES = [
  "firecrawl.search",
  "firecrawl.scrape",
] as const satisfies readonly FirecrawlScope[]

export type ConnectedAppFirecrawlOperation = "scrape" | "search"

export interface ConnectedAppFirecrawlRuntimeIdentity {
  applicationId: string
  credentialRecordId: string
  scopes: readonly FirecrawlScope[]
}

export type ConnectedAppFirecrawlCredentialResolution =
  | { identity: ConnectedAppFirecrawlRuntimeIdentity; ok: true }
  | { ok: false; reason: "disabled" | "invalid" | "unavailable" }

export type ConnectedAppFirecrawlAdmissionResult =
  | { admissionId: string; ok: true }
  | {
      ok: false
      reason: "concurrency_limited" | "rate_limited" | "unavailable"
      retryAfterSeconds?: number
    }

export interface ConnectedAppFirecrawlSettlementInput {
  admissionId: string | null
  applicationId: string
  correlationId: string
  credentialRecordId: string
  latencyMs: number
  operation: ConnectedAppFirecrawlOperation
  outcome: "attempted" | "blocked" | "cancelled" | "failed" | "succeeded"
  requestBytes: number
  responseBytes: number
  resultCount: number
  status: number
}

export type ConnectedAppFirecrawlMetadataInput = Omit<
  ConnectedAppFirecrawlSettlementInput,
  "admissionId"
>

export type AdminConnectedAppFirecrawlCredentialMutationResult =
  | {
      credential: AdminConnectedAppFirecrawlCredential | null
      detail: string
      firecrawl: AdminConnectedAppFirecrawl
      status: "enabled"
    }
  | { detail: string; status: "blocked" }
  | { status: "not_found" }

type AdminConnectedAppFirecrawlCredentialMutationSuccess = Extract<
  AdminConnectedAppFirecrawlCredentialMutationResult,
  { status: "enabled" }
>

type AdminConnectedAppFirecrawlCredentialCommitRace = Extract<
  AdminConnectedAppFirecrawlCredentialMutationResult,
  { status: "blocked" | "not_found" }
>

export class AdminConnectedAppFirecrawlCredentialCommitRaceError extends Error {
  readonly failure: AdminConnectedAppFirecrawlCredentialCommitRace

  constructor(result: AdminConnectedAppFirecrawlCredentialCommitRace) {
    super(
      result.status === "blocked"
        ? result.detail
        : "Key was not found during the Firecrawl credential commit.",
    )
    this.name = "AdminConnectedAppFirecrawlCredentialCommitRaceError"
    this.failure = result
  }
}

export type AdminConnectedAppFirecrawlCredentialRevealFinalizer<T> = (
  result: AdminConnectedAppFirecrawlCredentialMutationSuccess,
  transaction: InferenceCoreTransaction | null,
) => Promise<T>

export type AdminConnectedAppFirecrawlLifecycleMutationResult =
  | {
      detail: string
      firecrawl: AdminConnectedAppFirecrawl
      status: "disabled" | "revoked" | "updated"
    }
  | { detail: string; status: "blocked" }
  | { status: "not_found" }

export type AdminConnectedAppFirecrawlPassiveTestResult =
  | {
      connectionStatus: AdminConnectedAppConnectionStatus
      detail: string
      firecrawl: AdminConnectedAppFirecrawl
      observedAt: string | null
      status: "degraded" | "passed" | "waiting"
    }
  | { status: "not_found" }

export type AdminConnectedAppFirecrawlReadinessPreflight =
  | {
      egressAllowedHosts: ReadonlySet<string>
      publicBaseUrl: string
      status: "ready"
      upstreamBaseUrl: string
    }
  | { detail: string; status: "blocked" }

export type AdminConnectedAppFirecrawlCredentialPreflight =
  | {
      createsCredential: boolean
      publicBaseUrl: string
      status: "ready"
    }
  | { detail: string; status: "blocked" }
  | { status: "not_found" }

interface FirecrawlAccessRecord {
  appId: string
  connectionStatus: AdminConnectedAppConnectionStatus
  disclaimerAcceptedAt: string | null
  disclaimerAcceptedBy: string | null
  disclaimerVersion: string | null
  lastConnectedAt: string | null
  maxConcurrentScrapes: number | null
  scrapeRateLimitRps: number | null
  searchRateLimitRps: number | null
  status: "disabled" | "enabled"
  updatedAt: string
  updatedBy: string
}

interface FirecrawlCredentialRecord {
  appId: string
  id: string
  issuedAt: string
  keyPrefix: string
  lastUsedAt: string | null
  overlapExpiresAt: string | null
  revokedAt: string | null
  rotatedAt: string | null
  status: "active" | "retiring" | "revoked"
  verifierHash: string
}

interface FixtureAdmission {
  appId: string
  credentialId: string
  leaseExpiresAt: number
  operation: ConnectedAppFirecrawlOperation
  settled: boolean
  startedAt: number
}

const memoryParentStatuses = new Map<
  string,
  "deleted" | "disabled" | "enabled"
>()
const memoryAccess = new Map<string, FirecrawlAccessRecord>()
const memoryCredentials: FirecrawlCredentialRecord[] = []
const memoryRateWindows = new Map<
  string,
  { count: number; windowStartedAt: number }
>()
const memoryAdmissions = new Map<string, FixtureAdmission>()

export function preflightAdminConnectedAppFirecrawlReadiness(
  env: NodeJS.ProcessEnv = process.env,
): AdminConnectedAppFirecrawlReadinessPreflight {
  if (environmentBoolean(env.FIRECRAWL_INSTALLED) !== true) {
    return blocked("Firecrawl is not installed on this appliance.")
  }
  if (environmentBoolean(env.FIRECRAWL_APPLIANCE_KILL_SWITCH) !== false) {
    return blocked(
      "Firecrawl cannot be enabled while the appliance kill switch is active or invalid.",
    )
  }
  if (environmentBoolean(env.FIRECRAWL_RESOURCE_PROFILE_QUALIFIED) !== true) {
    return blocked("The Firecrawl appliance resource profile is not qualified.")
  }
  if (environmentBoolean(env.FIRECRAWL_EGRESS_POLICY_READY) !== true) {
    return blocked("The Firecrawl appliance egress policy is not ready.")
  }
  const egressAllowedHosts = parseFirecrawlEgressAllowedHosts(
    env.FIRECRAWL_EGRESS_ALLOWED_HOSTS,
  )
  if (!egressAllowedHosts) {
    return blocked("The Firecrawl exact-host egress allowlist is invalid.")
  }
  if (
    !/^\/run\/llm-machines\/firecrawl\/[a-z0-9][a-z0-9-]*$/.test(
      env.FIRECRAWL_EGRESS_ALLOWLIST_DIR?.trim() ?? "",
    )
  ) {
    return blocked(
      "The volatile Firecrawl egress allowlist directory is invalid.",
    )
  }
  const publicBaseUrl = normalizeFirecrawlBaseUrl(
    env.FIRECRAWL_PUBLIC_BASE_URL,
    isProductionRuntime(env),
    true,
  )
  if (!publicBaseUrl) {
    return blocked("The Firecrawl public base URL is missing or invalid.")
  }
  if (isProductionRuntime(env)) {
    const firecrawlHost = env.PRODUCT_FIRECRAWL_HOST?.trim()
    if (
      !firecrawlHost ||
      !isPublicProductHostname(firecrawlHost) ||
      new URL(publicBaseUrl).hostname !== firecrawlHost
    ) {
      return blocked(
        "The Firecrawl public base URL does not match the Product Firecrawl authority.",
      )
    }
  }
  const upstreamBaseUrl = normalizeFirecrawlBaseUrl(
    env.FIRECRAWL_UPSTREAM_BASE_URL,
    false,
    true,
    true,
  )
  if (!upstreamBaseUrl || !isGovernedFirecrawlUpstream(upstreamBaseUrl)) {
    return blocked("The Firecrawl internal upstream URL is missing or invalid.")
  }
  return {
    egressAllowedHosts,
    publicBaseUrl,
    status: "ready",
    upstreamBaseUrl,
  }
}

export async function getAdminConnectedAppFirecrawlProjection(
  applicationId: string,
  executor?: InferenceCoreQueryExecutor | null,
): Promise<AdminConnectedAppFirecrawl | null> {
  const load = async (database: InferenceCoreQueryExecutor) => {
    const parentRows = await database
      .select({ status: applications.status })
      .from(applications)
      .where(eq(applications.id, applicationId))
      .limit(1)
    if (!parentRows[0] || parentRows[0].status === "deleted") {
      return null
    }
    const accessRows = await database
      .select()
      .from(applicationFirecrawlAccess)
      .where(eq(applicationFirecrawlAccess.appId, applicationId))
      .limit(1)
    if (accessRows[0]) {
      const credentialRows = await database
        .select()
        .from(applicationFirecrawlCredentials)
        .where(eq(applicationFirecrawlCredentials.appId, applicationId))
        .orderBy(desc(applicationFirecrawlCredentials.issuedAt))
      return projectFirecrawl(
        accessRecordFromRow(accessRows[0]),
        credentialRows.map(credentialRecordFromRow),
      )
    }
    return defaultFirecrawlProjection()
  }
  if (executor) {
    return load(executor)
  }
  const database = getInferenceCoreDb()
  if (database) {
    return runInferenceCoreReadSnapshot(database, load)
  }

  assertFixtureStorage()
  const parentStatus = memoryParentStatuses.get(applicationId)
  if (!parentStatus || parentStatus === "deleted") {
    return null
  }
  const access = memoryAccess.get(applicationId)
  return access
    ? projectFirecrawl(access, credentialsForApp(applicationId))
    : defaultFirecrawlProjection()
}

export async function initializeAdminConnectedAppFirecrawlForParent(
  actor: Actor,
  applicationId: string,
  transaction?: InferenceCoreTransaction | null,
): Promise<AdminConnectedAppFirecrawl | null> {
  const database = getInferenceCoreDb()
  if (transaction || database) {
    const initialize = async (executor: InferenceCoreTransaction) => {
      const storageActor = await upsertActorUser(actor, executor)
      const parentRows = await executor
        .select({ status: applications.status })
        .from(applications)
        .where(eq(applications.id, applicationId))
        .limit(1)
      if (!parentRows[0] || parentRows[0].status === "deleted") {
        return null
      }
      await executor
        .insert(applicationFirecrawlAccess)
        .values({
          appId: applicationId,
          status: "disabled",
          updatedBy: storageActor.subject,
        })
        .onConflictDoNothing({ target: applicationFirecrawlAccess.appId })
      return getAdminConnectedAppFirecrawlProjection(applicationId, executor)
    }
    return transaction
      ? initialize(transaction)
      : (database?.transaction(initialize) ?? null)
  }

  assertFixtureStorage()
  const now = new Date().toISOString()
  memoryParentStatuses.set(applicationId, "enabled")
  if (!memoryAccess.has(applicationId)) {
    memoryAccess.set(applicationId, {
      appId: applicationId,
      connectionStatus: "not_connected",
      disclaimerAcceptedAt: null,
      disclaimerAcceptedBy: null,
      disclaimerVersion: null,
      lastConnectedAt: null,
      maxConcurrentScrapes: null,
      scrapeRateLimitRps: null,
      searchRateLimitRps: null,
      status: "disabled",
      updatedAt: now,
      updatedBy: actor.subject,
    })
  }
  return getAdminConnectedAppFirecrawlProjection(applicationId)
}

export async function markAdminConnectedAppFirecrawlParentEnabled(
  applicationId: string,
  transaction?: InferenceCoreTransaction | null,
): Promise<void> {
  if (transaction || getInferenceCoreDb()) {
    return
  }
  assertFixtureStorage()
  if (memoryParentStatuses.get(applicationId) !== "deleted") {
    memoryParentStatuses.set(applicationId, "enabled")
  }
}

export async function preflightEnableAdminConnectedAppFirecrawl(
  applicationId: string,
  identityContext?: IdentityMutationRouteContext,
): Promise<AdminConnectedAppFirecrawlCredentialPreflight> {
  const readiness = preflightAdminConnectedAppFirecrawlReadiness()
  if (readiness.status === "blocked") {
    return readiness
  }
  const projection =
    await getAdminConnectedAppFirecrawlProjection(applicationId)
  if (!projection) {
    return { status: "not_found" }
  }
  const hasActiveCredential = projection.credentials.some(
    (credential) => credential.status === "active",
  )
  if (projection.disclaimerAcceptedAt !== null && !hasActiveCredential) {
    return blocked(
      "This Key's Firecrawl credential is no longer active. Create a new Key to use Firecrawl again.",
    )
  }
  const createsCredential = !hasActiveCredential
  if (createsCredential && !identityContext?.commitWithReceipt) {
    return blocked(
      "Durable identity mutation finalization is required before revealing a Firecrawl key.",
    )
  }
  return {
    createsCredential,
    publicBaseUrl: readiness.publicBaseUrl,
    status: "ready",
  }
}

export async function enableAdminConnectedAppFirecrawl<T = never>(
  actor: Actor,
  applicationId: string,
  request: AdminConnectedAppFirecrawlEnableRequest,
  identityContext?: IdentityMutationRouteContext,
  finalizeReveal?: AdminConnectedAppFirecrawlCredentialRevealFinalizer<T>,
): Promise<AdminConnectedAppFirecrawlCredentialMutationResult | T> {
  const parsed = adminConnectedAppFirecrawlEnableRequestSchema.parse(request)
  const preflight = await preflightEnableAdminConnectedAppFirecrawl(
    applicationId,
    identityContext,
  )
  if (preflight.status !== "ready") {
    return preflight
  }

  if (!preflight.createsCredential) {
    return persistEnableFirecrawl(actor, applicationId, parsed, null, undefined)
  }
  const commitWithReceipt = identityContext?.commitWithReceipt
  if (!commitWithReceipt) {
    return blocked(
      "Durable identity mutation finalization is required before revealing a Firecrawl key.",
    )
  }
  return commitWithReceipt({
    resourceId: applicationId,
    run: async (transaction) => {
      assertAtomicRevealTransaction(transaction)
      const generated = createFirecrawlCredential(applicationId)
      const result = await persistEnableFirecrawl(
        actor,
        applicationId,
        parsed,
        generated,
        transaction,
        preflight.publicBaseUrl,
      )
      const committed = requireCredentialMutationSuccess(result)
      return finalizeReveal ? finalizeReveal(committed, transaction) : committed
    },
  })
}

export async function disableAdminConnectedAppFirecrawl(
  actor: Actor,
  applicationId: string,
): Promise<AdminConnectedAppFirecrawlLifecycleMutationResult> {
  const result = await mutateAccess(
    actor,
    applicationId,
    "admin.firecrawl.disabled",
    {
      connectionStatus: "not_connected",
      lastConnectedAt: null,
      status: "disabled",
    },
  )
  return result.status === "updated"
    ? { ...result, detail: "Firecrawl access disabled.", status: "disabled" }
    : result
}

export async function revokeAdminConnectedAppFirecrawlCredential(
  actor: Actor,
  applicationId: string,
  credentialId: string,
): Promise<AdminConnectedAppFirecrawlLifecycleMutationResult> {
  return persistCredentialRevocation(actor, applicationId, credentialId)
}

export async function testAdminConnectedAppFirecrawl(
  actor: Actor,
  applicationId: string,
): Promise<AdminConnectedAppFirecrawlPassiveTestResult> {
  const firecrawl = await getAdminConnectedAppFirecrawlProjection(applicationId)
  if (!firecrawl) {
    return { status: "not_found" }
  }
  await emitAudit({
    action: "admin.firecrawl.connection_test.read",
    applicationId,
    credentialRecordId: firecrawl.credentials.find(
      (credential) => credential.status === "active",
    )?.id,
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
  if (firecrawl.connectionStatus === "connected") {
    return {
      connectionStatus: "connected",
      detail: "A real authenticated Firecrawl gateway connection was observed.",
      firecrawl,
      observedAt: firecrawl.lastConnectedAt,
      status: "passed",
    }
  }
  if (firecrawl.connectionStatus === "degraded") {
    return {
      connectionStatus: "degraded",
      detail: "The latest authenticated Firecrawl gateway connection degraded.",
      firecrawl,
      observedAt: firecrawl.lastConnectedAt,
      status: "degraded",
    }
  }
  return {
    connectionStatus: "not_connected",
    detail: "No authenticated Firecrawl gateway connection has been observed.",
    firecrawl,
    observedAt: null,
    status: "waiting",
  }
}

export async function disableAdminConnectedAppFirecrawlForParent(
  actor: Actor,
  applicationId: string,
  transaction?: InferenceCoreTransaction | null,
): Promise<void> {
  await persistParentLifecycle(
    actor,
    applicationId,
    "disabled",
    "lifecycle.application.firecrawl_disabled",
    transaction,
  )
}

export async function deleteAdminConnectedAppFirecrawlForParent(
  actor: Actor,
  applicationId: string,
  transaction?: InferenceCoreTransaction | null,
): Promise<void> {
  await persistParentLifecycle(
    actor,
    applicationId,
    "deleted",
    "lifecycle.application.firecrawl_revoked",
    transaction,
  )
}

export async function resolveAdminConnectedAppFirecrawlCredential(
  apiKey: string,
): Promise<ConnectedAppFirecrawlCredentialResolution> {
  const parsed = parseFirecrawlApiKey(apiKey)
  if (!parsed) {
    return { ok: false, reason: "invalid" }
  }
  if (preflightAdminConnectedAppFirecrawlReadiness().status !== "ready") {
    return { ok: false, reason: "unavailable" }
  }
  const database = getInferenceCoreDb()
  if (database) {
    try {
      const candidates = await database
        .select()
        .from(applicationFirecrawlCredentials)
        .where(eq(applicationFirecrawlCredentials.keyPrefix, parsed.keyPrefix))
      const credential = candidates
        .map(credentialRecordFromRow)
        .find(
          (candidate) =>
            usableCredential(candidate) &&
            safeHashEqual(candidate.verifierHash, parsed.verifierHash),
        )
      if (!credential) {
        return { ok: false, reason: "invalid" }
      }
      return resolveStoredRuntimeIdentity(credential, database)
    } catch {
      return { ok: false, reason: "unavailable" }
    }
  }

  if (!canUseBffFixtureData()) {
    return { ok: false, reason: "unavailable" }
  }
  const credential = memoryCredentials.find(
    (candidate) =>
      candidate.keyPrefix === parsed.keyPrefix &&
      usableCredential(candidate) &&
      safeHashEqual(candidate.verifierHash, parsed.verifierHash),
  )
  if (!credential) {
    return { ok: false, reason: "invalid" }
  }
  const access = memoryAccess.get(credential.appId)
  if (
    memoryParentStatuses.get(credential.appId) !== "enabled" ||
    access?.status !== "enabled"
  ) {
    return { ok: false, reason: "disabled" }
  }
  return runtimeResolution(credential)
}

export async function admitAdminConnectedAppFirecrawlRequest(input: {
  correlationId: string
  identity: ConnectedAppFirecrawlRuntimeIdentity
  operation: ConnectedAppFirecrawlOperation
}): Promise<ConnectedAppFirecrawlAdmissionResult> {
  if (preflightAdminConnectedAppFirecrawlReadiness().status !== "ready") {
    return { ok: false, reason: "unavailable" }
  }
  const database = getInferenceCoreDb()
  if (database) {
    try {
      return await database.transaction((transaction) =>
        admitDatabaseRequest(transaction, input.identity, input.operation),
      )
    } catch {
      return { ok: false, reason: "unavailable" }
    }
  }
  if (!canUseBffFixtureData()) {
    return { ok: false, reason: "unavailable" }
  }
  return admitFixtureRequest(input.identity, input.operation)
}

export async function settleAdminConnectedAppFirecrawlRequest(
  input: ConnectedAppFirecrawlSettlementInput,
): Promise<boolean> {
  assertSettlementMetadata(input)
  if (!input.admissionId) {
    return false
  }
  const database = getInferenceCoreDb()
  if (database) {
    try {
      return await database.transaction((transaction) =>
        settleDatabaseRequest(transaction, input),
      )
    } catch {
      return false
    }
  }
  if (!canUseBffFixtureData()) {
    return false
  }
  const admission = memoryAdmissions.get(input.admissionId)
  if (
    !admission ||
    admission.settled ||
    admission.appId !== input.applicationId ||
    admission.credentialId !== input.credentialRecordId ||
    admission.operation !== input.operation
  ) {
    return false
  }
  await emitAudit({
    action: `firecrawl.gateway.${input.operation}`,
    applicationId: input.applicationId,
    correlationId: input.correlationId,
    credentialRecordId: input.credentialRecordId,
    outcome: input.outcome === "succeeded" ? "succeeded" : "failed",
    sourceSystem: "firecrawl",
  })
  admission.settled = true
  const credential = memoryCredentials.find(
    (candidate) => candidate.id === input.credentialRecordId,
  )
  if (credential) {
    credential.lastUsedAt = new Date().toISOString()
  }
  return true
}

export async function recordAdminConnectedAppFirecrawlConnection(input: {
  applicationId: string
  connectedAt: string
  connectionStatus?: "connected" | "degraded"
  correlationId: string
  credentialRecordId: string
}): Promise<boolean> {
  const connectedAt = new Date(input.connectedAt)
  if (!Number.isFinite(connectedAt.getTime())) {
    return false
  }
  const connectionStatus = input.connectionStatus ?? "connected"
  const database = getInferenceCoreDb()
  if (database) {
    try {
      return await database.transaction(async (transaction) => {
        const current = await lockRuntimeRows(
          transaction,
          input.applicationId,
          input.credentialRecordId,
        )
        if (!current) {
          return false
        }
        const rows = await transaction
          .update(applicationFirecrawlAccess)
          .set({ connectionStatus, lastConnectedAt: connectedAt })
          .where(eq(applicationFirecrawlAccess.appId, input.applicationId))
          .returning({ appId: applicationFirecrawlAccess.appId })
        if (rows.length !== 1) {
          return false
        }
        await transaction.insert(auditEvents).values({
          action: "firecrawl.gateway.connection_observed",
          applicationId: input.applicationId,
          correlationId: input.correlationId,
          credentialPrefix: null,
          credentialRecordId: input.credentialRecordId,
          id: randomUUID(),
          keycloakSubjectId: null,
          occurredAt: new Date(),
          outcome: connectionStatus === "connected" ? "succeeded" : "failed",
          recoveryReasonCode: null,
          sourceSystem: "firecrawl",
        })
        return true
      })
    } catch {
      return false
    }
  }
  if (!canUseBffFixtureData()) {
    return false
  }
  const access = memoryAccess.get(input.applicationId)
  const credential = memoryCredentials.find(
    (candidate) =>
      candidate.appId === input.applicationId &&
      candidate.id === input.credentialRecordId &&
      usableCredential(candidate),
  )
  if (
    !access ||
    access.status !== "enabled" ||
    memoryParentStatuses.get(input.applicationId) !== "enabled" ||
    !credential
  ) {
    return false
  }
  try {
    await emitAudit({
      action: "firecrawl.gateway.connection_observed",
      applicationId: input.applicationId,
      correlationId: input.correlationId,
      credentialRecordId: input.credentialRecordId,
      outcome: connectionStatus === "connected" ? "succeeded" : "failed",
      sourceSystem: "firecrawl",
    })
  } catch {
    return false
  }
  access.connectionStatus = connectionStatus
  access.lastConnectedAt = connectedAt.toISOString()
  return true
}

export async function recordAdminConnectedAppFirecrawlGatewayMetadata(
  input: ConnectedAppFirecrawlMetadataInput,
): Promise<void> {
  assertSettlementMetadata(input)
  await emitAudit({
    action: `firecrawl.gateway.${input.operation}`,
    applicationId: input.applicationId,
    correlationId: input.correlationId,
    credentialRecordId: input.credentialRecordId,
    outcome: input.outcome === "succeeded" ? "succeeded" : "failed",
    sourceSystem: "firecrawl",
  })
}

export function resetAdminConnectedAppFirecrawlForTest(): void {
  memoryParentStatuses.clear()
  memoryAccess.clear()
  memoryCredentials.splice(0)
  memoryRateWindows.clear()
  memoryAdmissions.clear()
}

async function persistEnableFirecrawl(
  actor: Actor,
  applicationId: string,
  request: AdminConnectedAppFirecrawlEnableRequest,
  generated: ReturnType<typeof createFirecrawlCredential> | null,
  transaction?: InferenceCoreTransaction | null,
  publicBaseUrl?: string,
): Promise<AdminConnectedAppFirecrawlCredentialMutationResult> {
  const database = getInferenceCoreDb()
  if (transaction || database) {
    const persist = async (executor: InferenceCoreTransaction) => {
      const storageActor = await upsertActorUser(actor, executor)
      const access = await ensureAndLockAccess(
        executor,
        applicationId,
        storageActor.subject,
        true,
      )
      if (!access) {
        return { status: "not_found" as const }
      }
      const activeRows = await executor
        .select()
        .from(applicationFirecrawlCredentials)
        .where(
          and(
            eq(applicationFirecrawlCredentials.appId, applicationId),
            eq(applicationFirecrawlCredentials.status, "active"),
          ),
        )
        .limit(1)
      const active = activeRows[0]
      const firstEnable = access.disclaimerAcceptedAt === null
      if (!firstEnable && !active) {
        return blocked(
          "This Key's Firecrawl credential is no longer active. Create a new Key to use Firecrawl again.",
        )
      }
      if (!active && !generated) {
        return blocked("An atomic Firecrawl key reveal is required.")
      }
      if (!active && generated) {
        await executor
          .insert(applicationFirecrawlCredentials)
          .values(credentialInsertValues(generated.record))
      }
      const now = new Date()
      await executor
        .update(applicationFirecrawlAccess)
        .set({
          ...(firstEnable
            ? {
                disclaimerAcceptedAt: now,
                disclaimerAcceptedBy: storageActor.subject,
                disclaimerVersion: FIRECRAWL_DISCLAIMER_VERSION,
                maxConcurrentScrapes: request.maxConcurrentScrapes,
                scrapeRateLimitRps: request.scrapeRateLimitRps,
                searchRateLimitRps: request.searchRateLimitRps,
              }
            : {}),
          status: "enabled",
          updatedAt: now,
          updatedBy: storageActor.subject,
        })
        .where(eq(applicationFirecrawlAccess.appId, applicationId))
      const credentialId = active?.id ?? generated?.record.id
      await executor.insert(auditEvents).values(
        auditValues({
          action: "admin.firecrawl.enabled",
          applicationId,
          credentialRecordId: credentialId,
          keycloakSubjectId: storageActor.subject,
          occurredAt: now,
        }),
      )
      const firecrawl = await getAdminConnectedAppFirecrawlProjection(
        applicationId,
        executor,
      )
      if (!firecrawl) {
        throw new Error("Enabled Firecrawl projection could not be read back.")
      }
      return {
        credential:
          !active && generated && publicBaseUrl
            ? credentialReveal(generated, publicBaseUrl)
            : null,
        detail: active
          ? "Firecrawl access re-enabled with its existing active key."
          : "Firecrawl access enabled. Store the displayed key now; it cannot be recovered.",
        firecrawl,
        status: "enabled" as const,
      }
    }
    return transaction
      ? persist(transaction)
      : (database?.transaction(persist) ?? { status: "not_found" })
  }

  assertFixtureStorage()
  const access = memoryAccess.get(applicationId)
  if (!access || memoryParentStatuses.get(applicationId) !== "enabled") {
    return { status: "not_found" }
  }
  const active = memoryCredentials.find(
    (candidate) =>
      candidate.appId === applicationId && candidate.status === "active",
  )
  const firstEnable = access.disclaimerAcceptedAt === null
  if (!firstEnable && !active) {
    return blocked(
      "This Key's Firecrawl credential is no longer active. Create a new Key to use Firecrawl again.",
    )
  }
  if (!active && !generated) {
    return blocked("An atomic Firecrawl key reveal is required.")
  }
  const now = new Date().toISOString()
  if (!active && generated) {
    memoryCredentials.unshift(cloneCredential(generated.record))
  }
  if (firstEnable) {
    access.disclaimerAcceptedAt = now
    access.disclaimerAcceptedBy = actor.subject
    access.disclaimerVersion = FIRECRAWL_DISCLAIMER_VERSION
    access.maxConcurrentScrapes = request.maxConcurrentScrapes
    access.scrapeRateLimitRps = request.scrapeRateLimitRps
    access.searchRateLimitRps = request.searchRateLimitRps
  }
  access.status = "enabled"
  access.updatedAt = now
  access.updatedBy = actor.subject
  const credentialId = active?.id ?? generated?.record.id
  await mutationAudit(
    actor,
    "admin.firecrawl.enabled",
    applicationId,
    credentialId,
  )
  return {
    credential:
      !active && generated && publicBaseUrl
        ? credentialReveal(generated, publicBaseUrl)
        : null,
    detail: active
      ? "Firecrawl access re-enabled with its existing active key."
      : "Firecrawl access enabled. Store the displayed key now; it cannot be recovered.",
    firecrawl: projectFirecrawl(access, credentialsForApp(applicationId)),
    status: "enabled",
  }
}

async function mutateAccess(
  actor: Actor,
  applicationId: string,
  action: string,
  updates: Partial<FirecrawlAccessRecord>,
): Promise<AdminConnectedAppFirecrawlLifecycleMutationResult> {
  const database = getInferenceCoreDb()
  if (database) {
    return database.transaction(async (transaction) => {
      const storageActor = await upsertActorUser(actor, transaction)
      const access = await ensureAndLockAccess(
        transaction,
        applicationId,
        storageActor.subject,
        false,
      )
      if (!access) {
        return { status: "not_found" }
      }
      const now = new Date()
      await transaction
        .update(applicationFirecrawlAccess)
        .set({
          ...accessUpdatesForDatabase(updates),
          updatedAt: now,
          updatedBy: storageActor.subject,
        })
        .where(eq(applicationFirecrawlAccess.appId, applicationId))
      const active = await activeCredentialId(applicationId, transaction)
      await transaction.insert(auditEvents).values(
        auditValues({
          action,
          applicationId,
          credentialRecordId: active,
          keycloakSubjectId: storageActor.subject,
          occurredAt: now,
        }),
      )
      const firecrawl = await getAdminConnectedAppFirecrawlProjection(
        applicationId,
        transaction,
      )
      if (!firecrawl) {
        throw new Error("Firecrawl projection could not be read back.")
      }
      return {
        detail: "Firecrawl settings updated.",
        firecrawl,
        status: "updated",
      }
    })
  }

  assertFixtureStorage()
  const access = memoryAccess.get(applicationId)
  if (!access || memoryParentStatuses.get(applicationId) === "deleted") {
    return { status: "not_found" }
  }
  Object.assign(access, updates, {
    updatedAt: new Date().toISOString(),
    updatedBy: actor.subject,
  })
  const active = memoryCredentials.find(
    (candidate) =>
      candidate.appId === applicationId && candidate.status === "active",
  )
  await mutationAudit(actor, action, applicationId, active?.id)
  return {
    detail: "Firecrawl settings updated.",
    firecrawl: projectFirecrawl(access, credentialsForApp(applicationId)),
    status: "updated",
  }
}

async function persistCredentialRevocation(
  actor: Actor,
  applicationId: string,
  credentialId: string,
): Promise<AdminConnectedAppFirecrawlLifecycleMutationResult> {
  const database = getInferenceCoreDb()
  const now = new Date()
  if (database) {
    return database.transaction(async (transaction) => {
      const storageActor = await upsertActorUser(actor, transaction)
      const access = await ensureAndLockAccess(
        transaction,
        applicationId,
        storageActor.subject,
        false,
      )
      if (!access) {
        return { status: "not_found" }
      }
      const credentialRows = await transaction
        .select()
        .from(applicationFirecrawlCredentials)
        .where(
          and(
            eq(applicationFirecrawlCredentials.appId, applicationId),
            eq(applicationFirecrawlCredentials.id, credentialId),
          ),
        )
        .limit(1)
        .for("update")
      const credential = credentialRows[0]
      if (!credential || credential.status === "revoked") {
        return blocked("An active or retiring Firecrawl key is required.")
      }
      await transaction
        .update(applicationFirecrawlCredentials)
        .set({ revokedAt: now, status: "revoked" })
        .where(eq(applicationFirecrawlCredentials.id, credentialId))
      if (credential.status === "active") {
        await transaction
          .update(applicationFirecrawlAccess)
          .set({
            connectionStatus: "not_connected",
            lastConnectedAt: null,
            status: "disabled",
            updatedAt: now,
            updatedBy: storageActor.subject,
          })
          .where(eq(applicationFirecrawlAccess.appId, applicationId))
      }
      await transaction.insert(auditEvents).values(
        auditValues({
          action: "admin.firecrawl.credential.revoked",
          applicationId,
          credentialRecordId: credentialId,
          keycloakSubjectId: storageActor.subject,
          occurredAt: now,
        }),
      )
      const firecrawl = await getAdminConnectedAppFirecrawlProjection(
        applicationId,
        transaction,
      )
      if (!firecrawl) {
        throw new Error("Revoked Firecrawl projection could not be read back.")
      }
      return {
        detail: "Firecrawl key revoked.",
        firecrawl,
        status: "revoked",
      }
    })
  }

  assertFixtureStorage()
  const access = memoryAccess.get(applicationId)
  const credential = memoryCredentials.find(
    (candidate) =>
      candidate.appId === applicationId &&
      candidate.id === credentialId &&
      candidate.status !== "revoked",
  )
  if (!access || !credential) {
    return { status: "not_found" }
  }
  const disablesAccess = credential.status === "active"
  credential.status = "revoked"
  credential.revokedAt = now.toISOString()
  if (credential.rotatedAt === null) {
    credential.overlapExpiresAt = null
  }
  if (disablesAccess) {
    access.status = "disabled"
    access.connectionStatus = "not_connected"
    access.lastConnectedAt = null
  }
  access.updatedAt = now.toISOString()
  access.updatedBy = actor.subject
  await mutationAudit(
    actor,
    "admin.firecrawl.credential.revoked",
    applicationId,
    credentialId,
  )
  return {
    detail: "Firecrawl key revoked.",
    firecrawl: projectFirecrawl(access, credentialsForApp(applicationId)),
    status: "revoked",
  }
}

async function persistParentLifecycle(
  actor: Actor,
  applicationId: string,
  parentStatus: "deleted" | "disabled",
  action: string,
  transaction?: InferenceCoreTransaction | null,
): Promise<void> {
  const database = getInferenceCoreDb()
  const now = new Date()
  if (transaction || database) {
    const persist = async (executor: InferenceCoreTransaction) => {
      const storageActor = await upsertActorUser(actor, executor)
      const accessRows = await executor
        .select({ appId: applicationFirecrawlAccess.appId })
        .from(applicationFirecrawlAccess)
        .where(eq(applicationFirecrawlAccess.appId, applicationId))
        .limit(1)
        .for("update")
      if (!accessRows[0]) {
        return
      }
      const credentialRows = await executor
        .select({ id: applicationFirecrawlCredentials.id })
        .from(applicationFirecrawlCredentials)
        .where(
          and(
            eq(applicationFirecrawlCredentials.appId, applicationId),
            parentStatus === "deleted"
              ? inArray(applicationFirecrawlCredentials.status, [
                  "active",
                  "retiring",
                ])
              : eq(applicationFirecrawlCredentials.status, "active"),
          ),
        )
      const credentialIds = credentialRows.map((credential) => credential.id)
      if (parentStatus === "deleted") {
        await executor
          .update(applicationFirecrawlCredentials)
          .set({ revokedAt: now, status: "revoked" })
          .where(
            and(
              eq(applicationFirecrawlCredentials.appId, applicationId),
              inArray(applicationFirecrawlCredentials.status, [
                "active",
                "retiring",
              ]),
            ),
          )
      }
      await executor
        .update(applicationFirecrawlAccess)
        .set({
          connectionStatus: "not_connected",
          lastConnectedAt: null,
          status: "disabled",
          updatedAt: now,
          updatedBy: storageActor.subject,
        })
        .where(eq(applicationFirecrawlAccess.appId, applicationId))
      await executor.insert(auditEvents).values(
        (credentialIds.length > 0 ? credentialIds : [undefined]).map(
          (credentialRecordId) =>
            auditValues({
              action,
              applicationId,
              credentialRecordId,
              keycloakSubjectId: storageActor.subject,
              occurredAt: now,
              sourceSystem: "lifecycle",
            }),
        ),
      )
    }
    if (transaction) {
      await persist(transaction)
    } else if (database) {
      await database.transaction(persist)
    }
    return
  }

  assertFixtureStorage()
  memoryParentStatuses.set(applicationId, parentStatus)
  const access = memoryAccess.get(applicationId)
  if (!access) {
    return
  }
  const credentialIds = memoryCredentials
    .filter(
      (candidate) =>
        candidate.appId === applicationId &&
        (parentStatus === "deleted"
          ? candidate.status !== "revoked"
          : candidate.status === "active"),
    )
    .map((credential) => credential.id)
  if (parentStatus === "deleted") {
    for (const credential of memoryCredentials) {
      if (
        credential.appId === applicationId &&
        credential.status !== "revoked"
      ) {
        credential.status = "revoked"
        credential.revokedAt = now.toISOString()
      }
    }
  }
  access.status = "disabled"
  access.connectionStatus = "not_connected"
  access.lastConnectedAt = null
  access.updatedAt = now.toISOString()
  access.updatedBy = actor.subject
  for (const credentialRecordId of credentialIds.length > 0
    ? credentialIds
    : [undefined]) {
    await emitAudit({
      action,
      applicationId,
      credentialRecordId,
      keycloakSubjectId: actor.subject,
      outcome: "succeeded",
      sourceSystem: "lifecycle",
    })
  }
}

async function ensureAndLockAccess(
  transaction: InferenceCoreTransaction,
  applicationId: string,
  actorSubject: string,
  requireParentEnabled: boolean,
): Promise<FirecrawlAccessRecord | null> {
  const parentRows = await transaction
    .select({ status: applications.status })
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1)
    .for("update")
  const parent = parentRows[0]
  if (
    !parent ||
    parent.status === "deleted" ||
    (requireParentEnabled && parent.status !== "enabled")
  ) {
    return null
  }
  await transaction
    .insert(applicationFirecrawlAccess)
    .values({
      appId: applicationId,
      status: "disabled",
      updatedBy: actorSubject,
    })
    .onConflictDoNothing({ target: applicationFirecrawlAccess.appId })
  const rows = await transaction
    .select()
    .from(applicationFirecrawlAccess)
    .where(eq(applicationFirecrawlAccess.appId, applicationId))
    .limit(1)
    .for("update")
  return rows[0] ? accessRecordFromRow(rows[0]) : null
}

async function resolveStoredRuntimeIdentity(
  credential: FirecrawlCredentialRecord,
  database: InferenceCoreQueryExecutor,
): Promise<ConnectedAppFirecrawlCredentialResolution> {
  const [accessRows, parentRows] = await Promise.all([
    database
      .select({ status: applicationFirecrawlAccess.status })
      .from(applicationFirecrawlAccess)
      .where(eq(applicationFirecrawlAccess.appId, credential.appId))
      .limit(1),
    database
      .select({ status: applications.status })
      .from(applications)
      .where(eq(applications.id, credential.appId))
      .limit(1),
  ])
  if (
    accessRows[0]?.status !== "enabled" ||
    parentRows[0]?.status !== "enabled"
  ) {
    return { ok: false, reason: "disabled" }
  }
  return runtimeResolution(credential)
}

async function admitDatabaseRequest(
  transaction: InferenceCoreTransaction,
  identity: ConnectedAppFirecrawlRuntimeIdentity,
  operation: ConnectedAppFirecrawlOperation,
): Promise<ConnectedAppFirecrawlAdmissionResult> {
  const current = await lockRuntimeRows(
    transaction,
    identity.applicationId,
    identity.credentialRecordId,
  )
  if (!current) {
    return { ok: false, reason: "unavailable" }
  }
  const limit =
    operation === "search"
      ? current.searchRateLimitRps
      : current.scrapeRateLimitRps
  if (limit !== null) {
    const rateRows = await transaction.execute(sql<{ request_count: number }>`
      WITH expired_windows AS (
        DELETE FROM admin.application_firecrawl_rate_limit_windows
        WHERE app_id = ${identity.applicationId}
          AND route_kind = ${operation}
          AND expires_at <= clock_timestamp()
        RETURNING app_id
      )
      INSERT INTO admin.application_firecrawl_rate_limit_windows (
        app_id,
        route_kind,
        window_started_at,
        request_count,
        expires_at
      )
      VALUES (
        ${identity.applicationId},
        ${operation},
        date_trunc('second', statement_timestamp()),
        1,
        date_trunc('second', statement_timestamp()) + interval '2 seconds'
      )
      ON CONFLICT (app_id, route_kind, window_started_at)
      DO UPDATE SET
        request_count =
          admin.application_firecrawl_rate_limit_windows.request_count + 1,
        expires_at = EXCLUDED.expires_at
      WHERE admin.application_firecrawl_rate_limit_windows.request_count
        < ${limit}
      RETURNING request_count
    `)
    if (resultRows(rateRows).length === 0) {
      return { ok: false, reason: "rate_limited", retryAfterSeconds: 1 }
    }
  }
  if (operation === "scrape" && current.maxConcurrentScrapes !== null) {
    const active = await transaction
      .select({ count: sql<number>`count(*)::integer` })
      .from(applicationFirecrawlRequestLedger)
      .where(
        and(
          eq(applicationFirecrawlRequestLedger.appId, identity.applicationId),
          eq(applicationFirecrawlRequestLedger.routeKind, "scrape"),
          eq(applicationFirecrawlRequestLedger.state, "active"),
          gt(applicationFirecrawlRequestLedger.leaseExpiresAt, new Date()),
        ),
      )
    if (
      (active[0]?.count ?? current.maxConcurrentScrapes) >=
      current.maxConcurrentScrapes
    ) {
      return { ok: false, reason: "concurrency_limited" }
    }
  }
  const now = new Date()
  const admissionId = randomUUID()
  await transaction.insert(applicationFirecrawlRequestLedger).values({
    appId: identity.applicationId,
    credentialId: identity.credentialRecordId,
    id: admissionId,
    leaseExpiresAt: new Date(
      now.getTime() + FIRECRAWL_REQUEST_LEASE_SECONDS * 1000,
    ),
    routeKind: operation,
    startedAt: now,
  })
  return { admissionId, ok: true }
}

async function lockRuntimeRows(
  transaction: InferenceCoreTransaction,
  applicationId: string,
  credentialId: string,
): Promise<{
  maxConcurrentScrapes: number | null
  scrapeRateLimitRps: number | null
  searchRateLimitRps: number | null
} | null> {
  const rows = await transaction.execute(sql<{
    max_concurrent_scrapes: number | null
    scrape_rate_limit_rps: number | null
    search_rate_limit_rps: number | null
  }>`
    SELECT
      access.max_concurrent_scrapes,
      access.scrape_rate_limit_rps,
      access.search_rate_limit_rps
    FROM admin.application_firecrawl_access AS access
    JOIN admin.applications AS application
      ON application.id = access.app_id
    JOIN admin.application_firecrawl_credentials AS credential
      ON credential.app_id = access.app_id
    JOIN admin.emergency_isolation_state AS isolation
      ON isolation.id = 'appliance'
      AND isolation.status = 'inactive'
    WHERE access.app_id = ${applicationId}
      AND application.status = 'enabled'
      AND access.status = 'enabled'
      AND credential.id = ${credentialId}
      AND credential.revoked_at IS NULL
      AND (
        credential.status = 'active'
        OR (
          credential.status = 'retiring'
          AND credential.overlap_expires_at > clock_timestamp()
        )
      )
    FOR UPDATE OF access, isolation
  `)
  const current = resultRows(rows)[0] as
    | {
        max_concurrent_scrapes: number | null
        scrape_rate_limit_rps: number | null
        search_rate_limit_rps: number | null
      }
    | undefined
  return current
    ? {
        maxConcurrentScrapes: current.max_concurrent_scrapes,
        scrapeRateLimitRps: current.scrape_rate_limit_rps,
        searchRateLimitRps: current.search_rate_limit_rps,
      }
    : null
}

function admitFixtureRequest(
  identity: ConnectedAppFirecrawlRuntimeIdentity,
  operation: ConnectedAppFirecrawlOperation,
): ConnectedAppFirecrawlAdmissionResult {
  const access = memoryAccess.get(identity.applicationId)
  const credential = memoryCredentials.find(
    (candidate) =>
      candidate.appId === identity.applicationId &&
      candidate.id === identity.credentialRecordId &&
      usableCredential(candidate),
  )
  if (
    !access ||
    access.status !== "enabled" ||
    memoryParentStatuses.get(identity.applicationId) !== "enabled" ||
    !credential
  ) {
    return { ok: false, reason: "unavailable" }
  }
  const now = Date.now()
  const limit =
    operation === "search"
      ? access.searchRateLimitRps
      : access.scrapeRateLimitRps
  if (limit !== null) {
    const key = `${identity.applicationId}:${operation}`
    let window = memoryRateWindows.get(key)
    if (!window || now - window.windowStartedAt >= 1000) {
      window = { count: 0, windowStartedAt: now }
      memoryRateWindows.set(key, window)
    }
    window.count += 1
    if (window.count > limit) {
      return { ok: false, reason: "rate_limited", retryAfterSeconds: 1 }
    }
  }
  if (operation === "scrape" && access.maxConcurrentScrapes !== null) {
    const active = [...memoryAdmissions.values()].filter(
      (candidate) =>
        candidate.appId === identity.applicationId &&
        candidate.operation === "scrape" &&
        !candidate.settled &&
        candidate.leaseExpiresAt > now,
    ).length
    if (active >= access.maxConcurrentScrapes) {
      return { ok: false, reason: "concurrency_limited" }
    }
  }
  const admissionId = randomUUID()
  memoryAdmissions.set(admissionId, {
    appId: identity.applicationId,
    credentialId: identity.credentialRecordId,
    leaseExpiresAt: now + FIRECRAWL_REQUEST_LEASE_SECONDS * 1000,
    operation,
    settled: false,
    startedAt: now,
  })
  return { admissionId, ok: true }
}

async function settleDatabaseRequest(
  transaction: InferenceCoreTransaction,
  input: ConnectedAppFirecrawlSettlementInput,
): Promise<boolean> {
  if (!input.admissionId) {
    return false
  }
  const ledgerRows = await transaction
    .select()
    .from(applicationFirecrawlRequestLedger)
    .where(eq(applicationFirecrawlRequestLedger.id, input.admissionId))
    .limit(1)
    .for("update")
  const ledger = ledgerRows[0]
  if (
    !ledger ||
    ledger.state !== "active" ||
    ledger.appId !== input.applicationId ||
    ledger.credentialId !== input.credentialRecordId ||
    ledger.routeKind !== input.operation
  ) {
    return false
  }
  const now = new Date()
  const bucketDate = ledger.startedAt.toISOString().slice(0, 10)
  await transaction
    .update(applicationFirecrawlRequestLedger)
    .set({
      latencyMs: input.latencyMs,
      settledAt: now,
      state: "settled",
      statusCode: input.status,
    })
    .where(eq(applicationFirecrawlRequestLedger.id, input.admissionId))
  await transaction
    .insert(applicationFirecrawlUsageDaily)
    .values({
      appId: input.applicationId,
      bucketDate,
      credentialId: input.credentialRecordId,
      failureCount: input.outcome === "succeeded" ? 0 : 1,
      latencyMsMax: input.latencyMs,
      latencyMsSum: input.latencyMs,
      requestCount: 1,
      routeKind: input.operation,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        applicationFirecrawlUsageDaily.appId,
        applicationFirecrawlUsageDaily.credentialId,
        applicationFirecrawlUsageDaily.bucketDate,
        applicationFirecrawlUsageDaily.routeKind,
      ],
      set: {
        failureCount: sql`${applicationFirecrawlUsageDaily.failureCount} + ${input.outcome === "succeeded" ? 0 : 1}`,
        latencyMsMax: sql`greatest(${applicationFirecrawlUsageDaily.latencyMsMax}, ${input.latencyMs})`,
        latencyMsSum: sql`${applicationFirecrawlUsageDaily.latencyMsSum} + ${input.latencyMs}`,
        requestCount: sql`${applicationFirecrawlUsageDaily.requestCount} + 1`,
        updatedAt: now,
      },
    })
  await transaction
    .update(applicationFirecrawlCredentials)
    .set({ lastUsedAt: now })
    .where(eq(applicationFirecrawlCredentials.id, input.credentialRecordId))
  await transaction.insert(auditEvents).values({
    action: `firecrawl.gateway.${input.operation}`,
    applicationId: input.applicationId,
    correlationId: input.correlationId,
    credentialPrefix: null,
    credentialRecordId: input.credentialRecordId,
    id: randomUUID(),
    keycloakSubjectId: null,
    occurredAt: now,
    outcome: input.outcome === "succeeded" ? "succeeded" : "failed",
    recoveryReasonCode: null,
    sourceSystem: "firecrawl",
  })
  return true
}

function createFirecrawlCredential(applicationId: string): {
  apiKey: string
  record: FirecrawlCredentialRecord
} {
  const prefixEntropy = randomBytes(8).toString("hex")
  const secret = randomBytes(32).toString("base64url")
  const apiKey = `llmm_fc_${prefixEntropy}_${secret}`
  const issuedAt = new Date().toISOString()
  return {
    apiKey,
    record: {
      appId: applicationId,
      id: `fck-${randomUUID()}`,
      issuedAt,
      keyPrefix: `llmm_fc_${prefixEntropy}`,
      lastUsedAt: null,
      overlapExpiresAt: null,
      revokedAt: null,
      rotatedAt: null,
      status: "active",
      verifierHash: hashFirecrawlApiKey(apiKey),
    },
  }
}

function credentialReveal(
  generated: ReturnType<typeof createFirecrawlCredential>,
  publicBaseUrl: string,
): AdminConnectedAppFirecrawlCredential {
  return {
    apiKey: generated.apiKey,
    credentialId: generated.record.id,
    exampleCurl: `curl -H "Authorization: Bearer ${generated.apiKey}" ${publicBaseUrl}/v2/search`,
    firecrawlBaseUrl: publicBaseUrl,
    issuedAt: generated.record.issuedAt,
    keyPrefix: generated.record.keyPrefix,
  }
}

function projectFirecrawl(
  access: FirecrawlAccessRecord,
  credentials: FirecrawlCredentialRecord[],
): AdminConnectedAppFirecrawl {
  return adminConnectedAppFirecrawlSchema.parse({
    connectionStatus: access.connectionStatus,
    credentials: credentials
      .map((credential) => ({
        id: credential.id,
        issuedAt: credential.issuedAt,
        keyPrefix: credential.keyPrefix,
        lastUsedAt: credential.lastUsedAt,
        overlapExpiresAt: credential.overlapExpiresAt,
        revokedAt: credential.revokedAt,
        rotatedAt: credential.rotatedAt,
        status: credential.status,
      }))
      .sort((left, right) => right.issuedAt.localeCompare(left.issuedAt)),
    disclaimerAcceptedAt: access.disclaimerAcceptedAt,
    disclaimerVersion: access.disclaimerVersion,
    lastConnectedAt: access.lastConnectedAt,
    maxConcurrentScrapes: access.maxConcurrentScrapes,
    scrapeRateLimitRps: access.scrapeRateLimitRps,
    searchRateLimitRps: access.searchRateLimitRps,
    status: access.status,
  })
}

function defaultFirecrawlProjection(): AdminConnectedAppFirecrawl {
  return adminConnectedAppFirecrawlSchema.parse({
    connectionStatus: "not_connected",
    credentials: [],
    disclaimerAcceptedAt: null,
    disclaimerVersion: null,
    lastConnectedAt: null,
    maxConcurrentScrapes: null,
    scrapeRateLimitRps: null,
    searchRateLimitRps: null,
    status: "disabled",
  })
}

function accessRecordFromRow(
  row: typeof applicationFirecrawlAccess.$inferSelect,
): FirecrawlAccessRecord {
  return {
    appId: row.appId,
    connectionStatus: connectionStatus(row.connectionStatus),
    disclaimerAcceptedAt: row.disclaimerAcceptedAt?.toISOString() ?? null,
    disclaimerAcceptedBy: row.disclaimerAcceptedBy,
    disclaimerVersion: row.disclaimerVersion,
    lastConnectedAt: row.lastConnectedAt?.toISOString() ?? null,
    maxConcurrentScrapes: row.maxConcurrentScrapes,
    scrapeRateLimitRps: row.scrapeRateLimitRps,
    searchRateLimitRps: row.searchRateLimitRps,
    status: firecrawlStatus(row.status),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  }
}

function credentialRecordFromRow(
  row: typeof applicationFirecrawlCredentials.$inferSelect,
): FirecrawlCredentialRecord {
  return {
    appId: row.appId,
    id: row.id,
    issuedAt: row.issuedAt.toISOString(),
    keyPrefix: row.keyPrefix,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    overlapExpiresAt: row.overlapExpiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    rotatedAt: row.rotatedAt?.toISOString() ?? null,
    status: credentialStatus(row.status),
    verifierHash: row.verifierHash,
  }
}

function credentialInsertValues(record: FirecrawlCredentialRecord) {
  return {
    appId: record.appId,
    id: record.id,
    issuedAt: new Date(record.issuedAt),
    keyPrefix: record.keyPrefix,
    lastUsedAt: record.lastUsedAt ? new Date(record.lastUsedAt) : null,
    overlapExpiresAt: record.overlapExpiresAt
      ? new Date(record.overlapExpiresAt)
      : null,
    revokedAt: record.revokedAt ? new Date(record.revokedAt) : null,
    rotatedAt: record.rotatedAt ? new Date(record.rotatedAt) : null,
    status: record.status,
    verifierHash: record.verifierHash,
  }
}

function accessUpdatesForDatabase(updates: Partial<FirecrawlAccessRecord>) {
  return {
    connectionStatus: updates.connectionStatus,
    disclaimerAcceptedAt:
      updates.disclaimerAcceptedAt === undefined
        ? undefined
        : updates.disclaimerAcceptedAt
          ? new Date(updates.disclaimerAcceptedAt)
          : null,
    disclaimerAcceptedBy: updates.disclaimerAcceptedBy,
    disclaimerVersion: updates.disclaimerVersion,
    lastConnectedAt:
      updates.lastConnectedAt === undefined
        ? undefined
        : updates.lastConnectedAt
          ? new Date(updates.lastConnectedAt)
          : null,
    maxConcurrentScrapes: updates.maxConcurrentScrapes,
    scrapeRateLimitRps: updates.scrapeRateLimitRps,
    searchRateLimitRps: updates.searchRateLimitRps,
    status: updates.status,
  }
}

async function activeCredentialId(
  applicationId: string,
  executor: InferenceCoreQueryExecutor,
): Promise<string | undefined> {
  const rows = await executor
    .select({ id: applicationFirecrawlCredentials.id })
    .from(applicationFirecrawlCredentials)
    .where(
      and(
        eq(applicationFirecrawlCredentials.appId, applicationId),
        eq(applicationFirecrawlCredentials.status, "active"),
      ),
    )
    .limit(1)
  return rows[0]?.id
}

function credentialsForApp(applicationId: string): FirecrawlCredentialRecord[] {
  return memoryCredentials
    .filter((credential) => credential.appId === applicationId)
    .map(cloneCredential)
}

function cloneCredential(
  credential: FirecrawlCredentialRecord,
): FirecrawlCredentialRecord {
  return { ...credential }
}

function runtimeResolution(
  credential: FirecrawlCredentialRecord,
): ConnectedAppFirecrawlCredentialResolution {
  return {
    identity: {
      applicationId: credential.appId,
      credentialRecordId: credential.id,
      scopes: [...FIRECRAWL_SCOPES],
    },
    ok: true,
  }
}

function parseFirecrawlApiKey(
  apiKey: string,
): { keyPrefix: string; verifierHash: string } | null {
  const match = /^(llmm_fc_[0-9a-f]{16})_[A-Za-z0-9_-]{43}$/.exec(apiKey)
  return match?.[1]
    ? { keyPrefix: match[1], verifierHash: hashFirecrawlApiKey(apiKey) }
    : null
}

function hashFirecrawlApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex")
}

function safeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex")
  const rightBuffer = Buffer.from(right, "hex")
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  )
}

function usableCredential(credential: FirecrawlCredentialRecord): boolean {
  if (credential.revokedAt !== null) {
    return false
  }
  return (
    credential.status === "active" ||
    (credential.status === "retiring" &&
      credential.overlapExpiresAt !== null &&
      Date.parse(credential.overlapExpiresAt) > Date.now())
  )
}

function normalizeFirecrawlBaseUrl(
  value: string | undefined,
  rejectLoopback: boolean,
  requireRootPath = false,
  allowPlaintextNonLoopback = false,
): string | null {
  const candidate = value?.trim()
  if (
    !candidate ||
    candidate.includes("?") ||
    candidate.includes("#") ||
    candidate.includes("\\") ||
    containsControlCharacter(candidate)
  ) {
    return null
  }
  try {
    const url = new URL(candidate)
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      (rejectLoopback && url.port !== "") ||
      url.search ||
      url.hash ||
      (!allowPlaintextNonLoopback &&
        url.protocol === "http:" &&
        !isLoopbackHostname(url.hostname)) ||
      (requireRootPath && url.pathname !== "/") ||
      (requireRootPath &&
        url.hostname.toLowerCase().replace(/\.$/, "") ===
          "api.firecrawl.dev") ||
      (rejectLoopback && isLoopbackHostname(url.hostname))
    ) {
      return null
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/"
    return url.toString().replace(/\/$/, "")
  } catch {
    return null
  }
}

function isGovernedFirecrawlUpstream(value: string): boolean {
  const upstream = new URL(value)
  return (
    upstream.protocol === "http:" &&
    upstream.hostname.toLowerCase() === "firecrawl-api" &&
    upstream.port === "3002" &&
    upstream.pathname === "/"
  )
}

function isPublicProductHostname(value: string): boolean {
  return (
    value.length <= 253 &&
    value === value.toLowerCase() &&
    !value.includes(":") &&
    !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) &&
    value
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 31 || codePoint === 127) {
      return true
    }
  }
  return false
}

function isLoopbackHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/\.$/, "")
  const mappedIpv4HighWord =
    /^\[?::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}\]?$/.exec(hostname)?.[1]
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.") ||
    /^\[?::ffff:127(?:\.|:)/.test(hostname) ||
    (mappedIpv4HighWord !== undefined &&
      Number.parseInt(mappedIpv4HighWord, 16) >>> 8 === 127)
  )
}

function environmentBoolean(value: string | undefined): boolean | null {
  return value === "true" ? true : value === "false" ? false : null
}

function blocked(detail: string): { detail: string; status: "blocked" } {
  return { detail, status: "blocked" }
}

function isCredentialMutationSuccess(
  result: AdminConnectedAppFirecrawlCredentialMutationResult,
): result is AdminConnectedAppFirecrawlCredentialMutationSuccess {
  return result.status === "enabled"
}

function requireCredentialMutationSuccess(
  result: AdminConnectedAppFirecrawlCredentialMutationResult,
): AdminConnectedAppFirecrawlCredentialMutationSuccess {
  if (!isCredentialMutationSuccess(result)) {
    throw new AdminConnectedAppFirecrawlCredentialCommitRaceError(result)
  }
  return result
}

function assertFixtureStorage(): void {
  if (!canUseBffFixtureData()) {
    throw new Error("PostgreSQL Firecrawl storage is unavailable.")
  }
}

function assertAtomicRevealTransaction(
  transaction: InferenceCoreTransaction | null,
): void {
  if (getInferenceCoreDb() && !transaction) {
    throw new Error(
      "Firecrawl key persistence and the idempotency receipt require one transaction.",
    )
  }
}

function assertSettlementMetadata(
  input: ConnectedAppFirecrawlMetadataInput,
): void {
  for (const value of [
    input.latencyMs,
    input.requestBytes,
    input.responseBytes,
    input.resultCount,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        "Firecrawl settlement metadata must be non-negative integers.",
      )
    }
  }
  if (
    !Number.isInteger(input.status) ||
    input.status < 100 ||
    input.status > 599
  ) {
    throw new Error("Firecrawl settlement status must be an HTTP status code.")
  }
}

function connectionStatus(value: string): AdminConnectedAppConnectionStatus {
  if (
    value === "connected" ||
    value === "degraded" ||
    value === "not_connected"
  ) {
    return value
  }
  throw new Error("Firecrawl storage contains an invalid connection status.")
}

function firecrawlStatus(value: string): "disabled" | "enabled" {
  if (value === "disabled" || value === "enabled") {
    return value
  }
  throw new Error("Firecrawl storage contains an invalid lifecycle status.")
}

function credentialStatus(value: string): FirecrawlCredentialRecord["status"] {
  if (value === "active" || value === "retiring" || value === "revoked") {
    return value
  }
  throw new Error("Firecrawl storage contains an invalid credential status.")
}

async function mutationAudit(
  actor: Actor,
  action: string,
  applicationId: string,
  credentialRecordId?: string,
): Promise<void> {
  await emitAudit({
    action,
    applicationId,
    credentialRecordId,
    keycloakSubjectId: actor.subject,
    outcome: "succeeded",
    sourceSystem: "console",
  })
}

function auditValues(input: {
  action: string
  applicationId: string
  credentialRecordId?: string
  keycloakSubjectId: string
  occurredAt: Date
  sourceSystem?: "console" | "lifecycle"
}) {
  return {
    action: input.action,
    applicationId: input.applicationId,
    correlationId: randomUUID(),
    credentialPrefix: null,
    credentialRecordId: input.credentialRecordId ?? null,
    id: randomUUID(),
    keycloakSubjectId: input.keycloakSubjectId,
    occurredAt: input.occurredAt,
    outcome: "succeeded" as const,
    recoveryReasonCode: null,
    sourceSystem: input.sourceSystem ?? ("console" as const),
  }
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
