import { createHash, timingSafeEqual } from "node:crypto"
import {
  type ConsoleHighRiskAction,
  consoleHighRiskActions,
} from "@llm-machines/contracts/inference-core"
import type {
  ConsoleEncryptionContext,
  ConsoleSessionCipher,
} from "../auth/console-session-crypto"
import {
  newOpaqueHandle,
  opaqueHandleDigest,
} from "../auth/console-session-crypto"
import type {
  ConsoleOidcClient,
  ConsoleOidcTokenSet,
} from "./console-session-oidc"
import type {
  ConsoleSessionRecord,
  ConsoleSessionRepository,
  ConsoleSessionRole,
} from "./console-session-store"

const ACCESS_LIFETIME_MS = 5 * 60 * 1000
const IDLE_LIFETIME_MS = 8 * 60 * 60 * 1000
const ABSOLUTE_LIFETIME_MS = 24 * 60 * 60 * 1000
const REFRESH_SKEW_MS = 60 * 1000
const LOGIN_LIFETIME_MS = 2 * 60 * 1000
const REFRESH_OUTAGE_BACKOFF_MS = 5 * 1000

interface SecretPayload {
  accessToken: string
  email?: string
  groups: string[]
  keycloakSessionId?: string
  mfaVerifiedAt?: string
  refreshToken: string
  role: ConsoleSessionRole
  subject: string
}

interface LoginSecret {
  action?: ConsoleHighRiskAction
  codeVerifier: string
  elevation: boolean
  nonce: string
  priorSessionHandle?: string
  returnPath: string
  expectedSubject?: string
}

export interface ValidatedConsoleIdentity {
  accessExpiresAt: Date
  email?: string
  groups: string[]
  keycloakSessionId?: string
  mfaVerifiedAt?: Date
  offlineAccess: boolean
  role: ConsoleSessionRole
  subject: string
}

export type ConsoleTokenValidation =
  | { identity: ValidatedConsoleIdentity; state: "valid" }
  | { state: "invalid" }
  | {
      reason: "identity_restart" | "identity_timeout" | "identity_unavailable"
      state: "unavailable"
    }

export interface ConsoleTokenValidator {
  readiness(): Promise<
    | { state: "ready" }
    | {
        reason: "identity_restart" | "identity_timeout" | "identity_unavailable"
        state: "unavailable"
      }
  >
  validate(
    tokens: ConsoleOidcTokenSet,
    expectedNonce?: string,
  ): Promise<ConsoleTokenValidation>
}

export interface RefreshFailureTelemetry {
  record(event: {
    event: "console_session.refresh_failed"
    reason: string
    sessionReference: string
  }): void | Promise<void>
}

export interface ConsoleSessionView {
  accessToken: string
  accessTokenExpiresAt: Date
  email?: string
  groups: string[]
  mfaVerifiedAt: Date | null
  role: ConsoleSessionRole
  subject: string
}

export type ConsoleSessionResolution =
  | { reason: string; state: "terminal" }
  | { reason: string; retryable: true; state: "unavailable" }
  | { refreshCount: 0 | 1; session: ConsoleSessionView; state: "active" }

type LockedConsoleSessionResolution =
  | Exclude<ConsoleSessionResolution, { state: "active" }>
  | (Extract<ConsoleSessionResolution, { state: "active" }> & {
      refreshGeneration: number
    })

export interface ConsoleBackchannelClaims {
  expiresAt: Date
  issuedAt: Date
  jti: string
  keycloakSessionId?: string
  subject?: string
}

export type ConsoleBackchannelVerification =
  | ConsoleBackchannelClaims
  | null
  | {
      reason: "identity_restart" | "identity_timeout" | "identity_unavailable"
      retryable: true
      state: "unavailable"
    }

export interface ConsoleBackchannelVerifier {
  verify(token: string): Promise<ConsoleBackchannelVerification>
}

export interface ConsoleIdentityContext {
  clientId: string
  issuer: string
}

export type ConsoleAuthorizationStart = {
  authorizationUrl: string
  loginHandle: string
}

export class ConsoleSessionService {
  constructor(
    private readonly repository: ConsoleSessionRepository,
    private readonly cipher: ConsoleSessionCipher,
    private readonly oidc: ConsoleOidcClient,
    private readonly validator: ConsoleTokenValidator,
    private readonly telemetry: RefreshFailureTelemetry,
    private readonly identityContext: ConsoleIdentityContext,
    private readonly now: () => Date = () => new Date(),
  ) {}

  beginLogin(returnTo: string): Promise<ConsoleAuthorizationStart> {
    return this.createAuthorization(returnTo, null)
  }

  async beginElevation(input: {
    action: string
    returnTo: string
    sessionHandle: string
  }): Promise<
    | ({ state: "started" } & ConsoleAuthorizationStart)
    | Exclude<ConsoleSessionResolution, { state: "active" }>
  > {
    if (!isConsoleHighRiskAction(input.action)) {
      return { reason: "invalid", state: "terminal" }
    }
    const current = await this.resolve(input.sessionHandle)
    if (current.state !== "active") {
      return current
    }
    return {
      ...(await this.createAuthorization(input.returnTo, {
        action: input.action,
        priorSessionHandle: input.sessionHandle,
        subject: current.session.subject,
      })),
      state: "started",
    }
  }

  private async createAuthorization(
    returnTo: string,
    elevation: {
      action: ConsoleHighRiskAction
      priorSessionHandle: string
      subject: string
    } | null,
  ): Promise<ConsoleAuthorizationStart> {
    const now = this.now()
    const loginHandle = newOpaqueHandle()
    const handleDigest = opaqueHandleDigest(loginHandle)
    const state = newOpaqueHandle()
    const codeVerifier = newOpaqueHandle() + newOpaqueHandle()
    const nonce = newOpaqueHandle()
    await this.repository.insertLogin({
      createdAt: now,
      encryptedPayload: this.cipher.seal(
        encryptionContext(
          this.identityContext,
          "login",
          handleDigest,
          elevation
            ? identitySelectorDigest("subject", elevation.subject)
            : undefined,
        ),
        {
          action: elevation?.action,
          codeVerifier,
          elevation: Boolean(elevation),
          nonce,
          priorSessionHandle: elevation?.priorSessionHandle,
          returnPath: normalizeConsoleReturnPath(returnTo),
          expectedSubject: elevation?.subject,
        },
      ),
      encryptionKid: this.cipher.activeKid,
      expiresAt: new Date(now.getTime() + LOGIN_LIFETIME_MS),
      handleDigest,
      stateDigest: opaqueHandleDigest(state),
      subjectDigest: elevation
        ? identitySelectorDigest("subject", elevation.subject)
        : null,
    })
    return {
      authorizationUrl: this.oidc.authorizationUrl({
        codeChallenge: createHash("sha256")
          .update(codeVerifier, "utf8")
          .digest("base64url"),
        elevation: Boolean(elevation),
        nonce,
        state,
      }),
      loginHandle,
    }
  }

  async completeLogin(input: {
    code: string
    loginHandle: string
    state: string
  }): Promise<
    | { returnPath: string; sessionHandle: string; state: "active" }
    | { reason: string; returnPath?: string; state: "terminal" }
    | {
        reason: string
        retryable: true
        returnPath?: string
        state: "unavailable"
      }
  > {
    const now = this.now()
    const login = await this.repository.consumeLogin(
      opaqueHandleDigest(input.loginHandle),
      opaqueHandleDigest(input.state),
      now,
    )
    if (!login) {
      return { reason: "invalid", state: "terminal" }
    }
    let loginSecret: LoginSecret
    try {
      loginSecret = parseLoginSecret(
        this.cipher.open(
          encryptionContext(
            this.identityContext,
            "login",
            login.handleDigest,
            login.subjectDigest ?? undefined,
          ),
          login.encryptedPayload,
        ),
      )
    } catch {
      return { reason: "invalid", state: "terminal" }
    }
    if (
      (loginSecret.expectedSubject
        ? identitySelectorDigest("subject", loginSecret.expectedSubject)
        : null) !== login.subjectDigest
    ) {
      return { reason: "invalid", state: "terminal" }
    }
    const exchange = await this.oidc.exchangeCode(
      input.code,
      loginSecret.codeVerifier,
    )
    if (exchange.state !== "ok") {
      return exchange.state === "unavailable"
        ? {
            reason: exchange.reason,
            retryable: true,
            returnPath: loginSecret.returnPath,
            state: "unavailable",
          }
        : {
            reason: exchange.reason,
            returnPath: loginSecret.returnPath,
            state: "terminal",
          }
    }
    const validation = await this.validator.validate(
      exchange.tokens,
      loginSecret.nonce,
    )
    if (validation.state !== "valid") {
      return validation.state === "unavailable"
        ? {
            reason: validation.reason,
            retryable: true,
            returnPath: loginSecret.returnPath,
            state: "unavailable",
          }
        : {
            reason: "invalid",
            returnPath: loginSecret.returnPath,
            state: "terminal",
          }
    }
    if (
      !acceptedIdentity(validation.identity, now) ||
      (loginSecret.expectedSubject &&
        validation.identity.subject !== loginSecret.expectedSubject)
    ) {
      return {
        reason: "invalid",
        returnPath: loginSecret.returnPath,
        state: "terminal",
      }
    }
    const sessionHandle = newOpaqueHandle()
    const handleDigest = opaqueHandleDigest(sessionHandle)
    try {
      await this.repository.insertSession(
        newSessionRecord(
          handleDigest,
          exchange.tokens,
          validation.identity,
          this.cipher,
          this.identityContext,
          now,
        ),
      )
    } catch (error) {
      await this.oidc.revoke(exchange.tokens.refreshToken)
      throw error
    }
    if (loginSecret.priorSessionHandle) {
      await this.logout(loginSecret.priorSessionHandle)
    }
    return {
      returnPath: loginSecret.returnPath,
      sessionHandle,
      state: "active",
    }
  }

  async resolve(sessionHandle: string): Promise<ConsoleSessionResolution> {
    return publicSessionResolution(
      await this.resolveLocked(sessionHandle, false),
    )
  }

  async logout(sessionHandle: string): Promise<void> {
    await this.terminateSession(sessionHandle, "revoke")
  }

  async globalLogout(sessionHandle: string): Promise<void> {
    await this.terminateSession(sessionHandle, "end-session")
  }

  private async terminateSession(
    sessionHandle: string,
    remoteAction: "end-session" | "revoke",
  ): Promise<void> {
    const digest = opaqueHandleDigest(sessionHandle)
    let refreshToken: string | null = null
    await this.repository.withLockedSession(digest, async (record) => {
      if (record) {
        try {
          refreshToken = parseSecretPayload(
            this.cipher.open(
              encryptionContext(
                this.identityContext,
                "session",
                digest,
                record.subjectDigest,
              ),
              record.encryptedPayload,
            ),
          ).refreshToken
        } catch {
          refreshToken = null
        }
      }
      return { record: null, value: undefined }
    })
    if (refreshToken) {
      if (remoteAction === "end-session") {
        await this.oidc.endSession(refreshToken)
      } else {
        await this.oidc.revoke(refreshToken)
      }
    }
  }

  async backchannelLogout(claims: ConsoleBackchannelClaims): Promise<number> {
    const now = this.now()
    if (
      now.getTime() - claims.issuedAt.getTime() > 5 * 60 * 1000 ||
      claims.issuedAt.getTime() - now.getTime() > REFRESH_SKEW_MS ||
      claims.expiresAt.getTime() <= now.getTime() ||
      claims.expiresAt.getTime() >
        now.getTime() + 5 * 60 * 1000 + REFRESH_SKEW_MS ||
      (!claims.keycloakSessionId && !claims.subject)
    ) {
      return 0
    }
    return this.repository.consumeLogoutAndRevoke({
      jtiDigest: identitySelectorDigest("logout-jti", claims.jti),
      keycloakSessionDigest: claims.keycloakSessionId
        ? identitySelectorDigest("keycloak-session", claims.keycloakSessionId)
        : undefined,
      now,
      retainUntil: new Date(claims.expiresAt.getTime() + REFRESH_SKEW_MS),
      subjectDigest: claims.subject
        ? identitySelectorDigest("subject", claims.subject)
        : undefined,
    })
  }

  async executeWithSession<T>(
    sessionHandle: string,
    operation: (accessToken: string) => Promise<{ status: number; value: T }>,
  ): Promise<
    | { state: "ok"; value: T }
    | Exclude<ConsoleSessionResolution, { state: "active" }>
  > {
    const initial = await this.resolveLocked(sessionHandle, false)
    if (initial.state !== "active") {
      return initial
    }
    const first = await operation(initial.session.accessToken)
    if (first.status !== 401) {
      return { state: "ok", value: first.value }
    }
    if (initial.refreshCount === 1) {
      await this.terminate(sessionHandle, "revoked")
      return { reason: "revoked", state: "terminal" }
    }
    const refreshed = await this.resolveLocked(
      sessionHandle,
      true,
      initial.refreshGeneration,
    )
    if (refreshed.state !== "active") {
      return refreshed
    }
    const replay = await operation(refreshed.session.accessToken)
    if (replay.status === 401) {
      await this.terminate(sessionHandle, "revoked")
      return { reason: "revoked", state: "terminal" }
    }
    return { state: "ok", value: replay.value }
  }

  private async resolveLocked(
    sessionHandle: string,
    forceRefresh: boolean,
    expectedRefreshGeneration?: number,
  ): Promise<LockedConsoleSessionResolution> {
    const digest = opaqueHandleDigest(sessionHandle)
    return this.repository.withLockedSession(digest, async (record) => {
      const now = this.now()
      if (!record) {
        return { record: null, value: terminal("absent") }
      }
      if (record.idleExpiresAt <= now || record.absoluteExpiresAt <= now) {
        return {
          record: null,
          value: terminal("expired"),
        }
      }
      if (
        record.refreshBlockedUntil &&
        record.refreshFailureReason &&
        record.refreshBlockedUntil > now
      ) {
        return {
          record,
          value: {
            reason: record.refreshFailureReason,
            retryable: true,
            state: "unavailable",
          } as const,
        }
      }
      let secret: SecretPayload
      try {
        secret = parseSecretPayload(
          this.cipher.open(
            encryptionContext(
              this.identityContext,
              "session",
              digest,
              record.subjectDigest,
            ),
            record.encryptedPayload,
          ),
        )
      } catch {
        return {
          record: null,
          value: terminal("invalid"),
        }
      }
      if (
        forceRefresh ||
        record.accessExpiresAt.getTime() <= now.getTime() + REFRESH_SKEW_MS
      ) {
        if (
          forceRefresh &&
          expectedRefreshGeneration !== undefined &&
          record.refreshGeneration !== expectedRefreshGeneration
        ) {
          if (
            record.accessExpiresAt.getTime() <=
            now.getTime() + REFRESH_SKEW_MS
          ) {
            return this.refreshLocked(record, secret, now)
          }
          const touched = touchRecord(record, now)
          return {
            record: touched,
            value: activeView(touched, secret, 1),
          }
        }
        return this.refreshLocked(record, secret, now)
      }
      const touched = touchRecord(record, now)
      return {
        record: touched,
        value: activeView(touched, secret, 0),
      }
    })
  }

  private async refreshLocked(
    record: ConsoleSessionRecord,
    secret: SecretPayload,
    now: Date,
  ) {
    const readiness = await this.validator.readiness()
    if (readiness.state === "unavailable") {
      await this.recordFailure(record, readiness.reason)
      return {
        record: blockRefresh(record, readiness.reason, now),
        value: {
          reason: readiness.reason,
          retryable: true,
          state: "unavailable",
        } as const,
      }
    }
    const result = await this.oidc.refresh(secret.refreshToken)
    if (result.state === "unavailable") {
      await this.recordFailure(record, result.reason)
      return {
        record: blockRefresh(record, result.reason, now),
        value: {
          reason: result.reason,
          retryable: true,
          state: "unavailable",
        } as const,
      }
    }
    if (result.state === "terminal") {
      await this.recordFailure(record, result.reason)
      return {
        record: null,
        value: terminal(result.reason),
      }
    }
    if (sameSecret(result.tokens.refreshToken, secret.refreshToken)) {
      await this.recordFailure(record, "refresh_not_rotated")
      return {
        record: null,
        value: terminal("reuse_detected"),
      }
    }
    const validation = await this.validator.validate(result.tokens)
    if (validation.state === "unavailable") {
      await this.recordFailure(record, validation.reason)
      return {
        record: preserveRotatedRefreshToken(
          record,
          secret,
          result.tokens.refreshToken,
          this.cipher,
          this.identityContext,
          now,
          validation.reason,
        ),
        value: {
          reason: validation.reason,
          retryable: true,
          state: "unavailable",
        } as const,
      }
    }
    if (
      validation.state !== "valid" ||
      validation.identity.subject !== secret.subject ||
      !acceptedIdentity(validation.identity, now)
    ) {
      await this.recordFailure(record, "malformed_response")
      return {
        record: null,
        value: terminal("revoked"),
      }
    }
    const updated = refreshedRecord(
      record,
      result.tokens,
      validation.identity,
      this.cipher,
      this.identityContext,
      now,
    )
    return {
      record: updated,
      value: activeView(
        updated,
        secretFromIdentity(result.tokens, validation.identity),
        1,
      ),
    }
  }

  private async terminate(
    sessionHandle: string,
    _reason: string,
  ): Promise<void> {
    const digest = opaqueHandleDigest(sessionHandle)
    await this.repository.withLockedSession(digest, async () => ({
      record: null,
      value: undefined,
    }))
  }

  private async recordFailure(record: ConsoleSessionRecord, reason: string) {
    await this.telemetry.record({
      event: "console_session.refresh_failed",
      reason,
      sessionReference: record.handleDigest.slice(0, 12),
    })
  }
}

export function isConsoleHighRiskAction(
  action: string,
): action is ConsoleHighRiskAction {
  return (consoleHighRiskActions as readonly string[]).includes(action)
}

export function normalizeConsoleReturnPath(value: string | undefined): string {
  if (!value || !safeReturnShape(value) || unsafePathSyntax(value)) {
    return "/"
  }
  try {
    const url = new URL(value, "https://console.invalid")
    const canonical = `${url.pathname}${url.search}${url.hash}`
    return url.origin === "https://console.invalid" &&
      safeReturnShape(canonical) &&
      !unsafePathSyntax(canonical)
      ? canonical
      : "/"
  } catch {
    return "/"
  }
}

function safeReturnShape(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value) &&
    !containsControlCharacter(value)
  )
}

function unsafePathSyntax(value: string): boolean {
  const path = value.split(/[?#]/, 1)[0] ?? ""
  if (/%(?:2f|5c)/i.test(path)) {
    return true
  }
  return path.split("/").some((segment) => {
    try {
      const decoded = decodeURIComponent(segment)
      return decoded === "." || decoded === ".."
    } catch {
      return true
    }
  })
}

function newSessionRecord(
  handleDigest: string,
  tokens: ConsoleOidcTokenSet,
  identity: ValidatedConsoleIdentity,
  cipher: ConsoleSessionCipher,
  identityContext: ConsoleIdentityContext,
  now: Date,
): ConsoleSessionRecord {
  const subjectDigest = identitySelectorDigest("subject", identity.subject)
  return {
    absoluteExpiresAt: new Date(now.getTime() + ABSOLUTE_LIFETIME_MS),
    accessExpiresAt: identity.accessExpiresAt,
    createdAt: now,
    encryptedPayload: cipher.seal(
      encryptionContext(
        identityContext,
        "session",
        handleDigest,
        subjectDigest,
      ),
      secretFromIdentity(tokens, identity),
    ),
    encryptionKid: cipher.activeKid,
    handleDigest,
    idleExpiresAt: new Date(now.getTime() + IDLE_LIFETIME_MS),
    keycloakSessionDigest: identity.keycloakSessionId
      ? identitySelectorDigest("keycloak-session", identity.keycloakSessionId)
      : null,
    lastSeenAt: now,
    refreshBlockedUntil: null,
    refreshFailureReason: null,
    refreshGeneration: 0,
    subjectDigest,
    updatedAt: now,
  }
}

function refreshedRecord(
  record: ConsoleSessionRecord,
  tokens: ConsoleOidcTokenSet,
  identity: ValidatedConsoleIdentity,
  cipher: ConsoleSessionCipher,
  identityContext: ConsoleIdentityContext,
  now: Date,
): ConsoleSessionRecord {
  const subjectDigest = identitySelectorDigest("subject", identity.subject)
  return {
    ...record,
    accessExpiresAt: identity.accessExpiresAt,
    encryptedPayload: cipher.seal(
      encryptionContext(
        identityContext,
        "session",
        record.handleDigest,
        subjectDigest,
      ),
      secretFromIdentity(tokens, identity),
    ),
    encryptionKid: cipher.activeKid,
    idleExpiresAt: new Date(
      Math.min(
        now.getTime() + IDLE_LIFETIME_MS,
        record.absoluteExpiresAt.getTime(),
      ),
    ),
    keycloakSessionDigest: identity.keycloakSessionId
      ? identitySelectorDigest("keycloak-session", identity.keycloakSessionId)
      : record.keycloakSessionDigest,
    lastSeenAt: now,
    refreshBlockedUntil: null,
    refreshFailureReason: null,
    refreshGeneration: record.refreshGeneration + 1,
    subjectDigest,
    updatedAt: now,
  }
}

function preserveRotatedRefreshToken(
  record: ConsoleSessionRecord,
  secret: SecretPayload,
  refreshToken: string,
  cipher: ConsoleSessionCipher,
  identityContext: ConsoleIdentityContext,
  now: Date,
  reason: "identity_restart" | "identity_timeout" | "identity_unavailable",
): ConsoleSessionRecord {
  return {
    ...record,
    accessExpiresAt: now,
    encryptedPayload: cipher.seal(
      encryptionContext(
        identityContext,
        "session",
        record.handleDigest,
        record.subjectDigest,
      ),
      { ...secret, refreshToken },
    ),
    encryptionKid: cipher.activeKid,
    refreshBlockedUntil: new Date(now.getTime() + REFRESH_OUTAGE_BACKOFF_MS),
    refreshFailureReason: reason,
    refreshGeneration: record.refreshGeneration + 1,
    updatedAt: now,
  }
}

function touchRecord(
  record: ConsoleSessionRecord,
  now: Date,
): ConsoleSessionRecord {
  return {
    ...record,
    idleExpiresAt: new Date(
      Math.min(
        now.getTime() + IDLE_LIFETIME_MS,
        record.absoluteExpiresAt.getTime(),
      ),
    ),
    lastSeenAt: now,
    refreshBlockedUntil: null,
    refreshFailureReason: null,
    updatedAt: now,
  }
}

function blockRefresh(
  record: ConsoleSessionRecord,
  reason: "identity_restart" | "identity_timeout" | "identity_unavailable",
  now: Date,
): ConsoleSessionRecord {
  return {
    ...record,
    refreshBlockedUntil: new Date(now.getTime() + REFRESH_OUTAGE_BACKOFF_MS),
    refreshFailureReason: reason,
  }
}

function activeView(
  record: ConsoleSessionRecord,
  secret: SecretPayload,
  refreshCount: 0 | 1,
): LockedConsoleSessionResolution {
  return {
    refreshCount,
    refreshGeneration: record.refreshGeneration,
    session: {
      accessToken: secret.accessToken,
      accessTokenExpiresAt: record.accessExpiresAt,
      email: secret.email,
      groups: secret.groups,
      mfaVerifiedAt: secret.mfaVerifiedAt
        ? new Date(secret.mfaVerifiedAt)
        : null,
      role: secret.role,
      subject: secret.subject,
    },
    state: "active",
  }
}

function publicSessionResolution(
  resolution: LockedConsoleSessionResolution,
): ConsoleSessionResolution {
  if (resolution.state !== "active") {
    return resolution
  }
  const { refreshGeneration: _refreshGeneration, ...visible } = resolution
  return visible
}

function acceptedIdentity(
  identity: ValidatedConsoleIdentity,
  now: Date,
): boolean {
  const lifetime = identity.accessExpiresAt.getTime() - now.getTime()
  return (
    !identity.offlineAccess &&
    lifetime > -REFRESH_SKEW_MS &&
    lifetime <= ACCESS_LIFETIME_MS + REFRESH_SKEW_MS
  )
}

function terminal(
  reason: string,
): Extract<ConsoleSessionResolution, { state: "terminal" }> {
  return { reason, state: "terminal" }
}

function secretFromIdentity(
  tokens: ConsoleOidcTokenSet,
  identity: ValidatedConsoleIdentity,
): SecretPayload {
  return {
    accessToken: tokens.accessToken,
    email: identity.email,
    groups: identity.groups,
    keycloakSessionId: identity.keycloakSessionId,
    mfaVerifiedAt: identity.mfaVerifiedAt?.toISOString(),
    refreshToken: tokens.refreshToken,
    role: identity.role,
    subject: identity.subject,
  }
}

function identitySelectorDigest(kind: string, value: string): string {
  return createHash("sha256")
    .update(`llmm-console-session:${kind}:v1\0`, "utf8")
    .update(value, "utf8")
    .digest("hex")
}

function sameSecret(left: string, right: string): boolean {
  const a = createHash("sha256").update(left, "utf8").digest()
  const b = createHash("sha256").update(right, "utf8").digest()
  return timingSafeEqual(a, b)
}

function parseLoginSecret(value: unknown): LoginSecret {
  if (!isRecord(value)) {
    throw new Error("Invalid encrypted Console login payload.")
  }
  const codeVerifier = boundedString(value.codeVerifier, 64, 128)
  const nonce = boundedString(value.nonce, 43, 128)
  const returnPath = boundedString(value.returnPath, 1, 4096)
  if (
    !codeVerifier ||
    !nonce ||
    !returnPath ||
    typeof value.elevation !== "boolean" ||
    normalizeConsoleReturnPath(returnPath) !== returnPath
  ) {
    throw new Error("Invalid encrypted Console login payload.")
  }
  const action = typeof value.action === "string" ? value.action : undefined
  const expectedSubject =
    typeof value.expectedSubject === "string"
      ? value.expectedSubject
      : undefined
  const priorSessionHandle =
    typeof value.priorSessionHandle === "string"
      ? value.priorSessionHandle
      : undefined
  if (
    value.elevation !==
      Boolean(action && expectedSubject && priorSessionHandle) ||
    (action && !isConsoleHighRiskAction(action)) ||
    (expectedSubject && !boundedString(expectedSubject, 1, 255)) ||
    (priorSessionHandle && !/^[A-Za-z0-9_-]{43}$/.test(priorSessionHandle))
  ) {
    throw new Error("Invalid encrypted Console elevation payload.")
  }
  return {
    action: action as ConsoleHighRiskAction | undefined,
    codeVerifier,
    elevation: value.elevation,
    expectedSubject,
    nonce,
    priorSessionHandle,
    returnPath,
  }
}

function parseSecretPayload(value: unknown): SecretPayload {
  if (!isRecord(value)) {
    throw new Error("Invalid encrypted Console session payload.")
  }
  const accessToken = boundedString(value.accessToken, 1, 32 * 1024)
  const refreshToken = boundedString(value.refreshToken, 1, 32 * 1024)
  const subject = boundedString(value.subject, 1, 255)
  const groups = Array.isArray(value.groups)
    ? value.groups.filter(
        (group): group is string =>
          typeof group === "string" && group.length > 0 && group.length <= 255,
      )
    : []
  const role =
    value.role === "admin" || value.role === "operator" ? value.role : null
  const mfaVerifiedAt =
    typeof value.mfaVerifiedAt === "string" &&
    Number.isFinite(new Date(value.mfaVerifiedAt).getTime())
      ? value.mfaVerifiedAt
      : undefined
  if (
    !accessToken ||
    !refreshToken ||
    !subject ||
    !role ||
    !Array.isArray(value.groups) ||
    groups.length !== value.groups.length ||
    groups.length > 64
  ) {
    throw new Error("Invalid encrypted Console session payload.")
  }
  return {
    accessToken,
    email: boundedString(value.email, 3, 320),
    groups,
    keycloakSessionId: boundedString(value.keycloakSessionId, 1, 255),
    mfaVerifiedAt,
    refreshToken,
    role,
    subject,
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 31 || code === 127) {
      return true
    }
  }
  return false
}

function encryptionContext(
  identity: ConsoleIdentityContext,
  recordType: "login" | "session",
  recordId: string,
  subject?: string,
): ConsoleEncryptionContext {
  return {
    clientId: identity.clientId,
    issuer: identity.issuer,
    recordId,
    recordType,
    recordVersion: 1,
    ...(subject ? { subject } : {}),
  }
}
