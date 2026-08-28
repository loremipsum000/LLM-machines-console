import { type KeyObject, createSign, generateKeyPairSync } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createConsoleTokenValidator } from "./console-session-token-validator"

const now = new Date("2026-08-02T10:00:00.000Z")
const nowSeconds = Math.floor(now.getTime() / 1000)
const issuer = "https://console.example.test/identity/realms/appliance"
const config = {
  accessAudience: "console-bff",
  clientId: "console-web",
  issuer,
  jwksUrl: "https://keycloak.internal/realms/appliance/certs",
}

describe("cryptographic Console identity token authority", () => {
  afterEach(() => vi.restoreAllMocks())

  it("verifies access and ID token signature, issuer, audience, expiry, and nonce", async () => {
    const signer = signingFixture("identity-key")
    const request = vi.fn(async () => Response.json({ keys: [signer.jwk] }))
    const validator = createConsoleTokenValidator(config, request, () => now)

    await expect(
      validator.validate(
        {
          accessToken: signer.token(accessClaims()),
          idToken: signer.token({
            aud: "console-web",
            exp: nowSeconds + 300,
            iat: nowSeconds,
            iss: issuer,
            nonce: "expected-nonce",
            sub: "operator-1",
          }),
          refreshToken: "server-only-refresh",
        },
        "expected-nonce",
      ),
    ).resolves.toMatchObject({
      identity: {
        keycloakSessionId: "keycloak-session-1",
        role: "operator",
        subject: "operator-1",
      },
      state: "valid",
    })
  })

  it("rejects a forged ID-token payload even when nonce and claims look valid", async () => {
    const trusted = signingFixture("identity-key")
    const attacker = signingFixture("identity-key")
    const validator = createConsoleTokenValidator(
      config,
      vi.fn(async () => Response.json({ keys: [trusted.jwk] })),
      () => now,
    )

    await expect(
      validator.validate(
        {
          accessToken: trusted.token(accessClaims()),
          idToken: attacker.token({
            aud: "console-web",
            exp: nowSeconds + 300,
            iat: nowSeconds,
            iss: issuer,
            nonce: "expected-nonce",
            sub: "operator-1",
          }),
          refreshToken: "server-only-refresh",
        },
        "expected-nonce",
      ),
    ).resolves.toEqual({ state: "invalid" })
  })

  it("rejects offline scope and a token issued to another authorized party", async () => {
    const signer = signingFixture("identity-key")
    const validator = createConsoleTokenValidator(
      config,
      vi.fn(async () => Response.json({ keys: [signer.jwk] })),
      () => now,
    )

    await expect(
      validator.validate({
        accessToken: signer.token({
          ...accessClaims(),
          scope: "openid offline_access",
        }),
        refreshToken: "server-only-refresh",
      }),
    ).resolves.toMatchObject({
      identity: { offlineAccess: true },
      state: "valid",
    })
    await expect(
      validator.validate({
        accessToken: signer.token({
          ...accessClaims(),
          azp: "another-client",
        }),
        refreshToken: "server-only-refresh",
      }),
    ).resolves.toEqual({ state: "invalid" })
  })

  it("rejects oversized JWT input and non-signing JWK metadata", async () => {
    const signer = signingFixture("identity-key")
    const nonSigningJwk = { ...signer.jwk, use: "enc" }
    const validator = createConsoleTokenValidator(
      config,
      vi.fn(async () => Response.json({ keys: [nonSigningJwk] })),
      () => now,
    )

    await expect(
      validator.validate({
        accessToken: "A".repeat(64 * 1024 + 1),
        refreshToken: "server-only-refresh",
      }),
    ).resolves.toEqual({ state: "invalid" })
    await expect(
      validator.validate({
        accessToken: signer.token(accessClaims()),
        refreshToken: "server-only-refresh",
      }),
    ).resolves.toEqual({ state: "invalid" })
  })

  it.each([
    [503, "identity_restart"],
    [502, "identity_unavailable"],
  ] as const)(
    "preserves a retryable %s JWKS failure",
    async (status, reason) => {
      const signer = signingFixture("identity-key")
      const validator = createConsoleTokenValidator(
        config,
        vi.fn(async () => new Response(null, { status })),
        () => now,
      )

      await expect(
        validator.validate({
          accessToken: signer.token(accessClaims()),
          refreshToken: "server-only-refresh",
        }),
      ).resolves.toEqual({ reason, state: "unavailable" })
    },
  )

  it("uses a warm bounded public-key cache during a JWKS outage", async () => {
    let clock = new Date(now)
    const signer = signingFixture("identity-key")
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ keys: [signer.jwk] }))
      .mockResolvedValue(new Response(null, { status: 502 }))
    const validator = createConsoleTokenValidator(config, request, () => clock)

    await expect(validator.readiness()).resolves.toEqual({ state: "ready" })
    clock = new Date(clock.getTime() + 5 * 60 * 1000 + 1)
    await expect(validator.readiness()).resolves.toEqual({ state: "ready" })
    await expect(
      validator.validate({
        accessToken: signer.token({
          ...accessClaims(),
          exp: Math.floor(clock.getTime() / 1000) + 300,
          iat: Math.floor(clock.getTime() / 1000),
        }),
        refreshToken: "server-only-refresh",
      }),
    ).resolves.toMatchObject({ state: "valid" })
  })

  it("reports restart as retryable readiness when no public key is cached", async () => {
    const validator = createConsoleTokenValidator(
      config,
      vi.fn(async () => new Response(null, { status: 503 })),
      () => now,
    )
    await expect(validator.readiness()).resolves.toEqual({
      reason: "identity_restart",
      state: "unavailable",
    })
  })

  it("cryptographically verifies bounded back-channel logout claims", async () => {
    const signer = signingFixture("logout-key")
    const validator = createConsoleTokenValidator(
      config,
      vi.fn(async () => Response.json({ keys: [signer.jwk] })),
      () => now,
    )
    const claims = logoutClaims()

    await expect(validator.verify(signer.token(claims))).resolves.toMatchObject(
      {
        jti: "logout-jti-1",
        keycloakSessionId: "keycloak-session-1",
      },
    )
    const attacker = signingFixture("logout-key")
    await expect(validator.verify(attacker.token(claims))).resolves.toBeNull()
    await expect(
      validator.verify(signer.token({ ...claims, nonce: "not-allowed" })),
    ).resolves.toBeNull()
  })

  it.each([
    [503, "identity_restart"],
    [502, "identity_unavailable"],
  ] as const)(
    "preserves retryable back-channel logout verification failure %s",
    async (status, reason) => {
      const signer = signingFixture("logout-key")
      const validator = createConsoleTokenValidator(
        config,
        vi.fn(async () => new Response(null, { status })),
        () => now,
      )

      await expect(
        validator.verify(signer.token(logoutClaims())),
      ).resolves.toEqual({
        reason,
        retryable: true,
        state: "unavailable",
      })
    },
  )
})

function accessClaims() {
  return {
    amr: ["webauthn-passwordless"],
    aud: "console-bff",
    auth_time: nowSeconds,
    azp: "console-web",
    email: "operator@example.test",
    exp: nowSeconds + 300,
    groups: ["Operations"],
    iat: nowSeconds,
    iss: issuer,
    realm_access: { roles: ["operator"] },
    sid: "keycloak-session-1",
    sub: "operator-1",
    typ: "Bearer",
  }
}

function logoutClaims() {
  return {
    aud: "console-web",
    events: {
      "http://schemas.openid.net/event/backchannel-logout": {},
    },
    exp: nowSeconds + 60,
    iat: nowSeconds,
    iss: issuer,
    jti: "logout-jti-1",
    sid: "keycloak-session-1",
  }
}

function signingFixture(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  })
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>
  Object.assign(jwk, { alg: "RS256", kid, use: "sig" })
  return {
    jwk,
    token: (payload: Record<string, unknown>) =>
      signToken(privateKey, kid, payload),
  }
}

function signToken(
  privateKey: KeyObject,
  kid: string,
  payload: Record<string, unknown>,
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid, typ: "JWT" }),
  ).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const content = `${header}.${body}`
  const signer = createSign("RSA-SHA256")
  signer.update(content)
  signer.end()
  return `${content}.${signer.sign(privateKey).toString("base64url")}`
}
