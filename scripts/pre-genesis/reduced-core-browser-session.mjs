import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import {
  X509Certificate,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto"
import { createWriteStream, readFileSync } from "node:fs"
import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import {
  createServer as createHttpServer,
  request as httpRequest,
} from "node:http"
import {
  createServer as createHttpsServer,
  request as httpsRequest,
} from "node:https"
import { tmpdir } from "node:os"
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"
import { evaluateSourceBoundary } from "../../infra/ingress/source-no-bypass.mjs"
import { createOidcFixture } from "./reduced-core-oidc-fixture.mjs"

const integratedCoreMode = process.argv.includes("--integrated-core")
const keycloakTeamMode = process.argv.includes("--keycloak-team")
const keycloakIdentityMode =
  process.argv.includes("--keycloak-identity") ||
  keycloakTeamMode ||
  integratedCoreMode
const postgresPersistenceMode = process.argv.includes("--postgres-persistence")
const postgresBackedMode =
  postgresPersistenceMode || keycloakTeamMode || integratedCoreMode
const observabilityMode =
  process.argv.includes("--observability") || integratedCoreMode
const liteLlmIntegrationMode =
  process.argv.includes("--litellm") || integratedCoreMode
const credentialLifecycleMode =
  process.argv.includes("--credential-lifecycle") ||
  postgresPersistenceMode ||
  integratedCoreMode
const applicationsMode =
  process.argv.includes("--applications") ||
  credentialLifecycleMode ||
  liteLlmIntegrationMode
const supportedModes = new Set([
  "--applications",
  "--credential-lifecycle",
  "--observability",
  "--postgres-persistence",
  "--keycloak-identity",
  "--keycloak-team",
  "--litellm",
  "--integrated-core",
])
const selectedModes = process.argv.slice(2)

if (
  selectedModes.some((argument) => !supportedModes.has(argument)) ||
  new Set(selectedModes).size !== selectedModes.length ||
  selectedModes.length > 1
) {
  throw new Error(
    "Usage: reduced-core-browser-session.mjs [--applications|--credential-lifecycle|--observability|--postgres-persistence|--keycloak-identity|--keycloak-team|--litellm|--integrated-core]",
  )
}

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const keycloakControl = keycloakIdentityMode
  ? keycloakControlFromEnvironment()
  : null
const postgresControl = postgresBackedMode
  ? postgresControlFromEnvironment()
  : null
const liteLlmControl = liteLlmIntegrationMode
  ? liteLlmControlFromEnvironment()
  : null
const firecrawlControl = integratedCoreMode
  ? integratedFirecrawlControlFromEnvironment()
  : null
const integratedObservabilityControl = integratedCoreMode
  ? integratedObservabilityControlFromEnvironment()
  : null
const founderUatControl = integratedCoreMode
  ? founderUatControlFromEnvironment()
  : null
const initialTime = integratedCoreMode
  ? new Date()
  : applicationsMode
    ? new Date(Date.now() - 10 * 60 * 1000)
    : keycloakIdentityMode
      ? new Date()
      : new Date("2026-08-05T10:00:00.000Z")
const authorities = {
  api: "api.llmm.test",
  console: "console.llmm.test",
  firecrawl: "firecrawl.llmm.test",
  identity: "identity.llmm.test",
}
const consolePaths = [
  ["/", "Overview"],
  ["/applications", "Applications"],
  ["/inference", "Inference"],
  ["/hardware", "Hardware"],
  ["/team", "Team"],
  ["/activity", "Activity & Audit"],
  ["/settings", "Settings"],
]
const evidence = await runBrowserSessionProof()
process.stdout.write(`${JSON.stringify(evidence)}\n`)

async function runBrowserSessionProof() {
  await assertDevelopmentDependenciesReady()
  const stateRoot = await createTemporaryStateRoot()
  const children = []
  const servers = []
  let browser
  let page
  let currentTime = new Date(initialTime)
  let evidence
  let failure
  let oidc
  let postgresOutageEvidence = null
  let postgresPersistenceEvidence = null
  const sensitiveValues = []
  const browserResponses = []
  const identityFixtureFailures = []
  const observedOrigins = []
  const tlsErrors = []
  try {
    await chmod(stateRoot, 0o700)
    const [
      bffPort,
      webPort,
      inferencePort,
      firecrawlPort,
      prometheusPort,
      alertmanagerPort,
    ] = await reservePorts(observabilityMode ? 6 : 4)
    const edgePort = keycloakControl?.edgePort ?? (await browserSafePort())
    const clockFile = join(stateRoot, "clock.txt")
    await writeFile(clockFile, `${currentTime.toISOString()}\n`, {
      mode: 0o600,
    })
    const certificate = await createCertificate(stateRoot)
    const webRoot = await prepareTemporaryWebProject(stateRoot)
    const observabilityTokenFile = join(stateRoot, "f0-o1-observability-token")
    const consoleOrigin = `https://${authorities.console}:${edgePort}`
    const identityIssuer = `https://${authorities.identity}:${edgePort}/realms/llm-machines`
    const credentials = keycloakControl
      ? {
          ...keycloakControl.credentials,
          liteLlm: liteLlmControl?.routingKey ?? opaqueValue(),
          observability: opaqueValue(),
        }
      : {
          admin: user("admin"),
          operator: user("operator"),
          bffService: opaqueValue(),
          liteLlm: liteLlmControl?.routingKey ?? opaqueValue(),
          oidcClient: opaqueValue(),
          observability: opaqueValue(),
        }
    if (observabilityMode && !integratedCoreMode) {
      await writeFile(
        observabilityTokenFile,
        `${credentials.observability}\n`,
        { mode: 0o600 },
      )
    }
    const observabilityCanaries = observabilityMode
      ? {
          alertLabel: `f0o1-alert-${opaqueValue()}`,
          liteLlmCredential: `sk-f0o1-${opaqueValue()}`,
          workload: `f0o1-workload-${opaqueValue()}`,
        }
      : null
    const retentionCanaries =
      liteLlmControl?.canaries ??
      (postgresBackedMode
        ? {
            prompt: `f0p1-prompt-${opaqueValue()}`,
            request: `f0p1-request-${opaqueValue()}`,
            response: `f0p1-response-${opaqueValue()}`,
            secret: `f0p1-secret-${opaqueValue()}`,
          }
        : null)
    const sessionKeyMaterial = postgresBackedMode
      ? randomBytes(32).toString("base64")
      : null
    const sessionKeyringFile = join(stateRoot, "f0-p1-session-keyring.json")
    if (sessionKeyMaterial) {
      await writeFile(
        sessionKeyringFile,
        `${JSON.stringify({
          activeKid: "f0-p1-throwaway",
          keys: [
            {
              kid: "f0-p1-throwaway",
              material: sessionKeyMaterial,
              status: "active",
            },
          ],
          version: 1,
        })}\n`,
        { mode: 0o600 },
      )
      sensitiveValues.push(
        credentials.admin.password,
        credentials.admin.otpSecret,
        credentials.operator.password,
        credentials.operator.otpSecret,
        credentials.bffService,
        credentials.liteLlm,
        credentials.oidcClient,
        sessionKeyMaterial,
        decodeURIComponent(new URL(postgresControl.databaseUrl).password),
        ...Object.values(retentionCanaries),
      )
    }
    if (observabilityCanaries) {
      sensitiveValues.push(
        credentials.liteLlm,
        credentials.observability,
        ...Object.values(observabilityCanaries),
      )
    }
    if (liteLlmControl) {
      sensitiveValues.push(
        liteLlmControl.adminKey,
        liteLlmControl.routingKey,
        ...Object.values(liteLlmControl.canaries),
      )
    }
    if (firecrawlControl) {
      sensitiveValues.push(...Object.values(firecrawlControl.canaries))
    }
    const clientId = "console-web"
    const audience = "console-bff"
    oidc = keycloakControl
      ? keycloakControl
      : createOidcFixture({
          audience,
          clientId,
          clientSecret: credentials.oidcClient,
          issuer: identityIssuer,
          now: () => new Date(currentTime),
          redirectUri: `${consoleOrigin}/api/console/session/callback`,
          users: { admin: credentials.admin, operator: credentials.operator },
        })
    if (keycloakIdentityMode && !integratedCoreMode) {
      sensitiveValues.push(
        credentials.admin.password,
        credentials.operator.password,
        credentials.bffService,
        ...(keycloakTeamMode ? [credentials.humanAdmin] : []),
        credentials.liteLlm,
        credentials.oidcClient,
      )
    }

    const inferenceControl = liteLlmControl
      ? null
      : { available: true, requests: [] }
    if (inferenceControl) {
      const inference = createInferenceDouble(
        credentials.liteLlm,
        retentionCanaries?.response ?? "fixture-response",
        inferenceControl,
        observabilityCanaries,
      )
      servers.push(inference)
      await listen(inference, inferencePort)
    }
    if (!integratedCoreMode) {
      const firecrawl = createFirecrawlDouble()
      servers.push(firecrawl)
      await listen(firecrawl, firecrawlPort)
    }
    const prometheusControl = observabilityMode
      ? { available: true, requests: [] }
      : null
    const alertmanagerControl = observabilityMode
      ? { available: true, requests: [] }
      : null
    if (
      observabilityMode &&
      !integratedCoreMode &&
      prometheusControl &&
      alertmanagerControl &&
      prometheusPort &&
      alertmanagerPort
    ) {
      const prometheus = createPrometheusDouble(
        credentials.observability,
        prometheusControl,
      )
      const alertmanager = createAlertmanagerDouble(
        credentials.observability,
        alertmanagerControl,
        observabilityCanaries,
      )
      servers.push(prometheus, alertmanager)
      await Promise.all([
        listen(prometheus, prometheusPort),
        listen(alertmanager, alertmanagerPort),
      ])
    }

    const bffEnvironment = {
      BFF_FALLBACK_MODELS: "fixture-model",
      BFF_FIXTURE_MODE: "true",
      BFF_SERVICE_API_KEY: credentials.bffService,
      ...(observabilityMode && prometheusPort && alertmanagerPort
        ? {
            ADMIN_ALERTMANAGER_BASE_URL:
              integratedObservabilityControl?.alertmanagerBaseUrl ??
              `http://127.0.0.1:${alertmanagerPort}`,
            ...(integratedCoreMode
              ? {}
              : {
                  ADMIN_ALERTMANAGER_BEARER_TOKEN_FILE: observabilityTokenFile,
                }),
            ADMIN_ALERTMANAGER_TIMEOUT_MS: "500",
            ...(integratedCoreMode
              ? {
                  ADMIN_GRAFANA_BASE_URL:
                    integratedObservabilityControl.grafanaBaseUrl,
                  ADMIN_GRAFANA_TIMEOUT_MS: "500",
                }
              : {}),
            ADMIN_LITELLM_API_KEY: credentials.liteLlm,
            ADMIN_LITELLM_BASE_URL:
              liteLlmControl?.baseUrl ?? `http://127.0.0.1:${inferencePort}`,
            ADMIN_LITELLM_TIMEOUT_MS: "500",
            ADMIN_PROMETHEUS_BASE_URL:
              integratedObservabilityControl?.prometheusBaseUrl ??
              `http://127.0.0.1:${prometheusPort}`,
            ...(integratedCoreMode
              ? {}
              : {
                  ADMIN_PROMETHEUS_BEARER_TOKEN_FILE: observabilityTokenFile,
                }),
            ADMIN_PROMETHEUS_TIMEOUT_MS: "500",
          }
        : {}),
      ...(applicationsMode
        ? {
            ADMIN_LITELLM_API_KEY:
              liteLlmControl?.adminKey ?? credentials.liteLlm,
            ADMIN_LITELLM_BASE_URL:
              liteLlmControl?.baseUrl ?? `http://127.0.0.1:${inferencePort}`,
          }
        : {}),
      CONNECTED_APPS_BFF_BASE_URL: `https://${authorities.api}:${edgePort}`,
      CONNECTED_APPS_KEYCLOAK_FIXTURE: "true",
      F0_S1_CA_FILE: certificate.ca,
      F0_S1_CLOCK_FILE: clockFile,
      F0_S1_CONSOLE_ORIGIN: consoleOrigin,
      F0_S1_IDENTITY_ISSUER: identityIssuer,
      F0_S1_OIDC_AUDIENCE: audience,
      F0_S1_OIDC_CLIENT_ID: clientId,
      F0_S1_OIDC_CLIENT_SECRET: credentials.oidcClient,
      ...(applicationsMode
        ? {
            FIRECRAWL_APPLIANCE_KILL_SWITCH: "false",
            FIRECRAWL_EGRESS_ALLOWED_HOSTS:
              firecrawlControl?.allowedHosts.join(",") ??
              "allowed.example.test",
            FIRECRAWL_EGRESS_ALLOWLIST_DIR:
              "/run/llm-machines/firecrawl/local-fixture",
            FIRECRAWL_EGRESS_POLICY_READY: "true",
            FIRECRAWL_INSTALLED: "true",
            FIRECRAWL_RESOURCE_PROFILE_QUALIFIED: "true",
            FIRECRAWL_UPSTREAM_BASE_URL: "http://firecrawl-api:3002",
            PRE_GENESIS_FIRECRAWL_UPSTREAM_BASE_URL: `http://127.0.0.1:${firecrawlPort}`,
            ...(firecrawlControl
              ? {
                  PRE_GENESIS_FIRECRAWL_ACTUAL: "true",
                  PRE_GENESIS_FIRECRAWL_ALLOWED_HOSTS:
                    firecrawlControl.allowedHosts.join(","),
                  PRE_GENESIS_FIRECRAWL_UPSTREAM_BASE_URL:
                    firecrawlControl.baseUrl,
                }
              : {}),
          }
        : {}),
      FIRECRAWL_PUBLIC_BASE_URL: `https://${authorities.firecrawl}:${edgePort}`,
      HOST: "127.0.0.1",
      LITELLM_KEY: credentials.liteLlm,
      LITELLM_URL:
        liteLlmControl?.baseUrl ?? `http://127.0.0.1:${inferencePort}`,
      NODE_ENV: "test",
      NODE_EXTRA_CA_CERTS: certificate.ca,
      ...(postgresControl
        ? {
            DATABASE_URL: postgresControl.databaseUrl,
            F0_P1_POSTGRES_PERSISTENCE: "true",
            F0_P1_SESSION_KEYRING_FILE: sessionKeyringFile,
          }
        : {}),
      ...(keycloakTeamMode || integratedCoreMode
        ? {
            KEYCLOAK_ADMIN_BASE_URL: keycloakControl.adminBaseUrl,
            KEYCLOAK_ADMIN_CLIENT_ID: "console-human-admin",
            KEYCLOAK_ADMIN_CLIENT_SECRET:
              keycloakControl.credentials.humanAdmin,
            KEYCLOAK_ADMIN_REALM: "llm-machines",
            TEAM_ALLOWED_EMAIL_DOMAINS: "fixture.invalid",
          }
        : {}),
      PORT: String(bffPort),
      PRODUCT_API_HOST: authorities.api,
      PRODUCT_CONSOLE_HOST: authorities.console,
      PRODUCT_FIRECRAWL_HOST: authorities.firecrawl,
      PRODUCT_IDENTITY_HOST: authorities.identity,
      PUBLIC_BFF_BASE_URL: `https://${authorities.api}:${edgePort}`,
    }
    const bffCommand = [
      process.execPath,
      resolve(repositoryRoot, "apps/bff/node_modules/tsx/dist/cli.mjs"),
      resolve(
        repositoryRoot,
        "scripts/pre-genesis/reduced-core-session-bff-fixture.mts",
      ),
    ]
    let bffChild = startChild(
      postgresBackedMode ? "bff-before-restart" : "bff",
      bffCommand,
      bffEnvironment,
      stateRoot,
      repositoryRoot,
    )
    children.push(bffChild)
    const restartBff = postgresControl
      ? async () => {
          const before = postgresSessionSnapshot()
          assert.ok(
            before.count >= 2,
            "F0-P1 requires both Admin and Operator session records before restart.",
          )
          await stopChild(bffChild)
          bffChild = startChild(
            "bff-after-restart",
            bffCommand,
            bffEnvironment,
            stateRoot,
            repositoryRoot,
          )
          children.push(bffChild)
          await waitForHttp(`http://127.0.0.1:${bffPort}/livez`, children)
          await waitForStatus(
            `http://127.0.0.1:${bffPort}/readyz`,
            200,
            children,
          )
          const after = postgresSessionSnapshot()
          assert.deepEqual(after.handles, before.handles)
          assert.equal(after.count, before.count)
          assert.equal(after.encryptedOnly, true)
          return {
            encryptedOpaqueSessions: true,
            identities: ["admin", "operator"],
            sessionCount: after.count,
            sessionHandlesStable: true,
          }
        }
      : null
    const webEnvironment = {
      CONSOLE_BFF_SERVICE_API_KEY: credentials.bffService,
      CONSOLE_BFF_URL: `http://127.0.0.1:${bffPort}`,
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: founderUatControl ? "production" : "development",
      WEB_IDENTITY_ORIGIN: `https://${authorities.identity}:${edgePort}`,
    }
    if (founderUatControl) {
      await buildFounderWebProject(webRoot, webEnvironment, stateRoot)
    }
    children.push(
      startChild(
        "web",
        [
          process.execPath,
          resolve(repositoryRoot, "apps/web/node_modules/next/dist/bin/next"),
          founderUatControl ? "start" : "dev",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(webPort),
        ],
        webEnvironment,
        stateRoot,
        webRoot,
      ),
    )

    await waitForHttp(`http://127.0.0.1:${bffPort}/livez`, children)
    await waitForHttp(`http://127.0.0.1:${webPort}/auth/signin`, children)
    const edgeInput = {
      applicationsMode,
      bffPort,
      certificate,
      edgePort,
      identityFixtureFailures,
      keycloakControl,
      observedOrigins,
      oidc,
      tlsErrors,
      webPort,
    }
    const edge = createDevelopmentEdge(edgeInput)
    servers.push(edge)
    await listen(edge, edgePort)
    const ipv6Edge = createDevelopmentEdge(edgeInput)
    if (await listenLoopbackIpv6(ipv6Edge, edgePort)) {
      servers.push(ipv6Edge)
    }
    const edgeProbe = await requestHttpsEdge(
      `https://127.0.0.1:${edgePort}/applications?q=safe`,
      `${authorities.console}:${edgePort}`,
    )
    assert.ok(edgeProbe.status >= 300 && edgeProbe.status < 400)
    assert.match(edgeProbe.location ?? "", /^https:\/\/console\.llmm\.test:/)

    const executablePath = await chromeExecutable()
    browser = await chromium.launch({
      args: [
        "--allow-insecure-localhost",
        `--host-resolver-rules=${Object.values(authorities)
          .map((host) => `MAP ${host} 127.0.0.1`)
          .join(",")}`,
        "--ignore-certificate-errors",
        `--ignore-certificate-errors-spki-list=${certificate.spki}`,
        "--no-proxy-server",
      ],
      executablePath,
      headless: true,
    })
    const context = await browser.newContext({ ignoreHTTPSErrors: true })
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: consoleOrigin,
    })
    page = await context.newPage()
    const pageErrors = []
    const browserMetadata = []
    page.on("console", (message) => browserMetadata.push(message.text()))
    page.on("pageerror", (error) => pageErrors.push(error.message))
    page.on("request", (request) => browserMetadata.push(request.url()))
    page.on("response", (response) => {
      const url = new URL(response.url())
      if (Object.values(authorities).includes(url.hostname)) {
        browserResponses.push({
          host: url.hostname,
          path: url.pathname,
          queryKeys: [...new Set(url.searchParams.keys())].sort(),
          status: response.status(),
        })
      }
    })
    const tlsProbe = await page.goto(`https://127.0.0.1:${edgePort}/`)
    assert.equal(tlsProbe?.status(), 421)

    await signIn(page, consoleOrigin, credentials.admin, "/applications?q=safe")
    assert.equal(new URL(page.url()).pathname, "/applications")
    assert.equal(new URL(page.url()).search, "?q=safe")
    await assertRole(page, "Administrator")
    await assertConsoleNavigation(page, consoleOrigin)
    await assertDesktopViewportLayout(page, consoleOrigin)

    if (keycloakTeamMode) {
      const identityFlow = await proveKeycloakIdentityCookieBoundary({
        context,
        edgePort,
      })
      const teamFlow = await proveKeycloakTeamConsoleFlow({
        bffPort,
        consoleOrigin,
        context,
        credentials,
        page,
        sensitiveValues,
      })
      const postgresEvidence = inspectKeycloakTeamPersistence(sensitiveValues)
      assert.deepEqual(pageErrors, [])
      assertNoSensitiveValues(
        browserMetadata,
        sensitiveValues,
        "browser metadata",
      )
      await page.evaluate(async () => navigator.clipboard.writeText(""))
      assert.equal(
        await page.evaluate(() => navigator.clipboard.readText()),
        "",
      )
      assertNoSensitiveValues(
        [await page.locator("body").innerText()],
        sensitiveValues,
        "final DOM",
      )
      await page.screenshot({
        path: join(stateRoot, "credential-free-final.png"),
      })
      await context.close()

      const browserVersion = browser.version()
      await browser.close()
      browser = undefined
      evidence = {
        architecture: process.arch,
        browser: { name: "Google Chrome", version: browserVersion },
        credentialMaterialPrinted: false,
        evidenceClass: "LOCAL_KEYCLOAK_TEAM_MUTATION_ONLY",
        identity: identityFlow,
        persistence: postgresEvidence,
        team: teamFlow,
        limitations: [
          "Disposable Keycloak 26.7.0 and PostgreSQL prove a local functional lane, not production commissioning, exact-Core, or Q0 qualification.",
          "The local Keycloak server uses generated throwaway identities and the native platform selected by the pinned multi-platform image.",
          "The proof translates only the already approved console-human-admin FGAP contract and does not qualify customer-native Keycloak administration.",
          "Email delivery, CSV import, arbitrary group CRUD, backup, restore, and production MFA enrollment remain outside this package.",
          "No result is release, capacity, runtime-qualification, or Product acceptance evidence.",
        ],
        proved: [
          "Admin creates an Operator through the actual Console Team UI using the canonical Operators group",
          "the isolated console-human-admin service account performs user, group-membership, and password operations through Keycloak FGAP v2 without realm or client administration authority",
          "generated passwords use the approved one-time reveal and leave subsequent DOM, browser metadata, PostgreSQL, logs, and teardown state",
          "disable and reactivation preserve the retained role and canonical group authority",
          "Operator can view Team identities but cannot reach Team mutation views or submit a mutation through its authenticated Console session",
          "the durable identity mutation journal and audit store retain approved metadata only",
          "native Keycloak administration remains denied through Product ingress",
        ],
        status: "passed",
        temporaryStateRemoved: true,
      }
      if (founderUatControl) {
        await holdFounderUat({
          caFile: certificate.ca,
          children,
          credentials,
          edgePort,
          firecrawlControl,
          keycloakControl,
          liteLlmControl,
          synchronizeClock: synchronizeFixtureClock,
        })
      }
      const cleanup = await Promise.allSettled([
        ...servers.map(closeServer),
        ...children.map(stopChild),
      ])
      const cleanupFailures = cleanup
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason)
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          cleanupFailures,
          "F0-I2 cleanup did not complete.",
        )
      }
      servers.length = 0
      children.length = 0
      await rm(sessionKeyringFile, { force: true })
      await assertStateFilesCredentialFree(stateRoot, sensitiveValues)
      await rm(stateRoot, { force: true, recursive: true })
      assert.equal(await exists(stateRoot), false)
      return evidence
    }

    if (keycloakIdentityMode && !integratedCoreMode) {
      const identityFlow = await proveKeycloakIdentityConsoleFlow({
        consoleOrigin,
        context,
        credentials,
        edgePort,
        page,
      })
      assert.deepEqual(pageErrors, [])
      assertNoSensitiveValues(
        browserMetadata,
        sensitiveValues,
        "browser metadata",
      )
      await page.evaluate(async () => navigator.clipboard.writeText(""))
      assert.equal(
        await page.evaluate(() => navigator.clipboard.readText()),
        "",
      )
      await page.screenshot({
        path: join(stateRoot, "credential-free-final.png"),
      })
      await context.close()

      const browserVersion = browser.version()
      await browser.close()
      browser = undefined
      evidence = {
        architecture: process.arch,
        browser: { name: "Google Chrome", version: browserVersion },
        credentialMaterialPrinted: false,
        evidenceClass: "LOCAL_KEYCLOAK_IDENTITY_INTEGRATION_ONLY",
        identity: identityFlow,
        limitations: [
          "Disposable Keycloak 26.7.0 is functional identity evidence, not production commissioning, exact-Core, or Q0 qualification.",
          "The local Keycloak server uses ephemeral H2 development storage, generated throwaway identities, and the native arm64 platform selected by the pinned multi-platform image.",
          "A generated local CA with browser-only trust bypass is not appliance TLS evidence.",
          "Reserved *.llmm.test aliases are loopback-only browser fixture authorities, not Product DNS constants.",
          "Refresh expiry, reuse detection, concurrency, clock skew, and identity outage remain deterministic F0-S1 evidence until synchronized-clock runtime qualification.",
          "Console identity mutations, Keycloak FGAP, commissioning, backup, and restore are not exercised.",
          "No result is Q0, release, capacity, or runtime-qualification evidence.",
        ],
        proved: [
          "actual Console Web and BFF complete Authorization Code plus PKCE login through the approved identity authority",
          "Admin and Operator authenticate with password and TOTP through the exact pinned Keycloak 26.7.0 image",
          "the Product token validator accepts the exact issuer, audience, subject, auth_time, amr, nonce, and realm-role claims",
          "Keycloak browser cookies remain identity-authority scoped while the Console receives only its opaque Product session cookie",
          "the identity route allowlist carries native login actions and static resources while native Keycloak administration remains denied",
          "logout clears local Console custody and protected navigation returns to the approved sign-in surface",
          "Admin and Operator can use retained Console navigation without Grafana, LiteLLM native UI, or Keycloak Admin UI",
          "Operator is denied Admin-only Application, Team, and audit-export controls",
        ],
        status: "passed",
        temporaryStateRemoved: true,
      }
      const cleanup = await Promise.allSettled([
        ...servers.map(closeServer),
        ...children.map(stopChild),
      ])
      const cleanupFailures = cleanup
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason)
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          cleanupFailures,
          "F0-I1 cleanup did not complete.",
        )
      }
      servers.length = 0
      children.length = 0
      await assertStateFilesCredentialFree(stateRoot, sensitiveValues)
      await rm(stateRoot, { force: true, recursive: true })
      assert.equal(await exists(stateRoot), false)
      return evidence
    }

    const observabilityFlow =
      observabilityMode &&
      !integratedCoreMode &&
      observabilityCanaries &&
      prometheusControl &&
      alertmanagerControl
        ? await proveObservabilityConsoleFlow({
            alertmanagerControl,
            consoleOrigin,
            inferenceControl,
            observabilityCanaries,
            page,
            prometheusControl,
          })
        : null

    let persistenceOperatorContext
    let persistenceOperatorPage
    if (postgresBackedMode) {
      persistenceOperatorContext = await browser.newContext({
        ignoreHTTPSErrors: true,
      })
      persistenceOperatorPage = await persistenceOperatorContext.newPage()
      await synchronizeFixtureClock()
      await signIn(
        persistenceOperatorPage,
        consoleOrigin,
        credentials.operator,
        "/applications",
      )
      await assertRole(persistenceOperatorPage, "Operator")
      await assertConsoleNavigation(persistenceOperatorPage, consoleOrigin)
    }

    const applicationFlow = integratedCoreMode
      ? await proveApplicationConsoleFlow({
          actualFirecrawl: firecrawlControl,
          certificate,
          consoleOrigin,
          edgePort,
          page,
          postgresControl,
          restartBff,
          retentionCanaries,
          sensitiveValues,
          streamingRequired: true,
          synchronizeClock: synchronizeFixtureClock,
          userCredentials: credentials.admin,
          credentialLifecycleMode,
        })
      : liteLlmIntegrationMode
        ? await proveLiteLlmConsoleFlow({
            certificate,
            consoleOrigin,
            edgePort,
            liteLlmControl,
            page,
            sensitiveValues,
            synchronizeClock: synchronizeFixtureClock,
            userCredentials: credentials.admin,
          })
        : applicationsMode
          ? await proveApplicationConsoleFlow({
              certificate,
              consoleOrigin,
              edgePort,
              page,
              postgresControl,
              restartBff,
              retentionCanaries,
              sensitiveValues,
              synchronizeClock: synchronizeFixtureClock,
              userCredentials: credentials.admin,
              credentialLifecycleMode,
            })
          : null

    if (
      postgresPersistenceMode &&
      persistenceOperatorContext &&
      persistenceOperatorPage &&
      applicationFlow
    ) {
      await persistenceOperatorPage.goto(`${consoleOrigin}/applications`)
      await assertRole(persistenceOperatorPage, "Operator")
      await assertOperatorApplicationReadOnly(
        persistenceOperatorPage,
        applicationFlow,
      )
      await persistenceOperatorContext.close()
      postgresOutageEvidence = await provePostgresOutageRecovery({
        bffPort,
        children,
        consoleOrigin,
        page,
      })
    }

    if (integratedCoreMode) {
      assert.ok(persistenceOperatorContext)
      assert.ok(persistenceOperatorPage)
      await assertIntegratedTeamProjection(page, consoleOrigin, true)
      await persistenceOperatorPage.goto(`${consoleOrigin}/applications`)
      await assertRole(persistenceOperatorPage, "Operator")
      await assertConsoleNavigation(persistenceOperatorPage, consoleOrigin)
      await assertOperatorApplicationReadOnly(
        persistenceOperatorPage,
        applicationFlow,
      )
      await assertIntegratedTeamProjection(
        persistenceOperatorPage,
        consoleOrigin,
        false,
      )
      await persistenceOperatorContext.close()
      persistenceOperatorContext = undefined
      persistenceOperatorPage = undefined
      const identityFlow = await proveKeycloakIdentityCookieBoundary({
        context,
        edgePort,
      })
      const observability = await proveIntegratedObservabilityConsoleFlow({
        consoleOrigin,
        founderUat: Boolean(founderUatControl),
        page,
      })
      const noBypass = await proveIntegratedNoBypass({
        certificate,
        edgePort,
      })
      const adminSession = sessionCookie(await context.cookies(consoleOrigin))
      assert.equal(adminSession.httpOnly, true)
      assert.equal(adminSession.secure, true)
      await page.goto(`${consoleOrigin}/`)
      await page.getByRole("button", { name: "Sign out" }).click()
      await page.waitForURL((url) => url.pathname === "/auth/signin")
      await context.clearCookies()
      await synchronizeFixtureClock()
      await signIn(page, consoleOrigin, credentials.operator, "/applications")
      await assertRole(page, "Operator")
      await assertConsoleNavigation(page, consoleOrigin)
      await assertOperatorApplicationReadOnly(page, applicationFlow)
      await page.goto(`${consoleOrigin}/`)
      await page.getByRole("button", { name: "Sign out" }).click()
      await page.waitForURL((url) => url.pathname === "/auth/signin")

      postgresPersistenceEvidence = inspectPostgresPersistence(sensitiveValues)
      assert.deepEqual(pageErrors, [])
      assertNoSensitiveValues(
        browserMetadata,
        sensitiveValues,
        "browser metadata",
      )
      await page.evaluate(async () => navigator.clipboard.writeText(""))
      await page.screenshot({
        path: join(stateRoot, "credential-free-final.png"),
      })
      await context.close()
      const browserVersion = browser.version()
      await browser.close()
      browser = undefined
      evidence = {
        architecture: process.arch,
        browser: { name: "Google Chrome", version: browserVersion },
        credentialMaterialPrinted: false,
        evidenceClass: "LOCAL_INTEGRATED_REDUCED_CORE_ONLY",
        flow: applicationFlow,
        identity: identityFlow,
        noBypass,
        observability,
        persistence: postgresPersistenceEvidence,
        proved: [
          "actual Console Web and BFF authenticate through disposable Keycloak 26.7.0",
          "real Product migrations and encrypted opaque sessions persist across a controlled BFF restart",
          "Product-issued Application credentials reach actual private LiteLLM and deterministic inference for streaming and non-streaming Chat Completions",
          "Firecrawl remains Application-disabled by default and actual reduced search and static scrape require its separate credential",
          "actual Prometheus, Alertmanager, and private Grafana start while the Console remains the only customer control surface",
          "the four customer authorities deny native administration, alternate hosts, unsafe paths, and spoofed forwarding metadata",
          "workload and credential canaries remain absent from Product state and browser artifacts",
        ],
        runtimeQualified: false,
        status: "passed",
        temporaryStateRemoved: true,
      }
      if (founderUatControl) {
        await holdFounderUat({
          caFile: certificate.ca,
          children,
          credentials,
          edgePort,
          firecrawlControl,
          keycloakControl,
          liteLlmControl,
          synchronizeClock: synchronizeFixtureClock,
        })
      }
      const cleanup = await Promise.allSettled([
        ...servers.map(closeServer),
        ...children.map(stopChild),
      ])
      const cleanupFailures = cleanup
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason)
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          cleanupFailures,
          "F0-C1 browser cleanup did not complete.",
        )
      }
      servers.length = 0
      children.length = 0
      await rm(sessionKeyringFile, { force: true })
      await assertStateFilesCredentialFree(stateRoot, sensitiveValues)
      await rm(stateRoot, { force: true, recursive: true })
      assert.equal(await exists(stateRoot), false)
      return evidence
    }

    const sharedCookie = sessionCookie(await context.cookies(consoleOrigin))
    const revoker = await browser.newContext({ ignoreHTTPSErrors: true })
    await revoker.addCookies([sharedCookie])
    const revokerPage = await revoker.newPage()
    await revokerPage.goto(`${consoleOrigin}/`)
    await revokerPage.getByRole("button", { name: "Sign out" }).click()
    try {
      await revokerPage.waitForURL((url) => url.pathname === "/auth/signin", {
        timeout: 5_000,
      })
    } catch {
      throw new Error(
        `Revoking browser did not reach sign-in at ${revokerPage.url()}: ${(await revokerPage.locator("body").innerText()).slice(0, 500)}`,
      )
    }
    await revoker.close()
    await page.goto(`${consoleOrigin}/hardware`)
    await assertExpiredSignIn(page, "/hardware")

    await signIn(page, consoleOrigin, credentials.admin, "/")
    await advanceClock(241_000)
    const refreshBefore = oidc.refreshCount
    const secondPage = await context.newPage()
    await Promise.all([
      page.goto(`${consoleOrigin}/applications`),
      secondPage.goto(`${consoleOrigin}/inference`),
    ])
    assert.equal(oidc.refreshCount - refreshBefore, 1)
    await assertRole(page, "Administrator")
    await assertRole(secondPage, "Administrator")
    await secondPage.close()

    await advanceClock(241_000)
    oidc.setAvailable(false)
    await page.goto(`${consoleOrigin}/settings`)
    const unavailableHeading = page.getByRole("heading", {
      name: "Identity service temporarily unavailable",
    })
    if ((await unavailableHeading.count()) !== 1) {
      throw new Error(
        `Identity outage did not render its recoverable state at ${page.url()}: ${(await page.locator("body").innerText()).slice(0, 500)}`,
      )
    }
    await unavailableHeading.waitFor()
    assert.equal(new URL(page.url()).pathname, "/auth/unavailable")
    assert.equal(new URL(page.url()).searchParams.get("returnTo"), "/settings")
    assert.ok(sessionCookie(await context.cookies(consoleOrigin)))
    oidc.setAvailable(true)
    await advanceClock(6_000)
    await page.getByRole("link", { name: "Retry" }).click()
    await page.getByRole("heading", { name: "Settings" }).waitFor()
    if (integratedCoreMode && firecrawlControl) {
      const firecrawlRow = page
        .getByRole("row")
        .filter({ has: page.getByRole("cell", { name: "Firecrawl" }) })
      assert.equal(
        await firecrawlRow.getByRole("cell", { name: "Reachable" }).count(),
        1,
        "Settings did not project the actual private Firecrawl service as reachable.",
      )
    }

    await advanceClock(31 * 60 * 1000)
    await page.goto(`${consoleOrigin}/team`)
    await assertExpiredSignIn(page, "/team")
    assert.equal(
      (await context.cookies(consoleOrigin)).some(
        (cookie) => cookie.name === "__Host-llm-machines-session",
      ),
      false,
    )

    await page.goto(
      `${consoleOrigin}/auth/signin?returnTo=${encodeURIComponent("https://attacker.invalid/")}`,
    )
    await page.getByRole("link", { name: /Keycloak/ }).click()
    await completeIdentityLogin(page, credentials.operator)
    assert.equal(new URL(page.url()).pathname, "/")
    await assertRole(page, "Operator")
    await assertConsoleNavigation(page, consoleOrigin)
    await page.goto(`${consoleOrigin}/applications/apps/new`)
    await page.getByRole("heading", { name: "Admin access required" }).waitFor()
    await page.goto(`${consoleOrigin}/team/members/new`)
    await page.getByRole("heading", { name: "Admin access required" }).waitFor()
    await page.goto(`${consoleOrigin}/activity`)
    assert.equal(
      await page.getByText("Export JSON", { exact: true }).count(),
      0,
    )
    assert.equal(await page.getByText("Export CSV", { exact: true }).count(), 0)
    if (credentialLifecycleMode && applicationFlow) {
      await assertOperatorApplicationReadOnly(page, applicationFlow)
    }
    if (observabilityMode) {
      await assertObservabilityConsoleProjection(
        page,
        consoleOrigin,
        observabilityCanaries,
      )
    }

    await page.goto(`${consoleOrigin}/`)
    await page.getByRole("button", { name: "Sign out" }).click()
    await page.waitForURL((url) => url.pathname === "/auth/signin")
    await page.goto(`${consoleOrigin}/inference`)
    assert.equal(new URL(page.url()).pathname, "/auth/signin")
    assert.equal(new URL(page.url()).searchParams.get("returnTo"), "/inference")
    if (postgresControl) {
      postgresPersistenceEvidence = inspectPostgresPersistence(sensitiveValues)
    }
    assert.deepEqual(pageErrors, [])
    assertNoSensitiveValues(
      browserMetadata,
      sensitiveValues,
      "browser metadata",
    )
    await page.evaluate(async () => navigator.clipboard.writeText(""))
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "")
    await page.screenshot({
      path: join(stateRoot, "credential-free-final.png"),
    })
    await context.close()

    const browserVersion = browser.version()
    await browser.close()
    browser = undefined
    evidence = {
      architecture: process.arch,
      browser: { name: "Google Chrome", version: browserVersion },
      credentialMaterialPrinted: false,
      evidenceClass: postgresPersistenceMode
        ? "LOCAL_POSTGRES_RESTART_PERSISTENCE_ONLY"
        : credentialLifecycleMode
          ? "LOCAL_BROWSER_CREDENTIAL_LIFECYCLE_ONLY"
          : liteLlmIntegrationMode
            ? "LOCAL_PRIVATE_LITELLM_INTEGRATION_ONLY"
            : observabilityMode
              ? "LOCAL_BROWSER_OBSERVABILITY_PROJECTION_ONLY"
              : applicationsMode
                ? "LOCAL_BROWSER_APPLICATION_FLOW_ONLY"
                : "LOCAL_BROWSER_SESSION_AND_ROLE_FLOW_ONLY",
      ...(applicationFlow ? { flow: applicationFlow } : {}),
      ...(observabilityFlow ? { observability: observabilityFlow } : {}),
      ...(postgresOutageEvidence
        ? { postgresOutage: postgresOutageEvidence }
        : {}),
      ...(postgresPersistenceEvidence
        ? { persistence: postgresPersistenceEvidence }
        : {}),
      limitations: [
        ...(postgresPersistenceMode
          ? [
              "Disposable local PostgreSQL is functional evidence, not VM103 or exact-Core qualification.",
            ]
          : [
              "In-memory Console session storage is not PostgreSQL restart-persistence evidence.",
            ]),
        "The deterministic identity fixture is not Keycloak 26.7.0 runtime qualification.",
        "A generated local CA with browser-only trust bypass is not appliance TLS evidence.",
        "Reserved *.llmm.test aliases are loopback-only browser fixture authorities, not Product DNS constants.",
        liteLlmIntegrationMode
          ? "Exact LiteLLM v1.85.0 is private and disposable; deterministic inference is not SGLang or production-capacity evidence."
          : observabilityMode
            ? "Prometheus, Alertmanager, and LiteLLM are deterministic private doubles, not packaged runtime qualification."
            : applicationsMode
              ? "Inference is deterministic; Firecrawl upstream execution remains F0-W1 evidence."
              : "Inference is deterministic and Firecrawl is not exercised by F0-S1.",
        "No result is Q0, release, capacity, or runtime-qualification evidence.",
      ],
      proved: [
        "browser Authorization Code and PKCE login through the approved identity authority",
        "safe same-origin return handling and one-time expired-session redirect",
        "revoked and expired sessions clear local browser custody without a frozen Console",
        "retryable identity outage preserves the session and recovers without a redirect loop",
        "parallel browser requests serialize refresh-token rotation",
        "logout clears local custody and protected navigation requires login",
        "Admin and Operator can use all retained Console navigation without native expert surfaces",
        "Operator is denied Admin-only Application, Team, and audit-export controls",
        ...(postgresPersistenceMode
          ? [
              "real Product migrations initialize an empty disposable PostgreSQL database",
              "Admin and Operator encrypted opaque sessions plus Application, credential, usage, audit, and Firecrawl metadata survive one controlled BFF restart",
              "expired and revoked credentials remain denied while active rotated and second-Application credentials remain accepted after restart",
              "PostgreSQL unavailability degrades readiness and recovers without state corruption",
              "workload content and secret canaries remain absent from PostgreSQL and teardown artifacts",
            ]
          : []),
        ...(applicationFlow
          ? [
              liteLlmIntegrationMode
                ? "Admin creates an Application and its customer-facing credential reaches private LiteLLM only through the Product API authority"
                : "Admin creates an Application and receives separate one-time inference and Firecrawl credentials through the actual Console UI",
              liteLlmIntegrationMode
                ? "non-streaming and streaming Chat Completions traverse actual LiteLLM and update usage and last-use metadata"
                : "a standard OpenAI-compatible client reaches the Product API authority and updates passive connection, usage, and last-use evidence",
              liteLlmIntegrationMode
                ? "the Console renders real LiteLLM health, served models, usage, route summary, and safe credential metadata without mutation authority"
                : "Firecrawl is disabled by default and requires explicit disclaimer acknowledgement for the selected Application",
              ...(liteLlmIntegrationMode
                ? [
                    "LiteLLM outage fails the Product API and Console projection closed, then recovers without exposing a native service route",
                    "Application credentials cannot authenticate directly to LiteLLM and native LiteLLM paths remain absent from Product ingress",
                  ]
                : []),
              ...(credentialLifecycleMode
                ? [
                    "Admin rotates and revokes inference and Firecrawl credentials through the Console while exact Application isolation remains enforced",
                    "one-time secrets leave subsequent DOM, history, copied UI state, browser metadata, screenshots, and teardown artifacts",
                    "Operator remains read-only across Application and credential lifecycle surfaces",
                  ]
                : []),
            ]
          : []),
        ...(observabilityFlow
          ? [
              "Admin and Operator read the same source-backed Hardware and Inference projections through the actual Console",
              "Prometheus supplies seven curated hardware signals and Alertmanager supplies allowlisted metadata-only active alerts",
              "LiteLLM supplies health, usage, model inventory, route summary, and safe credential metadata through GET-only private reads",
              "private source outage renders controlled unavailable states and the Console recovers without native service links",
              "Grafana, Alertmanager, LiteLLM, and Keycloak native administration remain absent from Product navigation",
              "queue depth remains explicitly not configured and no workload or source credential canary reaches browser or teardown state",
            ]
          : []),
      ],
      status: "passed",
      temporaryStateRemoved: true,
    }

    async function advanceClock(milliseconds) {
      currentTime = new Date(currentTime.getTime() + milliseconds)
      await writeFile(clockFile, `${currentTime.toISOString()}\n`, {
        mode: 0o600,
      })
    }

    async function synchronizeFixtureClock() {
      currentTime = new Date()
      await writeFile(clockFile, `${currentTime.toISOString()}\n`, {
        mode: 0o600,
      })
    }
  } catch (error) {
    const safeError = sanitizedError(error, sensitiveValues)
    const bffDiagnostics = (
      await Promise.all(
        ["bff", "bff-before-restart", "bff-after-restart"].flatMap((name) =>
          ["stdout", "stderr"].map((stream) =>
            readFile(join(stateRoot, `${name}.${stream}.log`), "utf8").catch(
              () => "",
            ),
          ),
        ),
      )
    ).join("\n")
    const diagnostics = [
      ...tlsErrors
        .filter(
          (message) =>
            !message.includes("ECONNRESET") &&
            !message.includes("socket hang up"),
        )
        .map((message) => new Error(message)),
      ...(observedOrigins.length
        ? [new Error(`Observed session origins: ${observedOrigins.join(", ")}`)]
        : []),
      ...(oidc?.lastGrantFailure
        ? [new Error(`OIDC metadata: ${oidc.lastGrantFailure}`)]
        : []),
      ...(identityFixtureFailures.length
        ? [
            new Error(
              `Identity fixture metadata: ${identityFixtureFailures.join(", ")}`,
            ),
          ]
        : []),
      ...(browserResponses.length
        ? [
            new Error(
              `Browser response metadata: ${JSON.stringify(browserResponses.slice(-20))}`,
            ),
          ]
        : []),
      ...(page
        ? [
            new Error(
              `Browser state: ${new URL(page.url()).pathname}\n${redactedDiagnosticTail(
                await page
                  .locator("body")
                  .innerText()
                  .catch(() => ""),
                sensitiveValues,
              )}`,
            ),
          ]
        : []),
      ...(bffDiagnostics
        ? [
            new Error(
              `BFF metadata:\n${redactedDiagnosticTail(
                bffDiagnostics,
                sensitiveValues,
              )}`,
            ),
          ]
        : []),
    ]
    failure = diagnostics.length
      ? new AggregateError(
          [safeError, ...diagnostics],
          "F0-S1 browser proof failed.",
        )
      : safeError
  } finally {
    await browser?.close().catch(() => undefined)
    const cleanup = await Promise.allSettled([
      ...servers.map(closeServer),
      ...children.map(stopChild),
    ])
    const failures = cleanup
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason)
    if (failures.length > 0) {
      failure = new AggregateError(
        failure ? [failure, ...failures] : failures,
        "F0-S1 cleanup did not complete.",
      )
    }
    await rm(join(stateRoot, "f0-p1-session-keyring.json"), { force: true })
    await rm(join(stateRoot, "f0-o1-observability-token"), { force: true })
    if (failures.length === 0 && sensitiveValues.length > 0) {
      try {
        await assertStateFilesCredentialFree(stateRoot, sensitiveValues)
      } catch (error) {
        failure = failure
          ? new AggregateError(
              [failure, error],
              "F0-U2 secret-retention verification failed.",
            )
          : error
      }
    }
    await rm(stateRoot, { force: true, recursive: true })
    if (await exists(stateRoot)) {
      failure = new Error("F0-U2 temporary state was not removed.")
    }
  }
  if (failure) {
    throw failure
  }
  assert.ok(evidence)
  return evidence
}

async function signIn(page, consoleOrigin, userCredentials, returnPath) {
  await page.goto(`${consoleOrigin}${returnPath}`)
  const loginLink = page.getByRole("link", { name: /Keycloak/ })
  if ((await loginLink.count()) !== 1) {
    throw new Error(
      `Console sign-in link was not rendered at ${page.url()}: ${(await page.locator("body").innerText()).slice(0, 500)}`,
    )
  }
  await loginLink.click()
  await completeIdentityLogin(page, userCredentials)
}

async function completeIdentityLogin(page, userCredentials) {
  if (keycloakIdentityMode) {
    const navigation = page.locator("nav[aria-label='Console navigation']")
    const username = page.locator("#username")
    await Promise.race([
      navigation.waitFor({ timeout: 20_000 }),
      username.waitFor({ timeout: 20_000 }),
    ])
    if ((await navigation.count()) === 1 && (await navigation.isVisible())) {
      return
    }
    const identityCookies = await page.context().cookies(page.url())
    assert.ok(
      identityCookies.some((cookie) => cookie.name === "AUTH_SESSION_ID"),
      "Keycloak did not establish its identity-host login cookie.",
    )
    assert.equal(
      identityCookies.some((cookie) =>
        cookie.name.startsWith("__Host-llm-machines-"),
      ),
      false,
      "A Product Console cookie reached the identity authority.",
    )
    await username.fill(userCredentials.username)
    await page.locator("#password").fill(userCredentials.password)
    await page.locator("#kc-login").click()
    const otp = page.locator("#otp")
    await otp.waitFor({ timeout: 20_000 })
    await otp.fill(
      totp(userCredentials.otpSecret, await identityEpochMilliseconds()),
    )
    await page.locator("#kc-login").click()
    try {
      await navigation.waitFor({ timeout: 20_000 })
    } catch {
      throw new Error(
        `Console navigation was not rendered after Keycloak callback at ${page.url()}: ${(await page.locator("body").innerText()).slice(0, 500)}`,
      )
    }
    return
  }
  await page
    .getByRole("heading", { name: "Fixture identity sign in" })
    .waitFor({ timeout: 10_000 })
  const loginCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "__Host-llm-machines-login",
  )
  assert.ok(loginCookie, "The browser did not retain the opaque login cookie.")
  assert.equal(loginCookie.httpOnly, true)
  assert.equal(loginCookie.secure, true)
  await page.getByLabel("Username").fill(userCredentials.username)
  await page.getByLabel("Password").fill(userCredentials.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  const navigation = page.locator("nav[aria-label='Console navigation']")
  try {
    await navigation.waitFor({ timeout: 10_000 })
  } catch {
    throw new Error(
      `Console navigation was not rendered after identity callback at ${page.url()}: ${(await page.locator("body").innerText()).slice(0, 500)}`,
    )
  }
}

async function assertRole(page, label) {
  await page.getByText(label, { exact: true }).waitFor()
}

async function assertExpiredSignIn(page, returnTo) {
  await page
    .getByText("Your Console session expired.", { exact: false })
    .waitFor()
  const url = new URL(page.url())
  assert.equal(url.pathname, "/auth/signin")
  assert.equal(url.searchParams.get("session"), "expired")
  assert.equal(url.searchParams.get("returnTo"), returnTo)
}

async function assertConsoleNavigation(page, consoleOrigin) {
  for (const [path, heading] of consolePaths) {
    const response = await page.goto(`${consoleOrigin}${path}`)
    assert.ok(response && response.status() < 500, `${path} returned an error.`)
    await page.getByRole("heading", { name: heading }).first().waitFor()
  }
  const hrefs = await page
    .locator("a")
    .evaluateAll((links) =>
      links.map((link) => link.getAttribute("href") ?? ""),
    )
  assert.equal(
    hrefs.some((href) => /(?:grafana|litellm|keycloak.*admin)/i.test(href)),
    false,
  )
}

async function assertDesktopViewportLayout(page, consoleOrigin) {
  const previousViewport = page.viewportSize()
  try {
    await page.setViewportSize({ height: 768, width: 1024 })
    for (const [path, heading] of [
      ["/applications", "Applications"],
      ["/inference", "Inference"],
      ["/hardware", "Hardware"],
      ["/settings", "Settings"],
    ]) {
      await page.goto(`${consoleOrigin}${path}`)
      await page.getByRole("heading", { name: heading }).first().waitFor()
      const layout = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        mainRight:
          document.querySelector("main")?.getBoundingClientRect().right ?? 0,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      assert.equal(
        layout.scrollWidth,
        layout.clientWidth,
        `${path} overflowed at the 1024-pixel desktop boundary.`,
      )
      assert.ok(
        layout.mainRight <= layout.clientWidth,
        `${path} clipped its main Console surface at 1024 pixels.`,
      )
    }

    await page.goto(`${consoleOrigin}/team`)
    await page.getByRole("heading", { name: "Team" }).first().waitFor()
    assert.equal(
      await page.getByRole("link", { name: "Import CSV" }).count(),
      0,
    )
    assert.equal(
      await page.getByRole("link", { name: "Create group" }).count(),
      0,
    )
  } finally {
    if (previousViewport) await page.setViewportSize(previousViewport)
  }
}

async function proveKeycloakIdentityCookieBoundary({ context, edgePort }) {
  const cookies = await context.cookies()
  const consoleCookies = cookies.filter(
    (cookie) => cookie.domain === authorities.console,
  )
  const identityCookies = cookies.filter(
    (cookie) => cookie.domain === authorities.identity,
  )
  const productSession = sessionCookie(consoleCookies)
  assert.ok(
    identityCookies.some((cookie) =>
      ["KEYCLOAK_IDENTITY", "KEYCLOAK_SESSION"].includes(cookie.name),
    ),
    "Keycloak did not retain a native identity-host session cookie.",
  )
  assert.equal(
    identityCookies.some((cookie) =>
      cookie.name.startsWith("__Host-llm-machines-"),
    ),
    false,
  )
  assert.equal(
    consoleCookies.some((cookie) => cookie.name.startsWith("KEYCLOAK_")),
    false,
  )

  const deniedNativePaths = [
    "/admin/",
    "/admin/master/console/",
    "/realms/master/admin/",
    "/realms/llm-machines/admin/",
  ]
  for (const path of deniedNativePaths) {
    const response = await requestHttpsEdge(
      `https://127.0.0.1:${edgePort}${path}`,
      `${authorities.identity}:${edgePort}`,
    )
    assert.equal(response.status, 404, `${path} was not denied.`)
  }
  return {
    identityCookieNames: [...new Set(identityCookies.map(({ name }) => name))]
      .filter((name) => !name.includes("RESTART"))
      .sort(),
    nativeAdminPathsDenied: deniedNativePaths,
    productSessionCookie: productSession.name,
  }
}

async function proveKeycloakTeamConsoleFlow({
  bffPort,
  consoleOrigin,
  context,
  credentials,
  page,
  sensitiveValues,
}) {
  const displayName = `F0 I2 Operator ${randomBytes(4).toString("hex")}`
  const email = `f0-i2-${randomBytes(5).toString("hex")}@fixture.invalid`

  await page.goto(`${consoleOrigin}/team`)
  await page.getByRole("heading", { name: "Team" }).first().waitFor()
  await page.getByText("admin fixture", { exact: true }).waitFor()
  await page.getByText("operator fixture", { exact: true }).waitFor()

  await page.goto(`${consoleOrigin}/team/members/new`)
  await page.getByRole("heading", { name: "Team > New member" }).waitFor()
  await page.getByLabel("Name").fill(displayName)
  await page.getByLabel("Company email").fill(email)
  await page.getByLabel("Role").selectOption("operator")
  await page.getByLabel("Group").selectOption({ label: "Operators" })
  await page.getByRole("button", { name: "Create user" }).click()
  await page.getByText("User created.", { exact: true }).waitFor()
  const firstPassword = await page.getByLabel("Generated password").inputValue()
  if (firstPassword) sensitiveValues.push(firstPassword)
  assert.ok(firstPassword.length >= 20)
  const detailHref = await page
    .getByRole("link", { name: "Open member detail" })
    .getAttribute("href")
  assert.match(detailHref ?? "", /^\/team\/members\/[0-9a-f-]{36}$/)
  const memberId = detailHref.split("/").at(-1)

  await page.goto(`${consoleOrigin}${detailHref}`)
  await page.getByRole("heading", { name: `Team > ${displayName}` }).waitFor()
  const username = await page
    .locator("dt", { hasText: "Username" })
    .locator("xpath=following-sibling::dd")
    .innerText()
  assert.equal(
    (await page.locator("body").innerText()).includes(firstPassword),
    false,
  )
  await page.getByText("Operator", { exact: true }).first().waitFor()
  await page.getByText("Active", { exact: true }).first().waitFor()
  await assertKeycloakPasswordOutcome({
    accepted: true,
    consoleOrigin,
    page,
    password: firstPassword,
    username,
  })

  await page.getByRole("button", { name: "Generate password" }).click()
  await page.getByText("Password generated.", { exact: true }).waitFor()
  const rotatedPassword = await page
    .getByLabel("Generated password")
    .inputValue()
  if (rotatedPassword) sensitiveValues.push(rotatedPassword)
  assert.ok(rotatedPassword.length >= 20)
  assert.notEqual(rotatedPassword, firstPassword)
  await assertKeycloakPasswordOutcome({
    accepted: false,
    consoleOrigin,
    page,
    password: firstPassword,
    username,
  })
  await assertKeycloakPasswordOutcome({
    accepted: true,
    consoleOrigin,
    page,
    password: rotatedPassword,
    username,
  })

  await page.goto(`${consoleOrigin}/team`)
  await page.getByRole("heading", { name: "Team" }).first().waitFor()
  const teamBody = await page.locator("body").innerText()
  assert.equal(teamBody.includes(firstPassword), false)
  assert.equal(teamBody.includes(rotatedPassword), false)

  await page.goto(`${consoleOrigin}${detailHref}`)
  await page.getByRole("button", { name: "Disable user" }).click()
  await page.getByText("Team member disabled.", { exact: true }).waitFor()
  await page.getByText("Disabled", { exact: true }).first().waitFor()
  await page.getByText("Operator", { exact: true }).first().waitFor()
  await page.getByText("Operators", { exact: true }).first().waitFor()
  await page.getByRole("button", { name: "Reactivate user" }).click()
  await page.getByText("Team member reactivated.", { exact: true }).waitFor()
  await page.getByText("Active", { exact: true }).first().waitFor()
  await page.getByText("Operator", { exact: true }).first().waitFor()
  await page.getByText("Operators", { exact: true }).first().waitFor()

  await page.goto(`${consoleOrigin}/`)
  await page.getByRole("button", { name: "Sign out" }).click()
  await page.waitForURL((url) => url.pathname === "/auth/signin")
  await context.clearCookies()
  await signIn(page, consoleOrigin, credentials.operator, "/team")
  await assertRole(page, "Operator")
  await page.getByText(displayName, { exact: true }).waitFor()
  assert.equal(await page.getByRole("link", { name: "Create user" }).count(), 0)
  await page.goto(`${consoleOrigin}/team/members/new`)
  await page.getByRole("heading", { name: "Admin access required" }).waitFor()
  await page.goto(`${consoleOrigin}${detailHref}`)
  await page.getByRole("heading", { name: `Team > ${displayName}` }).waitFor()
  for (const action of [
    "Generate password",
    "Disable user",
    "Reactivate user",
    "Delete",
  ]) {
    assert.equal(await page.getByRole("button", { name: action }).count(), 0)
  }
  const mutationCountBefore = identityMutationJournalRowCount()
  const operatorSession = sessionCookie(await context.cookies(consoleOrigin))
  const deniedMutation = await context.request.post(
    `http://127.0.0.1:${bffPort}/api/admin/team/members/${encodeURIComponent(memberId)}/disable`,
    {
      data: {},
      failOnStatusCode: false,
      headers: {
        Authorization: `Bearer ${credentials.bffService}`,
        "Idempotency-Key": randomUUID(),
        "x-llm-machines-console-session": operatorSession.value,
      },
    },
  )
  assert.equal(deniedMutation.status(), 403)
  await deniedMutation.dispose()
  assert.equal(identityMutationJournalRowCount(), mutationCountBefore)
  await page.reload()
  await page.getByText("Active", { exact: true }).first().waitFor()
  await page.getByText("Operator", { exact: true }).first().waitFor()
  await page.getByText("Operators", { exact: true }).first().waitFor()

  return {
    adminCreateOperator: "passed",
    canonicalGroup: "Operators",
    disableReactivate: "passed",
    memberId,
    oneTimePasswordReveal: "passed",
    operatorMutationDenial: "passed",
    passwordRotation: "passed",
  }
}

async function assertIntegratedTeamProjection(
  page,
  consoleOrigin,
  canManageUsers,
) {
  await page.goto(`${consoleOrigin}/team`)
  await page.getByRole("heading", { name: "Team" }).first().waitFor()
  await page.getByText("admin fixture", { exact: true }).waitFor()
  await page.getByText("operator fixture", { exact: true }).waitFor()
  assert.equal(
    await page
      .getByRole("heading", { name: "Keycloak admin API not configured" })
      .count(),
    0,
  )
  assert.equal(
    await page.getByRole("link", { name: "Create user" }).count(),
    canManageUsers ? 1 : 0,
  )
  if (!canManageUsers) {
    await page.goto(`${consoleOrigin}/team/members/new`)
    await page.getByRole("heading", { name: "Admin access required" }).waitFor()
  }
}

async function assertKeycloakPasswordOutcome({
  accepted,
  consoleOrigin,
  page,
  password,
  username,
}) {
  const browser = page.context().browser()
  assert.ok(browser)
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const probe = await context.newPage()
  try {
    await probe.goto(`${consoleOrigin}/team`)
    await probe.getByRole("link", { name: /Keycloak/ }).click()
    await probe.locator("#username").fill(username)
    await probe.locator("#password").fill(password)
    await probe.locator("#kc-login").click()
    if (accepted) {
      await probe.locator("#kc-totp-settings-form").waitFor({ timeout: 20_000 })
      assert.match(
        new URL(probe.url()).pathname,
        /\/realms\/llm-machines\/login-actions\/required-action$/,
      )
      return
    }
    await probe.locator("#username").waitFor({ timeout: 20_000 })
    assert.equal(await probe.locator("#kc-totp-settings-form").count(), 0)
    assert.match(
      await probe.locator("body").innerText(),
      /Invalid username or password/i,
    )
  } finally {
    await context.close()
  }
}

async function proveKeycloakIdentityConsoleFlow({
  consoleOrigin,
  context,
  credentials,
  edgePort,
  page,
}) {
  const cookies = await context.cookies()
  const consoleCookies = cookies.filter(
    (cookie) => cookie.domain === authorities.console,
  )
  const identityCookies = cookies.filter(
    (cookie) => cookie.domain === authorities.identity,
  )
  const productSession = sessionCookie(consoleCookies)
  assert.equal(productSession.httpOnly, true)
  assert.equal(productSession.secure, true)
  assert.ok(
    identityCookies.some((cookie) =>
      ["KEYCLOAK_IDENTITY", "KEYCLOAK_SESSION"].includes(cookie.name),
    ),
    "Keycloak did not retain a native identity-host session cookie.",
  )
  assert.equal(
    identityCookies.some((cookie) =>
      cookie.name.startsWith("__Host-llm-machines-"),
    ),
    false,
    "A Product session cookie reached the identity authority.",
  )
  assert.equal(
    consoleCookies.some((cookie) => cookie.name.startsWith("KEYCLOAK_")),
    false,
    "A Keycloak native cookie reached the Console authority.",
  )

  const deniedNativePaths = [
    "/admin/",
    "/admin/master/console/",
    "/realms/master/admin/",
    "/realms/llm-machines/admin/",
  ]
  for (const path of deniedNativePaths) {
    const response = await requestHttpsEdge(
      `https://127.0.0.1:${edgePort}${path}`,
      `${authorities.identity}:${edgePort}`,
    )
    assert.equal(response.status, 404, `${path} was not denied.`)
  }

  await page.goto(`${consoleOrigin}/`)
  await page.getByRole("button", { name: "Sign out" }).click()
  await page.waitForURL((url) => url.pathname === "/auth/signin")
  await page.goto(`${consoleOrigin}/inference`)
  assert.equal(new URL(page.url()).pathname, "/auth/signin")
  assert.equal(new URL(page.url()).searchParams.get("returnTo"), "/inference")

  await context.clearCookies()
  await signIn(page, consoleOrigin, credentials.operator, "/")
  await assertRole(page, "Operator")
  await assertConsoleNavigation(page, consoleOrigin)
  await page.goto(`${consoleOrigin}/applications/apps/new`)
  await page.getByRole("heading", { name: "Admin access required" }).waitFor()
  await page.goto(`${consoleOrigin}/team/members/new`)
  await page.getByRole("heading", { name: "Admin access required" }).waitFor()
  await page.goto(`${consoleOrigin}/activity`)
  assert.equal(await page.getByText("Export JSON", { exact: true }).count(), 0)
  assert.equal(await page.getByText("Export CSV", { exact: true }).count(), 0)

  await page.goto(`${consoleOrigin}/`)
  await page.getByRole("button", { name: "Sign out" }).click()
  await page.waitForURL((url) => url.pathname === "/auth/signin")
  await page.goto(`${consoleOrigin}/team`)
  assert.equal(new URL(page.url()).pathname, "/auth/signin")
  assert.equal(new URL(page.url()).searchParams.get("returnTo"), "/team")

  return {
    adminRole: "Administrator",
    identityCookieNames: [...new Set(identityCookies.map(({ name }) => name))]
      .filter((name) => !name.includes("RESTART"))
      .sort(),
    nativeAdminPathsDenied: deniedNativePaths,
    operatorRole: "Operator",
    productSessionCookie: productSession.name,
  }
}

async function proveObservabilityConsoleFlow({
  alertmanagerControl,
  consoleOrigin,
  inferenceControl,
  observabilityCanaries,
  page,
  prometheusControl,
}) {
  await assertObservabilityConsoleProjection(
    page,
    consoleOrigin,
    observabilityCanaries,
  )

  inferenceControl.available = false
  await page.goto(`${consoleOrigin}/inference`)
  await page
    .getByText(
      "LiteLLM is configured, but aggregate inference usage is unavailable.",
    )
    .waitFor()
  assert.equal(
    (await page.getByText("Unavailable", { exact: true }).count()) > 0,
    true,
  )
  inferenceControl.available = true
  await assertObservabilityConsoleProjection(
    page,
    consoleOrigin,
    observabilityCanaries,
  )

  prometheusControl.available = false
  alertmanagerControl.available = false
  await page.goto(`${consoleOrigin}/hardware`)
  await page
    .getByText(
      /Prometheus federation is configured, but hardware metrics could not be read/,
    )
    .waitFor()
  await page
    .getByText(
      /Alert federation is configured, but its current state could not be read/,
    )
    .waitFor()
  prometheusControl.available = true
  alertmanagerControl.available = true
  await assertObservabilityConsoleProjection(
    page,
    consoleOrigin,
    observabilityCanaries,
  )

  for (const nativePath of ["/grafana", "/litellm", "/keycloak/admin"]) {
    const response = await page.goto(`${consoleOrigin}${nativePath}`)
    assert.equal(response?.status(), 404)
  }

  assertPrivateReadRequests(inferenceControl.requests, {
    allowedPaths: new Set([
      "/key/list",
      "/model/info",
      "/spend/logs/v2",
      "/user/daily/activity/aggregated",
      "/v1/model/info",
      "/v1/models",
    ]),
    allowedQueryKeys: new Map([
      [
        "/key/list",
        ["include_team_keys", "page", "return_full_object", "size"],
      ],
      ["/model/info", []],
      [
        "/spend/logs/v2",
        ["end_date", "page", "page_size", "start_date", "status_filter"],
      ],
      ["/user/daily/activity/aggregated", ["end_date", "start_date"]],
      ["/v1/model/info", []],
      ["/v1/models", []],
    ]),
    source: "LiteLLM",
  })
  assertPrivateReadRequests(prometheusControl.requests, {
    allowedPaths: new Set(["/api/v1/query", "/api/v1/query_range"]),
    allowedQueryKeys: new Map([
      ["/api/v1/query", ["query"]],
      ["/api/v1/query_range", ["end", "query", "start", "step"]],
    ]),
    source: "Prometheus",
  })
  assertPrivateReadRequests(alertmanagerControl.requests, {
    allowedPaths: new Set(["/-/ready", "/api/v2/alerts"]),
    allowedQueryKeys: new Map([
      ["/-/ready", []],
      ["/api/v2/alerts", ["active", "inhibited", "silenced"]],
    ]),
    source: "Alertmanager",
    unauthenticatedPaths: new Set(["/-/ready"]),
  })

  return {
    activeAlerts: 1,
    adminAndOperatorReadParity: "passed",
    curatedHardwareSignals: 7,
    grafanaAbsent: true,
    liteLlmProjection: {
      credentialMetadata: "safe-only",
      models: 1,
      requests: 17,
      tokens: 1700,
    },
    nativeAdministration: "absent",
    privateReads: {
      alertmanager: summarizePrivateRequests(alertmanagerControl.requests),
      liteLlm: summarizePrivateRequests(inferenceControl.requests),
      prometheus: summarizePrivateRequests(prometheusControl.requests),
    },
    queueDepth: "not_configured",
    sourceOutageRecovery: "passed",
  }
}

async function proveIntegratedObservabilityConsoleFlow({
  consoleOrigin,
  founderUat,
  page,
}) {
  await assertActualLiteLlmProjection(page, consoleOrigin)
  await page.goto(`${consoleOrigin}/hardware`)
  await page.getByRole("heading", { name: "Hardware" }).waitFor()
  await page
    .getByText("Prometheus is returning all 7 curated hardware signals.", {
      exact: false,
    })
    .waitFor({ timeout: 30_000 })
  for (const heading of [
    "CPU utilization",
    "GPU temperature",
    "GPU utilization",
    "RAM usage",
    "Filesystem usage",
    "Power draw",
    "Network throughput",
  ]) {
    await page.getByRole("heading", { name: heading }).waitFor()
  }
  if (founderUat) {
    const cpu = page.locator("section").filter({
      has: page.getByRole("heading", { name: "CPU utilization" }),
    })
    await cpu.getByText("50%", { exact: true }).waitFor()
    const alerts = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Active alerts" }),
    })
    await alerts.getByText("Healthy", { exact: true }).waitFor()
    await alerts
      .getByText("No active firing alerts were reported.", { exact: true })
      .waitFor()
  }
  await page.goto(`${consoleOrigin}/`)
  await page.getByRole("heading", { name: "Overview" }).waitFor()
  await page.getByText("Models served", { exact: true }).waitFor()
  await page.getByText("Targets up", { exact: true }).waitFor()
  if (founderUat) {
    const hardwareTile = page.locator("article").filter({
      has: page.getByRole("heading", { name: "Hardware" }),
    })
    await hardwareTile.getByText("Available", { exact: true }).waitFor()
    const systemTile = page.locator("article").filter({
      has: page.getByRole("heading", { name: "System" }),
    })
    await systemTile.getByText("Operational", { exact: true }).waitFor()

    await page.goto(`${consoleOrigin}/settings`)
    await page.getByRole("heading", { name: "Settings" }).waitFor()
    const grafanaRow = page.getByRole("row").filter({ hasText: "Grafana" })
    await grafanaRow.getByText("Reachable", { exact: true }).waitFor()
  }
  const body = await page.locator("body").innerText()
  assert.doesNotMatch(body, /Grafana.*(?:open|launch|visit)/i)
  return {
    alertmanager: founderUat
      ? "actual-private-no-synthetic-alert"
      : "actual-private-local-null-with-synthetic-alert",
    grafana: "actual-private-no-customer-route",
    hardwareSignals: 7,
    liteLlmProjection:
      "health-models-usage-route-summary-safe-credential-metadata",
    prometheus: "actual-private",
  }
}

async function proveIntegratedNoBypass({ certificate, edgePort }) {
  const denied = []
  for (const [authority, path] of [
    [authorities.console, "/grafana"],
    [authorities.console, "/litellm"],
    [authorities.console, "/keycloak/admin"],
    [authorities.api, "/ui"],
    [authorities.api, "/key/list"],
    [authorities.api, "/model/info"],
    [authorities.firecrawl, "/"],
    [authorities.firecrawl, "/v2/crawl"],
    [authorities.identity, "/admin/"],
    [authorities.identity, "/realms/master/account"],
  ]) {
    const response = await requestHttpsEdgeWithHeaders({
      certificate,
      edgePort,
      headers: {
        authorization: "Bearer spoofed-customer-authority",
        cookie: "KEYCLOAK_SESSION=spoofed; llmm-native=spoofed",
        host: `${authority}:${edgePort}`,
        "x-forwarded-host": "litellm.llmm.test",
        "x-forwarded-proto": "http",
      },
      method: path === "/v2/crawl" ? "POST" : "GET",
      path,
      servername: authority,
    })
    assert.ok(
      [400, 401, 403, 404, 421].includes(response.status),
      `${authority}${path} bypass returned ${response.status}.`,
    )
    denied.push(`${authority}${path}`)
  }
  for (const authority of [
    "grafana.llmm.test",
    "keycloak.llmm.test",
    "litellm.llmm.test",
    "postgres.llmm.test",
  ]) {
    const response = await requestHttpsEdgeWithHeaders({
      certificate,
      edgePort,
      headers: { host: `${authority}:${edgePort}` },
      method: "GET",
      path: "/",
      servername: authorities.console,
    })
    assert.equal(response.status, 421)
    denied.push(authority)
  }
  const unsafe = await requestHttpsEdgeWithHeaders({
    certificate,
    edgePort,
    headers: { host: `${authorities.firecrawl}:${edgePort}` },
    method: "POST",
    path: "/v2/search?route=%2Fv2%2Fscrape",
    servername: authorities.firecrawl,
  })
  assert.ok([400, 404].includes(unsafe.status))
  return {
    alternateAuthoritiesDenied: 4,
    nativeAndUnsafeRoutesDenied: denied,
    spoofedCredentialAndForwardingHeadersDenied: true,
  }
}

async function assertObservabilityConsoleProjection(
  page,
  consoleOrigin,
  observabilityCanaries,
) {
  await page.goto(`${consoleOrigin}/inference`)
  await page.getByRole("heading", { name: "Inference" }).waitFor()
  await page.getByText("LiteLLM remains private", { exact: true }).waitFor()
  await page
    .getByText("LiteLLM reports 17 requests and 1,700 tokens in the last 30d.")
    .waitFor()
  await page.getByText("fixture-model", { exact: true }).first().waitFor()
  await page
    .getByText("Route changes are not a v1 customer capability.", {
      exact: false,
    })
    .waitFor()
  await page.getByRole("button", { name: /Expand/ }).click()
  await page.getByText("core-routing", { exact: true }).waitFor()
  await page.getByText("inference-core", { exact: true }).waitFor()
  for (const mutationName of [
    "Create route",
    "Create virtual key",
    "Rotate virtual key",
    "Revoke virtual key",
  ]) {
    assert.equal(
      await page
        .getByRole("button", { exact: true, name: mutationName })
        .count(),
      0,
    )
  }

  await page.goto(`${consoleOrigin}/hardware`)
  await page.getByRole("heading", { name: "Hardware" }).waitFor()
  await page
    .getByText("Prometheus is returning all 7 curated hardware signals.", {
      exact: false,
    })
    .waitFor()
  await page.getByRole("heading", { name: "LLMMGpuSaturation" }).waitFor()
  for (const heading of [
    "CPU utilization",
    "GPU temperature",
    "GPU utilization",
    "RAM usage",
    "Filesystem usage",
    "Power draw",
    "Network throughput",
  ]) {
    await page.getByRole("heading", { name: heading }).waitFor()
  }

  await page.goto(`${consoleOrigin}/`)
  await page.getByRole("heading", { name: "Overview" }).waitFor()
  await page.getByText("Models served", { exact: true }).waitFor()
  await page.getByText("Targets up", { exact: true }).waitFor()

  const body = await page.locator("body").innerText()
  assertNoSensitiveValues(
    [body],
    Object.values(observabilityCanaries),
    "Console projection",
  )
  assert.doesNotMatch(body, /Grafana.*(?:open|launch|visit)/i)
}

function assertPrivateReadRequests(
  requests,
  { allowedPaths, allowedQueryKeys, source, unauthenticatedPaths = new Set() },
) {
  assert.ok(requests.length > 0, `${source} received no private reads.`)
  for (const request of requests) {
    assert.equal(request.method, "GET", `${source} received a mutation.`)
    if (!unauthenticatedPaths.has(request.path)) {
      assert.equal(
        request.authorized,
        true,
        `${source} read was unauthenticated.`,
      )
    }
    assert.equal(
      allowedPaths.has(request.path),
      true,
      `${source} received an unapproved path ${request.path}.`,
    )
    assert.deepEqual(
      request.queryKeys,
      allowedQueryKeys.get(request.path),
      `${source} received unapproved query keys on ${request.path}.`,
    )
  }
}

function summarizePrivateRequests(requests) {
  return [...new Set(requests.map((request) => request.path))].sort()
}

async function proveLiteLlmConsoleFlow({
  certificate,
  consoleOrigin,
  edgePort,
  liteLlmControl,
  page,
  sensitiveValues,
  synchronizeClock,
  userCredentials,
}) {
  assert.ok(liteLlmControl)
  const applicationName = `LiteLLM client ${randomBytes(4).toString("hex")}`
  await openApplicationCreate({
    consoleOrigin,
    page,
    synchronizeClock,
    userCredentials,
  })
  await submitApplicationCreate(page, applicationName)
  await page.getByRole("heading", { name: "Application credential" }).waitFor()
  const applicationCredential = await revealedCredential(page, "API key")
  sensitiveValues.push(applicationCredential)
  assertCredentialFormat(
    applicationCredential,
    /^llmm_t4_[0-9a-f]{18}_[A-Za-z0-9_-]{43}$/,
    "inference",
  )
  const detailPath = await page
    .getByRole("link", { name: "View application" })
    .getAttribute("href")
  assert.match(detailPath ?? "", /^\/applications\/apps\/app-/)

  const models = await requestJsonThroughEdge({
    authority: authorities.api,
    bearerToken: applicationCredential,
    caFile: certificate.ca,
    edgePort,
    method: "GET",
    path: "/v1/models",
  })
  assert.equal(models.status, 200)
  assert.equal(models.body?.data?.[0]?.id, "fixture-model")

  const completion = await requestJsonThroughEdge({
    authority: authorities.api,
    bearerToken: applicationCredential,
    body: {
      messages: [{ content: liteLlmControl.canaries.prompt, role: "user" }],
      model: "fixture-model",
    },
    caFile: certificate.ca,
    edgePort,
    method: "POST",
    path: "/v1/chat/completions",
  })
  assert.equal(completion.status, 200)
  assert.equal(
    completion.body?.choices?.[0]?.message?.content,
    liteLlmControl.canaries.response,
  )
  assert.equal(completion.body?.usage?.total_tokens, 5)

  const stream = await requestTextThroughEdge({
    authority: authorities.api,
    bearerToken: applicationCredential,
    body: {
      messages: [
        { content: liteLlmControl.canaries.streamingPrompt, role: "user" },
      ],
      model: "fixture-model",
      stream: true,
      stream_options: { include_usage: true },
    },
    caFile: certificate.ca,
    edgePort,
    method: "POST",
    path: "/v1/chat/completions",
  })
  assert.equal(stream.status, 200)
  assert.match(stream.contentType, /^text\/event-stream/)
  assert.match(stream.body, /fixture-stream-response/)
  assert.match(stream.body, /data: \[DONE\]/)

  const directWithApplicationCredential = await fetch(
    `${liteLlmControl.baseUrl}/v1/models`,
    {
      headers: { authorization: `Bearer ${applicationCredential}` },
      signal: AbortSignal.timeout(5_000),
    },
  )
  assert.equal(directWithApplicationCredential.status, 401)

  await page.goto(`${consoleOrigin}/applications`)
  const applicationCard = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: applicationName }) })
  await applicationCard.waitFor()
  assert.notEqual(await metricValue(applicationCard, "Last used"), "Never")
  assert.ok(
    Number.parseInt(await metricValue(applicationCard, "Requests"), 10) >= 2,
  )
  assert.ok(
    Number.parseInt(await metricValue(applicationCard, "Tokens"), 10) >= 10,
  )

  await assertActualLiteLlmProjection(page, consoleOrigin)
  for (const nativePath of ["/litellm", "/ui", "/key/list", "/model/info"]) {
    const response = await page.goto(`${consoleOrigin}${nativePath}`)
    assert.equal(response?.status(), 404)
  }
  for (const nativePath of ["/ui", "/key/list", "/model/info"]) {
    const response = await requestJsonThroughEdge({
      authority: authorities.api,
      bearerToken: applicationCredential,
      caFile: certificate.ca,
      edgePort,
      method: "GET",
      path: nativePath,
    })
    assert.equal(response.status, 404)
  }

  stopLiteLlm(liteLlmControl)
  const unavailable = await requestJsonThroughEdge({
    authority: authorities.api,
    bearerToken: applicationCredential,
    body: {
      messages: [
        { content: liteLlmControl.canaries.outagePrompt, role: "user" },
      ],
      model: "fixture-model",
    },
    caFile: certificate.ca,
    edgePort,
    method: "POST",
    path: "/v1/chat/completions",
  })
  assert.ok(unavailable.status >= 500)
  await page.goto(`${consoleOrigin}/inference`)
  await page
    .getByText(/LiteLLM.*unavailable/i)
    .first()
    .waitFor()

  startLiteLlm(liteLlmControl)
  await waitForLiteLlm(liteLlmControl)
  await assertActualLiteLlmProjection(page, consoleOrigin)
  const recovered = await requestJsonThroughEdge({
    authority: authorities.api,
    bearerToken: applicationCredential,
    body: {
      messages: [
        { content: liteLlmControl.canaries.recoveryPrompt, role: "user" },
      ],
      model: "fixture-model",
    },
    caFile: certificate.ca,
    edgePort,
    method: "POST",
    path: "/v1/chat/completions",
  })
  assert.equal(recovered.status, 200)

  return {
    applicationAuthority: "Product-issued credential",
    applicationCredentialDirectLiteLlmAccess: "denied",
    consoleProjection: "health-models-usage-route-safe-credential-metadata",
    nativeCustomerAccess: "absent",
    nonStreaming: "passed",
    outageRecovery: "passed",
    streaming: "passed",
  }
}

async function assertActualLiteLlmProjection(page, consoleOrigin) {
  const deadline = performance.now() + 30_000
  while (performance.now() < deadline) {
    await page.goto(`${consoleOrigin}/inference`)
    const body = await page.locator("body").innerText()
    if (
      body.includes("fixture-model") &&
      /LiteLLM reports \d+ requests/.test(body)
    ) {
      break
    }
    await page.waitForTimeout(500)
  }
  await page.getByRole("heading", { name: "Inference" }).waitFor()
  await page.getByText("LiteLLM remains private", { exact: true }).waitFor()
  await page.getByText("fixture-model", { exact: true }).first().waitFor()
  await page
    .getByText("Route changes are not a v1 customer capability.", {
      exact: false,
    })
    .waitFor()
  await page.getByRole("button", { name: /Expand/ }).click()
  await page.getByText("core-routing", { exact: true }).waitFor()
  for (const mutationName of [
    "Create route",
    "Create virtual key",
    "Rotate virtual key",
    "Revoke virtual key",
  ]) {
    assert.equal(
      await page
        .getByRole("button", { exact: true, name: mutationName })
        .count(),
      0,
    )
  }
}

function stopLiteLlm(control) {
  const result = dockerControl(control, [
    "stop",
    "--time",
    "5",
    control.container,
  ])
  if (result.status !== 0) throw new Error("F0-L2 could not stop LiteLLM.")
}

function startLiteLlm(control) {
  const result = dockerControl(control, ["start", control.container])
  if (result.status !== 0) throw new Error("F0-L2 could not restart LiteLLM.")
}

async function waitForLiteLlm(control) {
  const deadline = performance.now() + 120_000
  let lastStatus = null
  while (performance.now() < deadline) {
    try {
      lastStatus = await requestLiteLlmStatus(control)
      if (lastStatus === 200) return
    } catch {}
    await delay(250)
  }
  throw new Error(
    `F0-L2 LiteLLM did not recover; last status was ${lastStatus ?? "unreachable"}.`,
  )
}

function requestLiteLlmStatus(control) {
  const target = new URL(control.baseUrl)
  return new Promise((resolveStatus, rejectStatus) => {
    const request = httpRequest(
      {
        headers: {
          authorization: `Bearer ${control.adminKey}`,
          connection: "close",
        },
        host: target.hostname,
        method: "GET",
        path: "/v1/models",
        port: target.port,
      },
      (response) => {
        response.once("end", () => resolveStatus(response.statusCode ?? 500))
        response.resume()
      },
    )
    request.setTimeout(2_000, () => request.destroy(new Error("timeout")))
    request.once("error", rejectStatus)
    request.end()
  })
}

function dockerControl(control, arguments_) {
  return spawnSync(
    "docker",
    ["--context", control.dockerContext, ...arguments_],
    {
      encoding: "utf8",
      env: { LANG: "C", LC_ALL: "C", PATH: process.env.PATH ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
}

async function proveApplicationConsoleFlow({
  actualFirecrawl = null,
  certificate,
  consoleOrigin,
  credentialLifecycleMode,
  edgePort,
  page,
  postgresControl,
  restartBff,
  retentionCanaries,
  sensitiveValues,
  streamingRequired = false,
  synchronizeClock,
  userCredentials,
}) {
  const applicationName = `Browser client ${randomBytes(4).toString("hex")}`
  await openApplicationCreate({
    consoleOrigin,
    page,
    synchronizeClock,
    userCredentials,
  })
  await submitApplicationCreate(page, applicationName)
  try {
    await page
      .getByRole("heading", { name: "Application credential" })
      .waitFor()
  } catch {
    throw new Error(
      `Application create did not reach its one-time reveal: ${safeDiagnosticTail(await page.locator("body").innerText())}`,
    )
  }

  const inferenceCredential = await revealedCredential(page, "API key")
  const inferenceCredentialId = await revealedCredential(page, "Credential ID")
  sensitiveValues.push(inferenceCredential)
  assertCredentialFormat(
    inferenceCredential,
    /^llmm_t4_[0-9a-f]{18}_[A-Za-z0-9_-]{43}$/,
    "inference",
  )
  assert.equal(
    await revealedCredential(page, "OpenAI base URL"),
    `https://${authorities.api}:${edgePort}/v1`,
  )
  const viewApplication = page.getByRole("link", { name: "View application" })
  const detailPath = await viewApplication.getAttribute("href")
  assert.match(detailPath ?? "", /^\/applications\/apps\/app-/)
  if (postgresControl) {
    assert.deepEqual(
      postgresApplicationFirecrawlStatus(detailPath.split("/").at(-1)),
      { credentialCount: 0, status: "disabled" },
    )
  }

  const models = await requestJsonThroughEdge({
    authority: authorities.api,
    bearerToken: inferenceCredential,
    caFile: certificate.ca,
    edgePort,
    method: "GET",
    path: "/v1/models",
  })
  assert.equal(models.status, 200)
  assert.equal(models.body?.data?.[0]?.id, "fixture-model")

  const completion = await requestJsonThroughEdge({
    authority: authorities.api,
    bearerToken: inferenceCredential,
    body: {
      messages: [
        {
          content: retentionCanaries
            ? `${retentionCanaries.prompt} ${retentionCanaries.request}`
            : "disposable fixture input",
          role: "user",
        },
      ],
      model: "fixture-model",
    },
    caFile: certificate.ca,
    edgePort,
    method: "POST",
    path: "/v1/chat/completions",
  })
  assert.equal(completion.status, 200)
  assert.equal(completion.body?.usage?.total_tokens, 5)
  if (retentionCanaries) {
    assert.equal(
      completion.body?.choices?.[0]?.message?.content,
      retentionCanaries.response,
    )
  }

  let streaming = null
  if (streamingRequired) {
    const response = await requestTextThroughEdge({
      authority: authorities.api,
      bearerToken: inferenceCredential,
      body: {
        messages: [
          {
            content: retentionCanaries?.request ?? "integrated stream input",
            role: "user",
          },
        ],
        model: "fixture-model",
        stream: true,
        stream_options: { include_usage: true },
      },
      caFile: certificate.ca,
      edgePort,
      method: "POST",
      path: "/v1/chat/completions",
    })
    assert.equal(response.status, 200)
    assert.match(response.contentType, /^text\/event-stream/)
    assert.match(response.body, /fixture-stream-response/)
    assert.match(response.body, /data: \[DONE\]/)
    streaming = "passed"
  }

  const externalOpenAiClient = integratedCoreMode
    ? await runOpenAiClientSmoke({
        apiKey: inferenceCredential,
        caFile: certificate.ca,
        edgePort,
        prompt: retentionCanaries
          ? `${retentionCanaries.prompt} ${retentionCanaries.request}`
          : "external OpenAI SDK client input",
        sensitiveValues,
      })
    : null

  await page.getByRole("button", { name: "Check connection" }).click()
  await page
    .getByText(
      "A real authenticated client reached the Application models endpoint.",
      { exact: false },
    )
    .waitFor()
  await viewApplication.click()
  await page
    .getByRole("heading", { exact: true, name: applicationName })
    .waitFor()
  const firecrawlSection = page
    .getByRole("heading", { name: "Firecrawl web access" })
    .locator("xpath=../..")
  await firecrawlSection.getByText("Disabled", { exact: true }).waitFor()
  assert.equal(
    await page
      .getByRole("heading", { exact: true, name: "Firecrawl credential" })
      .count(),
    0,
  )

  await page.getByRole("button", { name: "Enable Firecrawl" }).click()
  assert.equal(
    await page
      .getByRole("heading", { exact: true, name: "Firecrawl credential" })
      .count(),
    0,
  )
  await page
    .getByLabel(
      /I understand that enabling Firecrawl permits outbound web requests/,
    )
    .check()
  await page.getByRole("button", { name: "Enable Firecrawl" }).click()
  await page
    .getByRole("heading", { exact: true, name: "Firecrawl credential" })
    .waitFor()
  await firecrawlSection.getByText("Enabled", { exact: true }).waitFor()

  const firecrawlCredential = await revealedCredential(
    page,
    "Firecrawl API key",
  )
  const firecrawlCredentialId = await revealedCredential(
    page,
    "Firecrawl credential ID",
  )
  sensitiveValues.push(firecrawlCredential)
  assertCredentialFormat(
    firecrawlCredential,
    /^llmm_fc_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/,
    "Firecrawl",
  )
  if (firecrawlCredential === inferenceCredential) {
    throw new Error("Inference and Firecrawl credentials were not separate.")
  }

  let actualFirecrawlEvidence = null
  if (actualFirecrawl) {
    const search = await requestJsonThroughEdge({
      authority: authorities.firecrawl,
      bearerToken: firecrawlCredential,
      body: { limit: 1, query: actualFirecrawl.canaries.query },
      caFile: certificate.ca,
      edgePort,
      method: "POST",
      path: "/v2/search",
    })
    assert.equal(search.status, 200)
    assert.equal(search.body?.success, true)
    const scrape = await requestJsonThroughEdge({
      authority: authorities.firecrawl,
      bearerToken: firecrawlCredential,
      body: {
        formats: ["markdown"],
        url: `https://example.com/?trace=${actualFirecrawl.canaries.url}`,
      },
      caFile: certificate.ca,
      edgePort,
      method: "POST",
      path: "/v2/scrape",
    })
    assert.equal(scrape.status, 200)
    assert.equal(scrape.body?.success, true)
    assert.equal(typeof scrape.body?.data?.markdown, "string")
    const unsupported = await requestJsonThroughEdge({
      authority: authorities.firecrawl,
      bearerToken: firecrawlCredential,
      body: { url: "https://example.com" },
      caFile: certificate.ca,
      edgePort,
      method: "POST",
      path: "/v2/crawl",
    })
    assert.equal(unsupported.status, 404)
    actualFirecrawlEvidence = {
      search: "passed",
      staticScrape: "passed",
      unsupportedRouteDenied: true,
    }
  }
  assert.equal(
    await revealedCredential(page, "Firecrawl base URL"),
    `https://${authorities.firecrawl}:${edgePort}`,
  )

  if (credentialLifecycleMode) {
    await page.getByRole("button", { name: "Copy Firecrawl API key" }).click()
    await page
      .getByRole("button", { name: "Copy Firecrawl API key" })
      .getByText("Copied")
      .waitFor()
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      firecrawlCredential,
    )
    await page.goto(`${consoleOrigin}/applications`)
    await page.goBack()
    await assertSecretsAbsentFromPage(page, sensitiveValues)
  }

  await page.goto(`${consoleOrigin}/applications`)
  const applicationCard = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: applicationName }) })
  await applicationCard.waitFor()
  const visibleRequests = Number.parseInt(
    await metricValue(applicationCard, "Requests"),
    10,
  )
  const visibleTokens = Number.parseInt(
    await metricValue(applicationCard, "Tokens"),
    10,
  )
  if (streamingRequired) {
    assert.ok(visibleRequests >= 3)
    assert.ok(visibleTokens >= 10)
  } else {
    assert.equal(visibleRequests, 2)
    assert.equal(visibleTokens, 5)
  }
  assert.notEqual(await metricValue(applicationCard, "Last used"), "Never")
  assert.equal(await metricValue(applicationCard, "Firecrawl"), "Enabled")

  const lifecycle = credentialLifecycleMode
    ? await proveCredentialLifecycle({
        certificate,
        consoleOrigin,
        edgePort,
        firstApplication: {
          detailPath,
          firecrawlCredential,
          firecrawlCredentialId,
          inferenceCredential,
          inferenceCredentialId,
          name: applicationName,
        },
        page,
        postgresControl,
        restartBff,
        sensitiveValues,
        synchronizeClock,
        userCredentials,
      })
    : null

  return {
    applicationCreation: "passed",
    credentialMaterialPrinted: false,
    firecrawl: {
      ...(actualFirecrawlEvidence ?? {}),
      defaultOff: true,
      disclaimerRequired: true,
      perApplicationEnablement: "passed",
      separateCredential: true,
      upstreamExecutionEvidence: "F0-W1",
    },
    inference: {
      connectionEvidence: "passed",
      lastUseVisible: true,
      openAiClient:
        externalOpenAiClient ?? "not-executed-outside-integrated-core",
      requestsVisible: visibleRequests,
      tokensVisible: visibleTokens,
      ...(streaming ? { streaming } : {}),
    },
    mfaElevation: "passed",
    oneTimeReveal: "passed",
    ...(lifecycle ? { lifecycle } : {}),
  }
}

async function proveCredentialLifecycle({
  certificate,
  consoleOrigin,
  edgePort,
  firstApplication,
  page,
  postgresControl,
  restartBff,
  sensitiveValues,
  synchronizeClock,
  userCredentials,
}) {
  await page.goto(`${consoleOrigin}${firstApplication.detailPath}`)

  await page.getByRole("button", { name: "Rotate credentials" }).click()
  const inferenceRotation = page.getByRole("dialog", {
    name: "Rotate Application credential?",
  })
  await inferenceRotation.getByRole("button", { name: "Rotate" }).click()
  await page.getByRole("heading", { name: "Rotated credential" }).waitFor()
  await page.getByText("exact 24-hour overlap", { exact: false }).waitFor()
  const rotatedInferenceCredential = await revealedCredential(page, "API key")
  const rotatedInferenceCredentialId = await revealedCredential(
    page,
    "Credential ID",
  )
  assertCredentialFormat(
    rotatedInferenceCredential,
    /^llmm_t4_[0-9a-f]{18}_[A-Za-z0-9_-]{43}$/,
    "rotated inference",
  )
  sensitiveValues.push(rotatedInferenceCredential)
  await assertInferenceCredentialAccepted({
    certificate,
    credential: firstApplication.inferenceCredential,
    edgePort,
  })
  await assertInferenceCredentialAccepted({
    certificate,
    credential: rotatedInferenceCredential,
    edgePort,
  })
  await page.getByRole("button", { name: "Check connection" }).click()
  await page
    .getByText("A real authenticated client reached", { exact: false })
    .waitFor()
  await assertCredentialCard(page, firstApplication.inferenceCredentialId, {
    lastUse: "used",
    status: "Retiring",
  })
  await assertCredentialCard(page, rotatedInferenceCredentialId, {
    age: "Issued today",
    status: "Active",
  })

  await page
    .getByRole("button", { name: "Rotate Firecrawl credential" })
    .click()
  const firecrawlRotation = page.getByRole("dialog", {
    name: "Rotate Firecrawl credential?",
  })
  await firecrawlRotation
    .getByRole("button", { name: "Rotate Firecrawl key" })
    .click()
  await page
    .getByRole("heading", { name: "Rotated Firecrawl credential" })
    .waitFor()
  const rotatedFirecrawlCredential = await revealedCredential(
    page,
    "Firecrawl API key",
  )
  const rotatedFirecrawlCredentialId = await revealedCredential(
    page,
    "Firecrawl credential ID",
  )
  assertCredentialFormat(
    rotatedFirecrawlCredential,
    /^llmm_fc_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/,
    "rotated Firecrawl",
  )
  sensitiveValues.push(rotatedFirecrawlCredential)
  await assertFirecrawlCredentialAccepted({
    certificate,
    credential: firstApplication.firecrawlCredential,
    edgePort,
  })
  await assertFirecrawlCredentialAccepted({
    certificate,
    credential: rotatedFirecrawlCredential,
    edgePort,
  })
  await page.getByRole("button", { name: "Check Firecrawl connection" }).click()
  await page
    .getByText(
      "A real authenticated Firecrawl gateway connection was observed",
      {
        exact: false,
      },
    )
    .waitFor()
  await assertCredentialCard(page, firstApplication.firecrawlCredentialId, {
    lastUse: "used",
    status: "Retiring",
  })
  await assertCredentialCard(page, rotatedFirecrawlCredentialId, {
    age: "Issued today",
    status: "Active",
  })

  await openApplicationCreate({
    consoleOrigin,
    page,
    synchronizeClock,
    userCredentials,
  })
  const secondName = `Isolated browser client ${randomBytes(4).toString("hex")}`
  await submitApplicationCreate(page, secondName)
  await page.getByRole("heading", { name: "Application credential" }).waitFor()
  const secondInferenceCredential = await revealedCredential(page, "API key")
  const secondInferenceCredentialId = await revealedCredential(
    page,
    "Credential ID",
  )
  sensitiveValues.push(secondInferenceCredential)
  const secondDetailPath = await page
    .getByRole("link", { name: "View application" })
    .getAttribute("href")
  assert.match(secondDetailPath ?? "", /^\/applications\/apps\/app-/)
  await page.getByRole("link", { name: "View application" }).click()
  await page.getByRole("button", { name: "Enable Firecrawl" }).click()
  await page
    .getByLabel(
      /I understand that enabling Firecrawl permits outbound web requests/,
    )
    .check()
  await page.getByRole("button", { name: "Enable Firecrawl" }).click()
  await page.getByRole("heading", { name: "Firecrawl credential" }).waitFor()
  const secondFirecrawlCredential = await revealedCredential(
    page,
    "Firecrawl API key",
  )
  const secondFirecrawlCredentialId = await revealedCredential(
    page,
    "Firecrawl credential ID",
  )
  sensitiveValues.push(secondFirecrawlCredential)

  await assertInferenceCredentialAccepted({
    certificate,
    credential: secondInferenceCredential,
    edgePort,
  })
  await assertFirecrawlCredentialAccepted({
    certificate,
    credential: secondFirecrawlCredential,
    edgePort,
  })
  await assertCrossApplicationMutationDenied({
    foreignCredentialId: firstApplication.inferenceCredentialId,
    ownCredentialId: secondInferenceCredentialId,
    page,
    type: "inference",
  })
  await assertCrossApplicationMutationDenied({
    foreignCredentialId: firstApplication.firecrawlCredentialId,
    ownCredentialId: secondFirecrawlCredentialId,
    page,
    type: "firecrawl",
  })
  await assertInferenceCredentialAccepted({
    certificate,
    credential: secondInferenceCredential,
    edgePort,
  })
  await assertFirecrawlCredentialAccepted({
    certificate,
    credential: secondFirecrawlCredential,
    edgePort,
  })

  let restartEvidence = null
  await page.goto(`${consoleOrigin}${firstApplication.detailPath}`)
  if (postgresControl) {
    assert.ok(restartBff)
    await revokeCredentialThroughUi(
      page,
      firstApplication.firecrawlCredentialId,
      "Revoke Firecrawl key",
    )
    expireInferenceCredential(firstApplication.inferenceCredentialId)
    restartEvidence = await restartBff()
    await page.goto(`${consoleOrigin}${firstApplication.detailPath}`)
    await assertRole(page, "Administrator")
    await page
      .getByRole("heading", { name: "Firecrawl web access" })
      .locator("xpath=../..")
      .getByText("Enabled", { exact: true })
      .waitFor()
    await assertCredentialDenied({
      authority: authorities.api,
      body: undefined,
      certificate,
      credential: firstApplication.inferenceCredential,
      edgePort,
      path: "/v1/models",
    })
    await assertInferenceCredentialAccepted({
      certificate,
      credential: rotatedInferenceCredential,
      edgePort,
    })
    await assertCredentialDenied({
      authority: authorities.firecrawl,
      body: { limit: 1, query: "post-restart revoked credential" },
      certificate,
      credential: firstApplication.firecrawlCredential,
      edgePort,
      path: "/v2/search",
    })
    await assertFirecrawlCredentialAccepted({
      certificate,
      credential: rotatedFirecrawlCredential,
      edgePort,
    })
    await assertInferenceCredentialAccepted({
      certificate,
      credential: secondInferenceCredential,
      edgePort,
    })
    await assertFirecrawlCredentialAccepted({
      certificate,
      credential: secondFirecrawlCredential,
      edgePort,
    })
  } else {
    await revokeCredentialThroughUi(
      page,
      firstApplication.firecrawlCredentialId,
      "Revoke Firecrawl key",
    )
  }
  await revokeCredentialThroughUi(
    page,
    rotatedFirecrawlCredentialId,
    "Revoke Firecrawl key",
  )
  await revokeCredentialThroughUi(
    page,
    firstApplication.inferenceCredentialId,
    "Revoke now",
  )
  await revokeCredentialThroughUi(
    page,
    rotatedInferenceCredentialId,
    "Revoke now",
  )

  for (const credential of [
    firstApplication.inferenceCredential,
    rotatedInferenceCredential,
  ]) {
    await assertCredentialDenied({
      authority: authorities.api,
      body: undefined,
      certificate,
      credential,
      edgePort,
      path: "/v1/models",
    })
  }
  for (const credential of [
    firstApplication.firecrawlCredential,
    rotatedFirecrawlCredential,
  ]) {
    await assertCredentialDenied({
      authority: authorities.firecrawl,
      body: { limit: 1, query: "post-revocation fixture query" },
      certificate,
      credential,
      edgePort,
      path: "/v2/search",
    })
  }
  await assertInferenceCredentialAccepted({
    certificate,
    credential: secondInferenceCredential,
    edgePort,
  })
  await assertFirecrawlCredentialAccepted({
    certificate,
    credential: secondFirecrawlCredential,
    edgePort,
  })

  await page.goto(`${consoleOrigin}/applications`)
  await assertSecretsAbsentFromPage(page, sensitiveValues)

  return {
    ageAndLastUse: "passed",
    crossApplicationMutationDenial: "passed",
    exactStaticOverlapSeconds: 86_400,
    firecrawlRotationAndRevocation: "passed",
    inferenceRotationAndRevocation: "passed",
    operatorPaths: [firstApplication.detailPath, secondDetailPath],
    ...(restartEvidence ? { restart: restartEvidence } : {}),
    secondApplicationIsolation: "passed",
    secretDomAndHistoryRetention: "none",
  }
}

async function assertInferenceCredentialAccepted({
  certificate,
  credential,
  edgePort,
}) {
  const response = await requestJsonThroughEdge({
    authority: authorities.api,
    bearerToken: credential,
    caFile: certificate.ca,
    edgePort,
    method: "GET",
    path: "/v1/models",
  })
  assert.equal(response.status, 200, "An expected inference credential failed.")
}

async function assertFirecrawlCredentialAccepted({
  certificate,
  credential,
  edgePort,
}) {
  const response = await requestJsonThroughEdge({
    authority: authorities.firecrawl,
    bearerToken: credential,
    body: { limit: 1, query: "deterministic lifecycle query" },
    caFile: certificate.ca,
    edgePort,
    method: "POST",
    path: "/v2/search",
  })
  assert.equal(response.status, 200, "An expected Firecrawl credential failed.")
}

async function assertCredentialDenied({
  authority,
  body,
  certificate,
  credential,
  edgePort,
  path,
}) {
  const response = await requestJsonThroughEdge({
    authority,
    bearerToken: credential,
    body,
    caFile: certificate.ca,
    edgePort,
    method: body ? "POST" : "GET",
    path,
  })
  assert.equal(response.status, 401, "A revoked credential was accepted.")
}

async function assertCredentialCard(page, credentialId, expected) {
  const card = page.locator("article").filter({ hasText: credentialId })
  await card.waitFor()
  let text = ""
  for (let attempt = 0; attempt < 50; attempt += 1) {
    text = await card.innerText()
    if (text.split("\n").includes(expected.status)) {
      break
    }
    await page.waitForTimeout(100)
  }
  if (!text.split("\n").includes(expected.status)) {
    throw new Error(
      `Credential metadata did not reach ${expected.status}: ${safeDiagnosticTail(text)}`,
    )
  }
  if (expected.age) {
    assert.equal(await metricValue(card, "Age"), expected.age)
  }
  if (expected.lastUse === "used") {
    if ((await metricValue(card, "Last use")) === "Never") {
      throw new Error(
        `Credential last-use metadata remained empty: ${safeDiagnosticTail(text)}`,
      )
    }
  }
}

async function assertCrossApplicationMutationDenied({
  foreignCredentialId,
  ownCredentialId,
  page,
  type,
}) {
  const buttonName =
    type === "firecrawl" ? "Revoke Firecrawl key" : "Revoke now"
  const ownCard = page.locator("article").filter({ hasText: ownCredentialId })
  await ownCard.getByRole("button", { name: buttonName }).click()
  const dialog = page.getByRole("dialog", {
    name:
      type === "firecrawl"
        ? "Revoke Firecrawl credential?"
        : "Revoke credential now?",
  })
  await dialog
    .locator('input[name="credentialId"]')
    .evaluate((input, value) => {
      input.value = String(value)
    }, foreignCredentialId)
  await dialog.getByRole("button", { name: buttonName }).click()
  await page
    .locator("output")
    .filter({ hasText: /not found|revocation failed/i })
    .last()
    .waitFor()
  await assertCredentialCard(page, ownCredentialId, { status: "Active" })
}

async function revokeCredentialThroughUi(page, credentialId, buttonName) {
  const card = page.locator("article").filter({ hasText: credentialId })
  await card.getByRole("button", { name: buttonName }).click()
  const dialog = page.getByRole("dialog", {
    name:
      buttonName === "Revoke Firecrawl key"
        ? "Revoke Firecrawl credential?"
        : "Revoke credential now?",
  })
  await dialog.getByRole("button", { name: buttonName }).click()
  await page
    .locator("output")
    .filter({
      hasText:
        buttonName === "Revoke Firecrawl key"
          ? "Firecrawl key revoked."
          : "Credential revoked immediately.",
    })
    .last()
    .waitFor()
  await assertCredentialCard(page, credentialId, { status: "Revoked" })
}

async function assertSecretsAbsentFromPage(page, sensitiveValues) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const content = await page.content()
      assertNoSensitiveValues(
        [content, page.url()],
        sensitiveValues,
        "browser DOM",
      )
      return
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("page is navigating") ||
        attempt === 9
      ) {
        throw error
      }
      await page.waitForTimeout(100)
    }
  }
}

async function assertOperatorApplicationReadOnly(page, applicationFlow) {
  for (const path of applicationFlow.lifecycle.operatorPaths) {
    await page.goto(new URL(path, page.url()).toString())
    await page
      .getByText("Operator access is read-only.", { exact: false })
      .first()
      .waitFor()
    for (const name of [
      "Check connection",
      "Rotate credentials",
      "Revoke now",
      "Disable app",
      "Check Firecrawl connection",
      "Rotate Firecrawl credential",
      "Revoke Firecrawl key",
      "Disable Firecrawl",
    ]) {
      assert.equal(await page.getByRole("button", { name }).count(), 0)
    }
  }
}

async function openApplicationCreate({
  consoleOrigin,
  page,
  synchronizeClock,
  userCredentials,
}) {
  await page.goto(`${consoleOrigin}/applications/apps/new`)
  const form = page.getByRole("heading", { name: "Applications > Add app" })
  const elevation = page.getByRole("heading", { name: "Verify your identity" })
  await Promise.race([form.waitFor(), elevation.waitFor()])
  if ((await elevation.count()) === 0) {
    return
  }

  await synchronizeClock()
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/console/session/elevate",
  )
  await page.getByRole("button", { name: "Continue to verification" }).click()
  const response = await responsePromise
  try {
    if (keycloakIdentityMode) {
      await Promise.race([
        page.locator("#username").waitFor({ timeout: 5_000 }),
        page
          .locator("nav[aria-label='Console navigation']")
          .waitFor({ timeout: 5_000 }),
      ])
    } else {
      await page
        .getByRole("heading", { name: "Fixture identity sign in" })
        .waitFor({ timeout: 5_000 })
    }
  } catch {
    const location = response.headers().location
    const redirect = location ? new URL(location) : null
    throw new Error(
      `MFA elevation returned ${response.status()} with redirect ${redirect ? `${redirect.origin}${redirect.pathname}` : "absent"} but did not navigate at ${new URL(page.url()).pathname}: ${safeDiagnosticTail(await page.locator("body").innerText())}`,
    )
  }
  await completeIdentityLogin(page, userCredentials)
  assert.equal(new URL(page.url()).pathname, "/applications/apps/new")
  await form.waitFor()
}

async function submitApplicationCreate(page, applicationName) {
  await page.getByLabel("Name").fill(applicationName)
  await page
    .getByLabel("Description")
    .fill("Disposable browser-driven Application proof")
  await page.getByLabel("fixture-model").check()
  await page.getByRole("button", { name: "Create app" }).click()
}

async function revealedCredential(page, label) {
  const copyButton = page.getByRole("button", { name: `Copy ${label}` })
  await copyButton.waitFor()
  return copyButton.locator("xpath=../div/*[last()]").innerText()
}

function assertCredentialFormat(value, pattern, label) {
  if (!pattern.test(value)) {
    throw new Error(`The ${label} credential did not use its approved format.`)
  }
}

async function metricValue(container, label) {
  const metric = container.locator("dt", { hasText: label })
  await metric.waitFor()
  assert.equal((await metric.innerText()).trim(), label.toUpperCase())
  return metric.locator("xpath=following-sibling::dd").innerText()
}

async function requestJsonThroughEdge({
  authority,
  bearerToken,
  body,
  caFile,
  edgePort,
  method,
  path,
}) {
  const encodedBody = body === undefined ? undefined : JSON.stringify(body)
  const ca = await readFile(caFile)
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpsRequest(
      {
        ca,
        headers: {
          authorization: `Bearer ${bearerToken}`,
          host: `${authority}:${edgePort}`,
          ...(encodedBody
            ? {
                "content-length": Buffer.byteLength(encodedBody),
                "content-type": "application/json",
              }
            : {}),
        },
        host: "127.0.0.1",
        method,
        path,
        port: edgePort,
        rejectUnauthorized: true,
        servername: authority,
      },
      (response) => {
        const chunks = []
        response.on("data", (chunk) => chunks.push(chunk))
        response.once("end", () => {
          const payload = Buffer.concat(chunks).toString("utf8")
          try {
            resolveRequest({
              body: payload ? JSON.parse(payload) : null,
              status: response.statusCode ?? 500,
            })
          } catch {
            rejectRequest(new Error("The Product edge returned invalid JSON."))
          }
        })
      },
    )
    request.once("error", rejectRequest)
    request.end(encodedBody)
  })
}

async function requestTextThroughEdge({
  authority,
  bearerToken,
  body,
  caFile,
  edgePort,
  method,
  path,
}) {
  const encodedBody = JSON.stringify(body)
  const ca = await readFile(caFile)
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpsRequest(
      {
        ca,
        headers: {
          accept: "text/event-stream",
          authorization: `Bearer ${bearerToken}`,
          "content-length": Buffer.byteLength(encodedBody),
          "content-type": "application/json",
          host: `${authority}:${edgePort}`,
        },
        host: "127.0.0.1",
        method,
        path,
        port: edgePort,
        rejectUnauthorized: true,
        servername: authority,
      },
      (response) => {
        const chunks = []
        response.on("data", (chunk) => chunks.push(chunk))
        response.once("end", () => {
          resolveRequest({
            body: Buffer.concat(chunks).toString("utf8"),
            contentType: String(response.headers["content-type"] ?? ""),
            status: response.statusCode ?? 500,
          })
        })
      },
    )
    request.once("error", rejectRequest)
    request.end(encodedBody)
  })
}

async function runOpenAiClientSmoke({
  apiKey,
  caFile,
  edgePort,
  prompt,
  sensitiveValues,
}) {
  const stdoutChunks = []
  const stderrChunks = []
  let outputLength = 0
  let stdinFailure = null
  const child = spawn(
    process.execPath,
    [resolve(repositoryRoot, "test-support/f0-e2e2-openai-client/client.mjs")],
    {
      cwd: repositoryRoot,
      env: {
        LANG: "C",
        LC_ALL: "C",
        PATH: process.env.PATH ?? "",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  )
  const collect = (target) => (chunk) => {
    outputLength += chunk.length
    if (outputLength > 65_536) {
      child.kill("SIGKILL")
      return
    }
    target.push(chunk)
  }
  child.stdout.on("data", collect(stdoutChunks))
  child.stderr.on("data", collect(stderrChunks))
  child.stdin.on("error", (error) => {
    if (error.code !== "EPIPE") stdinFailure = error
  })
  child.stdin.end(
    JSON.stringify({
      apiKey,
      baseUrl: `https://${authorities.api}:${edgePort}/v1`,
      caFile,
      model: "fixture-model",
      prompt,
    }),
  )

  const outcome = await new Promise((resolveChild, rejectChild) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL")
      rejectChild(new Error("The external OpenAI SDK client timed out."))
    }, 60_000)
    child.once("error", (error) => {
      clearTimeout(timeout)
      rejectChild(error)
    })
    child.once("close", (code, signal) => {
      clearTimeout(timeout)
      resolveChild({ code, signal })
    })
  })
  const stdout = Buffer.concat(stdoutChunks).toString("utf8")
  const stderr = Buffer.concat(stderrChunks).toString("utf8")
  assertNoSensitiveValues(
    [stdout, stderr],
    sensitiveValues,
    "external OpenAI SDK client output",
  )
  if (outputLength > 65_536) {
    throw new Error("The external OpenAI SDK client exceeded its output limit.")
  }
  if (stdinFailure) {
    throw new Error("The external OpenAI SDK client input failed.")
  }
  if (outcome.code !== 0) {
    throw new Error(
      `The external OpenAI SDK client failed with ${outcome.signal ?? outcome.code}: ${redactedDiagnosticTail(stderr, sensitiveValues)}`,
    )
  }

  let evidence
  try {
    evidence = JSON.parse(stdout)
  } catch {
    throw new Error("The external OpenAI SDK client returned invalid evidence.")
  }
  assert.deepEqual(
    {
      client: evidence.client,
      clientVersion: evidence.clientVersion,
      modelDiscovery: evidence.modelDiscovery,
      nonStreamingStatus: evidence.nonStreaming?.status,
      processBoundary: evidence.processBoundary,
      streamingStatus: evidence.streaming?.status,
    },
    {
      client: "openai-node",
      clientVersion: "7.4.0",
      modelDiscovery: "passed",
      nonStreamingStatus: "passed",
      processBoundary: "child",
      streamingStatus: "passed",
    },
  )
  assert.ok(evidence.nonStreaming.totalTokens > 0)
  assert.ok(evidence.streaming.chunks > 0)
  assert.ok(evidence.streaming.totalTokens > 0)
  return evidence
}

function createDevelopmentEdge({
  applicationsMode,
  bffPort,
  certificate,
  edgePort,
  identityFixtureFailures,
  keycloakControl,
  observedOrigins,
  oidc,
  tlsErrors,
  webPort,
}) {
  const server = createHttpsServer(
    { cert: certificate.cert, key: certificate.key },
    (request, response) => {
      const host = (request.headers.host ?? "").split(":", 1)[0].toLowerCase()
      const url = new URL(request.url ?? "/", `https://${request.headers.host}`)
      if (host === authorities.identity) {
        if (keycloakControl) {
          proxyIdentityRequest(
            request,
            response,
            url,
            keycloakControl.upstreamPort,
          )
          return
        }
        void oidc.handle(request, response, url).catch((error) => {
          identityFixtureFailures.push(
            error instanceof Error ? error.message : "unknown_fixture_failure",
          )
          if (!response.headersSent) {
            sendJson(response, 400, { error: "identity_fixture_failure" })
          } else {
            response.destroy()
          }
        })
        return
      }
      if (host === authorities.console) {
        if (
          url.pathname === "/api/console/session/logout" ||
          url.pathname === "/api/console/session/elevate"
        ) {
          observedOrigins.push(String(request.headers.origin ?? "absent"))
        }
        const targetPort = url.pathname.startsWith("/api/console/session/")
          ? bffPort
          : webPort
        proxyRequest(
          request,
          response,
          targetPort,
          url.pathname + url.search,
          edgePort,
        )
        return
      }
      if (host === authorities.api && applicationsMode) {
        proxyRequest(
          request,
          response,
          bffPort,
          `/api/app-gateway${url.pathname}${url.search}`,
          edgePort,
          true,
        )
        return
      }
      if (host === authorities.firecrawl && applicationsMode) {
        proxyRequest(
          request,
          response,
          bffPort,
          url.pathname + url.search,
          edgePort,
          true,
        )
        return
      }
      if (host === authorities.api || host === authorities.firecrawl) {
        sendJson(response, 404, { error: "surface_not_used_by_f0_s1" })
        return
      }
      sendJson(response, 421, { error: "unknown_authority" })
    },
  )
  server.on("tlsClientError", (error) => tlsErrors.push(error.message))
  return server
}

function proxyIdentityRequest(incoming, outgoing, url, upstreamPort) {
  const boundary = evaluateSourceBoundary({
    customerPort: 443,
    headers: incoming.headers,
    hostHeaders: [authorities.identity],
    hosts: authorities,
    method: incoming.method ?? "GET",
    rawTarget: `${url.pathname}${url.search}`,
    sni: authorities.identity,
  })
  if (!boundary.allowed) {
    sendJson(outgoing, 404, { error: "identity_route_denied" })
    return
  }
  const upstream = httpRequest(
    {
      headers: boundary.forwardedHeaders,
      host: "127.0.0.1",
      method: incoming.method,
      path: `${boundary.upstreamPath}${url.search}`,
      port: upstreamPort,
    },
    (upstreamResponse) => {
      outgoing.writeHead(
        upstreamResponse.statusCode ?? 502,
        withoutHopByHop(upstreamResponse.headers),
      )
      upstreamResponse.pipe(outgoing)
    },
  )
  upstream.on("error", () => {
    if (!outgoing.headersSent) {
      sendJson(outgoing, 502, { error: "identity_unavailable" })
    } else {
      outgoing.destroy()
    }
  })
  incoming.pipe(upstream)
}

function proxyRequest(
  incoming,
  outgoing,
  port,
  path,
  edgePort,
  forwardAuthorization = false,
) {
  const headers = normalizedProxyHeaders(incoming, forwardAuthorization)
  const upstream = httpRequest(
    {
      headers,
      host: "127.0.0.1",
      method: incoming.method,
      path,
      port,
    },
    (upstreamResponse) => {
      const responseHeaders = withoutHopByHop(upstreamResponse.headers)
      const location = normalizedConsoleLocation(
        responseHeaders.location,
        edgePort,
        port,
      )
      if (location) {
        responseHeaders.location = location
      }
      outgoing.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders)
      upstreamResponse.pipe(outgoing)
    },
  )
  upstream.on("error", () => {
    if (!outgoing.headersSent) {
      sendJson(outgoing, 502, { error: "upstream_unavailable" })
    } else {
      outgoing.destroy()
    }
  })
  incoming.pipe(upstream)
}

function normalizedConsoleLocation(location, edgePort, upstreamPort) {
  if (typeof location !== "string") {
    return location
  }
  const url = new URL(location, `https://${authorities.console}:${edgePort}`)
  if (
    (url.protocol === "http:" &&
      url.hostname === authorities.console &&
      url.port === String(edgePort)) ||
    (["127.0.0.1", "localhost"].includes(url.hostname) &&
      url.port === String(upstreamPort))
  ) {
    url.protocol = "https:"
    url.hostname = authorities.console
    url.port = String(edgePort)
    return url.toString()
  }
  return location
}

function normalizedProxyHeaders(request, forwardAuthorization = false) {
  const blocked = new Set([
    ...(forwardAuthorization ? [] : ["authorization"]),
    ...(forwardAuthorization
      ? ["cookie", "x-llm-machines-console-session"]
      : []),
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
  ])
  const headers = Object.fromEntries(
    Object.entries(withoutHopByHop(request.headers)).filter(
      ([name]) => !blocked.has(name),
    ),
  )
  headers["x-forwarded-for"] = request.socket.remoteAddress ?? "127.0.0.1"
  headers["x-forwarded-host"] = request.headers.host ?? ""
  headers["x-forwarded-proto"] = "https"
  return headers
}

function withoutHopByHop(headers) {
  const blocked = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ])
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !blocked.has(name)),
  )
}

function createInferenceDouble(
  apiKey,
  responseContent,
  control = { available: true, requests: [] },
  observabilityCanaries = null,
) {
  return createHttpServer((request, response) => {
    void handleInferenceDoubleRequest(
      request,
      response,
      apiKey,
      responseContent,
      control,
      observabilityCanaries,
    ).catch(() => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: "fixture_failure" })
      } else {
        response.destroy()
      }
    })
  })
}

function createFirecrawlDouble() {
  return createHttpServer((request, response) => {
    void handleFirecrawlDoubleRequest(request, response).catch(() => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: "fixture_failure" })
      } else {
        response.destroy()
      }
    })
  })
}

async function handleFirecrawlDoubleRequest(request, response) {
  if (
    request.method !== "POST" ||
    (request.url !== "/v2/search" && request.url !== "/v2/scrape")
  ) {
    sendJson(response, 404, { error: "unsupported" })
    return
  }
  if (request.headers.authorization || request.headers.cookie) {
    sendJson(response, 400, { error: "credential_forwarding_forbidden" })
    return
  }
  const body = await readJsonRequest(request)
  if (
    !body ||
    (request.url === "/v2/search"
      ? typeof body.query !== "string"
      : typeof body.url !== "string" ||
        new URL(body.url).hostname !== "allowed.example.test")
  ) {
    sendJson(response, 400, { error: "invalid_fixture_request" })
    return
  }
  sendJson(response, 200, {
    data:
      request.url === "/v2/search"
        ? {
            web: [
              {
                description: "Deterministic search description",
                title: "Deterministic search result",
                url: "https://allowed.example.test/result",
              },
            ],
          }
        : {
            markdown: "# Deterministic scrape result",
            metadata: {
              sourceURL: "https://allowed.example.test/page",
              statusCode: 200,
              title: "Deterministic scrape result",
            },
          },
    success: true,
  })
}

async function handleInferenceDoubleRequest(
  request,
  response,
  apiKey,
  responseContent,
  control,
  observabilityCanaries,
) {
  const authorized = request.headers.authorization === `Bearer ${apiKey}`
  const url = new URL(request.url ?? "/", "http://fixture.invalid")
  control.requests.push({
    authorized,
    method: request.method ?? "UNKNOWN",
    path: url.pathname,
    queryKeys: [...new Set(url.searchParams.keys())].sort(),
  })
  if (!authorized) {
    sendJson(response, 401, { error: "unauthorized" })
    return
  }
  if (!control.available) {
    sendJson(response, 503, { error: "fixture_unavailable" })
    return
  }
  if (request.method === "GET" && url.pathname === "/v1/models") {
    sendJson(response, 200, {
      data: [{ id: "fixture-model", object: "model", owned_by: "fixture" }],
      object: "list",
    })
    return
  }
  if (
    request.method === "GET" &&
    url.pathname === "/user/daily/activity/aggregated"
  ) {
    sendJson(response, 200, {
      metadata: {
        total_api_requests: observabilityCanaries ? 17 : 0,
        total_tokens: observabilityCanaries ? 1700 : 0,
      },
      results: observabilityCanaries
        ? [
            {
              breakdown: {
                model_groups: {
                  "fixture-model": {
                    metrics: { api_requests: 17, total_tokens: 1700 },
                  },
                },
              },
              date: "2026-08-07",
              metrics: { total_api_requests: 17, total_tokens: 1700 },
            },
          ]
        : [],
    })
    return
  }
  if (request.method === "GET" && url.pathname === "/model/info") {
    sendJson(response, 200, {
      data: [
        {
          model_info: {
            id: "fixture-model-id",
            litellm_provider: "fixture",
            max_context_tokens: 8192,
          },
          model_name: "fixture-model",
        },
      ],
    })
    return
  }
  if (request.method === "GET" && url.pathname === "/key/list") {
    sendJson(response, 200, {
      current_page: 1,
      keys: observabilityCanaries
        ? [
            {
              blocked: false,
              key_alias: "core-routing",
              last_active: "2026-08-07T12:00:00.000Z",
              models: ["fixture-model"],
              team_alias: "inference-core",
              token: observabilityCanaries.liteLlmCredential,
            },
          ]
        : [],
      total_count: observabilityCanaries ? 1 : 0,
      total_pages: 1,
    })
    return
  }
  if (request.method === "GET" && url.pathname === "/spend/logs/v2") {
    sendJson(response, 200, {
      data: observabilityCanaries
        ? [
            {
              model_group: "fixture-model",
              spend: 0,
              start_time: "2026-08-07T12:00:00.000Z",
              total_tokens: 100,
            },
          ]
        : [],
    })
    return
  }
  if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
    sendJson(response, 404, { error: "unsupported" })
    return
  }
  const body = await readJsonRequest(request)
  if (body?.model !== "fixture-model" || !Array.isArray(body.messages)) {
    sendJson(response, 400, { error: "invalid_fixture_request" })
    return
  }
  sendJson(response, 200, {
    choices: [
      {
        finish_reason: "stop",
        index: 0,
        message: { content: responseContent, role: "assistant" },
      },
    ],
    created: 0,
    id: "chatcmpl-fixture",
    model: "fixture-model",
    object: "chat.completion",
    usage: { completion_tokens: 2, prompt_tokens: 3, total_tokens: 5 },
  })
}

function createPrometheusDouble(apiKey, control) {
  return createHttpServer((request, response) => {
    const authorized = request.headers.authorization === `Bearer ${apiKey}`
    const url = new URL(request.url ?? "/", "http://fixture.invalid")
    control.requests.push({
      authorized,
      method: request.method ?? "UNKNOWN",
      path: url.pathname,
      queryKeys: [...new Set(url.searchParams.keys())].sort(),
    })
    if (!authorized) {
      sendJson(response, 401, { error: "unauthorized" })
      return
    }
    if (!control.available) {
      sendJson(response, 503, { error: "fixture_unavailable" })
      return
    }
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method_not_allowed" })
      return
    }
    if (url.pathname === "/api/v1/query") {
      const query = url.searchParams.get("query") ?? ""
      const timestamp = Math.floor(Date.now() / 1000)
      const result = query.startsWith("up{")
        ? [
            {
              metric: { host: "core-a", job: "node" },
              value: [timestamp, "1"],
            },
            {
              metric: { host: "inference-a", job: "dcgm" },
              value: [timestamp, "1"],
            },
          ]
        : [
            {
              metric: { host: "core-a" },
              value: [timestamp, query.includes("filesystem") ? "71" : "62"],
            },
          ]
      sendJson(response, 200, {
        data: { result, resultType: "vector" },
        status: "success",
      })
      return
    }
    if (url.pathname === "/api/v1/query_range") {
      const end = Number(url.searchParams.get("end"))
      const start = Number(url.searchParams.get("start"))
      const query = url.searchParams.get("query") ?? ""
      const metric = {
        __name__: metricNameForQuery(query),
        device: query.includes("network") ? "eth0" : "/dev/vda1",
        direction: query.includes("transmit") ? "TX" : "RX",
        gpu: "0",
        host: "core-a",
        mountpoint: "/",
      }
      sendJson(response, 200, {
        data: {
          result: [
            {
              metric,
              values: [
                [Number.isFinite(start) ? start : 1, "41"],
                [Number.isFinite(end) ? end : 2, "42"],
              ],
            },
          ],
          resultType: "matrix",
        },
        status: "success",
      })
      return
    }
    sendJson(response, 404, { error: "unsupported" })
  })
}

function createAlertmanagerDouble(apiKey, control, observabilityCanaries) {
  return createHttpServer((request, response) => {
    const authorized = request.headers.authorization === `Bearer ${apiKey}`
    const url = new URL(request.url ?? "/", "http://fixture.invalid")
    control.requests.push({
      authorized,
      method: request.method ?? "UNKNOWN",
      path: url.pathname,
      queryKeys: [...new Set(url.searchParams.keys())].sort(),
    })
    if (request.method === "GET" && url.pathname === "/-/ready") {
      sendJson(response, control.available ? 200 : 503, {
        status: control.available ? "ready" : "unavailable",
      })
      return
    }
    if (!authorized) {
      sendJson(response, 401, { error: "unauthorized" })
      return
    }
    if (!control.available) {
      sendJson(response, 503, { error: "fixture_unavailable" })
      return
    }
    if (request.method !== "GET" || url.pathname !== "/api/v2/alerts") {
      sendJson(response, 404, { error: "unsupported" })
      return
    }
    sendJson(response, 200, [
      {
        labels: {
          alertname: "LLMMGpuSaturation",
          component: "inference",
          severity: "warning",
          unapproved: observabilityCanaries.workload,
        },
        startsAt: "2026-08-07T12:00:00.000Z",
        status: { state: "active" },
      },
      {
        labels: {
          alertname: observabilityCanaries.alertLabel,
          component: "inference",
          severity: "critical",
        },
        startsAt: "2026-08-07T12:00:00.000Z",
        status: { state: "active" },
      },
    ])
  })
}

function metricNameForQuery(query) {
  if (query.includes("GPU_TEMP")) return "DCGM_FI_DEV_GPU_TEMP"
  if (query.includes("GPU_UTIL")) return "DCGM_FI_DEV_GPU_UTIL"
  if (query.includes("memory")) return "node_memory_MemAvailable_bytes"
  if (query.includes("filesystem")) return "node_filesystem_avail_bytes"
  if (query.includes("power")) return "ipmi_dcmi_power_consumption_watts"
  if (query.includes("network")) return "node_network_receive_bytes_total"
  return "node_cpu_seconds_total"
}

async function createCertificate(stateRoot) {
  const caKey = join(stateRoot, "ca.key")
  const ca = join(stateRoot, "ca.crt")
  const key = join(stateRoot, "edge.key")
  const request = join(stateRoot, "edge.csr")
  const cert = join(stateRoot, "edge.crt")
  const extensions = join(stateRoot, "edge.ext")
  await writeFile(
    extensions,
    [
      "basicConstraints=CA:FALSE",
      "keyUsage=digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",
      `subjectAltName=${Object.values(authorities)
        .map((host) => `DNS:${host}`)
        .join(",")}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  )
  runOpenSsl([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    caKey,
    "-out",
    ca,
    "-subj",
    "/CN=LLMM F0-S1 throwaway CA",
    "-days",
    "1",
    "-sha256",
  ])
  runOpenSsl([
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    request,
    "-subj",
    `/CN=${authorities.console}`,
  ])
  runOpenSsl([
    "x509",
    "-req",
    "-in",
    request,
    "-CA",
    ca,
    "-CAkey",
    caKey,
    "-CAcreateserial",
    "-out",
    cert,
    "-days",
    "1",
    "-sha256",
    "-extfile",
    extensions,
  ])
  const certBytes = await readFile(cert)
  const publicKey = new X509Certificate(certBytes).publicKey.export({
    format: "der",
    type: "spki",
  })
  return {
    ca,
    cert: certBytes,
    key: await readFile(key),
    spki: createHash("sha256").update(publicKey).digest("base64"),
  }
}

function runOpenSsl(arguments_) {
  const result = spawnSync("openssl", arguments_, {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
  })
  if (result.status !== 0) {
    throw new Error(`OpenSSL fixture setup failed: ${result.stderr.trim()}`)
  }
}

function postgresControlFromEnvironment() {
  const databaseUrl = requiredEnvironment("F0_P1_DATABASE_URL")
  const parsed = new URL(databaseUrl)
  if (
    parsed.protocol !== "postgresql:" ||
    parsed.hostname !== "127.0.0.1" ||
    !parsed.port ||
    !parsed.username ||
    !parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("F0-P1 requires a loopback-only PostgreSQL URL.")
  }
  const container = requiredEnvironment("F0_P1_POSTGRES_CONTAINER")
  const database = requiredEnvironment("F0_P1_POSTGRES_DB")
  const user = requiredEnvironment("F0_P1_POSTGRES_USER")
  const dockerContext = process.env.F0_P1_DOCKER_CONTEXT?.trim() || null
  if (
    !/^[a-z0-9][a-z0-9_.-]{0,127}$/.test(container) ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(database) ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(user) ||
    (dockerContext !== null && !/^[A-Za-z0-9_.-]{1,128}$/.test(dockerContext))
  ) {
    throw new Error("F0-P1 PostgreSQL control metadata is invalid.")
  }
  return { container, database, databaseUrl, dockerContext, user }
}

function liteLlmControlFromEnvironment() {
  const configPath = requiredEnvironment("F0_L2_LITELLM_CONFIG_FILE")
  let config
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"))
  } catch {
    throw new Error("F0-L2 LiteLLM control metadata is invalid JSON.")
  }
  const baseUrl = new URL(String(config.baseUrl ?? ""))
  if (
    baseUrl.protocol !== "http:" ||
    baseUrl.hostname !== "127.0.0.1" ||
    !baseUrl.port ||
    baseUrl.pathname !== "/" ||
    baseUrl.search ||
    baseUrl.hash ||
    typeof config.adminKey !== "string" ||
    config.adminKey.length < 20 ||
    typeof config.routingKey !== "string" ||
    config.routingKey.length < 20 ||
    typeof config.container !== "string" ||
    !/^[a-z0-9][a-z0-9_.-]{0,127}$/.test(config.container) ||
    typeof config.dockerContext !== "string" ||
    !/^[A-Za-z0-9_.-]{1,128}$/.test(config.dockerContext) ||
    !config.canaries ||
    ![
      "outagePrompt",
      "prompt",
      "recoveryPrompt",
      "response",
      "streamingPrompt",
    ].every(
      (name) =>
        typeof config.canaries[name] === "string" &&
        config.canaries[name].length >= 20,
    )
  ) {
    throw new Error("F0-L2 LiteLLM control metadata is invalid.")
  }
  return {
    adminKey: config.adminKey,
    baseUrl: baseUrl.origin,
    canaries: config.canaries,
    container: config.container,
    dockerContext: config.dockerContext,
    routingKey: config.routingKey,
  }
}

function integratedFirecrawlControlFromEnvironment() {
  const path = requiredEnvironment("F0_C1_FIRECRAWL_CONFIG_FILE")
  const config = readControlFile(path, "Firecrawl")
  const baseUrl = validatedLoopbackControlUrl(config.baseUrl, "Firecrawl")
  if (
    !Array.isArray(config.allowedHosts) ||
    config.allowedHosts.length === 0 ||
    config.allowedHosts.length > 8 ||
    new Set(config.allowedHosts).size !== config.allowedHosts.length ||
    config.allowedHosts.some(
      (host) =>
        typeof host !== "string" ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host),
    ) ||
    !config.canaries ||
    !["query", "url"].every(
      (name) =>
        typeof config.canaries[name] === "string" &&
        config.canaries[name].length >= 20,
    ) ||
    !config.containers ||
    Object.keys(config.containers).sort().join(",") !==
      "api,browser,egress,search" ||
    Object.values(config.containers).some(
      (container) =>
        typeof container !== "string" || !/^[a-f0-9]{64}$/.test(container),
    )
  ) {
    throw new Error("F0-C1 Firecrawl control metadata is invalid.")
  }
  return {
    allowedHosts: config.allowedHosts,
    baseUrl,
    canaries: config.canaries,
    containers: config.containers,
  }
}

function integratedObservabilityControlFromEnvironment() {
  const path = requiredEnvironment("F0_C1_OBSERVABILITY_CONFIG_FILE")
  const config = readControlFile(path, "observability")
  return {
    alertmanagerBaseUrl: validatedLoopbackControlUrl(
      config.alertmanagerBaseUrl,
      "Alertmanager",
    ),
    grafanaBaseUrl: validatedLoopbackControlUrl(
      config.grafanaBaseUrl,
      "Grafana",
    ),
    prometheusBaseUrl: validatedLoopbackControlUrl(
      config.prometheusBaseUrl,
      "Prometheus",
    ),
  }
}

function founderUatControlFromEnvironment() {
  const values = {
    controlFile: process.env.F0_UAT0_CONTROL_FILE?.trim(),
    credentialFile: process.env.F0_UAT0_CREDENTIAL_FILE?.trim(),
    outerInventory: process.env.F0_UAT0_OUTER_INVENTORY?.trim(),
    stopFile: process.env.F0_UAT0_STOP_FILE?.trim(),
  }
  if (Object.values(values).every((value) => !value)) return null
  if (Object.values(values).some((value) => !value)) {
    throw new Error("F0-UAT0 operator control metadata is incomplete.")
  }
  for (const path of [
    values.controlFile,
    values.credentialFile,
    values.stopFile,
  ]) {
    if (!isAbsolute(path)) {
      throw new Error("F0-UAT0 operator control paths must be absolute.")
    }
  }
  if (
    new Set(
      [values.controlFile, values.credentialFile, values.stopFile].map((path) =>
        resolve(path, ".."),
      ),
    ).size !== 1
  ) {
    throw new Error("F0-UAT0 operator control paths must share one owner root.")
  }
  let outerInventory
  try {
    outerInventory = JSON.parse(values.outerInventory)
  } catch {
    throw new Error("F0-UAT0 outer inventory is invalid JSON.")
  }
  if (
    !outerInventory ||
    typeof outerInventory !== "object" ||
    typeof outerInventory.network !== "string" ||
    typeof outerInventory.postgresVolume !== "string" ||
    !outerInventory.containers ||
    typeof outerInventory.containers !== "object"
  ) {
    throw new Error("F0-UAT0 outer inventory is invalid.")
  }
  return { ...values, outerInventory }
}

async function holdFounderUat({
  caFile,
  children,
  credentials,
  edgePort,
  firecrawlControl,
  keycloakControl,
  liteLlmControl,
  synchronizeClock,
}) {
  assert.ok(founderUatControl)
  assert.equal(typeof synchronizeClock, "function")
  await synchronizeClock()
  const credentialDocument = {
    admin: founderCredential(credentials.admin),
    operator: founderCredential(credentials.operator),
    schemaVersion: 1,
  }
  await writeFile(
    founderUatControl.credentialFile,
    `${JSON.stringify(credentialDocument, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  )
  const inventory = {
    applicationProcesses: children
      .filter((record) => !record.stopping && !record.exited)
      .map((record) => ({ name: record.name, pid: record.child.pid })),
    edgeProcess: process.pid,
    firecrawl: firecrawlControl.containers ?? {},
    identity: keycloakControl.container,
    liteLlm: liteLlmControl.container,
    outer: founderUatControl.outerInventory,
  }
  await writeFile(
    founderUatControl.controlFile,
    `${JSON.stringify(
      {
        authorities: {
          api: `https://${authorities.api}:${edgePort}`,
          console: `https://${authorities.console}:${edgePort}`,
          firecrawl: `https://${authorities.firecrawl}:${edgePort}`,
          identity: `https://${authorities.identity}:${edgePort}`,
        },
        caFile,
        credentialFile: founderUatControl.credentialFile,
        inventory,
        keepRunning: true,
        privateNativeServices: [
          "firecrawl",
          "grafana",
          "keycloak-admin",
          "litellm",
          "postgresql",
          "prometheus",
          "sglang-or-inference-double",
        ],
        schemaVersion: 1,
        status: "READY",
      },
      null,
      2,
    )}\n`,
    { flag: "wx", mode: 0o600 },
  )

  while (!(await exists(founderUatControl.stopFile))) {
    await synchronizeClock()
    const failed = children.find((record) => !record.stopping && record.exited)
    if (failed) {
      throw new Error(
        `F0-UAT0 managed process exited while founder access was active: ${failed.name}.`,
      )
    }
    await delay(500)
  }
  await Promise.all([
    rm(founderUatControl.controlFile, { force: true }),
    rm(founderUatControl.credentialFile, { force: true }),
    rm(founderUatControl.stopFile, { force: true }),
  ])
}

function founderCredential(userCredentials) {
  return {
    otpSecret: userCredentials.otpSecret,
    password: userCredentials.password,
    role: userCredentials.role,
    username: userCredentials.username,
  }
}

function readControlFile(path, service) {
  if (!isAbsolute(path)) {
    throw new Error(`F0-C1 ${service} control file must be absolute.`)
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    throw new Error(`F0-C1 ${service} control metadata is invalid JSON.`)
  }
}

function validatedLoopbackControlUrl(value, service) {
  const url = new URL(String(value ?? ""))
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(`F0-C1 ${service} control URL is not loopback-only.`)
  }
  return url.origin
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`The selected pre-Genesis mode requires ${name}.`)
  return value
}

function postgresSessionSnapshot() {
  return postgresJson(`
    SELECT json_build_object(
      'count', count(*)::integer,
      'handles', COALESCE(json_agg(handle_digest ORDER BY handle_digest), '[]'::json),
      'encryptedOnly', COALESCE(bool_and(
        encryption_kid = 'f0-p1-throwaway'
        AND encrypted_payload ?& ARRAY['version','kid','iv','tag','ciphertext']
        AND (encrypted_payload - 'version' - 'kid' - 'iv' - 'tag' - 'ciphertext') = '{}'::jsonb
      ), true)
    )
    FROM common.console_sessions;
  `)
}

function postgresApplicationFirecrawlStatus(applicationId) {
  assert.match(applicationId ?? "", /^app-[a-z0-9-]+$/)
  return postgresJson(
    `
      SELECT json_build_object(
        'status', access.status,
        'credentialCount', (
          SELECT count(*)::integer
          FROM admin.application_firecrawl_credentials AS credential
          WHERE credential.app_id = access.app_id
        )
      )
      FROM admin.application_firecrawl_access AS access
      WHERE access.app_id = :'application_id';
    `,
    { application_id: applicationId },
  )
}

function expireInferenceCredential(credentialId) {
  assert.match(credentialId, /^cak-[0-9a-f-]{36}$/)
  const updated = Number.parseInt(
    postgresPsql(
      `
        WITH expired AS (
          UPDATE admin.application_credentials
          SET issued_at = CURRENT_TIMESTAMP - interval '2 days',
              rotated_at = CURRENT_TIMESTAMP - interval '86401 seconds',
              overlap_expires_at = CURRENT_TIMESTAMP - interval '1 second'
          WHERE id = :'credential_id'
            AND kind = 'api_key'
            AND status = 'retiring'
          RETURNING id
        )
        SELECT count(*) FROM expired;
      `,
      { credential_id: credentialId },
    ),
    10,
  )
  assert.equal(updated, 1, "F0-P1 could not expire the retiring credential.")
}

function inspectPostgresPersistence(sensitiveValues) {
  const summary = postgresJson(`
    SELECT json_build_object(
      'applications', (SELECT count(*)::integer FROM admin.applications WHERE status <> 'deleted'),
      'auditEvents', (SELECT count(*)::integer FROM common.audit_events),
      'auditSubjects', (
        SELECT count(DISTINCT keycloak_subject_id)::integer
        FROM common.audit_events
        WHERE keycloak_subject_id IS NOT NULL
      ),
      'auditMetadataOnly', NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'common'
          AND table_name = 'audit_events'
          AND column_name NOT IN (
            'id','occurred_at','ingested_at','action','outcome','source_system',
            'correlation_id','keycloak_subject_id','application_id',
            'credential_record_id','credential_prefix','recovery_reason_code'
          )
      ),
      'firecrawlCredentials', (SELECT count(*)::integer FROM admin.application_firecrawl_credentials),
      'firecrawlEnabledApplications', (
        SELECT count(*)::integer
        FROM admin.application_firecrawl_access
        WHERE status = 'enabled'
      ),
      'firecrawlUsageRows', (SELECT count(*)::integer FROM admin.application_firecrawl_usage_daily),
      'humanIdentities', (SELECT count(*)::integer FROM common.human_identities),
      'inferenceCredentials', (SELECT count(*)::integer FROM admin.application_credentials),
      'inferenceUsageRows', (SELECT count(*)::integer FROM admin.application_usage_daily),
      'plaintextSessionPayloads', (
        SELECT count(*)::integer
        FROM common.console_sessions
        WHERE NOT (encrypted_payload ?& ARRAY['version','kid','iv','tag','ciphertext'])
      )
    );
  `)
  assert.equal(summary.applications, 2)
  assert.equal(summary.inferenceCredentials, 3)
  assert.equal(summary.firecrawlCredentials, 3)
  assert.equal(summary.firecrawlEnabledApplications, 1)
  assert.ok(summary.inferenceUsageRows > 0)
  assert.ok(summary.firecrawlUsageRows > 0)
  assert.ok(summary.auditEvents > 0)
  assert.ok(summary.auditSubjects >= 2)
  assert.ok(summary.humanIdentities >= 1)
  assert.equal(summary.auditMetadataOnly, true)
  assert.equal(summary.plaintextSessionPayloads, 0)

  const dump = postgresDocker([
    "exec",
    postgresControl.container,
    "pg_dump",
    "--data-only",
    "--no-owner",
    "--no-privileges",
    "--dbname",
    postgresControl.database,
    "--username",
    postgresControl.user,
  ])
  assertNoSensitiveValues([dump], sensitiveValues, "PostgreSQL data")
  return {
    ...summary,
    canaryRetention: "none",
    credentialMaterialPersisted: false,
  }
}

function inspectKeycloakTeamPersistence(sensitiveValues) {
  const summary = postgresJson(`
    SELECT json_build_object(
      'auditEvents', (
        SELECT count(*)::integer
        FROM common.audit_events
        WHERE action LIKE 'team.%'
      ),
      'auditMetadataOnly', NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'common'
          AND table_name = 'audit_events'
          AND column_name NOT IN (
            'id','occurred_at','ingested_at','action','outcome','source_system',
            'correlation_id','keycloak_subject_id','application_id',
            'credential_record_id','credential_prefix','recovery_reason_code'
          )
      ),
      'completedIdentityMutations', (
        SELECT count(*)::integer
        FROM admin.identity_mutation_journal
        WHERE state = 'completed'
      ),
      'identityMutationMetadataOnly', NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'admin'
          AND table_name = 'identity_mutation_journal'
          AND column_name NOT IN (
            'id','idempotency_ledger_id','keycloak_subject_id','operation_code',
            'request_fingerprint','target_type','target_identifier','state',
            'resource_id','created_at','updated_at','keycloak_applied_at',
            'completed_at','reconciliation_required_at','reconciliation_reason'
          )
      ),
      'plaintextSessionPayloads', (
        SELECT count(*)::integer
        FROM common.console_sessions
        WHERE NOT (encrypted_payload ?& ARRAY['version','kid','iv','tag','ciphertext'])
      ),
      'reconciliationRequired', (
        SELECT count(*)::integer
        FROM admin.identity_mutation_journal
        WHERE state = 'reconciliation_required'
      )
    );
  `)
  assert.ok(summary.auditEvents >= 4)
  assert.equal(summary.completedIdentityMutations, 4)
  assert.equal(summary.auditMetadataOnly, true)
  assert.equal(summary.identityMutationMetadataOnly, true)
  assert.equal(summary.plaintextSessionPayloads, 0)
  assert.equal(summary.reconciliationRequired, 0)

  const dump = postgresDocker([
    "exec",
    postgresControl.container,
    "pg_dump",
    "--data-only",
    "--no-owner",
    "--no-privileges",
    "--dbname",
    postgresControl.database,
    "--username",
    postgresControl.user,
  ])
  assertNoSensitiveValues([dump], sensitiveValues, "PostgreSQL data")
  return {
    ...summary,
    credentialMaterialPersisted: false,
  }
}

function identityMutationJournalRowCount() {
  return Number.parseInt(
    postgresPsql(`
      SELECT count(*)::integer
      FROM admin.identity_mutation_journal;
    `),
    10,
  )
}

async function provePostgresOutageRecovery({
  bffPort,
  children,
  consoleOrigin,
  page,
}) {
  postgresDocker(["pause", postgresControl.container])
  const degraded = await fetch(`http://127.0.0.1:${bffPort}/readyz`, {
    signal: AbortSignal.timeout(15_000),
  })
  assert.equal(degraded.status, 503)
  assert.deepEqual(await degraded.json(), {
    service: "console-bff",
    status: "degraded",
    version: "0.0.0",
  })
  postgresDocker(["unpause", postgresControl.container])
  await waitForPostgresControl()
  await waitForStatus(`http://127.0.0.1:${bffPort}/readyz`, 200, children)
  await page.goto(`${consoleOrigin}/applications`)
  await page.getByRole("heading", { name: "Applications" }).waitFor()
  await assertRole(page, "Administrator")
  return {
    degradedReadiness: 503,
    outageMethod: "pause-unpause",
    recoveredReadiness: 200,
    statePreserved: true,
  }
}

async function waitForPostgresControl() {
  const deadline = performance.now() + 60_000
  while (performance.now() < deadline) {
    const result = postgresDockerResult([
      "exec",
      postgresControl.container,
      "pg_isready",
      "--dbname",
      postgresControl.database,
      "--username",
      postgresControl.user,
    ])
    if (result.status === 0) return
    await delay(250)
  }
  throw new Error("F0-P1 PostgreSQL did not recover.")
}

function postgresJson(sql, variables = {}) {
  const output = postgresPsql(sql, variables)
  try {
    return JSON.parse(output)
  } catch {
    throw new Error("F0-P1 PostgreSQL returned invalid JSON evidence.")
  }
}

function postgresPsql(sql, variables = {}) {
  const variableArguments = Object.entries(variables).flatMap(
    ([name, value]) => ["--set", `${name}=${value}`],
  )
  return postgresDocker(
    [
      "exec",
      "--interactive",
      postgresControl.container,
      "psql",
      "--no-align",
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      ...variableArguments,
      "--tuples-only",
      "--dbname",
      postgresControl.database,
      "--username",
      postgresControl.user,
    ],
    sql,
  ).trim()
}

function postgresDocker(arguments_, input) {
  const result = postgresDockerResult(arguments_, input)
  if (result.status !== 0) {
    throw new Error(
      `F0-P1 PostgreSQL control failed: ${safeDiagnosticTail(result.stderr)}`,
    )
  }
  return result.stdout
}

function postgresDockerResult(arguments_, input) {
  assert.ok(postgresControl)
  return spawnSync(
    "docker",
    [
      ...(postgresControl.dockerContext
        ? ["--context", postgresControl.dockerContext]
        : []),
      ...arguments_,
    ],
    {
      encoding: "utf8",
      env: {
        HOME: process.env.HOME ?? "",
        LANG: "C",
        LC_ALL: "C",
        PATH: process.env.PATH ?? "",
      },
      input,
      maxBuffer: 64 * 1024 * 1024,
    },
  )
}

async function assertDevelopmentDependenciesReady() {
  const required = [
    "apps/bff/node_modules/tsx/dist/cli.mjs",
    "apps/web/node_modules/next/dist/bin/next",
    "packages/contracts/dist/inference-core.js",
    "packages/copy/dist/index.js",
  ]
  try {
    await Promise.all(
      required.map((path) => access(resolve(repositoryRoot, path))),
    )
  } catch {
    throw new Error(
      "F0-S1 dependencies are not ready. Run the frozen install and build contracts/copy first.",
    )
  }
}

async function chromeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROME_EXECUTABLE,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Try the next explicitly supported local browser location.
    }
  }
  throw new Error(
    "F0-S1 requires an installed Chrome/Chromium browser or PLAYWRIGHT_CHROME_EXECUTABLE.",
  )
}

async function createTemporaryStateRoot() {
  const controlled = process.env.F0_C1_BROWSER_STATE_ROOT?.trim()
  const controlledTemporaryRoot = process.env.F0_C1_BROWSER_TEMP_ROOT?.trim()
  const [repositoryRealRoot, temporaryRealRoot] = await Promise.all([
    realpath(repositoryRoot),
    realpath(tmpdir()),
  ])
  if (controlled) {
    if (
      !integratedCoreMode ||
      !isAbsolute(controlled) ||
      !controlledTemporaryRoot ||
      !isAbsolute(controlledTemporaryRoot)
    ) {
      throw new Error("F0-C1 browser state ownership is invalid.")
    }
    const [controlledRealRoot, expectedTemporaryRoot] = await Promise.all([
      realpath(controlled),
      realpath(controlledTemporaryRoot),
    ])
    if (
      !pathIsInside(expectedTemporaryRoot, controlledRealRoot) ||
      basename(controlledRealRoot).match(
        /^llmm-f0-c1-browser-[a-f0-9]{16}$/,
      ) === null
    ) {
      throw new Error("F0-C1 browser state escaped its temporary boundary.")
    }
    await chmod(controlledRealRoot, 0o700)
    return controlledRealRoot
  }
  if (pathIsInside(repositoryRealRoot, temporaryRealRoot)) {
    throw new Error(
      "F0-S1 temporary state must be outside the source worktree.",
    )
  }
  return mkdtemp(join(temporaryRealRoot, "llmm-f0-s1-"))
}

function keycloakControlFromEnvironment() {
  const configFile = process.env.F0_I1_KEYCLOAK_CONFIG_FILE?.trim()
  if (!configFile || !isAbsolute(configFile)) {
    throw new Error(
      "F0-I1 requires an absolute disposable Keycloak config file.",
    )
  }
  const config = JSON.parse(readFileSync(configFile, "utf8"))
  if (
    !Number.isInteger(config.edgePort) ||
    !Number.isInteger(config.upstreamPort) ||
    typeof config.container !== "string" ||
    !/^[a-z0-9][a-z0-9_.-]{0,127}$/.test(config.container) ||
    typeof config.dockerContext !== "string" ||
    !/^[A-Za-z0-9_.-]{1,128}$/.test(config.dockerContext) ||
    !config.credentials
  ) {
    throw new Error("F0-I1 Keycloak control data is invalid.")
  }
  const adminBaseUrl = `http://127.0.0.1:${config.upstreamPort}`
  if (
    (keycloakTeamMode || integratedCoreMode) &&
    (typeof config.credentials.humanAdmin !== "string" ||
      config.credentials.humanAdmin.length < 32)
  ) {
    throw new Error("F0-I2 Keycloak Team control data is invalid.")
  }
  return {
    adminBaseUrl,
    container: config.container,
    credentials: config.credentials,
    dockerContext: config.dockerContext,
    edgePort: config.edgePort,
    upstreamPort: config.upstreamPort,
  }
}

async function identityEpochMilliseconds() {
  const deadline = performance.now() + 35_000
  while (performance.now() < deadline) {
    const epochSeconds = identityEpochSeconds()
    const periodPosition = epochSeconds % 30
    if (periodPosition >= 5 && periodPosition <= 20) {
      return epochSeconds * 1_000
    }
    await delay(250)
  }
  throw new Error("F0-I1 identity clock did not reach a safe TOTP window.")
}

function identityEpochSeconds() {
  assert.ok(keycloakControl)
  const result = spawnSync(
    "docker",
    [
      "--context",
      keycloakControl.dockerContext,
      "exec",
      keycloakControl.container,
      "date",
      "+%s",
    ],
    {
      encoding: "utf8",
      env: { LANG: "C", LC_ALL: "C", PATH: process.env.PATH ?? "" },
      maxBuffer: 1024 * 1024,
    },
  )
  const epochSeconds = Number.parseInt(result.stdout.trim(), 10)
  if (result.status !== 0 || !Number.isSafeInteger(epochSeconds)) {
    throw new Error("F0-I1 could not read the disposable identity clock.")
  }
  return epochSeconds
}

function pathIsInside(parent, candidate) {
  const fromParent = relative(parent, candidate)
  return (
    fromParent === "" ||
    (!isAbsolute(fromParent) &&
      fromParent !== ".." &&
      !fromParent.startsWith(`..${sep}`))
  )
}

async function prepareTemporaryWebProject(stateRoot) {
  const sourceRoot = resolve(repositoryRoot, "apps/web")
  const webRoot = join(stateRoot, "web")
  await mkdir(webRoot, { mode: 0o700 })
  const tsconfig = JSON.parse(
    await readFile(resolve(sourceRoot, "tsconfig.json"), "utf8"),
  )
  tsconfig.extends = resolve(repositoryRoot, "tsconfig.base.json")
  await writeFile(
    join(webRoot, "tsconfig.json"),
    `${JSON.stringify(tsconfig, null, 2)}\n`,
    { mode: 0o600 },
  )
  await copyFile(
    resolve(sourceRoot, "next-env.d.ts"),
    join(webRoot, "next-env.d.ts"),
  )
  for (const path of [
    "next.config.ts",
    "package.json",
    "postcss.config.mjs",
    "public",
    "src",
  ]) {
    await cp(resolve(sourceRoot, path), join(webRoot, path), {
      recursive: true,
    })
  }
  await symlink(
    resolve(sourceRoot, "node_modules"),
    join(webRoot, "node_modules"),
  )
  return webRoot
}

async function buildFounderWebProject(webRoot, environment, stateRoot) {
  const result = spawnSync(
    process.execPath,
    [
      resolve(repositoryRoot, "apps/web/node_modules/next/dist/bin/next"),
      "build",
    ],
    {
      cwd: webRoot,
      encoding: "utf8",
      env: {
        HOME: stateRoot,
        LANG: "C",
        LC_ALL: "C",
        PATH: process.env.PATH ?? "",
        TMPDIR: stateRoot,
        ...environment,
      },
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  await Promise.all([
    writeFile(join(stateRoot, "web-build.stdout.log"), result.stdout ?? "", {
      mode: 0o600,
    }),
    writeFile(join(stateRoot, "web-build.stderr.log"), result.stderr ?? "", {
      mode: 0o600,
    }),
  ])
  if (result.status !== 0) {
    throw new Error("F0-UAT0 could not build the founder Console Web surface.")
  }
}

function startChild(name, command, environment, stateRoot, cwd) {
  const stdout = createWriteStream(join(stateRoot, `${name}.stdout.log`), {
    mode: 0o600,
  })
  const stderr = createWriteStream(join(stateRoot, `${name}.stderr.log`), {
    mode: 0o600,
  })
  const detached = !integratedCoreMode
  const child = spawn(command[0], command.slice(1), {
    cwd,
    detached,
    env: {
      HOME: stateRoot,
      LANG: "C",
      LC_ALL: "C",
      TMPDIR: stateRoot,
      ...environment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const record = {
    child,
    detached,
    exited: false,
    name,
    stderr,
    stdout,
    stopping: false,
  }
  child.stdout.pipe(stdout)
  child.stderr.pipe(stderr)
  child.once("exit", () => {
    record.exited = true
  })
  return record
}

async function stopChild(record) {
  record.stopping = true
  if (!record.exited && record.child.pid) {
    try {
      if (record.detached) process.kill(-record.child.pid, "SIGTERM")
      else record.child.kill("SIGTERM")
    } catch (error) {
      if (error.code !== "ESRCH") throw error
    }
    const deadline = performance.now() + 5_000
    while (!record.exited && performance.now() < deadline) {
      await delay(50)
    }
    if (!record.exited) {
      try {
        if (record.detached) process.kill(-record.child.pid, "SIGKILL")
        else record.child.kill("SIGKILL")
      } catch (error) {
        if (error.code !== "ESRCH") throw error
      }
    }
  }
  await Promise.all([endStream(record.stdout), endStream(record.stderr)])
}

function endStream(stream) {
  if (stream.closed) return Promise.resolve()
  return new Promise((resolveEnd) => {
    stream.once("close", resolveEnd)
    stream.end()
  })
}

async function reservePorts(count) {
  const reservations = []
  try {
    for (let index = 0; index < count; index += 1) {
      const server = createHttpServer()
      await listen(server, 0)
      reservations.push(server)
    }
    return reservations.map((server) => server.address().port)
  } finally {
    await Promise.all(reservations.map(closeServer))
  }
}

async function browserSafePort() {
  for (let port = 18443; port <= 18543; port += 1) {
    const server = createHttpServer()
    try {
      await listen(server, port)
      await closeServer(server)
      return port
    } catch {
      await closeServer(server).catch(() => undefined)
    }
  }
  throw new Error("No disposable browser-safe HTTPS port was available.")
}

function listen(server, port) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen)
    server.listen(port, "127.0.0.1", resolveListen)
  })
}

function listenLoopbackIpv6(server, port) {
  return new Promise((resolveListen) => {
    const onError = () => {
      server.off("listening", onListening)
      resolveListen(false)
    }
    const onListening = () => {
      server.off("error", onError)
      resolveListen(true)
    }
    server.once("error", onError)
    server.once("listening", onListening)
    server.listen({ host: "::1", ipv6Only: true, port })
  })
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()))
    server.closeAllConnections?.()
  })
}

function requestHttpsEdge(url, host) {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpsRequest(
      url,
      { headers: host ? { host } : {}, rejectUnauthorized: false },
      (response) => {
        response.resume()
        response.once("end", () => {
          resolveRequest({
            location: response.headers.location,
            status: response.statusCode ?? 500,
          })
        })
      },
    )
    request.once("error", rejectRequest)
    request.end()
  })
}

async function requestHttpsEdgeWithHeaders({
  certificate,
  edgePort,
  headers,
  method,
  path,
  servername,
}) {
  const ca = await readFile(certificate.ca)
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpsRequest(
      {
        ca,
        headers,
        host: "127.0.0.1",
        method,
        path,
        port: edgePort,
        rejectUnauthorized: true,
        servername,
      },
      (response) => {
        response.resume()
        response.once("end", () => {
          resolveRequest({ status: response.statusCode ?? 500 })
        })
      },
    )
    request.once("error", rejectRequest)
    request.end()
  })
}

async function waitForHttp(url, children) {
  const deadline = performance.now() + 45_000
  while (performance.now() < deadline) {
    const failed = children.find((record) => record.exited && !record.stopping)
    if (failed) {
      throw new Error(`${failed.name} exited during F0-S1 startup.`)
    }
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(2_000),
      })
      if (response.status < 500) return
    } catch {
      // The child is still starting.
    }
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${new URL(url).pathname}.`)
}

async function waitForStatus(url, expectedStatus, children) {
  const deadline = performance.now() + 45_000
  while (performance.now() < deadline) {
    const failed = children.find((record) => record.exited && !record.stopping)
    if (failed) {
      throw new Error(`${failed.name} exited during F0-P1 recovery.`)
    }
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(3_000),
      })
      if (response.status === expectedStatus) return
    } catch {
      // The disposable service is still recovering.
    }
    await delay(100)
  }
  throw new Error(
    `Timed out waiting for ${new URL(url).pathname} status ${expectedStatus}.`,
  )
}

function readJsonRequest(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.once("error", rejectBody)
    request.once("end", () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch {
        resolveBody(null)
      }
    })
  })
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json",
  })
  response.end(body)
}

function user(role) {
  return {
    password: opaqueValue(),
    role,
    subject: `fixture-${role}-${randomBytes(8).toString("hex")}`,
    username: `${role}-${randomBytes(6).toString("hex")}`,
  }
}

function sessionCookie(cookies) {
  const cookie = cookies.find(
    (candidate) => candidate.name === "__Host-llm-machines-session",
  )
  assert.ok(cookie, "The browser did not receive the opaque Console cookie.")
  assert.equal(cookie.httpOnly, true)
  assert.equal(cookie.secure, true)
  assert.equal(cookie.sameSite, "Lax")
  return cookie
}

function opaqueValue() {
  return randomBytes(32).toString("base64url")
}

function totp(secret, epochMilliseconds = Date.now()) {
  assert.equal(typeof secret, "string")
  const counter = Math.floor(epochMilliseconds / 30_000)
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(buffer)
    .digest()
  const offset = digest.at(-1) & 0x0f
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return value.toString().padStart(6, "0")
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function safeDiagnosticTail(value) {
  return value
    .slice(-4_000)
    .replaceAll(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replaceAll(/[A-Za-z0-9_-]{43,}/g, "[opaque]")
}

function redactedDiagnosticTail(value, sensitiveValues) {
  let message = safeDiagnosticTail(value)
  for (const sensitiveValue of sensitiveValues) {
    if (!sensitiveValue) continue
    message = message.replaceAll(sensitiveValue, "[credential]")
  }
  return message
}

function sanitizedError(error, sensitiveValues) {
  const source =
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  return new Error(redactedDiagnosticTail(source, sensitiveValues))
}

function assertNoSensitiveValues(values, sensitiveValues, surface) {
  for (const value of values) {
    for (const sensitiveValue of sensitiveValues) {
      if (String(value).includes(sensitiveValue)) {
        throw new Error(`F0-U2 retained credential material in ${surface}.`)
      }
    }
  }
}

async function assertStateFilesCredentialFree(root, sensitiveValues) {
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        pending.push(path)
        continue
      }
      if (!entry.isFile()) {
        continue
      }
      const content = await readFile(path)
      for (const sensitiveValue of sensitiveValues) {
        if (content.includes(Buffer.from(sensitiveValue))) {
          throw new Error(
            `A pre-Genesis teardown artifact retained credential material: ${relative(root, path)}.`,
          )
        }
      }
    }
  }
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
