import { createSign, generateKeyPairSync } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import { resetJwksCachesForTest, verifyKeycloakJwt } from "./keycloak-jwt"

const forgedAdminHeaders = {
  authorization: "Bearer test-service-key",
  "x-llm-machines-keycloak-token": "",
  "x-llm-machines-user-email": "admin@example.test",
  "x-llm-machines-user-roles": "admin",
  "x-llm-machines-user-sub": "forged-admin",
}

describe("persona auth security hardening", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    resetJwksCachesForTest()
  })

  it("rejects service-key requests that self-assert admin through forwarded headers in production mode", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_ALLOW_HEADER_ONLY_SERVICE_AUTH", "false")
    vi.stubEnv("BFF_REQUIRE_FORWARDED_KEYCLOAK_TOKEN", "true")

    const server = buildServer()

    const response = await server.inject({
      headers: forgedAdminHeaders,
      method: "GET",
      url: "/api/admin/overview",
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({
      detail:
        "A valid Keycloak bearer token or trusted service identity is required.",
    })
    await server.close()
  })

  it("keeps header-only service auth behind the explicit local/test override", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_ALLOW_HEADER_ONLY_SERVICE_AUTH", "true")
    vi.stubEnv("BFF_REQUIRE_FORWARDED_KEYCLOAK_TOKEN", "false")

    const server = buildServer()

    const response = await server.inject({
      headers: forgedAdminHeaders,
      method: "GET",
      url: "/api/admin/overview",
    })

    expect(response.statusCode).toBe(200)
    await server.close()
  })

  it("rejects unresolved forwarded-token placeholders instead of falling back", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_ALLOW_HEADER_ONLY_SERVICE_AUTH", "false")
    vi.stubEnv("BFF_REQUIRE_FORWARDED_KEYCLOAK_TOKEN", "true")
    vi.stubEnv("KEYCLOAK_ISSUER_URL", "https://keycloak.example.test/realm")

    const server = buildServer()

    const response = await server.inject({
      headers: {
        ...forgedAdminHeaders,
        "x-llm-machines-keycloak-token": "{{FORWARDED_ACCESS_TOKEN}}",
      },
      method: "GET",
      url: "/api/admin/overview",
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({
      detail: "Authentication headers contain unresolved placeholders.",
    })
    await server.close()
  })

  it("accepts a service-key request only when the forwarded Keycloak JWT verifies", async () => {
    const issuer = "https://keycloak.example.test/realms/llm-machines"
    const { token, jwk } = signedKeycloakJwt({
      email: "admin@example.test",
      groups: ["/Everyone", "/Ops"],
      issuer,
      roles: ["admin"],
      subject: "keycloak-admin",
    })
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url) === `${issuer}/protocol/openid-connect/certs`) {
        return new Response(JSON.stringify({ keys: [jwk] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
      }
      return new Response("not found", { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_ALLOW_HEADER_ONLY_SERVICE_AUTH", "false")
    vi.stubEnv("BFF_REQUIRE_FORWARDED_KEYCLOAK_TOKEN", "true")
    vi.stubEnv("KEYCLOAK_ISSUER_URL", issuer)

    const server = buildServer()

    const response = await server.inject({
      headers: {
        ...forgedAdminHeaders,
        "x-llm-machines-keycloak-token": token,
        "x-llm-machines-user-roles": "unclassified",
        "x-llm-machines-user-sub": "forged-unclassified",
      },
      method: "GET",
      url: "/api/admin/overview",
    })

    expect(response.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url) === `${issuer}/protocol/openid-connect/certs`) {
        return new Response(JSON.stringify({ keys: [jwk] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
      }
      return new Response("not found", { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)
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
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ keys: [first.jwk, second.jwk] }),
    )
    vi.stubGlobal("fetch", fetchMock)
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
    expect(firstAgain).toMatchObject({
      subject: "keycloak-admin",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

function signedKeycloakJwt(input: {
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

  const header = base64UrlJson({ alg: "RS256", kid, typ: "JWT" })
  const payload = base64UrlJson({
    email: input.email,
    exp: Math.floor(Date.now() / 1000) + 3600,
    groups: input.groups,
    iss: input.issuer,
    realm_access: { roles: input.roles },
    sub: input.subject,
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
    base64UrlJson({ alg: "RS256", kid: input.kid, typ: "JWT" }),
    base64UrlJson({
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: input.issuer,
      realm_access: { roles: ["admin"] },
      sub: input.subject,
    }),
    Buffer.from("invalid-signature").toString("base64url"),
  ].join(".")
}
