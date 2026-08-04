import { createHash, createPublicKey, verify } from "node:crypto"
import { lstatSync, readFileSync, readdirSync } from "node:fs"
import { relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { sha256File } from "./deterministic-archive.mjs"
import { canonicalJson } from "./generate-release-manifest.mjs"
import {
  minimumExceptionExpiryFromBundle,
  validateReleaseEvidenceIndex,
} from "./validate-release-evidence-index.mjs"

const issuer = "urn:llm-machines:vendor"
const sha256Pattern = /^sha256:[a-f0-9]{64}$/
const safePathPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const mutablePathPattern = /(?:^|[._/-])latest(?:$|[._/-])/i
const kidPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const signaturePattern = /^[A-Za-z0-9_-]{86}$/
const classifications = new Set([
  "core",
  "evidence",
  "license",
  "source",
  "installer",
  "rollback",
  "public-trust",
])
const requiredEvidence = JSON.parse(
  readFileSync(new URL("./release-plan.json", import.meta.url), "utf8"),
).requiredEvidence

if (
  !Array.isArray(requiredEvidence) ||
  requiredEvidence.length === 0 ||
  new Set(requiredEvidence).size !== requiredEvidence.length
) {
  throw new Error("checked-in release plan requiredEvidence is invalid")
}

function fail(message) {
  throw new Error(message)
}

function exactKeys(value, expected, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${field} must be an object`)
  }
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${field} keys must be exactly ${wanted.join(", ")}`)
  }
}

function parseTimestamp(value, field) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail(`${field} must be a canonical UTC timestamp`)
  }
  return parsed
}

function decodeBase64Url(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    fail(`${field} is not canonical base64url`)
  }
  const decoded = Buffer.from(value, "base64url")
  if (decoded.toString("base64url") !== value) {
    fail(`${field} is not canonical base64url`)
  }
  return decoded
}

function publicKey(record, field) {
  exactKeys(record, ["format", "value"], field)
  if (record.format !== "spki-der-base64url") {
    fail(`${field} must use SPKI DER base64url`)
  }
  try {
    const key = createPublicKey({
      key: decodeBase64Url(record.value, `${field}.value`),
      format: "der",
      type: "spki",
    })
    if (key.asymmetricKeyType !== "ed25519") fail(`${field} is not Ed25519`)
    return key
  } catch (error) {
    fail(
      `${field} is invalid: ${error instanceof Error ? error.message : "unknown"}`,
    )
  }
}

function safeArtifactPath(path) {
  const parts = (path ?? "").split("/")
  if (
    !safePathPattern.test(path ?? "") ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    parts.some((part) => part === "" || part === "." || part === "..") ||
    mutablePathPattern.test(path)
  ) {
    fail(`unsafe or mutable artifact path: ${path ?? "missing"}`)
  }
}

function portablePath(path) {
  return path.split(sep).join("/")
}

function listFiles(root, current = root) {
  const files = []
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = resolve(current, entry.name)
    const path = portablePath(relative(root, absolute))
    if (entry.isSymbolicLink()) fail(`symbolic links are forbidden: ${path}`)
    if (entry.isDirectory()) {
      files.push(...listFiles(root, absolute))
      continue
    }
    if (!entry.isFile()) fail(`non-regular artifact is forbidden: ${path}`)
    const metadata = lstatSync(absolute)
    if (metadata.nlink !== 1) fail(`hard-linked artifact is forbidden: ${path}`)
    files.push(path)
  }
  return files.sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  )
}

function parseCanonicalJson(path, field) {
  const bytes = readFileSync(path)
  let value
  try {
    value = JSON.parse(bytes.toString("utf8"))
  } catch {
    fail(`${field} is not valid JSON`)
  }
  if (!bytes.equals(Buffer.from(canonicalJson(value)))) {
    fail(`${field} is not canonical JSON`)
  }
  return { bytes, value }
}

function scopedCertificationPayload(key) {
  const { certificationSignature: _signature, ...payload } = key
  return Buffer.from(canonicalJson(payload))
}

function validateTrust(trust, signedAt, kid, trustedRootSha256) {
  exactKeys(
    trust,
    ["schema", "generatedAt", "issuer", "root", "keys", "dualTrust"],
    "public release trust",
  )
  if (
    trust.schema !== "llm-machines.release-public-trust.v1" ||
    trust.issuer !== issuer
  ) {
    fail("public release trust identity is invalid")
  }
  const generatedAt = parseTimestamp(trust.generatedAt, "trust.generatedAt")
  exactKeys(
    trust.root,
    [
      "kid",
      "purpose",
      "algorithm",
      "publicKey",
      "notBefore",
      "notAfter",
      "state",
      "revokedAt",
      "revocationReason",
    ],
    "release root",
  )
  if (
    !kidPattern.test(trust.root.kid ?? "") ||
    trust.root.purpose !== "vendor-release-root" ||
    trust.root.algorithm !== "Ed25519"
  ) {
    fail("release root identity is invalid")
  }
  const rootNotBefore = parseTimestamp(trust.root.notBefore, "root.notBefore")
  const rootNotAfter = parseTimestamp(trust.root.notAfter, "root.notAfter")
  if (
    rootNotBefore >= rootNotAfter ||
    generatedAt < rootNotBefore ||
    generatedAt > rootNotAfter ||
    signedAt < rootNotBefore ||
    signedAt > rootNotAfter ||
    trust.root.state !== "active" ||
    trust.root.revokedAt !== null ||
    trust.root.revocationReason !== null
  ) {
    fail("release root is not active and valid")
  }
  const rootKey = publicKey(trust.root.publicKey, "root.publicKey")
  const rootPublicKey = trust.root.publicKey.value
  const actualRootSha256 = `sha256:${createHash("sha256")
    .update(decodeBase64Url(rootPublicKey, "root.publicKey.value"))
    .digest("hex")}`
  if (
    !sha256Pattern.test(trustedRootSha256 ?? "") ||
    actualRootSha256 !== trustedRootSha256
  ) {
    fail("release root does not match the independently trusted fingerprint")
  }
  if (!Array.isArray(trust.keys) || trust.keys.length === 0) {
    fail("public release trust requires scoped keys")
  }
  if (!Array.isArray(trust.dualTrust) || trust.dualTrust.length > 16) {
    fail("public release trust dualTrust is invalid")
  }
  const keyIds = new Set()
  const publicKeys = new Set([rootPublicKey])
  for (const key of trust.keys) {
    exactKeys(
      key,
      [
        "kid",
        "purpose",
        "algorithm",
        "issuer",
        "publicKey",
        "notBefore",
        "notAfter",
        "state",
        "revokedAt",
        "revocationReason",
        "signedByKid",
        "certificationSignature",
      ],
      "scoped release key",
    )
    if (keyIds.has(key.kid)) fail(`duplicate scoped release key: ${key.kid}`)
    keyIds.add(key.kid)
    if (
      !kidPattern.test(key.kid ?? "") ||
      key.purpose !== "release-artifact" ||
      key.algorithm !== "Ed25519" ||
      key.issuer !== issuer ||
      key.signedByKid !== trust.root.kid ||
      !signaturePattern.test(key.certificationSignature ?? "")
    ) {
      fail(`scoped release key identity is invalid: ${key.kid ?? "missing"}`)
    }
    const keyNotBefore = parseTimestamp(
      key.notBefore,
      `key ${key.kid}.notBefore`,
    )
    const keyNotAfter = parseTimestamp(key.notAfter, `key ${key.kid}.notAfter`)
    if (keyNotBefore >= keyNotAfter) {
      fail(`scoped release key validity is invalid: ${key.kid}`)
    }
    if (publicKeys.has(key.publicKey?.value)) {
      fail(`release public key material is reused: ${key.kid}`)
    }
    publicKeys.add(key.publicKey.value)
    if (key.state === "revoked") {
      if (key.revokedAt === null || typeof key.revocationReason !== "string") {
        fail(`revoked release key lacks revocation metadata: ${key.kid}`)
      }
      parseTimestamp(key.revokedAt, `key ${key.kid}.revokedAt`)
    } else if (key.revokedAt !== null || key.revocationReason !== null) {
      fail(`non-revoked release key has revocation metadata: ${key.kid}`)
    }
    publicKey(key.publicKey, `key ${key.kid}.publicKey`)
    if (
      !verify(
        null,
        scopedCertificationPayload(key),
        rootKey,
        decodeBase64Url(key.certificationSignature, "certificationSignature"),
      )
    ) {
      fail(`scoped release key certification failed: ${key.kid}`)
    }
  }
  const migrationIds = new Set()
  for (const migration of trust.dualTrust) {
    exactKeys(
      migration,
      ["predecessorKid", "successorKid", "startsAt", "endsAt"],
      "dual-trust migration",
    )
    const migrationId = `${migration.predecessorKid}:${migration.successorKid}`
    if (migrationIds.has(migrationId)) fail("duplicate dual-trust migration")
    migrationIds.add(migrationId)
    const startsAt = parseTimestamp(migration.startsAt, "dualTrust.startsAt")
    const endsAt = parseTimestamp(migration.endsAt, "dualTrust.endsAt")
    if (
      startsAt >= endsAt ||
      endsAt - startsAt > 30 * 24 * 60 * 60 * 1000 ||
      !keyIds.has(migration.predecessorKid) ||
      !keyIds.has(migration.successorKid) ||
      migration.predecessorKid === migration.successorKid
    ) {
      fail("dual-trust migration is invalid")
    }
  }
  const selected = trust.keys.find((key) => key.kid === kid)
  if (!selected) fail(`unknown release signing key: ${kid}`)
  const notBefore = parseTimestamp(selected.notBefore, "key.notBefore")
  const notAfter = parseTimestamp(selected.notAfter, "key.notAfter")
  if (signedAt < generatedAt || signedAt < notBefore || signedAt > notAfter) {
    fail("release signature is outside signing-key validity")
  }
  if (
    selected.state === "revoked" ||
    (selected.revokedAt !== null &&
      signedAt >= parseTimestamp(selected.revokedAt, "key.revokedAt"))
  ) {
    fail("release signing key is revoked")
  }
  if (selected.state === "active") return selected
  if (selected.state !== "retiring") fail("release signing key is not trusted")
  const migrations = trust.dualTrust.filter(
    (entry) => entry.predecessorKid === selected.kid,
  )
  if (migrations.length !== 1)
    fail("retiring key requires one dual-trust window")
  const migration = migrations[0]
  const startsAt = parseTimestamp(migration.startsAt, "dualTrust.startsAt")
  const endsAt = parseTimestamp(migration.endsAt, "dualTrust.endsAt")
  if (
    startsAt >= endsAt ||
    signedAt < startsAt ||
    signedAt > endsAt ||
    !keyIds.has(migration.successorKid)
  ) {
    fail("release signature is outside the dual-trust window")
  }
  return selected
}

function validateManifest(manifest, artifactRoot, signatureTimestamp) {
  exactKeys(
    manifest,
    ["schema", "status", "release", "contracts", "artifacts", "qualification"],
    "release manifest",
  )
  if (
    manifest.schema !== "llm-machines.release-manifest.v1" ||
    manifest.status !== "PACKAGED_UNQUALIFIED" ||
    manifest.qualification?.runtimeQualified !== false ||
    manifest.qualification?.q0 !== "NOT_STARTED" ||
    manifest.qualification?.contractActivation !== "INACTIVE"
  ) {
    fail("release manifest overstates qualification or activation")
  }
  exactKeys(
    manifest.release,
    [
      "version",
      "artifactName",
      "sourceCommit",
      "sourceTree",
      "sourceDateEpoch",
      "evidenceEvaluatedAt",
      "platform",
    ],
    "release identity",
  )
  exactKeys(
    manifest.contracts,
    [
      "releasePlanSha256",
      "releaseEvidencePolicySha256",
      "coreImageInventorySha256",
      "coreImageLockSha256",
      "deliveryProfileSchemaSha256",
      "inferenceArtifactLockSchemaSha256",
      "firecrawlSourcePackageSha256",
    ],
    "release contracts",
  )
  exactKeys(
    manifest.qualification,
    ["runtimeQualified", "q0", "contractActivation"],
    "release qualification",
  )
  const expectedArtifactName = `llm-machines-core-${manifest.release.version}-linux-amd64.tar.zst`
  if (
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(
      manifest.release.version ?? "",
    ) ||
    manifest.release.artifactName !== expectedArtifactName ||
    !/^[a-f0-9]{40}$/.test(manifest.release.sourceCommit ?? "") ||
    !/^[a-f0-9]{40}$/.test(manifest.release.sourceTree ?? "") ||
    !Number.isInteger(manifest.release.sourceDateEpoch) ||
    manifest.release.sourceDateEpoch < 1 ||
    !Number.isInteger(Date.parse(manifest.release.evidenceEvaluatedAt)) ||
    Date.parse(manifest.release.evidenceEvaluatedAt) <
      manifest.release.sourceDateEpoch * 1000 ||
    manifest.release.platform !== "linux/amd64" ||
    Object.values(manifest.contracts).some(
      (digest) => !sha256Pattern.test(digest ?? ""),
    )
  ) {
    fail("release identity or contract digests are invalid")
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    fail("release manifest artifact inventory is empty")
  }
  const paths = new Set()
  const ids = new Set()
  const evidence = new Set()
  let coreLock
  let evidenceIndex
  let vulnerabilityEvidence
  let corePackage
  let publicTrust
  let previousPath = null
  for (const artifact of manifest.artifacts) {
    exactKeys(
      artifact,
      [
        "id",
        "evidenceId",
        "path",
        "size",
        "sha256",
        "mediaType",
        "classification",
      ],
      "release manifest artifact",
    )
    safeArtifactPath(artifact.path)
    if (
      typeof artifact.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]{2,63}$/.test(artifact.id) ||
      (artifact.evidenceId !== null &&
        (typeof artifact.evidenceId !== "string" ||
          !/^[a-z0-9][a-z0-9-]{2,63}$/.test(artifact.evidenceId))) ||
      typeof artifact.mediaType !== "string" ||
      artifact.mediaType.length < 3 ||
      !classifications.has(artifact.classification)
    ) {
      fail(`invalid artifact metadata: ${artifact.path}`)
    }
    if (
      previousPath !== null &&
      Buffer.from(previousPath).compare(Buffer.from(artifact.path)) >= 0
    ) {
      fail("release manifest artifact inventory is not bytewise sorted")
    }
    previousPath = artifact.path
    if (paths.has(artifact.path))
      fail(`duplicate artifact path: ${artifact.path}`)
    if (ids.has(artifact.id)) fail(`duplicate artifact ID: ${artifact.id}`)
    paths.add(artifact.path)
    ids.add(artifact.id)
    if (artifact.evidenceId !== null) {
      if (!requiredEvidence.includes(artifact.evidenceId)) {
        fail(`unapproved evidence ID: ${artifact.evidenceId}`)
      }
      if (evidence.has(artifact.evidenceId)) {
        fail(`duplicate evidence ID: ${artifact.evidenceId}`)
      }
      evidence.add(artifact.evidenceId)
    }
    if (!Number.isInteger(artifact.size) || artifact.size < 0) {
      fail(`invalid artifact size: ${artifact.path}`)
    }
    if (!sha256Pattern.test(artifact.sha256 ?? "")) {
      fail(`invalid artifact digest: ${artifact.path}`)
    }
    const absolute = resolve(artifactRoot, artifact.path)
    const relativePath = relative(resolve(artifactRoot), absolute)
    if (relativePath.startsWith(`..${sep}`) || relativePath === "..") {
      fail(`artifact escapes artifact root: ${artifact.path}`)
    }
    const metadata = lstatSync(absolute)
    if (!metadata.isFile() || metadata.nlink !== 1) {
      fail(`artifact is not one regular file: ${artifact.path}`)
    }
    if (
      metadata.size !== artifact.size ||
      sha256File(absolute) !== artifact.sha256
    ) {
      fail(`artifact content differs from manifest: ${artifact.path}`)
    }
    if (artifact.evidenceId === "core-image-lock") coreLock = artifact
    if (artifact.evidenceId === "release-evidence-index") {
      evidenceIndex = artifact
    }
    if (artifact.evidenceId === "image-vulnerability-evidence") {
      vulnerabilityEvidence = artifact
    }
    if (artifact.evidenceId === "public-release-trust") publicTrust = artifact
    if (artifact.id === "core-package") corePackage = artifact
  }
  for (const evidenceId of requiredEvidence) {
    if (!evidence.has(evidenceId))
      fail(`missing required evidence: ${evidenceId}`)
  }
  if (
    manifest.artifacts.filter(({ evidenceId }) => evidenceId === null)
      .length !== 1
  ) {
    fail("only one Core package may omit an evidence ID")
  }
  const actualFiles = listFiles(resolve(artifactRoot))
  const declaredFiles = [...paths].sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  )
  if (JSON.stringify(actualFiles) !== JSON.stringify(declaredFiles)) {
    fail("artifact root does not exactly match the signed manifest")
  }
  if (
    !coreLock ||
    coreLock.sha256 !== manifest.contracts?.coreImageLockSha256
  ) {
    fail("signed manifest does not bind its actual Core image lock")
  }
  if (
    !corePackage ||
    corePackage.evidenceId !== null ||
    corePackage.classification !== "core" ||
    corePackage.path !== `core/${expectedArtifactName}`
  ) {
    fail("signed manifest does not contain one Core package")
  }
  const coreLockValue = JSON.parse(
    readFileSync(resolve(artifactRoot, coreLock.path), "utf8"),
  )
  if (
    coreLockValue?.schema !== "llm-machines.core-image-lock.v1" ||
    coreLockValue?.status !== "LOCKED" ||
    coreLockValue?.release?.version !== manifest.release?.version ||
    coreLockValue?.release?.sourceCommit !== manifest.release?.sourceCommit ||
    coreLockValue?.release?.sourceTree !== manifest.release?.sourceTree
  ) {
    fail("actual Core image lock differs from the signed release identity")
  }
  if (!evidenceIndex) {
    fail("signed manifest does not contain its semantic evidence index")
  }
  if (!vulnerabilityEvidence) {
    fail("signed manifest does not contain vulnerability evidence")
  }
  const evidenceIndexValue = JSON.parse(
    readFileSync(resolve(artifactRoot, evidenceIndex.path), "utf8"),
  )
  const vulnerabilityEvidenceValue = JSON.parse(
    readFileSync(resolve(artifactRoot, vulnerabilityEvidence.path), "utf8"),
  )
  validateReleaseEvidenceIndex(evidenceIndexValue, {
    coreLock: coreLockValue,
    coreLockPath: resolve(artifactRoot, coreLock.path),
    evidenceArtifacts: manifest.artifacts,
    release: manifest.release,
    minimumExceptionExpiry: minimumExceptionExpiryFromBundle(
      vulnerabilityEvidenceValue,
    ),
    signatureTimestamp,
  })
  if (!publicTrust || publicTrust.classification !== "public-trust") {
    fail("signed manifest does not contain its public release trust")
  }
  return { corePackage, publicTrust }
}

export function verifyReleaseBundle({
  manifestPath,
  signaturePath,
  trustPath,
  artifactRoot,
  trustedRootSha256,
}) {
  const manifestRecord = parseCanonicalJson(
    resolve(manifestPath),
    "release manifest",
  )
  const signature = parseCanonicalJson(
    resolve(signaturePath),
    "release signature",
  ).value
  const trust = parseCanonicalJson(
    resolve(trustPath),
    "public release trust",
  ).value
  exactKeys(
    signature,
    [
      "schema",
      "status",
      "purpose",
      "algorithm",
      "issuer",
      "kid",
      "signedManifestSha256",
      "signedAt",
      "signature",
    ],
    "release signature",
  )
  if (
    signature.schema !== "llm-machines.release-signature.v1" ||
    signature.status !== "SIGNED_OFFLINE" ||
    signature.purpose !== "release-artifact" ||
    signature.algorithm !== "Ed25519" ||
    signature.issuer !== issuer ||
    !kidPattern.test(signature.kid ?? "") ||
    !sha256Pattern.test(signature.signedManifestSha256 ?? "") ||
    !signaturePattern.test(signature.signature ?? "")
  ) {
    fail("release signature envelope is invalid")
  }
  const signedAt = parseTimestamp(signature.signedAt, "signature.signedAt")
  const key = validateTrust(trust, signedAt, signature.kid, trustedRootSha256)
  const manifestSha256 = `sha256:${createHash("sha256")
    .update(manifestRecord.bytes)
    .digest("hex")}`
  if (manifestSha256 !== signature.signedManifestSha256) {
    fail("release signature envelope binds a different manifest")
  }
  if (
    !verify(
      null,
      manifestRecord.bytes,
      publicKey(key.publicKey, "release signing publicKey"),
      decodeBase64Url(signature.signature, "signature"),
    )
  ) {
    fail("release signature verification failed")
  }
  const validated = validateManifest(
    manifestRecord.value,
    resolve(artifactRoot),
    signature.signedAt,
  )
  if (sha256File(resolve(trustPath)) !== validated.publicTrust.sha256) {
    fail("used public release trust does not match the signed trust artifact")
  }
  return {
    status: "VERIFIED_PACKAGED_UNQUALIFIED",
    manifest: manifestRecord.value,
    manifestSha256,
    corePackage: validated.corePackage,
    signingKid: key.kid,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arguments_ = process.argv.slice(2)
  if (
    arguments_.length !== 10 ||
    arguments_[0] !== "--manifest" ||
    arguments_[2] !== "--signature" ||
    arguments_[4] !== "--trust" ||
    arguments_[6] !== "--artifact-root" ||
    arguments_[8] !== "--trusted-root-sha256"
  ) {
    fail(
      "expected --manifest PATH --signature PATH --trust PATH --artifact-root PATH --trusted-root-sha256 SHA256",
    )
  }
  const result = verifyReleaseBundle({
    manifestPath: arguments_[1],
    signaturePath: arguments_[3],
    trustPath: arguments_[5],
    artifactRoot: arguments_[7],
    trustedRootSha256: arguments_[9],
  })
  process.stdout.write(
    `${JSON.stringify(
      {
        status: result.status,
        manifestSha256: result.manifestSha256,
        release: result.manifest.release,
        corePackage: result.corePackage,
        signingKid: result.signingKid,
      },
      null,
      2,
    )}\n`,
  )
}
