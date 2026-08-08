import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const amendmentPath =
  "docs/reduction/inference-core/pr-12-source-closure-amendment-3.json"

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

test("amendment 3 preserves amendment 2 and binds the current release source", () => {
  const amendment = readJson(amendmentPath)
  assert.equal(amendment.sourceClosureStatus, "SOURCE_CLOSED")
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
  assert.notEqual(
    amendment.releaseSource.commit,
    amendment.predecessor.releaseSource.commit,
  )
})

test("intervening protected history is exact and is not reclassified", () => {
  const amendment = readJson(amendmentPath)
  const history = amendment.interveningProtectedHistory
  assert.equal(
    history.fromReleaseSource,
    amendment.predecessor.releaseSource.commit,
  )
  assert.deepEqual(
    git(
      "rev-list",
      "--first-parent",
      "--reverse",
      `${history.fromReleaseSource}..${history.throughIntegration}`,
    ).split("\n"),
    history.firstParentAdmissions,
  )
  assert.equal(history.firstParentAdmissions.at(-1), history.throughIntegration)
  assert.equal(history.includesPullRequest53, true)
  assert.equal(
    history.disposition,
    "PRESERVED_PROTECTED_HISTORY_NOT_RECLASSIFIED_AS_PR12_SUCCESSORS",
  )
})

test("both Firecrawl release successors have exact protected topology", () => {
  const amendment = readJson(amendmentPath)
  assert.deepEqual(
    amendment.successors.map(({ pullRequest }) => pullRequest),
    [54, 55],
  )
  let expectedBase = amendment.interveningProtectedHistory.throughIntegration
  for (const successor of amendment.successors) {
    const admission = successor.protectedAdmission
    assert.equal(successor.base.commit, expectedBase)
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
    expectedBase = admission.commit
  }
  assert.equal(amendment.releaseSource.commit, expectedBase)
})

test("the release source binds the exact official Node API build input", () => {
  const amendment = readJson(amendmentPath)
  const sourcePackage = JSON.parse(
    execFileSync(
      "git",
      [
        "show",
        `${amendment.releaseSource.commit}:infra/firecrawl/release/source-package.json`,
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    ),
  )
  const nodeInputId = ["node-api-build", "er"].join("")
  const nodeInput = sourcePackage.buildInputs.find(
    ({ id }) => id === nodeInputId,
  )
  assert.ok(nodeInput)
  assert.deepEqual(
    {
      repository: nodeInput.repository,
      readableVersion: `node:${nodeInput.version}`,
      sourceRevision: nodeInput.sourceRevision,
      indexDigest: nodeInput.indexDigest,
      platform: nodeInput.platform,
      platformDigest: nodeInput.platformDigest,
    },
    {
      repository: amendment.nodeApiBuildInput.repository,
      readableVersion: amendment.nodeApiBuildInput.readableVersion,
      sourceRevision: amendment.nodeApiBuildInput.sourceRevision,
      indexDigest: amendment.nodeApiBuildInput.indexDigest,
      platform: amendment.nodeApiBuildInput.platform,
      platformDigest: amendment.nodeApiBuildInput.platformDigest,
    },
  )
  assert.equal(
    new Set(sourcePackage.buildInputs.map(({ id }) => id)).size,
    sourcePackage.buildInputs.length,
  )
})

test("the release source binds current Firecrawl reproducibility evidence", () => {
  const amendment = readJson(amendmentPath)
  assert.deepEqual(amendment.evidenceBindings.map(({ path }) => path).sort(), [
    "infra/firecrawl/release/assemble-source-packet.mjs",
    "infra/firecrawl/release/patches/build-hardening.patch",
    "infra/firecrawl/release/reproducibility-evidence.json",
    "infra/firecrawl/release/source-package.json",
    "infra/firecrawl/release/validate-source-package.mjs",
    "infra/firecrawl/release/validate-source-package.test.mjs",
  ])
  for (const binding of amendment.evidenceBindings) {
    assert.match(binding.sha256, /^[a-f0-9]{64}$/)
    assert.equal(
      sha256AtCommit(amendment.releaseSource.commit, binding.path),
      binding.sha256,
    )
  }
  const evidence = JSON.parse(
    execFileSync(
      "git",
      [
        "show",
        `${amendment.releaseSource.commit}:infra/firecrawl/release/reproducibility-evidence.json`,
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    ),
  )
  for (const key of [
    "sourcePackageSha256",
    "fileCount",
    "symlinkCount",
    "inventorySha256",
    "sha256SumsSha256",
    "packetSha256",
  ]) {
    assert.equal(evidence[key], amendment.firecrawlEvidence[key])
  }
  assert.deepEqual(evidence.patchesApplied, [
    { order: 1, ...amendment.firecrawlEvidence.patches[0] },
    { order: 2, ...amendment.firecrawlEvidence.patches[1] },
  ])
  assert.equal(evidence.runtimeQualified, false)
})

test("amendment 3 remains inactive and distinct from Product acceptance", () => {
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
    "docs/reduction/inference-core/README.md",
    "docs/reduction/inference-core/decision-register.md",
    "docs/reduction/inference-core/validation-register.md",
  ]) {
    const content = readFileSync(resolve(repositoryRoot, path), "utf8")
    assert.match(content, /Amendment 3/)
    assert.match(content, /accepted remains false/i)
    assert.match(content, /runtimeQualified remains\s+false/)
    assert.match(content, /D2A-RC and Q0 remain\s+NOT_STARTED/)
    assert.match(content, /4b2fc6a[\s\S]{0,100}historical/i)
  }
})

test("amendment 3 introduction is an exact governance-only transition", () => {
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
    "A docs/reduction/inference-core/pr-12-source-closure-amendment-3.json",
    "M docs/reduction/inference-core/validation-register.md",
    "A scripts/inference-core/pr12-source-closure-amendment-3.test.mjs",
  ])
  assert.equal(
    changedPaths.some((entry) =>
      /^(?:[A-Z] )?(?:apps|packages|infra|\.github)\//.test(entry),
    ),
    false,
  )
})
