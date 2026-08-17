import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const evidence = JSON.parse(
  readFileSync(
    resolve(
      root,
      "docs/reduction/inference-core/vm103-l1b-bootstrap-fetch-correction.json",
    ),
    "utf8",
  ),
)

test("L1B bootstrap successor preserves the stopped fail-closed boundary", () => {
  assert.equal(evidence.workPackage, "VM103-L1B-P7")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.runtimeObservation.assemblyVolumesFormatted, false)
  assert.equal(
    evidence.runtimeObservation.vmStateAfterObservation,
    "STOPPED_PARTIAL_BOOTSTRAP_PRESERVED",
  )
})

test("L1B bootstrap successor does not broaden egress or Product behavior", () => {
  assert.equal(evidence.correction.allLockedHostAndDockerInputsEnumerated, true)
  assert.equal(evidence.correction.jqFailurePropagatesBeforeInstallation, true)
  assert.equal(evidence.correction.debianSecuritySourceUsesHttps, true)
  assert.equal(evidence.correction.ipv4TransportBound, true)
  assert.equal(evidence.correction.repositoryUpdateWarningsFailClosed, true)
  assert.equal(evidence.correction.egressPolicyBroadened, false)
  assert.equal(evidence.boundaries.productRuntimeChanged, false)
})
