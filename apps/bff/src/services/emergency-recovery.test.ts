import type {
  EmergencyRecoveryActivationServiceInput,
  EmergencyRecoveryCommissionServiceInput,
} from "@llm-machines/contracts/inference-core"
import { describe, expect, it, vi } from "vitest"
import {
  type EmergencyRecoveryAuditInput,
  EmergencyRecoveryService,
  type EmergencyRecoveryStore,
  type StoredEmergencyRecoveryFactor,
  type StoredEmergencyRecoverySession,
} from "./emergency-recovery"

const operatorSubject = "operator-1"
const adminSubject = "admin-1"
const fixedSessionId = "01234567-89ab-4def-8123-456789abcdef"

describe("emergency recovery", () => {
  it("commissions one appliance factor and persists only its scrypt verifier", async () => {
    const fixture = fixtureService()
    const result = await fixture.service.commission(
      commissionInput(fixture.now),
    )

    expect(result.status).toBe("commissioned")
    if (result.status !== "commissioned") {
      throw new Error("Expected a commissioned recovery factor.")
    }
    expect(result.recoveryFactor).toMatch(/^llmr1_[A-Za-z0-9_-]{43}$/)
    expect(fixture.store.factor).toMatchObject({
      algorithm: "scrypt",
      blockSize: 8,
      commissionedBy: adminSubject,
      cost: 16_384,
      keyLength: 32,
      maxMemory: 67_108_864,
      parallelization: 1,
      salt: expect.stringMatching(/^[0-9a-f]{32}$/),
      verifierHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(JSON.stringify(fixture.store)).not.toContain(result.recoveryFactor)

    await expect(
      fixture.service.commission(commissionInput(fixture.now)),
    ).resolves.toEqual({ status: "already_commissioned" })
    expect(fixture.store.audits.map((audit) => audit.outcome)).toEqual([
      "succeeded",
      "denied",
    ])
  })

  it("requires a live enabled Operator, matching subject, and recent MFA AMR", async () => {
    const fixture = fixtureService()
    const factor = await commissionedFactor(fixture)

    await expect(
      fixture.service.activate(
        activationInput(fixture.now, factor, {
          acr: "urn:llm-machines:mfa",
          amr: ["pwd"],
        }),
      ),
    ).resolves.toEqual({ reason: "mfa_required", status: "denied" })

    await expect(
      fixture.service.activate(
        activationInput(fixture.now, factor, {
          authTime: unixSeconds(fixture.now) - 301,
        }),
      ),
    ).resolves.toEqual({
      reason: "recent_authentication_required",
      status: "denied",
    })

    await expect(
      fixture.service.activate(
        activationInput(fixture.now, factor, {
          liveIdentity: {
            enabled: false,
            keycloakSubjectId: operatorSubject,
            role: "operator",
          },
        }),
      ),
    ).resolves.toEqual({
      reason: "identity_disabled",
      status: "denied",
    })

    await expect(
      fixture.service.activate(
        activationInput(fixture.now, factor, {
          liveIdentity: {
            enabled: true,
            keycloakSubjectId: operatorSubject,
            role: "admin",
          },
        }),
      ),
    ).resolves.toEqual({
      reason: "identity_not_operator",
      status: "denied",
    })

    await expect(
      fixture.service.activate(
        activationInput(fixture.now, factor, {
          liveIdentity: {
            enabled: true,
            keycloakSubjectId: "operator-2",
            role: "operator",
          },
        }),
      ),
    ).resolves.toEqual({
      reason: "identity_mismatch",
      status: "denied",
    })
  })

  it("activates one fixed 15-minute Console-only grant and never extends it", async () => {
    const fixture = fixtureService()
    const factor = await commissionedFactor(fixture)
    const result = await fixture.service.activate(
      activationInput(fixture.now, factor),
    )

    expect(result).toEqual({
      grant: {
        activatedAt: "2026-07-31T12:00:00.000Z",
        expiresAt: "2026-07-31T12:15:00.000Z",
        keycloakSubjectId: operatorSubject,
        reasonCode: "admin_lockout",
        scope: "console_admin_capabilities",
        sessionId: fixedSessionId,
      },
      status: "activated",
    })
    await expect(
      fixture.service.resolve(fixedSessionId, operatorSubject),
    ).resolves.toMatchObject({ status: "active" })

    fixture.setNow("2026-07-31T12:14:59.999Z")
    const beforeExpiry = await fixture.service.resolve(
      fixedSessionId,
      operatorSubject,
    )
    expect(beforeExpiry).toMatchObject({
      grant: { expiresAt: "2026-07-31T12:15:00.000Z" },
      status: "active",
    })

    fixture.setNow("2026-07-31T12:15:00.000Z")
    await expect(
      fixture.service.resolve(fixedSessionId, operatorSubject),
    ).resolves.toEqual({ status: "inactive" })
    expect(fixture.store.sessions.get(fixedSessionId)?.status).toBe("expired")
    expect(
      fixture.store.audits.some(
        (audit) => audit.action === "emergency_recovery.session.expire",
      ),
    ).toBe(true)
  })

  it("returns only commissioned metadata and the unexpired active grant", async () => {
    const fixture = fixtureService()
    const factor = await commissionedFactor(fixture)
    await fixture.service.activate(activationInput(fixture.now, factor))

    const status = await fixture.service.status()
    expect(status).toMatchObject({
      activeGrant: {
        keycloakSubjectId: operatorSubject,
        sessionId: fixedSessionId,
      },
      factor: {
        commissionedAt: "2026-07-31T12:00:00.000Z",
        commissionedBy: adminSubject,
      },
      status: "ok",
    })
    expect(JSON.stringify(status)).not.toContain(factor)
    expect(JSON.stringify(status)).not.toMatch(/verifier|salt|scrypt/i)

    fixture.setNow("2026-07-31T12:15:00.000Z")
    await expect(fixture.service.status()).resolves.toMatchObject({
      activeGrant: null,
      status: "ok",
    })
    expect(fixture.store.sessions.get(fixedSessionId)?.status).toBe("expired")
  })

  it("fails the status projection closed when durable state is unavailable", async () => {
    const fixture = fixtureService()
    vi.spyOn(fixture.store, "getActiveSession").mockRejectedValueOnce(
      new Error("private-database-error"),
    )

    await expect(fixture.service.status()).resolves.toEqual({
      status: "unavailable",
    })
  })

  it("enforces one active session across Operators", async () => {
    const fixture = fixtureService()
    const factor = await commissionedFactor(fixture)
    await expect(
      fixture.service.activate(activationInput(fixture.now, factor)),
    ).resolves.toMatchObject({ status: "activated" })

    await expect(
      fixture.service.activate(
        activationInput(fixture.now, factor, {
          authenticationSubject: "operator-2",
          liveIdentity: {
            enabled: true,
            keycloakSubjectId: "operator-2",
            role: "operator",
          },
        }),
      ),
    ).resolves.toEqual({ status: "active_session_exists" })
    expect(
      fixture.store.audits.filter(
        (audit) => audit.action === "emergency_recovery.session.activate",
      ),
    ).toHaveLength(2)
  })

  it("rejects a wrong factor with a metadata-only audit", async () => {
    const fixture = fixtureService()
    const factor = await commissionedFactor(fixture)
    const wrongFactor = `${factor.slice(0, -1)}${factor.endsWith("A") ? "B" : "A"}`

    await expect(
      fixture.service.activate(activationInput(fixture.now, wrongFactor)),
    ).resolves.toEqual({ reason: "invalid_factor", status: "denied" })
    const lastAudit = fixture.store.audits.at(-1)
    expect(lastAudit).toMatchObject({
      action: "emergency_recovery.session.activate",
      keycloakSubjectId: operatorSubject,
      outcome: "denied",
      recoveryReasonCode: "admin_lockout",
    })
    expect(JSON.stringify(lastAudit)).not.toContain(wrongFactor)
  })

  it("admits one activation verifier and rejects a parallel flood without queueing", async () => {
    const fixture = fixtureService()
    const factor = await commissionedFactor(fixture)
    const storedFactor = fixture.store.factor
    if (!storedFactor) {
      throw new Error("Expected a persisted recovery factor.")
    }
    const persistedFactor = cloneFactor(storedFactor)
    const factorReadStarted = deferred<void>()
    const releaseFactorRead = deferred<StoredEmergencyRecoveryFactor | null>()
    const getFactor = vi
      .spyOn(fixture.store, "getFactor")
      .mockImplementationOnce(async () => {
        factorReadStarted.resolve(undefined)
        return await releaseFactorRead.promise
      })

    const admitted = fixture.service.activate(
      activationInput(fixture.now, factor),
    )
    await factorReadStarted.promise
    const rejected = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        fixture.service.activate(
          activationInput(fixture.now, factor, {
            authenticationSubject: `operator-${index + 2}`,
          }),
        ),
      ),
    )

    expect(rejected).toEqual(
      Array.from({ length: 12 }, () => ({
        retryAfterSeconds: 1,
        status: "rate_limited",
      })),
    )
    expect(getFactor).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(rejected)).not.toContain(factor)

    releaseFactorRead.resolve(persistedFactor)
    await expect(admitted).resolves.toMatchObject({ status: "activated" })
  })

  it("admits five attempts per subject and rate-limits the sixth", async () => {
    const fixture = fixtureService()
    const factor = await commissionedFactor(fixture)
    const wrongFactor = differentFactor(factor)
    const getFactor = vi.spyOn(fixture.store, "getFactor")

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        fixture.service.activate(activationInput(fixture.now, wrongFactor)),
      ).resolves.toEqual({ reason: "invalid_factor", status: "denied" })
    }

    const sixth = await fixture.service.activate(
      activationInput(fixture.now, wrongFactor),
    )
    expect(sixth).toEqual({
      retryAfterSeconds: 60,
      status: "rate_limited",
    })
    expect(getFactor).toHaveBeenCalledTimes(5)
    expect(JSON.stringify(sixth)).not.toContain(wrongFactor)

    await expect(
      fixture.service.activate(
        activationInput(fixture.now, wrongFactor, {
          authenticationSubject: "operator-2",
        }),
      ),
    ).resolves.toEqual({ reason: "invalid_factor", status: "denied" })
  })

  it("resets the per-subject attempt window after 60 seconds", async () => {
    const fixture = fixtureService()
    const factor = `llmr1_${"A".repeat(43)}`

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        fixture.service.activate(activationInput(fixture.now, factor)),
      ).resolves.toEqual({ status: "not_commissioned" })
    }
    await expect(
      fixture.service.activate(activationInput(fixture.now, factor)),
    ).resolves.toEqual({
      retryAfterSeconds: 60,
      status: "rate_limited",
    })

    fixture.setNow("2026-07-31T12:01:00.000Z")
    await expect(
      fixture.service.activate(activationInput(fixture.now, factor)),
    ).resolves.toEqual({ status: "not_commissioned" })
  })

  it("releases the activation verifier after factor mismatch and store error", async () => {
    const fixture = fixtureService()
    const factor = await commissionedFactor(fixture)
    const wrongFactor = differentFactor(factor)
    vi.spyOn(fixture.store, "getFactor").mockRejectedValueOnce(
      new Error("private-store-error"),
    )

    await expect(
      fixture.service.activate(activationInput(fixture.now, factor)),
    ).resolves.toEqual({ status: "unavailable" })
    await expect(
      fixture.service.activate(activationInput(fixture.now, wrongFactor)),
    ).resolves.toEqual({ reason: "invalid_factor", status: "denied" })
    await expect(
      fixture.service.activate(activationInput(fixture.now, factor)),
    ).resolves.toMatchObject({ status: "activated" })
  })

  it("bounds and prunes per-subject attempt-window state", async () => {
    const fixture = fixtureService()
    const factor = `llmr1_${"A".repeat(43)}`

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await fixture.service.activate(activationInput(fixture.now, factor))
    }
    await expect(
      fixture.service.activate(activationInput(fixture.now, factor)),
    ).resolves.toMatchObject({ status: "rate_limited" })

    for (let subject = 2; subject <= 1025; subject += 1) {
      await fixture.service.activate(
        activationInput(fixture.now, factor, {
          authenticationSubject: `operator-${subject}`,
        }),
      )
    }

    await expect(
      fixture.service.activate(activationInput(fixture.now, factor)),
    ).resolves.toEqual({ status: "not_commissioned" })
  })

  it("binds explicit revocation to the active Operator subject", async () => {
    const fixture = fixtureService()
    const factor = await commissionedFactor(fixture)
    await fixture.service.activate(activationInput(fixture.now, factor))

    await expect(
      fixture.service.revoke({
        allowAny: false,
        correlationId: "revoke-other",
        requesterSubjectId: "operator-2",
        sessionId: fixedSessionId,
      }),
    ).resolves.toEqual({ status: "not_found" })

    fixture.setNow("2026-07-31T12:05:00.000Z")
    await expect(
      fixture.service.revoke({
        allowAny: false,
        correlationId: "revoke-owner",
        requesterSubjectId: operatorSubject,
        sessionId: fixedSessionId,
      }),
    ).resolves.toEqual({
      revokedAt: "2026-07-31T12:05:00.000Z",
      sessionId: fixedSessionId,
      status: "revoked",
    })
    await expect(
      fixture.service.resolve(fixedSessionId, operatorSubject),
    ).resolves.toEqual({ status: "inactive" })
  })

  it("allows a server-authorized standing Admin to revoke the active grant", async () => {
    const fixture = fixtureService()
    const factor = await commissionedFactor(fixture)
    await fixture.service.activate(activationInput(fixture.now, factor))
    fixture.setNow("2026-07-31T12:05:00.000Z")

    await expect(
      fixture.service.revoke({
        allowAny: true,
        correlationId: "admin-revoke",
        requesterSubjectId: adminSubject,
        sessionId: fixedSessionId,
      }),
    ).resolves.toMatchObject({ status: "revoked" })
    expect(fixture.store.sessions.get(fixedSessionId)?.revokedBy).toBe(
      adminSubject,
    )
    expect(fixture.store.audits.at(-1)).toMatchObject({
      action: "emergency_recovery.session.revoke",
      keycloakSubjectId: adminSubject,
      outcome: "succeeded",
    })
  })
})

class InMemoryEmergencyRecoveryStore implements EmergencyRecoveryStore {
  audits: EmergencyRecoveryAuditInput[] = []
  factor: StoredEmergencyRecoveryFactor | null = null
  sessions = new Map<string, StoredEmergencyRecoverySession>()

  async commission(
    factor: StoredEmergencyRecoveryFactor,
    audit: EmergencyRecoveryAuditInput,
  ): Promise<"already_commissioned" | "commissioned"> {
    if (this.factor) {
      this.audits.push({ ...audit, outcome: "denied" })
      return "already_commissioned"
    }
    this.factor = cloneFactor(factor)
    this.audits.push({ ...audit })
    return "commissioned"
  }

  async getFactor(): Promise<StoredEmergencyRecoveryFactor | null> {
    return this.factor ? cloneFactor(this.factor) : null
  }

  async getActiveSession(
    now: Date,
  ): Promise<StoredEmergencyRecoverySession | null> {
    for (const session of this.sessions.values()) {
      if (
        session.status === "active" &&
        session.expiresAt.getTime() <= now.getTime()
      ) {
        await this.expire(session.id, now)
      }
    }
    const active = [...this.sessions.values()].find(
      (session) =>
        session.status === "active" &&
        session.expiresAt.getTime() > now.getTime(),
    )
    return active ? cloneSession(active) : null
  }

  async activate(
    session: StoredEmergencyRecoverySession,
    audit: EmergencyRecoveryAuditInput,
  ): Promise<"active_session_exists" | StoredEmergencyRecoverySession> {
    for (const candidate of this.sessions.values()) {
      if (
        candidate.status === "active" &&
        candidate.expiresAt.getTime() <= session.activatedAt.getTime()
      ) {
        candidate.status = "expired"
        this.audits.push({
          action: "emergency_recovery.session.expire",
          correlationId: candidate.correlationId,
          keycloakSubjectId: candidate.keycloakSubjectId,
          occurredAt: new Date(session.activatedAt),
          outcome: "succeeded",
          recoveryReasonCode:
            candidate.reasonCode as EmergencyRecoveryAuditInput["recoveryReasonCode"],
        })
      }
    }
    if ([...this.sessions.values()].some((row) => row.status === "active")) {
      this.audits.push({ ...audit, outcome: "denied" })
      return "active_session_exists"
    }
    const saved = cloneSession(session)
    this.sessions.set(saved.id, saved)
    this.audits.push({ ...audit })
    return cloneSession(saved)
  }

  async getSession(
    sessionId: string,
  ): Promise<StoredEmergencyRecoverySession | null> {
    const session = this.sessions.get(sessionId)
    return session ? cloneSession(session) : null
  }

  async expire(
    sessionId: string,
    now: Date,
  ): Promise<StoredEmergencyRecoverySession | null> {
    const session = this.sessions.get(sessionId)
    if (
      !session ||
      session.status !== "active" ||
      session.expiresAt.getTime() > now.getTime()
    ) {
      return null
    }
    session.status = "expired"
    this.audits.push({
      action: "emergency_recovery.session.expire",
      correlationId: session.correlationId,
      keycloakSubjectId: session.keycloakSubjectId,
      occurredAt: new Date(now),
      outcome: "succeeded",
      recoveryReasonCode:
        session.reasonCode as EmergencyRecoveryAuditInput["recoveryReasonCode"],
    })
    return cloneSession(session)
  }

  async revoke(input: {
    allowAny: boolean
    audit: EmergencyRecoveryAuditInput
    now: Date
    requesterSubjectId: string
    sessionId: string
  }): Promise<StoredEmergencyRecoverySession | null> {
    const session = this.sessions.get(input.sessionId)
    if (
      !session ||
      (!input.allowAny &&
        session.keycloakSubjectId !== input.requesterSubjectId) ||
      session.status !== "active" ||
      session.expiresAt.getTime() <= input.now.getTime()
    ) {
      this.audits.push({ ...input.audit, outcome: "denied" })
      return null
    }
    session.revokedAt = new Date(input.now)
    session.revokedBy = input.requesterSubjectId
    session.status = "revoked"
    this.audits.push({
      ...input.audit,
      recoveryReasonCode:
        session.reasonCode as EmergencyRecoveryAuditInput["recoveryReasonCode"],
    })
    return cloneSession(session)
  }

  async recordAudit(audit: EmergencyRecoveryAuditInput): Promise<void> {
    this.audits.push({ ...audit, occurredAt: new Date(audit.occurredAt) })
  }
}

function fixtureService() {
  let now = new Date("2026-07-31T12:00:00.000Z")
  const store = new InMemoryEmergencyRecoveryStore()
  const service = new EmergencyRecoveryService(store, {
    now: () => new Date(now),
    randomBytes: (size) => Buffer.alloc(size, size === 32 ? 0x11 : 0x22),
    randomId: () => fixedSessionId,
  })
  return {
    get now() {
      return new Date(now)
    },
    service,
    setNow(value: string) {
      now = new Date(value)
    },
    store,
  }
}

async function commissionedFactor(
  fixture: ReturnType<typeof fixtureService>,
): Promise<string> {
  const result = await fixture.service.commission(commissionInput(fixture.now))
  if (result.status !== "commissioned") {
    throw new Error("Expected recovery factor commissioning to succeed.")
  }
  return result.recoveryFactor
}

function commissionInput(now: Date): EmergencyRecoveryCommissionServiceInput {
  return {
    authentication: {
      acr: "urn:llm-machines:mfa",
      amr: ["pwd", "otp"],
      authTime: unixSeconds(now) - 30,
      keycloakSubjectId: adminSubject,
    },
    correlationId: "commission-1",
    liveIdentity: {
      enabled: true,
      keycloakSubjectId: adminSubject,
      role: "admin",
    },
  }
}

function activationInput(
  now: Date,
  factor: string,
  overrides: {
    acr?: string
    amr?: string[]
    authenticationSubject?: string
    authTime?: number
    liveIdentity?: EmergencyRecoveryActivationServiceInput["liveIdentity"]
  } = {},
): EmergencyRecoveryActivationServiceInput {
  const authenticationSubject =
    overrides.authenticationSubject ?? operatorSubject
  return {
    authentication: {
      acr: overrides.acr,
      amr: overrides.amr ?? ["pwd", "webauthn"],
      authTime: overrides.authTime ?? unixSeconds(now) - 30,
      keycloakSubjectId: authenticationSubject,
    },
    correlationId: "activate-1",
    factor,
    liveIdentity: overrides.liveIdentity ?? {
      enabled: true,
      keycloakSubjectId: authenticationSubject,
      role: "operator",
    },
    reasonCode: "admin_lockout",
  }
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

function cloneFactor(
  factor: StoredEmergencyRecoveryFactor,
): StoredEmergencyRecoveryFactor {
  return { ...factor, commissionedAt: new Date(factor.commissionedAt) }
}

function cloneSession(
  session: StoredEmergencyRecoverySession,
): StoredEmergencyRecoverySession {
  return {
    ...session,
    activatedAt: new Date(session.activatedAt),
    expiresAt: new Date(session.expiresAt),
    revokedAt: session.revokedAt ? new Date(session.revokedAt) : null,
  }
}

function differentFactor(factor: string): string {
  return `${factor.slice(0, -1)}${factor.endsWith("A") ? "B" : "A"}`
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}
