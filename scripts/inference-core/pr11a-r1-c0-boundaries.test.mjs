import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
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
const mergedSourceHead = "6b773e334b5ffa18495ab5c3c9e72f559343fb3e"
const integrationMerge = "0f29c7939fa885c11c191e8b672f09e16635ddcb"
const admittedBehaviorSourcePaths = [
  "apps/bff/src/auth/authorization.ts",
  "apps/bff/src/commands/audit-ingestion.ts",
  "apps/bff/src/services/admin-team.ts",
  "apps/bff/src/services/audit-ingestion.ts",
  "apps/bff/src/services/emergency-recovery.ts",
  "apps/bff/src/services/expert-capabilities.ts",
  "apps/bff/src/services/native-audit-source.ts",
  "apps/web/src/components/console-v2/hardware-v2-experience.tsx",
  "apps/web/src/components/console-v2/inference-v2-experience.tsx",
  "apps/web/src/components/console-v2/team-v2-experience.tsx",
  "packages/contracts/src/inference-core-authorization.ts",
  "packages/contracts/src/inference-core-recovery.ts",
  "packages/contracts/src/inference-core.ts",
]
const sourceCandidatePaths = [
  "apps/bff/src/auth/authorization-security.test.ts",
  "apps/bff/src/auth/authorization.ts",
  "apps/bff/src/commands/audit-ingestion.ts",
  "apps/bff/src/routes/admin-hardware.test.ts",
  "apps/bff/src/routes/admin-inference.test.ts",
  "apps/bff/src/routes/admin-isolation.test.ts",
  "apps/bff/src/routes/admin-recovery.test.ts",
  "apps/bff/src/services/admin-team.ts",
  "apps/bff/src/services/audit-ingestion.test.ts",
  "apps/bff/src/services/audit-ingestion.ts",
  "apps/bff/src/services/emergency-recovery.test.ts",
  "apps/bff/src/services/emergency-recovery.ts",
  "apps/bff/src/services/expert-capabilities.test.ts",
  "apps/bff/src/services/expert-capabilities.ts",
  "apps/bff/src/services/native-audit-source.test.ts",
  "apps/bff/src/services/native-audit-source.ts",
  "apps/web/src/components/console-v2/hardware-v2-experience.test.tsx",
  "apps/web/src/components/console-v2/hardware-v2-experience.tsx",
  "apps/web/src/components/console-v2/inference-v2-experience.tsx",
  "apps/web/src/components/console-v2/role-aware-presentation.test.tsx",
  "apps/web/src/components/console-v2/team-v2-experience.tsx",
  "docs/reduction/inference-core/README.md",
  decisionPath,
  decisionRegisterPath,
  validationRegisterPath,
  "packages/contracts/src/inference-core-authorization.test.ts",
  "packages/contracts/src/inference-core-authorization.ts",
  "packages/contracts/src/inference-core-recovery.test.ts",
  "packages/contracts/src/inference-core-recovery.ts",
  "packages/contracts/src/inference-core.test.ts",
  "packages/contracts/src/inference-core.ts",
  "scripts/inference-core/guardrails.mjs",
  "scripts/inference-core/pr02-boundaries.test.mjs",
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
    `${contractBaseCommit}..${mergedSourceHead}`,
    "--",
  )
  return output === "" ? [] : output.split("\n").sort()
}

test("R1-C0 is anchored to the protected integration base", () => {
  assert.equal(
    git("rev-parse", `${contractBaseCommit}^{tree}`),
    contractBaseTree,
  )
  assert.equal(git("rev-parse", `${integrationMerge}^1`), contractBaseCommit)
  assert.equal(git("rev-parse", `${integrationMerge}^2`), mergedSourceHead)
  assert.equal(
    git("rev-parse", `${integrationMerge}^{tree}`),
    git("rev-parse", `${mergedSourceHead}^{tree}`),
  )
  assert.doesNotThrow(() =>
    git("merge-base", "--is-ancestor", integrationMerge, "HEAD"),
  )
})

test("R1-C0 is a merged source package, not an accepted revision", () => {
  const decision = readDecision()
  assert.equal(decision.schemaVersion, 1)
  assert.equal(decision.workPackage, "PR-11A-R1-C0")
  assert.equal(decision.scope, "product-authority-and-governance-source-only")
  assert.equal(decision.contractBaseCommit, contractBaseCommit)
  assert.equal(decision.contractBaseTree, contractBaseTree)
  assert.equal(decision.exactBranch, exactBranch)
  assert.equal(decision.reviewStatus, "r1-c0-merged-source-package")
  assert.equal(decision.accepted, false)
  assert.equal(decision.revisionBound, false)
})

test("R1-C0 binds the Console-first private-service boundary", () => {
  const decisions = readDecision().bindingDecisions
  assert.equal(decisions.console.primaryCustomerExperience, true)
  assert.equal(
    decisions.console.launchCriticalWithoutNativeExpertSurfaces,
    true,
  )
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
  assert.equal(decisions.removedAuthority.nativeTargetMatrix, true)
  assert.equal(decisions.removedAuthority.keycloakNativeHrefFields, true)
  assert.equal(decisions.removedAuthority.recoveryNativeAccessField, true)
  assert.equal(decisions.packageSequence.nextAfterReviewedMerge, "R1-S1")
  assert.equal(decisions.packageSequence.grafanaWorkAuthorized, false)
  assert.equal(decisions.packageSequence.laterPackagesBundled, false)
})

test("R1-C0 production source contains no retired native authority", () => {
  const forbidden = [
    "litellm.routes_keys.edit",
    "grafana.dashboards_alerting.edit",
    "grafana.view",
    "inferenceCoreExpertAccessMatrix",
    "expertCapabilities",
    "nativeExpertAccess",
    "keycloakHref",
    "Direct LiteLLM access",
    "Direct Keycloak access",
    "Direct Grafana access",
    "managed in LiteLLM",
  ]
  for (const relativePath of admittedBehaviorSourcePaths) {
    const absolutePath = resolve(repositoryRoot, relativePath)
    if (!existsSync(absolutePath)) {
      continue
    }
    const source = readFileSync(absolutePath, "utf8")
    for (const retiredValue of forbidden) {
      assert.equal(
        source.includes(retiredValue),
        false,
        `${relativePath} retains ${retiredValue}`,
      )
    }
  }
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
    /PR-11A R1-C0[^\n]+Merged through PR 13 at integration commit `0f29c7939fa885c11c191e8b672f09e16635ddcb`; PR-11A remains incomplete, unaccepted, and not revision-bound/,
  )
  assert.match(
    validationRegister,
    /PR-11A R1-C0[^\n]+Source validation passed and merged through PR 13; aggregate R1-V1 review remains pending; PR-11A is unaccepted and not revision-bound/,
  )
  assert.doesNotMatch(decisionRegister, /PR-11A R1-C0[^\n]+Accepted/)
  assert.doesNotMatch(validationRegister, /PR-11A R1-C0[^\n]+Passed/)
})

test("R1-C0 source inventory is exact and changes no route or runtime", () => {
  const decision = readDecision()
  assert.deepEqual(decision.preBehaviorInventory, {
    admittedBehaviorSourcePaths,
    routesAdded: [],
    routesChanged: [],
    routesRemoved: [],
    runtimeBindings: [],
    realSecretBindings: [],
    productMainMutation: false,
  })
  assert.deepEqual(changedPathsFromBase(), sourceCandidatePaths)
  assert.equal(
    git(
      "ls-tree",
      "--name-only",
      integrationMerge,
      "--",
      "docs/reduction/inference-core/contract-revisions/PR-11A.json",
    ),
    "",
  )
})
