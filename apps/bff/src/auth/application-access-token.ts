import { verifyKeycloakJwt } from "./keycloak-jwt"

export interface ApplicationAccessTokenIdentity {
  clientId: string
  keycloakSubjectId: string
}

export interface ApplicationAccessTokenConfig {
  identityHost?: string
  issuerUrl?: string
}

const APPLICATION_REALM = "llm-machines-applications"
const APPLICATION_AUDIENCE = "console-bff"
const APPLICATION_ACCESS_TOKEN_MAX_LIFETIME_SECONDS = 300
const APPLICATION_CLIENT_ID_PATTERN =
  /^llmm-app-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function verifyApplicationAccessToken(
  token: string,
  config: ApplicationAccessTokenConfig = {},
): Promise<ApplicationAccessTokenIdentity | null> {
  const identityHost = normalizeIdentityHost(
    config.identityHost ?? process.env.PRODUCT_IDENTITY_HOST ?? "",
  )
  const issuerUrl = normalizeApplicationIssuerUrl(
    config.issuerUrl ?? process.env.KEYCLOAK_APPLICATION_ISSUER_URL ?? "",
    identityHost,
  )
  if (!identityHost || !issuerUrl) {
    return null
  }

  const payload = await verifyKeycloakJwt(token, {
    keycloakAudience: APPLICATION_AUDIENCE,
    keycloakIssuerUrl: issuerUrl,
  })
  const issuedAt = payload?.issuedAt
  const now = Math.floor(Date.now() / 1000)
  if (
    !payload ||
    !hasExactApplicationAudience(payload.audience) ||
    typeof issuedAt !== "number" ||
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > now ||
    payload.expiresAt <= issuedAt ||
    payload.expiresAt - issuedAt >
      APPLICATION_ACCESS_TOKEN_MAX_LIFETIME_SECONDS ||
    !payload.azp ||
    !APPLICATION_CLIENT_ID_PATTERN.test(payload.azp) ||
    (payload.clientId !== undefined && payload.clientId !== payload.azp)
  ) {
    return null
  }

  return {
    clientId: payload.azp,
    keycloakSubjectId: payload.subject,
  }
}

function hasExactApplicationAudience(
  audience: string | string[] | undefined,
): boolean {
  return (
    audience === APPLICATION_AUDIENCE ||
    (Array.isArray(audience) &&
      audience.length === 1 &&
      audience[0] === APPLICATION_AUDIENCE)
  )
}

function normalizeApplicationIssuerUrl(
  value: string,
  identityHost: string | null,
): string | null {
  const candidate = value.trim().replace(/\/+$/, "")
  if (!candidate || !identityHost) {
    return null
  }

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }

  const authority = candidate.slice(candidate.indexOf("://") + 3).split("/")[0]
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.hostname !== identityHost ||
    url.username !== "" ||
    url.password !== "" ||
    authority?.includes("@") ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname !== `/realms/${APPLICATION_REALM}`
  ) {
    return null
  }

  return candidate
}

function normalizeIdentityHost(value: string): string | null {
  const candidate = value.trim()
  return candidate.length <= 253 &&
    candidate === candidate.toLowerCase() &&
    !candidate.includes(":") &&
    !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate) &&
    candidate
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    ? candidate
    : null
}
