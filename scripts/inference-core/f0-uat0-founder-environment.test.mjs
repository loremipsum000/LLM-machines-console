import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const read = (path) => readFileSync(path, "utf8")
const browser = read("scripts/pre-genesis/reduced-core-browser-session.mjs")
const firecrawl = read(
  "scripts/pre-genesis/reduced-core-firecrawl-integration.mjs",
)
const integrated = read("scripts/pre-genesis/reduced-core-integrated.mjs")
const operator = read("scripts/pre-genesis/reduced-core-uat.mjs")
const evidence = JSON.parse(
  read("docs/reduction/inference-core/f0-uat0-founder-environment.json"),
)

test("F0-UAT0 exposes one explicit start, status, and stop contract", () => {
  assert.match(
    operator,
    /supportedCommands = new Set\(\["start", "status", "stop"\]\)/,
  )
  assert.match(operator, /F0_UAT0_KEEP_RUNNING: "true"/)
  assert.match(integrated, /--keep-running/)
  assert.match(
    integrated,
    /browserState: keepRunning\s+\? join\(stateRoot, `llmm-f0-c1-browser-\$\{runId\}`\)/,
  )
  assert.match(
    integrated,
    /F0_C1_BROWSER_TEMP_ROOT: keepRunning \? stateRoot : browserTemporaryRoot/,
  )
  assert.match(
    integrated,
    /if \(!keepRunning\) await postAlert\(alertmanagerBaseUrl\)/,
  )
  assert.match(integrated, /sub_filter '__LLMM_DYNAMIC_IDLE__' '\$msec'/)
  assert.match(integrated, /sub_filter_types text\/plain/)
  assert.match(
    integrated,
    /cpu="0"[^\n]+__LLMM_DYNAMIC_IDLE__[\s\S]+cpu="1"[^\n]+ 1000/,
  )
  assert.match(browser, /ADMIN_GRAFANA_BASE_URL:/)
  assert.match(browser, /async function waitForFounderHealthyCpu\(/)
  assert.match(browser, /latestValue < 85/)
  assert.match(browser, /xpath=ancestor::section\[1\]/)
  assert.doesNotMatch(browser, /cpu\.getByText\("50%"/)
  assert.match(browser, /async function openApplicationCreate\(/)
  assert.match(
    browser,
    /assert\.equal\(new URL\(page\.url\(\)\)\.pathname, "\/applications\/apps\/new"\)/,
  )
  assert.doesNotMatch(
    browser,
    /assert\.equal\(new URL\(page\.url\(\)\)\.pathname, "\/applications"\)\n\s+await page\.goto\(`\$\{consoleOrigin\}\/applications\/apps\/new`\)/,
  )
  assert.match(browser, /founderUat: Boolean\(founderUatControl\)/)
  assert.match(browser, /actual-private-no-synthetic-alert/)
  assert.match(
    browser,
    /persistenceOperatorPage = await persistenceOperatorContext\.newPage\(\)\n {6}await synchronizeFixtureClock\(\)\n {6}await signIn\(/,
  )
  assert.match(browser, /status: "READY"/)
  assert.match(browser, /founderUatControl \? "start" : "dev"/)
  assert.match(
    browser,
    /if \(founderUatControl\) \{\n {6}await buildFounderWebProject\(webRoot, webEnvironment, stateRoot\)/,
  )
  assert.match(
    browser,
    /NODE_ENV: founderUatControl \? "production" : "development"/,
  )
  assert.match(
    browser,
    /while \(!\(await exists\(founderUatControl\.stopFile\)\)\)/,
  )
  const founderHandoffs = [
    ...browser.matchAll(/await holdFounderUat\(\{([\s\S]*?)\n {8}\}\)/g),
  ]
  assert.equal(founderHandoffs.length, 2)
  for (const handoff of founderHandoffs) {
    assert.match(handoff[1], /synchronizeClock: synchronizeFixtureClock/)
  }
  const founderHold = browser.slice(
    browser.indexOf("async function holdFounderUat({"),
    browser.indexOf("function founderCredential("),
  )
  assert.match(founderHold, /await synchronizeClock\(\)[\s\S]*status: "READY"/)
  assert.match(
    founderHold,
    /while \(!\(await exists\(founderUatControl\.stopFile\)\)\) \{\n {4}await synchronizeClock\(\)/,
  )
  const integratedHandover = browser.slice(
    browser.indexOf(
      "if (integratedCoreMode) {\n      assert.ok(persistenceOperatorContext)",
    ),
    browser.indexOf("const sharedCookie ="),
  )
  assert.match(integratedHandover, /await holdFounderUat\(\{/)
  assert.ok(
    integratedHandover.indexOf("await holdFounderUat({") <
      integratedHandover.indexOf("const cleanup = await Promise.allSettled"),
  )
})

test("F0-UAT0 keeps the customer edge private and native services unavailable", () => {
  assert.match(integrated, /keep-running mode requires native Linux\/amd64/)
  assert.match(integrated, /PRE_GENESIS_DOCKER_CONTEXT: "default"/)
  assert.match(
    integrated,
    /if \(nativeAmd64\) \{\n {4}if \(value !== "default"\)/,
  )
  assert.match(integrated, /\^colima-llmm-f0-f2-\[a-f0-9\]\{16\}\$/)
  assert.match(firecrawl, /process\.platform !== "linux"/)
  assert.match(firecrawl, /process\.arch !== "x64"/)
  assert.match(browser, /console\.llmm\.test/)
  assert.match(browser, /api\.llmm\.test/)
  assert.match(browser, /identity\.llmm\.test/)
  assert.match(browser, /firecrawl\.llmm\.test/)
  assert.match(browser, /"keycloak-admin"/)
  assert.match(browser, /"sglang-or-inference-double"/)
  assert.doesNotMatch(operator, /0\.0\.0\.0|--publish|docker\.io/)
})

test("F0-UAT0 separates restricted credentials from normal operator output", () => {
  assert.match(browser, /flag: "wx", mode: 0o600/)
  assert.match(browser, /credentialFile: founderUatControl\.credentialFile/)
  assert.match(
    operator,
    /credentialMode: credentialMode === null \? null : "0600"/,
  )
  assert.doesNotMatch(operator, /readFile\(paths\.credentials/)
  assert.doesNotMatch(operator, /otpSecret:|password:|bffService|oidcClient/)
  assert.match(operator, /assertNoOwnedRuntimeRemains/)
  assert.match(operator, /label=com\.llm-machines\.test-package=F0-C1/)
})

test("F0-UAT0 status is safe before the environment exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "llmm-f0-uat0-status-"))
  const controlRoot = join(root, "not-started")
  try {
    const result = spawnSync(
      process.execPath,
      ["scripts/pre-genesis/reduced-core-uat.mjs", "status"],
      {
        encoding: "utf8",
        env: { ...process.env, F0_UAT0_CONTROL_ROOT: controlRoot },
      },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), {
      controlRoot,
      status: "NOT_STARTED",
    })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("F0-UAT0 remains pre-Genesis functional evidence only", () => {
  assert.equal(evidence.workPackage, "F0-UAT0")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.match(evidence.nextPackage, /^F0-E2E2/)
  assert.ok(evidence.notEvidenceFor.some((value) => value.includes("Q0")))
  assert.ok(
    evidence.notEvidenceFor.some((value) =>
      value.includes("production inference capacity"),
    ),
  )
})
