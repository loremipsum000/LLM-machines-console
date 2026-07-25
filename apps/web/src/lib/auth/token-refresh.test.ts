import { afterEach, describe, expect, it, vi } from "vitest"
import type { Account } from "next-auth"
import {
  attachKeycloakAccount,
  ensureFreshKeycloakAccessToken,
  freshKeycloakAccessToken,
} from "./token-refresh"

describe("Keycloak token refresh", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("stores Keycloak access, refresh, expiry, and roles on sign-in", () => {
    const token = attachKeycloakAccount(
      { sub: "user-1" },
      {
        access_token: jwtWithPayload({
          exp: 1_000,
          groups: ["/Security"],
          realm_access: { roles: ["admin"] },
        }),
        expires_at: 1_000,
        provider: "keycloak",
        providerAccountId: "user-1",
        refresh_token: "refresh-1",
        type: "oidc",
      } satisfies Account,
      undefined,
    )

    expect(token.accessToken).toBeTruthy()
    expect(token.accessTokenExpiresAt).toBe(1_000)
    expect(token.refreshToken).toBe("refresh-1")
    expect(token.groups).toEqual(["Security"])
    expect(token.roles).toEqual(["admin"])
  })

  it("stores Keycloak email and preferred username on sign-in", () => {
    const token = attachKeycloakAccount(
      { sub: "user-1" },
      {
        access_token: jwtWithPayload({
          exp: 1_000,
          realm_access: { roles: ["admin"] },
        }),
        provider: "keycloak",
        providerAccountId: "user-1",
        type: "oidc",
      } satisfies Account,
      {
        email: "demo-admin@identity.example.test",
        preferred_username: "demo-admin",
      },
    )

    expect(token.email).toBe("demo-admin@identity.example.test")
    expect(token.preferredUsername).toBe("demo-admin")
  })

  it("does not refresh a token that is still inside its usable window", async () => {
    const fetchSpy = vi.fn()
    const token = {
      accessToken: jwtWithPayload({ exp: 9_999_999_999 }),
      accessTokenExpiresAt: 9_999_999_999,
      refreshToken: "refresh-1",
      roles: ["builder"],
      sub: "user-1",
    }

    const refreshed = await ensureFreshKeycloakAccessToken(token, {
      fetch: fetchSpy,
      now: () => 900_000,
    })

    expect(refreshed).toBe(token)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(freshKeycloakAccessToken(refreshed)).toBe(token.accessToken)
  })

  it("refreshes expired Keycloak access tokens and rotates refresh tokens", async () => {
    vi.stubEnv("AUTH_KEYCLOAK_ISSUER", "https://keycloak.test/realms/demo/")
    vi.stubEnv("AUTH_KEYCLOAK_ID", "console-web")
    vi.stubEnv("AUTH_KEYCLOAK_SECRET", "secret")

    const newAccessToken = jwtWithPayload({
      exp: 2_000,
      groups: ["/Security"],
      realm_access: { roles: ["admin"] },
    })
    const fetchSpy = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json({
          access_token: newAccessToken,
          expires_in: 300,
          refresh_token: "refresh-2",
        }),
    )

    const refreshed = await ensureFreshKeycloakAccessToken(
      {
        accessToken: jwtWithPayload({ exp: 900 }),
        accessTokenExpiresAt: 900,
        refreshToken: "refresh-1",
        groups: ["Finance"],
        roles: ["builder"],
        sub: "user-1",
      },
      {
        fetch: fetchSpy as typeof fetch,
        now: () => 1_000_000,
      },
    )

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://keycloak.test/realms/demo/protocol/openid-connect/token",
      expect.objectContaining({
        method: "POST",
      }),
    )
    const [, request] = fetchSpy.mock.calls[0]
    expect((request?.body as URLSearchParams).get("refresh_token")).toBe(
      "refresh-1",
    )
    expect(refreshed.accessToken).toBe(newAccessToken)
    expect(refreshed.accessTokenExpiresAt).toBe(1_300)
    expect(refreshed.refreshToken).toBe("refresh-2")
    expect(refreshed.groups).toEqual(["Finance", "Security"])
    expect(refreshed.roles).toEqual(["builder", "admin"])
  })

  it("suppresses stale forwarded access tokens when refresh fails", async () => {
    vi.stubEnv("AUTH_KEYCLOAK_ISSUER", "https://keycloak.test/realms/demo")
    vi.stubEnv("AUTH_KEYCLOAK_ID", "console-web")
    vi.stubEnv("AUTH_KEYCLOAK_SECRET", "secret")

    const refreshed = await ensureFreshKeycloakAccessToken(
      {
        accessToken: jwtWithPayload({ exp: 900 }),
        accessTokenExpiresAt: 900,
        refreshToken: "refresh-1",
        roles: ["admin"],
        sub: "user-1",
      },
      {
        fetch: vi.fn(async () =>
          Response.json({ error: "invalid_grant" }, { status: 400 }),
        ),
        now: () => 1_000_000,
      },
    )

    expect(freshKeycloakAccessToken(refreshed)).toBeUndefined()
    expect(refreshed.roles).toEqual(["admin"])
    expect(refreshed.sub).toBe("user-1")
  })
})

function jwtWithPayload(payload: Record<string, unknown>): string {
  return [
    encodeBase64Url({ alg: "RS256", typ: "JWT" }),
    encodeBase64Url(payload),
    "signature",
  ].join(".")
}

function encodeBase64Url(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}
