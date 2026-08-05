import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createWriteStream } from "node:fs"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer, request as httpRequest } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const checkMode = process.argv.includes("--check")

const runtime = await startReducedCoreDevelopmentRuntime()

if (checkMode) {
  try {
    await verifyRuntime(runtime)
  } finally {
    await runtime.close()
  }
  process.stdout.write(
    `${JSON.stringify({
      architecture: process.arch,
      credentialMaterialPrinted: false,
      evidenceClass: "LOCAL_DETERMINISTIC_CONTROL_PLANE_ONLY",
      services: runtime.publicSummary.services,
      status: "passed",
      temporaryStateRemoved: true,
    })}\n`,
  )
} else {
  process.stdout.write(`${JSON.stringify(runtime.publicSummary, null, 2)}\n`)
  process.stdout.write("Press Ctrl-C to stop and remove temporary state.\n")
  await holdUntilSignal(runtime)
}

async function startReducedCoreDevelopmentRuntime() {
  const stateRoot = await mkdtemp(join(tmpdir(), "llmm-reduced-core-dev-"))
  await chmod(stateRoot, 0o700)
  const credentials = {
    bffServiceApiKey: randomBytes(32).toString("base64url"),
    liteLlmApiKey: randomBytes(32).toString("base64url"),
  }
  await writeFile(
    join(stateRoot, "throwaway-credentials.json"),
    `${JSON.stringify(credentials)}\n`,
    { mode: 0o600 },
  )

  const ports = await reservePorts(4)
  const [bffPort, webPort, edgePort, inferencePort] = ports
  const children = []
  const servers = []

  try {
    await runCommand(["corepack", "pnpm", "install", "--frozen-lockfile"])
    const inference = createInferenceDouble(credentials.liteLlmApiKey)
    await listen(inference, inferencePort)
    servers.push(inference)

    await runCommand([
      "corepack",
      "pnpm",
      "--filter",
      "@llm-machines/contracts",
      "build",
    ])
    await runCommand([
      "corepack",
      "pnpm",
      "--filter",
      "@llm-machines/copy",
      "build",
    ])

    children.push(
      startChild(
        "bff",
        [
          "corepack",
          "pnpm",
          "--filter",
          "@llm-machines/bff",
          "exec",
          "tsx",
          "src/index.ts",
        ],
        {
          BFF_FIXTURE_MODE: "true",
          BFF_FALLBACK_MODELS: "fixture-model",
          BFF_SERVICE_API_KEY: credentials.bffServiceApiKey,
          CONNECTED_APPS_BFF_BASE_URL: `http://api.localhost:${edgePort}`,
          CONNECTED_APPS_KEYCLOAK_FIXTURE: "true",
          FIRECRAWL_PUBLIC_BASE_URL: `http://firecrawl.localhost:${edgePort}`,
          HOST: "127.0.0.1",
          LITELLM_KEY: credentials.liteLlmApiKey,
          LITELLM_URL: `http://127.0.0.1:${inferencePort}`,
          NODE_ENV: "test",
          PORT: String(bffPort),
          PRODUCT_API_HOST: "api.localhost",
          PRODUCT_IDENTITY_HOST: "identity.localhost",
          PUBLIC_BFF_BASE_URL: `http://api.localhost:${edgePort}`,
        },
        stateRoot,
      ),
    )
    children.push(
      startChild(
        "web",
        [
          "corepack",
          "pnpm",
          "--filter",
          "@llm-machines/web",
          "exec",
          "next",
          "dev",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(webPort),
        ],
        {
          CONSOLE_BFF_SERVICE_API_KEY: credentials.bffServiceApiKey,
          CONSOLE_BFF_URL: `http://127.0.0.1:${bffPort}`,
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stateRoot,
      ),
    )

    await waitForHttp(`http://127.0.0.1:${bffPort}/livez`)
    await waitForHttp(`http://127.0.0.1:${webPort}/auth/signin`)

    const edge = createDevelopmentEdge({ bffPort, webPort })
    await listen(edge, edgePort)
    servers.push(edge)

    const services = {
      api: `http://api.localhost:${edgePort}`,
      console: `http://console.localhost:${edgePort}`,
      firecrawl: `http://firecrawl.localhost:${edgePort}`,
      identity: `http://identity.localhost:${edgePort}`,
    }
    await writeFile(
      join(stateRoot, "runtime.json"),
      `${JSON.stringify({
        evidenceClass: "LOCAL_DETERMINISTIC_CONTROL_PLANE_ONLY",
        ports: { bffPort, edgePort, inferencePort, webPort },
        services,
      })}\n`,
      { mode: 0o600 },
    )

    return {
      adminHeaders: {
        authorization: `Bearer ${credentials.bffServiceApiKey}`,
        "x-llm-machines-user-email": "local-admin@example.test",
        "x-llm-machines-user-roles": "admin",
        "x-llm-machines-user-sub": "local-admin",
      },
      bffOrigin: `http://127.0.0.1:${bffPort}`,
      async close() {
        await Promise.allSettled(servers.map(closeServer))
        await Promise.allSettled(children.map(stopChild))
        await rm(stateRoot, { force: true, recursive: true })
      },
      publicSummary: {
        evidenceClass: "LOCAL_DETERMINISTIC_CONTROL_PLANE_ONLY",
        limitations: [
          "HTTP authority router is not Product Nginx or TLS evidence.",
          "Identity is intentionally unavailable; Keycloak login is not qualified.",
          "Inference is deterministic and is not SGLang or capacity evidence.",
          "Application metadata is in-memory; created temporary files are removed on shutdown.",
        ],
        services,
        stateRoot,
      },
    }
  } catch (error) {
    await Promise.allSettled(servers.map(closeServer))
    await Promise.allSettled(children.map(stopChild))
    await rm(stateRoot, { force: true, recursive: true })
    throw error
  }
}

function createInferenceDouble(apiKey) {
  return createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      sendJson(response, 401, { error: { message: "Unauthorized" } })
      return
    }
    if (request.method === "GET" && request.url === "/v1/models") {
      sendJson(response, 200, {
        data: [{ id: "fixture-model", object: "model" }],
        object: "list",
      })
      return
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      sendJson(response, 404, { error: { message: "Unsupported route" } })
      return
    }
    const body = await readJsonBody(request)
    if (!body || body.model !== "fixture-model") {
      sendJson(response, 400, { error: { message: "Invalid fixture request" } })
      return
    }
    if (body.stream === true) {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/event-stream",
      })
      response.write(
        `data: ${JSON.stringify({
          choices: [{ delta: { content: "fixture-response" }, index: 0 }],
          id: "chatcmpl-fixture",
          model: "fixture-model",
          object: "chat.completion.chunk",
        })}\n\n`,
      )
      response.write(
        `data: ${JSON.stringify({
          choices: [],
          id: "chatcmpl-fixture",
          model: "fixture-model",
          object: "chat.completion.chunk",
          usage: { completion_tokens: 2, prompt_tokens: 3, total_tokens: 5 },
        })}\n\n`,
      )
      response.end("data: [DONE]\n\n")
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
  })
}

function createDevelopmentEdge({ bffPort, webPort }) {
  return createServer((request, response) => {
    const host = (request.headers.host ?? "").split(":", 1)[0].toLowerCase()
    if (host === "console.localhost") {
      proxyRequest(request, response, webPort, request.url ?? "/", "console")
      return
    }
    if (host === "api.localhost") {
      const target =
        request.url === "/v1/models" && request.method === "GET"
          ? "/api/app-gateway/v1/models"
          : request.url === "/v1/chat/completions" && request.method === "POST"
            ? "/api/app-gateway/v1/chat/completions"
            : null
      if (target) {
        proxyRequest(request, response, bffPort, target, "api")
      } else {
        sendJson(response, 404, { error: { message: "Unsupported API route" } })
      }
      return
    }
    if (host === "firecrawl.localhost") {
      const supported =
        request.method === "POST" &&
        (request.url === "/v2/search" || request.url === "/v2/scrape")
      if (supported) {
        proxyRequest(request, response, bffPort, request.url, "api")
      } else {
        sendJson(response, 404, {
          error: { message: "Unsupported Firecrawl route" },
        })
      }
      return
    }
    if (host === "identity.localhost") {
      sendJson(response, 503, {
        code: "identity_double_not_started",
        detail: "Keycloak is outside the local deterministic bootstrap lane.",
      })
      return
    }
    sendJson(response, 421, { error: { message: "Unknown authority" } })
  })
}

function proxyRequest(incoming, outgoing, port, path, profile) {
  const headers = normalizedProxyHeaders(incoming.headers, profile)
  const upstream = httpRequest(
    {
      headers,
      host: "127.0.0.1",
      method: incoming.method,
      path,
      port,
    },
    (upstreamResponse) => {
      outgoing.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers,
      )
      upstreamResponse.pipe(outgoing)
    },
  )
  upstream.on("error", () => {
    if (!outgoing.headersSent) {
      sendJson(outgoing, 502, { error: { message: "Upstream unavailable" } })
    } else {
      outgoing.destroy()
    }
  })
  incoming.pipe(upstream)
}

function normalizedProxyHeaders(headers, profile) {
  const allowed =
    profile === "console"
      ? ["accept", "accept-encoding", "content-type", "cookie", "user-agent"]
      : ["accept", "authorization", "content-length", "content-type"]
  return Object.fromEntries(
    allowed.flatMap((name) => {
      const value = headers[name]
      return value === undefined ? [] : [[name, value]]
    }),
  )
}

async function verifyRuntime(runtime) {
  const liveness = await fetch(`${runtime.bffOrigin}/livez`)
  if (!liveness.ok) {
    throw new Error("BFF liveness failed.")
  }
  const consoleResponse = await fetch(runtime.publicSummary.services.console, {
    redirect: "manual",
  })
  if (consoleResponse.status >= 500) {
    throw new Error("Console Web bootstrap failed.")
  }
  const identityResponse = await fetch(
    `${runtime.publicSummary.services.identity}/realms/llm-machines`,
  )
  if (identityResponse.status !== 503) {
    throw new Error("Identity double did not fail closed.")
  }
  const unknownResponse = await fetch(
    `${runtime.publicSummary.services.api}/native/admin`,
  )
  if (unknownResponse.status !== 404) {
    throw new Error("Local authority router exposed an unsupported API route.")
  }
}

async function holdUntilSignal(runtime) {
  await new Promise((resolveSignal) => {
    const stop = () => resolveSignal()
    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
  })
  await runtime.close()
}

function startChild(name, command, environment, stateRoot) {
  const stdout = createWriteStream(join(stateRoot, `${name}.stdout.log`), {
    flags: "a",
    mode: 0o600,
  })
  const stderr = createWriteStream(join(stateRoot, `${name}.stderr.log`), {
    flags: "a",
    mode: 0o600,
  })
  const child = spawn(command[0], command.slice(1), {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout.pipe(stdout)
  child.stderr.pipe(stderr)
  return { child, name, stderr, stdout }
}

async function stopChild(record) {
  if (record.child.exitCode === null && record.child.signalCode === null) {
    record.child.kill("SIGTERM")
    await Promise.race([
      new Promise((resolveExit) => record.child.once("exit", resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
    ])
    if (record.child.exitCode === null && record.child.signalCode === null) {
      record.child.kill("SIGKILL")
    }
  }
  record.stdout.end()
  record.stderr.end()
}

async function runCommand(command) {
  await new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: repositoryRoot,
      env: process.env,
      stdio: "ignore",
    })
    child.once("error", rejectCommand)
    child.once("exit", (code) => {
      if (code === 0) {
        resolveCommand()
      } else {
        rejectCommand(new Error(`${command.join(" ")} exited with ${code}.`))
      }
    })
  })
}

async function reservePorts(count) {
  const reservations = []
  try {
    for (let index = 0; index < count; index += 1) {
      const server = createServer()
      await listen(server, 0)
      reservations.push(server)
    }
    return reservations.map((server) => {
      const address = server.address()
      if (!address || typeof address === "string") {
        throw new Error("Could not reserve a local port.")
      }
      return address.port
    })
  } finally {
    await Promise.allSettled(reservations.map(closeServer))
  }
}

async function waitForHttp(url) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" })
      if (response.status < 500) {
        return
      }
    } catch {
      // The child is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`Timed out waiting for ${new URL(url).pathname}.`)
}

function listen(server, port) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen)
    server.listen(port, "127.0.0.1", resolveListen)
  })
}

function closeServer(server) {
  return new Promise((resolveClose) => server.close(() => resolveClose()))
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 1024 * 1024) {
      return null
    }
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    return null
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json",
  })
  response.end(`${JSON.stringify(body)}\n`)
}
