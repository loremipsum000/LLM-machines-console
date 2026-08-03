import "server-only"

import { normalizeConsoleReturnPath } from "./safe-return"
import { consoleSessionResolveResponseSchema } from "@llm-machines/contracts/inference-core"

export const CONSOLE_SESSION_COOKIE = "__Host-llm-machines-session"
export const CONSOLE_SESSION_HEADER = "x-llm-machines-console-session"
export const CONSOLE_SESSION_MAX_AGE_SECONDS = 30 * 60
const SESSION_RESOLVE_TIMEOUT_MS = 5_000
const MAXIMUM_RESOLVE_RESPONSE_BYTES = 64 * 1024
const opaqueHandlePattern = /^[A-Za-z0-9_-]{43}$/

export type WebConsoleSessionResolution = ReturnType<
  typeof consoleSessionResolveResponseSchema.parse
>

export async function resolveConsoleSession(
  cookieHeader: string | null,
  options: {
    baseUrl?: string
    fetch?: typeof fetch
    serviceCredential?: string
  } = {},
): Promise<WebConsoleSessionResolution> {
  const sessionHandle = opaqueConsoleSessionHandle(cookieHeader)
  const baseUrl = cleanValue(options.baseUrl ?? process.env.CONSOLE_BFF_URL)
  const credential = cleanValue(
    options.serviceCredential ?? process.env.CONSOLE_BFF_SERVICE_API_KEY,
  )
  if (!sessionHandle) {
    return { reason: "absent", state: "terminal" }
  }
  if (!baseUrl || !credential) {
    return unavailable()
  }
  try {
    const response = await (options.fetch ?? fetch)(
      `${baseUrl.replace(/\/+$/, "")}/api/internal/console-session/resolve`,
      {
        cache: "no-store",
        headers: {
          authorization: `Bearer ${credential}`,
          [CONSOLE_SESSION_HEADER]: sessionHandle,
        },
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(SESSION_RESOLVE_TIMEOUT_MS),
      },
    )
    const payload = await boundedJson(response)
    const parsed = consoleSessionResolveResponseSchema.safeParse(payload)
    if (
      response.status === 200 &&
      parsed.success &&
      parsed.data.state === "active"
    ) {
      return parsed.data
    }
    if (
      response.status === 401 &&
      parsed.success &&
      parsed.data.state === "terminal"
    ) {
      return parsed.data
    }
    if (
      response.status === 503 &&
      parsed.success &&
      parsed.data.state === "unavailable"
    ) {
      return parsed.data
    }
    return response.status >= 500 ? unavailable() : terminalInvalid()
  } catch {
    return unavailable()
  }
}

export function opaqueConsoleSessionHandle(
  cookieHeader: string | null | undefined,
): string | null {
  let handle: string | null = null
  for (const entry of cookieHeader?.split(";") ?? []) {
    const separator = entry.indexOf("=")
    if (
      separator < 1 ||
      entry.slice(0, separator).trim() !== CONSOLE_SESSION_COOKIE
    ) {
      continue
    }
    const value = entry.slice(separator + 1).trim()
    if (handle || !opaqueHandlePattern.test(value)) {
      return null
    }
    handle = value
  }
  return handle
}

export function expiredConsoleSessionRedirectResponse(
  requestUrl: string | URL,
): Response {
  const url = new URL(requestUrl)
  const returnTo = normalizeConsoleReturnPath(`${url.pathname}${url.search}`)
  const signInUrl = new URL("/auth/signin", url.origin)
  signInUrl.searchParams.set("session", "expired")
  signInUrl.searchParams.set("returnTo", returnTo)

  return new Response(null, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Location: signInUrl.toString(),
      "Set-Cookie": `${CONSOLE_SESSION_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Secure; HttpOnly; SameSite=Lax`,
    },
    status: 303,
  })
}

async function boundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"))
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAXIMUM_RESOLVE_RESPONSE_BYTES
  ) {
    await response.body?.cancel().catch(() => undefined)
    return null
  }
  const text = await boundedResponseText(
    response,
    MAXIMUM_RESOLVE_RESPONSE_BYTES,
  )
  if (text === null) {
    return null
  }
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function boundedResponseText(
  response: Response,
  maximumBytes: number,
): Promise<string | null> {
  if (!response.body) {
    return ""
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      totalBytes += value.byteLength
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const combined = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(combined)
}

function cleanValue(value: string | undefined): string | undefined {
  const cleaned = value?.trim()
  return cleaned && !["null", "undefined"].includes(cleaned.toLowerCase())
    ? cleaned
    : undefined
}

function terminalInvalid(): WebConsoleSessionResolution {
  return { reason: "invalid", state: "terminal" }
}

function unavailable(): WebConsoleSessionResolution {
  return {
    reason: "identity_unavailable",
    retryable: true,
    state: "unavailable",
  }
}
