import assert from "node:assert/strict"
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import {
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
import { sha256File } from "./deterministic-archive.mjs"
import { canonicalJson } from "./generate-release-manifest.mjs"
import {
  generateRollbackDescriptor,
  verifyRollbackDescriptor,
} from "./generate-rollback-descriptor.mjs"
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

function payload(root, label) {
  for (const directory of [
    "config",
    "images",
    "lifecycle",
    "seeds",
    "verification",
  ]) {
    write(join(root, directory, `${directory}.txt`), `${label}-${directory}\n`)
  }
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

function syntheticCoreLock(version, sourceCommit, sourceTree, sourceDigests) {
  const inventory = readCoreImageInventory()
  return {
    schema: "llm-machines.core-image-lock.v1",
    status: "LOCKED",
    release: { version, sourceCommit, sourceTree },
    inventorySha256: coreInventorySha256(),
    platform: "linux/amd64",
    privateRegistry: "registry.release.invalid",
    images: inventory.components.map((component, index) => ({
      id: component.id,
      repository: `registry.release.invalid/${component.mirrorRepository}`,
      version:
        component.kind === "third-party-mirror"
          ? component.version
          : `${version}-build.${index + 1}`,
      indexDigest:
        component.kind === "third-party-mirror"
          ? component.indexDigest
          : digest(((index + 1) % 16).toString(16)),
      platform: "linux/amd64",
      platformDigest:
        component.kind === "third-party-mirror"
          ? component.platformDigest
          : digest(((index + 2) % 16).toString(16)),
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
  payload(payloadRoot, label)
  const assembled = assembleCorePackage({
    inputRoot: payloadRoot,
    outputPath: corePath,
    sourceDateEpoch: 1_722_772_800,
  })
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
  const coreLockValue = syntheticCoreLock(version, sourceCommit, sourceTree, {
    firecrawl: `sha256:${createHash("sha256").update(firecrawlSource).digest("hex")}`,
    grafana: `sha256:${createHash("sha256").update(grafanaSource).digest("hex")}`,
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
    schema: "llm-machines.release-manifest.v1",
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
      deliveryProfileSchemaSha256: digest("3"),
      inferenceArtifactLockSchemaSha256: digest("4"),
      firecrawlSourcePackageSha256: digest("5"),
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
    directory,
    manifest,
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
  })
  assert.equal(second.sha256, fixture.assembled.sha256)
  assert.deepEqual(second.paths, fixture.assembled.paths)
  rmSync(fixture.directory, { recursive: true, force: true })
})

test("public verifier and clean-room installer preserve the unqualified boundary", () => {
  const fixture = bundleFixture()
  const verified = verifyReleaseBundle(fixture.bundle)
  assert.equal(verified.status, "VERIFIED_PACKAGED_UNQUALIFIED")
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
  const descriptor = generateRollbackDescriptor({
    currentBundle: current.bundle,
    previousBundle: previous.bundle,
  })
  assert.equal(descriptor.action, "PREPARE_ONLY")
  assert.match(descriptor.current.manifestSha256, /^sha256:[a-f0-9]{64}$/)
  const currentVerified = verifyReleaseBundle(current.bundle)
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
      }),
    /private-key-like/,
  )
  assert.throws(
    () =>
      assembleCorePackage({
        inputRoot: join(fixture.directory, "payload"),
        outputPath: fixture.corePath,
        sourceDateEpoch: 1_722_772_800,
      }),
    /already exists/,
  )
  rmSync(fixture.directory, { recursive: true, force: true })
})
