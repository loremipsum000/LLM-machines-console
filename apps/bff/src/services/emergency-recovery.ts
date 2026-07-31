import {
  randomBytes as nodeRandomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto"
import type {
  EmergencyRecoveryActivationResult,
  EmergencyRecoveryActivationServiceInput,
  EmergencyRecoveryCommissionResult,
  EmergencyRecoveryCommissionServiceInput,
  EmergencyRecoveryGrant,
  EmergencyRecoveryReasonCode,
  EmergencyRecoveryResolution,
  EmergencyRecoveryRevocationResult,
  EmergencyRecoveryStatusResult,
} from "@llm-machines/contracts/inference-core"
import {
  emergencyRecoveryActivationServiceInputSchema,
  emergencyRecoveryApprovedMfaMethods,
  emergencyRecoveryCommissionServiceInputSchema,
  emergencyRecoveryReasonCodeSchema,
} from "@llm-machines/contracts/inference-core"
import { and, eq, gt, lte, sql } from "drizzle-orm"
import { getInferenceCoreDb } from "../db/inference-core-client"
import {
  auditEvents,
  emergencyRecoveryFactor,
  emergencyRecoverySessions,
} from "../db/inference-core-schema"

const factorId = "appliance"
const recoverySessionDurationMs = 15 * 60 * 1000
const recentAuthenticationWindowSeconds = 5 * 60
const activationVerifierCapacity = 1
const activationAttemptLimitPerSubject = 5
const activationAttemptWindowMs = 60 * 1000
const activationAttemptSubjectCapacity = 1024
const activationBusyRetryAfterSeconds = 1
const scryptParameters = {
  algorithm: "scrypt" as const,
  blockSize: 8,
  cost: 16_384,
  keyLength: 32,
  maxMemory: 64 * 1024 * 1024,
  parallelization: 1,
}

type InferenceCoreDatabase = NonNullable<ReturnType<typeof getInferenceCoreDb>>

type ActivationAdmission =
  | {
      admitted: false
      retryAfterSeconds: number
    }
  | {
      admitted: true
      release: () => void
    }

interface ActivationAttemptWindow {
  admittedAttempts: number
  lastAdmittedAtMs: number
  startedAtMs: number
}

class ActivationAbuseControl {
  private readonly activePermits = new Set<symbol>()
  private readonly attemptWindows = new Map<string, ActivationAttemptWindow>()

  admit(keycloakSubjectId: string, nowMs: number): ActivationAdmission {
    this.pruneExpiredWindows(nowMs)

    const existing = this.attemptWindows.get(keycloakSubjectId)
    if (
      existing &&
      existing.admittedAttempts >= activationAttemptLimitPerSubject
    ) {
      return {
        admitted: false,
        retryAfterSeconds: boundedRetryAfterSeconds(
          existing.startedAtMs + activationAttemptWindowMs - nowMs,
        ),
      }
    }
    if (this.activePermits.size >= activationVerifierCapacity) {
      return {
        admitted: false,
        retryAfterSeconds: activationBusyRetryAfterSeconds,
      }
    }

    let window = existing
    if (!window) {
      this.evictOldestWindowAtCapacity()
      window = {
        admittedAttempts: 0,
        lastAdmittedAtMs: nowMs,
        startedAtMs: nowMs,
      }
      this.attemptWindows.set(keycloakSubjectId, window)
    }
    window.admittedAttempts += 1
    window.lastAdmittedAtMs = nowMs

    const permit = Symbol(keycloakSubjectId)
    this.activePermits.add(permit)
    return {
      admitted: true,
      release: () => {
        this.activePermits.delete(permit)
      },
    }
  }

  private pruneExpiredWindows(nowMs: number): void {
    for (const [subject, window] of this.attemptWindows) {
      if (nowMs >= window.startedAtMs + activationAttemptWindowMs) {
        this.attemptWindows.delete(subject)
      }
    }
  }

  private evictOldestWindowAtCapacity(): void {
    if (this.attemptWindows.size < activationAttemptSubjectCapacity) {
      return
    }
    let oldestSubject: string | undefined
    let oldestAdmission = Number.POSITIVE_INFINITY
    for (const [subject, window] of this.attemptWindows) {
      if (window.lastAdmittedAtMs < oldestAdmission) {
        oldestSubject = subject
        oldestAdmission = window.lastAdmittedAtMs
      }
    }
    if (oldestSubject) {
      this.attemptWindows.delete(oldestSubject)
    }
  }
}

function boundedRetryAfterSeconds(remainingMs: number): number {
  return Math.min(
    activationAttemptWindowMs / 1000,
    Math.max(1, Math.ceil(remainingMs / 1000)),
  )
}

export interface StoredEmergencyRecoveryFactor {
  algorithm: string
  blockSize: number
  commissionedAt: Date
  commissionedBy: string
  cost: number
  keyLength: number
  maxMemory: number
  parallelization: number
  salt: string
  verifierHash: string
}

export interface StoredEmergencyRecoverySession {
  activatedAt: Date
  correlationId: string
  expiresAt: Date
  id: string
  keycloakSubjectId: string
  reasonCode: string
  revokedAt: Date | null
  revokedBy: string | null
  status: "active" | "expired" | "revoked"
}

export interface EmergencyRecoveryAuditInput {
  action: string
  correlationId: string
  keycloakSubjectId: string
  occurredAt: Date
  outcome: "denied" | "succeeded"
  recoveryReasonCode?: EmergencyRecoveryReasonCode
}

export interface EmergencyRecoveryStore {
  activate(
    session: StoredEmergencyRecoverySession,
    audit: EmergencyRecoveryAuditInput,
  ): Promise<"active_session_exists" | StoredEmergencyRecoverySession>
  commission(
    factor: StoredEmergencyRecoveryFactor,
    audit: EmergencyRecoveryAuditInput,
  ): Promise<"already_commissioned" | "commissioned">
  expire(
    sessionId: string,
    now: Date,
  ): Promise<StoredEmergencyRecoverySession | null>
  getFactor(): Promise<StoredEmergencyRecoveryFactor | null>
  getActiveSession(now: Date): Promise<StoredEmergencyRecoverySession | null>
  getSession(sessionId: string): Promise<StoredEmergencyRecoverySession | null>
  recordAudit(audit: EmergencyRecoveryAuditInput): Promise<void>
  revoke(input: {
    allowAny: boolean
    audit: EmergencyRecoveryAuditInput
    now: Date
    requesterSubjectId: string
    sessionId: string
  }): Promise<StoredEmergencyRecoverySession | null>
}

export interface EmergencyRecoveryServiceOptions {
  now?: () => Date
  randomBytes?: (size: number) => Buffer
  randomId?: () => string
}

export class EmergencyRecoveryService {
  private readonly activationAbuseControl = new ActivationAbuseControl()
  private readonly now: () => Date
  private readonly randomBytes: (size: number) => Buffer
  private readonly randomId: () => string

  constructor(
    private readonly store: EmergencyRecoveryStore,
    options: EmergencyRecoveryServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date())
    this.randomBytes = options.randomBytes ?? nodeRandomBytes
    this.randomId = options.randomId ?? randomUUID
  }

  async commission(
    input: EmergencyRecoveryCommissionServiceInput,
  ): Promise<EmergencyRecoveryCommissionResult> {
    const parsed =
      emergencyRecoveryCommissionServiceInputSchema.safeParse(input)
    if (!parsed.success) {
      return { status: "unavailable" }
    }

    const now = this.now()
    const denied = commissionDenial(parsed.data, now)
    if (denied) {
      try {
        await this.store.recordAudit(
          recoveryAudit({
            action: "emergency_recovery.factor.commission",
            correlationId: parsed.data.correlationId,
            keycloakSubjectId: parsed.data.authentication.keycloakSubjectId,
            occurredAt: now,
            outcome: "denied",
          }),
        )
      } catch {
        return { status: "unavailable" }
      }
      return { reason: denied, status: "denied" }
    }

    try {
      const existing = await this.store.getFactor()
      if (existing) {
        await this.store.recordAudit(
          recoveryAudit({
            action: "emergency_recovery.factor.commission",
            correlationId: parsed.data.correlationId,
            keycloakSubjectId: parsed.data.authentication.keycloakSubjectId,
            occurredAt: now,
            outcome: "denied",
          }),
        )
        return { status: "already_commissioned" }
      }

      const recoveryFactor = `llmr1_${this.randomBytes(32).toString("base64url")}`
      const salt = this.randomBytes(16).toString("hex")
      const verifierHash = await deriveFactor(recoveryFactor, salt)
      const status = await this.store.commission(
        {
          ...scryptParameters,
          commissionedAt: now,
          commissionedBy: parsed.data.authentication.keycloakSubjectId,
          salt,
          verifierHash,
        },
        recoveryAudit({
          action: "emergency_recovery.factor.commission",
          correlationId: parsed.data.correlationId,
          keycloakSubjectId: parsed.data.authentication.keycloakSubjectId,
          occurredAt: now,
          outcome: "succeeded",
        }),
      )

      return status === "commissioned"
        ? {
            commissionedAt: now.toISOString(),
            recoveryFactor,
            status,
          }
        : { status }
    } catch {
      return { status: "unavailable" }
    }
  }

  async activate(
    input: EmergencyRecoveryActivationServiceInput,
  ): Promise<EmergencyRecoveryActivationResult> {
    const parsed =
      emergencyRecoveryActivationServiceInputSchema.safeParse(input)
    if (!parsed.success) {
      return { reason: "invalid_factor", status: "denied" }
    }

    const now = this.now()
    const denied = activationDenial(parsed.data, now)
    if (denied) {
      return await this.denyActivation(parsed.data, denied, now)
    }

    const admission = this.activationAbuseControl.admit(
      parsed.data.authentication.keycloakSubjectId,
      now.getTime(),
    )
    if (!admission.admitted) {
      return {
        retryAfterSeconds: admission.retryAfterSeconds,
        status: "rate_limited",
      }
    }

    try {
      const factor = await this.store.getFactor()
      if (!factor) {
        await this.store.recordAudit(
          recoveryAudit({
            action: "emergency_recovery.session.activate",
            correlationId: parsed.data.correlationId,
            keycloakSubjectId: parsed.data.authentication.keycloakSubjectId,
            occurredAt: now,
            outcome: "denied",
            recoveryReasonCode: parsed.data.reasonCode,
          }),
        )
        return { status: "not_commissioned" }
      }
      if (!(await factorMatches(parsed.data.factor, factor))) {
        return await this.denyActivation(parsed.data, "invalid_factor", now)
      }

      const activatedAt = now
      const session: StoredEmergencyRecoverySession = {
        activatedAt,
        correlationId: parsed.data.correlationId,
        expiresAt: new Date(activatedAt.getTime() + recoverySessionDurationMs),
        id: this.randomId(),
        keycloakSubjectId: parsed.data.authentication.keycloakSubjectId,
        reasonCode: parsed.data.reasonCode,
        revokedAt: null,
        revokedBy: null,
        status: "active",
      }
      const saved = await this.store.activate(
        session,
        recoveryAudit({
          action: "emergency_recovery.session.activate",
          correlationId: parsed.data.correlationId,
          keycloakSubjectId: parsed.data.authentication.keycloakSubjectId,
          occurredAt: now,
          outcome: "succeeded",
          recoveryReasonCode: parsed.data.reasonCode,
        }),
      )

      return saved === "active_session_exists"
        ? { status: "active_session_exists" }
        : { grant: toGrant(saved), status: "activated" }
    } catch {
      return { status: "unavailable" }
    } finally {
      admission.release()
    }
  }

  async resolve(
    sessionId: string,
    keycloakSubjectId: string,
  ): Promise<EmergencyRecoveryResolution> {
    if (!isUuid(sessionId) || !validSubject(keycloakSubjectId)) {
      return { status: "inactive" }
    }

    try {
      const now = this.now()
      const session = await this.store.getSession(sessionId)
      if (
        !session ||
        session.keycloakSubjectId !== keycloakSubjectId ||
        session.status !== "active"
      ) {
        return { status: "inactive" }
      }
      if (session.expiresAt.getTime() <= now.getTime()) {
        await this.store.expire(session.id, now)
        return { status: "inactive" }
      }
      return { grant: toGrant(session), status: "active" }
    } catch {
      return { status: "unavailable" }
    }
  }

  async status(): Promise<EmergencyRecoveryStatusResult> {
    try {
      const now = this.now()
      const [factor, activeSession] = await Promise.all([
        this.store.getFactor(),
        this.store.getActiveSession(now),
      ])
      return {
        activeGrant: activeSession ? toGrant(activeSession) : null,
        factor: factor
          ? {
              commissionedAt: factor.commissionedAt.toISOString(),
              commissionedBy: factor.commissionedBy,
            }
          : null,
        status: "ok",
      }
    } catch {
      return { status: "unavailable" }
    }
  }

  async revoke(input: {
    allowAny: boolean
    correlationId: string
    requesterSubjectId: string
    sessionId: string
  }): Promise<EmergencyRecoveryRevocationResult> {
    if (
      !isUuid(input.sessionId) ||
      !validSubject(input.requesterSubjectId) ||
      !validCorrelationId(input.correlationId)
    ) {
      return { status: "not_found" }
    }

    const now = this.now()
    try {
      const revoked = await this.store.revoke({
        allowAny: input.allowAny,
        audit: recoveryAudit({
          action: "emergency_recovery.session.revoke",
          correlationId: input.correlationId,
          keycloakSubjectId: input.requesterSubjectId,
          occurredAt: now,
          outcome: "succeeded",
        }),
        now,
        requesterSubjectId: input.requesterSubjectId,
        sessionId: input.sessionId,
      })
      return revoked
        ? {
            revokedAt: now.toISOString(),
            sessionId: revoked.id,
            status: "revoked",
          }
        : { status: "not_found" }
    } catch {
      return { status: "unavailable" }
    }
  }

  private async denyActivation(
    input: EmergencyRecoveryActivationServiceInput,
    reason: Extract<
      EmergencyRecoveryActivationResult,
      { status: "denied" }
    >["reason"],
    now: Date,
  ): Promise<EmergencyRecoveryActivationResult> {
    try {
      await this.store.recordAudit(
        recoveryAudit({
          action: "emergency_recovery.session.activate",
          correlationId: input.correlationId,
          keycloakSubjectId: input.authentication.keycloakSubjectId,
          occurredAt: now,
          outcome: "denied",
          recoveryReasonCode: input.reasonCode,
        }),
      )
      return { reason, status: "denied" }
    } catch {
      return { status: "unavailable" }
    }
  }
}

export function emergencyRecoveryServiceFromRuntime(
  options: EmergencyRecoveryServiceOptions = {},
): EmergencyRecoveryService | null {
  const database = getInferenceCoreDb()
  return database
    ? new EmergencyRecoveryService(
        new PostgresEmergencyRecoveryStore(database),
        options,
      )
    : null
}

class PostgresEmergencyRecoveryStore implements EmergencyRecoveryStore {
  constructor(private readonly database: InferenceCoreDatabase) {}

  async getFactor(): Promise<StoredEmergencyRecoveryFactor | null> {
    const row = (
      await this.database
        .select()
        .from(emergencyRecoveryFactor)
        .where(eq(emergencyRecoveryFactor.id, factorId))
        .limit(1)
    )[0]
    return row ? storedFactor(row) : null
  }

  async getActiveSession(
    now: Date,
  ): Promise<StoredEmergencyRecoverySession | null> {
    return await this.database.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(0, 52005)`)
      const expired = await transaction
        .update(emergencyRecoverySessions)
        .set({ status: "expired" })
        .where(
          and(
            eq(emergencyRecoverySessions.status, "active"),
            lte(emergencyRecoverySessions.expiresAt, now),
          ),
        )
        .returning()
      for (const row of expired) {
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "emergency_recovery.session.expire",
            correlationId: row.correlationId,
            keycloakSubjectId: row.keycloakSubjectId,
            occurredAt: now,
            outcome: "succeeded",
            recoveryReasonCode: parsedReasonCode(row.reasonCode),
          }),
        )
      }

      const active = (
        await transaction
          .select()
          .from(emergencyRecoverySessions)
          .where(
            and(
              eq(emergencyRecoverySessions.status, "active"),
              gt(emergencyRecoverySessions.expiresAt, now),
            ),
          )
          .limit(1)
      )[0]
      return active ? storedSession(active) : null
    })
  }

  async commission(
    factor: StoredEmergencyRecoveryFactor,
    audit: EmergencyRecoveryAuditInput,
  ): Promise<"already_commissioned" | "commissioned"> {
    return await this.database.transaction(async (transaction) => {
      const inserted = await transaction
        .insert(emergencyRecoveryFactor)
        .values({
          ...factor,
          id: factorId,
        })
        .onConflictDoNothing()
        .returning({ id: emergencyRecoveryFactor.id })

      await transaction
        .insert(auditEvents)
        .values(
          auditValues(
            inserted.length === 1
              ? audit
              : { ...audit, outcome: "denied" as const },
          ),
        )
      return inserted.length === 1 ? "commissioned" : "already_commissioned"
    })
  }

  async activate(
    session: StoredEmergencyRecoverySession,
    audit: EmergencyRecoveryAuditInput,
  ): Promise<"active_session_exists" | StoredEmergencyRecoverySession> {
    return await this.database.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(0, 52005)`)
      const expired = await transaction
        .update(emergencyRecoverySessions)
        .set({ status: "expired" })
        .where(
          and(
            eq(emergencyRecoverySessions.status, "active"),
            lte(emergencyRecoverySessions.expiresAt, session.activatedAt),
          ),
        )
        .returning()
      for (const row of expired) {
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "emergency_recovery.session.expire",
            correlationId: row.correlationId,
            keycloakSubjectId: row.keycloakSubjectId,
            occurredAt: session.activatedAt,
            outcome: "succeeded",
            recoveryReasonCode: parsedReasonCode(row.reasonCode),
          }),
        )
      }

      const active = await transaction
        .select({ id: emergencyRecoverySessions.id })
        .from(emergencyRecoverySessions)
        .where(eq(emergencyRecoverySessions.status, "active"))
        .limit(1)
      if (active.length > 0) {
        await transaction
          .insert(auditEvents)
          .values(auditValues({ ...audit, outcome: "denied" }))
        return "active_session_exists"
      }

      const row = (
        await transaction
          .insert(emergencyRecoverySessions)
          .values(session)
          .returning()
      )[0]
      if (!row) {
        throw new Error("Emergency recovery session was not persisted.")
      }
      await transaction.insert(auditEvents).values(auditValues(audit))
      return storedSession(row)
    })
  }

  async getSession(
    sessionId: string,
  ): Promise<StoredEmergencyRecoverySession | null> {
    const row = (
      await this.database
        .select()
        .from(emergencyRecoverySessions)
        .where(eq(emergencyRecoverySessions.id, sessionId))
        .limit(1)
    )[0]
    return row ? storedSession(row) : null
  }

  async expire(
    sessionId: string,
    now: Date,
  ): Promise<StoredEmergencyRecoverySession | null> {
    return await this.database.transaction(async (transaction) => {
      const row = (
        await transaction
          .update(emergencyRecoverySessions)
          .set({ status: "expired" })
          .where(
            and(
              eq(emergencyRecoverySessions.id, sessionId),
              eq(emergencyRecoverySessions.status, "active"),
              lte(emergencyRecoverySessions.expiresAt, now),
            ),
          )
          .returning()
      )[0]
      if (!row) {
        return null
      }
      await transaction.insert(auditEvents).values(
        auditValues({
          action: "emergency_recovery.session.expire",
          correlationId: row.correlationId,
          keycloakSubjectId: row.keycloakSubjectId,
          occurredAt: now,
          outcome: "succeeded",
          recoveryReasonCode: parsedReasonCode(row.reasonCode),
        }),
      )
      return storedSession(row)
    })
  }

  async revoke(input: {
    allowAny: boolean
    audit: EmergencyRecoveryAuditInput
    now: Date
    requesterSubjectId: string
    sessionId: string
  }): Promise<StoredEmergencyRecoverySession | null> {
    return await this.database.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(0, 52005)`)
      const expired = (
        await transaction
          .update(emergencyRecoverySessions)
          .set({ status: "expired" })
          .where(
            and(
              eq(emergencyRecoverySessions.id, input.sessionId),
              eq(emergencyRecoverySessions.status, "active"),
              lte(emergencyRecoverySessions.expiresAt, input.now),
            ),
          )
          .returning()
      )[0]
      if (expired) {
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "emergency_recovery.session.expire",
            correlationId: expired.correlationId,
            keycloakSubjectId: expired.keycloakSubjectId,
            occurredAt: input.now,
            outcome: "succeeded",
            recoveryReasonCode: parsedReasonCode(expired.reasonCode),
          }),
        )
      }

      const row = (
        await transaction
          .update(emergencyRecoverySessions)
          .set({
            revokedAt: input.now,
            revokedBy: input.requesterSubjectId,
            status: "revoked",
          })
          .where(
            and(
              eq(emergencyRecoverySessions.id, input.sessionId),
              ...(input.allowAny
                ? []
                : [
                    eq(
                      emergencyRecoverySessions.keycloakSubjectId,
                      input.requesterSubjectId,
                    ),
                  ]),
              eq(emergencyRecoverySessions.status, "active"),
              gt(emergencyRecoverySessions.expiresAt, input.now),
            ),
          )
          .returning()
      )[0]
      await transaction.insert(auditEvents).values(
        auditValues(
          row
            ? {
                ...input.audit,
                recoveryReasonCode: parsedReasonCode(row.reasonCode),
              }
            : { ...input.audit, outcome: "denied" },
        ),
      )
      return row ? storedSession(row) : null
    })
  }

  async recordAudit(audit: EmergencyRecoveryAuditInput): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.insert(auditEvents).values(auditValues(audit))
    })
  }
}

function commissionDenial(
  input: EmergencyRecoveryCommissionServiceInput,
  now: Date,
):
  | "identity_disabled"
  | "identity_mismatch"
  | "identity_not_admin"
  | "mfa_required"
  | "recent_authentication_required"
  | null {
  if (!input.liveIdentity.enabled) {
    return "identity_disabled"
  }
  if (input.liveIdentity.role !== "admin") {
    return "identity_not_admin"
  }
  return authenticationDenial(input, now)
}

function activationDenial(
  input: EmergencyRecoveryActivationServiceInput,
  now: Date,
):
  | "identity_disabled"
  | "identity_mismatch"
  | "identity_not_operator"
  | "mfa_required"
  | "recent_authentication_required"
  | null {
  if (!input.liveIdentity.enabled) {
    return "identity_disabled"
  }
  if (input.liveIdentity.role !== "operator") {
    return "identity_not_operator"
  }
  return authenticationDenial(input, now)
}

function authenticationDenial(
  input: {
    authentication: EmergencyRecoveryActivationServiceInput["authentication"]
    liveIdentity: EmergencyRecoveryActivationServiceInput["liveIdentity"]
  },
  now: Date,
):
  | "identity_mismatch"
  | "mfa_required"
  | "recent_authentication_required"
  | null {
  if (
    input.authentication.keycloakSubjectId !==
    input.liveIdentity.keycloakSubjectId
  ) {
    return "identity_mismatch"
  }

  const nowSeconds = Math.floor(now.getTime() / 1000)
  if (
    input.authentication.authTime > nowSeconds ||
    nowSeconds - input.authentication.authTime >
      recentAuthenticationWindowSeconds
  ) {
    return "recent_authentication_required"
  }

  const approvedMfa = new Set<string>(emergencyRecoveryApprovedMfaMethods)
  if (!input.authentication.amr.some((method) => approvedMfa.has(method))) {
    return "mfa_required"
  }
  return null
}

async function factorMatches(
  candidate: string,
  factor: StoredEmergencyRecoveryFactor,
): Promise<boolean> {
  if (!storedFactorParametersAreSupported(factor)) {
    throw new Error("Unsupported emergency recovery verifier parameters.")
  }
  const candidateHash = Buffer.from(
    await deriveFactor(candidate, factor.salt),
    "hex",
  )
  const storedHash = Buffer.from(factor.verifierHash, "hex")
  try {
    return (
      candidateHash.length === storedHash.length &&
      timingSafeEqual(candidateHash, storedHash)
    )
  } finally {
    candidateHash.fill(0)
    storedHash.fill(0)
  }
}

function deriveFactor(value: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(
      value,
      Buffer.from(salt, "hex"),
      scryptParameters.keyLength,
      {
        blockSize: scryptParameters.blockSize,
        cost: scryptParameters.cost,
        maxmem: scryptParameters.maxMemory,
        parallelization: scryptParameters.parallelization,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error)
          return
        }
        const buffer = Buffer.from(derivedKey)
        try {
          resolve(buffer.toString("hex"))
        } finally {
          buffer.fill(0)
        }
      },
    )
  })
}

function storedFactorParametersAreSupported(
  factor: StoredEmergencyRecoveryFactor,
): boolean {
  return (
    factor.algorithm === scryptParameters.algorithm &&
    factor.blockSize === scryptParameters.blockSize &&
    factor.cost === scryptParameters.cost &&
    factor.keyLength === scryptParameters.keyLength &&
    factor.maxMemory === scryptParameters.maxMemory &&
    factor.parallelization === scryptParameters.parallelization &&
    /^[0-9a-f]{32}$/.test(factor.salt) &&
    /^[0-9a-f]{64}$/.test(factor.verifierHash)
  )
}

function toGrant(
  session: StoredEmergencyRecoverySession,
): EmergencyRecoveryGrant {
  const reasonCode = emergencyRecoveryReasonCodeSchema.parse(session.reasonCode)
  return {
    activatedAt: session.activatedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    keycloakSubjectId: session.keycloakSubjectId,
    nativeExpertAccess: false,
    reasonCode,
    scope: "console_admin_capabilities",
    sessionId: session.id,
  }
}

function recoveryAudit(
  input: EmergencyRecoveryAuditInput,
): EmergencyRecoveryAuditInput {
  return input
}

function auditValues(audit: EmergencyRecoveryAuditInput) {
  return {
    action: audit.action,
    applicationId: null,
    correlationId: audit.correlationId,
    credentialPrefix: null,
    credentialRecordId: null,
    id: randomUUID(),
    keycloakSubjectId: audit.keycloakSubjectId,
    occurredAt: audit.occurredAt,
    outcome: audit.outcome,
    recoveryReasonCode: audit.recoveryReasonCode ?? null,
    sourceSystem: "console",
  }
}

function storedFactor(
  row: typeof emergencyRecoveryFactor.$inferSelect,
): StoredEmergencyRecoveryFactor {
  return {
    algorithm: row.algorithm,
    blockSize: row.blockSize,
    commissionedAt: row.commissionedAt,
    commissionedBy: row.commissionedBy,
    cost: row.cost,
    keyLength: row.keyLength,
    maxMemory: row.maxMemory,
    parallelization: row.parallelization,
    salt: row.salt,
    verifierHash: row.verifierHash,
  }
}

function storedSession(
  row: typeof emergencyRecoverySessions.$inferSelect,
): StoredEmergencyRecoverySession {
  const status =
    row.status === "active" ||
    row.status === "expired" ||
    row.status === "revoked"
      ? row.status
      : "expired"
  return {
    activatedAt: row.activatedAt,
    correlationId: row.correlationId,
    expiresAt: row.expiresAt,
    id: row.id,
    keycloakSubjectId: row.keycloakSubjectId,
    reasonCode: row.reasonCode,
    revokedAt: row.revokedAt,
    revokedBy: row.revokedBy,
    status,
  }
}

function parsedReasonCode(
  value: string,
): EmergencyRecoveryReasonCode | undefined {
  const parsed = emergencyRecoveryReasonCodeSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

function validSubject(value: string): boolean {
  return value.length >= 1 && value.length <= 255
}

function validCorrelationId(value: string): boolean {
  return value.length >= 1 && value.length <= 128
}
