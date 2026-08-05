import assert from "node:assert/strict"
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { assembleCorePackage } from "./assemble-core-package.mjs"
import { installCleanRoom } from "./clean-room-install.mjs"
import {
  assembleDeterministicArchive,
  sha256File,
} from "./deterministic-archive.mjs"
import { canonicalJson } from "./generate-release-manifest.mjs"
import {
  commissioningEvidenceSha256,
  generateInitialInstallDescriptor,
  generateRollbackDescriptor,
  verifyInitialInstallDescriptor,
  verifyRollbackDescriptor,
} from "./generate-rollback-descriptor.mjs"
import { createDeploymentPlacement } from "./validate-deployment-placement.mjs"
import {
  coreInventorySha256,
  readCoreImageInventory,
} from "./validate-image-lock.mjs"
import {
  buildReleaseEvidenceIndex,
  semanticEvidence,
} from "./validate-release-evidence-index.mjs"
import { verifyReleaseBundle } from "./verify-release-bundle.mjs"

const plan = JSON.parse(
  readFileSync(new URL("./release-plan.json", import.meta.url), "utf8"),
)
const issuer = "urn:llm-machines:vendor"
const signedAt = "2026-08-04T12:00:00.000Z"
const evidenceEvaluatedAt = "2026-08-04T11:00:00.000Z"

function digest(character) {
  return `sha256:${character.repeat(64)}`
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function writeOciArchive(root, id, label) {
  const layoutRoot = join(root, `.oci-layout-${id}`)
  const outputPath = join(root, `${id}.oci.tar.zst`)
  const layer = Buffer.from(`${label}-${id}-layer\n`)
  const layerDigest = sha256Bytes(layer)
  const config = Buffer.from(
    canonicalJson({
      architecture: "amd64",
      os: "linux",
      rootfs: { type: "layers", diff_ids: [layerDigest] },
    }),
  )
  const configDigest = sha256Bytes(config)
  const manifest = Buffer.from(
    canonicalJson({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      config: {
        mediaType: "application/vnd.oci.image.config.v1+json",
        digest: configDigest,
        size: config.length,
      },
      layers: [
        {
          mediaType: "application/vnd.oci.image.layer.v1.tar",
          digest: layerDigest,
          size: layer.length,
        },
      ],
    }),
  )
  const manifestDigest = sha256Bytes(manifest)
  const index = Buffer.from(
    canonicalJson({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.index.v1+json",
      manifests: [
        {
          mediaType: "application/vnd.oci.image.manifest.v1+json",
          digest: manifestDigest,
          size: manifest.length,
          platform: { architecture: "amd64", os: "linux" },
        },
      ],
    }),
  )
  write(
    join(layoutRoot, "oci-layout"),
    canonicalJson({ imageLayoutVersion: "1.0.0" }),
  )
  writeFileSync(join(layoutRoot, "index.json"), index)
  write(join(layoutRoot, "blobs", "sha256", layerDigest.slice(7)), layer)
  write(join(layoutRoot, "blobs", "sha256", configDigest.slice(7)), config)
  write(join(layoutRoot, "blobs", "sha256", manifestDigest.slice(7)), manifest)
  assembleDeterministicArchive({
    inputRoot: layoutRoot,
    outputPath,
    sourceDateEpoch: 1_722_772_800,
  })
  rmSync(layoutRoot, { recursive: true, force: true })
  return {
    ociArchiveSha256: sha256File(outputPath),
    indexDigest: sha256Bytes(index),
    platformDigest: manifestDigest,
  }
}

function payload(root, label) {
  const imageIdentities = new Map()
  for (const directory of [
    "config",
    "images",
    "lifecycle",
    "seeds",
    "verification",
  ]) {
    if (directory === "images") {
      for (const { id } of readCoreImageInventory().components) {
        imageIdentities.set(
          id,
          writeOciArchive(join(root, directory), id, label),
        )
      }
    } else {
      write(
        join(root, directory, `${directory}.txt`),
        `${label}-${directory}\n`,
      )
    }
  }
  return imageIdentities
}

function exportPublic(key) {
  return key.export({ format: "der", type: "spki" }).toString("base64url")
}

function trustFixture() {
  const root = generateKeyPairSync("ed25519")
  const scoped = generateKeyPairSync("ed25519")
  const rootRecord = {
    kid: "vendor-root-2026",
    purpose: "vendor-release-root",
    algorithm: "Ed25519",
    publicKey: {
      format: "spki-der-base64url",
      value: exportPublic(root.publicKey),
    },
    notBefore: "2026-01-01T00:00:00.000Z",
    notAfter: "2030-01-01T00:00:00.000Z",
    state: "active",
    revokedAt: null,
    revocationReason: null,
  }
  const scopedRecord = {
    kid: "release-artifact-2026",
    purpose: "release-artifact",
    algorithm: "Ed25519",
    issuer,
    publicKey: {
      format: "spki-der-base64url",
      value: exportPublic(scoped.publicKey),
    },
    notBefore: "2026-01-01T00:00:00.000Z",
    notAfter: "2027-01-01T00:00:00.000Z",
    state: "active",
    revokedAt: null,
    revocationReason: null,
    signedByKid: rootRecord.kid,
  }
  const certificationSignature = sign(
    null,
    Buffer.from(canonicalJson(scopedRecord)),
    root.privateKey,
  ).toString("base64url")
  return {
    privateKey: scoped.privateKey,
    rootPrivateKey: root.privateKey,
    rootSha256: `sha256:${createHash("sha256")
      .update(root.publicKey.export({ format: "der", type: "spki" }))
      .digest("hex")}`,
    trust: {
      schema: "llm-machines.release-public-trust.v1",
      generatedAt: "2026-08-01T00:00:00.000Z",
      issuer,
      root: rootRecord,
      keys: [{ ...scopedRecord, certificationSignature }],
      dualTrust: [],
    },
  }
}

function classification(evidenceId) {
  if (evidenceId === "installer") return "installer"
  if (evidenceId === "rollback") return "rollback"
  if (evidenceId === "public-release-trust") return "public-trust"
  if (evidenceId.includes("corresponding-source")) return "source"
  if (evidenceId.includes("license") || evidenceId === "third-party-notices") {
    return "license"
  }
  return "evidence"
}

function syntheticCoreLock(
  version,
  sourceCommit,
  sourceTree,
  sourceDigests,
  payloadRoot,
  imageIdentities,
  validationRoot,
) {
  const inventory = readCoreImageInventory(validationRoot)
  return {
    schema: "llm-machines.core-image-lock.v2",
    status: "LOCKED",
    release: { version, sourceCommit, sourceTree },
    inventorySha256: coreInventorySha256(validationRoot),
    platform: "linux/amd64",
    images: inventory.components.map((component, index) => ({
      id: component.id,
      mirrorRepository: component.mirrorRepository,
      version:
        component.kind === "third-party-mirror"
          ? component.version
          : `${version}-build.${index + 1}`,
      ociArchivePath: `images/${component.id}.oci.tar.zst`,
      ociArchiveSha256: sha256File(
        join(payloadRoot, "images", `${component.id}.oci.tar.zst`),
      ),
      approvedSourceIndexDigest:
        component.kind === "third-party-mirror" ? component.indexDigest : null,
      approvedSourcePlatformDigest:
        component.kind === "third-party-mirror"
          ? component.platformDigest
          : null,
      indexDigest: imageIdentities.get(component.id).indexDigest,
      platform: "linux/amd64",
      platformDigest: imageIdentities.get(component.id).platformDigest,
      sourceRevision:
        component.sourceRevision === "release-source-commit"
          ? sourceCommit
          : component.sourceRevision === "release-source-lock"
            ? "firecrawl-source-lock-v2.11.0"
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
        ? {
            correspondingSourceSha256:
              component.id === "grafana-private"
                ? sourceDigests.grafana
                : sourceDigests.firecrawl,
          }
        : {}),
    })),
  }
}

function bundleFixture(version = "1.0.0", label = version) {
  const directory = mkdtempSync(join(tmpdir(), "llmm-offline-lifecycle-"))
  const artifactRoot = join(directory, "artifacts")
  const payloadRoot = join(directory, "payload")
  const artifactName = `llm-machines-core-${version}-linux-amd64.tar.zst`
  const corePath = join(artifactRoot, "core", artifactName)
  mkdirSync(artifactRoot, { recursive: true })
  mkdirSync(payloadRoot)
  const imageIdentities = payload(payloadRoot, label)
  const validationRoot = join(directory, "validation-root")
  const inventory = readCoreImageInventory()
  inventory.components = inventory.components.map((component) =>
    component.kind === "third-party-mirror"
      ? {
          ...component,
          indexDigest: imageIdentities.get(component.id).indexDigest,
          platformDigest: imageIdentities.get(component.id).platformDigest,
        }
      : component,
  )
  write(
    join(validationRoot, "infra/release/core-image-inventory.json"),
    canonicalJson(inventory),
  )
  const sourceCommit = label
    .charCodeAt(0)
    .toString(16)
    .padStart(40, "0")
    .slice(-40)
  const sourceTree = label
    .charCodeAt(label.length - 1)
    .toString(16)
    .padStart(40, "0")
    .slice(-40)
  const firecrawlSource = "exact Firecrawl corresponding source fixture\n"
  const grafanaSource = "exact Grafana corresponding source fixture\n"
  const coreLockValue = syntheticCoreLock(
    version,
    sourceCommit,
    sourceTree,
    {
      firecrawl: `sha256:${createHash("sha256").update(firecrawlSource).digest("hex")}`,
      grafana: `sha256:${createHash("sha256").update(grafanaSource).digest("hex")}`,
    },
    payloadRoot,
    imageIdentities,
    validationRoot,
  )
  const assembled = assembleCorePackage({
    inputRoot: payloadRoot,
    outputPath: corePath,
    sourceDateEpoch: 1_722_772_800,
    coreLock: coreLockValue,
    validationRoot,
  })
  const semanticPaths = new Map(semanticEvidence)
  semanticPaths.set(
    "release-evidence-index",
    "evidence/release-evidence-index.json",
  )
  const artifacts = [
    {
      id: "core-package",
      evidenceId: null,
      path: `core/${artifactName}`,
      size: assembled.size,
      sha256: assembled.sha256,
      mediaType: "application/zstd",
      classification: "core",
    },
  ]
  for (const evidenceId of plan.requiredEvidence) {
    const path =
      evidenceId === "core-image-lock"
        ? "locks/core-image-lock.json"
        : (semanticPaths.get(evidenceId) ?? `evidence/${evidenceId}.json`)
    const contents =
      evidenceId === "core-image-lock"
        ? canonicalJson(coreLockValue)
        : evidenceId === "firecrawl-corresponding-source"
          ? firecrawlSource
          : evidenceId === "grafana-corresponding-source"
            ? grafanaSource
            : evidenceId === "image-vulnerability-evidence"
              ? canonicalJson({
                  schema: "llm-machines.image-vulnerability-evidence.v1",
                  images: coreLockValue.images.map(({ id }) => ({
                    id,
                    disposition: { exceptions: [] },
                  })),
                })
              : evidenceId === "rollback"
                ? canonicalJson(generateInitialInstallDescriptor())
                : canonicalJson({ evidenceId, label })
    write(join(artifactRoot, path), contents)
    artifacts.push({
      id: `evidence-${evidenceId}`,
      evidenceId,
      path,
      size: Buffer.byteLength(contents),
      sha256: sha256File(join(artifactRoot, path)),
      mediaType: "application/json",
      classification: classification(evidenceId),
    })
  }
  artifacts.sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)),
  )
  const coreLock = artifacts.find(
    ({ evidenceId }) => evidenceId === "core-image-lock",
  )
  const evidenceIndexArtifact = artifacts.find(
    ({ evidenceId }) => evidenceId === "release-evidence-index",
  )
  const evidenceIndexValue = buildReleaseEvidenceIndex({
    coreLock: coreLockValue,
    coreLockPath: join(artifactRoot, coreLock.path),
    evidenceEvaluatedAt,
    evidenceArtifacts: artifacts,
    minimumExceptionExpiry: null,
  })
  const evidenceIndexContents = canonicalJson(evidenceIndexValue)
  writeFileSync(
    join(artifactRoot, evidenceIndexArtifact.path),
    evidenceIndexContents,
  )
  evidenceIndexArtifact.size = Buffer.byteLength(evidenceIndexContents)
  evidenceIndexArtifact.sha256 = sha256File(
    join(artifactRoot, evidenceIndexArtifact.path),
  )
  const trust = trustFixture()
  const publicTrustPath = join(
    artifactRoot,
    "evidence/public-release-trust.json",
  )
  const publicTrustContents = canonicalJson(trust.trust)
  writeFileSync(publicTrustPath, publicTrustContents)
  const publicTrustArtifact = artifacts.find(
    ({ evidenceId }) => evidenceId === "public-release-trust",
  )
  publicTrustArtifact.size = Buffer.byteLength(publicTrustContents)
  publicTrustArtifact.sha256 = sha256File(publicTrustPath)
  const manifest = {
    schema: "llm-machines.release-manifest.v2",
    status: "PACKAGED_UNQUALIFIED",
    release: {
      version,
      artifactName,
      sourceCommit,
      sourceTree,
      sourceDateEpoch: 1_722_772_800,
      evidenceEvaluatedAt,
      platform: "linux/amd64",
    },
    contracts: {
      releasePlanSha256: digest("1"),
      releaseEvidencePolicySha256: digest("6"),
      coreImageInventorySha256: digest("2"),
      coreImageLockSha256: coreLock.sha256,
      deploymentPlacementSchemaSha256: digest("9"),
      deliveryProfileSchemaSha256: digest("3"),
      inferenceArtifactLockSchemaSha256: digest("4"),
      firecrawlSourcePackageSha256: digest("5"),
      initialInstallDescriptorSchemaSha256: digest("a"),
      productInstallationStateSchemaSha256: digest("b"),
      rollbackDescriptorSchemaSha256: digest("c"),
    },
    artifacts,
    qualification: {
      runtimeQualified: false,
      q0: "NOT_STARTED",
      contractActivation: "INACTIVE",
    },
  }
  const manifestPath = join(directory, "release-manifest.json")
  const signaturePath = join(directory, "release-signature.json")
  const trustPath = publicTrustPath
  const manifestBytes = Buffer.from(canonicalJson(manifest))
  writeFileSync(manifestPath, manifestBytes)
  writeFileSync(
    signaturePath,
    canonicalJson({
      schema: "llm-machines.release-signature.v1",
      status: "SIGNED_OFFLINE",
      purpose: "release-artifact",
      algorithm: "Ed25519",
      issuer,
      kid: trust.trust.keys[0].kid,
      signedManifestSha256: sha256File(manifestPath),
      signedAt,
      signature: sign(null, manifestBytes, trust.privateKey).toString(
        "base64url",
      ),
    }),
  )
  return {
    assembled,
    bundle: {
      manifestPath,
      signaturePath,
      trustPath,
      artifactRoot,
      trustedRootSha256: trust.rootSha256,
    },
    corePath,
    coreLockValue,
    directory,
    manifest,
    payloadRoot,
    validationRoot,
    rootSigningPrivateKey: trust.rootPrivateKey,
    signingPrivateKey: trust.privateKey,
  }
}

function resignManifest(fixture, manifest) {
  const manifestBytes = Buffer.from(canonicalJson(manifest))
  writeFileSync(fixture.bundle.manifestPath, manifestBytes)
  const envelope = JSON.parse(
    readFileSync(fixture.bundle.signaturePath, "utf8"),
  )
  envelope.signedManifestSha256 = sha256File(fixture.bundle.manifestPath)
  envelope.signature = sign(
    null,
    manifestBytes,
    fixture.signingPrivateKey,
  ).toString("base64url")
  writeFileSync(fixture.bundle.signaturePath, canonicalJson(envelope))
}

test("Core package assembly is reproducible and normalized", () => {
  const fixture = bundleFixture()
  const secondPath = join(fixture.directory, "second.tar.zst")
  const second = assembleCorePackage({
    inputRoot: join(fixture.directory, "payload"),
    outputPath: secondPath,
    sourceDateEpoch: 1_722_772_800,
    coreLock: fixture.coreLockValue,
    validationRoot: fixture.validationRoot,
  })
  assert.equal(second.sha256, fixture.assembled.sha256)
  assert.deepEqual(second.paths, fixture.assembled.paths)
  rmSync(fixture.directory, { recursive: true, force: true })
})

test("Core package assembly rejects OCI archive omission and digest drift", () => {
  const fixture = bundleFixture("1.0.1", "archive-binding")
  const archivePath = join(
    fixture.directory,
    "payload",
    fixture.coreLockValue.images[0].ociArchivePath,
  )
  copyFileSync(
    join(
      fixture.directory,
      "payload",
      fixture.coreLockValue.images[1].ociArchivePath,
    ),
    archivePath,
  )
  assert.throws(
    () =>
      assembleCorePackage({
        inputRoot: join(fixture.directory, "payload"),
        outputPath: join(fixture.directory, "changed.tar.zst"),
        sourceDateEpoch: 1_722_772_800,
        coreLock: fixture.coreLockValue,
        validationRoot: fixture.validationRoot,
      }),
    /OCI archive identity differs/,
  )
  rmSync(archivePath)
  assert.throws(
    () =>
      assembleCorePackage({
        inputRoot: join(fixture.directory, "payload"),
        outputPath: join(fixture.directory, "missing.tar.zst"),
        sourceDateEpoch: 1_722_772_800,
        coreLock: fixture.coreLockValue,
        validationRoot: fixture.validationRoot,
      }),
    /exact locked OCI archive set/,
  )
  rmSync(fixture.directory, { recursive: true, force: true })
})

test("public verifier and clean-room installer preserve the unqualified boundary", () => {
  const fixture = bundleFixture()
  const verified = verifyReleaseBundle(fixture.bundle)
  assert.equal(verified.status, "VERIFIED_PACKAGED_UNQUALIFIED")
  assert.equal(verified.rollbackMode, "INITIAL_INSTALL_NO_PREDECESSOR")
  const targetRoot = join(fixture.directory, "installed")
  const installed = installCleanRoom({ ...fixture.bundle, targetRoot })
  assert.equal(installed.status, "INSTALLED_UNQUALIFIED")
  assert.deepEqual(installed.qualification, {
    runtimeQualified: false,
    q0: "NOT_STARTED",
    contractActivation: "INACTIVE",
  })
  assert.match(
    readFileSync(join(targetRoot, "installation.json"), "utf8"),
    /INSTALLED_UNQUALIFIED/,
  )
  assert.throws(
    () => installCleanRoom({ ...fixture.bundle, targetRoot }),
    /must not already exist/,
  )
  rmSync(fixture.directory, { recursive: true, force: true })
})

test("commissioning placement derives signed and observed image identities", () => {
  const fixture = bundleFixture("1.0.0-rc.1", "placement")
  const registryExportRoot = join(fixture.directory, "registry-export")
  cpSync(
    join(fixture.payloadRoot, "images"),
    join(registryExportRoot, "images"),
    { recursive: true },
  )
  const authority = "registry.customer.example:5443"
  const placement = createDeploymentPlacement({
    releaseBundle: fixture.bundle,
    importRoot: fixture.payloadRoot,
    registryExportRoot,
    validationRoot: fixture.validationRoot,
    registryAuthority: authority,
    approvedRegistryAuthorities: [authority],
    commissioningEvidenceId: "commissioning.image-placement.0001",
    auditEvidenceId: "audit.image-placement.0001",
  })
  assert.equal(
    placement.coreRelease.releaseManifestSha256,
    sha256File(fixture.bundle.manifestPath),
  )
  assert.equal(placement.placements.length, fixture.coreLockValue.images.length)
  assert.ok(
    placement.placements.every(
      ({ verification }) =>
        verification.status === "VERIFIED" &&
        verification.importedArchiveSha256 ===
          verification.mirroredArchiveSha256,
    ),
  )

  const first = fixture.coreLockValue.images[0]
  const second = fixture.coreLockValue.images[1]
  copyFileSync(
    join(registryExportRoot, second.ociArchivePath),
    join(registryExportRoot, first.ociArchivePath),
  )
  assert.throws(
    () =>
      createDeploymentPlacement({
        releaseBundle: fixture.bundle,
        importRoot: fixture.payloadRoot,
        registryExportRoot,
        validationRoot: fixture.validationRoot,
        registryAuthority: authority,
        approvedRegistryAuthorities: [authority],
        commissioningEvidenceId: "commissioning.image-placement.0002",
        auditEvidenceId: "audit.image-placement.0002",
      }),
    /imported or mirrored content is not verified/,
  )
  rmSync(fixture.directory, { recursive: true, force: true })
})

test("public verification rejects tampering, omitted evidence, and untracked artifacts", () => {
  const tampered = bundleFixture("1.0.1", "tampered")
  writeFileSync(
    join(tampered.bundle.artifactRoot, tampered.manifest.artifacts[0].path),
    "changed\n",
  )
  assert.throws(
    () => verifyReleaseBundle(tampered.bundle),
    /differs from manifest/,
  )
  rmSync(tampered.directory, { recursive: true, force: true })

  const extra = bundleFixture("1.0.2", "extra")
  write(join(extra.bundle.artifactRoot, "extra.txt"), "unexpected\n")
  assert.throws(
    () => verifyReleaseBundle(extra.bundle),
    /does not exactly match/,
  )
  rmSync(extra.directory, { recursive: true, force: true })

  const omitted = bundleFixture("1.0.3", "omitted")
  const manifest = JSON.parse(readFileSync(omitted.bundle.manifestPath, "utf8"))
  manifest.artifacts = manifest.artifacts.filter(
    ({ evidenceId }) => evidenceId !== "secret-scan",
  )
  resignManifest(omitted, manifest)
  assert.throws(
    () => verifyReleaseBundle(omitted.bundle),
    /missing required evidence/,
  )
  rmSync(omitted.directory, { recursive: true, force: true })
})

test("public verification derives exception expiry from the signed vulnerability bundle", () => {
  const fixture = bundleFixture("1.0.4", "exception-expiry")
  const manifest = JSON.parse(readFileSync(fixture.bundle.manifestPath, "utf8"))
  const vulnerabilityArtifact = manifest.artifacts.find(
    ({ evidenceId }) => evidenceId === "image-vulnerability-evidence",
  )
  const vulnerabilityPath = join(
    fixture.bundle.artifactRoot,
    vulnerabilityArtifact.path,
  )
  const vulnerability = JSON.parse(readFileSync(vulnerabilityPath, "utf8"))
  vulnerability.images[0].disposition.exceptions.push({
    expiresAt: "2026-08-05T00:00:00.000Z",
  })
  writeFileSync(vulnerabilityPath, canonicalJson(vulnerability))
  vulnerabilityArtifact.size = readFileSync(vulnerabilityPath).length
  vulnerabilityArtifact.sha256 = sha256File(vulnerabilityPath)

  const indexArtifact = manifest.artifacts.find(
    ({ evidenceId }) => evidenceId === "release-evidence-index",
  )
  const indexPath = join(fixture.bundle.artifactRoot, indexArtifact.path)
  const index = JSON.parse(readFileSync(indexPath, "utf8"))
  index.artifacts.find(
    ({ evidenceId }) => evidenceId === "image-vulnerability-evidence",
  ).sha256 = vulnerabilityArtifact.sha256
  assert.equal(index.minimumExceptionExpiry, null)
  writeFileSync(indexPath, canonicalJson(index))
  indexArtifact.size = readFileSync(indexPath).length
  indexArtifact.sha256 = sha256File(indexPath)
  manifest.artifacts.sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)),
  )
  resignManifest(fixture, manifest)
  assert.throws(
    () => verifyReleaseBundle(fixture.bundle),
    /exception expiry differs from packaged evidence/,
  )
  rmSync(fixture.directory, { recursive: true, force: true })
})

test("public verification rejects wrong purpose, revoked keys, and invalid signatures", () => {
  for (const mutation of ["purpose", "revoked", "signature"]) {
    const fixture = bundleFixture(`1.1.${mutation.length}`, mutation)
    if (mutation === "signature") {
      const envelope = JSON.parse(
        readFileSync(fixture.bundle.signaturePath, "utf8"),
      )
      envelope.signature = `${envelope.signature.slice(0, -1)}${envelope.signature.endsWith("A") ? "B" : "A"}`
      writeFileSync(fixture.bundle.signaturePath, canonicalJson(envelope))
    } else {
      const trust = JSON.parse(readFileSync(fixture.bundle.trustPath, "utf8"))
      if (mutation === "purpose") trust.keys[0].purpose = "update-bundle"
      if (mutation === "revoked") {
        trust.keys[0].state = "revoked"
        trust.keys[0].revokedAt = "2026-08-03T00:00:00.000Z"
        trust.keys[0].revocationReason = "test revocation"
        const { certificationSignature: _oldSignature, ...payload } =
          trust.keys[0]
        trust.keys[0].certificationSignature = sign(
          null,
          Buffer.from(canonicalJson(payload)),
          fixture.rootSigningPrivateKey,
        ).toString("base64url")
      }
      writeFileSync(fixture.bundle.trustPath, canonicalJson(trust))
    }
    assert.throws(() => verifyReleaseBundle(fixture.bundle))
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

test("rollback metadata binds two verified releases and never activates either", () => {
  const previous = bundleFixture("1.9.0", "previous")
  const current = bundleFixture("2.0.0", "current")
  const initialCurrentVerified = verifyReleaseBundle(current.bundle)
  const descriptor = generateRollbackDescriptor({
    currentRelease: {
      version: initialCurrentVerified.manifest.release.version,
      sourceCommit: initialCurrentVerified.manifest.release.sourceCommit,
      sourceTree: initialCurrentVerified.manifest.release.sourceTree,
      corePackagePath: initialCurrentVerified.corePackage.path,
      corePackageSize: initialCurrentVerified.corePackage.size,
      corePackageSha256: initialCurrentVerified.corePackage.sha256,
    },
    previousBundle: previous.bundle,
  })
  assert.equal(descriptor.action, "PREPARE_ONLY")
  assert.equal(descriptor.mode, "SIGNED_PREDECESSOR")
  assert.equal(descriptor.current.manifestSha256, undefined)
  assert.match(descriptor.target.manifestSha256, /^sha256:[a-f0-9]{64}$/)
  const rollbackArtifact = current.manifest.artifacts.find(
    ({ evidenceId }) => evidenceId === "rollback",
  )
  const rollbackPath = join(current.bundle.artifactRoot, rollbackArtifact.path)
  writeFileSync(rollbackPath, canonicalJson(descriptor))
  rollbackArtifact.size = readFileSync(rollbackPath).length
  rollbackArtifact.sha256 = sha256File(rollbackPath)
  resignManifest(current, current.manifest)
  const currentVerified = verifyReleaseBundle(current.bundle)
  assert.equal(currentVerified.rollbackMode, "SIGNED_PREDECESSOR")
  assert.equal(
    verifyRollbackDescriptor(
      descriptor,
      currentVerified,
      verifyReleaseBundle(previous.bundle),
    ),
    true,
  )
  const changed = structuredClone(descriptor)
  changed.target.corePackageSha256 = digest("f")
  assert.throws(
    () =>
      verifyRollbackDescriptor(
        changed,
        currentVerified,
        verifyReleaseBundle(previous.bundle),
      ),
    /target release binding/,
  )
  rmSync(previous.directory, { recursive: true, force: true })
  rmSync(current.directory, { recursive: true, force: true })
})

test("first release explicitly has no predecessor and cannot claim rollback", () => {
  const descriptor = generateInitialInstallDescriptor()
  assert.equal(descriptor.mode, "INITIAL_INSTALL_NO_PREDECESSOR")
  assert.equal(descriptor.action, "NO_RELEASE_ROLLBACK")
  assert.equal(descriptor.predecessor, null)
  assert.equal(descriptor.runtimeQualified, false)
  assert.equal(descriptor.contractActivation, "INACTIVE")
  assert.equal(
    descriptor.recoveryRequirement,
    "Q0_PREINSTALL_BACKUP_AND_CLEAN_RESTORE",
  )
  const installationState = {
    schema: "llm-machines.product-installation-state.v1",
    status: "OBSERVED_EMPTY",
    applianceId: "llmm-customer-site-1",
    observedAt: "2026-08-05T09:00:00.000Z",
    observer: {
      type: "customer-commissioning-authority",
      id: "q0.commissioning.observer.1",
    },
    containsCredentials: false,
    observation: {
      priorProductReleaseExists: false,
      productStateDatasetState: "EMPTY",
      releaseHistoryState: "ABSENT",
    },
    evidenceId: "commissioning.product-state.empty.0001",
  }
  const trust = {
    expectedApplianceId: installationState.applianceId,
    trustedEvidenceSha256: commissioningEvidenceSha256(installationState),
  }
  assert.equal(
    verifyInitialInstallDescriptor(descriptor, installationState, trust),
    true,
  )
  for (const mutate of [
    (value) => {
      value.action = "PREPARE_ONLY"
    },
    (value) => {
      value.runtimeQualified = true
    },
    (value) => {
      value.contractActivation = "ACTIVE"
    },
    (value) => {
      value.predecessor = { version: "fabricated" }
    },
  ]) {
    const changed = structuredClone(descriptor)
    mutate(changed)
    assert.throws(() =>
      verifyInitialInstallDescriptor(changed, installationState, trust),
    )
  }
  const existingRelease = {
    ...installationState,
    observation: {
      ...installationState.observation,
      priorProductReleaseExists: true,
    },
  }
  assert.throws(
    () =>
      verifyInitialInstallDescriptor(descriptor, existingRelease, {
        ...trust,
        trustedEvidenceSha256: commissioningEvidenceSha256(existingRelease),
      }),
    /requires trusted appliance-bound empty Product state/,
  )
  assert.throws(
    () => verifyInitialInstallDescriptor(descriptor, installationState),
    /requires trusted appliance-bound empty Product state/,
  )
  assert.throws(
    () =>
      verifyInitialInstallDescriptor(descriptor, installationState, {
        ...trust,
        expectedApplianceId: "llmm-other-site-2",
      }),
    /requires trusted appliance-bound empty Product state/,
  )
  assert.doesNotThrow(() =>
    JSON.parse(
      readFileSync(
        new URL("./initial-install-descriptor.schema.json", import.meta.url),
        "utf8",
      ),
    ),
  )
  assert.doesNotThrow(() =>
    JSON.parse(
      readFileSync(
        new URL("./product-installation-state.schema.json", import.meta.url),
        "utf8",
      ),
    ),
  )
  assert.doesNotThrow(() =>
    JSON.parse(
      readFileSync(
        new URL("./rollback-descriptor.schema.json", import.meta.url),
        "utf8",
      ),
    ),
  )
})

test("public verification rejects signed arbitrary rollback evidence", () => {
  const fixture = bundleFixture("1.0.0-rc.1", "invalid-rollback")
  const rollbackArtifact = fixture.manifest.artifacts.find(
    ({ evidenceId }) => evidenceId === "rollback",
  )
  const rollbackPath = join(fixture.bundle.artifactRoot, rollbackArtifact.path)
  writeFileSync(
    rollbackPath,
    canonicalJson({
      schema: "unreviewed.rollback",
      predecessor: { version: "fabricated" },
      action: "ACTIVATE",
    }),
  )
  rollbackArtifact.size = readFileSync(rollbackPath).length
  rollbackArtifact.sha256 = sha256File(rollbackPath)
  resignManifest(fixture, fixture.manifest)
  assert.throws(
    () => verifyReleaseBundle(fixture.bundle),
    /rollback descriptor/,
  )
  rmSync(fixture.directory, { recursive: true, force: true })
})

test("verification rejects trust substitution and a trust document outside the manifest", () => {
  const trusted = bundleFixture("4.0.0", "trusted")
  const attacker = bundleFixture("4.0.1", "attacker")
  assert.throws(
    () =>
      verifyReleaseBundle({
        ...attacker.bundle,
        trustedRootSha256: trusted.bundle.trustedRootSha256,
      }),
    /independently trusted fingerprint/,
  )

  const alternateTrustPath = join(trusted.directory, "alternate-trust.json")
  const alternateTrust = JSON.parse(
    readFileSync(trusted.bundle.trustPath, "utf8"),
  )
  alternateTrust.generatedAt = "2026-07-31T00:00:00.000Z"
  writeFileSync(alternateTrustPath, canonicalJson(alternateTrust))
  assert.throws(
    () =>
      verifyReleaseBundle({
        ...trusted.bundle,
        trustPath: alternateTrustPath,
      }),
    /does not match the signed trust artifact/,
  )
  rmSync(trusted.directory, { recursive: true, force: true })
  rmSync(attacker.directory, { recursive: true, force: true })
})

test("Core assembly rejects private-key-like payloads and existing outputs", () => {
  const fixture = bundleFixture("3.0.0", "guard")
  const secondPayload = join(fixture.directory, "guard-payload")
  mkdirSync(secondPayload)
  payload(secondPayload, "guard")
  write(join(secondPayload, "config", "release.key"), "not a private key\n")
  assert.throws(
    () =>
      assembleCorePackage({
        inputRoot: secondPayload,
        outputPath: join(fixture.directory, "guard.tar.zst"),
        sourceDateEpoch: 1_722_772_800,
        coreLock: fixture.coreLockValue,
        validationRoot: fixture.validationRoot,
      }),
    /private-key-like/,
  )
  assert.throws(
    () =>
      assembleCorePackage({
        inputRoot: join(fixture.directory, "payload"),
        outputPath: fixture.corePath,
        sourceDateEpoch: 1_722_772_800,
        coreLock: fixture.coreLockValue,
        validationRoot: fixture.validationRoot,
      }),
    /already exists/,
  )
  rmSync(fixture.directory, { recursive: true, force: true })
})
