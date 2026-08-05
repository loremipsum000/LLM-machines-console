import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { X509Certificate, createHash, randomBytes } from "node:crypto"
import { createWriteStream } from "node:fs"
import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
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
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"
import { createOidcFixture } from "./reduced-core-oidc-fixture.mjs"

const applicationsMode = process.argv.includes("--applications")

if (
  process.argv.slice(2).some((argument) => argument !== "--applications") ||
  process.argv.filter((argument) => argument === "--applications").length > 1
) {
  throw new Error("Usage: reduced-core-browser-session.mjs [--applications]")
}

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const initialTime = applicationsMode
  ? new Date(Date.now() - 10 * 60 * 1000)
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
  let currentTime = new Date(initialTime)
  let evidence
  let failure
  let oidc
  const observedOrigins = []
  const tlsErrors = []
  try {
    await chmod(stateRoot, 0o700)
    const [bffPort, webPort, inferencePort] = await reservePorts(3)
    const edgePort = await browserSafePort()
    const clockFile = join(stateRoot, "clock.txt")
    await writeFile(clockFile, `${currentTime.toISOString()}\n`, {
      mode: 0o600,
    })
    const certificate = await createCertificate(stateRoot)
    const webRoot = await prepareTemporaryWebProject(stateRoot)
    const consoleOrigin = `https://${authorities.console}:${edgePort}`
    const identityIssuer = `https://${authorities.identity}:${edgePort}/realms/llm-machines`
    const credentials = {
      admin: user("admin"),
      operator: user("operator"),
      bffService: opaqueValue(),
      liteLlm: opaqueValue(),
      oidcClient: opaqueValue(),
    }
    const clientId = "console-web"
    const audience = "console-bff"
    oidc = createOidcFixture({
      audience,
      clientId,
      clientSecret: credentials.oidcClient,
      issuer: identityIssuer,
      now: () => new Date(currentTime),
      redirectUri: `${consoleOrigin}/api/console/session/callback`,
      users: { admin: credentials.admin, operator: credentials.operator },
    })

    const inference = createInferenceDouble(credentials.liteLlm)
    servers.push(inference)
    await listen(inference, inferencePort)

    children.push(
      startChild(
        "bff",
        [
          process.execPath,
          resolve(repositoryRoot, "apps/bff/node_modules/tsx/dist/cli.mjs"),
          resolve(
            repositoryRoot,
            "scripts/pre-genesis/reduced-core-session-bff-fixture.mts",
          ),
        ],
        {
          BFF_FALLBACK_MODELS: "fixture-model",
          BFF_FIXTURE_MODE: "true",
          BFF_SERVICE_API_KEY: credentials.bffService,
          ...(applicationsMode
            ? {
                ADMIN_LITELLM_API_KEY: credentials.liteLlm,
                ADMIN_LITELLM_BASE_URL: `http://127.0.0.1:${inferencePort}`,
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
                FIRECRAWL_EGRESS_ALLOWED_HOSTS: "allowed.example.test",
                FIRECRAWL_EGRESS_ALLOWLIST_DIR:
                  "/run/llm-machines/firecrawl/local-fixture",
                FIRECRAWL_EGRESS_POLICY_READY: "true",
                FIRECRAWL_INSTALLED: "true",
                FIRECRAWL_RESOURCE_PROFILE_QUALIFIED: "true",
                FIRECRAWL_UPSTREAM_BASE_URL: "http://firecrawl-api:3002",
              }
            : {}),
          FIRECRAWL_PUBLIC_BASE_URL: `https://${authorities.firecrawl}:${edgePort}`,
          HOST: "127.0.0.1",
          LITELLM_KEY: credentials.liteLlm,
          LITELLM_URL: `http://127.0.0.1:${inferencePort}`,
          NODE_ENV: "test",
          NODE_EXTRA_CA_CERTS: certificate.ca,
          PORT: String(bffPort),
          PRODUCT_API_HOST: authorities.api,
          PRODUCT_CONSOLE_HOST: authorities.console,
          PRODUCT_FIRECRAWL_HOST: authorities.firecrawl,
          PRODUCT_IDENTITY_HOST: authorities.identity,
          PUBLIC_BFF_BASE_URL: `https://${authorities.api}:${edgePort}`,
        },
        stateRoot,
        repositoryRoot,
      ),
    )
    children.push(
      startChild(
        "web",
        [
          process.execPath,
          resolve(repositoryRoot, "apps/web/node_modules/next/dist/bin/next"),
          "dev",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(webPort),
        ],
        {
          CONSOLE_BFF_SERVICE_API_KEY: credentials.bffService,
          CONSOLE_BFF_URL: `http://127.0.0.1:${bffPort}`,
          NEXT_TELEMETRY_DISABLED: "1",
          NODE_ENV: "development",
          WEB_IDENTITY_ORIGIN: `https://${authorities.identity}:${edgePort}`,
        },
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
    const page = await context.newPage()
    const pageErrors = []
    page.on("pageerror", (error) => pageErrors.push(error.message))
    const tlsProbe = await page.goto(`https://127.0.0.1:${edgePort}/`)
    assert.equal(tlsProbe?.status(), 421)

    await signIn(page, consoleOrigin, credentials.admin, "/applications?q=safe")
    assert.equal(new URL(page.url()).pathname, "/applications")
    assert.equal(new URL(page.url()).search, "?q=safe")
    await assertRole(page, "Administrator")
    await assertConsoleNavigation(page, consoleOrigin)

    const applicationFlow = applicationsMode
      ? await proveApplicationConsoleFlow({
          certificate,
          consoleOrigin,
          edgePort,
          page,
          synchronizeClock: async () => {
            currentTime = new Date()
            await writeFile(clockFile, `${currentTime.toISOString()}\n`, {
              mode: 0o600,
            })
          },
          userCredentials: credentials.admin,
        })
      : null

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

    await page.goto(`${consoleOrigin}/`)
    await page.getByRole("button", { name: "Sign out" }).click()
    await page.waitForURL((url) => url.pathname === "/auth/signin")
    await page.goto(`${consoleOrigin}/inference`)
    assert.equal(new URL(page.url()).pathname, "/auth/signin")
    assert.equal(new URL(page.url()).searchParams.get("returnTo"), "/inference")
    assert.deepEqual(pageErrors, [])
    await context.close()

    const browserVersion = browser.version()
    await browser.close()
    browser = undefined
    evidence = {
      architecture: process.arch,
      browser: { name: "Google Chrome", version: browserVersion },
      credentialMaterialPrinted: false,
      evidenceClass: applicationsMode
        ? "LOCAL_BROWSER_APPLICATION_FLOW_ONLY"
        : "LOCAL_BROWSER_SESSION_AND_ROLE_FLOW_ONLY",
      ...(applicationFlow ? { flow: applicationFlow } : {}),
      limitations: [
        "In-memory Console session storage is not PostgreSQL restart-persistence evidence.",
        "The deterministic identity fixture is not Keycloak 26.7.0 runtime qualification.",
        "A generated local CA with browser-only trust bypass is not appliance TLS evidence.",
        "Reserved *.llmm.test aliases are loopback-only browser fixture authorities, not Product DNS constants.",
        applicationsMode
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
        ...(applicationFlow
          ? [
              "Admin creates an Application and receives separate one-time inference and Firecrawl credentials through the actual Console UI",
              "a standard OpenAI-compatible client reaches the Product API authority and updates passive connection, usage, and last-use evidence",
              "Firecrawl is disabled by default and requires explicit disclaimer acknowledgement for the selected Application",
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
  } catch (error) {
    const bffDiagnostics = await readFile(
      join(stateRoot, "bff.stderr.log"),
      "utf8",
    ).catch(() => "")
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
      ...(bffDiagnostics
        ? [new Error(`BFF metadata:\n${safeDiagnosticTail(bffDiagnostics)}`)]
        : []),
    ]
    failure = diagnostics.length
      ? new AggregateError(
          [error, ...diagnostics],
          "F0-S1 browser proof failed.",
        )
      : error
  } finally {
    await browser?.close().catch(() => undefined)
    const cleanup = await Promise.allSettled([
      ...servers.map(closeServer),
      ...children.map(stopChild),
    ])
    await rm(stateRoot, { force: true, recursive: true })
    const failures = cleanup
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason)
    if (failures.length > 0) {
      failure = new AggregateError(
        failure ? [failure, ...failures] : failures,
        "F0-S1 cleanup did not complete.",
      )
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
  await page
    .getByRole("heading", { name: "Fixture identity sign in" })
    .waitFor()
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
  if ((await navigation.count()) !== 1) {
    throw new Error(
      `Console navigation was not rendered after identity callback at ${page.url()}: ${(await page.locator("body").innerText()).slice(0, 500)}`,
    )
  }
  await navigation.waitFor()
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

async function proveApplicationConsoleFlow({
  certificate,
  consoleOrigin,
  edgePort,
  page,
  synchronizeClock,
  userCredentials,
}) {
  const applicationName = `Browser client ${randomBytes(4).toString("hex")}`
  await page.goto(`${consoleOrigin}/applications/apps/new`)
  await submitApplicationCreate(page, applicationName)
  const elevation = page.getByRole("heading", { name: "Verify your identity" })
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("Verify your identity") ||
      document.body.innerText.includes("Application credential"),
  )
  if ((await elevation.count()) === 1) {
    await elevation.waitFor()
    await synchronizeClock()
    const responsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/console/session/elevate",
    )
    await page.getByRole("button", { name: "Continue to verification" }).click()
    const response = await responsePromise
    try {
      await page
        .getByRole("heading", { name: "Fixture identity sign in" })
        .waitFor({ timeout: 5_000 })
    } catch {
      const location = response.headers().location
      const redirect = location ? new URL(location) : null
      throw new Error(
        `MFA elevation returned ${response.status()} with redirect ${redirect ? `${redirect.origin}${redirect.pathname}` : "absent"} but did not navigate at ${new URL(page.url()).pathname}: ${safeDiagnosticTail(await page.locator("body").innerText())}`,
      )
    }
    await completeIdentityLogin(page, userCredentials)
    assert.equal(new URL(page.url()).pathname, "/applications")
    await page.goto(`${consoleOrigin}/applications/apps/new`)
    await submitApplicationCreate(page, applicationName)
  }
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
      messages: [{ content: "disposable fixture input", role: "user" }],
      model: "fixture-model",
    },
    caFile: certificate.ca,
    edgePort,
    method: "POST",
    path: "/v1/chat/completions",
  })
  assert.equal(completion.status, 200)
  assert.equal(completion.body?.usage?.total_tokens, 5)

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
  assertCredentialFormat(
    firecrawlCredential,
    /^llmm_fc_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/,
    "Firecrawl",
  )
  if (firecrawlCredential === inferenceCredential) {
    throw new Error("Inference and Firecrawl credentials were not separate.")
  }
  assert.equal(
    await revealedCredential(page, "Firecrawl base URL"),
    `https://${authorities.firecrawl}:${edgePort}`,
  )

  await page.goto(`${consoleOrigin}/applications`)
  const applicationCard = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: applicationName }) })
  await applicationCard.waitFor()
  assert.equal(await metricValue(applicationCard, "Requests"), "2")
  assert.equal(await metricValue(applicationCard, "Tokens"), "5")
  assert.notEqual(await metricValue(applicationCard, "Last used"), "Never")
  assert.equal(await metricValue(applicationCard, "Firecrawl"), "Enabled")

  return {
    applicationCreation: "passed",
    credentialMaterialPrinted: false,
    firecrawl: {
      defaultOff: true,
      disclaimerRequired: true,
      perApplicationEnablement: "passed",
      separateCredential: true,
      upstreamExecutionEvidence: "F0-W1",
    },
    inference: {
      connectionEvidence: "passed",
      lastUseVisible: true,
      openAiClient: "passed",
      requestsVisible: 2,
      tokensVisible: 5,
    },
    mfaElevation: "passed",
    oneTimeReveal: "passed",
  }
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

function createDevelopmentEdge({
  applicationsMode,
  bffPort,
  certificate,
  edgePort,
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
        void oidc.handle(request, response, url).catch(() => {
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

function createInferenceDouble(apiKey) {
  return createHttpServer((request, response) => {
    void handleInferenceDoubleRequest(request, response, apiKey).catch(() => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: "fixture_failure" })
      } else {
        response.destroy()
      }
    })
  })
}

async function handleInferenceDoubleRequest(request, response, apiKey) {
  if (request.headers.authorization !== `Bearer ${apiKey}`) {
    sendJson(response, 401, { error: "unauthorized" })
    return
  }
  const url = new URL(request.url ?? "/", "http://fixture.invalid")
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
      metadata: { total_api_requests: 0, total_tokens: 0 },
      results: [],
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
      keys: [],
      total_count: 0,
      total_pages: 0,
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
        message: { content: "fixture-response", role: "assistant" },
      },
    ],
    created: 0,
    id: "chatcmpl-fixture",
    model: "fixture-model",
    object: "chat.completion",
    usage: { completion_tokens: 2, prompt_tokens: 3, total_tokens: 5 },
  })
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
  const [repositoryRealRoot, temporaryRealRoot] = await Promise.all([
    realpath(repositoryRoot),
    realpath(tmpdir()),
  ])
  if (pathIsInside(repositoryRealRoot, temporaryRealRoot)) {
    throw new Error(
      "F0-S1 temporary state must be outside the source worktree.",
    )
  }
  return mkdtemp(join(temporaryRealRoot, "llmm-f0-s1-"))
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

function startChild(name, command, environment, stateRoot, cwd) {
  const stdout = createWriteStream(join(stateRoot, `${name}.stdout.log`), {
    mode: 0o600,
  })
  const stderr = createWriteStream(join(stateRoot, `${name}.stderr.log`), {
    mode: 0o600,
  })
  const child = spawn(command[0], command.slice(1), {
    cwd,
    detached: true,
    env: {
      HOME: stateRoot,
      LANG: "C",
      LC_ALL: "C",
      TMPDIR: stateRoot,
      ...environment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const record = { child, exited: false, name, stderr, stdout, stopping: false }
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
      process.kill(-record.child.pid, "SIGTERM")
    } catch (error) {
      if (error.code !== "ESRCH") throw error
    }
    const deadline = Date.now() + 5_000
    while (!record.exited && Date.now() < deadline) {
      await delay(50)
    }
    if (!record.exited) {
      try {
        process.kill(-record.child.pid, "SIGKILL")
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

async function waitForHttp(url, children) {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
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

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function safeDiagnosticTail(value) {
  return value
    .slice(-4_000)
    .replaceAll(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replaceAll(/[A-Za-z0-9_-]{43,}/g, "[opaque]")
}
