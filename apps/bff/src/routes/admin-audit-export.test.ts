import { generateKeyPairSync } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import {
  emitAudit,
  getAuditEventsForTest,
  resetAuditEventsForTest,
} from "../services/audit"

const adminHeaders = identityHeaders("admin", "admin-export-route")
const operatorHeaders = identityHeaders("operator", "operator-export-route")
const temporaryDirectories: string[] = []

describe("Admin signed audit export routes", () => {
  afterEach(async () => {
    vi.unstubAllEnvs()
    resetAuditEventsForTest()
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((path) => rm(path, { force: true, recursive: true })),
    )
  })

  it("allows Admin export and public-key download with signed paging authority", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const signing = await signingFixture()
    vi.stubEnv("AUDIT_EXPORT_SIGNING_ACTIVE_KID", signing.kid)
    vi.stubEnv("AUDIT_EXPORT_SIGNING_PRIVATE_KEY_FILE", signing.privateKeyFile)
    vi.stubEnv("AUDIT_EXPORT_SIGNING_PUBLIC_JWKS_FILE", signing.publicJwksFile)
    await emitAudit({
      action: "admin.audit.tested",
      correlationId: "route-export-event",
      outcome: "succeeded",
      sourceSystem: "console",
    })
    const to = new Date()
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1_000)
    const server = buildServer()

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

async function signingFixture() {
  const directory = await mkdtemp(join(tmpdir(), "audit-route-signing-"))
  temporaryDirectories.push(directory)
  const keys = generateKeyPairSync("ed25519")
  const kid = "audit-route-test"
  const privateKeyFile = join(directory, "private.pem")
  const publicJwksFile = join(directory, "public.jwks.json")
  const publicJwk = keys.publicKey.export({ format: "jwk" })
  await writeFile(
    privateKeyFile,
    keys.privateKey.export({ format: "pem", type: "pkcs8" }),
    { mode: 0o600 },
  )
  await writeFile(
    publicJwksFile,
    JSON.stringify({
      keys: [
        {
          alg: "EdDSA",
          crv: "Ed25519",
          kid,
          kty: "OKP",
          use: "sig",
          x: publicJwk.x,
        },
      ],
    }),
  )
  return { kid, privateKeyFile, publicJwksFile }
}

function identityHeaders(role: "admin" | "operator", subject: string) {
  return {
    authorization: "Bearer test-service-key",
    "x-llm-machines-keycloak-token": "",
    "x-llm-machines-user-sub": subject,
    "x-llm-machines-user-roles": role,
  }
}
