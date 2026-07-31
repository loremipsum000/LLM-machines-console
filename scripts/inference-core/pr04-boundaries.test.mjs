import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import {
  pr04ContractBase,
  pr04DecisionPath,
  pr04LaneAnchor,
  pr04StandaloneDbTestBoundary,
  repositoryRoot,
  routeBaselinePath,
  verifyPr04BaseEvidence,
  verifyPr04DecisionDocument,
  verifyPr04TargetState,
  verifyReviewedPr04WebAuthenticationEvidence,
  verifyStandaloneDbTestBoundary,
} from "./guardrails.mjs"

test("PR-04 is anchored to the reviewed PR-03 integration tree", () => {
  assert.equal(pr04ContractBase, "fb36b9de38396af79c82056963ae3f4833a12fef")
  assert.equal(pr04LaneAnchor, pr04ContractBase)
  assert.equal(
    git(["rev-parse", `${pr04ContractBase}^{tree}`]),
    "be8f9ebafd0ea2e9411689600c21f2cf8464e39b",
  )
})

test("PR-04 retains all PR-02 and PR-03 evidence byte-identically", () => {
  assert.deepEqual(verifyPr04BaseEvidence(), [])
})

test("PR-04 decision evidence is structurally complete", () => {
  const decision = readJson(resolve(repositoryRoot, pr04DecisionPath))

  assert.deepEqual(verifyPr04DecisionDocument(decision), [])
})

test("PR-04 binds the successor Web authentication evidence", () => {
  assert.deepEqual(verifyReviewedPr04WebAuthenticationEvidence(), [])
})

test("PR-04 keeps PGlite inside the exact standalone DB test workspace", () => {
  const paths = [
    ...pr04StandaloneDbTestBoundary.allowedPaths,
    "apps/bff/package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ]
  assert.deepEqual(verifyStandaloneDbTestBoundary(repositoryRoot, paths), [])
})

test("an activated PR-04 baseline satisfies the data target", () => {
  const baseline = readJson(resolve(repositoryRoot, routeBaselinePath))
  if (!(baseline.reviewedRevisions ?? []).some(({ id }) => id === "PR-04")) {
    return
  }

  const allowlist = readJson(
    resolve(
      repositoryRoot,
      "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
    ),
  )
  assert.deepEqual(
    verifyPr04TargetState({
      root: repositoryRoot,
      currentAllowlist: allowlist,
      currentRoutes: baseline,
      paths: baseline.repositoryClosure.map(({ path }) => path),
    }),
    [],
  )
})

function git(args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim()
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}
