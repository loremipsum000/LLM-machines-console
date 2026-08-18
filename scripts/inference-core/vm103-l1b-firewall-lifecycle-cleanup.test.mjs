import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const contract = JSON.parse(
  readFileSync(
    resolve(
      root,
      "docs/reduction/inference-core/vm103-l1b-firewall-lifecycle-cleanup.json",
    ),
    "utf8",
  ),
)
const lifecycle = readFileSync(
  resolve(root, "infra/release/l1b/docker-lifecycle.sh"),
  "utf8",
)
const firewall = readFileSync(
  resolve(root, "infra/release/l1b/firewall-lifecycle.mjs"),
  "utf8",
)

test("P13 preserves P12 as a failed pre-image-construction observation", () => {
  assert.equal(contract.workPackage, "VM103-L1B-P13")
  assert.equal(contract.accepted, false)
  assert.equal(contract.runtimeQualified, false)
  assert.equal(contract.contractActivation, "INACTIVE")
  assert.equal(
    contract.preservedP12Observation.nativeLifecycleGatePassed,
    false,
  )
  assert.equal(contract.preservedP12Observation.producedImageCount, 0)
  assert.equal(contract.preservedP12Observation.assemblyAStarted, false)
  assert.equal(contract.preservedP12Observation.assemblyBStarted, false)
})

test("P13 permits only exact-delta cleanup and canonical equivalence", () => {
  assert.equal(contract.correction.broadFirewallFlushDenied, true)
  assert.equal(contract.correction.iptablesRestoreDenied, true)
  assert.equal(contract.correction.unrelatedRuleMutationDenied, true)
  assert.equal(contract.correction.unrelatedPolicyMutationDenied, true)
  assert.match(firewall, /action === "cleanup"/)
  assert.match(firewall, /delete-rule-index/)
  assert.match(firewall, /delete-nft-table/)
  assert.doesNotMatch(firewall, /iptables-restore/)
  assert.doesNotMatch(firewall, /flush ruleset/)
  assert.match(lifecycle, /verify-equivalent/)
})

test("P13 binds the complete requested lifecycle test and redesign boundary", () => {
  assert.deepEqual(contract.requiredTests, [
    "SUCCESSFUL_STARTUP_AND_READINESS",
    "NORMAL_SHUTDOWN",
    "FAILURE_BEFORE_DNSMASQ",
    "FAILURE_AFTER_DNSMASQ",
    "DOCKER_READINESS_FAILURE",
    "FORCED_DOCKER_TERMINATION",
    "SIGNAL_AND_INTERRUPTION",
    "REPEATED_INVOCATION",
    "SEQUENTIAL_A_B_ISOLATION",
    "UNRELATED_FIREWALL_STATE_PRESERVATION",
    "SIMULTANEOUS_BRIDGE_AND_BIP_REJECTION",
    "NATIVE_DOCKER_29_5_3_STARTUP_AND_CLEANUP",
  ])
  assert.match(
    contract.redesignStop,
    /SEPARATELY_RESTORED_VM_STATE_PER_ASSEMBLY/,
  )
  assert.equal(contract.boundaries.l1bSuccessful, false)
})
