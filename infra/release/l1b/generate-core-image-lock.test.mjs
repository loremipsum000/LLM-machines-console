import assert from "node:assert/strict"
import test from "node:test"
import { readCoreImageInventory } from "../validate-image-lock.mjs"
import { buildCoreImageLock } from "./generate-core-image-lock.mjs"

const digest = `sha256:${"a".repeat(64)}`
const inventory = readCoreImageInventory()
const release = {
  version: "v1.0.0-rc.1",
  sourceCommit: "1".repeat(40),
  sourceTree: "2".repeat(40),
}

function comparison() {
  return {
    schema: "llm-machines.vm103-l1b-assembly-comparison.v1",
    status: "BYTE_IDENTICAL_IMAGE_SET",
    firstInventorySha256: "b".repeat(64),
    secondInventorySha256: "b".repeat(64),
    canonicalInventorySha256: "b".repeat(64),
    imageCount: 13,
    images: inventory.components.map((component) => ({
      id: component.id,
      ociArchiveSha256: digest,
      indexDigest: digest,
      platformDigest:
        component.kind === "third-party-mirror"
          ? component.platformDigest
          : digest,
    })),
  }
}

function evidence() {
  return inventory.components.map((component) => ({
    id: component.id,
    sbomSha256: digest,
    provenanceSha256: digest,
    vulnerabilityReportSha256: digest,
    vulnerabilityDispositionSha256: digest,
    licenseTextSha256: digest,
    noticeSha256: digest,
    licenseReviewSha256: digest,
    ...(/(?:AGPL|GPL)/.test(component.license) ||
    component.transitiveCopyleftSourceRequired
      ? { correspondingSourceSha256: digest }
      : {}),
  }))
}

test("final Core lock is generated only from complete comparison and evidence", () => {
  const lock = buildCoreImageLock({
    comparison: comparison(),
    evidenceDigests: evidence(),
    inventory,
    release,
  })
  assert.equal(lock.status, "LOCKED")
  assert.equal(lock.images.length, 13)
  assert.equal(lock.release.sourceCommit, release.sourceCommit)
})

test("missing reviewed evidence fails closed", () => {
  const bindings = evidence()
  bindings[0].licenseReviewSha256 = undefined
  assert.throws(
    () =>
      buildCoreImageLock({
        comparison: comparison(),
        evidenceDigests: bindings,
        inventory,
        release,
      }),
    /evidence bindings/,
  )
})

test("non-identical assembly status fails closed", () => {
  const value = comparison()
  value.status = "DIFFERENT"
  assert.throws(
    () =>
      buildCoreImageLock({
        comparison: value,
        evidenceDigests: evidence(),
        inventory,
        release,
      }),
    /byte-identical/,
  )
})
