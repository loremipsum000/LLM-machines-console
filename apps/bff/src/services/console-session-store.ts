import { timingSafeEqual } from "node:crypto"

export type ConsoleSessionRole = "admin" | "operator"
export type ConsoleSessionRefreshUnavailableReason =
  | "identity_restart"
  | "identity_timeout"
  | "identity_unavailable"

export interface ConsoleLoginRecord {
  createdAt: Date
  encryptedPayload: string
  encryptionKid: string
  expiresAt: Date
  handleDigest: string
  stateDigest: string
  subjectDigest: string | null
}

export interface ConsoleSessionRecord {
  absoluteExpiresAt: Date
  accessExpiresAt: Date
  createdAt: Date
  encryptedPayload: string
  encryptionKid: string
  handleDigest: string
  idleExpiresAt: Date
  keycloakSessionDigest: string | null
  lastSeenAt: Date
  refreshBlockedUntil: Date | null
  refreshFailureReason: ConsoleSessionRefreshUnavailableReason | null
  refreshGeneration: number
  subjectDigest: string
  updatedAt: Date
}

export interface LockedSessionResult<T> {
  record: ConsoleSessionRecord | null
  value: T
}

export interface ConsoleSessionRepository {
  consumeLogin(
    handleDigest: string,
    stateDigest: string,
    now: Date,
  ): Promise<ConsoleLoginRecord | null>
  consumeLogoutAndRevoke(input: {
    jtiDigest: string
    keycloakSessionDigest?: string
    now: Date
    retainUntil: Date
    subjectDigest?: string
  }): Promise<number>
  insertLogin(record: ConsoleLoginRecord): Promise<void>
  insertSession(record: ConsoleSessionRecord): Promise<void>
  withLockedSession<T>(
    handleDigest: string,
    work: (
      record: ConsoleSessionRecord | null,
    ) => Promise<LockedSessionResult<T>>,
  ): Promise<T>
}

export class TestOnlyInMemoryConsoleSessionRepository
  implements ConsoleSessionRepository
{
  readonly loginRecords = new Map<string, ConsoleLoginRecord>()
  readonly logoutTokenReplays = new Map<string, Date>()
  readonly sessionRecords = new Map<string, ConsoleSessionRecord>()
  private readonly locks = new Map<string, Promise<void>>()

  async consumeLogin(
    handleDigest: string,
    stateDigest: string,
    now: Date,
  ): Promise<ConsoleLoginRecord | null> {
    return this.withLock(`login:${handleDigest}`, async () => {
      const record = this.loginRecords.get(handleDigest)
      this.loginRecords.delete(handleDigest)
      if (
        !record ||
        !safeDigestEqual(record.stateDigest, stateDigest) ||
        record.expiresAt <= now
      ) {
        return null
      }
      return cloneLogin(record)
    })
  }

  async consumeLogoutAndRevoke(input: {
    jtiDigest: string
    keycloakSessionDigest?: string
    now: Date
    retainUntil: Date
    subjectDigest?: string
  }): Promise<number> {
    return this.withLock("backchannel-logout", async () => {
      for (const [digest, retainUntil] of this.logoutTokenReplays) {
        if (retainUntil <= input.now) {
          this.logoutTokenReplays.delete(digest)
        }
      }
      if (
        input.retainUntil <= input.now ||
        this.logoutTokenReplays.has(input.jtiDigest)
      ) {
        return 0
      }
      this.logoutTokenReplays.set(input.jtiDigest, new Date(input.retainUntil))
      let count = 0
      for (const [handle, record] of this.sessionRecords) {
        const matches = input.keycloakSessionDigest
          ? record.keycloakSessionDigest === input.keycloakSessionDigest
          : Boolean(
              input.subjectDigest &&
                record.subjectDigest === input.subjectDigest,
            )
        if (matches) {
          this.sessionRecords.delete(handle)
          count += 1
        }
      }
      return count
    })
  }

  async insertLogin(record: ConsoleLoginRecord): Promise<void> {
    if (this.loginRecords.has(record.handleDigest)) {
      throw new Error("Duplicate Console login handle.")
    }
    this.loginRecords.set(record.handleDigest, cloneLogin(record))
  }

  async insertSession(record: ConsoleSessionRecord): Promise<void> {
    if (this.sessionRecords.has(record.handleDigest)) {
      throw new Error("Duplicate Console session handle.")
    }
    this.sessionRecords.set(record.handleDigest, cloneSession(record))
  }

  async withLockedSession<T>(
    handleDigest: string,
    work: (
      record: ConsoleSessionRecord | null,
    ) => Promise<LockedSessionResult<T>>,
  ): Promise<T> {
    return this.withLock(`session:${handleDigest}`, async () => {
      const current = this.sessionRecords.get(handleDigest)
      const result = await work(current ? cloneSession(current) : null)
      if (result.record) {
        this.sessionRecords.set(handleDigest, cloneSession(result.record))
      } else {
        this.sessionRecords.delete(handleDigest)
      }
      return result.value
    })
  }

  private async withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve()
    let release: () => void = () => {}
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => current)
    this.locks.set(key, queued)
    await previous
    try {
      return await work()
    } finally {
      release()
      if (this.locks.get(key) === queued) {
        this.locks.delete(key)
      }
    }
  }
}

function safeDigestEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex")
  const b = Buffer.from(right, "hex")
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b)
}

function cloneLogin(record: ConsoleLoginRecord): ConsoleLoginRecord {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    expiresAt: new Date(record.expiresAt),
  }
}

function cloneSession(record: ConsoleSessionRecord): ConsoleSessionRecord {
  return {
    ...record,
    absoluteExpiresAt: new Date(record.absoluteExpiresAt),
    accessExpiresAt: new Date(record.accessExpiresAt),
    createdAt: new Date(record.createdAt),
    idleExpiresAt: new Date(record.idleExpiresAt),
    lastSeenAt: new Date(record.lastSeenAt),
    refreshBlockedUntil: record.refreshBlockedUntil
      ? new Date(record.refreshBlockedUntil)
      : null,
    updatedAt: new Date(record.updatedAt),
  }
}
