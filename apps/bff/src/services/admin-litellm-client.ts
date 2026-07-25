interface LiteLlmConfig {
  apiKey: string
  baseUrl: string
}

const DEFAULT_TIMEOUT_MS = 2500

export const LITE_LLM_LOG_SAMPLE_SIZE = 100

export class LiteLlmAdminClient {
  constructor(private readonly config: LiteLlmConfig) {}

  async getJson(
    path: string,
    searchParams = new URLSearchParams(),
  ): Promise<unknown> {
    const url = new URL(path, this.config.baseUrl)
    for (const [key, value] of searchParams) {
      url.searchParams.set(key, value)
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      signal: AbortSignal.timeout(liteLlmTimeoutMs()),
    })
    if (!response.ok) {
      throw new Error(`LiteLLM read failed with ${response.status}.`)
    }
    return response.json()
  }
}

export function liteLlmConfig(): LiteLlmConfig | null {
  const baseUrl =
    process.env.ADMIN_LITELLM_BASE_URL?.trim() ||
    process.env.LITELLM_URL?.trim()
  const apiKey =
    process.env.ADMIN_LITELLM_API_KEY?.trim() || process.env.LITELLM_KEY?.trim()

  if (!baseUrl || !apiKey) {
    return null
  }
  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
  }
}

export function liteLlmDateWindow(
  days = 30,
): { endDate: string; startDate: string } {
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
  return parsed
}
