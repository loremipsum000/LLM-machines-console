import { afterEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/persona"
import {
  closeLibreChatBackfillClientForTest,
  type LibreChatCollection,
  type LibreChatDatabase,
  readLibreChatRecentChatTitles,
} from "./librechat-backfill"

const actor: Actor = {
  authMode: "keycloak",
  email: "demo-admin@identity.example.test",
  persona: "admin",
  roles: ["admin"],
  subject: "keycloak-subject-1",
}

describe("LibreChat backfill", () => {
  afterEach(async () => {
    vi.unstubAllEnvs()
    await closeLibreChatBackfillClientForTest()
  })

  it("is disabled when no Mongo URL is configured", async () => {
    await expect(readLibreChatRecentChatTitles(actor)).resolves.toEqual([])
  })

  it("imports only the latest three titled conversations for the actor", async () => {
    const db = fakeLibreChatDb({
      conversations: [
        conversation("thread-1", "Newest", "2026-05-21T10:00:00.000Z"),
        conversation("thread-2", "Second", "2026-05-21T09:00:00.000Z"),
        conversation("thread-3", "Third", "2026-05-21T08:00:00.000Z"),
        conversation("thread-4", "Fourth", "2026-05-21T07:00:00.000Z"),
        conversation("thread-empty", "", "2026-05-21T11:00:00.000Z"),
      ],
      users: [
        {
          _id: "librechat-user-1",
          email: "demo-admin@identity.example.test",
          openidId: "keycloak-subject-1",
        },
      ],
    })

    const threads = await readLibreChatRecentChatTitles(actor, {
      config: {
        dbName: "LibreChat",
        url: "mongodb://example.test/LibreChat",
      },
      db,
    })

    expect(threads).toEqual([
      {
        model: "qwen3-35b-local",
        resourceName: "LLM Machines",
        threadId: "thread-1",
        title: "Newest",
        updatedAt: new Date("2026-05-21T10:00:00.000Z"),
      },
      {
        model: "qwen3-35b-local",
        resourceName: "LLM Machines",
        threadId: "thread-2",
        title: "Second",
        updatedAt: new Date("2026-05-21T09:00:00.000Z"),
      },
      {
        model: "qwen3-35b-local",
        resourceName: "LLM Machines",
        threadId: "thread-3",
        title: "Third",
        updatedAt: new Date("2026-05-21T08:00:00.000Z"),
      },
    ])
  })

  it("matches LibreChat users by Keycloak username fallbacks", async () => {
    const db = fakeLibreChatDb({
      conversations: [
        conversation("thread-1", "Newest", "2026-05-21T10:00:00.000Z"),
      ],
      users: [
        {
          _id: "librechat-user-1",
          username: "demo-admin",
        },
      ],
    })

    const threads = await readLibreChatRecentChatTitles(
      {
        ...actor,
        email: undefined,
        subject: "demo-admin",
      },
      {
        config: {
          dbName: "LibreChat",
          url: "mongodb://example.test/LibreChat",
        },
        db,
      },
    )

    expect(threads).toEqual([
      expect.objectContaining({
        threadId: "thread-1",
        title: "Newest",
      }),
    ])
  })

  it("does not import conversations for another LibreChat user", async () => {
    const db = fakeLibreChatDb({
      conversations: [
        conversation("thread-1", "Newest", "2026-05-21T10:00:00.000Z"),
      ],
      users: [
        {
          _id: "other-user",
          email: "other@example.test",
          openidId: "other-subject",
          username: "other",
        },
      ],
    })

    await expect(
      readLibreChatRecentChatTitles(actor, {
        config: {
          dbName: "LibreChat",
          url: "mongodb://example.test/LibreChat",
        },
        db,
      }),
    ).resolves.toEqual([])
  })
})

function conversation(
  conversationId: string,
  title: string,
  updatedAt: string,
) {
  return {
    conversationId,
    createdAt: new Date(updatedAt),
    endpoint: "LLM Machines",
    model: "qwen3-35b-local",
    title,
    updatedAt: new Date(updatedAt),
  }
}

function fakeLibreChatDb(opts: {
  conversations: ReturnType<typeof conversation>[]
  users: Array<Record<string, unknown>>
}): LibreChatDatabase {
  return {
    collection<T>(name: string): LibreChatCollection<T> {
      if (name === "users") {
        return {
          async findOne(filter) {
            return (opts.users.find((user) =>
              matchesMongoFilter(user, filter),
            ) ?? null) as T | null
          },
          find() {
            throw new Error("Unexpected users.find call")
          },
        }
      }

      if (name === "conversations") {
        return {
          async findOne() {
            throw new Error("Unexpected conversations.findOne call")
          },
          find() {
            return {
              sort() {
                return {
                  limit(limit) {
                    return {
                      async toArray() {
                        return opts.conversations
                          .filter((item) => item.title.trim().length > 0)
                          .sort(
                            (a, b) =>
                              b.updatedAt.getTime() - a.updatedAt.getTime(),
                          )
                          .slice(0, limit) as T[]
                      },
                    }
                  },
                }
              },
            }
          },
        }
      }

      throw new Error(`Unexpected collection ${name}`)
    },
  }
}

function matchesMongoFilter(
  row: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  const orFilters = filter.$or
  if (!Array.isArray(orFilters)) {
    return false
  }

  return orFilters.some((candidate) => {
    if (!isRecord(candidate)) {
      return false
    }
    return Object.entries(candidate).every(([key, value]) => row[key] === value)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
