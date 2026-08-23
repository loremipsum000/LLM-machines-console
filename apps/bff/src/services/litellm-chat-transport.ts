import { canUseBffFixtureData } from "../config/fixture-mode"
import {
  type ChatCompletionsBody,
  normalizeTextOnlyChatCompletionsBody,
} from "../inference/chat-completions"

const fallbackModels = ["llm-machines-default"]
const LITELLM_MODEL_LIST_DEADLINE_MS = 5_000
const LITELLM_MODEL_LIST_MAX_BYTES = 2 * 1024 * 1024
const LITELLM_CHAT_DEADLINE_DEFAULT_MS = 2 * 60 * 1000
export const LITELLM_CHAT_DEADLINE_MAX_MS = 5 * 60 * 1000
export const LITELLM_NON_STREAMING_MAX_BYTES = 8 * 1024 * 1024
export const LITELLM_STREAM_EVENT_MAX_BYTES = 1024 * 1024

export interface LiteLlmModel {
  id: string
  object: "model"
  owned_by: string
}

export interface LiteLlmModelList {
  data: LiteLlmModel[]
  object: "list"
}

export type LiteLlmModelListResult =
  | { body: LiteLlmModelList; ok: true }
  | {
      detail: string
      missingModels: string[]
      ok: false
      reason: "alias_unavailable"
      status: 503
      title: string
    }
  | {
      detail: string
      ok: false
      reason: "not_configured" | "upstream_unavailable"
      status: 503
      title: string
    }

export type LiteLlmTransportFailureReason =
  | "cancelled"
  | "deadline_exceeded"
  | "read_failed"
  | "response_too_large"
  | "stream_event_too_large"
  | "unavailable"

type LiteLlmChatFailureReason = Extract<
  LiteLlmTransportFailureReason,
  "cancelled" | "deadline_exceeded" | "response_too_large" | "unavailable"
>

type LiteLlmNonStreamingReadFailureReason = Exclude<
  LiteLlmTransportFailureReason,
  "stream_event_too_large" | "unavailable"
>

export type LiteLlmChatCompletionResult =
  | { ok: true; response: Response; signal: AbortSignal }
  | {
      ok: false
      reason: LiteLlmChatFailureReason
    }

export interface LiteLlmChatTransport {
  createChatCompletion(
    body: ChatCompletionsBody,
    signal: AbortSignal,
  ): Promise<LiteLlmChatCompletionResult>
}

export interface OpenAIUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export type LiteLlmNonStreamingReadResult =
  | { body: string; ok: true; usage: OpenAIUsage | null }
  | {
      ok: false
      reason: LiteLlmNonStreamingReadFailureReason
    }

export class LiteLlmTransportError extends Error {
  constructor(readonly reason: LiteLlmTransportFailureReason) {
    super(transportErrorMessage(reason))
    this.name = "LiteLlmTransportError"
  }
}

interface WritableBackpressureTarget {
  off(event: "close" | "drain", listener: () => void): unknown
  once(event: "close" | "drain", listener: () => void): unknown
}

export function waitForWritableDrainOrAbort(
  target: WritableBackpressureTarget,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason)
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const cleanUp = (): void => {
      target.off("close", onWritable)
      target.off("drain", onWritable)
      signal.removeEventListener("abort", onAbort)
    }
    const onWritable = (): void => {
      if (settled) {
        return
      }
      settled = true
      cleanUp()
      resolve()
    }
    const onAbort = (): void => {
      if (settled) {
        return
      }
      settled = true
      cleanUp()
      reject(signal.reason)
    }

    target.once("close", onWritable)
    target.once("drain", onWritable)
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
    }
  })
}

export async function fetchLiteLlmModels(
  allowedModels: string[],
  callerSignal?: AbortSignal,
): Promise<LiteLlmModelListResult> {
  const config = liteLlmConfig()

  if (config) {
    const boundary = createRequestBoundary(
      callerSignal,
      LITELLM_MODEL_LIST_DEADLINE_MS,
    )
    try {
      const response = await fetch(`${config.baseUrl}/v1/models`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        method: "GET",
        redirect: "error",
        signal: boundary.signal,
      })
      if (!response.ok) {
        await cancelResponseBody(response)
        return modelListUnavailable(
          `LiteLLM returned HTTP ${response.status} while listing models.`,
        )
      }
      const responseText = await readBoundedResponseText(
        response,
        LITELLM_MODEL_LIST_MAX_BYTES,
      )
      const modelList = parseModelList(responseText)
      if (!modelList) {
        return modelListUnavailable("LiteLLM returned an invalid model list.")
      }
      return filterModelList(modelList, allowedModels)
    } catch {
      return modelListUnavailable("LiteLLM model list request failed.")
    } finally {
      boundary.dispose()
    }
  }

  if (!canUseBffFixtureData()) {
    return {
      detail: "Set LITELLM_URL and LITELLM_KEY before listing models.",
      ok: false,
      reason: "not_configured",
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

export function createLiteLlmChatTransport(): LiteLlmChatTransport | undefined {
  const config = liteLlmConfig()
  if (!config) {
    return undefined
  }

  return {
    async createChatCompletion(body, signal) {
      if (signal.aborted) {
        return { ok: false, reason: "cancelled" }
      }

      const boundary = createRequestBoundary(
        signal,
        configuredLiteLlmChatDeadlineMs(),
      )
      try {
        const streaming = isStreamingChatCompletionsRequest(body)
        const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
          body: JSON.stringify(liteLlmChatCompletionBody(body)),
          headers: {
            Accept: streaming ? "text/event-stream" : "application/json",
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          redirect: "error",
          signal: boundary.signal,
        })

        if (!response.ok || !response.body) {
          await cancelResponseBody(response)
          boundary.dispose()
          return {
            ok: true,
            response: responseWithoutBody(response),
            signal: boundary.signal,
          }
        }

        if (!streaming && responseExceedsLimit(response)) {
          await cancelResponseBody(response)
          boundary.dispose()
          return { ok: false, reason: "response_too_large" }
        }

        return {
          ok: true,
          response: responseWithReadBoundary(
            response,
            boundary,
            streaming ? undefined : LITELLM_NON_STREAMING_MAX_BYTES,
          ),
          signal: boundary.signal,
        }
      } catch (error) {
        const reason =
          boundary.failureReason() ?? getLiteLlmTransportErrorReason(error)
        boundary.dispose()
        return {
          ok: false,
          reason: isLiteLlmChatFailureReason(reason) ? reason : "unavailable",
        }
      }
    },
  }
}

export function configuredLiteLlmChatDeadlineMs(): number {
  const parsed = Number.parseInt(process.env.LITELLM_CHAT_DEADLINE_MS ?? "", 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return LITELLM_CHAT_DEADLINE_DEFAULT_MS
  }
  return Math.min(parsed, LITELLM_CHAT_DEADLINE_MAX_MS)
}

export function isStreamingChatCompletionsRequest(
  body: ChatCompletionsBody,
): boolean {
  return body.stream === true
}

export async function readLiteLlmNonStreamingResponse(
  response: Response,
  options: { maxBytes?: number } = {},
): Promise<LiteLlmNonStreamingReadResult> {
  const maxBytes = boundedReadLimit(
    options.maxBytes,
    LITELLM_NON_STREAMING_MAX_BYTES,
  )
  if (responseExceedsLimit(response, maxBytes)) {
    await cancelResponseBody(response)
    return { ok: false, reason: "response_too_large" }
  }

  try {
    const body = await readBoundedResponseText(response, maxBytes)
    return { body, ok: true, usage: parseOpenAIUsage(body) }
  } catch (error) {
    const reason = getLiteLlmTransportErrorReason(error)
    return {
      ok: false,
      reason: isLiteLlmNonStreamingReadFailureReason(reason)
        ? reason
        : "read_failed",
    }
  }
}

export function parseOpenAIUsage(responseText: string): OpenAIUsage | null {
  const direct = usageFromJson(responseText)
  if (direct) {
    return direct
  }

  try {
    const parser = createOpenAIStreamingUsageParser()
    parser.push(new TextEncoder().encode(responseText))
    return parser.finish()
  } catch {
    return null
  }
}

export function parseOpenAIUsageTokens(responseText: string): number {
  return parseOpenAIUsage(responseText)?.totalTokens ?? 0
}

export interface OpenAIStreamingUsageParser {
  finish(): OpenAIUsage | null
  push(chunk: Uint8Array): OpenAIUsage | null
}

export function createOpenAIStreamingUsageParser(
  options: { maxEventBytes?: number } = {},
): OpenAIStreamingUsageParser {
  const maxEventBytes = boundedReadLimit(
    options.maxEventBytes,
    LITELLM_STREAM_EVENT_MAX_BYTES,
  )
  const decoder = new TextDecoder()
  let dataLines: string[] = []
  let eventBytes = 0
  let failed: LiteLlmTransportError | null = null
  let latestUsage: OpenAIUsage | null = null
  let lineBytes: number[] = []

  const assertUsable = (): void => {
    if (failed) {
      throw failed
    }
  }

  const parseEvent = (): void => {
    if (dataLines.length === 0) {
      return
    }
    const payload = dataLines.join("\n")
    if (payload !== "[DONE]") {
      latestUsage = usageFromJson(payload) ?? latestUsage
    }
  }

  const processLine = (): void => {
    if (lineBytes.at(-1) === 13) {
      lineBytes.pop()
    }
    if (lineBytes.length === 0) {
      parseEvent()
      dataLines = []
      eventBytes = 0
      return
    }

    const line = decoder.decode(Uint8Array.from(lineBytes))
    if (line.startsWith("data:")) {
      const data = line.slice("data:".length)
      dataLines.push(data.startsWith(" ") ? data.slice(1) : data)
    }
  }

  return {
    finish() {
      assertUsable()
      if (lineBytes.length > 0) {
        processLine()
        lineBytes = []
      }
      parseEvent()
      dataLines = []
      eventBytes = 0
      return latestUsage
    },
    push(chunk) {
      assertUsable()
      for (const byte of chunk) {
        eventBytes += 1
        if (eventBytes > maxEventBytes) {
          failed = new LiteLlmTransportError("stream_event_too_large")
          lineBytes = []
          dataLines = []
          throw failed
        }
        if (byte === 10) {
          processLine()
          lineBytes = []
        } else {
          lineBytes.push(byte)
        }
      }
      return latestUsage
    },
  }
}

export function getLiteLlmTransportErrorReason(
  error: unknown,
): LiteLlmTransportFailureReason | null {
  return error instanceof LiteLlmTransportError ? error.reason : null
}

function isLiteLlmChatFailureReason(
  reason: LiteLlmTransportFailureReason | null,
): reason is LiteLlmChatFailureReason {
  return (
    reason === "cancelled" ||
    reason === "deadline_exceeded" ||
    reason === "response_too_large" ||
    reason === "unavailable"
  )
}

function isLiteLlmNonStreamingReadFailureReason(
  reason: LiteLlmTransportFailureReason | null,
): reason is LiteLlmNonStreamingReadFailureReason {
  return (
    reason === "cancelled" ||
    reason === "deadline_exceeded" ||
    reason === "read_failed" ||
    reason === "response_too_large"
  )
}

function filterModelList(
  body: LiteLlmModelList,
  allowedModels: string[],
): LiteLlmModelListResult {
  if (allowedModels.length === 0) {
    return { body, ok: true }
  }
  const allowed = new Set(allowedModels)
  const available = new Set(body.data.map((model) => model.id))
  const missingModels = [...allowed].filter((model) => !available.has(model))
  if (missingModels.length > 0) {
    return {
      detail: "One or more allowed LiteLLM model aliases are unavailable.",
      missingModels,
      ok: false,
      reason: "alias_unavailable",
      status: 503,
      title: "Allowed model unavailable",
    }
  }

  return {
    body: {
      data: body.data.filter((model) => allowed.has(model.id)),
      object: "list",
    },
    ok: true,
  }
}

function modelListUnavailable(detail: string): LiteLlmModelListResult {
  return {
    detail,
    ok: false,
    reason: "upstream_unavailable",
    status: 503,
    title: "LiteLLM model list unavailable",
  }
}

function liteLlmConfig(): { apiKey: string; baseUrl: string } | undefined {
  const rawUrl = process.env.LITELLM_URL?.trim()
  const apiKey = process.env.LITELLM_KEY?.trim()
  if (!rawUrl || !apiKey) {
    return undefined
  }

  try {
    const parsed = new URL(rawUrl)
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      rawUrl.includes("?") ||
      rawUrl.includes("#")
    ) {
      return undefined
    }
    return {
      apiKey,
      baseUrl: parsed.toString().replace(/\/+$/, ""),
    }
  } catch {
    return undefined
  }
}

function liteLlmChatCompletionBody(
  body: ChatCompletionsBody,
): ChatCompletionsBody {
  const normalizedBody = normalizeTextOnlyChatCompletionsBody(body)
  if (!isStreamingChatCompletionsRequest(body)) {
    return normalizedBody
  }

  return {
    ...normalizedBody,
    stream_options: {
      ...(typeof body.stream_options === "object" &&
      body.stream_options !== null
        ? body.stream_options
        : {}),
      include_usage: true,
    },
  }
}

function parseModelList(responseText: string): LiteLlmModelList | null {
  try {
    const value = JSON.parse(responseText) as unknown
    if (
      !isRecord(value) ||
      value.object !== "list" ||
      !Array.isArray(value.data)
    ) {
      return null
    }

    const data: LiteLlmModel[] = []
    for (const model of value.data) {
      if (
        !isRecord(model) ||
        typeof model.id !== "string" ||
        model.object !== "model" ||
        typeof model.owned_by !== "string"
      ) {
        return null
      }
      data.push({ id: model.id, object: "model", owned_by: model.owned_by })
    }
    return { data, object: "list" }
  } catch {
    return null
  }
}

function usageFromJson(value: string): OpenAIUsage | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!isRecord(parsed) || !isRecord(parsed.usage)) {
      return null
    }

    const inputTokens = firstTokenCount(
      parsed.usage.prompt_tokens,
      parsed.usage.input_tokens,
    )
    const outputTokens = firstTokenCount(
      parsed.usage.completion_tokens,
      parsed.usage.output_tokens,
    )
    const totalTokens = tokenCount(parsed.usage.total_tokens)
    if (inputTokens === null && outputTokens === null && totalTokens === null) {
      return null
    }
    return { inputTokens, outputTokens, totalTokens }
  } catch {
    return null
  }
}

function firstTokenCount(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = tokenCount(value)
    if (parsed !== null) {
      return parsed
    }
  }
  return null
}

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

interface RequestBoundary {
  dispose(): void
  error(): LiteLlmTransportError
  failureReason(): "cancelled" | "deadline_exceeded" | null
  signal: AbortSignal
}

function createRequestBoundary(
  callerSignal: AbortSignal | undefined,
  deadlineMs: number,
): RequestBoundary {
  const controller = new AbortController()
  let failureReason: "cancelled" | "deadline_exceeded" | null = null
  let disposed = false

  const abort = (reason: "cancelled" | "deadline_exceeded"): void => {
    if (failureReason !== null) {
      return
    }
    failureReason = reason
    controller.abort(new LiteLlmTransportError(reason))
  }
  const onCallerAbort = (): void => abort("cancelled")
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true })
  if (callerSignal?.aborted) {
    onCallerAbort()
  }

  const deadline = setTimeout(() => abort("deadline_exceeded"), deadlineMs)
  deadline.unref()

  return {
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      clearTimeout(deadline)
      callerSignal?.removeEventListener("abort", onCallerAbort)
    },
    error() {
      return new LiteLlmTransportError(failureReason ?? "read_failed")
    },
    failureReason() {
      return failureReason
    },
    signal: controller.signal,
  }
}

function responseWithReadBoundary(
  response: Response,
  boundary: RequestBoundary,
  maxBytes: number | undefined,
): Response {
  const reader = response.body?.getReader()
  if (!reader) {
    boundary.dispose()
    return responseWithoutBody(response)
  }

  let bytesRead = 0
  let streamController: ReadableStreamDefaultController<Uint8Array> | null =
    null
  let terminal = false

  const cleanUp = (): void => {
    boundary.signal.removeEventListener("abort", onAbort)
    boundary.dispose()
  }
  const fail = (error: LiteLlmTransportError): void => {
    if (terminal) {
      return
    }
    terminal = true
    cleanUp()
    void reader.cancel(error).catch(() => undefined)
    streamController?.error(error)
  }
  const onAbort = (): void => fail(boundary.error())

  const body = new ReadableStream<Uint8Array>({
    async cancel(reason) {
      if (!terminal) {
        terminal = true
        cleanUp()
      }
      await reader.cancel(reason)
    },
    async pull(controller) {
      if (terminal) {
        return
      }
      try {
        const { done, value } = await reader.read()
        if (terminal) {
          return
        }
        if (done) {
          terminal = true
          cleanUp()
          controller.close()
          return
        }
        bytesRead += value.byteLength
        if (maxBytes !== undefined && bytesRead > maxBytes) {
          fail(new LiteLlmTransportError("response_too_large"))
          return
        }
        controller.enqueue(value)
      } catch (error) {
        fail(
          boundary.signal.aborted
            ? boundary.error()
            : error instanceof LiteLlmTransportError
              ? error
              : new LiteLlmTransportError("read_failed"),
        )
      }
    },
    start(controller) {
      streamController = controller
      boundary.signal.addEventListener("abort", onAbort, { once: true })
      if (boundary.signal.aborted) {
        onAbort()
      }
    },
  })

  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  })
}

function responseWithoutBody(response: Response): Response {
  return new Response(null, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  })
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (responseExceedsLimit(response, maxBytes)) {
    await cancelResponseBody(response)
    throw new LiteLlmTransportError("response_too_large")
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new LiteLlmTransportError("read_failed")
  }
  const chunks: string[] = []
  const decoder = new TextDecoder()
  let bytesRead = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      bytesRead += value.byteLength
      if (bytesRead > maxBytes) {
        await reader.cancel()
        throw new LiteLlmTransportError("response_too_large")
      }
      chunks.push(decoder.decode(value, { stream: true }))
    }
    chunks.push(decoder.decode())
    return chunks.join("")
  } catch (error) {
    if (error instanceof LiteLlmTransportError) {
      throw error
    }
    throw new LiteLlmTransportError("read_failed")
  }
}

function responseExceedsLimit(
  response: Response,
  maxBytes = LITELLM_NON_STREAMING_MAX_BYTES,
): boolean {
  const declaredLength = response.headers.get("content-length")
  if (declaredLength === null) {
    return false
  }
  const parsedLength = Number(declaredLength)
  return (
    !Number.isSafeInteger(parsedLength) ||
    parsedLength < 0 ||
    parsedLength > maxBytes
  )
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    return
  }
}

function boundedReadLimit(value: number | undefined, maximum: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? Math.min(value as number, maximum)
    : maximum
}

function transportErrorMessage(reason: LiteLlmTransportFailureReason): string {
  switch (reason) {
    case "cancelled":
      return "LiteLLM request was cancelled."
    case "deadline_exceeded":
      return "LiteLLM request deadline was exceeded."
    case "response_too_large":
      return "LiteLLM response exceeded the read limit."
    case "stream_event_too_large":
      return "LiteLLM stream event exceeded the read limit."
    case "unavailable":
      return "LiteLLM request was unavailable."
    default:
      return "LiteLLM response could not be read."
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
