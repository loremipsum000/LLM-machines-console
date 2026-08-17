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
  const evidencePolicy = JSON.parse(
    readFileSync(
      resolve(root, "infra/release/release-evidence-policy.json"),
      "utf8",
    ),
  )
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
  assert.equal(policy.containsCredentials, false)
  assert.equal(
    plan.evidencePolicy,
    "infra/release/release-evidence-policy.json",
  )
  assert.equal(evidencePolicy.runtimeQualified, false)
  assert.equal(evidencePolicy.vulnerability.allCoreImagesRequired, true)
  assert.deepEqual(evidencePolicy.vulnerability.severityThresholds, {
    critical: 0,
    high: 0,
  })
  assert.deepEqual(evidencePolicy.provenance.approvedBuildActorIds, [
    "https://llm-machines.invalid/build-actors/offline-release/v1",
  ])
  assert.ok(plan.requiredEvidence.includes("image-vulnerability-evidence"))
  assert.ok(plan.requiredEvidence.includes("license-reviews"))
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
