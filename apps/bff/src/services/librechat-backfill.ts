import { MongoClient } from "mongodb"
import type { Actor } from "../auth/persona"

const LIBRECHAT_BACKFILL_LIMIT = 3

interface LibreChatBackfillConfig {
  dbName: string
  url?: string
}

export interface LibreChatBackfilledThread {
  model: string | null
  resourceName: string | null
  threadId: string
  title: string
  updatedAt: Date
}

interface LibreChatUserDocument {
  _id?: unknown
  email?: unknown
  name?: unknown
  openidId?: unknown
  username?: unknown
}

interface LibreChatConversationDocument {
  _id?: unknown
  conversationId?: unknown
  createdAt?: unknown
  endpoint?: unknown
  model?: unknown
  title?: unknown
  updatedAt?: unknown
}

export interface LibreChatCollection<T> {
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
  findOne(
    filter: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<T | null>
}

export interface LibreChatDatabase {
  collection<T>(name: string): LibreChatCollection<T>
}

let cachedClient: MongoClient | null = null
let cachedUrl: string | null = null

export async function readLibreChatRecentChatTitles(
  actor: Actor,
  opts: {
    config?: LibreChatBackfillConfig
    db?: LibreChatDatabase
  } = {},
): Promise<LibreChatBackfilledThread[]> {
  const config = opts.config ?? getLibreChatBackfillConfig()
  if (!config.url && !opts.db) {
    return []
  }

  const db = opts.db ?? (await getLibreChatDatabase(config))
  if (!db) {
    return []
  }

  const user = await db
    .collection<LibreChatUserDocument>("users")
    .findOne(buildUserFilter(actor), {
      projection: { _id: 1 },
    })
  if (!user?._id) {
    return []
  }

  const userIds = libreChatUserIds(user._id)
  if (userIds.length === 0) {
    return []
  }

  const rows = await db
    .collection<LibreChatConversationDocument>("conversations")
    .find(
      {
        title: { $exists: true, $ne: "" },
        user: { $in: userIds },
      },
      {
        projection: {
          _id: 1,
          conversationId: 1,
          createdAt: 1,
          endpoint: 1,
          model: 1,
          title: 1,
          updatedAt: 1,
        },
      },
    )
    .sort({ updatedAt: -1 })
    .limit(LIBRECHAT_BACKFILL_LIMIT)
    .toArray()

  return rows.flatMap((row) => parseConversation(row))
}

export async function closeLibreChatBackfillClientForTest(): Promise<void> {
  const client = cachedClient
  cachedClient = null
  cachedUrl = null
  await client?.close()
}

function getLibreChatBackfillConfig(): LibreChatBackfillConfig {
  return {
    dbName: process.env.LIBRECHAT_MONGO_DB?.trim() || "LibreChat",
    url: process.env.LIBRECHAT_MONGO_URL?.trim() || undefined,
  }
}

async function getLibreChatDatabase(
  config: LibreChatBackfillConfig,
): Promise<LibreChatDatabase | null> {
  if (!config.url) {
    return null
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

function buildUserFilter(actor: Actor): Record<string, unknown> {
  const identities = libreChatIdentityCandidates(actor)
  const emailCandidates = identities.filter((value) => value.includes("@"))
  const usernameCandidates = new Set<string>()

  for (const identity of identities) {
    usernameCandidates.add(identity)
    const [localPart, domain] = identity.split("@")
    if (localPart && domain) {
      usernameCandidates.add(localPart)
    }
  }

  return {
    $or: [
      ...identities.map((value) => ({ openidId: value })),
      ...emailCandidates.map((value) => ({ email: value })),
      ...[...usernameCandidates].flatMap((value) => [
        { username: value },
        { name: value },
      ]),
    ],
  }
}

function libreChatIdentityCandidates(actor: Actor): string[] {
  const values = [actor.subject, actor.email]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
  return [...new Set(values)]
}

function libreChatUserIds(value: unknown): unknown[] {
  if (!value) {
    return []
  }

  const stringId = String(value)
  return stringId === value ? [value] : [value, stringId]
}

function parseConversation(
  row: LibreChatConversationDocument,
): LibreChatBackfilledThread[] {
  const title = stringValue(row.title)
  const threadId = stringValue(row.conversationId) ?? stringValue(row._id)
  const updatedAt = dateValue(row.updatedAt) ?? dateValue(row.createdAt)
  if (!title || !threadId || !updatedAt) {
    return []
  }

  return [
    {
      model: stringValue(row.model) ?? null,
      resourceName: stringValue(row.endpoint) ?? "LibreChat",
      threadId,
      title,
      updatedAt,
    },
  ]
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
