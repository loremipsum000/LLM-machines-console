import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")

test("PR-12 release evidence package remains source-only and fail-closed", () => {
  const plan = JSON.parse(
    readFileSync(resolve(root, "infra/release/release-plan.json"), "utf8"),
  )
  const policy = JSON.parse(
    readFileSync(
      resolve(root, "infra/release/license-disposition.json"),
      "utf8",
    ),
  )
  assert.equal(plan.qualification.q0, "NOT_STARTED")
  assert.equal(plan.qualification.contractActivation, "INACTIVE")
  assert.equal(plan.qualification.grafanaCustomerAccess, "DEFERRED_V1")
  assert.equal(plan.qualification.nativeLiteLlmAccess, "ABSENT")
  assert.equal(plan.qualification.nativeKeycloakAdminAccess, "ABSENT")
  assert.equal(policy.containsCredentials, false)
  for (const path of [
    "infra/release/generate-release-evidence.mjs",
    "infra/release/generate-clean-seeds.mjs",
  ]) {
    const source = readFileSync(resolve(root, path), "utf8")
    assert.doesNotMatch(
      source,
      /(?:docker\s+(?:run|push)|kubectl|ssh\s|harbor|keycloak-config-cli)/i,
    )
    assert.doesNotMatch(
      source,
      /(?:PRIVATE KEY|BEGIN OPENSSH|ghp_|github_pat_)/,
    )
  }
})
