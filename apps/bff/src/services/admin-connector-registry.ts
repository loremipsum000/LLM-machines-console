import { createHash, randomUUID } from "node:crypto"
import { desc, eq } from "drizzle-orm"
import type {
  AdminMcpServerConnectionTestRequest,
  AdminMcpServerConnectionTestResponse,
  AdminMcpServerDetail,
  AdminTeamGroupUnlock,
  AdminConnectorRegistryItem,
  AdminConnectorRegistryPosture,
  AdminConnectorRegistryResponse,
  AdminConnectorRuntimeSetup,
  AdminConnectorVettingChecklist,
  AdminConnectorVettingDecision,
  AdminConnectorVettingDecisionRecord,
  AdminConnectorVettingDecisionRequest,
  AgentSandboxProfile,
  ConnectorVettingStatus,
  CreateAdminMcpServerRequest,
  HubSourceStatus,
  McpCatalogEntry,
  UpdateAdminMcpServerRequest,
} from "@llm-machines/contracts"
import {
  adminConnectorVettingChecklistSchema,
  adminConnectorVettingDecisionSchema,
  agentSandboxProfileSchema,
} from "@llm-machines/contracts"
import type { Actor } from "../auth/persona"
import { getMcpCatalogEntries } from "../catalog/signed-catalog"
import { getDb } from "../db/client"
import {
  adminMcpServers,
  connectorVettingDecisions,
  egressApprovals,
} from "../db/schema"
import { emitAudit } from "./audit"
import {
  egressMaxBytes,
  egressTimeoutMs,
  fetchPublicHttpEndpoint,
  validatePublicHttpEndpoint,
} from "./security/url-safety"
import { upsertActorUser } from "./users"

export interface ConnectorRegistryFilters {
  query?: string
}

export type ConnectorVettingDecisionResult =
  | { status: "updated"; item: AdminConnectorRegistryItem }
  | { status: "not_found" }
  | { status: "invalid"; detail: string }
  | { status: "catalog_unavailable"; detail: string }

export type AdminMcpServerCreateResult =
  | { status: "created"; item: AdminConnectorRegistryItem }
  | { status: "duplicate"; detail: string }
  | { status: "invalid"; detail: string }
  | { status: "catalog_unavailable"; detail: string }

export type AdminMcpServerDetailResult =
  | { status: "found"; detail: AdminMcpServerDetail }
  | { status: "managed" }
  | { status: "not_found" }

export type AdminMcpServerUpdateResult =
  | { status: "updated"; item: AdminConnectorRegistryItem }
  | { status: "invalid"; detail: string }
  | { status: "managed" }
  | { status: "not_found" }

export interface AdminMcpServerRecord {
  accessGroups: string[]
  accessLevel: "read_only" | "read_write"
  authMode: "bearer" | "none"
  bearerTokenSecretRef: string | null
  chatCommand: string
  createdAt: string
  createdBy: string
  description: string
  endpointUrl: string | null
  id: string
  name: string
  status: "draft" | "enabled" | "disabled"
  stdioCommand: string | null
  transport: "stdio" | "url"
  updatedAt: string
  updatedBy: string
}

const memoryDecisions: AdminConnectorVettingDecisionRecord[] = []
const memoryAdminMcpServers: AdminMcpServerRecord[] = []
const reservedAdminMcpServerIds = new Set(["admin-servers"])

const approvalChecklistKeys = [
  "auditEventsReviewed",
  "dataClassesReviewed",
  "endpointsReviewed",
  "licenseReviewed",
  "runtimeSetupAcknowledged",
  "scopesReviewed",
  "secretsPlanReviewed",
  "sourceIntegrityReviewed",
] satisfies Array<keyof AdminConnectorVettingChecklist>

interface ActiveEgressApproval {
  accessMode: string
  endpointHost: string
  endpointPort: number
  expiresAt: Date | null
  profile: string
}

export async function getAdminConnectorRegistry(
  actor: Actor,
  filters: ConnectorRegistryFilters = {},
): Promise<AdminConnectorRegistryResponse> {
  const { catalogError, response } = await buildAdminConnectorRegistry(filters)

  await emitAudit({
    actorId: actor.subject,
    action: "admin.connector_registry.read",
    targetType: "mcp.catalog",
    targetId: "registry",
    metadata: {
      query: response.query,
      sourceStatus: response.sourceStatus,
      totalCount: response.summary.totalCount,
      visibleCount: response.items.length,
      ...(catalogError ? { catalogError } : {}),
    },
  })

  return response
}

export async function getAdminConnectorRegistryReadModel(
  filters: ConnectorRegistryFilters = {},
): Promise<AdminConnectorRegistryResponse> {
  const { response } = await buildAdminConnectorRegistry(filters)
  return response
}

export async function createAdminMcpServer(
  actor: Actor,
  request: CreateAdminMcpServerRequest,
): Promise<AdminMcpServerCreateResult> {
  let catalogEntries: McpCatalogEntry[]
  try {
    catalogEntries = getMcpCatalogEntries()
  } catch (error) {
    return {
      status: "catalog_unavailable",
      detail:
        error instanceof Error ? error.message : "MCP catalog unavailable.",
    }
  }

  const record = buildAdminMcpServerRecord(actor, request)
  if (reservedAdminMcpServerIds.has(record.id)) {
    return {
      status: "duplicate",
      detail: "This MCP server chat command is reserved by the BFF gateway.",
    }
  }
  if (catalogEntries.some((entry) => entry.id === record.id)) {
    return {
      status: "duplicate",
      detail: "An MCP server with this chat command already exists.",
    }
  }

  const existing = await getAdminMcpServerRecord(record.id)
  if (existing) {
    return {
      status: "duplicate",
      detail: "An MCP server with this chat command already exists.",
    }
  }

  if (request.transport === "url") {
    const endpoint = parseMcpEndpoint(request.endpointUrl ?? "")
    if (!endpoint) {
      return {
        status: "invalid",
        detail: "URL-backed MCP servers require an HTTP or HTTPS endpoint.",
      }
    }
  }

  const saved = await saveAdminMcpServerRecord(actor, record)
  const item = toRegistryItem(
    adminMcpServerRecordToCatalogEntry(saved),
    null,
    await getActiveEgressApprovals(),
  )

  await emitAudit({
    actorId: actor.subject,
    action: "admin.mcp_server.created",
    targetType: "mcp.connector",
    targetId: saved.id,
    metadata: {
      accessGroups: saved.accessGroups,
      accessLevel: saved.accessLevel,
      authMode: saved.authMode,
      chatCommand: saved.chatCommand,
      status: saved.status,
      transport: saved.transport,
    },
  })

  return { status: "created", item }
}

export async function testAdminMcpServerConnection(
  actor: Actor,
  request: AdminMcpServerConnectionTestRequest,
): Promise<AdminMcpServerConnectionTestResponse> {
  if (request.transport === "stdio") {
    const response = {
      detail:
        "STDIO MCP servers require the appliance runtime launcher and cannot be tested through URL reachability.",
      discoveredTools: [],
      status: "unsupported" as const,
    }
    await emitAudit({
      actorId: actor.subject,
      action: "admin.mcp_server.test_connection",
      targetType: "mcp.connector",
      targetId: connectorIdFromChatCommand(request.chatCommand),
      metadata: {
        status: response.status,
        transport: request.transport,
      },
    })
    return response
  }

  const endpointValidation = validatePublicHttpEndpoint(
    request.endpointUrl ?? "",
  )
  if (!endpointValidation.ok || !endpointValidation.url) {
    return {
      detail:
        endpointValidation.detail ??
        "URL-backed MCP servers require a public HTTP or HTTPS endpoint.",
      discoveredTools: [],
      status: "failed",
    }
  }

  const headers = new Headers({ "Content-Type": "application/json" })
  let bearerToken: string | null = null
  if (request.authMode === "bearer") {
    const secretRef = request.bearerTokenSecretRef ?? ""
    bearerToken = process.env[secretRef]?.trim() ?? ""
    if (!bearerToken) {
      return {
        detail: `Bearer secret ${secretRef} is not configured in the BFF environment.`,
        discoveredTools: [],
        status: "failed",
      }
    }
    headers.set("Authorization", `Bearer ${bearerToken}`)
  }

  try {
    const response = await fetchPublicHttpEndpoint(
      endpointValidation.url.toString(),
      {
        body: JSON.stringify({
          id: "console-test",
          jsonrpc: "2.0",
          method: "tools/list",
        }),
        headers,
        method: "POST",
        maxBytes: egressMaxBytes("BFF_MCP_MAX_RESPONSE_BYTES", 1024 * 1024),
        timeoutMs: egressTimeoutMs("BFF_MCP_FETCH_TIMEOUT_MS", 5000),
      },
    )
    if (!response.response.ok) {
      throw new Error("MCP endpoint returned an HTTP error.")
    }
    const payload = parseMcpJsonResponse(response.bodyText)
    if (!isMcpJsonRpcResponse(payload)) {
      throw new Error("MCP endpoint returned an invalid JSON-RPC response.")
    }
    const discoveredTools = redactMcpConnectionTestSecrets(
      extractMcpToolNames(payload),
      [bearerToken, bearerToken ? `Bearer ${bearerToken}` : null],
    )
    const result = {
      detail: `MCP endpoint responded with ${discoveredTools.length} tool(s).`,
      discoveredTools,
      status: "passed" as const,
    }
    await emitAudit({
      actorId: actor.subject,
      action: "admin.mcp_server.test_connection",
      targetType: "mcp.connector",
      targetId: connectorIdFromChatCommand(request.chatCommand),
      metadata: {
        discoveredTools,
        status: result.status,
        transport: request.transport,
      },
    })
    return result
  } catch {
    const result = {
      detail: "MCP endpoint test failed.",
      discoveredTools: [],
      status: "failed" as const,
    }
    await emitAudit({
      actorId: actor.subject,
      action: "admin.mcp_server.test_connection",
      targetType: "mcp.connector",
      targetId: connectorIdFromChatCommand(request.chatCommand),
      metadata: {
        status: result.status,
        transport: request.transport,
      },
    })
    return result
  }
}

export async function getAdminMcpServerRecord(
  connectorId: string,
): Promise<AdminMcpServerRecord | null> {
  const db = getDb()
  if (db) {
    const rows = await db
      .select()
      .from(adminMcpServers)
      .where(eq(adminMcpServers.id, connectorId))
      .limit(1)
    return rows[0] ? adminMcpServerRecordFromRow(rows[0]) : null
  }

  const record = memoryAdminMcpServers.find((item) => item.id === connectorId)
  return record ? cloneAdminMcpServerRecord(record) : null
}

export async function getAdminMcpServerDetail(
  actor: Actor,
  connectorId: string,
): Promise<AdminMcpServerDetailResult> {
  const record = await getAdminMcpServerRecord(connectorId)
  if (!record) {
    return isManagedCatalogConnector(connectorId)
      ? { status: "managed" }
      : { status: "not_found" }
  }

  await emitAudit({
    actorId: actor.subject,
    action: "admin.mcp_server.read",
    targetType: "mcp.connector",
    targetId: record.id,
    metadata: {
      supportTier: "t3",
      transport: record.transport,
    },
  })

  return { status: "found", detail: adminMcpServerRecordToDetail(record) }
}

export async function updateAdminMcpServer(
  actor: Actor,
  connectorId: string,
  request: UpdateAdminMcpServerRequest,
): Promise<AdminMcpServerUpdateResult> {
  const existing = await getAdminMcpServerRecord(connectorId)
  if (!existing) {
    return isManagedCatalogConnector(connectorId)
      ? { status: "managed" }
      : { status: "not_found" }
  }

  if (request.transport !== existing.transport) {
    return {
      status: "invalid",
      detail: "MCP server transport cannot be changed after creation.",
    }
  }
  if (request.transport === "stdio" && request.status === "enabled") {
    return {
      status: "invalid",
      detail:
        "STDIO MCP servers cannot be enabled until the appliance runtime launcher exists.",
    }
  }
  if (
    request.transport === "url" &&
    !parseMcpEndpoint(request.endpointUrl ?? "")
  ) {
    return {
      status: "invalid",
      detail: "URL-backed MCP servers require an HTTP or HTTPS endpoint.",
    }
  }

  const updated = await updateAdminMcpServerRecord(actor, {
    ...existing,
    accessGroups: normalizeAccessGroups(request.accessGroups),
    accessLevel: request.accessLevel,
    authMode: request.authMode,
    bearerTokenSecretRef:
      request.authMode === "bearer"
        ? (request.bearerTokenSecretRef ?? null)
        : null,
    description: request.description,
    endpointUrl:
      request.transport === "url" ? (request.endpointUrl ?? null) : null,
    name: request.name,
    status: request.status,
    stdioCommand:
      request.transport === "stdio" ? (request.stdioCommand ?? null) : null,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.subject,
  })
  const item = toRegistryItem(
    adminMcpServerRecordToCatalogEntry(updated),
    null,
    await getActiveEgressApprovals(),
  )

  await emitAudit({
    actorId: actor.subject,
    action: "admin.mcp_server.updated",
    targetType: "mcp.connector",
    targetId: updated.id,
    metadata: {
      accessGroups: updated.accessGroups,
      accessLevel: updated.accessLevel,
      authMode: updated.authMode,
      status: updated.status,
      supportTier: "t3",
      transport: updated.transport,
    },
  })

  return { status: "updated", item }
}

export async function getEnabledAdminMcpServerRuntimeRecords(): Promise<
  AdminMcpServerRecord[]
> {
  return (await getAdminMcpServerRecords()).filter(
    (record) => record.status === "enabled" && record.transport === "url",
  )
}

async function buildAdminConnectorRegistry(
  filters: ConnectorRegistryFilters = {},
): Promise<{
  catalogError: string | null
  response: AdminConnectorRegistryResponse
}> {
  const query = filters.query?.trim() || null
  let entries: McpCatalogEntry[] = []
  let sourceStatus: HubSourceStatus = "ok"
  let catalogError: string | null = null

  try {
    entries = getMcpCatalogEntries()
    sourceStatus = entries.some(
      (entry) => postureFor(entry.vettingStatus) !== "approved",
    )
      ? "degraded"
      : "ok"
  } catch (error) {
    sourceStatus = "unavailable"
    catalogError =
      error instanceof Error ? error.message : "Catalog unavailable"
  }

  const adminMcpServerEntries = (await getAdminMcpServerRecords()).map(
    adminMcpServerRecordToCatalogEntry,
  )
  const latestDecisions = await getLatestConnectorVettingDecisions()
  const activeEgressApprovals = await getActiveEgressApprovals()
  const allEntries = [...entries, ...adminMcpServerEntries]
  const allItems = allEntries.map((entry) =>
    toRegistryItem(
      entry,
      latestDecisions.get(entry.id) ?? null,
      activeEgressApprovals,
    ),
  )
  const items = allItems
    .filter((item) => matchesQuery(item, query))
    .sort(sortRegistryItems)
  const summary = summarize(allItems)
  if (sourceStatus !== "unavailable") {
    sourceStatus = allItems.every(
      (item) => item.posture === "approved" && item.runtimeSetup.runnable,
    )
      ? "ok"
      : "degraded"
  }

  return {
    catalogError,
    response: {
      generatedAt: new Date().toISOString(),
      query,
      sourceStatus,
      summary,
      items,
    },
  }
}

export async function adminMcpServerUnlocksForAccessGroup(
  groupName: string,
): Promise<AdminTeamGroupUnlock[]> {
  const records = await getAdminMcpServerRecords()
  return records
    .filter((record) => record.status !== "disabled")
    .filter((record) => adminMcpServerMatchesAccessGroup(record, groupName))
    .map((record) => ({
      href: `/applications/mcp/${encodeURIComponent(record.id)}/settings`,
      id: record.id,
      name: record.name,
      type: "mcp_server" as const,
    }))
}

export async function renameAdminMcpServerAccessGroup(
  actor: Actor,
  oldName: string,
  newName: string,
): Promise<number> {
  const records = await getAdminMcpServerRecords()
  let changedCount = 0
  for (const record of records) {
    const accessGroups = renameAccessGroup(record.accessGroups, oldName, newName)
    if (sameAccessGroups(record.accessGroups, accessGroups)) {
      continue
    }
    await updateAdminMcpServerRecord(actor, {
      ...record,
      accessGroups,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.subject,
    })
    changedCount += 1
  }
  if (changedCount > 0) {
    await emitAudit({
      actorId: actor.subject,
      action: "admin.mcp_server.access_group_renamed",
      targetType: "admin.mcp_server",
      targetId: oldName,
      metadata: {
        changedCount,
        newName,
        oldName,
      },
    })
  }
  return changedCount
}

export async function decideAdminConnectorVetting(
  actor: Actor,
  connectorId: string,
  request: AdminConnectorVettingDecisionRequest,
): Promise<ConnectorVettingDecisionResult> {
  let entries: McpCatalogEntry[]
  try {
    entries = getMcpCatalogEntries()
  } catch (error) {
    return {
      status: "catalog_unavailable",
      detail:
        error instanceof Error ? error.message : "MCP catalog unavailable.",
    }
  }

  const entry = entries.find((candidate) => candidate.id === connectorId)
  if (!entry) {
    return { status: "not_found" }
  }

  const invalidDetail = validateDecision(entry, request)
  if (invalidDetail) {
    return {
      status: "invalid",
      detail: invalidDetail,
    }
  }

  const latestDecisions = await getLatestConnectorVettingDecisions()
  const previousDecision = latestDecisions.get(entry.id) ?? null
  const decision = await createConnectorVettingDecision(actor, entry, request)
  const activeEgressApprovals = await getActiveEgressApprovals()
  const item = toRegistryItem(entry, decision, activeEgressApprovals)

  await emitAudit({
    actorId: actor.subject,
    action: `admin.connector_vetting.${auditActionForDecision(
      request.decision,
    )}`,
    targetType: "mcp.connector",
    targetId: entry.id,
    reason: request.note,
    metadata: {
      decision: request.decision,
      catalogVettingStatus: entry.vettingStatus,
      reviewChecklist: request.checklist,
      previousDecision: previousDecision?.decision ?? null,
      sourceRef: entry.sourceRef,
      checksum: entry.checksum,
      requiredScopes: entry.requiredScopes,
      allowedEndpoints: entry.allowedEndpoints,
      supportTier: entry.supportTier,
      readWrite: entry.readWrite,
    },
  })

  return {
    status: "updated",
    item,
  }
}

async function createConnectorVettingDecision(
  actor: Actor,
  entry: McpCatalogEntry,
  request: AdminConnectorVettingDecisionRequest,
): Promise<AdminConnectorVettingDecisionRecord> {
  const now = new Date()
  const storageActor = getDb() ? await upsertActorUser(actor) : actor
  const decision: AdminConnectorVettingDecisionRecord = {
    id: randomUUID(),
    connectorId: entry.id,
    decision: request.decision,
    checklist: request.checklist,
    note: request.note,
    decidedBy: storageActor.subject,
    decidedAt: now.toISOString(),
    sourceRef: entry.sourceRef,
    checksum: entry.checksum,
    requiredScopes: entry.requiredScopes,
    allowedEndpoints: entry.allowedEndpoints,
  }

  const db = getDb()
  if (db) {
    await db.insert(connectorVettingDecisions).values({
      id: decision.id,
      connectorId: decision.connectorId,
      decision: decision.decision,
      checklist: decision.checklist,
      note: decision.note,
      decidedBy: decision.decidedBy,
      sourceRef: decision.sourceRef,
      checksum: decision.checksum,
      requiredScopes: decision.requiredScopes,
      allowedEndpoints: decision.allowedEndpoints,
      createdAt: now,
    })
  } else {
    memoryDecisions.unshift(decision)
  }

  return decision
}

async function getAdminMcpServerRecords(): Promise<AdminMcpServerRecord[]> {
  const db = getDb()
  if (db) {
    const rows = await db
      .select()
      .from(adminMcpServers)
      .orderBy(desc(adminMcpServers.updatedAt))
    return rows.map(adminMcpServerRecordFromRow)
  }

  return memoryAdminMcpServers.map(cloneAdminMcpServerRecord)
}

async function saveAdminMcpServerRecord(
  actor: Actor,
  record: AdminMcpServerRecord,
): Promise<AdminMcpServerRecord> {
  const db = getDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    await db.insert(adminMcpServers).values({
      accessGroups: record.accessGroups,
      accessLevel: record.accessLevel,
      authMode: record.authMode,
      bearerTokenSecretRef: record.bearerTokenSecretRef,
      chatCommand: record.chatCommand,
      createdAt: new Date(record.createdAt),
      createdBy: storageActor.subject,
      description: record.description,
      displayName: record.name,
      endpointUrl: record.endpointUrl,
      id: record.id,
      status: record.status,
      stdioCommand: record.stdioCommand,
      transport: record.transport,
      updatedAt: new Date(record.updatedAt),
      updatedBy: storageActor.subject,
    })
    return {
      ...record,
      createdBy: storageActor.subject,
      updatedBy: storageActor.subject,
    }
  }

  memoryAdminMcpServers.unshift(cloneAdminMcpServerRecord(record))
  return cloneAdminMcpServerRecord(record)
}

async function updateAdminMcpServerRecord(
  actor: Actor,
  record: AdminMcpServerRecord,
): Promise<AdminMcpServerRecord> {
  const db = getDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    await db
      .update(adminMcpServers)
      .set({
        accessGroups: record.accessGroups,
        accessLevel: record.accessLevel,
        authMode: record.authMode,
        bearerTokenSecretRef: record.bearerTokenSecretRef,
        description: record.description,
        displayName: record.name,
        endpointUrl: record.endpointUrl,
        status: record.status,
        stdioCommand: record.stdioCommand,
        updatedAt: new Date(record.updatedAt),
        updatedBy: storageActor.subject,
      })
      .where(eq(adminMcpServers.id, record.id))
    return {
      ...record,
      updatedBy: storageActor.subject,
    }
  }

  const index = memoryAdminMcpServers.findIndex((item) => item.id === record.id)
  if (index >= 0) {
    memoryAdminMcpServers[index] = cloneAdminMcpServerRecord(record)
  }
  return cloneAdminMcpServerRecord(record)
}

function buildAdminMcpServerRecord(
  actor: Actor,
  request: CreateAdminMcpServerRequest,
): AdminMcpServerRecord {
  const now = new Date().toISOString()
  const transport = request.transport
  return {
    accessGroups: normalizeAccessGroups(request.accessGroups),
    accessLevel: request.accessLevel,
    authMode: request.authMode,
    bearerTokenSecretRef: request.bearerTokenSecretRef ?? null,
    chatCommand: request.chatCommand,
    createdAt: now,
    createdBy: actor.subject,
    description: request.description,
    endpointUrl: transport === "url" ? (request.endpointUrl ?? null) : null,
    id: connectorIdFromChatCommand(request.chatCommand),
    name: request.name,
    status:
      transport === "stdio"
        ? "draft"
        : request.saveMode === "draft"
          ? "draft"
          : "enabled",
    stdioCommand:
      transport === "stdio" ? (request.stdioCommand ?? null) : null,
    transport,
    updatedAt: now,
    updatedBy: actor.subject,
  }
}

function adminMcpServerRecordToCatalogEntry(
  record: AdminMcpServerRecord,
): McpCatalogEntry {
  const endpoint = record.endpointUrl
    ? parseMcpEndpoint(record.endpointUrl)
    : null
  const status: ConnectorVettingStatus =
    record.status === "disabled"
      ? "disabled"
      : record.status === "draft"
        ? "pending_runtime_validation"
        : record.accessLevel === "read_write"
          ? "approved_read_write"
          : "approved_read_only"
  return {
    allowedEndpoints: endpoint ? [endpoint.hostPort] : [],
    auditEvents: [`connector.${record.id}.invoke`],
    checksum: adminMcpServerChecksum(record),
    dataClasses: ["admin-configured"],
    description: record.description,
    displayName: record.name,
    id: record.id,
    lastReviewedAt: status.startsWith("approved_") ? record.updatedAt : null,
    license: "Local admin configuration",
    maintainer: "Console Admin",
    readWrite: record.accessLevel,
    requiredScopes: [record.chatCommand],
    runtimeProfile:
      record.transport === "url" ? "admin-url-mcp" : "admin-stdio-mcp",
    secretsRequired:
      record.authMode === "bearer" && record.bearerTokenSecretRef
        ? [record.bearerTokenSecretRef]
        : [],
    sourceRef: `admin/mcp-servers/${record.id}`,
    supportTier: "t3",
    version: "0.1.0",
    vettingStatus: status,
  }
}

function adminMcpServerRecordToDetail(
  record: AdminMcpServerRecord,
): AdminMcpServerDetail {
  return {
    accessGroups: [...record.accessGroups],
    accessLevel: record.accessLevel,
    auditHref: "#audit-log-deferred",
    authMode: record.authMode,
    bearerTokenSecretRef: record.bearerTokenSecretRef,
    chatCommand: record.chatCommand,
    createdAt: record.createdAt,
    description: record.description,
    endpointUrl: record.endpointUrl,
    id: record.id,
    name: record.name,
    status: record.status,
    stdioCommand: record.stdioCommand,
    supportTier: "t3",
    transport: record.transport,
    updatedAt: record.updatedAt,
  }
}

function isManagedCatalogConnector(connectorId: string): boolean {
  try {
    return getMcpCatalogEntries().some((entry) => entry.id === connectorId)
  } catch {
    return false
  }
}

function adminMcpServerRecordFromRow(
  row: typeof adminMcpServers.$inferSelect,
): AdminMcpServerRecord {
  return {
    accessGroups: stringArrayFromJson(row.accessGroups),
    accessLevel: row.accessLevel === "read_write" ? "read_write" : "read_only",
    authMode: row.authMode === "bearer" ? "bearer" : "none",
    bearerTokenSecretRef: row.bearerTokenSecretRef,
    chatCommand: row.chatCommand,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    description: row.description,
    endpointUrl: row.endpointUrl,
    id: row.id,
    name: row.displayName,
    status:
      row.status === "enabled" || row.status === "disabled"
        ? row.status
        : "draft",
    stdioCommand: row.stdioCommand,
    transport: row.transport === "stdio" ? "stdio" : "url",
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  }
}

function cloneAdminMcpServerRecord(
  record: AdminMcpServerRecord,
): AdminMcpServerRecord {
  return {
    ...record,
    accessGroups: [...record.accessGroups],
  }
}

async function getLatestConnectorVettingDecisions(): Promise<
  Map<string, AdminConnectorVettingDecisionRecord>
> {
  const latest = new Map<string, AdminConnectorVettingDecisionRecord>()
  const db = getDb()
  if (db) {
    const rows = await db
      .select()
      .from(connectorVettingDecisions)
      .orderBy(desc(connectorVettingDecisions.createdAt))
    for (const row of rows) {
      if (latest.has(row.connectorId)) {
        continue
      }
      latest.set(row.connectorId, {
        id: row.id,
        connectorId: row.connectorId,
        decision: adminConnectorVettingDecisionSchema.parse(row.decision),
        checklist: adminConnectorVettingChecklistSchema.parse(row.checklist),
        note: row.note,
        decidedBy: row.decidedBy,
        decidedAt: row.createdAt.toISOString(),
        sourceRef: row.sourceRef,
        checksum: row.checksum,
        requiredScopes: stringArrayFromJson(row.requiredScopes),
        allowedEndpoints: stringArrayFromJson(row.allowedEndpoints),
      })
    }
    return latest
  }

  for (const decision of memoryDecisions) {
    if (!latest.has(decision.connectorId)) {
      latest.set(decision.connectorId, decision)
    }
  }
  return latest
}

function toRegistryItem(
  entry: McpCatalogEntry,
  localDecision: AdminConnectorVettingDecisionRecord | null,
  activeEgressApprovals: ActiveEgressApproval[] = [],
): AdminConnectorRegistryItem {
  const effectiveVettingStatus = localDecision?.decision ?? entry.vettingStatus
  const posture = postureFor(effectiveVettingStatus)
  const runtimeSetup = buildRuntimeSetup(
    entry,
    effectiveVettingStatus,
    activeEgressApprovals,
  )

  return {
    ...entry,
    effectiveVettingStatus,
    localDecision,
    posture,
    runtimeSetup,
    sourceStatus: runtimeSetup.runnable ? "ok" : "degraded",
    reviewHref: `/resources/mcp_connector/${entry.id}`,
    auditHref: "#audit-log-deferred",
  }
}

async function getActiveEgressApprovals(): Promise<ActiveEgressApproval[]> {
  const db = getDb()
  if (!db) {
    return []
  }

  const now = new Date()
  const rows = await db.select().from(egressApprovals)
  return rows
    .filter((row) => row.status === "active")
    .filter((row) => !row.expiresAt || row.expiresAt > now)
    .map((row) => ({
      accessMode: row.accessMode,
      endpointHost: row.endpointHost,
      endpointPort: row.endpointPort,
      expiresAt: row.expiresAt,
      profile: row.profile,
    }))
}

function buildRuntimeSetup(
  entry: McpCatalogEntry,
  effectiveVettingStatus: ConnectorVettingStatus,
  activeEgressApprovals: ActiveEgressApproval[],
): AdminConnectorRuntimeSetup {
  const setupHref = "/applications"
  if (
    effectiveVettingStatus === "blocked" ||
    effectiveVettingStatus === "disabled" ||
    effectiveVettingStatus === "deprecated"
  ) {
    return {
      activeEgress: [],
      detail: "Connector is blocked, disabled, or deprecated by local policy.",
      missingEgress: [],
      missingSecrets: [],
      runnable: false,
      setupHref,
      status: "blocked_by_policy",
    }
  }

  if (!isApprovedVettingStatus(effectiveVettingStatus)) {
    return {
      activeEgress: [],
      detail: "Connector approval is required before runtime setup can run.",
      missingEgress: [],
      missingSecrets: [],
      runnable: false,
      setupHref,
      status: "needs_vetting",
    }
  }

  const missingSecrets = entry.secretsRequired.filter(
    (secret) => !hasConfiguredSecret(secret),
  )
  if (missingSecrets.length > 0) {
    return {
      activeEgress: [],
      detail: `Missing appliance secret configuration: ${missingSecrets.join(
        ", ",
      )}.`,
      missingEgress: [],
      missingSecrets,
      runnable: false,
      setupHref,
      status: "missing_secrets",
    }
  }

  const profile = parseScopedEgressProfile(entry.runtimeProfile)
  if (profile) {
    const activeEgress = entry.allowedEndpoints.filter((endpoint) =>
      hasMatchingActiveEgress(
        endpoint,
        profile,
        entry.readWrite,
        activeEgressApprovals,
      ),
    )
    const missingEgress = entry.allowedEndpoints.filter(
      (endpoint) => !activeEgress.includes(endpoint),
    )
    if (missingEgress.length > 0) {
      return {
        activeEgress,
        detail: `Missing active scoped egress approval: ${missingEgress.join(
          ", ",
        )}.`,
        missingEgress,
        missingSecrets: [],
        runnable: false,
        setupHref,
        status: "missing_egress",
      }
    }

    return {
      activeEgress,
      detail: "Connector approval, secrets, and scoped egress are ready.",
      missingEgress: [],
      missingSecrets: [],
      runnable: true,
      setupHref,
      status: "ready",
    }
  }

  if (entry.runtimeProfile !== "managed-tool-proxy") {
    if (entry.runtimeProfile === "admin-url-mcp") {
      return {
        activeEgress: entry.allowedEndpoints,
        detail: "Admin-created URL MCP server is approved and routed through the BFF gateway.",
        missingEgress: [],
        missingSecrets: [],
        runnable: true,
        setupHref,
        status: "ready",
      }
    }

    return {
      activeEgress: [],
      detail: `Runtime profile ${entry.runtimeProfile} is not connected to a managed setup gate.`,
      missingEgress: [],
      missingSecrets: [],
      runnable: false,
      setupHref,
      status: "unsupported_runtime",
    }
  }

  return {
    activeEgress: [],
    detail: "Managed local connector is approved and ready.",
    missingEgress: [],
    missingSecrets: [],
    runnable: true,
    setupHref,
    status: "ready",
  }
}

function isApprovedVettingStatus(status: ConnectorVettingStatus): boolean {
  return status === "approved_read_only" || status === "approved_read_write"
}

function hasConfiguredSecret(name: string): boolean {
  return Boolean(process.env[name]?.trim())
}

function parseScopedEgressProfile(value: string): AgentSandboxProfile | null {
  const parsed = agentSandboxProfileSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function hasMatchingActiveEgress(
  endpoint: string,
  profile: AgentSandboxProfile,
  accessMode: "read_only" | "read_write",
  activeEgressApprovals: ActiveEgressApproval[],
): boolean {
  const parsed = parseAllowedEndpoint(endpoint)
  if (!parsed) {
    return false
  }
  return activeEgressApprovals.some(
    (approval) =>
      approval.profile === profile &&
      approval.accessMode === accessMode &&
      approval.endpointHost === parsed.host &&
      approval.endpointPort === parsed.port,
  )
}

function parseAllowedEndpoint(
  endpoint: string,
): { host: string; port: number } | null {
  const [host, portValue] = endpoint.split(":")
  if (!host || !portValue) {
    return null
  }
  const port = Number(portValue)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null
  }
  return { host, port }
}

function parseMcpEndpoint(
  endpointUrl: string,
): { hostPort: string; href: string } | null {
  const validation = validatePublicHttpEndpoint(endpointUrl)
  if (!validation.ok || !validation.url) {
    return null
  }
  const endpoint = validation.url
  const port =
    endpoint.port ||
    (endpoint.protocol === "https:" ? "443" : "80")
  return {
    hostPort: `${endpoint.hostname}:${port}`,
    href: endpoint.toString(),
  }
}

function parseMcpJsonResponse(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText)
  } catch {
    throw new Error("MCP endpoint returned invalid JSON.")
  }
}

function isMcpJsonRpcResponse(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  return record.jsonrpc === "2.0" && ("result" in record || "error" in record)
}

function connectorIdFromChatCommand(chatCommand: string): string {
  return chatCommand.replace(/^@/, "").toLowerCase()
}

function normalizeAccessGroups(groups: string[]): string[] {
  const normalized = groups
    .map((group) => group.trim())
    .filter(Boolean)
    .filter((group) => group !== "Everyone")
  return [...new Set(normalized)]
}

function adminMcpServerMatchesAccessGroup(
  record: AdminMcpServerRecord,
  groupName: string,
): boolean {
  if (isEveryoneAccessGroup(groupName)) {
    return record.accessGroups.length === 0
  }
  const normalized = groupName.toLowerCase()
  return record.accessGroups.some((group) => group.toLowerCase() === normalized)
}

function renameAccessGroup(
  groups: string[],
  oldName: string,
  newName: string,
): string[] {
  const oldNormalized = oldName.toLowerCase()
  const renamed = groups.map((group) =>
    group.toLowerCase() === oldNormalized ? newName : group,
  )
  return normalizeAccessGroups(renamed)
}

function sameAccessGroups(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function isEveryoneAccessGroup(groupName: string): boolean {
  return groupName.toLowerCase() === "everyone"
}

function adminMcpServerChecksum(record: AdminMcpServerRecord): string {
  const redacted = {
    accessGroups: record.accessGroups,
    accessLevel: record.accessLevel,
    authMode: record.authMode,
    chatCommand: record.chatCommand,
    description: record.description,
    endpointHost: record.endpointUrl ? parseMcpEndpoint(record.endpointUrl) : null,
    id: record.id,
    name: record.name,
    status: record.status,
    transport: record.transport,
  }
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(redacted))
    .digest("hex")}`
}

function extractMcpToolNames(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return []
  }
  const result = "result" in payload ? payload.result : undefined
  if (!result || typeof result !== "object" || !("tools" in result)) {
    return []
  }
  const tools = result.tools
  if (!Array.isArray(tools)) {
    return []
  }
  return tools
    .map((tool) =>
      tool && typeof tool === "object" && "name" in tool
        ? tool.name
        : undefined,
    )
    .filter((name): name is string => typeof name === "string" && name.length > 0)
}

function redactMcpConnectionTestSecrets(
  values: string[],
  secrets: Array<string | null>,
): string[] {
  const activeSecrets = secrets
    .filter((secret): secret is string => Boolean(secret))
    .sort((left, right) => right.length - left.length)
  if (activeSecrets.length === 0) {
    return values
  }
  return values.map((value) =>
    activeSecrets.reduce(
      (redacted, secret) => redacted.split(secret).join("[redacted]"),
      value,
    ),
  )
}

function summarize(items: AdminConnectorRegistryItem[]) {
  return items.reduce(
    (summary, entry) => {
      const posture = entry.posture
      summary.totalCount += 1
      if (posture === "approved") {
        summary.approvedCount += 1
      }
      if (posture === "review_required") {
        summary.pendingCount += 1
      }
      if (posture === "blocked") {
        summary.blockedCount += 1
      }
      if (entry.secretsRequired.length > 0) {
        summary.secretsRequiredCount += 1
      }
      if (entry.supportTier !== "t1") {
        summary.t2T3Count += 1
      }
      return summary
    },
    {
      totalCount: 0,
      approvedCount: 0,
      pendingCount: 0,
      blockedCount: 0,
      secretsRequiredCount: 0,
      t2T3Count: 0,
    },
  )
}

function postureFor(
  status: ConnectorVettingStatus | AdminConnectorVettingDecision,
): AdminConnectorRegistryPosture {
  switch (status) {
    case "approved_read_only":
    case "approved_read_write":
      return "approved"
    case "blocked":
      return "blocked"
    case "disabled":
      return "disabled"
    case "deprecated":
      return "deprecated"
    default:
      return "review_required"
  }
}

function validateDecision(
  entry: McpCatalogEntry,
  request: AdminConnectorVettingDecisionRequest,
): string | null {
  const decision = request.decision
  if (decision === "approved_read_write" && entry.readWrite !== "read_write") {
    return "This connector is cataloged as read-only, so it cannot receive a read/write approval."
  }
  if (decision.startsWith("approved_") && entry.allowedEndpoints.length === 0) {
    return "Endpoint allowlist is required before approval."
  }
  if (
    decision.startsWith("approved_") &&
    !isApprovalChecklistComplete(request)
  ) {
    return "Connector approvals require every review checklist assertion to be completed."
  }
  return null
}

function isApprovalChecklistComplete(
  request: AdminConnectorVettingDecisionRequest,
): boolean {
  return approvalChecklistKeys.every((key) => request.checklist[key])
}

function matchesQuery(
  item: AdminConnectorRegistryItem,
  query: string | null,
): boolean {
  if (!query) {
    return true
  }
  const haystack = [
    item.id,
    item.displayName,
    item.description,
    item.maintainer,
    item.supportTier,
    item.vettingStatus,
    item.effectiveVettingStatus,
    item.localDecision?.note,
    item.localDecision?.decision,
    item.posture,
    item.readWrite,
    item.runtimeProfile,
    item.sourceRef,
    item.license,
    ...item.requiredScopes,
    ...item.allowedEndpoints,
    ...item.dataClasses,
    ...item.auditEvents,
    ...item.secretsRequired,
  ]
    .join(" ")
    .toLowerCase()

  return haystack.includes(query.toLowerCase())
}

function sortRegistryItems(
  left: AdminConnectorRegistryItem,
  right: AdminConnectorRegistryItem,
): number {
  const leftRank = postureRank(left.effectiveVettingStatus)
  const rightRank = postureRank(right.effectiveVettingStatus)
  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }
  return left.displayName.localeCompare(right.displayName)
}

function postureRank(status: ConnectorVettingStatus): number {
  if (status === "blocked") {
    return 0
  }
  if (status.startsWith("pending_") || status === "draft") {
    return 1
  }
  if (status === "disabled") {
    return 2
  }
  if (status === "deprecated") {
    return 3
  }
  return 4
}

function auditActionForDecision(
  decision: AdminConnectorVettingDecision,
): string {
  switch (decision) {
    case "approved_read_only":
      return "approve_read_only"
    case "approved_read_write":
      return "approve_read_write"
    case "blocked":
      return "block"
    case "disabled":
      return "disable"
  }
}

function stringArrayFromJson(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === "string")
}

export function resetConnectorVettingDecisionsForTest(): void {
  memoryDecisions.splice(0)
  memoryAdminMcpServers.splice(0)
}
