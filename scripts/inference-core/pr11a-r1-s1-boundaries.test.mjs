import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import {
  buildRouteBaseline,
  pr11aR1S1Pr09NativeIdentifierSuccessorEvidence,
  verifyReviewedPr09NativeIdentifierEvidence,
} from "./guardrails.mjs"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const decisionPath =
  "docs/reduction/inference-core/pr-11a-r1-s1-console-session-decisions.json"
const decisionRegisterPath =
  "docs/reduction/inference-core/decision-register.md"
const validationRegisterPath =
  "docs/reduction/inference-core/validation-register.md"
const acceptedRouteBaselinePath =
  "docs/reduction/inference-core/route-baseline.json"
const integrationBase = "0f29c7939fa885c11c191e8b672f09e16635ddcb"
const sourceBase = "aa831424949fb49095de48714b508ada0b57f589"
const sourceBaseTree = "3c17e44c23fd15b1d84722529b4f96693ec0cd93"
const sourceHead = "102989e25f94dc68f8ec4d2aa2e583669aac604c"
const sourceHeadTree = "0c139e4075dd96350ab851e99dbd0314330a61f6"

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

function routeSignatures(routes) {
  return routes.map(
    ({ method, path, surface }) => `${method} ${surface} ${path}`,
  )
}

test("R1-S1 is anchored after the protected R1-C0 integration", () => {
  assert.equal(git("rev-parse", `${sourceBase}^{tree}`), sourceBaseTree)
  assert.equal(git("rev-parse", `${sourceHead}^{tree}`), sourceHeadTree)
  assert.doesNotThrow(() =>
    git("merge-base", "--is-ancestor", integrationBase, sourceBase),
  )
  assert.doesNotThrow(() =>
    git("merge-base", "--is-ancestor", sourceBase, sourceHead),
  )
  assert.doesNotThrow(() =>
    git("merge-base", "--is-ancestor", sourceHead, "HEAD"),
  )
})

test("R1-S1 remains an unaccepted source-only candidate", () => {
  const decision = readJson(decisionPath)
  assert.equal(decision.schemaVersion, 1)
  assert.equal(decision.workPackage, "PR-11A-R1-S1")
  assert.equal(decision.scope, "console-session-hardening-source-only")
  assert.equal(decision.integrationBaseCommit, integrationBase)
  assert.equal(decision.sourceBaseCommit, sourceBase)
  assert.equal(decision.sourceHeadCommit, sourceHead)
  assert.equal(
    decision.reviewStatus,
    "source-candidate-awaiting-independent-review",
  )
  assert.equal(decision.localValidation, "passed-local-full-source-gates")
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

test("R1-S1 source inventory is exact", () => {
  const decision = readJson(decisionPath)
  assert.deepEqual(
    changedPaths(sourceBase, sourceHead),
    decision.sourcePathInventory,
  )
  assert.equal(decision.sourcePathInventory.length, 100)
  assert.deepEqual(decision.sourcePathCounts, {
    added: 37,
    deleted: 9,
    modified: 54,
    total: 100,
  })
})

test("R1-S1 binds the exact native audit evidence successor", () => {
  assert.deepEqual(pr11aR1S1Pr09NativeIdentifierSuccessorEvidence, {
    path: "test-support/inference-core-db-tests/src/pr09-audit-ingestion.test.ts",
    sha256: "34f5d2a631bf0ad19b81e781e10d3738f4702ceed50a5a56cb2d164f6a804fc1",
  })
  assert.deepEqual(verifyReviewedPr09NativeIdentifierEvidence(), [])
})

test("R1-S1 makes only the reviewed opaque-session route transition", () => {
  const accepted = readJson(acceptedRouteBaselinePath)
  const candidate = buildRouteBaseline({
    baseCommit: sourceHead,
    root: repositoryRoot,
  })
  const acceptedSignatures = new Set(routeSignatures(accepted.routes))
  const candidateSignatures = new Set(routeSignatures(candidate.routes))
  const added = [...candidateSignatures]
    .filter((signature) => !acceptedSignatures.has(signature))
    .sort()
  const removed = [...acceptedSignatures]
    .filter((signature) => !candidateSignatures.has(signature))
    .sort()
  const decision = readJson(decisionPath)

  assert.equal(accepted.routes.length, 104)
  assert.equal(candidate.routes.length, 109)
  assert.deepEqual(added, decision.routeTransition.added)
  assert.deepEqual(removed, decision.routeTransition.removed)
})

test("R1-S1 removes browser tokens and retired native authority", () => {
  const deletedBrowserAuth = [
    "apps/web/src/app/api/auth/[...nextauth]/route.ts",
    "apps/web/src/app/auth/keycloak/route.ts",
    "apps/web/src/lib/auth/auth.ts",
    "apps/web/src/lib/auth/env.ts",
    "apps/web/src/lib/auth/token-refresh.ts",
    "apps/web/src/types/next-auth.d.ts",
  ]
  for (const path of deletedBrowserAuth) {
    assert.equal(existsSync(resolve(repositoryRoot, path)), false, path)
  }

  const webPackage = readFileSync(
    resolve(repositoryRoot, "apps/web/package.json"),
    "utf8",
  )
  const lockfile = readFileSync(
    resolve(repositoryRoot, "pnpm-lock.yaml"),
    "utf8",
  )
  assert.doesNotMatch(webPackage, /next-auth/)
  assert.doesNotMatch(lockfile, /next-auth/)

  const productionPaths = [
    "apps/bff/src/auth/authorization.ts",
    "apps/bff/src/routes/console-session.ts",
    "apps/bff/src/services/console-session-runtime.ts",
    "apps/web/src/lib/auth/session-client.ts",
    "apps/web/src/middleware.ts",
    "packages/contracts/src/inference-core-session.ts",
  ]
  const forbidden = [
    "litellm.routes_keys.edit",
    "grafana.dashboards_alerting.edit",
    "grafana.view",
    "expert_access.",
  ]
  for (const path of productionPaths) {
    const source = readFileSync(resolve(repositoryRoot, path), "utf8")
    for (const value of forbidden) {
      assert.equal(source.includes(value), false, `${path} retains ${value}`)
    }
  }
})

test("R1-S1 registers cannot overstate acceptance or qualification", () => {
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
    /PR-11A R1-S1[^\n]+source candidate[^\n]+awaiting independent review[^\n]+unaccepted[^\n]+not revision-bound/i,
  )
  assert.match(
    validationRegister,
    /PR-11A R1-S1[^\n]+independent review[^\n]+R1-V1[^\n]+Q0[^\n]+pending[^\n]+unaccepted[^\n]+not revision-bound/i,
  )
  assert.doesNotMatch(decisionRegister, /PR-11A R1-S1[^\n]+\| Accepted/i)
  assert.doesNotMatch(validationRegister, /PR-11A R1-S1[^\n]+\| Passed/i)
})
