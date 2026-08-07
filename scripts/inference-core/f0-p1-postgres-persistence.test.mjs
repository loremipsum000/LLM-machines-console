import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { test } from "node:test"

const repositoryRoot = resolve(import.meta.dirname, "../..")

test("F0-P1 remains a bounded disposable PostgreSQL persistence proof", async () => {
  const [decision, packageJson, wrapper, browser, fixture, store, client] =
    await Promise.all([
      readJson("docs/reduction/inference-core/f0-p1-postgres-persistence.json"),
      readJson("package.json"),
      readSource("scripts/pre-genesis/reduced-core-postgres-persistence.mjs"),
      readSource("scripts/pre-genesis/reduced-core-browser-session.mjs"),
      readSource("scripts/pre-genesis/reduced-core-session-bff-fixture.mts"),
      readSource("apps/bff/src/services/console-session-store-drizzle.ts"),
      readSource("apps/bff/src/db/inference-core-client.ts"),
    ])

  assert.equal(decision.workPackage, "F0-P1")
  assert.equal(decision.accepted, false)
  assert.equal(decision.runtimeQualified, false)
  assert.equal(
    decision.evidenceClass,
    "LOCAL_POSTGRES_RESTART_PERSISTENCE_ONLY",
  )
  assert.match(
    packageJson.scripts["test:pre-genesis:postgres-persistence"],
    /reduced-core-postgres-persistence\.mjs/,
  )
  assert.match(
    wrapper,
    /postgres:17\.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3/,
  )
  assert.match(wrapper, /0000_inference_core\.sql/)
  assert.match(wrapper, /--label/)
  assert.match(wrapper, /temporaryStateRemoved/)
  assert.match(browser, /LOCAL_POSTGRES_RESTART_PERSISTENCE_ONLY/)
  assert.match(browser, /canaryRetention: "none"/)
  assert.match(browser, /outageMethod: "pause-unpause"/)
  assert.match(fixture, /DrizzleConsoleSessionRepository/)
  assert.match(fixture, /F0_P1_SESSION_KEYRING_FILE/)
  assert.match(store, /timestamp\(record\.expiresAt\)/)
  assert.match(client, /INFERENCE_CORE_READINESS_TIMEOUT_MS = 5_000/)
  assert.doesNotMatch(wrapper, /(?:ssh|kubectl|harbor|gitea|vmid\s*115)/i)
  assert.doesNotMatch(wrapper, /\.\.\.process\.env/)
  assert.ok(
    decision.notEvidenceFor.includes(
      "exact amd64 Core composition or VM103 qualification",
    ),
  )
})

async function readSource(path) {
  return readFile(resolve(repositoryRoot, path), "utf8")
}

async function readJson(path) {
  return JSON.parse(await readSource(path))
}
