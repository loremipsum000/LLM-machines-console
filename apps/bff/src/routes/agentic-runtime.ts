import { createHash, randomUUID } from "node:crypto"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import {
  agenticAdapterDiagnosticsResponseSchema,
  agenticAdapterEgressResponseSchema,
  agenticAdapterApplyEgressRequestSchema,
  agenticAdapterRevokeEgressRequestSchema,
  agenticAdapterRevokeEgressResponseSchema,
  agenticRuntimeHistoryResponseSchema,
  type AgenticRuntime,
  type AgenticRuntimeStatus,
  agenticStatusResponseSchema,
  agenticRuntimeSchema,
  createEgressApprovalSchema,
  hermesAccessResponseSchema,
  openClawAccessResponseSchema,
} from "@llm-machines/contracts"
import { withPersona } from "../auth/persona"
import {
  signApprovalEnvelope,
  signRevocationEnvelope,
} from "../services/approval-envelope"
import {
  createEgressApprovalRecord,
  getEgressApprovalRecord,
  markEgressApprovalResult,
  markEgressApprovalRevoked,
} from "../services/egress-approvals"
import {
  getAgenticRuntimeHistory,
  recordAgenticRuntimeSnapshots,
} from "../services/agentic-runtime-history"
import {
  completeIdempotency,
  reserveIdempotency,
} from "../services/idempotency"
import { emitAudit } from "../services/audit"
import { recordPolicyViolation } from "../services/policy-violations"
import { upsertActorUser } from "../services/users"

const runtimeProfiles = {
  openclaw: "openclaw-restricted",
  hermes: "hermes-restricted",
} as const

export function registerAgenticRuntimeRoutes(server: FastifyInstance): void {
  server.get(
    "/api/admin/agentic/status",
    withPersona("admin"),
    async (request) => {
      const status = agenticStatusResponseSchema.parse(await getAgenticStatus())
      await recordAgenticRuntimeSnapshots(status)
      const actor = request.actor
      if (!actor) {
        throw new Error("Agentic status route executed without an actor.")
      }

      await emitAudit({
        actorId: actor.subject,
        action: "admin.agentic_runtime.status.read",
        targetType: "agentic.runtime",
        targetId: "status",
        metadata: {
          configuredRuntimes: status.runtimes.filter(
            (runtime) => runtime.configured,
          ).length,
          healthyRuntimes: status.runtimes.filter((runtime) => runtime.healthy)
            .length,
        },
      })

      return status
    },
  )

  server.get(
    "/api/admin/agentic/history",
    withPersona("admin"),
    async (request) => {
      const actor = request.actor
      if (!actor) {
        throw new Error("Agentic history route executed without an actor.")
      }

      const history = agenticRuntimeHistoryResponseSchema.parse(
        await getAgenticRuntimeHistory(parseWindowHours(request.query)),
      )
      await emitAudit({
        actorId: actor.subject,
        action: "admin.agentic_runtime.history.read",
        targetType: "agentic.runtime",
        targetId: "history",
        metadata: {
          windowHours: history.windowHours,
          sampleCount: history.samples.length,
          sloStatuses: Object.fromEntries(
            history.slos.map((slo) => [slo.runtime, slo.status]),
          ),
        },
      })

      return history
    },
  )

  server.post(
    "/api/admin/agentic/egress-approvals",
    withPersona("admin"),
    async (request, reply) => {
      const parsed = createEgressApprovalSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid egress approval",
          status: 400,
          detail: parsed.error.issues.map((issue) => issue.message).join("; "),
        })
      }

      const actor = request.actor
      if (!actor) {
        return reply.code(401).send({
          type: "about:blank",
          title: "Unauthenticated",
          status: 401,
          detail: "A valid admin actor is required.",
        })
      }
      if (!runtimeControlAllowed(actor.subject)) {
        await emitAudit({
          actorId: actor.subject,
          action: "admin.agentic_runtime.control.denied",
          targetType: "agentic.runtime",
          targetId: "egress-approval",
          reason: "runtime_control_not_allowed",
          metadata: {
            route: "POST /api/admin/agentic/egress-approvals",
          },
        })
        return reply.code(403).send({
          type: "about:blank",
          title: "Runtime control is restricted",
          status: 403,
          detail:
            "This admin is not in AGENTIC_RUNTIME_CONTROL_ADMIN_SUBJECTS.",
        })
      }

      const idempotencyKey = getHeaderValue(request, "idempotency-key")
      if (!idempotencyKey) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Idempotency key is required",
          status: 400,
          detail:
            "Pass an Idempotency-Key header for egress approval mutations.",
        })
      }

      const requestHash = hashJson(parsed.data)
      const reservation = await reserveIdempotency({
        actorId: actor.subject,
        route: "POST /api/admin/agentic/egress-approvals",
        idempotencyKey,
        requestHash,
      })
      if (reservation.status === "replay") {
        return reply.code(reservation.statusCode).send(reservation.response)
      }
      if (reservation.status === "conflict") {
        return reply.code(409).send({
          type: "about:blank",
          title: "Idempotency key conflict",
          status: 409,
          detail:
            "This Idempotency-Key was already used with a different request body.",
        })
      }
      if (reservation.status === "pending") {
        return reply.code(409).send({
          type: "about:blank",
          title: "Egress approval is still in progress",
          status: 409,
          detail:
            "This Idempotency-Key is already processing. Retry after the first request finishes.",
        })
      }

      const adapterBaseUrl = getAdapterBaseUrl()
      const adapterToken = process.env.AGENTIC_ADAPTER_TOKEN
      const signingSecret = process.env.AGENTIC_APPROVAL_SIGNING_SECRET
      if (!adapterBaseUrl || !adapterToken || !signingSecret) {
        const responsePayload = {
          type: "about:blank",
          title: "Egress approval adapter is not configured",
          status: 501,
          detail:
            "The request is valid, but applying sandbox egress requires AGENTIC_ADAPTER_BASE_URL, AGENTIC_ADAPTER_TOKEN, and AGENTIC_APPROVAL_SIGNING_SECRET.",
        }
        await completeIdempotency({
          storeKey: reservation.storeKey,
          requestHash,
          statusCode: 501,
          response: responsePayload,
        })
        return reply.code(501).send(responsePayload)
      }

      const approvalId = randomUUID()
      const adapterRequest = agenticAdapterApplyEgressRequestSchema.parse({
        ...parsed.data,
        approvalId,
        approvedBy: actor.subject,
      })
      const envelope = signApprovalEnvelope({
        request: adapterRequest,
        actor,
      })

      await upsertActorUser(actor)
      await createEgressApprovalRecord({
        approvalId,
        approval: parsed.data,
        approvedBy: actor.subject,
        idempotencyKey,
        requestHash,
      })
      await emitAudit({
        actorId: actor.subject,
        action: "egress_approval.requested",
        targetType: "admin.egress_approvals",
        targetId: approvalId,
        reason: parsed.data.reason,
        metadata: {
          sandboxName: parsed.data.sandboxName,
          profile: parsed.data.profile,
          endpointHost: parsed.data.endpointHost,
          endpointPort: parsed.data.endpointPort,
          accessMode: parsed.data.accessMode,
          expiresAt: parsed.data.expiresAt ?? null,
          idempotencyKey,
        },
      })

      const adapterResponse = await fetch(
        new URL("/v1/egress/approvals", adapterBaseUrl),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${adapterToken}`,
            "Content-Type": "application/json",
            "X-LLM-Machines-Approval-Envelope": envelope,
          },
          body: JSON.stringify(adapterRequest),
        },
      )

      const responseBody = await parseAdapterResponse(adapterResponse)
      if (!adapterResponse.ok) {
        const failure = problemDetails(responseBody, adapterResponse.status)
        await markEgressApprovalResult({
          approvalId,
          failureDetail: failure.detail,
        })
        await emitAudit({
          actorId: actor.subject,
          action: "egress_approval.failed",
          targetType: "admin.egress_approvals",
          targetId: approvalId,
          reason: parsed.data.reason,
          metadata: {
            status: adapterResponse.status,
            detail: failure.detail,
          },
        })
        if (isAdapterPolicyDenial(adapterResponse.status)) {
          await recordPolicyViolation({
            actor,
            policyType: "data_governance",
            severity: adapterResponse.status === 403 ? "critical" : "warning",
            actionTaken: "block",
            targetType: "admin.egress_approvals",
            targetId: approvalId,
            message: "Sandbox egress approval was blocked by adapter policy.",
            metadata: {
              accessMode: parsed.data.accessMode,
              detail: failure.detail,
              endpointHost: parsed.data.endpointHost,
              endpointPort: parsed.data.endpointPort,
              profile: parsed.data.profile,
              sandboxName: parsed.data.sandboxName,
              status: adapterResponse.status,
            },
          })
        }
        await completeIdempotency({
          storeKey: reservation.storeKey,
          requestHash,
          statusCode: adapterResponse.status,
          response: failure,
        })
        return reply.code(adapterResponse.status).send(failure)
      }

      const responsePayload =
        agenticAdapterEgressResponseSchema.parse(responseBody)
      const status = await markEgressApprovalResult({
        approvalId,
        response: responsePayload,
      })
      await emitAudit({
        actorId: actor.subject,
        action:
          status === "dry_run"
            ? "egress_approval.dry_run"
            : "egress_approval.applied",
        targetType: "admin.egress_approvals",
        targetId: approvalId,
        reason: parsed.data.reason,
        metadata: {
          sandboxName: responsePayload.sandboxName,
          endpoint: responsePayload.endpoint,
          command: responsePayload.command,
          rollbackCommand: responsePayload.rollbackCommand,
        },
      })
      await completeIdempotency({
        storeKey: reservation.storeKey,
        requestHash,
        statusCode: 201,
        response: responsePayload,
      })

      return reply.code(201).send(responsePayload)
    },
  )

  server.post(
    "/api/admin/agentic/egress-approvals/:approvalId/revoke",
    withPersona("admin"),
    async (request, reply) => {
      const params = parseRevokeEgressApprovalParams(request.params)
      if (!params.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid egress approval",
          status: 400,
          detail: params.detail,
        })
      }

      const parsed = parseRevokeEgressApprovalBody(request.body)
      if (!parsed.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid egress revocation",
          status: 400,
          detail: parsed.detail,
        })
      }

      const actor = request.actor
      if (!actor) {
        return reply.code(401).send({
          type: "about:blank",
          title: "Unauthenticated",
          status: 401,
          detail: "A valid admin actor is required.",
        })
      }
      if (!runtimeControlAllowed(actor.subject)) {
        await emitAudit({
          actorId: actor.subject,
          action: "admin.agentic_runtime.control.denied",
          targetType: "agentic.runtime",
          targetId: params.data.approvalId,
          reason: "runtime_control_not_allowed",
          metadata: {
            route:
              "POST /api/admin/agentic/egress-approvals/:approvalId/revoke",
          },
        })
        return reply.code(403).send({
          type: "about:blank",
          title: "Runtime control is restricted",
          status: 403,
          detail:
            "This admin is not in AGENTIC_RUNTIME_CONTROL_ADMIN_SUBJECTS.",
        })
      }

      const idempotencyKey = getHeaderValue(request, "idempotency-key")
      if (!idempotencyKey) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Idempotency key is required",
          status: 400,
          detail:
            "Pass an Idempotency-Key header for egress revocation mutations.",
        })
      }

      const approval = await getEgressApprovalRecord(params.data.approvalId)
      if (!approval) {
        return reply.code(404).send({
          type: "about:blank",
          title: "Egress approval not found",
          status: 404,
          detail: "No egress approval exists for this ID.",
        })
      }
      if (approval.status !== "active") {
        return reply.code(409).send({
          type: "about:blank",
          title: "Egress approval is not active",
          status: 409,
          detail: "Only active egress approvals can be revoked.",
        })
      }

      const adapterBaseUrl = getAdapterBaseUrl()
      const adapterToken = process.env.AGENTIC_ADAPTER_TOKEN
      const signingSecret = process.env.AGENTIC_APPROVAL_SIGNING_SECRET
      if (!adapterBaseUrl || !adapterToken || !signingSecret) {
        return reply.code(501).send({
          type: "about:blank",
          title: "Egress approval adapter is not configured",
          status: 501,
          detail:
            "Revoking sandbox egress requires AGENTIC_ADAPTER_BASE_URL, AGENTIC_ADAPTER_TOKEN, and AGENTIC_APPROVAL_SIGNING_SECRET.",
        })
      }

      const requestHash = hashJson({
        approvalId: params.data.approvalId,
        reason: parsed.data.reason,
      })
      const reservation = await reserveIdempotency({
        actorId: actor.subject,
        route: "POST /api/admin/agentic/egress-approvals/:approvalId/revoke",
        idempotencyKey,
        requestHash,
      })
      if (reservation.status === "replay") {
        return reply.code(reservation.statusCode).send(reservation.response)
      }
      if (reservation.status === "conflict") {
        return reply.code(409).send({
          type: "about:blank",
          title: "Idempotency key conflict",
          status: 409,
          detail:
            "This Idempotency-Key was already used with a different request body.",
        })
      }
      if (reservation.status === "pending") {
        return reply.code(409).send({
          type: "about:blank",
          title: "Egress revocation is still in progress",
          status: 409,
          detail:
            "This Idempotency-Key is already processing. Retry after the first request finishes.",
        })
      }

      const adapterRequest = agenticAdapterRevokeEgressRequestSchema.parse({
        approvalId: params.data.approvalId,
        revokedBy: actor.subject,
        sandboxName: approval.input.sandboxName,
        profile: approval.input.profile,
        endpointHost: approval.input.endpointHost,
        endpointPort: approval.input.endpointPort,
        reason: parsed.data.reason,
      })
      const envelope = signRevocationEnvelope({
        request: adapterRequest,
        actor,
      })

      await upsertActorUser(actor)
      await emitAudit({
        actorId: actor.subject,
        action: "egress_approval.revoke_requested",
        targetType: "admin.egress_approvals",
        targetId: params.data.approvalId,
        reason: parsed.data.reason,
        metadata: {
          sandboxName: approval.input.sandboxName,
          profile: approval.input.profile,
          endpointHost: approval.input.endpointHost,
          endpointPort: approval.input.endpointPort,
          idempotencyKey,
        },
      })

      const adapterResponse = await fetch(
        new URL("/v1/egress/revocations", adapterBaseUrl),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${adapterToken}`,
            "Content-Type": "application/json",
            "X-LLM-Machines-Revocation-Envelope": envelope,
          },
          body: JSON.stringify(adapterRequest),
        },
      )

      const responseBody = await parseAdapterResponse(adapterResponse)
      if (!adapterResponse.ok) {
        const failure = problemDetails(responseBody, adapterResponse.status)
        await emitAudit({
          actorId: actor.subject,
          action: "egress_approval.revoke_failed",
          targetType: "admin.egress_approvals",
          targetId: params.data.approvalId,
          reason: parsed.data.reason,
          metadata: {
            adapterStatus: adapterResponse.status,
            detail: failure.detail,
          },
        })
        await completeIdempotency({
          storeKey: reservation.storeKey,
          requestHash,
          statusCode: adapterResponse.status,
          response: failure,
        })
        return reply.code(adapterResponse.status).send(failure)
      }

      const responsePayload =
        agenticAdapterRevokeEgressResponseSchema.parse(responseBody)
      if (responsePayload.status === "revoked") {
        await markEgressApprovalRevoked({
          approvalId: params.data.approvalId,
          response: responsePayload,
        })
      }
      await emitAudit({
        actorId: actor.subject,
        action:
          responsePayload.status === "dry_run"
            ? "egress_approval.revoke_dry_run"
            : "egress_approval.revoked",
        targetType: "admin.egress_approvals",
        targetId: params.data.approvalId,
        reason: parsed.data.reason,
        metadata: {
          sandboxName: responsePayload.sandboxName,
          endpoint: responsePayload.endpoint,
          command: responsePayload.command,
        },
      })
      await completeIdempotency({
        storeKey: reservation.storeKey,
        requestHash,
        statusCode: 200,
        response: responsePayload,
      })

      return reply.code(200).send(responsePayload)
    },
  )

  server.get(
    "/api/admin/agentic/openclaw/access",
    withPersona("admin"),
    async () => openClawAccessResponseSchema.parse(getOpenClawAccess()),
  )

  server.get(
    "/api/admin/agentic/adapter/diagnostics",
    withPersona("admin"),
    async (request) => {
      const actor = request.actor
      if (!actor) {
        throw new Error("Agentic diagnostics route executed without an actor.")
      }

      const diagnostics = agenticAdapterDiagnosticsResponseSchema.parse(
        await getAdapterDiagnostics(),
      )
      await emitAudit({
        actorId: actor.subject,
        action: "admin.agentic_runtime.adapter_diagnostics.read",
        targetType: "agentic.adapter",
        targetId: "diagnostics",
        metadata: {
          configured: diagnostics.configured,
          healthy: diagnostics.healthy,
          status: diagnostics.status,
          applyEnabled: diagnostics.applyEnabled,
        },
      })

      return diagnostics
    },
  )

  server.get(
    "/api/admin/agentic/hermes/access",
    withPersona("admin"),
    async () => hermesAccessResponseSchema.parse(getHermesAccess()),
  )

  server.post(
    "/api/admin/agentic/hermes/v1/chat/completions",
    withPersona("admin"),
    async (request, reply) => {
      return proxyJsonOrStream(request, reply, "hermes", "/v1/chat/completions")
    },
  )
}

function getOpenClawAccess(): {
  runtime: "openclaw"
  profile: "openclaw-restricted"
  configured: boolean
  dashboardUrl: string | null
  tokenRequired: true
} {
  const baseUrl = getRuntimeBaseUrl("openclaw")
  if (!baseUrl) {
    return {
      runtime: "openclaw",
      profile: "openclaw-restricted",
      configured: false,
      dashboardUrl: null,
      tokenRequired: true,
    }
  }

  const dashboardUrl = new URL("/", baseUrl).toString()
  return {
    runtime: "openclaw",
    profile: "openclaw-restricted",
    configured: true,
    dashboardUrl,
    tokenRequired: true,
  }
}

function getHermesAccess(): {
  runtime: "hermes"
  profile: "hermes-restricted"
  configured: boolean
  chatCompletionsProxyPath: string | null
  tokenRequired: true
} {
  const configured = Boolean(getRuntimeBaseUrl("hermes"))

  return {
    runtime: "hermes",
    profile: "hermes-restricted",
    configured,
    chatCompletionsProxyPath: configured
      ? "/api/admin/agentic/hermes/v1/chat/completions"
      : null,
    tokenRequired: true,
  }
}

async function getAdapterDiagnostics(): Promise<{
  configured: boolean
  healthy: boolean
  service: string | null
  status: "ok" | "degraded" | "not_configured" | "unavailable"
  baseUrl: string | null
  applyEnabled: boolean | null
  detail: string
}> {
  const adapterBaseUrl = getAdapterBaseUrl()
  const adapterToken = process.env.AGENTIC_ADAPTER_TOKEN
  if (!adapterBaseUrl || !adapterToken) {
    return {
      configured: false,
      healthy: false,
      service: "agentic-adapter",
      status: "not_configured",
      baseUrl: adapterBaseUrl ?? null,
      applyEnabled: null,
      detail:
        "Set AGENTIC_ADAPTER_BASE_URL and AGENTIC_ADAPTER_TOKEN before reading adapter diagnostics.",
    }
  }

  try {
    const adapterResponse = await fetch(
      new URL("/v1/diagnostics", adapterBaseUrl),
      {
        headers: {
          Authorization: `Bearer ${adapterToken}`,
        },
        signal: AbortSignal.timeout(3000),
      },
    )
    const body = await parseAdapterResponse(adapterResponse)
    if (!adapterResponse.ok) {
      return {
        configured: true,
        healthy: false,
        service: "agentic-adapter",
        status: "unavailable",
        baseUrl: adapterBaseUrl,
        applyEnabled: null,
        detail: problemDetails(body, adapterResponse.status).detail,
      }
    }

    const service =
      body && typeof body === "object" && "service" in body
        ? stringValue((body as { service?: unknown }).service)
        : null
    const rawStatus =
      body && typeof body === "object" && "status" in body
        ? stringValue((body as { status?: unknown }).status)
        : null
    const applyEnabled =
      body && typeof body === "object" && "applyEnabled" in body
        ? booleanValue((body as { applyEnabled?: unknown }).applyEnabled)
        : null
    const status = rawStatus === "ok" ? "ok" : "degraded"

    return {
      configured: true,
      healthy: status === "ok",
      service: service ?? "agentic-adapter",
      status,
      baseUrl: adapterBaseUrl,
      applyEnabled,
      detail: `HTTP ${adapterResponse.status}`,
    }
  } catch (error) {
    return {
      configured: true,
      healthy: false,
      service: "agentic-adapter",
      status: "unavailable",
      baseUrl: adapterBaseUrl,
      applyEnabled: null,
      detail:
        error instanceof Error
          ? `Adapter diagnostics request failed: ${error.message}`
          : "Adapter diagnostics request failed.",
    }
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

async function getAgenticStatus(): Promise<{
  runtimes: AgenticRuntimeStatus[]
}> {
  const runtimes: AgenticRuntime[] = ["openclaw", "hermes"]
  const statuses = await Promise.all(runtimes.map(getRuntimeStatus))

  return {
    runtimes: statuses,
  }
}

async function getRuntimeStatus(
  runtime: AgenticRuntime,
): Promise<AgenticRuntimeStatus> {
  const baseUrl = getRuntimeBaseUrl(runtime)
  if (!baseUrl) {
    return {
      runtime,
      profile: runtimeProfiles[runtime],
      configured: false,
      healthy: false,
      baseUrl: null,
      detail: "Base URL is not configured.",
    }
  }

  const healthPath = runtime === "hermes" ? "/health" : "/"

  try {
    const response = await fetch(new URL(healthPath, baseUrl), {
      signal: AbortSignal.timeout(3000),
    })
    return {
      runtime,
      profile: runtimeProfiles[runtime],
      configured: true,
      healthy: response.ok,
      baseUrl,
      detail: `HTTP ${response.status}`,
    }
  } catch {
    return {
      runtime,
      profile: runtimeProfiles[runtime],
      configured: true,
      healthy: false,
      baseUrl,
      detail: "Runtime health probe failed.",
    }
  }
}

async function proxyJsonOrStream(
  request: FastifyRequest,
  reply: FastifyReply,
  runtime: AgenticRuntime,
  path: string,
): Promise<FastifyReply | undefined> {
  const parsedRuntime = agenticRuntimeSchema.parse(runtime)
  const baseUrl = getRuntimeBaseUrl(parsedRuntime)
  if (!baseUrl) {
    return reply.code(503).send({
      type: "about:blank",
      title: "Agentic runtime is not configured",
      status: 503,
      detail: `Set ${getRuntimeEnvName(parsedRuntime)} before proxying requests.`,
    })
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-LLM-Machines-Actor": request.actor?.subject ?? "unknown",
  }
  const token = getRuntimeToken(parsedRuntime)
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const upstream = await fetch(new URL(path, baseUrl), {
    method: request.method,
    headers,
    body: JSON.stringify(request.body ?? {}),
  })

  if (!upstream.body) {
    reply.code(upstream.status)
    return reply.send(await upstream.text())
  }

  const contentType = upstream.headers.get("content-type") ?? "application/json"
  if (!contentType.includes("text/event-stream")) {
    reply.code(upstream.status)
    reply.header("Content-Type", contentType)
    return reply.send(await upstream.text())
  }

  reply.hijack()
  reply.raw.writeHead(upstream.status, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Encoding": "identity",
  })

  const reader = upstream.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      if (!reply.raw.write(value)) {
        await new Promise<void>((resolve) => {
          reply.raw.once("drain", resolve)
        })
      }
    }
  } finally {
    reply.raw.end()
  }

  return undefined
}

function getRuntimeToken(runtime: AgenticRuntime): string | undefined {
  return process.env[getRuntimeTokenEnvName(runtime)]
}

function getRuntimeTokenEnvName(runtime: AgenticRuntime): string {
  return runtime === "openclaw"
    ? "AGENTIC_OPENCLAW_TOKEN"
    : "AGENTIC_HERMES_TOKEN"
}

function getRuntimeBaseUrl(runtime: AgenticRuntime): string | undefined {
  return normalizeConfiguredUrl(process.env[getRuntimeEnvName(runtime)])
}

function getRuntimeEnvName(runtime: AgenticRuntime): string {
  return runtime === "openclaw"
    ? "AGENTIC_OPENCLAW_BASE_URL"
    : "AGENTIC_HERMES_BASE_URL"
}

function parseWindowHours(query: unknown): number {
  if (!query || typeof query !== "object" || !("windowHours" in query)) {
    return 24
  }
  const value = (query as { windowHours?: unknown }).windowHours
  if (typeof value !== "string") {
    return 24
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 168 ? parsed : 24
}

function parseRevokeEgressApprovalParams(
  params: unknown,
):
  | { success: true; data: { approvalId: string } }
  | { success: false; detail: string } {
  if (!params || typeof params !== "object" || !("approvalId" in params)) {
    return { success: false, detail: "approvalId is required." }
  }
  const approvalId = (params as { approvalId?: unknown }).approvalId
  if (
    typeof approvalId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      approvalId,
    )
  ) {
    return { success: false, detail: "approvalId must be a UUID." }
  }
  return { success: true, data: { approvalId } }
}

function parseRevokeEgressApprovalBody(
  body: unknown,
):
  | { success: true; data: { reason: string } }
  | { success: false; detail: string } {
  if (!body || typeof body !== "object" || !("reason" in body)) {
    return { success: false, detail: "reason is required." }
  }
  const reason = (body as { reason?: unknown }).reason
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return { success: false, detail: "reason must be a non-empty string." }
  }
  return { success: true, data: { reason: reason.trim() } }
}

function runtimeControlAllowed(actorSubject: string): boolean {
  const subjects = process.env.AGENTIC_RUNTIME_CONTROL_ADMIN_SUBJECTS?.split(
    ",",
  )
    .map((subject) => subject.trim())
    .filter(Boolean)
  if (!subjects || subjects.length === 0) {
    return true
  }
  return subjects.includes(actorSubject)
}

function getAdapterBaseUrl(): string | undefined {
  return normalizeConfiguredUrl(process.env.AGENTIC_ADAPTER_BASE_URL)
}

function normalizeConfiguredUrl(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\/+$/, "")
  return normalized || undefined
}

function isAdapterPolicyDenial(status: number): boolean {
  return status === 400 || status === 403
}

function getHeaderValue(
  request: FastifyRequest,
  name: string,
): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex")
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

async function parseAdapterResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    try {
      return await response.json()
    } catch {
      return {
        type: "about:blank",
        title: response.ok ? "Adapter response" : "Agentic adapter error",
        status: response.status,
        detail: `Adapter returned malformed JSON with HTTP ${response.status}.`,
      }
    }
  }

  const text = await response.text()
  return {
    type: "about:blank",
    title: response.ok ? "Adapter response" : "Agentic adapter error",
    status: response.status,
    detail: text || `Adapter returned HTTP ${response.status}.`,
  }
}

function problemDetails(
  value: unknown,
  status: number,
): {
  type: string
  title: string
  status: number
  detail: string
} {
  if (
    value &&
    typeof value === "object" &&
    "title" in value &&
    "detail" in value
  ) {
    const candidate = value as {
      type?: unknown
      title?: unknown
      status?: unknown
      detail?: unknown
    }
    return {
      type: typeof candidate.type === "string" ? candidate.type : "about:blank",
      title:
        typeof candidate.title === "string"
          ? candidate.title
          : "Agentic adapter error",
      status,
      detail:
        typeof candidate.detail === "string"
          ? candidate.detail
          : `Adapter returned HTTP ${status}.`,
    }
  }

  return {
    type: "about:blank",
    title: "Agentic adapter error",
    status,
    detail: `Adapter returned HTTP ${status}.`,
  }
}
