#!/usr/bin/env node

import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  canonicalJson,
  coreCompatibilityFingerprint,
  loadContracts,
  validateDeliveryProfile,
} from "./validate-profile.mjs"

const root = path.dirname(fileURLToPath(import.meta.url))

export function renderDeliveryProfile(profile, contracts = loadContracts()) {
  const errors = validateDeliveryProfile(profile, contracts.core)
  if (errors.length > 0) throw new Error(errors.join("\n"))

  const command = [
    ...contracts.engine.launch.baseCommand,
    "--model-path",
    profile.model.mountPath,
    "--served-model-name",
    profile.model.alias,
    "--host",
    "0.0.0.0",
    "--port",
    String(profile.network.port),
    "--context-length",
    String(profile.limits.configuredContextTokens),
    "--tp-size",
    String(profile.parallelism.tensor),
    "--pp-size",
    String(profile.parallelism.pipeline),
    "--dp-size",
    String(profile.parallelism.data),
    "--enable-metrics",
    "--log-level-http",
    "warning",
    "--uvicorn-access-log-exclude-prefixes",
    "/",
  ]
  for (const argument of profile.launch.additionalArguments) {
    command.push(argument.name)
    if (argument.value !== null) command.push(String(argument.value))
  }

  const capabilityAdvertisement =
    ["ACTIVE", "ACTIVE_INTERNAL_TEST"].includes(profile.activation.state) &&
    profile.capacity.state === "MEASURED"
      ? {
          state: "ACTIVE_MEASURED",
          freshness: {
            measuredAt: profile.capacity.measuredAt,
            validUntil: profile.capacity.validUntil,
          },
          models: [
            {
              alias: profile.model.alias,
              contextTokens: profile.capacity.effectiveContextTokens,
              maxConcurrentRequests: profile.capacity.maxConcurrentRequests,
              maxOutputTokens: profile.capacity.maxOutputTokens,
              p95LatencyMilliseconds: profile.capacity.p95LatencyMilliseconds,
              queue: profile.capacity.queue,
              throughputTokensPerSecond:
                profile.capacity.throughputTokensPerSecond,
            },
          ],
        }
      : {
          freshness: { measuredAt: null, validUntil: null },
          models: [],
          state: "UNAVAILABLE_UNMEASURED",
        }

  return {
    apiVersion: "inference-core.llm-machines/v1",
    kind: "RenderedInferenceDeliveryProfile",
    source: {
      profileId: profile.metadata.profileId,
      revision: profile.metadata.revision,
    },
    coreCompatibilityFingerprint: coreCompatibilityFingerprint(contracts.core),
    engine: {
      image: `${profile.engine.image.repository}:${profile.engine.image.version}@${profile.engine.image.digest}`,
      command,
    },
    model: {
      artifactDigest: profile.model.artifactDigest,
      manifestDigest: profile.model.manifestDigest,
      mountPath: profile.model.mountPath,
      revision: profile.model.revision,
      source: profile.model.source,
    },
    network: {
      allowedCallers: profile.network.allowedCallers,
      serviceName: profile.network.serviceName,
      visibility: profile.network.visibility,
    },
    probes: profile.probes,
    capabilityAdvertisement,
    qualification: {
      evidenceDigest: profile.capacity.evidenceDigest,
      scope: profile.metadata.admissionScope,
      productionCapacityClaim:
        profile.accelerator.productionSupportClaim === true,
      qualifiedProfileDigest: profile.activation.qualifiedProfileDigest,
    },
    rollback: profile.rollback,
  }
}

export function renderCanonicalJson(profile, contracts = loadContracts()) {
  return `${canonicalJson(renderDeliveryProfile(profile, contracts))}\n`
}

function parseArguments(arguments_) {
  if (arguments_.length !== 2 || arguments_[0] !== "--profile") {
    throw new Error("usage: render-profile.mjs --profile <profile.json>")
  }
  return arguments_[1]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const profilePath = path.resolve(
      root,
      "../..",
      parseArguments(process.argv.slice(2)),
    )
    const profile = JSON.parse(readFileSync(profilePath, "utf8"))
    process.stdout.write(renderCanonicalJson(profile))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
}
