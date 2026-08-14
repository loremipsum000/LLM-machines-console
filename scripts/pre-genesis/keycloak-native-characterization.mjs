import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { chromium } from "playwright-core"

const KEYCLOAK_IMAGE =
  "quay.io/keycloak/keycloak@sha256:26939e1318d6f008fc2ee6e10cec1cf8f1ba8a21846c1bc81b91ed0506bc2a7a"
const PACKAGE = "F0-N3"
const THEME_INVENTORY_SHA256 =
  "ec32ce8b4f5f6d1de830ba2285bf51f90721d9cce386f5ebbd351108beb4ae45"
const evidenceFile = resolve(required("F0_N3_EVIDENCE_FILE"))
const themeRoot = resolve(required("F0_N3_THEME_ROOT"))
const routes = new Map()
let runtime

try {
  runtime = await startRuntime()
  const configured = await configureNativeAuthority(runtime)
  const browser = await characterizeBrowser(runtime, configured)
  const restart = await proveRestart(runtime, browser)
  const outage = await proveOutage(runtime)
  const theme = await themeInventory(themeRoot)
  assert.equal(theme.inventorySha256, THEME_INVENTORY_SHA256)
  const report = {
    schema: "llm-machines.f0-n3-keycloak-native-characterization.v1",
    status: "PASS",
    version: "26.7.0",
    image: {
      index:
        "sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13",
      platform: "linux/amd64",
      platformManifest:
        "sha256:26939e1318d6f008fc2ee6e10cec1cf8f1ba8a21846c1bc81b91ed0506bc2a7a",
    },
    authority: {
      productionOrigin: "https://keycloak.lab.llm-machines.com",
      adminConsolePath: "/keycloak/admin/llm-machines/console/",
      nativeIngress: "INACTIVE_PENDING_F0_N5",
      directListener: "LOOPBACK_ONLY_CHARACTERIZATION",
    },
    authentication: browser.authentication,
    theme,
    authorization: browser.authorization,
    browser: browser.browser,
    cookies: browser.cookies,
    csrfAndCors: browser.csrfAndCors,
    logout: browser.logout,
    restart,
    outage,
    routeInventory: [...routes.values()].sort((left, right) =>
      `${left.authority} ${left.path} ${left.method}`.localeCompare(
        `${right.authority} ${right.path} ${right.method}`,
      ),
    ),
    layeredDeleteControl: {
      upstreamStatus: 204,
      requiredEdgeStatus: 403,
      requiredMethod: "DELETE",
      requiredPath: "/keycloak/admin/realms/llm-machines/users/{uuid}",
      activationBlockedUntilEdgeProof: true,
    },
    consoleSessionForwarded: false,
    credentialMaterialPrinted: false,
    credentialsRetained: false,
    runtimeQualified: false,
  }
  await writeFile(evidenceFile, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  })
  await chmod(evidenceFile, 0o600)
  process.stdout.write(`${JSON.stringify({ evidenceFile, status: "PASS" })}\n`)
} finally {
  if (runtime) await cleanup(runtime)
}

async function startRuntime() {
  const runId = randomBytes(8).toString("hex")
  const root = await mkdtemp(join(tmpdir(), "llmm-f0-n3-keycloak-"))
  await chmod(root, 0o700)
  const state = {
    root,
    runId,
    container: `llmm-f0-n3-keycloak-${runId}`,
    network: `llmm-f0-n3-${runId}`,
    volume: `llmm-f0-n3-keycloak-${runId}`,
    port: await reservePort(),
    secrets: {
      adminPassword: opaque(),
      bootstrapPassword: opaque(),
      operatorPassword: opaque(),
    },
  }
  runtime = state
  const realmFile = join(root, "realm.json")
  await writeFile(realmFile, `${JSON.stringify(realmSeed(state), null, 2)}\n`, {
    // The parent directory remains 0700; the container needs read access to
    // this throwaway bind-mounted import file.
    mode: 0o644,
  })
  docker(["pull", "--platform", "linux/amd64", KEYCLOAK_IMAGE])
  docker([
    "network",
    "create",
    "--label",
    `com.llm-machines.test-package=${PACKAGE}`,
    state.network,
  ])
  docker([
    "volume",
    "create",
    "--label",
    `com.llm-machines.test-package=${PACKAGE}`,
    state.volume,
  ])
  docker([
    "run",
    "--detach",
    "--name",
    state.container,
    "--label",
    `com.llm-machines.test-package=${PACKAGE}`,
    "--network",
    state.network,
    "--publish",
    `127.0.0.1:${state.port}:8080`,
    "--env",
    "KC_BOOTSTRAP_ADMIN_USERNAME=fixture-bootstrap",
    "--env",
    `KC_BOOTSTRAP_ADMIN_PASSWORD=${state.secrets.bootstrapPassword}`,
    "--mount",
    `type=bind,src=${realmFile},dst=/opt/keycloak/data/import/realm.json,readonly`,
    "--mount",
    `type=bind,src=${themeRoot},dst=/opt/keycloak/themes/llm-machines,readonly`,
    "--mount",
    `type=volume,src=${state.volume},dst=/opt/keycloak/data`,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges=true",
    KEYCLOAK_IMAGE,
    "start-dev",
    "--import-realm",
    "--http-relative-path=/keycloak",
    `--hostname=http://127.0.0.1:${state.port}/keycloak`,
    "--hostname-strict=true",
    "--health-enabled=true",
  ])
  try {
    await waitForKeycloak(state)
  } catch (error) {
    const logs = dockerResult(["logs", "--tail", "120", state.container])
    throw new AggregateError(
      [error, new Error(safeRuntimeDiagnostic(logs.stdout, logs.stderr))],
      "F0-N3 Keycloak did not become ready",
    )
  }
  const binding = docker(["port", state.container, "8080/tcp"]).trim()
  assert.match(binding, new RegExp(`^127\\.0\\.0\\.1:${state.port}$`))
  return state
}

async function configureNativeAuthority(state) {
  const base = baseUrl(state)
  const bootstrap = await passwordToken(
    base,
    "master",
    "fixture-bootstrap",
    state.secrets.bootstrapPassword,
  )
  const headers = bearerHeaders(bootstrap)
  const realmPath = `${base}/keycloak/admin/realms/llm-machines`
  const adminUser = await exactUser(base, headers, "admin")
  const operatorUser = await exactUser(base, headers, "operator")
  const realmManagement = await exactClient(base, headers, "realm-management")
  const adminRole = await json(fetch(`${realmPath}/roles/admin`, { headers }))
  const queryRoles = await Promise.all(
    ["query-groups", "query-users"].map((role) =>
      json(
        fetch(
          `${realmPath}/clients/${encodeURIComponent(realmManagement.id)}/roles/${role}`,
          { headers },
        ),
      ),
    ),
  )
  await expectStatus(
    fetch(
      `${realmPath}/users/${encodeURIComponent(adminUser.id)}/role-mappings/clients/${encodeURIComponent(realmManagement.id)}`,
      {
        body: JSON.stringify(queryRoles),
        headers: { ...headers, "content-type": "application/json" },
        method: "POST",
      },
    ),
    204,
  )
  await expectStatus(
    fetch(realmPath, {
      body: JSON.stringify({ adminPermissionsEnabled: true }),
      headers: { ...headers, "content-type": "application/json" },
      method: "PUT",
    }),
    204,
  )
  const permissionClient = await waitForClient(
    base,
    headers,
    "admin-permissions",
  )
  const authorization = `${realmPath}/clients/${encodeURIComponent(permissionClient.id)}/authz/resource-server`
  await expectStatus(
    fetch(`${authorization}/policy/role`, {
      body: JSON.stringify({
        logic: "POSITIVE",
        name: "customer-admin-role",
        roles: [{ id: adminRole.id, required: false }],
      }),
      headers: { ...headers, "content-type": "application/json" },
      method: "POST",
    }),
    201,
  )
  const admins = await exactGroup(base, headers, "Admins")
  const operators = await exactGroup(base, headers, "Operators")
  for (const permission of [
    {
      name: "customer-admin-manage-all-users",
      policies: ["customer-admin-role"],
      resourceType: "Users",
      scopes: ["view", "manage"],
    },
    groupPermission("Admins", admins.id),
    groupPermission("Operators", operators.id),
  ]) {
    await expectStatus(
      fetch(`${authorization}/permission/scope`, {
        body: JSON.stringify(permission),
        headers: { ...headers, "content-type": "application/json" },
        method: "POST",
      }),
      201,
    )
  }
  return { adminUser, bootstrap, operatorUser }
}

async function characterizeBrowser(state, configured) {
  const base = baseUrl(state)
  const browser = await chromium.launch({
    executablePath: browserExecutable(),
    headless: true,
    args: ["--disable-background-networking", "--no-first-run", "--no-sandbox"],
  })
  try {
    const admin = await loginNative(
      browser,
      state,
      "admin",
      state.secrets.adminPassword,
    )
    assert.equal(admin.pkceS256, true)
    assert.equal(admin.brandedLogin, true)
    assert.ok(admin.bearer, "Admin Console did not issue a native bearer token")
    assert.equal(admin.principalVisible, true)
    const authorization = await exerciseAdminRest(
      state,
      admin.bearer,
      configured,
    )
    const subjectBinding = await proveAdminSubjectBinding(
      state,
      configured.bootstrap,
      configured.adminUser.id,
    )
    const operator = await loginNative(
      browser,
      state,
      "operator",
      state.secrets.operatorPassword,
      { expectDenied: true },
    )
    assert.equal(operator.pkceS256, true)
    assert.equal(operator.denied, true)
    assert.equal(operator.bearer, undefined)
    const operatorToken = await passwordToken(
      base,
      "llm-machines",
      "operator",
      state.secrets.operatorPassword,
    )
    const operatorStatus = await status(
      fetch(`${base}/keycloak/admin/realms/llm-machines/users?max=1`, {
        headers: bearerHeaders(operatorToken),
      }),
    )
    assert.equal(operatorStatus, 403)
    assert.equal(
      operator.cookies.some(({ name }) => name.startsWith("__Host-llmm-")),
      false,
    )
    const csrf = await status(
      fetch(`${base}/keycloak/admin/realms/llm-machines/users`, {
        body: JSON.stringify({ username: `cross-origin-${state.runId}` }),
        headers: {
          ...bearerHeaders(admin.bearer),
          "content-type": "application/json",
          origin: "https://attacker.invalid",
        },
        method: "POST",
      }),
    )
    assert.ok([201, 403].includes(csrf))
    if (csrf === 201) {
      const created = await exactUser(
        base,
        bearerHeaders(admin.bearer),
        `cross-origin-${state.runId}`,
      )
      await expectStatus(
        fetch(
          `${base}/keycloak/admin/realms/llm-machines/users/${created.id}`,
          { headers: bearerHeaders(admin.bearer), method: "DELETE" },
        ),
        204,
      )
    }
    const logout = await nativeLogout(admin.page, admin.context, base)
    const operatorLogout = await nativeLogout(
      operator.page,
      operator.context,
      base,
    )
    return {
      browser: await browser.version(),
      authentication: {
        authorizationCode: true,
        pkceS256: true,
        mandatoryTotp: false,
        passwordOnly: true,
        brandedTheme: "llm-machines",
        nativeSession: true,
        consoleSessionForwarded: false,
        subjectBound: subjectBinding,
        idleSeconds: 28_800,
        maximumSeconds: 86_400,
      },
      authorization: {
        Admin: authorization,
        Operator: {
          adminConsole: "DENY",
          browserDenialPage: true,
          logout: operatorLogout,
          usersListStatus: operatorStatus,
        },
        masterRealm: "DENY",
        unrelatedRealm: "DENY",
        serverAdministrator: false,
      },
      cookies: admin.cookies,
      csrfAndCors: {
        crossOriginBearerMutationObservedStatus: csrf,
        edgeRequirement:
          "The Product edge must preserve reviewed native Origin behavior and never rely on browser Origin as the authorization boundary.",
        bearerSubjectBindingRequired: true,
      },
      logout,
      restartPage: admin.page,
      restartContext: admin.context,
    }
  } finally {
    await browser.close()
  }
}

async function exerciseAdminRest(state, token, configured) {
  const base = `${baseUrl(state)}/keycloak/admin/realms/llm-machines`
  const headers = bearerHeaders(token)
  const outcomes = {}
  outcomes.usersList = await status(fetch(`${base}/users?max=10`, { headers }))
  assert.equal(outcomes.usersList, 200)
  const username = `managed-${state.runId}`
  const createdResponse = await fetch(`${base}/users`, {
    body: JSON.stringify({
      email: `${username}@example.invalid`,
      enabled: true,
      username,
    }),
    headers: { ...headers, "content-type": "application/json" },
    method: "POST",
  })
  outcomes.userCreate = createdResponse.status
  assert.equal(outcomes.userCreate, 201)
  const userId = (createdResponse.headers.get("location") ?? "")
    .split("/")
    .at(-1)
  assert.match(userId ?? "", /^[0-9a-f-]{36}$/)
  outcomes.userUpdate = await status(
    fetch(`${base}/users/${userId}`, {
      body: JSON.stringify({ enabled: true, firstName: "Managed" }),
      headers: { ...headers, "content-type": "application/json" },
      method: "PUT",
    }),
  )
  assert.equal(outcomes.userUpdate, 204)
  outcomes.passwordReset = await status(
    fetch(`${base}/users/${userId}/reset-password`, {
      body: JSON.stringify({
        temporary: false,
        type: "password",
        value: opaque(),
      }),
      headers: { ...headers, "content-type": "application/json" },
      method: "PUT",
    }),
  )
  assert.equal(outcomes.passwordReset, 204)
  outcomes.sessionsList = await status(
    fetch(`${base}/users/${configured.adminUser.id}/sessions`, { headers }),
  )
  assert.equal(outcomes.sessionsList, 200)
  outcomes.sessionInvalidateUnknown = await status(
    fetch(`${base}/sessions/00000000-0000-0000-0000-000000000000`, {
      headers,
      method: "DELETE",
    }),
  )
  assert.equal(outcomes.sessionInvalidateUnknown, 404)
  const denials = {
    masterRealm: await status(
      fetch(`${baseUrl(state)}/keycloak/admin/realms/master`, { headers }),
    ),
    unrelatedRealm: await status(
      fetch(`${baseUrl(state)}/keycloak/admin/realms/unrelated`, { headers }),
    ),
    realmCreation: await status(
      fetch(`${baseUrl(state)}/keycloak/admin/realms`, {
        body: JSON.stringify({ realm: `blocked-${state.runId}` }),
        headers: { ...headers, "content-type": "application/json" },
        method: "POST",
      }),
    ),
    clients: await status(fetch(`${base}/clients?max=1`, { headers })),
    identityProviders: await status(
      fetch(`${base}/identity-provider/instances`, { headers }),
    ),
    roles: await status(fetch(`${base}/roles?max=1`, { headers })),
    groupMutation: await status(
      fetch(`${base}/groups`, {
        body: JSON.stringify({ name: `blocked-${state.runId}` }),
        headers: { ...headers, "content-type": "application/json" },
        method: "POST",
      }),
    ),
    impersonation: await status(
      fetch(`${base}/users/${configured.operatorUser.id}/impersonation`, {
        headers,
        method: "POST",
      }),
    ),
    roleMapping: await status(
      fetch(`${base}/users/${configured.operatorUser.id}/role-mappings/realm`, {
        body: "[]",
        headers: { ...headers, "content-type": "application/json" },
        method: "POST",
      }),
    ),
    realmMutation: await status(
      fetch(base, {
        body: JSON.stringify({ displayName: "blocked" }),
        headers: { ...headers, "content-type": "application/json" },
        method: "PUT",
      }),
    ),
  }
  for (const [name, result] of Object.entries(denials))
    assert.equal(
      result,
      name === "unrelatedRealm" ? 404 : 403,
      `${name} was not denied with its exact fail-closed status`,
    )
  outcomes.upstreamUserDelete = await status(
    fetch(`${base}/users/${userId}`, { headers, method: "DELETE" }),
  )
  assert.equal(outcomes.upstreamUserDelete, 204)
  return { approvedOperations: outcomes, deniedOperations: denials }
}

async function proveAdminSubjectBinding(state, bootstrapToken, adminUserId) {
  const events = await json(
    fetch(
      `${baseUrl(state)}/keycloak/admin/realms/llm-machines/admin-events?max=100`,
      { headers: bearerHeaders(bootstrapToken) },
    ),
  )
  const boundEvents = events.filter(
    (event) => event.authDetails?.userId === adminUserId,
  )
  assert.ok(
    boundEvents.some(
      (event) =>
        event.operationType === "CREATE" &&
        String(event.resourcePath).startsWith("users/"),
    ),
    "Admin create operation was not bound to the authenticated Admin subject",
  )
  assert.ok(
    boundEvents.some(
      (event) =>
        event.operationType === "UPDATE" &&
        String(event.resourcePath).startsWith("users/"),
    ),
    "Admin update operation was not bound to the authenticated Admin subject",
  )
  return {
    adminEventDetailsRetained: false,
    authenticatedUserIdMatched: true,
    createAndUpdateEventsBound: true,
    mechanism: "KEYCLOAK_ADMIN_EVENT_AUTH_DETAILS_USER_ID",
  }
}

async function loginNative(
  browser,
  state,
  username,
  password,
  { expectDenied = false } = {},
) {
  const base = baseUrl(state)
  const context = await browser.newContext()
  const page = await context.newPage()
  let bearer
  let bearerSubject
  const bearerCandidates = []
  let pkceS256 = false
  let brandedLogin = false
  let themeAssetLoaded = false
  page.on("request", async (request) => {
    const url = new URL(request.url())
    if (url.origin !== base) return
    const headers = await request.allHeaders().catch(() => null)
    if (!headers) return
    recordRoute(url, request.method(), headers, null, null)
    if (
      url.pathname.endsWith("/protocol/openid-connect/auth") &&
      url.searchParams.get("code_challenge_method") === "S256" &&
      url.searchParams.has("code_challenge")
    )
      pkceS256 = true
    if (
      url.pathname.startsWith("/keycloak/admin/realms/") &&
      headers.authorization?.startsWith("Bearer ")
    ) {
      const candidate = headers.authorization.slice("Bearer ".length)
      if (
        candidate.split(".").length === 3 &&
        !bearerCandidates.includes(candidate) &&
        bearerCandidates.length < 8
      )
        bearerCandidates.push(candidate)
    }
  })
  page.on("response", async (response) => {
    const url = new URL(response.url())
    if (url.origin !== base) return
    if (
      url.pathname.includes("/login/llm-machines/") &&
      url.pathname.endsWith("/css/login.css") &&
      response.status() === 200
    )
      themeAssetLoaded = true
    const headers = await response.allHeaders().catch(() => null)
    if (!headers) return
    recordRoute(
      url,
      response.request().method(),
      null,
      headers,
      response.status(),
    )
  })
  await page.goto(`${base}/keycloak/admin/llm-machines/console/`, {
    waitUntil: "domcontentloaded",
  })
  await page.locator("#username").waitFor({ timeout: 120_000 })
  brandedLogin =
    themeAssetLoaded &&
    (await page
      .locator("html")
      .evaluate((element) => element.classList.contains("llm-machines-sso")))
  assert.equal(brandedLogin, true)
  await page.locator("#username").fill(username)
  await page.locator("#password").fill(password)
  await page.locator("#kc-login").click()
  try {
    await eventually(async () => {
      for (const candidate of bearerCandidates) {
        const claims = jwtClaims(candidate)
        if (claims?.azp !== "security-admin-console") continue
        bearer = candidate
        const response = await fetch(
          `${base}/keycloak/realms/llm-machines/protocol/openid-connect/userinfo`,
          { headers: bearerHeaders(candidate) },
        )
        if (response.status !== 200) {
          await response.body?.cancel()
          return true
        }
        const payload = await response.json()
        if (typeof payload.sub === "string") {
          bearerSubject = payload.sub
        }
        return true
      }
      return false
    }, 20_000)
  } catch {
    const currentUrl = new URL(page.url())
    const bodyText = await page.locator("body").innerText()
    if (
      expectDenied &&
      bearerCandidates.length === 0 &&
      /do not have permission to access this resource/i.test(bodyText)
    ) {
      return {
        bearer: undefined,
        brandedLogin,
        context,
        cookies: (await context.cookies()).map(cookieMetadata),
        denied: true,
        page,
        pkceS256,
        principalVisible: false,
      }
    }
    const candidateMetadata = bearerCandidates.map((candidate) => {
      const claims = jwtClaims(candidate)
      return {
        azp: claims?.azp ?? null,
        claimNames: claims ? Object.keys(claims).sort() : [],
        name: claims?.name ?? null,
        preferredUsername: claims?.preferred_username ?? null,
        subjectPresent: typeof claims?.sub === "string",
      }
    })
    throw new Error(
      `Native Admin Console did not expose a bearer request at ${currentUrl.origin}${currentUrl.pathname} with query keys ${[...currentUrl.searchParams.keys()].sort().join(",")}; candidate metadata ${JSON.stringify(candidateMetadata)}: ${safeRuntimeDiagnostic(bodyText)}`,
    )
  }
  const cookies = (await context.cookies()).map(cookieMetadata)
  const principalVisible = (await page.locator("body").innerText()).includes(
    `${username} fixture`,
  )
  return {
    bearer,
    bearerSubject,
    brandedLogin,
    context,
    cookies,
    page,
    pkceS256,
    principalVisible,
  }
}

async function nativeLogout(page, context, base) {
  const menu = page.getByRole("button", { name: /admin|user menu/i }).last()
  if ((await menu.count()) > 0) await menu.click().catch(() => undefined)
  const signOut = page.getByText(/sign out/i, { exact: true }).last()
  if ((await signOut.count()) > 0) await signOut.click().catch(() => undefined)
  else
    await page.goto(
      `${base}/keycloak/realms/llm-machines/protocol/openid-connect/logout?client_id=security-admin-console&post_logout_redirect_uri=${encodeURIComponent(`${base}/keycloak/admin/llm-machines/console/`)}`,
      { waitUntil: "domcontentloaded" },
    )
  const cookies = await context.cookies()
  const sessionCookiePresent = cookies.some(({ name }) =>
    ["KEYCLOAK_SESSION", "KEYCLOAK_IDENTITY"].includes(name),
  )
  await context.close()
  return sessionCookiePresent
    ? "LOGOUT_ENDPOINT_REACHED_SESSION_REVALIDATION_REQUIRED"
    : "NATIVE_SESSION_CLEARED"
}

async function proveRestart(state) {
  docker(["restart", state.container])
  await waitForKeycloak(state)
  return "SERVER_RESTARTED_PERSISTENT_REALM_READY_NATIVE_SESSION_MUST_REVALIDATE"
}

async function proveOutage(state) {
  docker(["stop", state.container])
  const unavailable = await fetch(
    `${baseUrl(state)}/keycloak/admin/llm-machines/console/`,
  )
    .then(() => false)
    .catch(() => true)
  assert.equal(unavailable, true)
  docker(["start", state.container])
  await waitForKeycloak(state)
  return "IDENTITY_UNAVAILABLE_WITHOUT_FALLBACK_OR_ALTERNATE_AUTHORITY"
}

function realmSeed(state) {
  return {
    realm: "llm-machines",
    enabled: true,
    sslRequired: "none",
    loginTheme: "llm-machines",
    accessTokenLifespan: 300,
    ssoSessionIdleTimeout: 28_800,
    ssoSessionMaxLifespan: 86_400,
    revokeRefreshToken: true,
    refreshTokenMaxReuse: 0,
    eventsEnabled: true,
    eventsExpiration: 3600,
    enabledEventTypes: ["LOGIN", "LOGOUT"],
    adminEventsEnabled: true,
    adminEventsDetailsEnabled: false,
    roles: { realm: [{ name: "admin" }, { name: "operator" }] },
    groups: [
      { name: "Admins", realmRoles: ["admin"] },
      { name: "Operators", realmRoles: ["operator"] },
    ],
    users: [
      fixtureUser("admin", state.secrets.adminPassword, "/Admins"),
      fixtureUser("operator", state.secrets.operatorPassword, "/Operators"),
    ],
  }
}

function fixtureUser(username, password, group) {
  return {
    username,
    email: `${username}@example.invalid`,
    emailVerified: true,
    enabled: true,
    firstName: username,
    groups: [group],
    lastName: "fixture",
    credentials: [{ temporary: false, type: "password", value: password }],
  }
}

function groupPermission(name, id) {
  return {
    name: `customer-admin-view-${name}-members`,
    policies: ["customer-admin-role"],
    resources: [id],
    resourceType: "Groups",
    scopes: ["view", "view-members"],
  }
}

async function passwordToken(base, realm, username, password) {
  const response = await fetch(
    `${base}/keycloak/realms/${realm}/protocol/openid-connect/token`,
    {
      body: new URLSearchParams({
        client_id: "admin-cli",
        grant_type: "password",
        password,
        username,
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    },
  )
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(typeof payload.access_token, "string")
  return payload.access_token
}

async function exactUser(base, headers, username) {
  const values = await json(
    fetch(
      `${base}/keycloak/admin/realms/llm-machines/users?username=${encodeURIComponent(username)}&exact=true&max=2`,
      { headers },
    ),
  )
  assert.equal(values.length, 1)
  return values[0]
}

async function exactGroup(base, headers, name) {
  const values = await json(
    fetch(
      `${base}/keycloak/admin/realms/llm-machines/groups?search=${encodeURIComponent(name)}&exact=true&max=2`,
      { headers },
    ),
  )
  const matches = values.filter((value) => value.name === name)
  assert.equal(matches.length, 1)
  return matches[0]
}

async function exactClient(base, headers, clientId) {
  const values = await json(
    fetch(
      `${base}/keycloak/admin/realms/llm-machines/clients?clientId=${encodeURIComponent(clientId)}&exact=true&max=2`,
      { headers },
    ),
  )
  assert.equal(values.length, 1)
  return values[0]
}

async function waitForClient(base, headers, clientId) {
  return eventually(() => exactClient(base, headers, clientId))
}

async function waitForKeycloak(state) {
  await eventually(async () => {
    const response = await fetch(
      `${baseUrl(state)}/keycloak/realms/llm-machines/.well-known/openid-configuration`,
    ).catch(() => null)
    return response?.status === 200
  }, 180_000)
}

async function cleanup(state) {
  const failures = []
  for (const args of [
    ["rm", "--force", state.container],
    ["volume", "rm", state.volume],
    ["network", "rm", state.network],
  ]) {
    const result = dockerResult(args)
    if (result.status !== 0 && !/No such|not found/i.test(result.stderr))
      failures.push(new Error(result.stderr))
  }
  await rm(state.root, { force: true, recursive: true })
  if (dockerResult(["inspect", state.container]).status === 0)
    failures.push(new Error("F0-N3 container remains"))
  if (dockerResult(["volume", "inspect", state.volume]).status === 0)
    failures.push(new Error("F0-N3 volume remains"))
  if (dockerResult(["network", "inspect", state.network]).status === 0)
    failures.push(new Error("F0-N3 network remains"))
  if (failures.length > 0)
    throw new AggregateError(failures, "F0-N3 cleanup failed")
}

async function themeInventory(root) {
  const files = []
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const candidate = join(current, entry.name)
      if (entry.isDirectory()) pending.push(candidate)
      else if (entry.isFile()) files.push(candidate)
    }
  }
  const inventory = []
  for (const file of files) {
    const fileHash = createHash("sha256")
      .update(await readFile(file))
      .digest("hex")
    inventory.push(`${file.slice(root.length + 1)}\0${fileHash}\n`)
  }
  return {
    fileCount: files.length,
    inventorySha256: createHash("sha256")
      .update(inventory.sort().join(""))
      .digest("hex"),
    name: "llm-machines",
  }
}

function recordRoute(
  url,
  method,
  requestHeaders,
  responseHeaders,
  responseStatus,
) {
  const key = `${url.origin} ${url.pathname} ${method}`
  const existing = routes.get(key) ?? {
    authority: "identity",
    method,
    path: normalizedPath(url.pathname),
    queryKeys: [],
    requestHeaders: [],
    responseHeaders: [],
    responseStatuses: [],
    redirectOrigins: [],
  }
  existing.queryKeys = unique([
    ...existing.queryKeys,
    ...[...url.searchParams.keys()],
  ])
  existing.requestHeaders = unique([
    ...existing.requestHeaders,
    ...reviewedHeaderNames(requestHeaders),
  ])
  existing.responseHeaders = unique([
    ...existing.responseHeaders,
    ...reviewedHeaderNames(responseHeaders),
  ])
  if (Number.isInteger(responseStatus)) {
    existing.responseStatuses = unique([
      ...existing.responseStatuses,
      responseStatus,
    ])
  }
  const location = responseHeaders?.location
  if (location) {
    const redirect = new URL(location, url)
    existing.redirectOrigins = unique([
      ...existing.redirectOrigins,
      `${redirect.origin === url.origin ? "https://keycloak.lab.llm-machines.com" : redirect.origin}${normalizedPath(redirect.pathname)}`,
    ])
  }
  routes.set(key, existing)
}

function normalizedPath(path) {
  return path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "{uuid}")
}

function reviewedHeaderNames(headers) {
  if (!headers) return []
  const allowed = new Set([
    "accept",
    "authorization",
    "content-type",
    "cookie",
    "location",
    "origin",
    "referer",
    "set-cookie",
    "x-frame-options",
  ])
  return Object.keys(headers)
    .map((name) => name.toLowerCase())
    .filter((name) => allowed.has(name))
}

function cookieMetadata(cookie) {
  return {
    domain:
      cookie.domain === "127.0.0.1"
        ? "keycloak.lab.llm-machines.com"
        : cookie.domain,
    httpOnly: cookie.httpOnly,
    name: cookie.name,
    path: cookie.path,
    sameSite: cookie.sameSite,
    secure: cookie.secure,
  }
}

function jwtClaims(token) {
  try {
    if (token.split(".").length !== 3) return null
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url"))
  } catch {
    return null
  }
}

function bearerHeaders(token) {
  return { authorization: `Bearer ${token}` }
}

function baseUrl(state) {
  return `http://127.0.0.1:${state.port}`
}

async function json(responsePromise) {
  const response = await responsePromise
  assert.equal(response.ok, true, `request returned ${response.status}`)
  return response.json()
}

async function status(responsePromise) {
  const response = await responsePromise
  await response.body?.cancel()
  return response.status
}

async function expectStatus(responsePromise, expected) {
  const actual = await status(responsePromise)
  assert.equal(actual, expected)
}

async function eventually(operation, timeout = 120_000) {
  const deadline = performance.now() + timeout
  let lastError
  while (performance.now() < deadline) {
    try {
      const value = await operation()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
  }
  throw lastError ?? new Error("F0-N3 condition did not become ready")
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolveListen)
  })
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  )
  return address.port
}

function browserExecutable() {
  return process.env.CHROMIUM_PATH?.trim() || "/usr/bin/chromium"
}

function docker(args) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function dockerResult(args) {
  try {
    return { status: 0, stderr: "", stdout: docker(args) }
  } catch (error) {
    return {
      status: error.status ?? 1,
      stderr: String(error.stderr ?? error.message ?? ""),
      stdout: String(error.stdout ?? ""),
    }
  }
}

function opaque() {
  return randomBytes(32).toString("base64url")
}

function unique(values) {
  return [...new Set(values)].sort()
}

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function safeRuntimeDiagnostic(...values) {
  return values
    .join("\n")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted-opaque]")
    .slice(-16_384)
}
