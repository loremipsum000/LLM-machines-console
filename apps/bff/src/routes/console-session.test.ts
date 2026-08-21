import Fastify from "fastify"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  ConsoleBackchannelVerifier,
  ConsoleSessionService,
} from "../services/console-session-service"
import { registerConsoleSessionRoutes } from "./console-session"

const sessionHandle = "S".repeat(43)
const loginHandle = "L".repeat(43)

describe("Console session HTTP boundary", () => {
  const serviceStub = {
    backchannelLogout: vi.fn(async () => 1),
    beginLogin: vi.fn(async () => ({
      authorizationUrl:
        "https://console.example.test/identity/authorize?state=opaque",
      loginHandle,
    })),
    beginElevation: vi.fn(async () => ({
      authorizationUrl:
        "https://console.example.test/identity/authorize?state=elevation",
      loginHandle,
      state: "started" as const,
    })),
    completeLogin: vi.fn(async () => ({
      returnPath: "/applications?tab=keys",
      sessionHandle,
      state: "active" as const,
    })),
    globalLogout: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    resolve: vi.fn(async () => ({
      refreshCount: 0 as const,
      session: {
        accessToken: "server-only-access",
        accessTokenExpiresAt: new Date("2026-08-02T10:05:00.000Z"),
        groups: ["Operations"],
        mfaVerifiedAt: null,
        role: "operator" as const,
        subject: "operator-1",
      },
      state: "active" as const,
    })),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    serviceStub.completeLogin.mockResolvedValue({
      returnPath: "/applications?tab=keys",
      sessionHandle,
      state: "active",
    })
    serviceStub.resolve.mockResolvedValue({
      refreshCount: 0,
      session: {
        accessToken: "server-only-access",
        accessTokenExpiresAt: new Date("2026-08-02T10:05:00.000Z"),
        groups: ["Operations"],
        mfaVerifiedAt: null,
        role: "operator",
        subject: "operator-1",
      },
      state: "active",
    })
  })

  it("sets only an opaque login cookie and starts the edge-routed code flow", async () => {
    const server = buildServer(serviceStub as unknown as ConsoleSessionService)
    const response = await server.inject({
      method: "GET",
      url: "/api/console/session/login?returnTo=%2Fapplications%3Ftab%3Dkeys",
    })

    expect(response.statusCode).toBe(303)
    expect(response.headers.location).toContain("/identity/authorize")
    expect(response.headers["set-cookie"]).toContain(
      `__Host-llm-machines-login=${loginHandle}`,
    )
    expect(response.headers["set-cookie"]).not.toMatch(/access|refresh|eyJ/i)
  })

  it("never places access or refresh tokens on the Web resolver boundary", async () => {
    const server = buildServer(serviceStub as unknown as ConsoleSessionService)
    const unauthorized = await server.inject({
      headers: { "x-llm-machines-console-session": sessionHandle },
      method: "GET",
      url: "/api/internal/console-session/resolve",
    })
    expect(unauthorized.statusCode).toBe(401)
    expect(unauthorized.body).not.toContain("server-only-access")

    const internal = await server.inject({
      headers: {
        authorization: "Bearer web-to-bff",
        "x-llm-machines-console-session": sessionHandle,
      },
      method: "GET",
      url: "/api/internal/console-session/resolve",
    })
    expect(internal.statusCode).toBe(200)
    expect(internal.json().session).toMatchObject({
      role: "operator",
      subject: "operator-1",
    })
    expect(internal.body).not.toMatch(/server-only-access|refresh-/)
    expect(internal.headers["cache-control"]).toContain("no-store")
  })

  it("sets an eight-hour sliding opaque cookie after callback", async () => {
    const server = buildServer(serviceStub as unknown as ConsoleSessionService)
    const response = await server.inject({
      headers: { cookie: `__Host-llm-machines-login=${loginHandle}` },
      method: "GET",
      url: "/api/console/session/callback?code=code&state=state&iss=https%3A%2F%2Fidentity.example.test%2Frealms%2Fappliance",
    })
    const cookies = response.headers["set-cookie"]
    expect(response.statusCode).toBe(303)
    expect(cookies).toContain(
      `__Host-llm-machines-session=${sessionHandle}; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Lax`,
    )
    expect(JSON.stringify(cookies)).not.toMatch(/server-only-access|refresh-/)
  })

  it("uses explicit expired state and preserves only a validated return path", async () => {
    serviceStub.completeLogin.mockResolvedValueOnce({
      reason: "revoked",
      returnPath: "/applications?tab=keys",
      state: "terminal",
    } as never)
    const server = buildServer(serviceStub as unknown as ConsoleSessionService)
    const response = await server.inject({
      headers: { cookie: `__Host-llm-machines-login=${loginHandle}` },
      method: "GET",
      url: "/api/console/session/callback?code=code&state=state&iss=https%3A%2F%2Fidentity.example.test%2Frealms%2Fappliance",
    })
    const location = new URL(response.headers.location ?? "")
    expect(location.searchParams.get("session")).toBe("expired")
    expect(location.searchParams.get("returnTo")).toBe("/applications?tab=keys")
  })

  it("returns typed outcomes without trying to mutate a browser cookie on the private resolver", async () => {
    const server = buildServer(serviceStub as unknown as ConsoleSessionService)
    serviceStub.resolve.mockResolvedValueOnce({
      reason: "identity_unavailable",
      retryable: true,
      state: "unavailable",
    } as never)
    const unavailable = await resolve(server)
    expect(unavailable.statusCode).toBe(503)
    expect(unavailable.headers["set-cookie"]).toBeUndefined()

    serviceStub.resolve.mockResolvedValueOnce({
      reason: "expired",
      state: "terminal",
    } as never)
    const expired = await resolve(server)
    expect(expired.statusCode).toBe(401)
    expect(expired.headers["set-cookie"]).toBeUndefined()
  })

  it("maps resolver storage failure to a retryable 503", async () => {
    const server = buildServer(serviceStub as unknown as ConsoleSessionService)
    serviceStub.resolve.mockRejectedValueOnce(new Error("database unavailable"))

    const response = await resolve(server)

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({
      reason: "storage_unavailable",
      retryable: true,
      state: "unavailable",
    })
    expect(response.headers["set-cookie"]).toBeUndefined()
  })

  it("rejects a callback with the wrong issuer or an unreviewed query key", async () => {
    const server = buildServer(serviceStub as unknown as ConsoleSessionService)
    for (const query of [
      "code=code&state=state&iss=https%3A%2F%2Fattacker.example.test",
      "code=code&state=state&iss=https%3A%2F%2Fidentity.example.test%2Frealms%2Fappliance&unexpected=value",
    ]) {
      const response = await server.inject({
        headers: { cookie: `__Host-llm-machines-login=${loginHandle}` },
        method: "GET",
        url: `/api/console/session/callback?${query}`,
      })
      expect(response.statusCode).toBe(303)
      expect(response.headers.location).toContain("session=expired")
    }
    expect(serviceStub.completeLogin).not.toHaveBeenCalled()
  })

  it("requires exact same-origin POST logout and clears locally first", async () => {
    const server = buildServer(serviceStub as unknown as ConsoleSessionService)
    const denied = await server.inject({
      headers: {
        cookie: `__Host-llm-machines-session=${sessionHandle}`,
        origin: "https://attacker.example.test",
      },
      method: "POST",
      url: "/api/console/session/logout",
    })
    expect(denied.statusCode).toBe(403)

    const accepted = await server.inject({
      headers: {
        cookie: `__Host-llm-machines-session=${sessionHandle}`,
        origin: "https://console.example.test",
      },
      method: "POST",
      url: "/api/console/session/logout",
    })
    expect(accepted.statusCode).toBe(303)
    expect(accepted.headers.location).toBe(
      "https://grafana.example.test/logout",
    )
    expect(serviceStub.globalLogout).toHaveBeenCalledWith(sessionHandle)
    expect(accepted.headers["set-cookie"]).toContain("Max-Age=0")
  })

  it("clears local custody when server-side logout is unavailable", async () => {
    serviceStub.globalLogout.mockRejectedValueOnce(
      new Error("identity unavailable"),
    )
    const server = buildServer(serviceStub as unknown as ConsoleSessionService)

    const response = await server.inject({
      headers: {
        cookie: `__Host-llm-machines-session=${sessionHandle}`,
        origin: "https://console.example.test",
      },
      method: "POST",
      url: "/api/console/session/logout",
    })

    expect(response.statusCode).toBe(303)
    expect(response.headers.location).toBe(
      "https://grafana.example.test/logout",
    )
    expect(response.headers["set-cookie"]).toContain("Max-Age=0")
  })

  it("returns the fixed credential-free logout hop to the Console client", async () => {
    const server = buildServer(serviceStub as unknown as ConsoleSessionService)
    const response = await server.inject({
      headers: {
        accept: "application/json",
        cookie: `__Host-llm-machines-session=${sessionHandle}`,
        origin: "https://console.example.test",
      },
      method: "POST",
      url: "/api/console/session/logout",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      next: "https://grafana.example.test/logout",
    })
    expect(response.headers["set-cookie"]).toContain("Max-Age=0")
  })

  it("allows only the shared isolated test port for the native logout hop", () => {
    expect(() =>
      buildServer(serviceStub as unknown as ConsoleSessionService, undefined, {
        consoleOrigin: "https://console.llmm.test:24443",
        nativeLogoutStartUrl: "https://grafana.llmm.test:24443/logout",
      }),
    ).not.toThrow()
    expect(() =>
      buildServer(serviceStub as unknown as ConsoleSessionService, undefined, {
        consoleOrigin: "https://console.example.test",
        nativeLogoutStartUrl: "https://grafana.example.test:24443/logout",
      }),
    ).toThrow("Native logout must use the exact HTTPS edge route.")
  })

  it("verifies back-channel logout tokens before consuming replay state", async () => {
    const verify = vi.fn(async () => ({
      expiresAt: new Date("2026-08-02T10:01:00.000Z"),
      issuedAt: new Date("2026-08-02T10:00:00.000Z"),
      jti: "logout-jti-1",
      keycloakSessionId: "keycloak-session-1",
    }))
    const server = buildServer(
      serviceStub as unknown as ConsoleSessionService,
      verify,
    )
    const response = await server.inject({
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
      payload: "logout_token=signed.logout.token",
      url: "/api/internal/console-session/backchannel-logout",
    })
    expect(response.statusCode).toBe(204)
    expect(verify).toHaveBeenCalledWith("signed.logout.token")
    expect(serviceStub.backchannelLogout).toHaveBeenCalledOnce()
  })

  it.each(["identity_restart", "identity_unavailable"] as const)(
    "returns retryable 503 for %s during back-channel verification",
    async (reason) => {
      const signedToken = "signed.logout.token"
      const server = buildServer(
        serviceStub as unknown as ConsoleSessionService,
        vi.fn(async () => ({
          reason,
          retryable: true as const,
          state: "unavailable" as const,
        })),
      )
      const response = await server.inject({
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
        payload: `logout_token=${signedToken}`,
        url: "/api/internal/console-session/backchannel-logout",
      })

      expect(response.statusCode).toBe(503)
      expect(response.headers["retry-after"]).toBe("1")
      expect(response.json()).toEqual({
        reason,
        retryable: true,
        state: "unavailable",
      })
      expect(response.body).not.toContain(signedToken)
      expect(serviceStub.backchannelLogout).not.toHaveBeenCalled()
    },
  )

  it("keeps invalid back-channel logout at 400 without token disclosure", async () => {
    const signedToken = "invalid.signed.logout.token"
    const server = buildServer(serviceStub as unknown as ConsoleSessionService)
    const response = await server.inject({
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
      payload: `logout_token=${signedToken}`,
      url: "/api/internal/console-session/backchannel-logout",
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: "invalid_logout_token" })
    expect(response.body).not.toContain(signedToken)
    expect(serviceStub.backchannelLogout).not.toHaveBeenCalled()
  })

  it("starts only a same-origin, action-bound elevation POST", async () => {
    const server = buildServer(serviceStub as unknown as ConsoleSessionService)
    const response = await server.inject({
      headers: {
        cookie: `__Host-llm-machines-session=${sessionHandle}`,
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://console.example.test",
      },
      method: "POST",
      payload:
        "action=team.users_roles.manage&returnTo=%2Fteam%3Ftab%3Dmembers",
      url: "/api/console/session/elevate",
    })
    expect(response.statusCode).toBe(303)
    expect(serviceStub.beginElevation).toHaveBeenCalledWith({
      action: "team.users_roles.manage",
      returnTo: "/team?tab=members",
      sessionHandle,
    })
    expect(response.headers["set-cookie"]).toContain(
      "__Host-llm-machines-login=",
    )
  })
})

function buildServer(
  sessionService: ConsoleSessionService,
  verify: ConsoleBackchannelVerifier["verify"] = async () => null,
  overrides: Partial<{
    consoleOrigin: string
    nativeLogoutStartUrl: string
  }> = {},
) {
  const server = Fastify()
  registerConsoleSessionRoutes(server, {
    backchannelVerifier: { verify },
    consoleOrigin: overrides.consoleOrigin ?? "https://console.example.test",
    identityIssuer: "https://identity.example.test/realms/appliance",
    internalServiceCredential: "web-to-bff",
    nativeLogoutStartUrl:
      overrides.nativeLogoutStartUrl ?? "https://grafana.example.test/logout",
    service: sessionService,
  })
  return server
}

function resolve(server: ReturnType<typeof buildServer>) {
  return server.inject({
    headers: {
      authorization: "Bearer web-to-bff",
      "x-llm-machines-console-session": sessionHandle,
    },
    method: "GET",
    url: "/api/internal/console-session/resolve",
  })
}
