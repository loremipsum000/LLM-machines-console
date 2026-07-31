import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { verifyKeycloakJwt } from "../auth/keycloak-jwt"
import {
  type ChatCompletionsBody,
  isChatCompletionsBody,
} from "../inference/chat-completions"
import {
  type ConnectedAppGatewayReservation,
  type ConnectedAppRuntimeIdentity,
  consumeConnectedAppGatewayRateLimit,
  reconcileConnectedAppGatewayUsage,
  recordConnectedAppGatewayUsage,
  reserveConnectedAppGatewayTokens,
  resolveConnectedAppRuntimeIdentity,
  resolveConnectedAppRuntimeIdentityByApiKey,
} from "../services/admin-connected-apps"
import { evaluateApplicationGatewayPolicy } from "../services/application-gateway-policy"
import { emitAudit } from "../services/audit"
import {
  createLiteLlmChatTransport,
  fetchLiteLlmModels,
  isStreamingChatCompletionsRequest,
  parseOpenAIUsageTokens,
} from "../services/litellm-chat-transport"

const DEFAULT_TOKEN_RESERVATION = 2048

export function registerAppGatewayRoutes(server: FastifyInstance): void {
  server.get("/api/app-gateway/v1/models", async (request, reply) => {
    reply.header("x-llm-machines-request-id", request.id)
    const auth = await authenticateConnectedApp(request)
    if (!auth.ok) {
      return sendGatewayProblem(reply, auth.status, auth.title, auth.detail)
    }

    const policy = evaluateApplicationGatewayPolicy(auth.app, null)
    if (!policy.ok) {
      await safelyAuditGatewayRequest(request, auth.app, {
        latencyMs: 0,
        model: null,
        route: "models",
        status: policy.status,
        tokens: 0,
      })
      return sendGatewayProblem(
        reply,
        policy.status,
        policy.title,
        policy.detail,
      )
    }
    const rateLimit = await consumeConnectedAppGatewayRateLimit(auth.app)
    if (!rateLimit.ok) {
      await safelyAuditGatewayRequest(request, auth.app, {
        latencyMs: 0,
        model: null,
        route: "models",
        status: rateLimit.status,
        tokens: 0,
      })
      return sendGatewayProblem(
        reply,
        rateLimit.status,
        rateLimit.title,
        rateLimit.detail,
      )
    }

    const models = await fetchLiteLlmModels(auth.app.allowedModels)
    if (!models.ok) {
      await safelyAuditGatewayRequest(request, auth.app, {
        latencyMs: 0,
        model: null,
        route: "models",
        status: models.status,
        tokens: 0,
      })
      return sendGatewayProblem(
        reply,
        models.status,
        models.title,
        models.detail,
      )
    }

    await safelyAuditGatewayRequest(request, auth.app, {
      latencyMs: 0,
      model: null,
      route: "models",
      status: 200,
      tokens: 0,
    })
    return reply.send(models.body)
  })

  server.post(
    "/api/app-gateway/v1/chat/completions",
    async (request, reply) => {
      reply.header("x-llm-machines-request-id", request.id)
      const auth = await authenticateConnectedApp(request)
      if (!auth.ok) {
        return sendGatewayProblem(reply, auth.status, auth.title, auth.detail)
      }
      if (!isChatCompletionsBody(request.body)) {
        return sendGatewayProblem(
          reply,
          400,
          "Invalid chat completion body",
          "`model` and `messages` are required.",
        )
      }

      const policy = evaluateApplicationGatewayPolicy(
        auth.app,
        request.body.model,
      )
      if (!policy.ok) {
        await safelyAuditGatewayRequest(request, auth.app, {
          latencyMs: 0,
          model: request.body.model,
          route: "chat_completions",
          status: policy.status,
          tokens: 0,
        })
        return sendGatewayProblem(
          reply,
          policy.status,
          policy.title,
          policy.detail,
        )
      }
      const rateLimit = await consumeConnectedAppGatewayRateLimit(auth.app)
      if (!rateLimit.ok) {
        await safelyAuditGatewayRequest(request, auth.app, {
          latencyMs: 0,
          model: request.body.model,
          route: "chat_completions",
          status: rateLimit.status,
          tokens: 0,
        })
        return sendGatewayProblem(
          reply,
          rateLimit.status,
          rateLimit.title,
          rateLimit.detail,
        )
      }

      return proxyChatCompletions(request, reply, auth.app, request.body)
    },
  )
}

type ConnectedAppAuthResult =
  | { app: ConnectedAppRuntimeIdentity; ok: true }
  | { detail: string; ok: false; status: 401 | 403; title: string }

async function authenticateConnectedApp(
  request: FastifyRequest,
): Promise<ConnectedAppAuthResult> {
  const token = bearerToken(request)
  if (!token) {
    return {
      detail: "Pass a connected app bearer token.",
      ok: false,
      status: 401,
      title: "Connected app token required",
    }
  }

  const staticKeyApp = await resolveConnectedAppRuntimeIdentityByApiKey(token)
  if (staticKeyApp) {
    return { app: staticKeyApp, ok: true }
  }

  const oauthIdentity = await oauthIdentityFromToken(token)
  if (!oauthIdentity) {
    return {
      detail: "The connected app bearer token could not be verified.",
      ok: false,
      status: 401,
      title: "Invalid connected app token",
    }
  }

  const app = await resolveConnectedAppRuntimeIdentity(oauthIdentity.clientId)
  if (!app) {
    return {
      detail: "The connected app client is not registered in Console.",
      ok: false,
      status: 403,
      title: "Unknown connected app",
    }
  }

  return {
    app: {
      ...app,
      keycloakSubjectId: oauthIdentity.keycloakSubjectId,
    },
    ok: true,
  }
}

async function oauthIdentityFromToken(token: string): Promise<{
  clientId: string
  keycloakSubjectId: string
} | null> {
  if (
    process.env.NODE_ENV === "test" &&
    token.startsWith("fixture-connected-app:")
  ) {
    const clientId = token.slice("fixture-connected-app:".length).trim()
    return clientId
      ? {
          clientId,
          keycloakSubjectId: `fixture-subject:${clientId}`,
        }
      : null
  }

  const payload = await verifyKeycloakJwt(token)
  if (!payload) {
    return null
  }
  const clientId = payload.azp ?? payload.clientId
  if (!clientId) {
    return null
  }
  return {
    clientId,
    keycloakSubjectId: payload.subject,
  }
}

async function proxyChatCompletions(
  request: FastifyRequest,
  reply: FastifyReply,
  app: ConnectedAppRuntimeIdentity,
  body: ChatCompletionsBody,
): Promise<FastifyReply | undefined> {
  const transport = createLiteLlmChatTransport()
  if (!transport) {
    const status = 503
    await safelyAuditGatewayRequest(request, app, {
      latencyMs: 0,
      model: body.model,
      route: "chat_completions",
      status,
      tokens: 0,
    })
    return sendGatewayProblem(
      reply,
      status,
      "LiteLLM is not configured",
      "Set LITELLM_URL and LITELLM_KEY for app gateway chat pass-through.",
    )
  }

  const startedAt = Date.now()
  let reservation: Awaited<ReturnType<typeof reserveConnectedAppGatewayTokens>>
  try {
    reservation = await reserveConnectedAppGatewayTokens(
      app,
      estimateTokenReservation(body),
    )
  } catch (error) {
    logGatewayAccountingFailure(request, app, "reserve", error)
    return sendGatewayProblem(
      reply,
      503,
      "Connected app accounting unavailable",
      "The connected app request could not reserve its token budget. Retry later.",
      "accounting_unavailable",
    )
  }
  if (!reservation.ok) {
    await safelyAuditGatewayRequest(request, app, {
      latencyMs: 0,
      model: body.model,
      route: "chat_completions",
      status: reservation.status,
      tokens: 0,
    })
    return sendGatewayProblem(
      reply,
      reservation.status,
      reservation.title,
      reservation.detail,
    )
  }
  const controller = new AbortController()
  request.raw.on("close", () => controller.abort())

  const transportResult = await transport.createChatCompletion(
    body,
    controller.signal,
  )
  if (!transportResult.ok) {
    await safelyAuditGatewayRequest(
      request,
      app,
      {
        latencyMs: Date.now() - startedAt,
        model: body.model,
        route: "chat_completions",
        status: 502,
        tokens: 0,
      },
      reservation.reservation,
    )
    return sendGatewayProblem(
      reply,
      502,
      "LiteLLM chat completion failed",
      "LiteLLM could not complete the connected app request.",
    )
  }
  const upstream = transportResult.response

  if (!upstream.ok || !upstream.body) {
    await safelyAuditGatewayRequest(
      request,
      app,
      {
        latencyMs: Date.now() - startedAt,
        model: body.model,
        route: "chat_completions",
        status: upstream.status,
        tokens: 0,
      },
      reservation.reservation,
    )
    return sendGatewayProblem(
      reply,
      upstream.status,
      "LiteLLM chat completion failed",
      `LiteLLM returned HTTP ${upstream.status} for the connected app request.`,
    )
  }

  if (!isStreamingChatCompletionsRequest(body)) {
    const responseText = await upstream.text()
    const tokens = parseOpenAIUsageTokens(responseText)
    await safelyAuditGatewayRequest(
      request,
      app,
      {
        latencyMs: Date.now() - startedAt,
        model: body.model,
        route: "chat_completions",
        status: upstream.status,
        tokens,
      },
      reservation.reservation,
    )
    reply.code(upstream.status)
    reply.header(
      "Content-Type",
      upstream.headers.get("content-type") ?? "application/json",
    )
    return reply.send(responseText)
  }

  const streamedUsage = await pipeOpenAIStream(request, reply, upstream)
  await safelyAuditGatewayRequest(
    request,
    app,
    {
      latencyMs: Date.now() - startedAt,
      model: body.model,
      route: "chat_completions",
      status: upstream.status,
      tokens: streamedUsage.tokens,
    },
    reservation.reservation,
  )
  return undefined
}

async function safelyAuditGatewayRequest(
  request: FastifyRequest,
  app: ConnectedAppRuntimeIdentity,
  input: {
    latencyMs: number
    model: string | null
    route: "chat_completions" | "models"
    status: number
    tokens: number
  },
  reservation?: ConnectedAppGatewayReservation,
): Promise<void> {
  try {
    await auditGatewayRequest(app, input, request.id, reservation)
  } catch (error) {
    logGatewayAccountingFailure(request, app, "reconcile", error)
  }
}

function logGatewayAccountingFailure(
  request: FastifyRequest,
  app: ConnectedAppRuntimeIdentity,
  operation: "reconcile" | "reserve",
  error: unknown,
): void {
  request.log.error(
    {
      appId: app.appId,
      environment: app.environment,
      err: error,
      operation,
      requestId: request.id,
    },
    "Connected app gateway accounting failed",
  )
}

async function auditGatewayRequest(
  app: ConnectedAppRuntimeIdentity,
  input: {
    latencyMs: number
    model: string | null
    route: "chat_completions" | "models"
    status: number
    tokens: number
  },
  correlationId: string,
  reservation?: ConnectedAppGatewayReservation,
): Promise<void> {
  const usageInput = {
    environment: app.environment,
    latencyMs: input.latencyMs,
    model: input.model,
    status: input.status,
    tokens: input.tokens,
  }
  if (reservation) {
    await reconcileConnectedAppGatewayUsage(app.appId, usageInput, reservation)
  } else {
    await recordConnectedAppGatewayUsage(app.appId, usageInput)
  }
  await emitAudit({
    actorId: app.keycloakSubjectId ?? app.credentialRecordId,
    action: `connected_app.gateway.${input.route}`,
    targetType: "connected_app",
    targetId: app.appId,
    metadata: {
      applicationId: app.appId,
      authMethod: app.authMethod,
      correlationId,
      credentialRecordId: app.credentialRecordId,
      keycloakSubjectId: app.keycloakSubjectId,
      outcome:
        input.status >= 200 && input.status < 400
          ? "succeeded"
          : input.status === 401 || input.status === 403
            ? "denied"
            : "failed",
      sourceSystem: "console",
    },
  })
}

async function pipeOpenAIStream(
  request: FastifyRequest,
  reply: FastifyReply,
  upstream: Response,
): Promise<{ tokens: number }> {
  reply.hijack()
  reply.raw.writeHead(200, {
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Encoding": "identity",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
    "x-llm-machines-request-id": request.id,
  })

  const reader = upstream.body?.getReader()
  if (!reader) {
    reply.raw.write("data: [DONE]\n\n")
    reply.raw.end()
    return { tokens: 0 }
  }

  request.raw.on("close", () => {
    reader.cancel().catch(() => undefined)
  })

  const decoder = new TextDecoder()
  const parser = new SseUsageParser()
  let usageTokens = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      usageTokens = Math.max(
        usageTokens,
        parser.push(decoder.decode(value, { stream: true })),
      )
      if (!reply.raw.write(value)) {
        await new Promise<void>((resolve) => {
          reply.raw.once("drain", resolve)
        })
      }
    }
  } finally {
    usageTokens = Math.max(usageTokens, parser.finish())
    reply.raw.end()
  }
  return { tokens: usageTokens }
}

function sendGatewayProblem(
  reply: FastifyReply,
  status: number,
  title: string,
  detail: string,
  code?: string,
): FastifyReply {
  const requestId = reply.request.id
  reply.header("x-llm-machines-request-id", requestId)
  return reply.code(status).send({
    ...(code ? { code } : {}),
    detail,
    request_id: requestId,
    status,
    title,
    type: "about:blank",
  })
}

function bearerToken(request: FastifyRequest): string | null {
  const value = request.headers.authorization
  return value?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null
}

function estimateTokenReservation(body: ChatCompletionsBody): number {
  for (const field of ["max_tokens", "max_completion_tokens"]) {
    const value = body[field]
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value)
    }
  }
  const configured = Number.parseInt(
    process.env.CONNECTED_APP_DEFAULT_TOKEN_RESERVATION ??
      String(DEFAULT_TOKEN_RESERVATION),
    10,
  )
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_TOKEN_RESERVATION
}

class SseUsageParser {
  private buffer = ""

  push(chunk: string): number {
    this.buffer += chunk
    return this.drainCompleteEvents()
  }

  finish(): number {
    const pending = this.buffer
    this.buffer = ""
    return parseOpenAIUsageTokens(pending)
  }

  private drainCompleteEvents(): number {
    let maxTokens = 0
    while (true) {
      const separator = this.nextSeparator()
      if (!separator) {
        return maxTokens
      }
      const event = this.buffer.slice(0, separator.index)
      this.buffer = this.buffer.slice(separator.index + separator.length)
      maxTokens = Math.max(maxTokens, parseOpenAIUsageTokens(event))
    }
  }

  private nextSeparator(): { index: number; length: number } | null {
    const unix = this.buffer.indexOf("\n\n")
    const windows = this.buffer.indexOf("\r\n\r\n")
    if (unix < 0 && windows < 0) {
      return null
    }
    if (windows >= 0 && (unix < 0 || windows < unix)) {
      return { index: windows, length: 4 }
    }
    return { index: unix, length: 2 }
  }
}
