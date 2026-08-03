import { constants } from "node:fs"
import { open } from "node:fs/promises"
import {
  type AdminAuditVerificationKeysResponse,
  type InferenceCoreSigningTrustBundle,
  type InferenceCoreSigningTrustKey,
  adminAuditVerificationKeysResponseSchema,
  auditExportIssuerId,
  inferenceCoreSigningTrustBundleSchema,
  resolveInferenceCoreSigningKey,
  resolveInferenceCoreVerificationKey,
} from "@llm-machines/contracts/inference-core"

const MAX_SIGNING_TRUST_BUNDLE_BYTES = 512 * 1024

export interface SigningTrustFileConfig {
  file: string
  requiredOwnerUid?: number
}

export interface AuditSigningTrustRequest {
  activeKid: string
  applianceId: string
  at: Date
}

export interface ResolvedAuditSigningTrust {
  issuerId: string
  key: Extract<InferenceCoreSigningTrustKey, { purpose: "audit-export" }>
  verificationKeys: AdminAuditVerificationKeysResponse
}

export class SigningTrustUnavailableError extends Error {
  constructor() {
    super("Signing trust metadata is unavailable.")
    this.name = "SigningTrustUnavailableError"
  }
}

export async function loadSigningTrustBundle(
  config: SigningTrustFileConfig,
): Promise<InferenceCoreSigningTrustBundle> {
  if (!absolutePath(config.file)) {
    throw new SigningTrustUnavailableError()
  }
  const requiredOwnerUid = config.requiredOwnerUid ?? 0
  if (!Number.isSafeInteger(requiredOwnerUid) || requiredOwnerUid < 0) {
    throw new SigningTrustUnavailableError()
  }

  let bytes: Buffer | undefined
  try {
    const handle = await open(
      config.file,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    )
    try {
      const metadata = await handle.stat()
      if (
        !metadata.isFile() ||
        metadata.uid !== requiredOwnerUid ||
        metadata.size < 1 ||
        metadata.size > MAX_SIGNING_TRUST_BUNDLE_BYTES ||
        (metadata.mode & 0o022) !== 0
      ) {
        throw new Error("Unsafe signing trust file metadata.")
      }
      bytes = await handle.readFile()
    } finally {
      await handle.close()
    }
    if (bytes.length < 1 || bytes.length > MAX_SIGNING_TRUST_BUNDLE_BYTES) {
      throw new Error("Unsafe signing trust file size.")
    }
    return inferenceCoreSigningTrustBundleSchema.parse(
      JSON.parse(bytes.toString("utf8")) as unknown,
    )
  } catch (error) {
    if (error instanceof SigningTrustUnavailableError) {
      throw error
    }
    throw new SigningTrustUnavailableError()
  } finally {
    bytes?.fill(0)
  }
}

export function resolveAuditSigningTrust(
  bundle: InferenceCoreSigningTrustBundle,
  request: AuditSigningTrustRequest,
): ResolvedAuditSigningTrust {
  const issuerId = auditExportIssuerId(request.applianceId)
  const at = request.at.toISOString()
  const resolution = resolveInferenceCoreSigningKey(bundle, {
    algorithm: "Ed25519",
    applianceId: request.applianceId,
    at,
    issuerId,
    kid: request.activeKid,
    purpose: "audit-export",
  })
  if (
    resolution.status !== "trusted" ||
    resolution.key.purpose !== "audit-export"
  ) {
    throw new SigningTrustUnavailableError()
  }

  const keys = bundle.keys
    .filter(
      (
        candidate,
      ): candidate is Extract<
        InferenceCoreSigningTrustKey,
        { purpose: "audit-export" }
      > =>
        candidate.purpose === "audit-export" &&
        candidate.issuer.id === issuerId &&
        candidate.custody.applianceId === request.applianceId,
    )
    .filter((candidate) =>
      trustedForVerification(bundle, candidate, request, issuerId),
    )
    .map((candidate) => ({
      alg: "EdDSA" as const,
      crv: candidate.publicKey.crv,
      kid: candidate.kid,
      kty: candidate.publicKey.kty,
      use: "sig" as const,
      x: candidate.publicKey.x,
    }))
    .sort((left, right) => left.kid.localeCompare(right.kid))

  return {
    issuerId,
    key: resolution.key,
    verificationKeys: adminAuditVerificationKeysResponseSchema.parse({
      activeKid: request.activeKid,
      keys,
    }),
  }
}

function trustedForVerification(
  bundle: InferenceCoreSigningTrustBundle,
  key: Extract<InferenceCoreSigningTrustKey, { purpose: "audit-export" }>,
  request: AuditSigningTrustRequest,
  issuerId: string,
): boolean {
  return (
    resolveInferenceCoreVerificationKey(bundle, {
      algorithm: "Ed25519",
      applianceId: request.applianceId,
      at: request.at.toISOString(),
      issuerId,
      kid: key.kid,
      purpose: "audit-export",
    }).status === "trusted"
  )
}

function absolutePath(value: string): boolean {
  return value.startsWith("/") && value.length > 1
}
