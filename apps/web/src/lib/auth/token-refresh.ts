import type { Account, Profile } from "next-auth"
import type { JWT } from "next-auth/jwt"
import {
  extractGroupsFromAccessToken,
  extractRealmRolesFromAccessToken,
  retainedConsoleRoles,
} from "./role-claims"

const ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 60

interface RefreshOptions {
  fetch?: typeof fetch
  now?: () => number
}

interface KeycloakRefreshResponse {
  access_token?: unknown
  expires_in?: unknown
  refresh_token?: unknown
}

export function attachKeycloakAccount(
  token: JWT,
  account: Account,
  profile?: Profile,
): JWT {
  const accessToken = stringValue(account.access_token)
  const roles = retainedConsoleRoles(
    extractRealmRolesFromAccessToken(accessToken),
  )
  const groups = extractGroupsFromAccessToken(accessToken)

  return {
    ...token,
    accessToken,
    accessTokenExpiresAt:
      numberValue(account.expires_at) ?? extractAccessTokenExpiry(accessToken),
    email: profileString(profile, "email") ?? stringValue(token.email),
    preferredUsername:
      profileString(profile, "preferred_username") ??
      stringValue(token.preferredUsername),
    refreshToken: stringValue(account.refresh_token),
    groups,
    roles,
  }
}

export async function ensureFreshKeycloakAccessToken(
  token: JWT,
  options: RefreshOptions = {},
): Promise<JWT> {
  if (isKeycloakAccessTokenFresh(token, options.now)) {
    return token
  }

  const refreshToken = stringValue(token.refreshToken)
  if (!refreshToken) {
    return withoutForwardedAuthority(token)
  }

  const issuer = trimTrailingSlash(process.env.AUTH_KEYCLOAK_ISSUER)
  const clientId = process.env.AUTH_KEYCLOAK_ID
  const clientSecret = process.env.AUTH_KEYCLOAK_SECRET
  if (!issuer || !clientId || !clientSecret) {
    return withoutForwardedAuthority(token)
  }

  try {
    const now = options.now?.() ?? Date.now()
    const response = await (options.fetch ?? fetch)(
      `${issuer}/protocol/openid-connect/token`,
      {
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        method: "POST",
      },
    )
    if (!response.ok) {
      return withoutForwardedAuthority(token)
    }

    const refreshed = parseRefreshResponse(await response.json())
    const accessToken = stringValue(refreshed.access_token)
    if (!accessToken) {
      return withoutForwardedAuthority(token)
    }

    const expiresIn = numberValue(refreshed.expires_in)
    const roles = retainedConsoleRoles(
      extractRealmRolesFromAccessToken(accessToken),
    )
    const groups = extractGroupsFromAccessToken(accessToken)

    return {
      ...token,
      accessToken,
      accessTokenExpiresAt:
        expiresIn !== undefined
          ? Math.floor(now / 1000) + expiresIn
          : extractAccessTokenExpiry(accessToken),
      refreshToken: stringValue(refreshed.refresh_token) ?? refreshToken,
      groups,
      roles,
    }
  } catch {
    return withoutForwardedAuthority(token)
  }
}

export function freshKeycloakAccessToken(token: JWT): string | undefined {
  return isKeycloakAccessTokenFresh(token)
    ? stringValue(token.accessToken)
    : undefined
}

export function isKeycloakAccessTokenFresh(
  token: JWT,
  now: () => number = Date.now,
): boolean {
  const accessToken = stringValue(token.accessToken)
  if (!accessToken) {
    return false
  }

  const expiresAt =
    numberValue(token.accessTokenExpiresAt) ??
    extractAccessTokenExpiry(accessToken)
  if (expiresAt === undefined) {
    return false
  }

  const nowSeconds = Math.floor(now() / 1000)
  return expiresAt > nowSeconds + ACCESS_TOKEN_REFRESH_SKEW_SECONDS
}

function withoutForwardedAuthority(token: JWT): JWT {
  return {
    ...token,
    accessToken: undefined,
    accessTokenExpiresAt: undefined,
    groups: [],
    refreshToken: undefined,
    roles: [],
  }
}

function parseRefreshResponse(value: unknown): KeycloakRefreshResponse {
  return isRecord(value) ? value : {}
}

function extractAccessTokenExpiry(accessToken: unknown): number | undefined {
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return undefined
  }

  const [, payload] = accessToken.split(".")
  if (!payload) {
    return undefined
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as unknown
    if (!isRecord(parsed)) {
      return undefined
    }
    return numberValue(parsed.exp)
  } catch {
    return undefined
  }
}

function decodeBase64Url(payload: string): string {
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/")
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  return Buffer.from(`${base64}${padding}`, "base64").toString("utf8")
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function profileString(
  profile: Profile | undefined,
  key: string,
): string | undefined {
  if (!profile || typeof profile !== "object") {
    return undefined
  }
  return stringValue((profile as Record<string, unknown>)[key])
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function trimTrailingSlash(value?: string): string | undefined {
  return value?.replace(/\/+$/, "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
