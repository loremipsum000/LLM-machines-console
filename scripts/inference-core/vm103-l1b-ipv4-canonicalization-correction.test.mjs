import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const evidence = JSON.parse(
  readFileSync(
    resolve(
      root,
      "docs/reduction/inference-core/vm103-l1b-ipv4-canonicalization-correction.json",
    ),
    "utf8",
  ),
)

test("L1B canonicalization successor binds the observed pre-transaction failure", () => {
  assert.equal(evidence.workPackage, "VM103-L1B-P10")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE")
  assert.equal(evidence.runtimeObservation.stage, "PRE_TRANSACTION")
  assert.equal(evidence.runtimeObservation.firewallChanged, false)
  assert.equal(evidence.runtimeObservation.bootstrapStarted, false)
  assert.equal(evidence.runtimeObservation.assemblyAStarted, false)
})

test("resolver and both validators share one numeric IPv4 rule", () => {
  assert.equal(evidence.correction.canonicalRule, "IPV4_NUMERIC_ASCENDING")
  assert.equal(evidence.correction.resolverEnforcesRule, true)
  assert.equal(evidence.correction.javascriptValidatorEnforcesRule, true)
  assert.equal(evidence.correction.pythonBindingValidatorEnforcesRule, true)
  assert.equal(evidence.correction.lexicalOrderRejected, true)
  assert.equal(evidence.correction.egressPolicyBroadened, false)
  assert.equal(evidence.boundaries.productRuntimeChanged, false)
})

test("L1B canonicalization successor binds exact validation and review", () => {
  assert.deepEqual(evidence.implementationCandidate, {
    commit: "01891588baaf99e1cfb85bc7a2276674daa4777c",
    tree: "1635614814b30a70f71996c3db1ab246a9c14964",
  })
  assert.equal(evidence.validation.local.result, "PASS")
  assert.equal(evidence.validation.local.focusedTests, 24)
  assert.equal(evidence.validation.local.rootGuardrailTests, 659)
  assert.equal(evidence.validation.local.releaseTests, 206)
  assert.equal(evidence.validation.detachedClone.result, "PASS")
  assert.equal(
    evidence.validation.detachedClone.commit,
    evidence.implementationCandidate.commit,
  )
  assert.equal(
    evidence.validation.detachedClone.tree,
    evidence.implementationCandidate.tree,
  )
  assert.equal(evidence.validation.securityScan.result, "PASS")
  assert.equal(evidence.validation.securityScan.secretFindings, 0)
  assert.equal(evidence.validation.securityScan.internalAddressFindings, 0)
  assert.equal(evidence.validation.securityScan.mutableImageFindings, 0)
  assert.equal(evidence.validation.materialReview.verdict, "PASS")
  assert.equal(
    evidence.validation.materialReview.reviewedCommit,
    evidence.implementationCandidate.commit,
  )
  assert.equal(
    evidence.validation.materialReview.reviewedTree,
    evidence.implementationCandidate.tree,
  )
  assert.deepEqual(evidence.validation.materialReview.materialFindings, [])
})
