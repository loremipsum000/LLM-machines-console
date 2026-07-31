import { createSign, generateKeyPairSync } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { resetJwksCachesForTest, verifyKeycloakJwt } from "./keycloak-jwt"

describe("Keycloak bearer-token type boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetJwksCachesForTest()
  })

  it.each([
    ["Refresh", Math.floor(Date.now() / 1000) + 300],
    ["Offline", Math.floor(Date.now() / 1000) + 300],
    ["Bearer", undefined],
    ["Bearer", 1.5],
  ])("rejects payload type %s with expiration %s", async (typ, exp) => {
    const issuer = "https://keycloak.example.test/realms/llm-machines"
    const signed = signedToken({ exp, issuer, typ })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ keys: [signed.jwk] })),
    )

    await expect(
      verifyKeycloakJwt(signed.token, {
        keycloakAudience: "console-bff",
        keycloakIssuerUrl: issuer,
      }),
    ).resolves.toBeNull()
  })

  it("accepts a signed, unexpired Bearer access token", async () => {
    const issuer = "https://keycloak.example.test/realms/llm-machines"
    const signed = signedToken({
      exp: Math.floor(Date.now() / 1000) + 300,
      issuer,
      typ: "Bearer",
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ keys: [signed.jwk] })),
    )

    await expect(
      verifyKeycloakJwt(signed.token, {
        keycloakAudience: "console-bff",
        keycloakIssuerUrl: issuer,
      }),
    ).resolves.toMatchObject({ subject: "subject-1" })
  })
})

function signedToken(input: {
  exp: number | undefined
  issuer: string
  typ: string
}) {
  const kid = `kid-${input.typ.toLowerCase()}`
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  })
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>
  Object.assign(jwk, { alg: "RS256", kid, use: "sig" })
  const header = encoded({ alg: "RS256", kid, typ: "JWT" })
  const payload = encoded({
    aud: "console-bff",
    exp: input.exp,
    iss: input.issuer,
    realm_access: { roles: ["admin"] },
    sub: "subject-1",
    typ: input.typ,
  })
  const content = `${header}.${payload}`
  const signer = createSign("RSA-SHA256")
  signer.update(content)
  signer.end()
  return {
    jwk,
    token: `${content}.${signer.sign(privateKey).toString("base64url")}`,
  }
}

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}
