import { createPublicKey, createVerify, type KeyObject } from "node:crypto"
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify"
import { type Persona, personaCanAccess } from "@llm-machines/contracts"
import { emitAudit } from "../services/audit"

export type AuthMode =
  | "keycloak"
  | "service-forwarded"
  | "service-forwarded-mcp"

export interface Actor {
  subject: string
  email?: string
  persona: Persona
  roles: string[]
  groups?: string[]
  authMode: AuthMode
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

declare module "fastify" {
  interface FastifyContextConfig {
    allowMcpServiceForwardedAuth?: boolean
    persona?: Persona
  }

  interface FastifyRequest {
    actor?: Actor
  }
}

interface AuthConfig {
  keycloakIssuerUrl?: string
  keycloakAudience?: string
  allowHeaderOnlyServiceAuth: boolean
  allowMcpServiceForwardedAuth: boolean
  requireForwardedKeycloakToken: boolean
  serviceApiKey?: string
  serviceKeyAccessTokenHeader: string
  serviceKeyUserHeader: string
  serviceKeyEmailHeader: string
  serviceKeyRolesHeader: string
  serviceKeyGroupsHeader: string
}

interface JwtHeader {
  alg: string
  kid?: string
  typ?: string
}

interface JwtPayload {
  azp?: string
  client_id?: string
  sub?: string
  email?: string
  preferred_username?: string
  exp?: number
  nbf?: number
  iss?: string
  aud?: string | string[]
  realm_access?: {
    roles?: string[]
  }
  groups?: string[]
}

interface JwksDocument {
  keys: Array<Record<string, unknown>>
}

const keyCache = new Map<string, { key: KeyObject; expiresAt: number }>()
const jwksCache = new Map<string, { document: JwksDocument; expiresAt: number }>()
const negativeKidCache = new Map<string, number>()
const jwksFetchWindows = new Map<string, { count: number; resetAt: number }>()
const jwksFetchPromises = new Map<string, Promise<JwksDocument | null>>()
const defaultJwksCacheMs = 15 * 60 * 1000
const defaultNegativeKidCacheMs = 60 * 1000
const defaultJwksTimeoutMs = 2000
const defaultJwksFetchLimit = 4
const defaultJwksFetchWindowMs = 60 * 1000

type AuthFailureReason =
  | "missing_token"
  | "invalid_token"
  | "invalid_forwarded_token"
  | "invalid_forwarded_identity"
  | "unresolved_placeholder"

type AuthResult =
  | { ok: true; actor: Actor }
  | { ok: false; reason: AuthFailureReason }

export function registerPersonaAuth(server: FastifyInstance): void {
  server.addHook("preHandler", authHook)
}

export function withPersona(persona: Persona): {
  config: { persona: Persona }
}
export function withPersona(
  persona: Persona,
  options: { allowMcpServiceForwardedAuth?: boolean },
): {
  config: { allowMcpServiceForwardedAuth?: boolean; persona: Persona }
}
export function withPersona(
  persona: Persona,
  options: { allowMcpServiceForwardedAuth?: boolean } = {},
): {
  config: { allowMcpServiceForwardedAuth?: boolean; persona: Persona }
} {
  return {
    config: {
      allowMcpServiceForwardedAuth: options.allowMcpServiceForwardedAuth,
      persona,
    },
  }
}

const authHook: preHandlerHookHandler = async (request, reply) => {
  const requiredPersona = request.routeOptions.config?.persona
  if (!requiredPersona) {
    return
  }

  const authResult = await authenticateRequest(request)
  if (!authResult.ok) {
    await emitAudit({
      actorId: "anonymous",
      action: "auth.denied",
      targetType: "route",
      targetId: request.routeOptions.url ?? request.url,
      reason: authResult.reason,
      metadata: {
        authMode: "denied",
        method: request.method,
        requiredPersona,
      },
    })
    const detail =
      authResult.reason === "unresolved_placeholder"
        ? "Authentication headers contain unresolved LibreChat placeholders."
        : "A valid Keycloak bearer token or trusted service identity is required."
    return reply.code(401).send({
      type: "about:blank",
      title: "Unauthenticated",
      status: 401,
      detail,
    })
  }

  const actor = authResult.actor
  if (!personaCanAccess(actor.persona, requiredPersona)) {
    await emitAudit({
      actorId: actor.subject,
      action: "auth.denied",
      targetType: "route",
      targetId: request.routeOptions.url ?? request.url,
      reason: "insufficient_persona",
      metadata: {
        method: request.method,
        actualPersona: actor.persona,
        requiredPersona,
        authMode: actor.authMode,
      },
    })
    return reply.code(403).send({
      type: "about:blank",
      title: "Forbidden",
      status: 403,
      detail: `Route requires ${requiredPersona} access.`,
    })
  }

  request.actor = actor
}

async function authenticateRequest(
  request: FastifyRequest,
): Promise<AuthResult> {
  const authorization = request.headers.authorization
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) {
    return { ok: false, reason: "missing_token" }
  }

  const config = getAuthConfig()
  if (config.serviceApiKey && token === config.serviceApiKey) {
    const forwardedToken = getHeaderValue(
      request,
      config.serviceKeyAccessTokenHeader,
    )
    if (forwardedToken) {
      if (containsUnresolvedPlaceholder(forwardedToken)) {
        return { ok: false, reason: "unresolved_placeholder" }
      }
      if (!config.keycloakIssuerUrl) {
        return { ok: false, reason: "invalid_forwarded_token" }
      }
      const actor = await actorFromKeycloakJwt(
        forwardedToken.replace(/^Bearer\s+/i, ""),
        config,
      )
      if (actor) {
        return { ok: true, actor }
      }
      return { ok: false, reason: "invalid_forwarded_token" }
    }

    if (
      request.routeOptions.config?.allowMcpServiceForwardedAuth &&
      config.allowMcpServiceForwardedAuth
    ) {
      const actor = actorFromForwardedHeaders(
        request,
        config,
        "service-forwarded-mcp",
      )
      return actor
        ? { ok: true, actor }
        : { ok: false, reason: "invalid_forwarded_identity" }
    }

    if (config.requireForwardedKeycloakToken) {
      return { ok: false, reason: "invalid_forwarded_token" }
    }
    if (!config.allowHeaderOnlyServiceAuth) {
      return { ok: false, reason: "invalid_forwarded_identity" }
    }

    const actor = actorFromForwardedHeaders(
      request,
      config,
      "service-forwarded",
    )
    return actor
      ? { ok: true, actor }
      : { ok: false, reason: "invalid_forwarded_identity" }
  }

  if (!config.keycloakIssuerUrl) {
    return { ok: false, reason: "invalid_token" }
  }

  const actor = await actorFromKeycloakJwt(token, config)
  return actor ? { ok: true, actor } : { ok: false, reason: "invalid_token" }
}

function getAuthConfig(): AuthConfig {
  return {
    allowHeaderOnlyServiceAuth: envFlag(
      "BFF_ALLOW_HEADER_ONLY_SERVICE_AUTH",
      process.env.NODE_ENV === "test",
    ),
    allowMcpServiceForwardedAuth: envFlag(
      "BFF_MCP_ALLOW_SERVICE_FORWARDED_AUTH",
      true,
    ),
    keycloakIssuerUrl: trimTrailingSlash(process.env.KEYCLOAK_ISSUER_URL),
    keycloakAudience: process.env.KEYCLOAK_AUDIENCE,
    requireForwardedKeycloakToken: envFlag(
      "BFF_REQUIRE_FORWARDED_KEYCLOAK_TOKEN",
      process.env.NODE_ENV !== "test",
    ),
    serviceApiKey: process.env.BFF_SERVICE_API_KEY,
    serviceKeyAccessTokenHeader:
      process.env.BFF_FORWARDED_ACCESS_TOKEN_HEADER ??
      "x-llm-machines-keycloak-token",
    serviceKeyUserHeader:
      process.env.BFF_FORWARDED_USER_HEADER ?? "x-llm-machines-user-sub",
    serviceKeyEmailHeader:
      process.env.BFF_FORWARDED_EMAIL_HEADER ?? "x-llm-machines-user-email",
    serviceKeyRolesHeader:
      process.env.BFF_FORWARDED_ROLES_HEADER ?? "x-llm-machines-user-roles",
    serviceKeyGroupsHeader:
      process.env.BFF_FORWARDED_GROUPS_HEADER ?? "x-llm-machines-user-groups",
  }
}

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  if (value === "true" || value === "1" || value === "yes") {
    return true
  }
  if (value === "false" || value === "0" || value === "no") {
    return false
  }
  return fallback
}

function actorFromForwardedHeaders(
  request: FastifyRequest,
  config: AuthConfig,
  authMode: AuthMode,
): Actor | null {
  const subject = getHeaderValue(request, config.serviceKeyUserHeader)
  if (!subject) {
    return null
  }

  const roles = parseRoleHeader(
    getHeaderValue(request, config.serviceKeyRolesHeader),
  )
  const persona = personaFromRoles(roles)
  if (!persona) {
    return null
  }

  return {
    subject,
    email: getHeaderValue(request, config.serviceKeyEmailHeader),
    persona,
    roles,
    groups: parseGroupHeader(
      getHeaderValue(request, config.serviceKeyGroupsHeader),
    ),
    authMode,
  }
}

function containsUnresolvedPlaceholder(value: string): boolean {
  return /\{\{[^}]+\}\}|\$\{[^}]+\}/.test(value)
}

async function actorFromKeycloakJwt(
  token: string,
  config: AuthConfig,
): Promise<Actor | null> {
  const payload = await verifyKeycloakJwt(token, config)
  if (!payload) {
    return null
  }

  const persona = personaFromRoles(payload.roles)
  if (!persona) {
    return null
  }

  return {
    subject: payload.subject,
    email: payload.email,
    persona,
    roles: payload.roles,
    groups: payload.groups,
    authMode: "keycloak",
  }
}

export async function verifyKeycloakJwt(
  token: string,
  config: AuthConfig = getAuthConfig(),
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

async function getSigningKey(
  kid: string,
  config: AuthConfig,
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
    key,
    expiresAt: Date.now() + 15 * 60 * 1000,
  })
  return key
}

async function getJwksDocument(issuerUrl: string): Promise<JwksDocument | null> {
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
    const response = await fetch(
      `${issuerUrl}/protocol/openid-connect/certs`,
      { signal: controller.signal },
    )
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
  return positiveIntegerEnv(
    "BFF_JWKS_FETCH_RATE_LIMIT",
    defaultJwksFetchLimit,
  )
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

export function resetJwksCachesForTest(): void {
  keyCache.clear()
  jwksCache.clear()
  negativeKidCache.clear()
  jwksFetchWindows.clear()
  jwksFetchPromises.clear()
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
  signedContent: string
  signature: Buffer
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
    signedContent: `${parts[0]}.${parts[1]}`,
    signature: Buffer.from(parts[2], "base64url"),
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
    azp: typeof parsed.azp === "string" ? parsed.azp : undefined,
    client_id:
      typeof parsed.client_id === "string" ? parsed.client_id : undefined,
    sub: typeof parsed.sub === "string" ? parsed.sub : undefined,
    email: typeof parsed.email === "string" ? parsed.email : undefined,
    preferred_username:
      typeof parsed.preferred_username === "string"
        ? parsed.preferred_username
        : undefined,
    exp: typeof parsed.exp === "number" ? parsed.exp : undefined,
    nbf: typeof parsed.nbf === "number" ? parsed.nbf : undefined,
    iss: typeof parsed.iss === "string" ? parsed.iss : undefined,
    aud: parseAudience(parsed.aud),
    realm_access: realmAccess,
    groups: stringArrayValue(parsed.groups).map(normalizeGroupName),
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

function personaFromRoles(roles: string[]): Persona | null {
  const normalized = new Set(roles.map((role) => role.toLowerCase()))
  if (normalized.has("admin")) {
    return "admin"
  }
  if (normalized.has("builder")) {
    return "builder"
  }
  if (normalized.has("consumer")) {
    return "consumer"
  }

  return null
}

function parseRoleHeader(value?: string): string[] {
  if (!value) {
    return []
  }

  return value
    .split(/[,\s]+/)
    .map((role) => role.trim())
    .filter(Boolean)
}

function parseGroupHeader(value?: string): string[] {
  if (!value) {
    return []
  }

  return value
    .split(",")
    .map((group) => normalizeGroupName(group.trim()))
    .filter(Boolean)
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

function getHeaderValue(
  request: FastifyRequest,
  headerName: string,
): string | undefined {
  const value = request.headers[headerName.toLowerCase()]
  return typeof value === "string" ? value : value?.[0]
}

function trimTrailingSlash(value?: string): string | undefined {
  return value?.replace(/\/+$/, "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
