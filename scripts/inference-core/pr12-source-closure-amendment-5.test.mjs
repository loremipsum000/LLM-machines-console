import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const amendmentPath =
  "docs/reduction/inference-core/pr-12-source-closure-amendment-5.json"

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

test("amendment 5 preserves amendment 4 and binds the current release source", () => {
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
})

test("amendment 4 governance and the Koffi successor have exact protected topology", () => {
  const amendment = readJson(amendmentPath)
  const predecessorAdmission =
    amendment.predecessor.protectedGovernanceAdmission
  assert.equal(
    git("rev-parse", `${predecessorAdmission.commit}^1`),
    predecessorAdmission.firstParent,
  )
  assert.equal(
    git("rev-parse", `${predecessorAdmission.commit}^2`),
    predecessorAdmission.secondParent,
  )
  assert.equal(
    git("rev-parse", `${predecessorAdmission.commit}^{tree}`),
    predecessorAdmission.tree,
  )

  const { successor } = amendment
  const admission = successor.protectedAdmission
  assert.equal(successor.pullRequest, 59)
  assert.equal(successor.base.commit, predecessorAdmission.commit)
  assert.equal(
    git("rev-parse", `${successor.base.commit}^{tree}`),
    successor.base.tree,
  )
  assert.equal(
    git("rev-parse", `${successor.candidate.commit}^{tree}`),
    successor.candidate.tree,
  )
  assert.equal(git("rev-parse", `${admission.commit}^1`), admission.firstParent)
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
  assert.equal(successor.candidate.materialReview, "PASS")
  assert.equal(successor.productBehaviorChanged, false)
  assert.equal(successor.runtimeQualified, false)
  assert.equal(amendment.releaseSource.commit, admission.commit)
})

test("the release source binds the exact Koffi executable-stack correction", () => {
  const amendment = readJson(amendmentPath)
  const patch = execFileSync(
    "git",
    [
      "show",
      `${amendment.releaseSource.commit}:infra/firecrawl/release/patches/build-hardening.patch`,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  )
  for (const token of [
    "Koffi 2.9.0 ships its linux/x64 native module with an executable GNU_STACK.",
    'path.dirname(require.resolve("koffi"))',
    "elf.writeUInt32LE(flags & ~1, offset + 4);",
    "RUN /usr/bin/node -e 'require(\"koffi\")'",
  ]) {
    assert.ok(patch.includes(token), `missing Koffi hardening token: ${token}`)
  }
  assert.deepEqual(amendment.correctedRuntimeArtifact, {
    package: "koffi",
    version: "2.9.0",
    module:
      "apps/api/node_modules/.pnpm/koffi@2.9.0/node_modules/koffi/build/koffi/linux_x64/koffi.node",
    elfClass: "ELF64",
    byteOrder: "LITTLE_ENDIAN",
    programHeader: "PT_GNU_STACK",
    originalFlags: "RWE",
    admittedFlags: "RW",
    edit: "CLEAR_PF_X_ONLY",
    runtimeLoadCheck: "PASS",
    licensingDisposition: "UNCHANGED_BY_EXECUTABLE_STACK_CORRECTION",
  })
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

test("amendment 5 remains inactive and distinct from Product acceptance", () => {
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
    assert.match(content, /Amendment 5/)
    assert.match(content, /accepted remains false/i)
    assert.match(content, /runtimeQualified remains\s+false/)
    assert.match(content, /D2A-RC and Q0 remain\s+NOT_STARTED/)
    assert.match(content, /5e7761b[\s\S]{0,100}historical/i)
  }
})

test("amendment 5 introduction is an exact governance-only transition", () => {
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
    "A docs/reduction/inference-core/pr-12-source-closure-amendment-5.json",
    "M docs/reduction/inference-core/validation-register.md",
    "A scripts/inference-core/pr12-source-closure-amendment-5.test.mjs",
  ])
  assert.equal(
    changedPaths.some((entry) =>
      /^(?:[A-Z] )?(?:apps|packages|infra|\.github)\//.test(entry),
    ),
    false,
  )
})
