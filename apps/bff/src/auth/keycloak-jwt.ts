import { type KeyObject, createPublicKey, createVerify } from "node:crypto"

export interface KeycloakJwtConfig {
  keycloakAudience?: string
  keycloakIssuerUrl?: string
}

export interface VerifiedKeycloakJwt {
  acr?: string
  amr?: string[]
  audience?: string | string[]
  authTime?: number
  azp?: string
  clientId?: string
  email?: string
  expiresAt: number
  groups: string[]
  issuedAt?: number
  issuer?: string
  notBefore?: number
  roles: string[]
  subject: string
}

interface JwtHeader {
  alg: string
  kid?: string
  typ?: string
}

interface JwtPayload {
  acr?: string
  amr?: string[]
  aud?: string | string[]
  auth_time?: number
  azp?: string
  client_id?: string
  email?: string
  exp?: number
  groups?: string[]
  iat?: number
  iss?: string
  nbf?: number
  preferred_username?: string
  realm_access?: {
    roles?: string[]
  }
  sub?: string
  typ?: string
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
const jwksMaxBytes = 2 * 1024 * 1024
const maxJwksKidLength = 256
const maxNegativeKidCacheEntries = 1024

export async function verifyKeycloakJwt(
  token: string,
  config: KeycloakJwtConfig = keycloakJwtConfigFromEnv(),
): Promise<VerifiedKeycloakJwt | null> {
  const parsed = parseJwt(token)
  if (!parsed) {
    return null
  }

  const { header, payload, signedContent, signature } = parsed
  if (
    header.alg !== "RS256" ||
    !header.kid ||
    !payload.sub ||
    payload.typ !== "Bearer" ||
    typeof payload.exp !== "number" ||
    !Number.isSafeInteger(payload.exp)
  ) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  if ((payload.exp ?? 0) <= now) {
    return null
  }
  if (
    payload.nbf !== undefined &&
    (!Number.isSafeInteger(payload.nbf) || payload.nbf > now)
  ) {
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

  let key: KeyObject | null
  try {
    key = await getSigningKey(header.kid, config)
  } catch {
    return null
  }
  if (!key || !verifyRs256(signedContent, signature, key)) {
    return null
  }

  return {
    acr: payload.acr,
    amr: payload.amr,
    audience: payload.aud,
    authTime: payload.auth_time,
    azp: payload.azp,
    clientId: payload.client_id,
    email: payload.email ?? payload.preferred_username,
    expiresAt: payload.exp,
    groups: payload.groups ?? [],
    issuedAt: payload.iat,
    issuer: payload.iss,
    notBefore: payload.nbf,
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

export function getJwksCacheSizesForTest(): {
  negativeKidEntries: number
} {
  return { negativeKidEntries: negativeKidCache.size }
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
  if (negativeUntil !== undefined) {
    negativeKidCache.delete(cacheKey)
  }

  const cachedDocument = jwksCache.get(config.keycloakIssuerUrl)
  const hadFreshCachedDocument =
    cachedDocument !== undefined && cachedDocument.expiresAt > Date.now()
  let jwks = await getJwksDocument(config.keycloakIssuerUrl)
  let jwk = jwks?.keys.find((candidate) => candidate.kid === kid)
  if (!jwk && hadFreshCachedDocument) {
    jwks = await getJwksDocument(config.keycloakIssuerUrl, true)
    jwk = jwks?.keys.find((candidate) => candidate.kid === kid)
  }
  if (!jwk) {
    cacheMissingKid(cacheKey)
    return null
  }

  const key = createPublicKey({ key: jwk, format: "jwk" })
  keyCache.set(cacheKey, {
    expiresAt: Date.now() + jwksCacheMs(),
    key,
  })
  return key
}

function cacheMissingKid(cacheKey: string): void {
  const now = Date.now()
  for (const [candidate, expiresAt] of negativeKidCache) {
    if (expiresAt <= now) {
      negativeKidCache.delete(candidate)
    }
  }
  while (negativeKidCache.size >= maxNegativeKidCacheEntries) {
    const oldest = negativeKidCache.keys().next()
    if (oldest.done) {
      break
    }
    negativeKidCache.delete(oldest.value)
  }
  negativeKidCache.set(cacheKey, now + jwksNegativeCacheMs())
}

async function getJwksDocument(
  issuerUrl: string,
  forceRefresh = false,
): Promise<JwksDocument | null> {
  const cached = jwksCache.get(issuerUrl)
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
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
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return null
    }
    const body = await readBoundedJwksJson(response)
    const jwks = parseJwks(body)
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

async function readBoundedJwksJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length")
  if (
    contentLength !== null &&
    Number.isSafeInteger(Number(contentLength)) &&
    Number(contentLength) > jwksMaxBytes
  ) {
    await response.body?.cancel().catch(() => undefined)
    return null
  }

  const reader = response.body?.getReader()
  if (!reader) {
    return null
  }
  const chunks: Uint8Array[] = []
  let bytesRead = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    bytesRead += value.byteLength
    if (bytesRead > jwksMaxBytes) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }

  const body = new Uint8Array(bytesRead)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(body))
  } catch {
    return null
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

  const kid = typeof parsed.kid === "string" ? parsed.kid : undefined

  return {
    alg: parsed.alg,
    kid: kid !== undefined && kid.length <= maxJwksKidLength ? kid : undefined,
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
    acr: typeof parsed.acr === "string" ? parsed.acr : undefined,
    amr: Array.isArray(parsed.amr) ? stringArrayValue(parsed.amr) : undefined,
    aud: parseAudience(parsed.aud),
    auth_time:
      typeof parsed.auth_time === "number" ? parsed.auth_time : undefined,
    azp: typeof parsed.azp === "string" ? parsed.azp : undefined,
    client_id:
      typeof parsed.client_id === "string" ? parsed.client_id : undefined,
    email: typeof parsed.email === "string" ? parsed.email : undefined,
    exp: typeof parsed.exp === "number" ? parsed.exp : undefined,
    groups: stringArrayValue(parsed.groups).map(normalizeGroupName),
    iat: typeof parsed.iat === "number" ? parsed.iat : undefined,
    iss: typeof parsed.iss === "string" ? parsed.iss : undefined,
    nbf: typeof parsed.nbf === "number" ? parsed.nbf : undefined,
    preferred_username:
      typeof parsed.preferred_username === "string"
        ? parsed.preferred_username
        : undefined,
    realm_access: realmAccess,
    sub: typeof parsed.sub === "string" ? parsed.sub : undefined,
    typ: typeof parsed.typ === "string" ? parsed.typ : undefined,
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
