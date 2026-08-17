import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const evidence = JSON.parse(
  readFileSync(
    resolve(
      root,
      "docs/reduction/inference-core/vm103-l1b-ssh-key-custody-correction.json",
    ),
    "utf8",
  ),
)

test("L1B SSH-key successor preserves the stopped fail-closed boundary", () => {
  assert.equal(evidence.workPackage, "VM103-L1B-P8")
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

test("L1B SSH-key successor preserves key-only access without shared credentials", () => {
  assert.equal(evidence.correction.sameFileUsesPermissionNormalization, true)
  assert.equal(evidence.correction.differentFileUsesVerifiedInstall, true)
  assert.equal(evidence.correction.keyOnlyAccessPreserved, true)
  assert.equal(evidence.correction.passwordAuthenticationEnabled, false)
  assert.equal(evidence.correction.sharedCredentialIntroduced, false)
  assert.equal(evidence.boundaries.productRuntimeChanged, false)
})
