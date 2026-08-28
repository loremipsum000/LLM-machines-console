import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import {
  buildPr11aR1V1SourceClosureDocument,
  listPr11aR1V1SourceClosureChanges,
  pr11aAggregateEvidencePath,
  pr11aContractRevisionPath,
  pr11aR1V1Input,
  pr11aR1V1ProtectedAdmission,
  pr11aR1V1ProtectedAdmissionTree,
  pr11aR1V1SourceClosureCommit,
  pr11aR1V1SourceClosurePath,
  pr11aR1V1SourceClosurePaths,
  pr11aR1V1SourceClosureTree,
  pr11aR1V1ValidatedCandidate,
  pr11aR1V1ValidatedCandidateTree,
  verifyPr11aR1V1SourceClosureDocument,
} from "./guardrails.mjs"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

function git(...args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim()
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"))
}

function sha256AtCommit(commit, path) {
  return createHash("sha256")
    .update(
      execFileSync("git", ["show", `${commit}:${path}`], {
        cwd: repositoryRoot,
        encoding: null,
      }),
    )
    .digest("hex")
}

test("PR-11A protected admission has the exact validated candidate tree", () => {
  assert.equal(
    git("rev-parse", `${pr11aR1V1ProtectedAdmission}^1`),
    pr11aR1V1Input,
  )
  assert.equal(
    git("rev-parse", `${pr11aR1V1ProtectedAdmission}^2`),
    pr11aR1V1ValidatedCandidate,
  )
  assert.equal(
    git("rev-parse", `${pr11aR1V1ProtectedAdmission}^{tree}`),
    pr11aR1V1ProtectedAdmissionTree,
  )
  assert.equal(
    git("rev-parse", `${pr11aR1V1ValidatedCandidate}^{tree}`),
    pr11aR1V1ValidatedCandidateTree,
  )
  assert.equal(pr11aR1V1ProtectedAdmissionTree, pr11aR1V1ValidatedCandidateTree)
  assert.equal(
    git(
      "diff",
      "--name-only",
      pr11aR1V1ValidatedCandidate,
      pr11aR1V1ProtectedAdmission,
    ),
    "",
  )
})

test("PR-11A source closure binds immutable admitted evidence", () => {
  const closure = readJson(pr11aR1V1SourceClosurePath)
  assert.deepEqual(
    closure,
    buildPr11aR1V1SourceClosureDocument({ root: repositoryRoot }),
  )
  assert.deepEqual(
    verifyPr11aR1V1SourceClosureDocument(closure, { root: repositoryRoot }),
    [],
  )
  assert.equal(
    closure.revisionBoundTo.contractRevisionSha256,
    sha256AtCommit(pr11aR1V1ProtectedAdmission, pr11aContractRevisionPath),
  )
  assert.equal(
    closure.evidence.aggregateSha256,
    sha256AtCommit(pr11aR1V1ProtectedAdmission, pr11aAggregateEvidencePath),
  )
})

test("PR-11A source closure remains distinct from acceptance and activation", () => {
  const closure = readJson(pr11aR1V1SourceClosurePath)
  const routes = readJson("docs/reduction/inference-core/route-baseline.json")
  assert.equal(closure.sourceClosureStatus, "SOURCE_CLOSED")
  assert.equal(closure.accepted, false)
  assert.equal(closure.revisionBound, true)
  assert.deepEqual(closure.status, {
    runtimeQualified: false,
    contractActivation: "INACTIVE",
    q0: "NOT_STARTED",
    grafanaQualification: "NOT_STARTED",
    pr12: "NOT_STARTED",
    deployment: "INACTIVE",
    productMain: "UNCHANGED",
  })
  assert.equal(routes.reviewedRevisions.at(-1)?.id, "PR-11")
})

test("PR-11A source closure changes governance paths only", () => {
  assert.equal(
    git("rev-parse", pr11aR1V1SourceClosureCommit),
    pr11aR1V1SourceClosureCommit,
  )
  assert.equal(
    git("rev-parse", `${pr11aR1V1SourceClosureCommit}^{tree}`),
    pr11aR1V1SourceClosureTree,
  )
  assert.equal(
    git("rev-parse", `${pr11aR1V1SourceClosureCommit}^`),
    pr11aR1V1ProtectedAdmission,
  )
  const changedPaths = listPr11aR1V1SourceClosureChanges(repositoryRoot).map(
    ({ path }) => path,
  )
  assert.deepEqual(changedPaths, pr11aR1V1SourceClosurePaths)
  assert.equal(
    changedPaths.some((path) =>
      /^(?:apps|packages|infra|\.github)\//.test(path),
    ),
    false,
  )
})
