import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const closurePath = "docs/reduction/inference-core/pr-12-source-closure.json"

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
      }),
    )
    .digest("hex")
}

test("PR-12 aggregate admission has the exact reviewed tree", () => {
  const closure = readJson(closurePath)
  const admission = closure.protectedAdmission
  assert.equal(git("rev-parse", `${admission.commit}^1`), admission.firstParent)
  assert.equal(
    git("rev-parse", `${admission.commit}^2`),
    admission.secondParent,
  )
  assert.equal(git("rev-parse", `${admission.commit}^{tree}`), admission.tree)
  assert.equal(
    git("rev-parse", `${closure.validatedAggregateCandidate.commit}^{tree}`),
    closure.validatedAggregateCandidate.tree,
  )
  assert.equal(admission.tree, closure.validatedAggregateCandidate.tree)
  assert.equal(
    git(
      "diff",
      "--name-only",
      closure.validatedAggregateCandidate.commit,
      admission.commit,
    ),
    "",
  )
})

test("PR-12 source closure binds immutable admitted evidence", () => {
  const closure = readJson(closurePath)
  assert.equal(
    git("rev-parse", `${closure.releaseSource.commit}^{tree}`),
    closure.releaseSource.tree,
  )
  assert.equal(
    closure.evidence.aggregateSha256,
    sha256AtCommit(
      closure.protectedAdmission.commit,
      closure.evidence.aggregatePath,
    ),
  )
})

test("PR-12 source closure remains distinct from acceptance and Q0", () => {
  const closure = readJson(closurePath)
  assert.equal(closure.sourceClosureStatus, "SOURCE_CLOSED")
  assert.equal(closure.accepted, false)
  assert.equal(closure.releaseSourceBound, true)
  assert.deepEqual(closure.status, {
    runtimeQualified: false,
    contractActivation: "INACTIVE",
    d2aRc: "NOT_STARTED",
    q0: "NOT_STARTED",
    grafanaCustomerAccess: "DEFERRED_V1",
    deployment: "INACTIVE",
    productMain: "UNCHANGED",
  })
})

test("current registers report source closure without runtime acceptance", () => {
  for (const path of [
    "docs/reduction/inference-core/decision-register.md",
    "docs/reduction/inference-core/validation-register.md",
  ]) {
    const content = readFileSync(resolve(repositoryRoot, path), "utf8")
    assert.match(content, /PR-12 source closure/)
    assert.match(content, /source-closed/)
    assert.match(content, /accepted remains false/)
    assert.match(content, /runtimeQualified remains false/)
    assert.match(content, /Q0 remains NOT_STARTED/)
  }
})

test("PR-12 closeout changes governance paths only", () => {
  const closure = readJson(closurePath)
  const allowed = new Set([
    "docs/reduction/inference-core/README.md",
    "docs/reduction/inference-core/decision-register.md",
    "docs/reduction/inference-core/pr-12-source-closure.json",
    "docs/reduction/inference-core/validation-register.md",
    "scripts/inference-core/pr12-source-closure.test.mjs",
  ])
  const paths = git(
    "diff",
    "--name-only",
    closure.protectedAdmission.commit,
    "HEAD",
  )
    .split("\n")
    .filter(Boolean)
  for (const path of paths) assert.equal(allowed.has(path), true)
  assert.equal(
    paths.some((path) => /^(?:apps|packages|infra|\.github)\//.test(path)),
    false,
  )
})
