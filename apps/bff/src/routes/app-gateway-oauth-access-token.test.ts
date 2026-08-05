import { createSign, generateKeyPairSync } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { resetJwksCachesForTest } from "../auth/keycloak-jwt"
import { buildServer } from "../index"
import { resetConnectedAppsForTest } from "../services/admin-connected-apps"
import {
  getAuditEventsForTest,
  resetAuditEventsForTest,
} from "../services/audit"
import { resetIdempotencyForTest } from "../services/idempotency"
import { resetIdentityMutationJournalForTest } from "../services/identity-mutation-journal"

const APPLICATION_ISSUER =
  "https://keycloak.example.test/realms/llm-machines-applications"
const HUMAN_ISSUER = "https://keycloak.example.test/realms/llm-machines"
const KEY_ID = "shared-realm-key-id"
const KEYCLOAK_SUBJECT_ID = "application-service-account-subject"
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
})
const signingJwk = publicKey.export({ format: "jwk" }) as Record<
  string,
  unknown
>
Object.assign(signingJwk, { alg: "RS256", kid: KEY_ID, use: "sig" })

const adminHeaders = {
  authorization: "Bearer test-service-key",
  "x-llm-machines-keycloak-token": "",
  "x-llm-machines-user-email": "admin@example.test",
  "x-llm-machines-user-roles": "admin",
  "x-llm-machines-user-sub": "admin-1",
}

describe("Application-realm OAuth gateway authentication", () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    resetJwksCachesForTest()
    resetAuditEventsForTest()
    resetIdempotencyForTest()
    resetIdentityMutationJournalForTest()
    await resetConnectedAppsForTest()
  })

  it("accepts a signed Application token, rejects a human token, and retains metadata only", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("PRODUCT_IDENTITY_HOST", "keycloak.example.test")
    vi.stubEnv("KEYCLOAK_APPLICATION_ISSUER_URL", APPLICATION_ISSUER)
    vi.stubEnv("KEYCLOAK_ISSUER_URL", HUMAN_ISSUER)
    vi.stubEnv("KEYCLOAK_AUDIENCE", "console-bff")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")

    const requestedUrls: string[] = []
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      requestedUrls.push(url)
      if (
        url === `${APPLICATION_ISSUER}/protocol/openid-connect/certs` ||
        url === `${HUMAN_ISSUER}/protocol/openid-connect/certs`
      ) {
        return Response.json({ keys: [signingJwk] })
      }
      if (url === "http://litellm.test/v1/models") {
        return Response.json({
          data: [{ id: "local-a", object: "model", owned_by: "llm-machines" }],
          object: "list",
        })
      }
      throw new Error(`Unexpected fetch URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const server = buildServer()
    const createdResponse = await server.inject({
      headers: {
        ...adminHeaders,
        "idempotency-key": "create-real-oauth-gateway-application",
      },
      method: "POST",
      payload: {
        allowedModels: ["local-a"],
        authMethod: "oauth_client_credentials",
        description: "Signed OAuth gateway integration test.",
        name: "Signed OAuth Gateway",
      },
      url: "/api/admin/applications/connected-apps",
    })
    expect(createdResponse.statusCode, createdResponse.body).toBe(201)
    const created = createdResponse.json() as {
      app: { id: string }
      credential: {
        clientId: string
        clientSecret: string
        credentialId: string
      }
    }
    const applicationToken = signedAccessToken({
      clientId: created.credential.clientId,
      issuer: APPLICATION_ISSUER,
    })
    const humanToken = signedAccessToken({
      clientId: created.credential.clientId,
      issuer: HUMAN_ISSUER,
    })

    const accepted = await server.inject({
      headers: { authorization: `Bearer ${applicationToken}` },
      method: "GET",
      url: "/api/app-gateway/v1/models",
    })
    const rejected = await server.inject({
      headers: { authorization: `Bearer ${humanToken}` },
      method: "GET",
      url: "/api/app-gateway/v1/models",
    })

    expect(accepted.statusCode).toBe(200)
    expect(accepted.json()).toEqual({
      data: [{ id: "local-a", object: "model", owned_by: "llm-machines" }],
      object: "list",
    })
    expect(rejected.statusCode).toBe(401)
    expect(rejected.json()).toMatchObject({
      title: "Invalid connected app token",
    })
    expect(requestedUrls).toEqual([
      `${APPLICATION_ISSUER}/protocol/openid-connect/certs`,
      "http://litellm.test/v1/models",
    ])

    const gatewayEvents = getAuditEventsForTest().filter(
      (event) => event.action === "connected_app.gateway.models",
    )
    expect(gatewayEvents).toHaveLength(1)
    expect(gatewayEvents[0]).toMatchObject({
      actorId: KEYCLOAK_SUBJECT_ID,
      metadata: {
        applicationId: created.app.id,
        correlationId: expect.any(String),
        credentialRecordId: created.credential.credentialId,
        keycloakSubjectId: KEYCLOAK_SUBJECT_ID,
        outcome: "succeeded",
        sourceSystem: "console",
      },
    })
    const auditText = JSON.stringify(getAuditEventsForTest())
    expect(auditText).not.toContain(applicationToken)
    expect(auditText).not.toContain(humanToken)
    expect(auditText).not.toContain(created.credential.clientSecret)
    expect(auditText).not.toContain('"azp"')
    expect(auditText).not.toContain('"aud"')
    expect(auditText).not.toContain('"iat"')

    await server.close()
  })
})

function signedAccessToken(input: {
  clientId: string
  issuer: string
}): string {
  const now = Math.floor(Date.now() / 1000)
  const header = encoded({ alg: "RS256", kid: KEY_ID, typ: "JWT" })
  const payload = encoded({
    aud: "console-bff",
    azp: input.clientId,
    client_id: input.clientId,
    exp: now + 300,
    iat: now,
    iss: input.issuer,
    nbf: now,
    sub: KEYCLOAK_SUBJECT_ID,
    typ: "Bearer",
  })
  const content = `${header}.${payload}`
  const signer = createSign("RSA-SHA256")
  signer.update(content)
  signer.end()
  return `${content}.${signer.sign(privateKey).toString("base64url")}`
}

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}
