import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"
import { validateIngressPackage } from "../../infra/ingress/validate-ingress.mjs"

const root = resolve(import.meta.dirname, "../..")
const evidencePath =
  "docs/reduction/inference-core/f0-n5r-keycloak-dual-authority.json"
const historicalEvidencePath =
  "docs/reduction/inference-core/f0-n5-native-edge.json"
const admittedCandidate = "aa41359c0e0b35b0b3fb0a44bf9c5fa92e7c2486"

test("F0-N5R binds the protected input and remains inactive", async () => {
  const evidence = await readJson(evidencePath)
  assert.equal(evidence.workPackage, "F0-N5R")
  assert.equal(evidence.status, "SOURCE_CORRECTION_COMPLETE_F0_N7_PENDING")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE_PENDING_F0_N7")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.genesisPublished, false)
  assert.equal(
    evidence.protectedInput.commit,
    "4585830069cb91cf1806a3a3308c7663860b6822",
  )
  assert.equal(
    git("rev-parse", `${evidence.protectedInput.commit}^{tree}`),
    evidence.protectedInput.tree,
  )
})

test("F0-N5R binds the supported Keycloak dual-authority contract", async () => {
  const evidence = await readJson(evidencePath)
  const profile = await readJson("infra/ingress/native-admin-edge-profile.json")
  const keycloak = profile.services.keycloakAdmin
  assert.deepEqual(keycloak.hostnameContract, {
    hostname: "https://@@PRODUCT_IDENTITY_HOST@@",
    hostnameAdmin: "https://@@PRODUCT_KEYCLOAK_ADMIN_HOST@@/keycloak",
    proxyHeaders: "xforwarded",
    hostnameStrict: true,
  })
  assert.equal(keycloak.frontendContextPath, "/")
  assert.equal(keycloak.adminContextPath, "/keycloak")
  assert.equal(keycloak.upstreamContextPath, "/")
  assert.equal(
    keycloak.pathNormalization.scope,
    "ALLOWLISTED_KEYCLOAK_ADMIN_LOCATIONS_ONLY",
  )
  assert.equal(evidence.keycloakContract.adminHostOidcRoutes, "DENY")
  assert.equal(evidence.keycloakContract.consoleSessionForwarded, false)
  assert.equal(evidence.keycloakContract.consoleTokenForwarded, false)
  assert.equal(
    evidence.keycloakContract.nativeSessionRemainsKeycloakOwned,
    true,
  )
})

test("F0-N5R checked-in edge validates and keeps deletion before rewrite", async () => {
  assert.deepEqual(validateIngressPackage(root), [])
  const nginx = await readText("infra/ingress/product-edge.nginx.conf.template")
  const headers = await readText(
    "infra/ingress/request-headers-keycloak-admin-browser.inc",
  )
  assert.equal(
    nginx.split("rewrite ^/keycloak/(.*)$ /$1 break;").length - 1,
    11,
  )
  assert.match(
    nginx,
    /if \(\$request_method = DELETE\) \{ return 403; \}[\s\S]{0,700}rewrite \^\/keycloak\/\(\.\*\)\$ \/\$1 break;/,
  )
  assert.doesNotMatch(
    nginx,
    /location = \/keycloak\/realms\/llm-machines\/protocol\/openid-connect\/auth/,
  )
  assert.match(
    nginx,
    /location = \/realms\/llm-machines\/protocol\/openid-connect\/userinfo/,
  )
  assert.match(headers, /proxy_set_header X-Forwarded-Prefix \/keycloak;/)
})

test("F0-N5R records bounded disposable path proof and complete cleanup", async () => {
  const runtime = (await readJson(evidencePath)).disposableRuntimeObservation
  assert.deepEqual(runtime.results, {
    externalAdminConsole: 200,
    externalUserDelete: 403,
    adminHostDuplicateOidc: 404,
    directUpstreamPrefixedAdmin: 404,
    directUpstreamRootAdmin: 200,
    identityAuthorizationReachedKeycloak: 400,
  })
  assert.equal(runtime.credentialValuesRecorded, false)
  assert.equal(runtime.workloadContentRecorded, false)
  assert.equal(runtime.containersRemoved, true)
  assert.equal(runtime.listenersRemoved, true)
  assert.equal(runtime.temporaryFilesRemoved, true)
})

test("F0-N5R preserves historical F0-N5 evidence byte-for-byte", async () => {
  const evidence = await readJson(evidencePath)
  const current = await readText(historicalEvidencePath)
  const historical = gitRaw(
    "show",
    `${evidence.protectedInput.commit}:${historicalEvidencePath}`,
  )
  assert.equal(current, historical)
  assert.equal(sha256(current), evidence.defect.historicalEvidenceSha256)
})

test("F0-N5R source fingerprints and evidence are credential-free", async () => {
  const evidence = await readJson(evidencePath)
  for (const [path, expected] of Object.entries(evidence.sourceArtifacts)) {
    assert.equal(
      `sha256:${sha256(gitRaw("show", `${admittedCandidate}:${path}`))}`,
      expected,
      path,
    )
  }
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
