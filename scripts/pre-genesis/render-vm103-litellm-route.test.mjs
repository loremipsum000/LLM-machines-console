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

test("renders one credential-free route from the exact activated profile pair", () => {
  const source = sourceProfile()
  const rendered = renderDeliveryProfile(source, contracts)
  const result = renderVm103LiteLlmRoute(
    source,
    rendered,
    "10.33.74.166",
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
  assert.deepEqual(result.rollback, source.rollback)
  assert.match(result.config, new RegExp(`model_name: ${source.model.alias}`))
  assert.match(result.config, /api_base: http:\/\/10\.33\.74\.166:30005\/v1/)
  assert.match(result.config, /api_key: os\.environ\/UPSTREAM_API_KEY/)
  assert.match(result.config, /store_prompts_in_spend_logs: false/)
  assert.match(result.config, /turn_off_message_logging: true/)
  assert.doesNotMatch(result.config, /fixture-model|password|secret/i)
  assert.match(result.sha256, /^[0-9a-f]{64}$/)
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

  const first = renderVm103LiteLlmRoute(
    firstSource,
    firstRendered,
    "10.33.74.166",
    "http://10.33.74.166:30005/v1",
    now,
  )
  const equivalent = renderVm103LiteLlmRoute(
    firstSource,
    equivalentRendered,
    "10.33.74.166",
    "http://10.33.74.166:30005/v1",
    now,
  )
  const changed = renderVm103LiteLlmRoute(
    changedSource,
    changedRendered,
    "10.33.74.166",
    "http://10.33.74.166:30005/v1",
    now,
  )

  assert.equal(first.renderedProfileDigest, equivalent.renderedProfileDigest)
  assert.notEqual(first.renderedProfileDigest, changed.renderedProfileDigest)
  assert.equal(first.sha256, changed.sha256)
})

test("rejects invalid, inactive, stale, and public source inputs", () => {
  const invalid = sourceProfile()
  invalid.model.artifactDigest = "wrong"
  assert.throws(
    () =>
      renderVm103LiteLlmRoute(
        invalid,
        renderDeliveryProfile(sourceProfile(), contracts),
        "10.33.74.166",
        "http://10.33.74.166:30005/v1",
        now,
      ),
    /exact activated internal-test source profile/,
  )

  const inactive = structuredClone(syntheticProfile)
  assert.throws(
    () =>
      renderVm103LiteLlmRoute(
        inactive,
        renderDeliveryProfile(inactive, contracts),
        "10.33.74.166",
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
      renderVm103LiteLlmRoute(
        stale,
        renderDeliveryProfile(stale, contracts),
        "10.33.74.166",
        "http://10.33.74.166:30005/v1",
        now,
      ),
    /current measured/,
  )

  const source = sourceProfile()
  const rendered = renderDeliveryProfile(source, contracts)
  assert.throws(
    () =>
      renderVm103LiteLlmRoute(
        source,
        rendered,
        "10.33.74.166",
        "http://203.0.113.10:30005/v1",
        now,
      ),
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
      () =>
        renderVm103LiteLlmRoute(
          source,
          rendered,
          "10.33.74.166",
          "http://10.33.74.166:30005/v1",
          now,
        ),
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
      () =>
        renderVm103LiteLlmRoute(
          source,
          rendered,
          "10.33.74.166",
          endpoint,
          now,
        ),
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
      renderVm103LiteLlmRoute(
        source,
        renderDeliveryProfile(sourceProfile(), contracts),
        "10.33.74.166",
        "http://10.33.74.166:30005/v1",
        now,
      ),
    /rollback keys must be exactly/,
  )
})

function validateSourceErrors(profile) {
  return validateDeliveryProfile(profile, contracts.core).join("\n")
}
