interface LiteLlmConfig {
  apiKey: string
  baseUrl: string
}

export interface LiteLlmReadOptions {
  onBytesRead?: (byteLength: number) => void
  signal?: AbortSignal
}

const DEFAULT_TIMEOUT_MS = 2500
const MAX_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

export const LITE_LLM_LOG_SAMPLE_SIZE = 100

export class LiteLlmAdminClient {
  constructor(private readonly config: LiteLlmConfig) {}

  async getJson(
    path: string,
    searchParams = new URLSearchParams(),
    options: LiteLlmReadOptions = {},
  ): Promise<unknown> {
    const url = new URL(path, this.config.baseUrl)
    for (const [key, value] of searchParams) {
      url.searchParams.set(key, value)
    }

    const timeoutSignal = AbortSignal.timeout(liteLlmTimeoutMs())
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      method: "GET",
      redirect: "error",
      signal: options.signal
        ? AbortSignal.any([timeoutSignal, options.signal])
        : timeoutSignal,
    })
    if (!response.ok) {
      throw new Error(`LiteLLM read failed with ${response.status}.`)
    }
    return readBoundedJson(response, options.onBytesRead)
  }
}

export function liteLlmConfig(): LiteLlmConfig | null {
  const baseUrl = process.env.ADMIN_LITELLM_BASE_URL?.trim()
  const apiKey = process.env.ADMIN_LITELLM_API_KEY?.trim()

  if (!baseUrl || !apiKey) {
    return null
  }
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    return null
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    baseUrl.includes("?") ||
    baseUrl.includes("#")
  ) {
    return null
  }
  return {
    apiKey,
    baseUrl: parsed.toString().replace(/\/+$/, ""),
  }
}

export function liteLlmDateWindow(days = 30): {
  endDate: string
  startDate: string
} {
  const end = new Date()
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - days)
  return {
    endDate: end.toISOString().slice(0, 10),
    startDate: start.toISOString().slice(0, 10),
  }
}

function liteLlmTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.ADMIN_LITELLM_TIMEOUT_MS ?? "", 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS
  }
  return Math.min(parsed, MAX_TIMEOUT_MS)
}

async function readBoundedJson(
  response: Response,
  onBytesRead?: (byteLength: number) => void,
): Promise<unknown> {
  const declaredLength = response.headers.get("content-length")
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength)
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > MAX_RESPONSE_BYTES
    ) {
      throw new Error("LiteLLM response exceeded the read limit.")
    }
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error("LiteLLM returned an empty response.")
  }
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let receivedBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    receivedBytes += value.byteLength
    if (receivedBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error("LiteLLM response exceeded the read limit.")
    }
    try {
      onBytesRead?.(value.byteLength)
    } catch (error) {
      await reader.cancel()
      throw error
    }
    chunks.push(decoder.decode(value, { stream: true }))
  }
  chunks.push(decoder.decode())
  return JSON.parse(chunks.join(""))
}
