import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import {
  pr03ContractBase,
  pr03DecisionPath,
  pr03LaneAnchor,
  repositoryRoot,
  routeBaselinePath,
  verifyPr03DecisionDocument,
  verifyPr03TargetState,
} from "./guardrails.mjs"

test("PR-03 is anchored to the reviewed PR-02 tree and integration merge", () => {
  const baseTree = git(["rev-parse", `${pr03ContractBase}^{tree}`])
  const anchorTree = git(["rev-parse", `${pr03LaneAnchor}^{tree}`])

  assert.equal(baseTree, anchorTree)
  assert.doesNotThrow(() =>
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", pr03ContractBase, pr03LaneAnchor],
      {
        cwd: repositoryRoot,
        stdio: "ignore",
      },
    ),
  )
})

test("PR-03 decision evidence is structurally complete", () => {
  const decision = readJson(resolve(repositoryRoot, pr03DecisionPath))

  assert.deepEqual(verifyPr03DecisionDocument(decision), [])
})

test("an activated PR-03 baseline satisfies the removal target", () => {
  const baseline = readJson(resolve(repositoryRoot, routeBaselinePath))
  if (!(baseline.reviewedRevisions ?? []).some(({ id }) => id === "PR-03")) {
    return
  }

  const allowlist = readJson(
    resolve(
      repositoryRoot,
      "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
    ),
  )
  assert.deepEqual(
    verifyPr03TargetState({
      root: repositoryRoot,
      currentAllowlist: allowlist,
      currentRoutes: baseline,
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
