#!/usr/bin/env node

import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

export function renderVm103LiteLlmRoute(profile, endpoint, now = new Date()) {
  const url = new URL(endpoint)
  const model = profile?.capabilityAdvertisement?.models?.[0]
  const freshness = profile?.capabilityAdvertisement?.freshness
  if (
    profile?.apiVersion !== "inference-core.llm-machines/v1" ||
    profile?.kind !== "RenderedInferenceDeliveryProfile" ||
    profile?.qualification?.scope !== "INTERNAL_TEST_ONLY" ||
    profile?.qualification?.productionCapacityClaim !== false ||
    profile?.capabilityAdvertisement?.state !== "ACTIVE_MEASURED" ||
    profile.capabilityAdvertisement.models.length !== 1 ||
    typeof model?.alias !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(model.alias) ||
    !freshness?.measuredAt ||
    !freshness?.validUntil ||
    Date.parse(freshness.measuredAt) > now.getTime() ||
    Date.parse(freshness.validUntil) <= now.getTime() ||
    profile?.network?.visibility !== "private-inference-plane" ||
    !profile.network.allowedCallers?.includes("litellm-private")
  ) {
    throw new Error(
      "The LiteLLM route requires one current measured internal profile.",
    )
  }
  if (
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.pathname !== "/v1" ||
    url.search ||
    url.hash ||
    !privateIpv4(url.hostname) ||
    !Number.isInteger(Number(url.port)) ||
    Number(url.port) < 1024 ||
    Number(url.port) > 65_535
  ) {
    throw new Error(
      "The LiteLLM route requires one exact private SGLang endpoint.",
    )
  }
  const expectedArguments = [
    "--served-model-name",
    model.alias,
    "--port",
    url.port,
  ]
  const command = profile?.engine?.command
  if (
    !Array.isArray(command) ||
    expectedArguments.some(
      (value, index) =>
        command.indexOf(value) < 0 ||
        (index % 2 === 1 &&
          command[command.indexOf(expectedArguments[index - 1]) + 1] !== value),
    )
  ) {
    throw new Error(
      "The LiteLLM route disagrees with the measured engine command.",
    )
  }

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
    sha256: createHash("sha256").update(config).digest("hex"),
    modelAlias: model.alias,
    profileId: profile.source.profileId,
    profileRevision: profile.source.revision,
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
  const [profilePath, endpoint, outputPath] = process.argv.slice(2)
  if (!profilePath || !endpoint || !outputPath) {
    throw new Error(
      "Usage: render-vm103-litellm-route.mjs PROFILE ENDPOINT OUTPUT",
    )
  }
  const profile = JSON.parse(await readFile(profilePath, "utf8"))
  const result = renderVm103LiteLlmRoute(profile, endpoint)
  await writeFile(outputPath, result.config, { flag: "wx", mode: 0o600 })
  process.stdout.write(
    `${JSON.stringify({
      modelAlias: result.modelAlias,
      profileId: result.profileId,
      profileRevision: result.profileRevision,
      sha256: result.sha256,
    })}\n`,
  )
}
