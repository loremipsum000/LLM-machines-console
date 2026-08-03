import { randomBytes } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { createConsoleSessionCipher } from "../auth/console-session-crypto"
import type {
  ConsoleOidcClient,
  ConsoleOidcTokenResult,
  ConsoleOidcTokenSet,
} from "./console-session-oidc"
import {
  ConsoleSessionService,
  type ConsoleTokenValidation,
  type ConsoleTokenValidator,
  normalizeConsoleReturnPath,
} from "./console-session-service"
import { TestOnlyInMemoryConsoleSessionRepository } from "./console-session-store"

describe("opaque server-side Console sessions", () => {
  it("uses PKCE S256 and expires a login transaction at exactly 120 seconds", async () => {
    const fixture = createFixture()
    const login = await fixture.service.beginLogin("/applications?tab=keys")
    const [persistedLogin] = fixture.repository.loginRecords.values()
    if (!persistedLogin) {
      throw new Error("Expected a persisted login transaction.")
    }
    expect(JSON.stringify(persistedLogin)).not.toContain(
      "/applications?tab=keys",
    )
    expect(fixture.oidc.authorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        codeChallenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        state: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      }),
    )
    fixture.advance(120_000)

    await expect(
      fixture.service.completeLogin({
        code: "authorization-code",
        loginHandle: login.loginHandle,
        state: fixture.lastState(),
      }),
    ).resolves.toEqual({ reason: "invalid", state: "terminal" })
    expect(fixture.oidc.exchangeCode).not.toHaveBeenCalled()
  })

  it("keeps access and refresh tokens only in an authenticated encrypted record", async () => {
    const fixture = createFixture()
    const session = await fixture.login()
    const [record] = fixture.repository.sessionRecords.values()

    expect(session.sessionHandle).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(record?.encryptedPayload).not.toContain("access-1")
    expect(record?.encryptedPayload).not.toContain("refresh-1")
    expect(JSON.stringify(record)).not.toMatch(
      /operator@example\.test|Operations|operator-1|keycloak-session-1/,
    )
    await expect(
      fixture.service.resolve(session.sessionHandle),
    ).resolves.toMatchObject({
      session: { accessToken: "access-1", role: "operator" },
      state: "active",
    })
  })

  it("burns a login transaction after a state mismatch", async () => {
    const fixture = createFixture()
    const login = await fixture.service.beginLogin("/applications")

    await expect(
      fixture.service.completeLogin({
        code: "authorization-code",
        loginHandle: login.loginHandle,
        state: "wrong-state",
      }),
    ).resolves.toEqual({ reason: "invalid", state: "terminal" })
    await expect(
      fixture.service.completeLogin({
        code: "authorization-code",
        loginHandle: login.loginHandle,
        state: fixture.lastState(),
      }),
    ).resolves.toEqual({ reason: "invalid", state: "terminal" })
    expect(fixture.oidc.exchangeCode).not.toHaveBeenCalled()
    expect(fixture.repository.loginRecords.size).toBe(0)
  })

  it("rejects Admin login without MFA and offline browser authority", async () => {
    for (const identity of [
      fixtureIdentity({ role: "admin" }),
      fixtureIdentity({ offlineAccess: true }),
    ]) {
      const fixture = createFixture({ identity })
      const login = await fixture.service.beginLogin("/")
      await expect(
        fixture.service.completeLogin({
          code: "authorization-code",
          loginHandle: login.loginHandle,
          state: fixture.lastState(),
        }),
      ).resolves.toMatchObject({ reason: "invalid", state: "terminal" })
    }
  })

  it("expires idle and maximum sessions and clears their encrypted authority", async () => {
    for (const advanceMs of [30 * 60 * 1000, 8 * 60 * 60 * 1000]) {
      const fixture = createFixture()
      const session = await fixture.login()
      fixture.advance(advanceMs)

      await expect(
        fixture.service.resolve(session.sessionHandle),
      ).resolves.toEqual({
        reason: "expired",
        state: "terminal",
      })
      expect(fixture.repository.sessionRecords.size).toBe(0)
    }
  })

  it("serializes one-time refresh across concurrent requests and browser tabs", async () => {
    const fixture = createFixture()
    const session = await fixture.login()
    fixture.advance(4 * 60 * 1000 + 1)
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    fixture.oidc.refresh.mockImplementationOnce(async () => {
      await gate
      return { state: "ok", tokens: fixture.tokens("2") }
    })

    const tabs = Array.from({ length: 20 }, () =>
      fixture.service.resolve(session.sessionHandle),
    )
    release()
    const results = await Promise.all(tabs)

    expect(fixture.oidc.refresh).toHaveBeenCalledTimes(1)
    expect(results).toHaveLength(20)
    expect(results.every((result) => result.state === "active")).toBe(true)
    const [record] = fixture.repository.sessionRecords.values()
    expect(record?.refreshGeneration).toBe(1)
  })

  it("refreshes inside the 60-second clock-skew window", async () => {
    const fixture = createFixture()
    const session = await fixture.login()
    fixture.advance(4 * 60 * 1000 + 1)
    fixture.oidc.refresh.mockResolvedValueOnce({
      state: "ok",
      tokens: fixture.tokens("2"),
    })

    await expect(
      fixture.service.resolve(session.sessionHandle),
    ).resolves.toMatchObject({
      refreshCount: 1,
      session: { accessToken: "access-2" },
      state: "active",
    })
  })

  it.each(["identity_restart", "identity_unavailable"] as const)(
    "preserves the local session during retryable %s",
    async (reason) => {
      const fixture = createFixture()
      const session = await fixture.login()
      fixture.advance(4 * 60 * 1000 + 1)
      fixture.oidc.refresh.mockResolvedValueOnce({
        reason,
        state: "unavailable",
      })

      await expect(
        fixture.service.resolve(session.sessionHandle),
      ).resolves.toEqual({
        reason,
        retryable: true,
        state: "unavailable",
      })
      expect(fixture.repository.sessionRecords.size).toBe(1)
      expect(fixture.telemetry).toHaveBeenCalledWith({
        event: "console_session.refresh_failed",
        reason,
        sessionReference: expect.stringMatching(/^[a-f0-9]{12}$/),
      })
    },
  )

  it("does not consume a one-time refresh token when validator readiness is unavailable", async () => {
    const fixture = createFixture()
    const session = await fixture.login()
    fixture.advance(4 * 60 * 1000 + 1)
    fixture.validator.readiness.mockResolvedValueOnce({
      reason: "identity_restart",
      state: "unavailable",
    })

    await expect(
      fixture.service.resolve(session.sessionHandle),
    ).resolves.toEqual({
      reason: "identity_restart",
      retryable: true,
      state: "unavailable",
    })
    expect(fixture.oidc.refresh).not.toHaveBeenCalled()
    expect(fixture.repository.sessionRecords.size).toBe(1)
  })

  it("preserves a newly rotated refresh token when post-refresh validation is unavailable", async () => {
    const fixture = createFixture()
    const session = await fixture.login()
    fixture.advance(4 * 60 * 1000 + 1)
    fixture.oidc.refresh.mockResolvedValueOnce({
      state: "ok",
      tokens: fixture.tokens("2"),
    })
    fixture.validator.validate.mockResolvedValueOnce({
      reason: "identity_restart",
      state: "unavailable",
    })

    await expect(
      fixture.service.resolve(session.sessionHandle),
    ).resolves.toEqual({
      reason: "identity_restart",
      retryable: true,
      state: "unavailable",
    })
    expect(fixture.repository.sessionRecords.size).toBe(1)

    fixture.advance(5_000)
    fixture.oidc.refresh.mockResolvedValueOnce({
      state: "ok",
      tokens: fixture.tokens("3"),
    })
    await expect(
      fixture.service.resolve(session.sessionHandle),
    ).resolves.toMatchObject({
      refreshCount: 1,
      session: { accessToken: "access-3" },
      state: "active",
    })
    expect(fixture.oidc.refresh).toHaveBeenNthCalledWith(1, "refresh-1")
    expect(fixture.oidc.refresh).toHaveBeenNthCalledWith(2, "refresh-2")
  })

  it("revokes the family on refresh reuse without emitting token material", async () => {
    const fixture = createFixture()
    const session = await fixture.login()
    fixture.advance(4 * 60 * 1000 + 1)
    fixture.oidc.refresh.mockResolvedValueOnce({
      state: "ok",
      tokens: fixture.tokens("1"),
    })

    await expect(
      fixture.service.resolve(session.sessionHandle),
    ).resolves.toEqual({
      reason: "reuse_detected",
      state: "terminal",
    })
    expect(JSON.stringify(fixture.telemetry.mock.calls)).not.toMatch(
      /access-|refresh-/,
    )
    expect(fixture.repository.sessionRecords.size).toBe(0)
  })

  it("hard-deletes a session after a revoked refresh token", async () => {
    const fixture = createFixture()
    const session = await fixture.login()
    fixture.advance(4 * 60 * 1000 + 1)
    fixture.oidc.refresh.mockResolvedValueOnce({
      reason: "revoked",
      state: "terminal",
    })

    await expect(
      fixture.service.resolve(session.sessionHandle),
    ).resolves.toEqual({ reason: "revoked", state: "terminal" })
    expect(fixture.repository.sessionRecords.size).toBe(0)
    expect(fixture.telemetry).toHaveBeenCalledWith({
      event: "console_session.refresh_failed",
      reason: "revoked",
      sessionReference: expect.stringMatching(/^[a-f0-9]{12}$/),
    })
  })

  it("allows no more than one refresh and one downstream replay", async () => {
    const fixture = createFixture()
    const session = await fixture.login()
    fixture.oidc.refresh.mockResolvedValueOnce({
      state: "ok",
      tokens: fixture.tokens("2"),
    })
    const operation = vi.fn(async (accessToken: string) => ({
      status: 401,
      value: accessToken,
    }))

    await expect(
      fixture.service.executeWithSession(session.sessionHandle, operation),
    ).resolves.toEqual({ reason: "revoked", state: "terminal" })
    expect(fixture.oidc.refresh).toHaveBeenCalledTimes(1)
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it("coalesces parallel downstream 401 refreshes across browser tabs", async () => {
    const fixture = createFixture()
    const session = await fixture.login()
    let initialCalls = 0
    let releaseInitialCalls: () => void = () => {}
    const bothInitialCalls = new Promise<void>((resolve) => {
      releaseInitialCalls = resolve
    })
    const operation = vi.fn(async (accessToken: string) => {
      if (accessToken === "access-1") {
        initialCalls += 1
        if (initialCalls === 2) {
          releaseInitialCalls()
        }
        await bothInitialCalls
        return { status: 401, value: accessToken }
      }
      return { status: 200, value: accessToken }
    })

    const results = await Promise.all([
      fixture.service.executeWithSession(session.sessionHandle, operation),
      fixture.service.executeWithSession(session.sessionHandle, operation),
    ])

    expect(results).toEqual([
      { state: "ok", value: "access-2" },
      { state: "ok", value: "access-2" },
    ])
    expect(fixture.oidc.refresh).toHaveBeenCalledTimes(1)
    expect(operation).toHaveBeenCalledTimes(4)
    expect(
      [...fixture.repository.sessionRecords.values()][0]?.refreshGeneration,
    ).toBe(1)
  })

  it("does not cascade refresh rotation across tabs after a post-rotation validation outage", async () => {
    const fixture = createFixture()
    const session = await fixture.login()
    let initialCalls = 0
    let releaseInitialCalls: () => void = () => {}
    const bothInitialCalls = new Promise<void>((resolve) => {
      releaseInitialCalls = resolve
    })
    const operation = vi.fn(async (accessToken: string) => {
      if (accessToken === "access-1") {
        initialCalls += 1
        if (initialCalls === 2) {
          releaseInitialCalls()
        }
        await bothInitialCalls
        return { status: 401, value: accessToken }
      }
      return { status: 200, value: accessToken }
    })
    fixture.oidc.refresh.mockResolvedValueOnce({
      state: "ok",
      tokens: fixture.tokens("2"),
    })
    fixture.validator.validate.mockResolvedValueOnce({
      reason: "identity_restart",
      state: "unavailable",
    })

    const results = await Promise.all([
      fixture.service.executeWithSession(session.sessionHandle, operation),
      fixture.service.executeWithSession(session.sessionHandle, operation),
    ])

    expect(results).toEqual([
      {
        reason: "identity_restart",
        retryable: true,
        state: "unavailable",
      },
      {
        reason: "identity_restart",
        retryable: true,
        state: "unavailable",
      },
    ])
    expect(operation).toHaveBeenCalledTimes(2)
    expect(fixture.oidc.refresh).toHaveBeenCalledTimes(1)
    expect(fixture.repository.sessionRecords.size).toBe(1)
    expect(
      [...fixture.repository.sessionRecords.values()][0]?.refreshGeneration,
    ).toBe(1)
  })

  it("coalesces parallel pre-refresh identity outages with a bounded retry delay", async () => {
    const fixture = createFixture()
    const session = await fixture.login()
    fixture.advance(4 * 60 * 1000 + 1)
    fixture.validator.readiness.mockResolvedValue({
      reason: "identity_timeout",
      state: "unavailable",
    })

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        fixture.service.resolve(session.sessionHandle),
      ),
    )

    expect(results).toHaveLength(20)
    expect(
      results.every(
        (result) =>
          result.state === "unavailable" &&
          result.reason === "identity_timeout",
      ),
    ).toBe(true)
    expect(fixture.validator.readiness).toHaveBeenCalledTimes(1)
    expect(fixture.oidc.refresh).not.toHaveBeenCalled()

    fixture.advance(5_000)
    fixture.validator.readiness.mockResolvedValue({ state: "ready" })
    await expect(
      fixture.service.resolve(session.sessionHandle),
    ).resolves.toMatchObject({ state: "active" })
    expect(fixture.oidc.refresh).toHaveBeenCalledTimes(1)
  })

  it("handles explicit logout and verified back-channel logout", async () => {
    const fixture = createFixture()
    const first = await fixture.login()
    await fixture.service.logout(first.sessionHandle)
    expect(fixture.oidc.revoke).toHaveBeenCalledWith("refresh-1")
    await expect(
      fixture.service.resolve(first.sessionHandle),
    ).resolves.toMatchObject({
      state: "terminal",
    })

    const second = await fixture.login()
    const claims = {
      expiresAt: new Date(fixture.now().getTime() + 60_000),
      issuedAt: fixture.now(),
      jti: "logout-event-1",
      keycloakSessionId: "keycloak-session-1",
    }
    await expect(fixture.service.backchannelLogout(claims)).resolves.toBe(1)
    const [retainUntil] = fixture.repository.logoutTokenReplays.values()
    expect(retainUntil?.toISOString()).toBe(
      new Date(claims.expiresAt.getTime() + 60_000).toISOString(),
    )
    await expect(fixture.service.backchannelLogout(claims)).resolves.toBe(0)
    await expect(
      fixture.service.resolve(second.sessionHandle),
    ).resolves.toMatchObject({
      state: "terminal",
    })
  })

  it("rejects expired back-channel logout without retaining replay state", async () => {
    const fixture = createFixture()
    await fixture.login()

    await expect(
      fixture.service.backchannelLogout({
        expiresAt: fixture.now(),
        issuedAt: new Date(fixture.now().getTime() - 60_000),
        jti: "expired-logout-event",
        subject: "operator-1",
      }),
    ).resolves.toBe(0)
    expect(fixture.repository.logoutTokenReplays.size).toBe(0)
    expect(fixture.repository.sessionRecords.size).toBe(1)
  })

  it("requires recent MFA for high-risk elevation", () => {
    const now = new Date("2026-08-02T10:00:00.000Z")
    expect(
      ConsoleSessionService.highRiskMfaCurrent(
        {
          accessToken: "server-only",
          accessTokenExpiresAt: new Date(now.getTime() + 300_000),
          groups: [],
          mfaVerifiedAt: new Date(now.getTime() - 299_999),
          role: "operator",
          subject: "operator-1",
        },
        now,
      ),
    ).toBe(true)
    expect(
      ConsoleSessionService.highRiskMfaCurrent(
        {
          accessToken: "server-only",
          accessTokenExpiresAt: new Date(now.getTime() + 300_000),
          groups: [],
          mfaVerifiedAt: new Date(now.getTime() - 300_001),
          role: "operator",
          subject: "operator-1",
        },
        now,
      ),
    ).toBe(false)
    expect(
      ConsoleSessionService.actionAuthorized(
        "applications.credentials.test_rotate_revoke",
        {
          accessToken: "server-only",
          accessTokenExpiresAt: new Date(now.getTime() + 300_000),
          groups: [],
          mfaVerifiedAt: null,
          role: "admin",
          subject: "admin-1",
        },
        now,
      ),
    ).toBe(false)
    expect(
      ConsoleSessionService.actionAuthorized(
        "overview.read",
        {
          accessToken: "server-only",
          accessTokenExpiresAt: new Date(now.getTime() + 300_000),
          groups: [],
          mfaVerifiedAt: null,
          role: "operator",
          subject: "operator-1",
        },
        now,
      ),
    ).toBe(true)
  })

  it("binds high-risk elevation to the current subject and fresh MFA", async () => {
    const mfaVerifiedAt = new Date("2026-08-02T10:00:00.000Z")
    const fixture = createFixture({
      identity: fixtureIdentity({ mfaVerifiedAt }),
    })
    const current = await fixture.login()
    const elevation = await fixture.service.beginElevation({
      action: "applications.credentials.test_rotate_revoke",
      returnTo: "/applications?tab=keys",
      sessionHandle: current.sessionHandle,
    })
    expect(elevation).toMatchObject({ state: "started" })
    expect(fixture.oidc.authorizationUrl).toHaveBeenLastCalledWith(
      expect.objectContaining({ elevation: true }),
    )
    if (elevation.state !== "started") {
      throw new Error("Expected elevation authorization to start.")
    }
    const completed = await fixture.service.completeLogin({
      code: "elevation-code",
      loginHandle: elevation.loginHandle,
      state: fixture.lastState(),
    })
    expect(completed).toMatchObject({
      returnPath: "/applications?tab=keys",
      state: "active",
    })
    expect(fixture.oidc.revoke).toHaveBeenCalledWith("refresh-1")
  })

  it("fails high-risk elevation closed when auth_time evidence is stale", async () => {
    const fixture = createFixture({
      identity: fixtureIdentity({
        mfaVerifiedAt: new Date("2026-08-02T09:54:59.000Z"),
      }),
    })
    const current = await fixture.login()
    const elevation = await fixture.service.beginElevation({
      action: "team.users_roles.manage",
      returnTo: "/team",
      sessionHandle: current.sessionHandle,
    })
    if (elevation.state !== "started") {
      throw new Error("Expected elevation authorization to start.")
    }
    await expect(
      fixture.service.completeLogin({
        code: "elevation-code",
        loginHandle: elevation.loginHandle,
        state: fixture.lastState(),
      }),
    ).resolves.toMatchObject({ reason: "invalid", state: "terminal" })
  })
})

describe("Console return-path normalization", () => {
  it("preserves a legitimate same-origin path and query", () => {
    expect(
      normalizeConsoleReturnPath("/applications?next=%2Fmodels&tab=keys"),
    ).toBe("/applications?next=%2Fmodels&tab=keys")
  })

  it.each([
    "/%2e%2e//attacker.example.test",
    "/.%2e//attacker.example.test",
    "/safe/%2E%2E/settings",
    "/safe/../settings",
    "//attacker.example.test/path",
    "/%0aattacker.example.test",
  ])("rejects unsafe return target %s", (value) => {
    expect(normalizeConsoleReturnPath(value)).toBe("/")
  })
})

function createFixture(
  options: {
    identity?: ReturnType<typeof fixtureIdentity>
  } = {},
) {
  let clock = new Date("2026-08-02T10:00:00.000Z")
  let authorizationInput: { elevation?: boolean; state: string } | null = null
  const repository = new TestOnlyInMemoryConsoleSessionRepository()
  const oidc = {
    authorizationUrl: vi.fn((input: { state: string }) => {
      authorizationInput = input
      return `https://console.example.test/identity/authorize?state=${input.state}`
    }),
    exchangeCode: vi.fn<ConsoleOidcClient["exchangeCode"]>(async () => ({
      state: "ok",
      tokens: tokens("1"),
    })),
    refresh: vi.fn<ConsoleOidcClient["refresh"]>(
      async (): Promise<ConsoleOidcTokenResult> => ({
        state: "ok",
        tokens: tokens("2"),
      }),
    ),
    revoke: vi.fn<ConsoleOidcClient["revoke"]>(async () => undefined),
  }
  const telemetry = vi.fn()
  const validator = {
    readiness: vi.fn<ConsoleTokenValidator["readiness"]>(async () => ({
      state: "ready",
    })),
    validate: vi.fn(
      async (
        tokenSet: ConsoleOidcTokenSet,
      ): Promise<ConsoleTokenValidation> => ({
        identity: {
          ...(options.identity ?? fixtureIdentity()),
          accessExpiresAt: new Date(clock.getTime() + 5 * 60 * 1000),
          keycloakSessionId: "keycloak-session-1",
        },
        state: "valid",
      }),
    ),
  }
  const service = new ConsoleSessionService(
    repository,
    createConsoleSessionCipher({
      activeKid: "test-key",
      keys: { "test-key": randomBytes(32) },
    }),
    oidc,
    validator,
    { record: telemetry },
    {
      clientId: "console-web",
      issuer: "https://console.example.test/identity/realms/appliance",
    },
    () => new Date(clock),
  )
  return {
    advance(milliseconds: number) {
      clock = new Date(clock.getTime() + milliseconds)
    },
    lastState() {
      if (!authorizationInput) {
        throw new Error("Authorization was not started.")
      }
      return authorizationInput.state
    },
    async login() {
      const login = await service.beginLogin("/applications?tab=keys")
      const completed = await service.completeLogin({
        code: "authorization-code",
        loginHandle: login.loginHandle,
        state: this.lastState(),
      })
      if (completed.state !== "active") {
        throw new Error("Expected active test session.")
      }
      return completed
    },
    now: () => new Date(clock),
    oidc,
    repository,
    service,
    telemetry,
    tokens,
    validator,
  }
}

function fixtureIdentity(
  overrides: Partial<{
    email: string
    groups: string[]
    mfaVerifiedAt: Date
    offlineAccess: boolean
    role: "admin" | "operator"
    subject: string
  }> = {},
) {
  return {
    email: "operator@example.test",
    groups: ["Operations"],
    offlineAccess: false,
    role: "operator" as const,
    subject: "operator-1",
    ...overrides,
  }
}

function tokens(version: string): ConsoleOidcTokenSet {
  return {
    accessToken: `access-${version}`,
    idToken: `id-${version}`,
    refreshToken: `refresh-${version}`,
  }
}
