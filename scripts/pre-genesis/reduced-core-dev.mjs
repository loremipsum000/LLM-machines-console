import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createWriteStream } from "node:fs"
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { createServer, request as httpRequest } from "node:http"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const checkMode = process.argv.includes("--check")
const verticalSliceMode = process.argv.includes("--vertical-slice")

if (checkMode && verticalSliceMode) {
  throw new Error("Choose either --check or --vertical-slice, not both.")
}

class ShutdownRequestedError extends Error {}

let shutdownRequested = false
let resolveShutdown
const shutdownSignal = new Promise((resolveSignal) => {
  resolveShutdown = resolveSignal
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    shutdownRequested = true
    resolveShutdown(signal)
  })
}

let runtime
try {
  runtime = await startReducedCoreDevelopmentRuntime()
} catch (error) {
  if (!(error instanceof ShutdownRequestedError)) {
    throw error
  }
}

if (!runtime) {
  process.exitCode = 130
} else if (shutdownRequested) {
  await runtime.close()
  process.exitCode = 130
} else if (checkMode) {
  try {
    await Promise.race([verifyRuntime(runtime), runtime.failureSignal])
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
} else if (verticalSliceMode) {
  let result
  try {
    result = await Promise.race([
      verifyApplicationInferenceVerticalSlice(runtime),
      runtime.failureSignal,
      shutdownFailure(),
    ])
  } catch (error) {
    if (!(error instanceof ShutdownRequestedError)) {
      throw error
    }
    process.exitCode = 130
  } finally {
    await runtime.close()
  }
  if (result) {
    process.stdout.write(
      `${JSON.stringify({
        architecture: process.arch,
        credentialMaterialPrinted: false,
        evidenceClass: "LOCAL_DETERMINISTIC_APPLICATION_FLOW_ONLY",
        flow: result,
        services: runtime.publicSummary.services,
        status: "passed",
        temporaryStateRemoved: true,
      })}\n`,
    )
  }
} else {
  process.stdout.write(`${JSON.stringify(runtime.publicSummary, null, 2)}\n`)
  process.stdout.write("Press Ctrl-C to stop and remove temporary state.\n")
  try {
    if (!shutdownRequested) {
      await Promise.race([shutdownSignal, runtime.failureSignal])
    }
  } finally {
    await runtime.close()
  }
}

async function shutdownFailure() {
  await shutdownSignal
  throw new ShutdownRequestedError()
}

async function startReducedCoreDevelopmentRuntime() {
  await assertDevelopmentDependenciesReady()
  ensureStartupActive()
  const stateRoot = await createTemporaryStateRoot()
  const children = []
  const servers = []
  const beforeRemoveChecks = []
  const runtimeFailure = createRuntimeFailure()
  const close = createRuntimeCleanup({
    beforeRemoveChecks,
    children,
    servers,
    stateRoot,
  })

  try {
    await chmod(stateRoot, 0o700)
    const credentials = {
      bffServiceApiKey: randomBytes(32).toString("base64url"),
      liteLlmApiKey: randomBytes(32).toString("base64url"),
    }
    const fixtureClock = verticalSliceMode
      ? await createFixtureClock(stateRoot)
      : null
    await writeFile(
      join(stateRoot, "throwaway-credentials.json"),
      `${JSON.stringify(credentials)}\n`,
      { mode: 0o600 },
    )
    ensureStartupActive()

    const ports = await reservePorts(4)
    const [bffPort, webPort, edgePort, inferencePort] = ports
    const webRoot = await prepareTemporaryWebProject(stateRoot)
    ensureStartupActive()

    const streamingProbe = verticalSliceMode ? createStreamingProbe() : null
    const inference = createInferenceDouble(
      credentials.liteLlmApiKey,
      streamingProbe,
    )
    servers.push(inference)
    await listen(inference, inferencePort)
    ensureStartupActive()

    children.push(
      startChild(
        "bff",
        [
          process.execPath,
          resolve(repositoryRoot, "apps/bff/node_modules/tsx/dist/cli.mjs"),
          resolve(repositoryRoot, "apps/bff/src/index.ts"),
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
          ...(fixtureClock?.environment ?? {}),
          PORT: String(bffPort),
          PRODUCT_API_HOST: "api.localhost",
          PRODUCT_IDENTITY_HOST: "identity.localhost",
          PUBLIC_BFF_BASE_URL: `http://api.localhost:${edgePort}`,
        },
        stateRoot,
        repositoryRoot,
        runtimeFailure.report,
      ),
    )
    children.push(
      startChild(
        "web",
        [
          process.execPath,
          resolve(repositoryRoot, "apps/web/node_modules/next/dist/bin/next"),
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
          NODE_ENV: "development",
        },
        stateRoot,
        webRoot,
        runtimeFailure.report,
      ),
    )

    await waitForHttp(`http://127.0.0.1:${bffPort}/livez`)
    ensureStartupActive()
    await waitForHttp(`http://127.0.0.1:${webPort}/auth/signin`)
    ensureStartupActive()

    const edge = createDevelopmentEdge({ bffPort, webPort })
    servers.push(edge)
    await listen(edge, edgePort)
    ensureStartupActive()

    const services = {
      api: `http://api.localhost:${edgePort}`,
      console: `http://console.localhost:${edgePort}`,
      firecrawl: `http://firecrawl.localhost:${edgePort}`,
      identity: `http://identity.localhost:${edgePort}`,
    }
    const processGroupIds = children.map(({ child }) => child.pid)
    await writeFile(
      join(stateRoot, "runtime.json"),
      `${JSON.stringify({
        evidenceClass: "LOCAL_DETERMINISTIC_CONTROL_PLANE_ONLY",
        ports: { bffPort, edgePort, inferencePort, webPort },
        processGroupIds,
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
      close,
      failureSignal: runtimeFailure.signal,
      fixtureClock,
      inferenceApiKey: credentials.liteLlmApiKey,
      inferenceOrigin: `http://127.0.0.1:${inferencePort}`,
      logPaths: children.flatMap((record) => [
        join(stateRoot, `${record.name}.stdout.log`),
        join(stateRoot, `${record.name}.stderr.log`),
      ]),
      nonRevealBodies: [],
      publicSummary: {
        evidenceClass: "LOCAL_DETERMINISTIC_CONTROL_PLANE_ONLY",
        limitations: [
          "HTTP authority router is not Product Nginx or TLS evidence.",
          "Identity is intentionally unavailable; Keycloak login is not qualified.",
          "Inference is deterministic and is not SGLang or capacity evidence.",
          "Run --vertical-slice for the deterministic F0-L1 Application credential and gateway flow.",
          "Application metadata is in-memory; created temporary files are removed on shutdown.",
        ],
        services,
        stateRoot,
      },
      registerBeforeRemoveCheck(check) {
        beforeRemoveChecks.push(check)
      },
      sensitiveRuntimeValues: Object.values(credentials),
      stateRoot,
      streamingProbe,
    }
  } catch (error) {
    await close()
    throw error
  }
}

function createInferenceDouble(apiKey, streamingProbe) {
  return createServer((request, response) => {
    void handleInferenceDoubleRequest(
      apiKey,
      streamingProbe,
      request,
      response,
    ).catch(() => {
      if (response.destroyed) {
        return
      }
      if (response.headersSent) {
        response.destroy()
      } else {
        sendJson(response, 400, { error: { message: "Invalid request body" } })
      }
    })
  })
}

async function handleInferenceDoubleRequest(
  apiKey,
  streamingProbe,
  request,
  response,
) {
  if (request.headers.authorization !== `Bearer ${apiKey}`) {
    sendJson(response, 401, { error: { message: "Unauthorized" } })
    return
  }
  if (request.method === "GET" && request.url === "/v1/models") {
    sendJson(response, 200, {
      data: [
        {
          id: "fixture-model",
          object: "model",
          owned_by: "llm-machines",
        },
      ],
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
    if (body.stream_options?.include_usage !== true) {
      sendJson(response, 400, {
        error: { message: "Streaming usage evidence is required" },
      })
      return
    }
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
    if (streamingProbe) {
      await streamingProbe.waitForTerminalRelease()
    }
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
  const liveness = await boundedFetch(`${runtime.bffOrigin}/livez`)
  if (!liveness.ok) {
    throw new Error("BFF liveness failed.")
  }
  const consoleResponse = await boundedFetch(
    runtime.publicSummary.services.console,
    { redirect: "manual" },
  )
  if (consoleResponse.status >= 500) {
    throw new Error("Console Web bootstrap failed.")
  }
  const identityResponse = await boundedFetch(
    `${runtime.publicSummary.services.identity}/realms/llm-machines`,
  )
  if (identityResponse.status !== 503) {
    throw new Error("Identity double did not fail closed.")
  }
  const unknownResponse = await boundedFetch(
    `${runtime.publicSummary.services.api}/native/admin`,
  )
  if (unknownResponse.status !== 404) {
    throw new Error("Local authority router exposed an unsupported API route.")
  }
  const modelsResponse = await boundedFetch(
    `${runtime.inferenceOrigin}/v1/models`,
    {
      headers: { authorization: `Bearer ${runtime.inferenceApiKey}` },
    },
  )
  if (!modelsResponse.ok) {
    throw new Error("Inference-double model listing failed.")
  }
  const completionResponse = await boundedFetch(
    `${runtime.inferenceOrigin}/v1/chat/completions`,
    {
      body: JSON.stringify({
        messages: [{ content: "fixture", role: "user" }],
        model: "fixture-model",
      }),
      headers: {
        authorization: `Bearer ${runtime.inferenceApiKey}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  )
  const completion = await completionResponse.json()
  if (
    !completionResponse.ok ||
    completion.choices?.[0]?.message?.content !== "fixture-response" ||
    completion.usage?.total_tokens !== 5
  ) {
    throw new Error("Inference-double Chat Completions check failed.")
  }
  const streamingResponse = await boundedFetch(
    `${runtime.inferenceOrigin}/v1/chat/completions`,
    {
      body: JSON.stringify({
        messages: [{ content: "fixture", role: "user" }],
        model: "fixture-model",
        stream: true,
        stream_options: { include_usage: true },
      }),
      headers: {
        authorization: `Bearer ${runtime.inferenceApiKey}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  )
  const stream = await streamingResponse.text()
  if (
    !streamingResponse.ok ||
    !stream.includes("fixture-response") ||
    !stream.includes('"total_tokens":5') ||
    !stream.endsWith("data: [DONE]\n\n")
  ) {
    throw new Error("Inference-double streaming Chat Completions check failed.")
  }
}

async function verifyApplicationInferenceVerticalSlice(runtime) {
  const primary = await createFixtureApplication(runtime, {
    allowedModels: ["fixture-model"],
    idempotencyKey: "f0-l1-create-primary",
    name: "F0-L1 primary client",
  })
  const isolated = await createFixtureApplication(runtime, {
    allowedModels: ["isolated-fixture-model"],
    idempotencyKey: "f0-l1-create-isolated",
    name: "F0-L1 isolated client",
  })

  const primaryKey = requiredApiKey(primary)
  const isolatedKey = requiredApiKey(isolated)
  if (primaryKey === isolatedKey) {
    throw new Error("F0-L1 issued the same credential to two Applications.")
  }
  const nonStreaming = await openAiChatCompletion(
    runtime.publicSummary.services.api,
    primaryKey,
    false,
  )
  if (
    nonStreaming.status !== 200 ||
    nonStreaming.body.choices?.[0]?.message?.content !== "fixture-response" ||
    nonStreaming.body.usage?.total_tokens !== 5
  ) {
    throw new Error("F0-L1 non-streaming Chat Completions failed.")
  }

  const streaming = await openAiChatCompletion(
    runtime.publicSummary.services.api,
    primaryKey,
    true,
    () => runtime.streamingProbe.releaseTerminal(),
  )
  if (
    streaming.status !== 200 ||
    streaming.content !== "fixture-response" ||
    streaming.totalTokens !== 5 ||
    !streaming.done ||
    !streaming.firstChunkBeforeTerminal
  ) {
    throw new Error("F0-L1 streaming Chat Completions failed.")
  }

  const initialDetail = await applicationDetail(runtime, primary.app.id)
  assertUsage(initialDetail, { requests7d: 2, tokens7d: 10 })
  const initialMetadata = initialDetail.app.credentials.find(
    (credential) => credential.id === primary.credential.credentialId,
  )
  if (!initialDetail.app.usage.lastUsedAt || !initialMetadata?.lastUsedAt) {
    throw new Error("F0-L1 did not record initial Application last use.")
  }

  const models = await openAiModels(
    runtime.publicSummary.services.api,
    primaryKey,
  )
  if (
    models.status !== 200 ||
    models.body.data?.length !== 1 ||
    models.body.data[0]?.id !== "fixture-model"
  ) {
    throw new Error("F0-L1 OpenAI-compatible model discovery failed.")
  }

  const connectionTest = await adminJson(runtime, {
    idempotencyKey: "f0-l1-test-primary",
    method: "POST",
    path: `/api/admin/applications/connected-apps/${primary.app.id}/test`,
  })
  if (
    connectionTest.status !== 200 ||
    connectionTest.body.status !== "passed"
  ) {
    throw new Error("F0-L1 Application connection evidence did not pass.")
  }

  const rotated = await adminJson(runtime, {
    credentialReveal: true,
    idempotencyKey: "f0-l1-rotate-primary",
    method: "POST",
    path: `/api/admin/applications/connected-apps/${primary.app.id}/rotate-credentials`,
  })
  if (rotated.status !== 200 || rotated.body.status !== "rotated") {
    throw new Error("F0-L1 Application credential rotation failed.")
  }
  const rotatedKey = requiredApiKey(rotated.body)
  const retiringMetadata = rotated.body.app.credentials.find(
    (credential) => credential.id === primary.credential.credentialId,
  )
  if (
    retiringMetadata?.status !== "retiring" ||
    !retiringMetadata.overlapExpiresAt ||
    !retiringMetadata.rotatedAt ||
    Date.parse(retiringMetadata.overlapExpiresAt) -
      Date.parse(retiringMetadata.rotatedAt) !==
      86_400_000
  ) {
    throw new Error("F0-L1 rotation did not create a bounded overlap.")
  }

  await runtime.fixtureClock.set(
    Date.parse(retiringMetadata.overlapExpiresAt) - 1,
  )
  await requireSuccessfulCompletion(
    runtime.publicSummary.services.api,
    primaryKey,
    "retiring credential during overlap",
  )
  await requireSuccessfulCompletion(
    runtime.publicSummary.services.api,
    rotatedKey,
    "rotated credential",
  )
  const rotatedDetail = await applicationDetail(runtime, primary.app.id)
  assertUsage(rotatedDetail, { requests7d: 5, tokens7d: 20 })
  const activeMetadata = rotatedDetail.app.credentials.find(
    (credential) => credential.id === rotated.body.credential.credentialId,
  )
  if (!activeMetadata?.lastUsedAt || activeMetadata.status !== "active") {
    throw new Error("F0-L1 did not bind last use to the rotated credential.")
  }
  await runtime.fixtureClock.set(Date.parse(retiringMetadata.overlapExpiresAt))
  await requireCredentialDenied(
    runtime.publicSummary.services.api,
    primaryKey,
    "expired retiring credential",
  )

  const crossApplicationRevoke = await adminJson(runtime, {
    idempotencyKey: "f0-l1-cross-app-revoke",
    method: "POST",
    path: `/api/admin/applications/connected-apps/${isolated.app.id}/credentials/${rotated.body.credential.credentialId}/revoke`,
  })
  if (crossApplicationRevoke.status !== 404) {
    throw new Error("F0-L1 accepted a cross-Application credential mutation.")
  }

  const isolatedAttempt = await openAiChatCompletion(
    runtime.publicSummary.services.api,
    isolatedKey,
    false,
  )
  if (isolatedAttempt.status !== 403) {
    throw new Error("F0-L1 did not enforce the isolated Application policy.")
  }
  const isolatedDetail = await applicationDetail(runtime, isolated.app.id)
  const primaryAfterIsolation = await applicationDetail(runtime, primary.app.id)
  assertUsage(isolatedDetail, { requests7d: 1, tokens7d: 0 })
  assertUsage(primaryAfterIsolation, { requests7d: 5, tokens7d: 20 })
  if (
    isolatedDetail.app.usage.failures7d !== 1 ||
    !isolatedDetail.app.usage.lastUsedAt ||
    primaryAfterIsolation.app.usage.failures7d !== 0
  ) {
    throw new Error("F0-L1 did not isolate Application usage attribution.")
  }

  await revokeFixtureCredential(
    runtime,
    primary.app.id,
    primary.credential.credentialId,
    "f0-l1-revoke-retiring",
  )
  await requireCredentialDenied(
    runtime.publicSummary.services.api,
    primaryKey,
    "revoked retiring credential",
  )
  await requireSuccessfulCompletion(
    runtime.publicSummary.services.api,
    rotatedKey,
    "remaining active credential",
  )

  await revokeFixtureCredential(
    runtime,
    primary.app.id,
    rotated.body.credential.credentialId,
    "f0-l1-revoke-active",
  )
  await requireCredentialDenied(
    runtime.publicSummary.services.api,
    rotatedKey,
    "revoked active credential",
  )

  const finalDetail = await applicationDetail(runtime, primary.app.id)
  assertUsage(finalDetail, { requests7d: 6, tokens7d: 25 })
  if (
    finalDetail.app.status !== "disabled" ||
    !finalDetail.app.credentials.every(
      (credential) => credential.status === "revoked",
    )
  ) {
    throw new Error("F0-L1 did not disable the credential-less Application.")
  }

  runtime.registerBeforeRemoveCheck(() =>
    assertVerticalSliceLeavesNoSensitiveOutput(runtime, [
      primaryKey,
      isolatedKey,
      rotatedKey,
    ]),
  )

  return {
    accounting: {
      lastUseRecorded: true,
      requests7d: finalDetail.app.usage.requests7d,
      tokens7d: finalDetail.app.usage.tokens7d,
    },
    applicationCreation: "passed",
    connectionTest: "passed",
    inferenceClient: "OPENAI_COMPATIBLE_HTTP",
    isolation: {
      accountingAttributedToCredentialApplication: true,
      crossApplicationCredentialMutationDenied: true,
      crossApplicationModelUseDenied: true,
    },
    nonStreamingChatCompletions: "passed",
    revocation: {
      activeCredentialDenied: true,
      retiringCredentialDenied: true,
    },
    rotation: {
      automaticOverlapExpiryDenied: true,
      boundedOverlapRecorded: true,
      retiringCredentialAcceptedDuringOverlap: true,
      rotatedCredentialAccepted: true,
    },
    separateApplicationCredentials: true,
    streamingChatCompletions: "passed",
  }
}

async function createFixtureApplication(
  runtime,
  { allowedModels, idempotencyKey, name },
) {
  const result = await adminJson(runtime, {
    body: {
      allowedModels,
      description: "Disposable F0-L1 Application-flow fixture.",
      name,
    },
    credentialReveal: true,
    idempotencyKey,
    method: "POST",
    path: "/api/admin/applications/connected-apps",
  })
  if (
    result.status !== 201 ||
    result.body.status !== "created" ||
    !result.body.app?.id ||
    !result.body.credential?.credentialId
  ) {
    throw new Error("F0-L1 Application creation failed.")
  }
  requiredApiKey(result.body)
  return result.body
}

async function revokeFixtureCredential(
  runtime,
  applicationId,
  credentialId,
  idempotencyKey,
) {
  const result = await adminJson(runtime, {
    idempotencyKey,
    method: "POST",
    path: `/api/admin/applications/connected-apps/${applicationId}/credentials/${credentialId}/revoke`,
  })
  if (
    result.status !== 200 ||
    result.body.id !== applicationId ||
    !Array.isArray(result.body.credentials)
  ) {
    throw new Error("F0-L1 Application credential revocation failed.")
  }
}

async function applicationDetail(runtime, applicationId) {
  const result = await adminJson(runtime, {
    method: "GET",
    path: `/api/admin/applications/connected-apps/${applicationId}`,
  })
  if (result.status !== 200 || !result.body.app) {
    throw new Error("F0-L1 Application detail read failed.")
  }
  return result.body
}

async function adminJson(
  runtime,
  { body, credentialReveal = false, idempotencyKey, method, path },
) {
  const response = await boundedFetch(`${runtime.bffOrigin}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...runtime.adminHeaders,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    method,
  })
  const responseBody = await response.json()
  runtime.nonRevealBodies.push(
    credentialReveal
      ? responseWithoutExpectedCredentialReveal(responseBody)
      : responseBody,
  )
  return { body: responseBody, status: response.status }
}

function responseWithoutExpectedCredentialReveal(responseBody) {
  const reviewedBody = structuredClone(responseBody)
  if (
    typeof reviewedBody !== "object" ||
    reviewedBody === null ||
    typeof reviewedBody.credential !== "object" ||
    reviewedBody.credential === null ||
    typeof reviewedBody.credential.apiKey !== "string" ||
    typeof reviewedBody.credential.exampleCurl !== "string"
  ) {
    throw new Error("F0-L1 expected the static credential reveal fields.")
  }
  const revealedApiKey = reviewedBody.credential.apiKey
  const curlParts = reviewedBody.credential.exampleCurl.split(revealedApiKey)
  if (curlParts.length !== 2) {
    throw new Error("F0-L1 expected one credential occurrence in exampleCurl.")
  }
  reviewedBody.credential.apiKey = "[expected-one-time-credential-reveal]"
  reviewedBody.credential.exampleCurl = curlParts.join(
    "[expected-one-time-credential-reveal]",
  )
  return reviewedBody
}

async function openAiChatCompletion(
  apiOrigin,
  apiKey,
  stream,
  onFirstStreamChunk,
) {
  const response = await boundedFetch(`${apiOrigin}/v1/chat/completions`, {
    body: JSON.stringify({
      messages: [{ content: "disposable fixture input", role: "user" }],
      model: "fixture-model",
      stream,
    }),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    method: "POST",
  })
  if (!stream || response.status !== 200) {
    return { body: await response.json(), status: response.status }
  }
  if (!response.body) {
    throw new Error("F0-L1 streaming response had no body.")
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ""
  let firstChunkBeforeTerminal = false
  while (true) {
    const { done: streamDone, value } = await reader.read()
    if (streamDone) {
      text += decoder.decode()
      break
    }
    if (!firstChunkBeforeTerminal) {
      firstChunkBeforeTerminal = true
      onFirstStreamChunk?.()
    }
    text += decoder.decode(value, { stream: true })
  }
  let content = ""
  let done = false
  let totalTokens = null
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) {
      continue
    }
    const data = line.slice("data: ".length)
    if (data === "[DONE]") {
      done = true
      continue
    }
    const event = JSON.parse(data)
    content += event.choices?.[0]?.delta?.content ?? ""
    if (Number.isSafeInteger(event.usage?.total_tokens)) {
      totalTokens = event.usage.total_tokens
    }
  }
  return {
    content,
    done,
    firstChunkBeforeTerminal,
    status: response.status,
    totalTokens,
  }
}

async function openAiModels(apiOrigin, apiKey) {
  const response = await boundedFetch(`${apiOrigin}/v1/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
  })
  return { body: await response.json(), status: response.status }
}

async function requireSuccessfulCompletion(apiOrigin, apiKey, label) {
  const result = await openAiChatCompletion(apiOrigin, apiKey, false)
  if (
    result.status !== 200 ||
    result.body.choices?.[0]?.message?.content !== "fixture-response"
  ) {
    throw new Error(`F0-L1 ${label} was not accepted.`)
  }
}

async function requireCredentialDenied(apiOrigin, apiKey, label) {
  const result = await openAiChatCompletion(apiOrigin, apiKey, false)
  if (result.status !== 401) {
    throw new Error(`F0-L1 ${label} was not denied.`)
  }
}

function requiredApiKey(result) {
  const apiKey = result.credential?.apiKey
  if (typeof apiKey !== "string" || !apiKey.startsWith("llmm_t4_")) {
    throw new Error("F0-L1 did not receive a one-time static credential.")
  }
  return apiKey
}

function assertUsage(detail, expected) {
  if (
    detail.app.usage?.requests7d !== expected.requests7d ||
    detail.app.usage?.tokens7d !== expected.tokens7d
  ) {
    throw new Error("F0-L1 Application usage accounting did not reconcile.")
  }
}

async function assertVerticalSliceLeavesNoSensitiveOutput(
  runtime,
  applicationKeys,
) {
  const forbiddenValues = [
    ...runtime.sensitiveRuntimeValues.map((value, index) => ({
      label: `service-credential-${index}`,
      value,
    })),
    ...applicationKeys.map((value, index) => ({
      label: `application-credential-${index}`,
      value,
    })),
    {
      label: "parent-database-sentinel",
      value: "parent-database-must-not-cross",
    },
    { label: "parent-secret-sentinel", value: "parent-value-must-not-cross" },
    { label: "request-content", value: "disposable fixture input" },
    { label: "response-content", value: "fixture-response" },
  ]
  const reviewedOutputs = [
    ...runtime.nonRevealBodies.map((body, index) => ({
      label: `response-${index}`,
      value: JSON.stringify(body),
    })),
    ...(await Promise.all(
      runtime.logPaths.map(async (path, index) => ({
        label: `runtime-log-${index}`,
        value: await readFile(path, "utf8"),
      })),
    )),
  ]
  for (const output of reviewedOutputs) {
    for (const forbidden of forbiddenValues) {
      if (output.value.includes(forbidden.value)) {
        throw new Error(`F0-L1 found ${forbidden.label} in ${output.label}.`)
      }
    }
  }
}

async function createFixtureClock(stateRoot) {
  const clockPath = join(stateRoot, "fixture-clock.txt")
  const modulePath = join(stateRoot, "fixture-clock.mjs")
  const initialTime = Date.parse("2026-08-05T12:00:00.000Z")
  await writeFile(clockPath, `${initialTime}\n`, { mode: 0o600 })
  await writeFile(
    modulePath,
    `import { readFileSync } from "node:fs"

const NativeDate = globalThis.Date
const clockPath = process.env.LLMM_F0_CLOCK_FILE

function fixtureNow() {
  const value = Number.parseInt(readFileSync(clockPath, "utf8").trim(), 10)
  if (!Number.isSafeInteger(value)) {
    throw new Error("Invalid disposable fixture clock.")
  }
  return value
}

class FixtureDate extends NativeDate {
  constructor(...args) {
    super(...(args.length === 0 ? [fixtureNow()] : args))
  }

  static now() {
    return fixtureNow()
  }
}

globalThis.Date = FixtureDate
`,
    { mode: 0o600 },
  )
  return {
    environment: {
      LLMM_F0_CLOCK_FILE: clockPath,
      NODE_OPTIONS: `--import=${pathToFileURL(modulePath).href}`,
    },
    set(value) {
      if (!Number.isSafeInteger(value)) {
        throw new Error("F0-L1 fixture clock requires a safe integer.")
      }
      return writeFile(clockPath, `${value}\n`, { mode: 0o600 })
    },
  }
}

function createStreamingProbe() {
  let released = false
  let releaseTerminal
  const terminalRelease = new Promise((resolveRelease) => {
    releaseTerminal = resolveRelease
  })
  return {
    releaseTerminal() {
      if (!released) {
        released = true
        releaseTerminal()
      }
    },
    waitForTerminalRelease() {
      return promiseWithTimeout(
        terminalRelease,
        5_000,
        "F0-L1 did not observe a downstream stream chunk before terminal release.",
      )
    },
  }
}

async function promiseWithTimeout(promise, timeoutMs, message) {
  let timeout
  try {
    return await Promise.race([
      promise,
      new Promise((_, rejectTimeout) => {
        timeout = setTimeout(() => rejectTimeout(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

function startChild(
  name,
  command,
  environment,
  stateRoot,
  cwd,
  reportRuntimeFailure,
) {
  const errors = []
  const stdout = createWriteStream(join(stateRoot, `${name}.stdout.log`), {
    flags: "a",
    mode: 0o600,
  })
  const stderr = createWriteStream(join(stateRoot, `${name}.stderr.log`), {
    flags: "a",
    mode: 0o600,
  })
  const child = spawn(command[0], command.slice(1), {
    cwd,
    detached: true,
    env: isolatedChildEnvironment(stateRoot, environment),
    stdio: ["ignore", "pipe", "pipe"],
  })
  const record = { child, errors, name, stderr, stdout, stopping: false }
  const recordFailure = (error) => {
    if (record.stopping) {
      record.errors.push(error)
    } else {
      reportRuntimeFailure(error)
    }
  }
  stdout.on("error", recordFailure)
  stderr.on("error", recordFailure)
  child.on("error", recordFailure)
  child.on("exit", (code, signal) => {
    if (!record.stopping) {
      recordFailure(
        new Error(
          `${name} exited unexpectedly (code=${code ?? "none"}, signal=${signal ?? "none"}).`,
        ),
      )
    }
  })
  child.stdout.pipe(stdout)
  child.stderr.pipe(stderr)
  return record
}

async function stopChild(record) {
  const errors = []
  record.stopping = true
  try {
    if (processGroupExists(record.child.pid)) {
      killProcessGroup(record.child.pid, "SIGTERM")
      if (!(await waitForProcessGroupExit(record.child.pid, 5_000))) {
        killProcessGroup(record.child.pid, "SIGKILL")
        if (!(await waitForProcessGroupExit(record.child.pid, 5_000))) {
          throw new Error(
            `${record.name} process group ${record.child.pid} survived SIGKILL.`,
          )
        }
      }
    }
    if (!(await waitForChildExit(record.child, 1_000))) {
      throw new Error(`${record.name} child exit was not observed.`)
    }
  } catch (error) {
    errors.push(error)
  }
  const streamResults = await Promise.allSettled([
    endWritable(record.stdout),
    endWritable(record.stderr),
  ])
  errors.push(
    ...record.errors,
    ...streamResults
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason),
  )
  if (errors.length > 0) {
    throw new AggregateError(errors, `${record.name} did not stop cleanly.`)
  }
}

function createRuntimeFailure() {
  let rejectFailure
  let reported = false
  const signal = new Promise((_, reject) => {
    rejectFailure = reject
  })
  signal.catch(() => {})
  return {
    report(error) {
      if (!reported) {
        reported = true
        rejectFailure(error)
      }
    },
    signal,
  }
}

function endWritable(stream, timeoutMs = 5_000) {
  if (stream.closed) {
    return Promise.resolve()
  }
  return new Promise((resolveEnd, rejectEnd) => {
    let settled = false
    const finish = (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      stream.off("close", onClose)
      stream.off("error", onError)
      if (error) {
        rejectEnd(error)
      } else {
        resolveEnd()
      }
    }
    const onClose = () => finish()
    const onError = (error) => finish(error)
    const timeout = setTimeout(() => {
      stream.destroy()
      finish(new Error("Timed out closing a local development log."))
    }, timeoutMs)
    stream.once("close", onClose)
    stream.once("error", onError)
    stream.end()
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
    ensureStartupActive()
    try {
      const response = await boundedFetch(url, { redirect: "manual" }, 2_000)
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

function boundedFetch(url, options = {}, timeoutMs = 5_000) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  })
}

function listen(server, port) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen)
    server.listen(port, "127.0.0.1", resolveListen)
  })
}

function closeServer(server) {
  if (!server.listening) {
    return Promise.resolve()
  }
  return new Promise((resolveClose, rejectClose) => {
    let settled = false
    const finish = (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      if (error) {
        rejectClose(error)
      } else {
        resolveClose()
      }
    }
    const timeout = setTimeout(
      () =>
        finish(new Error("Timed out closing a local development listener.")),
      5_000,
    )
    server.close((error) => finish(error))
    server.closeAllConnections?.()
  })
}

function isolatedChildEnvironment(stateRoot, overrides) {
  return {
    HOME: stateRoot,
    LANG: "C",
    LC_ALL: "C",
    TMPDIR: stateRoot,
    ...overrides,
  }
}

function createRuntimeCleanup({
  beforeRemoveChecks,
  children,
  servers,
  stateRoot,
}) {
  let closePromise
  return () => {
    closePromise ??= (async () => {
      const results = await Promise.allSettled([
        ...servers.map(closeServer),
        ...children.map(stopChild),
      ])
      const cleanupErrors = results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason)
      const checkResults = await Promise.allSettled(
        beforeRemoveChecks.map((check) => check()),
      )
      cleanupErrors.push(
        ...checkResults
          .filter((result) => result.status === "rejected")
          .map((result) => result.reason),
      )
      try {
        await rm(stateRoot, { force: true, recursive: true })
      } catch (error) {
        cleanupErrors.push(error)
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          "Disposable reduced-Core cleanup did not complete.",
        )
      }
    })()
    return closePromise
  }
}

async function assertDevelopmentDependenciesReady() {
  const required = [
    "apps/bff/node_modules/tsx/dist/cli.mjs",
    "apps/web/node_modules/next/dist/bin/next",
    "packages/contracts/dist/inference-core.js",
    "packages/copy/dist/index.js",
  ]
  try {
    await Promise.all(
      required.map((path) => access(resolve(repositoryRoot, path))),
    )
  } catch {
    throw new Error(
      "Development dependencies are not ready. Run the documented frozen install and build prerequisites first.",
    )
  }
}

async function createTemporaryStateRoot() {
  const [repositoryRealRoot, temporaryRealRoot] = await Promise.all([
    realpath(repositoryRoot),
    realpath(tmpdir()),
  ])
  if (pathIsInside(repositoryRealRoot, temporaryRealRoot)) {
    throw new Error(
      "The operating-system temporary directory must be outside the source worktree.",
    )
  }
  return mkdtemp(join(temporaryRealRoot, "llmm-reduced-core-dev-"))
}

function pathIsInside(parent, candidate) {
  const pathFromParent = relative(parent, candidate)
  return (
    pathFromParent === "" ||
    (!isAbsolute(pathFromParent) &&
      pathFromParent !== ".." &&
      !pathFromParent.startsWith(`..${sep}`))
  )
}

async function prepareTemporaryWebProject(stateRoot) {
  const sourceRoot = resolve(repositoryRoot, "apps/web")
  const webRoot = join(stateRoot, "web")
  await mkdir(webRoot, { mode: 0o700 })
  const tsconfig = JSON.parse(
    await readFile(resolve(sourceRoot, "tsconfig.json"), "utf8"),
  )
  tsconfig.extends = resolve(repositoryRoot, "tsconfig.base.json")
  await writeFile(
    join(webRoot, "tsconfig.json"),
    `${JSON.stringify(tsconfig, null, 2)}\n`,
    { mode: 0o600 },
  )
  await copyFile(
    resolve(sourceRoot, "next-env.d.ts"),
    join(webRoot, "next-env.d.ts"),
  )
  for (const path of [
    "next.config.ts",
    "node_modules",
    "package.json",
    "postcss.config.mjs",
    "public",
    "src",
  ]) {
    await symlink(resolve(sourceRoot, path), join(webRoot, path))
  }
  return webRoot
}

function ensureStartupActive() {
  if (shutdownRequested) {
    throw new ShutdownRequestedError()
  }
}

function killProcessGroup(pid, signal) {
  if (!pid) {
    return
  }
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error
    }
  }
}

function processGroupExists(pid) {
  if (!pid) {
    return false
  }
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false
    }
    throw error
  }
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processGroupExists(pid)) {
      return true
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  return !processGroupExists(pid)
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true)
  }
  return Promise.race([
    new Promise((resolveExit) => child.once("exit", () => resolveExit(true))),
    new Promise((resolveTimeout) =>
      setTimeout(() => resolveTimeout(false), timeoutMs),
    ),
  ])
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
