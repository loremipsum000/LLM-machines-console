#!/usr/bin/env node

import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  coreInventorySha256,
  readCoreImageInventory,
  requiredCoreImageIds,
  validateCoreImageLock,
} from "../validate-image-lock.mjs"

const directory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(directory, "../../..")
const sha256Pattern = /^sha256:[a-f0-9]{64}$/

function fail(message) {
  throw new Error(message)
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function sha256File(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`
}

function sourcePacketId(component) {
  if (component.id === "litellm") return "litellm-oss-transitive-sources"
  if (component.id === "grafana-private") return "grafana-corresponding-source"
  if (component.id.startsWith("firecrawl-"))
    return "firecrawl-corresponding-source"
  return null
}

function evidenceKeys(component) {
  return [
    "sbomSha256",
    "provenanceSha256",
    "vulnerabilityReportSha256",
    "vulnerabilityDispositionSha256",
    "licenseTextSha256",
    "noticeSha256",
    "licenseReviewSha256",
    ...(sourcePacketId(component) ? ["correspondingSourceSha256"] : []),
  ]
}

export function buildCoreImageLock({
  comparison,
  evidenceDigests,
  inventory,
  release,
  root = repositoryRoot,
}) {
  if (
    comparison?.schema !== "llm-machines.vm103-l1b-assembly-comparison.v1" ||
    comparison?.status !== "BYTE_IDENTICAL_IMAGE_SET" ||
    comparison?.imageCount !== requiredCoreImageIds.length ||
    JSON.stringify(comparison?.images?.map(({ id }) => id)) !==
      JSON.stringify(requiredCoreImageIds)
  ) {
    fail("Core lock requires the exact byte-identical L1B comparison")
  }
  if (
    !/^[a-f0-9]{40}$/.test(release?.sourceCommit ?? "") ||
    !/^[a-f0-9]{40}$/.test(release?.sourceTree ?? "") ||
    typeof release?.version !== "string" ||
    release.version.length === 0
  ) {
    fail("Core lock release identity is invalid")
  }
  const evidenceById = new Map(
    Array.isArray(evidenceDigests)
      ? evidenceDigests.map((entry) => [entry.id, entry])
      : [],
  )
  const inventoryById = new Map(
    inventory.components.map((entry) => [entry.id, entry]),
  )
  const comparisonById = new Map(
    comparison.images.map((entry) => [entry.id, entry]),
  )
  const images = requiredCoreImageIds.map((id) => {
    const component = inventoryById.get(id)
    const artifact = comparisonById.get(id)
    const evidence = evidenceById.get(id)
    const expectedEvidenceKeys = ["id", ...evidenceKeys(component)].sort()
    if (
      !component ||
      !artifact ||
      !evidence ||
      JSON.stringify(Object.keys(evidence).sort()) !==
        JSON.stringify(expectedEvidenceKeys) ||
      evidenceKeys(component).some((key) => !sha256Pattern.test(evidence[key]))
    ) {
      fail(`${id} evidence bindings are incomplete or mutable`)
    }
    const thirdParty = component.kind === "third-party-mirror"
    return {
      id,
      mirrorRepository: component.mirrorRepository,
      version:
        component.version === "release-version"
          ? release.version
          : component.version,
      ociArchivePath: `images/${id}.oci.tar.zst`,
      ociArchiveSha256: artifact.ociArchiveSha256,
      approvedSourceIndexDigest: thirdParty ? component.indexDigest : null,
      approvedSourcePlatformDigest: thirdParty
        ? component.platformDigest
        : null,
      indexDigest: artifact.indexDigest,
      platform: "linux/amd64",
      platformDigest: artifact.platformDigest,
      sourceRevision:
        component.sourceRevision === "release-source-commit"
          ? release.sourceCommit
          : component.sourceRevision,
      license: component.license,
      ...Object.fromEntries(
        evidenceKeys(component).map((key) => [key, evidence[key]]),
      ),
    }
  })
  const lock = {
    schema: "llm-machines.core-image-lock.v2",
    status: "LOCKED",
    release,
    inventorySha256: coreInventorySha256(root),
    platform: "linux/amd64",
    images,
  }
  const errors = validateCoreImageLock(lock, inventory, root)
  if (errors.length > 0)
    fail(`generated Core image lock is invalid: ${errors.join("; ")}`)
  return lock
}

function evidenceDigests(
  evidenceRoot,
  vulnerabilityRoot,
  correspondingSourceRoot,
  inventory,
) {
  const packets = new Map([
    [
      "firecrawl-corresponding-source",
      resolve(
        correspondingSourceRoot,
        "firecrawl-corresponding-source.tar.zst",
      ),
    ],
    [
      "grafana-corresponding-source",
      resolve(correspondingSourceRoot, "grafana-corresponding-source.tar.zst"),
    ],
    [
      "litellm-oss-transitive-sources",
      resolve(
        correspondingSourceRoot,
        "litellm-oss-transitive-sources.tar.zst",
      ),
    ],
  ])
  return inventory.components.map((component) => {
    const id = component.id
    const result = {
      id,
      sbomSha256: sha256File(resolve(evidenceRoot, "sbom", `${id}.cdx.json`)),
      provenanceSha256: sha256File(
        resolve(evidenceRoot, "provenance", `${id}.intoto.json`),
      ),
      vulnerabilityReportSha256: sha256File(
        resolve(vulnerabilityRoot, `${id}.report.json`),
      ),
      vulnerabilityDispositionSha256: sha256File(
        resolve(vulnerabilityRoot, `${id}.disposition.json`),
      ),
      licenseTextSha256: sha256File(
        resolve(evidenceRoot, "licenses", `${id}.txt`),
      ),
      noticeSha256: sha256File(resolve(evidenceRoot, "notices", `${id}.txt`)),
      licenseReviewSha256: sha256File(
        resolve(evidenceRoot, "licenses", `${id}.review.json`),
      ),
    }
    const packet = sourcePacketId(component)
    if (packet)
      result.correspondingSourceSha256 = sha256File(packets.get(packet))
    return result
  })
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2)
    values.set(argv[index], argv[index + 1])
  const required = [
    "--comparison",
    "--evidence-root",
    "--vulnerability-root",
    "--corresponding-source-root",
    "--version",
    "--source-commit",
    "--source-tree",
    "--output",
  ]
  if (
    values.size !== required.length ||
    required.some((key) => !values.get(key))
  ) {
    fail(`expected ${required.join(" VALUE ")} VALUE`)
  }
  return values
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2))
  const inventory = readCoreImageInventory(repositoryRoot)
  const lock = buildCoreImageLock({
    comparison: JSON.parse(
      readFileSync(resolve(args.get("--comparison")), "utf8"),
    ),
    evidenceDigests: evidenceDigests(
      resolve(args.get("--evidence-root")),
      resolve(args.get("--vulnerability-root")),
      resolve(args.get("--corresponding-source-root")),
      inventory,
    ),
    inventory,
    release: {
      version: args.get("--version"),
      sourceCommit: args.get("--source-commit"),
      sourceTree: args.get("--source-tree"),
    },
  })
  writeFileSync(resolve(args.get("--output")), `${canonicalJson(lock)}\n`, {
    flag: "wx",
    mode: 0o600,
  })
}
