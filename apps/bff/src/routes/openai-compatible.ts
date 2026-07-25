import { randomUUID } from "node:crypto"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { withPersona } from "../auth/persona"
import type { Actor } from "../auth/persona"
import type { ChatCompletionsBody, SlashCommand } from "../openai/types"
import {
  extractTextContent,
  isChatCompletionsBody,
  normalizeTextOnlyChatCompletionsBody,
  parseSlashCommand,
} from "../openai/types"
import { canUseBffFixtureData } from "../config/fixture-mode"
import { emitAudit } from "../services/audit"
import { recordHubChatThread } from "../services/hub"
import { preflightCorpusKnowledgeForPrompt } from "../services/knowledge/corpus-preflight"
import {
  invokeSlashCommand,
  streamSlashCommand,
} from "../services/slash-middleware"
import {
  doneChunk,
  encodeContentChunk,
  encodeErrorChunk,
  encodeFinishChunk,
} from "../streaming/openai-encoder"

const fallbackModels = ["llm-machines-default"]

export function registerOpenAICompatibleRoutes(server: FastifyInstance): void {
  server.get("/v1/models", withPersona("consumer"), async (request, reply) => {
    const result = await fetchModels(request.id)
    if (!result.ok) {
      return reply.code(result.status).send({
        type: "about:blank",
        title: result.title,
        status: result.status,
        detail: result.detail,
        request_id: result.requestId,
      })
    }
    return reply.send(result.body)
  })

  server.post(
    "/v1/chat/completions",
    withPersona("consumer"),
    async (request, reply) => {
      if (!isChatCompletionsBody(request.body)) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid chat completion body",
          status: 400,
          detail: "`model` and `messages` are required.",
        })
      }

      const nativeAgent = isNativeLibreChatAgentRequest(request)
      const slash = nativeAgent ? null : parseSlashCommand(request.body)
      const observedThread = getObservedChatThread(request, request.body, slash)
      if (slash) {
        if (!request.actor) {
          return reply.code(401).send({
            type: "about:blank",
            title: "Unauthenticated",
            status: 401,
            detail: "A valid actor is required for slash-command invocation.",
          })
        }

        const controller = new AbortController()
        request.raw.on("close", () => controller.abort())

        if (isStreamingRequest(request.body)) {
          return streamSlashInvocation({
            actor: request.actor,
            model: request.body.model,
            observedThread,
            reply,
            signal: controller.signal,
            slash,
          })
        }

        const invocation = await invokeSlashCommand(request.actor, slash, {
          model: request.body.model,
          signal: controller.signal,
        })
        if (!invocation.ok) {
          return sendProblem(reply, invocation)
        }

        recordObservedChatThread(observedThread)
        if (!isStreamingRequest(request.body)) {
          return reply.send(
            openAIChatCompletionResponse({
              content: invocation.response,
              model: request.body.model,
            }),
          )
        }

        return undefined
      }

      return proxyChatCompletions(
        request,
        reply,
        request.body,
        observedThread,
        nativeAgent,
      )
    },
  )
}

interface ObservedChatThread {
  actor: Actor
  model: string | null
  preview: string
  resourceName: string | null
  threadId: string
  title: string
}

async function streamSlashInvocation(opts: {
  actor: Actor
  model: string
  observedThread: ObservedChatThread | null
  reply: FastifyReply
  signal: AbortSignal
  slash: SlashCommand
}): Promise<FastifyReply | undefined> {
  const id = `chatcmpl-${randomUUID()}`
  let started = false

  const ensureStarted = (): void => {
    if (started) {
      return
    }
    opts.reply.hijack()
    writeSseHeaders(opts.reply)
    started = true
  }

  const invocation = await streamSlashCommand(opts.actor, opts.slash, {
    model: opts.model,
    signal: opts.signal,
    onContent: async (content) => {
      ensureStarted()
      await writeWithBackpressure(
        opts.reply,
        encodeContentChunk({
          id,
          model: opts.model,
          content,
        }),
      )
    },
  })

  if (!started && !invocation.ok) {
    return sendProblem(opts.reply, invocation)
  }

  if (invocation.ok) {
    recordObservedChatThread(opts.observedThread)
  }

  ensureStarted()
  if (!invocation.ok) {
    await writeWithBackpressure(
      opts.reply,
      encodeErrorChunk({
        id,
        model: opts.model,
        message: invocation.detail,
      }),
    )
  }
  await writeWithBackpressure(
    opts.reply,
    encodeFinishChunk({ id, model: opts.model, reason: "stop" }),
  )
  await writeWithBackpressure(opts.reply, doneChunk)
  opts.reply.raw.end()
  return undefined
}

function sendProblem(
  reply: FastifyReply,
  problem: { status: number; title: string; detail: string },
): FastifyReply {
  return reply.code(problem.status).send({
    type: "about:blank",
    title: problem.title,
    status: problem.status,
    detail: problem.detail,
  })
}

function sendSanitizedUpstreamProblem(
  reply: FastifyReply,
  problem: { detail: string; requestId: string; status: number; title: string },
): FastifyReply {
  return reply.code(problem.status).send({
    type: "about:blank",
    title: problem.title,
    status: problem.status,
    detail: problem.detail,
    request_id: problem.requestId,
  })
}

type ModelListResult =
  | {
      ok: true
      body: {
        object: "list"
        data: Array<{ id: string; object: "model"; owned_by: string }>
      }
    }
  | {
      ok: false
      requestId: string
      status: 503
      title: string
      detail: string
    }

async function fetchModels(requestId: string): Promise<ModelListResult> {
  const litellmUrl = getLiteLlmUrl()
  const litellmKey = process.env.LITELLM_KEY

  if (litellmUrl && litellmKey) {
    try {
      const response = await fetch(`${litellmUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${litellmKey}` },
      })
      if (response.ok) {
        return {
          ok: true,
          body: (await response.json()) as {
            object: "list"
            data: Array<{ id: string; object: "model"; owned_by: string }>
          },
        }
      }
      return {
        ok: false,
        requestId,
        status: 503,
        title: "LiteLLM model list unavailable",
        detail: `LiteLLM returned HTTP ${response.status} while listing models. Reference request_id for operator logs.`,
      }
    } catch {
      return {
        ok: false,
        requestId,
        status: 503,
        title: "LiteLLM model list unavailable",
        detail:
          "LiteLLM model list request failed. Reference request_id for operator logs.",
      }
    }
  }

  if (!canUseBffFixtureData()) {
    return {
      ok: false,
      requestId,
      status: 503,
      title: "LiteLLM is not configured",
      detail: "Set LITELLM_URL and LITELLM_KEY before listing models.",
    }
  }

  const configuredModels =
    process.env.BFF_FALLBACK_MODELS?.split(",")
      .map((model) => model.trim())
      .filter(Boolean) ?? fallbackModels

  return {
    ok: true,
    body: {
      object: "list",
      data: configuredModels.map((id) => ({
        id,
        object: "model",
        owned_by: "llm-machines",
      })),
    },
  }
}

async function proxyChatCompletions(
  request: FastifyRequest,
  reply: FastifyReply,
  body: ChatCompletionsBody,
  observedThread: ObservedChatThread | null,
  nativeAgent: boolean,
): Promise<FastifyReply | undefined> {
  const litellmUrl = getLiteLlmUrl()
  const litellmKey = process.env.LITELLM_KEY

  if (!litellmUrl || !litellmKey) {
    return reply.code(503).send({
      type: "about:blank",
      title: "LiteLLM is not configured",
      status: 503,
      detail: "Set LITELLM_URL and LITELLM_KEY for chat pass-through.",
    })
  }

  const controller = new AbortController()
  request.raw.on("close", () => controller.abort())

  const preflight = !nativeAgent
    ? await preflightCorpusKnowledgeForRequest(request.actor, body)
    : null
  if (
    preflight?.contextMessage &&
    (preflight.auditAction === "knowledge_preflight.ambiguous" ||
      preflight.auditAction === "knowledge_intent.unfulfilled")
  ) {
    recordObservedChatThread(observedThread)
    return sendDeterministicChatResponse(reply, body, preflight.contextMessage)
  }
  const upstreamBody = preflight?.contextMessage
    ? withCorpusContextMessage(body, preflight.contextMessage)
    : body

  let upstream: Response
  try {
    upstream = await fetch(`${litellmUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${litellmKey}`,
      },
      body: JSON.stringify(normalizeTextOnlyChatCompletionsBody(upstreamBody)),
      signal: controller.signal,
    })
  } catch {
    return sendSanitizedUpstreamProblem(reply, {
      detail:
        "LiteLLM could not complete the chat request. Reference request_id for operator logs.",
      requestId: request.id,
      status: 503,
      title: "LiteLLM chat completion failed",
    })
  }

  if (!upstream.ok || !upstream.body) {
    return sendSanitizedUpstreamProblem(reply, {
      detail: `LiteLLM returned HTTP ${upstream.status} for the chat request. Reference request_id for operator logs.`,
      requestId: request.id,
      status: upstream.ok ? 502 : upstream.status,
      title: "LiteLLM chat completion failed",
    })
  }

  if (!isStreamingRequest(request.body)) {
    const responseText = await upstream.text()
    recordObservedChatThread(observedThread)
    await auditNativeAgentCompletion({
      body,
      nativeAgent,
      observedThread,
      responseText,
      status: upstream.status,
    })
    reply.code(upstream.status)
    reply.header(
      "Content-Type",
      upstream.headers.get("content-type") ?? "application/json",
    )
    return reply.send(responseText)
  }

  recordObservedChatThread(observedThread)
  await auditNativeAgentCompletion({
    body,
    nativeAgent,
    observedThread,
    responseText: null,
    status: upstream.status,
  })
  await pipeOpenAIStream(request, reply, upstream)
  return undefined
}

async function preflightCorpusKnowledgeForRequest(
  actor: Actor | undefined,
  body: ChatCompletionsBody,
) {
  if (!actor) {
    return null
  }
  const latestUserMessage = [...body.messages]
    .reverse()
    .find((message) => message.role === "user")
  const prompt = extractTextContent(latestUserMessage?.content)
  if (!prompt) {
    return null
  }
  return preflightCorpusKnowledgeForPrompt(actor, prompt)
}

function withCorpusContextMessage(
  body: ChatCompletionsBody,
  contextMessage: string,
): ChatCompletionsBody {
  return {
    ...body,
    messages: [
      {
        role: "system",
        content: contextMessage,
      },
      ...body.messages,
    ],
  }
}

async function sendDeterministicChatResponse(
  reply: FastifyReply,
  body: ChatCompletionsBody,
  content: string,
): Promise<FastifyReply | undefined> {
  if (!isStreamingRequest(body)) {
    return reply.send(
      openAIChatCompletionResponse({
        content,
        model: body.model,
      }),
    )
  }

  const id = `chatcmpl-${randomUUID()}`
  reply.hijack()
  writeSseHeaders(reply)
  await writeWithBackpressure(
    reply,
    encodeContentChunk({
      id,
      model: body.model,
      content,
    }),
  )
  await writeWithBackpressure(
    reply,
    encodeFinishChunk({ id, model: body.model, reason: "stop" }),
  )
  await writeWithBackpressure(reply, doneChunk)
  reply.raw.end()
  return undefined
}

async function pipeOpenAIStream(
  request: FastifyRequest,
  reply: FastifyReply,
  upstream: Response,
): Promise<void> {
  reply.hijack()
  writeSseHeaders(reply)

  const reader = upstream.body?.getReader()
  if (!reader) {
    reply.raw.write(doneChunk)
    reply.raw.end()
    return
  }

  request.raw.on("close", () => {
    reader.cancel().catch(() => undefined)
  })

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      await writeWithBackpressure(reply, value)
    }
  } catch {
    await writeWithBackpressure(reply, doneChunk)
  } finally {
    reply.raw.end()
  }
}

function openAIChatCompletionResponse(opts: {
  content: string
  model: string
}): object {
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: opts.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: opts.content,
        },
        finish_reason: "stop",
      },
    ],
  }
}

function writeSseHeaders(reply: FastifyReply): void {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Encoding": "identity",
  })
}

async function writeWithBackpressure(
  reply: FastifyReply,
  chunk: Uint8Array,
): Promise<void> {
  if (reply.raw.write(chunk)) {
    return
  }

  await new Promise<void>((resolve) => {
    reply.raw.once("drain", resolve)
  })
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

function isNativeLibreChatAgentRequest(request: FastifyRequest): boolean {
  const value = getHeaderValue(request, "x-llm-machines-agent-runtime")
  return value?.toLowerCase() === "librechat-native"
}

async function auditNativeAgentCompletion(opts: {
  body: ChatCompletionsBody
  nativeAgent: boolean
  observedThread: ObservedChatThread | null
  responseText: string | null
  status: number
}): Promise<void> {
  if (!opts.nativeAgent || !opts.observedThread) {
    return
  }

  await emitAudit({
    actorId: opts.observedThread.actor.subject,
    action: "librechat_native_agent.model_call",
    targetType: "librechat.native_agent",
    targetId: opts.observedThread.threadId,
    metadata: {
      conversationId: opts.observedThread.threadId,
      endpointType: "native_agent",
      model: opts.body.model,
      source: "librechat_native_agent",
      status: opts.status,
      usage: parseUsage(opts.responseText),
    },
  })
}

function parseUsage(responseText: string | null): unknown {
  if (!responseText) {
    return null
  }

  try {
    const body = JSON.parse(responseText) as { usage?: unknown }
    return body.usage ?? null
  } catch {
    return null
  }
}

function getObservedChatThread(
  request: FastifyRequest,
  body: ChatCompletionsBody,
  slash: SlashCommand | null,
): ObservedChatThread | null {
  if (!request.actor) {
    return null
  }

  const threadId = getHeaderValue(request, "x-librechat-thread-id")
  if (!threadId) {
    return null
  }

  const latestUserMessage = [...body.messages]
    .reverse()
    .find((message) => message.role === "user")
  const preview = extractTextContent(latestUserMessage?.content)
  if (!preview) {
    return null
  }

  return {
    actor: request.actor,
    threadId,
    title: preview,
    preview,
    model: body.model,
    resourceName: slash?.kind === "agent" ? titleFromSlug(slash.name) : null,
  }
}

function recordObservedChatThread(thread: ObservedChatThread | null): void {
  if (!thread) {
    return
  }

  recordHubChatThread(thread.actor, {
    threadId: thread.threadId,
    title: thread.title,
    preview: thread.preview,
    model: thread.model,
    resourceName: thread.resourceName,
  })
}

function getHeaderValue(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name.toLowerCase()]
  if (Array.isArray(value)) {
    return value[0]?.trim() || null
  }
  return value?.trim() || null
}

function titleFromSlug(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ")
}
