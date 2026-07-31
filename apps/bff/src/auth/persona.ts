import { type Persona, personaCanAccess } from "@llm-machines/contracts"
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify"
import { emitAudit } from "../services/audit"
import { verifyKeycloakJwt } from "./keycloak-jwt"

export {
  resetJwksCachesForTest,
  verifyKeycloakJwt,
} from "./keycloak-jwt"
export type { VerifiedKeycloakJwt } from "./keycloak-jwt"

export type AuthMode = "keycloak" | "service-forwarded"

export interface Actor {
  subject: string
  email?: string
  persona: Persona
  roles: string[]
  groups?: string[]
  authMode: AuthMode
}

declare module "fastify" {
  interface FastifyContextConfig {
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
  requireForwardedKeycloakToken: boolean
  serviceApiKey?: string
  serviceKeyAccessTokenHeader: string
  serviceKeyUserHeader: string
  serviceKeyEmailHeader: string
  serviceKeyRolesHeader: string
  serviceKeyGroupsHeader: string
}

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
} {
  return { config: { persona } }
}

const authHook: preHandlerHookHandler = async (request, reply) => {
  const requiredPersona = request.routeOptions.config?.persona
  if (!requiredPersona) {
    return
  }

  const authResult = await authenticateRequest(request)
  if (!authResult.ok) {
    await emitAudit({
      action: "auth.denied",
      correlationId: request.id,
      outcome: "denied",
      sourceSystem: "console",
    })
    const detail =
      authResult.reason === "unresolved_placeholder"
        ? "Authentication headers contain unresolved placeholders."
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
      action: "auth.denied",
      correlationId: request.id,
      keycloakSubjectId: actor.subject,
      outcome: "denied",
      sourceSystem: "console",
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
