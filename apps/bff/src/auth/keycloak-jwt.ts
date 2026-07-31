import { type KeyObject, createPublicKey, createVerify } from "node:crypto"

export interface KeycloakJwtConfig {
  keycloakAudience?: string
  keycloakIssuerUrl?: string
}

export interface VerifiedKeycloakJwt {
  audience?: string | string[]
  azp?: string
  clientId?: string
  email?: string
  groups: string[]
  issuer?: string
  roles: string[]
  subject: string
}

interface JwtHeader {
  alg: string
  kid?: string
  typ?: string
}

interface JwtPayload {
  aud?: string | string[]
  azp?: string
  client_id?: string
  email?: string
  exp?: number
  groups?: string[]
  iss?: string
  nbf?: number
  preferred_username?: string
  realm_access?: {
    roles?: string[]
  }
  sub?: string
}

interface JwksDocument {
  keys: Array<Record<string, unknown>>
}

const keyCache = new Map<string, { expiresAt: number; key: KeyObject }>()
const jwksCache = new Map<
  string,
  { document: JwksDocument; expiresAt: number }
>()
const negativeKidCache = new Map<string, number>()
const jwksFetchWindows = new Map<string, { count: number; resetAt: number }>()
const jwksFetchPromises = new Map<string, Promise<JwksDocument | null>>()
const defaultJwksCacheMs = 15 * 60 * 1000
const defaultNegativeKidCacheMs = 60 * 1000
const defaultJwksTimeoutMs = 2000
const defaultJwksFetchLimit = 4
const defaultJwksFetchWindowMs = 60 * 1000

export async function verifyKeycloakJwt(
  token: string,
  config: KeycloakJwtConfig = keycloakJwtConfigFromEnv(),
): Promise<VerifiedKeycloakJwt | null> {
  const parsed = parseJwt(token)
  if (!parsed) {
    return null
  }

  const { header, payload, signedContent, signature } = parsed
  if (header.alg !== "RS256" || !header.kid || !payload.sub) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  if (payload.exp && payload.exp <= now) {
    return null
  }
  if (payload.nbf && payload.nbf > now) {
    return null
  }
  if (config.keycloakIssuerUrl && payload.iss !== config.keycloakIssuerUrl) {
    return null
  }
  if (
    config.keycloakAudience &&
    !audienceContains(payload.aud, config.keycloakAudience)
  ) {
    return null
  }

  const key = await getSigningKey(header.kid, config)
  if (!key || !verifyRs256(signedContent, signature, key)) {
    return null
  }

  return {
    audience: payload.aud,
    azp: payload.azp,
    clientId: payload.client_id,
    email: payload.email ?? payload.preferred_username,
    groups: payload.groups ?? [],
    issuer: payload.iss,
    roles: payload.realm_access?.roles ?? [],
    subject: payload.sub,
  }
}

export function resetJwksCachesForTest(): void {
  keyCache.clear()
  jwksCache.clear()
  negativeKidCache.clear()
  jwksFetchWindows.clear()
  jwksFetchPromises.clear()
}

function keycloakJwtConfigFromEnv(): KeycloakJwtConfig {
  return {
    keycloakAudience: process.env.KEYCLOAK_AUDIENCE,
    keycloakIssuerUrl: process.env.KEYCLOAK_ISSUER_URL?.replace(/\/+$/, ""),
  }
}

async function getSigningKey(
  kid: string,
  config: KeycloakJwtConfig,
): Promise<KeyObject | null> {
  if (!config.keycloakIssuerUrl) {
    return null
  }

  const cacheKey = `${config.keycloakIssuerUrl}:${kid}`
  const cached = keyCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.key
  }

  const negativeUntil = negativeKidCache.get(cacheKey)
  if (negativeUntil && negativeUntil > Date.now()) {
    return null
  }

  const jwks = await getJwksDocument(config.keycloakIssuerUrl)
  const jwk = jwks?.keys.find((candidate) => candidate.kid === kid)
  if (!jwk) {
    negativeKidCache.set(cacheKey, Date.now() + jwksNegativeCacheMs())
    return null
  }

  const key = createPublicKey({ key: jwk, format: "jwk" })
  keyCache.set(cacheKey, {
    expiresAt: Date.now() + defaultJwksCacheMs,
    key,
  })
  return key
}

async function getJwksDocument(
  issuerUrl: string,
): Promise<JwksDocument | null> {
  const cached = jwksCache.get(issuerUrl)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.document
  }

  const pending = jwksFetchPromises.get(issuerUrl)
  if (pending) {
    return pending
  }

  if (!consumeJwksFetchBudget(issuerUrl)) {
    return null
  }

  const promise = fetchJwksDocument(issuerUrl).finally(() => {
    jwksFetchPromises.delete(issuerUrl)
  })
  jwksFetchPromises.set(issuerUrl, promise)
  return promise
}

async function fetchJwksDocument(
  issuerUrl: string,
): Promise<JwksDocument | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), jwksTimeoutMs())
  try {
    const response = await fetch(`${issuerUrl}/protocol/openid-connect/certs`, {
      signal: controller.signal,
    })
    if (!response.ok) {
      return null
    }
    const jwks = parseJwks(await response.json())
    if (!jwks) {
      return null
    }
    jwksCache.set(issuerUrl, {
      document: jwks,
      expiresAt: Date.now() + jwksCacheMs(),
    })
    return jwks
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function consumeJwksFetchBudget(issuerUrl: string): boolean {
  const now = Date.now()
  const windowMs = jwksFetchWindowMs()
  const limit = jwksFetchLimit()
  const current = jwksFetchWindows.get(issuerUrl)
  if (!current || current.resetAt <= now) {
    jwksFetchWindows.set(issuerUrl, {
      count: 1,
      resetAt: now + windowMs,
    })
    return true
  }
  if (current.count >= limit) {
    return false
  }
  current.count += 1
  return true
}

function jwksCacheMs(): number {
  return positiveIntegerEnv("BFF_JWKS_CACHE_MS", defaultJwksCacheMs)
}

function jwksNegativeCacheMs(): number {
  return positiveIntegerEnv(
    "BFF_JWKS_NEGATIVE_CACHE_MS",
    defaultNegativeKidCacheMs,
  )
}

function jwksTimeoutMs(): number {
  return positiveIntegerEnv("BFF_JWKS_FETCH_TIMEOUT_MS", defaultJwksTimeoutMs)
}

function jwksFetchLimit(): number {
  return positiveIntegerEnv("BFF_JWKS_FETCH_RATE_LIMIT", defaultJwksFetchLimit)
}

function jwksFetchWindowMs(): number {
  return positiveIntegerEnv(
    "BFF_JWKS_FETCH_RATE_WINDOW_MS",
    defaultJwksFetchWindowMs,
  )
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function verifyRs256(
  signedContent: string,
  signature: Buffer,
  key: KeyObject,
): boolean {
  const verifier = createVerify("RSA-SHA256")
  verifier.update(signedContent)
  verifier.end()
  return verifier.verify(key, signature)
}

function parseJwt(token: string): {
  header: JwtHeader
  payload: JwtPayload
  signature: Buffer
  signedContent: string
} | null {
  const parts = token.split(".")
  if (parts.length !== 3) {
    return null
  }

  const header = parseJwtHeader(parts[0])
  const payload = parseJwtPayload(parts[1])
  if (!header || !payload) {
    return null
  }

  return {
    header,
    payload,
    signature: Buffer.from(parts[2], "base64url"),
    signedContent: `${parts[0]}.${parts[1]}`,
  }
}

function parseJwtHeader(value: string): JwtHeader | null {
  const parsed = parseBase64Json(value)
  if (!isRecord(parsed) || typeof parsed.alg !== "string") {
    return null
  }

  return {
    alg: parsed.alg,
    kid: typeof parsed.kid === "string" ? parsed.kid : undefined,
    typ: typeof parsed.typ === "string" ? parsed.typ : undefined,
  }
}

function parseJwtPayload(value: string): JwtPayload | null {
  const parsed = parseBase64Json(value)
  if (!isRecord(parsed)) {
    return null
  }

  const realmAccess = isRecord(parsed.realm_access)
    ? {
        roles: Array.isArray(parsed.realm_access.roles)
          ? parsed.realm_access.roles.filter(
              (role): role is string => typeof role === "string",
            )
          : undefined,
      }
    : undefined

  return {
    aud: parseAudience(parsed.aud),
    azp: typeof parsed.azp === "string" ? parsed.azp : undefined,
    client_id:
      typeof parsed.client_id === "string" ? parsed.client_id : undefined,
    email: typeof parsed.email === "string" ? parsed.email : undefined,
    exp: typeof parsed.exp === "number" ? parsed.exp : undefined,
    groups: stringArrayValue(parsed.groups).map(normalizeGroupName),
    iss: typeof parsed.iss === "string" ? parsed.iss : undefined,
    nbf: typeof parsed.nbf === "number" ? parsed.nbf : undefined,
    preferred_username:
      typeof parsed.preferred_username === "string"
        ? parsed.preferred_username
        : undefined,
    realm_access: realmAccess,
    sub: typeof parsed.sub === "string" ? parsed.sub : undefined,
  }
}

function parseJwks(value: unknown): JwksDocument | null {
  if (!isRecord(value) || !Array.isArray(value.keys)) {
    return null
  }

  return {
    keys: value.keys.filter(isRecord),
  }
}

function parseBase64Json(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
  } catch {
    return null
  }
}

function normalizeGroupName(group: string): string {
  return group.replace(/^\/+/, "").split("/").filter(Boolean).at(-1) ?? ""
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
}

function parseAudience(value: unknown): string | string[] | undefined {
  if (typeof value === "string") {
    return value
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string")
  }
  return undefined
}

function audienceContains(
  actualAudience: string | string[] | undefined,
  expectedAudience: string,
): boolean {
  if (typeof actualAudience === "string") {
    return actualAudience === expectedAudience
  }
  return actualAudience?.includes(expectedAudience) ?? false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
