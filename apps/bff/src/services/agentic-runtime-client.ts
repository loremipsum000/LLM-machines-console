import type { HubResource } from "@llm-machines/contracts"
import type { Actor } from "../auth/persona"
import { canUseBffFixtureData } from "../config/fixture-mode"

export type AgentRuntimeExecution =
  | {
      ok: true
      response: string
      source: "local_fallback" | "agentic_runtime"
      runtime: "openclaw"
    }
  | {
      ok: false
      status: 503
      title: string
      detail: string
      runtime: "openclaw"
    }

export async function executeAgentResource(opts: {
  actor: Actor
  input: string
  model: string
  resource: HubResource
  signal?: AbortSignal
}): Promise<AgentRuntimeExecution> {
  const runtime = "openclaw"
  const baseUrl = getOpenClawBaseUrl()
  if (!baseUrl) {
    if (!canUseBffFixtureData()) {
      return runtimeFailure("OpenClaw runtime is not configured.")
    }
    return {
      ok: true,
      response: renderLocalAgentResponse(opts.resource, opts.input),
      runtime,
      source: "local_fallback",
    }
  }

  try {
    const upstream = await fetch(getOpenClawChatCompletionsUrl(baseUrl), {
      method: "POST",
      headers: getRuntimeHeaders(opts.actor),
      body: JSON.stringify(runtimeRequestBody(opts, false)),
      signal: timeoutSignal(opts.signal),
    })

    if (!upstream.ok) {
      return runtimeFailure(
        `OpenClaw returned HTTP ${upstream.status}: ${await readErrorDetail(
          upstream,
        )}`,
      )
    }

    const body = (await upstream.json()) as unknown
    const content = extractChatCompletionContent(body)
    if (!content) {
      return runtimeFailure(describeMissingChatCompletionContent(body))
    }

    return {
      ok: true,
      response: content,
      runtime,
      source: "agentic_runtime",
    }
  } catch (error) {
    return runtimeFailure(
      error instanceof Error
        ? `OpenClaw request failed: ${error.message}`
        : "OpenClaw request failed.",
    )
  }
}

export async function streamAgentResource(
  opts: {
    actor: Actor
    input: string
    model: string
    resource: HubResource
    signal?: AbortSignal
  },
  onContent: (content: string) => Promise<void>,
): Promise<AgentRuntimeExecution> {
  const runtime = "openclaw"
  const baseUrl = getOpenClawBaseUrl()
  if (!baseUrl) {
    if (!canUseBffFixtureData()) {
      return runtimeFailure("OpenClaw runtime is not configured.")
    }
    const response = renderLocalAgentResponse(opts.resource, opts.input)
    await onContent(response)
    return {
      ok: true,
      response,
      runtime,
      source: "local_fallback",
    }
  }

  try {
    const upstream = await fetch(getOpenClawChatCompletionsUrl(baseUrl), {
      method: "POST",
      headers: getRuntimeHeaders(opts.actor),
      body: JSON.stringify(runtimeRequestBody(opts, true)),
      signal: timeoutSignal(opts.signal),
    })

    if (!upstream.ok) {
      return runtimeFailure(
        `OpenClaw returned HTTP ${upstream.status}: ${await readErrorDetail(
          upstream,
        )}`,
      )
    }

    if (!upstream.body) {
      return runtimeFailure("OpenClaw returned an empty streaming body.")
    }

    const contentType = upstream.headers.get("content-type") ?? ""
    if (!contentType.includes("text/event-stream")) {
      const body = (await upstream.json()) as unknown
      const content = extractChatCompletionContent(body)
      if (!content) {
        return runtimeFailure(describeMissingChatCompletionContent(body))
      }
      await onContent(content)
      return {
        ok: true,
        response: content,
        runtime,
        source: "agentic_runtime",
      }
    }

    const response = await relayOpenAIStream(upstream.body, onContent)
    if (!response.ok) {
      return runtimeFailure(response.detail)
    }

    return {
      ok: true,
      response: response.content,
      runtime,
      source: "agentic_runtime",
    }
  } catch (error) {
    return runtimeFailure(
      error instanceof Error
        ? `OpenClaw request failed: ${error.message}`
        : "OpenClaw request failed.",
    )
  }
}

function getRuntimeHeaders(actor: Actor): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-LLM-Machines-Actor": actor.subject,
  }
  if (process.env.AGENTIC_OPENCLAW_TOKEN) {
    headers.Authorization = `Bearer ${process.env.AGENTIC_OPENCLAW_TOKEN}`
  }
  return headers
}

function runtimeRequestBody(
  opts: {
    input: string
    model: string
    resource: HubResource
  },
  stream: boolean,
): object {
  return {
    model: process.env.AGENTIC_OPENCLAW_MODEL ?? opts.model,
    messages: [
      {
        role: "system",
        content: [
          `You are ${opts.resource.name}, a Hub agent running inside the LLM Machines OpenClaw restricted profile.`,
          "Return a concise, useful response. Do not claim to use external tools unless the runtime actually used them.",
        ].join(" "),
      },
      {
        role: "user",
        content:
          opts.input ||
          "Confirm you are ready for appliance-local summarization.",
      },
    ],
    stream,
  }
}

function getOpenClawBaseUrl(): string | undefined {
  return process.env.AGENTIC_OPENCLAW_BASE_URL?.replace(/\/+$/, "")
}

function getOpenClawChatCompletionsUrl(baseUrl: string): URL {
  const path =
    process.env.AGENTIC_OPENCLAW_CHAT_COMPLETIONS_PATH ?? "/v1/chat/completions"
  return new URL(path.startsWith("/") ? path : `/${path}`, baseUrl)
}

function getRuntimeTimeoutMs(): number {
  const parsed = Number(process.env.AGENTIC_RUNTIME_TIMEOUT_MS)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000
}

function timeoutSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(getRuntimeTimeoutMs())
  if (!parent) {
    return timeout
  }

  return AbortSignal.any([parent, timeout])
}

function runtimeFailure(detail: string): AgentRuntimeExecution {
  return {
    ok: false,
    status: 503,
    title: "Agentic runtime failed",
    detail,
    runtime: "openclaw",
  }
}

function extractChatCompletionContent(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("choices" in body)) {
    return null
  }

  const choices = (body as { choices?: unknown }).choices
  if (!Array.isArray(choices)) {
    return null
  }

  const first = choices[0]
  if (!first || typeof first !== "object" || !("message" in first)) {
    return null
  }

  const message = (first as { message?: unknown }).message
  if (!message || typeof message !== "object" || !("content" in message)) {
    return null
  }

  const content = (message as { content?: unknown }).content
  return typeof content === "string" && content.trim() ? content.trim() : null
}

function describeMissingChatCompletionContent(body: unknown): string {
  if (!body || typeof body !== "object" || !("choices" in body)) {
    return "OpenClaw returned a response without assistant content."
  }

  const choices = (body as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return "OpenClaw returned a response without assistant content."
  }

  const first = choices[0]
  if (!first || typeof first !== "object") {
    return "OpenClaw returned a response without assistant content."
  }

  const finishReason = (first as { finish_reason?: unknown }).finish_reason
  const message = (first as { message?: unknown }).message
  const hasReasoningContent =
    message &&
    typeof message === "object" &&
    typeof (message as { reasoning_content?: unknown }).reasoning_content ===
      "string" &&
    Boolean(
      (message as { reasoning_content?: string }).reasoning_content?.trim(),
    )

  if (finishReason === "length") {
    return [
      "OpenClaw returned no assistant content because the response reached max_tokens before visible output.",
      "Increase max output tokens or use a less reasoning-heavy model.",
    ].join(" ")
  }

  if (hasReasoningContent) {
    return "OpenClaw returned reasoning content but no assistant content."
  }

  return "OpenClaw returned a response without assistant content."
}

async function relayOpenAIStream(
  body: ReadableStream<Uint8Array>,
  onContent: (content: string) => Promise<void>,
): Promise<{ ok: true; content: string } | { ok: false; detail: string }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const content: string[] = []
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const result = await drainSseFrames(buffer, async (chunk) => {
        content.push(chunk)
        await onContent(chunk)
      })
      if (!result.ok) {
        return result
      }
      buffer = result.remainder
    }

    buffer += decoder.decode()
    if (buffer.trim()) {
      const result = await drainSseFrames(`${buffer}\n\n`, async (chunk) => {
        content.push(chunk)
        await onContent(chunk)
      })
      if (!result.ok) {
        return result
      }
    }
  } finally {
    reader.releaseLock()
  }

  return { ok: true, content: content.join("") }
}

async function drainSseFrames(
  input: string,
  onContent: (content: string) => Promise<void>,
): Promise<
  | { ok: true; remainder: string }
  | {
      ok: false
      detail: string
    }
> {
  const frames = input.split(/\r?\n\r?\n/)
  const remainder = frames.pop() ?? ""

  for (const frame of frames) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n")
      .trim()
    if (!data || data === "[DONE]") {
      continue
    }

    try {
      const payload = JSON.parse(data) as unknown
      const content = extractStreamingDeltaContent(payload)
      if (content) {
        await onContent(content)
      }
    } catch {
      return {
        ok: false,
        detail: "OpenClaw returned a malformed streaming frame.",
      }
    }
  }

  return { ok: true, remainder }
}

function extractStreamingDeltaContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("choices" in payload)) {
    return null
  }

  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices)) {
    return null
  }

  const first = choices[0]
  if (!first || typeof first !== "object" || !("delta" in first)) {
    return null
  }

  const delta = (first as { delta?: unknown }).delta
  if (!delta || typeof delta !== "object" || !("content" in delta)) {
    return null
  }

  const content = (delta as { content?: unknown }).content
  return typeof content === "string" ? content : null
}

async function readErrorDetail(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    try {
      const body = (await response.json()) as unknown
      if (body && typeof body === "object" && "detail" in body) {
        const detail = (body as { detail?: unknown }).detail
        if (typeof detail === "string") {
          return detail
        }
      }
    } catch {
      return "malformed JSON error response"
    }
  }

  const text = await response.text()
  return text || "empty error response"
}

function renderLocalAgentResponse(
  resource: HubResource,
  input: string,
): string {
  if (!input) {
    return `${resource.name} is ready. Send text after @${normalizeSlug(
      resource.name,
    )} to summarize appliance-local context.`
  }

  const compactInput = input.replace(/\s+/g, " ").trim()
  const excerpt =
    compactInput.length > 220
      ? `${compactInput.slice(0, 217).trimEnd()}...`
      : compactInput

  return [
    `${resource.name} ran on the local appliance.`,
    "",
    `Summary: ${excerpt}`,
    "",
    "Next: open the generated task or artifact panel when a run produces inspectable output.",
  ].join("\n")
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
