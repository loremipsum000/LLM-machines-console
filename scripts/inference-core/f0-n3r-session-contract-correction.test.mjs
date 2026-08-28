import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const evidencePath =
  "docs/reduction/inference-core/f0-n3r-session-contract-correction.json"

test("F0-N3R binds the exact protected input and remains inactive", async () => {
  const evidence = await readJson(evidencePath)

  assert.equal(evidence.workPackage, "F0-N3R")
  assert.equal(evidence.status, "SOURCE_SECURITY_CONTRACT_CORRECTED")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE_PENDING_F0_N7")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.genesisPublished, false)
  assert.equal(
    evidence.protectedInput.commit,
    "0b0240c3aac9348198fd3959a5ba571ff94d57ac",
  )
  assert.equal(
    git("rev-parse", `${evidence.protectedInput.commit}^{tree}`),
    evidence.protectedInput.tree,
  )
})

test("F0-N3R aligns Console and Keycloak at five minutes, eight hours, and 24 hours", async () => {
  const evidence = await readJson(evidencePath)
  const contract = await readText(
    "packages/contracts/src/inference-core-session.ts",
  )
  const service = await readText(
    "apps/bff/src/services/console-session-service.ts",
  )
  const keycloak = await readJson(
    "infra/keycloak/pr11a-console-session-policy.json",
  )

  assert.deepEqual(evidence.sessionPolicy, {
    accessTokenSeconds: 300,
    concurrentRefreshPreserved: true,
    identityOutageRecoveryPreserved: true,
    idleSeconds: 28_800,
    logoutPreserved: true,
    maximumSeconds: 86_400,
    refreshRotationPreserved: true,
    revocationPreserved: true,
    safeSameOriginRedirectPreserved: true,
  })
  assert.match(contract, /absoluteLifetimeSeconds: 24 \* 60 \* 60/)
  assert.match(contract, /accessTokenLifetimeSeconds: 5 \* 60/)
  assert.match(contract, /idleLifetimeSeconds: 8 \* 60 \* 60/)
  assert.match(service, /ABSOLUTE_LIFETIME_MS = 24 \* 60 \* 60 \* 1000/)
  assert.match(service, /IDLE_LIFETIME_MS = 8 \* 60 \* 60 \* 1000/)
  assert.equal(keycloak.realm.accessTokenSeconds, 300)
  assert.equal(keycloak.realm.ssoSessionIdleSeconds, 28_800)
  assert.equal(keycloak.realm.ssoSessionMaxSeconds, 86_400)
})

test("F0-N3R proves idle and maximum expiration with controlled time", async () => {
  const evidence = await readJson(evidencePath)
  const serviceTest = await readText(
    "apps/bff/src/services/console-session-service.test.ts",
  )
  const browser = await readText(
    "scripts/pre-genesis/reduced-core-browser-session.mjs",
  )

  assert.deepEqual(evidence.expiryProof, {
    idle: "CONTROLLED_CLOCK_AT_28800_SECONDS",
    maximum: "CONTROLLED_SESSION_TIMESTAMP_AND_CLOCK_AT_86400_SECONDS",
    wallClockWait: false,
  })
  assert.match(serviceTest, /idleFixture\.advance\(8 \* 60 \* 60 \* 1000\)/)
  assert.match(serviceTest, /maximumFixture\.advance\(24 \* 60 \* 60 \* 1000\)/)
  assert.match(browser, /advanceClock\(8 \* 60 \* 60 \* 1000 \+ 1\)/)
  assert.doesNotMatch(browser, /advanceClock\(31 \* 60 \* 1000\)/)
})

test("F0-N3R preserves historical F0-N3 evidence byte for byte", async () => {
  const evidence = await readJson(evidencePath)
  const historical = await readText(evidence.historicalEvidence.path)

  assert.equal(
    historical.trim(),
    git(
      "show",
      `${evidence.protectedInput.commit}:${evidence.historicalEvidence.path}`,
    ),
  )
  assert.equal(sha256(historical), evidence.historicalEvidence.sha256)
  assert.equal(evidence.historicalEvidence.rewritten, false)
})

test("F0-N3R source fingerprints and changed-path inventory are exact", async () => {
  const evidence = await readJson(evidencePath)
  const packageCommit = git(
    "log",
    "-1",
    "--format=%H",
    "--diff-filter=A",
    "--",
    evidencePath,
  )
  assert.match(packageCommit, /^[0-9a-f]{40}$/)
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
    evidence.sourceChangeBoundary.runtimeImplementationChanged,
    false,
  )
  assert.equal(evidence.sourceChangeBoundary.productBoundaryChanged, false)
})

test("F0-N3R evidence contains no credential or token material", async () => {
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
