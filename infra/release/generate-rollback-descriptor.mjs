import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { canonicalJson } from "./generate-release-manifest.mjs"
import { verifyReleaseBundle } from "./verify-release-bundle.mjs"

function fail(message) {
  throw new Error(message)
}

function releaseIdentity(release, manifestSha256, corePackage) {
  return {
    version: release.version,
    sourceCommit: release.sourceCommit,
    sourceTree: release.sourceTree,
    manifestSha256,
    corePackagePath: corePackage.path,
    corePackageSize: corePackage.size,
    corePackageSha256: corePackage.sha256,
  }
}

export function generateRollbackDescriptor({ currentBundle, previousBundle }) {
  const current = verifyReleaseBundle(currentBundle)
  const previous = verifyReleaseBundle(previousBundle)
  if (current.manifest.release.version === previous.manifest.release.version) {
    fail("rollback target must use a different release version")
  }
  return {
    schema: "llm-machines.rollback-descriptor.v1",
    status: "PACKAGED_UNQUALIFIED",
    current: releaseIdentity(
      current.manifest.release,
      current.manifestSha256,
      current.corePackage,
    ),
    target: releaseIdentity(
      previous.manifest.release,
      previous.manifestSha256,
      previous.corePackage,
    ),
    action: "PREPARE_ONLY",
    qualification: {
      runtimeQualified: false,
      q0: "NOT_STARTED",
      contractActivation: "INACTIVE",
    },
  }
}

export function verifyRollbackDescriptor(
  descriptor,
  currentVerified,
  previousVerified,
) {
  if (
    descriptor?.schema !== "llm-machines.rollback-descriptor.v1" ||
    descriptor?.status !== "PACKAGED_UNQUALIFIED" ||
    descriptor?.action !== "PREPARE_ONLY" ||
    descriptor?.qualification?.runtimeQualified !== false ||
    descriptor?.qualification?.q0 !== "NOT_STARTED" ||
    descriptor?.qualification?.contractActivation !== "INACTIVE"
  ) {
    fail("rollback descriptor overstates qualification or action")
  }
  const matches = (record, verified) =>
    record?.version === verified.manifest.release.version &&
    record?.sourceCommit === verified.manifest.release.sourceCommit &&
    record?.sourceTree === verified.manifest.release.sourceTree &&
    record?.manifestSha256 === verified.manifestSha256 &&
    record?.corePackagePath === verified.corePackage.path &&
    record?.corePackageSize === verified.corePackage.size &&
    record?.corePackageSha256 === verified.corePackage.sha256
  if (!matches(descriptor.current, currentVerified)) {
    fail("rollback descriptor current release binding is invalid")
  }
  if (!matches(descriptor.target, previousVerified)) {
    fail("rollback descriptor target release binding is invalid")
  }
  if (descriptor.current.version === descriptor.target.version) {
    fail("rollback descriptor cannot target the current release")
  }
  return true
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arguments_ = process.argv.slice(2)
  if (
    arguments_.length !== 4 ||
    arguments_[0] !== "--input" ||
    arguments_[2] !== "--output"
  ) {
    fail("expected --input PATH --output PATH")
  }
  const input = JSON.parse(readFileSync(resolve(arguments_[1]), "utf8"))
  const descriptor = generateRollbackDescriptor(input)
  writeFileSync(resolve(arguments_[3]), canonicalJson(descriptor), {
    flag: "wx",
  })
}
