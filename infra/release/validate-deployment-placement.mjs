import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import {
  readCoreImageInventory,
  validateCoreImageLock,
} from "./validate-image-lock.mjs"

const sha256Pattern = /^sha256:[a-f0-9]{64}$/
const authorityPattern =
  /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9][0-9]{0,4})?$/
const forbiddenPublicAuthorities = new Set([
  "docker.io",
  "registry-1.docker.io",
  "ghcr.io",
  "quay.io",
  "gcr.io",
  "public.ecr.aws",
  "registry.gitlab.com",
])
const forbiddenPublicPatterns = [
  /\.pkg\.dev$/,
  /\.azurecr\.io$/,
  /\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com$/,
]
const credentialKeyPattern = /(?:credential|password|secret|token|username)/i

function exactKeys(errors, value, expected, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${field} must be an object`)
    return
  }
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    errors.push(`${field} keys must be exactly ${wanted.join(", ")}`)
  }
}

function findCredentialField(value, path = "placement") {
  if (!value || typeof value !== "object") return null
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`
    if (key !== "containsCredentials" && credentialKeyPattern.test(key)) {
      return nestedPath
    }
    const found = findCredentialField(nested, nestedPath)
    if (found) return found
  }
  return null
}

function validateAuthority(errors, authority, approved) {
  if (
    typeof authority !== "string" ||
    !authorityPattern.test(authority) ||
    authority.includes("..") ||
    authority.includes("@") ||
    authority.includes("/")
  ) {
    errors.push("registry authority is malformed")
    return
  }
  const [host, port] = authority.split(":")
  if (port !== undefined && Number.parseInt(port, 10) > 65_535) {
    errors.push("registry authority port is invalid")
  }
  if (
    forbiddenPublicAuthorities.has(host) ||
    forbiddenPublicPatterns.some((pattern) => pattern.test(host))
  ) {
    errors.push("public registry authorities are forbidden")
  }
  if (!approved.includes(authority)) {
    errors.push("registry authority is not approved for this commissioning")
  }
}

export function validateDeploymentPlacement(
  placement,
  {
    coreLock,
    coreImageLockSha256,
    releaseManifestSha256,
    approvedRegistryAuthorities = [],
    inventory = readCoreImageInventory(),
  } = {},
) {
  const errors = []
  exactKeys(
    errors,
    placement,
    [
      "schema",
      "status",
      "containsCredentials",
      "runtimeQualified",
      "coreRelease",
      "registryAuthority",
      "placements",
      "records",
    ],
    "deployment placement",
  )
  exactKeys(
    errors,
    placement?.coreRelease,
    ["version", "releaseManifestSha256", "coreImageLockSha256"],
    "deployment placement core release",
  )
  exactKeys(
    errors,
    placement?.records,
    ["commissioning", "audit"],
    "deployment placement records",
  )
  exactKeys(
    errors,
    placement?.records?.commissioning,
    ["status", "evidenceId"],
    "deployment placement commissioning record",
  )
  exactKeys(
    errors,
    placement?.records?.audit,
    ["status", "eventType", "evidenceId", "metadataOnly"],
    "deployment placement audit record",
  )

  if (placement?.schema !== "llm-machines.deployment-placement.v1") {
    errors.push("deployment placement schema is not v1")
  }
  if (placement?.status !== "COMMISSIONING_VERIFIED") {
    errors.push("deployment placement must be commissioning-verified")
  }
  if (placement?.containsCredentials !== false) {
    errors.push("deployment placement must remain credential-free")
  }
  if (placement?.runtimeQualified !== false) {
    errors.push("deployment placement cannot claim runtime qualification")
  }
  const credentialField = findCredentialField(placement)
  if (credentialField) {
    errors.push(
      `deployment placement contains credential field ${credentialField}`,
    )
  }

  if (!coreLock || typeof coreLock !== "object") {
    errors.push("validated Core image lock is required")
  } else {
    errors.push(...validateCoreImageLock(coreLock, inventory))
  }
  if (!sha256Pattern.test(coreImageLockSha256 ?? "")) {
    errors.push("exact Core image lock digest is required")
  }
  if (!sha256Pattern.test(releaseManifestSha256 ?? "")) {
    errors.push("exact release manifest digest is required")
  }
  if (
    placement?.coreRelease?.version !== coreLock?.release?.version ||
    placement?.coreRelease?.coreImageLockSha256 !== coreImageLockSha256 ||
    placement?.coreRelease?.releaseManifestSha256 !== releaseManifestSha256
  ) {
    errors.push("deployment placement does not bind the exact Core release")
  }

  const approved = Array.isArray(approvedRegistryAuthorities)
    ? approvedRegistryAuthorities
    : []
  if (
    approved.length === 0 ||
    approved.some(
      (authority) =>
        typeof authority !== "string" || authority !== authority.toLowerCase(),
    )
  ) {
    errors.push(
      "an exact lowercase commissioning registry allowlist is required",
    )
  }
  validateAuthority(errors, placement?.registryAuthority, approved)

  const placements = Array.isArray(placement?.placements)
    ? placement.placements
    : []
  const images = Array.isArray(coreLock?.images) ? coreLock.images : []
  if (
    placements.length !== images.length ||
    placements.some((entry, index) => entry?.id !== images[index]?.id)
  ) {
    errors.push("deployment placement must preserve the exact Core image order")
  }
  for (const [index, entry] of placements.entries()) {
    const image = images[index]
    const field = `placement ${entry?.id ?? index}`
    exactKeys(
      errors,
      entry,
      [
        "id",
        "mirrorRepository",
        "effectiveReference",
        "ociArchiveSha256",
        "indexDigest",
        "platformDigest",
        "verification",
      ],
      field,
    )
    exactKeys(
      errors,
      entry?.verification,
      [
        "status",
        "importedArchiveSha256",
        "mirroredIndexDigest",
        "mirroredPlatformDigest",
      ],
      `${field} verification`,
    )
    if (!image) continue
    const expectedReference = `${placement.registryAuthority}/${image.mirrorRepository}@${image.platformDigest}`
    if (
      entry.mirrorRepository !== image.mirrorRepository ||
      entry.effectiveReference !== expectedReference ||
      entry.ociArchiveSha256 !== image.ociArchiveSha256 ||
      entry.indexDigest !== image.indexDigest ||
      entry.platformDigest !== image.platformDigest
    ) {
      errors.push(`${field} differs from the signed Core lock`)
    }
    if (
      entry.effectiveReference.includes(":latest") ||
      !entry.effectiveReference.includes("@sha256:")
    ) {
      errors.push(`${field} effective reference is mutable or tag-only`)
    }
    if (
      entry.verification?.status !== "VERIFIED" ||
      entry.verification?.importedArchiveSha256 !== image.ociArchiveSha256 ||
      entry.verification?.mirroredIndexDigest !== image.indexDigest ||
      entry.verification?.mirroredPlatformDigest !== image.platformDigest
    ) {
      errors.push(`${field} imported or mirrored content is not verified`)
    }
  }

  if (
    placement?.records?.commissioning?.status !== "RECORDED" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(
      placement?.records?.commissioning?.evidenceId ?? "",
    )
  ) {
    errors.push("commissioning evidence record is invalid")
  }
  if (
    placement?.records?.audit?.status !== "RECORDED" ||
    placement?.records?.audit?.eventType !==
      "release.image-placement.verified" ||
    placement?.records?.audit?.metadataOnly !== true ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(
      placement?.records?.audit?.evidenceId ?? "",
    )
  ) {
    errors.push("metadata-only audit record is invalid")
  }
  return errors
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function run() {
  const { values } = parseArgs({
    options: {
      placement: { type: "string" },
      "core-lock": { type: "string" },
      "release-manifest-sha256": { type: "string" },
      "approved-registry": { type: "string", multiple: true },
    },
    strict: true,
  })
  if (!values.placement || !values["core-lock"]) {
    throw new Error("--placement and --core-lock are required")
  }
  const placement = JSON.parse(readFileSync(values.placement, "utf8"))
  const coreLockBytes = readFileSync(values["core-lock"])
  const coreLock = JSON.parse(coreLockBytes)
  const errors = validateDeploymentPlacement(placement, {
    coreLock,
    coreImageLockSha256: sha256(coreLockBytes),
    releaseManifestSha256: values["release-manifest-sha256"],
    approvedRegistryAuthorities: values["approved-registry"],
  })
  if (errors.length > 0) throw new Error(errors.join("\n"))
  process.stdout.write("deployment placement valid\n")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run()
