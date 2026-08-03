import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const integrationBase = "ffc49eb6e97169ced202efbaa6363c85bfdd40dc"
const integrationBaseTree = "e1a2c49683f215ca03561e90d0fd73b2c54da17f"
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

test("R1-D1 is admitted from the protected R1-K1 integration merge", () => {
  assert.equal(git("rev-parse", `${integrationBase}^{tree}`), integrationBaseTree)
  assert.doesNotThrow(() =>
    git("merge-base", "--is-ancestor", integrationBase, "HEAD"),
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
  assert.ok(
    [
      "admitted-source-incomplete",
      "source-candidate-awaiting-independent-review",
      "source-candidate-independently-reviewed",
    ].includes(decision.reviewStatus),
  )
  assert.equal(decision.accepted, false)
  assert.equal(decision.revisionBound, false)
  assert.equal(decision.runtimeQualified, false)
  assert.equal(
    existsSync(
      resolve(
        repositoryRoot,
        "docs/reduction/inference-core/contract-revisions/PR-11A.json",
      ),
    ),
    false,
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
