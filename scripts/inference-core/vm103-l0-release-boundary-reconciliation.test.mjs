import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const evidence = readJson(
  "docs/reduction/inference-core/vm103-l0-release-boundary-reconciliation.json",
)

test("VM103-L0 binds the exact protected source-only input", () => {
  assert.equal(evidence.workPackage, "VM103-L0")
  assert.equal(evidence.status, "SOURCE_RECONCILIATION_CANDIDATE")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.genesisPublished, false)
  assert.equal(
    git("rev-parse", `${evidence.protectedInput.commit}^{tree}`),
    evidence.protectedInput.tree,
  )
})

test("VM103-L0 reconciles the retained native boundary without activation", () => {
  const plan = readJson("infra/release/release-plan.json")
  const inventory = readJson("infra/release/core-image-inventory.json")
  const deployment = readJson("infra/deployment/vm103-deployment-contract.json")
  const components = new Map(
    inventory.components.map((component) => [component.id, component]),
  )

  assert.deepEqual(
    plan.qualification,
    evidence.currentBoundary.releaseQualification,
  )
  assert.equal(
    components.get("grafana-private").customerExposure,
    "product-edge-admin-only-native-sso",
  )
  assert.equal(
    components.get("litellm").customerExposure,
    "product-edge-native-sso-and-console-projection",
  )
  assert.equal(
    components.get("keycloak").customerExposure,
    "product-edge-identity-and-scoped-admin-sso",
  )
  assert.deepEqual(inventory.excluded, ["portainer"])
  assert.equal(
    deployment.releaseBinding.sourceInventory.sha256,
    `sha256:${sha256(
      readFileSync(resolve(root, "infra/release/core-image-inventory.json")),
    )}`,
  )
  assert.equal(
    inventory.components.some(({ id }) => /portainer/i.test(id)),
    false,
  )
  assert.equal(evidence.releaseMetadataCorrection.productBehaviorChanged, false)
  assert.equal(evidence.releaseMetadataCorrection.nativeIngressActivated, false)
  assert.equal(evidence.futureReleaseBoundary.deploymentAllowed, false)
})

test("VM103-L0 preserves immutable historical evidence byte-for-byte", () => {
  for (const historical of evidence.historicalEvidencePreserved) {
    const current = readFileSync(resolve(root, historical.path))
    const atInput = execFileSync(
      "git",
      ["show", `${evidence.protectedInput.commit}:${historical.path}`],
      { cwd: root },
    )
    assert.deepEqual(current, atInput, historical.path)
    assert.equal(sha256(current), historical.sha256, historical.path)
  }
})

test("VM103-L0 rejects the retired PR-12 native-access boundary", () => {
  const serialized = JSON.stringify(readJson("infra/release/release-plan.json"))
  assert.doesNotMatch(serialized, /DEFERRED_V1/)
  assert.doesNotMatch(serialized, /"nativeLiteLlmAccess":"ABSENT"/)
  assert.doesNotMatch(serialized, /"nativeKeycloakAdminAccess":"ABSENT"/)
})

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"))
}

function git(...arguments_) {
  return execFileSync("git", arguments_, { cwd: root, encoding: "utf8" }).trim()
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
