import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const directory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(directory, "../..")
const sha256Pattern = /^sha256:[a-f0-9]{64}$/

export const semanticEvidence = [
  ["product-bom", "bom/product-bom.cdx.json"],
  ["image-sboms", "evidence/image-sboms.json"],
  ["image-provenance", "evidence/image-provenance.json"],
  ["third-party-notices", "licenses/third-party-notices.json"],
  ["license-texts", "licenses/license-texts.json"],
  ["license-disposition", "licenses/license-disposition.json"],
  ["license-reviews", "licenses/license-reviews.json"],
  [
    "image-vulnerability-evidence",
    "security/image-vulnerability-evidence.json",
  ],
  [
    "firecrawl-corresponding-source",
    "source/firecrawl-corresponding-source.tar.zst",
  ],
  [
    "grafana-corresponding-source",
    "source/grafana-corresponding-source.tar.zst",
  ],
]

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

function exactKeys(value, keys, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${field} must be an object`)
  }
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${field} keys must be exactly ${expected.join(", ")}`)
  }
}

function imageEvidenceProjection(image) {
  return {
    id: image.id,
    repository: image.repository,
    sourceRevision: image.sourceRevision,
    platformDigest: image.platformDigest,
    sbomSha256: image.sbomSha256,
    provenanceSha256: image.provenanceSha256,
    vulnerabilityReportSha256: image.vulnerabilityReportSha256,
    vulnerabilityDispositionSha256: image.vulnerabilityDispositionSha256,
    licenseTextSha256: image.licenseTextSha256,
    noticeSha256: image.noticeSha256,
    licenseReviewSha256: image.licenseReviewSha256,
    ...(image.correspondingSourceSha256
      ? { correspondingSourceSha256: image.correspondingSourceSha256 }
      : {}),
  }
}

export function buildReleaseEvidenceIndex(
  {
    coreLock,
    coreLockPath,
    evidenceEvaluatedAt,
    evidenceArtifacts,
    minimumExceptionExpiry,
  },
  { root = repositoryRoot } = {},
) {
  const artifactMap = new Map(
    evidenceArtifacts.map((artifact) => [artifact.evidenceId, artifact]),
  )
  return {
    schema: "llm-machines.release-evidence-index.v1",
    status: "SEMANTICALLY_VALIDATED",
    containsCredentials: false,
    runtimeQualified: false,
    release: {
      version: coreLock.release.version,
      sourceCommit: coreLock.release.sourceCommit,
      sourceTree: coreLock.release.sourceTree,
      evidenceEvaluatedAt,
    },
    contracts: {
      evidenceGeneratorSha256: sha256File(
        resolve(root, "infra/release/generate-release-evidence.mjs"),
      ),
      evidenceIndexValidatorSha256: sha256File(
        resolve(root, "infra/release/validate-release-evidence-index.mjs"),
      ),
      evidencePolicySha256: sha256File(
        resolve(root, "infra/release/release-evidence-policy.json"),
      ),
      coreImageLockSha256: sha256File(coreLockPath),
    },
    images: [...coreLock.images]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(imageEvidenceProjection),
    artifacts: semanticEvidence.map(([evidenceId, path]) => {
      const artifact = artifactMap.get(evidenceId)
      if (
        !artifact ||
        artifact.path !== path ||
        !sha256Pattern.test(artifact.sha256)
      ) {
        fail(`semantic evidence artifact is missing or invalid: ${evidenceId}`)
      }
      return { evidenceId, path, sha256: artifact.sha256 }
    }),
    minimumExceptionExpiry,
  }
}

export function validateReleaseEvidenceIndex(
  index,
  {
    coreLock,
    coreLockPath,
    evidenceArtifacts,
    release,
    minimumExceptionExpiry,
    signatureTimestamp = null,
  },
  { root = repositoryRoot } = {},
) {
  exactKeys(
    index,
    [
      "schema",
      "status",
      "containsCredentials",
      "runtimeQualified",
      "release",
      "contracts",
      "images",
      "artifacts",
      "minimumExceptionExpiry",
    ],
    "release evidence index",
  )
  exactKeys(
    index.release,
    ["version", "sourceCommit", "sourceTree", "evidenceEvaluatedAt"],
    "release evidence index release",
  )
  exactKeys(
    index.contracts,
    [
      "evidenceGeneratorSha256",
      "evidenceIndexValidatorSha256",
      "evidencePolicySha256",
      "coreImageLockSha256",
    ],
    "release evidence index contracts",
  )
  const evaluatedAt = Date.parse(index.release.evidenceEvaluatedAt)
  const sourceDate = Number.isInteger(release.sourceDateEpoch)
    ? release.sourceDateEpoch * 1000
    : Number.NaN
  if (
    index.schema !== "llm-machines.release-evidence-index.v1" ||
    index.status !== "SEMANTICALLY_VALIDATED" ||
    index.containsCredentials !== false ||
    index.runtimeQualified !== false ||
    !Number.isInteger(evaluatedAt) ||
    !Number.isInteger(sourceDate) ||
    evaluatedAt < sourceDate ||
    canonicalJson(index.release) !==
      canonicalJson({
        version: release.version,
        sourceCommit: release.sourceCommit,
        sourceTree: release.sourceTree,
        evidenceEvaluatedAt: release.evidenceEvaluatedAt,
      })
  ) {
    fail("release evidence index does not bind the release identity")
  }
  const expectedContracts = {
    evidenceGeneratorSha256: sha256File(
      resolve(root, "infra/release/generate-release-evidence.mjs"),
    ),
    evidenceIndexValidatorSha256: sha256File(
      resolve(root, "infra/release/validate-release-evidence-index.mjs"),
    ),
    evidencePolicySha256: sha256File(
      resolve(root, "infra/release/release-evidence-policy.json"),
    ),
    coreImageLockSha256: sha256File(coreLockPath),
  }
  if (canonicalJson(index.contracts) !== canonicalJson(expectedContracts)) {
    fail("release evidence index contract digests are invalid")
  }
  const expectedImages = [...coreLock.images]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(imageEvidenceProjection)
  if (canonicalJson(index.images) !== canonicalJson(expectedImages)) {
    fail("release evidence index does not bind every locked image")
  }
  const expectedArtifacts = semanticEvidence.map(([evidenceId, path]) => {
    const artifact = evidenceArtifacts.find(
      (candidate) => candidate.evidenceId === evidenceId,
    )
    if (
      !artifact ||
      artifact.path !== path ||
      !sha256Pattern.test(artifact.sha256)
    ) {
      fail(`release evidence index artifact is invalid: ${evidenceId}`)
    }
    return { evidenceId, path, sha256: artifact.sha256 }
  })
  if (canonicalJson(index.artifacts) !== canonicalJson(expectedArtifacts)) {
    fail("release evidence index does not bind exact generated evidence")
  }
  if (index.minimumExceptionExpiry !== minimumExceptionExpiry) {
    fail(
      "release evidence index exception expiry differs from packaged evidence",
    )
  }
  if (index.minimumExceptionExpiry !== null) {
    const expiry = Date.parse(index.minimumExceptionExpiry)
    const signatureTime =
      signatureTimestamp === null ? evaluatedAt : Date.parse(signatureTimestamp)
    if (
      !Number.isInteger(expiry) ||
      !Number.isInteger(signatureTime) ||
      expiry <= signatureTime
    ) {
      fail("vulnerability exception expired before evidence admission")
    }
  }
}

export function minimumExceptionExpiryFromBundle(bundle) {
  if (
    bundle?.schema !== "llm-machines.image-vulnerability-evidence.v1" ||
    !Array.isArray(bundle?.images)
  ) {
    fail("image vulnerability bundle cannot derive exception expiry")
  }
  const expiries = []
  for (const image of bundle.images) {
    if (!Array.isArray(image?.disposition?.exceptions)) {
      fail("image vulnerability disposition cannot derive exception expiry")
    }
    for (const exception of image.disposition.exceptions) {
      if (
        typeof exception?.expiresAt !== "string" ||
        !Number.isInteger(Date.parse(exception.expiresAt))
      ) {
        fail("vulnerability exception expiry is invalid")
      }
      expiries.push(exception.expiresAt)
    }
  }
  return expiries.length === 0
    ? null
    : expiries.sort((left, right) => Date.parse(left) - Date.parse(right))[0]
}

export { canonicalJson }
