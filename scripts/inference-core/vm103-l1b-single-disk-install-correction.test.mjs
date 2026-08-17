import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const evidence = JSON.parse(
  readFileSync(
    resolve(
      root,
      "docs/reduction/inference-core/vm103-l1b-single-disk-install-correction.json",
    ),
    "utf8",
  ),
)

test("L1B single-disk successor records the exact fail-closed observation", () => {
  assert.equal(evidence.workPackage, "VM103-L1B-P4")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(
    evidence.runtimeObservation.vmStateAfterObservation,
    "STOPPED_FAIL_CLOSED",
  )
  assert.equal(evidence.runtimeObservation.capacityOrMemoryFailure, false)
  assert.ok(
    evidence.runtimeObservation.assemblyAUsedBytesAfter >
      evidence.runtimeObservation.assemblyAUsedBytesBefore,
  )
})

test("L1B single-disk successor preserves assembly evidence before reset", () => {
  assert.equal(
    evidence.correction.installationPhase,
    "SINGLE_ATTACHED_SYSTEM_DISK",
  )
  assert.equal(evidence.correction.assemblyVolumesDetachedAndPreserved, true)
  assert.equal(evidence.correction.assemblyEvidenceSnapshottedBeforeReset, true)
  assert.equal(evidence.correction.dynamicGuestDiskEnumerationTrusted, false)
  assert.equal(evidence.boundaries.manualInstallerSelectionProhibited, true)
})
