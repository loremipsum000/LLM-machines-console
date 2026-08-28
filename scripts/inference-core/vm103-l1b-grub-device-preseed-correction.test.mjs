import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const evidence = JSON.parse(
  readFileSync(
    resolve(
      root,
      "docs/reduction/inference-core/vm103-l1b-grub-device-preseed-correction.json",
    ),
    "utf8",
  ),
)

test("L1B GRUB successor preserves the stopped fail-closed boundary", () => {
  assert.equal(evidence.workPackage, "VM103-L1B-P6")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.runtimeObservation.manualSelectionMade, false)
  assert.equal(
    evidence.runtimeObservation.vmStateAfterObservation,
    "STOPPED_PARTIAL_INSTALL_PRESERVED",
  )
})

test("L1B GRUB successor binds partitioning and boot to the only disk", () => {
  assert.equal(evidence.runtimeObservation.partitionDevice, "/dev/sda")
  assert.equal(evidence.runtimeObservation.assemblyVolumesAttached, false)
  assert.equal(
    evidence.correction.directive,
    "d-i grub-installer/bootdev string /dev/sda",
  )
  assert.equal(evidence.correction.partitionAndBootDeviceMatch, true)
  assert.equal(evidence.correction.singleInstallationDiskRequired, true)
})
