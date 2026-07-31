import {
  type EmergencyRecoveryResolution,
  type InferenceCoreCapability,
  type InferenceCoreHumanRole,
  emergencyRecoveryResolutionSchema,
  inferenceCoreHumanRoleSchema,
  roleHasInferenceCoreCapability,
} from "@llm-machines/contracts/inference-core"
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
  role: InferenceCoreHumanRole
  effectiveRole?: InferenceCoreHumanRole
  groups?: string[]
  authMode: AuthMode
  authTime?: number
  acr?: string
  amr?: string[]
}

export type HumanRouteAuthorizationPolicy =
  | { capability: InferenceCoreCapability; kind: "capability" }
  | { kind: "admin-only" }

export interface CurrentAuthorizationIdentity {
  enabled: boolean
  role: InferenceCoreHumanRole
  subject: string
}

export type LiveHumanAuthorityResolver = (
  actor: Actor,
  request: FastifyRequest,
) => Promise<CurrentAuthorizationIdentity | null>

export type EmergencyRecoverySessionResolver = (
  sessionId: string,
  keycloakSubjectId: string,
  request: FastifyRequest,
) => Promise<EmergencyRecoveryResolution>

export interface AuthorizationOptions {
  resolveCurrentIdentity: LiveHumanAuthorityResolver
  resolveRecoverySession: EmergencyRecoverySessionResolver
}

declare module "fastify" {
  interface FastifyContextConfig {
    authorization?: HumanRouteAuthorizationPolicy
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

const nativeExpertMutationCapabilities = new Set<InferenceCoreCapability>([
  "grafana.dashboards_alerting.edit",
  "litellm.routes_keys.edit",
])

export function registerAuthorization(
  server: FastifyInstance,
  options: AuthorizationOptions,
): void {
  server.addHook("preHandler", authorizationHook(options))
}

export function withCapability(capability: InferenceCoreCapability): {
  config: { authorization: HumanRouteAuthorizationPolicy }
} {
  return {
    config: { authorization: { capability, kind: "capability" } },
  }
}

export function withAdminOnly(): {
  config: { authorization: HumanRouteAuthorizationPolicy }
} {
  return { config: { authorization: { kind: "admin-only" } } }
}

function authorizationHook(
  options: AuthorizationOptions,
): preHandlerHookHandler {
  return async (request, reply) => {
    const policy = request.routeOptions.config?.authorization
    if (!policy && !isProtectedHumanRoute(request)) {
      return
    }

    const authResult = await authenticateRequest(request)
    if (!authResult.ok) {
      await auditDenial(request)
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

    const liveActor = await resolveCurrentActor(
      authResult.actor,
      request,
      reply,
      options.resolveCurrentIdentity,
    )
    if (!liveActor) {
      return
    }

    if (!policy) {
      await auditDenial(request, liveActor.subject)
      return forbidden(
        reply,
        "This protected route has no authorization policy.",
      )
    }

    const policyActor = await resolvePolicyActor(
      liveActor,
      policy,
      request,
      reply,
      options.resolveRecoverySession,
    )
    if (!policyActor) {
      return
    }

    if (!actorSatisfiesPolicy(policyActor, policy)) {
      await auditDenial(request, liveActor.subject)
      return forbidden(reply, policyDenialDetail(policy))
    }

    request.actor = policyActor
  }
}

async function resolveCurrentActor(
  actor: Actor,
  request: FastifyRequest,
  reply: FastifyReply,
  resolver: LiveHumanAuthorityResolver,
): Promise<Actor | null> {
  let identity: CurrentAuthorizationIdentity | null
  try {
    identity = await resolver(actor, request)
  } catch {
    await auditDenial(request, actor.subject)
    reply.code(503).send({
      type: "about:blank",
      title: "Authorization authority unavailable",
      status: 503,
      detail: "Current identity status could not be verified.",
    })
    return null
  }

  const parsedRole = inferenceCoreHumanRoleSchema.safeParse(identity?.role)
  if (
    !identity?.enabled ||
    identity.subject !== actor.subject ||
    !parsedRole.success
  ) {
    await auditDenial(request, actor.subject)
    forbidden(reply, "The current identity is disabled or has no valid role.")
    return null
  }

  return { ...actor, role: parsedRole.data }
}

async function resolvePolicyActor(
  actor: Actor,
  policy: HumanRouteAuthorizationPolicy,
  request: FastifyRequest,
  reply: FastifyReply,
  resolver: EmergencyRecoverySessionResolver,
): Promise<Actor | null> {
  if (actorSatisfiesPolicy(actor, policy)) {
    return actor
  }

  const recoverySessionId = recoverySessionHeader(request)
  if (
    policy.kind !== "capability" ||
    !recoverySessionId ||
    actor.role !== "operator"
  ) {
    return actor
  }

  let resolution: EmergencyRecoveryResolution
  try {
    const resolved = emergencyRecoveryResolutionSchema.safeParse(
      await resolver(recoverySessionId, actor.subject, request),
    )
    resolution = resolved.success ? resolved.data : { status: "unavailable" }
  } catch {
    resolution = { status: "unavailable" }
  }

  if (resolution.status === "unavailable") {
    await auditDenial(request, actor.subject)
    reply.code(503).send({
      type: "about:blank",
      title: "Recovery authority unavailable",
      status: 503,
      detail: "Emergency recovery authority could not be verified.",
    })
    return null
  }
  if (
    resolution.status !== "active" ||
    resolution.grant.keycloakSubjectId !== actor.subject ||
    resolution.grant.scope !== "console_admin_capabilities" ||
    resolution.grant.nativeExpertAccess !== false
  ) {
    await auditDenial(request, actor.subject)
    forbidden(reply, "The emergency recovery session is not active.")
    return null
  }

  return { ...actor, effectiveRole: "admin" }
}

function actorSatisfiesPolicy(
  actor: Actor,
  policy: HumanRouteAuthorizationPolicy,
): boolean {
  const policyRole = actor.effectiveRole ?? actor.role
  return policy.kind === "admin-only"
    ? actor.role === "admin"
    : !(
        actor.effectiveRole &&
        nativeExpertMutationCapabilities.has(policy.capability)
      ) && roleHasInferenceCoreCapability(policyRole, policy.capability)
}

function policyDenialDetail(policy: HumanRouteAuthorizationPolicy): string {
  return policy.kind === "admin-only"
    ? "Route requires Admin access."
    : `Route requires the ${policy.capability} capability.`
}

function isProtectedHumanRoute(request: FastifyRequest): boolean {
  const route = request.routeOptions.url
  return (
    typeof route === "string" &&
    (route === "/api/admin" || route.startsWith("/api/admin/"))
  )
}

function recoverySessionHeader(request: FastifyRequest): string | undefined {
  const value = request.headers["x-llm-machines-recovery-session-id"]
  return typeof value === "string" && value.trim() === value && value
    ? value
    : undefined
}

async function auditDenial(
  request: FastifyRequest,
  keycloakSubjectId?: string,
): Promise<void> {
  try {
    await emitAudit({
      action: "auth.denied",
      correlationId: request.id,
      keycloakSubjectId,
      outcome: "denied",
      sourceSystem: "console",
    })
  } catch {
    // Authorization remains fail-closed when its audit sink is unavailable.
  }
}

function forbidden(reply: FastifyReply, detail: string) {
  return reply.code(403).send({
    type: "about:blank",
    title: "Forbidden",
    status: 403,
    detail,
  })
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
      if (!hasVerifiableKeycloakConfig(config)) {
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

  if (!hasVerifiableKeycloakConfig(config)) {
    return { ok: false, reason: "invalid_token" }
  }

  const actor = await actorFromKeycloakJwt(token, config)
  return actor ? { ok: true, actor } : { ok: false, reason: "invalid_token" }
}

function getAuthConfig(): AuthConfig {
  const testRuntime = process.env.NODE_ENV === "test"
  return {
    allowHeaderOnlyServiceAuth: testRuntime,
    keycloakIssuerUrl: trimTrailingSlash(process.env.KEYCLOAK_ISSUER_URL),
    keycloakAudience: process.env.KEYCLOAK_AUDIENCE,
    requireForwardedKeycloakToken:
      !testRuntime || envFlag("BFF_REQUIRE_FORWARDED_KEYCLOAK_TOKEN", false),
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

function hasVerifiableKeycloakConfig(config: AuthConfig): boolean {
  return Boolean(
    config.keycloakIssuerUrl &&
      (config.keycloakAudience || process.env.NODE_ENV === "test"),
  )
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
  const role = humanRoleFromRoles(roles)
  if (!role) {
    return null
  }

  return {
    subject,
    email: getHeaderValue(request, config.serviceKeyEmailHeader),
    role,
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

  const role = humanRoleFromRoles(payload.roles)
  if (!role) {
    return null
  }

  return {
    subject: payload.subject,
    email: payload.email,
    role,
    groups: payload.groups,
    authMode: "keycloak",
    authTime: payload.authTime,
    acr: payload.acr,
    amr: payload.amr,
  }
}

function humanRoleFromRoles(roles: string[]): InferenceCoreHumanRole | null {
  if (
    roles.some((role) => {
      const normalized = role.toLowerCase()
      return (
        (normalized === "admin" || normalized === "operator") &&
        role !== normalized
      )
    })
  ) {
    return null
  }
  const normalized = new Set(roles)
  const retainedRoles = inferenceCoreHumanRoleSchema.options.filter((role) =>
    normalized.has(role),
  )
  return retainedRoles.length === 1 ? retainedRoles[0] : null
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
