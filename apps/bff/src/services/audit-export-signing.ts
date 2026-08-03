import {
  type KeyObject,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto"
import { constants } from "node:fs"
import { open } from "node:fs/promises"
import type { AdminAuditVerificationKeysResponse } from "@llm-machines/contracts/inference-core"
import {
  loadSigningTrustBundle,
  resolveAuditSigningTrust,
} from "./signing-trust"

const MAX_PRIVATE_KEY_BYTES = 16 * 1024
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface AuditExportSigningMaterial {
  activeKid: string
  applianceId: string
  issuerId: string
  privateKey: KeyObject
  purpose: "audit-export"
  verificationKeys: AdminAuditVerificationKeysResponse
}

export interface AuditExportSigningConfig {
  activeKid?: string
  applianceId?: string
  now?: Date
  privateKeyFile?: string
  privateKeyOwnerUid?: number
  signingTrustFile?: string
  signingTrustOwnerUid?: number
}

export interface AuditExportProtectedAuthority {
  schemaVersion: 1
  exportedAt: string
  range: { from: string; to: string }
  requestedCursor: string | null
  nextCursor: string | null
  rowCount: number
  order: "occurred_at_asc,id_asc"
  filters: {
    applicationId: string | null
    eventId: string | null
    outcome: string | null
    querySha256: string | null
    severity: string | null
    sourceSystem: string | null
  }
}

export class AuditExportSigningUnavailableError extends Error {
  constructor() {
    super("Audit export signing material is unavailable.")
    this.name = "AuditExportSigningUnavailableError"
  }
}

export async function loadAuditExportSigningMaterial(
  config: AuditExportSigningConfig = {},
): Promise<AuditExportSigningMaterial> {
  const activeKid =
    config.activeKid ?? process.env.AUDIT_EXPORT_SIGNING_ACTIVE_KID
  const applianceId =
    config.applianceId ?? process.env.AUDIT_EXPORT_SIGNING_APPLIANCE_ID
  const privateKeyFile =
    config.privateKeyFile ?? process.env.AUDIT_EXPORT_SIGNING_PRIVATE_KEY_FILE
  const signingTrustFile =
    config.signingTrustFile ??
    process.env.AUDIT_EXPORT_SIGNING_TRUST_BUNDLE_FILE
  const now = config.now ?? new Date()
  if (
    !safeKid(activeKid) ||
    !safeApplianceId(applianceId) ||
    !absolutePath(privateKeyFile) ||
    !absolutePath(signingTrustFile) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new AuditExportSigningUnavailableError()
  }

  try {
    const signingTrust = await loadSigningTrustBundle({
      file: signingTrustFile,
      requiredOwnerUid: config.signingTrustOwnerUid,
    })
    const privateKeyBytes = await readMountedPrivateKey(
      privateKeyFile,
      config.privateKeyOwnerUid ?? 0,
    )
    let privateKey: KeyObject
    try {
      privateKey = createPrivateKey(privateKeyBytes)
    } finally {
      privateKeyBytes.fill(0)
    }
    if (privateKey.asymmetricKeyType !== "ed25519") {
      throw new Error("Signing key is not Ed25519.")
    }
    const trust = resolveAuditSigningTrust(signingTrust, {
      activeKid,
      applianceId,
      at: now,
    })
    assertPublicKeyMatchesPrivateKey(privateKey, trust.key.publicKey.x)
    return {
      activeKid,
      applianceId,
      issuerId: trust.issuerId,
      privateKey,
      purpose: "audit-export",
      verificationKeys: trust.verificationKeys,
    }
  } catch (error) {
    if (error instanceof AuditExportSigningUnavailableError) {
      throw error
    }
    throw new AuditExportSigningUnavailableError()
  }
}

export function signAuditExport(
  payload: Buffer,
  contentType: "application/json" | "text/csv",
  material: AuditExportSigningMaterial,
  authority: AuditExportProtectedAuthority,
): string {
  assertSigningMaterial(material)
  const protectedHeader = Buffer.from(
    JSON.stringify({
      alg: "EdDSA",
      cty: contentType,
      kid: material.activeKid,
      llmAudit: authority,
      llmSigning: {
        issuer: material.issuerId,
        purpose: material.purpose,
        schemaVersion: 1,
      },
      typ: "LLM-MACHINES-AUDIT-EXPORT-V1",
    }),
    "utf8",
  ).toString("base64url")
  const encodedPayload = payload.toString("base64url")
  const signingInput = Buffer.from(
    `${protectedHeader}.${encodedPayload}`,
    "ascii",
  )
  const signature = sign(null, signingInput, material.privateKey).toString(
    "base64url",
  )
  return `${protectedHeader}.${encodedPayload}.${signature}`
}

function assertPublicKeyMatchesPrivateKey(
  privateKey: KeyObject,
  expectedPublicKey: string,
): void {
  const derived = createPublicKey(privateKey).export({ format: "jwk" })
  if (
    derived.kty !== "OKP" ||
    derived.crv !== "Ed25519" ||
    derived.x !== expectedPublicKey
  ) {
    throw new Error("Trusted public key does not match the signing key.")
  }
}

function assertSigningMaterial(material: AuditExportSigningMaterial): void {
  const active = material.verificationKeys.keys.find(
    (key) => key.kid === material.activeKid,
  )
  if (
    material.purpose !== "audit-export" ||
    !safeKid(material.activeKid) ||
    !safeApplianceId(material.applianceId) ||
    material.issuerId !==
      `urn:llm-machines:customer-appliance:${material.applianceId}` ||
    material.privateKey.asymmetricKeyType !== "ed25519" ||
    !active
  ) {
    throw new AuditExportSigningUnavailableError()
  }
  try {
    assertPublicKeyMatchesPrivateKey(material.privateKey, active.x)
  } catch {
    throw new AuditExportSigningUnavailableError()
  }
}

async function readMountedPrivateKey(
  path: string,
  requiredOwnerUid: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(requiredOwnerUid) || requiredOwnerUid < 0) {
    throw new Error("Mounted signing file has unsafe owner policy.")
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const metadata = await handle.stat()
    if (
      !metadata.isFile() ||
      metadata.uid !== requiredOwnerUid ||
      metadata.size < 1 ||
      metadata.size > MAX_PRIVATE_KEY_BYTES ||
      (metadata.mode & 0o077) !== 0
    ) {
      throw new Error("Mounted signing file has unsafe metadata.")
    }
    const bytes = await handle.readFile()
    if (bytes.length < 1 || bytes.length > MAX_PRIVATE_KEY_BYTES) {
      bytes.fill(0)
      throw new Error("Mounted signing file has unsafe size.")
    }
    return bytes
  } finally {
    await handle.close()
  }
}

function safeKid(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  )
}

function safeApplianceId(value: string | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

function absolutePath(value: string | undefined): value is string {
  return typeof value === "string" && value.startsWith("/") && value.length > 1
}
