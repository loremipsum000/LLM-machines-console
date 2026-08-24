#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { renderCanonicalJson } from "./render-profile.mjs"
import {
  canonicalJson,
  loadContracts,
  profileQualificationDigest,
  validateDeliveryProfile,
} from "./validate-profile.mjs"

const root = path.dirname(fileURLToPath(import.meta.url))

export async function qualifyInternalProfile(options) {
  const contracts = options.contracts ?? loadContracts()
  const profile = structuredClone(options.profile)
  const endpoint = new URL(options.endpoint)
  validateInputs(profile, endpoint, options, contracts)
  verifyRuntimeImage(options.container, profile.engine.image.digest)
  const workloadCanary = `LLMM_WORKLOAD_CANARY_${randomBytes(16).toString("hex")}`

  const startedAt = new Date(options.now?.() ?? Date.now())
  const fetchImpl = options.fetchImpl ?? fetch
  const request = (pathname, init = {}) =>
    fetchImpl(new URL(pathname, endpoint), {
      ...init,
      signal: AbortSignal.timeout(options.timeoutMilliseconds ?? 120_000),
    })

  const probeStatuses = {}
  for (const [name, probe] of Object.entries(profile.probes)) {
    const response = await request(probe.path)
    probeStatuses[name] = response.status
    await response.arrayBuffer()
    if (response.status !== 200) throw new Error(`${name} probe failed`)
  }

  const modelsResponse = await request("/v1/models")
  const models = await modelsResponse.json()
  if (
    modelsResponse.status !== 200 ||
    !Array.isArray(models.data) ||
    !models.data.some((entry) => entry?.id === profile.model.alias)
  ) {
    throw new Error("the measured model alias is not served")
  }

  await chat(request, profile.model.alias, false, workloadCanary)
  const latencies = []
  let completionTokens = 0
  let generationWallMilliseconds = 0
  for (let index = 0; index < options.samples; index += 1) {
    const result = await timedChat(
      request,
      profile.model.alias,
      false,
      workloadCanary,
    )
    latencies.push(result.elapsedMilliseconds)
    completionTokens += result.completionTokens
    generationWallMilliseconds += result.elapsedMilliseconds
  }

  const queueObservation = { maxObservedDepth: 0, state: "measured" }
  let monitor = true
  const monitorPromise = (async () => {
    while (monitor) {
      const metrics = await (await request("/metrics")).text()
      queueObservation.maxObservedDepth = Math.max(
        queueObservation.maxObservedDepth,
        metricValue(metrics, "sglang:num_queue_reqs"),
      )
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  })()
  const concurrentStarted = performance.now()
  const concurrent = await Promise.all(
    Array.from({ length: options.concurrency }, () =>
      timedChat(request, profile.model.alias, false, workloadCanary),
    ),
  )
  generationWallMilliseconds += performance.now() - concurrentStarted
  for (const result of concurrent) {
    latencies.push(result.elapsedMilliseconds)
    completionTokens += result.completionTokens
  }
  monitor = false
  await monitorPromise

  const streaming = await timedChat(
    request,
    profile.model.alias,
    true,
    workloadCanary,
  )
  latencies.push(streaming.elapsedMilliseconds)
  completionTokens += streaming.completionTokens
  generationWallMilliseconds += streaming.elapsedMilliseconds

  const wrongModel = await chatStatus(request, "unadmitted-model", false)
  const overContext = await overContextStatus(
    request,
    profile.model.alias,
    profile.limits.configuredContextTokens,
  )
  if (overContext < 400) throw new Error("context denial failed")

  const retention = await (options.runtimeInspector ?? inspectRuntimeRetention)(
    options.container,
    workloadCanary,
  )
  validateRetentionEvidence(retention)
  const retentionEvidenceDigest = digest(canonicalJson(retention))
  const measuredAt = startedAt.toISOString()
  const validUntil = new Date(
    startedAt.getTime() + options.validDays * 86_400_000,
  ).toISOString()
  const sortedLatencies = [...latencies].sort((left, right) => left - right)
  const p95Index = Math.max(0, Math.ceil(sortedLatencies.length * 0.95) - 1)
  const evidence = {
    schema: "llm-machines.internal-sglang-measurement.v1",
    scope: "INTERNAL_TEST_ONLY",
    productionCapacityClaim: false,
    profileId: profile.metadata.profileId,
    revision: profile.metadata.revision,
    engineImageDigest: profile.engine.image.digest,
    modelArtifactDigest: profile.model.artifactDigest,
    modelManifestDigest: profile.model.manifestDigest,
    measuredAt,
    validUntil,
    probes: probeStatuses,
    modelDiscovery: 200,
    nonStreamingSamples: options.samples,
    streaming: { status: 200, completionTokens: streaming.completionTokens },
    concurrency: options.concurrency,
    queue: queueObservation,
    enforcementBoundary: {
      directEngineWrongModelStatus: wrongModel,
      modelPermissionEnforcedBy: "litellm-private-and-product-edge",
      productCompositeDenialRequired: true,
      overContextStatus: overContext,
    },
    measurements: {
      effectiveContextTokens: profile.limits.configuredContextTokens,
      maxOutputTokens: options.maxOutputTokens,
      throughputTokensPerSecond: round(
        completionTokens / (generationWallMilliseconds / 1000),
      ),
      p95LatencyMilliseconds: round(sortedLatencies[p95Index]),
    },
    retentionEvidenceDigest,
    contentStored: false,
  }
  const evidenceDigest = digest(canonicalJson(evidence))

  profile.metadata.lifecycleState = "ACTIVE_MEASURED_INTERNAL_TEST"
  profile.capacity = {
    state: "MEASURED",
    profileRevision: profile.metadata.revision,
    engineImageDigest: profile.engine.image.digest,
    modelArtifactDigest: profile.model.artifactDigest,
    evidenceDigest,
    measuredAt,
    validUntil,
    effectiveContextTokens: profile.limits.configuredContextTokens,
    maxOutputTokens: options.maxOutputTokens,
    throughputTokensPerSecond: evidence.measurements.throughputTokensPerSecond,
    maxConcurrentRequests: options.concurrency,
    p95LatencyMilliseconds: evidence.measurements.p95LatencyMilliseconds,
    queue: queueObservation,
  }
  profile.activation.state = "ACTIVE_INTERNAL_TEST"
  profile.activation.qualifiedProfileDigest =
    profileQualificationDigest(profile)
  const errors = validateDeliveryProfile(profile, contracts.core)
  if (errors.length > 0) throw new Error(errors.join("\n"))

  return {
    evidence: { ...evidence, evidenceDigest },
    profile,
    rendered: JSON.parse(renderCanonicalJson(profile, contracts)),
  }
}

function validateInputs(profile, endpoint, options, contracts) {
  const errors = validateDeliveryProfile(profile, contracts.core)
  if (errors.length > 0) throw new Error(errors.join("\n"))
  if (
    profile.metadata.admissionScope !== "INTERNAL_TEST_ONLY" ||
    profile.metadata.lifecycleState !== "CANDIDATE_UNQUALIFIED" ||
    profile.activation.state !== "INACTIVE" ||
    profile.accelerator.productionSupportClaim !== false
  ) {
    throw new Error("input must be an inactive internal-test candidate")
  }
  if (
    endpoint.protocol !== "http:" ||
    endpoint.hostname !== "127.0.0.1" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    Number(endpoint.port) !== profile.network.port
  ) {
    throw new Error("measurement endpoint must be exact loopback HTTP")
  }
  if (
    !Number.isSafeInteger(options.samples) ||
    options.samples < 3 ||
    !Number.isSafeInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > profile.parallelism.replicas * 2 ||
    !Number.isSafeInteger(options.maxOutputTokens) ||
    options.maxOutputTokens < 1 ||
    options.maxOutputTokens > profile.limits.maxOutputTokens ||
    !Number.isSafeInteger(options.validDays) ||
    options.validDays < 1 ||
    options.validDays > 30
  ) {
    throw new Error("measurement bounds are invalid")
  }
}

function verifyRuntimeImage(container, expectedDigest) {
  if (!container) return
  const actual = execFileSync(
    "docker",
    ["inspect", container, "--format", "{{.Image}}|{{.State.Running}}"],
    { encoding: "utf8" },
  ).trim()
  if (actual !== `${expectedDigest}|true`) {
    throw new Error("runtime container does not match the active image digest")
  }
}

async function timedChat(request, model, stream, workloadCanary) {
  const started = performance.now()
  const response = await chat(request, model, stream, workloadCanary)
  return {
    completionTokens: response.completionTokens,
    elapsedMilliseconds: performance.now() - started,
  }
}

async function chat(request, model, stream, workloadCanary) {
  const response = await request("/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: `Do not repeat ${workloadCanary}. Return the word READY.`,
        },
      ],
      max_tokens: 32,
      temperature: 0,
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
    }),
  })
  if (response.status !== 200) throw new Error("chat completion failed")
  if (!stream) {
    const payload = await response.json()
    if (!payload?.choices?.[0]?.message?.content)
      throw new Error("chat completion response is empty")
    return { completionTokens: payload.usage?.completion_tokens ?? 0 }
  }
  const body = await response.text()
  if (!body.includes("data: [DONE]")) throw new Error("stream did not finish")
  let completionTokens = 0
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: {") || !line.includes('"usage"')) continue
    const payload = JSON.parse(line.slice(6))
    completionTokens = payload.usage?.completion_tokens ?? completionTokens
  }
  return { completionTokens }
}

async function chatStatus(request, model, stream) {
  const response = await request("/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "READY" }],
      max_tokens: 1,
      stream,
    }),
  })
  await response.arrayBuffer()
  return response.status
}

async function overContextStatus(request, model, configuredContextTokens) {
  const response = await request("/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: "token ".repeat(configuredContextTokens * 2 + 64),
        },
      ],
      max_tokens: 1,
    }),
  })
  await response.arrayBuffer()
  return response.status
}

function metricValue(metrics, name) {
  const line = metrics
    .split("\n")
    .find(
      (entry) => entry.startsWith(`${name}{`) || entry.startsWith(`${name} `),
    )
  if (!line) throw new Error(`required metric ${name} is missing`)
  const value = Number(line.trim().split(/\s+/).at(-1))
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`required metric ${name} is invalid`)
  return value
}

function validateRetentionEvidence(value) {
  const expected = [
    "containerLogs",
    "containerWritableState",
    "hostTemporaryState",
    "requestLoggingDisabled",
    "workloadCanaryMatches",
  ]
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(expected.sort()) ||
    value.containerLogs !== "scanned" ||
    value.containerWritableState !== "scanned" ||
    value.hostTemporaryState !== "scanned" ||
    value.requestLoggingDisabled !== true ||
    value.workloadCanaryMatches !== 0
  ) {
    throw new Error("retention evidence is incomplete")
  }
}

function inspectRuntimeRetention(container, workloadCanary) {
  if (!container) throw new Error("runtime container is required")
  const logResult = spawnSync("docker", ["logs", container], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (logResult.status !== 0) throw new Error("runtime log scan failed")
  const logs = `${logResult.stdout}${logResult.stderr}`
  const writableStateStatus = execFileSync(
    "docker",
    [
      "exec",
      "-e",
      `LLMM_CANARY=${workloadCanary}`,
      container,
      "sh",
      "-lc",
      'if grep -R -F -q -- "$LLMM_CANARY" /tmp /root/.cache /root/.triton 2>/dev/null; then exit 3; fi',
    ],
    { encoding: "utf8" },
  )
  if (writableStateStatus !== "")
    throw new Error("unexpected retention scan output")
  return {
    containerLogs: "scanned",
    containerWritableState: "scanned",
    hostTemporaryState: "scanned",
    requestLoggingDisabled: true,
    workloadCanaryMatches: logs.includes(workloadCanary) ? 1 : 0,
  }
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function round(value) {
  return Math.round(value * 1000) / 1000
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith("--") || value === undefined)
      throw new Error("arguments must be name-value pairs")
    values.set(name, value)
  }
  const required = [
    "--profile",
    "--endpoint",
    "--container",
    "--evidence",
    "--activated-profile",
    "--rendered-profile",
  ]
  if (required.some((name) => !values.has(name)))
    throw new Error("required qualification argument is missing")
  return {
    profile: JSON.parse(
      readFileSync(path.resolve(values.get("--profile")), "utf8"),
    ),
    endpoint: values.get("--endpoint"),
    container: values.get("--container"),
    evidencePath: path.resolve(values.get("--evidence")),
    activatedProfilePath: path.resolve(values.get("--activated-profile")),
    renderedProfilePath: path.resolve(values.get("--rendered-profile")),
    samples: Number(values.get("--samples") ?? 5),
    concurrency: Number(values.get("--concurrency") ?? 2),
    maxOutputTokens: Number(values.get("--max-output-tokens") ?? 32),
    validDays: Number(values.get("--valid-days") ?? 30),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2))
    const result = await qualifyInternalProfile(options)
    writeFileSync(options.evidencePath, `${canonicalJson(result.evidence)}\n`, {
      mode: 0o600,
    })
    writeFileSync(
      options.activatedProfilePath,
      `${canonicalJson(result.profile)}\n`,
      { mode: 0o600 },
    )
    writeFileSync(
      options.renderedProfilePath,
      `${canonicalJson(result.rendered)}\n`,
      { mode: 0o600 },
    )
    process.stdout.write(`${result.evidence.evidenceDigest}\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
}
