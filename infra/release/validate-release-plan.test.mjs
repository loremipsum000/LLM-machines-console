import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  canonicalJson,
  generateReleaseManifest,
} from "./generate-release-manifest.mjs"
import {
  validateReleasePlan,
  verifyCheckedInReleasePlan,
} from "./validate-release-plan.mjs"

const root = new URL("../../", import.meta.url)
const plan = JSON.parse(
  readFileSync(new URL("./release-plan.json", import.meta.url), "utf8"),
)
const digest = `sha256:${"a".repeat(64)}`

function input() {
  return {
    release: {
      version: "1.0.0-rc.1",
      artifactName: "llm-machines-core-1.0.0-rc.1-linux-amd64.tar.zst",
      sourceCommit: "b".repeat(40),
      sourceTree: "c".repeat(40),
      sourceDateEpoch: 1785840000,
    },
    contracts: { coreImageLockSha256: digest },
    artifacts: [
      {
        path: "evidence/product-bom.cdx.json",
        size: 41,
        sha256: digest,
        mediaType: "application/vnd.cyclonedx+json",
        classification: "evidence",
      },
      {
        path: "core/core-images.tar.zst",
        size: 101,
        sha256: `sha256:${"d".repeat(64)}`,
        mediaType: "application/zstd",
        classification: "core",
      },
    ],
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

test("manifest generation is canonical, sorted, and deterministic", () => {
  const first = canonicalJson(generateReleaseManifest(input()))
  const second = canonicalJson(generateReleaseManifest(input()))
  assert.equal(first, second)
  const manifest = JSON.parse(first)
  assert.deepEqual(
    manifest.artifacts.map(({ path }) => path),
    ["core/core-images.tar.zst", "evidence/product-bom.cdx.json"],
  )
  assert.deepEqual(manifest.qualification, {
    runtimeQualified: false,
    q0: "NOT_STARTED",
    contractActivation: "INACTIVE",
  })
})

test("manifest generation rejects unsafe or ambiguous inputs", () => {
  const traversal = input()
  traversal.artifacts[0].path = "../secret"
  assert.throws(() => generateReleaseManifest(traversal), /unsafe artifact/)

  const duplicate = input()
  duplicate.artifacts[1].path = duplicate.artifacts[0].path
  assert.throws(() => generateReleaseManifest(duplicate), /duplicate artifact/)

  const latest = input()
  latest.release.version = "latest"
  assert.throws(() => generateReleaseManifest(latest), /semantic release/)
})

test("CLI refuses to overwrite an existing manifest", async () => {
  const directory = mkdtempSync(join(tmpdir(), "llmm-release-manifest-"))
  const inputPath = join(directory, "input.json")
  const outputPath = join(directory, "manifest.json")
  writeFileSync(inputPath, canonicalJson(input()))
  writeFileSync(outputPath, "occupied\n")
  const { spawnSync } = await import("node:child_process")
  const result = spawnSync(
    process.execPath,
    [
      new URL("./generate-release-manifest.mjs", import.meta.url).pathname,
      "--input",
      inputPath,
      "--output",
      outputPath,
    ],
    { cwd: root.pathname, encoding: "utf8" },
  )
  assert.notEqual(result.status, 0)
  assert.equal(readFileSync(outputPath, "utf8"), "occupied\n")
})
