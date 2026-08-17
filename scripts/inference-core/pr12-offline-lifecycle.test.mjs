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
  assert.equal(
    plan.qualification.nativeAccessSourceProfile,
    "ADMITTED_INACTIVE_PENDING_VM103_DEPLOYMENT",
  )
  assert.equal(
    plan.qualification.grafanaCustomerAccess,
    "ADMIN_EDITOR_ONLY_NO_SERVER_ADMIN",
  )
  assert.equal(
    plan.qualification.nativeLiteLlmAccess,
    "ADMIN_PROXY_ADMIN_OPERATOR_INTERNAL_USER_OWN_KEYS_AND_SPEND_ONLY",
  )
  assert.equal(
    plan.qualification.nativeKeycloakAdminAccess,
    "ADMIN_APPLIANCE_REALM_SCOPED_USER_DELETE_EDGE_DENIED",
  )
  assert.equal(plan.qualification.portainerAccess, "DEFERRED_UPSTREAM_SECURITY")
  assert.match(installer, /INSTALLED_UNQUALIFIED/)
  assert.match(rollback, /PREPARE_ONLY/)
  assert.match(rollback, /INITIAL_INSTALL_NO_PREDECESSOR/)
  assert.match(rollback, /NO_RELEASE_ROLLBACK/)
  assert.match(rollback, /Q0_PREINSTALL_BACKUP_AND_CLEAN_RESTORE/)
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
