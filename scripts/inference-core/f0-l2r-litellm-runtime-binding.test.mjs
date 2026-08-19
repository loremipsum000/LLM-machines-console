import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"
import {
  loadLiteLlmOssRuntimeContract,
  validateLiteLlmOssRuntimeContract,
  validateLiteLlmOssRuntimeInspection,
} from "../pre-genesis/litellm-oss-runtime-contract.mjs"

const root = resolve(import.meta.dirname, "../..")
const expectedImage =
  "sha256:d1396589f1fed1fa3e67142c5f93189e257db14ce92ce9d952fbf18a58350f6b"
const evidencePath =
  "docs/reduction/inference-core/f0-l2r-litellm-runtime-binding.json"

test("F0-L2R binds integrated startup to the admitted OSS image", async () => {
  const runtime = loadLiteLlmOssRuntimeContract(root)
  const source = await readText(
    "scripts/pre-genesis/reduced-core-litellm-integration.mjs",
  )

  assert.equal(runtime.image, expectedImage)
  assert.equal(runtime.version, "v1.96.2-llmm.1")
  assert.equal(runtime.platform, "linux/amd64")
  assert.equal(
    runtime.sourceRevision,
    "83d6d84bfb7abbbff70d456bc89028d426db8c33",
  )
  assert.match(source, /loadLiteLlmOssRuntimeContract/)
  assert.match(
    source,
    /inspectLiteLlmOssRuntimeImage\(dockerResult, LITELLM_IMAGE\)/,
  )
  assert.match(source, /imageContract:/)
  assert.match(source, /await waitForRetention\(serviceControl \? 2 : 3\)/)
  assert.match(source, /performance\.now\(\) \+ 120_000/)
  assert.match(source, /accounting metadata did not settle/)
  assert.match(source, /assertNoSensitiveValues\(\s*\[dump, logs\]/)
  assert.doesNotMatch(source, /ghcr\.io\/berriai\/litellm/)
  assert.doesNotMatch(source, /v1\.85\.0/)

  const browser = await readText(
    "scripts/pre-genesis/reduced-core-browser-session.mjs",
  )
  const integrated = await readText(
    "scripts/pre-genesis/reduced-core-integrated.mjs",
  )
  assert.match(browser, /liteLlmControl\.imageContract\.version/)
  assert.doesNotMatch(browser, /Exact LiteLLM v1\.85\.0/)
  assert.match(integrated, /service\.name === "litellm" && service\.ready/)
  assert.match(integrated, /150_000/)
})

test("F0-L2R rejects drift between inventory and source package", async () => {
  const [inventory, sourcePackage] = await Promise.all([
    readJson("infra/release/core-image-inventory.json"),
    readJson("infra/litellm/oss-downstream/source-package.json"),
  ])

  for (const mutate of [
    (candidate) => {
      candidate.components.find(({ id }) => id === "litellm").version =
        "v1.85.0"
    },
    (candidate) => {
      candidate.components.find(({ id }) => id === "litellm").sourceRevision =
        "0".repeat(40)
    },
    (candidate) => {
      candidate.components.find(({ id }) => id === "litellm").sourcePackage =
        "unreviewed.json"
    },
  ]) {
    const candidate = structuredClone(inventory)
    mutate(candidate)
    assert.throws(() =>
      validateLiteLlmOssRuntimeContract({
        inventory: candidate,
        sourcePackage,
      }),
    )
  }
})

test("F0-L2R rejects mutable or unmeasured downstream artifacts", async () => {
  const [inventory, sourcePackage] = await Promise.all([
    readJson("infra/release/core-image-inventory.json"),
    readJson("infra/litellm/oss-downstream/source-package.json"),
  ])

  for (const mutate of [
    (candidate) => {
      candidate.downstream.artifactEvidence.configDigest = "latest"
    },
    (candidate) => {
      candidate.downstream.artifactEvidence.byteIdentical = false
    },
    (candidate) => {
      candidate.downstream.artifactEvidence.independentBuilds = 1
    },
    (candidate) => {
      candidate.downstream.platform = "linux/arm64"
    },
  ]) {
    const candidate = structuredClone(sourcePackage)
    mutate(candidate)
    assert.throws(() =>
      validateLiteLlmOssRuntimeContract({
        inventory,
        sourcePackage: candidate,
      }),
    )
  }
})

test("F0-L2R verifies the loaded OCI identity before execution", () => {
  const runtime = loadLiteLlmOssRuntimeContract(root)
  const valid = {
    Architecture: "amd64",
    Config: {
      Labels: {
        "org.opencontainers.image.licenses": "MIT",
        "org.opencontainers.image.revision": runtime.sourceRevision,
        "org.opencontainers.image.title": "LiteLLM OSS Downstream",
        "org.opencontainers.image.version": runtime.version,
      },
    },
    Id: runtime.image,
    Os: "linux",
  }
  validateLiteLlmOssRuntimeInspection(valid, runtime)

  for (const mutate of [
    (candidate) => {
      candidate.Id = `sha256:${"0".repeat(64)}`
    },
    (candidate) => {
      candidate.Architecture = "arm64"
    },
    (candidate) => {
      candidate.Config.Labels["org.opencontainers.image.version"] = "v1.85.0"
    },
    (candidate) => {
      candidate.Config.Labels["org.opencontainers.image.revision"] = "0".repeat(
        40,
      )
    },
  ]) {
    const candidate = structuredClone(valid)
    mutate(candidate)
    assert.throws(() => validateLiteLlmOssRuntimeInspection(candidate, runtime))
  }
})

test("F0-L2R binds the exact protected input and source candidate", async () => {
  const evidence = await readJson(evidencePath)

  assert.equal(evidence.workPackage, "F0-L2R")
  assert.equal(evidence.status, "LOCAL_INTEGRATED_LITELLM_OSS_RUNTIME_BOUND")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE_PENDING_F0_N7")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.genesisPublished, false)
  assert.equal(
    git("rev-parse", `${evidence.protectedInput.commit}^{tree}`),
    evidence.protectedInput.tree,
  )
  assert.equal(
    git("rev-parse", `${evidence.sourceCandidate.commit}^{tree}`),
    evidence.sourceCandidate.tree,
  )
  assert.equal(
    git("rev-parse", `${evidence.sourceCandidate.commit}^1`),
    "1f5c9669d7fb3e2250838bf0c9a5d59990179297",
  )
})

test("F0-L2R binds passing integrated runtime and cleanup evidence", async () => {
  const evidence = await readJson(evidencePath)
  const runtime = evidence.runtimeEvidence

  assert.equal(runtime.environment, "VM117_ISOLATED_LINUX_AMD64")
  assert.equal(runtime.applicationCreation, "PASSED")
  assert.equal(runtime.modelDiscovery, "PASSED")
  assert.equal(runtime.nonStreamingChatCompletions, "PASSED")
  assert.equal(runtime.streamingChatCompletions, "PASSED")
  assert.equal(runtime.usageAndLastUse, "PASSED")
  assert.equal(runtime.keycloakLoginAndOutageRecovery, "PASSED")
  assert.equal(runtime.firecrawlSearchAndStaticScrape, "PASSED")
  assert.equal(runtime.observabilityStartup, "PASSED")
  assert.equal(runtime.restartPersistence, "PASSED")
  assert.equal(runtime.noBypass, "PASSED")
  assert.equal(runtime.workloadContentCanaries, 0)
  assert.equal(runtime.credentialMaterialPersisted, false)
  assert.equal(runtime.runOwnedResourcesRemoved, true)
  assert.equal(runtime.persistentFounderEnvironmentPreserved, true)
  assert.equal(runtime.genericSecretMatches, 0)
  assert.match(runtime.credentialFreeLogSha256, /^[0-9a-f]{64}$/)
})

test("F0-L2R source fingerprints and path inventory are exact", async () => {
  const evidence = await readJson(evidencePath)
  const changedPaths = git(
    "diff",
    "--name-only",
    `${evidence.protectedInput.commit}..${evidence.sourceCandidate.commit}`,
  )
    .split("\n")
    .filter(Boolean)
    .sort()

  assert.deepEqual(
    changedPaths,
    [...evidence.sourceChangeBoundary.changedPaths].sort(),
  )
  for (const [path, expected] of Object.entries(evidence.sourceArtifacts)) {
    assert.equal(
      `sha256:${sha256(gitBlob(`${evidence.sourceCandidate.commit}:${path}`))}`,
      expected,
      path,
    )
  }
  assert.equal(
    evidence.sourceChangeBoundary.productRuntimeBehaviorChanged,
    false,
  )
  assert.equal(evidence.sourceChangeBoundary.productBoundaryChanged, false)
  assert.equal(evidence.sourceChangeBoundary.nativeIngressActivated, false)
  assert.equal(evidence.sourceChangeBoundary.vm103Touched, false)
})

test("F0-L2R preserves earlier local candidates as unpushed evidence", async () => {
  const evidence = await readJson(evidencePath)

  assert.deepEqual(
    evidence.preservedLocalEvidence.map(({ commit }) => commit),
    [
      "9d5a2f54e9bf3b4107cf970724780ebf18f14960",
      "94324e3975cb8b0fe848837170aff7a6f8b67d91",
      "2ba1a8661f762a6f292c4874f64b776dd9b1344c",
    ],
  )
  for (const candidate of evidence.preservedLocalEvidence) {
    assert.equal(candidate.published, false)
    assert.equal(candidate.disposition, "UNPUSHED_HISTORICAL_EVIDENCE")
    assert.match(git("cat-file", "-t", candidate.commit), /^commit$/)
  }
})

test("F0-L2R evidence contains no credential or token material", async () => {
  const evidence = await readText(evidencePath)
  assert.doesNotMatch(
    evidence,
    /(?:PRIVATE KEY|BEGIN OPENSSH|Bearer\s+|eyJ[A-Za-z0-9_-]{20}|llmm_(?:t4|fc)_[A-Za-z0-9_-]{20})/i,
  )
})

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

function gitBlob(revision) {
  return execFileSync("git", ["show", revision], {
    cwd: root,
    encoding: "utf8",
  })
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

async function readText(path) {
  return readFile(resolve(root, path), "utf8")
}

async function readJson(path) {
  return JSON.parse(await readText(path))
}
