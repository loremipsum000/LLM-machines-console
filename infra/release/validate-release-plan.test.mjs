import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import {
  canonicalJson as canonicalEvidence,
  generateReleaseEvidence,
} from "./generate-release-evidence.mjs"
import {
  canonicalJson,
  generateReleaseManifest,
} from "./generate-release-manifest.mjs"
import { generateInitialInstallDescriptor } from "./generate-rollback-descriptor.mjs"
import {
  coreInventorySha256,
  readCoreImageInventory,
} from "./validate-image-lock.mjs"
import { semanticEvidence } from "./validate-release-evidence-index.mjs"
import {
  validateReleasePlan,
  verifyCheckedInReleasePlan,
} from "./validate-release-plan.mjs"

const root = new URL("../../", import.meta.url)
const rootPath = root.pathname
const plan = JSON.parse(
  readFileSync(new URL("./release-plan.json", import.meta.url), "utf8"),
)
const slsaActorKey = ["build", "er"].join("")

function git(...arguments_) {
  return execFileSync("git", ["-C", rootPath, ...arguments_], {
    encoding: "utf8",
  }).trim()
}

function digest(character) {
  return `sha256:${character.repeat(64)}`
}

function syntheticCoreLock(version) {
  const inventory = readCoreImageInventory()
  const sourceCommit = git("rev-parse", "HEAD^{commit}")
  const sourceTree = git("rev-parse", "HEAD^{tree}")
  return {
    schema: "llm-machines.core-image-lock.v2",
    status: "LOCKED",
    release: { version, sourceCommit, sourceTree },
    inventorySha256: coreInventorySha256(),
    platform: "linux/amd64",
    images: inventory.components.map((component, index) => {
      const first = ((index + 1) % 16).toString(16)
      const second = ((index + 2) % 16).toString(16)
      return {
        id: component.id,
        mirrorRepository: component.mirrorRepository,
        version:
          component.kind === "third-party-mirror"
            ? component.version
            : component.kind === "litellm-oss-build-output"
              ? component.version
              : `${version}-build.${index + 1}`,
        ociArchivePath: `images/${component.id}.oci.tar.zst`,
        ociArchiveSha256: digest("9"),
        approvedSourceIndexDigest:
          component.kind === "third-party-mirror"
            ? component.indexDigest
            : null,
        approvedSourcePlatformDigest:
          component.kind === "third-party-mirror"
            ? component.platformDigest
            : null,
        indexDigest:
          component.kind === "third-party-mirror"
            ? component.indexDigest
            : digest(first),
        platform: "linux/amd64",
        platformDigest:
          component.kind === "third-party-mirror"
            ? component.platformDigest
            : digest(second),
        sourceRevision:
          component.sourceRevision === "release-source-commit"
            ? sourceCommit
            : component.sourceRevision === "release-source-lock"
              ? "firecrawl-source-lock-v2.11.0"
              : component.sourceRevision,
        license: component.license,
        sbomSha256: digest("a"),
        provenanceSha256: digest("b"),
        vulnerabilityReportSha256: digest("d"),
        vulnerabilityDispositionSha256: digest("e"),
        licenseTextSha256: digest("f"),
        noticeSha256: digest("7"),
        licenseReviewSha256: digest("8"),
        ...(/(?:AGPL|GPL)/.test(component.license) ||
        component.transitiveCopyleftSourceRequired === true
          ? { correspondingSourceSha256: digest("c") }
          : {}),
      }
    }),
  }
}

function classificationFor(evidenceId) {
  if (evidenceId === "installer") return "installer"
  if (evidenceId === "rollback") return "rollback"
  if (evidenceId === "public-release-trust") return "public-trust"
  if (evidenceId === "firecrawl-corresponding-source") return "source"
  if (evidenceId === "grafana-corresponding-source") return "source"
  if (evidenceId === "litellm-oss-transitive-sources") return "source"
  if (evidenceId.includes("license") || evidenceId === "third-party-notices") {
    return "license"
  }
  return "evidence"
}

function writeArtifact(rootDirectory, relativePath, contents) {
  const path = join(rootDirectory, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function canonicalEvidenceJson(value) {
  return `${canonicalEvidence(value)}\n`
}

function prepareSemanticEvidence(directory, lock, evidenceEvaluatedAt) {
  const evidenceRoot = join(directory, "semantic-inputs")
  const vulnerabilityRoot = join(directory, "vulnerability-inputs")
  const correspondingSourceRoot = join(directory, "source-inputs")
  const outputRoot = join(directory, "semantic-outputs")
  const firecrawlPacket = "exact Firecrawl corresponding source fixture\n"
  const grafanaPacket = "exact Grafana corresponding source fixture\n"
  const litellmPacket = "exact LiteLLM transitive source fixture\n"
  writeArtifact(
    correspondingSourceRoot,
    "firecrawl-corresponding-source.tar.zst",
    firecrawlPacket,
  )
  writeArtifact(
    correspondingSourceRoot,
    "grafana-corresponding-source.tar.zst",
    grafanaPacket,
  )
  writeArtifact(
    correspondingSourceRoot,
    "litellm-oss-transitive-sources.tar.zst",
    litellmPacket,
  )
  const inventory = readCoreImageInventory()
  const inventoryById = new Map(
    inventory.components.map((component) => [component.id, component]),
  )
  const evaluatedTime = Date.parse(evidenceEvaluatedAt)
  const isoBefore = (milliseconds) =>
    new Date(evaluatedTime - milliseconds).toISOString()
  for (const image of lock.images) {
    const component = inventoryById.get(image.id)
    const recipe =
      component.kind === "product-build-output"
        ? component.dockerfile
        : ["firecrawl-build-output", "litellm-oss-build-output"].includes(
              component.kind,
            )
          ? component.sourcePackage
          : "infra/release/core-image-inventory.json"
    const recipeSha256 = sha256Bytes(readFileSync(join(rootPath, recipe)))
    const imageReference = `image:${image.id}`
    const packageReference = `pkg:generic/${image.id}-fixture@1.0.0`
    const sbom = {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      version: 1,
      metadata: {
        tools: {
          components: [
            {
              type: "application",
              name: "syft",
              version: "1.0.0",
            },
          ],
        },
        component: {
          type: "container",
          "bom-ref": imageReference,
          name: image.id,
          version: image.version,
          hashes: [
            {
              alg: "SHA-256",
              content: image.platformDigest.slice("sha256:".length),
            },
          ],
          properties: [
            {
              name: "llm-machines:image-platform-digest",
              value: image.platformDigest,
            },
          ],
        },
      },
      components: [
        {
          type: "library",
          "bom-ref": packageReference,
          name: `${image.id}-fixture`,
          version: "1.0.0",
          purl: packageReference,
          hashes: [{ alg: "SHA-256", content: "9".repeat(64) }],
        },
      ],
      dependencies: [
        { ref: imageReference, dependsOn: [packageReference] },
        { ref: packageReference, dependsOn: [] },
      ],
    }
    const provenance = {
      _type: "https://in-toto.io/Statement/v1",
      predicateType: "https://slsa.dev/provenance/v1",
      subject: [
        {
          name: image.mirrorRepository,
          digest: { sha256: image.platformDigest.slice("sha256:".length) },
        },
      ],
      predicate: {
        buildDefinition: {
          buildType: {
            "third-party-mirror":
              "https://llm-machines.invalid/build-types/oci-mirror/v1",
            "product-build-output":
              "https://llm-machines.invalid/build-types/product-container/v1",
            "litellm-oss-build-output":
              "https://llm-machines.invalid/build-types/litellm-oss-container/v1",
            "firecrawl-build-output":
              "https://llm-machines.invalid/build-types/firecrawl-reduced-container/v1",
          }[component.kind],
          externalParameters: {
            componentId: image.id,
            mirrorRepository: image.mirrorRepository,
            imageVersion: image.version,
            sourceRevision: image.sourceRevision,
            ...(component.kind === "third-party-mirror"
              ? {
                  approvedSourceImage: {
                    indexDigest: component.indexDigest,
                    platform: component.platform,
                    platformDigest: component.platformDigest,
                  },
                }
              : {}),
            recipe: { path: recipe, sha256: recipeSha256 },
          },
          internalParameters: {},
          resolvedDependencies: [
            {
              uri: `urn:llm-machines:source:${image.id}`,
              digest: { gitCommit: image.sourceRevision },
            },
            {
              uri: `file:${recipe}`,
              digest: { sha256: recipeSha256.slice("sha256:".length) },
            },
          ],
        },
        runDetails: {
          [slsaActorKey]: {
            id: "https://llm-machines.invalid/build-actors/offline-release/v1",
          },
          metadata: {
            invocationId: `fixture-${image.id}`,
            startedOn: isoBefore(7_200_000),
            finishedOn: isoBefore(7_199_000),
          },
          byproducts: [],
        },
      },
    }
    const licenseText = `Reviewed license text for ${image.id} under ${image.license}.\n`
    const noticeText = `Reviewed distribution notice for ${image.id}.\n`
    const report = {
      schema: "llm-machines.vulnerability-report.v1",
      image: {
        id: image.id,
        mirrorRepository: image.mirrorRepository,
        digest: image.platformDigest,
      },
      scanner: { name: "trivy", version: "0.65.0" },
      database: { updatedAt: isoBefore(10_800_000) },
      scannedAt: isoBefore(7_200_000),
      findings: [],
    }
    const reportBytes = canonicalEvidenceJson(report)
    const disposition = {
      schema: "llm-machines.vulnerability-disposition.v1",
      status: "REVIEWED",
      containsCredentials: false,
      runtimeQualified: false,
      image: report.image,
      reportSha256: sha256Bytes(reportBytes),
      scanner: report.scanner,
      database: report.database,
      policy: {
        maximumDatabaseAgeHours: 72,
        maximumEvidenceAgeHours: 24,
        severityThresholds: { critical: 0, high: 0 },
        maximumExceptionAgeDays: 30,
      },
      counts: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
      exceptions: [],
      reviewedAt: isoBefore(3_600_000),
      decision: "ACCEPTED",
    }
    const review = {
      schema: "llm-machines.license-review.v1",
      status: "REVIEWED",
      component: {
        id: image.id,
        mirrorRepository: image.mirrorRepository,
        sourceRevision: image.sourceRevision,
        license: image.license,
      },
      licenseTextSha256: sha256Bytes(licenseText),
      noticeSha256: sha256Bytes(noticeText),
      reviewedAt: isoBefore(1_800_000),
      reviewer: { type: "release-compliance", id: "fixture-reviewer" },
    }
    const sbomBytes = canonicalEvidenceJson(sbom)
    const provenanceBytes = canonicalEvidenceJson(provenance)
    const dispositionBytes = canonicalEvidenceJson(disposition)
    const reviewBytes = canonicalEvidenceJson(review)
    writeArtifact(evidenceRoot, `sbom/${image.id}.cdx.json`, sbomBytes)
    writeArtifact(
      evidenceRoot,
      `provenance/${image.id}.intoto.json`,
      provenanceBytes,
    )
    writeArtifact(evidenceRoot, `licenses/${image.id}.txt`, licenseText)
    writeArtifact(evidenceRoot, `notices/${image.id}.txt`, noticeText)
    writeArtifact(evidenceRoot, `licenses/${image.id}.review.json`, reviewBytes)
    writeArtifact(vulnerabilityRoot, `${image.id}.report.json`, reportBytes)
    writeArtifact(
      vulnerabilityRoot,
      `${image.id}.disposition.json`,
      dispositionBytes,
    )
    image.sbomSha256 = sha256Bytes(sbomBytes)
    image.provenanceSha256 = sha256Bytes(provenanceBytes)
    image.vulnerabilityReportSha256 = sha256Bytes(reportBytes)
    image.vulnerabilityDispositionSha256 = sha256Bytes(dispositionBytes)
    image.licenseTextSha256 = sha256Bytes(licenseText)
    image.noticeSha256 = sha256Bytes(noticeText)
    image.licenseReviewSha256 = sha256Bytes(reviewBytes)
    if (image.correspondingSourceSha256) {
      image.correspondingSourceSha256 = sha256Bytes(
        image.id === "grafana-private"
          ? grafanaPacket
          : image.id === "litellm"
            ? litellmPacket
            : firecrawlPacket,
      )
    }
  }
  const coreLockPath = join(directory, "core-image-lock.json")
  writeArtifact(directory, "core-image-lock.json", `${canonicalJson(lock)}\n`)
  generateReleaseEvidence(
    {
      coreLockPath,
      evidenceRoot,
      correspondingSourceRoot,
      vulnerabilityRoot,
      outputRoot,
      evidenceEvaluatedAt,
    },
    { root: rootPath },
  )
  return { coreLockPath, outputRoot }
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "llmm-release-integrity-"))
  const artifactRoot = join(directory, "artifacts")
  mkdirSync(artifactRoot)
  const version = "1.0.0-rc.1"
  const artifactName = `llm-machines-core-${version}-linux-amd64.tar.zst`
  const sourceDateEpoch = Number.parseInt(
    git("show", "-s", "--format=%ct", "HEAD"),
    10,
  )
  const evidenceEvaluatedAt = new Date(
    (sourceDateEpoch + 14_400) * 1000,
  ).toISOString()
  const semanticPaths = new Map(semanticEvidence)
  semanticPaths.set(
    "release-evidence-index",
    "evidence/release-evidence-index.json",
  )
  const artifacts = [
    {
      id: "core-package",
      evidenceId: null,
      path: `core/${artifactName}`,
      mediaType: "application/zstd",
      classification: "core",
    },
    ...plan.requiredEvidence.map((evidenceId) => ({
      id: `evidence-${evidenceId}`,
      evidenceId,
      path:
        evidenceId === "core-image-lock"
          ? "locks/core-image-lock.json"
          : (semanticPaths.get(evidenceId) ?? `evidence/${evidenceId}.json`),
      mediaType: "application/json",
      classification: classificationFor(evidenceId),
    })),
  ]
  const lock = syntheticCoreLock(version)
  const prepared = prepareSemanticEvidence(directory, lock, evidenceEvaluatedAt)
  for (const artifact of artifacts) {
    let contents = `${artifact.id}\n`
    if (artifact.evidenceId === "core-image-lock") {
      contents = readFileSync(prepared.coreLockPath)
    } else if (semanticPaths.has(artifact.evidenceId)) {
      contents = readFileSync(
        join(prepared.outputRoot, semanticPaths.get(artifact.evidenceId)),
      )
    } else if (artifact.evidenceId === "rollback") {
      contents = canonicalJson(generateInitialInstallDescriptor())
    }
    writeArtifact(artifactRoot, artifact.path, contents)
  }
  return {
    artifactRoot,
    directory,
    input: {
      release: {
        version,
        artifactName,
        sourceCommit: git("rev-parse", "HEAD^{commit}"),
        sourceTree: git("rev-parse", "HEAD^{tree}"),
        sourceDateEpoch,
        evidenceEvaluatedAt,
      },
      artifacts,
    },
  }
}

test("checked-in deterministic release plan passes", () => {
  assert.deepEqual(verifyCheckedInReleasePlan(), [])
})

test("Core and inference boundaries fail closed", () => {
  const changedCore = structuredClone(plan)
  changedCore.core.memoryGiB = 64
  assert.match(validateReleasePlan(changedCore).join("\n"), /fixed Core/)

  const changedInference = structuredClone(plan)
  changedInference.inference.engine = "vllm"
  assert.match(
    validateReleasePlan(changedInference).join("\n"),
    /variable inference/,
  )
})

test("qualification and signing cannot be overstated", () => {
  const qualified = structuredClone(plan)
  qualified.runtimeQualified = true
  qualified.qualification.q0 = "PASSED"
  qualified.signing.privateMaterialInPackage = true
  const errors = validateReleasePlan(qualified).join("\n")
  assert.match(errors, /source-only/)
  assert.match(errors, /signing custody/)
  assert.match(errors, /overstates qualification/)
})

test("release evidence policy and required evidence cannot drift", () => {
  const changedPolicy = structuredClone(plan)
  changedPolicy.evidencePolicy = "infra/release/unreviewed-policy.json"
  assert.match(
    validateReleasePlan(changedPolicy).join("\n"),
    /release evidence policy differs/,
  )

  const duplicateEvidence = structuredClone(plan)
  duplicateEvidence.requiredEvidence.push(
    duplicateEvidence.requiredEvidence.at(-1),
  )
  assert.match(
    validateReleasePlan(duplicateEvidence).join("\n"),
    /evidence set or order differs/,
  )
})

test("manifest derives actual files and checked-out Git identity deterministically", () => {
  const value = fixture()
  const first = canonicalJson(
    generateReleaseManifest(value.input, { artifactRoot: value.artifactRoot }),
  )
  const second = canonicalJson(
    generateReleaseManifest(value.input, { artifactRoot: value.artifactRoot }),
  )
  assert.equal(first, second)
  const manifest = JSON.parse(first)
  assert.equal(manifest.release.sourceCommit, git("rev-parse", "HEAD^{commit}"))
  assert.equal(manifest.release.sourceTree, git("rev-parse", "HEAD^{tree}"))
  assert.match(
    manifest.contracts.releaseEvidencePolicySha256,
    /^sha256:[a-f0-9]{64}$/,
  )
  assert.equal(manifest.artifacts.length, plan.requiredEvidence.length + 1)
  assert.deepEqual(
    new Set(
      manifest.artifacts
        .map(({ evidenceId }) => evidenceId)
        .filter((value) => value !== null),
    ),
    new Set(plan.requiredEvidence),
  )
  for (const artifact of manifest.artifacts) {
    const bytes = readFileSync(join(value.artifactRoot, artifact.path))
    assert.equal(artifact.size, bytes.length)
    assert.match(artifact.sha256, /^sha256:[a-f0-9]{64}$/)
  }
  assert.deepEqual(manifest.qualification, {
    runtimeQualified: false,
    q0: "NOT_STARTED",
    contractActivation: "INACTIVE",
  })
})

test("manifest rejects caller-provided hashes, unsafe paths, and duplicates", () => {
  const callerHash = fixture()
  callerHash.input.artifacts[0].sha256 = digest("f")
  assert.throws(
    () =>
      generateReleaseManifest(callerHash.input, {
        artifactRoot: callerHash.artifactRoot,
      }),
    /artifact declaration keys must be exactly/,
  )

  const traversal = fixture()
  traversal.input.artifacts[0].path = "../secret"
  assert.throws(
    () =>
      generateReleaseManifest(traversal.input, {
        artifactRoot: traversal.artifactRoot,
      }),
    /unsafe artifact/,
  )

  const duplicate = fixture()
  duplicate.input.artifacts[1].path = duplicate.input.artifacts[0].path
  assert.throws(
    () =>
      generateReleaseManifest(duplicate.input, {
        artifactRoot: duplicate.artifactRoot,
      }),
    /duplicate artifact path/,
  )
})

test("manifest requires every planned evidence item and only declared files", () => {
  const missing = fixture()
  missing.input.artifacts.pop()
  assert.throws(
    () =>
      generateReleaseManifest(missing.input, {
        artifactRoot: missing.artifactRoot,
      }),
    /missing required evidence declaration/,
  )

  const extraDeclaration = fixture()
  extraDeclaration.input.artifacts[1].evidenceId = "unreviewed-evidence"
  assert.throws(
    () =>
      generateReleaseManifest(extraDeclaration.input, {
        artifactRoot: extraDeclaration.artifactRoot,
      }),
    /extra evidence declaration/,
  )

  const duplicateEvidence = fixture()
  duplicateEvidence.input.artifacts[2].evidenceId =
    duplicateEvidence.input.artifacts[1].evidenceId
  assert.throws(
    () =>
      generateReleaseManifest(duplicateEvidence.input, {
        artifactRoot: duplicateEvidence.artifactRoot,
      }),
    /duplicate evidence declaration/,
  )

  const missingFile = fixture()
  const removed = missingFile.input.artifacts.at(-1)
  unlinkSync(join(missingFile.artifactRoot, removed.path))
  assert.throws(
    () =>
      generateReleaseManifest(missingFile.input, {
        artifactRoot: missingFile.artifactRoot,
      }),
    /missing artifact file/,
  )

  const untracked = fixture()
  writeArtifact(untracked.artifactRoot, "evidence/untracked.json", "extra\n")
  assert.throws(
    () =>
      generateReleaseManifest(untracked.input, {
        artifactRoot: untracked.artifactRoot,
      }),
    /untracked artifact file/,
  )

  const unsafe = fixture()
  symlinkSync(
    join(unsafe.artifactRoot, unsafe.input.artifacts[0].path),
    join(unsafe.artifactRoot, "unsafe-link"),
  )
  assert.throws(
    () =>
      generateReleaseManifest(unsafe.input, {
        artifactRoot: unsafe.artifactRoot,
      }),
    /unsafe symbolic-link artifact/,
  )
})

test("manifest rejects mutable names and mismatched checked-out source identity", () => {
  const latest = fixture()
  latest.input.release.version = "latest"
  assert.throws(
    () =>
      generateReleaseManifest(latest.input, {
        artifactRoot: latest.artifactRoot,
      }),
    /semantic release/,
  )

  const source = fixture()
  source.input.release.sourceCommit = "f".repeat(40)
  assert.throws(
    () =>
      generateReleaseManifest(source.input, {
        artifactRoot: source.artifactRoot,
      }),
    /sourceCommit does not match/,
  )

  const mutableArtifact = fixture()
  mutableArtifact.input.artifacts[1].path = "evidence/latest.json"
  assert.throws(
    () =>
      generateReleaseManifest(mutableArtifact.input, {
        artifactRoot: mutableArtifact.artifactRoot,
      }),
    /mutable artifact path/,
  )
})

test("manifest validates the actual Core image lock", () => {
  const value = fixture()
  const declaration = value.input.artifacts.find(
    ({ evidenceId }) => evidenceId === "core-image-lock",
  )
  const path = join(value.artifactRoot, declaration.path)
  const lock = JSON.parse(readFileSync(path, "utf8"))
  lock.release.sourceCommit = "f".repeat(40)
  writeFileSync(path, canonicalJson(lock))
  assert.throws(
    () =>
      generateReleaseManifest(value.input, {
        artifactRoot: value.artifactRoot,
      }),
    /Core image lock is invalid|does not bind/,
  )
})

test("manifest semantically validates canonical rollback evidence", () => {
  const invalid = fixture()
  const declaration = invalid.input.artifacts.find(
    ({ evidenceId }) => evidenceId === "rollback",
  )
  writeFileSync(
    join(invalid.artifactRoot, declaration.path),
    canonicalJson({
      schema: "unreviewed.rollback",
      predecessor: { version: "fabricated" },
      action: "ACTIVATE",
    }),
  )
  assert.throws(
    () =>
      generateReleaseManifest(invalid.input, {
        artifactRoot: invalid.artifactRoot,
      }),
    /rollback descriptor/,
  )

  const noncanonical = fixture()
  const canonicalDeclaration = noncanonical.input.artifacts.find(
    ({ evidenceId }) => evidenceId === "rollback",
  )
  writeFileSync(
    join(noncanonical.artifactRoot, canonicalDeclaration.path),
    JSON.stringify(generateInitialInstallDescriptor()),
  )
  assert.throws(
    () =>
      generateReleaseManifest(noncanonical.input, {
        artifactRoot: noncanonical.artifactRoot,
      }),
    /rollback descriptor is not canonical JSON/,
  )
})

test("manifest rejects extra fields anywhere in the actual Core image lock", () => {
  for (const mutate of [
    (lock) => {
      lock.unreviewed = "secret-bearing"
    },
    (lock) => {
      lock.release.unreviewed = "secret-bearing"
    },
    (lock) => {
      lock.images[0].unreviewed = "secret-bearing"
    },
  ]) {
    const value = fixture()
    const declaration = value.input.artifacts.find(
      ({ evidenceId }) => evidenceId === "core-image-lock",
    )
    const path = join(value.artifactRoot, declaration.path)
    const lock = JSON.parse(readFileSync(path, "utf8"))
    mutate(lock)
    writeFileSync(path, canonicalJson(lock))
    assert.throws(
      () =>
        generateReleaseManifest(value.input, {
          artifactRoot: value.artifactRoot,
        }),
      /Core image lock.*keys must be exactly/,
    )
  }
})

test("CLI refuses to overwrite an existing manifest", () => {
  const value = fixture()
  const inputPath = join(value.directory, "input.json")
  const outputPath = join(value.directory, "manifest.json")
  writeFileSync(inputPath, canonicalJson(value.input))
  writeFileSync(outputPath, "occupied\n")
  const result = spawnSync(
    process.execPath,
    [
      new URL("./generate-release-manifest.mjs", import.meta.url).pathname,
      "--input",
      inputPath,
      "--artifact-root",
      value.artifactRoot,
      "--output",
      outputPath,
    ],
    { cwd: rootPath, encoding: "utf8" },
  )
  assert.notEqual(result.status, 0)
  assert.equal(readFileSync(outputPath, "utf8"), "occupied\n")
})

test("CLI refuses to write the manifest inside the artifact root", () => {
  const value = fixture()
  const inputPath = join(value.directory, "input.json")
  const outputPath = join(value.artifactRoot, "manifest.json")
  writeFileSync(inputPath, canonicalJson(value.input))
  const result = spawnSync(
    process.execPath,
    [
      new URL("./generate-release-manifest.mjs", import.meta.url).pathname,
      "--input",
      inputPath,
      "--artifact-root",
      value.artifactRoot,
      "--output",
      outputPath,
    ],
    { cwd: rootPath, encoding: "utf8" },
  )
  assert.notEqual(result.status, 0)
  assert.equal(existsSync(outputPath), false)
  assert.match(result.stderr, /outside the artifact root/)
})
