import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const evidence = JSON.parse(
  readFileSync(
    resolve(
      root,
      "docs/reduction/inference-core/vm103-l1b-egress-resolver-binding-correction.json",
    ),
    "utf8",
  ),
)

test("L1B resolver successor preserves the stopped fail-closed boundary", () => {
  assert.equal(evidence.workPackage, "VM103-L1B-P5")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(
    evidence.runtimeObservation.vmStateAfterObservation,
    "STOPPED_PARTIAL_INSTALL_PRESERVED",
  )
  assert.equal(evidence.correction.liveFirewallExceptionAdded, false)
})

test("L1B resolver successor binds the observation to the policy resolver", () => {
  assert.equal(evidence.runtimeObservation.policyResolver, "10.33.74.1")
  assert.equal(evidence.correction.executionHost, "PROXMOX_PROVISIONING_HOST")
  assert.equal(evidence.correction.resolverTool, "/usr/bin/dig")
  assert.equal(evidence.correction.resolverBoundToSourcePolicy, true)
  assert.equal(evidence.correction.resolverIdentityRecorded, true)
  assert.equal(evidence.correction.differentResolverRejected, true)
})
