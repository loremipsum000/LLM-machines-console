import { canUseBffFixtureData } from "../config/fixture-mode"
import {
  type ChatCompletionsBody,
  normalizeTextOnlyChatCompletionsBody,
} from "../inference/chat-completions"

const fallbackModels = ["llm-machines-default"]

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
  | { detail: string; ok: false; status: 503; title: string }

export type LiteLlmChatCompletionResult =
  | { ok: true; response: Response }
  | { ok: false }

export interface LiteLlmChatTransport {
  createChatCompletion(
    body: ChatCompletionsBody,
    signal: AbortSignal,
  ): Promise<LiteLlmChatCompletionResult>
}

export async function fetchLiteLlmModels(
  allowedModels: string[],
): Promise<LiteLlmModelListResult> {
  const litellmUrl = liteLlmUrl()
  const litellmKey = process.env.LITELLM_KEY

  if (litellmUrl && litellmKey) {
    try {
      const response = await fetch(`${litellmUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${litellmKey}` },
      })
      if (response.ok) {
        return filterModelList(
          (await response.json()) as LiteLlmModelList,
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

export function createLiteLlmChatTransport(): LiteLlmChatTransport | undefined {
  const litellmUrl = liteLlmUrl()
  const litellmKey = process.env.LITELLM_KEY
  if (!litellmUrl || !litellmKey) {
    return undefined
  }

  return {
    async createChatCompletion(body, signal) {
      try {
        const response = await fetch(`${litellmUrl}/v1/chat/completions`, {
          body: JSON.stringify(liteLlmChatCompletionBody(body)),
          headers: {
            Authorization: `Bearer ${litellmKey}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          signal,
        })
        return { ok: true, response }
      } catch {
        return { ok: false }
      }
    },
  }
}

export function isStreamingChatCompletionsRequest(
  body: ChatCompletionsBody,
): boolean {
  return body.stream === true
}

export function parseOpenAIUsageTokens(responseText: string): number {
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

function filterModelList(
  body: LiteLlmModelList,
  allowedModels: string[],
): LiteLlmModelListResult {
  const allowed = new Set(allowedModels)
  return {
    body: {
      data: body.data.filter((model) => allowed.has(model.id)),
      object: "list",
    },
    ok: true,
  }
}

function liteLlmUrl(): string | undefined {
  return process.env.LITELLM_URL?.replace(/\/+$/, "")
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
