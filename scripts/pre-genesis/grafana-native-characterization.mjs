import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { chromium } from "playwright-core"

const GRAFANA_IMAGE =
  "docker.io/grafana/grafana@sha256:e27e68cfd5795c1bea54950766078a02e84dfa3bafe0a4d0e5382f713dfd8e4e"
const KEYCLOAK_IMAGE =
  "quay.io/keycloak/keycloak@sha256:26939e1318d6f008fc2ee6e10cec1cf8f1ba8a21846c1bc81b91ed0506bc2a7a"
const packageLabel = "F0-N2"
const evidenceFile = resolve(required("F0_N2_EVIDENCE_FILE"))
const sourceGrafanaIni = resolve(required("F0_N2_GRAFANA_INI"))

const routes = new Map()
const websocketPaths = new Set()
const eventStreamPaths = new Set()
let state

try {
  state = await startRuntime()
  const browserEvidence = await characterizeBrowser(state)
  const outage = await proveIdentityOutage(state)
  const runtime = await inspectRuntime(state)
  const report = {
    schema: "llm-machines.f0-n2-grafana-characterization.v1",
    status: "PASS",
    version: "13.1.3",
    image: {
      index:
        "sha256:ab5cb380e3ff3172d6c8bd2e7cfd31cce977d2881b260e1f5bc089bf0b759b43",
      platform: "linux/amd64",
      platformManifest:
        "sha256:e27e68cfd5795c1bea54950766078a02e84dfa3bafe0a4d0e5382f713dfd8e4e",
      sourceCommit: "45a27d64b64a82d666b06aa5c5bb3521587edb0d",
      tagObject: "12cb42922a6c6604e62d5f9ed512fd0d9febf4ec",
    },
    browser: browserEvidence.browser,
    authentication: browserEvidence.authentication,
    authorization: browserEvidence.authorization,
    cookies: browserEvidence.cookies,
    csrf: browserEvidence.csrf,
    logout: browserEvidence.logout,
    restart: browserEvidence.restart,
    identityOutage: outage,
    transport: {
      webSocketPaths: [...websocketPaths].sort(),
      eventStreamPaths: [...eventStreamPaths].sort(),
    },
    routeInventory: [...routes.values()].sort((left, right) =>
      `${left.origin}${left.path}${left.method}`.localeCompare(
        `${right.origin}${right.path}${right.method}`,
      ),
    ),
    runtime,
    consoleSessionForwarded: false,
    credentialsRetained: false,
  }
  await writeFile(evidenceFile, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  })
  await chmod(evidenceFile, 0o600)
  process.stdout.write(`${JSON.stringify({ status: "PASS", evidenceFile })}\n`)
} finally {
  if (state) await cleanup(state)
}

async function startRuntime() {
  const runId = randomBytes(8).toString("hex")
  const root = await mkdtemp(join(tmpdir(), "llmm-f0-n2-grafana-"))
  await chmod(root, 0o700)
  const runtime = {
    runId,
    root,
    network: `llmm-f0-n2-${runId}`,
    volume: `llmm-f0-n2-grafana-${runId}`,
    containers: {
      grafana: `llmm-f0-n2-grafana-${runId}`,
      keycloak: `llmm-f0-n2-keycloak-${runId}`,
    },
    ports: {
      grafana: await reservePort(),
      identity: await reservePort(),
    },
    secrets: {
      adminPassword: opaque(),
      identityBootstrapPassword: opaque(),
      oidcClientSecret: opaque(),
      operatorPassword: opaque(),
      dualPassword: opaque(),
      unknownPassword: opaque(),
    },
  }
  state = runtime
  const paths = {
    grafanaIni: join(root, "grafana.ini"),
    oidcSecret: join(root, "grafana-oidc-secret"),
    realmSeed: join(root, "realm.json"),
  }
  await copyFile(sourceGrafanaIni, paths.grafanaIni)
  await writeFile(paths.oidcSecret, runtime.secrets.oidcClientSecret, {
    mode: 0o444,
  })
  await writeFile(
    paths.realmSeed,
    `${JSON.stringify(realmSeed(runtime), null, 2)}\n`,
    { mode: 0o444 },
  )
  await docker(["pull", "--platform", "linux/amd64", GRAFANA_IMAGE])
  await docker(["pull", "--platform", "linux/amd64", KEYCLOAK_IMAGE])
  await docker([
    "network",
    "create",
    "--label",
    `com.llm-machines.test-package=${packageLabel}`,
    runtime.network,
  ])
  await docker([
    "volume",
    "create",
    "--label",
    `com.llm-machines.test-package=${packageLabel}`,
    runtime.volume,
  ])
  await docker([
    "run",
    "--detach",
    "--name",
    runtime.containers.keycloak,
    "--label",
    `com.llm-machines.test-package=${packageLabel}`,
    "--network",
    runtime.network,
    "--network-alias",
    "keycloak",
    "--publish",
    `127.0.0.1:${runtime.ports.identity}:8080`,
    "--env",
    "KC_BOOTSTRAP_ADMIN_USERNAME=fixture-bootstrap",
    "--env",
    `KC_BOOTSTRAP_ADMIN_PASSWORD=${runtime.secrets.identityBootstrapPassword}`,
    "--mount",
    `type=bind,src=${paths.realmSeed},dst=/opt/keycloak/data/import/realm.json,readonly`,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges=true",
    KEYCLOAK_IMAGE,
    "start-dev",
    "--import-realm",
    `--hostname=http://127.0.0.1:${runtime.ports.identity}`,
    "--http-enabled=true",
    "--health-enabled=true",
  ])
  await waitForHttp(
    `http://127.0.0.1:${runtime.ports.identity}/realms/llm-machines/.well-known/openid-configuration`,
  )
  await configureClientScope(runtime)
  const identityBase = `http://127.0.0.1:${runtime.ports.identity}`
  const grafanaBase = `http://127.0.0.1:${runtime.ports.grafana}`
  await docker([
    "run",
    "--detach",
    "--name",
    runtime.containers.grafana,
    "--label",
    `com.llm-machines.test-package=${packageLabel}`,
    "--network",
    runtime.network,
    "--network-alias",
    "grafana",
    "--publish",
    `127.0.0.1:${runtime.ports.grafana}:3000`,
    "--env",
    `GF_SERVER_ROOT_URL=${grafanaBase}/`,
    "--env",
    "GF_SERVER_DOMAIN=127.0.0.1",
    "--env",
    "GF_SERVER_ENFORCE_DOMAIN=false",
    "--env",
    "GF_SECURITY_COOKIE_SECURE=false",
    "--env",
    "GF_LOG_LEVEL=warn",
    "--env",
    `LLMM_KEYCLOAK_AUTH_URL=${identityBase}/realms/llm-machines/protocol/openid-connect/auth`,
    "--env",
    "LLMM_KEYCLOAK_TOKEN_URL=http://keycloak:8080/realms/llm-machines/protocol/openid-connect/token",
    "--env",
    "LLMM_KEYCLOAK_USERINFO_URL=http://keycloak:8080/realms/llm-machines/protocol/openid-connect/userinfo",
    "--env",
    "LLMM_KEYCLOAK_JWKS_URL=http://keycloak:8080/realms/llm-machines/protocol/openid-connect/certs",
    "--env",
    `LLMM_GRAFANA_SIGNOUT_REDIRECT_URL=${identityBase}/realms/llm-machines/protocol/openid-connect/logout?client_id=grafana&post_logout_redirect_uri=${encodeURIComponent(`${grafanaBase}/login`)}`,
    "--mount",
    `type=bind,src=${paths.grafanaIni},dst=/etc/grafana/grafana.ini,readonly`,
    "--mount",
    `type=bind,src=${paths.oidcSecret},dst=/run/secrets/llmm_grafana_oidc_client_secret,readonly`,
    "--mount",
    `type=volume,src=${runtime.volume},dst=/var/lib/grafana`,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges=true",
    GRAFANA_IMAGE,
  ])
  await waitForHttp(`${grafanaBase}/api/health`, 300_000)
  return runtime
}

async function characterizeBrowser(runtime) {
  const grafanaBase = `http://127.0.0.1:${runtime.ports.grafana}`
  const identityBase = `http://127.0.0.1:${runtime.ports.identity}`
  const browser = await chromium.launch({
    executablePath: browserExecutable(),
    headless: true,
    args: ["--disable-background-networking", "--no-first-run", "--no-sandbox"],
  })
  try {
    const admin = await login(
      browser,
      runtime,
      "admin",
      runtime.secrets.adminPassword,
    )
    const user = await browserJson(admin.page, "/api/user")
    assert.equal(user.status, 200)
    assert.equal(user.body?.isGrafanaAdmin, false)
    const organizations = await browserJson(admin.page, "/api/user/orgs")
    assert.equal(organizations.status, 200)
    assert.equal(organizations.body?.length, 1)
    assert.equal(organizations.body?.[0]?.role, "Editor")
    const disabledPlugins = {}
    for (const pluginId of ["elasticsearch", "tempo", "zipkin"]) {
      const plugin = await browserJson(
        admin.page,
        `/api/plugins/${pluginId}/settings`,
      )
      assert.equal(plugin.status, 404, `${pluginId} remains reachable`)
      disabledPlugins[pluginId] = "NOT_FOUND"
    }
    const plugins = await browserJson(admin.page, "/api/plugins")
    assert.equal(plugins.status, 200)
    for (const pluginId of Object.keys(disabledPlugins))
      assert.equal(
        plugins.body?.some(({ id }) => id === pluginId),
        false,
        `${pluginId} remains listed`,
      )
    const datasourceMutation = await browserJson(
      admin.page,
      "/api/datasources",
      {
        method: "POST",
        body: {
          access: "proxy",
          name: `blocked-${runtime.runId}`,
          type: "tempo",
          url: "http://127.0.0.1:1",
        },
      },
    )
    assert.equal(datasourceMutation.status, 403)
    const dashboard = await browserJson(admin.page, "/api/dashboards/db", {
      method: "POST",
      body: {
        dashboard: {
          id: null,
          panels: [],
          schemaVersion: 41,
          tags: ["f0-n2"],
          title: `F0-N2 ${runtime.runId}`,
        },
        overwrite: false,
      },
    })
    assert.equal(dashboard.status, 200)
    assert.match(dashboard.body?.uid ?? "", /^[A-Za-z0-9_-]+$/)
    const removed = await browserJson(
      admin.page,
      `/api/dashboards/uid/${dashboard.body.uid}`,
      { method: "DELETE" },
    )
    assert.equal(removed.status, 200)

    const operator = await deniedLogin(
      browser,
      runtime,
      "operator",
      runtime.secrets.operatorPassword,
    )
    const dual = await deniedLogin(
      browser,
      runtime,
      "dual",
      runtime.secrets.dualPassword,
    )
    const unknown = await deniedLogin(
      browser,
      runtime,
      "unknown",
      runtime.secrets.unknownPassword,
    )

    const cookies = (await admin.context.cookies()).map(cookieMetadata)
    for (const expected of ["grafana_session", "grafana_session_expiry"])
      assert.ok(
        cookies.some(({ name }) => name === expected),
        `${expected} missing`,
      )
    const crossOrigin = await crossOriginMutation(admin.context, grafanaBase)
    assert.equal(crossOrigin, 403)
    await docker(["restart", runtime.containers.grafana])
    await waitForHttp(`${grafanaBase}/api/health`)
    await admin.page.reload({ waitUntil: "domcontentloaded" })
    const afterRestart = await browserJson(admin.page, "/api/user")
    assert.equal(afterRestart.status, 200)
    assert.equal(afterRestart.body?.isGrafanaAdmin, false)
    const organizationsAfterRestart = await browserJson(
      admin.page,
      "/api/user/orgs",
    )
    assert.equal(organizationsAfterRestart.status, 200)
    assert.equal(organizationsAfterRestart.body?.[0]?.role, "Editor")
    const logoutResult = await logout(admin, grafanaBase)
    return {
      browser: await browser.version(),
      authentication: {
        authorizationCode: true,
        identityAuthorizationPath:
          "/realms/llm-machines/protocol/openid-connect/auth",
        callbackPath: "/login/generic_oauth",
        pkceS256: admin.pkceS256,
        nativeSession: true,
        consoleSessionForwarded: false,
      },
      authorization: {
        Admin: "Editor",
        Operator: operator,
        mixedAdminOperator: dual,
        unknownRole: unknown,
        grafanaServerAdministrator: false,
        dashboardCreateDelete: "PASS",
        disabledVulnerablePlugins: disabledPlugins,
        disabledVulnerablePluginsAbsentFromInventory: true,
        editorDatasourceMutationStatus: datasourceMutation.status,
      },
      cookies,
      csrf: {
        sameOriginMutationOriginObserved:
          admin.sameOriginMutationOriginObserved,
        sameOriginMutationRefererObserved:
          admin.sameOriginMutationRefererObserved,
        crossOriginMutationStatus: crossOrigin,
        edgeRequirement:
          "State-changing requests require a same-origin Origin or Referer because the native browser may omit Origin.",
      },
      logout: logoutResult,
      restart: "PASS_NATIVE_SESSION_AND_GRAFANA_STATE",
    }
  } finally {
    await browser.close()
  }
}

async function login(browser, runtime, username, password) {
  const grafanaBase = `http://127.0.0.1:${runtime.ports.grafana}`
  const identityBase = `http://127.0.0.1:${runtime.ports.identity}`
  const context = await browser.newContext()
  const page = await context.newPage()
  let pkceS256 = false
  let sameOriginMutationOriginObserved = false
  let sameOriginMutationRefererObserved = false
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (![grafanaBase, identityBase].includes(url.origin)) return
    const headers = request.headers()
    recordRoute(url, request.method(), headers, null)
    if (
      url.pathname.endsWith("/protocol/openid-connect/auth") &&
      url.searchParams.get("code_challenge_method") === "S256" &&
      url.searchParams.has("code_challenge")
    )
      pkceS256 = true
    if (
      url.origin === grafanaBase &&
      request.method() === "POST" &&
      headers.origin === grafanaBase
    )
      sameOriginMutationOriginObserved = true
    if (
      url.origin === grafanaBase &&
      request.method() === "POST" &&
      headers.referer?.startsWith(grafanaBase)
    )
      sameOriginMutationRefererObserved = true
  })
  page.on("response", async (response) => {
    const url = new URL(response.url())
    if (![grafanaBase, identityBase].includes(url.origin)) return
    const headers = await response.allHeaders()
    recordRoute(url, response.request().method(), null, headers)
    if ((headers["content-type"] ?? "").includes("text/event-stream"))
      eventStreamPaths.add(`${logicalOrigin(url)} ${url.pathname}`)
  })
  page.on("websocket", (socket) => {
    const url = new URL(socket.url())
    if ([grafanaBase, identityBase].includes(url.origin))
      websocketPaths.add(`${logicalOrigin(url)} ${url.pathname}`)
  })
  await page.goto(`${grafanaBase}/login/generic_oauth`, {
    waitUntil: "domcontentloaded",
  })
  await page.locator("#username").fill(username)
  await page.locator("#password").fill(password)
  await Promise.all([
    page.waitForURL((url) => url.origin === grafanaBase, { timeout: 120_000 }),
    page.locator("#kc-login").click(),
  ])
  await page.waitForLoadState("domcontentloaded")
  assert.equal(new URL(page.url()).origin, grafanaBase)
  assert.ok(pkceS256, "Grafana did not initiate PKCE S256")
  return {
    context,
    page,
    pkceS256,
    sameOriginMutationOriginObserved,
    sameOriginMutationRefererObserved,
  }
}

async function deniedLogin(browser, runtime, username, password) {
  const session = await login(browser, runtime, username, password)
  await session.page.waitForLoadState("domcontentloaded")
  const cookies = await session.context.cookies()
  const hasNativeSession = cookies.some(
    ({ name }) => name === "grafana_session",
  )
  const apiUser = await browserJson(session.page, "/api/user")
  assert.equal(hasNativeSession, false, `${username} received Grafana session`)
  assert.ok(apiUser.status === 401 || apiUser.status === 403)
  await session.context.close()
  return "DENY"
}

async function logout(session, grafanaBase) {
  await session.page
    .goto(`${grafanaBase}/logout`, { waitUntil: "domcontentloaded" })
    .catch((error) => {
      assert.match(error.message, /net::ERR_ABORTED/)
    })
  await eventually(async () => {
    const cookies = await session.context.cookies()
    return !cookies.some(({ name }) => name === "grafana_session")
  })
  const cookies = await session.context.cookies()
  assert.equal(
    cookies.some(({ name }) => name === "grafana_session"),
    false,
  )
  await session.context.close()
  return "NATIVE_SESSION_CLEARED_AND_KEYCLOAK_LOGOUT_REDIRECTED"
}

async function proveIdentityOutage(runtime) {
  await docker(["stop", runtime.containers.keycloak])
  const health = await fetch(
    `http://127.0.0.1:${runtime.ports.grafana}/api/health`,
  )
  assert.equal(health.status, 200)
  const login = await fetch(
    `http://127.0.0.1:${runtime.ports.grafana}/login/generic_oauth`,
    { redirect: "manual" },
  )
  assert.equal(login.status, 302)
  const location = login.headers.get("location") ?? ""
  assert.match(
    location,
    /\/realms\/llm-machines\/protocol\/openid-connect\/auth/,
  )
  await docker(["start", runtime.containers.keycloak])
  await waitForHttp(
    `http://127.0.0.1:${runtime.ports.identity}/realms/llm-machines/.well-known/openid-configuration`,
  )
  return "CONTROLLED_IDENTITY_REDIRECT_UNAVAILABLE_GRAFANA_REMAINS_HEALTHY"
}

async function inspectRuntime(runtime) {
  const ports = await docker(["port", runtime.containers.grafana, "3000/tcp"])
  assert.match(ports, /^127\.0\.0\.1:/)
  const image = JSON.parse(
    await docker(["image", "inspect", GRAFANA_IMAGE, "--format", "{{json .}}"]),
  )
  return {
    grafanaListener: "loopback-only",
    directCustomerPort: "DENIED_BY_BINDING",
    imageArchitecture: image.Architecture,
    imageId: image.Id,
    imageOs: image.Os,
    sourceLabel: image.Config?.Labels?.["org.opencontainers.image.source"],
    nativeRouteActivation: "INACTIVE_PENDING_F0_N5",
  }
}

async function configureClientScope(runtime) {
  const base = `http://127.0.0.1:${runtime.ports.identity}`
  const tokenResponse = await fetch(
    `${base}/realms/master/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "admin-cli",
        grant_type: "password",
        password: runtime.secrets.identityBootstrapPassword,
        username: "fixture-bootstrap",
      }),
    },
  )
  assert.equal(tokenResponse.status, 200)
  const token = (await tokenResponse.json()).access_token
  assert.ok(token)
  const headers = { Authorization: `Bearer ${token}` }
  const clients = await fetch(
    `${base}/admin/realms/llm-machines/clients?clientId=grafana`,
    {
      headers,
    },
  ).then((response) => response.json())
  assert.equal(clients.length, 1)
  const roles = []
  for (const role of ["admin", "operator"]) {
    const response = await fetch(
      `${base}/admin/realms/llm-machines/roles/${role}`,
      {
        headers,
      },
    )
    assert.equal(response.status, 200)
    roles.push(await response.json())
  }
  const mapping = await fetch(
    `${base}/admin/realms/llm-machines/clients/${clients[0].id}/scope-mappings/realm`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(roles),
    },
  )
  assert.equal(mapping.status, 204)
}

function realmSeed(runtime) {
  const grafanaBase = `http://127.0.0.1:${runtime.ports.grafana}`
  return {
    realm: "llm-machines",
    enabled: true,
    sslRequired: "none",
    accessTokenLifespan: 300,
    ssoSessionIdleTimeout: 28_800,
    ssoSessionMaxLifespan: 86_400,
    roles: { realm: [{ name: "admin" }, { name: "operator" }] },
    clients: [
      {
        clientId: "grafana",
        enabled: true,
        publicClient: false,
        secret: runtime.secrets.oidcClientSecret,
        standardFlowEnabled: true,
        directAccessGrantsEnabled: false,
        serviceAccountsEnabled: false,
        fullScopeAllowed: false,
        redirectUris: [`${grafanaBase}/login/generic_oauth`],
        webOrigins: [grafanaBase],
        attributes: {
          "pkce.code.challenge.method": "S256",
          "post.logout.redirect.uris": `${grafanaBase}/*`,
        },
        protocolMappers: [
          {
            name: "grafana-realm-roles",
            protocol: "openid-connect",
            protocolMapper: "oidc-usermodel-realm-role-mapper",
            config: {
              "access.token.claim": "true",
              "claim.name": "realm_access.roles",
              "id.token.claim": "true",
              "jsonType.label": "String",
              multivalued: "true",
              "userinfo.token.claim": "true",
            },
          },
        ],
      },
    ],
    users: [
      fixtureUser("admin", runtime.secrets.adminPassword, ["admin"]),
      fixtureUser("operator", runtime.secrets.operatorPassword, ["operator"]),
      fixtureUser("dual", runtime.secrets.dualPassword, ["admin", "operator"]),
      fixtureUser("unknown", runtime.secrets.unknownPassword, []),
    ],
  }
}

function fixtureUser(username, password, realmRoles) {
  return {
    username,
    email: `f0-n2-${username}@example.com`,
    emailVerified: true,
    enabled: true,
    firstName: username,
    lastName: "Fixture",
    requiredActions: [],
    realmRoles,
    credentials: [{ type: "password", value: password, temporary: false }],
  }
}

async function browserJson(page, path, options = {}) {
  return page.evaluate(
    async ({ body, method, path }) => {
      const response = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      let parsed = null
      try {
        parsed = await response.json()
      } catch {}
      return { body: parsed, status: response.status }
    },
    { body: options.body, method: options.method ?? "GET", path },
  )
}

async function crossOriginMutation(context, grafanaBase) {
  const cookieHeader = (await context.cookies(grafanaBase))
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ")
  const response = await fetch(`${grafanaBase}/api/dashboards/db`, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/json",
      Origin: "https://attacker.example.invalid",
    },
    body: JSON.stringify({
      dashboard: { id: null, panels: [], title: "blocked-cross-origin" },
      overwrite: false,
    }),
  })
  return response.status
}

function recordRoute(url, method, requestHeaders, responseHeaders) {
  const key = `${logicalOrigin(url)}|${url.pathname}|${method}`
  const current = routes.get(key) ?? {
    method,
    origin: logicalOrigin(url),
    path: url.pathname,
    queryKeys: [],
    requestHeaderNames: [],
    responseHeaderNames: [],
  }
  current.queryKeys = [
    ...new Set([...current.queryKeys, ...url.searchParams.keys()]),
  ].sort()
  if (requestHeaders)
    current.requestHeaderNames = [
      ...new Set([
        ...current.requestHeaderNames,
        ...Object.keys(requestHeaders),
      ]),
    ].sort()
  if (responseHeaders)
    current.responseHeaderNames = [
      ...new Set([
        ...current.responseHeaderNames,
        ...Object.keys(responseHeaders),
      ]),
    ].sort()
  routes.set(key, current)
}

function logicalOrigin(url) {
  return url.port === String(state?.ports?.identity) ? "identity" : "grafana"
}

function cookieMetadata({ httpOnly, name, path, sameSite, secure }) {
  return { httpOnly, name, path, sameSite, secure }
}

async function cleanup(runtime) {
  for (const container of Object.values(runtime.containers))
    await docker(["rm", "--force", container], { allowFailure: true })
  await docker(["network", "rm", runtime.network], { allowFailure: true })
  await docker(["volume", "rm", runtime.volume], { allowFailure: true })
  await rm(runtime.root, { recursive: true, force: true })
  const remaining = await docker([
    "ps",
    "--all",
    "--quiet",
    "--filter",
    `label=com.llm-machines.test-package=${packageLabel}`,
  ])
  assert.equal(remaining.trim(), "", "F0-N2 task containers remain")
}

async function docker(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  } catch (error) {
    if (allowFailure) return ""
    throw new Error(
      `docker ${args[0]} failed: ${error.stderr?.toString().trim()}`,
    )
  }
}

async function waitForHttp(url, timeout = 120_000) {
  await eventually(async () => {
    try {
      const response = await fetch(url)
      return response.ok
    } catch {
      return false
    }
  }, timeout)
}

async function eventually(check, timeout = 10_000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await check()) return true
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`condition did not pass within ${timeout}ms`)
}

async function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() => resolvePort(address.port))
    })
  })
}

function browserExecutable() {
  for (const candidate of [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ])
    if (existsSync(candidate)) return candidate
  throw new Error("Chromium-compatible browser is required")
}

function opaque() {
  return randomBytes(32).toString("base64url")
}

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
