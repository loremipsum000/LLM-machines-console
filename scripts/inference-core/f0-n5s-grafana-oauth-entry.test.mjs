import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"
import { validateIngressPackage } from "../../infra/ingress/validate-ingress.mjs"

const root = resolve(import.meta.dirname, "../..")
const evidencePath =
  "docs/reduction/inference-core/f0-n5s-grafana-oauth-entry.json"
const protectedInput = "dbdc1005711ea2cbfb3658a268181dbd2deef6e0"
const sourceCandidate = "e1f45dab020c27a4ae734499063ab2db7e1d2abf"

test("F0-N5S binds the protected input and remains inactive", async () => {
  const evidence = await readJson(evidencePath)
  assert.equal(evidence.workPackage, "F0-N5S")
  assert.equal(evidence.status, "SOURCE_CORRECTION_COMPLETE_F0_N7_PENDING")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE_PENDING_F0_N7")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.genesisPublished, false)
  assert.equal(evidence.protectedInput.commit, protectedInput)
  assert.equal(git("rev-parse", `${sourceCandidate}^1`), protectedInput)
  assert.equal(
    git("rev-parse", `${protectedInput}^{tree}`),
    evidence.protectedInput.tree,
  )
})

test("F0-N5S binds only Grafana OAuth entry and exact callback queries", async () => {
  const profile = await readJson("infra/ingress/native-admin-edge-profile.json")
  const route = profile.services.grafana.routes.find(
    ({ id }) => id === "oauth-entry-or-callback",
  )
  assert.deepEqual(route, {
    id: "oauth-entry-or-callback",
    methods: ["GET", "HEAD"],
    path: { kind: "exact", value: "/login/generic_oauth" },
    queryPolicy: "grafana-oauth-entry-or-callback",
    emptyQueryAllowed: true,
  })
  assert.deepEqual(profile.queryPolicies["grafana-oauth-entry-or-callback"], [
    "code",
    "iss",
    "session_state",
    "state",
  ])

  const nginx = await readText("infra/ingress/product-edge.nginx.conf.template")
  assert.match(
    nginx,
    /map \$args \$llmm_query_grafana_oauth \{[\s\S]{0,220}"" 1;[\s\S]{0,220}\(\?:code\|iss\|session_state\|state\)/,
  )
  assert.match(
    nginx,
    /location = \/login\/generic_oauth \{[\s\S]{0,220}\$llmm_query_grafana_oauth/,
  )
  assert.match(
    nginx,
    /location = \/sso\/callback \{[\s\S]{0,220}\$llmm_query_oidc_callback/,
  )
  assert.deepEqual(validateIngressPackage(root), [])
})

test("F0-N5S records the focused HTTPS browser proof and cleanup", async () => {
  const runtime = (await readJson(evidencePath)).disposableRuntimeObservation
  assert.deepEqual(runtime.results, {
    oauthInitiationWithoutQuery: "PASS",
    oauthCallbackWithExactKeys: "PASS",
    pkceS256: "PASS",
    adminRole: "Editor",
    operator: "DENY",
    grafanaServerAdministrator: false,
    dashboardMutation: "PASS",
    datasourceMutationStatus: 404,
    unapprovedQueryStatus: 400,
  })
  assert.equal(runtime.credentialValuesRecorded, false)
  assert.equal(runtime.workloadContentRecorded, false)
  assert.equal(runtime.containersRemoved, true)
  assert.equal(runtime.networksRemoved, true)
  assert.equal(runtime.volumesRemoved, true)
  assert.equal(runtime.temporarySecretsRemoved, true)
})

test("F0-N5S preserves historical F0-N5 and F0-N5R evidence", async () => {
  const evidence = await readJson(evidencePath)
  for (const [path, expected] of [
    [
      "docs/reduction/inference-core/f0-n5-native-edge.json",
      evidence.defect.f0N5EvidenceSha256,
    ],
    [
      "docs/reduction/inference-core/f0-n5r-keycloak-dual-authority.json",
      evidence.defect.f0N5rEvidenceSha256,
    ],
  ]) {
    const current = await readText(path)
    assert.equal(sha256(current), expected)
    assert.equal(current, gitRaw("show", `${protectedInput}:${path}`))
  }
})

test("F0-N5S fingerprints and changed paths are exact and credential-free", async () => {
  const evidence = await readJson(evidencePath)
  for (const [path, expected] of Object.entries(evidence.sourceArtifacts)) {
    assert.equal(
      `sha256:${sha256(gitRaw("show", `${sourceCandidate}:${path}`))}`,
      expected,
      path,
    )
  }
  assert.deepEqual(
    git("diff", "--name-only", `${protectedInput}..${sourceCandidate}`)
      .split("\n")
      .filter(Boolean)
      .sort(),
    evidence.changedPaths,
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
