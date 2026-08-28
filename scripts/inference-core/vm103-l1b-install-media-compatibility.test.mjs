import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import {
  readL1bSource,
  validateL1bSource,
} from "../../infra/release/l1b/validate-source.mjs"

const root = resolve(import.meta.dirname, "../..")
const evidence = JSON.parse(
  readFileSync(
    resolve(
      root,
      "docs/reduction/inference-core/vm103-l1b-install-media-compatibility.json",
    ),
    "utf8",
  ),
)

test("L1B media successor preserves the stopped pre-install boundary", () => {
  assert.equal(evidence.workPackage, "VM103-L1B-P2")
  assert.equal(evidence.status, "SOURCE_PROVISIONING_SUCCESSOR_CANDIDATE")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(
    evidence.runtimeObservation.vmStateAfterObservation,
    "STOPPED_NOT_INSTALLED",
  )
  assert.equal(evidence.runtimeObservation.disksWrittenByInstaller, false)
})

test("L1B installation binds the exact verified read-only media lifecycle", () => {
  const source = readL1bSource()
  assert.deepEqual(validateL1bSource(source), [])
  assert.deepEqual(source.profile.installationMedia.attachment, {
    bus: "ide2",
    mode: "read-only-cdrom",
    requiredDuringInstallation: true,
    removeAfterInstallation: true,
  })
  assert.equal(
    source.profile.installationMedia.sha256,
    evidence.correction.sha256,
  )
})
