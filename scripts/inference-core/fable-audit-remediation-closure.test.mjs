import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"

const root = resolve(import.meta.dirname, "../..")
const closurePath = resolve(
  root,
  "docs/reduction/inference-core/fable-audit-remediation-closure.json",
)
const closure = JSON.parse(readFileSync(closurePath, "utf8"))

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

test("Fable audit closure binds the audited candidate and protected merge", () => {
  assert.equal(
    closure.audit.candidateCommit,
    "0f0399c6a091d4ec0ea78f4379362add38c87b22",
  )
  assert.equal(
    closure.audit.candidateTree,
    "ced785bf0d7f63efab780443e1207b0e3ece73d8",
  )
  assert.equal(
    closure.audit.protectedMerge,
    "005ab894e2ef6826879738eac99030fc97b9fb70",
  )
  assert.equal(
    git("rev-parse", `${closure.audit.candidateCommit}^{tree}`),
    closure.audit.candidateTree,
  )
  assert.equal(
    git("rev-parse", `${closure.audit.protectedMerge}^{tree}`),
    closure.audit.candidateTree,
  )
  assert.equal(closure.audit.externalEvidence.ephemeralClonePreserved, true)
  assert.equal(closure.audit.externalEvidence.cleanupAuthorized, false)
})

test("each remediation is a tree-identical protected merge in exact order", () => {
  assert.deepEqual(
    closure.remediations.map(({ package: name, pullRequest }) => ({
      name,
      pullRequest,
    })),
    [
      { name: "authentication-hardening", pullRequest: 148 },
      { name: "alert-and-grafana-contract-correctness", pullRequest: 149 },
      { name: "activity-semantics", pullRequest: 150 },
    ],
  )

  let expectedFirstParent = closure.audit.protectedMerge
  for (const remediation of closure.remediations) {
    assert.equal(
      git("rev-parse", `${remediation.candidateCommit}^{tree}`),
      remediation.candidateTree,
    )
    assert.equal(
      git("rev-parse", `${remediation.protectedMerge}^{tree}`),
      remediation.candidateTree,
    )
    assert.equal(
      git("rev-parse", `${remediation.protectedMerge}^1`),
      expectedFirstParent,
    )
    assert.equal(
      git("rev-parse", `${remediation.protectedMerge}^2`),
      remediation.candidateCommit,
    )
    assert.equal(remediation.reviewVerdict, "PASS_NO_MATERIAL_FINDINGS")
    assert.match(remediation.reviewer, /^[A-Z][A-Za-z]+$/)
    expectedFirstParent = remediation.protectedMerge
  }
})

test("validation evidence is named, digest-bound, and unique", () => {
  const hashes = []
  for (const remediation of closure.remediations) {
    assert.ok(remediation.validationEvidence.length >= 9)
    for (const evidence of remediation.validationEvidence) {
      assert.match(evidence.command, /\S/)
      assert.match(evidence.log, /^fable-[a-z0-9-]+\.log$/)
      assert.match(evidence.sha256, /^[a-f0-9]{64}$/)
      hashes.push(evidence.sha256)
    }
  }
  assert.equal(new Set(hashes).size, hashes.length)
})

test("every audit finding has one explicit disposition", () => {
  assert.deepEqual(closure.findingDispositions.fixed, [
    "SEC-001",
    "SEC-003",
    "BUG-001",
    "BUG-002",
    "BUG-003",
    "ARCH-001",
    "MAINT-002",
    "MAINT-003",
  ])
  assert.deepEqual(closure.findingDispositions.acceptedRisk, ["SEC-002"])
  assert.deepEqual(closure.findingDispositions.deferredMeasurement, [
    "PERF-001",
    "OPT-2",
    "OPT-3",
  ])
  assert.deepEqual(closure.findingDispositions.deferredQualification, [
    "ARCH-002",
    "MAINT-001",
    "H-1",
    "H-2",
    "H-3",
    "H-4",
  ])

  const all = Object.values(closure.findingDispositions).flat()
  assert.equal(new Set(all).size, all.length)
})

test("closure remains governance-only and inactive", () => {
  assert.deepEqual(closure.status, {
    productAccepted: false,
    runtimeQualified: false,
    contractActivation: "INACTIVE",
    genesisPublished: false,
  })
  assert.deepEqual(closure.governancePaths, [
    "docs/reduction/inference-core/fable-audit-remediation-closure.json",
    "docs/reduction/inference-core/validation-register.md",
    "scripts/inference-core/fable-audit-remediation-closure.test.mjs",
  ])
})
