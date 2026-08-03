import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { auditExportIssuerId } from "@llm-machines/contracts/inference-core"
import { afterEach, describe, expect, it } from "vitest"
import {
  SigningTrustUnavailableError,
  loadSigningTrustBundle,
  resolveAuditSigningTrust,
} from "./signing-trust"

const applianceId = "01234567-89ab-4def-8123-456789abcdef"
const temporaryDirectories: string[] = []

describe("mounted signing trust", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((path) => rm(path, { force: true, recursive: true })),
    )
  })

  it("loads strict public trust metadata and resolves exact audit custody", async () => {
    const fixture = await trustFile(validBundle())
    const bundle = await loadSigningTrustBundle(fixture.config)
    const trust = resolveAuditSigningTrust(bundle, {
      activeKid: "audit-2026",
      applianceId,
      at: new Date("2026-08-10T00:00:00.000Z"),
    })

    expect(trust).toMatchObject({
      issuerId: auditExportIssuerId(applianceId),
      key: {
        kid: "audit-2026",
        purpose: "audit-export",
        state: "active",
      },
      verificationKeys: { activeKid: "audit-2026" },
    })
    expect(trust.verificationKeys.keys.map((key) => key.kid)).toEqual([
      "audit-2026",
    ])
  })

  it("rejects symlinks, writable metadata, and the wrong mounted-file owner", async () => {
    const linkedFixture = await trustFile(validBundle())
    const link = join(linkedFixture.directory, "trust-link.json")
    await symlink(linkedFixture.config.file, link)
    await expect(
      loadSigningTrustBundle({ ...linkedFixture.config, file: link }),
    ).rejects.toBeInstanceOf(SigningTrustUnavailableError)

    const writableFixture = await trustFile(validBundle())
    await chmod(writableFixture.config.file, 0o664)
    await expect(
      loadSigningTrustBundle(writableFixture.config),
    ).rejects.toBeInstanceOf(SigningTrustUnavailableError)

    const ownerFixture = await trustFile(validBundle())
    await expect(
      loadSigningTrustBundle({
        ...ownerFixture.config,
        requiredOwnerUid: ownerFixture.config.requiredOwnerUid + 1,
      }),
    ).rejects.toBeInstanceOf(SigningTrustUnavailableError)
  })

  it("rejects private material and cross-purpose public-key reuse", async () => {
    const privateMaterial = validBundle()
    Object.assign(privateMaterial.keys[0].publicKey, {
      d: "private-material",
    })
    const privateFixture = await trustFile(privateMaterial)
    await expect(
      loadSigningTrustBundle(privateFixture.config),
    ).rejects.toBeInstanceOf(SigningTrustUnavailableError)

    const sharedMaterial = validBundle()
    sharedMaterial.keys[2].publicKey = {
      ...sharedMaterial.keys[1].publicKey,
    }
    const sharedFixture = await trustFile(sharedMaterial)
    await expect(
      loadSigningTrustBundle(sharedFixture.config),
    ).rejects.toBeInstanceOf(SigningTrustUnavailableError)

    const aliasedMaterial = validBundle()
    Object.assign(aliasedMaterial.keys[2].publicKey, {
      value: `${"B".repeat(42)}B`,
    })
    const aliasedFixture = await trustFile(aliasedMaterial)
    await expect(
      loadSigningTrustBundle(aliasedFixture.config),
    ).rejects.toBeInstanceOf(SigningTrustUnavailableError)
  })

  it("rejects wrong appliance identity and non-audit active key IDs", async () => {
    const fixture = await trustFile(validBundle())
    const bundle = await loadSigningTrustBundle(fixture.config)

    expect(() =>
      resolveAuditSigningTrust(bundle, {
        activeKid: "audit-2026",
        applianceId: "11234567-89ab-4def-8123-456789abcdef",
        at: new Date("2026-08-10T00:00:00.000Z"),
      }),
    ).toThrow(SigningTrustUnavailableError)
    expect(() =>
      resolveAuditSigningTrust(bundle, {
        activeKid: "update-2026",
        applianceId,
        at: new Date("2026-08-10T00:00:00.000Z"),
      }),
    ).toThrow(SigningTrustUnavailableError)
  })

  it("projects a retiring key only during its bounded dual-trust window", async () => {
    const fixture = await trustFile(rotationBundle())
    const bundle = await loadSigningTrustBundle(fixture.config)

    expect(
      resolveAuditSigningTrust(bundle, {
        activeKid: "audit-2026-09",
        applianceId,
        at: new Date("2026-08-02T00:00:00.000Z"),
      }).verificationKeys.keys.map((key) => key.kid),
    ).toEqual(["audit-2026", "audit-2026-09"])
    expect(
      resolveAuditSigningTrust(bundle, {
        activeKid: "audit-2026-09",
        applianceId,
        at: new Date("2026-08-10T00:00:00.000Z"),
      }).verificationKeys.keys.map((key) => key.kid),
    ).toEqual(["audit-2026", "audit-2026-09"])
    expect(
      resolveAuditSigningTrust(bundle, {
        activeKid: "audit-2026-09",
        applianceId,
        at: new Date("2026-09-02T00:00:00.000Z"),
      }).verificationKeys.keys.map((key) => key.kid),
    ).toEqual(["audit-2026-09"])
  })

  it("rejects trust bundles with future, expired, or transition-gapped rotation windows", async () => {
    const future = rotationBundle()
    future.dualTrust[0].startsAt = "2026-09-01T00:00:00.000Z"
    future.dualTrust[0].endsAt = "2026-09-15T00:00:00.000Z"

    const expired = rotationBundle()
    expired.dualTrust[0].startsAt = "2026-07-01T00:00:00.000Z"
    expired.dualTrust[0].endsAt = "2026-07-15T00:00:00.000Z"
    expired.keys[4].rotatedAt = expired.dualTrust[0].startsAt
    expired.keys[5].rotatedAt = expired.dualTrust[0].startsAt

    const transitionGap = rotationBundle()
    transitionGap.keys[5].rotatedAt = "2026-08-01T00:00:00.000Z"

    for (const bundle of [future, expired, transitionGap]) {
      const fixture = await trustFile(bundle)
      await expect(
        loadSigningTrustBundle(fixture.config),
      ).rejects.toBeInstanceOf(SigningTrustUnavailableError)
    }
  })
})

async function trustFile(bundle: ReturnType<typeof validBundle>) {
  const directory = await mkdtemp(join(tmpdir(), "signing-trust-test-"))
  temporaryDirectories.push(directory)
  const file = join(directory, "signing-trust.json")
  await writeFile(file, JSON.stringify(bundle), { mode: 0o644 })
  return {
    config: { file, requiredOwnerUid: process.getuid?.() ?? 0 },
    directory,
  }
}

function validBundle() {
  return {
    dualTrust: [] as Array<{
      endsAt: string
      predecessorKid: string
      purpose: string
      startsAt: string
      successorKid: string
    }>,
    generatedAt: "2026-08-02T00:00:00.000Z",
    keys: [
      vendorKey("vendor-root-2026", "vendor-release-root", "A", null),
      vendorKey("artifact-2026", "release-artifact", "B", "vendor-root-2026"),
      vendorKey("update-2026", "update-bundle", "C", "vendor-root-2026"),
      vendorKey(
        "entitlement-2026",
        "offline-entitlement",
        "D",
        "vendor-root-2026",
      ),
      auditKey("audit-2026", "E"),
    ],
    schemaVersion: 1,
  }
}

function rotationBundle() {
  const bundle = validBundle()
  const predecessor = bundle.keys[4]
  predecessor.state = "retiring"
  predecessor.successorKid = "audit-2026-09"
  predecessor.rotatedAt = "2026-08-02T00:00:00.000Z"
  const successor = auditKey("audit-2026-09", "F")
  successor.predecessorKid = predecessor.kid
  successor.rotatedAt = "2026-08-02T00:00:00.000Z"
  bundle.keys.push(successor)
  bundle.dualTrust.push({
    endsAt: "2026-09-01T00:00:00.000Z",
    predecessorKid: predecessor.kid,
    purpose: "audit-export",
    startsAt: "2026-08-02T00:00:00.000Z",
    successorKid: successor.kid,
  })
  return bundle
}

function vendorKey(
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
    predecessorKid: null as string | null,
    publicKey: {
      format: "spki-der-base64url",
      value: `${publicSeed.repeat(42)}A`,
    },
    purpose,
    revokedAt: null as string | null,
    revocationReason: null as string | null,
    rotatedAt: null as string | null,
    signedByKid,
    state: "active",
    successorKid: null as string | null,
  }
}

function auditKey(kid: string, publicSeed: string) {
  return {
    algorithm: "Ed25519",
    custody: {
      applianceId,
      encryptedAtRest: true,
      owner: "customer",
      privateKeyProvisioning: "root-only-mounted-secret",
      recoveryEnvelope: "customer-held",
      scope: "per-appliance",
      tpmSealing: "required-when-available",
    },
    issuer: {
      id: auditExportIssuerId(applianceId),
      kind: "customer-appliance",
    },
    kid,
    notAfter: "2030-01-01T00:00:00.000Z",
    notBefore: "2026-01-01T00:00:00.000Z",
    predecessorKid: null as string | null,
    publicKey: {
      crv: "Ed25519",
      kty: "OKP",
      x: `${publicSeed.repeat(42)}A`,
    },
    purpose: "audit-export",
    revokedAt: null as string | null,
    revocationReason: null as string | null,
    rotatedAt: null as string | null,
    signedByKid: null,
    state: "active",
    successorKid: null as string | null,
  }
}
