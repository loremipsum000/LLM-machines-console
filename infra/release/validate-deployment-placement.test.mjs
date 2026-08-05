import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { validateDeploymentPlacement } from "./validate-deployment-placement.mjs"
import {
  coreInventorySha256,
  readCoreImageInventory,
} from "./validate-image-lock.mjs"

const digest = (character) => `sha256:${character.repeat(64)}`
const authority = "registry.customer.example:5443"

function coreLock() {
  const inventory = readCoreImageInventory()
  const sourceCommit = "1".repeat(40)
  return {
    schema: "llm-machines.core-image-lock.v1",
    status: "LOCKED",
    release: {
      version: "1.0.0-rc.1",
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
          : `1.0.0-rc.1-build.${index + 1}`,
      ociArchivePath: `images/${component.id}.oci.tar.zst`,
      ociArchiveSha256: digest("9"),
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
            ? "resolved-source-lock"
            : component.sourceRevision,
      license: component.license,
      sbomSha256: digest("a"),
      provenanceSha256: digest("b"),
      vulnerabilityReportSha256: digest("c"),
      vulnerabilityDispositionSha256: digest("d"),
      licenseTextSha256: digest("e"),
      noticeSha256: digest("f"),
      licenseReviewSha256: digest("7"),
      ...(/(?:AGPL|GPL)/.test(component.license)
        ? { correspondingSourceSha256: digest("8") }
        : {}),
    })),
  }
}

function placement(lock) {
  return {
    schema: "llm-machines.deployment-placement.v1",
    status: "COMMISSIONING_VERIFIED",
    containsCredentials: false,
    runtimeQualified: false,
    coreRelease: {
      version: lock.release.version,
      releaseManifestSha256: digest("1"),
      coreImageLockSha256: digest("2"),
    },
    registryAuthority: authority,
    placements: lock.images.map((image) => ({
      id: image.id,
      mirrorRepository: image.mirrorRepository,
      effectiveReference: `${authority}/${image.mirrorRepository}@${image.platformDigest}`,
      ociArchiveSha256: image.ociArchiveSha256,
      indexDigest: image.indexDigest,
      platformDigest: image.platformDigest,
      verification: {
        status: "VERIFIED",
        importedArchiveSha256: image.ociArchiveSha256,
        mirroredIndexDigest: image.indexDigest,
        mirroredPlatformDigest: image.platformDigest,
      },
    })),
    records: {
      commissioning: {
        status: "RECORDED",
        evidenceId: "commissioning.image-placement.0001",
      },
      audit: {
        status: "RECORDED",
        eventType: "release.image-placement.verified",
        evidenceId: "audit.image-placement.0001",
        metadataOnly: true,
      },
    },
  }
}

function errors(value, lock, overrides = {}) {
  return validateDeploymentPlacement(value, {
    coreLock: lock,
    coreImageLockSha256: digest("2"),
    releaseManifestSha256: digest("1"),
    approvedRegistryAuthorities: [authority],
    ...overrides,
  })
}

test("credential-free customer placement binds the signed Core identities", () => {
  const lock = coreLock()
  assert.deepEqual(errors(placement(lock), lock), [])
  assert.doesNotThrow(() =>
    JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "deployment-placement.schema.json"),
        "utf8",
      ),
    ),
  )
})

test("public, unapproved, malformed, mutable, and credential-bearing placements fail", () => {
  const lock = coreLock()
  const publicPlacement = placement(lock)
  publicPlacement.registryAuthority = "docker.io"
  publicPlacement.placements = publicPlacement.placements.map((entry) => ({
    ...entry,
    effectiveReference: entry.effectiveReference.replace(
      authority,
      "docker.io",
    ),
  }))
  assert.match(
    errors(publicPlacement, lock, {
      approvedRegistryAuthorities: ["docker.io"],
    }).join("\n"),
    /public registry authorities are forbidden/,
  )

  assert.match(
    errors(placement(lock), lock, {
      approvedRegistryAuthorities: ["different.customer.example"],
    }).join("\n"),
    /not approved/,
  )

  const malformed = placement(lock)
  malformed.registryAuthority = "https://registry.customer.example"
  assert.match(errors(malformed, lock).join("\n"), /malformed/)

  const mutable = placement(lock)
  mutable.placements[0].effectiveReference = `${authority}/core/product-edge:latest`
  assert.match(errors(mutable, lock).join("\n"), /mutable or tag-only/)

  const credentialBearing = placement(lock)
  credentialBearing.registryPassword = "not-a-real-secret"
  assert.match(errors(credentialBearing, lock).join("\n"), /credential field/)
})

test("manifest, archive, index, platform, and audit disagreement fail closed", () => {
  const lock = coreLock()
  const wrongManifest = placement(lock)
  wrongManifest.coreRelease.releaseManifestSha256 = digest("3")
  assert.match(errors(wrongManifest, lock).join("\n"), /exact Core release/)

  for (const mutate of [
    (value) => {
      value.placements[0].verification.importedArchiveSha256 = digest("3")
    },
    (value) => {
      value.placements[0].verification.mirroredIndexDigest = digest("3")
    },
    (value) => {
      value.placements[0].verification.mirroredPlatformDigest = digest("3")
    },
    (value) => {
      value.records.audit.metadataOnly = false
    },
  ]) {
    const value = placement(lock)
    mutate(value)
    assert.notDeepEqual(errors(value, lock), [])
  }
})

test("registry authority and repository identities cannot enter the universal Core lock", () => {
  const lock = coreLock()
  lock.privateRegistry = authority
  lock.images[0].repository = `${authority}/core/product-edge`
  assert.match(
    errors(placement(lock), lock).join("\n"),
    /Core image lock keys|image product-edge keys/,
  )
})
