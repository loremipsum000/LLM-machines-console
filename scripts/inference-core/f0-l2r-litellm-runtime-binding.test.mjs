import assert from "node:assert/strict"
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
  assert.match(source, /docker\(\["image", "inspect", LITELLM_IMAGE\]\)/)
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

async function readText(path) {
  return readFile(resolve(root, path), "utf8")
}

async function readJson(path) {
  return JSON.parse(await readText(path))
}

