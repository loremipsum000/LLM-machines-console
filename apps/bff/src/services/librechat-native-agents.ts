import { MongoClient } from "mongodb"
import type {
  AdminLibreChatAgentPosture,
  AdminLibreChatNativeAgent,
  HubSourceStatus,
} from "@llm-machines/contracts"
import type { Actor } from "../auth/persona"
import { getAdminConnectorRegistryReadModel } from "./admin-connector-registry"
import { emitAudit } from "./audit"

interface LibreChatAgentMirrorConfig {
  dbName: string
  url?: string
}

interface LibreChatAgentDocument {
  _id?: unknown
  author?: unknown
  createdAt?: unknown
  id?: unknown
  name?: unknown
  projectIds?: unknown
  updatedAt?: unknown
}

interface LibreChatCollection<T> {
  find(
    filter: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): {
    sort(sort: Record<string, 1 | -1>): {
      limit(limit: number): {
        toArray(): Promise<T[]>
      }
    }
  }
}

interface LibreChatDatabase {
  collection<T>(name: string): LibreChatCollection<T>
}

let cachedClient: MongoClient | null = null
let cachedUrl: string | null = null

export async function getLibreChatAgentPosture(
  actor: Actor,
): Promise<AdminLibreChatAgentPosture> {
  const generatedAt = new Date().toISOString()
  const registry = await getAdminConnectorRegistryReadModel()
  const runnableItems = registry.items.filter(
    (item) => item.runtimeSetup.runnable,
  )
  const blockedItems = registry.items.filter(
    (item) =>
      !item.runtimeSetup.runnable ||
      item.effectiveVettingStatus === "blocked" ||
      item.effectiveVettingStatus === "disabled",
  )
  const mirroredAgents = await readLibreChatNativeAgents()
  const sourceStatus = agentPostureSourceStatus(
    registry.sourceStatus,
    mirroredAgents.status,
  )

  await emitAudit({
    actorId: actor.subject,
    action: "admin.librechat_agents.posture.read",
    targetType: "librechat.native_agents",
    targetId: "posture",
    metadata: {
      enabled: true,
      memoryEnabled: false,
      mcpMode: "catalog_only",
      mirroredAgentCount: mirroredAgents.items.length,
      runnableConnectorCount: runnableItems.length,
      blockedConnectorCount: blockedItems.length,
    },
  })

  return {
    generatedAt,
    sourceStatus,
    enabled: true,
    memoryEnabled: false,
    creatorPolicy: "builders_admins",
    modelEndpoint: "bff_litellm",
    mcpMode: "catalog_only",
    mcpGateway: {
      sourceStatus: registry.sourceStatus,
      runnableCount: runnableItems.length,
      blockedCount: blockedItems.length,
      exposedConnectorIds: runnableItems.map((item) => item.id),
    },
    mirroredAgents: mirroredAgents.items,
    recentAuditHref: "#audit-log-deferred",
  }
}

export async function closeLibreChatNativeAgentClientForTest(): Promise<void> {
  const client = cachedClient
  cachedClient = null
  cachedUrl = null
  await client?.close()
}

async function readLibreChatNativeAgents(): Promise<{
  items: AdminLibreChatNativeAgent[]
  status: HubSourceStatus
}> {
  const config = getLibreChatAgentMirrorConfig()
  if (!config.url) {
    return { items: [], status: "not_configured" }
  }

  try {
    const db = await getLibreChatDatabase(config)
    const rows = await db
      .collection<LibreChatAgentDocument>("agents")
      .find(
        {},
        {
          projection: {
            _id: 1,
            author: 1,
            createdAt: 1,
            id: 1,
            name: 1,
            projectIds: 1,
            updatedAt: 1,
          },
        },
      )
      .sort({ updatedAt: -1 })
      .limit(25)
      .toArray()

    return {
      items: rows.flatMap(parseLibreChatAgent),
      status: "ok",
    }
  } catch {
    return { items: [], status: "unavailable" }
  }
}

function getLibreChatAgentMirrorConfig(): LibreChatAgentMirrorConfig {
  return {
    dbName: process.env.LIBRECHAT_MONGO_DB?.trim() || "LibreChat",
    url: process.env.LIBRECHAT_MONGO_URL?.trim() || undefined,
  }
}

async function getLibreChatDatabase(
  config: LibreChatAgentMirrorConfig,
): Promise<LibreChatDatabase> {
  if (!config.url) {
    throw new Error("LibreChat Mongo URL is not configured.")
  }

  if (!cachedClient || cachedUrl !== config.url) {
    await cachedClient?.close()
    cachedClient = new MongoClient(config.url, {
      serverSelectionTimeoutMS: 1500,
    })
    cachedUrl = config.url
  }

  await cachedClient.connect()
  return cachedClient.db(config.dbName)
}

function parseLibreChatAgent(
  row: LibreChatAgentDocument,
): AdminLibreChatNativeAgent[] {
  const id = stringValue(row.id) ?? stringValue(row._id)
  const name = stringValue(row.name)
  if (!id || !name) {
    return []
  }

  return [
    {
      id,
      name,
      authorId: stringValue(row.author) ?? null,
      visibility: visibilityFor(row),
      updatedAt:
        dateValue(row.updatedAt)?.toISOString() ??
        dateValue(row.createdAt)?.toISOString() ??
        null,
    },
  ]
}

function visibilityFor(
  row: LibreChatAgentDocument,
): AdminLibreChatNativeAgent["visibility"] {
  if (Array.isArray(row.projectIds) && row.projectIds.length > 0) {
    return "shared"
  }
  return "unknown"
}

function agentPostureSourceStatus(
  registryStatus: HubSourceStatus,
  mirrorStatus: HubSourceStatus,
): HubSourceStatus {
  if (registryStatus === "unavailable") {
    return "unavailable"
  }
  if (mirrorStatus === "unavailable") {
    return "degraded"
  }
  return registryStatus === "ok" && mirrorStatus === "ok" ? "ok" : "degraded"
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function dateValue(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
  }
  if (typeof value !== "string") {
    return undefined
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}
