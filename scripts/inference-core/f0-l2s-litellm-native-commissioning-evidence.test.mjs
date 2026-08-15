import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const evidencePath =
  "docs/reduction/inference-core/f0-l2s-litellm-native-commissioning.json"

test("F0-L2S binds exact protected input and source implementation", async () => {
  const evidence = await readJson(evidencePath)

  assert.equal(evidence.workPackage, "F0-L2S")
  assert.equal(evidence.status, "LOCAL_LITELLM_NATIVE_SUBJECT_BINDING_PROVEN")
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
    git("rev-parse", `${evidence.sourceImplementation.commit}^{tree}`),
    evidence.sourceImplementation.tree,
  )
  assert.equal(
    git("rev-parse", `${evidence.sourceImplementation.commit}^1`),
    evidence.protectedInput.commit,
  )
})

test("F0-L2S binds immutable subjects, exact image, and passing runtime proof", async () => {
  const evidence = await readJson(evidencePath)

  assert.equal(evidence.liteLlmIdentity.version, "v1.96.2-llmm.1")
  assert.equal(
    evidence.liteLlmIdentity.imageId,
    "sha256:d1396589f1fed1fa3e67142c5f93189e257db14ce92ce9d952fbf18a58350f6b",
  )
  assert.equal(evidence.commissioning.identityClaim, "sub")
  assert.equal(evidence.commissioning.roles.Admin, "proxy_admin")
  assert.equal(evidence.commissioning.roles.Operator, "internal_user")
  assert.equal(evidence.commissioning.firstRunCreated, 2)
  assert.equal(evidence.commissioning.repeatedRunUnchanged, 2)
  assert.equal(evidence.commissioning.postRestartUnchanged, 2)
  assert.equal(evidence.commissioning.automaticDeletion, false)
  assert.equal(evidence.commissioning.autoCreatedVirtualKey, false)
  assert.equal(evidence.commissioning.credentialMaterialReturned, false)
  assert.equal(evidence.runtimeEvidence.immutableSubjectBinding, "PASS")
  assert.equal(
    evidence.runtimeEvidence.crossUserAndGlobalMutationDenial,
    "PASS",
  )
  assert.equal(evidence.runtimeEvidence.restartPersistence, "PASS")
  assert.equal(evidence.runtimeEvidence.zeroContentRetention, "PASS")
  assert.equal(evidence.runtimeEvidence.consoleSessionForwarded, false)
  assert.equal(evidence.runtimeEvidence.runOwnedResourcesRemoved, true)
  assert.match(evidence.runtimeEvidence.browserEvidenceSha256, /^[0-9a-f]{64}$/)
})

test("F0-L2S source inventory and fingerprints are exact", async () => {
  const evidence = await readJson(evidencePath)
  const paths = git(
    "diff",
    "--name-only",
    `${evidence.protectedInput.commit}..${evidence.sourceImplementation.commit}`,
  )
    .split("\n")
    .filter(Boolean)
    .sort()

  assert.deepEqual(paths, Object.keys(evidence.sourceArtifacts).sort())
  for (const [path, expected] of Object.entries(evidence.sourceArtifacts))
    assert.equal(
      `sha256:${sha256(gitBlob(`${evidence.sourceImplementation.commit}:${path}`))}`,
      expected,
      path,
    )
})

test("F0-L2S preserves historical LiteLLM evidence and Product boundaries", async () => {
  const evidence = await readJson(evidencePath)
  const historicalPath =
    "docs/reduction/inference-core/f0-n1-litellm-oss-downstream.json"

  assert.equal(
    gitBlob(`${evidence.protectedInput.commit}:${historicalPath}`),
    gitBlob(`${evidence.sourceImplementation.commit}:${historicalPath}`),
  )
  assert.equal(
    evidence.sourceChangeBoundary.productRuntimeBehaviorChanged,
    false,
  )
  assert.equal(evidence.sourceChangeBoundary.productBoundaryChanged, false)
  assert.equal(evidence.sourceChangeBoundary.nativeIngressActivated, false)
  assert.equal(evidence.sourceChangeBoundary.vm103Touched, false)
  assert.equal(evidence.sourceChangeBoundary.giteaTouched, false)
  assert.equal(evidence.governanceCorrection.historicalPackage, "F0-N5S")
  assert.equal(evidence.governanceCorrection.historicalEvidenceChanged, false)
  assert.equal(evidence.governanceCorrection.productBehaviorChanged, false)
})

test("F0-L2S evidence and current registers contain no credential material", async () => {
  const [evidence, decisions, validations] = await Promise.all([
    readText(evidencePath),
    readText("docs/reduction/inference-core/decision-register.md"),
    readText("docs/reduction/inference-core/validation-register.md"),
  ])
  assert.match(decisions, /\| F0-L2S \|/)
  assert.match(validations, /\| F0-L2S \|/)
  assert.doesNotMatch(
    evidence,
    /(?:PRIVATE KEY|BEGIN OPENSSH|Bearer\s+|eyJ[A-Za-z0-9_-]{20}|sk-[A-Za-z0-9_-]{16})/i,
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
