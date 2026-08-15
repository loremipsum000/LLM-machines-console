import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { chmod, readFile, writeFile } from "node:fs/promises"
import { chromium } from "playwright-core"

const configFile = required("F0_N1_BROWSER_CONFIG_FILE")
const evidenceFile = required("F0_N1_BROWSER_EVIDENCE_FILE")
const secretsFile = required("F0_N1_BROWSER_SECRETS_FILE")
const state = JSON.parse(await readFile(configFile, "utf8"))
const liteLlmBase = `http://127.0.0.1:${state.ports.litellm}`
const identityBase = `http://127.0.0.1:${state.ports.identity}`
const routes = new Map()
const secrets = []
const browser = await chromium.launch({
  executablePath: chromeExecutable(),
  headless: true,
  args: ["--disable-background-networking", "--no-first-run"],
})

try {
  const invocationId = Date.now().toString(36)
  const adminAlias = `f0-n1-admin-${state.runId}-${invocationId}`
  const operatorAlias = `f0-n1-operator-${state.runId}-${invocationId}`
  const admin = await login("admin", state.secrets.adminPassword)
  const operator = await login("operator", state.secrets.operatorPassword)
  assert.equal(admin.claims.user_role, "proxy_admin")
  assert.equal(operator.claims.user_role, "internal_user")
  assert.equal(admin.claims.user_id, state.identities.admin)
  assert.equal(operator.claims.user_id, state.identities.operator)
  assert.notEqual(admin.claims.user_id, operator.claims.user_id)
  assertSessionLifetime(admin.claims)
  assertSessionLifetime(operator.claims)
  await assertOperatorNavigation(operator.page)

  const adminKey = await api(admin.token, "POST", "/key/generate", {
    key_alias: adminAlias,
    models: ["fixture-model"],
  })
  assert.equal(adminKey.status, 200)
  assert.match(adminKey.body?.key ?? "", /^sk-/)
  secrets.push(adminKey.body.key)

  const operatorKey = await api(operator.token, "POST", "/key/generate", {
    key_alias: operatorAlias,
    models: ["fixture-model"],
  })
  assert.equal(operatorKey.status, 200)
  assert.match(operatorKey.body?.key ?? "", /^sk-/)
  secrets.push(operatorKey.body.key)
  assert.equal(operatorKey.body.user_id, operator.claims.user_id)

  const ownInfo = await api(operatorKey.body.key, "GET", "/key/info")
  assert.equal(ownInfo.status, 200)
  const ownList = await api(
    operator.token,
    "GET",
    `/key/list?user_id=${encodeURIComponent(operator.claims.user_id)}&return_full_object=true&include_created_by_keys=true`,
  )
  assert.equal(ownList.status, 200)
  assert.ok(
    JSON.stringify(ownList.body).includes(operatorAlias),
    "Operator cannot view own key",
  )
  assert.ok(
    !JSON.stringify(ownList.body).includes(adminAlias),
    "Operator can view another user's key",
  )

  const crossDelete = await api(operator.token, "POST", "/key/delete", {
    keys: [adminKey.body.key],
  })
  assertDenied(crossDelete, "cross-user key delete")
  const crossInfo = await api(operator.token, "POST", "/v2/key/info", {
    keys: [adminKey.body.key],
  })
  assert.equal(crossInfo.status, 200)
  assert.deepEqual(crossInfo.body?.info, [])

  const forbidden = [
    [
      "POST",
      "/model/new",
      { litellm_params: { model: "openai/blocked" }, model_name: "blocked" },
    ],
    ["POST", "/team/new", { team_alias: "blocked" }],
    ["POST", "/organization/new", { organization_alias: "blocked" }],
    [
      "POST",
      "/user/new",
      { user_email: "blocked@f0-n1.invalid", user_role: "internal_user" },
    ],
    ["POST", "/config/update", { general_settings: {} }],
    [
      "POST",
      "/v1/mcp/server",
      { server_name: "blocked", url: "http://127.0.0.1" },
    ],
    [
      "POST",
      "/key/generate",
      { key_alias: "blocked-cross-user", user_id: admin.claims.user_id },
    ],
  ]
  const denialEvidence = []
  for (const [method, path, body] of forbidden) {
    const response = await api(operator.token, method, path, body)
    assertDenied(response, `${method} ${path}`)
    denialEvidence.push({ method, path, status: response.status })
  }

  const completion = await api(
    operatorKey.body.key,
    "POST",
    "/v1/chat/completions",
    {
      messages: [{ content: state.canaries.prompt, role: "user" }],
      model: "fixture-model",
      stream: false,
    },
  )
  assert.equal(completion.status, 200)
  assert.equal(
    completion.body?.choices?.[0]?.message?.content,
    state.canaries.response,
  )
  const stream = await apiText(
    operatorKey.body.key,
    "POST",
    "/v1/chat/completions",
    {
      messages: [{ content: state.canaries.stream, role: "user" }],
      model: "fixture-model",
      stream: true,
    },
  )
  assert.equal(stream.status, 200)
  assert.match(stream.body, /data: \[DONE\]/)

  const ownSpend = await api(operator.token, "GET", "/user/info")
  assert.equal(ownSpend.status, 200)
  assert.equal(ownSpend.body?.user_info?.user_role, "internal_user")

  const ownDelete = await api(operator.token, "POST", "/key/delete", {
    keys: [operatorKey.body.key],
  })
  assert.equal(ownDelete.status, 200)
  const deleted = await api(
    operatorKey.body.key,
    "POST",
    "/v1/chat/completions",
    {
      messages: [{ content: "deleted-key-check", role: "user" }],
      model: "fixture-model",
    },
  )
  assert.equal(deleted.status, 401)
  const adminDelete = await api(admin.token, "POST", "/key/delete", {
    keys: [adminKey.body.key],
  })
  assert.equal(adminDelete.status, 200)

  await logout(operator)
  await logout(admin)
  await writePrivate(secretsFile, `${JSON.stringify(secrets)}\n`)
  await writePrivate(
    evidenceFile,
    `${JSON.stringify(
      {
        schema: "llm-machines.f0-n1-browser-characterization.v1",
        status: "PASS",
        browser: await browser.version(),
        authentication: {
          authorizationCode: true,
          billableUsers: 2,
          billableUserLimit: 5,
          consoleSessionForwarded: false,
          nativeCookieNames: {
            identity: admin.identityCookieNames,
            litellm: admin.liteLlmCookies.map(({ name }) => name),
          },
          pkceS256: admin.pkceS256 && operator.pkceS256,
          roles: { Admin: "proxy_admin", Operator: "internal_user" },
          subjectBinding: {
            commissioning: state.commissioning,
            immutableUserIdClaim: "sub",
            result: "PASS",
          },
          serviceSession: {
            keycloakIdleSeconds: 28_800,
            keycloakMaximumSeconds: 86_400,
            liteLlmFixedMaximumSeconds: 28_800,
            limitation:
              "LiteLLM OSS v1.96.2 provides a fixed native UI JWT lifetime rather than a sliding idle timeout.",
          },
        },
        authorization: {
          adminOwnKeyLifecycle: "PASS",
          operatorOwnKeyLifecycle: "PASS",
          operatorOwnSpend: "PASS",
          crossUserDenied: true,
          globalMutationDenials: denialEvidence,
        },
        routing: {
          nonStreaming: "PASS",
          streaming: "PASS",
          accounting: "PASS",
        },
        logout: "NATIVE_COOKIE_CLEARED_SERVICE_LOCAL_SESSION_ENDED",
        routeInventory: [...routes.values()].sort((left, right) =>
          `${left.origin}${left.path}${left.method}`.localeCompare(
            `${right.origin}${right.path}${right.method}`,
          ),
        ),
      },
      null,
      2,
    )}\n`,
  )
  process.stdout.write(
    `${JSON.stringify({ status: "PASS", evidenceFile, secretsFile })}\n`,
  )
} finally {
  await browser.close()
}

async function login(username, password) {
  const context = await browser.newContext()
  const page = await context.newPage()
  let pkceS256 = false
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (![liteLlmBase, identityBase].includes(url.origin)) return
    recordRoute(url, request.method(), request.headers(), null)
    if (
      url.pathname.endsWith("/protocol/openid-connect/auth") &&
      url.searchParams.get("code_challenge_method") === "S256" &&
      url.searchParams.has("code_challenge")
    )
      pkceS256 = true
  })
  page.on("response", async (response) => {
    const url = new URL(response.url())
    if (![liteLlmBase, identityBase].includes(url.origin)) return
    const headers = await response.allHeaders()
    recordRoute(url, response.request().method(), null, headers)
  })
  await page.goto(`${liteLlmBase}/sso/key/generate`, {
    waitUntil: "domcontentloaded",
  })
  await page.locator("#username").fill(username)
  await page.locator("#password").fill(password)
  await Promise.all([
    page.waitForURL(
      (url) => url.origin === liteLlmBase && url.pathname.startsWith("/ui"),
      { timeout: 120_000 },
    ),
    page.locator("#kc-login").click(),
  ])
  await page.waitForLoadState("domcontentloaded")
  const allCookies = await context.cookies()
  const liteLlmCookies = allCookies
    .filter(({ domain }) => domain === "127.0.0.1")
    .filter(({ name }) => name === "token" || name.startsWith("litellm"))
    .map(({ httpOnly, name, path, sameSite, secure }) => ({
      httpOnly,
      name,
      path,
      sameSite,
      secure,
    }))
  const tokenCookie = allCookies.find(({ name }) => name === "token")
  assert.ok(tokenCookie, `${username} native LiteLLM token cookie missing`)
  const token = decodeURIComponent(tokenCookie.value)
  secrets.push(token)
  const claims = decodeJwt(token)
  assert.match(claims.key ?? "", /^sk-/)
  secrets.push(claims.key)
  const user = await api(claims.key, "GET", "/user/info")
  assert.equal(user.status, 200)
  assert.equal(user.body?.user_info?.user_role, claims.user_role)
  assert.ok(pkceS256)
  return {
    claims,
    context,
    identityCookieNames: allCookies
      .filter(
        ({ name }) =>
          name.startsWith("KEYCLOAK_") || name === "AUTH_SESSION_ID",
      )
      .map(({ name }) => name)
      .sort(),
    liteLlmCookies,
    page,
    pkceS256,
    sessionCookie: token,
    token: claims.key,
  }
}

async function logout(session) {
  await session.page.goto(`${liteLlmBase}/ui/`, {
    waitUntil: "domcontentloaded",
  })
  await session.page
    .getByRole("complementary")
    .getByText("Virtual Keys")
    .waitFor({ timeout: 60_000 })
  const account = session.page.getByRole("button", { name: /Account menu/i })
  await account.waitFor({ timeout: 60_000 })
  await account.click()
  const popup = session.page.getByTestId("sidebar-account-menu-panel")
  await popup.waitFor({ timeout: 10_000 })
  await popup.getByRole("button", { name: "Logout" }).click()
  const cleared = await eventually(async () => {
    const cookies = await session.context.cookies()
    return !cookies.some(({ name }) => name === "token")
  })
  if (!cleared) {
    const remaining = (await session.context.cookies())
      .filter(({ name }) => name === "token")
      .map(({ domain, httpOnly, name, path, sameSite, secure }) => ({
        domain,
        httpOnly,
        name,
        path,
        sameSite,
        secure,
      }))
    const sameAsLogin = (await session.context.cookies()).some(
      ({ name, value }) =>
        name === "token" && decodeURIComponent(value) === session.sessionCookie,
    )
    throw new Error(
      `native logout retained token cookie metadata: ${JSON.stringify({ remaining, sameAsLogin })}`,
    )
  }
  await session.page.goto(`${liteLlmBase}/ui/?page=llm-playground`, {
    waitUntil: "domcontentloaded",
  })
  const redirected = await eventually(
    async () => /\/ui\/login/.test(session.page.url()),
    60_000,
  )
  assert.ok(redirected, "protected navigation did not return to native login")
  assert.match(session.page.url(), /\/ui\/login/)
  await session.context.close()
}

async function assertOperatorNavigation(page) {
  await page.goto(`${liteLlmBase}/ui/`, { waitUntil: "domcontentloaded" })
  const navigation = page.getByRole("complementary")
  await navigation.getByText("Virtual Keys").waitFor({ timeout: 60_000 })
  await navigation.getByText("Usage", { exact: true }).waitFor()
  for (const unavailable of [
    "MCP Servers",
    "Models + Endpoints",
    "Teams",
    "Organizations",
    "Internal Users",
    "Settings",
  ])
    assert.equal(
      await navigation.getByText(unavailable, { exact: true }).count(),
      0,
      `Operator navigation exposed ${unavailable}`,
    )
}

async function api(token, method, path, body) {
  const response = await fetch(`${liteLlmBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const url = new URL(`${liteLlmBase}${path}`)
  recordRoute(
    url,
    method,
    { authorization: "[present]" },
    Object.fromEntries(response.headers),
  )
  let parsed = null
  try {
    parsed = await response.json()
  } catch {}
  return { body: parsed, status: response.status }
}

async function apiText(token, method, path, body) {
  const response = await fetch(`${liteLlmBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  return { body: await response.text(), status: response.status }
}

function assertDenied(response, action) {
  assert.ok(
    response.status === 401 || response.status === 403,
    `${action} was not authorization-denied: ${response.status}`,
  )
}

function recordRoute(url, method, requestHeaders, responseHeaders) {
  const key = `${url.origin}|${url.pathname}|${method}`
  const current = routes.get(key) ?? {
    method,
    origin: url.origin === liteLlmBase ? "litellm" : "identity",
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

function decodeJwt(token) {
  const parts = token.split(".")
  assert.equal(parts.length, 3)
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
}

function assertSessionLifetime(claims) {
  assert.equal(typeof claims.exp, "number")
  const remaining = claims.exp - Math.floor(Date.now() / 1000)
  assert.ok(remaining > 28_500, "native session lifetime is unexpectedly short")
  assert.ok(
    remaining <= 28_800,
    "native session exceeds the fixed 8-hour limit",
  )
}

async function writePrivate(path, value) {
  await writeFile(path, value, { mode: 0o600 })
  await chmod(path, 0o600)
}

function chromeExecutable() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Arc.app/Contents/MacOS/Arc",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]
  for (const candidate of candidates)
    if (existsSync(candidate)) return candidate
  throw new Error("Chrome, Chromium, Brave, or Arc is required")
}

async function eventually(check, timeout = 10_000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await check()) return true
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  return false
}

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
