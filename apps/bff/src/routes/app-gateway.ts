import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { verifyKeycloakJwt } from "../auth/persona"
import { canUseBffFixtureData } from "../config/fixture-mode"
import {
  isChatCompletionsBody,
  normalizeTextOnlyChatCompletionsBody,
} from "../openai/types"
import type { ChatCompletionsBody } from "../openai/types"
import {
  type ConnectedAppGatewayReservation,
  type ConnectedAppRuntimeIdentity,
  consumeConnectedAppGatewayRateLimit,
  recordConnectedAppGatewayUsage,
  reconcileConnectedAppGatewayUsage,
  reserveConnectedAppGatewayTokens,
  resolveConnectedAppRuntimeIdentity,
  resolveConnectedAppRuntimeIdentityByApiKey,
} from "../services/admin-connected-apps"
import { emitAudit } from "../services/audit"

const fallbackModels = ["llm-machines-default"]
const DEFAULT_TOKEN_RESERVATION = 2048

export function registerAppGatewayRoutes(server: FastifyInstance): void {
  server.get("/api/app-gateway/v1/models", async (request, reply) => {
    reply.header("x-llm-machines-request-id", request.id)
    const auth = await authenticateConnectedApp(request)
    if (!auth.ok) {
      return sendGatewayProblem(reply, auth.status, auth.title, auth.detail)
    }

    const policy = runtimePolicy(auth.app, null)
    if (!policy.ok) {
      await safelyAuditGatewayRequest(request, auth.app, {
        latencyMs: 0,
        model: null,
        route: "models",
        status: policy.status,
        tokens: 0,
      })
      return sendGatewayProblem(reply, policy.status, policy.title, policy.detail)
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

    const models = await fetchModels(auth.app.allowedModels)
    if (!models.ok) {
      await safelyAuditGatewayRequest(request, auth.app, {
        latencyMs: 0,
        model: null,
        route: "models",
        status: models.status,
        tokens: 0,
      })
      return sendGatewayProblem(reply, models.status, models.title, models.detail)
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

      const policy = runtimePolicy(auth.app, request.body.model)
      if (!policy.ok) {
        await safelyAuditGatewayRequest(request, auth.app, {
          latencyMs: 0,
          model: request.body.model,
          route: "chat_completions",
          status: policy.status,
          tokens: 0,
        })
        return sendGatewayProblem(reply, policy.status, policy.title, policy.detail)
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

  const clientId = await clientIdFromToken(token)
  if (!clientId) {
    return {
      detail: "The connected app bearer token could not be verified.",
      ok: false,
      status: 401,
      title: "Invalid connected app token",
    }
  }

  const app = await resolveConnectedAppRuntimeIdentity(clientId)
  if (!app) {
    return {
      detail: "The connected app client is not registered in Console.",
      ok: false,
      status: 403,
      title: "Unknown connected app",
    }
  }

  return { app, ok: true }
}

async function clientIdFromToken(token: string): Promise<string | null> {
  if (
    process.env.NODE_ENV === "test" &&
    token.startsWith("fixture-connected-app:")
  ) {
    return token.slice("fixture-connected-app:".length).trim() || null
  }

  const payload = await verifyKeycloakJwt(token)
  return payload?.azp ?? payload?.clientId ?? null
}

function runtimePolicy(
  app: ConnectedAppRuntimeIdentity,
  requestedModel: string | null,
):
  | { ok: true }
  | { detail: string; ok: false; status: 403; title: string } {
  if (app.status !== "enabled") {
    return {
      detail: "The connected app is disabled.",
      ok: false,
      status: 403,
      title: "Connected app disabled",
    }
  }
  if (requestedModel && !app.allowedModels.includes(requestedModel)) {
    return {
      detail: "The connected app is not allowed to use the requested model.",
      ok: false,
      status: 403,
      title: "Model not allowed",
    }
  }
  return { ok: true }
}

type ModelListResult =
  | {
      body: {
        data: Array<{ id: string; object: "model"; owned_by: string }>
        object: "list"
      }
      ok: true
    }
  | { detail: string; ok: false; status: 503; title: string }

async function fetchModels(allowedModels: string[]): Promise<ModelListResult> {
  const litellmUrl = getLiteLlmUrl()
  const litellmKey = process.env.LITELLM_KEY

  if (litellmUrl && litellmKey) {
    try {
      const response = await fetch(`${litellmUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${litellmKey}` },
      })
      if (response.ok) {
        return filterModelList(
          (await response.json()) as {
            data: Array<{ id: string; object: "model"; owned_by: string }>
            object: "list"
          },
          allowedModels,
        )
      }
      return {
        detail: `LiteLLM returned HTTP ${response.status} while listing models.`,
        ok: false,
        status: 503,
        title: "LiteLLM model list unavailable",
      }
    } catch {
      return {
        detail: "LiteLLM model list request failed.",
        ok: false,
        status: 503,
        title: "LiteLLM model list unavailable",
      }
    }
  }

  if (!canUseBffFixtureData()) {
    return {
      detail: "Set LITELLM_URL and LITELLM_KEY before listing models.",
      ok: false,
      status: 503,
      title: "LiteLLM is not configured",
    }
  }

  const configuredModels =
    process.env.BFF_FALLBACK_MODELS?.split(",")
      .map((model) => model.trim())
      .filter(Boolean) ?? fallbackModels

  return filterModelList(
    {
      data: configuredModels.map((id) => ({
        id,
        object: "model" as const,
        owned_by: "llm-machines",
      })),
      object: "list",
    },
    allowedModels,
  )
}

function filterModelList(
  body: {
    data: Array<{ id: string; object: "model"; owned_by: string }>
    object: "list"
  },
  allowedModels: string[],
): ModelListResult {
  const allowed = new Set(allowedModels)
  return {
    body: {
      object: "list",
      data: body.data.filter((model) => allowed.has(model.id)),
    },
    ok: true,
  }
}

async function proxyChatCompletions(
  request: FastifyRequest,
  reply: FastifyReply,
  app: ConnectedAppRuntimeIdentity,
  body: ChatCompletionsBody,
): Promise<FastifyReply | undefined> {
  const litellmUrl = getLiteLlmUrl()
  const litellmKey = process.env.LITELLM_KEY
  if (!litellmUrl || !litellmKey) {
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
  let reservation: Awaited<
    ReturnType<typeof reserveConnectedAppGatewayTokens>
  >
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

  let upstream: Response
  try {
    upstream = await fetch(`${litellmUrl}/v1/chat/completions`, {
      body: JSON.stringify(chatCompletionUpstreamBody(body)),
      headers: {
        Authorization: `Bearer ${litellmKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    })
  } catch {
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

  if (!isStreamingRequest(body)) {
    const responseText = await upstream.text()
    const tokens = parseUsageTokens(responseText)
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
    await auditGatewayRequest(app, input, reservation)
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
    actorId: app.appId,
    action: `connected_app.gateway.${input.route}`,
    targetType: "connected_app",
    targetId: app.appId,
      metadata: {
        appId: app.appId,
        authMethod: app.authMethod,
        clientId: app.clientId,
        environment: app.environment,
      latencyMs: input.latencyMs,
      model: input.model,
      status: input.status,
      tokens: input.tokens,
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

function getLiteLlmUrl(): string | undefined {
  return process.env.LITELLM_URL?.replace(/\/+$/, "")
}

function isStreamingRequest(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "stream" in value &&
    value.stream === true
  )
}

function parseUsageTokens(responseText: string): number {
  const eventTokens = responseText
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line && line !== "[DONE]")
    .map(usageTokensFromJson)
  const streamedTokens = Math.max(0, ...eventTokens)
  if (streamedTokens > 0) {
    return streamedTokens
  }

  return usageTokensFromJson(responseText)
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
    return parseUsageTokens(pending)
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
      maxTokens = Math.max(maxTokens, parseUsageTokens(event))
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

function usageTokensFromJson(value: string): number {
  try {
    const body = JSON.parse(value) as {
      usage?: {
        total_tokens?: unknown
      }
    }
    return typeof body.usage?.total_tokens === "number"
      ? body.usage.total_tokens
      : 0
  } catch {
    return 0
  }
}

function chatCompletionUpstreamBody(
  body: ChatCompletionsBody,
): ChatCompletionsBody {
  const normalizedBody = normalizeTextOnlyChatCompletionsBody(body)
  if (!isStreamingRequest(body)) {
    return normalizedBody
  }

  return {
    ...normalizedBody,
    stream_options: {
      ...(typeof body.stream_options === "object" && body.stream_options !== null
        ? body.stream_options
        : {}),
      include_usage: true,
    },
  }
}
