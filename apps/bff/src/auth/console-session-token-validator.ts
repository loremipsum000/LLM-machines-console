import { createPublicKey, createVerify } from "node:crypto"
import type {
  ConsoleBackchannelVerification,
  ConsoleBackchannelVerifier,
  ConsoleTokenValidation,
  ConsoleTokenValidator,
} from "../services/console-session-service"

const BACKCHANNEL_EVENT = "http://schemas.openid.net/event/backchannel-logout"
const MAX_JWT_BYTES = 64 * 1024
const MAX_JWT_SEGMENT_BYTES = 32 * 1024
const MAX_JWKS_BYTES = 2 * 1024 * 1024
const JWKS_CACHE_MS = 5 * 60 * 1000
const JWKS_OUTAGE_GRACE_MS = 15 * 60 * 1000

export interface ConsoleIdentityJwtConfig {
  accessAudience: string
  clientId: string
  issuer: string
  jwksUrl: string
  timeoutMs?: number
}

type Verification =
  | { payload: Record<string, unknown>; state: "valid" }
  | { state: "invalid" }
  | {
      reason: "identity_restart" | "identity_timeout" | "identity_unavailable"
      state: "unavailable"
    }

type JwksResult =
  | {
      keys: Array<Record<string, unknown>>
      outageReason?:
        | "identity_restart"
        | "identity_timeout"
        | "identity_unavailable"
      state: "available"
    }
  | {
      reason: "identity_restart" | "identity_timeout" | "identity_unavailable"
      state: "unavailable"
    }

export function createConsoleTokenValidator(
  config: ConsoleIdentityJwtConfig,
  request: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): ConsoleTokenValidator & ConsoleBackchannelVerifier {
  assertConfig(config)
  let cache:
    | {
        expiresAt: number
        keys: Array<Record<string, unknown>>
        staleUntil: number
      }
    | undefined
  const loadJwks = async (force = false): Promise<JwksResult> => {
    const currentTime = now().getTime()
    if (!force && cache && cache.expiresAt > currentTime) {
      return { keys: cache.keys, state: "available" }
    }
    const fetched = await fetchJwks(config, request)
    if (fetched.state === "available") {
      cache = {
        expiresAt: currentTime + JWKS_CACHE_MS,
        keys: fetched.keys,
        staleUntil: currentTime + JWKS_OUTAGE_GRACE_MS,
      }
      return fetched
    }
    if (cache && cache.staleUntil > currentTime) {
      return {
        keys: cache.keys,
        outageReason: fetched.reason,
        state: "available",
      }
    }
    return fetched
  }
  const verify = (token: string, audience: string) =>
    verifyJwt(token, audience, config, loadJwks, now)

  return {
    async readiness() {
      const result = await loadJwks()
      return result.state === "available" ? { state: "ready" as const } : result
    },
    async validate(tokens, expectedNonce): Promise<ConsoleTokenValidation> {
      const access = await verify(tokens.accessToken, config.accessAudience)
      if (access.state !== "valid") {
        return access
      }
      if (
        access.payload.typ !== "Bearer" ||
        typeof access.payload.sub !== "string" ||
        access.payload.sub.length < 1 ||
        access.payload.sub.length > 255 ||
        access.payload.azp !== config.clientId ||
        !Number.isSafeInteger(access.payload.exp)
      ) {
        return { state: "invalid" }
      }
      if (expectedNonce) {
        if (!tokens.idToken) {
          return { state: "invalid" }
        }
        const id = await verify(tokens.idToken, config.clientId)
        if (id.state !== "valid") {
          return id
        }
        if (
          id.payload.nonce !== expectedNonce ||
          id.payload.sub !== access.payload.sub ||
          (Array.isArray(id.payload.aud) &&
            id.payload.aud.length > 1 &&
            id.payload.azp !== config.clientId)
        ) {
          return { state: "invalid" }
        }
      }
      const roles = realmRoles(access.payload)
      const retained = roles.filter(
        (role): role is "admin" | "operator" =>
          role === "admin" || role === "operator",
      )
      if (retained.length !== 1) {
        return { state: "invalid" }
      }
      const amr = boundedStringArray(access.payload.amr, 32, 128)
      const mfa = amr.some((method) =>
        ["otp", "webauthn", "webauthn-passwordless", "hwk"].includes(
          method.toLowerCase(),
        ),
      )
      const authTime = integer(access.payload.auth_time)
      return {
        identity: {
          accessExpiresAt: new Date(Number(access.payload.exp) * 1000),
          email: boundedString(access.payload.email, 3, 320),
          groups: boundedStringArray(access.payload.groups, 64, 255),
          keycloakSessionId: boundedString(access.payload.sid, 1, 255),
          mfaVerifiedAt:
            mfa && authTime !== undefined
              ? new Date(authTime * 1000)
              : undefined,
          offlineAccess:
            roles.includes("offline_access") ||
            scopeValues(access.payload.scope).includes("offline_access"),
          role: retained[0],
          subject: access.payload.sub,
        },
        state: "valid",
      }
    },

    async verify(token: string): Promise<ConsoleBackchannelVerification> {
      const verified = await verify(token, config.clientId)
      if (verified.state === "unavailable") {
        return { ...verified, retryable: true }
      }
      if (verified.state !== "valid") {
        return null
      }
      const events = verified.payload.events
      const issuedAt = integer(verified.payload.iat)
      const expiresAt = integer(verified.payload.exp)
      const jti = stringValue(verified.payload.jti)
      const sid = stringValue(verified.payload.sid)
      const subject = stringValue(verified.payload.sub)
      if (
        !isRecord(events) ||
        !isRecord(events[BACKCHANNEL_EVENT]) ||
        "nonce" in verified.payload ||
        issuedAt === undefined ||
        expiresAt === undefined ||
        !jti ||
        (!sid && !subject)
      ) {
        return null
      }
      return {
        expiresAt: new Date(expiresAt * 1000),
        issuedAt: new Date(issuedAt * 1000),
        jti,
        keycloakSessionId: sid,
        subject,
      }
    },
  }
}

async function verifyJwt(
  token: string,
  audience: string,
  config: ConsoleIdentityJwtConfig,
  loadJwks: (force?: boolean) => Promise<JwksResult>,
  now: () => Date,
): Promise<Verification> {
  const parsed = parseJwt(token)
  if (!parsed || parsed.header.alg !== "RS256" || !parsed.header.kid) {
    return { state: "invalid" }
  }
  let jwks = await loadJwks()
  if (jwks.state === "unavailable") {
    return jwks
  }
  let key = jwks.keys.find(
    (candidate) =>
      candidate.kid === parsed.header.kid && usableSigningJwk(candidate),
  )
  if (!key) {
    jwks = await loadJwks(true)
    if (jwks.state === "unavailable") {
      return jwks
    }
    key = jwks.keys.find(
      (candidate) =>
        candidate.kid === parsed.header.kid && usableSigningJwk(candidate),
    )
    if (!key && jwks.outageReason) {
      return { reason: jwks.outageReason, state: "unavailable" }
    }
  }
  if (!key) {
    return { state: "invalid" }
  }
  try {
    const verifier = createVerify("RSA-SHA256")
    verifier.update(parsed.signedContent)
    verifier.end()
    if (
      !verifier.verify(
        createPublicKey({ format: "jwk", key }),
        Buffer.from(parsed.signature, "base64url"),
      )
    ) {
      return { state: "invalid" }
    }
  } catch {
    return { state: "invalid" }
  }
  const nowSeconds = Math.floor(now().getTime() / 1000)
  const exp = integer(parsed.payload.exp)
  const nbf = integer(parsed.payload.nbf)
  const iat = integer(parsed.payload.iat)
  if (
    parsed.payload.iss !== config.issuer ||
    !audienceContains(parsed.payload.aud, audience) ||
    exp === undefined ||
    exp < nowSeconds - 60 ||
    (nbf !== undefined && nbf > nowSeconds + 60) ||
    (iat !== undefined && iat > nowSeconds + 60)
  ) {
    return { state: "invalid" }
  }
  return { payload: parsed.payload, state: "valid" }
}

async function fetchJwks(
  config: ConsoleIdentityJwtConfig,
  request: typeof fetch,
): Promise<JwksResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 2000)
  let response: Response
  try {
    response = await request(config.jwksUrl, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    })
  } catch (error) {
    return {
      reason:
        error instanceof Error && error.name === "AbortError"
          ? "identity_timeout"
          : "identity_unavailable",
      state: "unavailable",
    }
  } finally {
    clearTimeout(timeout)
  }
  if (response.status === 503) {
    return { reason: "identity_restart", state: "unavailable" }
  }
  if (!response.ok) {
    return { reason: "identity_unavailable", state: "unavailable" }
  }
  const keys = await boundedJwks(response)
  return keys
    ? { keys, state: "available" }
    : { state: "unavailable", reason: "identity_unavailable" }
}

async function boundedJwks(
  response: Response,
): Promise<Array<Record<string, unknown>> | null> {
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JWKS_BYTES) {
    await response.body?.cancel().catch(() => undefined)
    return null
  }
  const reader = response.body?.getReader()
  if (!reader) {
    return null
  }
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    total += value.byteLength
    if (total > MAX_JWKS_BYTES) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const body = Buffer.alloc(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    const parsed = JSON.parse(body.toString("utf8")) as unknown
    if (
      !isRecord(parsed) ||
      !Array.isArray(parsed.keys) ||
      parsed.keys.length > 64
    ) {
      return null
    }
    return parsed.keys.filter(isRecord)
  } catch {
    return null
  } finally {
    body.fill(0)
  }
}

function parseJwt(token: string): {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signature: string
  signedContent: string
} | null {
  if (Buffer.byteLength(token, "utf8") > MAX_JWT_BYTES) {
    return null
  }
  const [header, payload, signature, extra] = token.split(".")
  if (
    !header ||
    !payload ||
    !signature ||
    extra ||
    !canonicalBase64UrlSegment(header) ||
    !canonicalBase64UrlSegment(payload) ||
    !canonicalBase64UrlSegment(signature)
  ) {
    return null
  }
  try {
    const headerBytes = Buffer.from(header, "base64url")
    const payloadBytes = Buffer.from(payload, "base64url")
    if (
      headerBytes.byteLength > MAX_JWT_SEGMENT_BYTES ||
      payloadBytes.byteLength > MAX_JWT_SEGMENT_BYTES
    ) {
      return null
    }
    const parsedHeader = JSON.parse(headerBytes.toString("utf8")) as unknown
    const parsedPayload = JSON.parse(payloadBytes.toString("utf8")) as unknown
    return isRecord(parsedHeader) && isRecord(parsedPayload)
      ? {
          header: parsedHeader,
          payload: parsedPayload,
          signature,
          signedContent: `${header}.${payload}`,
        }
      : null
  } catch {
    return null
  }
}

function realmRoles(payload: Record<string, unknown>): string[] {
  return isRecord(payload.realm_access)
    ? boundedStringArray(payload.realm_access.roles, 64, 128)
    : []
}

function audienceContains(value: unknown, expected: string): boolean {
  return value === expected || stringArray(value).includes(expected)
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
}

function boundedStringArray(
  value: unknown,
  maximumEntries: number,
  maximumLength: number,
): string[] {
  if (!Array.isArray(value) || value.length > maximumEntries) {
    return []
  }
  const strings = value.filter(
    (entry): entry is string =>
      typeof entry === "string" &&
      entry.length > 0 &&
      entry.length <= maximumLength,
  )
  return strings.length === value.length ? strings : []
}

function scopeValues(value: unknown): string[] {
  return typeof value === "string" && value.length <= 4096
    ? value.split(/\s+/).filter(Boolean)
    : []
}

function boundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): string | undefined {
  return typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum
    ? value
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function usableSigningJwk(value: Record<string, unknown>): boolean {
  return (
    value.kty === "RSA" &&
    value.alg === "RS256" &&
    value.use === "sig" &&
    typeof value.kid === "string" &&
    value.kid.length > 0 &&
    value.kid.length <= 255 &&
    typeof value.n === "string" &&
    typeof value.e === "string" &&
    (!Array.isArray(value.key_ops) || value.key_ops.includes("verify"))
  )
}

function canonicalBase64UrlSegment(value: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return false
  }
  const decoded = Buffer.from(value, "base64url")
  return (
    decoded.byteLength <= MAX_JWT_SEGMENT_BYTES &&
    decoded.toString("base64url") === value
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function assertConfig(config: ConsoleIdentityJwtConfig): void {
  if (
    !config.accessAudience ||
    !config.clientId ||
    new URL(config.issuer).protocol !== "https:" ||
    new URL(config.jwksUrl).protocol !== "https:"
  ) {
    throw new Error("Console identity JWT configuration is invalid.")
  }
}
