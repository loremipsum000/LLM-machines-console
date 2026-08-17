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
