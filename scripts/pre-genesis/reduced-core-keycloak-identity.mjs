import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { humanAdminPermissions } from "./keycloak-team-permissions.mjs"

const KEYCLOAK_IMAGE =
  "quay.io/keycloak/keycloak:26.7.0@sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13"
const POSTGRES_IMAGE =
  "docker.io/library/postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3"
const teamMode = process.argv.includes("--team")
if (process.argv.slice(2).some((argument) => argument !== "--team")) {
  throw new Error("Usage: reduced-core-keycloak-identity.mjs [--team]")
}
const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const dockerContext = required("PRE_GENESIS_DOCKER_CONTEXT")
const serviceControl = serviceControlFromEnvironment()
const runId = randomBytes(8).toString("hex")
const packageId = teamMode ? "F0-I2" : "F0-I1"
const containerName = `llmm-${packageId.toLowerCase()}-keycloak-${runId}`
const postgresContainerName = `llmm-f0-i2-postgres-${runId}`
const postgresVolumeName = `llmm-f0-i2-postgres-${runId}`
const postgresDatabase = "llmm_f0_i2"
const postgresUser = "llmm_f0_i2"
const stateRoot = await mkdtemp(
  join(
    await realpath(tmpdir()),
    teamMode ? "llmm-f0-i2-keycloak-team-" : "llmm-f0-i1-keycloak-",
  ),
)
const importRoot = join(stateRoot, "import")
const realmFile = join(importRoot, "llm-machines-realm.json")
const browserConfigFile = join(stateRoot, "browser-config.json")
const keycloakEnvironmentFile = join(stateRoot, "keycloak.env")
const postgresEnvironmentFile = join(stateRoot, "postgres.env")
const credentials = generatedCredentials()
let containerCreated = false
let postgresContainerCreated = false
let postgresVolumeCreated = false
let failure
let evidence

try {
  await chmod(stateRoot, 0o700)
  await mkdir(importRoot, { mode: 0o755 })
  const edgePort = serviceControl?.edgePort ?? (await reservePort())
  await writeFile(
    realmFile,
    `${JSON.stringify(realmExport(edgePort, credentials, teamMode))}\n`,
    { mode: 0o644 },
  )
  if (teamMode) {
    await writeFile(
      keycloakEnvironmentFile,
      [
        `KC_BOOTSTRAP_ADMIN_USERNAME=${credentials.bootstrap.username}`,
        `KC_BOOTSTRAP_ADMIN_PASSWORD=${credentials.bootstrap.password}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    )
  }
  docker(["info", "--format", "{{.ServerVersion}}"])
  docker([
    "create",
    "--name",
    containerName,
    "--label",
    `com.llm-machines.test-package=${packageId}`,
    ...(teamMode ? ["--env-file", keycloakEnvironmentFile] : []),
    "--cpus",
    "2",
    "--memory",
    "2g",
    "--publish",
    "127.0.0.1::8080",
    KEYCLOAK_IMAGE,
    "start-dev",
    "--import-realm",
    "--http-port=8080",
    `--hostname=https://identity.llmm.test:${edgePort}`,
    "--hostname-strict=true",
    "--proxy-headers=xforwarded",
  ])
  containerCreated = true
  docker(["cp", importRoot, `${containerName}:/opt/keycloak/data/import`])
  docker(["start", containerName])
  const upstreamPort = await waitForKeycloak()
  let databaseUrl = null
  if (teamMode) {
    await configureTeamAuthority(upstreamPort)
    databaseUrl = serviceControl ? null : await startPostgres()
  }
  await writeFile(
    browserConfigFile,
    `${JSON.stringify({
      container: containerName,
      credentials: browserCredentials(),
      dockerContext,
      edgePort,
      upstreamPort,
    })}\n`,
    { mode: 0o600 },
  )
  if (serviceControl) {
    await writeFile(
      serviceControl.controlFile,
      `${JSON.stringify({
        container: containerName,
        credentials: browserCredentials(),
        dockerContext,
        edgePort,
        upstreamPort,
      })}\n`,
      { mode: 0o600 },
    )
    await waitForStop(serviceControl.stopFile)
  }
  const browser = serviceControl
    ? null
    : spawnSync(
        process.execPath,
        [
          resolve(
            repositoryRoot,
            "scripts/pre-genesis/reduced-core-browser-session.mjs",
          ),
          teamMode ? "--keycloak-team" : "--keycloak-identity",
        ],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: childEnvironment(browserConfigFile, databaseUrl),
          maxBuffer: 64 * 1024 * 1024,
          timeout: 15 * 60 * 1000,
        },
      )
  if (browser && browser.status !== 0) {
    throw new Error(
      `${packageId} browser identity proof failed: ${sanitize(browser.stderr || browser.stdout)}`,
    )
  }
  const browserEvidence = browser
    ? JSON.parse(browser.stdout.trim().split("\n").at(-1))
    : null
  if (browserEvidence) {
    assert.equal(browserEvidence.status, "passed")
    assert.equal(
      browserEvidence.evidenceClass,
      teamMode
        ? "LOCAL_KEYCLOAK_TEAM_MUTATION_ONLY"
        : "LOCAL_KEYCLOAK_IDENTITY_INTEGRATION_ONLY",
    )
  }
  const image = docker([
    "image",
    "inspect",
    KEYCLOAK_IMAGE,
    "--format",
    "{{.Architecture}} {{.Id}}",
  ]).trim()
  evidence = {
    architecture: process.arch,
    ...(browserEvidence ? { browser: browserEvidence } : {}),
    credentialMaterialPrinted: false,
    evidenceClass: serviceControl
      ? "LOCAL_INTEGRATED_CORE_COMPONENT_ONLY"
      : teamMode
        ? "LOCAL_KEYCLOAK_TEAM_MUTATION_ONLY"
        : "LOCAL_KEYCLOAK_IDENTITY_INTEGRATION_ONLY",
    image: { identity: KEYCLOAK_IMAGE, localSelection: image },
    ...(teamMode
      ? {
          postgresImage: POSTGRES_IMAGE,
          scopedAuthority: "console-human-admin-fgap-v2",
        }
      : {}),
    routePolicy: "infra/ingress/source-no-bypass.mjs",
    status: "passed",
    temporaryStateRemoved: true,
  }
} catch (error) {
  const logs = containerCreated
    ? dockerResult(["logs", "--tail", "200", containerName])
    : null
  const diagnostic =
    logs && (logs.stdout || logs.stderr)
      ? new Error(
          `${packageId} Keycloak metadata:\n${sanitize(`${logs.stdout}\n${logs.stderr}`)}`,
        )
      : null
  failure = diagnostic
    ? new AggregateError([safeError(error), diagnostic], `${packageId} failed.`)
    : safeError(error)
} finally {
  const cleanupFailures = []
  if (containerCreated) {
    const result = dockerResult(["rm", "--force", containerName])
    if (result.status !== 0) cleanupFailures.push(safeError(result.stderr))
  }
  if (postgresContainerCreated) {
    const result = dockerResult(["rm", "--force", postgresContainerName])
    if (result.status !== 0) cleanupFailures.push(safeError(result.stderr))
  }
  if (postgresVolumeCreated) {
    const result = dockerResult(["volume", "rm", postgresVolumeName])
    if (result.status !== 0) cleanupFailures.push(safeError(result.stderr))
  }
  await rm(stateRoot, { force: true, recursive: true })
  if (
    containerCreated &&
    dockerResult(["inspect", containerName]).status === 0
  ) {
    cleanupFailures.push(new Error(`${packageId} Keycloak container remains.`))
  }
  if (
    postgresContainerCreated &&
    dockerResult(["inspect", postgresContainerName]).status === 0
  ) {
    cleanupFailures.push(new Error("F0-I2 PostgreSQL container remains."))
  }
  if (
    postgresVolumeCreated &&
    dockerResult(["volume", "inspect", postgresVolumeName]).status === 0
  ) {
    cleanupFailures.push(new Error("F0-I2 PostgreSQL volume remains."))
  }
  if (cleanupFailures.length > 0) {
    failure = new AggregateError(
      failure ? [failure, ...cleanupFailures] : cleanupFailures,
      `${packageId} cleanup failed.`,
    )
  }
}

if (failure) throw failure
assert.ok(evidence)
process.stdout.write(`${JSON.stringify(evidence)}\n`)

function realmExport(edgePort, values, includeTeamAuthority) {
  const passwordAmr = "llmm-password-amr"
  const otpAmr = "llmm-otp-amr"
  return {
    realm: "llm-machines",
    enabled: true,
    accessTokenLifespan: 300,
    ssoSessionIdleTimeout: 1800,
    ssoSessionMaxLifespan: 28800,
    revokeRefreshToken: true,
    refreshTokenMaxReuse: 0,
    otpPolicyType: "totp",
    otpPolicyAlgorithm: "HmacSHA256",
    otpPolicyDigits: 6,
    otpPolicyPeriod: 30,
    browserFlow: "llm-machines-browser-mfa",
    authenticatorConfig: [
      amrConfig(passwordAmr, "pwd"),
      amrConfig(otpAmr, "otp"),
    ],
    authenticationFlows: [
      {
        alias: "llm-machines-browser-mfa",
        builtIn: false,
        providerId: "basic-flow",
        topLevel: true,
        authenticationExecutions: [
          {
            authenticator: "auth-cookie",
            authenticatorFlow: false,
            priority: 10,
            requirement: "ALTERNATIVE",
          },
          {
            authenticatorFlow: true,
            flowAlias: "llm-machines-browser-mfa-forms",
            priority: 20,
            requirement: "ALTERNATIVE",
          },
        ],
      },
      {
        alias: "llm-machines-browser-mfa-forms",
        builtIn: false,
        providerId: "basic-flow",
        topLevel: false,
        authenticationExecutions: [
          {
            authenticator: "auth-username-password-form",
            authenticatorConfig: passwordAmr,
            authenticatorFlow: false,
            priority: 10,
            requirement: "REQUIRED",
          },
          {
            authenticator: "auth-otp-form",
            authenticatorConfig: otpAmr,
            authenticatorFlow: false,
            priority: 20,
            requirement: "REQUIRED",
          },
        ],
      },
    ],
    roles: { realm: [{ name: "admin" }, { name: "operator" }] },
    groups: [
      { name: "Admins", realmRoles: ["admin"] },
      { name: "Operators", realmRoles: ["operator"] },
    ],
    clientScopes: [
      {
        name: "basic",
        protocol: "openid-connect",
        attributes: {
          "display.on.consent.screen": "false",
          "include.in.token.scope": "false",
        },
        protocolMappers: [
          {
            name: "subject",
            protocol: "openid-connect",
            protocolMapper: "oidc-sub-mapper",
            config: {
              "access.token.claim": "true",
              "introspection.token.claim": "true",
              "lightweight.claim": "false",
            },
          },
          {
            name: "auth_time",
            protocol: "openid-connect",
            protocolMapper: "oidc-usersessionmodel-note-mapper",
            config: {
              "access.token.claim": "true",
              "claim.name": "auth_time",
              "id.token.claim": "true",
              "introspection.token.claim": "true",
              "jsonType.label": "long",
              "user.session.note": "AUTH_TIME",
            },
          },
        ],
      },
      simpleScope("profile"),
      simpleScope("email"),
      {
        name: "llm-machines-amr",
        protocol: "openid-connect",
        attributes: {
          "display.on.consent.screen": "false",
          "include.in.token.scope": "false",
        },
        protocolMappers: [
          {
            name: "amr",
            protocol: "openid-connect",
            protocolMapper: "oidc-amr-mapper",
            config: {
              "access.token.claim": "true",
              "id.token.claim": "false",
              "lightweight.claim": "false",
            },
          },
        ],
      },
    ],
    clients: [
      {
        clientId: "console-web",
        secret: values.oidcClient,
        enabled: true,
        protocol: "openid-connect",
        publicClient: false,
        standardFlowEnabled: true,
        directAccessGrantsEnabled: false,
        implicitFlowEnabled: false,
        serviceAccountsEnabled: false,
        fullScopeAllowed: true,
        redirectUris: [
          `https://console.llmm.test:${edgePort}/api/console/session/callback`,
        ],
        webOrigins: [],
        attributes: {
          "pkce.code.challenge.method": "S256",
          "backchannel.logout.session.required": "true",
        },
        defaultClientScopes: ["basic", "llm-machines-amr"],
        optionalClientScopes: ["profile", "email"],
        protocolMappers: [
          {
            name: "console-bff-audience",
            protocol: "openid-connect",
            protocolMapper: "oidc-audience-mapper",
            config: {
              "access.token.claim": "true",
              "id.token.claim": "false",
              "included.client.audience": "console-bff",
              "included.custom.audience": "",
            },
          },
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
              "userinfo.token.claim": "false",
            },
          },
        ],
      },
      ...(includeTeamAuthority
        ? [
            {
              clientId: "console-human-admin",
              secret: values.humanAdmin,
              enabled: true,
              protocol: "openid-connect",
              publicClient: false,
              standardFlowEnabled: false,
              directAccessGrantsEnabled: false,
              implicitFlowEnabled: false,
              serviceAccountsEnabled: true,
              fullScopeAllowed: false,
              defaultClientScopes: [],
              optionalClientScopes: [],
            },
          ]
        : []),
    ],
    users: [
      userExport(values.admin, "admin", "/Admins"),
      userExport(values.operator, "operator", "/Operators"),
    ],
  }
}

function simpleScope(name) {
  return {
    name,
    protocol: "openid-connect",
    attributes: {
      "display.on.consent.screen": "false",
      "include.in.token.scope": "true",
    },
    protocolMappers: [],
  }
}

function amrConfig(alias, value) {
  return {
    alias,
    config: {
      "default.reference.maxAge": "28800",
      "default.reference.value": value,
    },
  }
}

function userExport(user, role, group) {
  return {
    username: user.username,
    enabled: true,
    email: `${user.username}@fixture.invalid`,
    emailVerified: true,
    firstName: role,
    lastName: "fixture",
    realmRoles: [role],
    groups: [group],
    credentials: [
      { type: "password", value: user.password, temporary: false },
      {
        type: "otp",
        userLabel: `${packageId} disposable TOTP`,
        secretData: JSON.stringify({ value: user.otpSecret }),
        credentialData: JSON.stringify({
          algorithm: "HmacSHA256",
          counter: 0,
          digits: 6,
          period: 30,
          secretEncoding: null,
          subType: "totp",
        }),
      },
    ],
  }
}

function generatedCredentials() {
  return {
    admin: generatedUser("admin"),
    bootstrap: {
      password: opaqueValue(),
      username: `bootstrap-${randomBytes(6).toString("hex")}`,
    },
    operator: generatedUser("operator"),
    bffService: opaqueValue(),
    humanAdmin: opaqueValue(),
    liteLlm: opaqueValue(),
    oidcClient: opaqueValue(),
    observability: opaqueValue(),
    postgres: opaqueValue(),
  }
}

function browserCredentials() {
  return {
    admin: credentials.admin,
    bffService: credentials.bffService,
    ...(teamMode ? { humanAdmin: credentials.humanAdmin } : {}),
    liteLlm: credentials.liteLlm,
    observability: credentials.observability,
    oidcClient: credentials.oidcClient,
    operator: credentials.operator,
  }
}

function generatedUser(role) {
  return {
    otpSecret: randomBytes(20).toString("hex"),
    password: opaqueValue(),
    role,
    subject: `keycloak-${role}-${randomBytes(8).toString("hex")}`,
    username: `${role}-${randomBytes(6).toString("hex")}`,
  }
}

async function configureTeamAuthority(upstreamPort) {
  const root = `http://127.0.0.1:${upstreamPort}`
  const bootstrapToken = await token(root, "master", {
    client_id: "admin-cli",
    grant_type: "password",
    password: credentials.bootstrap.password,
    username: credentials.bootstrap.username,
  })
  const realmPath = "/admin/realms/llm-machines"
  await adminRequest(root, bootstrapToken, realmPath, {
    body: { adminPermissionsEnabled: true },
    method: "PUT",
  })

  const serviceClient = await exactClient(
    root,
    bootstrapToken,
    "console-human-admin",
  )
  const serviceUser = await adminJson(
    root,
    bootstrapToken,
    `${realmPath}/clients/${encodeURIComponent(serviceClient.id)}/service-account-user`,
  )
  assert.match(serviceUser.id ?? "", /^[0-9a-f-]{36}$/)

  const realmManagement = await exactClient(
    root,
    bootstrapToken,
    "realm-management",
  )
  const queryRoles = await Promise.all(
    ["query-users", "query-groups"].map((role) =>
      adminJson(
        root,
        bootstrapToken,
        `${realmPath}/clients/${encodeURIComponent(realmManagement.id)}/roles/${role}`,
      ),
    ),
  )
  await adminRequest(
    root,
    bootstrapToken,
    `${realmPath}/users/${encodeURIComponent(serviceUser.id)}/role-mappings/clients/${encodeURIComponent(realmManagement.id)}`,
    { body: queryRoles, method: "POST" },
  )

  const permissionClient = await waitForClient(
    root,
    bootstrapToken,
    "admin-permissions",
  )
  await adminRequest(
    root,
    bootstrapToken,
    `${realmPath}/clients/${encodeURIComponent(permissionClient.id)}/authz/resource-server/policy/user`,
    {
      body: {
        logic: "POSITIVE",
        name: "console-human-admin-service-account",
        users: [serviceUser.id],
      },
      method: "POST",
    },
  )

  const [adminsGroup, operatorsGroup] = await Promise.all([
    exactGroup(root, bootstrapToken, "Admins"),
    exactGroup(root, bootstrapToken, "Operators"),
  ])
  const permissionPath = `${realmPath}/clients/${encodeURIComponent(permissionClient.id)}/authz/resource-server/permission/scope`
  for (const permission of humanAdminPermissions({
    adminsGroupId: adminsGroup.id,
    operatorsGroupId: operatorsGroup.id,
  })) {
    await adminRequest(root, bootstrapToken, permissionPath, {
      body: permission,
      method: "POST",
    })
  }

  const serviceToken = await token(root, "llm-machines", {
    client_id: "console-human-admin",
    client_secret: credentials.humanAdmin,
    grant_type: "client_credentials",
  })
  await expectAdminStatus(root, serviceToken, `${realmPath}/users?max=2`, 200)
  await expectAdminStatus(root, serviceToken, `${realmPath}/groups?max=2`, 200)
  await expectAdminStatus(root, serviceToken, realmPath, 403)
  await expectAdminStatus(root, serviceToken, `${realmPath}/clients?max=1`, 403)
  const operator = await exactUser(
    root,
    bootstrapToken,
    credentials.operator.username,
  )
  const adminRole = await adminJson(
    root,
    bootstrapToken,
    `${realmPath}/roles/admin`,
  )
  await expectAdminStatus(
    root,
    serviceToken,
    `${realmPath}/users/${encodeURIComponent(operator.id)}/role-mappings/realm`,
    403,
    { body: [adminRole], method: "POST" },
  )
  await expectAdminStatus(
    root,
    serviceToken,
    `${realmPath}/users/${encodeURIComponent(operator.id)}/impersonation`,
    403,
    { method: "POST" },
  )
}

async function exactClient(root, bearer, clientId) {
  const clients = await adminJson(
    root,
    bearer,
    `/admin/realms/llm-machines/clients?clientId=${encodeURIComponent(clientId)}&exact=true&max=2`,
  )
  assert.equal(clients.length, 1, `Keycloak client ${clientId} was not exact.`)
  return clients[0]
}

async function waitForClient(root, bearer, clientId) {
  const deadline = performance.now() + 30_000
  while (performance.now() < deadline) {
    try {
      return await exactClient(root, bearer, clientId)
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
    }
  }
  throw new Error(`Keycloak client ${clientId} did not become available.`)
}

async function exactGroup(root, bearer, name) {
  const groups = await adminJson(
    root,
    bearer,
    `/admin/realms/llm-machines/groups?search=${encodeURIComponent(name)}&exact=true&max=2`,
  )
  const matches = groups.filter((group) => group.name === name)
  assert.equal(matches.length, 1, `Keycloak group ${name} was not exact.`)
  return matches[0]
}

async function exactUser(root, bearer, username) {
  const users = await adminJson(
    root,
    bearer,
    `/admin/realms/llm-machines/users?username=${encodeURIComponent(username)}&exact=true&max=2`,
  )
  assert.equal(users.length, 1, `Keycloak user ${username} was not exact.`)
  return users[0]
}

async function token(root, realm, input) {
  const response = await fetch(
    `${root}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`,
    {
      body: new URLSearchParams(input),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    },
  )
  if (!response.ok) {
    throw new Error(`Keycloak token request failed with ${response.status}.`)
  }
  const payload = await response.json()
  assert.equal(typeof payload.access_token, "string")
  return payload.access_token
}

async function adminJson(root, bearer, path) {
  const response = await fetch(`${root}${path}`, {
    headers: { authorization: `Bearer ${bearer}` },
  })
  if (!response.ok) {
    throw new Error(
      `Keycloak Admin request ${path} failed with ${response.status}.`,
    )
  }
  return response.json()
}

async function adminRequest(root, bearer, path, { body, method }) {
  const response = await fetch(`${root}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      authorization: `Bearer ${bearer}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    method,
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(
      `Keycloak Admin ${method} ${path} failed with ${response.status}: ${sanitize(detail)}`,
    )
  }
}

async function expectAdminStatus(
  root,
  bearer,
  path,
  expected,
  { body, method = "GET" } = {},
) {
  const response = await fetch(`${root}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      authorization: `Bearer ${bearer}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    method,
  })
  assert.equal(
    response.status,
    expected,
    `${path} returned ${response.status}.`,
  )
  await response.body?.cancel()
}

async function startPostgres() {
  await writeFile(
    postgresEnvironmentFile,
    [
      `POSTGRES_DB=${postgresDatabase}`,
      `POSTGRES_PASSWORD=${credentials.postgres}`,
      `POSTGRES_USER=${postgresUser}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  )
  docker([
    "volume",
    "create",
    "--label",
    "com.llm-machines.test-package=F0-I2",
    postgresVolumeName,
  ])
  postgresVolumeCreated = true
  docker([
    "run",
    "--detach",
    "--name",
    postgresContainerName,
    "--label",
    "com.llm-machines.test-package=F0-I2",
    "--env-file",
    postgresEnvironmentFile,
    "--publish",
    "127.0.0.1::5432",
    "--mount",
    `type=volume,source=${postgresVolumeName},target=/var/lib/postgresql/data`,
    POSTGRES_IMAGE,
  ])
  postgresContainerCreated = true
  const deadline = performance.now() + 60_000
  let postgresReady = false
  while (performance.now() < deadline) {
    const ready = dockerResult([
      "exec",
      postgresContainerName,
      "pg_isready",
      "--host",
      "127.0.0.1",
      "--dbname",
      postgresDatabase,
      "--username",
      postgresUser,
    ])
    if (ready.status === 0) {
      postgresReady = true
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
  }
  if (!postgresReady) {
    throw new Error("F0-I2 PostgreSQL did not reach final TCP readiness.")
  }
  const migration = await readFile(
    resolve(repositoryRoot, "infra/migrations/0000_inference_core.sql"),
    "utf8",
  )
  postgresPsql(migration)
  const port = postgresPort()
  return `postgresql://${postgresUser}:${encodeURIComponent(credentials.postgres)}@127.0.0.1:${port}/${postgresDatabase}`
}

function postgresPort() {
  const output = docker(["port", postgresContainerName, "5432/tcp"]).trim()
  const match = output.match(/127\.0\.0\.1:(\d+)$/m)
  if (!match) throw new Error("F0-I2 could not resolve the PostgreSQL port.")
  return Number.parseInt(match[1], 10)
}

function postgresPsql(sql) {
  const result = spawnSync(
    "docker",
    [
      "--context",
      dockerContext,
      "exec",
      "--interactive",
      postgresContainerName,
      "psql",
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--dbname",
      postgresDatabase,
      "--username",
      postgresUser,
    ],
    {
      encoding: "utf8",
      env: processEnvironment(),
      input: sql,
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  if (result.status !== 0) {
    throw new Error(
      `F0-I2 PostgreSQL migration failed: ${sanitize(result.stderr)}`,
    )
  }
}

async function waitForKeycloak() {
  const deadline = performance.now() + 120_000
  while (performance.now() < deadline) {
    const port = mappedPort()
    if (port) {
      const result = await fetch(
        `http://127.0.0.1:${port}/realms/llm-machines/.well-known/openid-configuration`,
      ).catch(() => null)
      if (result?.status === 200) return port
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
  }
  throw new Error(`${packageId} Keycloak did not become ready.`)
}

function mappedPort() {
  const result = dockerResult(["port", containerName, "8080/tcp"])
  if (result.status !== 0) return null
  const match = result.stdout.trim().match(/127\.0\.0\.1:(\d+)$/)
  return match ? Number.parseInt(match[1], 10) : null
}

function docker(arguments_) {
  const result = dockerResult(arguments_)
  if (result.status !== 0) {
    throw new Error(
      `${packageId} Docker command failed: ${sanitize(result.stderr)}`,
    )
  }
  return result.stdout
}

function dockerResult(arguments_) {
  return spawnSync("docker", ["--context", dockerContext, ...arguments_], {
    encoding: "utf8",
    env: processEnvironment(),
    maxBuffer: 64 * 1024 * 1024,
  })
}

function childEnvironment(configFile, databaseUrl) {
  const environment = {
    ...processEnvironment(),
    F0_I1_KEYCLOAK_CONFIG_FILE: configFile,
  }
  if (teamMode) {
    assert.ok(databaseUrl)
    environment.F0_P1_DATABASE_URL = databaseUrl
    environment.F0_P1_DOCKER_CONTEXT = dockerContext
    environment.F0_P1_POSTGRES_CONTAINER = postgresContainerName
    environment.F0_P1_POSTGRES_DB = postgresDatabase
    environment.F0_P1_POSTGRES_USER = postgresUser
  }
  return environment
}

function processEnvironment() {
  return {
    HOME: process.env.HOME ?? "",
    LANG: "C",
    LC_ALL: "C",
    PATH: process.env.PATH ?? "",
    PLAYWRIGHT_CHROME_EXECUTABLE:
      process.env.PLAYWRIGHT_CHROME_EXECUTABLE ?? "",
  }
}

function serviceControlFromEnvironment() {
  const controlFile = process.env.F0_C1_SERVICE_CONTROL_FILE?.trim()
  const stopFile = process.env.F0_C1_SERVICE_STOP_FILE?.trim()
  const edgePortValue = process.env.F0_C1_EDGE_PORT?.trim()
  if (!controlFile && !stopFile && !edgePortValue) return null
  if (!controlFile || !stopFile || !edgePortValue) {
    throw new Error("F0-C1 Keycloak service control is incomplete.")
  }
  const edgePort = Number.parseInt(edgePortValue, 10)
  if (
    !isAbsolute(controlFile) ||
    !isAbsolute(stopFile) ||
    !Number.isSafeInteger(edgePort) ||
    edgePort < 1024 ||
    edgePort > 65535
  ) {
    throw new Error("F0-C1 Keycloak service control is invalid.")
  }
  return { controlFile, edgePort, stopFile }
}

async function waitForStop(path) {
  for (;;) {
    try {
      await access(path)
      return
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
}

function reservePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once("error", rejectPort)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close((error) => {
        if (error) rejectPort(error)
        else if (typeof address === "object" && address)
          resolvePort(address.port)
        else
          rejectPort(new Error(`${packageId} could not reserve an edge port.`))
      })
    })
  })
}

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${packageId} requires ${name}.`)
  return value
}

function opaqueValue() {
  return randomBytes(32).toString("base64url")
}

function sanitize(value) {
  let output = String(value ?? "")
  const secrets = [
    credentials.admin.password,
    credentials.admin.otpSecret,
    credentials.operator.password,
    credentials.operator.otpSecret,
    credentials.bootstrap.password,
    credentials.bffService,
    credentials.humanAdmin,
    credentials.liteLlm,
    credentials.oidcClient,
    credentials.postgres,
  ]
  for (const secret of secrets) output = output.split(secret).join("[redacted]")
  return output.slice(-8_000)
}

function safeError(error) {
  return error instanceof Error
    ? new Error(sanitize(error.message))
    : new Error(sanitize(error))
}
