import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const evidence = JSON.parse(
  readFileSync(
    resolve(
      root,
      "docs/reduction/inference-core/vm103-l1b-bootstrap-service-start-containment.json",
    ),
    "utf8",
  ),
)

test("P11 records the failed runtime observation without overstating acceptance", () => {
  assert.equal(evidence.workPackage, "VM103-L1B-P11")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.runtimeObservation.assemblyAStarted, false)
  assert.equal(evidence.runtimeObservation.assemblyBStarted, false)
  assert.equal(evidence.boundaries.runtimeRetryStarted, false)
  assert.equal(evidence.boundaries.failedAttemptEvidencePreserved, true)
})

test("P11 applies one fail-closed rule to every package-triggered runtime unit", () => {
  assert.deepEqual(evidence.correction.canonicalRuntimeUnits, [
    "docker.service",
    "docker.socket",
    "containerd.service",
  ])
  assert.deepEqual(evidence.correction.sameCanonicalRule, {
    disableAndStop: true,
    inactiveRequired: true,
    disabledRequired: true,
  })
  assert.equal(evidence.correction.rootInspectionFailureDenied, true)
  assert.equal(
    evidence.correction.assemblyFormattingAfterAllContainmentChecks,
    true,
  )
})

test("P11 binds exact implementation validation and independent review", () => {
  assert.equal(
    evidence.correction.implementationCommit,
    "a26439357a4d2f75da0c5687f21d3183dbc5e5e0",
  )
  assert.equal(
    evidence.correction.implementationTree,
    "496edb9d7bceb75155128eb2cfac869daf9f0484",
  )
  assert.equal(evidence.validation.testCounts.focused, 69)
  assert.equal(evidence.validation.testCounts.guardrails, 660)
  assert.equal(evidence.validation.testCounts.release, 210)
  assert.deepEqual(evidence.validation.securityScan, {
    secretFindings: 0,
    internalAddressFindings: 0,
    mutableImageFindings: 0,
    unsafeConfigurationFindings: 0,
  })
  assert.equal(evidence.validation.materialReview.verdict, "PASS")
  assert.equal(evidence.validation.materialReview.materialFindings, 0)
})

test("P11 does not broaden Product or release authority", () => {
  assert.equal(evidence.boundaries.productBehaviorChanged, false)
  assert.equal(evidence.boundaries.egressPolicyChanged, false)
  assert.equal(evidence.boundaries.credentialsCreated, false)
  assert.equal(evidence.boundaries.registryMutation, false)
  assert.equal(evidence.boundaries.signing, false)
  assert.equal(evidence.boundaries.deployment, false)
})
