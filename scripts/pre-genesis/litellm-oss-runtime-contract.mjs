import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const sourcePackagePath = "infra/litellm/oss-downstream/source-package.json"
const inventoryPath = "infra/release/core-image-inventory.json"

export function loadLiteLlmOssRuntimeContract(repositoryRoot) {
  return validateLiteLlmOssRuntimeContract({
    inventory: readJson(resolve(repositoryRoot, inventoryPath)),
    sourcePackage: readJson(resolve(repositoryRoot, sourcePackagePath)),
  })
}

export function validateLiteLlmOssRuntimeContract({
  inventory,
  sourcePackage,
}) {
  const component = inventory?.components?.find(({ id }) => id === "litellm")
  requireValue(component, "Core inventory must contain LiteLLM")
  requireEqual(
    component.kind,
    "litellm-oss-build-output",
    "LiteLLM inventory kind",
  )
  requireEqual(
    component.sourcePackage,
    sourcePackagePath,
    "LiteLLM source-package path",
  )
  requireEqual(
    component.version,
    sourcePackage?.downstream?.version,
    "LiteLLM downstream version",
  )
  requireEqual(
    component.sourceRevision,
    sourcePackage?.upstream?.revision,
    "LiteLLM source revision",
  )
  requireEqual(
    component.mirrorRepository,
    sourcePackage?.downstream?.mirrorRepository,
    "LiteLLM mirror repository",
  )
  requireEqual(
    sourcePackage?.downstream?.platform,
    "linux/amd64",
    "LiteLLM runtime platform",
  )
  requireEqual(
    sourcePackage?.downstream?.artifactEvidence?.byteIdentical,
    true,
    "LiteLLM deterministic image result",
  )
  requireEqual(
    sourcePackage?.downstream?.artifactEvidence?.independentBuilds,
    2,
    "LiteLLM independent build count",
  )

  const image = sourcePackage?.downstream?.artifactEvidence?.configDigest
  requireDigest(image, "LiteLLM OCI config digest")
  requireDigest(
    sourcePackage?.downstream?.artifactEvidence?.manifestDigest,
    "LiteLLM OCI manifest digest",
  )
  requireHex(
    sourcePackage?.downstream?.artifactEvidence?.ociArchiveSha256,
    "LiteLLM OCI archive SHA-256",
  )

  return Object.freeze({
    image,
    manifestDigest: sourcePackage.downstream.artifactEvidence.manifestDigest,
    mirrorRepository: component.mirrorRepository,
    ociArchiveSha256:
      sourcePackage.downstream.artifactEvidence.ociArchiveSha256,
    platform: sourcePackage.downstream.platform,
    sourceRevision: sourcePackage.upstream.revision,
    version: sourcePackage.downstream.version,
  })
}

export function validateLiteLlmOssRuntimeInspection(inspection, contract) {
  requireEqual(inspection?.Id, contract.image, "LiteLLM loaded image ID")
  requireEqual(inspection?.Os, "linux", "LiteLLM loaded image OS")
  requireEqual(
    inspection?.Architecture,
    "amd64",
    "LiteLLM loaded image architecture",
  )
  const labels = inspection?.Config?.Labels
  requireEqual(
    labels?.["org.opencontainers.image.title"],
    "LiteLLM OSS Downstream",
    "LiteLLM OCI title",
  )
  requireEqual(
    labels?.["org.opencontainers.image.version"],
    contract.version,
    "LiteLLM OCI version",
  )
  requireEqual(
    labels?.["org.opencontainers.image.revision"],
    contract.sourceRevision,
    "LiteLLM OCI source revision",
  )
  requireEqual(
    labels?.["org.opencontainers.image.licenses"],
    "MIT",
    "LiteLLM OCI license",
  )
}

export function inspectLiteLlmOssRuntimeImage(runDocker, image) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = runDocker(["image", "inspect", image])
    if (result.error || result.status !== 0) {
      throw new Error("LiteLLM Docker image inspection failed")
    }
    const output = result.stdout?.trim()
    if (!output) continue

    let inspections
    try {
      inspections = JSON.parse(output)
    } catch {
      throw new Error("LiteLLM Docker image inspection returned malformed JSON")
    }
    if (!Array.isArray(inspections) || inspections.length !== 1) {
      throw new Error("LiteLLM Docker image inspection must return one image")
    }
    return inspections[0]
  }
  throw new Error("LiteLLM Docker image inspection returned no output")
}

export function loadCoreImageInventoryAtHead(runGit, repositoryRoot) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = runGit(
      [
        "-c",
        `safe.directory=${repositoryRoot}`,
        "show",
        "HEAD:infra/release/core-image-inventory.json",
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    )
    if (result.error || result.status !== 0) {
      throw new Error("Core image inventory Git read failed")
    }
    const output = result.stdout?.trim()
    if (!output) continue

    let inventory
    try {
      inventory = JSON.parse(output)
    } catch {
      throw new Error("Core image inventory Git read returned malformed JSON")
    }
    if (!inventory || !Array.isArray(inventory.components)) {
      throw new Error(
        "Core image inventory Git read returned an invalid inventory",
      )
    }
    return inventory
  }
  throw new Error("Core image inventory Git read returned no output")
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function requireDigest(value, field) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value ?? "")) {
    throw new Error(`${field} must be an exact SHA-256 digest`)
  }
}

function requireHex(value, field) {
  if (!/^[a-f0-9]{64}$/.test(value ?? "")) {
    throw new Error(`${field} must be an exact SHA-256 value`)
  }
}

function requireEqual(actual, expected, field) {
  if (actual !== expected) {
    throw new Error(`${field} does not match the admitted OSS contract`)
  }
}

function requireValue(value, message) {
  if (!value) throw new Error(message)
}
