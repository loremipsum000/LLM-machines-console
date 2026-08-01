import {
  type KeyObject,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto"
import { constants } from "node:fs"
import { open } from "node:fs/promises"
import {
  type AdminAuditVerificationKeysResponse,
  adminAuditVerificationJwkSchema,
  adminAuditVerificationKeysResponseSchema,
} from "@llm-machines/contracts/inference-core"

const MAX_PRIVATE_KEY_BYTES = 16 * 1024
const MAX_PUBLIC_JWKS_BYTES = 256 * 1024

export interface AuditExportSigningMaterial {
  activeKid: string
  privateKey: KeyObject
  verificationKeys: AdminAuditVerificationKeysResponse
}

export interface AuditExportSigningConfig {
  activeKid?: string
  privateKeyFile?: string
  publicJwksFile?: string
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
  const privateKeyFile =
    config.privateKeyFile ?? process.env.AUDIT_EXPORT_SIGNING_PRIVATE_KEY_FILE
  const publicJwksFile =
    config.publicJwksFile ?? process.env.AUDIT_EXPORT_SIGNING_PUBLIC_JWKS_FILE
  if (
    !safeKid(activeKid) ||
    !absolutePath(privateKeyFile) ||
    !absolutePath(publicJwksFile)
  ) {
    throw new AuditExportSigningUnavailableError()
  }

  try {
    const [privateKeyBytes, publicJwksBytes] = await Promise.all([
      readMountedFile(privateKeyFile, MAX_PRIVATE_KEY_BYTES, true),
      readMountedFile(publicJwksFile, MAX_PUBLIC_JWKS_BYTES, false),
    ])
    let privateKey: KeyObject
    try {
      privateKey = createPrivateKey(privateKeyBytes)
    } finally {
      privateKeyBytes.fill(0)
    }
    if (privateKey.asymmetricKeyType !== "ed25519") {
      throw new Error("Signing key is not Ed25519.")
    }
    let verificationKeys: AdminAuditVerificationKeysResponse
    try {
      verificationKeys = parseVerificationKeys(publicJwksBytes, activeKid)
    } finally {
      publicJwksBytes.fill(0)
    }
    assertActivePublicKeyMatchesPrivateKey(
      privateKey,
      verificationKeys,
      activeKid,
    )
    return { activeKid, privateKey, verificationKeys }
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
  const protectedHeader = Buffer.from(
    JSON.stringify({
      alg: "EdDSA",
      cty: contentType,
      kid: material.activeKid,
      llmAudit: authority,
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

function parseVerificationKeys(
  bytes: Buffer,
  activeKid: string,
): AdminAuditVerificationKeysResponse {
  const parsed = JSON.parse(bytes.toString("utf8")) as unknown
  if (!isPlainRecord(parsed) || Reflect.ownKeys(parsed).length !== 1) {
    throw new Error("JWKS must contain only keys.")
  }
  const keysValue = parsed.keys
  if (!Array.isArray(keysValue)) {
    throw new Error("JWKS keys are required.")
  }
  const keys = keysValue.map((key) =>
    adminAuditVerificationJwkSchema.parse(key),
  )
  const kids = keys.map((key) => key.kid)
  if (new Set(kids).size !== kids.length || !kids.includes(activeKid)) {
    throw new Error("JWKS key IDs are invalid.")
  }
  keys.sort((left, right) => left.kid.localeCompare(right.kid))
  return adminAuditVerificationKeysResponseSchema.parse({
    activeKid,
    keys,
  })
}

function assertActivePublicKeyMatchesPrivateKey(
  privateKey: KeyObject,
  verificationKeys: AdminAuditVerificationKeysResponse,
  activeKid: string,
): void {
  const active = verificationKeys.keys.find((key) => key.kid === activeKid)
  const derived = createPublicKey(privateKey).export({ format: "jwk" })
  if (
    !active ||
    derived.kty !== "OKP" ||
    derived.crv !== "Ed25519" ||
    derived.x !== active.x
  ) {
    throw new Error("Active JWKS key does not match the signing key.")
  }
}

async function readMountedFile(
  path: string,
  maximumBytes: number,
  privateFile: boolean,
): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const metadata = await handle.stat()
    if (
      !metadata.isFile() ||
      metadata.size < 1 ||
      metadata.size > maximumBytes ||
      (privateFile
        ? (metadata.mode & 0o077) !== 0
        : (metadata.mode & 0o022) !== 0)
    ) {
      throw new Error("Mounted signing file has unsafe metadata.")
    }
    const bytes = await handle.readFile()
    if (bytes.length < 1 || bytes.length > maximumBytes) {
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

function absolutePath(value: string | undefined): value is string {
  return typeof value === "string" && value.startsWith("/") && value.length > 1
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
