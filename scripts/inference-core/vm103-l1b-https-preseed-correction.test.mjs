import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const evidence = JSON.parse(
  readFileSync(
    resolve(
      root,
      "docs/reduction/inference-core/vm103-l1b-https-preseed-correction.json",
    ),
    "utf8",
  ),
)
const renderer = readFileSync(
  resolve(root, "infra/release/l1b/render-preseed.mjs"),
  "utf8",
)

test("L1B HTTPS preseed successor preserves the stopped fail-closed boundary", () => {
  assert.equal(evidence.workPackage, "VM103-L1B-P3")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(
    evidence.runtimeObservation.vmStateAfterObservation,
    "STOPPED_PARTIAL_INSTALL_PRESERVED",
  )
  assert.equal(evidence.boundaries.manualInstallerAnswerProhibited, true)
})

test("L1B preseed answers only the exact HTTPS mirror questions", () => {
  assert.match(renderer, /mirror\/protocol select https/)
  assert.match(renderer, /mirror\/https\/hostname string deb\.debian\.org/)
  assert.match(renderer, /mirror\/https\/directory string \/debian/)
  assert.match(renderer, /mirror\/https\/proxy string/)
  assert.match(renderer, /mirror\/suite select trixie/)
  assert.doesNotMatch(renderer, /mirror\/http\//)
})
