import { z } from "zod"

export const inferenceCoreSigningKeyPurposes = [
  "vendor-release-root",
  "release-artifact",
  "update-bundle",
  "offline-entitlement",
  "audit-export",
] as const

export const inferenceCoreScopedSigningKeyPurposes = [
  "release-artifact",
  "update-bundle",
  "offline-entitlement",
  "audit-export",
] as const

export const inferenceCoreMaximumDualTrustSeconds = 30 * 24 * 60 * 60
export const inferenceCoreVendorSigningIssuerId = "urn:llm-machines:vendor"

export const inferenceCoreSigningKeyPurposeSchema = z.enum(
  inferenceCoreSigningKeyPurposes,
)
export type InferenceCoreSigningKeyPurpose = z.infer<
  typeof inferenceCoreSigningKeyPurposeSchema
>

export const inferenceCoreSigningKeyStateSchema = z.enum([
  "active",
  "retiring",
  "revoked",
])
export type InferenceCoreSigningKeyState = z.infer<
  typeof inferenceCoreSigningKeyStateSchema
>

const signingKidSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const signingTimestampSchema = z.string().datetime({ offset: true })
export const inferenceCoreSigningAlgorithmSchema = z
  .string()
  .min(2)
  .max(32)
  .regex(/^[A-Za-z][A-Za-z0-9._-]+$/)
const base64UrlAlphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
const ed25519PublicKeyXSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .refine((value) => ed25519PublicKeyFingerprint(value) !== null, {
    message: "Ed25519 public keys must be canonical 32-byte base64url values.",
  })

export const inferenceCoreSigningPublicKeySchema = z
  .object({
    crv: z.literal("Ed25519"),
    kty: z.literal("OKP"),
    x: ed25519PublicKeyXSchema,
  })
  .strict()
export type InferenceCoreSigningPublicKey = z.infer<
  typeof inferenceCoreSigningPublicKeySchema
>

export const inferenceCoreVendorSigningPublicKeySchema = z
  .object({
    format: z.literal("spki-der-base64url"),
    value: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43,4096}$/)
      .refine((value) => base64UrlFingerprint(value, 32, 3_072) !== null, {
        message: "Vendor public keys must be canonical base64url SPKI bytes.",
      }),
  })
  .strict()

export const inferenceCoreVendorSigningIssuerSchema = z
  .object({
    id: z.literal(inferenceCoreVendorSigningIssuerId),
    kind: z.literal("vendor"),
  })
  .strict()

export const inferenceCoreCustomerApplianceSigningIssuerSchema = z
  .object({
    id: z.string().min(1).max(255),
    kind: z.literal("customer-appliance"),
  })
  .strict()

export const inferenceCoreVendorSigningCustodySchema = z
  .object({
    owner: z.literal("vendor"),
    privateMaterialPresence: z
      .object({
        appliance: z.literal(false),
        ciEnvironmentVariables: z.literal(false),
        cloudDependency: z.literal(false),
        git: z.literal(false),
      })
      .strict(),
    storage: z.literal("offline-hardware-backed"),
  })
  .strict()

export const inferenceCoreAuditSigningCustodySchema = z
  .object({
    applianceId: z.string().uuid(),
    encryptedAtRest: z.literal(true),
    owner: z.literal("customer"),
    privateKeyProvisioning: z.literal("root-only-mounted-secret"),
    recoveryEnvelope: z.literal("customer-held"),
    scope: z.literal("per-appliance"),
    tpmSealing: z.literal("required-when-available"),
  })
  .strict()

const signingLifecycleShape = {
  kid: signingKidSchema,
  notAfter: signingTimestampSchema,
  notBefore: signingTimestampSchema,
  predecessorKid: signingKidSchema.nullable(),
  revokedAt: signingTimestampSchema.nullable(),
  revocationReason: z.string().min(1).max(255).nullable(),
  rotatedAt: signingTimestampSchema.nullable(),
  state: inferenceCoreSigningKeyStateSchema,
  successorKid: signingKidSchema.nullable(),
} as const

const vendorReleaseRootSigningKeySchema = z
  .object({
    ...signingLifecycleShape,
    algorithm: inferenceCoreSigningAlgorithmSchema,
    custody: inferenceCoreVendorSigningCustodySchema,
    issuer: inferenceCoreVendorSigningIssuerSchema,
    purpose: z.literal("vendor-release-root"),
    publicKey: inferenceCoreVendorSigningPublicKeySchema,
    signedByKid: z.null(),
  })
  .strict()

const vendorScopedSigningKeySchema = z
  .object({
    ...signingLifecycleShape,
    algorithm: inferenceCoreSigningAlgorithmSchema,
    custody: inferenceCoreVendorSigningCustodySchema,
    issuer: inferenceCoreVendorSigningIssuerSchema,
    purpose: z.enum([
      "release-artifact",
      "update-bundle",
      "offline-entitlement",
    ]),
    publicKey: inferenceCoreVendorSigningPublicKeySchema,
    signedByKid: signingKidSchema,
  })
  .strict()

const auditExportSigningKeySchema = z
  .object({
    ...signingLifecycleShape,
    algorithm: z.literal("Ed25519"),
    custody: inferenceCoreAuditSigningCustodySchema,
    issuer: inferenceCoreCustomerApplianceSigningIssuerSchema,
    purpose: z.literal("audit-export"),
    publicKey: inferenceCoreSigningPublicKeySchema,
    signedByKid: z.null(),
  })
  .strict()

export const inferenceCoreSigningTrustKeySchema = z.discriminatedUnion(
  "purpose",
  [
    vendorReleaseRootSigningKeySchema,
    vendorScopedSigningKeySchema,
    auditExportSigningKeySchema,
  ],
)
export type InferenceCoreSigningTrustKey = z.infer<
  typeof inferenceCoreSigningTrustKeySchema
>

export const inferenceCoreDualTrustMigrationSchema = z
  .object({
    endsAt: signingTimestampSchema,
    predecessorKid: signingKidSchema,
    purpose: inferenceCoreSigningKeyPurposeSchema,
    startsAt: signingTimestampSchema,
    successorKid: signingKidSchema,
  })
  .strict()
export type InferenceCoreDualTrustMigration = z.infer<
  typeof inferenceCoreDualTrustMigrationSchema
>

const signingTrustBundleShape = z
  .object({
    dualTrust: z.array(inferenceCoreDualTrustMigrationSchema).max(16),
    generatedAt: signingTimestampSchema,
    keys: z.array(inferenceCoreSigningTrustKeySchema).min(5).max(64),
    schemaVersion: z.literal(1),
  })
  .strict()

export const inferenceCoreSigningTrustBundleSchema =
  signingTrustBundleShape.superRefine((bundle, context) => {
    validateSigningTrustBundle(bundle, (message, path) => {
      context.addIssue({ code: z.ZodIssueCode.custom, message, path })
    })
  })
export type InferenceCoreSigningTrustBundle = z.infer<
  typeof inferenceCoreSigningTrustBundleSchema
>

export type InferenceCoreSigningTrustResolution =
  | { key: InferenceCoreSigningTrustKey; status: "trusted" }
  | {
      reason:
        | "unknown_kid"
        | "purpose_mismatch"
        | "issuer_mismatch"
        | "algorithm_mismatch"
        | "appliance_mismatch"
        | "outside_validity"
        | "revoked"
        | "not_active"
        | "outside_dual_trust"
      status: "rejected"
    }

export interface InferenceCoreSigningTrustRequest {
  algorithm: string
  applianceId?: string
  at: string
  issuerId: string
  kid: string
  purpose: InferenceCoreSigningKeyPurpose
}

export function resolveInferenceCoreSigningKey(
  bundle: InferenceCoreSigningTrustBundle,
  request: InferenceCoreSigningTrustRequest,
): InferenceCoreSigningTrustResolution {
  const common = resolveCommonTrust(bundle, request)
  if (common.status === "rejected") {
    return common
  }
  if (common.key.state !== "active") {
    return { reason: "not_active", status: "rejected" }
  }
  return common
}

export function resolveInferenceCoreVerificationKey(
  bundle: InferenceCoreSigningTrustBundle,
  request: InferenceCoreSigningTrustRequest,
): InferenceCoreSigningTrustResolution {
  const common = resolveCommonTrust(bundle, request)
  if (common.status === "rejected" || common.key.state === "active") {
    return common
  }
  const timestamp = Date.parse(request.at)
  const migration = bundle.dualTrust.find(
    (candidate) =>
      candidate.purpose === request.purpose &&
      candidate.predecessorKid === request.kid &&
      timestamp >= Date.parse(candidate.startsAt) &&
      timestamp <= Date.parse(candidate.endsAt),
  )
  return migration
    ? common
    : { reason: "outside_dual_trust", status: "rejected" }
}

function resolveCommonTrust(
  bundle: InferenceCoreSigningTrustBundle,
  request: InferenceCoreSigningTrustRequest,
): InferenceCoreSigningTrustResolution {
  const key = bundle.keys.find((candidate) => candidate.kid === request.kid)
  if (!key) {
    return { reason: "unknown_kid", status: "rejected" }
  }
  if (key.purpose !== request.purpose) {
    return { reason: "purpose_mismatch", status: "rejected" }
  }
  if (key.issuer.id !== request.issuerId) {
    return { reason: "issuer_mismatch", status: "rejected" }
  }
  if (key.algorithm !== request.algorithm) {
    return { reason: "algorithm_mismatch", status: "rejected" }
  }
  if (
    key.purpose === "audit-export" &&
    request.applianceId !== key.custody.applianceId
  ) {
    return { reason: "appliance_mismatch", status: "rejected" }
  }
  const timestamp = Date.parse(request.at)
  if (
    !Number.isFinite(timestamp) ||
    timestamp < Date.parse(bundle.generatedAt) ||
    timestamp < Date.parse(key.notBefore) ||
    timestamp > Date.parse(key.notAfter)
  ) {
    return { reason: "outside_validity", status: "rejected" }
  }
  if (
    key.state === "revoked" ||
    (key.revokedAt !== null && timestamp >= Date.parse(key.revokedAt))
  ) {
    return { reason: "revoked", status: "rejected" }
  }
  return { key, status: "trusted" }
}

type SigningBundleShape = z.infer<typeof signingTrustBundleShape>

function validateSigningTrustBundle(
  bundle: SigningBundleShape,
  issue: (message: string, path: Array<string | number>) => void,
): void {
  const keysByKid = new Map(
    bundle.keys.map((key, index) => [key.kid, { index, key }] as const),
  )
  if (keysByKid.size !== bundle.keys.length) {
    issue("Signing key IDs must be globally unique.", ["keys"])
  }
  const publicKeyFingerprints = bundle.keys.map((key) =>
    key.purpose === "audit-export"
      ? ed25519PublicKeyFingerprint(key.publicKey.x)
      : base64UrlFingerprint(key.publicKey.value, 32, 3_072),
  )
  if (
    publicKeyFingerprints.some((fingerprint) => fingerprint === null) ||
    new Set(publicKeyFingerprints).size !== bundle.keys.length
  ) {
    issue("Public key material cannot be shared between signing purposes.", [
      "keys",
    ])
  }
  const vendorIssuerIds = new Set(
    bundle.keys
      .filter((key) => key.issuer.kind === "vendor")
      .map((key) => key.issuer.id),
  )
  if (vendorIssuerIds.size !== 1) {
    issue("A trust bundle must contain exactly one vendor issuer.", ["keys"])
  }
  const auditApplianceIds = new Set(
    bundle.keys
      .filter(
        (
          key,
        ): key is Extract<
          SigningBundleShape["keys"][number],
          { purpose: "audit-export" }
        > => key.purpose === "audit-export",
      )
      .map((key) => key.custody.applianceId),
  )
  if (auditApplianceIds.size !== 1) {
    issue("Audit-export keys must belong to one appliance.", ["keys"])
  }

  for (const purpose of inferenceCoreSigningKeyPurposes) {
    const purposeKeys = bundle.keys.filter((key) => key.purpose === purpose)
    if (purposeKeys.length === 0) {
      issue(`Missing required signing purpose: ${purpose}.`, ["keys"])
    }
    if (purposeKeys.filter((key) => key.state === "active").length !== 1) {
      issue(`Signing purpose ${purpose} must have exactly one active key.`, [
        "keys",
      ])
    }
  }

  for (const [index, key] of bundle.keys.entries()) {
    validateKeyLifecycle(key, index, bundle.generatedAt, issue)
    if (
      key.purpose === "audit-export" &&
      key.issuer.id !== auditExportIssuerId(key.custody.applianceId)
    ) {
      issue("Audit-export issuer must be bound to its appliance ID.", [
        "keys",
        index,
        "issuer",
        "id",
      ])
    }
    if (
      key.purpose !== "vendor-release-root" &&
      key.purpose !== "audit-export"
    ) {
      const root = keysByKid.get(key.signedByKid)?.key
      if (
        !root ||
        root.purpose !== "vendor-release-root" ||
        root.issuer.id !== key.issuer.id ||
        (key.state !== "revoked" && root.state === "revoked")
      ) {
        issue("Vendor scoped keys must chain to this issuer's release root.", [
          "keys",
          index,
          "signedByKid",
        ])
      }
    }
    validateRotationLink(key, index, keysByKid, issue)
  }

  const migrations = new Set<string>()
  for (const [index, migration] of bundle.dualTrust.entries()) {
    const migrationId = `${migration.purpose}:${migration.predecessorKid}:${migration.successorKid}`
    if (migrations.has(migrationId)) {
      issue("Dual-trust migrations must be unique.", ["dualTrust", index])
    }
    migrations.add(migrationId)
    validateDualTrustMigration(
      migration,
      index,
      keysByKid,
      bundle.generatedAt,
      issue,
    )
  }

  for (const [index, key] of bundle.keys.entries()) {
    if (
      key.state === "retiring" &&
      bundle.dualTrust.filter(
        (migration) => migration.predecessorKid === key.kid,
      ).length !== 1
    ) {
      issue(
        "Each retiring key requires exactly one bounded dual-trust window.",
        ["keys", index],
      )
    }
  }
}

function validateKeyLifecycle(
  key: SigningBundleShape["keys"][number],
  index: number,
  generatedAtValue: string,
  issue: (message: string, path: Array<string | number>) => void,
): void {
  const notBefore = Date.parse(key.notBefore)
  const notAfter = Date.parse(key.notAfter)
  const generatedAt = Date.parse(generatedAtValue)
  if (notBefore >= notAfter) {
    issue("Signing key validity must have a positive duration.", [
      "keys",
      index,
    ])
  }
  if (key.predecessorKid === key.kid || key.successorKid === key.kid) {
    issue("A signing key cannot rotate to or from itself.", ["keys", index])
  }
  const hasRotation = key.predecessorKid !== null || key.successorKid !== null
  if (hasRotation !== (key.rotatedAt !== null)) {
    issue("Rotation links and rotatedAt must be declared together.", [
      "keys",
      index,
    ])
  }
  if (
    key.rotatedAt !== null &&
    (Date.parse(key.rotatedAt) < notBefore ||
      Date.parse(key.rotatedAt) > notAfter ||
      Date.parse(key.rotatedAt) > generatedAt)
  ) {
    issue("rotatedAt must fall inside the key validity interval.", [
      "keys",
      index,
      "rotatedAt",
    ])
  }
  if (key.state === "revoked") {
    if (key.revokedAt === null || key.revocationReason === null) {
      issue("Revoked keys require revocation time and reason.", ["keys", index])
    } else if (
      Date.parse(key.revokedAt) < notBefore ||
      Date.parse(key.revokedAt) > notAfter ||
      Date.parse(key.revokedAt) > generatedAt
    ) {
      issue(
        "revokedAt must be effective within validity by bundle generation.",
        ["keys", index, "revokedAt"],
      )
    }
  } else if (key.revokedAt !== null || key.revocationReason !== null) {
    issue("Non-revoked keys cannot carry revocation metadata.", ["keys", index])
  }
  if (
    key.state !== "revoked" &&
    (generatedAt < notBefore || generatedAt > notAfter)
  ) {
    issue(
      "Active and retiring keys must be valid when the bundle is generated.",
      ["keys", index],
    )
  }
  if (key.state === "active" && key.successorKid !== null) {
    issue("An active signing key cannot declare a successor.", ["keys", index])
  }
  if (key.state === "retiring" && key.successorKid === null) {
    issue("A retiring signing key must declare its successor.", ["keys", index])
  }
}

function validateRotationLink(
  key: SigningBundleShape["keys"][number],
  index: number,
  keysByKid: Map<
    string,
    { index: number; key: SigningBundleShape["keys"][number] }
  >,
  issue: (message: string, path: Array<string | number>) => void,
): void {
  if (key.predecessorKid !== null) {
    const predecessor = keysByKid.get(key.predecessorKid)?.key
    if (
      !predecessor ||
      predecessor.successorKid !== key.kid ||
      predecessor.purpose !== key.purpose ||
      predecessor.issuer.id !== key.issuer.id
    ) {
      issue("predecessorKid must be a reciprocal same-purpose issuer link.", [
        "keys",
        index,
        "predecessorKid",
      ])
    }
  }
  if (key.successorKid !== null) {
    const successor = keysByKid.get(key.successorKid)?.key
    if (
      !successor ||
      successor.predecessorKid !== key.kid ||
      successor.purpose !== key.purpose ||
      successor.issuer.id !== key.issuer.id
    ) {
      issue("successorKid must be a reciprocal same-purpose issuer link.", [
        "keys",
        index,
        "successorKid",
      ])
    }
  }
}

function validateDualTrustMigration(
  migration: SigningBundleShape["dualTrust"][number],
  index: number,
  keysByKid: Map<
    string,
    { index: number; key: SigningBundleShape["keys"][number] }
  >,
  generatedAtValue: string,
  issue: (message: string, path: Array<string | number>) => void,
): void {
  const predecessor = keysByKid.get(migration.predecessorKid)?.key
  const successor = keysByKid.get(migration.successorKid)?.key
  const startsAt = Date.parse(migration.startsAt)
  const endsAt = Date.parse(migration.endsAt)
  if (
    startsAt >= endsAt ||
    endsAt - startsAt > inferenceCoreMaximumDualTrustSeconds * 1000
  ) {
    issue("Dual-trust windows must be positive and no longer than 30 days.", [
      "dualTrust",
      index,
    ])
  }
  if (
    !predecessor ||
    !successor ||
    predecessor.kid === successor.kid ||
    predecessor.purpose !== migration.purpose ||
    successor.purpose !== migration.purpose ||
    predecessor.issuer.id !== successor.issuer.id ||
    predecessor.state !== "retiring" ||
    successor.state !== "active" ||
    predecessor.successorKid !== successor.kid ||
    successor.predecessorKid !== predecessor.kid
  ) {
    issue("Dual trust requires linked retiring and active same-purpose keys.", [
      "dualTrust",
      index,
    ])
    return
  }
  if (
    startsAt <
      Math.max(
        Date.parse(predecessor.notBefore),
        Date.parse(successor.notBefore),
      ) ||
    endsAt >
      Math.min(Date.parse(predecessor.notAfter), Date.parse(successor.notAfter))
  ) {
    issue(
      "Dual-trust windows must remain inside both key validity intervals.",
      ["dualTrust", index],
    )
  }
  const generatedAt = Date.parse(generatedAtValue)
  if (generatedAt < startsAt || generatedAt > endsAt) {
    issue("A retiring key's dual-trust window must cover bundle generation.", [
      "dualTrust",
      index,
    ])
  }
  if (
    predecessor.rotatedAt !== migration.startsAt ||
    successor.rotatedAt !== migration.startsAt
  ) {
    issue(
      "Dual-trust start and predecessor/successor rotation times must align.",
      ["dualTrust", index],
    )
  }
}

function ed25519PublicKeyFingerprint(value: string): string | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    return null
  }
  return base64UrlFingerprint(value, 32, 32)
}

function base64UrlFingerprint(
  value: string,
  minimumBytes: number,
  maximumBytes: number,
): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    return null
  }
  const bytes: number[] = []
  let accumulator = 0
  let bitCount = 0
  for (const character of value) {
    const index = base64UrlAlphabet.indexOf(character)
    if (index < 0) {
      return null
    }
    accumulator = (accumulator << 6) | index
    bitCount += 6
    while (bitCount >= 8) {
      bitCount -= 8
      bytes.push((accumulator >> bitCount) & 0xff)
      accumulator &= bitCount === 0 ? 0 : (1 << bitCount) - 1
    }
  }
  if (
    bytes.length < minimumBytes ||
    bytes.length > maximumBytes ||
    accumulator !== 0
  ) {
    return null
  }
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function auditExportIssuerId(applianceId: string): string {
  return `urn:llm-machines:customer-appliance:${applianceId}`
}
