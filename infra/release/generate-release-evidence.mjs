import { createHash } from "node:crypto"
import {
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  readCoreImageInventory,
  validateCoreImageLock,
} from "./validate-image-lock.mjs"

const directory = dirname(fileURLToPath(import.meta.url))
export const repositoryRoot = resolve(directory, "../..")
const sha256Pattern = /^sha256:[a-f0-9]{64}$/
const slsaActorKey = ["build", "er"].join("")
const firecrawlIds = new Set([
  "firecrawl-api",
  "firecrawl-browser",
  "firecrawl-egress",
  "firecrawl-search",
])

function fail(message) {
  throw new Error(message)
}

function readJson(path, field) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    fail(`${field} is not valid JSON`)
  }
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

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path))
}

function requireRegularFile(path, field) {
  let metadata
  try {
    metadata = lstatSync(path)
  } catch {
    fail(`${field} is missing`)
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    fail(`${field} must be a single-link regular file`)
  }
}

function requireExactKeys(value, keys, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${field} must be an object`)
  }
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${field} keys must be exactly ${expected.join(", ")}`)
  }
}

function validateSbom(document, image) {
  if (
    document?.bomFormat !== "CycloneDX" ||
    document?.specVersion !== "1.6" ||
    document?.version !== 1 ||
    document?.metadata?.component?.name !== image.id ||
    document?.metadata?.component?.version !== image.version ||
    document?.metadata?.component?.properties?.find(
      ({ name }) => name === "llm-machines:image-platform-digest",
    )?.value !== image.platformDigest
  ) {
    fail(`SBOM for ${image.id} does not bind the locked image`)
  }
}

function validateProvenance(document, image) {
  const digest = image.platformDigest.slice("sha256:".length)
  const buildDefinition = document?.predicate?.buildDefinition
  const runDetails = document?.predicate?.runDetails
  const buildService = runDetails?.[slsaActorKey]
  if (
    document?._type !== "https://in-toto.io/Statement/v1" ||
    document?.predicateType !== "https://slsa.dev/provenance/v1" ||
    !Array.isArray(document?.subject) ||
    !document.subject.some(
      ({ name, digest: subjectDigest }) =>
        name === image.repository && subjectDigest?.sha256 === digest,
    ) ||
    typeof buildDefinition?.buildType !== "string" ||
    !buildDefinition.buildType.startsWith("https://") ||
    !buildDefinition.externalParameters ||
    typeof buildDefinition.externalParameters !== "object" ||
    Array.isArray(buildDefinition.externalParameters) ||
    !buildDefinition.internalParameters ||
    typeof buildDefinition.internalParameters !== "object" ||
    Array.isArray(buildDefinition.internalParameters) ||
    !Array.isArray(buildDefinition.resolvedDependencies) ||
    buildDefinition.resolvedDependencies.length === 0 ||
    typeof buildService?.id !== "string" ||
    !buildService.id.startsWith("https://") ||
    typeof runDetails?.metadata?.invocationId !== "string" ||
    !Number.isInteger(Date.parse(runDetails?.metadata?.startedOn)) ||
    !Number.isInteger(Date.parse(runDetails?.metadata?.finishedOn)) ||
    !Array.isArray(runDetails?.byproducts)
  ) {
    fail(`provenance for ${image.id} does not bind the locked image`)
  }
}

function readLicensePolicy(root, inventory) {
  const policy = readJson(
    resolve(root, "infra/release/license-disposition.json"),
    "license disposition",
  )
  requireExactKeys(
    policy,
    ["schema", "status", "containsCredentials", "licenses", "sourcePackets"],
    "license disposition",
  )
  if (
    policy.schema !== "llm-machines.license-disposition.v1" ||
    policy.status !== "SOURCE_POLICY" ||
    policy.containsCredentials !== false ||
    !Array.isArray(policy.licenses) ||
    !Array.isArray(policy.sourcePackets)
  ) {
    fail("license disposition policy is invalid")
  }
  const licenses = new Map()
  for (const entry of policy.licenses) {
    requireExactKeys(
      entry,
      ["id", "redistribution", "sourceRequired"],
      "license disposition entry",
    )
    if (licenses.has(entry.id)) fail(`duplicate license policy: ${entry.id}`)
    licenses.set(entry.id, entry)
  }
  const expected = new Set(inventory.components.map(({ license }) => license))
  if (
    licenses.size !== expected.size ||
    [...expected].some((license) => !licenses.has(license))
  ) {
    fail("license disposition does not cover the exact Core inventory")
  }
  const copyleftIds = new Set(
    inventory.components
      .filter(({ license }) => /(?:AGPL|GPL)/.test(license))
      .map(({ id }) => id),
  )
  const packetComponents = []
  const packetIds = new Set()
  for (const packet of policy.sourcePackets) {
    requireExactKeys(packet, ["id", "components"], "source packet policy")
    if (
      !/^[a-z0-9][a-z0-9-]+$/.test(packet.id ?? "") ||
      packetIds.has(packet.id) ||
      !Array.isArray(packet.components) ||
      packet.components.length === 0
    ) {
      fail("source packet policy is invalid or duplicated")
    }
    packetIds.add(packet.id)
    packetComponents.push(...packet.components)
  }
  if (
    packetComponents.length !== copyleftIds.size ||
    new Set(packetComponents).size !== packetComponents.length ||
    packetComponents.some((id) => !copyleftIds.has(id))
  ) {
    fail("source packets do not cover the exact copyleft Core inventory")
  }
  return { policy, licenses }
}

function validateVulnerabilityDisposition(document, images) {
  requireExactKeys(
    document,
    [
      "schema",
      "status",
      "containsCredentials",
      "runtimeQualified",
      "scanner",
      "databaseUpdatedAt",
      "blockingFindings",
      "images",
    ],
    "Firecrawl vulnerability disposition",
  )
  if (
    document.schema !== "llm-machines.firecrawl-vulnerability-disposition.v1" ||
    document.status !== "REVIEWED" ||
    document.containsCredentials !== false ||
    document.runtimeQualified !== false ||
    typeof document.scanner !== "string" ||
    !Number.isInteger(Date.parse(document.databaseUpdatedAt)) ||
    !Array.isArray(document.blockingFindings) ||
    document.blockingFindings.length !== 0 ||
    !Array.isArray(document.images)
  ) {
    fail("Firecrawl vulnerability disposition is not release-admissible")
  }
  const expected = images
    .filter(({ id }) => firecrawlIds.has(id))
    .sort((left, right) => left.id.localeCompare(right.id))
  const actual = [...document.images].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
  if (
    actual.length !== expected.length ||
    actual.some(
      (entry, index) =>
        entry.id !== expected[index].id ||
        entry.imageDigest !== expected[index].platformDigest ||
        entry.decision !== "ACCEPTED",
    )
  ) {
    fail("Firecrawl vulnerability disposition differs from the Core lock")
  }
}

export function generateReleaseEvidence(
  {
    coreLockPath,
    evidenceRoot,
    correspondingSourceRoot,
    firecrawlVulnerabilityPath,
    outputRoot,
  },
  { root = repositoryRoot } = {},
) {
  for (const [field, path] of Object.entries({
    coreLockPath,
    evidenceRoot,
    correspondingSourceRoot,
    firecrawlVulnerabilityPath,
    outputRoot,
  })) {
    if (typeof path !== "string" || path.length === 0)
      fail(`${field} is required`)
  }
  requireRegularFile(coreLockPath, "Core image lock")
  requireRegularFile(
    firecrawlVulnerabilityPath,
    "Firecrawl vulnerability disposition",
  )

  const inventory = readCoreImageInventory(root)
  const coreLock = readJson(coreLockPath, "Core image lock")
  const lockErrors = validateCoreImageLock(coreLock, inventory, root)
  if (lockErrors.length > 0)
    fail(`Core image lock is invalid: ${lockErrors.join("; ")}`)
  const { policy, licenses } = readLicensePolicy(root, inventory)
  const sourcePackets = []
  for (const packet of policy.sourcePackets) {
    const path = resolve(correspondingSourceRoot, `${packet.id}.tar.zst`)
    requireRegularFile(path, `${packet.id} packet`)
    const digest = sha256File(path)
    for (const componentId of packet.components) {
      const image = coreLock.images.find(({ id }) => id === componentId)
      if (image?.correspondingSourceSha256 !== digest) {
        fail(`${packet.id} packet differs from ${componentId} lock`)
      }
    }
    sourcePackets.push({ ...packet, path, digest })
  }

  const sboms = []
  const provenance = []
  const licenseTexts = []
  const notices = []
  for (const image of [...coreLock.images].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const sbomPath = resolve(evidenceRoot, "sbom", `${image.id}.cdx.json`)
    const provenancePath = resolve(
      evidenceRoot,
      "provenance",
      `${image.id}.intoto.json`,
    )
    const licensePath = resolve(evidenceRoot, "licenses", `${image.id}.txt`)
    requireRegularFile(sbomPath, `${image.id} SBOM`)
    requireRegularFile(provenancePath, `${image.id} provenance`)
    requireRegularFile(licensePath, `${image.id} license text`)
    if (sha256File(sbomPath) !== image.sbomSha256) {
      fail(`${image.id} SBOM digest differs from the Core lock`)
    }
    if (sha256File(provenancePath) !== image.provenanceSha256) {
      fail(`${image.id} provenance digest differs from the Core lock`)
    }
    const sbom = readJson(sbomPath, `${image.id} SBOM`)
    const statement = readJson(provenancePath, `${image.id} provenance`)
    validateSbom(sbom, image)
    validateProvenance(statement, image)
    const licenseText = readFileSync(licensePath, "utf8")
    if (licenseText.trim().length < 10)
      fail(`${image.id} license text is empty`)
    const licensePolicy = licenses.get(image.license)
    if (
      licensePolicy.sourceRequired !==
      Object.hasOwn(image, "correspondingSourceSha256")
    ) {
      fail(`${image.id} corresponding-source policy differs from its license`)
    }
    sboms.push({ id: image.id, document: sbom })
    provenance.push({ id: image.id, statement })
    licenseTexts.push({
      id: image.id,
      license: image.license,
      sha256: sha256File(licensePath),
      text: licenseText,
    })
    notices.push({
      id: image.id,
      license: image.license,
      repository: image.repository,
      sourceRevision: image.sourceRevision,
    })
  }

  const vulnerability = readJson(
    firecrawlVulnerabilityPath,
    "Firecrawl vulnerability disposition",
  )
  validateVulnerabilityDisposition(vulnerability, coreLock.images)
  const bom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: {
        type: "application",
        name: "llm-machines-core",
        version: coreLock.release.version,
        properties: [
          {
            name: "llm-machines:source-commit",
            value: coreLock.release.sourceCommit,
          },
          {
            name: "llm-machines:source-tree",
            value: coreLock.release.sourceTree,
          },
          { name: "llm-machines:runtime-qualified", value: "false" },
        ],
      },
    },
    components: coreLock.images.map((image) => ({
      type: "container",
      name: image.id,
      version: image.version,
      hashes: [{ alg: "SHA-256", content: image.platformDigest.slice(7) }],
      licenses: [{ license: { id: image.license } }],
    })),
  }

  const outputs = {
    "bom/product-bom.cdx.json": bom,
    "evidence/image-sboms.json": {
      schema: "llm-machines.image-sbom-bundle.v1",
      images: sboms,
    },
    "evidence/image-provenance.json": {
      schema: "llm-machines.image-provenance-bundle.v1",
      images: provenance,
    },
    "licenses/third-party-notices.json": {
      schema: "llm-machines.third-party-notices.v1",
      components: notices,
    },
    "licenses/license-texts.json": {
      schema: "llm-machines.license-text-bundle.v1",
      components: licenseTexts,
    },
    "licenses/license-disposition.json": {
      ...policy,
      status: "RELEASE_DISPOSITION",
      components: notices.map(({ id, license }) => ({ id, license })),
    },
    "security/firecrawl-vulnerability-disposition.json": vulnerability,
  }
  for (const [relativePath, value] of Object.entries(outputs)) {
    const path = resolve(outputRoot, relativePath)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${canonicalJson(value)}\n`, { flag: "wx" })
  }
  for (const packet of sourcePackets) {
    const sourceOutput = resolve(outputRoot, `source/${packet.id}.tar.zst`)
    mkdirSync(dirname(sourceOutput), { recursive: true })
    copyFileSync(packet.path, sourceOutput, constants.COPYFILE_EXCL)
  }
  return {
    outputs: [
      ...Object.keys(outputs),
      ...sourcePackets.map(({ id }) => `source/${id}.tar.zst`),
    ].sort(),
    sourcePackets: sourcePackets.map(({ id, digest, components }) => ({
      id,
      digest,
      components,
    })),
  }
}

export { canonicalJson, sha256Bytes }
