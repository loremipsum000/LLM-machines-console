import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"

const root = resolve(import.meta.dirname, "../..")
const closure = JSON.parse(
  readFileSync(
    resolve(
      root,
      "docs/reduction/inference-core/fable-business-pristine-closure.json",
    ),
    "utf8",
  ),
)

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

test("closure binds both external audit inventories to the audited baseline", () => {
  assert.deepEqual(closure.auditedBaseline, {
    candidateCommit: "0f0399c6a091d4ec0ea78f4379362add38c87b22",
    candidateTree: "ced785bf0d7f63efab780443e1207b0e3ece73d8",
    protectedMerge: "005ab894e2ef6826879738eac99030fc97b9fb70",
    pullRequest: 147,
  })
  assert.equal(
    git("rev-parse", `${closure.auditedBaseline.candidateCommit}^{tree}`),
    closure.auditedBaseline.candidateTree,
  )
  assert.equal(
    git("rev-parse", `${closure.auditedBaseline.protectedMerge}^{tree}`),
    closure.auditedBaseline.candidateTree,
  )
  assert.deepEqual(
    closure.externalEvidence.reports.map(({ name, fileCount }) => ({
      name,
      fileCount,
    })),
    [
      { name: "business-architecture-review", fileCount: 10 },
      { name: "code-pristine-review", fileCount: 13 },
    ],
  )
  for (const report of closure.externalEvidence.reports) {
    assert.match(report.inventorySha256, /^[a-f0-9]{64}$/)
    assert.match(report.findingsSha256, /^[a-f0-9]{64}$/)
  }
  assert.equal(closure.externalEvidence.ephemeralClonePreserved, true)
  assert.equal(closure.externalEvidence.cleanupAuthorized, false)
})

test("both source successors are exact tree-identical protected merges", () => {
  assert.deepEqual(
    closure.remediations.map(({ package: name, pullRequest }) => ({
      name,
      pullRequest,
    })),
    [
      { name: "business-authority-reconciliation", pullRequest: 152 },
      { name: "cleanliness-contract-ownership", pullRequest: 153 },
    ],
  )
  let parent = "ed46e293fee2190df96e7c45abcbdde59bc5e453"
  for (const remediation of closure.remediations) {
    assert.equal(
      git("rev-parse", `${remediation.candidateCommit}^{tree}`),
      remediation.candidateTree,
    )
    assert.equal(
      git("rev-parse", `${remediation.protectedMerge}^{tree}`),
      remediation.candidateTree,
    )
    assert.equal(git("rev-parse", `${remediation.protectedMerge}^1`), parent)
    assert.equal(
      git("rev-parse", `${remediation.protectedMerge}^2`),
      remediation.candidateCommit,
    )
    assert.equal(remediation.reviewVerdict, "PASS_NO_MATERIAL_FINDINGS")
    assert.match(remediation.reviewer, /^[A-Z][A-Za-z]+$/)
    assert.ok(remediation.validationEvidence.length >= 10)
    for (const [name, digest] of remediation.validationEvidence) {
      assert.match(name, /^[a-z][a-z-]+$/)
      assert.match(digest, /^[a-f0-9]{64}$/)
    }
    parent = remediation.protectedMerge
  }
})

test("all business and cleanliness findings have one honest disposition", () => {
  const business = [
    "PG-001",
    "PG-002",
    "PG-003",
    "PG-004",
    "PG-005",
    "PG-006",
    "AD-001",
    "AD-002",
    "AD-003",
    "AD-004",
    "UX-001",
    "UX-002",
    "UX-003",
    "UX-004",
    "OS-001",
    "OS-002",
    "HY-001",
    "HY-002",
    "HY-003",
  ]
  const cleanliness = Array.from(
    { length: 18 },
    (_, index) => `CL-${String(index + 1).padStart(3, "0")}`,
  )
  const ids = closure.findingDispositions.map(({ id }) => id)
  assert.deepEqual(ids, [...business, ...cleanliness])
  assert.equal(new Set(ids).size, ids.length)

  const fixed = closure.findingDispositions
    .filter(({ status }) => status === "FIXED")
    .map(({ id }) => id)
  assert.deepEqual(fixed, [
    "PG-001",
    "PG-002",
    "AD-001",
    "AD-003",
    "CL-004",
    "CL-008",
    "CL-012",
  ])
  const partial = new Map(
    closure.findingDispositions
      .filter(({ status }) => status === "PARTIALLY_FIXED")
      .map((finding) => [finding.id, finding.remaining]),
  )
  assert.deepEqual(
    partial,
    new Map([
      [
        "UX-001",
        "Disambiguate Product Keys, credential identifiers, audit verification keys, and LiteLLM virtual keys without changing their separate authorities",
      ],
      ["CL-017", "updateActionEnabled awaits PG-004"],
    ]),
  )
  assert.ok(
    closure.findingDispositions
      .filter(({ status }) => status !== "FIXED")
      .every(({ owner }) => typeof owner === "string" && owner.length > 0),
  )
})

test("closure preserves the protected tip and inactive Product boundary", () => {
  assert.deepEqual(closure.protectedSuccessorTip, {
    commit: "cf3066e24dd0fa8dae35c53ff53f98be8f536b76",
    tree: "dd66ef499533d5eb880f28f871142efa4d45f71e",
  })
  assert.equal(
    git("rev-parse", `${closure.protectedSuccessorTip.commit}^{tree}`),
    closure.protectedSuccessorTip.tree,
  )
  assert.deepEqual(closure.status, {
    productAccepted: false,
    runtimeQualified: false,
    contractActivation: "INACTIVE",
    genesisPublished: false,
  })
})
