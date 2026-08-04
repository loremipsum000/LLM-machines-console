import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const amendmentPath =
  "docs/reduction/inference-core/pr-12-source-closure-amendment-1.json"
const amendmentIntroduction = "f8e2e3b975256c325585f9e9aac1a1b47acf8166"
const amendmentIntroductionTree = "d4b7d8a03766fab9714e8465f4d99b563732f7b6"

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

test("PR-12 amendment preserves the predecessor and binds the exact release source", () => {
  const amendment = readJson(amendmentPath)
  assert.equal(amendment.sourceClosureStatus, "SOURCE_CLOSED")
  assert.equal(amendment.amendmentStatus, "SOURCE_CLOSURE_AMENDED")
  assert.equal(amendment.accepted, false)
  assert.equal(amendment.releaseSourceBound, true)
  assert.equal(
    git("rev-parse", `${amendment.releaseSource.commit}^{tree}`),
    amendment.releaseSource.tree,
  )
  assert.equal(
    sha256AtCommit(amendment.releaseSource.commit, amendment.predecessor.path),
    amendment.predecessor.sha256,
  )
  assert.equal(
    createHash("sha256")
      .update(readFileSync(resolve(repositoryRoot, amendment.predecessor.path)))
      .digest("hex"),
    amendment.predecessor.sha256,
  )
  const closeout = amendment.predecessor.sourceCloseoutAdmission
  assert.equal(git("rev-parse", `${closeout.commit}^1`), closeout.firstParent)
  assert.equal(git("rev-parse", `${closeout.commit}^2`), closeout.secondParent)
  assert.equal(git("rev-parse", `${closeout.commit}^{tree}`), closeout.tree)
  assert.equal(
    git("rev-parse", `${closeout.candidateCommit}^{tree}`),
    closeout.tree,
  )
  assert.equal(closeout.secondParent, closeout.candidateCommit)
  assert.equal(
    git("diff", "--name-only", closeout.candidateCommit, closeout.commit),
    "",
  )
})

test("both D2A preflight successors have exact protected topology and trees", () => {
  const amendment = readJson(amendmentPath)
  assert.deepEqual(
    amendment.successors.map(({ id }) => id),
    [
      "PR-12-RELEASE-TEST-GATE-SUCCESSOR",
      "PR-12-RELEASE-EVIDENCE-HARDENING-SUCCESSOR",
    ],
  )
  for (const successor of amendment.successors) {
    const admission = successor.protectedAdmission
    assert.equal(
      git("rev-parse", `${successor.base.commit}^{tree}`),
      successor.base.tree,
    )
    assert.equal(
      git("rev-parse", `${successor.candidate.commit}^{tree}`),
      successor.candidate.tree,
    )
    assert.equal(
      git("rev-parse", `${admission.commit}^1`),
      admission.firstParent,
    )
    assert.equal(
      git("rev-parse", `${admission.commit}^2`),
      admission.secondParent,
    )
    assert.equal(git("rev-parse", `${admission.commit}^{tree}`), admission.tree)
    assert.equal(admission.firstParent, successor.base.commit)
    assert.equal(admission.secondParent, successor.candidate.commit)
    assert.equal(admission.tree, successor.candidate.tree)
    assert.equal(
      git("diff", "--name-only", successor.candidate.commit, admission.commit),
      "",
    )
    assert.equal(successor.candidate.independentReview, "PASS")
    assert.equal(successor.productBehaviorChanged, false)
    assert.equal(successor.runtimeQualified, false)
  }
  assert.equal(
    amendment.releaseSource.commit,
    amendment.successors.at(-1).protectedAdmission.commit,
  )
})

test("amended release source contains every exact evidence binding", () => {
  const amendment = readJson(amendmentPath)
  assert.equal(amendment.evidenceBindings.length, 10)
  assert.equal(
    new Set(amendment.evidenceBindings.map(({ path }) => path)).size,
    amendment.evidenceBindings.length,
  )
  for (const binding of amendment.evidenceBindings) {
    assert.match(binding.sha256, /^[a-f0-9]{64}$/)
    assert.equal(
      sha256AtCommit(amendment.releaseSource.commit, binding.path),
      binding.sha256,
    )
  }

  const manifest = JSON.parse(
    execFileSync(
      "git",
      ["show", `${amendment.releaseSource.commit}:package.json`],
      { cwd: repositoryRoot, encoding: "utf8" },
    ),
  )
  const gate = JSON.parse(
    execFileSync(
      "git",
      [
        "show",
        `${amendment.releaseSource.commit}:docs/reduction/inference-core/pr-12-release-test-gate-binding.json`,
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    ),
  )
  assert.equal(manifest.scripts["test:release"], gate.commands.release)
  assert.equal(manifest.scripts.test, gate.commands.product)
  assert.equal(
    manifest.scripts.test.match(/corepack pnpm run test:release/g)?.length,
    1,
  )
})

test("amended source closure remains inactive and distinct from runtime acceptance", () => {
  const amendment = readJson(amendmentPath)
  assert.deepEqual(amendment.status, {
    runtimeQualified: false,
    contractActivation: "INACTIVE",
    d2aRc: "NOT_STARTED",
    q0: "NOT_STARTED",
    grafanaCustomerAccess: "DEFERRED_V1",
    deployment: "INACTIVE",
    productMain: "UNCHANGED",
  })
  for (const path of [
    "docs/reduction/inference-core/decision-register.md",
    "docs/reduction/inference-core/validation-register.md",
  ]) {
    const content = readFileSync(resolve(repositoryRoot, path), "utf8")
    assert.match(content, /Amendment 1/)
    assert.match(content, /accepted remains false/i)
    assert.match(content, /runtimeQualified remains false/)
    assert.match(content, /D2A-RC and Q0 remain NOT_STARTED/)
  }
})

test("PR-12 amendment introduction is an exact governance-only transition", () => {
  const amendment = readJson(amendmentPath)
  assert.equal(
    git("rev-parse", `${amendmentIntroduction}^`),
    amendment.releaseSource.commit,
  )
  assert.equal(
    git("rev-parse", `${amendmentIntroduction}^{tree}`),
    amendmentIntroductionTree,
  )
  const changedPaths = git(
    "diff",
    "--name-status",
    "--no-renames",
    amendment.releaseSource.commit,
    amendmentIntroduction,
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => line.replace("\t", " "))
  assert.deepEqual(changedPaths, [
    "M docs/reduction/inference-core/README.md",
    "M docs/reduction/inference-core/decision-register.md",
    "A docs/reduction/inference-core/pr-12-source-closure-amendment-1.json",
    "M docs/reduction/inference-core/validation-register.md",
  ])
  assert.equal(
    changedPaths.some((entry) =>
      /^(?:[A-Z] )?(?:apps|packages|infra|\.github)\//.test(entry),
    ),
    false,
  )
})
