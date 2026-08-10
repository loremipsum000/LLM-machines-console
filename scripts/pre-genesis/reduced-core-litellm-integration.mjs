import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { createServer } from "node:http"
import { createServer as createNetServer } from "node:net"
import { tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const LITELLM_IMAGE =
  "ghcr.io/berriai/litellm:v1.85.0@sha256:2e8517e2bed423c50ab7e40fb1ac0a9cbe62a764e9d65161d871fb6a9bf75a2d"
const POSTGRES_IMAGE =
  "docker.io/library/postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3"
const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const dockerContext = required("PRE_GENESIS_DOCKER_CONTEXT")
const serviceControl = serviceControlFromEnvironment()
const runId = randomBytes(8).toString("hex")
const network = `llmm-f0-l2-${runId}`
const liteLlmContainer = `llmm-f0-l2-litellm-${runId}`
const postgresContainer = `llmm-f0-l2-postgres-${runId}`
const database = "litellm"
const databaseUser = "litellm"
const databasePassword = opaqueValue()
const adminKey = `sk-${opaqueValue()}`
const saltKey = opaqueValue()
const upstreamKey = `sk-${opaqueValue()}`
const canaries = {
  outagePrompt: `f0l2-outage-${opaqueValue()}`,
  prompt: `f0l2-prompt-${opaqueValue()}`,
  recoveryPrompt: `f0l2-recovery-${opaqueValue()}`,
  response: `f0l2-response-${opaqueValue()}`,
  streamingPrompt: `f0l2-stream-${opaqueValue()}`,
}
const stateRoot = await mkdtemp(
  join(await realpath(tmpdir()), "llmm-f0-l2-litellm-"),
)
const postgresEnvironmentFile = join(stateRoot, "postgres.env")
const liteLlmEnvironmentFile = join(stateRoot, "litellm.env")
const browserConfigFile = join(stateRoot, "browser-config.json")
const created = { liteLlm: false, network: false, postgres: false }
let upstream
let upstreamRequests = 0
let evidence
let failure

try {
  await chmod(stateRoot, 0o700)
  docker(["info", "--format", "{{.ServerVersion}}"])
  assertLockedImageIdentity()
  const upstreamPort = await listenUpstream()
  await writeFile(
    postgresEnvironmentFile,
    [
      `POSTGRES_DB=${database}`,
      `POSTGRES_PASSWORD=${databasePassword}`,
      `POSTGRES_USER=${databaseUser}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  )
  const config = liteLlmConfig(upstreamPort)
  await writeFile(
    liteLlmEnvironmentFile,
    [
      `DATABASE_URL=postgresql://${databaseUser}:${databasePassword}@postgres:5432/${database}`,
      `LITELLM_CONFIG_B64=${Buffer.from(config).toString("base64")}`,
      `LITELLM_MASTER_KEY=${adminKey}`,
      `LITELLM_SALT_KEY=${saltKey}`,
      `UPSTREAM_API_KEY=${upstreamKey}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  )
  docker([
    "network",
    "create",
    "--label",
    "com.llm-machines.test-package=F0-L2",
    network,
  ])
  created.network = true
  docker([
    "run",
    "--detach",
    "--name",
    postgresContainer,
    "--label",
    "com.llm-machines.test-package=F0-L2",
    "--network",
    network,
    "--network-alias",
    "postgres",
    "--env-file",
    postgresEnvironmentFile,
    "--tmpfs",
    "/var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=1g",
    POSTGRES_IMAGE,
  ])
  created.postgres = true
  await waitForPostgres()
  const liteLlmPort = await reservePort()
  docker([
    "run",
    "--detach",
    "--name",
    liteLlmContainer,
    "--label",
    "com.llm-machines.test-package=F0-L2",
    "--network",
    network,
    "--env-file",
    liteLlmEnvironmentFile,
    "--publish",
    `127.0.0.1:${liteLlmPort}:4000`,
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=512m",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges=true",
    "--entrypoint",
    "/bin/sh",
    LITELLM_IMAGE,
    "-c",
    'printf "%s" "$LITELLM_CONFIG_B64" | base64 -d > /tmp/config.yaml && exec litellm --config /tmp/config.yaml --host 0.0.0.0 --port 4000 --num_workers 1',
  ])
  created.liteLlm = true
  const port = await waitForLiteLlmPort(liteLlmPort)
  const baseUrl = `http://127.0.0.1:${port}`
  await waitForLiteLlm(baseUrl)
  const keyResponse = await requestJson(`${baseUrl}/key/generate`, adminKey, {
    key_alias: "core-routing",
    metadata: { purpose: "private-product-routing" },
    models: ["fixture-model"],
    user_id: "inference-core",
  })
  assert.equal(keyResponse.status, 200)
  assert.match(keyResponse.body?.key ?? "", /^sk-/)
  const routingKey = keyResponse.body.key
  await writeFile(
    browserConfigFile,
    `${JSON.stringify({
      adminKey,
      baseUrl,
      canaries,
      container: liteLlmContainer,
      dockerContext,
      routingKey,
    })}\n`,
    { mode: 0o600 },
  )
  if (serviceControl) {
    await writeFile(
      serviceControl.controlFile,
      await readFile(browserConfigFile),
      {
        mode: 0o600,
      },
    )
    await waitForStop(serviceControl.stopFile)
  }
  const browser = serviceControl ? null : await runBrowser(browserConfigFile)
  if (browser) {
    assert.equal(browser.status, "passed")
    assert.equal(
      browser.evidenceClass,
      "LOCAL_PRIVATE_LITELLM_INTEGRATION_ONLY",
    )
  }

  const retention = inspectRetention()
  assert.ok(retention.spendRows >= (serviceControl ? 0 : 3))
  const dump = postgres([
    "pg_dump",
    "--data-only",
    "--no-owner",
    "--no-privileges",
    "--dbname",
    database,
    "--username",
    databaseUser,
  ])
  const logs = docker(["logs", liteLlmContainer])
  assertNoSensitiveValues(
    [dump, logs],
    [
      ...Object.values(canaries),
      "fixture-stream-response",
      adminKey,
      routingKey,
      upstreamKey,
    ],
  )
  const portBinding = JSON.parse(
    docker([
      "inspect",
      "--format",
      "{{json .NetworkSettings.Ports}}",
      liteLlmContainer,
    ]),
  )
  assert.equal(portBinding["4000/tcp"]?.[0]?.HostIp, "127.0.0.1")
  assert.ok(upstreamRequests >= (serviceControl ? 0 : 3))
  evidence = {
    architecture: process.arch,
    ...(browser ? { browser } : {}),
    credentialMaterialPrinted: false,
    evidenceClass: serviceControl
      ? "LOCAL_INTEGRATED_CORE_COMPONENT_ONLY"
      : "LOCAL_PRIVATE_LITELLM_INTEGRATION_ONLY",
    image: LITELLM_IMAGE,
    privatePortBinding: "loopback-only-disposable-fixture",
    retention: {
      metadataRows: {
        messages: retention.messageMetadataRows,
        proxyRequest: retention.proxyRequestMetadataRows,
        response: retention.responseMetadataRows,
        spend: retention.spendRows,
      },
      workloadContentCanaries: 0,
    },
    status: "passed",
    temporaryStateRemoved: true,
    upstream: {
      implementation: "deterministic-openai-compatible",
      requests: upstreamRequests,
    },
  }
} catch (error) {
  failure = safeError(error)
} finally {
  const cleanupFailures = []
  if (created.liteLlm)
    collectCleanup(cleanupFailures, ["rm", "--force", liteLlmContainer])
  if (created.postgres)
    collectCleanup(cleanupFailures, ["rm", "--force", postgresContainer])
  if (created.network)
    collectCleanup(cleanupFailures, ["network", "rm", network])
  if (upstream) {
    try {
      await closeServer(upstream)
    } catch (error) {
      cleanupFailures.push(safeError(error))
    }
  }
  await rm(stateRoot, { force: true, recursive: true })
  if (
    created.liteLlm &&
    dockerResult(["inspect", liteLlmContainer]).status === 0
  ) {
    cleanupFailures.push(new Error("F0-L2 LiteLLM container remains."))
  }
  if (
    created.postgres &&
    dockerResult(["inspect", postgresContainer]).status === 0
  ) {
    cleanupFailures.push(new Error("F0-L2 PostgreSQL container remains."))
  }
  if (
    created.network &&
    dockerResult(["network", "inspect", network]).status === 0
  ) {
    cleanupFailures.push(new Error("F0-L2 Docker network remains."))
  }
  if (cleanupFailures.length > 0) {
    failure = new AggregateError(
      failure ? [failure, ...cleanupFailures] : cleanupFailures,
      "F0-L2 cleanup failed.",
    )
  }
}

if (failure) throw failure
assert.ok(evidence)
process.stdout.write(`${JSON.stringify(evidence)}\n`)

function liteLlmConfig(upstreamPort) {
  return [
    "model_list:",
    "  - model_name: fixture-model",
    "    litellm_params:",
    "      model: openai/fixture-model",
    `      api_base: http://host.docker.internal:${upstreamPort}/v1`,
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
    "  store_model_in_db: false",
    "  store_prompts_in_spend_logs: false",
    "",
  ].join("\n")
}

async function listenUpstream() {
  upstream = createServer((request, response) => {
    void handleUpstream(request, response).catch(() => {
      if (!response.headersSent)
        sendJson(response, 500, { error: "fixture_failure" })
      else response.destroy()
    })
  })
  await new Promise((resolveListen, rejectListen) => {
    upstream.once("error", rejectListen)
    upstream.listen(0, "0.0.0.0", resolveListen)
  })
  return upstream.address().port
}

async function handleUpstream(request, response) {
  if (request.headers.authorization !== `Bearer ${upstreamKey}`) {
    sendJson(response, 401, { error: "unauthorized" })
    return
  }
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    sendJson(response, 404, { error: "unsupported" })
    return
  }
  const body = await readJson(request)
  if (body?.model !== "fixture-model" || !Array.isArray(body.messages)) {
    sendJson(response, 400, { error: "invalid_request" })
    return
  }
  upstreamRequests += 1
  if (body.stream === true) {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/event-stream",
    })
    const chunks = [
      streamChunk({ delta: { role: "assistant" }, finish_reason: null }),
      streamChunk({
        delta: { content: "fixture-stream-response" },
        finish_reason: null,
      }),
      streamChunk({ delta: {}, finish_reason: "stop" }),
      JSON.stringify({
        choices: [],
        created: 1,
        id: "f0-l2-stream",
        model: "fixture-model",
        object: "chat.completion.chunk",
        usage: { completion_tokens: 2, prompt_tokens: 3, total_tokens: 5 },
      }),
    ]
    for (const chunk of chunks) response.write(`data: ${chunk}\n\n`)
    response.end("data: [DONE]\n\n")
    return
  }
  sendJson(response, 200, {
    choices: [
      {
        finish_reason: "stop",
        index: 0,
        message: { content: canaries.response, role: "assistant" },
      },
    ],
    created: 1,
    id: "f0-l2-completion",
    model: "fixture-model",
    object: "chat.completion",
    usage: { completion_tokens: 2, prompt_tokens: 3, total_tokens: 5 },
  })
}

function streamChunk({ delta, finish_reason }) {
  return JSON.stringify({
    choices: [{ delta, finish_reason, index: 0 }],
    created: 1,
    id: "f0-l2-stream",
    model: "fixture-model",
    object: "chat.completion.chunk",
  })
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error("Fixture request exceeded its limit.")
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
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

async function runBrowser(configFile) {
  const child = spawn(
    process.execPath,
    [
      resolve(
        repositoryRoot,
        "scripts/pre-genesis/reduced-core-browser-session.mjs",
      ),
      "--litellm",
    ],
    {
      cwd: repositoryRoot,
      env: childEnvironment(configFile),
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => {
    stdout += chunk
    if (stdout.length > 64 * 1024 * 1024) child.kill("SIGTERM")
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk
    if (stderr.length > 64 * 1024 * 1024) child.kill("SIGTERM")
  })
  const timeout = setTimeout(() => child.kill("SIGTERM"), 15 * 60 * 1000)
  const status = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit)
    child.once("exit", resolveExit)
  })
  clearTimeout(timeout)
  if (status !== 0) {
    throw new Error(`F0-L2 browser proof failed: ${sanitize(stderr || stdout)}`)
  }
  return JSON.parse(stdout.trim().split("\n").at(-1))
}

function inspectRetention() {
  const result = postgres([
    "psql",
    "--no-align",
    "--no-psqlrc",
    "--tuples-only",
    "--set",
    "ON_ERROR_STOP=1",
    "--dbname",
    database,
    "--username",
    databaseUser,
    "--command",
    `SELECT json_build_object(
      'spendRows', count(*)::integer,
      'messageMetadataRows', count(*) FILTER (WHERE COALESCE(messages::text, '') NOT IN ('', '[]', 'null'))::integer,
      'responseMetadataRows', count(*) FILTER (WHERE COALESCE(response::text, '') NOT IN ('', '{}', 'null'))::integer,
      'proxyRequestMetadataRows', count(*) FILTER (WHERE COALESCE(proxy_server_request::text, '') NOT IN ('', '{}', 'null'))::integer
    ) FROM "LiteLLM_SpendLogs";`,
  ])
  return JSON.parse(result.trim())
}

function assertLockedImageIdentity() {
  const inventory = JSON.parse(
    spawnSync("git", ["show", "HEAD:infra/release/core-image-inventory.json"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).stdout,
  )
  const liteLlm = inventory.components.find(({ id }) => id === "litellm")
  const postgresImage = inventory.components.find(
    ({ id }) => id === "product-postgresql",
  )
  assert.equal(
    LITELLM_IMAGE,
    `${liteLlm.repository}:${liteLlm.version}@${liteLlm.indexDigest}`,
  )
  assert.equal(
    POSTGRES_IMAGE,
    `${postgresImage.repository}:${postgresImage.version}@${postgresImage.indexDigest}`,
  )
}

async function waitForPostgres() {
  const deadline = performance.now() + 60_000
  while (performance.now() < deadline) {
    const result = dockerResult([
      "exec",
      postgresContainer,
      "pg_isready",
      "--dbname",
      database,
      "--username",
      databaseUser,
    ])
    if (result.status === 0) return
    await delay(250)
  }
  throw new Error("F0-L2 PostgreSQL did not become ready.")
}

async function waitForLiteLlmPort(expectedPort) {
  const deadline = performance.now() + 60_000
  while (performance.now() < deadline) {
    const output = dockerResult(["port", liteLlmContainer, "4000/tcp"])
    const match = output.stdout.match(/127\.0\.0\.1:(\d+)$/m)
    if (output.status === 0 && match) {
      const port = Number.parseInt(match[1], 10)
      assert.equal(port, expectedPort)
      return port
    }
    await delay(250)
  }
  throw new Error("F0-L2 could not resolve the LiteLLM port.")
}

function reservePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createNetServer()
    server.once("error", rejectPort)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      assert.ok(address && typeof address === "object")
      server.close((error) =>
        error ? rejectPort(error) : resolvePort(address.port),
      )
    })
  })
}

async function waitForLiteLlm(baseUrl) {
  const deadline = performance.now() + 120_000
  while (performance.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/v1/models`, {
        headers: { authorization: `Bearer ${adminKey}` },
        signal: AbortSignal.timeout(2_000),
      })
      if (response.ok) return
    } catch {}
    await delay(500)
  }
  throw new Error("F0-L2 LiteLLM did not become ready.")
}

async function requestJson(url, token, body) {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  })
  return { body: await response.json(), status: response.status }
}

function postgres(arguments_) {
  return docker(["exec", postgresContainer, ...arguments_])
}

function docker(arguments_) {
  const result = dockerResult(arguments_)
  if (result.status !== 0) {
    throw new Error(`F0-L2 Docker command failed: ${sanitize(result.stderr)}`)
  }
  return result.stdout
}

function dockerResult(arguments_) {
  return spawnSync("docker", ["--context", dockerContext, ...arguments_], {
    encoding: "utf8",
    env: { LANG: "C", LC_ALL: "C", PATH: process.env.PATH ?? "" },
    maxBuffer: 64 * 1024 * 1024,
  })
}

function childEnvironment(configFile) {
  const environment = {
    F0_L2_LITELLM_CONFIG_FILE: configFile,
    LANG: "C",
    LC_ALL: "C",
    PATH: process.env.PATH ?? "",
  }
  if (process.env.PLAYWRIGHT_CHROME_EXECUTABLE) {
    environment.PLAYWRIGHT_CHROME_EXECUTABLE =
      process.env.PLAYWRIGHT_CHROME_EXECUTABLE
  }
  return environment
}

function serviceControlFromEnvironment() {
  const controlFile = process.env.F0_C1_SERVICE_CONTROL_FILE?.trim()
  const stopFile = process.env.F0_C1_SERVICE_STOP_FILE?.trim()
  if (!controlFile && !stopFile) return null
  if (
    !controlFile ||
    !stopFile ||
    !isAbsolute(controlFile) ||
    !isAbsolute(stopFile)
  ) {
    throw new Error("F0-C1 LiteLLM service control is invalid.")
  }
  return { controlFile, stopFile }
}

async function waitForStop(path) {
  for (;;) {
    try {
      await access(path)
      return
    } catch {}
    await delay(100)
  }
}

function assertNoSensitiveValues(values, sensitiveValues) {
  for (const value of values) {
    for (const sensitiveValue of sensitiveValues) {
      if (String(value).includes(sensitiveValue)) {
        throw new Error("F0-L2 retained workload or credential content.")
      }
    }
  }
}

function collectCleanup(failures, arguments_) {
  const result = dockerResult(arguments_)
  if (result.status !== 0) failures.push(safeError(result.stderr))
}

function closeServer(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()))
  })
}

function required(name) {
  const value = process.env[name]?.trim()
  if (!value || !/^[A-Za-z0-9_.-]{1,128}$/.test(value)) {
    throw new Error(`F0-L2 requires a valid ${name}.`)
  }
  return value
}

function opaqueValue() {
  return randomBytes(32).toString("base64url")
}

function sanitize(value) {
  let output = String(value)
  for (const sensitive of [
    databasePassword,
    adminKey,
    saltKey,
    upstreamKey,
    ...Object.values(canaries),
  ]) {
    output = output.replaceAll(sensitive, "[redacted]")
  }
  return output
    .replaceAll(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replaceAll(/[A-Za-z0-9_-]{43,}/g, "[opaque]")
    .slice(-8_000)
}

function safeError(error) {
  const value =
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  return new Error(sanitize(value))
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}
