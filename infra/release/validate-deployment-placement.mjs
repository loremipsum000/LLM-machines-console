import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { sha256File } from "./deterministic-archive.mjs"
import { canonicalJson } from "./generate-release-manifest.mjs"
import { inspectOciArchive } from "./inspect-oci-archive.mjs"
import {
  readCoreImageInventory,
  validateCoreImageLock,
} from "./validate-image-lock.mjs"
import { verifyReleaseBundle } from "./verify-release-bundle.mjs"

const knownPublicAuthorities = new Set([
  "docker.io",
  "registry-1.docker.io",
  "ghcr.io",
  "quay.io",
  "gcr.io",
  "public.ecr.aws",
  "registry.gitlab.com",
])
const credentialKeyPattern = /(?:credential|password|secret|token|username)/i
const evidenceIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/

function fail(message) {
  throw new Error(message)
}

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

function authorityHost(authority) {
  if (
    typeof authority !== "string" ||
    authority !== authority.toLowerCase() ||
    authority.length > 259 ||
    authority.includes("/") ||
    authority.includes("@") ||
    authority.includes("[") ||
    authority.includes("]")
  ) {
    return null
  }
  const parts = authority.split(":")
  if (parts.length > 2) return null
  const [host, port] = parts
  if (!host || host.length > 253) return null
  if (
    port !== undefined &&
    (!/^[1-9][0-9]{0,4}$/.test(port) || Number.parseInt(port, 10) > 65_535)
  ) {
    return null
  }
  const labels = host.split(".")
  if (
    labels.some(
      (label) =>
        label.length < 1 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    return null
  }
  return host
}

export function validateRegistryAuthority(
  authority,
  approvedRegistryAuthorities = [],
) {
  const errors = []
  const host = authorityHost(authority)
  if (!host) {
    errors.push("registry authority is malformed")
    return errors
  }
  if (knownPublicAuthorities.has(host)) {
    errors.push("public registry authorities are forbidden")
  }
  if (
    !Array.isArray(approvedRegistryAuthorities) ||
    approvedRegistryAuthorities.length === 0 ||
    approvedRegistryAuthorities.some(
      (entry) => typeof entry !== "string" || authorityHost(entry) === null,
    )
  ) {
    errors.push("an exact commissioning registry allowlist is required")
  } else if (!approvedRegistryAuthorities.includes(authority)) {
    errors.push("registry authority is not approved for this commissioning")
  }
  return errors
}

function placementContext({ releaseBundle, importRoot, registryExportRoot }) {
  const verified = verifyReleaseBundle(releaseBundle)
  const lockArtifact = verified.manifest.artifacts.find(
    ({ evidenceId }) => evidenceId === "core-image-lock",
  )
  if (!lockArtifact) fail("verified release omits the Core image lock")
  const coreLockPath = resolve(releaseBundle.artifactRoot, lockArtifact.path)
  const coreLock = JSON.parse(readFileSync(coreLockPath, "utf8"))
  const lockErrors = validateCoreImageLock(coreLock, readCoreImageInventory())
  if (lockErrors.length > 0) {
    fail(`verified Core image lock is invalid: ${lockErrors.join("; ")}`)
  }
  const observations = coreLock.images.map((image) => ({
    id: image.id,
    imported: inspectOciArchive(resolve(importRoot, image.ociArchivePath)),
    mirrored: inspectOciArchive(
      resolve(registryExportRoot, image.ociArchivePath),
    ),
  }))
  return {
    verified,
    coreLock,
    coreImageLockSha256: sha256File(coreLockPath),
    observations,
  }
}

function expectedObservation(image) {
  return {
    ociArchiveSha256: image.ociArchiveSha256,
    indexDigest: image.indexDigest,
    platform: image.platform,
    platformDigest: image.platformDigest,
  }
}

function validatePlacementDocument(
  placement,
  {
    coreLock,
    coreImageLockSha256,
    releaseManifestSha256,
    approvedRegistryAuthorities,
    observations,
  },
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
  if (
    placement?.schema !== "llm-machines.deployment-placement.v1" ||
    placement?.status !== "COMMISSIONING_VERIFIED" ||
    placement?.containsCredentials !== false ||
    placement?.runtimeQualified !== false
  ) {
    errors.push("deployment placement overstates status or qualification")
  }
  const credentialField = findCredentialField(placement)
  if (credentialField) {
    errors.push(
      `deployment placement contains credential field ${credentialField}`,
    )
  }
  if (
    placement?.coreRelease?.version !== coreLock.release.version ||
    placement?.coreRelease?.coreImageLockSha256 !== coreImageLockSha256 ||
    placement?.coreRelease?.releaseManifestSha256 !== releaseManifestSha256
  ) {
    errors.push("deployment placement does not bind the exact Core release")
  }
  errors.push(
    ...validateRegistryAuthority(
      placement?.registryAuthority,
      approvedRegistryAuthorities,
    ),
  )

  const placements = Array.isArray(placement?.placements)
    ? placement.placements
    : []
  if (
    placements.length !== coreLock.images.length ||
    placements.some((entry, index) => entry?.id !== coreLock.images[index]?.id)
  ) {
    errors.push("deployment placement must preserve the exact Core image order")
  }
  for (const [index, entry] of placements.entries()) {
    const image = coreLock.images[index]
    const observed = observations[index]
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
        "mirroredArchiveSha256",
        "mirroredIndexDigest",
        "mirroredPlatformDigest",
      ],
      `${field} verification`,
    )
    if (!image || !observed) continue
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
    const expected = expectedObservation(image)
    if (
      canonicalJson(observed.imported) !== canonicalJson(expected) ||
      canonicalJson(observed.mirrored) !== canonicalJson(expected) ||
      entry.verification?.status !== "VERIFIED" ||
      entry.verification?.importedArchiveSha256 !==
        observed.imported.ociArchiveSha256 ||
      entry.verification?.mirroredArchiveSha256 !==
        observed.mirrored.ociArchiveSha256 ||
      entry.verification?.mirroredIndexDigest !==
        observed.mirrored.indexDigest ||
      entry.verification?.mirroredPlatformDigest !==
        observed.mirrored.platformDigest
    ) {
      errors.push(`${field} imported or mirrored content is not verified`)
    }
  }
  if (
    placement?.records?.commissioning?.status !== "RECORDED" ||
    !evidenceIdPattern.test(placement?.records?.commissioning?.evidenceId ?? "")
  ) {
    errors.push("commissioning evidence record is invalid")
  }
  if (
    placement?.records?.audit?.status !== "RECORDED" ||
    placement?.records?.audit?.eventType !==
      "release.image-placement.verified" ||
    placement?.records?.audit?.metadataOnly !== true ||
    !evidenceIdPattern.test(placement?.records?.audit?.evidenceId ?? "")
  ) {
    errors.push("metadata-only audit record is invalid")
  }
  return errors
}

export function createDeploymentPlacement({
  releaseBundle,
  importRoot,
  registryExportRoot,
  registryAuthority,
  approvedRegistryAuthorities,
  commissioningEvidenceId,
  auditEvidenceId,
}) {
  const context = placementContext({
    releaseBundle,
    importRoot,
    registryExportRoot,
  })
  const placement = {
    schema: "llm-machines.deployment-placement.v1",
    status: "COMMISSIONING_VERIFIED",
    containsCredentials: false,
    runtimeQualified: false,
    coreRelease: {
      version: context.coreLock.release.version,
      releaseManifestSha256: context.verified.manifestSha256,
      coreImageLockSha256: context.coreImageLockSha256,
    },
    registryAuthority,
    placements: context.coreLock.images.map((image, index) => {
      const observed = context.observations[index]
      return {
        id: image.id,
        mirrorRepository: image.mirrorRepository,
        effectiveReference: `${registryAuthority}/${image.mirrorRepository}@${image.platformDigest}`,
        ociArchiveSha256: image.ociArchiveSha256,
        indexDigest: image.indexDigest,
        platformDigest: image.platformDigest,
        verification: {
          status: "VERIFIED",
          importedArchiveSha256: observed.imported.ociArchiveSha256,
          mirroredArchiveSha256: observed.mirrored.ociArchiveSha256,
          mirroredIndexDigest: observed.mirrored.indexDigest,
          mirroredPlatformDigest: observed.mirrored.platformDigest,
        },
      }
    }),
    records: {
      commissioning: {
        status: "RECORDED",
        evidenceId: commissioningEvidenceId,
      },
      audit: {
        status: "RECORDED",
        eventType: "release.image-placement.verified",
        evidenceId: auditEvidenceId,
        metadataOnly: true,
      },
    },
  }
  const errors = validatePlacementDocument(placement, {
    coreLock: context.coreLock,
    coreImageLockSha256: context.coreImageLockSha256,
    releaseManifestSha256: context.verified.manifestSha256,
    approvedRegistryAuthorities,
    observations: context.observations,
  })
  if (errors.length > 0) fail(errors.join("\n"))
  return placement
}

function run() {
  const { values } = parseArgs({
    options: {
      manifest: { type: "string" },
      signature: { type: "string" },
      trust: { type: "string" },
      "artifact-root": { type: "string" },
      "trusted-root-sha256": { type: "string" },
      "import-root": { type: "string" },
      "registry-export-root": { type: "string" },
      "registry-authority": { type: "string" },
      "approved-registry": { type: "string", multiple: true },
      "commissioning-evidence-id": { type: "string" },
      "audit-evidence-id": { type: "string" },
      output: { type: "string" },
    },
    strict: true,
  })
  const required = [
    "manifest",
    "signature",
    "trust",
    "artifact-root",
    "trusted-root-sha256",
    "import-root",
    "registry-export-root",
    "registry-authority",
    "commissioning-evidence-id",
    "audit-evidence-id",
    "output",
  ]
  for (const key of required) {
    if (!values[key]) fail(`--${key} is required`)
  }
  if (existsSync(values.output))
    fail("deployment placement output already exists")
  const placement = createDeploymentPlacement({
    releaseBundle: {
      manifestPath: values.manifest,
      signaturePath: values.signature,
      trustPath: values.trust,
      artifactRoot: values["artifact-root"],
      trustedRootSha256: values["trusted-root-sha256"],
    },
    importRoot: values["import-root"],
    registryExportRoot: values["registry-export-root"],
    registryAuthority: values["registry-authority"],
    approvedRegistryAuthorities: values["approved-registry"],
    commissioningEvidenceId: values["commissioning-evidence-id"],
    auditEvidenceId: values["audit-evidence-id"],
  })
  writeFileSync(values.output, canonicalJson(placement), { flag: "wx" })
  process.stdout.write(`${values.output}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run()
