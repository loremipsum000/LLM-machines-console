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

test("L1B network successor binds exact validation and independent review", () => {
  assert.deepEqual(evidence.implementationCandidate, {
    commit: "aa1a2492ab1a1dee1fae35837b62a4fd173a0191",
    tree: "830525bb52b9c4761165967aacd7e0f292f30082",
  })
  assert.equal(evidence.validation.local.result, "PASS")
  assert.equal(evidence.validation.local.focusedTests, 38)
  assert.equal(evidence.validation.local.rootGuardrailTests, 656)
  assert.equal(evidence.validation.local.releaseTests, 205)
  assert.equal(evidence.validation.detachedClone.result, "PASS")
  assert.deepEqual(
    evidence.validation.detachedClone.commit,
    evidence.implementationCandidate.commit,
  )
  assert.deepEqual(
    evidence.validation.detachedClone.tree,
    evidence.implementationCandidate.tree,
  )
  assert.equal(evidence.validation.securityScan.result, "PASS")
  assert.equal(evidence.validation.securityScan.secretFindings, 0)
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
