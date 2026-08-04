import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
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
  canonicalJson,
  generateReleaseManifest,
} from "./generate-release-manifest.mjs"
import {
  coreInventorySha256,
  readCoreImageInventory,
} from "./validate-image-lock.mjs"
import {
  validateReleasePlan,
  verifyCheckedInReleasePlan,
} from "./validate-release-plan.mjs"

const root = new URL("../../", import.meta.url)
const rootPath = root.pathname
const plan = JSON.parse(
  readFileSync(new URL("./release-plan.json", import.meta.url), "utf8"),
)

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
    schema: "llm-machines.core-image-lock.v1",
    status: "LOCKED",
    release: { version, sourceCommit, sourceTree },
    inventorySha256: coreInventorySha256(),
    platform: "linux/amd64",
    privateRegistry: "registry.release.invalid",
    images: inventory.components.map((component, index) => {
      const first = ((index + 1) % 16).toString(16)
      const second = ((index + 2) % 16).toString(16)
      return {
        id: component.id,
        repository: `registry.release.invalid/${component.mirrorRepository}`,
        version:
          component.kind === "third-party-mirror"
            ? component.version
            : `${version}-build.${index + 1}`,
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
        ...(/(?:AGPL|GPL)/.test(component.license)
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

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "llmm-release-integrity-"))
  const artifactRoot = join(directory, "artifacts")
  mkdirSync(artifactRoot)
  const version = "1.0.0-rc.1"
  const artifactName = `llm-machines-core-${version}-linux-amd64.tar.zst`
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
          : `evidence/${evidenceId}.json`,
      mediaType: "application/json",
      classification: classificationFor(evidenceId),
    })),
  ]
  for (const artifact of artifacts) {
    const contents =
      artifact.evidenceId === "core-image-lock"
        ? canonicalJson(syntheticCoreLock(version))
        : `${artifact.id}\n`
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
        sourceDateEpoch: Number.parseInt(
          git("show", "-s", "--format=%ct", "HEAD"),
          10,
        ),
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
