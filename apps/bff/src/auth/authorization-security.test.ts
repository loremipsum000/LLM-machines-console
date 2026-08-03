import { createSign, generateKeyPairSync } from "node:crypto"
import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  type AuthorizationOptions,
  registerAuthorization,
  withAdminOnly,
  withCapability,
} from "./authorization"
import { resetJwksCachesForTest, verifyKeycloakJwt } from "./keycloak-jwt"

const assertedAdminHeaders = {
  authorization: "Bearer test-service-key",
  "x-llm-machines-keycloak-token": "",
  "x-llm-machines-user-email": "admin@example.test",
  "x-llm-machines-user-roles": "admin",
  "x-llm-machines-user-sub": "asserted-admin",
}

describe("authorization security hardening", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    resetJwksCachesForTest()
  })

  it("rejects service-key requests that self-assert Admin in production mode", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_ALLOW_HEADER_ONLY_SERVICE_AUTH", "true")
    vi.stubEnv("BFF_REQUIRE_FORWARDED_KEYCLOAK_TOKEN", "false")
    const server = authorizationServer()

    const response = await server.inject({
      headers: assertedAdminHeaders,
      method: "GET",
      url: "/api/admin/read",
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({
      detail:
        "A valid Keycloak bearer token or trusted service identity is required.",
    })
    await server.close()
  })

  it("requires a configured audience outside the test runtime", async () => {
    const issuer = "https://keycloak.example.test/realms/llm-machines"
    const { token, jwk } = signedKeycloakJwt({
      email: "admin@example.test",
      groups: ["/Admins"],
      issuer,
      roles: ["admin"],
      subject: "keycloak-admin",
    })
    stubJwks(issuer, [jwk])
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("KEYCLOAK_ISSUER_URL", issuer)
    vi.stubEnv("KEYCLOAK_AUDIENCE", "")
    const server = authorizationServer()

    const response = await server.inject({
      headers: { authorization: `Bearer ${token}` },
      method: "GET",
      url: "/api/admin/read",
    })

    expect(response.statusCode).toBe(401)
    await server.close()
  })

  it("keeps header-only service auth behind the explicit local/test override", async () => {
    useHeaderOnlyServiceAuth()
    const server = authorizationServer()

    const response = await server.inject({
      headers: assertedAdminHeaders,
      method: "GET",
      url: "/api/admin/read",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ role: "admin" })
    await server.close()
  })

  it("gives Operator only the capabilities approved by the retained matrix", async () => {
    useHeaderOnlyServiceAuth()
    const server = authorizationServer()
    const operatorHeaders = {
      ...assertedAdminHeaders,
      "x-llm-machines-user-roles": "operator",
      "x-llm-machines-user-sub": "operator-1",
    }

    for (const url of [
      "/api/admin/read",
      "/api/admin/credentials",
      "/api/admin/disable",
    ]) {
      const response = await server.inject({
        headers: operatorHeaders,
        method: "GET",
        url,
      })
      expect(response.statusCode, url).toBe(200)
    }

    for (const url of ["/api/admin/policy", "/api/admin/admin-only"]) {
      const response = await server.inject({
        headers: operatorHeaders,
        method: "GET",
        url,
      })
      expect(response.statusCode, url).toBe(403)
    }
    await server.close()
  })

  it("fails closed when a protected human route has no reviewed policy", async () => {
    useHeaderOnlyServiceAuth()
    const server = authorizationServer()

    const response = await server.inject({
      headers: assertedAdminHeaders,
      method: "GET",
      url: "/api/admin/unclassified",
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({
      detail: "This protected route has no authorization policy.",
    })
    await server.close()
  })

  it("leaves an unregistered Admin tombstone as not found", async () => {
    useHeaderOnlyServiceAuth()
    const server = authorizationServer()

    const response = await server.inject({
      headers: assertedAdminHeaders,
      method: "POST",
      url: "/api/admin/unregistered-policy",
    })

    expect(response.statusCode).toBe(404)
    await server.close()
  })

  it("rejects retired and ambiguous base-role assertions", async () => {
    useHeaderOnlyServiceAuth()
    const server = authorizationServer()

    for (const roles of [
      "retired-role",
      "admin operator",
      "Admin",
      "OPERATOR",
      "Admin operator",
      "admin OPERATOR",
    ]) {
      const response = await server.inject({
        headers: {
          ...assertedAdminHeaders,
          "x-llm-machines-user-roles": roles,
        },
        method: "GET",
        url: "/api/admin/read",
      })
      expect(response.statusCode, roles).toBe(401)
    }
    await server.close()
  })

  it("rejects unresolved forwarded-token placeholders instead of falling back", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_ALLOW_HEADER_ONLY_SERVICE_AUTH", "false")
    vi.stubEnv("BFF_REQUIRE_FORWARDED_KEYCLOAK_TOKEN", "true")
    vi.stubEnv("KEYCLOAK_ISSUER_URL", "https://keycloak.example.test/realm")
    const server = authorizationServer()

    const response = await server.inject({
      headers: {
        ...assertedAdminHeaders,
        "x-llm-machines-keycloak-token": "{{FORWARDED_ACCESS_TOKEN}}",
      },
      method: "GET",
      url: "/api/admin/read",
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({
      detail: "Authentication headers contain unresolved placeholders.",
    })
    await server.close()
  })

  it("uses the verified forwarded token instead of forged identity headers", async () => {
    const issuer = "https://keycloak.example.test/realms/llm-machines"
    const { token, jwk } = signedKeycloakJwt({
      email: "operator@example.test",
      groups: ["/Everyone", "/Operators"],
      issuer,
      roles: ["operator"],
      subject: "keycloak-operator",
    })
    stubJwks(issuer, [jwk])
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_ALLOW_HEADER_ONLY_SERVICE_AUTH", "false")
    vi.stubEnv("BFF_REQUIRE_FORWARDED_KEYCLOAK_TOKEN", "true")
    vi.stubEnv("KEYCLOAK_ISSUER_URL", issuer)
    const server = authorizationServer()

    const response = await server.inject({
      headers: {
        ...assertedAdminHeaders,
        "x-llm-machines-keycloak-token": token,
      },
      method: "GET",
      url: "/api/admin/admin-only",
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({
      detail: "Route requires Admin access.",
    })
    await server.close()
  })

  it("rejects a JWT with a mis-cased retained lookalike beside an exact role", async () => {
    const issuer = "https://keycloak.example.test/realms/llm-machines"
    const { token, jwk } = signedKeycloakJwt({
      email: "operator@example.test",
      groups: ["/Operators"],
      issuer,
      roles: ["Admin", "operator"],
      subject: "keycloak-operator",
    })
    stubJwks(issuer, [jwk])
    vi.stubEnv("KEYCLOAK_ISSUER_URL", issuer)
    const server = authorizationServer()

    const response = await server.inject({
      headers: { authorization: `Bearer ${token}` },
      method: "GET",
      url: "/api/admin/read",
    })

    expect(response.statusCode).toBe(401)
    await server.close()
  })

  it("does not turn a recovered Operator into a standing Admin", async () => {
    useHeaderOnlyServiceAuth()
    const resolveRecoverySession = vi.fn(async () => activeRecovery())
    const server = authorizationServer({
      resolveCurrentIdentity: async (actor) => ({
        enabled: true,
        role: "operator",
        subject: actor.subject,
      }),
      resolveRecoverySession,
    })

    const response = await server.inject({
      headers: {
        ...assertedAdminHeaders,
        "x-llm-machines-recovery-session-id": recoverySessionId,
      },
      method: "GET",
      url: "/api/admin/admin-only",
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({
      detail: "Route requires Admin access.",
    })
    expect(resolveRecoverySession).not.toHaveBeenCalled()
    await server.close()
  })

  it("does not register retired native expert mutation surfaces", async () => {
    useHeaderOnlyServiceAuth()
    const server = authorizationServer()

    for (const url of [
      "/api/admin/litellm-native",
      "/api/admin/grafana-native",
    ]) {
      const response = await server.inject({
        headers: assertedAdminHeaders,
        method: "GET",
        url,
      })

      expect(response.statusCode, url).toBe(404)
    }
    await server.close()
  })

  it("passes authentication strength claims to the recovery seam", async () => {
    const issuer = "https://keycloak.example.test/realms/llm-machines"
    const authTime = Math.floor(Date.now() / 1000) - 30
    const { token, jwk } = signedKeycloakJwt({
      acr: "urn:llm-machines:mfa",
      amr: ["pwd", "otp"],
      authTime,
      email: "operator@example.test",
      groups: ["/Operators"],
      issuer,
      roles: ["operator"],
      subject: "keycloak-operator",
    })
    stubJwks(issuer, [jwk])
    vi.stubEnv("KEYCLOAK_ISSUER_URL", issuer)
    const server = authorizationServer()

    const response = await server.inject({
      headers: { authorization: `Bearer ${token}` },
      method: "GET",
      url: "/api/admin/read",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      acr: "urn:llm-machines:mfa",
      amr: ["pwd", "otp"],
      authTime,
      role: "operator",
    })
    await server.close()
  })

  it("resolves current role for every protected request and replaces stale role authority", async () => {
    useHeaderOnlyServiceAuth()
    const resolver = vi.fn(async () => ({
      enabled: true,
      role: "operator" as const,
      subject: "asserted-admin",
    }))
    const server = authorizationServer({ resolveCurrentIdentity: resolver })

    const first = await server.inject({
      headers: assertedAdminHeaders,
      method: "GET",
      url: "/api/admin/read",
    })
    const second = await server.inject({
      headers: assertedAdminHeaders,
      method: "GET",
      url: "/api/admin/admin-only",
    })

    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ role: "operator" })
    expect(first.json()).not.toHaveProperty("roles")
    expect(second.statusCode).toBe(403)
    expect(resolver).toHaveBeenCalledTimes(2)
    await server.close()
  })

  it("fails closed when the live identity authority is unavailable", async () => {
    useHeaderOnlyServiceAuth()
    const server = authorizationServer({
      resolveCurrentIdentity: async () => {
        throw new Error("unavailable")
      },
    })

    const response = await server.inject({
      headers: assertedAdminHeaders,
      method: "GET",
      url: "/api/admin/read",
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      detail: "Current identity status could not be verified.",
    })
    await server.close()
  })

  it("fails closed when live identity is disabled or bound to another subject", async () => {
    useHeaderOnlyServiceAuth()
    for (const identity of [
      { enabled: false, role: "admin" as const, subject: "asserted-admin" },
      { enabled: true, role: "admin" as const, subject: "another-subject" },
    ]) {
      const server = authorizationServer({
        resolveCurrentIdentity: async () => identity,
      })
      const response = await server.inject({
        headers: assertedAdminHeaders,
        method: "GET",
        url: "/api/admin/read",
      })

      expect(response.statusCode).toBe(403)
      await server.close()
    }
  })

  it("uses an active subject-bound recovery session only for Console policy evaluation", async () => {
    useHeaderOnlyServiceAuth()
    const resolveRecoverySession = vi.fn(async () => activeRecovery())
    const server = authorizationServer({
      resolveCurrentIdentity: async (actor) => ({
        enabled: true,
        role: "operator",
        subject: actor.subject,
      }),
      resolveRecoverySession,
    })

    const response = await server.inject({
      headers: {
        ...assertedAdminHeaders,
        "x-llm-machines-recovery-session-id": recoverySessionId,
      },
      method: "GET",
      url: "/api/admin/policy",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      effectiveRole: "admin",
      role: "operator",
      subject: "asserted-admin",
    })
    expect(resolveRecoverySession).toHaveBeenCalledWith(
      recoverySessionId,
      "asserted-admin",
      expect.anything(),
    )
    await server.close()
  })

  it("rejects expired, revoked, unavailable, and wrong-subject recovery sessions", async () => {
    useHeaderOnlyServiceAuth()
    const cases = [
      {
        expected: 403,
        label: "expired",
        resolution: { status: "inactive" as const },
      },
      {
        expected: 403,
        label: "revoked",
        resolution: { status: "inactive" as const },
      },
      {
        expected: 503,
        label: "unavailable",
        resolution: { status: "unavailable" as const },
      },
      {
        expected: 403,
        label: "wrong-subject",
        resolution: activeRecovery("another-subject"),
      },
    ]

    for (const testCase of cases) {
      const server = authorizationServer({
        resolveCurrentIdentity: async (actor) => ({
          enabled: true,
          role: "operator",
          subject: actor.subject,
        }),
        resolveRecoverySession: async () => testCase.resolution,
      })
      const response = await server.inject({
        headers: {
          ...assertedAdminHeaders,
          "x-llm-machines-recovery-session-id": recoverySessionId,
        },
        method: "GET",
        url: "/api/admin/policy",
      })

      expect(response.statusCode, testCase.label).toBe(testCase.expected)
      await server.close()
    }
  })

  it("does not consult recovery state without the recovery session header", async () => {
    useHeaderOnlyServiceAuth()
    const resolveRecoverySession = vi.fn(async () => activeRecovery())
    const server = authorizationServer({
      resolveCurrentIdentity: async (actor) => ({
        enabled: true,
        role: "operator",
        subject: actor.subject,
      }),
      resolveRecoverySession,
    })

    const response = await server.inject({
      headers: assertedAdminHeaders,
      method: "GET",
      url: "/api/admin/admin-only",
    })

    expect(response.statusCode).toBe(403)
    expect(resolveRecoverySession).not.toHaveBeenCalled()
    await server.close()
  })

  it("bounds random-kid JWKS fetches with document and negative caching", async () => {
    const issuer = "https://keycloak.example.test/realms/llm-machines"
    const { jwk } = signedKeycloakJwt({
      email: "admin@example.test",
      groups: ["/Everyone"],
      issuer,
      roles: ["admin"],
      subject: "keycloak-admin",
    })
    const fetchMock = stubJwks(issuer, [jwk])
    vi.stubEnv("KEYCLOAK_ISSUER_URL", issuer)

    const tokens = Array.from({ length: 25 }, (_, index) =>
      unsignedJwt({
        issuer,
        kid: `random-kid-${index}`,
        subject: `attacker-${index}`,
      }),
    )
    const repeatedUnknownKid = unsignedJwt({
      issuer,
      kid: "random-kid-0",
      subject: "attacker-repeat",
    })

    const results = await Promise.all(
      [...tokens, repeatedUnknownKid].map((token) => verifyKeycloakJwt(token)),
    )

    expect(results.every((result) => result === null)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("returns quickly when JWKS fetch times out", async () => {
    const issuer = "https://keycloak.example.test/realms/llm-machines"
    vi.stubEnv("KEYCLOAK_ISSUER_URL", issuer)
    vi.stubEnv("BFF_JWKS_FETCH_TIMEOUT_MS", "10")
    const fetchMock = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          )
          setTimeout(() => resolve(Response.json({ keys: [] })), 1000)
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const token = unsignedJwt({
      issuer,
      kid: "slow-kid",
      subject: "slow-user",
    })

    const startedAt = Date.now()
    const result = await verifyKeycloakJwt(token)

    expect(result).toBeNull()
    expect(Date.now() - startedAt).toBeLessThan(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("authenticates valid tokens after JWKS cache warm without refetching", async () => {
    const issuer = "https://keycloak.example.test/realms/llm-machines"
    const first = signedKeycloakJwt({
      email: "admin@example.test",
      groups: ["/Everyone"],
      issuer,
      kid: "cache-admin-kid",
      roles: ["admin"],
      subject: "keycloak-admin",
    })
    const second = signedKeycloakJwt({
      email: "operator@example.test",
      groups: ["/Everyone"],
      issuer,
      kid: "cache-operator-kid",
      roles: ["operator"],
      subject: "keycloak-operator",
    })
    const fetchMock = stubJwks(issuer, [first.jwk, second.jwk])
    vi.stubEnv("KEYCLOAK_ISSUER_URL", issuer)

    const firstPayload = await verifyKeycloakJwt(first.token)
    const secondPayload = await verifyKeycloakJwt(second.token)
    const firstAgain = await verifyKeycloakJwt(first.token)

    expect(firstPayload).toMatchObject({
      subject: "keycloak-admin",
      roles: ["admin"],
    })
    expect(secondPayload).toMatchObject({
      subject: "keycloak-operator",
      roles: ["operator"],
    })
    expect(firstAgain).toMatchObject({ subject: "keycloak-admin" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

function authorizationServer(options: Partial<AuthorizationOptions> = {}) {
  const server = Fastify({ logger: false })
  registerAuthorization(server, {
    resolveCurrentIdentity: async (actor) => ({
      enabled: true,
      role: actor.role,
      subject: actor.subject,
    }),
    resolveRecoverySession: async () => ({ status: "inactive" }),
    ...options,
  })
  server.get(
    "/api/admin/read",
    withCapability("console.operational.view"),
    async (request) => request.actor,
  )
  server.get(
    "/api/admin/credentials",
    withCapability("applications.credentials.test_rotate_revoke"),
    async (request) => request.actor,
  )
  server.get(
    "/api/admin/disable",
    withCapability("applications.disable"),
    async (request) => request.actor,
  )
  server.get(
    "/api/admin/policy",
    withCapability("applications.policy.change"),
    async (request) => request.actor,
  )
  server.get(
    "/api/admin/admin-only",
    withAdminOnly(),
    async (request) => request.actor,
  )
  server.get("/api/admin/unclassified", async () => ({ ok: true }))
  return server
}

const recoverySessionId = "01234567-89ab-4def-8123-456789abcdef"

function activeRecovery(keycloakSubjectId = "asserted-admin") {
  return {
    grant: {
      activatedAt: "2026-07-31T12:00:00.000Z",
      expiresAt: "2026-07-31T12:15:00.000Z",
      keycloakSubjectId,
      reasonCode: "admin_lockout" as const,
      scope: "console_admin_capabilities" as const,
      sessionId: recoverySessionId,
    },
    status: "active" as const,
  }
}

function useHeaderOnlyServiceAuth(): void {
  vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
  vi.stubEnv("BFF_ALLOW_HEADER_ONLY_SERVICE_AUTH", "true")
  vi.stubEnv("BFF_REQUIRE_FORWARDED_KEYCLOAK_TOKEN", "false")
}

function stubJwks(issuer: string, keys: Record<string, unknown>[]) {
  const fetchMock = vi.fn<typeof fetch>(async (url) => {
    if (String(url) === `${issuer}/protocol/openid-connect/certs`) {
      return Response.json({ keys })
    }
    return new Response("not found", { status: 404 })
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function signedKeycloakJwt(input: {
  acr?: string
  amr?: string[]
  authTime?: number
  email: string
  groups: string[]
  issuer: string
  kid?: string
  roles: string[]
  subject: string
}): { jwk: Record<string, unknown>; token: string } {
  const kid = input.kid ?? "security-test-kid"
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  })
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>
  jwk.kid = kid
  jwk.alg = "RS256"
  jwk.use = "sig"

  const header = base64UrlJson({ alg: "RS256", kid, typ: "Bearer" })
  const payload = base64UrlJson({
    acr: input.acr,
    amr: input.amr,
    auth_time: input.authTime,
    email: input.email,
    exp: Math.floor(Date.now() / 1000) + 3600,
    groups: input.groups,
    iss: input.issuer,
    realm_access: { roles: input.roles },
    sub: input.subject,
    typ: "Bearer",
  })
  const signedContent = `${header}.${payload}`
  const signer = createSign("RSA-SHA256")
  signer.update(signedContent)
  signer.end()
  const signature = signer.sign(privateKey).toString("base64url")

  return { jwk, token: `${signedContent}.${signature}` }
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function unsignedJwt(input: {
  issuer: string
  kid: string
  subject: string
}): string {
  return [
    base64UrlJson({ alg: "RS256", kid: input.kid, typ: "Bearer" }),
    base64UrlJson({
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: input.issuer,
      realm_access: { roles: ["admin"] },
      sub: input.subject,
      typ: "Bearer",
    }),
    Buffer.from("invalid-signature").toString("base64url"),
  ].join(".")
}
