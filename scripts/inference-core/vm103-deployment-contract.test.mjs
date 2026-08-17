import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import {
  validateCheckedInVm103DeploymentContract,
  validateVm103DeploymentContract,
} from "../../infra/deployment/validate-vm103-deployment-contract.mjs"

const root = resolve(import.meta.dirname, "../..")
const contract = JSON.parse(
  readFileSync(
    resolve(root, "infra/deployment/vm103-deployment-contract.json"),
    "utf8",
  ),
)

function changed(mutate) {
  const value = structuredClone(contract)
  mutate(value)
  return validateVm103DeploymentContract(value, root).join("\n")
}

test("checked-in VM103 deployment contract is exact and source-only", () => {
  assert.deepEqual(validateCheckedInVm103DeploymentContract(root), [])
})

test("release identities and unresolved build outputs fail closed", () => {
  assert.match(
    changed((value) => {
      value.releaseBinding.sourceInventory.sha256 = `sha256:${"0".repeat(64)}`
    }),
    /fingerprint/,
  )
  assert.match(
    changed((value) => {
      value.releaseBinding.releaseLockRequiredComponents.pop()
    }),
    /release-lock-required/,
  )
  assert.match(
    changed((value) => {
      value.releaseBinding.deploymentAllowedBeforeEveryDigestIsVerified = true
    }),
    /deploymentAllowedBeforeEveryDigestIsVerified/,
  )
})

test("native publication, retired surfaces, and gateway bypass fail closed", () => {
  assert.match(
    changed((value) => {
      value.services.find(({ id }) => id === "litellm").published = true
    }),
    /native publication/,
  )
  assert.match(
    changed((value) => {
      value.retiredSurfaces.deferredAdministration = "ADMITTED"
    }),
    /deferred administration/,
  )
  assert.match(
    changed((value) => {
      value.gateway.consoleSessionForwarded = true
    }),
    /gateway security/,
  )
})

test("collision, backup, and rollback preconditions fail closed", () => {
  assert.match(
    changed((value) => {
      value.placement.collisionPolicy.overlappingCidrAllowed = true
    }),
    /collision policy/,
  )
  assert.match(
    changed((value) => {
      value.persistence.backup.localSnapshotsCountAsBackup = true
    }),
    /backup boundary/,
  )
  assert.match(
    changed((value) => {
      value.lifecycle.mutationPreconditions =
        value.lifecycle.mutationPreconditions.filter(
          (item) => item !== "ISOLATED_CLEAN_RESTORE_PASSED",
        )
    }),
    /ISOLATED_CLEAN_RESTORE_PASSED/,
  )
})

test("gateway security and inference preparation remain separate gates", () => {
  assert.match(
    changed((value) => {
      value.separateGates.gatewaySecurity.bundledWithDeployment = true
    }),
    /separate not-started change/,
  )
  assert.match(
    changed((value) => {
      value.separateGates.inferencePreparation.productionCapacityClaimAllowed = true
    }),
    /inference preparation/,
  )
  assert.match(
    changed((value) => {
      value.separateGates.inferencePreparation.existingImagesOrModelsMayBeDeleted = true
    }),
    /inference preparation/,
  )
})
