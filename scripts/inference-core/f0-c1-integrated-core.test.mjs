import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { readFileSync } from "node:fs"
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { terminateProcessGroup } from "../pre-genesis/process-group.mjs"
import { restoreWorkspaceBuildArtifacts } from "../pre-genesis/workspace-artifacts.mjs"

const read = (path) => readFileSync(path, "utf8")
const evidence = JSON.parse(
  read("docs/reduction/inference-core/f0-c1-integrated-reduced-core.json"),
)
const browser = read("scripts/pre-genesis/reduced-core-browser-session.mjs")
const firecrawl = read(
  "scripts/pre-genesis/reduced-core-firecrawl-integration.mjs",
)
const integrated = read("scripts/pre-genesis/reduced-core-integrated.mjs")
const keycloak = read("scripts/pre-genesis/reduced-core-keycloak-identity.mjs")
const liteLlm = read("scripts/pre-genesis/reduced-core-litellm-integration.mjs")
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
  assert.match(integrated, /await restoreWorkspaceBuildArtifacts\(/)
  assert.ok(
    integrated.indexOf("await preserveWorkspaceBuildArtifacts()") <
      integrated.indexOf("buildWorkspaceFixturePackages()"),
  )
  assert.match(integrated, /LOCAL_INTEGRATED_REDUCED_CORE_ONLY/)
  assert.match(integrated, /reduced-core-firecrawl-integration\.mjs/)
  assert.match(integrated, /reduced-core-keycloak-identity\.mjs/)
  assert.match(integrated, /reduced-core-litellm-integration\.mjs/)
  assert.match(integrated, /infra\/migrations\/0000_inference_core\.sql/)
  assert.match(
    integrated,
    /"pg_isready",\s+"--host",\s+"127\.0\.0\.1",\s+"--port",\s+"5432"/,
  )
  assert.match(integrated, /if \(!postgresReady\) \{/)
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
  assert.match(metricsFixture, /target=\/tmp\/llmm-nginx\.conf,readonly/)
  assert.match(metricsFixture, /target=\/tmp\/metrics,readonly/)
  assert.doesNotMatch(metricsFixture, /target=\/etc\/llmm/)
  assert.match(integrated, /sample\.value\[1\] === "1"/)
  assert.doesNotMatch(integrated, /host\.docker\.internal/)
  assert.doesNotMatch(integrated, /server\.listen\(0, "0\.0\.0\.0"/)
  assert.doesNotMatch(liteLlm, /host\.docker\.internal/)
  assert.doesNotMatch(liteLlm, /upstream\.listen\(0, "0\.0\.0\.0"/)
  assert.equal(liteLlm.match(/"--publish"/g)?.length, 1)
  assert.match(liteLlm, /`127\.0\.0\.1:\$\{liteLlmPort\}:4000`/)
  assert.match(liteLlm, /"--network-alias",\s+"inference-double"/)
  assert.match(liteLlm, /"--log-driver",\s+"none"/)
  assert.match(integrated, /F0_C1_FIRECRAWL_RUN_ID: runId/)
  assert.match(
    integrated,
    /assert\.equal\(dockerContext, firecrawlDockerContext\)/,
  )
  assert.match(integrated, /detached: true/)
  assert.match(integrated, /process\.kill\(-service\.child\.pid, signal\)/)
  assert.match(integrated, /cleanupFirecrawlProfile/)
  assert.match(integrated, /colima", \["list", "--json"\]/)
  assert.match(integrated, /F0_C1_SERVICE_STATE_ROOT: files\.firecrawlState/)
  assert.match(integrated, /F0_C1_BROWSER_STATE_ROOT: files\.browserState/)
  assert.match(
    integrated,
    /F0_C1_BROWSER_TEMP_ROOT: keepRunning \? stateRoot : browserTemporaryRoot/,
  )
  assert.match(integrated, /terminationPromise = terminateProcessGroup/)
  assert.match(integrated, /await rename\(pending, backup\)/)
  assert.ok(
    integrated.indexOf("await rename(pending, backup)") <
      integrated.indexOf("workspaceBuildSnapshot.push"),
  )
  assert.match(integrated, /let workspaceArtifactsRestored = false/)
  assert.match(integrated, /if \(workspaceArtifactsRestored\) \{/)
  assert.match(integrated, /workspace recovery backup is unavailable/)
  assert.match(firecrawl, /controlledRunIdFromEnvironment/)
  assert.match(firecrawl, /F0_C1_SERVICE_STATE_ROOT/)
  assert.doesNotMatch(browser, /identityEpochMilliseconds|otpSecret|#otp/)
  assert.match(browser, /proveKeycloakOutageRecovery\(\{/)
  assert.match(browser, /controlledConsoleState: true/)
  assert.match(browser, /restartPortStable: true/)
  assert.match(browser, /F0_C1_BROWSER_STATE_ROOT/)
  assert.match(browser, /const detached = !integratedCoreMode/)
  assert.match(browser, /dockerControl\(keycloakControl/)
  assert.match(browser, /keycloakControl\.container/)
  assert.match(
    integrated,
    /"reduced-core-keycloak-identity\.mjs",\n {4}\["--team"\]/,
  )
  assert.match(integrated, /keycloakControl\.credentials\.humanAdmin/)
  assert.match(
    keycloak,
    /databaseUrl = serviceControl \? null : await startPostgres\(\)/,
  )
  assert.match(keycloak, /const upstreamPort = await reservePort\(\)/)
  assert.match(keycloak, /`127\.0\.0\.1:\$\{upstreamPort\}:8080`/)
  assert.match(keycloak, /await waitForKeycloak\(upstreamPort\)/)
  assert.doesNotMatch(keycloak, /127\.0\.0\.1::8080/)
  assert.match(keycloak, /loginTheme: "llm-machines"/)
  assert.match(keycloak, /ssoSessionIdleTimeout: 28800/)
  assert.match(keycloak, /ssoSessionMaxLifespan: 86400/)
  assert.match(keycloak, /themeRoot/)
  assert.match(keycloak, /\/opt\/keycloak\/themes\/llm-machines/)
  assert.match(browser, /keycloakTeamMode \|\| integratedCoreMode/)
  assert.match(browser, /containers: config\.containers/)
  assert.match(browser, /!\/\^\[a-f0-9\]\{64\}\$\/\.test\(container\)/)
  assert.match(
    browser,
    /Settings did not project the actual private Firecrawl service as reachable/,
  )
  assert.match(
    browser,
    /assertIntegratedTeamProjection\(page, consoleOrigin, true\)/,
  )
  assert.match(
    browser,
    /assertIntegratedTeamProjection\(\s*persistenceOperatorPage,\s*consoleOrigin,\s*false,\s*\)/,
  )
  assert.match(browser, /synchronizeClock: synchronizeFixtureClock/)
  const finalIdentitySwitch = browser.slice(
    browser.indexOf("if (integratedCoreMode)"),
    browser.indexOf("postgresPersistenceEvidence = inspectPostgresPersistence"),
  )
  const finalClockSync = finalIdentitySwitch.lastIndexOf(
    "await synchronizeFixtureClock()",
  )
  const finalOperatorSignIn = finalIdentitySwitch.lastIndexOf(
    'await signIn(page, consoleOrigin, credentials.operator, "/applications")',
  )
  assert.ok(finalClockSync >= 0)
  assert.ok(finalOperatorSignIn > finalClockSync)
  for (const source of [browser, firecrawl, integrated, keycloak, liteLlm]) {
    assert.doesNotMatch(source, /const deadline = Date\.now\(\)/)
    assert.doesNotMatch(source, /Date\.now\(\) < deadline/)
  }
})

test(
  "F0-C1 force-kills descendants after the browser group leader exits",
  { timeout: 5_000 },
  async () => {
    const descendant =
      'process.on("SIGTERM",()=>{});process.stdout.write("ready\\n");setInterval(()=>{},1000)'
    const leaderSource = `const {spawn}=require("node:child_process");const child=spawn(process.execPath,["-e",${JSON.stringify(descendant)}],{stdio:["ignore","pipe","ignore"]});child.stdout.once("data",()=>process.stdout.write("ready\\n"));process.on("SIGTERM",()=>process.exit(0));setInterval(()=>{},1000)`
    const leader = spawn(process.execPath, ["-e", leaderSource], {
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    })
    const pid = leader.pid
    assert.ok(pid)
    try {
      await once(leader.stdout, "data")
      assert.equal(
        await terminateProcessGroup(pid, {
          forceWaitMilliseconds: 2_000,
          graceMilliseconds: 100,
          pollMilliseconds: 10,
        }),
        true,
      )
      assert.throws(
        () => process.kill(-pid, 0),
        (error) => error?.code === "ESRCH",
      )
    } finally {
      try {
        process.kill(-pid, "SIGKILL")
      } catch (error) {
        assert.ok(error?.code === "ESRCH" || error?.code === "EPERM")
      }
    }
  },
)

test("F0-C1 keeps the complete backup when atomic restore fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "llmm-f0-c1-restore-test-"))
  const artifact = join(root, "workspace", "contracts-dist")
  const backup = join(root, "backup", "contracts-dist")
  const runId = "0123456789abcdef"
  try {
    await mkdir(artifact, { recursive: true })
    await mkdir(backup, { recursive: true })
    await writeFile(join(artifact, "value"), "generated")
    await writeFile(join(backup, "value"), "pre-existing")
    let injected = false
    await assert.rejects(
      restoreWorkspaceBuildArtifacts(
        [{ backup, existed: true, path: artifact }],
        {
          operations: {
            cp,
            rename: async (source, destination) => {
              if (
                !injected &&
                source.endsWith(`.llmm-f0-c1-restore-${runId}`)
              ) {
                injected = true
                throw Object.assign(new Error("injected restore failure"), {
                  code: "EIO",
                })
              }
              await rename(source, destination)
            },
            rm,
          },
          runId,
        },
      ),
      /injected restore failure/,
    )
    assert.equal(await readFile(join(backup, "value"), "utf8"), "pre-existing")
    assert.equal(await readFile(join(artifact, "value"), "utf8"), "generated")
    await restoreWorkspaceBuildArtifacts(
      [{ backup, existed: true, path: artifact }],
      { runId },
    )
    assert.equal(
      await readFile(join(artifact, "value"), "utf8"),
      "pre-existing",
    )
    assert.equal(await readFile(join(backup, "value"), "utf8"), "pre-existing")
  } finally {
    await rm(root, { force: true, recursive: true })
  }
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
  assert.match(
    browser,
    /for \(const service of \["grafana", "keycloak", "litellm", "postgres"\]\)/,
  )
  assert.match(browser, /const authority = deniedNativeAuthority\(service\)/)
  assert.match(
    browser,
    /const \[, \.\.\.suffix\] = authorities\.console\.split/,
  )
  assert.match(
    browser,
    /headers: \{ host: deniedAuthorityHost\(authority, edgePort\) \}/,
  )
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
