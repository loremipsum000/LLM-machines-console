import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"
const root = resolve(import.meta.dirname, "../..")
const evidencePath = "docs/reduction/inference-core/f0-n5-native-edge.json"
const profilePath = "infra/ingress/native-admin-edge-profile.json"
const admittedCandidate = "42919c93db1f5d3b7bb3e233919f9fdea77b5fc1"

test("F0-N5 binds the exact protected input and remains inactive", async () => {
  const evidence = await readJson(evidencePath)

  assert.equal(evidence.workPackage, "F0-N5")
  assert.equal(
    evidence.status,
    "SOURCE_PROFILE_COMPLETE_RUNTIME_VALIDATION_PENDING",
  )
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE_PENDING_F0_N7")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.genesisPublished, false)
  assert.equal(
    evidence.protectedInput.commit,
    "bbc36142ae528576e82759bb3ccec5027bd26917",
  )
  assert.equal(
    git("rev-parse", `${evidence.protectedInput.commit}^{tree}`),
    evidence.protectedInput.tree,
  )
  assert.equal(evidence.runtimeEvidence.liveDnsTlsOrGatewayMutation, false)
})

test("F0-N5 preserves native sessions and exact role boundaries", async () => {
  const evidence = await readJson(evidencePath)
  const [grafana, litellm, keycloak] = evidence.nativeAuthorities

  assert.deepEqual(grafana.roles, {
    Admin: "Editor",
    Operator: "DENY",
    serverAdministrator: false,
  })
  assert.deepEqual(litellm.roles, {
    Admin: "proxy_admin",
    Operator: "internal_user",
  })
  assert.equal(litellm.operatorAuthority, "OWN_VIRTUAL_KEYS_AND_OWN_SPEND_ONLY")
  assert.equal(litellm.freeSsoBillableUserLimit, 5)
  assert.deepEqual(keycloak.roles, {
    Admin: "SCOPED_APPLIANCE_REALM_ADMIN",
    Operator: "DENY",
  })
  assert.equal(keycloak.realm, "llm-machines")
  assert.equal(keycloak.masterRealm, "DENY")
  assert.equal(keycloak.unrelatedRealms, "DENY")
  assert.equal(keycloak.userDeleteEdgeStatus, 403)
  assert.equal(evidence.productBoundary.nativeSessionsRemainServiceOwned, true)
  assert.equal(evidence.productBoundary.consoleSessionForwarded, false)
  assert.equal(evidence.productBoundary.consoleTokenForwarded, false)
  assert.equal(evidence.productBoundary.reverseProxyImpersonation, false)
})

test("F0-N5 historical source profile and Nginx implementation remain exact", async () => {
  const evidence = await readJson(evidencePath)
  const profile = JSON.parse(git("show", `${admittedCandidate}:${profilePath}`))

  assert.equal(profile.activation, "INACTIVE_PENDING_F0_N7")
  assert.equal(profile.runtimeQualified, false)
  assert.equal(profile.globalDenials.keycloakUserDelete, 403)
  assert.equal(profile.globalDenials.portainerAuthority, "ABSENT")
  assert.equal(profile.globalDenials.portainerUpstream, "ABSENT")
  assert.equal(profile.globalDenials.portainerRoute, "ABSENT")
  for (const [path, expected] of Object.entries(evidence.sourceArtifacts)) {
    assert.equal(
      `sha256:${sha256(gitRaw("show", `${admittedCandidate}:${path}`))}`,
      expected,
      path,
    )
  }
})

test("F0-N5 uses customer-owned authority custody without provider credentials", async () => {
  const evidence = await readJson(evidencePath)
  const profileText = await readText(profilePath)

  assert.deepEqual(evidence.authorityCustody, {
    productionDomainOwner: "customer",
    connectedTls: "PROVIDER_NEUTRAL_SCOPED_DNS_01_OR_DELEGATED_CHALLENGE_ZONE",
    disconnectedTls: "CUSTOMER_OWNED_PRIVATE_CA",
    porkbunDependency: false,
    customerSpecificValuesInProductSource: false,
    labCertificateExpiryUtc: "2026-11-12T08:25:59Z",
    labCertificateSha256:
      "EA:D3:7B:FB:0B:5F:08:64:6A:8A:D9:1A:FE:EF:6D:BC:73:C8:4C:5F:23:60:17:B6:C2:14:6C:7E:E3:CC:66:41",
  })
  assert.doesNotMatch(
    profileText,
    /(?:PRIVATE KEY|BEGIN OPENSSH|password\s*[=:]|token\s*[=:]|PORKBUN_(?:API|SECRET)|api\.porkbun)/i,
  )
})

test("F0-N5 preserves admitted characterization and Portainer deferral evidence", async () => {
  const evidence = await readJson(evidencePath)
  const base = evidence.protectedInput.commit
  const preservedPaths = [
    "docs/reduction/inference-core/f0-n1-litellm-oss-downstream.json",
    "docs/reduction/inference-core/f0-n1-litellm-native-route-characterization.json",
    "docs/reduction/inference-core/f0-n2-grafana-native-access.json",
    "docs/reduction/inference-core/f0-n2-grafana-native-route-characterization.json",
    "docs/reduction/inference-core/f0-n3-keycloak-native-access.json",
    "docs/reduction/inference-core/f0-n4-portainer-upstream-security-deferral.json",
  ]

  for (const path of preservedPaths) {
    assert.equal((await readText(path)).trim(), git("show", `${base}:${path}`))
  }
  const inventory = await readJson("infra/release/core-image-inventory.json")
  assert.equal(
    inventory.components.some(({ id }) => /portainer/i.test(id)),
    false,
  )
  assert.equal(evidence.productBoundary.portainer, "DEFERRED_UPSTREAM_SECURITY")
})

test("F0-N5 evidence contains no credential or workload content", async () => {
  const evidenceText = await readText(evidencePath)

  assert.doesNotMatch(
    evidenceText,
    /(?:PRIVATE KEY|BEGIN OPENSSH|Bearer\s+|eyJ[A-Za-z0-9_-]{20}|llmm_(?:t4|fc)_[A-Za-z0-9_-]{20})/i,
  )
  assert.doesNotMatch(
    evidenceText,
    /(?:prompt|response|query|pageContent)\s*[=:]\s*["'][^"']+/i,
  )
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
