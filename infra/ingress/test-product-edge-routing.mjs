#!/usr/bin/env node

import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(moduleDirectory, "../..")
const consoleHost = "console.edge.test"
const imageInventoryPath = resolve(
  repositoryRoot,
  "infra/release/core-image-inventory.json",
)
const templatePath = resolve(
  repositoryRoot,
  "infra/ingress/product-edge.nginx.conf.template",
)

let container = null
let stateRoot = null
let web = null

try {
  const webPort = await reservePort()
  stateRoot = await mkdtemp(join(tmpdir(), "llmm-product-edge-routing."))
  const certificatePath = join(stateRoot, "certificate.pem")
  const keyPath = join(stateRoot, "private-key.pem")
  createCertificate(certificatePath, keyPath)

  web = startWeb(webPort)
  await waitForWeb(webPort, web)

  const configPath = join(stateRoot, "product-edge.nginx.conf")
  await writeFile(configPath, await renderConfig(webPort), { mode: 0o600 })
  const image = await productEdgeImage()
  container = startEdge({ certificatePath, configPath, image, keyPath })
  const edgePort = edgePublishedPort(container)
  await waitForEdge(edgePort, container)

  const proof = await proveRouting(edgePort)
  process.stdout.write(`${JSON.stringify({ proof, status: "PASS" })}\n`)
} finally {
  if (container) {
    run("docker", ["rm", "--force", container], { allowFailure: true })
  }
  if (web) {
    web.kill("SIGTERM")
    await waitForExit(web, 5_000)
    if (web.exitCode === null) web.kill("SIGKILL")
  }
  if (stateRoot) await rm(stateRoot, { force: true, recursive: true })
}

async function proveRouting(edgePort) {
  const legacyList = await edgeRequest(edgePort, {
    method: "GET",
    path: "/applications?tab=credentials",
  })
  assertRedirect(legacyList, "/keys", "?tab=credentials")

  const legacyHead = await edgeRequest(edgePort, {
    method: "HEAD",
    path: "/applications/apps/key-1?tab=usage",
  })
  assertRedirect(legacyHead, "/keys/apps/key-1", "?tab=usage")

  const legacyAction = await edgeRequest(edgePort, {
    body: "proof=legacy",
    headers: { "next-action": "runtime-routing-proof" },
    method: "POST",
    path: "/applications/apps/new?source=legacy",
  })
  assertRedirect(legacyAction, "/keys/apps/new", "?source=legacy")
  const legacyActionFollow = await edgeRequest(edgePort, {
    body: "proof=legacy",
    headers: { "next-action": "runtime-routing-proof" },
    method: "POST",
    path: "/keys/apps/new?source=legacy",
  })
  assertSignInRedirect(legacyActionFollow, "/keys/apps/new?source=legacy")

  const canonicalList = await edgeRequest(edgePort, {
    method: "GET",
    path: "/keys",
  })
  assertSignInRedirect(canonicalList, "/keys")

  const canonicalNew = await edgeRequest(edgePort, {
    method: "GET",
    path: "/keys/apps/new?source=canonical",
  })
  assertSignInRedirect(canonicalNew, "/keys/apps/new?source=canonical")

  const canonicalHead = await edgeRequest(edgePort, {
    method: "HEAD",
    path: "/keys/apps/key-1",
  })
  assertSignInRedirect(canonicalHead, "/keys/apps/key-1")

  const canonicalDetail = await edgeRequest(edgePort, {
    method: "GET",
    path: "/keys/apps/key-1?tab=usage",
  })
  assertSignInRedirect(canonicalDetail, "/keys/apps/key-1?tab=usage")

  const canonicalAction = await edgeRequest(edgePort, {
    body: "proof=canonical",
    headers: { "next-action": "runtime-routing-proof" },
    method: "POST",
    path: "/keys/apps/new",
  })
  assertSignInRedirect(canonicalAction, "/keys/apps/new")

  const canonicalDetailAction = await edgeRequest(edgePort, {
    body: "proof=canonical-detail",
    headers: { "next-action": "runtime-routing-proof" },
    method: "POST",
    path: "/keys/apps/key-1?tab=settings",
  })
  assertSignInRedirect(canonicalDetailAction, "/keys/apps/key-1?tab=settings")

  const missingActionHeader = await edgeRequest(edgePort, {
    method: "POST",
    path: "/keys/apps/new",
  })
  assert.equal(missingActionHeader.status, 405)

  const unsupportedMethod = await edgeRequest(edgePort, {
    method: "DELETE",
    path: "/keys/apps/key-1",
  })
  assert.equal(unsupportedMethod.status, 403)

  const unrelatedPath = await edgeRequest(edgePort, {
    method: "GET",
    path: "/keys/unrelated",
  })
  assert.equal(unrelatedPath.status, 404)

  const oversizedAction = await edgeRequest(edgePort, {
    body: "x".repeat(1024 * 1024 + 1),
    headers: { "next-action": "runtime-routing-proof" },
    method: "POST",
    path: "/keys/apps/new",
  })
  assert.equal(oversizedAction.status, 413)

  assert.notEqual(canonicalList.headers.location, "/applications")
  return {
    canonical: {
      detailGet: canonicalDetail.status,
      detailHead: canonicalHead.status,
      detailPost: canonicalDetailAction.status,
      listGet: canonicalList.status,
      newGet: canonicalNew.status,
      newPost: canonicalAction.status,
    },
    legacyRedirects: {
      actionPost: legacyAction.status,
      actionPostFollow: legacyActionFollow.status,
      detailHead: legacyHead.status,
      listGet: legacyList.status,
    },
    negative: {
      missingActionHeader: missingActionHeader.status,
      oversizedAction: oversizedAction.status,
      unrelatedPath: unrelatedPath.status,
      unsupportedMethod: unsupportedMethod.status,
    },
  }
}

function assertRedirect(response, pathname, search) {
  assert.equal(response.status, 307)
  const location = new URL(response.headers.location, `https://${consoleHost}`)
  assert.equal(location.pathname, pathname)
  assert.equal(location.search, search)
}

function assertSignInRedirect(response, returnTo) {
  assert.equal(response.status, 307)
  const location = new URL(response.headers.location, `https://${consoleHost}`)
  assert.equal(location.pathname, "/auth/signin")
  assert.equal(location.searchParams.get("returnTo"), returnTo)
}

async function renderConfig(webPort) {
  let config = await readFile(templatePath, "utf8")
  const replacements = {
    "@@PRODUCT_API_HOST@@": "api.edge.test",
    "@@PRODUCT_CONSOLE_HOST@@": consoleHost,
    "@@PRODUCT_FIRECRAWL_HOST@@": "firecrawl.edge.test",
    "@@PRODUCT_GRAFANA_HOST@@": "grafana.edge.test",
    "@@PRODUCT_IDENTITY_HOST@@": "identity.edge.test",
    "@@PRODUCT_KEYCLOAK_ADMIN_HOST@@": "keycloak.edge.test",
    "@@PRODUCT_LITELLM_HOST@@": "litellm.edge.test",
    "server console-bff:4001;": `server host.docker.internal:${webPort};`,
    "server console-web:3000;": `server host.docker.internal:${webPort};`,
    "server grafana:3000;": `server host.docker.internal:${webPort};`,
    "server keycloak:8080;": `server host.docker.internal:${webPort};`,
    "server litellm:4000;": `server host.docker.internal:${webPort};`,
  }
  for (const [source, replacement] of Object.entries(replacements)) {
    assert.match(config, new RegExp(escapeRegExp(source)))
    config = config.replaceAll(source, replacement)
  }
  assert.doesNotMatch(config, /@@[A-Z0-9_]+@@|server [a-z-]+:\d+;/)
  return config
}

async function productEdgeImage() {
  const inventory = JSON.parse(await readFile(imageInventoryPath, "utf8"))
  const component = inventory.components?.find(
    ({ id }) => id === "product-edge",
  )
  assert.equal(component?.repository, "docker.io/library/nginx")
  assert.equal(component?.version, "1.29.1-alpine")
  assert.match(component?.indexDigest ?? "", /^sha256:[a-f0-9]{64}$/)
  const image = `${component.repository}:${component.version}@${component.indexDigest}`
  const inspected = run("docker", ["image", "inspect", image], {
    allowFailure: true,
  })
  if (inspected.status !== 0) {
    run("docker", ["pull", "--platform", "linux/amd64", image])
  }
  return image
}

function startEdge({ certificatePath, configPath, image, keyPath }) {
  const name = `llmm-product-edge-routing-${process.pid}`
  const uid = process.getuid?.()
  const gid = process.getgid?.()
  assert.ok(Number.isSafeInteger(uid) && Number.isSafeInteger(gid))
  const tmpfsOwnership = `uid=${uid},gid=${gid},mode=0700`
  const result = run("docker", [
    "run",
    "--detach",
    "--name",
    name,
    "--platform",
    "linux/amd64",
    "--user",
    `${uid}:${gid}`,
    "--read-only",
    "--cap-drop",
    "ALL",
    "--cap-add",
    "NET_BIND_SERVICE",
    "--security-opt",
    "no-new-privileges=true",
    "--add-host",
    "host.docker.internal:host-gateway",
    "--publish",
    "127.0.0.1::443",
    "--tmpfs",
    `/var/cache/nginx:rw,noexec,nosuid,nodev,size=16m,${tmpfsOwnership}`,
    "--tmpfs",
    `/var/log/nginx:rw,noexec,nosuid,nodev,size=16m,${tmpfsOwnership}`,
    "--tmpfs",
    `/var/run:rw,noexec,nosuid,nodev,size=4m,${tmpfsOwnership}`,
    "--mount",
    `type=bind,src=${configPath},dst=/etc/nginx/nginx.conf,readonly`,
    "--mount",
    `type=bind,src=${certificatePath},dst=/run/secrets/llmm_edge_tls_certificate,readonly`,
    "--mount",
    `type=bind,src=${keyPath},dst=/run/secrets/llmm_edge_tls_private_key,readonly`,
    "--mount",
    `type=bind,src=${moduleDirectory},dst=/etc/nginx/llm-machines,readonly`,
    image,
  ])
  assert.match(result.stdout.trim(), /^[a-f0-9]{64}$/)
  return name
}

function edgePublishedPort(name) {
  const result = run("docker", ["port", name, "443/tcp"])
  const match = result.stdout.trim().match(/127\.0\.0\.1:(\d+)$/)
  assert.ok(match)
  return Number.parseInt(match[1], 10)
}

function startWeb(port) {
  const child = spawn(
    "corepack",
    [
      "pnpm",
      "--filter",
      "@llm-machines/web",
      "--fail-if-no-match",
      "exec",
      "next",
      "dev",
      "--hostname",
      "0.0.0.0",
      "--port",
      String(port),
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        CONSOLE_BFF_SERVICE_API_KEY: "runtime-routing-proof-only",
        CONSOLE_BFF_URL: "http://127.0.0.1:9",
        NEXT_TELEMETRY_DISABLED: "1",
        WEB_CONSOLE_ORIGIN: `https://${consoleHost}`,
        WEB_IDENTITY_ORIGIN: "https://identity.edge.test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  child.output = ""
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      child.output = `${child.output}${chunk}`.slice(-8_192)
    })
  }
  return child
}

async function waitForWeb(port, child) {
  try {
    await eventually(async () => {
      if (child.exitCode !== null) {
        throw new Error(`Console Web exited early: ${child.output}`)
      }
      const response = await plainRequest(port, "/auth/signin")
      return Number.isInteger(response.status)
    })
  } catch (error) {
    throw new Error(
      `Console Web readiness failed: ${child.output || "no process output"}`,
      { cause: error },
    )
  }
}

async function waitForEdge(port, name) {
  try {
    await eventually(async () => {
      const state = run(
        "docker",
        ["inspect", "--format", "{{.State.Status}}", name],
        { allowFailure: true },
      )
      const status = state.stdout.trim()
      if (state.status !== 0 || ["dead", "exited"].includes(status)) {
        const logs = run("docker", ["logs", name], { allowFailure: true })
        throw new Error(
          `Product edge exited early: ${logs.stderr}${logs.stdout}`,
        )
      }
      if (status !== "running") return false
      return (
        (await edgeRequest(port, { method: "GET", path: "/keys" })).status ===
        307
      )
    })
  } catch (error) {
    const state = run(
      "docker",
      ["inspect", "--format", "{{json .State}}", name],
      { allowFailure: true },
    )
    const logs = run("docker", ["logs", name], { allowFailure: true })
    throw new Error(
      `Product edge readiness failed: ${`${state.stdout}${logs.stderr}${logs.stdout}`.slice(-8_192)}`,
      { cause: error },
    )
  }
}

function edgeRequest(port, { body, headers = {}, method, path }) {
  const encodedBody = body === undefined ? undefined : Buffer.from(body)
  return requestResult(
    httpsRequest,
    {
      headers: {
        host: consoleHost,
        ...(encodedBody
          ? { "content-length": String(encodedBody.length) }
          : {}),
        ...headers,
      },
      host: "127.0.0.1",
      method,
      path,
      port,
      rejectUnauthorized: false,
      servername: consoleHost,
    },
    encodedBody,
  )
}

function plainRequest(port, path) {
  return requestResult(httpRequest, {
    host: "127.0.0.1",
    method: "GET",
    path,
    port,
  })
}

function requestResult(request, options, body) {
  return new Promise((resolve, reject) => {
    const outgoing = request(options, (response) => {
      response.resume()
      response.on("end", () =>
        resolve({ headers: response.headers, status: response.statusCode }),
      )
    })
    outgoing.on("error", reject)
    outgoing.end(body)
  })
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  assert.equal(typeof address, "object")
  const port = address.port
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return port
}

function createCertificate(certificatePath, keyPath) {
  run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    `/CN=${consoleHost}`,
    "-keyout",
    keyPath,
    "-out",
    certificatePath,
  ])
}

async function eventually(operation, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      if (await operation()) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw lastError ?? new Error("Timed out waiting for runtime routing proof.")
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  })
  if (!allowFailure && result.status !== 0) {
    throw new Error(
      `${command} failed: ${(result.stderr || result.stdout || "no output").slice(-4_096)}`,
    )
  }
  return result
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve()
  return Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ])
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
