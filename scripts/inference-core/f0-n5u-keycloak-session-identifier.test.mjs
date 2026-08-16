import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"
import { validateIngressPackage } from "../../infra/ingress/validate-ingress.mjs"

const root = resolve(import.meta.dirname, "../..")
const evidencePath =
  "docs/reduction/inference-core/f0-n5u-keycloak-session-identifier.json"
const protectedInput = "fbcc7d81bef80c0346942380a0361fe64c2b69fa"
const implementationCandidate = "7fa96d8332fbb1778dfdcb208593a73901e61c11"

test("F0-N5U binds the protected input and remains inactive", async () => {
  const evidence = await readJson(evidencePath)
  assert.equal(evidence.workPackage, "F0-N5U")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE_PENDING_F0_N7")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.genesisPublished, false)
  assert.equal(evidence.protectedInput.commit, protectedInput)
  assert.equal(evidence.implementationCandidate.commit, implementationCandidate)
  assert.equal(git("rev-parse", `${implementationCandidate}^`), protectedInput)
  assert.equal(
    git("rev-parse", `${implementationCandidate}^{tree}`),
    evidence.implementationCandidate.tree,
  )
})

test("F0-N5U binds the exact Keycloak 26.7.0 identifier generator", async () => {
  const evidence = await readJson(evidencePath)
  assert.deepEqual(evidence.upstreamSourceProof, {
    version: "26.7.0",
    tagCommit: "6c73e3027811d9c7b22683edd825e839272e9547",
    generator: "SecretGenerator.SECURE_ID_GENERATOR",
    entropyBytes: 18,
    encoding: "BASE64URL_PADDED_ENCODER_WITH_NO_PADDING_FOR_18_BYTE_INPUT",
    length: 24,
    alphabet: "A-Za-z0-9_-",
    sourceSha256: {
      "common/src/main/java/org/keycloak/common/util/SecretGenerator.java":
        "03ff7216edd3bf3f7bd896b8d59155dcfcbdea536352f73483a232e8e0aec892",
      "model/infinispan/src/main/java/org/keycloak/models/sessions/infinispan/InfinispanUserSessionProvider.java":
        "ff82c2db4e18bc50168670147626b0bbb483210f88407def5a2c7338595f50b3",
      "model/infinispan/src/main/java/org/keycloak/models/sessions/infinispan/InfinispanUserSessionProviderFactory.java":
        "ceee33bd59432dc9002b3a5bd201eaecaa5c2cbc37a6584994c3fc0818c88bd7",
    },
  })
  assert.deepEqual(validateIngressPackage(root), [])
})

test("F0-N5U records real invalidation and fail-closed denials", async () => {
  const runtime = (await readJson(evidencePath)).disposableRuntimeObservation
  assert.equal(runtime.results.sessionIdentifierContract, "BASE64URL_24")
  assert.ok(runtime.results.sessionsInvalidated > 0)
  assert.deepEqual(
    runtime.results.malformedIdentifierStatuses,
    [404, 404, 404, 404, 400],
  )
  assert.equal(runtime.results.wrongMethodStatus, 403)
  assert.equal(runtime.results.userDeleteStatus, 403)
  assert.equal(runtime.results.operatorAdminAccess, "DENY")
  assert.equal(runtime.sessionIdentifierValuesRecorded, false)
  assert.equal(runtime.credentialsRecorded, false)
  assert.equal(runtime.cookieValuesRecorded, false)
  assert.equal(runtime.workloadContentRecorded, false)
  assert.equal(runtime.containersRemoved, true)
  assert.equal(runtime.networkRemoved, true)
  assert.equal(runtime.volumeRemoved, true)
  assert.equal(runtime.temporaryFilesRemoved, true)
  assert.equal(runtime.founderEnvironmentPreserved, true)
})

test("F0-N5U preserves historical edge evidence byte-for-byte", async () => {
  const evidence = await readJson(evidencePath)
  for (const [name, path] of Object.entries({
    f0N5: "docs/reduction/inference-core/f0-n5-native-edge.json",
    f0N5r: "docs/reduction/inference-core/f0-n5r-keycloak-dual-authority.json",
    f0N5s: "docs/reduction/inference-core/f0-n5s-grafana-oauth-entry.json",
    f0N5t:
      "docs/reduction/inference-core/f0-n5t-keycloak-admin-token-origin.json",
  })) {
    const current = await readText(path)
    assert.equal(
      sha256(current),
      evidence.defect.historicalEvidenceSha256[name],
    )
    assert.equal(current, gitRaw("show", `${protectedInput}:${path}`))
  }
})

test("F0-N5U source fingerprints and path boundary are exact", async () => {
  const evidence = await readJson(evidencePath)
  for (const [path, expected] of Object.entries(evidence.sourceArtifacts)) {
    assert.equal(
      `sha256:${sha256(gitRaw("show", `${implementationCandidate}:${path}`))}`,
      expected,
      path,
    )
  }
  assert.deepEqual(
    git("diff", "--name-only", `${protectedInput}..${implementationCandidate}`)
      .split("\n")
      .filter(Boolean)
      .sort(),
    evidence.implementationChangedPaths,
  )
  const text = await readText(evidencePath)
  assert.doesNotMatch(
    text,
    /(?:PRIVATE KEY|BEGIN OPENSSH|Bearer\s+|eyJ[A-Za-z0-9_-]{20}|llmm_(?:t4|fc)_[A-Za-z0-9_-]{20})/i,
  )
  assert.doesNotMatch(text, /10\.(?:0|33)\./)
})

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

function gitRaw(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" })
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
