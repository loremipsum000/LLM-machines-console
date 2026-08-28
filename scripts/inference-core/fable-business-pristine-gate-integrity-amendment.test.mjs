import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"

const root = resolve(import.meta.dirname, "../..")
const amendment = JSON.parse(
  readFileSync(
    resolve(
      root,
      "docs/reduction/inference-core/fable-business-pristine-gate-integrity-amendment.json",
    ),
    "utf8",
  ),
)

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

function sha256(path) {
  return createHash("sha256")
    .update(readFileSync(resolve(root, path)))
    .digest("hex")
}

test("amendment preserves the admitted closure and binds its masked failure", () => {
  assert.deepEqual(amendment.historicalClosure, {
    candidateCommit: "a632baff14a87231354eb45b221b9cc2fbc6ad93",
    candidateTree: "ae078bef513f94497c73900148987ebff0ff45c2",
    protectedMerge: "496d2c33ff635abf09bfbe8b3abd541f2dc3072f",
    pullRequest: 154,
    preservedFiles: amendment.historicalClosure.preservedFiles,
  })
  assert.equal(
    git("rev-parse", `${amendment.historicalClosure.candidateCommit}^{tree}`),
    amendment.historicalClosure.candidateTree,
  )
  assert.equal(
    git("rev-parse", `${amendment.historicalClosure.protectedMerge}^{tree}`),
    amendment.historicalClosure.candidateTree,
  )
  for (const file of amendment.historicalClosure.preservedFiles) {
    assert.equal(sha256(file.path), file.sha256)
  }
  assert.equal(amendment.observation.pipefailEnabled, false)
  assert.equal(amendment.observation.pipelineExitSource, "tee")
  assert.equal(
    amendment.observation.actualResult,
    "FAILED_WEB_TEST_MASKED_BY_PIPELINE_EXIT_ZERO",
  )
  assert.match(amendment.observation.failureLogSha256, /^[a-f0-9]{64}$/)
})

test("synchronization successor is an exact tree-identical protected merge", () => {
  const successor = amendment.successor
  assert.equal(
    git("rev-parse", `${successor.candidateCommit}^{tree}`),
    successor.candidateTree,
  )
  assert.equal(
    git("rev-parse", `${successor.protectedMerge}^{tree}`),
    successor.candidateTree,
  )
  assert.equal(
    git("rev-parse", `${successor.protectedMerge}^1`),
    amendment.historicalClosure.protectedMerge,
  )
  assert.equal(
    git("rev-parse", `${successor.protectedMerge}^2`),
    successor.candidateCommit,
  )
  assert.equal(successor.pullRequest, 156)
  assert.equal(successor.focusedRepetitions, 50)
  assert.equal(successor.reviewVerdict, "PASS_NO_MATERIAL_FINDINGS")
  assert.equal(
    successor.validationCommandPolicy,
    "FAIL_FAST_WITHOUT_PIPELINE_OR_WITH_PIPEFAIL",
  )
})

test("all corrected validation evidence is digest-bound and status stays inactive", () => {
  for (const group of [
    amendment.validationEvidence.local,
    amendment.validationEvidence.detached,
  ]) {
    assert.ok(group.length >= 7)
    for (const [name, digest] of group) {
      assert.match(name, /^[a-z][a-z-]+$/)
      assert.match(digest, /^[a-f0-9]{64}$/)
    }
  }
  assert.equal(
    amendment.rootCause.classification,
    "TEST_SYNCHRONIZATION_DEFECT",
  )
  assert.equal(amendment.rootCause.productBehaviorChanged, false)
  assert.equal(amendment.rootCause.credentialAssertionsWeakened, false)
  assert.deepEqual(amendment.status, {
    productAccepted: false,
    runtimeQualified: false,
    contractActivation: "INACTIVE",
    genesisPublished: false,
    productMainAdmission: "PENDING_RETENTION_RULESET_AUTHORIZATION",
  })
})
