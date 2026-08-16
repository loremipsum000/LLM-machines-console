import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { request as httpsRequest } from "node:https"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"
import { commissionLiteLlmNativeUsers } from "./litellm-native-commissioning.mjs"

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const evidenceFile = resolve(required("F0_N7_EVIDENCE_FILE"))
const validationScope = process.env.F0_N7_SCOPE ?? "complete"
const nativeSessionTimeout = Number.parseInt(
  process.env.F0_N7_NATIVE_SESSION_TIMEOUT_MS ?? "120000",
  10,
)
const preserveFailureResources =
  process.env.F0_N7_PRESERVE_FAILURE_RESOURCES === "1"
assert.ok(
  [
    "complete",
    "grafana-oauth",
    "keycloak-admin",
    "keycloak-session-id",
    "litellm-oauth",
  ].includes(validationScope),
)
const packageLabel = "F0-N7"
const images = {
  edge: "docker.io/library/nginx:1.29.1-alpine@sha256:42a516af16b852e33b7682d5ef8acbd5d13fe08fecadc7ed98605ba5e3b26ab8",
  grafana:
    "docker.io/grafana/grafana:13.1.3@sha256:ab5cb380e3ff3172d6c8bd2e7cfd31cce977d2881b260e1f5bc089bf0b759b43",
  keycloak:
    "quay.io/keycloak/keycloak:26.7.0@sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13",
  litellm:
    "sha256:d1396589f1fed1fa3e67142c5f93189e257db14ce92ce9d952fbf18a58350f6b",
  postgres:
    "docker.io/library/postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3",
}
const hosts = {
  api: "api.f0n7.llmm.test",
  console: "console.f0n7.llmm.test",
  firecrawl: "firecrawl.f0n7.llmm.test",
  grafana: "grafana.f0n7.llmm.test",
  identity: "identity.f0n7.llmm.test",
  keycloak: "keycloak.f0n7.llmm.test",
  litellm: "litellm.f0n7.llmm.test",
}
const origins = Object.fromEntries(
  Object.entries(hosts).map(([name, host]) => [name, `https://${host}`]),
)
const runId = randomBytes(8).toString("hex")
const stateRoot = await mkdtemp(join(tmpdir(), "llmm-f0-n7-native-"))
const network = `llmm-f0-n7-${runId}`
const volume = `llmm-f0-n7-grafana-${runId}`
const containers = Object.fromEntries(
  [
    "edge",
    "fixture",
    "grafana",
    "inference",
    "keycloak",
    "litellm",
    "postgres",
  ].map((name) => [name, `llmm-f0-n7-${name}-${runId}`]),
)
const ports = Object.fromEntries(
  ["grafana", "keycloak", "litellm", "postgres"].map((name, index) => [
    name,
    18_800 + index,
  ]),
)
const secrets = {
  adminPassword: opaque(),
  bootstrapPassword: opaque(),
  databasePassword: opaque(),
  grafanaClient: opaque(),
  liteLlmClient: opaque(),
  liteLlmMaster: `sk-${opaque()}`,
  liteLlmSalt: opaque(),
  operatorPassword: opaque(),
  upstreamKey: `sk-${opaque()}`,
}
const canaries = {
  prompt: `f0n7-prompt-${opaque()}`,
  response: `f0n7-response-${opaque()}`,
  stream: `f0n7-stream-${opaque()}`,
}
const identities = {
  admin: randomUUID(),
  operator: randomUUID(),
}
const paths = {
  ca: join(stateRoot, "ca.crt"),
  caKey: join(stateRoot, "ca.key"),
  cert: join(stateRoot, "edge.crt"),
  certKey: join(stateRoot, "edge.key"),
  csr: join(stateRoot, "edge.csr"),
  extensions: join(stateRoot, "edge.ext"),
  grafanaIni: join(stateRoot, "grafana.ini"),
  grafanaSecret: join(stateRoot, "grafana-client-secret"),
  inferenceEnvironment: join(stateRoot, "inference.env"),
  keycloakEnvironment: join(stateRoot, "keycloak.env"),
  liteLlmEnvironment: join(stateRoot, "litellm.env"),
  nginx: join(stateRoot, "nginx.conf"),
  postgresEnvironment: join(stateRoot, "postgres.env"),
  realm: join(stateRoot, "realm.json"),
}
let browser
let failure
let result

try {
  await chmod(stateRoot, 0o700)
  await assertPreflight()
  await writeRuntimeFiles()
  docker([
    "network",
    "create",
    "--label",
    `com.llm-machines.test-package=${packageLabel}`,
    network,
  ])
  docker([
    "volume",
    "create",
    "--label",
    `com.llm-machines.test-package=${packageLabel}`,
    volume,
  ])
  startKeycloak()
  await waitForHttp(
    `http://127.0.0.1:${ports.keycloak}/realms/llm-machines/.well-known/openid-configuration`,
  )
  await Promise.all([
    verifyFixturePassword("admin", secrets.adminPassword),
    verifyFixturePassword("operator", secrets.operatorPassword),
  ])
  let commissioning = null
  if (!validationScope.startsWith("keycloak-")) {
    startPostgres()
    startInference()
    await configureGrafanaClientScope()
    startLiteLlm()
    startGrafana()
    await Promise.all([
      waitForHttp(`http://127.0.0.1:${ports.litellm}/health/liveliness`),
      waitForHttp(`http://127.0.0.1:${ports.grafana}/api/health`),
    ])
    commissioning = await proveLiteLlmCommissioning()
  }
  startFixture()
  startEdge()
  await waitForEdge()
  browser = await chromium.launch({
    executablePath: browserExecutable(),
    headless: true,
    args: [
      "--disable-background-networking",
      "--host-resolver-rules=MAP *.f0n7.llmm.test 127.0.0.1",
      `--ignore-certificate-errors-spki-list=${certificateSpki()}`,
      "--no-first-run",
      "--no-sandbox",
    ],
  })
  if (validationScope.startsWith("keycloak-")) {
    result = {
      schema:
        validationScope === "keycloak-session-id"
          ? "llm-machines.f0-n5u-keycloak-session-identifier-runtime-observation.v1"
          : "llm-machines.f0-n7-keycloak-admin-runtime-observation.v1",
      status: "PASS",
      browser: await browser.version(),
      authorities: { identity: hosts.identity, keycloak: hosts.keycloak },
      keycloak: await proveKeycloak(validationScope === "keycloak-session-id"),
      credentialsRecorded: false,
      runtimeQualified: false,
    }
  } else {
    const grafana = await proveGrafana()
    if (validationScope === "grafana-oauth") {
      const unapprovedQuery = await edgeRequest(
        hosts.grafana,
        "/login/generic_oauth?redirect_uri=https%3A%2F%2Fattacker.invalid",
      )
      assert.equal(unapprovedQuery.status, 400)
      result = {
        schema: "llm-machines.f0-n5s-grafana-oauth-runtime-observation.v1",
        status: "PASS",
        browser: await browser.version(),
        authorities: { grafana: hosts.grafana, identity: hosts.identity },
        grafana,
        oauthInitiationWithoutQuery: "PASS",
        oauthCallbackWithExactKeys: "PASS",
        unapprovedQueryStatus: unapprovedQuery.status,
        credentialsRecorded: false,
        runtimeQualified: false,
      }
    } else {
      const liteLlm = await proveLiteLlm()
      if (validationScope === "litellm-oauth") {
        result = {
          schema: "llm-machines.f0-n7-litellm-oauth-runtime-observation.v1",
          status: "PASS",
          browser: await browser.version(),
          authorities: { identity: hosts.identity, litellm: hosts.litellm },
          liteLlm,
          credentialsRecorded: false,
          runtimeQualified: false,
        }
      } else {
        const keycloak = await proveKeycloak()
        const noBypass = await proveNoBypass()
        const outageAndRestart = await proveOutageAndRestart()
        const retention = await proveRetention()
        result = {
          schema: "llm-machines.f0-n7-native-runtime-observation.v1",
          status: "PASS",
          browser: await browser.version(),
          authorities: hosts,
          grafana,
          liteLlm,
          commissioning,
          keycloak,
          noBypass,
          outageAndRestart,
          retention,
          credentialsRecorded: false,
          runtimeQualified: false,
        }
      }
    }
  }
  const serializedEvidence = `${JSON.stringify(result, null, 2)}\n`
  assertSensitiveValuesAbsent(serializedEvidence)
  await writeFile(evidenceFile, serializedEvidence, {
    mode: 0o600,
  })
  await chmod(evidenceFile, 0o600)
} catch (error) {
  failure = error
} finally {
  await browser?.close().catch(() => undefined)
  if (!(failure && preserveFailureResources))
    await cleanup().catch((error) => {
      failure = failure
        ? new AggregateError(
            [failure, error],
            "F0-N7 runtime and cleanup failed",
          )
        : error
    })
}

if (failure) throw failure
assert.equal(existsSync(stateRoot), false)
process.stdout.write(
  `${JSON.stringify({ cleanup: "PASS", evidenceFile, status: result.status })}\n`,
)

async function assertPreflight() {
  assert.equal(process.platform, "linux")
  assert.equal(process.arch, "x64")
  const edgeTemplate = await readFile(
    resolve(repositoryRoot, "infra/ingress/product-edge.nginx.conf.template"),
    "utf8",
  )
  assert.match(
    edgeTemplate,
    /proxy_cookie_flags ~\^\(\?:litellm_cp_return_to\|litellm_oauth_state\|sso_state\)\$ secure httponly samesite=lax;/,
  )
  await reserveExactPorts(Object.values(ports))
  assert.doesNotMatch(
    docker(["ps", "--format", "{{.Ports}}"]),
    /(?:0\.0\.0\.0|127\.0\.0\.1|\[::\]):443->/,
    "Host port 443 is already published by another container.",
  )
  for (const image of Object.values(images)) docker(["image", "inspect", image])
  const liteLlm = JSON.parse(docker(["image", "inspect", images.litellm]))[0]
  assert.equal(liteLlm.Architecture, "amd64")
  assert.equal(
    liteLlm.Config?.Labels?.["org.opencontainers.image.version"],
    "v1.96.2-llmm.1",
  )
}

async function writeRuntimeFiles() {
  await Promise.all([
    copyFile(
      resolve(repositoryRoot, "infra/observability/grafana/grafana.ini"),
      paths.grafanaIni,
    ),
    writeFile(paths.grafanaSecret, `${secrets.grafanaClient}\n`, {
      mode: 0o444,
    }),
    writeFile(
      paths.postgresEnvironment,
      `POSTGRES_DB=litellm\nPOSTGRES_USER=litellm\nPOSTGRES_PASSWORD=${secrets.databasePassword}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      paths.inferenceEnvironment,
      `UPSTREAM_API_KEY=${secrets.upstreamKey}\nUPSTREAM_RESPONSE=${canaries.response}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      paths.keycloakEnvironment,
      `KC_BOOTSTRAP_ADMIN_USERNAME=bootstrap-admin\nKC_BOOTSTRAP_ADMIN_PASSWORD=${secrets.bootstrapPassword}\n`,
      { mode: 0o600 },
    ),
    writeFile(paths.realm, `${JSON.stringify(realmSeed(), null, 2)}\n`, {
      mode: 0o444,
    }),
  ])
  const config = Buffer.from(liteLlmConfig()).toString("base64")
  await writeFile(
    paths.liteLlmEnvironment,
    [
      `DATABASE_URL=postgresql://litellm:${secrets.databasePassword}@postgres:5432/litellm`,
      `GENERIC_AUTHORIZATION_ENDPOINT=${origins.identity}/realms/llm-machines/protocol/openid-connect/auth`,
      "GENERIC_CLIENT_ID=litellm-native",
      `GENERIC_CLIENT_SECRET=${secrets.liteLlmClient}`,
      "GENERIC_CLIENT_USE_PKCE=true",
      "GENERIC_INCLUDE_CLIENT_ID=true",
      "GENERIC_SCOPE=openid email profile",
      "GENERIC_TOKEN_ENDPOINT=http://keycloak:8080/realms/llm-machines/protocol/openid-connect/token",
      "GENERIC_USER_ID_ATTRIBUTE=sub",
      "GENERIC_USERINFO_ENDPOINT=http://keycloak:8080/realms/llm-machines/protocol/openid-connect/userinfo",
      "GENERIC_USER_ROLE_ATTRIBUTE=litellm_role",
      "AUTO_REDIRECT_UI_LOGIN_TO_SSO=false",
      "LITELLM_UI_SESSION_DURATION=8h",
      `LITELLM_CONFIG_B64=${config}`,
      `LITELLM_MASTER_KEY=${secrets.liteLlmMaster}`,
      `LITELLM_SALT_KEY=${secrets.liteLlmSalt}`,
      `PROXY_BASE_URL=${origins.litellm}`,
      `PROXY_LOGOUT_URL=${origins.litellm}/ui/login/`,
      `UPSTREAM_API_KEY=${secrets.upstreamKey}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  )
  await createCertificate()
  let nginx = await readFile(
    resolve(repositoryRoot, "infra/ingress/product-edge.nginx.conf.template"),
    "utf8",
  )
  const replacements = {
    "@@PRODUCT_API_HOST@@": hosts.api,
    "@@PRODUCT_CONSOLE_HOST@@": hosts.console,
    "@@PRODUCT_FIRECRAWL_HOST@@": hosts.firecrawl,
    "@@PRODUCT_GRAFANA_HOST@@": hosts.grafana,
    "@@PRODUCT_IDENTITY_HOST@@": hosts.identity,
    "@@PRODUCT_KEYCLOAK_ADMIN_HOST@@": hosts.keycloak,
    "@@PRODUCT_LITELLM_HOST@@": hosts.litellm,
  }
  for (const [placeholder, value] of Object.entries(replacements)) {
    nginx = nginx.replaceAll(placeholder, value)
  }
  assert.doesNotMatch(nginx, /@@[A-Z0-9_]+@@/)
  await writeFile(paths.nginx, nginx, { mode: 0o444 })
  await Promise.all([
    chmod(paths.grafanaSecret, 0o444),
    chmod(paths.nginx, 0o444),
    chmod(paths.realm, 0o444),
  ])
}

function startPostgres() {
  docker([
    "run",
    "--detach",
    "--name",
    containers.postgres,
    "--label",
    `com.llm-machines.test-package=${packageLabel}`,
    "--network",
    network,
    "--network-alias",
    "postgres",
    "--env-file",
    paths.postgresEnvironment,
    "--publish",
    `127.0.0.1:${ports.postgres}:5432`,
    "--tmpfs",
    "/var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=1g",
    images.postgres,
  ])
}

function startInference() {
  docker([
    "run",
    "--detach",
    "--name",
    containers.inference,
    "--label",
    `com.llm-machines.test-package=${packageLabel}`,
    "--network",
    network,
    "--network-alias",
    "inference-double",
    "--env-file",
    paths.inferenceEnvironment,
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=16m",
    "--log-driver",
    "none",
    "--entrypoint",
    "python",
    images.litellm,
    "-c",
    inferenceSource(),
  ])
}

function startKeycloak() {
  docker([
    "run",
    "--detach",
    "--name",
    containers.keycloak,
    "--label",
    `com.llm-machines.test-package=${packageLabel}`,
    "--network",
    network,
    "--network-alias",
    "keycloak",
    "--env-file",
    paths.keycloakEnvironment,
    "--publish",
    `127.0.0.1:${ports.keycloak}:8080`,
    "--mount",
    `type=bind,src=${paths.realm},dst=/opt/keycloak/data/import/realm.json,readonly`,
    "--mount",
    `type=bind,src=${resolve(repositoryRoot, "infra/keycloak/themes/llm-machines")},dst=/opt/keycloak/themes/llm-machines,readonly`,
    images.keycloak,
    "start-dev",
    "--import-realm",
    "--http-enabled=true",
    "--http-port=8080",
    `--hostname=${origins.identity}`,
    `--hostname-admin=${origins.keycloak}/keycloak`,
    "--hostname-strict=true",
    "--proxy-headers=xforwarded",
  ])
}

function startLiteLlm() {
  docker([
    "run",
    "--detach",
    "--name",
    containers.litellm,
    "--label",
    `com.llm-machines.test-package=${packageLabel}`,
    "--network",
    network,
    "--network-alias",
    "litellm",
    "--env-file",
    paths.liteLlmEnvironment,
    "--publish",
    `127.0.0.1:${ports.litellm}:4000`,
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=512m",
    "--entrypoint",
    "/bin/sh",
    images.litellm,
    "-c",
    'printf "%s" "$LITELLM_CONFIG_B64" | base64 -d > /tmp/config.yaml && exec litellm --config /tmp/config.yaml --host 0.0.0.0 --port 4000 --num_workers 1',
  ])
}

function startGrafana() {
  docker([
    "run",
    "--detach",
    "--name",
    containers.grafana,
    "--label",
    `com.llm-machines.test-package=${packageLabel}`,
    "--network",
    network,
    "--network-alias",
    "grafana",
    "--publish",
    `127.0.0.1:${ports.grafana}:3000`,
    "--mount",
    `type=bind,src=${paths.grafanaIni},dst=/etc/grafana/grafana.ini,readonly`,
    "--mount",
    `type=bind,src=${paths.grafanaSecret},dst=/run/secrets/llmm_grafana_oidc_client_secret,readonly`,
    "--mount",
    `type=volume,src=${volume},dst=/var/lib/grafana`,
    "--env",
    `GF_SERVER_ROOT_URL=${origins.grafana}/`,
    "--env",
    `GF_SERVER_DOMAIN=${hosts.grafana}`,
    "--env",
    `LLMM_KEYCLOAK_AUTH_URL=${origins.identity}/realms/llm-machines/protocol/openid-connect/auth`,
    "--env",
    "LLMM_KEYCLOAK_TOKEN_URL=http://keycloak:8080/realms/llm-machines/protocol/openid-connect/token",
    "--env",
    "LLMM_KEYCLOAK_USERINFO_URL=http://keycloak:8080/realms/llm-machines/protocol/openid-connect/userinfo",
    "--env",
    "LLMM_KEYCLOAK_JWKS_URL=http://keycloak:8080/realms/llm-machines/protocol/openid-connect/certs",
    "--env",
    `LLMM_GRAFANA_SIGNOUT_REDIRECT_URL=${origins.identity}/realms/llm-machines/protocol/openid-connect/logout?client_id=grafana&post_logout_redirect_uri=${encodeURIComponent(`${origins.grafana}/login`)}`,
    images.grafana,
  ])
}

function startFixture() {
  const keycloakOnlyAliases = validationScope.startsWith("keycloak-")
    ? ["--network-alias", "grafana", "--network-alias", "litellm"]
    : []
  docker([
    "run",
    "--detach",
    "--name",
    containers.fixture,
    "--label",
    `com.llm-machines.test-package=${packageLabel}`,
    "--network",
    network,
    "--network-alias",
    "console-web",
    "--network-alias",
    "console-bff",
    ...keycloakOnlyAliases,
    images.edge,
  ])
}

function startEdge() {
  const mounts = [
    [paths.nginx, "/etc/nginx/nginx.conf"],
    [paths.cert, "/run/secrets/llmm_edge_tls_certificate"],
    [paths.certKey, "/run/secrets/llmm_edge_tls_private_key"],
    ...[
      "proxy-common.inc",
      "request-headers-console-browser.inc",
      "request-headers-customer-api.inc",
      "request-headers-grafana-browser.inc",
      "request-headers-identity-browser.inc",
      "request-headers-keycloak-admin-browser.inc",
      "request-headers-litellm-browser.inc",
      "request-safety.inc",
    ].map((name) => [
      resolve(repositoryRoot, "infra/ingress", name),
      `/etc/nginx/llm-machines/${name}`,
    ]),
  ]
  const mountArguments = mounts.flatMap(([source, target]) => [
    "--mount",
    `type=bind,src=${source},dst=${target},readonly`,
  ])
  docker([
    "run",
    "--detach",
    "--name",
    containers.edge,
    "--label",
    `com.llm-machines.test-package=${packageLabel}`,
    "--network",
    network,
    "--publish",
    "127.0.0.1:443:443",
    "--read-only",
    "--tmpfs",
    "/var/cache/nginx:rw,noexec,nosuid,nodev,size=16m",
    "--tmpfs",
    "/var/log/nginx:rw,noexec,nosuid,nodev,size=16m",
    "--tmpfs",
    "/var/run:rw,noexec,nosuid,nodev,size=4m",
    ...mountArguments,
    images.edge,
  ])
}

async function proveLiteLlmCommissioning() {
  const input = {
    baseUrl: `http://127.0.0.1:${ports.litellm}`,
    masterKey: secrets.liteLlmMaster,
    users: nativeUsers(),
  }
  const first = await commissionLiteLlmNativeUsers(input)
  assert.deepEqual(first, {
    created: 2,
    credentialMaterialReturned: false,
    immutableUserIdClaim: "sub",
    unchanged: 0,
    updated: 0,
    users: 2,
  })
  const repeated = await commissionLiteLlmNativeUsers(input)
  assert.deepEqual(repeated, {
    created: 0,
    credentialMaterialReturned: false,
    immutableUserIdClaim: "sub",
    unchanged: 2,
    updated: 0,
    users: 2,
  })
  return { first, repeated }
}

function nativeUsers() {
  return [
    {
      email: "f0-n7-admin@example.com",
      productRole: "Admin",
      subject: identities.admin,
    },
    {
      email: "f0-n7-operator@example.com",
      productRole: "Operator",
      subject: identities.operator,
    },
  ]
}

async function proveGrafana() {
  const admin = await browserLogin(
    `${origins.grafana}/login/generic_oauth`,
    secrets.adminPassword,
  )
  const user = await browserJson(admin.page, "/api/user")
  const orgs = await browserJson(admin.page, "/api/user/orgs")
  assert.equal(
    user.status,
    200,
    JSON.stringify({
      cookieNames: (await admin.context.cookies()).map(({ name }) => name),
      finalUrl: safeUrl(admin.page.url()),
      pkce: admin.pkce,
      requests: admin.requests.slice(-24),
    }),
  )
  assert.equal(user.body?.isGrafanaAdmin, false)
  assert.equal(orgs.body?.[0]?.role, "Editor")
  const created = await browserJson(admin.page, "/api/dashboards/db", {
    method: "POST",
    body: {
      dashboard: { id: null, panels: [], title: `F0-N7 ${runId}` },
      overwrite: false,
    },
  })
  assert.equal(created.status, 200)
  assert.match(created.body?.uid ?? "", /^[A-Za-z0-9_-]+$/)
  const datasource = await browserJson(admin.page, "/api/datasources", {
    method: "POST",
    body: { name: "blocked", type: "prometheus", url: "http://127.0.0.1" },
  })
  assert.ok([403, 404].includes(datasource.status))
  const cookieHeader = (await admin.context.cookies(origins.grafana))
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ")
  const crossOrigin = await edgeRequest(hosts.grafana, "/api/dashboards/db", {
    body: {
      dashboard: {
        id: null,
        panels: [],
        title: `blocked-cross-origin-${runId}`,
      },
      overwrite: false,
    },
    headers: {
      cookie: cookieHeader,
      origin: "https://attacker.example.invalid",
    },
    method: "POST",
  })
  assert.equal(crossOrigin.status, 403)
  const removed = await browserJson(
    admin.page,
    `/api/dashboards/uid/${created.body.uid}`,
    { method: "DELETE" },
  )
  assert.equal(removed.status, 200)
  const cookies = (await admin.context.cookies()).map(cookieMetadata)
  for (const name of ["grafana_session", "grafana_session_expiry"])
    assert.ok(cookies.some((cookie) => cookie.name === name))
  docker(["restart", containers.grafana])
  await waitForHttp(`http://127.0.0.1:${ports.grafana}/api/health`)
  const afterRestart = await browserJson(admin.page, "/api/user")
  assert.equal(afterRestart.status, 200)
  assert.equal(afterRestart.body?.isGrafanaAdmin, false)
  const operator = await browserLogin(
    `${origins.grafana}/login/generic_oauth`,
    secrets.operatorPassword,
    true,
  )
  assert.equal(operator.denied, true)
  assert.equal(
    (await operator.context.cookies()).some(
      ({ name }) => name === "grafana_session",
    ),
    false,
  )
  await operator.context.close()
  const logout = await logoutGrafana(admin)
  return {
    admin: "Editor",
    authorizationCode: true,
    cookies,
    crossOriginMutation: crossOrigin.status,
    logout,
    operator: "DENY",
    pkceS256: admin.pkce,
    restartPersistence: "PASS",
    serverAdministrator: false,
    datasourceMutation: datasource.status,
  }
}

async function proveLiteLlm() {
  const admin = await browserLogin(
    `${origins.litellm}/sso/key/generate`,
    secrets.adminPassword,
  )
  const operator = await browserLogin(
    `${origins.litellm}/sso/key/generate`,
    secrets.operatorPassword,
  )
  const adminToken = await tokenCookie(admin)
  await settleLiteLlmSession(admin)
  const operatorToken = await tokenCookie(operator)
  await settleLiteLlmSession(operator)
  const adminClaims = nativeLiteLlmClaims(adminToken)
  const operatorClaims = nativeLiteLlmClaims(operatorToken)
  assert.equal(adminClaims.user_role, "proxy_admin")
  assert.equal(operatorClaims.user_role, "internal_user")
  assert.equal(adminClaims.user_id, identities.admin)
  assert.equal(operatorClaims.user_id, identities.operator)
  const directAdmin = await directLiteLlmJson("/user/info", adminClaims.key)
  const edgeAdmin = await edgeJson(hosts.litellm, "/user/info", {
    bearer: adminClaims.key,
  })
  assert.equal(directAdmin.status, 200)
  assert.equal(
    edgeAdmin.status,
    200,
    JSON.stringify({
      directStatus: directAdmin.status,
      edgeError: safeErrorBody(edgeAdmin.body),
      edgeStatus: edgeAdmin.status,
    }),
  )
  const adminKey = await edgeJson(hosts.litellm, "/key/generate", {
    bearer: adminClaims.key,
    body: { key_alias: `f0-n7-admin-${runId}`, models: ["fixture-model"] },
    method: "POST",
  })
  const operatorKey = await edgeJson(hosts.litellm, "/key/generate", {
    bearer: operatorClaims.key,
    body: { key_alias: `f0-n7-operator-${runId}`, models: ["fixture-model"] },
    method: "POST",
  })
  assert.equal(adminKey.status, 200)
  assert.equal(operatorKey.status, 200)
  assert.equal(operatorKey.body?.user_id, identities.operator)
  const ownList = await edgeJson(
    hosts.litellm,
    `/key/list?user_id=${encodeURIComponent(identities.operator)}&return_full_object=true&include_created_by_keys=true`,
    { bearer: operatorClaims.key },
  )
  assert.equal(ownList.status, 200)
  assert.match(
    JSON.stringify(ownList.body),
    new RegExp(`f0-n7-operator-${runId}`),
  )
  assert.doesNotMatch(
    JSON.stringify(ownList.body),
    new RegExp(`f0-n7-admin-${runId}`),
  )
  const crossDelete = await edgeJson(hosts.litellm, "/key/delete", {
    bearer: operatorClaims.key,
    body: { keys: [adminKey.body.key] },
    method: "POST",
  })
  assert.ok([401, 403].includes(crossDelete.status))
  const crossInfo = await edgeJson(hosts.litellm, "/v2/key/info", {
    bearer: operatorClaims.key,
    body: { keys: [adminKey.body.key] },
    method: "POST",
  })
  assert.equal(crossInfo.status, 200)
  assert.deepEqual(crossInfo.body?.info, [])
  for (const [path, body] of [
    [
      "/model/new",
      { model_name: "blocked", litellm_params: { model: "openai/blocked" } },
    ],
    ["/team/new", { team_alias: "blocked" }],
    ["/organization/new", { organization_alias: "blocked" }],
    [
      "/user/new",
      { user_email: "blocked@example.invalid", user_role: "internal_user" },
    ],
    ["/config/update", { general_settings: {} }],
    [
      "/key/generate",
      { key_alias: "blocked-cross-user", user_id: identities.admin },
    ],
  ]) {
    const denied = await edgeJson(hosts.litellm, path, {
      bearer: operatorClaims.key,
      body,
      method: "POST",
    })
    assert.ok([401, 403].includes(denied.status), `${path} was not denied`)
  }
  const retiredMcp = await edgeJson(hosts.litellm, "/v1/mcp/server", {
    bearer: operatorClaims.key,
    body: { server_name: "blocked", url: "http://127.0.0.1" },
    method: "POST",
  })
  assert.equal(retiredMcp.status, 404)
  const completion = await edgeJson(hosts.litellm, "/v1/chat/completions", {
    bearer: operatorKey.body.key,
    body: {
      model: "fixture-model",
      messages: [{ role: "user", content: canaries.prompt }],
    },
    method: "POST",
  })
  assert.equal(completion.status, 200)
  assert.equal(
    completion.body?.choices?.[0]?.message?.content,
    canaries.response,
  )
  const stream = await edgeText(hosts.litellm, "/v1/chat/completions", {
    bearer: operatorKey.body.key,
    body: {
      model: "fixture-model",
      stream: true,
      messages: [{ role: "user", content: canaries.stream }],
    },
    method: "POST",
  })
  assert.equal(stream.status, 200)
  assert.match(stream.body, /data: \[DONE\]/)
  const ownSpend = await edgeJson(hosts.litellm, "/user/info", {
    bearer: operatorClaims.key,
  })
  assert.equal(ownSpend.status, 200)
  assert.equal(ownSpend.body?.user_info?.user_role, "internal_user")
  docker(["restart", containers.litellm])
  await waitForHttp(`http://127.0.0.1:${ports.litellm}/health/liveliness`)
  const postRestartCommissioning = await commissionLiteLlmNativeUsers({
    baseUrl: `http://127.0.0.1:${ports.litellm}`,
    masterKey: secrets.liteLlmMaster,
    users: nativeUsers(),
  })
  assert.equal(postRestartCommissioning.created, 0)
  assert.equal(postRestartCommissioning.updated, 0)
  assert.equal(postRestartCommissioning.unchanged, 2)
  const ownSpendAfterRestart = await edgeJson(hosts.litellm, "/user/info", {
    bearer: operatorClaims.key,
  })
  assert.equal(ownSpendAfterRestart.status, 200)
  const crossOriginPreflight = await edgeRequest(
    hosts.litellm,
    "/key/generate",
    {
      headers: {
        "access-control-request-headers": "authorization,content-type",
        "access-control-request-method": "POST",
        origin: "https://attacker.example.invalid",
      },
      method: "OPTIONS",
    },
  )
  assert.ok([403, 405].includes(crossOriginPreflight.status))
  const operatorDelete = await edgeJson(hosts.litellm, "/key/delete", {
    bearer: operatorClaims.key,
    body: { keys: [operatorKey.body.key] },
    method: "POST",
  })
  assert.equal(operatorDelete.status, 200)
  const revoked = await edgeJson(hosts.litellm, "/v1/chat/completions", {
    bearer: operatorKey.body.key,
    body: {
      model: "fixture-model",
      messages: [{ role: "user", content: "revoked-key-check" }],
    },
    method: "POST",
  })
  assert.equal(revoked.status, 401)
  const adminDelete = await edgeJson(hosts.litellm, "/key/delete", {
    bearer: adminClaims.key,
    body: { keys: [adminKey.body.key] },
    method: "POST",
  })
  assert.equal(adminDelete.status, 200)
  const cookies = {
    Admin: assertLiteLlmCookieSecurity(admin.nativeCookies),
    Operator: assertLiteLlmCookieSecurity(operator.nativeCookies),
  }
  await Promise.all([logoutLiteLlm(admin), logoutLiteLlm(operator)])
  return {
    admin: "proxy_admin",
    authorizationCode: true,
    conditionalReturnToCookie:
      "POLICY_BOUND_NOT_EMITTED_BY_APPROVED_QUERY_FREE_ENTRY",
    cookies,
    logout: "NATIVE_SESSION_CLEARED",
    operator: "internal_user",
    ownKeysAndSpendOnly: true,
    pkceS256: admin.pkce && operator.pkce,
    restartPersistence: "PASS",
    revokedVirtualKey: 401,
    routing: "PASS",
    crossOriginPreflight: crossOriginPreflight.status,
  }
}

async function proveKeycloak(sessionIdentifierOnly = false) {
  const admin = await browserLogin(
    `${origins.keycloak}/keycloak/admin/llm-machines/console/`,
    secrets.adminPassword,
  )
  await admin.page.waitForTimeout(3_000)
  const adminRequests = admin.requests.filter(({ path }) =>
    path.startsWith("/keycloak/admin/"),
  )
  assert.ok(
    adminRequests.some(
      ({ path, status }) =>
        path.includes("/realms/llm-machines") && status === 200,
    ),
  )
  const operator = await browserLogin(
    `${origins.keycloak}/keycloak/admin/llm-machines/console/`,
    secrets.operatorPassword,
    true,
  )
  assert.equal(operator.denied, true)
  const bearer = admin.bearer
  assert.match(bearer ?? "", /^eyJ/)
  const bearerClaims = nativeBearerClaims(bearer)
  assert.equal(bearerClaims.azp, "security-admin-console")
  const users = await edgeJson(
    hosts.keycloak,
    "/keycloak/admin/realms/llm-machines/users?max=10",
    { bearer },
  )
  assert.equal(users.status, 200)
  const target = users.body.find(({ username }) => username === "operator")
  assert.match(target?.id ?? "", /^[0-9a-f-]{36}$/)
  assert.equal(target.id, identities.operator)
  const created = await edgeRequest(
    hosts.keycloak,
    "/keycloak/admin/realms/llm-machines/users",
    {
      bearer,
      body: {
        email: `f0-n7-managed-${runId}@example.com`,
        enabled: true,
        username: `f0-n7-managed-${runId}`,
      },
      method: "POST",
    },
  )
  assert.equal(created.status, 201)
  const createdLocation = new URL(created.headers.location, origins.keycloak)
  const createdUserId = createdLocation.pathname.split("/").at(-1)
  assert.match(createdUserId ?? "", /^[0-9a-f-]{36}$/)
  const update = await edgeJson(
    hosts.keycloak,
    `/keycloak/admin/realms/llm-machines/users/${createdUserId}`,
    {
      bearer,
      body: { enabled: true, firstName: "Managed", lastName: "Fixture" },
      method: "PUT",
    },
  )
  assert.equal(update.status, 204)
  const passwordReset = await edgeJson(
    hosts.keycloak,
    `/keycloak/admin/realms/llm-machines/users/${createdUserId}/reset-password`,
    {
      bearer,
      body: { temporary: true, type: "password", value: opaque() },
      method: "PUT",
    },
  )
  assert.equal(passwordReset.status, 204)
  const subjectBinding = await proveKeycloakSubjectBinding()
  const operatorSessions = await edgeJson(
    hosts.keycloak,
    `/keycloak/admin/realms/llm-machines/users/${target.id}/sessions`,
    { bearer },
  )
  assert.equal(operatorSessions.status, 200)
  const sessionIdentifierDenials = []
  for (const sessionId of [
    "A".repeat(23),
    "A".repeat(25),
    "00000000-0000-4000-8000-000000000000",
    `${"A".repeat(23)}.`,
    `${"A".repeat(24)}%2fescape`,
  ]) {
    const denied = await edgeRequest(
      hosts.keycloak,
      `/keycloak/admin/realms/llm-machines/sessions/${sessionId}`,
      { bearer, method: "DELETE" },
    )
    assert.ok([400, 404].includes(denied.status))
    sessionIdentifierDenials.push(denied.status)
  }
  const wrongMethod = await edgeRequest(
    hosts.keycloak,
    `/keycloak/admin/realms/llm-machines/sessions/${"A".repeat(24)}`,
    { bearer, method: "GET" },
  )
  assert.equal(wrongMethod.status, 403)
  let invalidatedSessions = 0
  for (const session of operatorSessions.body ?? []) {
    assert.match(session.id ?? "", /^[A-Za-z0-9_-]{24}$/)
    const invalidation = await edgeJson(
      hosts.keycloak,
      `/keycloak/admin/realms/llm-machines/sessions/${session.id}`,
      { bearer, method: "DELETE" },
    )
    assert.equal(invalidation.status, 204)
    invalidatedSessions += 1
  }
  const deletion = await edgeJson(
    hosts.keycloak,
    `/keycloak/admin/realms/llm-machines/users/${target.id}`,
    { bearer, method: "DELETE" },
  )
  assert.equal(deletion.status, 403)
  if (sessionIdentifierOnly) {
    await admin.context.close()
    await operator.context.close()
    return {
      admin: "APPLIANCE_REALM_USER_ADMIN",
      managedUserCreateUpdatePasswordReset: "PASS",
      operator: "DENY",
      sessionIdentifierContract: "BASE64URL_24",
      sessionIdentifierDenials,
      sessionInvalidationWrongMethod: wrongMethod.status,
      sessionsInvalidated: invalidatedSessions,
      subjectBinding,
      userDelete: deletion.status,
    }
  }
  for (const path of [
    "/keycloak/admin/realms/master",
    "/keycloak/admin/realms/unrelated",
    "/keycloak/admin/realms/llm-machines/clients",
    "/keycloak/admin/realms/llm-machines/identity-provider/instances",
  ]) {
    const denied = await edgeJson(hosts.keycloak, path, { bearer })
    assert.ok([403, 404].includes(denied.status), `${path} was not denied`)
  }
  const serverInfo = await edgeJson(
    hosts.keycloak,
    "/keycloak/admin/serverinfo",
    { bearer },
  )
  assert.ok([200, 403].includes(serverInfo.status))
  const serverInfoMutation = await edgeJson(
    hosts.keycloak,
    "/keycloak/admin/serverinfo",
    { bearer, body: {}, method: "POST" },
  )
  assert.equal(serverInfoMutation.status, 403)
  const realmCreation = await edgeJson(
    hosts.keycloak,
    "/keycloak/admin/realms",
    {
      bearer,
      body: { realm: "blocked" },
      method: "POST",
    },
  )
  assert.equal(realmCreation.status, 404)
  const crossOriginPreflight = await edgeRequest(
    hosts.keycloak,
    "/keycloak/admin/realms/llm-machines/users",
    {
      headers: {
        "access-control-request-headers": "authorization,content-type",
        "access-control-request-method": "POST",
        origin: "https://attacker.example.invalid",
      },
      method: "OPTIONS",
    },
  )
  assert.ok([403, 405].includes(crossOriginPreflight.status))
  docker(["restart", containers.keycloak])
  await waitForHttp(
    `http://127.0.0.1:${ports.keycloak}/realms/llm-machines/.well-known/openid-configuration`,
  )
  const usersAfterRestart = await edgeJson(
    hosts.keycloak,
    "/keycloak/admin/realms/llm-machines/users?max=10",
    { bearer },
  )
  assert.equal(usersAfterRestart.status, 200)
  const cookies = (await admin.context.cookies()).map(cookieMetadata)
  await operator.context.close()
  const logout = await logoutKeycloak(admin)
  return {
    admin: "APPLIANCE_REALM_USER_ADMIN",
    authorizationCode: true,
    cookies,
    crossOriginPreflight: crossOriginPreflight.status,
    logout,
    managedUserCreateUpdatePasswordReset: "PASS",
    operator: "DENY",
    pkceS256: admin.pkce,
    restartPersistence: "PASS",
    sessionsInvalidated: invalidatedSessions,
    sessionIdentifierDenials,
    sessionInvalidationWrongMethod: wrongMethod.status,
    serverInfoRead: serverInfo.status,
    serverInfoMutation: serverInfoMutation.status,
    subjectBinding,
    userDelete: 403,
    masterAndUnrelatedRealm: "DENY",
  }
}

async function proveNoBypass() {
  const denied = []
  for (const [host, path] of [
    [hosts.grafana, "/../api/user"],
    [hosts.litellm, "/v1/agents"],
    [hosts.keycloak, "/keycloak/admin/master/console/"],
  ]) {
    const response = await edgeRequest(host, path)
    assert.ok([400, 404, 421].includes(response.status))
    denied.push(`${host}${path}`)
  }
  const alternateHost = await edgeRequest(hosts.grafana, "/", {
    requestHost: "portainer.f0n7.llmm.test",
  })
  assert.equal(alternateHost.status, 421)
  await assert.rejects(() =>
    edgeRequest("portainer.f0n7.llmm.test", "/", {
      requestHost: "portainer.f0n7.llmm.test",
    }),
  )
  for (const host of [hosts.grafana, hosts.litellm, hosts.keycloak]) {
    const baseline = await edgeRequest(host, "/")
    const spoofed = await edgeRequest(host, "/", {
      headers: {
        "x-forwarded-host": "attacker.invalid",
        "x-forwarded-proto": "http",
      },
    })
    assert.equal(spoofed.status, baseline.status)
    assert.doesNotMatch(spoofed.body, /attacker\.invalid/)
    assert.doesNotMatch(spoofed.headers.location ?? "", /attacker\.invalid/)
    const consoleCookie = await edgeRequest(host, "/", {
      headers: { cookie: "__Host-llm-machines-session=not-a-session" },
    })
    assert.equal(consoleCookie.status, 400)
    const productCredential = await edgeRequest(host, "/", {
      headers: { authorization: "Bearer llmm_t4_not-a-real-credential" },
    })
    assert.equal(productCredential.status, 400)
    const websocket = await edgeRequest(host, "/", {
      headers: { connection: "Upgrade", upgrade: "websocket" },
    })
    assert.equal(websocket.status, baseline.status)
    assert.notEqual(websocket.status, 101)
  }
  const unapprovedSse = await edgeRequest(hosts.litellm, "/v1/agents", {
    headers: { accept: "text/event-stream" },
  })
  assert.equal(unapprovedSse.status, 404)
  for (const [name, port] of Object.entries(ports)) {
    const bindings = docker([
      "port",
      containers[name] ?? containers.postgres,
    ]).trim()
    assert.match(bindings, /127\.0\.0\.1:/)
    assert.doesNotMatch(bindings, /0\.0\.0\.0:/)
    assert.ok(port > 0)
  }
  return {
    denied,
    alternateHostAndSni: "DENY",
    directPorts: "LOOPBACK_ONLY",
    productCredentialsAndConsoleCookies: "DENY",
    spoofedForwardingHeaders: "NORMALIZED_TO_EDGE_VALUES",
    unapprovedWebSocketAndSse: "DENY",
  }
}

async function proveOutageAndRestart() {
  for (const [name, health] of [
    ["grafana", `http://127.0.0.1:${ports.grafana}/api/health`],
    ["litellm", `http://127.0.0.1:${ports.litellm}/health/liveliness`],
    [
      "keycloak",
      `http://127.0.0.1:${ports.keycloak}/realms/llm-machines/.well-known/openid-configuration`,
    ],
  ]) {
    docker(["restart", containers[name]])
    await waitForHttp(health)
  }
  docker(["stop", containers.grafana])
  assert.equal((await edgeRequest(hosts.grafana, "/login")).status, 503)
  docker(["start", containers.grafana])
  await waitForHttp(`http://127.0.0.1:${ports.grafana}/api/health`)
  docker(["stop", containers.litellm])
  assert.equal((await edgeRequest(hosts.litellm, "/ui/")).status, 503)
  docker(["start", containers.litellm])
  await waitForHttp(`http://127.0.0.1:${ports.litellm}/health/liveliness`)
  docker(["stop", containers.keycloak])
  assert.equal(
    (await edgeRequest(hosts.keycloak, "/keycloak/admin/llm-machines/console/"))
      .status,
    503,
  )
  assert.equal(
    (
      await edgeRequest(
        hosts.identity,
        "/realms/llm-machines/protocol/openid-connect/auth?client_id=grafana&redirect_uri=https%3A%2F%2Fgrafana.f0n7.llmm.test%2Flogin%2Fgeneric_oauth&response_type=code&scope=openid&state=test&code_challenge=test&code_challenge_method=S256",
      )
    ).status,
    303,
  )
  docker(["start", containers.keycloak])
  await waitForHttp(
    `http://127.0.0.1:${ports.keycloak}/realms/llm-machines/.well-known/openid-configuration`,
  )
  return {
    restart: "PASS",
    grafanaOutage: 503,
    identityOutage: 303,
    keycloakAdminOutage: 503,
    liteLlmOutage: 503,
    fallbackAuthentication: false,
  }
}

async function proveRetention() {
  await delay(2_000)
  const dump = docker([
    "exec",
    containers.postgres,
    "pg_dump",
    "--data-only",
    "--no-owner",
    "--no-privileges",
    "--dbname",
    "litellm",
    "--username",
    "litellm",
  ])
  const logs = Object.values(containers)
    .map((container) => dockerResult(["logs", container]))
    .flatMap(({ stderr, stdout }) => [stderr, stdout])
  for (const value of [...Object.values(canaries), ...Object.values(secrets)]) {
    assert.doesNotMatch(dump, new RegExp(escapeRegex(value)))
    for (const log of logs)
      assert.doesNotMatch(log, new RegExp(escapeRegex(value)))
  }
  return {
    postgres: "METADATA_ONLY",
    logs: "WORKLOAD_AND_CREDENTIAL_VALUES_ABSENT",
    credentialValues: 0,
    workloadContentCanaries: 0,
  }
}

async function browserLogin(entry, password, expectDenied = false) {
  const entryOrigin = new URL(entry).origin
  const context = await browser.newContext()
  const page = await context.newPage()
  const requests = []
  const requestMethods = []
  const nativeCookies = []
  let bearer
  let pkce = false
  page.on("request", async (request) => {
    const url = new URL(request.url())
    requestMethods.push({ method: request.method(), path: url.pathname })
    const authorization = (await request.allHeaders().catch(() => null))
      ?.authorization
    if (authorization?.startsWith("Bearer eyJ")) {
      const candidate = authorization.slice(7)
      try {
        const claims = nativeBearerClaims(candidate)
        if (claims.azp === "security-admin-console") bearer = candidate
      } catch {}
    }
    if (url.pathname.endsWith("/protocol/openid-connect/auth")) {
      pkce ||= url.searchParams.get("code_challenge_method") === "S256"
    }
  })
  page.on("response", async (response) => {
    const url = new URL(response.url())
    requests.push({ path: url.pathname, status: response.status() })
    if (
      url.pathname.endsWith("/protocol/openid-connect/token") &&
      response.status() === 200
    ) {
      const payload = await response.json().catch(() => null)
      const candidate = payload?.access_token
      if (typeof candidate === "string" && candidate.startsWith("eyJ")) {
        const claims = nativeBearerClaims(candidate)
        if (claims.azp === "security-admin-console") bearer = candidate
      }
    }
  })
  await page.goto(entry, { waitUntil: "domcontentloaded" })
  await captureNativeCookieMetadata(context, entryOrigin, nativeCookies)
  const username = page.locator("#username")
  await username.waitFor({ state: "visible", timeout: nativeSessionTimeout })
  if (await username.isVisible()) {
    await page
      .locator("#username")
      .fill(password === secrets.adminPassword ? "admin" : "operator")
    await page.locator("#password").fill(password)
    const login = page.locator("#kc-login")
    const formAction = await page.locator("form").first().getAttribute("action")
    const loginDisabled = await login.isDisabled()
    assert.equal(loginDisabled, false)
    await page.locator("#password").press("Enter")
    await eventually(
      async () => {
        const currentOrigin = new URL(page.url()).origin
        const currentText = await page
          .locator("body")
          .innerText()
          .catch(() => "")
        return (
          currentOrigin === entryOrigin ||
          /do not have permission|access denied|failed to get user info|login failed|invalid username or password/i.test(
            currentText,
          )
        )
      },
      Math.min(nativeSessionTimeout, 30_000),
    ).catch((error) => {
      throw new Error(
        `Native login submission did not settle: ${JSON.stringify({
          formAction: formAction
            ? safeUrl(new URL(formAction, page.url()).href)
            : null,
          requestMethods: requestMethods.slice(-24),
        })}`,
        { cause: error },
      )
    })
  }
  await page.waitForTimeout(2_000)
  await captureNativeCookieMetadata(context, entryOrigin, nativeCookies)
  const text = await page
    .locator("body")
    .innerText()
    .catch(() => "")
  const denied =
    /do not have permission|access denied|failed to get user info|login failed/i.test(
      text,
    )
  if (expectDenied)
    assert.equal(denied, true, `Expected native denial at ${page.url()}`)
  else {
    assert.equal(
      denied,
      false,
      `Unexpected native denial at ${safeUrl(page.url())}`,
    )
    assert.equal(
      new URL(page.url()).origin,
      entryOrigin,
      `Native login did not return to its service: ${JSON.stringify({
        body: safe(text).slice(0, 1024),
        finalUrl: safeUrl(page.url()),
        requestMethods: requestMethods.slice(-24),
        requests: requests.slice(-24),
      })}`,
    )
    if (entryOrigin === origins.keycloak)
      await eventually(
        () => Promise.resolve(typeof bearer === "string"),
        nativeSessionTimeout,
      )
  }
  return { bearer, context, denied, nativeCookies, page, pkce, requests }
}

async function verifyFixturePassword(username, password) {
  const response = await fetch(
    `http://127.0.0.1:${ports.keycloak}/realms/llm-machines/protocol/openid-connect/token`,
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
}

function safeUrl(value) {
  const parsed = new URL(value)
  return `${parsed.origin}${parsed.pathname}`
}

async function browserJson(page, path, options = {}) {
  return page.evaluate(
    async ({ body, method, path }) => {
      const response = await fetch(path, {
        body: body ? JSON.stringify(body) : undefined,
        credentials: "same-origin",
        headers: body ? { "content-type": "application/json" } : undefined,
        method,
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

async function tokenCookie(session) {
  try {
    await eventually(
      async () =>
        (await session.context.cookies()).some(({ name }) => name === "token"),
      nativeSessionTimeout,
    )
  } catch (error) {
    throw new Error(
      `LiteLLM native session cookie was not established: ${JSON.stringify({
        cookieNames: (await session.context.cookies()).map(({ name }) => name),
        finalUrl: safeUrl(session.page.url()),
        requests: session.requests.slice(-24),
      })}`,
      { cause: error },
    )
  }
  const cookie = (await session.context.cookies()).find(
    ({ name }) => name === "token",
  )
  assert.ok(cookie)
  return decodeURIComponent(cookie.value)
}

async function settleLiteLlmSession(session) {
  await session.page.waitForURL(
    (url) => url.origin === origins.litellm && url.pathname.startsWith("/ui"),
    { timeout: nativeSessionTimeout },
  )
  await session.page.waitForLoadState("domcontentloaded")
}

async function logoutGrafana(session) {
  await session.page
    .goto(`${origins.grafana}/logout`, { waitUntil: "domcontentloaded" })
    .catch((error) => assert.match(error.message, /net::ERR_ABORTED/))
  await eventually(async () => {
    const cookies = await session.context.cookies()
    return !cookies.some(({ name }) => name === "grafana_session")
  }, 60_000)
  assert.equal(
    (await session.context.cookies()).some(
      ({ name }) => name === "grafana_session",
    ),
    false,
  )
  await session.context.close()
  return "NATIVE_SESSION_CLEARED_AND_KEYCLOAK_LOGOUT_REACHED"
}

async function logoutLiteLlm(session) {
  await session.page.goto(`${origins.litellm}/ui/`, {
    waitUntil: "domcontentloaded",
  })
  const navigation = session.page.getByRole("complementary")
  await navigation.getByText("Virtual Keys").waitFor({ timeout: 60_000 })
  const account = session.page.getByRole("button", { name: /Account menu/i })
  await account.waitFor({ timeout: 60_000 })
  await account.click()
  const popup = session.page.getByTestId("sidebar-account-menu-panel")
  await popup.waitFor({ timeout: 10_000 })
  await popup.getByRole("button", { name: "Logout" }).click()
  await eventually(async () => {
    const cookies = await session.context.cookies()
    return !cookies.some(({ name }) => name === "token")
  }, 60_000)
  await session.page.goto(`${origins.litellm}/ui/?page=llm-playground`, {
    waitUntil: "domcontentloaded",
  })
  await eventually(
    () => Promise.resolve(/\/ui\/login/.test(session.page.url())),
    60_000,
  )
  await session.context.close()
}

async function logoutKeycloak(session) {
  const accountMenu = session.page
    .getByRole("button", { name: /admin|user menu/i })
    .last()
  if ((await accountMenu.count()) > 0) {
    await accountMenu.click()
  }
  const nativeSignOut = session.page
    .getByText(/sign out/i, { exact: true })
    .last()
  if ((await nativeSignOut.count()) > 0) {
    await nativeSignOut.click()
  } else {
    await session.page.goto(
      `${origins.identity}/realms/llm-machines/protocol/openid-connect/logout?client_id=security-admin-console&post_logout_redirect_uri=${encodeURIComponent(`${origins.keycloak}/keycloak/admin/llm-machines/console/`)}`,
      { waitUntil: "domcontentloaded" },
    )
  }
  const confirmation = session.page
    .getByRole("button", { name: /sign out|logout/i })
    .last()
  if ((await confirmation.count()) > 0) {
    await confirmation.click()
  }
  await eventually(async () => {
    const cookies = await session.context.cookies()
    return !cookies.some(({ name }) =>
      ["KEYCLOAK_SESSION", "KEYCLOAK_IDENTITY"].includes(name),
    )
  }, 60_000)
  await session.context.close()
  return "NATIVE_SESSION_CLEARED"
}

function cookieMetadata({ domain, httpOnly, name, path, sameSite, secure }) {
  return { domain, httpOnly, name, path, sameSite, secure }
}

async function captureNativeCookieMetadata(context, origin, observations) {
  if (origin !== origins.litellm) return
  for (const cookie of await context.cookies(origin)) {
    const metadata = cookieMetadata(cookie)
    const prior = observations.find(({ name }) => name === metadata.name)
    if (prior) assert.deepEqual(metadata, prior)
    else observations.push(metadata)
  }
}

function assertLiteLlmCookieSecurity(observations) {
  const allowedNames = new Set([
    "litellm_cp_return_to",
    "litellm_oauth_state",
    "sso_state",
    "token",
  ])
  const emittedNames = observations.map(({ name }) => name).sort()
  assert.equal(
    emittedNames.every((name) => allowedNames.has(name)),
    true,
    `Unexpected LiteLLM native cookie: ${JSON.stringify(emittedNames)}`,
  )
  assert.deepEqual(emittedNames, ["litellm_oauth_state", "sso_state", "token"])
  for (const cookie of observations) {
    assert.equal(cookie.domain.replace(/^\./, ""), hosts.litellm)
    assert.equal(cookie.path, "/")
    assert.equal(cookie.secure, true)
    assert.equal(cookie.sameSite, "Lax")
    assert.equal(cookie.httpOnly, cookie.name !== "token")
  }
  return observations.toSorted(({ name: left }, { name: right }) =>
    left.localeCompare(right),
  )
}

function nativeLiteLlmClaims(token) {
  const parts = token.split(".")
  assert.equal(parts.length, 3)
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
  assert.match(claims.key ?? "", /^sk-/)
  return claims
}

function nativeBearerClaims(token) {
  const parts = token.split(".")
  assert.equal(parts.length, 3)
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
}

function edgeJson(host, path, options = {}) {
  return edgeRequest(host, path, options).then(async (response) => {
    let body = null
    try {
      body = JSON.parse(response.body)
    } catch {}
    return { body, status: response.status }
  })
}

function edgeText(host, path, options = {}) {
  return edgeRequest(host, path, options)
}

async function directLiteLlmJson(path, bearer) {
  const response = await fetch(`http://127.0.0.1:${ports.litellm}${path}`, {
    headers: { authorization: `Bearer ${bearer}` },
  })
  let body = null
  try {
    body = await response.json()
  } catch {}
  return { body, status: response.status }
}

function safeErrorBody(body) {
  if (!body || typeof body !== "object") return null
  return Object.fromEntries(
    ["detail", "error", "message"]
      .filter((key) => typeof body[key] === "string")
      .map((key) => [
        key,
        body[key]
          .replace(/eyJ[A-Za-z0-9_.-]+/g, "[redacted-jwt]")
          .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-key]")
          .slice(0, 512),
      ]),
  )
}

async function edgeRequest(
  host,
  path,
  {
    bearer,
    body,
    headers = {},
    method = "GET",
    requestHost = host,
    servername = host,
  } = {},
) {
  const ca = await readFile(paths.ca)
  const payload = body ? JSON.stringify(body) : null
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpsRequest(
      {
        ca,
        headers: {
          host: requestHost,
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(payload ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        host: "127.0.0.1",
        method,
        path,
        port: 443,
        rejectUnauthorized: true,
        servername,
      },
      (response) => {
        let responseBody = ""
        response.on("data", (chunk) => {
          responseBody += chunk
        })
        response.once("end", () =>
          resolveRequest({
            body: responseBody,
            headers: response.headers,
            status: response.statusCode ?? 500,
          }),
        )
      },
    )
    request.once("error", rejectRequest)
    if (payload) request.write(payload)
    request.end()
  })
}

function realmSeed() {
  return {
    realm: "llm-machines",
    enabled: true,
    loginTheme: "llm-machines",
    adminEventsEnabled: true,
    adminEventsDetailsEnabled: false,
    accessTokenLifespan: 300,
    ssoSessionIdleTimeout: 28_800,
    ssoSessionMaxLifespan: 86_400,
    revokeRefreshToken: true,
    refreshTokenMaxReuse: 0,
    roles: { realm: [{ name: "admin" }, { name: "operator" }] },
    clients: [
      oidcClient(
        "grafana",
        secrets.grafanaClient,
        `${origins.grafana}/login/generic_oauth`,
        "realm",
      ),
      oidcClient(
        "litellm-native",
        secrets.liteLlmClient,
        `${origins.litellm}/sso/callback`,
        "litellm",
      ),
    ],
    users: [
      {
        ...fixtureUser(
          identities.admin,
          "admin",
          secrets.adminPassword,
          "admin",
          "proxy_admin",
        ),
        clientRoles: {
          "realm-management": [
            "query-users",
            "query-groups",
            "view-users",
            "manage-users",
          ],
        },
      },
      fixtureUser(
        identities.operator,
        "operator",
        secrets.operatorPassword,
        "operator",
        "internal_user",
      ),
    ],
  }
}

function oidcClient(clientId, secret, redirect, mapper) {
  const protocolMappers =
    mapper === "realm"
      ? [
          {
            name: "realm-roles",
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
        ]
      : [
          {
            name: "LiteLLM role",
            protocol: "openid-connect",
            protocolMapper: "oidc-usermodel-attribute-mapper",
            config: {
              "access.token.claim": "true",
              "claim.name": "litellm_role",
              "id.token.claim": "true",
              "jsonType.label": "String",
              "userinfo.token.claim": "true",
              "user.attribute": "litellm_role",
            },
          },
        ]
  return {
    clientId,
    enabled: true,
    publicClient: false,
    secret,
    standardFlowEnabled: true,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false,
    fullScopeAllowed: false,
    redirectUris: [redirect],
    webOrigins: [new URL(redirect).origin],
    attributes: {
      "pkce.code.challenge.method": "S256",
      "post.logout.redirect.uris": `${new URL(redirect).origin}/*`,
    },
    protocolMappers,
  }
}

function fixtureUser(subject, username, password, role, liteLlmRole) {
  return {
    id: subject,
    username,
    enabled: true,
    email: `f0-n7-${username}@example.com`,
    emailVerified: true,
    firstName: username,
    lastName: "fixture",
    realmRoles: [role],
    attributes: { litellm_role: [liteLlmRole] },
    credentials: [{ type: "password", value: password, temporary: false }],
  }
}

async function configureGrafanaClientScope() {
  const base = `http://127.0.0.1:${ports.keycloak}`
  const token = await keycloakBootstrapToken()
  const headers = { authorization: `Bearer ${token}` }
  const clients = await fetch(
    `${base}/admin/realms/llm-machines/clients?clientId=grafana`,
    { headers },
  ).then((response) => response.json())
  assert.equal(clients.length, 1)
  const roles = []
  for (const role of ["admin", "operator"]) {
    const response = await fetch(
      `${base}/admin/realms/llm-machines/roles/${role}`,
      { headers },
    )
    assert.equal(response.status, 200)
    roles.push(await response.json())
  }
  const mapping = await fetch(
    `${base}/admin/realms/llm-machines/clients/${clients[0].id}/scope-mappings/realm`,
    {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(roles),
    },
  )
  assert.equal(mapping.status, 204)
}

async function keycloakBootstrapToken() {
  const tokenResponse = await fetch(
    `http://127.0.0.1:${ports.keycloak}/realms/master/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "admin-cli",
        grant_type: "password",
        password: secrets.bootstrapPassword,
        username: "bootstrap-admin",
      }),
    },
  )
  assert.equal(tokenResponse.status, 200)
  const token = (await tokenResponse.json()).access_token
  assert.ok(token)
  return token
}

async function proveKeycloakSubjectBinding() {
  const token = await keycloakBootstrapToken()
  const response = await fetch(
    `http://127.0.0.1:${ports.keycloak}/admin/realms/llm-machines/admin-events?max=100`,
    { headers: { authorization: `Bearer ${token}` } },
  )
  assert.equal(response.status, 200)
  const events = await response.json()
  const bound = events.filter(
    (event) => event.authDetails?.userId === identities.admin,
  )
  assert.ok(
    bound.some(
      (event) =>
        event.operationType === "CREATE" &&
        String(event.resourcePath).startsWith("users/"),
    ),
  )
  assert.ok(
    bound.some(
      (event) =>
        event.operationType === "UPDATE" &&
        String(event.resourcePath).startsWith("users/"),
    ),
  )
  assert.ok(bound.every((event) => event.representation === undefined))
  return {
    authenticatedUserIdMatched: true,
    createAndUpdateEventsBound: true,
    detailsRetained: false,
    mechanism: "KEYCLOAK_ADMIN_EVENT_AUTH_DETAILS_USER_ID",
  }
}

function liteLlmConfig() {
  return [
    "model_list:",
    "  - model_name: fixture-model",
    "    litellm_params:",
    "      model: openai/fixture-model",
    "      api_base: http://inference-double:4010/v1",
    "      api_key: os.environ/UPSTREAM_API_KEY",
    "      max_input_tokens: 8192",
    "      max_output_tokens: 1024",
    "litellm_settings:",
    "  disable_error_logs: true",
    "  disable_spend_logs: false",
    "  drop_params: true",
    "  log_raw_request_response: false",
    "  telemetry: false",
    "  turn_off_message_logging: true",
    "general_settings:",
    "  allow_requests_on_db_unavailable: false",
    "  master_key: os.environ/LITELLM_MASTER_KEY",
    "  store_model_in_db: true",
    "  store_prompts_in_spend_logs: false",
    "  enable_jwt_auth: false",
    "",
  ].join("\n")
}

function inferenceSource() {
  return `
import json, os
from http.server import BaseHTTPRequestHandler, HTTPServer
class Handler(BaseHTTPRequestHandler):
  def log_message(self, *args): pass
  def do_GET(self):
    if self.path == "/v1/models": self.reply({"object":"list","data":[{"id":"fixture-model","object":"model"}]})
    else: self.send_error(404)
  def do_POST(self):
    if self.path != "/v1/chat/completions": self.send_error(404); return
    length = int(self.headers.get("content-length", "0")); body = json.loads(self.rfile.read(length))
    if body.get("stream"):
      payload = "data: " + json.dumps({"id":"chatcmpl-f0n7","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":os.environ["UPSTREAM_RESPONSE"]},"finish_reason":None}]}) + "\\n\\ndata: [DONE]\\n\\n"
      self.send_response(200); self.send_header("content-type","text/event-stream"); self.end_headers(); self.wfile.write(payload.encode()); return
    self.reply({"id":"chatcmpl-f0n7","object":"chat.completion","model":"fixture-model","choices":[{"index":0,"message":{"role":"assistant","content":os.environ["UPSTREAM_RESPONSE"]},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}})
  def reply(self, value):
    data=json.dumps(value).encode(); self.send_response(200); self.send_header("content-type","application/json"); self.send_header("content-length",str(len(data))); self.end_headers(); self.wfile.write(data)
HTTPServer(("0.0.0.0",4010), Handler).serve_forever()
`
}

async function createCertificate() {
  exec("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=LLM Machines F0-N7 CA",
    "-keyout",
    paths.caKey,
    "-out",
    paths.ca,
  ])
  exec("openssl", [
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-subj",
    `/CN=${hosts.console}`,
    "-keyout",
    paths.certKey,
    "-out",
    paths.csr,
  ])
  const sans = Object.values(hosts)
    .map((host, index) => `DNS.${index + 1}=${host}`)
    .join("\n")
  await writeFile(
    paths.extensions,
    `subjectAltName=@alt_names\nextendedKeyUsage=serverAuth\n[alt_names]\n${sans}\n`,
    { mode: 0o600 },
  )
  exec("openssl", [
    "x509",
    "-req",
    "-in",
    paths.csr,
    "-CA",
    paths.ca,
    "-CAkey",
    paths.caKey,
    "-CAcreateserial",
    "-days",
    "1",
    "-extfile",
    paths.extensions,
    "-out",
    paths.cert,
  ])
  await Promise.all([chmod(paths.caKey, 0o600), chmod(paths.certKey, 0o600)])
}

function certificateSpki() {
  const pubkey = execFileSync("openssl", [
    "x509",
    "-in",
    paths.cert,
    "-pubkey",
    "-noout",
  ])
  const der = execFileSync("openssl", ["pkey", "-pubin", "-outform", "DER"], {
    input: pubkey,
  })
  return createHash("sha256").update(der).digest("base64")
}

async function waitForEdge() {
  const [host, path] = validationScope.startsWith("keycloak-")
    ? [hosts.keycloak, "/keycloak/admin/llm-machines/console/"]
    : [hosts.grafana, "/login"]
  await eventually(
    async () =>
      (await edgeRequest(host, path).catch(() => null))?.status === 200,
    60_000,
  )
}

async function waitForHttp(url) {
  await eventually(async () => {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(2_000),
    }).catch(() => null)
    return response?.status && response.status < 500
  }, 300_000)
}

async function reserveExactPorts(values) {
  const servers = []
  try {
    for (const port of values) {
      const server = createServer()
      await new Promise((resolveListen, rejectListen) => {
        server.once("error", rejectListen)
        server.listen(port, "127.0.0.1", resolveListen)
      })
      servers.push(server)
    }
  } finally {
    await Promise.all(
      servers.map(
        (server) => new Promise((resolveClose) => server.close(resolveClose)),
      ),
    )
  }
}

async function eventually(check, timeout) {
  const deadline = performance.now() + timeout
  while (performance.now() < deadline) {
    if (await check()) return
    await delay(250)
  }
  throw new Error(`F0-N7 condition did not pass within ${timeout}ms`)
}

async function cleanup() {
  for (const container of Object.values(containers))
    docker(["rm", "--force", container], { allowFailure: true })
  docker(["network", "rm", network], { allowFailure: true })
  docker(["volume", "rm", volume], { allowFailure: true })
  await rm(stateRoot, { force: true, recursive: true })
  const remaining = docker([
    "ps",
    "--all",
    "--quiet",
    "--filter",
    `label=com.llm-machines.test-package=${packageLabel}`,
  ])
  assert.equal(remaining.trim(), "")
}

function docker(args, { allowFailure = false } = {}) {
  const result = dockerResult(args)
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `docker ${args[0]} failed: ${safe(result.stderr || result.stdout)}`,
    )
  }
  return result.stdout.trim()
}

function dockerResult(args) {
  return spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  })
}

function exec(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  })
  if (result.status !== 0)
    throw new Error(`${command} failed: ${safe(result.stderr)}`)
}

function browserExecutable() {
  const configured = process.env.PLAYWRIGHT_CHROME_EXECUTABLE?.trim()
  for (const candidate of [
    configured,
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ])
    if (candidate && existsSync(candidate)) return candidate
  throw new Error("F0-N7 requires a Chromium-compatible browser")
}

function opaque() {
  return randomBytes(32).toString("base64url")
}
function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
function safe(value) {
  return String(value ?? "")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    .slice(-4096)
}
function assertSensitiveValuesAbsent(value) {
  for (const sensitive of [
    ...Object.values(canaries),
    ...Object.values(secrets),
  ])
    assert.doesNotMatch(value, new RegExp(escapeRegex(sensitive)))
}
function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
