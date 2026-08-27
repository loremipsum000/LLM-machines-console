import { createHmac, timingSafeEqual } from "node:crypto"
import type { ConsoleSessionRepository } from "./console-session-store"

const LITELLM_UI_SESSION_SECONDS = 8 * 60 * 60
const CLOCK_SKEW_SECONDS = 60
const MAX_TOKEN_LENGTH = 32 * 1024
const MAX_RESPONSE_BYTES = 64 * 1024

export type NativeSessionAuthorizationResult =
  | { state: "allowed" }
  | { reason: string; state: "denied" }
  | { reason: string; state: "unavailable" }

export class NativeSessionAuthorizationService {
  constructor(
    private readonly repository: ConsoleSessionRepository,
    private readonly liteLlm: { baseUrl: string; masterKey: string },
    private readonly now: () => Date = () => new Date(),
    private readonly request: typeof fetch = fetch,
  ) {}

  async authorizeLiteLlmBrowser(
    cookieHeader: string | undefined,
  ): Promise<NativeSessionAuthorizationResult> {
    const token = exactCookie(cookieHeader, "token")
    if (!token) return denied("native_session_absent")
    const claims = verifyLiteLlmUiJwt(token, this.liteLlm.masterKey, this.now())
    if (!claims) return denied("native_session_invalid")
    return this.authorizeIssueTime(claims.subject, claims.issuedAt)
  }

  async authorizeLiteLlmKey(
    authorizationHeader: string | undefined,
  ): Promise<NativeSessionAuthorizationResult> {
    const key = bearerToken(authorizationHeader)
    if (!key) return denied("native_key_absent")
    let response: Response
    try {
      response = await this.request(
        new URL("/key/info", this.liteLlm.baseUrl),
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${key}`,
          },
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(2500),
        },
      )
    } catch {
      return unavailable("native_key_introspection_unavailable")
    }
    if (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404
    )
      return denied("native_key_invalid")
    if (!response.ok) return unavailable("native_key_introspection_unavailable")
    let body: unknown
    try {
      body = await boundedJson(response)
    } catch {
      return unavailable("native_key_introspection_invalid")
    }
    const info = record(record(body)?.info)
    if (!info) return denied("native_key_invalid")
    if (info.team_id !== "litellm-dashboard") return { state: "allowed" }
    const subject = boundedSubject(info.user_id)
    const issuedAt = timestamp(info.created_at)
    if (!subject || !issuedAt) return denied("native_session_invalid")
    return this.authorizeIssueTime(subject, issuedAt)
  }

  private async authorizeIssueTime(
    subject: string,
    issuedAt: Date,
  ): Promise<NativeSessionAuthorizationResult> {
    let subjectFence: Date | null
    let globalFence: Date | null
    try {
      ;[subjectFence, globalFence] = await Promise.all([
        this.repository.latestNativeLogoutAt(subject),
        this.repository.latestNativeGlobalLogoutAt(),
      ])
    } catch {
      return unavailable("native_logout_fence_unavailable")
    }
    const fence = [subjectFence, globalFence]
      .filter((value): value is Date => value instanceof Date)
      .sort((left, right) => right.getTime() - left.getTime())[0]
    if (fence && issuedAt.getTime() <= fence.getTime())
      return denied("native_session_logged_out")
    return { state: "allowed" }
  }
}

export function nativeSessionAuthorizationFromRuntime(
  repository: ConsoleSessionRepository,
  environment: NodeJS.ProcessEnv = process.env,
): NativeSessionAuthorizationService {
  const baseUrl = environment.ADMIN_LITELLM_BASE_URL?.trim()
  const masterKey = environment.ADMIN_LITELLM_API_KEY?.trim()
  if (!baseUrl || !masterKey)
    throw new Error("LiteLLM native session authority is required.")
  const parsed = new URL(baseUrl)
  if (
    parsed.protocol !== "http:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/" ||
    !["127.0.0.1", "localhost", "litellm"].includes(parsed.hostname)
  )
    throw new Error("LiteLLM native session authority must remain private.")
  if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(masterKey))
    throw new Error("LiteLLM native session key is invalid.")
  return new NativeSessionAuthorizationService(repository, {
    baseUrl: parsed.toString(),
    masterKey,
  })
}

function verifyLiteLlmUiJwt(
  token: string,
  masterKey: string,
  now: Date,
): { issuedAt: Date; subject: string } | null {
  if (token.length > MAX_TOKEN_LENGTH) return null
  const parts = token.split(".")
  if (
    parts.length !== 3 ||
    parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
  )
    return null
  let header: Record<string, unknown> | null
  let payload: Record<string, unknown> | null
  let signature: Buffer
  try {
    header = record(
      JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")),
    )
    payload = record(
      JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")),
    )
    signature = Buffer.from(parts[2], "base64url")
  } catch {
    return null
  }
  if (!header || header.alg !== "HS256" || !payload || signature.length !== 32)
    return null
  const expected = createHmac("sha256", masterKey)
    .update(`${parts[0]}.${parts[1]}`, "ascii")
    .digest()
  if (!timingSafeEqual(signature, expected)) return null
  const subject = boundedSubject(payload.user_id)
  const expiresAt = integer(payload.exp)
  const nowSeconds = Math.floor(now.getTime() / 1000)
  if (
    !subject ||
    expiresAt === null ||
    expiresAt <= nowSeconds ||
    expiresAt > nowSeconds + LITELLM_UI_SESSION_SECONDS + CLOCK_SKEW_SECONDS
  )
    return null
  return {
    issuedAt: new Date((expiresAt - LITELLM_UI_SESSION_SECONDS) * 1000),
    subject,
  }
}

function exactCookie(header: string | undefined, name: string): string | null {
  if (!header || header.length > MAX_TOKEN_LENGTH * 2) return null
  const values: string[] = []
  for (const part of header.split(";")) {
    const index = part.indexOf("=")
    if (index < 1 || part.slice(0, index).trim() !== name) continue
    try {
      values.push(decodeURIComponent(part.slice(index + 1).trim()))
    } catch {
      return null
    }
  }
  return values.length === 1 && values[0].length <= MAX_TOKEN_LENGTH
    ? values[0]
    : null
}

function bearerToken(header: string | undefined): string | null {
  if (!header || header.length > MAX_TOKEN_LENGTH + 7) return null
  const match = header.match(/^Bearer ([A-Za-z0-9._-]+)$/)
  return match?.[1] && match[1].length <= MAX_TOKEN_LENGTH ? match[1] : null
}

async function boundedJson(response: Response): Promise<unknown> {
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_RESPONSE_BYTES)
    throw new Error("response_too_large")
  return JSON.parse(new TextDecoder().decode(bytes))
}

function boundedSubject(value: unknown): string | null {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 255 &&
    !/\s/.test(value) &&
    ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code <= 31 || code === 127
    })
    ? value
    : null
}

function timestamp(value: unknown): Date | null {
  if (typeof value !== "string") return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function denied(reason: string): NativeSessionAuthorizationResult {
  return { reason, state: "denied" }
}

function unavailable(reason: string): NativeSessionAuthorizationResult {
  return { reason, state: "unavailable" }
}
