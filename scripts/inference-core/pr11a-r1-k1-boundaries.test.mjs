import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const integrationBase = "1743cb746f87c7497a34f4de7e3bfc0db3ff0be2"
const integrationBaseTree = "d1e5402ffd12a0b9c9dee15faa78893edfd89223"
const sourceHead = "cd1f7c43bd7c2abe32a2423d1ce77506ecde84cc"
const sourceHeadTree = "59dd7047e45059cc79e587d93fc4f9df969b06dc"
const decisionPath =
  "docs/reduction/inference-core/pr-11a-r1-k1-signing-custody-decisions.json"

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

test("R1-K1 is admitted from the protected R1-E1 integration merge", () => {
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

test("R1-K1 starts source-incomplete and cannot overstate acceptance", () => {
  const decision = readDecision()
  assert.equal(decision.schemaVersion, 1)
  assert.equal(decision.workPackage, "PR-11A-R1-K1")
  assert.equal(decision.scope, "signing-custody-and-public-trust-source-only")
  assert.equal(decision.integrationBaseCommit, integrationBase)
  assert.equal(decision.integrationBaseTree, integrationBaseTree)
  assert.equal(decision.exactBranch, "codex/inference-core-pr-11a-r1-k1")
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
    existsSync(
      resolve(
        repositoryRoot,
        "docs/reduction/inference-core/contract-revisions/PR-11A.json",
      ),
    ),
    false,
  )
})

test("R1-K1 binds custody without selecting the vendor algorithm early", () => {
  const decisions = readDecision().bindingDecisions
  assert.equal(
    decisions.vendorCustody.algorithmSelection,
    "deferred-to-pr12-and-q0",
  )
  assert.equal(decisions.vendorCustody.privateMaterialOnAppliance, false)
  assert.equal(decisions.vendorCustody.privateMaterialInGit, false)
  assert.equal(
    decisions.vendorCustody.privateMaterialInCiEnvironmentVariables,
    false,
  )
  assert.equal(decisions.vendorCustody.cloudSigningDependency, false)
  assert.equal(decisions.auditExportCustody.algorithm, "Ed25519")
  assert.equal(
    decisions.auditExportCustody.privateKeyProvisioning,
    "root-only-mounted-secret",
  )
  assert.equal(decisions.auditExportCustody.recoveryEnvelope, "customer-held")
})

test("R1-K1 source inventory is exact and remains source-only", () => {
  const decision = readDecision()
  assert.deepEqual(
    changedPaths(integrationBase, sourceHead),
    [...decision.sourcePathInventory].sort(),
  )
  assert.deepEqual(decision.sourcePathCounts, {
    added: 6,
    deleted: 0,
    modified: 13,
    total: 19,
  })
  assert.equal(decision.forbiddenOutputs.realSecretBinding, true)
  assert.equal(decision.forbiddenOutputs.runtimeDeployment, true)
  assert.equal(decision.forbiddenOutputs.vendorPrivateSigningMaterial, true)
})

test("current registers report reviewed but unaccepted R1-K1", () => {
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
    /R1-K1[^\n]+independently reviewed source candidate[^\n]+cd1f7c43bd7c2abe32a2423d1ce77506ecde84cc[^\n]+unaccepted[^\n]+not revision-bound[^\n]+not runtime-qualified/i,
  )
  assert.match(
    validationRegister,
    /R1-K1[^\n]+fresh-clone full source validation[^\n]+independent review passed[^\n]+cd1f7c43bd7c2abe32a2423d1ce77506ecde84cc[^\n]+R1-V1[^\n]+Q0[^\n]+pending[^\n]+unaccepted[^\n]+not revision-bound/i,
  )
})
