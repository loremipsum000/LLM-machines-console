import { type KeyObject, createSign, generateKeyPairSync } from "node:crypto"
import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { verifyApplicationAccessToken } from "./application-access-token"
import {
  getJwksCacheSizesForTest,
  resetJwksCachesForTest,
  verifyKeycloakJwt,
} from "./keycloak-jwt"

const APPLICATION_ISSUER =
  "https://keycloak.example.test/realms/llm-machines-applications"
const HUMAN_ISSUER = "https://keycloak.example.test/realms/llm-machines"
const APPLICATION_CLIENT_ID = "llmm-app-11111111-1111-4111-8111-111111111111"
const APPLICATION_SUBJECT = "application-service-account-subject"
const SIGNING_KEY_ID = "application-realm-key"
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
})
const signingJwk = publicKey.export({ format: "jwk" }) as Record<
  string,
  unknown
>
Object.assign(signingJwk, {
  alg: "RS256",
  kid: SIGNING_KEY_ID,
  use: "sig",
})

interface ApplicationTokenClaims {
  aud?: string | string[]
  azp?: string
  client_id?: string
  exp?: number
  iat?: number
  iss?: string
  nbf?: number
  sub?: string
  typ?: string
}

describe("Application access-token verification", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-07-31T12:00:00.000Z"))
    vi.stubEnv("PRODUCT_IDENTITY_HOST", "keycloak.example.test")
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    resetJwksCachesForTest()
  })

  it("uses only the dedicated Application issuer configuration", async () => {
    const source = readFileSync(
      new URL("application-access-token.ts", import.meta.url),
      "utf8",
    )
    vi.stubEnv("KEYCLOAK_APPLICATION_ISSUER_URL", "")
    vi.stubEnv("KEYCLOAK_ISSUER_URL", HUMAN_ISSUER)
    vi.stubEnv("KEYCLOAK_AUDIENCE", "console-bff")
    vi.stubEnv("KEYCLOAK_ADMIN_BASE_URL", "https://keycloak.example.test")
    vi.stubEnv("KEYCLOAK_ADMIN_REALM", "llm-machines")
    vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_ID", "console-human-admin")
    vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_SECRET", "must-not-be-read")
    vi.stubEnv(
      "KEYCLOAK_APPLICATION_ADMIN_CLIENT_SECRET",
      "must-not-be-read-either",
    )
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      verifyApplicationAccessToken(signedApplicationToken()),
    ).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(source).not.toContain("process.env.KEYCLOAK_ISSUER_URL")
    expect(source).not.toMatch(/KEYCLOAK_(?:ADMIN|APPLICATION_ADMIN)_/)
  })

  it("accepts a signed 300-second Application token", async () => {
    const now = currentTimeSeconds()
    const fetchMock = stubApplicationJwks()

    await expect(
      verifyApplicationAccessToken(
        signedApplicationToken({ exp: now + 300, iat: now }),
        { issuerUrl: `${APPLICATION_ISSUER}/` },
      ),
    ).resolves.toEqual({
      clientId: APPLICATION_CLIENT_ID,
      keycloakSubjectId: APPLICATION_SUBJECT,
    })
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Accept: "application/json" },
      redirect: "error",
    })
  })

  it("accepts a singleton console-bff audience array", async () => {
    stubApplicationJwks()

    await expect(
      verifyApplicationAccessToken(
        signedApplicationToken({ aud: ["console-bff"] }),
        { issuerUrl: APPLICATION_ISSUER },
      ),
    ).resolves.toMatchObject({ clientId: APPLICATION_CLIENT_ID })
  })

  it("rejects an issuer outside the Product identity authority", async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      verifyApplicationAccessToken(signedApplicationToken(), {
        issuerUrl:
          "https://other-identity.example.test/realms/llm-machines-applications",
      }),
    ).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects a path-prefixed Application issuer", async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      verifyApplicationAccessToken(signedApplicationToken(), {
        issuerUrl:
          "https://keycloak.example.test/auth/realms/llm-machines-applications",
      }),
    ).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", undefined],
    ["wrong", "another-api"],
    ["empty array", []],
    ["additional audience", ["console-bff", "account"]],
  ])("rejects %s audience", async (_label, aud) => {
    stubApplicationJwks()

    await expect(
      verifyApplicationAccessToken(signedApplicationToken({ aud }), {
        issuerUrl: APPLICATION_ISSUER,
      }),
    ).resolves.toBeNull()
  })

  it.each([
    ["missing iat", { iat: undefined }],
    ["fractional iat", { iat: currentTimeSeconds() - 0.5 }],
    ["future iat", { iat: currentTimeSeconds() + 30 }],
    [
      "lifetime over 300 seconds",
      { exp: currentTimeSeconds() + 301, iat: currentTimeSeconds() },
    ],
    ["expired exp", { exp: currentTimeSeconds() - 1 }],
    ["future nbf", { nbf: currentTimeSeconds() + 30 }],
    ["fractional nbf", { nbf: currentTimeSeconds() - 0.5 }],
    ["non-Bearer token type", { typ: "Refresh" }],
  ] satisfies Array<[string, Partial<ApplicationTokenClaims>]>)(
    "rejects a token with %s",
    async (_label, claims) => {
      stubApplicationJwks()

      await expect(
        verifyApplicationAccessToken(signedApplicationToken(claims), {
          issuerUrl: APPLICATION_ISSUER,
        }),
      ).resolves.toBeNull()
    },
  )

  it.each([
    ["missing azp", { azp: undefined }],
    ["wrong namespace", { azp: "third-party-client" }],
    [
      "non-canonical UUID casing",
      { azp: "llmm-app-AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
    ],
    ["mismatched client_id", { client_id: "llmm-app-other-client" }],
    [
      "Application admin service token",
      {
        azp: "console-application-admin",
        client_id: "console-application-admin",
        exp: currentTimeSeconds() + 60,
      },
    ],
  ] satisfies Array<[string, Partial<ApplicationTokenClaims>]>)(
    "rejects %s",
    async (_label, claims) => {
      stubApplicationJwks()

      await expect(
        verifyApplicationAccessToken(signedApplicationToken(claims), {
          issuerUrl: APPLICATION_ISSUER,
        }),
      ).resolves.toBeNull()
    },
  )

  it("accepts an omitted client_id and requires equality when present", async () => {
    stubApplicationJwks()

    await expect(
      verifyApplicationAccessToken(
        signedApplicationToken({ client_id: undefined }),
        { issuerUrl: APPLICATION_ISSUER },
      ),
    ).resolves.toMatchObject({ clientId: APPLICATION_CLIENT_ID })
    await expect(
      verifyApplicationAccessToken(signedApplicationToken(), {
        issuerUrl: APPLICATION_ISSUER,
      }),
    ).resolves.toMatchObject({ clientId: APPLICATION_CLIENT_ID })
  })

  it.each([
    HUMAN_ISSUER,
    `${APPLICATION_ISSUER}-extra`,
    `${APPLICATION_ISSUER}?realm=other`,
    `${APPLICATION_ISSUER}#fragment`,
    "https://user:password@keycloak.example.test/realms/llm-machines-applications",
    "ftp://keycloak.example.test/realms/llm-machines-applications",
  ])(
    "rejects invalid Application issuer configuration %s",
    async (issuerUrl) => {
      const fetchMock = vi.fn<typeof fetch>()
      vi.stubGlobal("fetch", fetchMock)

      await expect(
        verifyApplicationAccessToken(signedApplicationToken(), { issuerUrl }),
      ).resolves.toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it("rejects a token issued by a different realm", async () => {
    const fetchMock = stubApplicationJwks()

    await expect(
      verifyApplicationAccessToken(
        signedApplicationToken({ iss: HUMAN_ISSUER }),
        { issuerUrl: APPLICATION_ISSUER },
      ),
    ).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fails closed without logging tokens or claims when JWKS is unsafe", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          keys: [{ alg: "RS256", kid: SIGNING_KEY_ID, kty: "not-a-key" }],
        }),
      ),
    )

    await expect(
      verifyApplicationAccessToken(signedApplicationToken(), {
        issuerUrl: APPLICATION_ISSUER,
      }),
    ).resolves.toBeNull()
    expect(error).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it("rejects a JWKS response above the bounded read limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { keys: [signingJwk] },
          { headers: { "content-length": String(2 * 1024 * 1024 + 1) } },
        ),
      ),
    )

    await expect(
      verifyApplicationAccessToken(signedApplicationToken(), {
        issuerUrl: APPLICATION_ISSUER,
      }),
    ).resolves.toBeNull()
  })

  it("cancels a non-success JWKS response body", async () => {
    const cancelled = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              cancel: cancelled,
            }),
            { status: 503 },
          ),
      ),
    )

    await expect(
      verifyApplicationAccessToken(signedApplicationToken(), {
        issuerUrl: APPLICATION_ISSUER,
      }),
    ).resolves.toBeNull()
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it("refreshes a cached JWKS document for a newly rotated key", async () => {
    const rotatedKeyId = "rotated-application-realm-key"
    const rotated = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const rotatedJwk = rotated.publicKey.export({
      format: "jwk",
    }) as Record<string, unknown>
    Object.assign(rotatedJwk, {
      alg: "RS256",
      kid: rotatedKeyId,
      use: "sig",
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ keys: [signingJwk] }))
      .mockResolvedValueOnce(Response.json({ keys: [signingJwk, rotatedJwk] }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      verifyApplicationAccessToken(signedApplicationToken(), {
        issuerUrl: APPLICATION_ISSUER,
      }),
    ).resolves.toMatchObject({ clientId: APPLICATION_CLIENT_ID })
    await expect(
      verifyApplicationAccessToken(
        signedApplicationToken(
          {},
          { kid: rotatedKeyId, privateKey: rotated.privateKey },
        ),
        { issuerUrl: APPLICATION_ISSUER },
      ),
    ).resolves.toMatchObject({ clientId: APPLICATION_CLIENT_ID })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("applies the configured JWKS TTL to cached signing keys", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ keys: [signingJwk] }))
      .mockResolvedValueOnce(Response.json({ keys: [] }))
    vi.stubGlobal("fetch", fetchMock)
    vi.stubEnv("BFF_JWKS_CACHE_MS", "1")
    const token = signedApplicationToken()

    await expect(
      verifyApplicationAccessToken(token, { issuerUrl: APPLICATION_ISSUER }),
    ).resolves.toMatchObject({ clientId: APPLICATION_CLIENT_ID })
    vi.setSystemTime(new Date("2026-07-31T12:00:00.002Z"))
    await expect(
      verifyApplicationAccessToken(token, { issuerUrl: APPLICATION_ISSUER }),
    ).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("bounds unknown kid length and prunes the capped negative cache", async () => {
    const fetchMock = stubApplicationJwks()

    await expect(
      verifyApplicationAccessToken(unsignedApplicationToken("x".repeat(257)), {
        issuerUrl: APPLICATION_ISSUER,
      }),
    ).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()

    for (let index = 0; index < 1100; index += 1) {
      await expect(
        verifyApplicationAccessToken(
          unsignedApplicationToken(`unknown-kid-${index}`),
          { issuerUrl: APPLICATION_ISSUER },
        ),
      ).resolves.toBeNull()
    }
    expect(getJwksCacheSizesForTest()).toEqual({ negativeKidEntries: 1024 })

    vi.setSystemTime(new Date("2026-07-31T12:01:01.000Z"))
    await expect(
      verifyApplicationAccessToken(
        unsignedApplicationToken("unknown-kid-after-expiry"),
        { issuerUrl: APPLICATION_ISSUER },
      ),
    ).resolves.toBeNull()
    expect(getJwksCacheSizesForTest()).toEqual({ negativeKidEntries: 1 })
  })

  it("keeps the 300-second Application policy out of human JWT validation", async () => {
    const now = currentTimeSeconds()
    const token = signedApplicationToken({
      azp: "console-web",
      client_id: "console-web",
      exp: now + 3600,
      iat: now,
      iss: HUMAN_ISSUER,
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ keys: [signingJwk] })),
    )

    await expect(
      verifyKeycloakJwt(token, {
        keycloakAudience: "console-bff",
        keycloakIssuerUrl: HUMAN_ISSUER,
      }),
    ).resolves.toMatchObject({ subject: APPLICATION_SUBJECT })
  })
})

function signedApplicationToken(
  overrides: Partial<ApplicationTokenClaims> = {},
  signingIdentity: { kid: string; privateKey: KeyObject } = {
    kid: SIGNING_KEY_ID,
    privateKey,
  },
): string {
  const now = currentTimeSeconds()
  const header = encoded({
    alg: "RS256",
    kid: signingIdentity.kid,
    typ: "JWT",
  })
  const payload = encoded({
    aud: "console-bff",
    azp: APPLICATION_CLIENT_ID,
    client_id: APPLICATION_CLIENT_ID,
    exp: now + 300,
    iat: now,
    iss: APPLICATION_ISSUER,
    nbf: now,
    sub: APPLICATION_SUBJECT,
    typ: "Bearer",
    ...overrides,
  })
  const content = `${header}.${payload}`
  const signer = createSign("RSA-SHA256")
  signer.update(content)
  signer.end()
  return `${content}.${signer.sign(signingIdentity.privateKey).toString("base64url")}`
}

function stubApplicationJwks() {
  const fetchMock = vi.fn<typeof fetch>()
  fetchMock.mockResolvedValue(Response.json({ keys: [signingJwk] }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function unsignedApplicationToken(kid: string): string {
  const now = currentTimeSeconds()
  return [
    encoded({ alg: "RS256", kid, typ: "JWT" }),
    encoded({
      aud: "console-bff",
      azp: APPLICATION_CLIENT_ID,
      client_id: APPLICATION_CLIENT_ID,
      exp: now + 300,
      iat: now,
      iss: APPLICATION_ISSUER,
      nbf: now,
      sub: APPLICATION_SUBJECT,
      typ: "Bearer",
    }),
    Buffer.from("invalid-signature").toString("base64url"),
  ].join(".")
}

function currentTimeSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}
