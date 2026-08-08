import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { test } from "node:test"

const repositoryRoot = resolve(import.meta.dirname, "../..")

test("F0-I1 remains a bounded disposable Keycloak identity proof", async () => {
  const [decision, packageJson, wrapper, browser, boundary, policy] =
    await Promise.all([
      readJson("docs/reduction/inference-core/f0-i1-keycloak-identity.json"),
      readJson("package.json"),
      readSource("scripts/pre-genesis/reduced-core-keycloak-identity.mjs"),
      readSource("scripts/pre-genesis/reduced-core-browser-session.mjs"),
      readSource("infra/ingress/source-no-bypass.mjs"),
      readJson("infra/keycloak/pr11a-console-session-policy.json"),
    ])

  assert.equal(decision.workPackage, "F0-I1")
  assert.equal(decision.accepted, false)
  assert.equal(decision.runtimeQualified, false)
  assert.equal(
    decision.evidenceClass,
    "LOCAL_KEYCLOAK_IDENTITY_INTEGRATION_ONLY",
  )
  assert.match(
    packageJson.scripts["test:pre-genesis:keycloak-identity"],
    /reduced-core-keycloak-identity\.mjs/,
  )
  assert.match(
    wrapper,
    new RegExp(escapeRegExp(policy.keycloakRuntime.q0Image)),
  )
  assert.match(wrapper, /--import-realm/)
  assert.match(wrapper, /--publish",\s*"127\.0\.0\.1::8080"/s)
  assert.match(wrapper, /"pkce\.code\.challenge\.method": "S256"/)
  assert.match(wrapper, /"default\.reference\.value": value/)
  assert.match(wrapper, /otpPolicyAlgorithm: "HmacSHA256"/)
  assert.match(browser, /evaluateSourceBoundary/)
  assert.match(browser, /LOCAL_KEYCLOAK_IDENTITY_INTEGRATION_ONLY/)
  assert.match(boundary, /nativeIdentityPathPattern/)
  assert.doesNotMatch(wrapper, /(?:ssh|kubectl|harbor|gitea|vmid\s*115)/i)
  assert.doesNotMatch(wrapper, /\.\.\.process\.env/)
  assert.ok(
    decision.notEvidenceFor.includes(
      "Keycloak FGAP v2 or Console user and password mutations",
    ),
  )
})

async function readSource(path) {
  return readFile(resolve(repositoryRoot, path), "utf8")
}

async function readJson(path) {
  return JSON.parse(await readSource(path))
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
