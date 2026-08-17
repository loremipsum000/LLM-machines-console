import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const evidence = JSON.parse(
  readFileSync(
    resolve(
      root,
      "docs/reduction/inference-core/vm103-l1b-dns-firewall-binding-correction.json",
    ),
    "utf8",
  ),
)

test("L1B network successor preserves the unqualified fail-closed boundary", () => {
  assert.equal(evidence.workPackage, "VM103-L1B-P9")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.runtimeObservation.assemblyVolumesFormatted, false)
})

test("L1B network successor binds one resolution without broadening egress", () => {
  assert.equal(evidence.correction.firewallAndGuestUseSameResolution, true)
  assert.equal(evidence.correction.filesFirstHostBindingBeforeFetch, true)
  assert.equal(evidence.correction.assemblyResolutionCopiesIndependent, true)
  assert.equal(
    evidence.correction.firewallAndBootstrapTransactionHashBound,
    true,
  )
  assert.equal(evidence.correction.installedFirewallReadbackRequired, true)
  assert.equal(
    evidence.correction.bootstrapRequiresInstalledFirewallReceipt,
    true,
  )
  assert.equal(
    evidence.correction.copiedTransactionRevalidatedBeforeNetwork,
    true,
  )
  assert.equal(
    evidence.correction.secondValidResolutionSubstitutionDenied,
    true,
  )
  assert.equal(evidence.correction.assemblyDnsHasNoForwarder, true)
  assert.equal(evidence.correction.hostNetworkUsedByBuildContainers, false)
  assert.equal(evidence.correction.dnsmasqPackageBytePinned, true)
  assert.equal(evidence.correction.egressPolicyBroadened, false)
  assert.equal(evidence.boundaries.productRuntimeChanged, false)
})
