import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const evidencePath =
  "docs/reduction/inference-core/f0-n3t-keycloak-runtime-bootstrap.json"

test("F0-N3T binds the exact protected input and remains inactive", async () => {
  const evidence = await readJson(evidencePath)

  assert.equal(evidence.workPackage, "F0-N3T")
  assert.equal(evidence.status, "LOCAL_KEYCLOAK_RUNTIME_BOOTSTRAP_CORRECTED")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE_PENDING_F0_N7")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.genesisPublished, false)
  assert.equal(
    git("rev-parse", `${evidence.protectedInput.commit}^{tree}`),
    evidence.protectedInput.tree,
  )
  assert.equal(
    git("rev-parse", `${evidence.sourceCorrection.commit}^{tree}`),
    evidence.sourceCorrection.tree,
  )
  assert.equal(
    git("rev-parse", `${evidence.sourceCorrection.commit}^`),
    evidence.protectedInput.commit,
  )
})

test("F0-N3T keeps Keycloak import readable without weakening host custody", async () => {
  const evidence = await readJson(evidencePath)
  const helper = await readText("scripts/pre-genesis/keycloak-import-root.mjs")

  assert.deepEqual(evidence.corrections.restrictiveUmask, {
    containerImportDirectoryMode: "0755",
    containerRealmFileMode: "0644",
    hostStateRootMode: "0700",
    throwawayCredentialsOnly: true,
  })
  assert.match(helper, /chmod\(directory, 0o755\)/)
  assert.match(helper, /chmod\(path, 0o644\)/)
})

test("F0-N3T preserves password-only login and the no-offline-token policy", async () => {
  const evidence = await readJson(evidencePath)
  const wrapper = await readText(
    "scripts/pre-genesis/reduced-core-keycloak-identity.mjs",
  )
  const browser = await readText(
    "scripts/pre-genesis/reduced-core-browser-session.mjs",
  )

  assert.deepEqual(evidence.corrections.offlineBrowserTokens, {
    consoleOptionalOfflineAccess: false,
    offlineAccessRoleAndScopeExist: true,
    realmDefaultRole: "default-roles-llm-machines",
    realmDefaultRoleComposites: [],
  })
  assert.equal(evidence.corrections.browserLogin.passwordOnly, true)
  assert.equal(evidence.corrections.browserLogin.totpRequired, false)
  assert.match(wrapper, /name: "default-roles-llm-machines"/)
  assert.match(wrapper, /name: "offline_access"/)
  assert.match(wrapper, /optionalClientScopes: \["profile", "email"\]/)
  assert.doesNotMatch(wrapper, /optionalClientScopes: \[[^\]]*offline_access/)
  assert.match(browser, /synchronizeClock: synchronizeFixtureClock/)
  assert.doesNotMatch(
    browser,
    /await probe\.locator\("#kc-totp-settings-form"\)\.waitFor/,
  )
})

test("F0-N3T binds the passing disposable linux runtime evidence", async () => {
  const evidence = await readJson(evidencePath)
  const runtime = evidence.runtimeEvidence

  assert.equal(runtime.environment, "VM117_ISOLATED_LINUX_AMD64")
  assert.equal(runtime.adminCreateOperator, "PASSED")
  assert.equal(runtime.passwordRotation, "PASSED")
  assert.equal(runtime.disableReactivate, "PASSED")
  assert.equal(runtime.operatorMutationDenial, "PASSED")
  assert.equal(runtime.auditMetadataOnly, true)
  assert.equal(runtime.credentialMaterialPersisted, false)
  assert.equal(runtime.genericSecretMatches, 0)
  assert.equal(runtime.runOwnedContainersRemoved, true)
  assert.equal(runtime.persistentFounderEnvironmentPreserved, true)
  assert.match(runtime.credentialFreeLogSha256, /^[0-9a-f]{64}$/)
})

test("F0-N3T preserves historical evidence byte for byte", async () => {
  const evidence = await readJson(evidencePath)

  for (const historical of evidence.historicalEvidence) {
    const current = await readText(historical.path)
    assert.equal(
      current.trim(),
      git("show", `${evidence.protectedInput.commit}:${historical.path}`),
    )
    assert.equal(sha256(current), historical.sha256)
    assert.equal(historical.rewritten, false)
  }
})

test("F0-N3T source fingerprints and changed paths are exact", async () => {
  const evidence = await readJson(evidencePath)
  const sourcePaths = git(
    "diff",
    "--name-only",
    `${evidence.protectedInput.commit}..${evidence.sourceCorrection.commit}`,
  )
    .split("\n")
    .filter(Boolean)
    .sort()
  assert.deepEqual(sourcePaths, Object.keys(evidence.sourceArtifacts).sort())

  const packageCommit = git("log", "-1", "--format=%H", "--", evidencePath)
  const changedPaths = git(
    "diff",
    "--name-only",
    `${evidence.protectedInput.commit}..${packageCommit}`,
  )
    .split("\n")
    .filter(Boolean)
    .sort()
  assert.deepEqual(
    changedPaths,
    [...evidence.sourceChangeBoundary.changedPaths].sort(),
  )
  for (const [path, expected] of Object.entries(evidence.sourceArtifacts)) {
    assert.equal(
      `sha256:${sha256(gitBlob(`${packageCommit}:${path}`))}`,
      expected,
      path,
    )
  }
  assert.equal(
    evidence.sourceChangeBoundary.productRuntimeBehaviorChanged,
    false,
  )
  assert.equal(evidence.sourceChangeBoundary.productBoundaryChanged, false)
})

test("F0-N3T evidence contains no credential or token material", async () => {
  const evidence = await readText(evidencePath)

  assert.doesNotMatch(
    evidence,
    /(?:PRIVATE KEY|BEGIN OPENSSH|Bearer\s+|eyJ[A-Za-z0-9_-]{20}|llmm_(?:t4|fc)_[A-Za-z0-9_-]{20})/i,
  )
})

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

function gitBlob(revision) {
  return execFileSync("git", ["show", revision], {
    cwd: root,
    encoding: "utf8",
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
