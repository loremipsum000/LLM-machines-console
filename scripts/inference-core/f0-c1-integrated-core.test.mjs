import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(path, "utf8")
const evidence = JSON.parse(
  read("docs/reduction/inference-core/f0-c1-integrated-reduced-core.json"),
)
const browser = read("scripts/pre-genesis/reduced-core-browser-session.mjs")
const integrated = read("scripts/pre-genesis/reduced-core-integrated.mjs")
const sessionFixture = read(
  "scripts/pre-genesis/reduced-core-session-bff-fixture.mts",
)

test("F0-C1 has one bounded disposable command", () => {
  assert.equal(
    evidence.command,
    "node scripts/pre-genesis/reduced-core-integrated.mjs",
  )
  assert.match(integrated, /buildWorkspaceFixturePackages\(\)/)
  assert.match(integrated, /await preserveWorkspaceBuildArtifacts\(\)/)
  assert.match(integrated, /await restoreWorkspaceBuildArtifacts\(\)/)
  assert.ok(
    integrated.indexOf("await preserveWorkspaceBuildArtifacts()") <
      integrated.indexOf("buildWorkspaceFixturePackages()"),
  )
  assert.match(integrated, /LOCAL_INTEGRATED_REDUCED_CORE_ONLY/)
  assert.match(integrated, /reduced-core-firecrawl-integration\.mjs/)
  assert.match(integrated, /reduced-core-keycloak-identity\.mjs/)
  assert.match(integrated, /reduced-core-litellm-integration\.mjs/)
  assert.match(integrated, /infra\/migrations\/0000_inference_core\.sql/)
  assert.match(integrated, /const prometheusHostPort = await reservePort\(\)/)
  assert.doesNotMatch(integrated, /127\.0\.0\.1:(?::|0:)/)
  assert.match(integrated, /uid=65534,gid=65534,mode=0750/)
  assert.match(integrated, /uid=472,gid=0,mode=0750/)
  assert.match(integrated, /files\.grafanaProvisioning/)
  assert.doesNotMatch(
    integrated,
    /target=\/etc\/grafana\/provisioning\/dashboards\/baseline/,
  )
  const metricsFixture = integrated.slice(
    integrated.indexOf("async function startMetricsFixture"),
    integrated.indexOf("function metricsPayload"),
  )
  assert.match(metricsFixture, /metrics-fixture/)
  assert.match(metricsFixture, /images\["product-edge"\]/)
  assert.doesNotMatch(metricsFixture, /--publish/)
  assert.match(integrated, /sample\.value\[1\] === "1"/)
  assert.doesNotMatch(integrated, /host\.docker\.internal/)
  assert.doesNotMatch(integrated, /server\.listen\(0, "0\.0\.0\.0"/)
})

test("F0-C1 retains the approved customer and private-service boundary", () => {
  for (const value of [
    "console.llmm.test",
    "api.llmm.test",
    "identity.llmm.test",
    "firecrawl.llmm.test",
  ]) {
    assert.match(browser, new RegExp(value.replaceAll(".", "\\.")))
  }
  for (const value of [
    "grafana.llmm.test",
    "keycloak.llmm.test",
    "litellm.llmm.test",
    "postgres.llmm.test",
  ]) {
    assert.match(browser, new RegExp(value.replaceAll(".", "\\.")))
  }
  assert.match(browser, /spoofedCredentialAndForwardingHeadersDenied/)
  assert.match(browser, /observabilityMode && !integratedCoreMode/)
  assert.match(browser, /keycloakIdentityMode && !integratedCoreMode/)
  assert.match(browser, /if \(postgresBackedMode\)/)
  assert.match(sessionFixture, /PRE_GENESIS_FIRECRAWL_ACTUAL/)
  assert.match(integrated, /readFile\(service\.stdoutPath, "utf8"\)/)
  assert.match(integrated, /readFile\(service\.stderrPath, "utf8"\)/)
  assert.match(integrated, /keycloakControl\.container/)
  assert.match(integrated, /liteLlmControl\.container/)
  assert.match(
    integrated,
    /assertNoSensitive\(\[logs\.stdout, logs\.stderr\], sensitiveValues\)/,
  )
  assert.doesNotMatch(integrated, /Customer.*Grafana|native LiteLLM access/i)
})

test("F0-C1 is functional evidence only and keeps the terminal sequence", () => {
  assert.equal(evidence.workPackage, "F0-C1")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.match(evidence.nextPackage, /^F0-SG1/)
  assert.ok(evidence.notEvidenceFor.some((value) => value.includes("SGLang")))
  assert.ok(
    evidence.notEvidenceFor.some((value) => value.includes("Product Nginx")),
  )
})

test("F0-C1 resolves retained images from the immutable Core inventory", () => {
  assert.match(integrated, /core-image-inventory\.json/)
  assert.match(integrated, /component\.indexDigest/)
  assert.doesNotMatch(integrated, /:[Ll][Aa][Tt][Ee][Ss][Tt]\b/)
  assert.doesNotMatch(integrated, /harbor\.|10\.33\.|vm103/i)
})
