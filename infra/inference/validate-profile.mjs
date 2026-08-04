#!/usr/bin/env node

import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.dirname(fileURLToPath(import.meta.url))

const expectedFiles = [
  "README.md",
  "core-interface-contract.json",
  "delivery-profile.schema.json",
  "fixtures/synthetic-multi-node.json",
  "fixtures/synthetic-single-node.json",
  "render-profile.mjs",
  "sglang-engine-contract.json",
  "validate-profile.mjs",
  "validate-profile.test.mjs",
]

const sha256Pattern = /^sha256:[a-f0-9]{64}$/
const sourceRevisionPattern = /^[a-f0-9]{40,64}$/
const profileIdPattern = /^[a-z0-9][a-z0-9-]{2,62}$/
const reservedLaunchArguments = new Set([
  "--admin-api-key",
  "--api-key",
  "--context-length",
  "--crash-dump-folder",
  "--dp",
  "--dp-size",
  "--enable-metrics",
  "--file-storage-path",
  "--host",
  "--log-requests",
  "--log-requests-target",
  "--model",
  "--model-path",
  "--port",
  "--pp",
  "--pp-size",
  "--served-model-name",
  "--tp",
  "--tp-size",
  "--trust-remote-code",
])

function add(errors, message) {
  errors.push(message)
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    )
  }
  return value
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

function exactKeys(value, expected, label, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    add(errors, `${label} must be an object`)
    return false
  }
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (!sameJson(actual, wanted)) {
    add(errors, `${label} keys must be exactly ${wanted.join(", ")}`)
    return false
  }
  return true
}

function parseJson(source, label, errors) {
  try {
    return JSON.parse(source)
  } catch (error) {
    add(errors, `${label} is not valid JSON: ${error.message}`)
    return null
  }
}

function listFiles(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(prefix, entry.name)
    if (entry.isDirectory())
      return listFiles(path.join(directory, entry.name), relative)
    return entry.isFile() ? [relative] : []
  })
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function validateOciArtifact(value, label, errors) {
  if (
    !exactKeys(
      value,
      [
        "repository",
        "version",
        "digest",
        "platform",
        "sourceRevision",
        "licenseSpdx",
        "sbomDigest",
        "provenanceDigest",
        "privateRegistryMirror",
      ],
      label,
      errors,
    )
  ) {
    return
  }

  for (const key of ["digest", "sbomDigest", "provenanceDigest"]) {
    if (!sha256Pattern.test(value[key]))
      add(errors, `${label}.${key} must use sha256`)
  }
  if (!sourceRevisionPattern.test(value.sourceRevision)) {
    add(errors, `${label}.sourceRevision must be an exact source revision`)
  }
  if (
    typeof value.repository !== "string" ||
    typeof value.privateRegistryMirror !== "string" ||
    typeof value.version !== "string" ||
    value.version.length < 2 ||
    /(?:^|[._-])latest(?:$|[._-])/i.test(value.version) ||
    /(?:^|[:/@])latest(?:$|@)/i.test(value.repository) ||
    /@sha256:/i.test(value.repository) ||
    /@sha256:/i.test(value.privateRegistryMirror)
  ) {
    add(
      errors,
      `${label} must separate a readable non-latest version from its digest`,
    )
  }
  if (
    !exactKeys(
      value.platform,
      ["os", "architecture"],
      `${label}.platform`,
      errors,
    ) ||
    value.platform?.os !== "linux" ||
    !["amd64", "arm64"].includes(value.platform?.architecture)
  ) {
    add(errors, `${label}.platform must be an exact supported Linux platform`)
  }
  if (typeof value.licenseSpdx !== "string" || value.licenseSpdx.length < 2) {
    add(errors, `${label}.licenseSpdx is required`)
  }
}

export function coreCompatibilityFingerprint(coreContract) {
  return sha256(canonicalJson(coreContract))
}

export function profileQualificationDigest(profile) {
  const candidate = structuredClone(profile)
  if (candidate.activation) candidate.activation.qualifiedProfileDigest = null
  return sha256(canonicalJson(candidate))
}

export function validateCoreContract(core) {
  const errors = []
  if (
    core?.apiVersion !== "inference-core.llm-machines/v1" ||
    core?.kind !== "CoreInferenceInterfaceContract"
  ) {
    add(errors, "Core interface identity is invalid")
  }
  exactKeys(
    core,
    [
      "apiVersion",
      "kind",
      "coreAppliance",
      "publicApi",
      "applicationCredentials",
      "auditLinkage",
      "consoleSections",
      "profileInvariant",
    ],
    "Core interface contract",
    errors,
  )
  exactKeys(
    core?.coreAppliance,
    ["baseline", "hosts", "localDiskExclusions", "backupTarget"],
    "Core appliance contract",
    errors,
  )
  if (
    !sameJson(core?.coreAppliance?.baseline, {
      localDiskGiB: 100,
      memoryMiB: 32768,
      vcpu: 8,
    })
  ) {
    add(
      errors,
      "Core baseline must remain 8 vCPU, 32 GiB RAM, and 100 GiB disk",
    )
  }
  for (const excluded of [
    "customer-backup-repository",
    "bulk-model-weights",
    "inference-accelerator-storage",
  ]) {
    if (!core?.coreAppliance?.localDiskExclusions?.includes(excluded)) {
      add(errors, `Core local disk must exclude ${excluded}`)
    }
  }
  if (
    core?.coreAppliance?.backupTarget !==
    "separate-customer-owned-restic-target"
  ) {
    add(errors, "Core backup target must remain customer-owned and separate")
  }
  const serialized = canonicalJson(core)
  if (
    /\b(?:gpu|vram|tensor|pipeline|replica|model-weight)\b/i.test(serialized)
  ) {
    add(
      errors,
      "Core contract contains an inference hardware or model assumption",
    )
  }
  if (core?.profileInvariant !== true) {
    add(
      errors,
      "Core API, credentials, audit, and Console contract must be profile invariant",
    )
  }
  return errors
}

export function validateEngineContract(contract) {
  const errors = []
  const engine = contract?.engine
  if (
    contract?.apiVersion !== "inference-core.llm-machines/v1" ||
    contract?.kind !== "SGLangEngineContract" ||
    contract?.metadata?.runtimeQualificationStatus !==
      "NOT_EVALUATED_RUNTIME" ||
    contract?.metadata?.sourceOnly !== true ||
    contract?.metadata?.containsCredentials !== false
  ) {
    add(errors, "SGLang contract must remain source-only and unqualified")
  }
  if (
    engine?.name !== "sglang" ||
    engine?.version !== "0.5.13" ||
    engine?.tag !== "v0.5.13" ||
    engine?.tagObject !== "cba18f4d8090d23e9273e663db2a0b3b2e39f117" ||
    engine?.sourceCommit !== "28b095c01005d4a3a2a5b637b7d028b07fba31b2" ||
    engine?.sourceArchiveSha256 !==
      "097aaf0dcc1e8e62c4a107f21d1807734ab76ee40ac4bd7e6e72299b1008ea46"
  ) {
    add(errors, "SGLang source identity must remain exactly v0.5.13")
  }
  if (
    contract?.imageBinding?.owner !== "inference-delivery-profile" ||
    contract?.imageBinding?.exactDigestRequired !== true ||
    contract?.imageBinding?.mutableReferenceAllowed !== false ||
    contract?.imageBinding?.historicalLabImageAdmitted !== false ||
    contract?.imageBinding?.hardwareSupportClaimFromSourceSelection !== false
  ) {
    add(
      errors,
      "runtime image and hardware admission must remain profile-owned",
    )
  }
  if (
    !sameJson(contract?.launch?.baseCommand, [
      "python3",
      "-m",
      "sglang.launch_server",
    ]) ||
    contract?.launch?.requestLoggingEnabled !== false ||
    contract?.launch?.credentialArgumentsAllowed !== false ||
    !contract?.launch?.argumentTemplate?.includes("--enable-metrics")
  ) {
    add(errors, "SGLang launch contract is incomplete or unsafe")
  }
  if (
    contract?.network?.placement !== "private-inference-plane" ||
    contract?.network?.directCustomerReachability !== false ||
    !sameJson(contract?.network?.allowedCallers, [
      "litellm-private",
      "prometheus-private-metrics-only",
    ])
  ) {
    add(errors, "SGLang must remain private behind LiteLLM")
  }
  if (
    !sameJson(contract?.routes?.openAiCompatible, [
      {
        allowedCaller: "litellm-private",
        method: "GET",
        path: "/v1/models",
      },
      {
        allowedCaller: "litellm-private",
        method: "POST",
        path: "/v1/chat/completions",
      },
    ]) ||
    contract?.routes?.liveness?.path !== "/health" ||
    contract?.routes?.readiness?.path !== "/health_generate" ||
    contract?.routes?.metrics?.path !== "/metrics" ||
    contract?.routes?.metrics?.allowedCaller !==
      "prometheus-private-metrics-only" ||
    contract?.routes?.nativeAdministrationExposed !== false
  ) {
    add(errors, "SGLang probe and administration route boundary is invalid")
  }
  if (
    contract?.retention?.workloadContentRetention !== "forbidden" ||
    contract?.retention?.requestLogging !== "disabled" ||
    contract?.retention?.responseLogging !== "disabled" ||
    contract?.retention?.requestBodyTracing !== "disabled"
  ) {
    add(errors, "SGLang zero-content-retention contract is incomplete")
  }
  return errors
}

export function validateDeliveryProfile(profile, coreContract) {
  const errors = []
  if (
    !exactKeys(
      profile,
      [
        "apiVersion",
        "kind",
        "metadata",
        "engine",
        "accelerator",
        "model",
        "limits",
        "parallelism",
        "launch",
        "network",
        "probes",
        "capacity",
        "activation",
        "rollback",
        "coreCompatibilityFingerprint",
      ],
      "profile",
      errors,
    )
  ) {
    return errors
  }
  if (
    profile.apiVersion !== "inference-core.llm-machines/v1" ||
    profile.kind !== "InferenceDeliveryProfile"
  ) {
    add(errors, "delivery profile identity is invalid")
  }

  exactKeys(
    profile.metadata,
    ["profileId", "revision", "lifecycleState", "containsCredentials"],
    "metadata",
    errors,
  )
  if (
    !profileIdPattern.test(profile.metadata?.profileId ?? "") ||
    !isPositiveInteger(profile.metadata?.revision) ||
    ![
      "SYNTHETIC_UNMEASURED",
      "CANDIDATE_UNQUALIFIED",
      "ACTIVE_QUALIFIED",
      "RETIRED",
    ].includes(profile.metadata?.lifecycleState) ||
    profile.metadata?.containsCredentials !== false
  ) {
    add(errors, "delivery profile metadata is invalid")
  }

  exactKeys(
    profile.engine,
    ["contractVersion", "sourceCommit", "image"],
    "engine",
    errors,
  )
  if (
    profile.engine?.contractVersion !== "0.5.13" ||
    profile.engine?.sourceCommit !== "28b095c01005d4a3a2a5b637b7d028b07fba31b2"
  ) {
    add(
      errors,
      "delivery profile must bind the selected SGLang source contract",
    )
  }
  validateOciArtifact(profile.engine?.image, "engine.image", errors)
  if (profile.engine?.image?.sourceRevision !== profile.engine?.sourceCommit) {
    add(
      errors,
      "engine image source revision must match the SGLang source commit",
    )
  }

  exactKeys(
    profile.accelerator,
    [
      "backend",
      "vendor",
      "architecture",
      "nodes",
      "devicesPerNode",
      "productionSupportClaim",
    ],
    "accelerator",
    errors,
  )
  if (
    !["cuda", "rocm", "xpu", "cpu"].includes(profile.accelerator?.backend) ||
    !isPositiveInteger(profile.accelerator?.nodes) ||
    !isPositiveInteger(profile.accelerator?.devicesPerNode) ||
    typeof profile.accelerator?.productionSupportClaim !== "boolean"
  ) {
    add(errors, "accelerator topology is invalid")
  }

  exactKeys(
    profile.model,
    [
      "alias",
      "sourceKind",
      "source",
      "revision",
      "artifactDigest",
      "manifestDigest",
      "licenseSpdx",
      "precision",
      "quantization",
      "mountPath",
    ],
    "model",
    errors,
  )
  if (
    !profileIdPattern.test(profile.model?.alias ?? "") ||
    !["huggingface", "signed-release-media"].includes(
      profile.model?.sourceKind,
    ) ||
    typeof profile.model?.source !== "string" ||
    !sourceRevisionPattern.test(profile.model?.revision ?? "") ||
    !sha256Pattern.test(profile.model?.artifactDigest ?? "") ||
    !sha256Pattern.test(profile.model?.manifestDigest ?? "") ||
    !profile.model?.mountPath?.startsWith("/srv/llm-machines/inference-models/")
  ) {
    add(
      errors,
      "model identity must bind an exact source, revision, and digest",
    )
  }

  exactKeys(
    profile.limits,
    ["configuredContextTokens", "maxOutputTokens"],
    "limits",
    errors,
  )
  if (
    !isPositiveInteger(profile.limits?.configuredContextTokens) ||
    !isPositiveInteger(profile.limits?.maxOutputTokens) ||
    profile.limits?.maxOutputTokens > profile.limits?.configuredContextTokens
  ) {
    add(errors, "configured context and output limits are invalid")
  }

  exactKeys(
    profile.parallelism,
    ["tensor", "pipeline", "data", "replicas"],
    "parallelism",
    errors,
  )
  const parallelValues = [
    profile.parallelism?.tensor,
    profile.parallelism?.pipeline,
    profile.parallelism?.data,
    profile.parallelism?.replicas,
  ]
  if (parallelValues.some((value) => !isPositiveInteger(value))) {
    add(errors, "parallelism and replicas must be positive integers")
  } else {
    const requiredDevices = parallelValues.reduce(
      (left, right) => left * right,
      1,
    )
    const availableDevices =
      profile.accelerator.nodes * profile.accelerator.devicesPerNode
    if (requiredDevices > availableDevices) {
      add(errors, "parallelism requires more devices than the profile declares")
    }
  }

  exactKeys(profile.launch, ["additionalArguments"], "launch", errors)
  if (!Array.isArray(profile.launch?.additionalArguments)) {
    add(errors, "launch.additionalArguments must be an array")
  } else {
    const names = new Set()
    for (const argument of profile.launch.additionalArguments) {
      exactKeys(argument, ["name", "value"], "launch argument", errors)
      if (
        !/^--[a-z0-9][a-z0-9-]{1,63}$/.test(argument?.name ?? "") ||
        reservedLaunchArguments.has(argument?.name)
      ) {
        add(
          errors,
          `launch argument ${argument?.name ?? "<missing>"} is reserved or invalid`,
        )
      }
      if (names.has(argument?.name))
        add(errors, `launch argument ${argument.name} is duplicated`)
      names.add(argument?.name)
      if (
        typeof argument?.value === "string" &&
        /(?:-----BEGIN|gh[pousr]_|github_pat_|sk-(?:proj-)?|password|secret|token)/i.test(
          argument.value,
        )
      ) {
        add(errors, "launch arguments cannot contain credential-like values")
      }
    }
  }

  if (
    !sameJson(profile.network?.allowedCallers, [
      "litellm-private",
      "prometheus-private-metrics-only",
    ]) ||
    profile.network?.visibility !== "private-inference-plane" ||
    !profileIdPattern.test(profile.network?.serviceName ?? "") ||
    !Number.isInteger(profile.network?.port) ||
    profile.network.port < 1024 ||
    profile.network.port > 65535
  ) {
    add(
      errors,
      "inference network must remain private to reviewed Core callers",
    )
  }
  const expectedProbes = {
    liveness: { method: "GET", path: "/health" },
    metrics: { method: "GET", path: "/metrics" },
    readiness: { method: "GET", path: "/health_generate" },
  }
  if (!sameJson(profile.probes, expectedProbes)) {
    add(
      errors,
      "health, readiness, and metrics probes must match the SGLang contract",
    )
  }

  exactKeys(
    profile.capacity,
    [
      "state",
      "profileRevision",
      "engineImageDigest",
      "modelArtifactDigest",
      "evidenceDigest",
      "effectiveContextTokens",
      "maxOutputTokens",
      "throughputTokensPerSecond",
      "maxConcurrentRequests",
      "p95LatencyMilliseconds",
      "queue",
    ],
    "capacity",
    errors,
  )
  const measurementFields = [
    "profileRevision",
    "engineImageDigest",
    "modelArtifactDigest",
    "evidenceDigest",
    "effectiveContextTokens",
    "maxOutputTokens",
    "throughputTokensPerSecond",
    "maxConcurrentRequests",
    "p95LatencyMilliseconds",
  ]
  if (profile.capacity?.state === "UNMEASURED") {
    if (measurementFields.some((field) => profile.capacity[field] !== null)) {
      add(errors, "an unmeasured profile cannot contain capacity claims")
    }
    if (
      profile.capacity?.queue?.state !== "not_configured" ||
      profile.capacity?.queue?.maxObservedDepth !== null
    ) {
      add(errors, "an unmeasured profile cannot contain a queue claim")
    }
  } else if (profile.capacity?.state === "MEASURED") {
    if (
      profile.capacity.profileRevision !== profile.metadata.revision ||
      profile.capacity.engineImageDigest !== profile.engine.image.digest ||
      profile.capacity.modelArtifactDigest !== profile.model.artifactDigest ||
      !sha256Pattern.test(profile.capacity.evidenceDigest ?? "") ||
      !isPositiveInteger(profile.capacity.effectiveContextTokens) ||
      !isPositiveInteger(profile.capacity.maxOutputTokens) ||
      !(profile.capacity.throughputTokensPerSecond > 0) ||
      !isPositiveInteger(profile.capacity.maxConcurrentRequests) ||
      !(profile.capacity.p95LatencyMilliseconds > 0) ||
      profile.capacity.effectiveContextTokens >
        profile.limits.configuredContextTokens ||
      profile.capacity.maxOutputTokens > profile.limits.maxOutputTokens
    ) {
      add(
        errors,
        "measured capacity is stale, incomplete, or exceeds configured limits",
      )
    }
    if (
      !["not_configured", "measured"].includes(
        profile.capacity?.queue?.state,
      ) ||
      (profile.capacity?.queue?.state === "measured" &&
        !Number.isInteger(profile.capacity?.queue?.maxObservedDepth)) ||
      (profile.capacity?.queue?.state === "not_configured" &&
        profile.capacity?.queue?.maxObservedDepth !== null)
    ) {
      add(
        errors,
        "queue capacity must be measured explicitly or remain not configured",
      )
    }
  } else {
    add(errors, "capacity state must be UNMEASURED or MEASURED")
  }

  if (profile.activation?.state === "ACTIVE") {
    if (
      profile.metadata.lifecycleState !== "ACTIVE_QUALIFIED" ||
      profile.capacity.state !== "MEASURED" ||
      profile.accelerator.productionSupportClaim !== true ||
      profile.activation.qualifiedProfileDigest !==
        profileQualificationDigest(profile)
    ) {
      add(errors, "only the exact measured and qualified profile may activate")
    }
  } else if (
    profile.activation?.state !== "INACTIVE" ||
    profile.activation?.qualifiedProfileDigest !== null ||
    profile.metadata.lifecycleState === "ACTIVE_QUALIFIED" ||
    profile.accelerator.productionSupportClaim !== false
  ) {
    add(errors, "inactive profiles cannot make a production support claim")
  }

  if (
    !profileIdPattern.test(profile.rollback?.profileId ?? "") ||
    !isPositiveInteger(profile.rollback?.revision) ||
    !sha256Pattern.test(profile.rollback?.engineImageDigest ?? "") ||
    !sha256Pattern.test(profile.rollback?.modelArtifactDigest ?? "")
  ) {
    add(errors, "rollback must bind an exact prior profile and artifacts")
  }
  if (
    profile.coreCompatibilityFingerprint !==
    coreCompatibilityFingerprint(coreContract)
  ) {
    add(errors, "delivery profile does not match the invariant Core interface")
  }

  const serialized = canonicalJson(profile)
  for (const [pattern, message] of [
    [
      /\bintel[ -]?arc[ -]?b50\b|\bb50\b/i,
      "demo accelerator identity is forbidden",
    ],
    [/\bsglang-xpu\b/i, "historical XPU image alias is forbidden"],
    [
      /(?:^|[/:@._-])latest(?:$|[/:@._-])/i,
      "mutable latest reference is forbidden",
    ],
    [
      /(?:^|[\s"'])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?:$|[\s"'])/m,
      "internal IP is forbidden",
    ],
    [
      /\b(?:vm\d{2,}|proxmox|pve)\b|\.(?:home|internal|lan|local)\b/i,
      "demo or internal hostname is forbidden",
    ],
  ]) {
    if (pattern.test(serialized)) add(errors, message)
  }
  return errors
}

export function validateSchema(schema) {
  const errors = []
  if (
    schema?.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
    schema?.$id !== "urn:llm-machines:schema:inference-delivery-profile:v1" ||
    schema?.properties?.engine?.properties?.contractVersion?.const !==
      "0.5.13" ||
    schema?.properties?.engine?.properties?.sourceCommit?.const !==
      "28b095c01005d4a3a2a5b637b7d028b07fba31b2" ||
    schema?.properties?.metadata?.properties?.containsCredentials?.const !==
      false ||
    schema?.properties?.network?.properties?.visibility?.const !==
      "private-inference-plane" ||
    schema?.$defs?.sha256?.pattern !== "^sha256:[a-f0-9]{64}$"
  ) {
    add(
      errors,
      "delivery profile schema does not freeze the reviewed identity boundary",
    )
  }
  return errors
}

export function validateSourceSafety(sources) {
  const errors = []
  const joined = Object.entries(sources)
    .map(([name, source]) => `\n${name}\n${source}`)
    .join("\n")
  for (const [pattern, message] of [
    [
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
      "private key material is forbidden",
    ],
    [
      /\b(?:gh[pousr]_[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-(?:proj-)?[A-Za-z0-9_-]{16,})\b/i,
      "credential-like token is forbidden",
    ],
    [
      /(?:\/Users\/|\/Volumes\/|\/home\/[^\s]+\/|docs\/lab\/|\.ovpn\b)/i,
      "lab or workstation path is forbidden",
    ],
  ]) {
    if (pattern.test(joined)) add(errors, message)
  }
  return errors
}

export function loadContracts() {
  return {
    core: JSON.parse(
      readFileSync(path.join(root, "core-interface-contract.json"), "utf8"),
    ),
    engine: JSON.parse(
      readFileSync(path.join(root, "sglang-engine-contract.json"), "utf8"),
    ),
    schema: JSON.parse(
      readFileSync(path.join(root, "delivery-profile.schema.json"), "utf8"),
    ),
  }
}

export function validateRepository() {
  const errors = []
  const actualFiles = listFiles(root).sort()
  if (!sameJson(actualFiles, expectedFiles)) {
    add(
      errors,
      `inference contract file set must be exactly ${expectedFiles.join(", ")}`,
    )
  }

  const sources = Object.fromEntries(
    expectedFiles
      .filter((name) => !name.endsWith(".mjs"))
      .map((name) => [name, readFileSync(path.join(root, name), "utf8")]),
  )
  const core = parseJson(
    sources["core-interface-contract.json"],
    "Core interface contract",
    errors,
  )
  const engine = parseJson(
    sources["sglang-engine-contract.json"],
    "SGLang engine contract",
    errors,
  )
  const schema = parseJson(
    sources["delivery-profile.schema.json"],
    "delivery profile schema",
    errors,
  )
  if (core) errors.push(...validateCoreContract(core))
  if (engine) errors.push(...validateEngineContract(engine))
  if (schema) errors.push(...validateSchema(schema))
  if (core) {
    for (const name of [
      "fixtures/synthetic-single-node.json",
      "fixtures/synthetic-multi-node.json",
    ]) {
      const profile = parseJson(sources[name], name, errors)
      if (profile) errors.push(...validateDeliveryProfile(profile, core))
    }
  }
  errors.push(...validateSourceSafety(sources))
  return errors
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = validateRepository()
  if (errors.length > 0) {
    process.stderr.write(`${errors.map((error) => `- ${error}`).join("\n")}\n`)
    process.exit(1)
  }
  process.stdout.write("Inference delivery-profile validation passed.\n")
}
