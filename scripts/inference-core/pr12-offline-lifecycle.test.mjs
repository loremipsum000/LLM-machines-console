import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const root = new URL("../../", import.meta.url)
const read = (path) => readFileSync(new URL(path, root), "utf8")

test("PR-12 offline lifecycle remains source-only and unqualified", () => {
  const plan = JSON.parse(read("infra/release/release-plan.json"))
  const installer = read("infra/release/clean-room-install.mjs")
  const rollback = read("infra/release/generate-rollback-descriptor.mjs")
  const verifier = read("infra/release/verify-release-bundle.mjs")

  assert.equal(plan.qualification.q0, "NOT_STARTED")
  assert.equal(plan.qualification.contractActivation, "INACTIVE")
  assert.equal(plan.qualification.grafanaCustomerAccess, "DEFERRED_V1")
  assert.equal(plan.qualification.nativeLiteLlmAccess, "ABSENT")
  assert.equal(plan.qualification.nativeKeycloakAdminAccess, "ABSENT")
  assert.match(installer, /INSTALLED_UNQUALIFIED/)
  assert.match(rollback, /PREPARE_ONLY/)
  assert.match(verifier, /VERIFIED_PACKAGED_UNQUALIFIED/)
  assert.doesNotMatch(
    `${installer}\n${rollback}\n${verifier}`,
    /createPrivateKey|generateKeyPair|privateKey|docker|podman|kubectl|ssh|systemctl|firewall|keycloak-admin/,
  )
})

test("release archive toolchain is version-pinned and deterministic", () => {
  const plan = JSON.parse(read("infra/release/release-plan.json"))
  assert.equal(plan.archive.zstdVersion, "1.5.7")
  assert.deepEqual(plan.archive.zstdArguments, [
    "-19",
    "--threads=1",
    "--no-progress",
    "--no-check",
  ])
  assert.equal(plan.archive.allowSymlinks, false)
  assert.equal(plan.archive.allowHardlinks, false)
  assert.equal(plan.archive.allowDeviceFiles, false)
})
