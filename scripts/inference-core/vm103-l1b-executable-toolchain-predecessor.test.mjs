import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const evidence = readJson(
  "docs/reduction/inference-core/vm103-l1b-executable-toolchain-predecessor.json",
)
const historicalCandidate = "9e388007f81f485968bce4783a335b9355d745d6"

test("L1B predecessor preserves inactive source-only governance", () => {
  assert.equal(evidence.workPackage, "VM103-L1B-P0")
  assert.equal(evidence.status, "SOURCE_PREDECESSOR_CANDIDATE")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.genesisPublished, false)
})

test("L1B predecessor records every fail-closed host and media gate", () => {
  assert.equal(evidence.proxmoxPreflight.vmid118, "UNUSED")
  assert.ok(evidence.proxmoxPreflight.zfsAvailableGiB >= 260)
  assert.ok(evidence.proxmoxPreflight.hostMemoryAvailableGiB >= 40)
  assert.equal(evidence.debianMedia.signatureResult, "GOODSIG_VALID")
  assert.equal(
    evidence.debianMedia.signerFingerprint,
    "DF9B9C49EAA9298432589D76DA87E80D6294BE9B",
  )
})

test("L1B predecessor preserves exact candidate-era source bytes", () => {
  const expectedPaths = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", historicalCandidate, "infra/release/l1b"],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(
      (path) => /\.(?:json|mjs|sh)$/.test(path) && !path.endsWith(".test.mjs"),
    )
    .sort()
  assert.deepEqual(
    evidence.sourcePackage.files.map(({ path }) => path).sort(),
    expectedPaths,
  )
  for (const entry of evidence.sourcePackage.files) {
    const historical = execFileSync(
      "git",
      ["show", `${historicalCandidate}:${entry.path}`],
      { cwd: root },
    )
    assert.equal(sha256(historical), entry.sha256)
  }
})

test("L1B predecessor creates no VM, image, lock, secret, or runtime output", () => {
  assert.deepEqual(evidence.outputs, {
    vmProvisioned: false,
    ociArchivesCreated: false,
    coreImageLockCreated: false,
    registryArtifactsCreated: false,
    credentialsCreated: false,
    deploymentChanged: false,
  })
})

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"))
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
