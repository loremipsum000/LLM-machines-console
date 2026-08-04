import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  canonicalJson,
  sha256 as profileSha256,
  validateDeliveryProfile,
} from "../inference/validate-profile.mjs"

const directory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(directory, "../..")
const digestPattern = /^sha256:[a-f0-9]{64}$/
const sha1Pattern = /^[a-f0-9]{40}$/
const sourceRegistryPattern = /^(?:docker\.io|ghcr\.io|quay\.io)\//
const forbiddenIdentityPattern =
  /(?:^|[/_.:-])(?:latest|sglang-xpu|intel-arc-b50)(?:$|[/_.:-])/i

export const requiredCoreImageIds = [
  "product-edge",
  "console-web",
  "console-bff",
  "keycloak",
  "litellm",
  "product-postgresql",
  "prometheus",
  "alertmanager",
  "grafana-private",
  "firecrawl-api",
  "firecrawl-browser",
  "firecrawl-search",
  "firecrawl-egress",
]

const expectedNodeBase =
  "node:22.23.2-bookworm-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46"
const expectedKeycloakImage =
  "quay.io/keycloak/keycloak:26.7.0@sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13"

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function duplicates(values) {
  return values.filter((value, index) => values.indexOf(value) !== index)
}

function validateDigest(errors, value, field) {
  if (!digestPattern.test(value ?? "")) {
    errors.push(`${field} must be an exact sha256 digest`)
  }
}

function validateReadableVersion(errors, value, field) {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${field} must be a non-empty readable version`)
  } else if (forbiddenIdentityPattern.test(value)) {
    errors.push(`${field} contains a forbidden mutable or demo identity`)
  }
}

export function readCoreImageInventory(root = repositoryRoot) {
  return readJson(resolve(root, "infra/release/core-image-inventory.json"))
}

export function coreInventorySha256(root = repositoryRoot) {
  return sha256(
    readFileSync(resolve(root, "infra/release/core-image-inventory.json")),
  )
}

export function canonicalDocumentSha256(value) {
  return profileSha256(canonicalJson(value))
}

export function validateCoreImageInventory(inventory, root = repositoryRoot) {
  const errors = []
  if (inventory?.schema !== "llm-machines.core-image-inventory.v1") {
    errors.push("Core image inventory schema is not v1")
  }
  if (inventory?.status !== "SOURCE_INVENTORY") {
    errors.push("Core image inventory must remain source-only")
  }
  if (inventory?.containsCredentials !== false) {
    errors.push("Core image inventory must be credential-free")
  }
  if (inventory?.runtimeQualified !== false) {
    errors.push("Core image inventory cannot claim runtime qualification")
  }
  if (
    JSON.stringify(inventory?.coreBaseline) !==
    JSON.stringify({
      vcpus: 8,
      memoryGiB: 32,
      localDiskGiB: 100,
      platform: "linux/amd64",
      backupRepository: "separate-customer-owned-target",
      bulkModelWeights: "excluded",
    })
  ) {
    errors.push("Core image inventory changed the fixed Core baseline")
  }

  const components = Array.isArray(inventory?.components)
    ? inventory.components
    : []
  const ids = components.map(({ id }) => id)
  if (JSON.stringify(ids) !== JSON.stringify(requiredCoreImageIds)) {
    errors.push("Core image inventory does not contain the exact retained set")
  }
  if (duplicates(ids).length > 0) {
    errors.push("Core image inventory contains duplicate components")
  }

  const nodeBase = inventory?.buildInputs?.find(
    ({ id }) => id === "node-runtime-base",
  )
  if (nodeBase?.version !== "22.23.2-bookworm-slim") {
    errors.push("Node runtime base version differs")
  }
  validateDigest(errors, nodeBase?.indexDigest, "Node runtime indexDigest")
  validateDigest(
    errors,
    nodeBase?.platformDigest,
    "Node runtime platformDigest",
  )
  if (nodeBase?.platform !== "linux/amd64") {
    errors.push("Node runtime base must bind linux/amd64")
  }

  for (const component of components) {
    const field = `component ${component.id ?? "unknown"}`
    if (component.required !== true) {
      errors.push(`${field} must be required`)
    }
    validateReadableVersion(errors, component.version, `${field} version`)
    if (typeof component.license !== "string" || !component.license) {
      errors.push(`${field} must declare its license`)
    }
    if (
      typeof component.mirrorRepository !== "string" ||
      !component.mirrorRepository.startsWith("core/")
    ) {
      errors.push(`${field} must declare its private mirror repository`)
    }
    if (component.kind === "third-party-mirror") {
      if (!sourceRegistryPattern.test(component.repository ?? "")) {
        errors.push(`${field} uses an unapproved source registry`)
      }
      validateDigest(errors, component.indexDigest, `${field} indexDigest`)
      validateDigest(
        errors,
        component.platformDigest,
        `${field} platformDigest`,
      )
      if (component.platform !== "linux/amd64") {
        errors.push(`${field} must bind linux/amd64`)
      }
    } else if (component.kind === "product-build-output") {
      if (!component.dockerfile) {
        errors.push(`${field} must bind a Dockerfile`)
      }
    } else if (component.kind === "firecrawl-build-output") {
      if (
        component.sourceLock !== "infra/firecrawl/provenance/source-lock.json"
      ) {
        errors.push(`${field} must bind the reviewed Firecrawl source lock`)
      }
      if (
        component.sourcePackage !==
        "infra/firecrawl/release/source-package.json"
      ) {
        errors.push(`${field} must bind the Firecrawl release source package`)
      }
    } else {
      errors.push(`${field} has an unsupported image kind`)
    }
  }

  for (const dockerfile of ["apps/bff/Dockerfile", "apps/web/Dockerfile"]) {
    const source = readFileSync(resolve(root, dockerfile), "utf8")
    const fromLines = source
      .split(/\r?\n/)
      .filter((line) => line.startsWith("FROM "))
    if (
      JSON.stringify(fromLines) !== JSON.stringify([`FROM ${expectedNodeBase}`])
    ) {
      errors.push(`${dockerfile} must use the exact Node base identity`)
    }
  }

  const sessionPolicy = readJson(
    resolve(root, "infra/keycloak/pr11a-console-session-policy.json"),
  )
  if (sessionPolicy?.keycloakRuntime?.q0Image !== expectedKeycloakImage) {
    errors.push("Keycloak q0Image must use the exact version-plus-digest")
  }

  return errors
}

export function validateCoreImageLock(lock, inventory, root = repositoryRoot) {
  const errors = []
  if (lock?.schema !== "llm-machines.core-image-lock.v1") {
    errors.push("Core image lock schema is not v1")
  }
  if (lock?.status !== "LOCKED") {
    errors.push("Core image lock must be LOCKED")
  }
  if (!sha1Pattern.test(lock?.release?.sourceCommit ?? "")) {
    errors.push("Core image lock source commit is invalid")
  }
  if (!sha1Pattern.test(lock?.release?.sourceTree ?? "")) {
    errors.push("Core image lock source tree is invalid")
  }
  if (lock?.platform !== "linux/amd64") {
    errors.push("Core image lock must bind linux/amd64")
  }
  if (lock?.inventorySha256 !== coreInventorySha256(root)) {
    errors.push("Core image lock inventory fingerprint differs")
  }
  const privateRegistry = lock?.privateRegistry
  if (
    typeof privateRegistry !== "string" ||
    !/^[a-z0-9.-]+(?::[0-9]{1,5})?$/.test(privateRegistry) ||
    ["docker.io", "ghcr.io", "quay.io"].includes(privateRegistry)
  ) {
    errors.push("Core image lock private registry is invalid")
  }

  const images = Array.isArray(lock?.images) ? lock.images : []
  const ids = images.map(({ id }) => id)
  if (JSON.stringify(ids) !== JSON.stringify(requiredCoreImageIds)) {
    errors.push("Core image lock omits, reorders, or adds a retained component")
  }
  if (duplicates(ids).length > 0) {
    errors.push("Core image lock contains duplicate components")
  }

  const inventoryById = new Map(
    inventory.components.map((component) => [component.id, component]),
  )
  for (const image of images) {
    const expected = inventoryById.get(image.id)
    const field = `image ${image.id ?? "unknown"}`
    if (!expected) {
      continue
    }
    if (
      image.repository !== `${privateRegistry}/${expected.mirrorRepository}`
    ) {
      errors.push(`${field} is outside the exact private mirror path`)
    }
    validateReadableVersion(errors, image.version, `${field} version`)
    validateDigest(errors, image.indexDigest, `${field} indexDigest`)
    validateDigest(errors, image.platformDigest, `${field} platformDigest`)
    validateDigest(errors, image.sbomSha256, `${field} sbomSha256`)
    validateDigest(errors, image.provenanceSha256, `${field} provenanceSha256`)
    if (image.platform !== "linux/amd64") {
      errors.push(`${field} must bind linux/amd64`)
    }
    if (image.license !== expected.license) {
      errors.push(`${field} license differs from the inventory`)
    }
    if (expected.kind === "third-party-mirror") {
      if (image.sourceRevision !== expected.sourceRevision) {
        errors.push(`${field} source revision differs from the inventory`)
      }
      if (image.version !== expected.version) {
        errors.push(`${field} version differs from the inventory`)
      }
      if (image.indexDigest !== expected.indexDigest) {
        errors.push(`${field} index digest differs from the approved source`)
      }
      if (image.platformDigest !== expected.platformDigest) {
        errors.push(`${field} platform digest differs from the approved source`)
      }
    } else if (expected.sourceRevision === "release-source-commit") {
      if (image.sourceRevision !== lock?.release?.sourceCommit) {
        errors.push(`${field} must bind the release source commit`)
      }
    } else if (expected.sourceRevision === "release-source-lock") {
      if (
        typeof image.sourceRevision !== "string" ||
        image.sourceRevision.length === 0 ||
        image.sourceRevision === expected.sourceRevision
      ) {
        errors.push(`${field} must bind the resolved source lock revision`)
      }
    } else if (image.sourceRevision !== expected.sourceRevision) {
      errors.push(`${field} source revision differs from the inventory`)
    }
    if (
      /(?:AGPL|GPL)/.test(expected.license) &&
      !digestPattern.test(image.correspondingSourceSha256 ?? "")
    ) {
      errors.push(`${field} requires corresponding-source evidence`)
    }
  }
  return errors
}

export function validateInferenceArtifactLock(lock, documents = {}) {
  const errors = []
  const root = documents?.root ?? repositoryRoot
  const profile = documents?.profile
  const rollbackProfile = documents?.rollbackProfile
  const coreLock = documents?.coreLock
  const inventory = documents?.inventory ?? readCoreImageInventory(root)
  const coreContract = readJson(
    resolve(root, "infra/inference/core-interface-contract.json"),
  )

  if (lock?.schema !== "llm-machines.inference-artifact-lock.v1") {
    errors.push("Inference artifact lock schema is not v1")
  }
  if (lock?.status !== "LOCKED") {
    errors.push("Inference artifact lock must be LOCKED")
  }
  if (lock?.engine?.name !== "sglang" || lock?.engine?.version !== "0.5.13") {
    errors.push("Inference artifact lock must bind SGLang 0.5.13")
  }
  if (
    lock?.engine?.sourceCommit !== "28b095c01005d4a3a2a5b637b7d028b07fba31b2"
  ) {
    errors.push("Inference artifact lock SGLang source commit differs")
  }
  for (const [field, value] of [
    ["profile content", lock?.profile?.contentSha256],
    ["Core lock", lock?.compatibleCoreRelease?.coreImageLockSha256],
    ["engine image", lock?.engine?.imageDigest],
    ["engine platform", lock?.engine?.platformDigest],
    ["engine SBOM", lock?.engine?.sbomSha256],
    ["engine provenance", lock?.engine?.provenanceSha256],
    ["model manifest", lock?.model?.artifactManifestSha256],
    ["model weights", lock?.model?.weightsSha256],
    ["rollback profile", lock?.rollback?.profileContentSha256],
    ["rollback engine", lock?.rollback?.engineImageDigest],
    ["rollback model", lock?.rollback?.modelWeightsSha256],
  ]) {
    validateDigest(errors, value, `Inference ${field}`)
  }
  if (forbiddenIdentityPattern.test(lock?.engine?.repository ?? "")) {
    errors.push("Inference engine repository uses a forbidden identity")
  }
  if (
    typeof lock?.engine?.repository !== "string" ||
    sourceRegistryPattern.test(lock.engine.repository)
  ) {
    errors.push("Inference engine must resolve from an approved private mirror")
  }

  if (!profile) {
    errors.push("Inference artifact lock requires the actual delivery profile")
  } else {
    errors.push(
      ...validateDeliveryProfile(profile, coreContract).map(
        (error) => `Delivery profile: ${error}`,
      ),
    )
    if (lock?.profile?.id !== profile?.metadata?.profileId) {
      errors.push("Inference artifact lock profile ID differs")
    }
    if (
      !Number.isInteger(lock?.profile?.revision) ||
      lock.profile.revision !== profile?.metadata?.revision
    ) {
      errors.push("Inference artifact lock profile revision differs")
    }
    if (lock?.profile?.contentSha256 !== canonicalDocumentSha256(profile)) {
      errors.push("Inference artifact lock profile content hash differs")
    }

    const expectedPlatform = `${profile?.engine?.image?.platform?.os}/${profile?.engine?.image?.platform?.architecture}-${profile?.accelerator?.backend}`
    for (const [field, actual, expected] of [
      ["version", lock?.engine?.version, profile?.engine?.contractVersion],
      [
        "source commit",
        lock?.engine?.sourceCommit,
        profile?.engine?.sourceCommit,
      ],
      [
        "repository",
        lock?.engine?.repository,
        profile?.engine?.image?.privateRegistryMirror,
      ],
      [
        "image digest",
        lock?.engine?.imageDigest,
        profile?.engine?.image?.digest,
      ],
      ["platform", lock?.engine?.platform, expectedPlatform],
      [
        "platform digest",
        lock?.engine?.platformDigest,
        profile?.engine?.image?.digest,
      ],
      ["SBOM", lock?.engine?.sbomSha256, profile?.engine?.image?.sbomDigest],
      [
        "provenance",
        lock?.engine?.provenanceSha256,
        profile?.engine?.image?.provenanceDigest,
      ],
      ["model source", lock?.model?.source, profile?.model?.source],
      ["model revision", lock?.model?.revision, profile?.model?.revision],
      [
        "model manifest",
        lock?.model?.artifactManifestSha256,
        profile?.model?.manifestDigest,
      ],
      [
        "model weights",
        lock?.model?.weightsSha256,
        profile?.model?.artifactDigest,
      ],
      ["model license", lock?.model?.license, profile?.model?.licenseSpdx],
    ]) {
      if (actual !== expected) {
        errors.push(`Inference artifact lock ${field} differs from profile`)
      }
    }
  }

  errors.push(
    ...validateCoreImageLock(coreLock, inventory, root).map(
      (error) => `Compatible Core lock: ${error}`,
    ),
  )
  if (lock?.compatibleCoreRelease?.version !== coreLock?.release?.version) {
    errors.push("Inference artifact lock Core release version differs")
  }
  if (
    coreLock &&
    lock?.compatibleCoreRelease?.coreImageLockSha256 !==
      canonicalDocumentSha256(coreLock)
  ) {
    errors.push("Inference artifact lock Core image-lock hash differs")
  }

  if (!rollbackProfile) {
    errors.push("Inference artifact lock requires the actual rollback profile")
  } else {
    errors.push(
      ...validateDeliveryProfile(rollbackProfile, coreContract).map(
        (error) => `Rollback profile: ${error}`,
      ),
    )
    for (const [field, actual, expected] of [
      [
        "profile ID",
        lock?.rollback?.profileId,
        rollbackProfile?.metadata?.profileId,
      ],
      [
        "profile revision",
        lock?.rollback?.profileRevision,
        rollbackProfile?.metadata?.revision,
      ],
      [
        "profile content hash",
        lock?.rollback?.profileContentSha256,
        canonicalDocumentSha256(rollbackProfile),
      ],
      [
        "engine image",
        lock?.rollback?.engineImageDigest,
        rollbackProfile?.engine?.image?.digest,
      ],
      [
        "model weights",
        lock?.rollback?.modelWeightsSha256,
        rollbackProfile?.model?.artifactDigest,
      ],
      [
        "selected profile rollback ID",
        profile?.rollback?.profileId,
        rollbackProfile?.metadata?.profileId,
      ],
      [
        "selected profile rollback revision",
        profile?.rollback?.revision,
        rollbackProfile?.metadata?.revision,
      ],
      [
        "selected profile rollback engine",
        profile?.rollback?.engineImageDigest,
        rollbackProfile?.engine?.image?.digest,
      ],
      [
        "selected profile rollback model",
        profile?.rollback?.modelArtifactDigest,
        rollbackProfile?.model?.artifactDigest,
      ],
    ]) {
      if (actual !== expected) {
        errors.push(
          `Inference artifact lock ${field} differs from rollback profile`,
        )
      }
    }
  }
  return errors
}

export function verifyCheckedInReleaseIdentityPolicy(root = repositoryRoot) {
  const inventory = readCoreImageInventory(root)
  return validateCoreImageInventory(inventory, root)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = verifyCheckedInReleaseIdentityPolicy()
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error)
    }
    process.exitCode = 1
  } else {
    console.log("Release image source policy passed")
  }
}
