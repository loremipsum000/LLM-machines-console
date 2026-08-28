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
import { PackageURL } from "packageurl-js"
import {
  readCoreImageInventory,
  validateCoreImageLock,
} from "./validate-image-lock.mjs"
import {
  buildReleaseEvidenceIndex,
  minimumExceptionExpiryFromBundle,
  semanticEvidence,
  validateReleaseEvidenceIndex,
} from "./validate-release-evidence-index.mjs"
import { expectedReleaseEvidencePolicy } from "./validate-release-plan.mjs"

const directory = dirname(fileURLToPath(import.meta.url))
export const repositoryRoot = resolve(directory, "../..")
const sha256Pattern = /^sha256:[a-f0-9]{64}$/
const slsaActorKey = ["build", "er"].join("")
const severityOrder = ["critical", "high", "medium", "low", "unknown"]

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

function readCanonicalJson(path, field) {
  const document = readJson(path, field)
  if (readFileSync(path, "utf8") !== `${canonicalJson(document)}\n`) {
    fail(`${field} must use canonical JSON encoding`)
  }
  return document
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

function isCanonicalReleasePackageUrl(value) {
  if (typeof value !== "string") {
    return false
  }

  try {
    const packageUrl = PackageURL.fromString(value)
    return (
      packageUrl.toString() === value &&
      /^[a-z](?:[a-z0-9.+-]*[a-z0-9])?$/.test(packageUrl.type)
    )
  } catch {
    return false
  }
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

function readEvidencePolicy(root) {
  const policy = readJson(
    resolve(root, "infra/release/release-evidence-policy.json"),
    "release evidence policy",
  )
  requireExactKeys(
    policy,
    [
      "schema",
      "status",
      "containsCredentials",
      "runtimeQualified",
      "sbom",
      "provenance",
      "vulnerability",
      "license",
    ],
    "release evidence policy",
  )
  if (
    policy.schema !== "llm-machines.release-evidence-policy.v1" ||
    policy.status !== "SOURCE_POLICY" ||
    policy.containsCredentials !== false ||
    policy.runtimeQualified !== false ||
    canonicalJson(policy) !== canonicalJson(expectedReleaseEvidencePolicy)
  ) {
    fail("release evidence policy is invalid")
  }
  return policy
}

function validateSbom(document, image, policy) {
  const component = document?.metadata?.component
  const tools = document?.metadata?.tools?.components
  const components = document?.components
  const dependencies = document?.dependencies
  const componentRefs = Array.isArray(components)
    ? components.map((entry) => entry?.["bom-ref"])
    : []
  const dependencyRefs = Array.isArray(dependencies)
    ? dependencies.map((entry) => entry?.ref)
    : []
  const allRefs = new Set([component?.["bom-ref"], ...componentRefs])
  const rootDependency = Array.isArray(dependencies)
    ? dependencies.find(({ ref }) => ref === component?.["bom-ref"])
    : undefined
  if (
    document?.bomFormat !== policy.sbom.format ||
    document?.specVersion !== policy.sbom.specVersion ||
    document?.version !== 1 ||
    component?.type !== policy.sbom.componentType ||
    component?.name !== image.id ||
    component?.version !== image.version ||
    typeof component?.["bom-ref"] !== "string" ||
    component["bom-ref"].length === 0 ||
    !component?.hashes?.some(
      ({ alg, content }) =>
        alg === "SHA-256" &&
        content === image.platformDigest.slice("sha256:".length),
    ) ||
    component?.properties?.find(
      ({ name }) => name === "llm-machines:image-platform-digest",
    )?.value !== image.platformDigest ||
    !Array.isArray(tools) ||
    tools.length === 0 ||
    tools.some(
      (tool) =>
        tool?.type !== "application" ||
        typeof tool?.name !== "string" ||
        !policy.sbom.approvedToolNames.includes(tool.name) ||
        typeof tool?.version !== "string" ||
        !/^[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[-+][0-9A-Za-z.-]+)?$/.test(
          tool.version,
        ),
    ) ||
    !Array.isArray(components) ||
    components.length < policy.sbom.minimumInventoryComponents ||
    componentRefs.some((reference) => typeof reference !== "string") ||
    componentRefs.some((reference) => reference.length === 0) ||
    new Set(componentRefs).size !== componentRefs.length ||
    components.some(
      (entry) =>
        !["application", "framework", "library", "operating-system"].includes(
          entry?.type,
        ) ||
        typeof entry?.name !== "string" ||
        entry.name.length === 0 ||
        typeof entry?.version !== "string" ||
        entry.version.length === 0 ||
        !isCanonicalReleasePackageUrl(entry?.purl) ||
        !Array.isArray(entry?.hashes) ||
        !entry.hashes.some(
          ({ alg, content }) =>
            alg === "SHA-256" && /^[a-f0-9]{64}$/.test(content ?? ""),
        ),
    ) ||
    !Array.isArray(dependencies) ||
    dependencyRefs.some((reference) => typeof reference !== "string") ||
    new Set(dependencyRefs).size !== dependencyRefs.length ||
    dependencyRefs.length !== allRefs.size ||
    dependencyRefs.some((reference) => !allRefs.has(reference)) ||
    [...allRefs].some((reference) => !dependencyRefs.includes(reference)) ||
    dependencies.some(
      ({ ref, dependsOn }) =>
        !Array.isArray(dependsOn) ||
        new Set(dependsOn).size !== dependsOn.length ||
        dependsOn.includes(ref) ||
        dependsOn.some((reference) => !allRefs.has(reference)),
    ) ||
    !rootDependency ||
    JSON.stringify([...rootDependency.dependsOn].sort()) !==
      JSON.stringify([...componentRefs].sort()) ||
    componentRefs.some(
      (reference) => !dependencies.some(({ ref }) => ref === reference),
    )
  ) {
    fail(`SBOM for ${image.id} does not bind complete locked-image evidence`)
  }
}

function recipePath(component) {
  if (component.kind === "product-build-output") return component.dockerfile
  if (component.kind === "litellm-oss-build-output")
    return component.sourcePackage
  if (component.kind === "firecrawl-build-output")
    return component.sourcePackage
  return "infra/release/core-image-inventory.json"
}

function expectedResolvedDependencies(component, image, root) {
  const recipe = recipePath(component)
  return [
    {
      uri: `urn:llm-machines:source:${image.id}`,
      digest: { gitCommit: image.sourceRevision },
    },
    {
      uri: `file:${recipe}`,
      digest: {
        sha256: sha256File(resolve(root, recipe)).slice("sha256:".length),
      },
    },
  ]
}

function validateProvenance(document, image, component, root, policy) {
  const digest = image.platformDigest.slice("sha256:".length)
  const buildDefinition = document?.predicate?.buildDefinition
  const runDetails = document?.predicate?.runDetails
  const buildService = runDetails?.[slsaActorKey]
  const recipe = recipePath(component)
  const expectedExternalParameters = {
    componentId: image.id,
    mirrorRepository: image.mirrorRepository,
    imageVersion: image.version,
    sourceRevision: image.sourceRevision,
    ...(component.kind === "third-party-mirror"
      ? {
          approvedSourceImage: {
            indexDigest: image.approvedSourceIndexDigest,
            platform: component.platform,
            platformDigest: image.approvedSourcePlatformDigest,
          },
        }
      : {}),
    recipe: {
      path: recipe,
      sha256: sha256File(resolve(root, recipe)),
    },
  }
  const startedOn = Date.parse(runDetails?.metadata?.startedOn)
  const finishedOn = Date.parse(runDetails?.metadata?.finishedOn)
  if (
    document?._type !== "https://in-toto.io/Statement/v1" ||
    document?.predicateType !== policy.provenance.predicateType ||
    !Array.isArray(document?.subject) ||
    document.subject.length !== 1 ||
    document.subject[0]?.name !== image.mirrorRepository ||
    document.subject[0]?.digest?.sha256 !== digest ||
    buildDefinition?.buildType !==
      policy.provenance.buildTypes[component.kind] ||
    canonicalJson(buildDefinition?.externalParameters) !==
      canonicalJson(expectedExternalParameters) ||
    canonicalJson(buildDefinition?.internalParameters) !== "{}" ||
    canonicalJson(buildDefinition?.resolvedDependencies) !==
      canonicalJson(expectedResolvedDependencies(component, image, root)) ||
    !policy.provenance.approvedBuildActorIds.includes(buildService?.id) ||
    typeof runDetails?.metadata?.invocationId !== "string" ||
    runDetails.metadata.invocationId.length === 0 ||
    !Number.isInteger(startedOn) ||
    !Number.isInteger(finishedOn) ||
    startedOn > finishedOn ||
    !Array.isArray(runDetails?.byproducts)
  ) {
    fail(`provenance for ${image.id} does not bind exact build evidence`)
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
      .filter(
        ({ license, transitiveCopyleftSourceRequired }) =>
          /(?:AGPL|GPL)/.test(license) ||
          transitiveCopyleftSourceRequired === true,
      )
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

function validateVulnerabilityEvidence(
  report,
  disposition,
  reportSha256,
  image,
  policy,
  evidenceEvaluatedAt,
) {
  requireExactKeys(
    report,
    ["schema", "image", "scanner", "database", "scannedAt", "findings"],
    `${image.id} vulnerability report`,
  )
  requireExactKeys(
    disposition,
    [
      "schema",
      "status",
      "containsCredentials",
      "runtimeQualified",
      "image",
      "reportSha256",
      "scanner",
      "database",
      "policy",
      "counts",
      "exceptions",
      "reviewedAt",
      "decision",
    ],
    `${image.id} vulnerability disposition`,
  )
  for (const [value, keys, field] of [
    [report.image, ["id", "mirrorRepository", "digest"], "report image"],
    [report.scanner, ["name", "version"], "report scanner"],
    [report.database, ["updatedAt"], "report database"],
    [
      disposition.image,
      ["id", "mirrorRepository", "digest"],
      "disposition image",
    ],
    [disposition.scanner, ["name", "version"], "disposition scanner"],
    [disposition.database, ["updatedAt"], "disposition database"],
    [
      disposition.policy,
      [
        "maximumDatabaseAgeHours",
        "maximumEvidenceAgeHours",
        "severityThresholds",
        "maximumExceptionAgeDays",
      ],
      "disposition policy",
    ],
    [
      disposition.policy?.severityThresholds,
      ["critical", "high"],
      "disposition thresholds",
    ],
    [disposition.counts, severityOrder, "disposition counts"],
  ]) {
    requireExactKeys(value, keys, `${image.id} ${field}`)
  }
  for (const finding of Array.isArray(report.findings) ? report.findings : []) {
    requireExactKeys(
      finding,
      ["id", "severity", "package", "installedVersion"],
      `${image.id} vulnerability finding`,
    )
  }
  for (const exception of Array.isArray(disposition.exceptions)
    ? disposition.exceptions
    : []) {
    requireExactKeys(
      exception,
      ["findingId", "reason", "approvedBy", "approvedAt", "expiresAt"],
      `${image.id} vulnerability exception`,
    )
  }
  const expectedImage = {
    id: image.id,
    mirrorRepository: image.mirrorRepository,
    digest: image.platformDigest,
  }
  const scannedAt = Date.parse(report?.scannedAt)
  const databaseUpdatedAt = Date.parse(report?.database?.updatedAt)
  const reviewedAt = Date.parse(disposition?.reviewedAt)
  const evaluatedAt = Date.parse(evidenceEvaluatedAt)
  const maximumAgeMs =
    policy.vulnerability.maximumDatabaseAgeHours * 60 * 60 * 1000
  if (
    report.schema !== policy.vulnerability.reportSchema ||
    canonicalJson(report.image) !== canonicalJson(expectedImage) ||
    report.scanner?.name !== policy.vulnerability.scanner ||
    typeof report.scanner?.version !== "string" ||
    !/^[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[-+][0-9A-Za-z.-]+)?$/.test(
      report.scanner.version,
    ) ||
    !Number.isInteger(scannedAt) ||
    !Number.isInteger(databaseUpdatedAt) ||
    !Number.isInteger(evaluatedAt) ||
    databaseUpdatedAt > scannedAt ||
    scannedAt > evaluatedAt ||
    evaluatedAt - databaseUpdatedAt > maximumAgeMs ||
    evaluatedAt - scannedAt >
      policy.vulnerability.maximumEvidenceAgeHours * 60 * 60 * 1000 ||
    !Array.isArray(report.findings) ||
    new Set(report.findings.map(({ id }) => id)).size !==
      report.findings.length ||
    report.findings.some(
      (finding) =>
        typeof finding?.id !== "string" ||
        !severityOrder.includes(finding?.severity) ||
        typeof finding?.package !== "string" ||
        typeof finding?.installedVersion !== "string",
    )
  ) {
    fail(`${image.id} vulnerability report is not admissible`)
  }
  const expectedCounts = Object.fromEntries(
    severityOrder.map((severity) => [
      severity,
      report.findings.filter((finding) => finding.severity === severity).length,
    ]),
  )
  const exceptions = Array.isArray(disposition?.exceptions)
    ? disposition.exceptions
    : []
  const exceptionIds = new Set(exceptions.map(({ findingId }) => findingId))
  const maximumExceptionMs =
    policy.vulnerability.maximumExceptionAgeDays * 24 * 60 * 60 * 1000
  const exceptionsValid = exceptions.every((exception) => {
    const approvedAt = Date.parse(exception?.approvedAt)
    const expiresAt = Date.parse(exception?.expiresAt)
    return (
      typeof exception?.findingId === "string" &&
      report.findings.some(({ id }) => id === exception.findingId) &&
      typeof exception?.reason === "string" &&
      exception.reason.length >= 10 &&
      typeof exception?.approvedBy === "string" &&
      exception.approvedBy.length > 0 &&
      Number.isInteger(approvedAt) &&
      Number.isInteger(expiresAt) &&
      approvedAt <= reviewedAt &&
      approvedAt <= evaluatedAt &&
      expiresAt > reviewedAt &&
      expiresAt > evaluatedAt &&
      expiresAt - approvedAt <= maximumExceptionMs
    )
  })
  const blockingFindings = report.findings.filter(
    ({ id, severity }) =>
      (severity === "critical" || severity === "high") && !exceptionIds.has(id),
  )
  if (
    disposition.schema !== policy.vulnerability.dispositionSchema ||
    disposition.status !== "REVIEWED" ||
    disposition.containsCredentials !== false ||
    disposition.runtimeQualified !== false ||
    canonicalJson(disposition.image) !== canonicalJson(expectedImage) ||
    disposition.reportSha256 !== reportSha256 ||
    canonicalJson(disposition.scanner) !== canonicalJson(report.scanner) ||
    canonicalJson(disposition.database) !== canonicalJson(report.database) ||
    canonicalJson(disposition.policy) !==
      canonicalJson({
        maximumDatabaseAgeHours: policy.vulnerability.maximumDatabaseAgeHours,
        maximumEvidenceAgeHours: policy.vulnerability.maximumEvidenceAgeHours,
        severityThresholds: policy.vulnerability.severityThresholds,
        maximumExceptionAgeDays: policy.vulnerability.maximumExceptionAgeDays,
      }) ||
    canonicalJson(disposition.counts) !== canonicalJson(expectedCounts) ||
    !Number.isInteger(reviewedAt) ||
    reviewedAt < scannedAt ||
    reviewedAt > evaluatedAt ||
    new Set(exceptionIds).size !== exceptions.length ||
    !exceptionsValid ||
    blockingFindings.length > 0 ||
    disposition.decision !== "ACCEPTED"
  ) {
    fail(`${image.id} vulnerability disposition is not release-admissible`)
  }
}

function validateLicenseReview(
  review,
  image,
  licenseTextSha256,
  noticeSha256,
  policy,
) {
  requireExactKeys(
    review,
    [
      "schema",
      "status",
      "component",
      "licenseTextSha256",
      "noticeSha256",
      "reviewedAt",
      "reviewer",
    ],
    `${image.id} license review`,
  )
  requireExactKeys(
    review.component,
    ["id", "mirrorRepository", "sourceRevision", "license"],
    `${image.id} license review component`,
  )
  requireExactKeys(
    review.reviewer,
    ["type", "id"],
    `${image.id} license reviewer`,
  )
  const expectedComponent = {
    id: image.id,
    mirrorRepository: image.mirrorRepository,
    sourceRevision: image.sourceRevision,
    license: image.license,
  }
  if (
    review.schema !== policy.license.reviewSchema ||
    review.status !== policy.license.reviewStatus ||
    canonicalJson(review.component) !== canonicalJson(expectedComponent) ||
    review.licenseTextSha256 !== licenseTextSha256 ||
    review.noticeSha256 !== noticeSha256 ||
    !Number.isInteger(Date.parse(review.reviewedAt)) ||
    review.reviewer?.type !== "release-compliance" ||
    typeof review.reviewer?.id !== "string" ||
    review.reviewer.id.length === 0
  ) {
    fail(`${image.id} license review does not bind exact component evidence`)
  }
}

function buildProductBom(coreLock) {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      tools: {
        components: [
          {
            type: "application",
            name: "llm-machines-release-evidence",
            version: "1",
          },
        ],
      },
      component: {
        type: "application",
        "bom-ref": "llm-machines-core",
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
      "bom-ref": `image:${image.id}`,
      name: image.id,
      version: image.version,
      hashes: [{ alg: "SHA-256", content: image.platformDigest.slice(7) }],
      licenses: [{ license: { id: image.license } }],
      properties: [
        {
          name: "llm-machines:mirror-repository",
          value: image.mirrorRepository,
        },
        {
          name: "llm-machines:oci-archive-path",
          value: image.ociArchivePath,
        },
        {
          name: "llm-machines:oci-archive-sha256",
          value: image.ociArchiveSha256,
        },
        {
          name: "llm-machines:oci-index-digest",
          value: image.indexDigest,
        },
        {
          name: "llm-machines:platform-manifest-digest",
          value: image.platformDigest,
        },
        ...(image.approvedSourceIndexDigest
          ? [
              {
                name: "llm-machines:approved-source-index-digest",
                value: image.approvedSourceIndexDigest,
              },
              {
                name: "llm-machines:approved-source-platform-digest",
                value: image.approvedSourcePlatformDigest,
              },
            ]
          : []),
      ],
    })),
    dependencies: [
      {
        ref: "llm-machines-core",
        dependsOn: coreLock.images.map(({ id }) => `image:${id}`),
      },
      ...coreLock.images.map(({ id }) => ({
        ref: `image:${id}`,
        dependsOn: [],
      })),
    ],
  }
}

function exactIdMap(entries, expectedIds, field) {
  if (!Array.isArray(entries) || entries.length !== expectedIds.length) {
    fail(`${field} does not cover every locked image`)
  }
  const map = new Map()
  for (const entry of entries) {
    if (typeof entry?.id !== "string" || map.has(entry.id)) {
      fail(`${field} has an invalid or duplicate image ID`)
    }
    map.set(entry.id, entry)
  }
  if (expectedIds.some((id) => !map.has(id))) {
    fail(`${field} does not cover every locked image`)
  }
  return map
}

export function validatePackagedReleaseEvidence(
  {
    coreLockPath,
    artifactRoot,
    evidenceArtifacts,
    release,
    signatureTimestamp = null,
  },
  { root = repositoryRoot } = {},
) {
  requireRegularFile(coreLockPath, "Core image lock")
  const inventory = readCoreImageInventory(root)
  const evidencePolicy = readEvidencePolicy(root)
  const coreLock = readJson(coreLockPath, "Core image lock")
  const lockErrors = validateCoreImageLock(coreLock, inventory, root)
  if (lockErrors.length > 0) {
    fail(`Core image lock is invalid: ${lockErrors.join("; ")}`)
  }
  const evaluatedAt = release?.evidenceEvaluatedAt
  if (
    coreLock.release.version !== release?.version ||
    coreLock.release.sourceCommit !== release?.sourceCommit ||
    coreLock.release.sourceTree !== release?.sourceTree ||
    !Number.isInteger(Date.parse(evaluatedAt))
  ) {
    fail("packaged evidence does not bind the release identity")
  }
  const readBundle = (relativePath, field) => {
    const path = resolve(artifactRoot, relativePath)
    requireRegularFile(path, field)
    return readJson(path, field)
  }
  const expectedIds = coreLock.images.map(({ id }) => id).sort()
  const sbomBundle = readBundle(
    "evidence/image-sboms.json",
    "image SBOM bundle",
  )
  const provenanceBundle = readBundle(
    "evidence/image-provenance.json",
    "image provenance bundle",
  )
  const vulnerabilityBundle = readBundle(
    "security/image-vulnerability-evidence.json",
    "image vulnerability bundle",
  )
  const licenseTextBundle = readBundle(
    "licenses/license-texts.json",
    "license text bundle",
  )
  const noticeBundle = readBundle(
    "licenses/third-party-notices.json",
    "third-party notice bundle",
  )
  const licenseReviewBundle = readBundle(
    "licenses/license-reviews.json",
    "license review bundle",
  )
  const bundleSchemas = [
    [sbomBundle, "llm-machines.image-sbom-bundle.v1", "images"],
    [provenanceBundle, "llm-machines.image-provenance-bundle.v1", "images"],
    [
      vulnerabilityBundle,
      "llm-machines.image-vulnerability-evidence.v1",
      "images",
    ],
    [licenseTextBundle, "llm-machines.license-text-bundle.v1", "components"],
    [noticeBundle, "llm-machines.third-party-notices.v1", "components"],
    [licenseReviewBundle, "llm-machines.license-review-bundle.v1", "images"],
  ]
  for (const [bundle, schema, arrayField] of bundleSchemas) {
    if (bundle?.schema !== schema || !Array.isArray(bundle?.[arrayField])) {
      fail(`packaged evidence bundle is invalid: ${schema}`)
    }
  }
  const sboms = exactIdMap(sbomBundle.images, expectedIds, "image SBOM bundle")
  const provenance = exactIdMap(
    provenanceBundle.images,
    expectedIds,
    "image provenance bundle",
  )
  const vulnerabilities = exactIdMap(
    vulnerabilityBundle.images,
    expectedIds,
    "image vulnerability bundle",
  )
  const licenseTexts = exactIdMap(
    licenseTextBundle.components,
    expectedIds,
    "license text bundle",
  )
  const notices = exactIdMap(
    noticeBundle.components,
    expectedIds,
    "third-party notice bundle",
  )
  const licenseReviews = exactIdMap(
    licenseReviewBundle.images,
    expectedIds,
    "license review bundle",
  )
  const inventoryById = new Map(
    inventory.components.map((component) => [component.id, component]),
  )
  for (const image of coreLock.images) {
    const sbom = sboms.get(image.id).document
    const statement = provenance.get(image.id).statement
    const vulnerability = vulnerabilities.get(image.id)
    const licenseText = licenseTexts.get(image.id)
    const notice = notices.get(image.id)
    const licenseReview = licenseReviews.get(image.id).review
    const invalidBindings = [
      ["SBOM", sha256Bytes(`${canonicalJson(sbom)}\n`) !== image.sbomSha256],
      [
        "provenance",
        sha256Bytes(`${canonicalJson(statement)}\n`) !== image.provenanceSha256,
      ],
      [
        "vulnerability report",
        sha256Bytes(`${canonicalJson(vulnerability.report)}\n`) !==
          image.vulnerabilityReportSha256,
      ],
      [
        "vulnerability disposition",
        sha256Bytes(`${canonicalJson(vulnerability.disposition)}\n`) !==
          image.vulnerabilityDispositionSha256,
      ],
      ["license identity", licenseText.license !== image.license],
      ["license digest", licenseText.sha256 !== image.licenseTextSha256],
      [
        "license text",
        sha256Bytes(licenseText.text) !== image.licenseTextSha256,
      ],
      ["notice license", notice.license !== image.license],
      [
        "notice mirror repository",
        notice.mirrorRepository !== image.mirrorRepository,
      ],
      ["notice source", notice.sourceRevision !== image.sourceRevision],
      ["notice digest", notice.sha256 !== image.noticeSha256],
      ["notice text", sha256Bytes(notice.text) !== image.noticeSha256],
      [
        "license review",
        sha256Bytes(`${canonicalJson(licenseReview)}\n`) !==
          image.licenseReviewSha256,
      ],
    ]
      .filter(([, invalid]) => invalid)
      .map(([field]) => field)
    if (invalidBindings.length > 0) {
      fail(
        `${image.id} packaged evidence is invalid: ${invalidBindings.join(", ")}`,
      )
    }
    validateSbom(sbom, image, evidencePolicy)
    validateProvenance(
      statement,
      image,
      inventoryById.get(image.id),
      root,
      evidencePolicy,
    )
    validateVulnerabilityEvidence(
      vulnerability.report,
      vulnerability.disposition,
      image.vulnerabilityReportSha256,
      image,
      evidencePolicy,
      evaluatedAt,
    )
    validateLicenseReview(
      licenseReview,
      image,
      image.licenseTextSha256,
      image.noticeSha256,
      evidencePolicy,
    )
  }
  const productBom = readBundle("bom/product-bom.cdx.json", "Product BOM")
  if (canonicalJson(productBom) !== canonicalJson(buildProductBom(coreLock))) {
    fail("Product BOM does not bind the exact Core image inventory")
  }
  const { policy } = readLicensePolicy(root, inventory)
  const licenseDisposition = readBundle(
    "licenses/license-disposition.json",
    "license disposition bundle",
  )
  const expectedDisposition = {
    ...policy,
    status: "RELEASE_DISPOSITION",
    components: [...coreLock.images]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({ id, license }) => ({ id, license })),
  }
  if (
    canonicalJson(licenseDisposition) !== canonicalJson(expectedDisposition)
  ) {
    fail("license disposition does not bind the exact Core inventory")
  }
  for (const packet of policy.sourcePackets) {
    const packetPath = resolve(artifactRoot, `source/${packet.id}.tar.zst`)
    requireRegularFile(packetPath, `${packet.id} packet`)
    const digest = sha256File(packetPath)
    for (const componentId of packet.components) {
      if (
        coreLock.images.find(({ id }) => id === componentId)
          ?.correspondingSourceSha256 !== digest
      ) {
        fail(`${packet.id} packet differs from ${componentId} lock`)
      }
    }
  }
  const evidenceIndexPath = resolve(
    artifactRoot,
    "evidence/release-evidence-index.json",
  )
  requireRegularFile(evidenceIndexPath, "release evidence index")
  const evidenceIndex = readJson(evidenceIndexPath, "release evidence index")
  validateReleaseEvidenceIndex(
    evidenceIndex,
    {
      coreLock,
      coreLockPath,
      evidenceArtifacts,
      release,
      minimumExceptionExpiry:
        minimumExceptionExpiryFromBundle(vulnerabilityBundle),
      signatureTimestamp,
    },
    { root },
  )
  return { coreLock, evidenceIndex }
}

export function generateReleaseEvidence(
  {
    coreLockPath,
    evidenceRoot,
    correspondingSourceRoot,
    vulnerabilityRoot,
    outputRoot,
    evidenceEvaluatedAt,
  },
  { root = repositoryRoot } = {},
) {
  for (const [field, path] of Object.entries({
    coreLockPath,
    evidenceRoot,
    correspondingSourceRoot,
    vulnerabilityRoot,
    outputRoot,
    evidenceEvaluatedAt,
  })) {
    if (typeof path !== "string" || path.length === 0)
      fail(`${field} is required`)
  }
  requireRegularFile(coreLockPath, "Core image lock")
  if (!Number.isInteger(Date.parse(evidenceEvaluatedAt))) {
    fail("evidenceEvaluatedAt must be an ISO-8601 timestamp")
  }

  const inventory = readCoreImageInventory(root)
  const evidencePolicy = readEvidencePolicy(root)
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
  const vulnerabilityEvidence = []
  const licenseTexts = []
  const notices = []
  const licenseReviews = []
  const exceptionExpiries = []
  const inventoryById = new Map(
    inventory.components.map((component) => [component.id, component]),
  )
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
    const noticePath = resolve(evidenceRoot, "notices", `${image.id}.txt`)
    const licenseReviewPath = resolve(
      evidenceRoot,
      "licenses",
      `${image.id}.review.json`,
    )
    const vulnerabilityReportPath = resolve(
      vulnerabilityRoot,
      `${image.id}.report.json`,
    )
    const vulnerabilityDispositionPath = resolve(
      vulnerabilityRoot,
      `${image.id}.disposition.json`,
    )
    requireRegularFile(sbomPath, `${image.id} SBOM`)
    requireRegularFile(provenancePath, `${image.id} provenance`)
    requireRegularFile(licensePath, `${image.id} license text`)
    requireRegularFile(noticePath, `${image.id} notice`)
    requireRegularFile(licenseReviewPath, `${image.id} license review`)
    requireRegularFile(
      vulnerabilityReportPath,
      `${image.id} vulnerability report`,
    )
    requireRegularFile(
      vulnerabilityDispositionPath,
      `${image.id} vulnerability disposition`,
    )
    if (sha256File(sbomPath) !== image.sbomSha256) {
      fail(`${image.id} SBOM digest differs from the Core lock`)
    }
    if (sha256File(provenancePath) !== image.provenanceSha256) {
      fail(`${image.id} provenance digest differs from the Core lock`)
    }
    if (sha256File(licensePath) !== image.licenseTextSha256) {
      fail(`${image.id} license-text digest differs from the Core lock`)
    }
    if (sha256File(noticePath) !== image.noticeSha256) {
      fail(`${image.id} notice digest differs from the Core lock`)
    }
    if (sha256File(licenseReviewPath) !== image.licenseReviewSha256) {
      fail(`${image.id} license-review digest differs from the Core lock`)
    }
    if (
      sha256File(vulnerabilityReportPath) !== image.vulnerabilityReportSha256
    ) {
      fail(`${image.id} vulnerability-report digest differs from the Core lock`)
    }
    if (
      sha256File(vulnerabilityDispositionPath) !==
      image.vulnerabilityDispositionSha256
    ) {
      fail(
        `${image.id} vulnerability-disposition digest differs from the Core lock`,
      )
    }
    const sbom = readCanonicalJson(sbomPath, `${image.id} SBOM`)
    const statement = readCanonicalJson(
      provenancePath,
      `${image.id} provenance`,
    )
    validateSbom(sbom, image, evidencePolicy)
    validateProvenance(
      statement,
      image,
      inventoryById.get(image.id),
      root,
      evidencePolicy,
    )
    const licenseText = readFileSync(licensePath, "utf8")
    const noticeText = readFileSync(noticePath, "utf8")
    if (licenseText.trim().length < 10)
      fail(`${image.id} license text is empty`)
    if (noticeText.trim().length < 10) fail(`${image.id} notice is empty`)
    const licenseReview = readCanonicalJson(
      licenseReviewPath,
      `${image.id} license review`,
    )
    validateLicenseReview(
      licenseReview,
      image,
      image.licenseTextSha256,
      image.noticeSha256,
      evidencePolicy,
    )
    const vulnerabilityReport = readCanonicalJson(
      vulnerabilityReportPath,
      `${image.id} vulnerability report`,
    )
    const vulnerabilityDisposition = readCanonicalJson(
      vulnerabilityDispositionPath,
      `${image.id} vulnerability disposition`,
    )
    validateVulnerabilityEvidence(
      vulnerabilityReport,
      vulnerabilityDisposition,
      image.vulnerabilityReportSha256,
      image,
      evidencePolicy,
      evidenceEvaluatedAt,
    )
    exceptionExpiries.push(
      ...vulnerabilityDisposition.exceptions.map(({ expiresAt }) => expiresAt),
    )
    const licensePolicy = licenses.get(image.license)
    const sourceRequired =
      licensePolicy.sourceRequired ||
      inventoryById.get(image.id)?.transitiveCopyleftSourceRequired === true
    if (sourceRequired !== Object.hasOwn(image, "correspondingSourceSha256")) {
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
      mirrorRepository: image.mirrorRepository,
      sourceRevision: image.sourceRevision,
      sha256: image.noticeSha256,
      text: noticeText,
    })
    licenseReviews.push({ id: image.id, review: licenseReview })
    vulnerabilityEvidence.push({
      id: image.id,
      report: vulnerabilityReport,
      disposition: vulnerabilityDisposition,
    })
  }
  const bom = buildProductBom(coreLock)

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
    "licenses/license-reviews.json": {
      schema: "llm-machines.license-review-bundle.v1",
      images: licenseReviews,
    },
    "security/image-vulnerability-evidence.json": {
      schema: "llm-machines.image-vulnerability-evidence.v1",
      images: vulnerabilityEvidence,
    },
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
  const evidenceArtifacts = semanticEvidence.map(([evidenceId, path]) => ({
    evidenceId,
    path,
    sha256: sha256File(resolve(outputRoot, path)),
  }))
  const releaseEvidenceIndex = buildReleaseEvidenceIndex(
    {
      coreLock,
      coreLockPath,
      evidenceEvaluatedAt,
      evidenceArtifacts,
      minimumExceptionExpiry:
        exceptionExpiries.length === 0
          ? null
          : [...exceptionExpiries].sort(
              (left, right) => Date.parse(left) - Date.parse(right),
            )[0],
    },
    { root },
  )
  const indexPath = resolve(outputRoot, "evidence/release-evidence-index.json")
  mkdirSync(dirname(indexPath), { recursive: true })
  writeFileSync(indexPath, `${canonicalJson(releaseEvidenceIndex)}\n`, {
    flag: "wx",
  })
  return {
    outputs: [
      ...Object.keys(outputs),
      ...sourcePackets.map(({ id }) => `source/${id}.tar.zst`),
      "evidence/release-evidence-index.json",
    ].sort(),
    sourcePackets: sourcePackets.map(({ id, digest, components }) => ({
      id,
      digest,
      components,
    })),
  }
}

export { canonicalJson, sha256Bytes }
