import { createHash } from "node:crypto"

const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/
const sha1Pattern = /^[a-f0-9]{40}$/
const sha256Pattern = /^sha256:[a-f0-9]{64}$/
const safePathPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const evidenceIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/
const applianceIdPattern =
  /^llmm-[a-z0-9][a-z0-9-]{0,31}-[a-z0-9][a-z0-9-]{0,31}-[0-9]{1,6}$/

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

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function canonicalTimestamp(value, field) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail(`${field} must be a canonical UTC timestamp`)
  }
}

function isSafePath(value) {
  const segments = (value ?? "").split("/")
  return (
    safePathPattern.test(value ?? "") &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    segments.every(
      (segment) => segment !== "" && segment !== "." && segment !== "..",
    )
  )
}

function validateReleaseIdentity(value, field, includeManifest) {
  exactKeys(
    value,
    [
      "version",
      "sourceCommit",
      "sourceTree",
      ...(includeManifest ? ["manifestSha256"] : []),
      "corePackagePath",
      "corePackageSize",
      "corePackageSha256",
    ],
    field,
  )
  if (
    !versionPattern.test(value.version ?? "") ||
    !sha1Pattern.test(value.sourceCommit ?? "") ||
    !sha1Pattern.test(value.sourceTree ?? "") ||
    (includeManifest && !sha256Pattern.test(value.manifestSha256 ?? "")) ||
    !isSafePath(value.corePackagePath) ||
    !Number.isInteger(value.corePackageSize) ||
    value.corePackageSize < 1 ||
    !sha256Pattern.test(value.corePackageSha256 ?? "")
  ) {
    fail(`${field} is invalid`)
  }
}

export function validateInitialInstallDescriptor(descriptor) {
  exactKeys(
    descriptor,
    [
      "schema",
      "status",
      "mode",
      "predecessor",
      "action",
      "runtimeQualified",
      "contractActivation",
      "q0",
      "recoveryRequirement",
    ],
    "initial-install descriptor",
  )
  if (
    descriptor.schema !== "llm-machines.initial-install-descriptor.v1" ||
    descriptor.status !== "PACKAGED_UNQUALIFIED" ||
    descriptor.mode !== "INITIAL_INSTALL_NO_PREDECESSOR" ||
    descriptor.predecessor !== null ||
    descriptor.action !== "NO_RELEASE_ROLLBACK" ||
    descriptor.runtimeQualified !== false ||
    descriptor.contractActivation !== "INACTIVE" ||
    descriptor.q0 !== "NOT_STARTED" ||
    descriptor.recoveryRequirement !== "Q0_PREINSTALL_BACKUP_AND_CLEAN_RESTORE"
  ) {
    fail("initial-install descriptor overstates rollback or qualification")
  }
  return true
}

export function validatePackagedRollbackDescriptor(
  descriptor,
  { release, corePackage },
) {
  if (descriptor?.schema === "llm-machines.initial-install-descriptor.v1") {
    validateInitialInstallDescriptor(descriptor)
    return descriptor.mode
  }
  exactKeys(
    descriptor,
    [
      "schema",
      "status",
      "mode",
      "current",
      "target",
      "action",
      "qualification",
    ],
    "rollback descriptor",
  )
  exactKeys(
    descriptor.qualification,
    ["runtimeQualified", "q0", "contractActivation"],
    "rollback qualification",
  )
  if (
    descriptor.schema !== "llm-machines.rollback-descriptor.v2" ||
    descriptor.status !== "PACKAGED_UNQUALIFIED" ||
    descriptor.mode !== "SIGNED_PREDECESSOR" ||
    descriptor.action !== "PREPARE_ONLY" ||
    descriptor.qualification.runtimeQualified !== false ||
    descriptor.qualification.q0 !== "NOT_STARTED" ||
    descriptor.qualification.contractActivation !== "INACTIVE"
  ) {
    fail("rollback descriptor overstates qualification or action")
  }
  validateReleaseIdentity(descriptor.current, "current release", false)
  validateReleaseIdentity(descriptor.target, "rollback target", true)
  if (
    descriptor.current.version !== release?.version ||
    descriptor.current.sourceCommit !== release?.sourceCommit ||
    descriptor.current.sourceTree !== release?.sourceTree ||
    descriptor.current.corePackagePath !== corePackage?.path ||
    descriptor.current.corePackageSize !== corePackage?.size ||
    descriptor.current.corePackageSha256 !== corePackage?.sha256
  ) {
    fail("rollback descriptor current release binding is invalid")
  }
  if (descriptor.current.version === descriptor.target.version) {
    fail("rollback descriptor cannot target the current release")
  }
  return descriptor.mode
}

export function commissioningEvidenceSha256(installationState) {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(installationState))
    .digest("hex")}`
}

export function verifyInitialInstallDescriptor(
  descriptor,
  installationState,
  { expectedApplianceId, trustedEvidenceSha256 } = {},
) {
  validateInitialInstallDescriptor(descriptor)
  exactKeys(
    installationState,
    [
      "schema",
      "status",
      "applianceId",
      "observedAt",
      "observer",
      "containsCredentials",
      "observation",
      "evidenceId",
    ],
    "Product installation-state evidence",
  )
  exactKeys(
    installationState.observer,
    ["type", "id"],
    "Product installation-state observer",
  )
  exactKeys(
    installationState.observation,
    [
      "priorProductReleaseExists",
      "productStateDatasetState",
      "releaseHistoryState",
    ],
    "Product installation-state observation",
  )
  canonicalTimestamp(installationState.observedAt, "observedAt")
  if (
    installationState.schema !== "llm-machines.product-installation-state.v1" ||
    installationState.status !== "OBSERVED_EMPTY" ||
    !applianceIdPattern.test(installationState.applianceId ?? "") ||
    installationState.applianceId !== expectedApplianceId ||
    installationState.observer.type !== "q0-trusted-observer" ||
    !evidenceIdPattern.test(installationState.observer.id ?? "") ||
    installationState.containsCredentials !== false ||
    installationState.observation.priorProductReleaseExists !== false ||
    installationState.observation.productStateDatasetState !== "EMPTY" ||
    installationState.observation.releaseHistoryState !== "ABSENT" ||
    !evidenceIdPattern.test(installationState.evidenceId ?? "") ||
    !sha256Pattern.test(trustedEvidenceSha256 ?? "") ||
    commissioningEvidenceSha256(installationState) !== trustedEvidenceSha256
  ) {
    fail(
      "initial-install mode requires trusted appliance-bound empty Product state",
    )
  }
  return true
}

export function verifyRollbackDescriptor(
  descriptor,
  currentVerified,
  previousVerified,
) {
  const mode = validatePackagedRollbackDescriptor(descriptor, {
    release: currentVerified?.manifest?.release,
    corePackage: currentVerified?.corePackage,
  })
  if (mode !== "SIGNED_PREDECESSOR") {
    fail("initial-install descriptor cannot authorize release rollback")
  }
  const target = descriptor.target
  const previous = previousVerified
  if (
    target.version !== previous?.manifest?.release?.version ||
    target.sourceCommit !== previous?.manifest?.release?.sourceCommit ||
    target.sourceTree !== previous?.manifest?.release?.sourceTree ||
    target.manifestSha256 !== previous?.manifestSha256 ||
    target.corePackagePath !== previous?.corePackage?.path ||
    target.corePackageSize !== previous?.corePackage?.size ||
    target.corePackageSha256 !== previous?.corePackage?.sha256
  ) {
    fail("rollback descriptor target release binding is invalid")
  }
  return true
}
