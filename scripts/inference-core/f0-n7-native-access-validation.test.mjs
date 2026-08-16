import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const evidencePath =
  "docs/reduction/inference-core/f0-n7-native-access-validation.json"

test("F0-N7 binds the exact protected input and passing runtime candidate", async () => {
  const evidence = await readJson(evidencePath)

  assert.equal(evidence.workPackage, "F0-N7")
  assert.equal(evidence.status, "LOCAL_AGGREGATE_NATIVE_ACCESS_PROVEN")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(
    evidence.contractActivation,
    "INACTIVE_PENDING_F0_N8_AND_DEPLOYMENT",
  )
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.genesisPublished, false)
  assert.equal(
    git("rev-parse", `${evidence.protectedInput.commit}^{tree}`),
    evidence.protectedInput.tree,
  )
  assert.equal(
    git("rev-parse", `${evidence.runtimeCandidate.commit}^{tree}`),
    evidence.runtimeCandidate.tree,
  )
  assert.equal(
    git(
      "merge-base",
      evidence.protectedInput.commit,
      evidence.runtimeCandidate.commit,
    ),
    evidence.protectedInput.commit,
  )
})

test("F0-N7 proves the admitted native role and authority boundaries", async () => {
  const evidence = await readJson(evidencePath)
  const runtime = evidence.runtimeEvidence

  assert.equal(runtime.grafana.admin, "EDITOR")
  assert.equal(runtime.grafana.operator, "DENY")
  assert.equal(runtime.grafana.serverAdministrator, false)
  assert.equal(runtime.litellm.admin, "PROXY_ADMIN")
  assert.equal(
    runtime.litellm.operator,
    "INTERNAL_USER_OWN_KEYS_AND_SPEND_ONLY",
  )
  assert.equal(runtime.litellm.globalAndCrossUserMutation, "DENY")
  assert.equal(runtime.keycloak.admin, "APPLIANCE_REALM_USER_ADMIN")
  assert.equal(runtime.keycloak.operator, "DENY")
  assert.equal(runtime.keycloak.userDeleteAtEdge, 403)
  assert.equal(runtime.keycloak.masterAndUnrelatedRealm, "DENY")
  assert.equal(runtime.portainer, "ABSENT_DEFERRED_UPSTREAM_SECURITY")
  assert.equal(runtime.retiredProductSurfaces, "ABSENT")
})

test("F0-N7 binds exact LiteLLM cookie observations without broadening queries", async () => {
  const evidence = await readJson(evidencePath)
  const liteLlm = evidence.runtimeEvidence.litellm
  const harness = gitBlob(
    `${evidence.runtimeCandidate.commit}:scripts/pre-genesis/f0-n7-native-runtime.mjs`,
  )

  assert.deepEqual(liteLlm.emittedCookieNames, [
    "litellm_oauth_state",
    "sso_state",
    "token",
  ])
  assert.equal(
    liteLlm.emittedCookiePolicy.litellm_oauth_state,
    "SECURE_HTTPONLY_SAMESITE_LAX",
  )
  assert.equal(
    liteLlm.emittedCookiePolicy.sso_state,
    "SECURE_HTTPONLY_SAMESITE_LAX",
  )
  assert.equal(
    liteLlm.emittedCookiePolicy.token,
    "SECURE_JAVASCRIPT_READABLE_SAMESITE_LAX",
  )
  assert.equal(
    liteLlm.conditionalReturnToCookie.edgePolicy,
    "SECURE_HTTPONLY_SAMESITE_LAX",
  )
  assert.equal(
    liteLlm.conditionalReturnToCookie.approvedFlowObservation,
    "NOT_EMITTED",
  )
  assert.equal(evidence.failedClosedAttempt.policyBroadened, false)
  assert.match(harness, /POLICY_BOUND_NOT_EMITTED_BY_APPROVED_QUERY_FREE_ENTRY/)
  assert.match(harness, /Unexpected LiteLLM native cookie/)
})

test("F0-N7 proves no-bypass, retention, and complete owned cleanup", async () => {
  const evidence = await readJson(evidencePath)
  const runtime = evidence.runtimeEvidence

  assert.equal(runtime.noBypass.alternateHostAndSni, "DENY")
  assert.equal(runtime.noBypass.directPorts, "LOOPBACK_ONLY")
  assert.equal(runtime.noBypass.consoleCookies, "DENY")
  assert.equal(runtime.noBypass.productCredentials, "DENY")
  assert.equal(runtime.noBypass.traversalAndUnsafeRoutes, "DENY")
  assert.equal(runtime.retention.credentialValues, 0)
  assert.equal(runtime.retention.workloadContentCanaries, 0)
  assert.equal(evidence.cleanup.runOwnedContainersRemaining, 0)
  assert.equal(evidence.cleanup.runOwnedNetworksRemaining, 0)
  assert.equal(evidence.cleanup.runOwnedVolumesRemaining, 0)
  assert.equal(evidence.cleanup.runOwnedTemporaryDirectoriesRemaining, 0)
  assert.equal(evidence.cleanup.founderContainersPreserved, 10)
  assert.equal(evidence.runtimeEvidence.credentialsRecorded, false)
  assert.equal(evidence.runtimeEvidence.cookieValuesRecorded, false)
  assert.equal(evidence.runtimeEvidence.workloadContentRecorded, false)
  assert.match(evidence.runtimeEvidence.rawEvidenceSha256, /^[0-9a-f]{64}$/)
})

test("F0-N7 source fingerprints and historical evidence remain exact", async () => {
  const evidence = await readJson(evidencePath)

  for (const [path, expected] of Object.entries(evidence.sourceArtifacts))
    assert.equal(
      `sha256:${sha256(gitBlob(`${evidence.runtimeCandidate.commit}:${path}`))}`,
      expected,
      path,
    )
  for (const path of [
    "docs/reduction/inference-core/f0-n1-litellm-oss-downstream.json",
    "docs/reduction/inference-core/f0-n5-native-edge.json",
    "docs/reduction/inference-core/f0-n5v-litellm-cookie-security.json",
    "docs/reduction/inference-core/f0-n6-console-technical-tools.json",
  ])
    assert.equal(
      gitBlob(`${evidence.protectedInput.commit}:${path}`),
      gitBlob(`${evidence.runtimeCandidate.commit}:${path}`),
      path,
    )
})

test("F0-N7 evidence and current registers contain no credential material", async () => {
  const [evidence, decisions, validations] = await Promise.all([
    readText(evidencePath),
    readText("docs/reduction/inference-core/decision-register.md"),
    readText("docs/reduction/inference-core/validation-register.md"),
  ])

  assert.match(decisions, /\| F0-N7 \|/)
  assert.match(validations, /\| F0-N7 \|/)
  assert.doesNotMatch(
    evidence,
    /(?:PRIVATE KEY|BEGIN OPENSSH|Bearer\s+|eyJ[A-Za-z0-9_-]{20}|sk-[A-Za-z0-9_-]{16}|llmm_(?:t4|fc)_[A-Za-z0-9_-]{20})/i,
  )
  assert.equal(
    (await readJson(evidencePath)).sourceBoundary.productMainChanged,
    false,
  )
})

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

function gitBlob(specification) {
  return execFileSync("git", ["show", specification], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  })
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

async function readJson(path) {
  return JSON.parse(await readText(path))
}

async function readText(path) {
  return readFile(resolve(root, path), "utf8")
}
