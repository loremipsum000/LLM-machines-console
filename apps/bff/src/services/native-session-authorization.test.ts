import { createHmac } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { TestOnlyInMemoryConsoleSessionRepository } from "./console-session-store"
import { NativeSessionAuthorizationService } from "./native-session-authorization"

const masterKey = "sk-native-session-test-key"
const now = new Date("2026-08-26T12:00:00.000Z")

describe("native session authorization", () => {
  it("accepts a current signed LiteLLM UI session and rejects it after logout", async () => {
    const repository = new TestOnlyInMemoryConsoleSessionRepository()
    const service = createService(repository)
    const token = jwt("admin-subject", now)
    await expect(
      service.authorizeLiteLlmBrowser(`token=${token}`),
    ).resolves.toEqual({
      state: "allowed",
    })
    repository.nativeLogoutFences.set(
      "admin-subject",
      new Date(now.getTime() + 1000),
    )
    await expect(
      service.authorizeLiteLlmBrowser(`token=${token}`),
    ).resolves.toEqual({
      reason: "native_session_logged_out",
      state: "denied",
    })
  })

  it("rejects unsigned, duplicate, expired, and globally fenced browser sessions", async () => {
    const repository = new TestOnlyInMemoryConsoleSessionRepository()
    const service = createService(repository)
    const token = jwt("admin-subject", now)
    await expect(
      service.authorizeLiteLlmBrowser(`token=${token}x`),
    ).resolves.toMatchObject({ state: "denied" })
    await expect(
      service.authorizeLiteLlmBrowser(`token=${token}; token=${token}`),
    ).resolves.toMatchObject({ state: "denied" })
    await expect(
      service.authorizeLiteLlmBrowser(
        `token=${jwt("admin-subject", new Date(now.getTime() - 9 * 60 * 60 * 1000))}`,
      ),
    ).resolves.toMatchObject({ state: "denied" })
    repository.nativeGlobalLogoutFence = new Date(now.getTime() + 1000)
    await expect(
      service.authorizeLiteLlmBrowser(`token=${token}`),
    ).resolves.toMatchObject({ state: "denied" })
  })

  it("keeps durable personal keys independent and fences dashboard keys", async () => {
    const repository = new TestOnlyInMemoryConsoleSessionRepository()
    repository.nativeLogoutFences.set("operator-subject", new Date(now))
    const request = vi.fn<typeof fetch>(async (_input, init) => {
      const authorization = String(
        new Headers(init?.headers).get("authorization"),
      )
      const dashboard = authorization.endsWith("dashboard-key")
      return new Response(
        JSON.stringify({
          info: dashboard
            ? {
                created_at: "2026-08-26T11:59:00.000Z",
                team_id: "litellm-dashboard",
                user_id: "operator-subject",
              }
            : {
                created_at: "2026-08-20T00:00:00.000Z",
                team_id: "operator-owned",
                user_id: "operator-subject",
              },
          key: "redacted-by-test-boundary",
        }),
        { status: 200 },
      )
    })
    const service = createService(repository, request)
    await expect(
      service.authorizeLiteLlmKey("Bearer personal-key"),
    ).resolves.toEqual({ state: "allowed" })
    await expect(
      service.authorizeLiteLlmKey("Bearer dashboard-key"),
    ).resolves.toEqual({
      reason: "native_session_logged_out",
      state: "denied",
    })
  })

  it("fails closed on invalid or unavailable key introspection", async () => {
    const repository = new TestOnlyInMemoryConsoleSessionRepository()
    const denied = createService(
      repository,
      vi.fn(async () => new Response(null, { status: 404 })),
    )
    const unavailable = createService(
      repository,
      vi.fn(async () => {
        throw new Error("down")
      }),
    )
    await expect(
      denied.authorizeLiteLlmKey("Bearer missing-key"),
    ).resolves.toMatchObject({ state: "denied" })
    await expect(
      unavailable.authorizeLiteLlmKey("Bearer live-key"),
    ).resolves.toMatchObject({ state: "unavailable" })
  })
})

function createService(
  repository: TestOnlyInMemoryConsoleSessionRepository,
  request: typeof fetch = vi.fn(
    async () => new Response(null, { status: 500 }),
  ),
) {
  return new NativeSessionAuthorizationService(
    repository,
    { baseUrl: "http://127.0.0.1:4000", masterKey },
    () => new Date(now),
    request,
  )
}

function jwt(subject: string, issuedAt: Date): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(issuedAt.getTime() / 1000) + 8 * 60 * 60,
      key: "sk-session-key",
      user_id: subject,
      user_role: "proxy_admin",
    }),
  ).toString("base64url")
  const signature = createHmac("sha256", masterKey)
    .update(`${header}.${payload}`)
    .digest("base64url")
  return `${header}.${payload}.${signature}`
}
