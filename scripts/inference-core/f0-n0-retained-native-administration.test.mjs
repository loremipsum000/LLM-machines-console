import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const decisionPath =
  "docs/reduction/inference-core/f0-n0-retained-native-administration.json"
const protectedInput = "eecbdc6099d36876b94b78689a54c914f6228eb4"
const f0N0Candidate = "d142cc9bef3c90a51abe6d9a818c73dc667a44ea"
const f0N0Merge = "1419006baff63c9861218872a41f64c096b8f9a8"

test("F0-N0 binds the prospective correction without activating native access", async () => {
  const decision = await readJson(decisionPath)

  assert.equal(decision.workPackage, "F0-N0")
  assert.equal(decision.status, "PROSPECTIVE_SCOPE_CORRECTION_SOURCE_ONLY")
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
  assert.equal(decision.historicalEvidencePolicy.rewritesPermitted, false)
  assert.equal(
    decision.liveReadOnlyObservations.runtimeMutationPerformed,
    false,
  )
  assert.equal(
    decision.liveReadOnlyObservations.certificateMutationAuthorized,
    false,
  )
})

test("F0-N0 distinguishes removed workloads from retained native administration", async () => {
  const decision = await readJson(decisionPath)

  assert.deepEqual(decision.productBoundary.removed, [
    "RETIRED_FIRST_PARTY_CHAT_UI",
    "RETIRED_FIRST_PARTY_CONVERSATIONS",
    "RETIRED_RETRIEVAL_UI",
    "RETIRED_RETRIEVAL_PIPELINE",
    "RETIRED_DOCUMENT_COLLECTIONS",
    "RETIRED_TOOL_PROTOCOL",
    "RETIRED_PRODUCT_DOCUMENT_PIPELINE",
  ])
  assert.equal(
    decision.productBoundary.console.position,
    "PRIMARY_SIMPLIFIED_UNIFIED_CUSTOMER_SURFACE",
  )
  assert.equal(
    decision.productBoundary.console.remainsUsefulWithoutNativeTools,
    true,
  )

  const surfaces = Object.fromEntries(
    decision.nativeSurfaces.map((surface) => [surface.id, surface]),
  )
  assert.deepEqual(Object.keys(surfaces).sort(), [
    "grafana",
    "keycloak-admin",
    "litellm",
    "portainer",
  ])
  assert.deepEqual(surfaces.grafana.roles, {
    Admin: "Editor",
    Operator: "DENY",
  })
  assert.equal(surfaces.grafana.serverAdministrator, false)
  assert.equal(surfaces["keycloak-admin"].realm, "llm-machines")
  assert.deepEqual(surfaces.portainer.roles, {
    Admin: "PORTAINER_ADMINISTRATOR",
    Operator: "DENY",
  })
  assert.equal(surfaces.portainer.customerRecoveryAdministratorRequired, true)
  assert.deepEqual(surfaces.litellm.roles, {
    Admin: "proxy_admin",
    Operator: "internal_user",
  })
  assert.equal(surfaces.litellm.enterpriseLicenseAllowed, false)
  assert.equal(surfaces.litellm.freeSsoUserLimit, 5)
  assert.ok(surfaces.litellm.operatorDenied.includes("proxy_admin"))
  for (const surface of Object.values(surfaces)) {
    assert.match(surface.activation, /^INACTIVE_PENDING_/)
  }
})

test("F0-N0 preserves native sessions and the Product-edge no-bypass boundary", async () => {
  const decision = await readJson(decisionPath)

  assert.equal(decision.identityBoundary.consoleSessionForwarding, false)
  assert.equal(decision.identityBoundary.sharedApplicationCookies, false)
  assert.equal(decision.identityBoundary.sharedHumanAccounts, false)
  assert.equal(decision.identityBoundary.anonymousAdministration, false)
  assert.equal(decision.identityBoundary.reverseProxyImpersonation, false)
  assert.equal(decision.identityBoundary.passwordOnlyPreGenesis, true)
  assert.equal(decision.identityBoundary.mandatoryTotp, false)
  assert.equal(decision.identityBoundary.idleSessionSeconds, 8 * 60 * 60)
  assert.equal(decision.identityBoundary.maximumSessionSeconds, 24 * 60 * 60)
  assert.equal(decision.ingressBoundary.productEdgeOnly, true)
  assert.equal(
    decision.ingressBoundary.directNativePortsCustomerAccessible,
    false,
  )
  assert.equal(
    decision.ingressBoundary.exactPerServiceBrowserRouteInventoryRequired,
    true,
  )
  assert.deepEqual(decision.firecrawlBoundary.routes, [
    "POST /v2/search",
    "POST /v2/scrape",
  ])
  assert.equal(decision.firecrawlBoundary.nativeCustomerUi, false)
})

test("F0-N0 assigns every superseded current surface without rewriting history", async () => {
  const [decision, decisionRegister, validationRegister, readme] =
    await Promise.all([
      readJson(decisionPath),
      readText("docs/reduction/inference-core/decision-register.md"),
      readText("docs/reduction/inference-core/validation-register.md"),
      readText("docs/reduction/inference-core/README.md"),
    ])

  assert.deepEqual(
    decision.implementationSequence,
    [
      "F0-N0",
      "F0-N1",
      "F0-N2",
      "F0-N3",
      "F0-N4",
      "F0-N5",
      "F0-N6",
      "F0-N7",
      "F0-N8",
    ].map(
      (id, index) =>
        `${id} ${
          [
            "scope and governance correction",
            "LiteLLM v1.96.2 upgrade, free SSO, and role characterization",
            "Grafana Admin-only OIDC correction",
            "scoped Keycloak Admin Console access",
            "Portainer Core restoration and Admin-only SSO",
            "Product-edge and DNS source profiles",
            "Console Technical Tools navigation and copy",
            "aggregate validation",
            "pre-Genesis closure amendment",
          ][index]
        }`,
    ),
  )

  const ownedPaths = new Set(
    decision.sourceRebaseline.flatMap((entry) => entry.paths),
  )
  for (const required of [
    "packages/contracts/src/inference-core-ingress.ts",
    "infra/ingress/edge-policy.json",
    "infra/release/core-image-inventory.json",
    "infra/keycloak/README.md",
    "infra/observability/grafana/grafana.ini",
    "apps/web/src/components/console-v2/console-v2-sections.ts",
    "scripts/pre-genesis/reduced-core-integrated.mjs",
    "scripts/inference-core/guardrails.mjs",
  ]) {
    assert.ok(ownedPaths.has(required), required)
  }
  for (const path of ownedPaths) {
    assert.doesNotThrow(
      () => git("ls-files", "--error-unmatch", path),
      `re-baseline path is not tracked: ${path}`,
    )
  }
  assert.deepEqual(
    decision.missingSourceCapabilities.map(({ owner }) => owner),
    ["F0-N1", "F0-N2", "F0-N3", "F0-N4", "F0-N5", "F0-N6"],
  )
  assert.match(decisionRegister, /\| F0-N0 \|/)
  assert.match(validationRegister, /\| F0-N0 \|/)
  assert.match(readme, /Prospective retained native administration correction/)

  assert.equal(git("rev-parse", `${f0N0Merge}^1`), protectedInput)
  assert.equal(git("rev-parse", `${f0N0Merge}^2`), f0N0Candidate)
  assert.equal(
    git("rev-parse", `${f0N0Merge}^{tree}`),
    git("rev-parse", `${f0N0Candidate}^{tree}`),
  )
  assert.deepEqual(changedPathsBetween(protectedInput, f0N0Candidate), [
    "docs/reduction/inference-core/README.md",
    "docs/reduction/inference-core/decision-register.md",
    "docs/reduction/inference-core/f0-n0-retained-native-administration.json",
    "docs/reduction/inference-core/validation-register.md",
    "scripts/inference-core/f0-n0-retained-native-administration.test.mjs",
  ])

  const serialized = JSON.stringify(decision)
  assert.doesNotMatch(
    serialized,
    /(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})/,
  )
  assert.doesNotMatch(
    serialized,
    /(?:PRIVATE KEY|BEGIN OPENSSH|password=|token=)/i,
  )
})

function git(...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
  }).trim()
}

function changedPathsBetween(base, candidate) {
  return git("diff", "--name-only", base, candidate)
    .split("\n")
    .filter(Boolean)
    .sort()
}

async function readJson(path) {
  return JSON.parse(await readText(path))
}

async function readText(path) {
  return readFile(resolve(root, path), "utf8")
}
