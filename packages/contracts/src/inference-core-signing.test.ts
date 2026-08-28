import { describe, expect, it } from "vitest"
import {
  auditExportIssuerId,
  inferenceCoreMaximumDualTrustSeconds,
  inferenceCoreSigningKeyPurposes,
  inferenceCoreSigningTrustBundleSchema,
  resolveInferenceCoreSigningKey,
  resolveInferenceCoreVerificationKey,
} from "./inference-core-signing"

const applianceId = "01234567-89ab-4def-8123-456789abcdef"
const vendorIssuer = { id: "urn:llm-machines:vendor", kind: "vendor" } as const
const vendorCustody = {
  owner: "vendor",
  privateMaterialPresence: {
    appliance: false,
    ciEnvironmentVariables: false,
    cloudDependency: false,
    git: false,
  },
  storage: "offline-hardware-backed",
} as const

describe("Inference Core signing custody contracts", () => {
  it("accepts separate keys for every product purpose and resolves only exact trust", () => {
    const bundle = inferenceCoreSigningTrustBundleSchema.parse(validBundle())

    expect(bundle.keys.map((key) => key.purpose)).toEqual(
      inferenceCoreSigningKeyPurposes,
    )
    expect(
      resolveInferenceCoreSigningKey(bundle, {
        algorithm: "Ed25519",
        applianceId,
        at: "2026-08-02T12:00:00.000Z",
        issuerId: auditExportIssuerId(applianceId),
        kid: "audit-2026",
        purpose: "audit-export",
      }),
    ).toMatchObject({ status: "trusted" })
    expect(
      resolveInferenceCoreSigningKey(bundle, {
        algorithm: "Ed25519",
        applianceId,
        at: "2026-08-02T12:00:00.000Z",
        issuerId: auditExportIssuerId(applianceId),
        kid: "update-2026",
        purpose: "audit-export",
      }),
    ).toEqual({ reason: "purpose_mismatch", status: "rejected" })
    expect(
      resolveInferenceCoreSigningKey(bundle, {
        algorithm: "Ed25519",
        applianceId,
        at: "2026-08-01T23:59:59.000Z",
        issuerId: auditExportIssuerId(applianceId),
        kid: "audit-2026",
        purpose: "audit-export",
      }),
    ).toEqual({ reason: "outside_validity", status: "rejected" })
    expect(
      resolveInferenceCoreSigningKey(bundle, {
        algorithm: "ES256",
        applianceId,
        at: "2026-08-02T12:00:00.000Z",
        issuerId: auditExportIssuerId(applianceId),
        kid: "audit-2026",
        purpose: "audit-export",
      }),
    ).toEqual({ reason: "algorithm_mismatch", status: "rejected" })
  })

  it("rejects shared key IDs, shared material, missing purposes, and private JWK fields", () => {
    const duplicateKid = clone(validBundle())
    duplicateKid.keys[2].kid = duplicateKid.keys[1].kid
    expect(
      inferenceCoreSigningTrustBundleSchema.safeParse(duplicateKid).success,
    ).toBe(false)

    const duplicateMaterial = clone(validBundle())
    duplicateMaterial.keys[2].publicKey = {
      ...duplicateMaterial.keys[1].publicKey,
    }
    expect(
      inferenceCoreSigningTrustBundleSchema.safeParse(duplicateMaterial)
        .success,
    ).toBe(false)

    const aliasedMaterial = clone(validBundle())
    Object.assign(aliasedMaterial.keys[2].publicKey, {
      value: `${"B".repeat(42)}B`,
    })
    expect(
      inferenceCoreSigningTrustBundleSchema.safeParse(aliasedMaterial).success,
    ).toBe(false)

    const missingPurpose = clone(validBundle())
    missingPurpose.keys.pop()
    expect(
      inferenceCoreSigningTrustBundleSchema.safeParse(missingPurpose).success,
    ).toBe(false)

    const privateMaterial = clone(validBundle())
    Object.assign(privateMaterial.keys[0].publicKey, { d: "private-material" })
    expect(
      inferenceCoreSigningTrustBundleSchema.safeParse(privateMaterial).success,
    ).toBe(false)
  })

  it("requires vendor leaf keys to chain to an offline hardware-backed root", () => {
    const wrongRoot = clone(validBundle())
    wrongRoot.keys[1].signedByKid = "audit-2026"
    expect(
      inferenceCoreSigningTrustBundleSchema.safeParse(wrongRoot).success,
    ).toBe(false)

    const onlineRoot = clone(validBundle())
    Object.assign(onlineRoot.keys[0].custody, { storage: "online" })
    expect(
      inferenceCoreSigningTrustBundleSchema.safeParse(onlineRoot).success,
    ).toBe(false)

    const ciPrivateMaterial = clone(validBundle())
    const rootCustody = ciPrivateMaterial.keys[0].custody
    if ("privateMaterialPresence" in rootCustody) {
      Object.assign(rootCustody.privateMaterialPresence, {
        ciEnvironmentVariables: true,
      })
    }
    expect(
      inferenceCoreSigningTrustBundleSchema.safeParse(ciPrivateMaterial)
        .success,
    ).toBe(false)
  })

  it("binds customer audit custody and issuer to one appliance", () => {
    const wrongIssuer = clone(validBundle())
    wrongIssuer.keys[4].issuer.id = auditExportIssuerId(
      "11234567-89ab-4def-8123-456789abcdef",
    )
    expect(
      inferenceCoreSigningTrustBundleSchema.safeParse(wrongIssuer).success,
    ).toBe(false)

    const wrongCustody = clone(validBundle())
    Object.assign(wrongCustody.keys[4].custody, {
      encryptedAtRest: false,
      recoveryEnvelope: "vendor-held",
      tpmSealing: "disabled",
    })
    expect(
      inferenceCoreSigningTrustBundleSchema.safeParse(wrongCustody).success,
    ).toBe(false)
  })

  it("accepts retiring verification only inside a linked bounded dual-trust window", () => {
    const bundle = inferenceCoreSigningTrustBundleSchema.parse(rotationBundle())
    const request = {
      algorithm: "Ed25519",
      applianceId,
      issuerId: auditExportIssuerId(applianceId),
      kid: "audit-2026",
      purpose: "audit-export",
    } as const

    expect(
      resolveInferenceCoreVerificationKey(bundle, {
        ...request,
        at: "2026-08-10T12:00:00.000Z",
      }),
    ).toMatchObject({ status: "trusted" })
    expect(
      resolveInferenceCoreVerificationKey(bundle, {
        ...request,
        at: "2026-09-02T00:00:01.000Z",
      }),
    ).toEqual({ reason: "outside_dual_trust", status: "rejected" })
    expect(
      resolveInferenceCoreSigningKey(bundle, {
        ...request,
        at: "2026-08-10T12:00:00.000Z",
      }),
    ).toEqual({ reason: "not_active", status: "rejected" })
  })

  it("rejects unlinked and overlong dual-trust migrations", () => {
    const unlinked = clone(rotationBundle())
    unlinked.dualTrust[0].successorKid = "update-2026"
    expect(
      inferenceCoreSigningTrustBundleSchema.safeParse(unlinked).success,
    ).toBe(false)

    const overlong = clone(rotationBundle())
    overlong.dualTrust[0].endsAt = new Date(
      Date.parse(overlong.dualTrust[0].startsAt) +
        (inferenceCoreMaximumDualTrustSeconds + 1) * 1000,
    ).toISOString()
    expect(
      inferenceCoreSigningTrustBundleSchema.safeParse(overlong).success,
    ).toBe(false)
  })

  it("rejects future, expired, and transition-gapped dual-trust windows", () => {
    const future = clone(rotationBundle())
    future.dualTrust[0].startsAt = "2026-09-01T00:00:00.000Z"
    future.dualTrust[0].endsAt = "2026-09-15T00:00:00.000Z"
    expect(
      inferenceCoreSigningTrustBundleSchema.safeParse(future).success,
    ).toBe(false)

    const expired = clone(rotationBundle())
    expired.dualTrust[0].startsAt = "2026-07-01T00:00:00.000Z"
    expired.dualTrust[0].endsAt = "2026-07-15T00:00:00.000Z"
    expired.keys[4].rotatedAt = expired.dualTrust[0].startsAt
    expired.keys[5].rotatedAt = expired.dualTrust[0].startsAt
    expect(
      inferenceCoreSigningTrustBundleSchema.safeParse(expired).success,
    ).toBe(false)

    const transitionGap = clone(rotationBundle())
    transitionGap.keys[5].rotatedAt = "2026-08-01T00:00:00.000Z"
    expect(
      inferenceCoreSigningTrustBundleSchema.safeParse(transitionGap).success,
    ).toBe(false)
  })

  it("rejects malformed revocation metadata and revoked keys at resolution", () => {
    const malformed = clone(validBundle())
    malformed.keys[2].state = "revoked"
    expect(
      inferenceCoreSigningTrustBundleSchema.safeParse(malformed).success,
    ).toBe(false)

    const candidate = clone(validBundle())
    const revoked = clone(candidate.keys[2])
    revoked.kid = "update-2025"
    Object.assign(revoked.publicKey, { value: `${"G".repeat(42)}A` })
    revoked.state = "revoked"
    revoked.revokedAt = "2026-08-01T00:00:00.000Z"
    revoked.revocationReason = "custody-compromise"
    candidate.keys.push(revoked)
    const bundle = inferenceCoreSigningTrustBundleSchema.parse(candidate)
    expect(
      resolveInferenceCoreVerificationKey(bundle, {
        algorithm: "ES256",
        at: "2026-08-02T12:00:00.000Z",
        issuerId: vendorIssuer.id,
        kid: revoked.kid,
        purpose: "update-bundle",
      }),
    ).toEqual({ reason: "revoked", status: "rejected" })
  })
})

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
    custody: { ...vendorCustody },
    issuer: { ...vendorIssuer },
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

function clone<T>(value: T): T {
  return structuredClone(value)
}
