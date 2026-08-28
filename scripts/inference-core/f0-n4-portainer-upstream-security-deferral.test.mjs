import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const decisionPath =
  "docs/reduction/inference-core/f0-n4-portainer-upstream-security-deferral.json"
const protectedInput = "2193952c191dc0db7a2f0d5a0072e63e30d8c0ad"

test("F0-N4 records a prospective upstream-security deferral", async () => {
  const decision = await readJson(decisionPath)

  assert.equal(decision.workPackage, "F0-N4")
  assert.equal(decision.status, "DEFERRED_UPSTREAM_SECURITY")
  assert.equal(decision.accepted, false)
  assert.equal(decision.runtimeQualified, false)
  assert.equal(decision.contractActivation, "INACTIVE")
  assert.equal(decision.q0, "NOT_STARTED")
  assert.equal(decision.genesisPublished, false)
  assert.equal(decision.protectedInput.commit, protectedInput)
  assert.equal(
    git("rev-parse", `${protectedInput}^{tree}`),
    decision.protectedInput.tree,
  )
  assert.equal(decision.decision.disposition, "DEFERRED_UPSTREAM_SECURITY")
  assert.equal(decision.decision.intendedForLaterReconsideration, true)
  assert.equal(decision.decision.permanentlyRemoved, false)
  assert.equal(decision.decision.blocksRemainingPreGenesisSequence, false)
  for (const field of [
    "admitted",
    "includedInCurrentCoreBom",
    "includedInCurrentImmutableImageLock",
    "packaged",
    "deployed",
    "exposed",
    "linked",
    "advertised",
    "broadDownstreamForkAuthorized",
    "vulnerabilityWorkaroundAuthorized",
    "alternativeAdministrationBridgeAuthorized",
    "sharedAccountAuthorized",
    "proxyImpersonationAuthorized",
  ]) {
    assert.equal(decision.decision[field], false, field)
  }
})

test("F0-N4 preserves the rejected feasibility result as non-admission evidence", async () => {
  const decision = await readJson(decisionPath)
  const evidence = decision.historicalFeasibilityEvidence

  assert.equal(evidence.preserveUnchanged, true)
  assert.equal(evidence.rewriteAsAcceptedImage, false)
  assert.equal(evidence.version, "2.39.6")
  assert.equal(
    evidence.sourceCommit,
    "723d1a2268f0fefe70d57f5981ce15d5d1ffc679",
  )
  assert.equal(evidence.boundedOverlay.twoBuildsByteIdentical, true)
  assert.equal(
    evidence.boundedOverlay.ociArchiveSha256,
    "8b7a2ff1b9b18a2c2fe0700e2c9071d2675cfacc9cefacbc72fc3471588928fb",
  )
  assert.equal(
    evidence.securityEvidence.materialDisposition,
    "BLOCKED_FOR_APPLIANCE_ADMINISTRATION",
  )
  assert.equal(evidence.securityEvidence.trivyCounts.critical, 0)
  assert.equal(evidence.securityEvidence.trivyCounts.high, 6)
  assert.equal(evidence.securityEvidence.reachableVulnerabilities, 10)
  assert.equal(
    evidence.runtimeCharacterizationAfterSecurityBlock,
    "NOT_RUN_AGAINST_REJECTED_IMAGE",
  )
})

test("F0-N4 leaves Portainer absent from current Product execution surfaces", async () => {
  const [decision, inventory, edge, startup, uat, navigation] =
    await Promise.all([
      readJson(decisionPath),
      readJson("infra/release/core-image-inventory.json"),
      readJson("infra/ingress/edge-policy.json"),
      readText("scripts/pre-genesis/reduced-core-integrated.mjs"),
      readText("scripts/pre-genesis/reduced-core-uat.mjs"),
      readText("apps/web/src/components/console-v2/console-v2-sections.ts"),
    ])

  assert.deepEqual(decision.currentBoundary.retainedNativeSurfaces, [
    "Grafana",
    "LiteLLM",
    "Keycloak Admin Console",
  ])
  assert.equal(
    decision.currentBoundary.defenseOnlyDenialReferencesPermitted,
    true,
  )
  assert.equal(decision.currentBoundary.consoleRemainsPrimary, true)
  assert.equal(
    inventory.components.some(({ id }) =>
      id.toLowerCase().includes("portainer"),
    ),
    false,
  )
  assert.equal("portainer" in edge.edge.hostTemplates, false)
  assert.equal(
    edge.upstreams.some(({ id }) => id.toLowerCase().includes("portainer")),
    false,
  )
  assert.equal(
    edge.routes.some(({ id }) => id.toLowerCase().includes("portainer")),
    false,
  )
  for (const [path, source] of [
    ["scripts/pre-genesis/reduced-core-integrated.mjs", startup],
    ["scripts/pre-genesis/reduced-core-uat.mjs", uat],
    ["apps/web/src/components/console-v2/console-v2-sections.ts", navigation],
  ]) {
    assert.doesNotMatch(source, /portainer/i, path)
  }
})

test("F0-N4 preserves prior scope evidence and binds the remaining sequence", async () => {
  const [
    decision,
    historicalCurrent,
    historicalAtBase,
    decisionRegister,
    validationRegister,
    readme,
  ] = await Promise.all([
    readJson(decisionPath),
    readText(
      "docs/reduction/inference-core/f0-n0-retained-native-administration.json",
    ),
    Promise.resolve(
      git(
        "show",
        `${protectedInput}:docs/reduction/inference-core/f0-n0-retained-native-administration.json`,
      ),
    ),
    readText("docs/reduction/inference-core/decision-register.md"),
    readText("docs/reduction/inference-core/validation-register.md"),
    readText("docs/reduction/inference-core/README.md"),
  ])

  assert.equal(historicalCurrent.trim(), historicalAtBase.trim())
  assert.equal(decision.futureAdmission.workPackage, "F0-N4R")
  assert.equal(decision.futureAdmission.mayReuseRejectedImage, false)
  assert.equal(decision.futureAdmission.mayInheritSecurityAdmission, false)
  assert.deepEqual(decision.remainingSequence, [
    "F0-N5 three-service Product-edge profiles",
    "F0-N6 Console Technical Tools for Grafana, LiteLLM, and Keycloak",
    "F0-N7 aggregate three-service native-access validation",
    "F0-N8 governance-only pre-Genesis closure",
  ])
  assert.match(
    decisionRegister,
    /\| F0-N4 \| Portainer upstream-security deferral \|/,
  )
  assert.match(
    validationRegister,
    /\| F0-N4 \| Portainer upstream-security deferral \|/,
  )
  assert.match(readme, /Portainer upstream-security deferral/)
})

test("F0-N4 is governance-only and contains no secret or private topology material", async () => {
  const decision = await readJson(decisionPath)

  assert.deepEqual(decision.sourceChangeBoundary.changedPaths, [
    "docs/reduction/inference-core/README.md",
    "docs/reduction/inference-core/decision-register.md",
    "docs/reduction/inference-core/f0-n4-portainer-upstream-security-deferral.json",
    "docs/reduction/inference-core/validation-register.md",
    "scripts/inference-core/f0-n4-portainer-upstream-security-deferral.test.mjs",
  ])
  assert.equal(decision.sourceChangeBoundary.governanceOnly, true)
  assert.equal(decision.sourceChangeBoundary.productBehaviorChanged, false)
  assert.equal(decision.sourceChangeBoundary.runtimeConfigurationChanged, false)
  assert.equal(decision.sourceChangeBoundary.releaseInventoryChanged, false)
  assert.equal(decision.sourceChangeBoundary.historicalEvidenceRewritten, false)

  const serialized = JSON.stringify(decision)
  assert.doesNotMatch(
    serialized,
    /(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})/,
  )
  assert.doesNotMatch(
    serialized,
    /(?:PRIVATE KEY|BEGIN OPENSSH|password\s*[=:]|token\s*[=:])/i,
  )
})

function git(...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
  }).trim()
}

async function readJson(path) {
  return JSON.parse(await readText(path))
}

async function readText(path) {
  return readFile(resolve(root, path), "utf8")
}
