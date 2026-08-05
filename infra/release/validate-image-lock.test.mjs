import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import {
  canonicalDocumentSha256,
  coreInventorySha256,
  readCoreImageInventory,
  requiredCoreImageIds,
  validateCoreImageInventory,
  validateCoreImageLock,
  validateInferenceArtifactLock,
  verifyCheckedInReleaseIdentityPolicy,
} from "./validate-image-lock.mjs"

const root = resolve(import.meta.dirname, "../..")
const digest = (character) => `sha256:${character.repeat(64)}`

function clone(value) {
  return structuredClone(value)
}

function syntheticCoreLock() {
  const inventory = readCoreImageInventory()
  const sourceCommit = "1".repeat(40)
  return {
    schema: "llm-machines.core-image-lock.v2",
    status: "LOCKED",
    release: {
      version: "1.0.0-test",
      sourceCommit,
      sourceTree: "2".repeat(40),
    },
    inventorySha256: coreInventorySha256(),
    platform: "linux/amd64",
    images: inventory.components.map((component, index) => ({
      id: component.id,
      mirrorRepository: component.mirrorRepository,
      version:
        component.kind === "third-party-mirror"
          ? component.version
          : `1.0.0-build.${index + 1}`,
      ociArchivePath: `images/${component.id}.oci.tar.zst`,
      ociArchiveSha256: digest("9"),
      approvedSourceIndexDigest:
        component.kind === "third-party-mirror" ? component.indexDigest : null,
      approvedSourcePlatformDigest:
        component.kind === "third-party-mirror"
          ? component.platformDigest
          : null,
      indexDigest:
        component.kind === "third-party-mirror"
          ? component.indexDigest
          : digest(((index + 1) % 10).toString()),
      platform: "linux/amd64",
      platformDigest:
        component.kind === "third-party-mirror"
          ? component.platformDigest
          : digest(((index + 2) % 10).toString()),
      sourceRevision:
        component.sourceRevision === "release-source-commit"
          ? sourceCommit
          : component.sourceRevision === "release-source-lock"
            ? "source-lock-revision"
            : component.sourceRevision,
      license: component.license,
      sbomSha256: digest("a"),
      provenanceSha256: digest("b"),
      vulnerabilityReportSha256: digest("d"),
      vulnerabilityDispositionSha256: digest("e"),
      licenseTextSha256: digest("f"),
      noticeSha256: digest("7"),
      licenseReviewSha256: digest("8"),
      ...(/(?:AGPL|GPL)/.test(component.license)
        ? { correspondingSourceSha256: digest("c") }
        : {}),
    })),
  }
}

function syntheticProfileDocuments() {
  const profile = JSON.parse(
    readFileSync(
      resolve(root, "infra/inference/fixtures/synthetic-single-node.json"),
      "utf8",
    ),
  )
  const rollbackProfile = clone(profile)
  rollbackProfile.metadata.profileId = "synthetic-rollback-profile"
  rollbackProfile.metadata.revision = 1
  rollbackProfile.engine.image.digest = digest("d")
  rollbackProfile.model.artifactDigest = digest("e")
  rollbackProfile.rollback = {
    profileId: rollbackProfile.metadata.profileId,
    revision: rollbackProfile.metadata.revision,
    engineImageDigest: rollbackProfile.engine.image.digest,
    modelArtifactDigest: rollbackProfile.model.artifactDigest,
  }
  profile.rollback = {
    profileId: rollbackProfile.metadata.profileId,
    revision: rollbackProfile.metadata.revision,
    engineImageDigest: rollbackProfile.engine.image.digest,
    modelArtifactDigest: rollbackProfile.model.artifactDigest,
  }
  return { profile, rollbackProfile, coreLock: syntheticCoreLock() }
}

function syntheticInferenceLock(documents) {
  const { profile, rollbackProfile, coreLock } = documents
  return {
    schema: "llm-machines.inference-artifact-lock.v1",
    status: "LOCKED",
    profile: {
      id: profile.metadata.profileId,
      revision: profile.metadata.revision,
      contentSha256: canonicalDocumentSha256(profile),
    },
    compatibleCoreRelease: {
      version: coreLock.release.version,
      coreImageLockSha256: canonicalDocumentSha256(coreLock),
    },
    engine: {
      name: "sglang",
      version: "0.5.13",
      sourceCommit: "28b095c01005d4a3a2a5b637b7d028b07fba31b2",
      repository: profile.engine.image.privateRegistryMirror,
      imageDigest: profile.engine.image.digest,
      platform: {
        os: profile.engine.image.platform.os,
        architecture: profile.engine.image.platform.architecture,
        acceleratorBackend: profile.accelerator.backend,
      },
      platformDigest: profile.engine.image.digest,
      sbomSha256: profile.engine.image.sbomDigest,
      provenanceSha256: profile.engine.image.provenanceDigest,
    },
    model: {
      source: profile.model.source,
      revision: profile.model.revision,
      artifactManifestSha256: profile.model.manifestDigest,
      weightsSha256: profile.model.artifactDigest,
      license: profile.model.licenseSpdx,
    },
    rollback: {
      profileId: rollbackProfile.metadata.profileId,
      profileRevision: rollbackProfile.metadata.revision,
      profileContentSha256: canonicalDocumentSha256(rollbackProfile),
      engineImageDigest: rollbackProfile.engine.image.digest,
      modelWeightsSha256: rollbackProfile.model.artifactDigest,
    },
  }
}

test("checked-in Core inventory and immutable lock schemas pass", () => {
  const documents = syntheticProfileDocuments()
  assert.deepEqual(verifyCheckedInReleaseIdentityPolicy(), [])
  assert.deepEqual(
    validateCoreImageLock(syntheticCoreLock(), readCoreImageInventory()),
    [],
  )
  assert.deepEqual(
    validateInferenceArtifactLock(syntheticInferenceLock(documents), documents),
    [],
  )
  for (const schema of [
    "core-image-lock.schema.json",
    "inference-artifact-lock.schema.json",
  ]) {
    assert.doesNotThrow(() =>
      JSON.parse(readFileSync(resolve(import.meta.dirname, schema), "utf8")),
    )
  }
})

test("Core inventory contains every retained image exactly once", () => {
  const inventory = readCoreImageInventory()
  assert.deepEqual(
    inventory.components.map(({ id }) => id),
    requiredCoreImageIds,
  )
  assert.equal(new Set(requiredCoreImageIds).size, requiredCoreImageIds.length)
})

test("production identity inputs contain no mutable or demo runtime reference", () => {
  for (const path of [
    "apps/bff/Dockerfile",
    "apps/web/Dockerfile",
    "infra/keycloak/pr11a-console-session-policy.json",
    "infra/release/core-image-inventory.json",
  ]) {
    const source = readFileSync(resolve(root, path), "utf8")
    assert.doesNotMatch(
      source,
      /(?:intel[-_ ]arc[-_ ]b50|sglang-xpu|demo[-_.]?(?:host|alias)|:latest(?:@|\s|$))/i,
      path,
    )
  }
})

test("Core inventory contains no customer inference topology assumption", () => {
  const inventory = readCoreImageInventory()
  const source = JSON.stringify(inventory)
  assert.doesNotMatch(
    source,
    /"(?:gpu|vram|acceleratorBackend|tensorParallel|pipelineParallel|replicas|modelSource|modelRevision)"/i,
  )
})

test("tag-only, latest, missing platform, and malformed digest fail", () => {
  const inventory = readCoreImageInventory()
  const mutations = [
    (lock) => {
      lock.images[0].indexDigest = undefined
    },
    (lock) => {
      lock.images[0].version = "latest"
    },
    (lock) => {
      lock.images[0].ociArchivePath = "images/wrong.oci.tar.zst"
    },
    (lock) => {
      lock.images[0].ociArchiveSha256 = undefined
    },
    (lock) => {
      lock.images[0].platform = undefined
    },
    (lock) => {
      lock.images[0].platformDigest = "sha256:bad"
    },
  ]
  for (const mutate of mutations) {
    const lock = syntheticCoreLock()
    mutate(lock)
    assert.notDeepEqual(validateCoreImageLock(lock, inventory), [])
  }
})

test("every Core image requires digest-bound security and license evidence", () => {
  const inventory = readCoreImageInventory()
  for (const field of [
    "vulnerabilityReportSha256",
    "vulnerabilityDispositionSha256",
    "licenseTextSha256",
    "noticeSha256",
    "licenseReviewSha256",
  ]) {
    const lock = syntheticCoreLock()
    delete lock.images[0][field]
    assert.match(
      validateCoreImageLock(lock, inventory).join("\n"),
      new RegExp(`${field} must be an exact sha256 digest`),
    )
  }
})

test("registry authorities and omitted retained components fail the universal lock", () => {
  const inventory = readCoreImageInventory()
  const authorityBound = syntheticCoreLock()
  authorityBound.images[0].mirrorRepository = "docker.io/core/product-edge"
  assert.match(
    validateCoreImageLock(authorityBound, inventory).join("\n"),
    /registry-neutral mirror path/,
  )

  const missing = syntheticCoreLock()
  missing.images.pop()
  assert.notDeepEqual(validateCoreImageLock(missing, inventory), [])
})

test("Product-built images must bind the exact release source commit", () => {
  const inventory = readCoreImageInventory()
  for (const productImageId of ["console-web", "console-bff"]) {
    const mismatched = syntheticCoreLock()
    const productImage = mismatched.images.find(
      ({ id }) => id === productImageId,
    )
    productImage.sourceRevision = "3".repeat(40)

    assert.deepEqual(validateCoreImageLock(mismatched, inventory), [
      `image ${productImageId} must bind the release source commit`,
    ])
  }
})

test("third-party archives retain the exact approved upstream identity", () => {
  const inventory = readCoreImageInventory()
  for (const mutate of [
    (lock) => {
      lock.images[3].approvedSourceIndexDigest = digest("f")
    },
    (lock) => {
      lock.images[3].approvedSourcePlatformDigest = digest("f")
    },
    (lock) => {
      lock.images[3].platformDigest = digest("f")
    },
  ]) {
    const lock = syntheticCoreLock()
    mutate(lock)
    assert.notDeepEqual(validateCoreImageLock(lock, inventory), [])
  }
})

test("a missing release object returns diagnostics instead of throwing", () => {
  const inventory = readCoreImageInventory()
  const malformed = syntheticCoreLock()
  malformed.release = undefined

  assert.doesNotThrow(() => validateCoreImageLock(malformed, inventory))
  const errors = validateCoreImageLock(malformed, inventory)
  assert.ok(errors.includes("Core image lock source commit is invalid"))
  assert.ok(
    errors.includes("image console-web must bind the release source commit"),
  )
  assert.ok(
    errors.includes("image console-bff must bind the release source commit"),
  )
})

test("source pins and Core baseline drift fail closed", () => {
  const inventory = readCoreImageInventory()
  const mutations = [
    (value) => {
      value.coreBaseline.memoryGiB = 64
    },
    (value) => {
      value.components[0].indexDigest = undefined
    },
    (value) => {
      value.components[0].version = "latest"
    },
    (value) => {
      value.components.pop()
    },
  ]
  for (const mutate of mutations) {
    const value = clone(inventory)
    mutate(value)
    assert.notDeepEqual(validateCoreImageInventory(value), [])
  }
})

test("inference lock requires exact SGLang, model, Core, and rollback identities", () => {
  const mutations = [
    (lock) => {
      lock.engine.version = "0.5.14"
    },
    (lock) => {
      lock.engine.repository = "ghcr.io/sgl-project/sglang"
    },
    (lock) => {
      lock.model.weightsSha256 = undefined
    },
    (lock) => {
      lock.compatibleCoreRelease.coreImageLockSha256 = undefined
    },
    (lock) => {
      lock.rollback.profileContentSha256 = undefined
    },
  ]
  for (const mutate of mutations) {
    const documents = syntheticProfileDocuments()
    const lock = syntheticInferenceLock(documents)
    mutate(lock)
    assert.notDeepEqual(validateInferenceArtifactLock(lock, documents), [])
  }
})

test("inference lock revisions are integers bound to the actual profile documents", () => {
  const schema = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, "inference-artifact-lock.schema.json"),
      "utf8",
    ),
  )
  assert.deepEqual(schema.properties.profile.properties.revision, {
    minimum: 1,
    type: "integer",
  })
  assert.deepEqual(schema.properties.rollback.properties.profileRevision, {
    minimum: 1,
    type: "integer",
  })
  assert.ok(
    schema.properties.rollback.required.includes("profileContentSha256"),
  )
  assert.equal(
    schema.properties.rollback.properties.artifactLockSha256,
    undefined,
  )

  const documents = syntheticProfileDocuments()
  const stringRevision = syntheticInferenceLock(documents)
  stringRevision.profile.revision = "1"
  stringRevision.rollback.profileRevision = "1"
  assert.match(
    validateInferenceArtifactLock(stringRevision, documents).join("\n"),
    /profile revision differs/,
  )

  const changedProfile = clone(documents.profile)
  changedProfile.limits.configuredContextTokens += 1024
  assert.match(
    validateInferenceArtifactLock(syntheticInferenceLock(documents), {
      ...documents,
      profile: changedProfile,
    }).join("\n"),
    /profile content hash differs/,
  )
})

test("inference lock validates the actual Core and rollback documents", () => {
  const documents = syntheticProfileDocuments()
  const lock = syntheticInferenceLock(documents)
  const changedCore = clone(documents.coreLock)
  changedCore.release.version = "different"
  assert.match(
    validateInferenceArtifactLock(lock, {
      ...documents,
      coreLock: changedCore,
    }).join("\n"),
    /Core release version differs|Core image-lock hash differs/,
  )

  const changedRollback = clone(documents.rollbackProfile)
  changedRollback.model.artifactDigest = digest("f")
  changedRollback.rollback.modelArtifactDigest = digest("f")
  assert.match(
    validateInferenceArtifactLock(lock, {
      ...documents,
      rollbackProfile: changedRollback,
    }).join("\n"),
    /differs from rollback profile/,
  )
})

test("inference lock rejects malformed documents without throwing", () => {
  const documents = syntheticProfileDocuments()
  const lock = syntheticInferenceLock(documents)
  const malformedProfile = clone(documents.profile)
  malformedProfile.accelerator = null

  assert.doesNotThrow(() =>
    validateInferenceArtifactLock(lock, {
      ...documents,
      profile: malformedProfile,
      inventory: {},
    }),
  )
  assert.match(
    validateInferenceArtifactLock(lock, {
      ...documents,
      profile: malformedProfile,
      inventory: {},
    }).join("\n"),
    /Delivery profile is malformed|Compatible Core lock is malformed/,
  )
  assert.doesNotThrow(() => validateInferenceArtifactLock(null))
})

test("inference lock rejects fields outside the exact schema", () => {
  const documents = syntheticProfileDocuments()
  const topLevel = syntheticInferenceLock(documents)
  topLevel.unreviewed = true
  assert.match(
    validateInferenceArtifactLock(topLevel, documents).join("\n"),
    /Inference artifact lock keys must be exactly/,
  )

  const nested = syntheticInferenceLock(documents)
  nested.engine.unreviewed = true
  assert.match(
    validateInferenceArtifactLock(nested, documents).join("\n"),
    /Inference artifact lock engine keys must be exactly/,
  )
})

test("inference lock rejects the current revision as its own rollback", () => {
  const documents = syntheticProfileDocuments()
  documents.rollbackProfile = clone(documents.profile)
  documents.profile.rollback = {
    profileId: documents.profile.metadata.profileId,
    revision: documents.profile.metadata.revision,
    engineImageDigest: documents.profile.engine.image.digest,
    modelArtifactDigest: documents.profile.model.artifactDigest,
  }
  const lock = syntheticInferenceLock(documents)

  assert.match(
    validateInferenceArtifactLock(lock, documents).join("\n"),
    /cannot select itself for rollback/,
  )
})
