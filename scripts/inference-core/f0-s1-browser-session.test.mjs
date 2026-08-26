import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { test } from "node:test"

const repositoryRoot = resolve(import.meta.dirname, "../..")

test("F0-S1 remains a bounded local browser-session proof", async () => {
  const [decision, packageJson, harness, identityFixture, bffFixture] =
    await Promise.all([
      readJson("docs/reduction/inference-core/f0-s1-browser-session.json"),
      readJson("package.json"),
      readSource("scripts/pre-genesis/reduced-core-browser-session.mjs"),
      readSource("scripts/pre-genesis/reduced-core-oidc-fixture.mjs"),
      readSource("scripts/pre-genesis/reduced-core-session-bff-fixture.mts"),
    ])

  assert.equal(decision.workPackage, "F0-S1")
  assert.equal(decision.accepted, false)
  assert.equal(decision.runtimeQualified, false)
  assert.equal(
    decision.evidenceClass,
    "LOCAL_BROWSER_SESSION_AND_ROLE_FLOW_ONLY",
  )
  assert.equal(decision.command, "corepack pnpm run test:pre-genesis:browser")
  assert.match(
    packageJson.scripts["test:pre-genesis:browser"],
    /reduced-core-browser-session\.mjs/,
  )
  assert.match(harness, /LOCAL_BROWSER_SESSION_AND_ROLE_FLOW_ONLY/)
  assert.match(
    harness,
    /parallel browser requests serialize refresh-token rotation/,
  )
  assert.match(harness, /Identity service temporarily unavailable/)
  assert.match(identityFixture, /code_challenge_method/)
  assert.match(identityFixture, /refresh token revoked or reused/)
  assert.match(bffFixture, /TestOnlyInMemoryConsoleSessionRepository/)
  assert.match(bffFixture, /createConsoleTokenValidator/)
  assert.doesNotMatch(
    harness,
    /(?:\b(?:ssh|kubectl|harbor|gitea)\b|\bvmid\s*115\b)/i,
  )
  assert.doesNotMatch(harness, /\.\.\.process\.env/)
  assert.ok(
    decision.notEvidenceFor.includes("Keycloak 26.7.0 runtime qualification"),
  )
  assert.ok(
    decision.deferred.includes(
      "F0-U1 browser Application creation and credential reveal",
    ),
  )
})

async function readSource(path) {
  return readFile(resolve(repositoryRoot, path), "utf8")
}

async function readJson(path) {
  return JSON.parse(await readSource(path))
}
