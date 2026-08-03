import { generateKeyPairSync } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import {
  emitAudit,
  getAuditEventsForTest,
  resetAuditEventsForTest,
} from "../services/audit"
import type { AuditExportSigningMaterial } from "../services/audit-export-signing"

const adminHeaders = identityHeaders("admin", "admin-export-route")
const operatorHeaders = identityHeaders("operator", "operator-export-route")
describe("Admin signed audit export routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    resetAuditEventsForTest()
  })

  it("allows Admin export and public-key download with signed paging authority", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const signing = signingFixture()
    await emitAudit({
      action: "admin.audit.tested",
      correlationId: "route-export-event",
      outcome: "succeeded",
      sourceSystem: "console",
    })
    const to = new Date()
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1_000)
    const server = buildServer({
      testAuditExportSigningMaterial: signing.material,
    })

    const response = await server.inject({
      method: "GET",
      url: `/api/admin/audit/export?format=json&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      headers: adminHeaders,
    })
    const keys = await server.inject({
      method: "GET",
      url: "/api/admin/audit/export/verification-keys",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toMatch(/^application\/jose/)
    expect(response.headers["x-llm-machines-audit-format"]).toBe("json")
    const [encodedHeader] = response.body.split(".")
    const protectedHeader = JSON.parse(
      Buffer.from(encodedHeader ?? "", "base64url").toString("utf8"),
    )
    expect(protectedHeader).toMatchObject({
      alg: "EdDSA",
      kid: signing.kid,
      llmAudit: {
        order: "occurred_at_asc,id_asc",
        range: { from: from.toISOString(), to: to.toISOString() },
        rowCount: 1,
      },
      llmSigning: {
        issuer: signing.material.issuerId,
        purpose: "audit-export",
        schemaVersion: 1,
      },
      typ: "LLM-MACHINES-AUDIT-EXPORT-V1",
    })
    expect(protectedHeader).not.toHaveProperty("jwk")
    expect(protectedHeader).not.toHaveProperty("jku")
    expect(keys.statusCode).toBe(200)
    expect(keys.json()).toMatchObject({
      activeKid: signing.kid,
      keys: [{ kid: signing.kid }],
    })
    expect(getAuditEventsForTest().map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "admin.audit.export",
        "admin.audit.verification_keys.read",
      ]),
    )
    await server.close()
  })

  it("denies Operator and isolates missing signing material to export routes", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const now = new Date(Date.now() - 1_000)
    const from = new Date(now.getTime() - 60_000)
    const server = buildServer()
    const url = `/api/admin/audit/export?format=csv&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(now.toISOString())}`

    const operatorExport = await server.inject({
      method: "GET",
      url,
      headers: operatorHeaders,
    })
    const adminExport = await server.inject({
      method: "GET",
      url,
      headers: adminHeaders,
    })
    const overview = await server.inject({
      method: "GET",
      url: "/api/admin/overview",
      headers: adminHeaders,
    })

    expect(operatorExport.statusCode).toBe(403)
    expect(adminExport.statusCode).toBe(503)
    expect(overview.statusCode).toBe(200)
    await server.close()
  })
})

function signingFixture(): {
  kid: string
  material: AuditExportSigningMaterial
} {
  const keys = generateKeyPairSync("ed25519")
  const kid = "audit-route-test"
  const publicJwk = keys.publicKey.export({ format: "jwk" })
  const applianceId = "01234567-89ab-4def-8123-456789abcdef"
  return {
    kid,
    material: {
      activeKid: kid,
      applianceId,
      issuerId: `urn:llm-machines:customer-appliance:${applianceId}`,
      privateKey: keys.privateKey,
      purpose: "audit-export",
      verificationKeys: {
        activeKid: kid,
        keys: [
          {
            alg: "EdDSA",
            crv: "Ed25519",
            kid,
            kty: "OKP",
            use: "sig",
            x: publicJwk.x ?? "",
          },
        ],
      },
    },
  }
}

function identityHeaders(role: "admin" | "operator", subject: string) {
  return {
    authorization: "Bearer test-service-key",
    "x-llm-machines-keycloak-token": "",
    "x-llm-machines-user-sub": subject,
    "x-llm-machines-user-roles": role,
  }
}
