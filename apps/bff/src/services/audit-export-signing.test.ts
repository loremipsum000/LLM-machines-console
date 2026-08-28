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

  it("emits purpose-and-issuer-bound JWS without embedded key material", async () => {
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
      llmSigning: {
        issuer: `urn:llm-machines:customer-appliance:${fixture.applianceId}`,
        purpose: "audit-export",
        schemaVersion: 1,
      },
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

  it("does not accept private JWK material in the mounted trust bundle", async () => {
    const fixture = await signingFixture({ includePrivateMaterial: true })

    await expect(
      loadAuditExportSigningMaterial(fixture.config),
    ).rejects.toBeInstanceOf(AuditExportSigningUnavailableError)
  })

  it("rejects final-component symlinks and writable trust metadata", async () => {
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
    await chmod(writableFixture.config.signingTrustFile, 0o664)
    await expect(
      loadAuditExportSigningMaterial(writableFixture.config),
    ).rejects.toBeInstanceOf(AuditExportSigningUnavailableError)

    const ownerFixture = await signingFixture()
    await expect(
      loadAuditExportSigningMaterial({
        ...ownerFixture.config,
        privateKeyOwnerUid: ownerFixture.config.privateKeyOwnerUid + 1,
      }),
    ).rejects.toBeInstanceOf(AuditExportSigningUnavailableError)
  })

  it("enforces a root-owned private mount and zeroes source bytes", () => {
    const source = readFileSync(
      new URL("audit-export-signing.ts", import.meta.url),
      "utf8",
    )
    expect(source).toContain("constants.O_RDONLY | constants.O_NOFOLLOW")
    expect(source).toContain("privateKeyBytes.fill(0)")
    expect(source).toContain("metadata.uid !== requiredOwnerUid")
    expect(source).toContain("(metadata.mode & 0o077) !== 0")
    expect(source).not.toMatch(/console\.(?:log|error|warn)/)
  })

  it("rejects wrong appliance identity, key purpose, and lifecycle state", async () => {
    const wrongAppliance = await signingFixture()
    await expect(
      loadAuditExportSigningMaterial({
        ...wrongAppliance.config,
        applianceId: "11234567-89ab-4def-8123-456789abcdef",
      }),
    ).rejects.toBeInstanceOf(AuditExportSigningUnavailableError)

    const wrongPurpose = await signingFixture({
      activePurpose: "update-bundle",
    })
    await expect(
      loadAuditExportSigningMaterial(wrongPurpose.config),
    ).rejects.toBeInstanceOf(AuditExportSigningUnavailableError)

    const expired = await signingFixture({
      auditNotAfter: "2026-08-01T00:00:00.000Z",
    })
    await expect(
      loadAuditExportSigningMaterial(expired.config),
    ).rejects.toBeInstanceOf(AuditExportSigningUnavailableError)
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
  options: {
    activePurpose?: "audit-export" | "update-bundle"
    auditNotAfter?: string
    includePrivateMaterial?: boolean
    mismatchActiveKey?: boolean
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "audit-signing-test-"))
  temporaryDirectories.push(directory)
  const active = generateKeyPairSync("ed25519")
  const mismatch = generateKeyPairSync("ed25519")
  const old = generateKeyPairSync("ed25519")
  const privateKeyFile = join(directory, "active.pem")
  const signingTrustFile = join(directory, "signing-trust.json")
  await writeFile(
    privateKeyFile,
    active.privateKey.export({ format: "pem", type: "pkcs8" }),
    { mode: 0o600 },
  )
  const activePublic = (
    options.mismatchActiveKey ? mismatch.publicKey : active.publicKey
  ).export({ format: "jwk" })
  const oldPublic = old.publicKey.export({ format: "jwk" })
  const applianceId = "01234567-89ab-4def-8123-456789abcdef"
  const auditIssuer = `urn:llm-machines:customer-appliance:${applianceId}`
  const activeKey = auditTrustKey({
    applianceId,
    issuerId: auditIssuer,
    kid: "audit-2026-08",
    notAfter: options.auditNotAfter,
    predecessorKid: "audit-2026-07",
    publicKey: activePublic.x ?? "",
    purpose: options.activePurpose,
    rotatedAt: "2026-08-01T00:00:00.000Z",
  })
  if (options.includePrivateMaterial) {
    Object.assign(activeKey.publicKey, { d: "private-material" })
  }
  await writeFile(
    signingTrustFile,
    JSON.stringify({
      dualTrust: [
        {
          endsAt: "2026-08-31T00:00:00.000Z",
          predecessorKid: "audit-2026-07",
          purpose: "audit-export",
          startsAt: "2026-08-01T00:00:00.000Z",
          successorKid: "audit-2026-08",
        },
      ],
      generatedAt: "2026-08-01T00:00:00.000Z",
      keys: [
        vendorTrustKey("vendor-root-2026", "vendor-release-root", "A", null),
        vendorTrustKey(
          "artifact-2026",
          "release-artifact",
          "B",
          "vendor-root-2026",
        ),
        vendorTrustKey("update-2026", "update-bundle", "C", "vendor-root-2026"),
        vendorTrustKey(
          "entitlement-2026",
          "offline-entitlement",
          "D",
          "vendor-root-2026",
        ),
        auditTrustKey({
          applianceId,
          issuerId: auditIssuer,
          kid: "audit-2026-07",
          publicKey: oldPublic.x ?? "",
          rotatedAt: "2026-08-01T00:00:00.000Z",
          state: "retiring",
          successorKid: "audit-2026-08",
        }),
        activeKey,
      ],
      schemaVersion: 1,
    }),
  )
  return {
    applianceId,
    config: {
      activeKid: "audit-2026-08",
      applianceId,
      now: new Date("2026-08-10T00:00:00.000Z"),
      privateKeyFile,
      privateKeyOwnerUid: process.getuid?.() ?? 0,
      signingTrustFile,
      signingTrustOwnerUid: process.getuid?.() ?? 0,
    },
    publicKey: active.publicKey,
  }
}

function vendorTrustKey(
  kid: string,
  purpose:
    | "vendor-release-root"
    | "release-artifact"
    | "update-bundle"
    | "offline-entitlement",
  publicSeed: string,
  signedByKid: string | null,
) {
  return {
    algorithm: "ES256",
    custody: {
      owner: "vendor",
      privateMaterialPresence: {
        appliance: false,
        ciEnvironmentVariables: false,
        cloudDependency: false,
        git: false,
      },
      storage: "offline-hardware-backed",
    },
    issuer: { id: "urn:llm-machines:vendor", kind: "vendor" },
    kid,
    notAfter: "2030-01-01T00:00:00.000Z",
    notBefore: "2026-01-01T00:00:00.000Z",
    predecessorKid: null,
    publicKey: {
      format: "spki-der-base64url",
      value: `${publicSeed.repeat(42)}A`,
    },
    purpose,
    revokedAt: null,
    revocationReason: null,
    rotatedAt: null,
    signedByKid,
    state: "active",
    successorKid: null,
  }
}

function auditTrustKey(input: {
  applianceId: string
  issuerId: string
  kid: string
  notAfter?: string
  predecessorKid?: string | null
  publicKey: string
  purpose?: "audit-export" | "update-bundle"
  rotatedAt?: string | null
  state?: "active" | "retiring"
  successorKid?: string | null
}) {
  return {
    algorithm: "Ed25519",
    custody: {
      applianceId: input.applianceId,
      encryptedAtRest: true,
      owner: "customer",
      privateKeyProvisioning: "root-only-mounted-secret",
      recoveryEnvelope: "customer-held",
      scope: "per-appliance",
      tpmSealing: "required-when-available",
    },
    issuer: { id: input.issuerId, kind: "customer-appliance" },
    kid: input.kid,
    notAfter: input.notAfter ?? "2030-01-01T00:00:00.000Z",
    notBefore: "2026-01-01T00:00:00.000Z",
    predecessorKid: input.predecessorKid ?? null,
    publicKey: { crv: "Ed25519", kty: "OKP", x: input.publicKey },
    purpose: input.purpose ?? "audit-export",
    revokedAt: null,
    revocationReason: null,
    rotatedAt: input.rotatedAt ?? null,
    signedByKid: null,
    state: input.state ?? "active",
    successorKid: input.successorKid ?? null,
  }
}
