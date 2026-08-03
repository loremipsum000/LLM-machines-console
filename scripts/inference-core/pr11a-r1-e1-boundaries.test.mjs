import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const integrationBase = "39057332207cca6193495453b7336eda07608255"
const integrationBaseTree = "4deb5b337120202b52173b05910f1cbf028b50c3"
const sourceHead = "c60280c11318aa21d230e7002cb7d703625a7168"
const sourceHeadTree = "898d5ef6605dc9e14ff401208f09acabc062fe1b"
const decisionPath =
  "docs/reduction/inference-core/pr-11a-r1-e1-product-edge-decisions.json"

function git(...args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim()
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"))
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

test("R1-E1 starts from the protected R1-S1 integration merge", () => {
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

test("R1-E1 remains an unaccepted source-only candidate", () => {
  const decision = readJson(decisionPath)
  assert.equal(decision.schemaVersion, 1)
  assert.equal(decision.workPackage, "PR-11A-R1-E1")
  assert.equal(decision.scope, "mandatory-core-product-edge-source-only")
  assert.equal(decision.integrationBaseCommit, integrationBase)
  assert.equal(decision.integrationBaseTree, integrationBaseTree)
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

test("R1-E1 source inventory is exact", () => {
  const decision = readJson(decisionPath)
  assert.deepEqual(
    changedPaths(integrationBase, sourceHead),
    [...decision.sourcePathInventory].sort(),
  )
  assert.equal(decision.sourcePathInventory.length, 26)
  assert.deepEqual(decision.sourcePathCounts, {
    added: 17,
    deleted: 0,
    modified: 9,
    total: 26,
  })
})

test("R1-E1 binds only core edge surfaces and keeps native systems absent", () => {
  const decision = readJson(decisionPath)
  assert.deepEqual(decision.bindingDecisions.edge.publicHostIds, [
    "console",
    "identity",
  ])
  assert.deepEqual(decision.bindingDecisions.fixedInternalUpstreams, [
    "console-web:3000",
    "console-bff:4001",
    "keycloak:8080",
  ])
  assert.deepEqual(decision.bindingDecisions.nativeAdministration, {
    alertmanager: "denied",
    firecrawlNative: "denied",
    grafana: "absent-unqualified",
    keycloakAdmin: "denied",
    litellm: "denied",
    prometheus: "denied",
  })
})

test("current registers report R1-S1 merged and R1-E1 unaccepted", () => {
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
    /R1-S1[^\n]+independently reviewed[^\n]+PR 14[^\n]+unaccepted[^\n]+not revision-bound/i,
  )
  assert.match(
    validationRegister,
    /R1-S1[^\n]+fresh-clone[^\n]+independent review[^\n]+PR 14[^\n]+unaccepted[^\n]+not revision-bound/i,
  )
  assert.match(
    decisionRegister,
    /R1-E1[^\n]+independently reviewed source package[^\n]+PR 15[^\n]+1743cb746f87c7497a34f4de7e3bfc0db3ff0be2[^\n]+unaccepted[^\n]+not revision-bound[^\n]+not runtime-qualified/i,
  )
  assert.match(
    validationRegister,
    /R1-E1[^\n]+fresh-clone full source validation[^\n]+independent review passed[^\n]+c60280c11318aa21d230e7002cb7d703625a7168[^\n]+PR 15[^\n]+1743cb746f87c7497a34f4de7e3bfc0db3ff0be2[^\n]+R1-V1[^\n]+Q0[^\n]+pending[^\n]+unaccepted[^\n]+not revision-bound/i,
  )
})
