import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const closurePath =
  "docs/reduction/inference-core/f0-n8-native-access-closure.json"

test("F0-N8 binds the exact protected native-access history", async () => {
  const closure = await readJson(closurePath)

  assert.equal(closure.workPackage, "F0-N8")
  assert.equal(
    closure.status,
    "NATIVE_ACCESS_CLOSURE_CANDIDATE_PENDING_PROTECTED_ADMISSION",
  )
  assert.equal(closure.accepted, false)
  assert.equal(closure.runtimeQualified, false)
  assert.equal(
    closure.contractActivation,
    "INACTIVE_PENDING_VM103_DEPLOYMENT_APPROVAL",
  )
  assert.equal(closure.q0, "NOT_STARTED")
  assert.equal(closure.genesisPublished, false)
  assert.equal(
    git("rev-parse", `${closure.nativeAccessProgramBase.commit}^{tree}`),
    closure.nativeAccessProgramBase.tree,
  )
  assert.equal(
    git("rev-parse", `${closure.protectedInput.commit}^{tree}`),
    closure.protectedInput.tree,
  )

  const firstParentSequence = git(
    "rev-list",
    "--first-parent",
    "--reverse",
    `${closure.nativeAccessProgramBase.commit}..${closure.protectedInput.commit}`,
  ).split("\n")
  assert.deepEqual(firstParentSequence, [
    "1419006baff63c9861218872a41f64c096b8f9a8",
    "74d6a13ea4ffc0ea97fbda0abfec67cb957c5d26",
    "a031e5399e629bf273c83f55a6a11b7b1f1c536a",
    "2193952c191dc0db7a2f0d5a0072e63e30d8c0ad",
    "bbc36142ae528576e82759bb3ccec5027bd26917",
    "ace103d9bdc6db24e616444e6e5d8a234a3c9414",
    "0b0240c3aac9348198fd3959a5ba571ff94d57ac",
    "adde6ff484213a4dab1ae1207d8840ad14a4eb52",
    "155a4fe5004b7a0d0e2ae880aea752e69deeafd2",
    "f8ac8d762ff2838937c46e4826c5faeeb53a0ab5",
    "4585830069cb91cf1806a3a3308c7663860b6822",
    "dbdc1005711ea2cbfb3658a268181dbd2deef6e0",
    "9adf82ffbf8f4617a7846e69e436acd21b9270c8",
    "ec2508c76f2b35b34407738dd2f3cdcc286e4608",
    "fbcc7d81bef80c0346942380a0361fe64c2b69fa",
    "0317d2effb29a1a6cbaa4fc0fc8332b140a5a03f",
    "a714672c91fc512e075e93dd084a88a26e77c22a",
    "67707a8cb14256f8a02f3c2bf20b539dfa7a059f",
  ])

  assert.deepEqual(
    closure.protectedPackages.map(({ id }) => id),
    [
      "F0-N0",
      "F0-N1",
      "F0-N2",
      "F0-N3",
      "F0-N4",
      "F0-N5",
      "F0-N6",
      "F0-N3R",
      "F0-N3T",
      "F0-L2R",
      "F0-N5R",
      "F0-N5S",
      "F0-L2S",
      "F0-N5T",
      "F0-N5U",
      "F0-N5V/F0-N1",
      "F0-N7",
    ],
  )

  for (const item of [
    ...closure.protectedPackages,
    ...closure.preservedInterveningHistory,
  ]) {
    verifyProtectedMerge(item)
    for (const evidence of item.evidence) {
      const protectedBytes = gitBlob(
        `${closure.protectedInput.commit}:${evidence.path}`,
      )
      assert.equal(sha256(protectedBytes), evidence.sha256, evidence.path)
      assert.equal(
        await readText(evidence.path),
        protectedBytes,
        `${evidence.path} must remain historical evidence`,
      )
    }
  }
})

test("F0-N8 closes the corrected three-service Product boundary", async () => {
  const [closure, n4, n6, n7] = await Promise.all([
    readJson(closurePath),
    readJson(
      "docs/reduction/inference-core/f0-n4-portainer-upstream-security-deferral.json",
    ),
    readJson(
      "docs/reduction/inference-core/f0-n6-console-technical-tools.json",
    ),
    readJson(
      "docs/reduction/inference-core/f0-n7-native-access-validation.json",
    ),
  ])

  assert.equal(
    closure.productBoundary.console,
    "PRIMARY_SIMPLIFIED_CUSTOMER_EXPERIENCE_COMPLETE_WITHOUT_NATIVE_TOOLS",
  )
  assert.deepEqual(closure.productBoundary.retired, [
    "LibreChat",
    "first-party chat",
    "conversations",
    "Knowledge",
    "RAG",
    "corpora",
    "MCP",
    "Product corpus pipeline",
  ])
  assert.deepEqual(n6.roleNavigation.Admin, ["grafana", "litellm", "keycloak"])
  assert.deepEqual(n6.roleNavigation.Operator, ["litellm"])
  assert.equal(n6.securityBoundary.consoleSessionForwarded, false)
  assert.equal(n6.securityBoundary.applicationCredentialForwarded, false)
  assert.equal(n7.runtimeEvidence.grafana.admin, "EDITOR")
  assert.equal(n7.runtimeEvidence.grafana.operator, "DENY")
  assert.equal(n7.runtimeEvidence.grafana.serverAdministrator, false)
  assert.equal(n7.runtimeEvidence.litellm.admin, "PROXY_ADMIN")
  assert.equal(
    n7.runtimeEvidence.litellm.operator,
    "INTERNAL_USER_OWN_KEYS_AND_SPEND_ONLY",
  )
  assert.equal(n7.runtimeEvidence.litellm.globalAndCrossUserMutation, "DENY")
  assert.equal(n7.runtimeEvidence.keycloak.operator, "DENY")
  assert.equal(n7.runtimeEvidence.keycloak.userDeleteAtEdge, 403)
  assert.equal(n7.runtimeEvidence.keycloak.masterAndUnrelatedRealm, "DENY")
  assert.equal(n7.runtimeEvidence.noBypass.directPorts, "LOOPBACK_ONLY")
  assert.equal(n7.runtimeEvidence.noBypass.consoleCookies, "DENY")
  assert.equal(n7.runtimeEvidence.noBypass.productCredentials, "DENY")
  assert.equal(n7.runtimeEvidence.retention.credentialValues, 0)
  assert.equal(n7.runtimeEvidence.retention.workloadContentCanaries, 0)
  assert.equal(n7.runtimeEvidence.retiredProductSurfaces, "ABSENT")
  assert.equal(n4.status, "DEFERRED_UPSTREAM_SECURITY")
  assert.equal(n4.decision.admitted, false)
  assert.equal(n4.decision.intendedForLaterReconsideration, true)
  assert.equal(n4.currentBoundary.portainerIngressConfigured, false)
  assert.equal(n4.currentBoundary.portainerStartupConfigured, false)
  assert.equal(n4.currentBoundary.portainerNavigationConfigured, false)
  assert.equal(n4.currentBoundary.portainerImageLocked, false)
})

test("F0-N8 is governance-only and preserves every later gate", async () => {
  const closure = await readJson(closurePath)

  assert.deepEqual(closure.sourceChangeBoundary.changedPaths, [
    "docs/reduction/inference-core/README.md",
    "docs/reduction/inference-core/decision-register.md",
    "docs/reduction/inference-core/f0-n8-native-access-closure.json",
    "docs/reduction/inference-core/validation-register.md",
    "scripts/inference-core/f0-n8-native-access-closure.test.mjs",
  ])
  assert.deepEqual(
    git("diff", "--name-only", `${closure.protectedInput.commit}...HEAD`).split(
      "\n",
    ),
    closure.sourceChangeBoundary.changedPaths,
  )
  assert.equal(closure.sourceChangeBoundary.governanceOnly, true)
  assert.equal(closure.sourceChangeBoundary.productBehaviorChanged, false)
  assert.equal(closure.sourceChangeBoundary.runtimeConfigurationChanged, false)
  assert.equal(closure.sourceChangeBoundary.nativeIngressActivated, false)
  assert.equal(closure.sourceChangeBoundary.vm103Touched, false)
  assert.equal(closure.sourceChangeBoundary.productMainChanged, false)
  assert.equal(closure.sourceChangeBoundary.giteaTouched, false)
  assert.equal(closure.sourceChangeBoundary.genesisCreated, false)
  assert.equal(closure.sourceChangeBoundary.d2aSigningQ0Started, false)
  assert.equal(closure.admission.deploymentRequiresSeparateApproval, true)
  assert.equal(
    closure.admission.genesisPublicationRequiresSeparateApproval,
    true,
  )
  assert.equal(
    closure.nextGate,
    "SEPARATE_APPROVAL_REQUIRED_BEFORE_VM103_PREFLIGHT_OR_DEPLOYMENT",
  )
})

test("F0-N8 is indexed and contains no credential material", async () => {
  const [closure, decisions, validations, readme] = await Promise.all([
    readText(closurePath),
    readText("docs/reduction/inference-core/decision-register.md"),
    readText("docs/reduction/inference-core/validation-register.md"),
    readText("docs/reduction/inference-core/README.md"),
  ])

  assert.match(decisions, /\| F0-N8 \|/)
  assert.match(validations, /\| F0-N8 \|/)
  assert.match(readme, /## F0-N8 retained native-access closure/)
  assert.doesNotMatch(
    [closure, decisions, validations].join("\n"),
    /(?:PRIVATE KEY|BEGIN OPENSSH|Bearer\s+|eyJ[A-Za-z0-9_-]{20}|sk-[A-Za-z0-9_-]{16}|llmm_(?:t4|fc)_[A-Za-z0-9_-]{20})/i,
  )
})

function verifyProtectedMerge(item) {
  const parents = git(
    "show",
    "-s",
    "--format=%P",
    item.integrationCommit,
  ).split(" ")
  assert.equal(parents.length, 2, `${item.id} must be a merge commit`)
  assert.equal(parents[1], item.candidateCommit, `${item.id} candidate parent`)
  assert.equal(
    git("rev-parse", `${item.candidateCommit}^{tree}`),
    item.candidateTree,
    `${item.id} candidate tree`,
  )
  assert.equal(
    git("rev-parse", `${item.integrationCommit}^{tree}`),
    item.integrationTree,
    `${item.id} integration tree`,
  )
  assert.equal(
    item.integrationTree,
    item.candidateTree,
    `${item.id} tree parity`,
  )
  const subject = git("show", "-s", "--format=%s", item.integrationCommit)
  if (item.pullRequest === 100)
    assert.equal(subject, "Merge F0-L2R integrated LiteLLM OSS runtime binding")
  else
    assert.match(
      subject,
      new RegExp(
        `(?:^Merge pull request #${item.pullRequest}\\b|\\(#${item.pullRequest}\\)$)`,
      ),
      `${item.id} protected PR identity`,
    )
}

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
