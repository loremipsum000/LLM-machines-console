import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const amendmentPath =
  "docs/reduction/inference-core/pr-12-source-closure-amendment-2.json"

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

test("PR-12 amendment 2 preserves amendment 1 and binds the exact release source", () => {
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
  assert.equal(
    amendment.predecessor.disposition,
    "PRESERVED_HISTORICAL_SOURCE_CLOSURE_AMENDMENT",
  )
})

test("both D2A blocker successors have exact protected topology and trees", () => {
  const amendment = readJson(amendmentPath)
  assert.deepEqual(
    amendment.successors.map(({ id }) => id),
    [
      "PR-12-REGISTRY-NEUTRAL-CORE-LOCK-SUCCESSOR",
      "PR-12-FIRST-RELEASE-ROLLBACK-SEMANTICS-SUCCESSOR",
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

test("review-blocked rollback candidates remain exact historical evidence", () => {
  const amendment = readJson(amendmentPath)
  const rollbackSuccessor = amendment.successors.at(-1)
  assert.deepEqual(
    rollbackSuccessor.reviewBlockedCandidates.map(({ commit }) => commit),
    [
      "78340e2ef0ae91f60ef6642e2666227c3384b0dd",
      "a68dd6a78be5f6e1c8156b650e7d114fdc08917f",
      "08103edd3b9fbb8b2a52e11a55a9bebdbd594b4b",
    ],
  )
  let expectedParent = rollbackSuccessor.base.commit
  for (const blocked of rollbackSuccessor.reviewBlockedCandidates) {
    assert.equal(git("rev-parse", `${blocked.commit}^{tree}`), blocked.tree)
    assert.equal(git("rev-parse", `${blocked.commit}^`), expectedParent)
    assert.equal(blocked.disposition, "PRESERVED_REVIEW_BLOCKED_EVIDENCE")
    expectedParent = blocked.commit
  }
  assert.equal(
    git("rev-parse", `${rollbackSuccessor.candidate.commit}^`),
    expectedParent,
  )
})

test("amended release source contains every exact successor evidence binding", () => {
  const amendment = readJson(amendmentPath)
  assert.equal(amendment.evidenceBindings.length, 28)
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
})

test("first-install commissioning observation remains a Q0 trust input", () => {
  const amendment = readJson(amendmentPath)
  assert.deepEqual(amendment.firstInstallCommissioningObservation, {
    phase: "Q0",
    status: "NOT_STARTED",
    requiredProof: [
      "TRUSTED_OBSERVER",
      "APPLIANCE_BINDING",
      "SEPARATE_CUSTOMER_BACKUP_TARGET",
      "CLEAN_RESTORE",
    ],
    authority: "UNDECIDED_Q0_TRUST_INPUT",
    custody: "UNDECIDED_Q0_TRUST_INPUT",
    interpretation:
      "PR-12 defines no signing or custody authority for this observation. Q0 must establish and verify both.",
  })
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
    assert.match(content, /Amendment 2/)
    assert.match(content, /accepted remains false/i)
    assert.match(content, /runtimeQualified remains false/)
    assert.match(content, /D2A-RC and Q0 remain NOT_STARTED/)
  }
})

test("PR-12 amendment 2 introduction is an exact governance-only transition", () => {
  const amendment = readJson(amendmentPath)
  const introduction = git(
    "log",
    "--diff-filter=A",
    "--format=%H",
    "-1",
    "--",
    amendmentPath,
  )
  assert.match(introduction, /^[a-f0-9]{40}$/)
  assert.equal(
    git("rev-parse", `${introduction}^`),
    amendment.releaseSource.commit,
  )
  const changedPaths = git(
    "diff",
    "--name-status",
    "--no-renames",
    amendment.releaseSource.commit,
    introduction,
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => line.replace("\t", " "))
  assert.deepEqual(changedPaths, [
    "M docs/reduction/inference-core/README.md",
    "M docs/reduction/inference-core/decision-register.md",
    "A docs/reduction/inference-core/pr-12-source-closure-amendment-2.json",
    "M docs/reduction/inference-core/validation-register.md",
    "A scripts/inference-core/pr12-source-closure-amendment-2.test.mjs",
  ])
  assert.equal(
    changedPaths.some((entry) =>
      /^(?:[A-Z] )?(?:apps|packages|infra|\.github)\//.test(entry),
    ),
    false,
  )
})
