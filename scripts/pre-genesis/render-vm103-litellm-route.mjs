#!/usr/bin/env node

import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { renderDeliveryProfile } from "../../infra/inference/render-profile.mjs"
import {
  canonicalJson,
  sha256 as canonicalSha256,
  coreCompatibilityFingerprint,
  loadContracts,
  validateDeliveryProfile,
} from "../../infra/inference/validate-profile.mjs"

const contracts = loadContracts()
export const vm103CoreCompatibilityFingerprint = coreCompatibilityFingerprint(
  contracts.core,
)

export function isSafeSglangWorkloadUnit(value) {
  return (
    typeof value === "string" &&
    /^(?=.{1,128}$)(?:[a-z0-9][a-z0-9_.-]*-)?sglang(?:-[a-z0-9][a-z0-9_.-]*)?\.service$/.test(
      value,
    )
  )
}

export function renderVm103LiteLlmRoute(
  sourceProfile,
  renderedProfile,
  placementEnvironment,
  renderedConfigurationManifest,
  expectedRenderedConfigurationManifestDigest,
  endpoint,
  now = new Date(),
) {
  const sourceErrors = validateDeliveryProfile(sourceProfile, contracts.core)
  if (
    sourceErrors.length > 0 ||
    sourceProfile?.metadata?.admissionScope !== "INTERNAL_TEST_ONLY" ||
    sourceProfile?.metadata?.lifecycleState !==
      "ACTIVE_MEASURED_INTERNAL_TEST" ||
    sourceProfile?.activation?.state !== "ACTIVE_INTERNAL_TEST" ||
    sourceProfile?.accelerator?.productionSupportClaim !== false ||
    sourceProfile?.capacity?.state !== "MEASURED"
  ) {
    throw new Error(
      `The LiteLLM route requires one exact activated internal-test source profile.${sourceErrors.length > 0 ? ` ${sourceErrors.join(" ")}` : ""}`,
    )
  }

  const canonicalRenderedProfile = canonicalJson(renderedProfile)
  const expectedRenderedProfile = renderDeliveryProfile(
    sourceProfile,
    contracts,
  )
  if (canonicalJson(expectedRenderedProfile) !== canonicalRenderedProfile) {
    throw new Error(
      "The LiteLLM route requires the exact canonical rendering of its activated source profile.",
    )
  }

  const placement = placementBinding(
    placementEnvironment,
    renderedConfigurationManifest,
    expectedRenderedConfigurationManifestDigest,
  )
  if (
    placement.LLMM_INFERENCE_PROFILE_FILE !==
      `${sourceProfile.metadata.profileId}.json` ||
    placement.LLMM_INFERENCE_PROFILE_ID !== sourceProfile.metadata.profileId ||
    Number(placement.LLMM_INFERENCE_PROFILE_REVISION) !==
      sourceProfile.metadata.revision ||
    placement.LLMM_INFERENCE_RENDERED_PROFILE_DIGEST !==
      canonicalSha256(canonicalRenderedProfile) ||
    placement.LLMM_INFERENCE_QUALIFIED_PROFILE_DIGEST !==
      sourceProfile.activation.qualifiedProfileDigest ||
    placement.LLMM_INFERENCE_CORE_COMPATIBILITY_FINGERPRINT !==
      expectedRenderedProfile.coreCompatibilityFingerprint
  ) {
    throw new Error(
      "The LiteLLM route requires the exact inference profile bound by the rendered placement artifact.",
    )
  }

  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("The LiteLLM route requires an exact validation time.")
  }
  const measuredAt = Date.parse(sourceProfile.capacity.measuredAt)
  const validUntil = Date.parse(sourceProfile.capacity.validUntil)
  if (
    !Number.isFinite(measuredAt) ||
    !Number.isFinite(validUntil) ||
    measuredAt > now.getTime() ||
    validUntil <= now.getTime()
  ) {
    throw new Error(
      "The LiteLLM route requires one current measured internal profile.",
    )
  }

  const url = new URL(endpoint)
  const expectedInferenceHost = placement.LLMM_INFERENCE_HOST
  if (
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.pathname !== "/v1" ||
    url.search ||
    url.hash ||
    !privateIpv4(expectedInferenceHost) ||
    url.hostname !== expectedInferenceHost ||
    Number(url.port) !== sourceProfile.network.port
  ) {
    throw new Error(
      "The LiteLLM route requires the exact private endpoint bound by the activated source profile.",
    )
  }

  const model = expectedRenderedProfile.capabilityAdvertisement.models[0]
  const renderedPlacementDigest = canonicalSha256(placementEnvironment)
  const renderedProfileDigest = canonicalSha256(canonicalRenderedProfile)
  const runtimeBindingDigest = canonicalSha256(
    canonicalJson({
      apiBase: url.toString(),
      evidenceDigest: sourceProfile.capacity.evidenceDigest,
      profileId: sourceProfile.metadata.profileId,
      profileRevision: sourceProfile.metadata.revision,
      qualifiedProfileDigest: sourceProfile.activation.qualifiedProfileDigest,
      renderedConfigurationManifestDigest:
        expectedRenderedConfigurationManifestDigest,
      renderedPlacementDigest,
      renderedProfileDigest,
    }),
  )
  const runtimeModelId = `llmm-route-${runtimeBindingDigest.slice(7)}`
  const config = [
    "model_list:",
    `  - model_name: ${model.alias}`,
    "    litellm_params:",
    `      model: openai/${model.alias}`,
    `      api_base: ${url.toString()}`,
    "      api_key: os.environ/UPSTREAM_API_KEY",
    "    model_info:",
    `      id: ${runtimeModelId}`,
    "general_settings:",
    "  allow_requests_on_db_unavailable: false",
    "  master_key: os.environ/LITELLM_MASTER_KEY",
    "  store_model_in_db: true",
    "  store_prompts_in_spend_logs: false",
    "litellm_settings:",
    "  disable_error_logs: true",
    "  disable_spend_logs: false",
    "  drop_params: true",
    "  log_raw_request_response: false",
    "  telemetry: false",
    "  turn_off_message_logging: true",
    "",
  ].join("\n")

  return {
    config,
    coreCompatibilityFingerprint: vm103CoreCompatibilityFingerprint,
    engineImageDigest: sourceProfile.engine.image.digest,
    evidenceDigest: sourceProfile.capacity.evidenceDigest,
    modelAlias: model.alias,
    modelArtifactDigest: sourceProfile.model.artifactDigest,
    modelManifestDigest: sourceProfile.model.manifestDigest,
    apiBase: url.toString(),
    profileId: sourceProfile.metadata.profileId,
    profileRevision: sourceProfile.metadata.revision,
    qualifiedProfileDigest: sourceProfile.activation.qualifiedProfileDigest,
    renderedConfigurationManifestDigest:
      expectedRenderedConfigurationManifestDigest,
    renderedPlacementDigest,
    renderedProfileDigest,
    rollback: {
      profileId: sourceProfile.rollback.profileId,
      revision: sourceProfile.rollback.revision,
      engineImageDigest: sourceProfile.rollback.engineImageDigest,
      modelArtifactDigest: sourceProfile.rollback.modelArtifactDigest,
    },
    runtimeBindingDigest,
    runtimeModelId,
    sha256: `sha256:${createHash("sha256").update(config).digest("hex")}`,
  }
}

const placementKeys = [
  "LLMM_BFF_IMAGE",
  "LLMM_CONFIGURATION_ROOT",
  "LLMM_EDGE_IMAGE",
  "LLMM_INFERENCE_CORE_COMPATIBILITY_FINGERPRINT",
  "LLMM_INFERENCE_HOST",
  "LLMM_INFERENCE_MODEL_ADMISSION_DIR",
  "LLMM_INFERENCE_PROFILE_FILE",
  "LLMM_INFERENCE_PROFILE_ID",
  "LLMM_INFERENCE_PROFILE_REVISION",
  "LLMM_INFERENCE_QUALIFIED_PROFILE_DIGEST",
  "LLMM_INFERENCE_RENDERED_PROFILE_DIGEST",
  "LLMM_INFERENCE_WORKLOAD_UNIT",
  "LLMM_SECRET_ROOT",
  "LLMM_SOURCE_ROOT",
  "LLMM_WEB_IMAGE",
]
const renderedConfigurationArtifacts = [
  "bff.env",
  "image-bindings.json",
  "placement.env",
  "product-edge.nginx.conf",
  "web.env",
]

function placementBinding(
  placementEnvironment,
  renderedConfigurationManifest,
  expectedManifestDigest,
) {
  if (
    typeof placementEnvironment !== "string" ||
    typeof renderedConfigurationManifest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(expectedManifestDigest) ||
    canonicalSha256(renderedConfigurationManifest) !== expectedManifestDigest
  ) {
    throw new Error(
      "The LiteLLM route requires the exact rendered placement manifest.",
    )
  }

  let manifest
  try {
    manifest = JSON.parse(renderedConfigurationManifest)
  } catch {
    throw new Error(
      "The LiteLLM route requires the exact rendered placement manifest.",
    )
  }
  const placementArtifact = manifest?.artifacts?.find(
    (artifact) => artifact?.name === "placement.env",
  )
  if (
    JSON.stringify(Object.keys(manifest ?? {}).sort()) !==
      JSON.stringify(["artifacts", "schema", "source"]) ||
    manifest?.schema !== "llm-machines.vm103-founder-rendered-config.v1" ||
    !manifest.source ||
    JSON.stringify(Object.keys(manifest.source).sort()) !==
      JSON.stringify(["commit", "tree"]) ||
    !/^[0-9a-f]{40}$/.test(manifest.source.commit) ||
    !/^[0-9a-f]{40}$/.test(manifest.source.tree) ||
    !Array.isArray(manifest.artifacts) ||
    JSON.stringify(manifest.artifacts.map((artifact) => artifact?.name)) !==
      JSON.stringify(renderedConfigurationArtifacts) ||
    manifest.artifacts.some(
      (artifact) =>
        JSON.stringify(Object.keys(artifact ?? {}).sort()) !==
          JSON.stringify(["name", "sha256"]) ||
        !/^sha256:[0-9a-f]{64}$/.test(artifact.sha256),
    ) ||
    manifest.artifacts.filter((artifact) => artifact?.name === "placement.env")
      .length !== 1 ||
    placementArtifact?.sha256 !== canonicalSha256(placementEnvironment)
  ) {
    throw new Error(
      "The LiteLLM route requires the exact rendered placement manifest.",
    )
  }

  const placement = parseEnvironment(placementEnvironment)
  if (
    JSON.stringify(Object.keys(placement).sort()) !==
      JSON.stringify(placementKeys) ||
    !privateIpv4(placement.LLMM_INFERENCE_HOST) ||
    !/^[a-z0-9][a-z0-9.-]{2,62}\.json$/.test(
      placement.LLMM_INFERENCE_PROFILE_FILE,
    ) ||
    placement.LLMM_INFERENCE_PROFILE_FILE !==
      `${placement.LLMM_INFERENCE_PROFILE_ID}.json` ||
    !/^[a-z0-9][a-z0-9.-]{2,62}$/.test(placement.LLMM_INFERENCE_PROFILE_ID) ||
    !/^[1-9][0-9]*$/.test(placement.LLMM_INFERENCE_PROFILE_REVISION) ||
    !/^sha256:[0-9a-f]{64}$/.test(
      placement.LLMM_INFERENCE_CORE_COMPATIBILITY_FINGERPRINT,
    ) ||
    !/^sha256:[0-9a-f]{64}$/.test(
      placement.LLMM_INFERENCE_QUALIFIED_PROFILE_DIGEST,
    ) ||
    !/^sha256:[0-9a-f]{64}$/.test(
      placement.LLMM_INFERENCE_RENDERED_PROFILE_DIGEST,
    ) ||
    !isSafeSglangWorkloadUnit(placement.LLMM_INFERENCE_WORKLOAD_UNIT)
  ) {
    throw new Error(
      "The LiteLLM route requires the exact rendered placement artifact.",
    )
  }
  return placement
}

function parseEnvironment(source) {
  const entries = source.split("\n")
  if (entries.at(-1) !== "") {
    throw new Error(
      "The LiteLLM route requires the exact rendered placement artifact.",
    )
  }
  const result = {}
  for (const entry of entries.slice(0, -1)) {
    const separator = entry.indexOf("=")
    const name = entry.slice(0, separator)
    const value = entry.slice(separator + 1)
    if (
      separator < 1 ||
      !/^[A-Z][A-Z0-9_]*$/.test(name) ||
      !value ||
      Object.hasOwn(result, name) ||
      /[\r\0]/.test(value)
    ) {
      throw new Error(
        "The LiteLLM route requires the exact rendered placement artifact.",
      )
    }
    result[name] = value
  }
  return result
}

function privateIpv4(value) {
  const parts = value.split(".")
  if (
    parts.length !== 4 ||
    parts.some(
      (part) =>
        !/^\d{1,3}$/.test(part) ||
        String(Number(part)) !== part ||
        Number(part) > 255,
    )
  ) {
    return false
  }
  const [first, second] = parts.map(Number)
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [
    sourceProfilePath,
    renderedProfilePath,
    placementEnvironmentPath,
    renderedConfigurationManifestPath,
    expectedRenderedConfigurationManifestDigest,
    endpoint,
    outputPath,
  ] = process.argv.slice(2)
  if (
    !sourceProfilePath ||
    !renderedProfilePath ||
    !placementEnvironmentPath ||
    !renderedConfigurationManifestPath ||
    !expectedRenderedConfigurationManifestDigest ||
    !endpoint ||
    !outputPath
  ) {
    throw new Error(
      "Usage: render-vm103-litellm-route.mjs SOURCE_PROFILE RENDERED_PROFILE PLACEMENT_ENV RENDERED_CONFIG_MANIFEST EXPECTED_MANIFEST_SHA256 ENDPOINT OUTPUT",
    )
  }
  const sourceProfile = JSON.parse(await readFile(sourceProfilePath, "utf8"))
  const renderedProfile = JSON.parse(
    await readFile(renderedProfilePath, "utf8"),
  )
  const placementEnvironment = await readFile(placementEnvironmentPath, "utf8")
  const renderedConfigurationManifest = await readFile(
    renderedConfigurationManifestPath,
    "utf8",
  )
  const result = renderVm103LiteLlmRoute(
    sourceProfile,
    renderedProfile,
    placementEnvironment,
    renderedConfigurationManifest,
    expectedRenderedConfigurationManifestDigest,
    endpoint,
  )
  await writeFile(outputPath, result.config, { flag: "wx", mode: 0o600 })
  process.stdout.write(
    `${JSON.stringify({
      coreCompatibilityFingerprint: result.coreCompatibilityFingerprint,
      apiBase: result.apiBase,
      engineImageDigest: result.engineImageDigest,
      evidenceDigest: result.evidenceDigest,
      modelAlias: result.modelAlias,
      modelArtifactDigest: result.modelArtifactDigest,
      modelManifestDigest: result.modelManifestDigest,
      profileId: result.profileId,
      profileRevision: result.profileRevision,
      qualifiedProfileDigest: result.qualifiedProfileDigest,
      renderedConfigurationManifestDigest:
        result.renderedConfigurationManifestDigest,
      renderedPlacementDigest: result.renderedPlacementDigest,
      renderedProfileDigest: result.renderedProfileDigest,
      rollback: result.rollback,
      runtimeBindingDigest: result.runtimeBindingDigest,
      runtimeModelId: result.runtimeModelId,
      sha256: result.sha256,
    })}\n`,
  )
}
