import { createHash, randomUUID } from "node:crypto"

export const retentionCanaryClasses = [
  "prompt",
  "model_response",
  "request_body",
  "response_body",
  "search_term",
  "target_url",
  "page_content",
  "extracted_content",
  "tool_arguments",
  "tool_results",
  "chat_history",
  "username",
  "email",
  "source_ip",
  "raw_credential",
  "key_hash",
  "free_text_reason",
  "upstream_error",
]

export const requiredTerminalStates = [
  "success",
  "rejection",
  "cancellation",
  "timeout",
  "upstream-failure",
  "crash",
  "restart",
  "backup",
  "restore",
]

export const requiredSourceScenarios = [
  "non-stream-success",
  "stream-success",
  "rejection",
  "cancellation",
  "timeout",
  "upstream-failure",
  "crash",
  "restart",
  "backup",
  "restore",
]

export const requiredSourceArtifactClasses = [
  "managed-store",
  "log",
  "metric",
  "queue",
  "cache",
  "crash-output",
  "export",
  "backup",
]

export const sourceScenarioVerdicts = [
  "SOURCE_CANARY_CLEAR",
  "SOURCE_CANARY_FOUND",
  "SOURCE_SCENARIO_NOT_EXERCISED",
  "SOURCE_CONTROL_ABSENT",
  "HARNESS_ERROR",
  "NOT_EVALUATED_RUNTIME",
]

export function createRetentionCanarySet(runId = randomUUID()) {
  return Object.fromEntries(
    retentionCanaryClasses.map((canaryClass) => {
      const digest = sha256(`${runId}\0${canaryClass}`)
      return [
        canaryClass,
        `LLMMZRC_${canaryClass.toUpperCase()}_${digest.slice(0, 32)}`,
      ]
    }),
  )
}

export function scanRetentionArtifacts({ artifacts, canaries }) {
  const artifactEntries = validateArtifacts(artifacts)
  validateCanaries(canaries)
  const hits = []
  for (const [artifactName, descriptor] of artifactEntries) {
    const bytes = serializeArtifact(descriptor.value)
    for (const canaryClass of Object.keys(canaries).sort()) {
      const canary = Buffer.from(canaries[canaryClass], "utf8")
      if (bytes.indexOf(canary) < 0) {
        continue
      }
      hits.push({
        artifact: artifactName,
        artifactClass: descriptor.artifactClass,
        canaryClass,
        canarySha256: sha256(canary),
      })
    }
  }
  return hits
}

export function characterizeSourceScenario({
  scenario,
  exercised,
  controlAvailable = true,
  runtimeRequired = false,
  artifacts = {},
  canaries,
}) {
  const base = {
    scenario,
    exercised: exercised === true,
    artifactClasses: [],
    runtimeZeroRetentionCompliance: "NOT_EVALUATED",
    d2aRcRetentionEvidence: "NOT_DUE",
  }

  if (!requiredSourceScenarios.includes(scenario)) {
    return { ...base, verdict: "HARNESS_ERROR", hits: [] }
  }
  if (typeof exercised !== "boolean") {
    return { ...base, verdict: "HARNESS_ERROR", hits: [] }
  }
  if (runtimeRequired) {
    return { ...base, verdict: "NOT_EVALUATED_RUNTIME", hits: [] }
  }
  if (!controlAvailable) {
    return { ...base, verdict: "SOURCE_CONTROL_ABSENT", hits: [] }
  }
  if (!exercised) {
    return {
      ...base,
      verdict: "SOURCE_SCENARIO_NOT_EXERCISED",
      hits: [],
    }
  }

  try {
    const artifactEntries = validateArtifacts(artifacts)
    const artifactClasses = [
      ...new Set(artifactEntries.map(([, value]) => value.artifactClass)),
    ].sort()
    const hits = scanRetentionArtifacts({ artifacts, canaries })
    return {
      ...base,
      artifactClasses,
      verdict:
        hits.length === 0 ? "SOURCE_CANARY_CLEAR" : "SOURCE_CANARY_FOUND",
      hits,
    }
  } catch (error) {
    return {
      ...base,
      verdict: "HARNESS_ERROR",
      hits: [],
      errorClass: error instanceof Error ? error.name : "UnknownError",
    }
  }
}

export function summarizeSourceCharacterization(results) {
  const scenarioCounts = new Map()
  const artifactClasses = new Set()
  let failed = !Array.isArray(results)
  let incomplete = false

  for (const result of Array.isArray(results) ? results : []) {
    if (
      !result ||
      typeof result !== "object" ||
      !requiredSourceScenarios.includes(result.scenario)
    ) {
      failed = true
      continue
    }
    if (
      !sourceScenarioVerdicts.includes(result.verdict) ||
      !Array.isArray(result.hits) ||
      result.runtimeZeroRetentionCompliance !== "NOT_EVALUATED" ||
      result.d2aRcRetentionEvidence !== "NOT_DUE"
    ) {
      failed = true
    }
    scenarioCounts.set(
      result.scenario,
      (scenarioCounts.get(result.scenario) ?? 0) + 1,
    )
    if ((scenarioCounts.get(result.scenario) ?? 0) > 1) {
      failed = true
    }
    if (
      result.verdict === "SOURCE_CANARY_FOUND" ||
      result.verdict === "HARNESS_ERROR"
    ) {
      failed = true
    } else if (result.verdict !== "SOURCE_CANARY_CLEAR") {
      incomplete = true
    }
    if (result.verdict === "SOURCE_CANARY_CLEAR") {
      if (
        result.exercised !== true ||
        !Array.isArray(result.hits) ||
        result.hits.length !== 0 ||
        !Array.isArray(result.artifactClasses) ||
        result.artifactClasses.length === 0 ||
        JSON.stringify(result.artifactClasses) !==
          JSON.stringify([...new Set(result.artifactClasses)].sort()) ||
        result.artifactClasses.some(
          (artifactClass) =>
            !requiredSourceArtifactClasses.includes(artifactClass),
        )
      ) {
        failed = true
      } else {
        for (const artifactClass of result.artifactClasses) {
          artifactClasses.add(artifactClass)
        }
      }
    } else if (
      result.verdict === "SOURCE_CANARY_FOUND" &&
      Array.isArray(result.hits) &&
      result.hits.length === 0
    ) {
      failed = true
    }
  }

  const missingScenarios = requiredSourceScenarios.filter(
    (scenario) => scenarioCounts.get(scenario) !== 1,
  )
  const missingArtifactClasses = requiredSourceArtifactClasses.filter(
    (artifactClass) => !artifactClasses.has(artifactClass),
  )
  if (missingScenarios.length > 0 || missingArtifactClasses.length > 0) {
    incomplete = true
  }

  return {
    verdict: failed
      ? "PR01_SOURCE_CHARACTERIZATION_FAILED"
      : incomplete
        ? "PR01_SOURCE_CHARACTERIZATION_INCOMPLETE"
        : "PR01_SOURCE_CHARACTERIZATION_CLEAR",
    scenarioCount: Array.isArray(results) ? results.length : 0,
    requiredScenarioCount: requiredSourceScenarios.length,
    artifactClassCount: artifactClasses.size,
    missingScenarios,
    missingArtifactClasses,
    runtimeZeroRetentionCompliance: "NOT_EVALUATED",
    d2aRcRetentionEvidence: "NOT_DUE",
  }
}

function validateArtifacts(artifacts) {
  if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)) {
    throw new TypeError("Artifacts must be a named descriptor object")
  }
  const entries = Object.entries(artifacts).sort(([left], [right]) =>
    left.localeCompare(right),
  )
  if (entries.length === 0) {
    throw new TypeError("At least one retention artifact is required")
  }
  for (const [artifactName, descriptor] of entries) {
    if (
      !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(artifactName) ||
      !descriptor ||
      typeof descriptor !== "object" ||
      Array.isArray(descriptor) ||
      !requiredSourceArtifactClasses.includes(descriptor.artifactClass) ||
      !Object.hasOwn(descriptor, "value") ||
      descriptor.value === undefined
    ) {
      throw new TypeError("Invalid retention artifact descriptor")
    }
  }
  return entries
}

function validateCanaries(canaries) {
  if (!canaries || typeof canaries !== "object" || Array.isArray(canaries)) {
    throw new TypeError("Canaries must be a complete named object")
  }
  const names = Object.keys(canaries).sort()
  const expected = [...retentionCanaryClasses].sort()
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new TypeError("Retention canary set is incomplete")
  }
  const values = new Set()
  for (const canaryClass of expected) {
    const value = canaries[canaryClass]
    const markerPattern = new RegExp(
      `^LLMMZRC_${canaryClass.toUpperCase()}_[0-9a-f]{32}$`,
    )
    if (
      typeof value !== "string" ||
      !markerPattern.test(value) ||
      values.has(value)
    ) {
      throw new TypeError("Invalid retention canary value")
    }
    values.add(value)
  }
}

function serializeArtifact(value) {
  const chunks = []
  const seen = new WeakSet()

  const appendText = (text) => {
    chunks.push(Buffer.from(text, "utf8"), Buffer.from([0]))
  }
  const appendBytes = (bytes) => {
    chunks.push(bytes, Buffer.from([0]))
  }
  const visitEnumerableOwnProperties = (candidate, skipNumericKeys = false) => {
    for (const key of Reflect.ownKeys(candidate)) {
      if (
        skipNumericKeys &&
        typeof key === "string" &&
        /^(?:0|[1-9]\d*)$/.test(key)
      ) {
        continue
      }
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key)
      if (!descriptor?.enumerable) {
        continue
      }
      if (!Object.hasOwn(descriptor, "value")) {
        throw new TypeError("Retention artifact accessors are not supported")
      }
      visit(typeof key === "symbol" ? key.toString() : key)
      visit(descriptor.value)
    }
  }
  const visit = (candidate) => {
    if (typeof candidate === "function") {
      throw new TypeError("Retention artifact functions are not supported")
    }
    if (candidate === null || typeof candidate !== "object") {
      appendText(String(candidate))
      return
    }
    if (seen.has(candidate)) {
      appendText("[Circular]")
      return
    }
    seen.add(candidate)

    if (Buffer.isBuffer(candidate)) {
      appendBytes(candidate)
      visitEnumerableOwnProperties(candidate, true)
      return
    }
    if (candidate instanceof ArrayBuffer) {
      appendBytes(Buffer.from(candidate))
      visitEnumerableOwnProperties(candidate)
      return
    }
    if (ArrayBuffer.isView(candidate)) {
      appendBytes(
        Buffer.from(
          candidate.buffer,
          candidate.byteOffset,
          candidate.byteLength,
        ),
      )
      visitEnumerableOwnProperties(candidate, true)
      return
    }
    if (candidate instanceof Date) {
      appendText(candidate.toISOString())
      visitEnumerableOwnProperties(candidate)
      return
    }
    if (candidate instanceof URL) {
      appendText(candidate.href)
      visitEnumerableOwnProperties(candidate)
      return
    }
    if (candidate instanceof URLSearchParams) {
      appendText(candidate.toString())
      for (const [key, value] of candidate) {
        visit(key)
        visit(value)
      }
      visitEnumerableOwnProperties(candidate)
      return
    }
    if (candidate instanceof Map) {
      for (const [key, value] of candidate) {
        visit(key)
        visit(value)
      }
      visitEnumerableOwnProperties(candidate)
      return
    }
    if (candidate instanceof Set) {
      for (const value of candidate) {
        visit(value)
      }
      visitEnumerableOwnProperties(candidate)
      return
    }
    if (candidate instanceof Error) {
      visit(candidate.name)
      visit(candidate.message)
      visit(candidate.stack)
      visit(candidate.cause)
    } else if (candidate instanceof RegExp) {
      appendText(candidate.toString())
      visitEnumerableOwnProperties(candidate)
      return
    } else if (
      !Array.isArray(candidate) &&
      Object.getPrototypeOf(candidate) !== Object.prototype &&
      Object.getPrototypeOf(candidate) !== null
    ) {
      throw new TypeError("Unsupported retention artifact value")
    }

    for (const key of Reflect.ownKeys(candidate)) {
      if (
        candidate instanceof Error &&
        typeof key === "string" &&
        ["cause", "message", "name", "stack"].includes(key)
      ) {
        continue
      }
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key)
      if (!descriptor) {
        continue
      }
      if (!Object.hasOwn(descriptor, "value")) {
        throw new TypeError("Retention artifact accessors are not supported")
      }
      visit(typeof key === "symbol" ? key.toString() : key)
      visit(descriptor.value)
    }
  }

  visit(value)
  return Buffer.concat(chunks)
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
