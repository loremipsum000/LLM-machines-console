import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { verifyApplicationAccessToken } from "../auth/application-access-token"
import {
  type ChatCompletionsBody,
  isChatCompletionsBody,
  normalizedChatCompletionsBodyUtf8Bytes,
} from "../inference/chat-completions"
import {
  type ConnectedAppGatewayUsageContext,
  type ConnectedAppGatewayUsageInput,
  type ConnectedAppRuntimeIdentity,
  admitConnectedAppGatewayUsage,
  consumeConnectedAppGatewayRateLimit,
  reconcileConnectedAppGatewayUsage,
  recordConnectedAppGatewayAccountingDegraded,
  recordConnectedAppGatewayUsage,
  recordConnectedAppModelsConnection,
  resolveConnectedAppRuntimeIdentity,
  resolveConnectedAppRuntimeIdentityByApiKey,
} from "../services/admin-connected-apps"
import { evaluateApplicationGatewayPolicy } from "../services/application-gateway-policy"
import { emitAudit } from "../services/audit"
import {
  type LiteLlmTransportFailureReason,
  type OpenAIUsage,
  createLiteLlmChatTransport,
  createOpenAIStreamingUsageParser,
  fetchLiteLlmModels,
  getLiteLlmTransportErrorReason,
  isStreamingChatCompletionsRequest,
  readLiteLlmNonStreamingResponse,
  waitForWritableDrainOrAbort,
} from "../services/litellm-chat-transport"

export function registerAppGatewayRoutes(server: FastifyInstance): void {
  server.get("/api/app-gateway/v1/models", async (request, reply) => {
    const startedAt = Date.now()
    reply.header("x-llm-machines-request-id", request.id)
    const auth = await authenticateConnectedApp(request)
    if (!auth.ok) {
      return sendGatewayProblem(reply, auth.status, auth.title, auth.detail)
    }

    const policy = evaluateApplicationGatewayPolicy(auth.app, null)
    if (!policy.ok) {
      await safelyAuditGatewayRequest(request, auth.app, {
        inputTokens: 0,
        latencyMs: 0,
        model: null,
        outputTokens: 0,
        route: "models",
        status: policy.status,
        totalTokens: 0,
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
        inputTokens: 0,
        latencyMs: 0,
        model: null,
        outputTokens: 0,
        route: "models",
        status: rateLimit.status,
        totalTokens: 0,
      })
      return sendGatewayProblem(
        reply,
        rateLimit.status,
        rateLimit.title,
        rateLimit.detail,
      )
    }

    let admission: Awaited<ReturnType<typeof admitConnectedAppGatewayUsage>>
    try {
      admission = await admitConnectedAppGatewayUsage(auth.app, {
        contextBytes: 0,
        model: null,
        route: "models",
      })
    } catch {
      logGatewayAccountingFailure(request, auth.app, "admit")
      await safelyAuditGatewayRequest(request, auth.app, {
        inputTokens: 0,
        latencyMs: Date.now() - startedAt,
        model: null,
        outputTokens: 0,
        route: "models",
        status: 503,
        totalTokens: 0,
      })
      return sendAccountingUnavailable(reply)
    }
    if (!admission.ok) {
      await safelyAuditGatewayRequest(request, auth.app, {
        inputTokens: 0,
        latencyMs: Date.now() - startedAt,
        model: null,
        outputTokens: 0,
        route: "models",
        status: admission.status,
        totalTokens: 0,
      })
      return sendGatewayProblem(
        reply,
        admission.status,
        admission.title,
        admission.detail,
      )
    }

    const models = await fetchLiteLlmModels(auth.app.allowedModels)
    if (!models.ok) {
      await safelyMarkGatewayDegraded(request, auth.app)
      await safelyAuditGatewayRequest(
        request,
        auth.app,
        {
          inputTokens: 0,
          latencyMs: Date.now() - startedAt,
          model: null,
          outputTokens: 0,
          route: "models",
          status: models.status,
          totalTokens: 0,
        },
        admission.context,
      )
      return sendGatewayProblem(
        reply,
        models.status,
        models.title,
        models.detail,
      )
    }

    await safelyReconcileGatewayUsage(
      request,
      auth.app,
      {
        inputTokens: 0,
        latencyMs: Date.now() - startedAt,
        model: null,
        outputTokens: 0,
        route: "models",
        status: 200,
        totalTokens: 0,
      },
      admission.context,
    )
    await safelyRecordSuccessfulModelsRequest(request, auth.app)
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
      const enabledPolicy = evaluateApplicationGatewayPolicy(auth.app, null)
      if (!enabledPolicy.ok) {
        await safelyAuditGatewayRequest(request, auth.app, {
          inputTokens: 0,
          latencyMs: 0,
          model: null,
          outputTokens: 0,
          route: "chat_completions",
          status: enabledPolicy.status,
          totalTokens: 0,
        })
        return sendGatewayProblem(
          reply,
          enabledPolicy.status,
          enabledPolicy.title,
          enabledPolicy.detail,
        )
      }

      const rateLimit = await consumeConnectedAppGatewayRateLimit(auth.app)
      if (!rateLimit.ok) {
        await safelyAuditGatewayRequest(request, auth.app, {
          inputTokens: 0,
          latencyMs: 0,
          model: null,
          outputTokens: 0,
          route: "chat_completions",
          status: rateLimit.status,
          totalTokens: 0,
        })
        return sendGatewayProblem(
          reply,
          rateLimit.status,
          rateLimit.title,
          rateLimit.detail,
        )
      }

      if (!isChatCompletionsBody(request.body)) {
        await safelyAuditGatewayRequest(request, auth.app, {
          inputTokens: 0,
          latencyMs: 0,
          model: null,
          outputTokens: 0,
          route: "chat_completions",
          status: 400,
          totalTokens: 0,
        })
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
          inputTokens: 0,
          latencyMs: 0,
          model: null,
          outputTokens: 0,
          route: "chat_completions",
          status: policy.status,
          totalTokens: 0,
        })
        return sendGatewayProblem(
          reply,
          policy.status,
          policy.title,
          policy.detail,
        )
      }

      const contextBytes = normalizedChatCompletionsBodyUtf8Bytes(request.body)
      let admission: Awaited<ReturnType<typeof admitConnectedAppGatewayUsage>>
      try {
        admission = await admitConnectedAppGatewayUsage(auth.app, {
          contextBytes,
          model: request.body.model,
          route: "chat_completions",
        })
      } catch {
        logGatewayAccountingFailure(request, auth.app, "admit")
        await safelyAuditGatewayRequest(request, auth.app, {
          inputTokens: 0,
          latencyMs: 0,
          model: request.body.model,
          outputTokens: 0,
          route: "chat_completions",
          status: 503,
          totalTokens: 0,
        })
        return sendAccountingUnavailable(reply)
      }
      if (!admission.ok) {
        await safelyAuditGatewayRequest(request, auth.app, {
          inputTokens: 0,
          latencyMs: 0,
          model: request.body.model,
          outputTokens: 0,
          route: "chat_completions",
          status: admission.status,
          totalTokens: 0,
        })
        return sendGatewayProblem(
          reply,
          admission.status,
          admission.title,
          admission.detail,
        )
      }

      return proxyChatCompletions(
        request,
        reply,
        auth.app,
        request.body,
        admission.context,
      )
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

  return verifyApplicationAccessToken(token)
}

async function proxyChatCompletions(
  request: FastifyRequest,
  reply: FastifyReply,
  app: ConnectedAppRuntimeIdentity,
  body: ChatCompletionsBody,
  usageContext: ConnectedAppGatewayUsageContext,
): Promise<FastifyReply | undefined> {
  const transport = createLiteLlmChatTransport()
  if (!transport) {
    const status = 503
    await safelyAuditGatewayRequest(
      request,
      app,
      gatewayUsageInput(body.model, status, 0),
      usageContext,
    )
    return sendGatewayProblem(
      reply,
      status,
      "LiteLLM is not configured",
      "Set LITELLM_URL and LITELLM_KEY for app gateway chat pass-through.",
    )
  }

  const startedAt = Date.now()
  const controller = new AbortController()
  const detachClientAbort = bindClientAbort(request, reply, controller)

  try {
    const transportResult = await transport.createChatCompletion(
      body,
      controller.signal,
    )
    if (!transportResult.ok) {
      const status = transportFailureStatus(transportResult.reason)
      if (transportResult.reason !== "cancelled") {
        await safelyMarkGatewayDegraded(request, app)
      }
      await safelyAuditGatewayRequest(
        request,
        app,
        gatewayUsageInput(body.model, status, Date.now() - startedAt),
        usageContext,
      )
      return canSendGatewayProblem(reply)
        ? sendTransportFailureProblem(reply, transportResult.reason)
        : undefined
    }
    const upstream = transportResult.response
    const transportSignal = transportResult.signal

    if (!upstream.ok || !upstream.body) {
      const status = upstream.ok ? 502 : upstream.status
      if (status === 404 || status >= 500) {
        await safelyMarkGatewayDegraded(request, app)
      }
      await safelyAuditGatewayRequest(
        request,
        app,
        gatewayUsageInput(body.model, status, Date.now() - startedAt),
        usageContext,
      )
      return canSendGatewayProblem(reply)
        ? sendGatewayProblem(
            reply,
            status,
            "LiteLLM chat completion failed",
            upstream.ok
              ? "LiteLLM returned no completion body for the connected app request."
              : `LiteLLM returned HTTP ${upstream.status} for the connected app request.`,
          )
        : undefined
    }

    if (!isStreamingChatCompletionsRequest(body)) {
      const response = await readLiteLlmNonStreamingResponse(upstream)
      if (!response.ok) {
        const status = transportFailureStatus(response.reason)
        if (response.reason !== "cancelled") {
          await safelyMarkGatewayDegraded(request, app)
        }
        await safelyAuditGatewayRequest(
          request,
          app,
          gatewayUsageInput(body.model, status, Date.now() - startedAt),
          usageContext,
        )
        return canSendGatewayProblem(reply)
          ? sendTransportFailureProblem(reply, response.reason)
          : undefined
      }

      await safelyAuditGatewayRequest(
        request,
        app,
        gatewayUsageInput(
          body.model,
          upstream.status,
          Date.now() - startedAt,
          response.usage,
        ),
        usageContext,
      )
      reply.code(upstream.status)
      reply.header(
        "Content-Type",
        upstream.headers.get("content-type") ?? "application/json",
      )
      return reply.send(response.body)
    }

    const streamed = await pipeOpenAIStream(
      request,
      reply,
      upstream,
      transportSignal,
    )
    const status = streamed.failureReason
      ? transportFailureStatus(streamed.failureReason)
      : upstream.status
    if (streamed.failureReason && streamed.failureReason !== "cancelled") {
      await safelyMarkGatewayDegraded(request, app)
    }
    await safelyAuditGatewayRequest(
      request,
      app,
      gatewayUsageInput(
        body.model,
        status,
        Date.now() - startedAt,
        streamed.usage,
      ),
      usageContext,
    )
    return undefined
  } finally {
    detachClientAbort()
  }
}

async function safelyAuditGatewayRequest(
  request: FastifyRequest,
  app: ConnectedAppRuntimeIdentity,
  input: ConnectedAppGatewayUsageInput,
  usageContext?: ConnectedAppGatewayUsageContext,
): Promise<void> {
  try {
    await auditGatewayRequest(app, input, request.id, usageContext)
  } catch {
    logGatewayAccountingFailure(request, app, "reconcile")
  }
}

function logGatewayAccountingFailure(
  request: FastifyRequest,
  app: ConnectedAppRuntimeIdentity,
  operation: "admit" | "connection" | "degraded" | "reconcile",
): void {
  const failureClass = {
    admit: "accounting_admission_failed",
    connection: "connection_recording_failed",
    degraded: "degraded_state_recording_failed",
    reconcile: "accounting_reconciliation_failed",
  }[operation]
  request.log.error(
    {
      appId: app.appId,
      failureClass,
      requestId: request.id,
    },
    "Connected app gateway accounting failed",
  )
}

async function auditGatewayRequest(
  app: ConnectedAppRuntimeIdentity,
  input: ConnectedAppGatewayUsageInput,
  correlationId: string,
  usageContext?: ConnectedAppGatewayUsageContext,
): Promise<void> {
  if (usageContext) {
    await reconcileConnectedAppGatewayUsage(app, input, usageContext)
  } else {
    await recordConnectedAppGatewayUsage(app, input)
  }
  await emitAudit({
    action: `connected_app.gateway.${input.route}`,
    applicationId: app.appId,
    correlationId,
    credentialRecordId: app.credentialRecordId,
    ...(app.keycloakSubjectId
      ? { keycloakSubjectId: app.keycloakSubjectId }
      : {}),
    outcome:
      input.status >= 200 && input.status < 400
        ? "succeeded"
        : input.status === 401 || input.status === 403
          ? "denied"
          : "failed",
    sourceSystem: "console",
  })
}

async function safelyReconcileGatewayUsage(
  request: FastifyRequest,
  app: ConnectedAppRuntimeIdentity,
  input: ConnectedAppGatewayUsageInput,
  usageContext: ConnectedAppGatewayUsageContext,
): Promise<void> {
  try {
    await reconcileConnectedAppGatewayUsage(app, input, usageContext)
  } catch {
    logGatewayAccountingFailure(request, app, "reconcile")
  }
}

async function safelyRecordSuccessfulModelsRequest(
  request: FastifyRequest,
  app: ConnectedAppRuntimeIdentity,
): Promise<void> {
  try {
    const recorded = await recordConnectedAppModelsConnection(app, request.id)
    if (!recorded) {
      logGatewayAccountingFailure(request, app, "connection")
    }
  } catch {
    logGatewayAccountingFailure(request, app, "connection")
  }
}

async function safelyMarkGatewayDegraded(
  request: FastifyRequest,
  app: ConnectedAppRuntimeIdentity,
): Promise<void> {
  try {
    const recorded = await recordConnectedAppGatewayAccountingDegraded(app)
    if (!recorded) {
      logGatewayAccountingFailure(request, app, "degraded")
    }
  } catch {
    logGatewayAccountingFailure(request, app, "degraded")
  }
}

async function pipeOpenAIStream(
  request: FastifyRequest,
  reply: FastifyReply,
  upstream: Response,
  transportSignal: AbortSignal,
): Promise<{
  failureReason: LiteLlmTransportFailureReason | null
  usage: OpenAIUsage | null
}> {
  reply.hijack()
  reply.raw.writeHead(upstream.status, {
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Encoding": "identity",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
    "x-llm-machines-request-id": request.id,
  })

  const reader = upstream.body?.getReader()
  if (!reader) {
    reply.raw.end()
    return { failureReason: "read_failed", usage: null }
  }

  const parser = createOpenAIStreamingUsageParser()
  let failureReason: LiteLlmTransportFailureReason | null = null
  let usage: OpenAIUsage | null = null
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      usage = parser.push(value) ?? usage
      if (!reply.raw.write(value)) {
        await waitForWritableDrainOrAbort(reply.raw, transportSignal)
      }
    }
  } catch (error) {
    failureReason =
      getLiteLlmTransportErrorReason(error) ??
      (reply.raw.destroyed ? "cancelled" : "read_failed")
    await reader.cancel(error).catch(() => undefined)
  } finally {
    if (failureReason === null) {
      try {
        usage = parser.finish() ?? usage
      } catch (error) {
        failureReason =
          getLiteLlmTransportErrorReason(error) ?? "stream_event_too_large"
      }
    }
    if (!reply.raw.destroyed && !reply.raw.writableEnded) {
      reply.raw.end()
    }
  }
  return { failureReason, usage }
}

function bindClientAbort(
  request: FastifyRequest,
  reply: FastifyReply,
  controller: AbortController,
): () => void {
  const abort = (): void => {
    if (!controller.signal.aborted) {
      controller.abort()
    }
  }
  const onResponseClose = (): void => {
    if (!reply.raw.writableEnded) {
      abort()
    }
  }
  request.raw.once("aborted", abort)
  reply.raw.once("close", onResponseClose)
  if (request.raw.aborted) {
    abort()
  }
  return () => {
    request.raw.off("aborted", abort)
    reply.raw.off("close", onResponseClose)
  }
}

function gatewayUsageInput(
  model: string | null,
  status: number,
  latencyMs: number,
  usage: OpenAIUsage | null = null,
): ConnectedAppGatewayUsageInput {
  const inputTokens = usage?.inputTokens ?? 0
  const outputTokens = usage?.outputTokens ?? 0
  return {
    inputTokens,
    latencyMs: Math.max(0, Math.floor(latencyMs)),
    model,
    outputTokens,
    route: "chat_completions",
    status,
    totalTokens: Math.max(inputTokens + outputTokens, usage?.totalTokens ?? 0),
  }
}

function transportFailureStatus(reason: LiteLlmTransportFailureReason): number {
  if (reason === "cancelled") {
    return 499
  }
  if (reason === "deadline_exceeded") {
    return 504
  }
  return 502
}

function sendTransportFailureProblem(
  reply: FastifyReply,
  reason: LiteLlmTransportFailureReason,
): FastifyReply {
  const status = transportFailureStatus(reason)
  if (reason === "deadline_exceeded") {
    return sendGatewayProblem(
      reply,
      status,
      "LiteLLM request deadline exceeded",
      "LiteLLM did not complete the connected app request before the gateway deadline.",
    )
  }
  if (reason === "response_too_large" || reason === "stream_event_too_large") {
    return sendGatewayProblem(
      reply,
      status,
      "LiteLLM response limit exceeded",
      "LiteLLM returned more data than the connected app gateway can safely transport.",
    )
  }
  return sendGatewayProblem(
    reply,
    status,
    reason === "cancelled"
      ? "Connected app request cancelled"
      : "LiteLLM chat completion failed",
    reason === "cancelled"
      ? "The connected app closed the request before completion."
      : "LiteLLM could not complete the connected app request.",
  )
}

function canSendGatewayProblem(reply: FastifyReply): boolean {
  return !reply.sent && !reply.raw.destroyed && !reply.raw.writableEnded
}

function sendAccountingUnavailable(reply: FastifyReply): FastifyReply {
  return sendGatewayProblem(
    reply,
    503,
    "Connected app accounting unavailable",
    "The connected app request could not establish usage accounting. Retry later.",
    "accounting_unavailable",
  )
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
