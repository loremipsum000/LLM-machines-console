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

export function renderVm103LiteLlmRoute(
  sourceProfile,
  renderedProfile,
  expectedInferenceHost,
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
  const config = [
    "model_list:",
    `  - model_name: ${model.alias}`,
    "    litellm_params:",
    `      model: openai/${model.alias}`,
    `      api_base: ${url.toString()}`,
    "      api_key: os.environ/UPSTREAM_API_KEY",
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
    profileId: sourceProfile.metadata.profileId,
    profileRevision: sourceProfile.metadata.revision,
    qualifiedProfileDigest: sourceProfile.activation.qualifiedProfileDigest,
    renderedProfileDigest: canonicalSha256(canonicalRenderedProfile),
    rollback: {
      profileId: sourceProfile.rollback.profileId,
      revision: sourceProfile.rollback.revision,
      engineImageDigest: sourceProfile.rollback.engineImageDigest,
      modelArtifactDigest: sourceProfile.rollback.modelArtifactDigest,
    },
    sha256: createHash("sha256").update(config).digest("hex"),
  }
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
    expectedInferenceHost,
    endpoint,
    outputPath,
  ] = process.argv.slice(2)
  if (
    !sourceProfilePath ||
    !renderedProfilePath ||
    !expectedInferenceHost ||
    !endpoint ||
    !outputPath
  ) {
    throw new Error(
      "Usage: render-vm103-litellm-route.mjs SOURCE_PROFILE RENDERED_PROFILE EXPECTED_PRIVATE_HOST ENDPOINT OUTPUT",
    )
  }
  const sourceProfile = JSON.parse(await readFile(sourceProfilePath, "utf8"))
  const renderedProfile = JSON.parse(
    await readFile(renderedProfilePath, "utf8"),
  )
  const result = renderVm103LiteLlmRoute(
    sourceProfile,
    renderedProfile,
    expectedInferenceHost,
    endpoint,
  )
  await writeFile(outputPath, result.config, { flag: "wx", mode: 0o600 })
  process.stdout.write(
    `${JSON.stringify({
      coreCompatibilityFingerprint: result.coreCompatibilityFingerprint,
      engineImageDigest: result.engineImageDigest,
      evidenceDigest: result.evidenceDigest,
      modelAlias: result.modelAlias,
      modelArtifactDigest: result.modelArtifactDigest,
      modelManifestDigest: result.modelManifestDigest,
      profileId: result.profileId,
      profileRevision: result.profileRevision,
      qualifiedProfileDigest: result.qualifiedProfileDigest,
      renderedProfileDigest: result.renderedProfileDigest,
      rollback: result.rollback,
      sha256: result.sha256,
    })}\n`,
  )
}
