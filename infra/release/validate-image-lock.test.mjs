import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import {
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
    schema: "llm-machines.core-image-lock.v1",
    status: "LOCKED",
    release: {
      version: "1.0.0-test",
      sourceCommit,
      sourceTree: "2".repeat(40),
    },
    inventorySha256: coreInventorySha256(),
    platform: "linux/amd64",
    privateRegistry: "registry.release.invalid",
    images: inventory.components.map((component, index) => ({
      id: component.id,
      repository: `registry.release.invalid/${component.mirrorRepository}`,
      version:
        component.kind === "third-party-mirror"
          ? component.version
          : `1.0.0-build.${index + 1}`,
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
      ...(/(?:AGPL|GPL)/.test(component.license)
        ? { correspondingSourceSha256: digest("c") }
        : {}),
    })),
  }
}

function syntheticInferenceLock() {
  return {
    schema: "llm-machines.inference-artifact-lock.v1",
    status: "LOCKED",
    profile: {
      id: "synthetic-profile",
      revision: "r1",
      contentSha256: digest("1"),
    },
    compatibleCoreRelease: {
      version: "1.0.0-test",
      coreImageLockSha256: digest("2"),
    },
    engine: {
      name: "sglang",
      version: "0.5.13",
      sourceCommit: "28b095c01005d4a3a2a5b637b7d028b07fba31b2",
      repository: "registry.release.invalid/inference/sglang",
      imageDigest: digest("3"),
      platform: "linux/amd64-cuda",
      platformDigest: digest("4"),
      sbomSha256: digest("5"),
      provenanceSha256: digest("6"),
    },
    model: {
      source: "synthetic/model",
      revision: "synthetic-revision",
      artifactManifestSha256: digest("7"),
      weightsSha256: digest("8"),
      license: "synthetic-only",
    },
    rollback: {
      profileId: "synthetic-profile",
      profileRevision: "r0",
      artifactLockSha256: digest("9"),
      engineImageDigest: digest("d"),
      modelWeightsSha256: digest("e"),
    },
  }
}

test("checked-in Core inventory and immutable lock schemas pass", () => {
  assert.deepEqual(verifyCheckedInReleaseIdentityPolicy(), [])
  assert.deepEqual(
    validateCoreImageLock(syntheticCoreLock(), readCoreImageInventory()),
    [],
  )
  assert.deepEqual(validateInferenceArtifactLock(syntheticInferenceLock()), [])
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

test("tag-only, latest, missing platform, and digest disagreement fail", () => {
  const inventory = readCoreImageInventory()
  const mutations = [
    (lock) => {
      lock.images[0].indexDigest = undefined
    },
    (lock) => {
      lock.images[0].version = "latest"
    },
    (lock) => {
      lock.images[0].platform = undefined
    },
    (lock) => {
      lock.images[0].platformDigest = digest("f")
    },
  ]
  for (const mutate of mutations) {
    const lock = syntheticCoreLock()
    mutate(lock)
    assert.notDeepEqual(validateCoreImageLock(lock, inventory), [])
  }
})

test("unapproved registries and omitted retained components fail", () => {
  const inventory = readCoreImageInventory()
  const publicLock = syntheticCoreLock()
  publicLock.privateRegistry = "docker.io"
  publicLock.images = publicLock.images.map((image) => ({
    ...image,
    repository: `docker.io/${image.repository.split("/").slice(1).join("/")}`,
  }))
  assert.notDeepEqual(validateCoreImageLock(publicLock, inventory), [])

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
      lock.rollback.artifactLockSha256 = undefined
    },
  ]
  for (const mutate of mutations) {
    const lock = syntheticInferenceLock()
    mutate(lock)
    assert.notDeepEqual(validateInferenceArtifactLock(lock), [])
  }
})
