import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  renderCanonicalJson,
  renderDeliveryProfile,
} from "./render-profile.mjs"
import {
  coreCompatibilityFingerprint,
  loadContracts,
  profileQualificationDigest,
  validateCoreContract,
  validateDeliveryProfile,
  validateEngineContract,
  validateRepository,
  validateSchema,
  validateSourceSafety,
} from "./validate-profile.mjs"

const root = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(root, "../..")
const contracts = loadContracts()
const single = JSON.parse(
  readFileSync(path.join(root, "fixtures/synthetic-single-node.json"), "utf8"),
)
const multi = JSON.parse(
  readFileSync(path.join(root, "fixtures/synthetic-multi-node.json"), "utf8"),
)

test("keeps the BFF compatibility pin aligned with the current core contract", () => {
  const contractsSource = readFileSync(
    path.join(repositoryRoot, "packages/contracts/src/inference-core.ts"),
    "utf8",
  )
  assert.match(
    contractsSource,
    new RegExp(
      `inferenceCoreCompatibilityFingerprint\\s*=\\s*["']${coreCompatibilityFingerprint(contracts.core)}["']`,
    ),
  )
})

function mutate(profile, mutation) {
  const changed = structuredClone(profile)
  mutation(changed)
  return changed
}

function activateMeasured(profile = single) {
  const changed = structuredClone(profile)
  changed.metadata.admissionScope = "PRODUCTION_DELIVERY"
  changed.metadata.lifecycleState = "ACTIVE_QUALIFIED"
  changed.accelerator.productionSupportClaim = true
  changed.capacity = {
    state: "MEASURED",
    profileRevision: changed.metadata.revision,
    engineImageDigest: changed.engine.image.digest,
    modelArtifactDigest: changed.model.artifactDigest,
    evidenceDigest:
      "sha256:6161616161616161616161616161616161616161616161616161616161616161",
    measuredAt: "2026-08-01T00:00:00.000Z",
    validUntil: "2027-08-01T00:00:00.000Z",
    effectiveContextTokens: changed.limits.configuredContextTokens,
    maxOutputTokens: changed.limits.maxOutputTokens,
    throughputTokensPerSecond: 1,
    maxConcurrentRequests: 1,
    p95LatencyMilliseconds: 1,
    queue: {
      state: "not_configured",
      maxObservedDepth: null,
    },
  }
  changed.activation.state = "ACTIVE"
  changed.activation.qualifiedProfileDigest =
    profileQualificationDigest(changed)
  return changed
}

function activateInternalMeasured(profile = single) {
  const changed = activateMeasured(profile)
  changed.metadata.admissionScope = "INTERNAL_TEST_ONLY"
  changed.metadata.lifecycleState = "ACTIVE_MEASURED_INTERNAL_TEST"
  changed.accelerator.productionSupportClaim = false
  changed.activation.state = "ACTIVE_INTERNAL_TEST"
  changed.activation.qualifiedProfileDigest =
    profileQualificationDigest(changed)
  return changed
}

test("the checked-in inference contracts and synthetic profiles pass", () => {
  assert.deepEqual(validateRepository(), [])
  assert.deepEqual(validateCoreContract(contracts.core), [])
  assert.deepEqual(validateEngineContract(contracts.engine), [])
  assert.deepEqual(validateSchema(contracts.schema), [])
})

test("two hardware topologies render deterministically without changing Core", () => {
  const singleFirst = renderCanonicalJson(single, contracts)
  const singleSecond = renderCanonicalJson(single, contracts)
  const multiRendered = renderCanonicalJson(multi, contracts)

  assert.equal(singleFirst, singleSecond)
  assert.notEqual(singleFirst, multiRendered)
  assert.equal(
    renderDeliveryProfile(single, contracts).coreCompatibilityFingerprint,
    renderDeliveryProfile(multi, contracts).coreCompatibilityFingerprint,
  )
  assert.equal(
    renderDeliveryProfile(single, contracts).coreCompatibilityFingerprint,
    coreCompatibilityFingerprint(contracts.core),
  )
})

test("synthetic profiles render no performance or model availability claim", () => {
  for (const profile of [single, multi]) {
    const rendered = renderDeliveryProfile(profile, contracts)
    assert.deepEqual(rendered.capabilityAdvertisement, {
      freshness: { measuredAt: null, validUntil: null },
      models: [],
      state: "UNAVAILABLE_UNMEASURED",
    })
    assert.doesNotMatch(
      JSON.stringify(rendered.capabilityAdvertisement),
      /throughput|concurrent|latency|context/i,
    )
  }
})

test("only the exact measured and activated revision advertises capacity", () => {
  const active = activateMeasured()
  assert.deepEqual(validateDeliveryProfile(active, contracts.core), [])
  assert.deepEqual(
    renderDeliveryProfile(active, contracts).capabilityAdvertisement,
    {
      freshness: {
        measuredAt: active.capacity.measuredAt,
        validUntil: active.capacity.validUntil,
      },
      models: [
        {
          alias: active.model.alias,
          contextTokens: active.capacity.effectiveContextTokens,
          maxConcurrentRequests: active.capacity.maxConcurrentRequests,
          maxOutputTokens: active.capacity.maxOutputTokens,
          p95LatencyMilliseconds: active.capacity.p95LatencyMilliseconds,
          queue: active.capacity.queue,
          throughputTokensPerSecond: active.capacity.throughputTokensPerSecond,
        },
      ],
      state: "ACTIVE_MEASURED",
    },
  )

  const staleEvidence = mutate(active, (profile) => {
    profile.capacity.engineImageDigest =
      "sha256:7171717171717171717171717171717171717171717171717171717171717171"
  })
  assert.match(
    validateDeliveryProfile(staleEvidence, contracts.core).join("\n"),
    /stale, incomplete/,
  )

  const staleActivation = mutate(active, (profile) => {
    profile.activation.qualifiedProfileDigest =
      "sha256:7272727272727272727272727272727272727272727272727272727272727272"
  })
  assert.match(
    validateDeliveryProfile(staleActivation, contracts.core).join("\n"),
    /exact measured and qualified/,
  )
})

test("an internal-test measurement activates without making a production claim", () => {
  const active = activateInternalMeasured()
  active.engine.image.sbomDigest = null
  active.engine.image.provenanceDigest = null
  active.activation.qualifiedProfileDigest = profileQualificationDigest(active)
  assert.deepEqual(validateDeliveryProfile(active, contracts.core), [])
  const rendered = renderDeliveryProfile(active, contracts)
  assert.equal(rendered.capabilityAdvertisement.state, "ACTIVE_MEASURED")
  assert.deepEqual(rendered.qualification, {
    evidenceDigest: active.capacity.evidenceDigest,
    productionCapacityClaim: false,
    qualifiedProfileDigest: active.activation.qualifiedProfileDigest,
    scope: "INTERNAL_TEST_ONLY",
  })

  const falseProduction = mutate(active, (profile) => {
    profile.accelerator.productionSupportClaim = true
    profile.activation.qualifiedProfileDigest =
      profileQualificationDigest(profile)
  })
  assert.match(
    validateDeliveryProfile(falseProduction, contracts.core).join("\n"),
    /without a production claim/,
  )
})

test("missing release evidence remains forbidden for production delivery", () => {
  const active = activateMeasured()
  active.engine.image.sbomDigest = null
  active.activation.qualifiedProfileDigest = profileQualificationDigest(active)
  assert.match(
    validateDeliveryProfile(active, contracts.core).join("\n"),
    /sbomDigest must use sha256/,
  )
})

test("unmeasured and inactive profiles fail closed", () => {
  const claimed = mutate(single, (profile) => {
    profile.capacity.throughputTokensPerSecond = 100
  })
  assert.match(
    validateDeliveryProfile(claimed, contracts.core).join("\n"),
    /cannot contain capacity claims/,
  )

  const supportClaim = mutate(single, (profile) => {
    profile.accelerator.productionSupportClaim = true
  })
  assert.match(
    validateDeliveryProfile(supportClaim, contracts.core).join("\n"),
    /cannot make a production support claim/,
  )

  const invalidWindow = activateMeasured()
  invalidWindow.capacity.validUntil = invalidWindow.capacity.measuredAt
  invalidWindow.activation.qualifiedProfileDigest =
    profileQualificationDigest(invalidWindow)
  assert.match(
    validateDeliveryProfile(invalidWindow, contracts.core).join("\n"),
    /stale, incomplete/,
  )
})

test("mutable images, demo identities, and internal topology are rejected", () => {
  for (const [value, pattern] of [
    [
      mutate(single, (profile) => {
        profile.engine.image.version = "latest"
      }),
      /non-latest|mutable latest/,
    ],
    [
      mutate(single, (profile) => {
        profile.accelerator.architecture = ["intel-arc", "b50"].join("-")
      }),
      /demo accelerator/,
    ],
    [
      mutate(single, (profile) => {
        profile.network.serviceName = "vm103"
      }),
      /demo or internal hostname/,
    ],
    [
      mutate(single, (profile) => {
        profile.engine.image.repository = [
          "registry.invalid/",
          "sglang-xpu",
        ].join("")
      }),
      /historical XPU/,
    ],
  ]) {
    assert.match(
      validateDeliveryProfile(value, contracts.core).join("\n"),
      pattern,
    )
  }
})

test("profile-controlled arguments cannot override identity, retention, or custody", () => {
  for (const name of [
    "--model-path",
    "--api-key",
    "--log-requests",
    "--trust-remote-code",
  ]) {
    const changed = mutate(single, (profile) => {
      profile.launch.additionalArguments.push({ name, value: "forbidden" })
    })
    assert.match(
      validateDeliveryProfile(changed, contracts.core).join("\n"),
      /reserved or invalid/,
    )
  }
})

test("rollback accepts only the four canonical credential-free fields", () => {
  const changed = mutate(single, (profile) => {
    profile.rollback.secretToken = "forbidden"
  })
  assert.match(
    validateDeliveryProfile(changed, contracts.core).join("\n"),
    /rollback keys must be exactly engineImageDigest, modelArtifactDigest, profileId, revision/,
  )
})

test("parallelism cannot exceed declared hardware", () => {
  const changed = mutate(single, (profile) => {
    profile.parallelism.replicas = 2
  })
  assert.match(
    validateDeliveryProfile(changed, contracts.core).join("\n"),
    /more devices/,
  )
})

test("Core baseline has no customer model or accelerator assumption", () => {
  const changed = structuredClone(contracts.core)
  changed.coreAppliance.defaultGpu = "synthetic"
  assert.match(
    validateCoreContract(changed).join("\n"),
    /Core appliance contract|hardware or model/,
  )

  assert.deepEqual(contracts.core.coreAppliance.localDiskExclusions, [
    "customer-backup-repository",
    "bulk-model-weights",
    "inference-accelerator-storage",
  ])
  const storage = JSON.parse(
    readFileSync(
      path.join(repositoryRoot, "infra/storage/profile.json"),
      "utf8",
    ),
  )
  assert.equal(
    storage.backup.repository.targetKind,
    "separate-customer-owned-mounted-filesystem",
  )
  assert.ok(storage.backup.excludedDatasets.includes("models"))
})

test("Core Console sections match the exact reduced five-surface order", () => {
  assert.deepEqual(contracts.core.consoleSections, [
    "applications",
    "inference",
    "hardware",
    "team",
    "settings",
  ])

  for (const consoleSections of [
    ["overview", ...contracts.core.consoleSections],
    contracts.core.consoleSections.slice(1),
    [...contracts.core.consoleSections, "activity"],
    [...contracts.core.consoleSections].reverse(),
  ]) {
    const changed = structuredClone(contracts.core)
    changed.consoleSections = consoleSections
    assert.match(
      validateCoreContract(changed).join("\n"),
      /reduced five-surface order/,
    )
  }
})

test("credential material and workstation paths are rejected", () => {
  for (const source of [
    ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
    ["github", "_pat_0123456789abcdefghijklmnop"].join(""),
    ["/", "Users/operator/profile.json"].join(""),
  ]) {
    assert.ok(validateSourceSafety({ changed: source }).length > 0)
  }
})

test("validator and renderer CLIs are deterministic and source-only", () => {
  const validation = spawnSync(
    process.execPath,
    [path.join(root, "validate-profile.mjs")],
    { cwd: repositoryRoot, encoding: "utf8" },
  )
  assert.equal(
    validation.status,
    0,
    `${validation.stdout}\n${validation.stderr}`,
  )
  assert.match(validation.stdout, /validation passed/)

  const profilePath = "infra/inference/fixtures/synthetic-single-node.json"
  const first = spawnSync(
    process.execPath,
    [path.join(root, "render-profile.mjs"), "--profile", profilePath],
    { cwd: repositoryRoot, encoding: "utf8" },
  )
  const second = spawnSync(
    process.execPath,
    [path.join(root, "render-profile.mjs"), "--profile", profilePath],
    { cwd: repositoryRoot, encoding: "utf8" },
  )
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`)
  assert.equal(first.stdout, second.stdout)
})
