import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const integrationBase = "ffc49eb6e97169ced202efbaa6363c85bfdd40dc"
const integrationBaseTree = "e1a2c49683f215ca03561e90d0fd73b2c54da17f"
const sourceHead = "46295906c3d733b0e56abe94d9732d8eb0549c29"
const sourceHeadTree = "dbbf55c1ed957aa905356b2faf11467c02781fb4"
const decisionPath =
  "docs/reduction/inference-core/pr-11a-r1-d1-storage-recovery-decisions.json"

function git(...args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim()
}

function readDecision() {
  return JSON.parse(readFileSync(resolve(repositoryRoot, decisionPath), "utf8"))
}

function changedPaths(from, to) {
  const output = git(
    "diff",
    "--name-only",
    "--no-ext-diff",
    "--no-renames",
    `${from}..${to}`,
    "--",
  )
  return output ? output.split("\n").sort() : []
}

test("R1-D1 is admitted from the protected R1-K1 integration merge", () => {
  assert.equal(
    git("rev-parse", `${integrationBase}^{tree}`),
    integrationBaseTree,
  )
  assert.doesNotThrow(() =>
    git("merge-base", "--is-ancestor", integrationBase, "HEAD"),
  )
  assert.equal(git("rev-parse", `${sourceHead}^{tree}`), sourceHeadTree)
  assert.doesNotThrow(() =>
    git("merge-base", "--is-ancestor", sourceHead, "HEAD"),
  )
})

test("R1-D1 starts source-incomplete and cannot overstate acceptance", () => {
  const decision = readDecision()
  assert.equal(decision.schemaVersion, 1)
  assert.equal(decision.workPackage, "PR-11A-R1-D1")
  assert.equal(
    decision.scope,
    "storage-backup-retention-and-recovery-source-only",
  )
  assert.equal(decision.integrationBaseCommit, integrationBase)
  assert.equal(decision.integrationBaseTree, integrationBaseTree)
  assert.equal(decision.exactBranch, "codex/inference-core-pr-11a-r1-d1")
  assert.equal(decision.reviewStatus, "source-candidate-independently-reviewed")
  assert.equal(
    decision.localValidation,
    "passed-local-and-fresh-clone-full-source-gates",
  )
  assert.equal(decision.sourceHeadCommit, sourceHead)
  assert.equal(decision.sourceHeadTree, sourceHeadTree)
  assert.deepEqual(decision.independentReview, {
    cleanup: "verified",
    freshClone: "passed-clean-detached-checkout",
    result: "passed-no-findings",
    reviewedCommit: sourceHead,
    reviewedTree: sourceHeadTree,
    runtimeActivated: false,
  })
  assert.equal(decision.accepted, false)
  assert.equal(decision.revisionBound, false)
  assert.equal(decision.runtimeQualified, false)
  assert.equal(
    git(
      "ls-tree",
      "--name-only",
      sourceHead,
      "--",
      "docs/reduction/inference-core/contract-revisions/PR-11A.json",
    ),
    "",
  )
})

test("R1-D1 binds the approved storage and backup boundary", () => {
  const decisions = readDecision().bindingDecisions
  assert.equal(decisions.localStorage.backend, "zfs")
  assert.deepEqual(decisions.localStorage.separateDatasetRoles, [
    "product_state",
    "databases",
    "models",
    "logs",
    "staging",
  ])
  assert.equal(decisions.localStorage.localSnapshotsCountAsBackups, false)
  assert.equal(decisions.backup.engine, "restic")
  assert.equal(decisions.backup.retentionDays, 30)
  assert.equal(decisions.backup.inlineOrEnvironmentSecretsAllowed, false)
  assert.equal(decisions.objectStorage.genericS3ServiceInBom, false)
  assert.equal(decisions.objectStorage.unusedAdapterAllowed, false)
})

test("R1-D1 source inventory is exact and remains source-only", () => {
  const decision = readDecision()
  assert.deepEqual(
    changedPaths(integrationBase, sourceHead),
    [...decision.sourcePathInventory].sort(),
  )
  assert.deepEqual(decision.sourcePathCounts, {
    added: 9,
    deleted: 0,
    modified: 9,
    total: 18,
  })
  assert.equal(decision.forbiddenOutputs.realSecretBinding, true)
  assert.equal(decision.forbiddenOutputs.runtimeDeployment, true)
  assert.equal(decision.forbiddenOutputs.storageOrBackupCommandExecution, true)
})

test("current registers report merged R1-K1 and unaccepted R1-D1", () => {
  const decisionRegister = readFileSync(
    resolve(
      repositoryRoot,
      "docs/reduction/inference-core/decision-register.md",
    ),
    "utf8",
  )
  const validationRegister = readFileSync(
    resolve(
      repositoryRoot,
      "docs/reduction/inference-core/validation-register.md",
    ),
    "utf8",
  )
  assert.match(
    decisionRegister,
    /R1-K1[^\n]+PR 16[^\n]+ffc49eb6e97169ced202efbaa6363c85bfdd40dc[^\n]+unaccepted[^\n]+not revision-bound/i,
  )
  assert.match(
    decisionRegister,
    /R1-D1[^\n]+independently reviewed source candidate[^\n]+46295906c3d733b0e56abe94d9732d8eb0549c29[^\n]+unaccepted[^\n]+not revision-bound[^\n]+not runtime-qualified/i,
  )
  assert.match(
    validationRegister,
    /R1-D1[^\n]+fresh-clone full source validation[^\n]+independent review passed[^\n]+46295906c3d733b0e56abe94d9732d8eb0549c29[^\n]+R1-V1[^\n]+Q0[^\n]+pending[^\n]+unaccepted[^\n]+not revision-bound/i,
  )
})
