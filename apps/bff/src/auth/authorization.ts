import {
  type EmergencyRecoveryResolution,
  type InferenceCoreCapability,
  type InferenceCoreHumanRole,
  emergencyRecoveryApprovedMfaMethods,
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
import type { ConsoleSessionResolution } from "../services/console-session-service"
import { validOpaqueConsoleHandle } from "./console-session-cookie"
import { verifyKeycloakJwt } from "./keycloak-jwt"

export {
  resetJwksCachesForTest,
  verifyKeycloakJwt,
} from "./keycloak-jwt"
export type { VerifiedKeycloakJwt } from "./keycloak-jwt"

export type AuthMode = "console-session" | "keycloak" | "service-forwarded"

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
  mfaVerifiedAt?: Date | null
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

export type ConsoleSessionResolver = (
  sessionHandle: string,
  request: FastifyRequest,
) => Promise<ConsoleSessionResolution>

export interface AuthorizationOptions {
  resolveCurrentIdentity: LiveHumanAuthorityResolver
  resolveRecoverySession: EmergencyRecoverySessionResolver
  resolveConsoleSession?: ConsoleSessionResolver
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
  serviceApiKey?: string
}

type AuthFailureReason =
  | "missing_token"
  | "invalid_token"
  | "invalid_console_session"
  | "legacy_forwarding_rejected"
  | "terminal_console_session"
  | "identity_restart"
  | "identity_timeout"
  | "identity_unavailable"
  | "storage_unavailable"

type AuthResult =
  | { ok: true; actor: Actor }
  | { ok: false; reason: AuthFailureReason; status: 401 | 503 }

const consoleSessionHeader = "x-llm-machines-console-session"
const legacyForwardingHeaders = [
  "x-llm-machines-keycloak-token",
  "x-llm-machines-user-sub",
  "x-llm-machines-user-email",
  "x-llm-machines-user-roles",
  "x-llm-machines-user-groups",
] as const
const approvedMfaMethods = new Set<string>(emergencyRecoveryApprovedMfaMethods)

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

    const authResult = await authenticateRequest(
      request,
      options.resolveConsoleSession,
    )
    if (!authResult.ok) {
      await auditDenial(request)
      if (authResult.status === 503) {
        return reply.code(503).send({
          type: "about:blank",
          title:
            authResult.reason === "storage_unavailable"
              ? "Console session unavailable"
              : "Identity service unavailable",
          status: 503,
          detail:
            authResult.reason === "storage_unavailable"
              ? "Console session storage could not be reached. Retry the request."
              : "The identity service could not validate the Console session. Retry the request.",
          code: authResult.reason,
        })
      }
      return reply.code(401).send({
        type: "about:blank",
        title: "Unauthenticated",
        status: 401,
        detail:
          authResult.reason === "terminal_console_session"
            ? "The Console session is invalid, expired, or revoked."
            : "A valid Keycloak bearer token or opaque Console session is required.",
        code: authResult.reason,
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
    resolution.grant.scope !== "console_admin_capabilities"
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
    : roleHasInferenceCoreCapability(policyRole, policy.capability)
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
  resolveConsoleSession: ConsoleSessionResolver | undefined,
): Promise<AuthResult> {
  const authorization = request.headers.authorization
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) {
    return { ok: false, reason: "missing_token", status: 401 }
  }

  const config = getAuthConfig()
  if (config.serviceApiKey && token === config.serviceApiKey) {
    if (
      !config.allowHeaderOnlyServiceAuth &&
      hasLegacyForwardingHeader(request)
    ) {
      return {
        ok: false,
        reason: "legacy_forwarding_rejected",
        status: 401,
      }
    }

    const sessionHandle = singleHeaderValue(request, consoleSessionHeader)
    if (sessionHandle !== undefined) {
      if (!validOpaqueConsoleHandle(sessionHandle) || !resolveConsoleSession) {
        return { ok: false, reason: "invalid_console_session", status: 401 }
      }
      let resolution: ConsoleSessionResolution
      try {
        resolution = await resolveConsoleSession(sessionHandle, request)
      } catch {
        return { ok: false, reason: "storage_unavailable", status: 503 }
      }
      if (resolution.state === "unavailable") {
        return {
          ok: false,
          reason: unavailableSessionReason(resolution.reason),
          status: 503,
        }
      }
      if (resolution.state === "terminal") {
        return {
          ok: false,
          reason: "terminal_console_session",
          status: 401,
        }
      }
      return {
        ok: true,
        actor: {
          authMode: "console-session",
          email: resolution.session.email,
          groups: resolution.session.groups,
          mfaVerifiedAt: resolution.session.mfaVerifiedAt,
          role: resolution.session.role,
          subject: resolution.session.subject,
        },
      }
    }

    if (!config.allowHeaderOnlyServiceAuth) {
      return { ok: false, reason: "invalid_console_session", status: 401 }
    }
    const actor = actorFromForwardedHeaders(request)
    return actor
      ? { ok: true, actor }
      : { ok: false, reason: "invalid_console_session", status: 401 }
  }

  if (!hasVerifiableKeycloakConfig(config)) {
    return { ok: false, reason: "invalid_token", status: 401 }
  }

  const actor = await actorFromKeycloakJwt(token, config)
  return actor
    ? { ok: true, actor }
    : { ok: false, reason: "invalid_token", status: 401 }
}

function getAuthConfig(): AuthConfig {
  const testRuntime = process.env.NODE_ENV === "test"
  return {
    allowHeaderOnlyServiceAuth: testRuntime,
    keycloakIssuerUrl: trimTrailingSlash(process.env.KEYCLOAK_ISSUER_URL),
    keycloakAudience: process.env.KEYCLOAK_AUDIENCE,
    serviceApiKey: process.env.BFF_SERVICE_API_KEY,
  }
}

function hasVerifiableKeycloakConfig(config: AuthConfig): boolean {
  return Boolean(
    config.keycloakIssuerUrl &&
      (config.keycloakAudience || process.env.NODE_ENV === "test"),
  )
}

function actorFromForwardedHeaders(request: FastifyRequest): Actor | null {
  const subject = getHeaderValue(request, "x-llm-machines-user-sub")
  if (!subject) {
    return null
  }

  const roles = parseRoleHeader(
    getHeaderValue(request, "x-llm-machines-user-roles"),
  )
  const role = humanRoleFromRoles(roles)
  if (!role) {
    return null
  }

  return {
    subject,
    email: getHeaderValue(request, "x-llm-machines-user-email"),
    role,
    groups: parseGroupHeader(
      getHeaderValue(request, "x-llm-machines-user-groups"),
    ),
    authMode: "service-forwarded",
  }
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
  const mfaVerifiedAt = verifiedMfaTime(payload.authTime, payload.amr)

  return {
    subject: payload.subject,
    email: payload.email,
    role,
    groups: payload.groups,
    authMode: "keycloak",
    authTime: payload.authTime,
    acr: payload.acr,
    amr: payload.amr,
    mfaVerifiedAt,
  }
}

function verifiedMfaTime(
  authTime: number | undefined,
  methods: string[] | undefined,
): Date | null {
  if (
    authTime === undefined ||
    !Number.isSafeInteger(authTime) ||
    !methods?.some((method) => approvedMfaMethods.has(method.toLowerCase()))
  ) {
    return null
  }
  const verifiedAt = new Date(authTime * 1000)
  return Number.isNaN(verifiedAt.getTime()) ? null : verifiedAt
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

function singleHeaderValue(
  request: FastifyRequest,
  headerName: string,
): string | undefined {
  const value = request.headers[headerName]
  return typeof value === "string" ? value : undefined
}

function hasLegacyForwardingHeader(request: FastifyRequest): boolean {
  return legacyForwardingHeaders.some(
    (header) => request.headers[header] !== undefined,
  )
}

function unavailableSessionReason(reason: string): AuthFailureReason {
  return reason === "identity_restart" ||
    reason === "identity_timeout" ||
    reason === "identity_unavailable" ||
    reason === "storage_unavailable"
    ? reason
    : "storage_unavailable"
}

function trimTrailingSlash(value?: string): string | undefined {
  return value?.replace(/\/+$/, "")
}
