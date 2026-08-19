import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  authorityOrigin,
  parseFounderUatPlacement,
} from "../pre-genesis/founder-uat-placement.mjs"

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
  assert.match(browser, /async function eventually\(check, timeout = 10_000\)/)
  assert.match(
    browser,
    /Product edge readiness failed:[\s\S]*probe=[\s\S]*logs=/,
  )
  assert.match(browser, /const edgeUid = process\.getuid\?\.\(\)/)
  assert.match(browser, /const edgeGid = process\.getgid\?\.\(\)/)
  assert.match(browser, /"--user",\n {4}edgeIdentity/)
  assert.match(
    browser,
    /Product edge mount is unreadable by its native identity/,
  )
  assert.match(browser, /mode=0700/)
  assert.doesNotMatch(browser, /--cap-add/)
  assert.match(browser, /\.State\.Status.*\.State\.ExitCode/)
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
  assert.match(browser, /WEB_CONSOLE_ORIGIN: consoleOrigin/)
  assert.equal(
    browser.match(
      /proveKeycloakIdentityCookieBoundary\(\{\n {8}certificate,\n {8}context,\n {8}edgePort,/g,
    )?.length,
    2,
  )
  assert.match(
    browser,
    /const unsupported = await requestHttpsEdgeWithHeaders\(\{[\s\S]*path: "\/v2\/crawl"/,
  )
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

test("F0-UAT0 keeps every retained native service behind the private edge", () => {
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
  assert.match(browser, /grafana\.llmm\.test/)
  assert.match(browser, /keycloak\.llmm\.test/)
  assert.match(browser, /litellm\.llmm\.test/)
  assert.match(browser, /"keycloak-upstream"/)
  assert.match(browser, /"grafana-upstream"/)
  assert.match(browser, /"litellm-upstream"/)
  assert.match(browser, /"sglang-or-inference-double"/)
  assert.match(integrated, /F0_UAT0_PLACEMENT_FILE/)
  assert.match(browser, /edgeBindAddress/)
  assert.match(browser, /publicOrigin\("identity", edgePort\)/)
  assert.match(browser, /ignoreHTTPSErrors: !founderUatPlacement/)
  assert.doesNotMatch(operator, /0\.0\.0\.0|--publish|docker\.io/)
})

test("F0-UAT0 validates one private edge and seven canonical deployment authorities", () => {
  const placement = parseFounderUatPlacement({
    authorities: {
      api: "https://api.lab.llm-machines.com",
      console: "https://console.lab.llm-machines.com",
      firecrawl: "https://firecrawl.lab.llm-machines.com",
      grafana: "https://grafana.lab.llm-machines.com",
      identity: "https://identity.lab.llm-machines.com",
      keycloak: "https://keycloak.lab.llm-machines.com",
      litellm: "https://litellm.lab.llm-machines.com",
    },
    edgeBindAddress: "192.168.42.10",
    edgePort: 18443,
    schemaVersion: 1,
    tls: {
      caFile: "/run/llm-machines/edge/ca.crt",
      certificateFile: "/run/llm-machines/edge/edge.crt",
      privateKeyFile: "/run/llm-machines/edge/edge.key",
    },
  })
  assert.equal(placement.edgeBindAddress, "192.168.42.10")
  assert.equal(placement.edgePort, 18443)
  assert.equal(
    authorityOrigin(placement, "console", 65535),
    "https://console.lab.llm-machines.com",
  )
  assert.equal(
    authorityOrigin(null, "console", 18443),
    "https://console.llmm.test:18443",
  )

  for (const mutation of [
    { edgeBindAddress: "127.0.0.1" },
    { edgeBindAddress: "0.0.0.0" },
    { edgeBindAddress: "203.0.113.10" },
    {
      authorities: {
        ...placement.authorities,
        api: "http://api.lab.llm-machines.com",
      },
    },
    {
      authorities: {
        ...placement.authorities,
        api: "https://api.lab.llm-machines.com:8443",
      },
    },
    {
      authorities: {
        ...placement.authorities,
        api: placement.authorities.console,
      },
    },
  ]) {
    assert.throws(() =>
      parseFounderUatPlacement({
        ...placement,
        ...mutation,
      }),
    )
  }
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
