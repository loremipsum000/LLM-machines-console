import { generateKeyPairSync, verify } from "node:crypto"
import { readFileSync } from "node:fs"
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  AuditExportSigningUnavailableError,
  loadAuditExportSigningMaterial,
  signAuditExport,
} from "./audit-export-signing"

const temporaryDirectories: string[] = []

describe("audit export Ed25519 signing", () => {
  afterEach(async () => {
    vi.unstubAllEnvs()
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((path) => rm(path, { force: true, recursive: true })),
    )
  })

  it("emits compact JWS without embedded key material and retains old public keys", async () => {
    const fixture = await signingFixture()
    const material = await loadAuditExportSigningMaterial(fixture.config)
    const payload = Buffer.from('{"schemaVersion":1}', "utf8")

    const compact = signAuditExport(
      payload,
      "application/json",
      material,
      authority(),
    )
    const [encodedHeader, encodedPayload, encodedSignature] = compact.split(".")
    const header = JSON.parse(
      Buffer.from(encodedHeader ?? "", "base64url").toString("utf8"),
    )

    expect(header).toEqual({
      alg: "EdDSA",
      cty: "application/json",
      kid: "audit-2026-08",
      llmAudit: authority(),
      typ: "LLM-MACHINES-AUDIT-EXPORT-V1",
    })
    expect(header).not.toHaveProperty("jwk")
    expect(header).not.toHaveProperty("jku")
    expect(Buffer.from(encodedPayload ?? "", "base64url")).toEqual(payload)
    expect(
      verify(
        null,
        Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii"),
        fixture.publicKey,
        Buffer.from(encodedSignature ?? "", "base64url"),
      ),
    ).toBe(true)
    expect(material.verificationKeys.keys.map((key) => key.kid)).toEqual([
      "audit-2026-07",
      "audit-2026-08",
    ])
  })

  it("fails closed when the active JWKS key does not match the private key", async () => {
    const fixture = await signingFixture({ mismatchActiveKey: true })

    await expect(
      loadAuditExportSigningMaterial(fixture.config),
    ).rejects.toBeInstanceOf(AuditExportSigningUnavailableError)
  })

  it("does not accept private JWK material in the public JWKS file", async () => {
    const fixture = await signingFixture({ includePrivateJwk: true })

    await expect(
      loadAuditExportSigningMaterial(fixture.config),
    ).rejects.toBeInstanceOf(AuditExportSigningUnavailableError)
  })

  it("rejects final-component symlinks and writable public key sets", async () => {
    const symlinkFixture = await signingFixture()
    const linkedPrivateKey = join(
      symlinkFixture.config.privateKeyFile.replace(/\/[^/]+$/, ""),
      "private-link.pem",
    )
    await symlink(symlinkFixture.config.privateKeyFile, linkedPrivateKey)
    await expect(
      loadAuditExportSigningMaterial({
        ...symlinkFixture.config,
        privateKeyFile: linkedPrivateKey,
      }),
    ).rejects.toBeInstanceOf(AuditExportSigningUnavailableError)

    const writableFixture = await signingFixture()
    await chmod(writableFixture.config.publicJwksFile, 0o664)
    await expect(
      loadAuditExportSigningMaterial(writableFixture.config),
    ).rejects.toBeInstanceOf(AuditExportSigningUnavailableError)
  })

  it("zeroes private source bytes after O_NOFOLLOW descriptor loading", () => {
    const source = readFileSync(
      new URL("audit-export-signing.ts", import.meta.url),
      "utf8",
    )
    expect(source).toContain("constants.O_RDONLY | constants.O_NOFOLLOW")
    expect(source).toContain("privateKeyBytes.fill(0)")
    expect(source).toContain("(metadata.mode & 0o077) !== 0")
    expect(source).toContain("(metadata.mode & 0o022) !== 0")
  })
})

function authority() {
  return {
    exportedAt: "2026-08-01T12:00:00.000Z",
    filters: {
      applicationId: null,
      eventId: null,
      outcome: null,
      querySha256: null,
      severity: null,
      sourceSystem: null,
    },
    nextCursor: null,
    order: "occurred_at_asc,id_asc",
    range: {
      from: "2026-07-01T12:00:00.000Z",
      to: "2026-08-01T12:00:00.000Z",
    },
    requestedCursor: null,
    rowCount: 1,
    schemaVersion: 1,
  } as const
}

async function signingFixture(
  options: { includePrivateJwk?: boolean; mismatchActiveKey?: boolean } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "audit-signing-test-"))
  temporaryDirectories.push(directory)
  const active = generateKeyPairSync("ed25519")
  const mismatch = generateKeyPairSync("ed25519")
  const old = generateKeyPairSync("ed25519")
  const privateKeyFile = join(directory, "active.pem")
  const publicJwksFile = join(directory, "public.jwks.json")
  await writeFile(
    privateKeyFile,
    active.privateKey.export({ format: "pem", type: "pkcs8" }),
    { mode: 0o600 },
  )
  const activePublic = (
    options.mismatchActiveKey ? mismatch.publicKey : active.publicKey
  ).export({ format: "jwk" })
  const oldPublic = old.publicKey.export({ format: "jwk" })
  const activeKey = {
    alg: "EdDSA",
    crv: "Ed25519",
    kid: "audit-2026-08",
    kty: "OKP",
    use: "sig",
    x: activePublic.x,
    ...(options.includePrivateJwk ? { d: "private-material" } : {}),
  }
  await writeFile(
    publicJwksFile,
    JSON.stringify({
      keys: [
        activeKey,
        {
          alg: "EdDSA",
          crv: "Ed25519",
          kid: "audit-2026-07",
          kty: "OKP",
          use: "sig",
          x: oldPublic.x,
        },
      ],
    }),
  )
  return {
    config: {
      activeKid: "audit-2026-08",
      privateKeyFile,
      publicJwksFile,
    },
    publicKey: active.publicKey,
  }
}
