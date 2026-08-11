import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(path, "utf8")
const browser = read("scripts/pre-genesis/reduced-core-browser-session.mjs")
const integrated = read("scripts/pre-genesis/reduced-core-integrated.mjs")
const clientRoot = "test-support/f0-e2e2-openai-client"
const client = read(`${clientRoot}/client.mjs`)
const evidence = JSON.parse(
  read("docs/reduction/inference-core/f0-e2e2-founder-journey.json"),
)
const packageDocument = JSON.parse(read(`${clientRoot}/package.json`))
const rootPackageDocument = JSON.parse(read("package.json"))

test("F0-E2E2 pins a standard OpenAI SDK client and its transport", () => {
  assert.equal(packageDocument.dependencies.openai, "7.4.0")
  assert.equal(packageDocument.dependencies.undici, "7.29.0")
  assert.equal(packageDocument.engines.node, ">=22.0.0")
  assert.equal(rootPackageDocument.dependencies?.openai, undefined)
  assert.equal(rootPackageDocument.devDependencies?.openai, undefined)
  assert.equal(rootPackageDocument.dependencies?.undici, undefined)
  assert.equal(rootPackageDocument.devDependencies?.undici, undefined)
  assert.match(client, /import OpenAI from "openai"/)
  assert.match(client, /import \{ Agent, fetch as undiciFetch \} from "undici"/)
  assert.match(client, /await client\.models\.list\(\)/)
  assert.equal(client.match(/client\.chat\.completions\.create\(/g)?.length, 2)
  assert.match(client, /stream: true/)
  assert.match(client, /stream_options: \{ include_usage: true \}/)
})

test("F0-E2E2 executes the SDK outside the browser and BFF processes", () => {
  assert.match(browser, /test-support\/f0-e2e2-openai-client\/client\.mjs/)
  assert.match(integrated, /installExternalClientFixture\(\)/)
  assert.match(integrated, /"--frozen-lockfile"/)
  assert.match(integrated, /"--ignore-scripts"/)
  assert.match(browser, /processBoundary: "child"/)
  assert.match(browser, /apiKey,\s*baseUrl:/)
  assert.match(browser, /child\.stdin\.end\(/)
  assert.doesNotMatch(browser, /OPENAI_API_KEY/)
  assert.doesNotMatch(client, /process\.env\.(?:OPENAI|LLMM|API_KEY)/)
  assert.doesNotMatch(browser, /openAiClient: "passed"/)
})

test("F0-E2E2 preserves the exact API authority and TLS boundary", () => {
  assert.match(client, /baseUrl\.hostname, "api\.llmm\.test"/)
  assert.match(client, /hostname !== "api\.llmm\.test"/)
  assert.match(client, /address: "127\.0\.0\.1"/)
  assert.match(client, /ca: await readFile\(config\.caFile\)/)
  assert.match(client, /redirect: "manual"/)
  assert.doesNotMatch(client, /rejectUnauthorized:\s*false/)
  assert.doesNotMatch(client, /NODE_TLS_REJECT_UNAUTHORIZED/)
})

test("F0-E2E2 never passes or emits the Application credential as metadata", () => {
  const credential = `llmm_t4_${"a".repeat(18)}_${"b".repeat(43)}`
  const result = spawnSync(process.execPath, [`${clientRoot}/client.mjs`], {
    encoding: "utf8",
    env: { LANG: "C", LC_ALL: "C", PATH: process.env.PATH ?? "" },
    input: JSON.stringify({
      apiKey: credential,
      baseUrl: "https://unapproved.invalid/v1",
      caFile: "/unavailable",
      model: "fixture-model",
      prompt: "bounded negative test",
    }),
  })
  assert.notEqual(result.status, 0)
  assert.equal(`${result.stdout}${result.stderr}`.includes(credential), false)
  assert.doesNotMatch(client, /console\.(?:log|error)|process\.argv\[2\]/)
})

test("F0-E2E2 remains founder functional evidence only", () => {
  assert.equal(evidence.workPackage, "F0-E2E2")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.externalClient.package, "openai")
  assert.match(evidence.status, /awaiting-protected-uat-replay/)
  assert.match(evidence.nextPackage, /^F0-UX2/)
  assert.ok(evidence.notEvidenceFor.some((value) => value.includes("Q0")))
  assert.ok(
    evidence.notEvidenceFor.some((value) =>
      value.includes("production inference capacity"),
    ),
  )
})
