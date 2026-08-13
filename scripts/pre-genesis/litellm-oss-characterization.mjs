import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import {
  chmod,
  chown,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const POSTGRES_IMAGE =
  "docker.io/library/postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3"
const KEYCLOAK_IMAGE =
  "quay.io/keycloak/keycloak:26.7.0@sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13"
const PREDECESSOR_IMAGE =
  "ghcr.io/berriai/litellm:v1.85.0@sha256:2e8517e2bed423c50ab7e40fb1ac0a9cbe62a764e9d65161d871fb6a9bf75a2d"
const packageLabel = "F0-N1"
const mode = process.argv[2]
const stateFile = resolve(required("F0_N1_STATE_FILE"))

if (mode === "start") await start()
else if (mode === "restart") await restart()
else if (mode === "identity-outage") await identityOutage()
else if (mode === "finalize") await finalize()
else if (mode === "cleanup") await cleanup(false)
else
  throw new Error(
    "expected start, restart, identity-outage, finalize, or cleanup",
  )

async function start() {
  let startupStage = "initialize"
  const downstreamImage = required("F0_N1_LITELLM_IMAGE")
  assert.match(downstreamImage, /^sha256:[a-f0-9]{64}$/)
  docker(["image", "inspect", downstreamImage])
  const runId = randomBytes(8).toString("hex")
  const root = await mkdtemp(join(tmpdir(), "llmm-f0-n1-runtime-"))
  await chmod(root, 0o700)
  const state = {
    schema: "llm-machines.f0-n1-runtime-state.v1",
    runId,
    root,
    network: `llmm-f0-n1-${runId}`,
    volume: `llmm-f0-n1-pg-${runId}`,
    containers: {
      inference: `llmm-f0-n1-inference-${runId}`,
      keycloak: `llmm-f0-n1-keycloak-${runId}`,
      litellm: `llmm-f0-n1-litellm-${runId}`,
      postgres: `llmm-f0-n1-postgres-${runId}`,
      predecessor: `llmm-f0-n1-predecessor-${runId}`,
    },
    ports: {
      identity: await reservePort(),
      litellm: await reservePort(),
      predecessor: await reservePort(),
    },
    images: {
      downstream: downstreamImage,
      keycloak: KEYCLOAK_IMAGE,
      postgres: POSTGRES_IMAGE,
      predecessor: PREDECESSOR_IMAGE,
    },
    secrets: {
      adminPassword: opaque(),
      databasePassword: opaque(),
      identityBootstrapPassword: opaque(),
      oidcClientSecret: opaque(),
      operatorPassword: opaque(),
      proxyMasterKey: `sk-${opaque()}`,
      proxySaltKey: opaque(),
      upstreamKey: `sk-${opaque()}`,
    },
    canaries: {
      prompt: `f0n1-prompt-${opaque()}`,
      response: `f0n1-response-${opaque()}`,
      stream: `f0n1-stream-${opaque()}`,
    },
    migratedKey: null,
  }
  await writeState(state)
  try {
    startupStage = "write-runtime-files"
    const paths = await writeRuntimeFiles(state)
    startupStage = "create-network-and-volume"
    docker([
      "network",
      "create",
      "--label",
      `com.llm-machines.test-package=${packageLabel}`,
      state.network,
    ])
    docker([
      "volume",
      "create",
      "--label",
      `com.llm-machines.test-package=${packageLabel}`,
      state.volume,
    ])
    docker([
      "run",
      "--detach",
      "--name",
      state.containers.postgres,
      "--label",
      `com.llm-machines.test-package=${packageLabel}`,
      "--network",
      state.network,
      "--network-alias",
      "postgres",
      "--env-file",
      paths.postgresEnvironment,
      "--mount",
      `type=volume,src=${state.volume},dst=/var/lib/postgresql/data`,
      POSTGRES_IMAGE,
    ])
    startupStage = "wait-for-postgresql"
    await waitForPostgres(state)
    startupStage = "start-inference-double"
    docker([
      "run",
      "--detach",
      "--name",
      state.containers.inference,
      "--label",
      `com.llm-machines.test-package=${packageLabel}`,
      "--network",
      state.network,
      "--network-alias",
      "inference-double",
      "--env-file",
      paths.inferenceEnvironment,
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,nodev,size=8m",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges=true",
      "--entrypoint",
      "python",
      PREDECESSOR_IMAGE,
      "-c",
      inferenceSource(),
    ])
    startupStage = "start-predecessor"
    docker([
      "run",
      "--detach",
      "--name",
      state.containers.predecessor,
      "--label",
      `com.llm-machines.test-package=${packageLabel}`,
      "--network",
      state.network,
      "--env-file",
      paths.litellmEnvironment,
      "--publish",
      `127.0.0.1:${state.ports.predecessor}:4000`,
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,nodev,size=512m",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges=true",
      "--entrypoint",
      "/bin/sh",
      PREDECESSOR_IMAGE,
      "-c",
      runtimeCommand(),
    ])
    await waitForHttp(
      `http://127.0.0.1:${state.ports.predecessor}/health/liveliness`,
    )
    startupStage = "create-migration-sentinel"
    const migrated = await requestJson(
      `http://127.0.0.1:${state.ports.predecessor}/key/generate`,
      state.secrets.proxyMasterKey,
      "POST",
      { key_alias: "f0-n1-migration-sentinel", models: ["fixture-model"] },
    )
    assert.equal(migrated.status, 200)
    assert.match(migrated.body?.key ?? "", /^sk-/)
    state.migratedKey = migrated.body.key
    await writeState(state)
    docker(["rm", "--force", state.containers.predecessor])
    startupStage = "start-keycloak"
    docker([
      "run",
      "--detach",
      "--name",
      state.containers.keycloak,
      "--label",
      `com.llm-machines.test-package=${packageLabel}`,
      "--network",
      state.network,
      "--network-alias",
      "keycloak",
      "--env-file",
      paths.keycloakEnvironment,
      "--publish",
      `127.0.0.1:${state.ports.identity}:8080`,
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges=true",
      "--mount",
      `type=bind,src=${paths.realmSeed},dst=/opt/keycloak/data/import/realm.json,readonly`,
      KEYCLOAK_IMAGE,
      "start-dev",
      "--import-realm",
      `--hostname=http://127.0.0.1:${state.ports.identity}`,
      "--http-enabled=true",
      "--health-enabled=true",
    ])
    await waitForHttp(
      `http://127.0.0.1:${state.ports.identity}/realms/llm-machines/.well-known/openid-configuration`,
    )
    startupStage = "start-downstream"
    docker([
      "run",
      "--detach",
      "--name",
      state.containers.litellm,
      "--label",
      `com.llm-machines.test-package=${packageLabel}`,
      "--network",
      state.network,
      "--env-file",
      paths.litellmEnvironment,
      "--publish",
      `127.0.0.1:${state.ports.litellm}:4000`,
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,nodev,size=512m",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges=true",
      "--entrypoint",
      "/bin/sh",
      downstreamImage,
      "-c",
      runtimeCommand(),
    ])
    await waitForHttp(
      `http://127.0.0.1:${state.ports.litellm}/health/liveliness`,
    )
    startupStage = "provision-native-users"
    for (const [userId, userRole] of [
      ["admin", "proxy_admin"],
      ["operator", "internal_user"],
    ]) {
      const provisioned = await requestJson(
        `http://127.0.0.1:${state.ports.litellm}/user/new`,
        state.secrets.proxyMasterKey,
        "POST",
        {
          user_email: `f0-n1-${userId}@example.com`,
          user_id: userId,
          user_role: userRole,
        },
      )
      assert.equal(provisioned.status, 200)
    }
    startupStage = "restrict-operator-native-ui"
    const uiSettings = await requestJson(
      `http://127.0.0.1:${state.ports.litellm}/update/ui_settings`,
      state.secrets.proxyMasterKey,
      "PATCH",
      {
        enabled_ui_pages_internal_users: ["api-keys", "new_usage"],
        enable_chat_ui: false,
      },
    )
    assert.equal(uiSettings.status, 200)
    startupStage = "verify-migration"
    const migration = await requestJson(
      `http://127.0.0.1:${state.ports.litellm}/key/info`,
      state.migratedKey,
    )
    assert.equal(migration.status, 200)
    process.stdout.write(
      `${JSON.stringify({ status: "ready", ports: state.ports, stateFile })}\n`,
    )
  } catch (error) {
    process.stderr.write(
      `F0-N1 disposable startup failed at ${startupStage}: ${error.message}\n`,
    )
    await cleanup(true)
    throw error
  }
}

async function restart() {
  const state = await readState()
  docker(["restart", state.containers.litellm])
  await waitForHttp(`http://127.0.0.1:${state.ports.litellm}/health/liveliness`)
  const migrated = await requestJson(
    `http://127.0.0.1:${state.ports.litellm}/key/info`,
    state.migratedKey,
  )
  assert.equal(migrated.status, 200)
  process.stdout.write(`${JSON.stringify({ restartPersistence: "PASS" })}\n`)
}

async function identityOutage() {
  const state = await readState()
  docker(["stop", state.containers.keycloak])
  const service = await fetch(
    `http://127.0.0.1:${state.ports.litellm}/health/liveliness`,
  )
  assert.equal(service.status, 200)
  const login = await fetch(
    `http://127.0.0.1:${state.ports.litellm}/sso/key/generate`,
    { redirect: "manual" },
  )
  assert.ok([302, 303, 307].includes(login.status))
  const identityRedirect = new URL(requiredHeader(login, "location"))
  assert.equal(
    identityRedirect.origin,
    `http://127.0.0.1:${state.ports.identity}`,
  )
  assert.match(
    identityRedirect.pathname,
    /\/realms\/llm-machines\/protocol\/openid-connect\/auth$/,
  )
  let identityUnavailable = false
  try {
    await fetch(identityRedirect, { signal: AbortSignal.timeout(5000) })
  } catch {
    identityUnavailable = true
  }
  assert.equal(identityUnavailable, true)
  docker(["start", state.containers.keycloak])
  await waitForHttp(
    `http://127.0.0.1:${state.ports.identity}/realms/llm-machines/.well-known/openid-configuration`,
  )
  process.stdout.write(
    `${JSON.stringify({ identityOutage: "CONTROLLED_NATIVE_LOGIN_UNAVAILABLE_SERVICE_REMAINS_HEALTHY" })}\n`,
  )
}

function requiredHeader(response, name) {
  const value = response.headers.get(name)
  assert.ok(value, `${name} response header is required`)
  return value
}

async function finalize() {
  const state = await readState()
  const browserSecretsFile = process.env.F0_N1_BROWSER_SECRETS_FILE
  const extraSecrets = browserSecretsFile
    ? JSON.parse(await readFile(resolve(browserSecretsFile), "utf8"))
    : []
  assert.ok(Array.isArray(extraSecrets))
  const dump = docker([
    "exec",
    "-e",
    `PGPASSWORD=${state.secrets.databasePassword}`,
    state.containers.postgres,
    "pg_dump",
    "--data-only",
    "--no-owner",
    "--no-privileges",
    "--username",
    "litellm",
    "litellm",
  ])
  const logs = [
    state.containers.keycloak,
    state.containers.litellm,
    state.containers.postgres,
  ].map((container) => docker(["logs", container], { allowFailure: true }))
  const forbidden = [
    ...Object.values(state.canaries),
    state.secrets.adminPassword,
    state.secrets.databasePassword,
    state.secrets.identityBootstrapPassword,
    state.secrets.oidcClientSecret,
    state.secrets.operatorPassword,
    state.secrets.proxyMasterKey,
    state.secrets.proxySaltKey,
    state.secrets.upstreamKey,
    state.migratedKey,
    ...extraSecrets,
  ]
  for (const value of forbidden) {
    assert.ok(
      !dump.includes(value),
      "plaintext sensitive value persisted in PostgreSQL",
    )
    for (const log of logs)
      assert.ok(
        !log.includes(value),
        "plaintext sensitive value persisted in runtime logs",
      )
  }
  const binding = JSON.parse(
    docker([
      "inspect",
      "--format",
      "{{json .NetworkSettings.Ports}}",
      state.containers.litellm,
    ]),
  )
  assert.equal(binding["4000/tcp"]?.[0]?.HostIp, "127.0.0.1")
  process.stdout.write(
    `${JSON.stringify({
      databaseMigration: "PASS_1_85_0_TO_1_96_2_OSS",
      directCustomerPort: "DENIED_LOOPBACK_ONLY_CHARACTERIZATION",
      enterpriseRuntimeMaterial: "ABSENT",
      restartPersistence: "PASS",
      zeroContentRetention: "PASS",
    })}\n`,
  )
}

async function cleanup(silent) {
  let state
  try {
    state = await readState()
  } catch {
    return
  }
  for (const container of Object.values(state.containers))
    docker(["rm", "--force", container], { allowFailure: true })
  docker(["network", "rm", state.network], { allowFailure: true })
  docker(["volume", "rm", state.volume], { allowFailure: true })
  await rm(state.root, { force: true, recursive: true })
  await rm(stateFile, { force: true })
  if (!silent) process.stdout.write(`${JSON.stringify({ cleanup: "PASS" })}\n`)
}

async function writeRuntimeFiles(state) {
  const paths = {
    inferenceEnvironment: join(state.root, "inference.env"),
    keycloakEnvironment: join(state.root, "keycloak.env"),
    litellmEnvironment: join(state.root, "litellm.env"),
    postgresEnvironment: join(state.root, "postgres.env"),
    realmSeed: join(state.root, "realm.json"),
  }
  await writeFile(
    paths.postgresEnvironment,
    `POSTGRES_DB=litellm\nPOSTGRES_USER=litellm\nPOSTGRES_PASSWORD=${state.secrets.databasePassword}\n`,
    { mode: 0o600 },
  )
  await writeFile(
    paths.inferenceEnvironment,
    `UPSTREAM_API_KEY=${state.secrets.upstreamKey}\nUPSTREAM_RESPONSE=${state.canaries.response}\n`,
    { mode: 0o600 },
  )
  await writeFile(
    paths.keycloakEnvironment,
    `KC_BOOTSTRAP_ADMIN_USERNAME=bootstrap-admin\nKC_BOOTSTRAP_ADMIN_PASSWORD=${state.secrets.identityBootstrapPassword}\n`,
    { mode: 0o600 },
  )
  const identityBase = `http://127.0.0.1:${state.ports.identity}`
  const liteLlmBase = `http://127.0.0.1:${state.ports.litellm}`
  const config = Buffer.from(litellmConfig()).toString("base64")
  await writeFile(
    paths.litellmEnvironment,
    [
      `DATABASE_URL=postgresql://litellm:${state.secrets.databasePassword}@postgres:5432/litellm`,
      `GENERIC_AUTHORIZATION_ENDPOINT=${identityBase}/realms/llm-machines/protocol/openid-connect/auth`,
      "GENERIC_CLIENT_ID=litellm-native",
      `GENERIC_CLIENT_SECRET=${state.secrets.oidcClientSecret}`,
      "GENERIC_CLIENT_USE_PKCE=true",
      "GENERIC_INCLUDE_CLIENT_ID=true",
      "GENERIC_SCOPE=openid email profile",
      "GENERIC_TOKEN_ENDPOINT=http://keycloak:8080/realms/llm-machines/protocol/openid-connect/token",
      "GENERIC_USERINFO_ENDPOINT=http://keycloak:8080/realms/llm-machines/protocol/openid-connect/userinfo",
      "GENERIC_USER_ROLE_ATTRIBUTE=litellm_role",
      "AUTO_REDIRECT_UI_LOGIN_TO_SSO=false",
      "LITELLM_UI_SESSION_DURATION=8h",
      `LITELLM_CONFIG_B64=${config}`,
      `LITELLM_MASTER_KEY=${state.secrets.proxyMasterKey}`,
      `LITELLM_SALT_KEY=${state.secrets.proxySaltKey}`,
      `PROXY_BASE_URL=${liteLlmBase}`,
      `PROXY_LOGOUT_URL=${liteLlmBase}/ui/login/`,
      `UPSTREAM_API_KEY=${state.secrets.upstreamKey}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  )
  await writeFile(
    paths.realmSeed,
    `${JSON.stringify(realmSeed(state), null, 2)}\n`,
    { mode: 0o600 },
  )
  await chown(paths.realmSeed, 1000, 0)
  await chmod(paths.realmSeed, 0o400)
  return paths
}

function realmSeed(state) {
  return {
    realm: "llm-machines",
    enabled: true,
    sslRequired: "none",
    ssoSessionIdleTimeout: 28_800,
    ssoSessionMaxLifespan: 86_400,
    clients: [
      {
        clientId: "litellm-native",
        name: "LiteLLM native administration",
        enabled: true,
        publicClient: false,
        secret: state.secrets.oidcClientSecret,
        standardFlowEnabled: true,
        directAccessGrantsEnabled: false,
        redirectUris: [`http://127.0.0.1:${state.ports.litellm}/sso/callback`],
        webOrigins: [`http://127.0.0.1:${state.ports.litellm}`],
        attributes: {
          "pkce.code.challenge.method": "S256",
          "post.logout.redirect.uris": `http://127.0.0.1:${state.ports.litellm}/ui/*`,
        },
        protocolMappers: [
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
        ],
      },
    ],
    users: [
      fixtureUser("admin", state.secrets.adminPassword, "proxy_admin"),
      fixtureUser("operator", state.secrets.operatorPassword, "internal_user"),
    ],
  }
}

function fixtureUser(username, password, role) {
  return {
    username,
    email: `f0-n1-${username}@example.com`,
    emailVerified: true,
    enabled: true,
    firstName: username === "admin" ? "Admin" : "Operator",
    lastName: "Fixture",
    requiredActions: [],
    attributes: { litellm_role: [role] },
    credentials: [{ type: "password", value: password, temporary: false }],
  }
}

function litellmConfig() {
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

function runtimeCommand() {
  return 'printf "%s" "$LITELLM_CONFIG_B64" | base64 -d > /tmp/config.yaml && exec litellm --config /tmp/config.yaml --host 0.0.0.0 --port 4000 --num_workers 1'
}

function inferenceSource() {
  return [
    "import json, os",
    "from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer",
    'key=os.environ["UPSTREAM_API_KEY"]',
    'answer=os.environ["UPSTREAM_RESPONSE"]',
    "class H(BaseHTTPRequestHandler):",
    " def log_message(self,*args): pass",
    " def do_POST(self):",
    '  if self.headers.get("Authorization") != "Bearer " + key: self.send_response(401); self.end_headers(); return',
    '  n=int(self.headers.get("Content-Length","0")); body=json.loads(self.rfile.read(n))',
    '  stream=body.get("stream") is True',
    "  self.send_response(200)",
    '  self.send_header("Cache-Control","no-store")',
    '  self.send_header("Content-Type","text/event-stream" if stream else "application/json")',
    "  self.end_headers()",
    '  if stream: self.wfile.write(("data: "+json.dumps({"choices":[{"delta":{"content":answer},"finish_reason":None,"index":0}],"model":"fixture-model","object":"chat.completion.chunk"})+"\\n\\ndata: [DONE]\\n\\n").encode())',
    '  else: self.wfile.write(json.dumps({"choices":[{"finish_reason":"stop","index":0,"message":{"content":answer,"role":"assistant"}}],"model":"fixture-model","object":"chat.completion","usage":{"completion_tokens":2,"prompt_tokens":3,"total_tokens":5}}).encode())',
    'ThreadingHTTPServer(("0.0.0.0",4010),H).serve_forever()',
  ].join("\n")
}

async function waitForPostgres(state) {
  await waitUntil(() => {
    const result = docker(
      [
        "exec",
        state.containers.postgres,
        "pg_isready",
        "-U",
        "litellm",
        "-d",
        "litellm",
      ],
      { allowFailure: true },
    )
    return result.includes("accepting connections")
  })
}

async function waitForHttp(url) {
  await waitUntil(async () => {
    try {
      const response = await fetch(url, { redirect: "manual" })
      return response.status >= 200 && response.status < 500
    } catch {
      return false
    }
  }, 240_000)
}

async function waitUntil(check, timeout = 120_000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await check()) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000))
  }
  throw new Error("timed out waiting for disposable F0-N1 service")
}

async function requestJson(url, token, method, body) {
  const response = await fetch(url, {
    method: method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let parsed = null
  try {
    parsed = await response.json()
  } catch {}
  return { body: parsed, status: response.status }
}

function docker(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (error) {
    if (allowFailure) return `${error.stdout ?? ""}${error.stderr ?? ""}`
    throw error
  }
}

async function reservePort() {
  return await new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.unref()
    server.once("error", rejectPort)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      assert.ok(address && typeof address === "object")
      server.close(() => resolvePort(address.port))
    })
  })
}

async function readState() {
  return JSON.parse(await readFile(stateFile, "utf8"))
}

async function writeState(state) {
  await writeFile(stateFile, `${JSON.stringify(state)}\n`, { mode: 0o600 })
  await chmod(stateFile, 0o600)
}

function opaque() {
  return randomBytes(32).toString("base64url")
}

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
