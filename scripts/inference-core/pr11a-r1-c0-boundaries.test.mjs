import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const decisionPath =
  "docs/reduction/inference-core/pr-11a-identity-ingress-hardening-decisions.json"
const decisionRegisterPath =
  "docs/reduction/inference-core/decision-register.md"
const validationRegisterPath =
  "docs/reduction/inference-core/validation-register.md"
const contractBaseCommit = "9d8f1a6144cb280104cdce0a21ab7dafa72087ec"
const contractBaseTree = "a7cb76ff95ec4ffc12cbd589b0514564602c35da"
const exactBranch = "codex/inference-core-pr-11a-r1-c0"
const governanceCheckpointPaths = [
  "docs/reduction/inference-core/README.md",
  decisionPath,
  decisionRegisterPath,
  validationRegisterPath,
  "scripts/inference-core/guardrails.mjs",
  "scripts/inference-core/pr11a-r1-c0-boundaries.test.mjs",
].sort()

function git(...args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim()
}

function readDecision() {
  return JSON.parse(readFileSync(resolve(repositoryRoot, decisionPath), "utf8"))
}

function changedPathsFromBase() {
  const output = git(
    "diff",
    "--name-only",
    "--no-ext-diff",
    "--no-renames",
    contractBaseCommit,
    "--",
  )
  return output === "" ? [] : output.split("\n").sort()
}

test("R1-C0 governance is anchored to the protected integration base", () => {
  assert.equal(
    git("rev-parse", `${contractBaseCommit}^{tree}`),
    contractBaseTree,
  )
  assert.doesNotThrow(() =>
    git("merge-base", "--is-ancestor", contractBaseCommit, "HEAD"),
  )
  assert.equal(git("branch", "--show-current"), exactBranch)
})

test("R1-C0 governance is explicitly proposed and unaccepted", () => {
  const decision = readDecision()
  assert.equal(decision.schemaVersion, 1)
  assert.equal(decision.workPackage, "PR-11A-R1-C0")
  assert.equal(decision.scope, "product-authority-and-governance-source-only")
  assert.equal(decision.contractBaseCommit, contractBaseCommit)
  assert.equal(decision.contractBaseTree, contractBaseTree)
  assert.equal(decision.exactBranch, exactBranch)
  assert.equal(decision.reviewStatus, "proposed-governance-first")
  assert.equal(decision.accepted, false)
  assert.equal(decision.revisionBound, false)
})

test("R1-C0 binds the Console-first private-service boundary", () => {
  const decisions = readDecision().bindingDecisions
  assert.equal(decisions.console.primaryCustomerExperience, true)
  assert.equal(decisions.console.launchCriticalWithoutNativeExpertSurfaces, true)
  assert.deepEqual(decisions.nativeExpertAccess, {
    launchTargets: [],
    litellm: "denied",
    keycloakAdmin: "denied",
    grafana: "deferred-unqualified",
  })
  assert.deepEqual(decisions.litellm.consoleMutationAuthority, [])
  assert.equal(decisions.litellm.networkPosture, "private")
  assert.equal(decisions.keycloak.customerNativeAdminConsole, false)
  assert.equal(decisions.keycloak.normalIdentityFlowsRetained, true)
  assert.equal(decisions.packageSequence.nextAfterReviewedMerge, "R1-S1")
  assert.equal(decisions.packageSequence.grafanaWorkAuthorized, false)
  assert.equal(decisions.packageSequence.laterPackagesBundled, false)
})

test("R1-C0 registers do not claim acceptance or revision binding", () => {
  const decisionRegister = readFileSync(
    resolve(repositoryRoot, decisionRegisterPath),
    "utf8",
  )
  const validationRegister = readFileSync(
    resolve(repositoryRoot, validationRegisterPath),
    "utf8",
  )
  assert.match(
    decisionRegister,
    /PR-11A R1-C0[^\n]+Proposed governance checkpoint only; unaccepted and not revision-bound/,
  )
  assert.match(
    validationRegister,
    /PR-11A R1-C0[^\n]+Not accepted; governance checkpoint only/,
  )
  assert.doesNotMatch(decisionRegister, /PR-11A R1-C0[^\n]+Accepted/)
  assert.doesNotMatch(validationRegister, /PR-11A R1-C0[^\n]+Passed/)
})

test("R1-C0 governance checkpoint contains no behavior change", () => {
  const decision = readDecision()
  assert.deepEqual(decision.preBehaviorInventory, {
    admittedBehaviorSourcePaths: [],
    routesAdded: [],
    routesChanged: [],
    routesRemoved: [],
    runtimeBindings: [],
    realSecretBindings: [],
    productMainMutation: false,
  })
  assert.deepEqual(changedPathsFromBase(), governanceCheckpointPaths)
  assert.equal(
    git(
      "ls-tree",
      "--name-only",
      "HEAD",
      "--",
      "docs/reduction/inference-core/contract-revisions/PR-11A.json",
    ),
    "",
  )
})
