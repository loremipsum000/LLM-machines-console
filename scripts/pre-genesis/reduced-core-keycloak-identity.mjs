import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import {
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
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const KEYCLOAK_IMAGE =
  "quay.io/keycloak/keycloak:26.7.0@sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13"
const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const dockerContext = required("PRE_GENESIS_DOCKER_CONTEXT")
const runId = randomBytes(8).toString("hex")
const containerName = `llmm-f0-i1-keycloak-${runId}`
const stateRoot = await mkdtemp(
  join(await realpath(tmpdir()), "llmm-f0-i1-keycloak-"),
)
const importRoot = join(stateRoot, "import")
const realmFile = join(importRoot, "llm-machines-realm.json")
const browserConfigFile = join(stateRoot, "browser-config.json")
const credentials = generatedCredentials()
let containerCreated = false
let failure
let evidence

try {
  await chmod(stateRoot, 0o700)
  await mkdir(importRoot, { mode: 0o755 })
  const edgePort = await reservePort()
  await writeFile(
    realmFile,
    `${JSON.stringify(realmExport(edgePort, credentials))}\n`,
    { mode: 0o644 },
  )
  docker(["info", "--format", "{{.ServerVersion}}"])
  docker([
    "create",
    "--name",
    containerName,
    "--label",
    "com.llm-machines.test-package=F0-I1",
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
  await writeFile(
    browserConfigFile,
    `${JSON.stringify({
      credentials,
      edgePort,
      upstreamPort,
    })}\n`,
    { mode: 0o600 },
  )
  const browser = spawnSync(
    process.execPath,
    [
      resolve(
        repositoryRoot,
        "scripts/pre-genesis/reduced-core-browser-session.mjs",
      ),
      "--keycloak-identity",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: childEnvironment(browserConfigFile),
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    },
  )
  if (browser.status !== 0) {
    throw new Error(
      `F0-I1 browser identity proof failed: ${sanitize(browser.stderr || browser.stdout)}`,
    )
  }
  const browserEvidence = JSON.parse(browser.stdout.trim().split("\n").at(-1))
  assert.equal(browserEvidence.status, "passed")
  assert.equal(
    browserEvidence.evidenceClass,
    "LOCAL_KEYCLOAK_IDENTITY_INTEGRATION_ONLY",
  )
  const image = docker([
    "image",
    "inspect",
    KEYCLOAK_IMAGE,
    "--format",
    "{{.Architecture}} {{.Id}}",
  ]).trim()
  evidence = {
    architecture: process.arch,
    browser: browserEvidence,
    credentialMaterialPrinted: false,
    evidenceClass: "LOCAL_KEYCLOAK_IDENTITY_INTEGRATION_ONLY",
    image: { identity: KEYCLOAK_IMAGE, localSelection: image },
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
          `F0-I1 Keycloak metadata:\n${sanitize(`${logs.stdout}\n${logs.stderr}`)}`,
        )
      : null
  failure = diagnostic
    ? new AggregateError([safeError(error), diagnostic], "F0-I1 failed.")
    : safeError(error)
} finally {
  const cleanupFailures = []
  if (containerCreated) {
    const result = dockerResult(["rm", "--force", containerName])
    if (result.status !== 0) cleanupFailures.push(safeError(result.stderr))
  }
  await rm(stateRoot, { force: true, recursive: true })
  if (
    containerCreated &&
    dockerResult(["inspect", containerName]).status === 0
  ) {
    cleanupFailures.push(new Error("F0-I1 Keycloak container remains."))
  }
  if (cleanupFailures.length > 0) {
    failure = new AggregateError(
      failure ? [failure, ...cleanupFailures] : cleanupFailures,
      "F0-I1 Keycloak cleanup failed.",
    )
  }
}

if (failure) throw failure
assert.ok(evidence)
process.stdout.write(`${JSON.stringify(evidence)}\n`)

function realmExport(edgePort, values) {
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
        userLabel: "F0-I1 disposable TOTP",
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
    operator: generatedUser("operator"),
    bffService: opaqueValue(),
    liteLlm: opaqueValue(),
    oidcClient: opaqueValue(),
    observability: opaqueValue(),
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

async function waitForKeycloak() {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const port = mappedPort()
    if (port) {
      const result = await fetch(
        `http://127.0.0.1:${port}/realms/llm-machines/.well-known/openid-configuration`,
      ).catch(() => null)
      if (result?.status === 200) return port
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
  }
  throw new Error("F0-I1 Keycloak did not become ready.")
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
    throw new Error(`F0-I1 Docker command failed: ${sanitize(result.stderr)}`)
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

function childEnvironment(configFile) {
  return {
    ...processEnvironment(),
    F0_I1_KEYCLOAK_CONFIG_FILE: configFile,
  }
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
        else rejectPort(new Error("F0-I1 could not reserve an edge port."))
      })
    })
  })
}

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`F0-I1 requires ${name}.`)
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
    credentials.bffService,
    credentials.liteLlm,
    credentials.oidcClient,
  ]
  for (const secret of secrets) output = output.split(secret).join("[redacted]")
  return output.slice(-8_000)
}

function safeError(error) {
  return error instanceof Error
    ? new Error(sanitize(error.message))
    : new Error(sanitize(error))
}
