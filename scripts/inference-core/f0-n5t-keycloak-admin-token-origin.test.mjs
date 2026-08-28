import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"
import { validateIngressPackage } from "../../infra/ingress/validate-ingress.mjs"

const root = resolve(import.meta.dirname, "../..")
const evidencePath =
  "docs/reduction/inference-core/f0-n5t-keycloak-admin-token-origin.json"
const protectedInput = "ec2508c76f2b35b34407738dd2f3cdcc286e4608"
const implementationCandidate = "74d09ef999c1b9f3a93795cbabe51f57697bc57e"

test("F0-N5T binds the protected input and remains inactive", async () => {
  const evidence = await readJson(evidencePath)
  assert.equal(evidence.workPackage, "F0-N5T")
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

test("F0-N5T admits only absent or exact Keycloak Admin Origin", async () => {
  const evidence = await readJson(evidencePath)
  assert.deepEqual(evidence.correction, {
    identityPath: "/realms/llm-machines/protocol/openid-connect/token",
    method: "POST",
    noOrigin: "ALLOW_SERVER_SIDE_EXCHANGE",
    allowedBrowserOrigin: "https://@@PRODUCT_KEYCLOAK_ADMIN_HOST@@",
    otherBrowserOrigins: "DENY_403_BEFORE_UPSTREAM",
    forwardedOrigin: "EXACT_ALLOWED_BROWSER_ORIGIN_ONLY",
    authorizationForwarded: false,
    cookieForwarded: false,
    consoleSessionForwarded: false,
    keycloakClientConfigurationChanged: false,
    nativeSessionRemainsKeycloakOwned: true,
  })
  assert.deepEqual(validateIngressPackage(root), [])
})

test("F0-N5T records browser success, hostile denial, and cleanup", async () => {
  const runtime = (await readJson(evidencePath)).disposableRuntimeObservation
  assert.deepEqual(runtime.results, {
    adminConsole: "PASS",
    exactBrowserOrigin: "PASS",
    tokenStatus: 200,
    foreignOriginStatus: 403,
    noOriginServerExchange: "ADMITTED_TO_KEYCLOAK",
  })
  assert.equal(runtime.credentialValuesRecorded, false)
  assert.equal(runtime.cookieValuesRecorded, false)
  assert.equal(runtime.workloadContentRecorded, false)
  assert.equal(runtime.containersRemoved, true)
  assert.equal(runtime.networkRemoved, true)
  assert.equal(runtime.volumeRemoved, true)
  assert.equal(runtime.temporaryFilesRemoved, true)
  assert.equal(runtime.founderEnvironmentPreserved, true)
})

test("F0-N5T preserves historical edge evidence byte-for-byte", async () => {
  const evidence = await readJson(evidencePath)
  for (const [name, path] of Object.entries({
    f0N5: "docs/reduction/inference-core/f0-n5-native-edge.json",
    f0N5r: "docs/reduction/inference-core/f0-n5r-keycloak-dual-authority.json",
    f0N5s: "docs/reduction/inference-core/f0-n5s-grafana-oauth-entry.json",
  })) {
    const current = await readText(path)
    assert.equal(
      sha256(current),
      evidence.defect.historicalEvidenceSha256[name],
    )
    assert.equal(current, gitRaw("show", `${protectedInput}:${path}`))
  }
})

test("F0-N5T source fingerprints and path boundary are exact", async () => {
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
