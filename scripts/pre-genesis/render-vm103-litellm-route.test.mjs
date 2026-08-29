import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { renderDeliveryProfile } from "../../infra/inference/render-profile.mjs"
import {
  canonicalJson,
  loadContracts,
  profileQualificationDigest,
  sha256,
  validateDeliveryProfile,
} from "../../infra/inference/validate-profile.mjs"
import { renderVm103LiteLlmRoute } from "./render-vm103-litellm-route.mjs"

const contracts = loadContracts()
const syntheticProfile = JSON.parse(
  readFileSync(
    new URL(
      "../../infra/inference/fixtures/synthetic-single-node.json",
      import.meta.url,
    ),
    "utf8",
  ),
)
const now = new Date("2026-08-25T12:00:00.000Z")

function sourceProfile() {
  const profile = structuredClone(syntheticProfile)
  profile.metadata.admissionScope = "INTERNAL_TEST_ONLY"
  profile.metadata.lifecycleState = "ACTIVE_MEASURED_INTERNAL_TEST"
  profile.accelerator.productionSupportClaim = false
  profile.engine.image.sbomDigest = null
  profile.engine.image.provenanceDigest = null
  profile.network.port = 30_005
  profile.capacity = {
    state: "MEASURED",
    profileRevision: profile.metadata.revision,
    engineImageDigest: profile.engine.image.digest,
    modelArtifactDigest: profile.model.artifactDigest,
    evidenceDigest: `sha256:${"4".repeat(64)}`,
    measuredAt: "2026-08-24T17:08:51.086Z",
    validUntil: "2026-09-23T17:08:51.086Z",
    effectiveContextTokens: profile.limits.configuredContextTokens,
    maxOutputTokens: profile.limits.maxOutputTokens,
    throughputTokensPerSecond: 12.5,
    maxConcurrentRequests: 1,
    p95LatencyMilliseconds: 125,
    queue: { maxObservedDepth: 0, state: "measured" },
  }
  profile.activation.state = "ACTIVE_INTERNAL_TEST"
  profile.activation.qualifiedProfileDigest =
    profileQualificationDigest(profile)
  return profile
}

function placementArtifacts(source, rendered, overrides = {}) {
  const values = {
    LLMM_BFF_IMAGE: `sha256:${"b".repeat(64)}`,
    LLMM_CONFIGURATION_ROOT: "/etc/llmm/configuration",
    LLMM_EDGE_IMAGE: `nginx@sha256:${"c".repeat(64)}`,
    LLMM_INFERENCE_CORE_COMPATIBILITY_FINGERPRINT:
      rendered.coreCompatibilityFingerprint,
    LLMM_INFERENCE_HOST: "10.33.74.166",
    LLMM_INFERENCE_MODEL_ADMISSION_DIR: "/etc/llmm/admission",
    LLMM_INFERENCE_PROFILE_FILE: `${source.metadata.profileId}.json`,
    LLMM_INFERENCE_PROFILE_ID: source.metadata.profileId,
    LLMM_INFERENCE_PROFILE_REVISION: String(source.metadata.revision),
    LLMM_INFERENCE_QUALIFIED_PROFILE_DIGEST:
      source.activation.qualifiedProfileDigest,
    LLMM_INFERENCE_RENDERED_PROFILE_DIGEST: sha256(canonicalJson(rendered)),
    LLMM_SECRET_ROOT: "/etc/llmm/secrets",
    LLMM_SOURCE_ROOT: "/opt/llmm/source",
    LLMM_WEB_IMAGE: `sha256:${"d".repeat(64)}`,
    ...overrides,
  }
  const placementEnvironment = `${Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n")}\n`
  const artifacts = [
    "bff.env",
    "image-bindings.json",
    "placement.env",
    "product-edge.nginx.conf",
    "web.env",
  ].map((name) => ({
    name,
    sha256:
      name === "placement.env"
        ? sha256(placementEnvironment)
        : `sha256:${name.charCodeAt(0).toString(16).padStart(2, "0").repeat(32)}`,
  }))
  const renderedConfigurationManifest = `${JSON.stringify(
    {
      artifacts,
      schema: "llm-machines.vm103-founder-rendered-config.v1",
      source: { commit: "e".repeat(40), tree: "f".repeat(40) },
    },
    null,
    2,
  )}\n`
  return {
    expectedManifestDigest: sha256(renderedConfigurationManifest),
    placementEnvironment,
    renderedConfigurationManifest,
  }
}

function renderRoute(source, rendered, endpoint, validationTime = now) {
  const placement = placementArtifacts(source, rendered)
  return renderVm103LiteLlmRoute(
    source,
    rendered,
    placement.placementEnvironment,
    placement.renderedConfigurationManifest,
    placement.expectedManifestDigest,
    endpoint,
    validationTime,
  )
}

test("renders one credential-free route from the exact activated profile pair", () => {
  const source = sourceProfile()
  const rendered = renderDeliveryProfile(source, contracts)
  const placement = placementArtifacts(source, rendered)
  const result = renderVm103LiteLlmRoute(
    source,
    rendered,
    placement.placementEnvironment,
    placement.renderedConfigurationManifest,
    placement.expectedManifestDigest,
    "http://10.33.74.166:30005/v1",
    now,
  )

  assert.equal(result.modelAlias, source.model.alias)
  assert.equal(result.engineImageDigest, source.engine.image.digest)
  assert.equal(result.modelArtifactDigest, source.model.artifactDigest)
  assert.equal(result.modelManifestDigest, source.model.manifestDigest)
  assert.equal(result.evidenceDigest, source.capacity.evidenceDigest)
  assert.equal(
    result.qualifiedProfileDigest,
    source.activation.qualifiedProfileDigest,
  )
  assert.equal(result.renderedProfileDigest, sha256(canonicalJson(rendered)))
  assert.equal(
    result.renderedConfigurationManifestDigest,
    placement.expectedManifestDigest,
  )
  assert.equal(
    result.renderedPlacementDigest,
    sha256(placement.placementEnvironment),
  )
  assert.deepEqual(result.rollback, source.rollback)
  assert.match(result.config, new RegExp(`model_name: ${source.model.alias}`))
  assert.match(result.config, /api_base: http:\/\/10\.33\.74\.166:30005\/v1/)
  assert.match(result.config, /api_key: os\.environ\/UPSTREAM_API_KEY/)
  assert.match(result.config, /store_prompts_in_spend_logs: false/)
  assert.match(result.config, /turn_off_message_logging: true/)
  assert.doesNotMatch(result.config, /fixture-model|password|secret/i)
  assert.match(result.sha256, /^sha256:[0-9a-f]{64}$/)
  assert.match(result.runtimeBindingDigest, /^sha256:[0-9a-f]{64}$/)
  assert.equal(
    result.runtimeModelId,
    `llmm-route-${result.runtimeBindingDigest.slice(7)}`,
  )
  assert.match(result.config, new RegExp(`id: ${result.runtimeModelId}`))
})

test("content-binds the exact canonical rendered profile deterministically", () => {
  const firstSource = sourceProfile()
  const firstRendered = renderDeliveryProfile(firstSource, contracts)
  const equivalentRendered = structuredClone(firstRendered)
  const changedSource = sourceProfile()
  changedSource.capacity.evidenceDigest = `sha256:${"6".repeat(64)}`
  changedSource.activation.qualifiedProfileDigest =
    profileQualificationDigest(changedSource)
  const changedRendered = renderDeliveryProfile(changedSource, contracts)

  const first = renderRoute(
    firstSource,
    firstRendered,
    "http://10.33.74.166:30005/v1",
    now,
  )
  const equivalent = renderRoute(
    firstSource,
    equivalentRendered,
    "http://10.33.74.166:30005/v1",
    now,
  )
  const changed = renderRoute(
    changedSource,
    changedRendered,
    "http://10.33.74.166:30005/v1",
    now,
  )

  assert.equal(first.renderedProfileDigest, equivalent.renderedProfileDigest)
  assert.notEqual(first.renderedProfileDigest, changed.renderedProfileDigest)
  assert.notEqual(first.sha256, changed.sha256)
  assert.notEqual(first.runtimeBindingDigest, changed.runtimeBindingDigest)
})

test("derives the private host and profile only from the manifest-bound placement", () => {
  const source = sourceProfile()
  const rendered = renderDeliveryProfile(source, contracts)
  const placement = placementArtifacts(source, rendered)

  assert.throws(
    () =>
      renderVm103LiteLlmRoute(
        source,
        rendered,
        placement.placementEnvironment,
        placement.renderedConfigurationManifest,
        `sha256:${"0".repeat(64)}`,
        "http://10.33.74.166:30005/v1",
        now,
      ),
    /exact rendered placement manifest/,
  )

  const driftedPlacement = placementArtifacts(source, rendered, {
    LLMM_INFERENCE_HOST: "10.33.74.165",
  })
  assert.throws(
    () =>
      renderVm103LiteLlmRoute(
        source,
        rendered,
        driftedPlacement.placementEnvironment,
        driftedPlacement.renderedConfigurationManifest,
        driftedPlacement.expectedManifestDigest,
        "http://10.33.74.166:30005/v1",
        now,
      ),
    /exact private endpoint/,
  )

  const wrongProfile = placementArtifacts(source, rendered, {
    LLMM_INFERENCE_PROFILE_ID: "substituted-profile",
  })
  assert.throws(
    () =>
      renderVm103LiteLlmRoute(
        source,
        rendered,
        wrongProfile.placementEnvironment,
        wrongProfile.renderedConfigurationManifest,
        wrongProfile.expectedManifestDigest,
        "http://10.33.74.166:30005/v1",
        now,
      ),
    /rendered placement artifact/,
  )

  const tamperedEnvironment = placement.placementEnvironment.replace(
    "LLMM_INFERENCE_HOST=10.33.74.166",
    "LLMM_INFERENCE_HOST=10.33.74.165",
  )
  assert.throws(
    () =>
      renderVm103LiteLlmRoute(
        source,
        rendered,
        tamperedEnvironment,
        placement.renderedConfigurationManifest,
        placement.expectedManifestDigest,
        "http://10.33.74.165:30005/v1",
        now,
      ),
    /exact rendered placement manifest/,
  )
})

test("rejects invalid, inactive, stale, and public source inputs", () => {
  const invalid = sourceProfile()
  invalid.model.artifactDigest = "wrong"
  assert.throws(
    () =>
      renderRoute(
        invalid,
        renderDeliveryProfile(sourceProfile(), contracts),
        "http://10.33.74.166:30005/v1",
        now,
      ),
    /exact activated internal-test source profile/,
  )

  const inactive = structuredClone(syntheticProfile)
  assert.throws(
    () =>
      renderRoute(
        inactive,
        renderDeliveryProfile(inactive, contracts),
        "http://10.33.74.166:30005/v1",
        now,
      ),
    /exact activated internal-test source profile/,
  )

  const stale = sourceProfile()
  stale.capacity.validUntil = "2026-08-25T11:59:59.000Z"
  stale.activation.qualifiedProfileDigest = profileQualificationDigest(stale)
  assert.throws(
    () =>
      renderRoute(
        stale,
        renderDeliveryProfile(stale, contracts),
        "http://10.33.74.166:30005/v1",
        now,
      ),
    /current measured/,
  )

  const source = sourceProfile()
  const rendered = renderDeliveryProfile(source, contracts)
  assert.throws(
    () => renderRoute(source, rendered, "http://203.0.113.10:30005/v1", now),
    /exact private endpoint/,
  )
})

test("rejects every well-formed substitution in the rendered identity", () => {
  const mutations = [
    (profile) => {
      profile.coreCompatibilityFingerprint = `sha256:${"f".repeat(64)}`
    },
    (profile) => {
      profile.source.revision += 1
    },
    (profile) => {
      profile.engine.image = profile.engine.image.replace(
        /sha256:[a-f0-9]{64}$/,
        `sha256:${"7".repeat(64)}`,
      )
    },
    (profile) => {
      profile.model.source = "substituted/model"
    },
    (profile) => {
      profile.model.revision = "b".repeat(40)
    },
    (profile) => {
      profile.model.artifactDigest = `sha256:${"8".repeat(64)}`
    },
    (profile) => {
      profile.model.manifestDigest = `sha256:${"9".repeat(64)}`
    },
    (profile) => {
      profile.qualification.evidenceDigest = `sha256:${"a".repeat(64)}`
    },
    (profile) => {
      profile.qualification.qualifiedProfileDigest = `sha256:${"b".repeat(64)}`
    },
    (profile) => {
      profile.rollback.profileId = "substituted-profile"
    },
    (profile) => {
      profile.network.serviceName = "substituted-service"
    },
    (profile) => {
      profile.probes.readiness.path = "/health"
    },
    (profile) => {
      const index = profile.engine.command.indexOf("--served-model-name")
      profile.engine.command[index + 1] = "substituted-model"
    },
  ]

  for (const mutate of mutations) {
    const source = sourceProfile()
    const rendered = structuredClone(renderDeliveryProfile(source, contracts))
    mutate(rendered)
    assert.throws(
      () => renderRoute(source, rendered, "http://10.33.74.166:30005/v1", now),
      /exact canonical rendering/,
    )
  }
})

test("rejects an endpoint that disagrees with the qualified command and network", () => {
  const source = sourceProfile()
  const rendered = renderDeliveryProfile(source, contracts)
  for (const endpoint of [
    "http://10.33.74.165:30005/v1",
    "http://10.33.74.166:30006/v1",
    "http://10.33.74.166:30005/v2",
    "https://10.33.74.166:30005/v1",
  ]) {
    assert.throws(
      () => renderRoute(source, rendered, endpoint, now),
      /exact private endpoint/,
    )
  }
})

test("rejects rollback fields outside the canonical credential-free schema", () => {
  const source = sourceProfile()
  source.rollback.secretToken = "forbidden"
  source.activation.qualifiedProfileDigest = profileQualificationDigest(source)

  assert.match(
    validateSourceErrors(source),
    /rollback keys must be exactly engineImageDigest, modelArtifactDigest, profileId, revision/,
  )
  assert.throws(
    () =>
      renderRoute(
        source,
        renderDeliveryProfile(sourceProfile(), contracts),
        "http://10.33.74.166:30005/v1",
        now,
      ),
    /rollback keys must be exactly/,
  )
})

function validateSourceErrors(profile) {
  return validateDeliveryProfile(profile, contracts.core).join("\n")
}
