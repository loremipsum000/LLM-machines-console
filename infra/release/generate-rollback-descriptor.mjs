import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  commissioningEvidenceSha256,
  validatePackagedRollbackDescriptor,
  verifyInitialInstallDescriptor,
  verifyRollbackDescriptor,
} from "./validate-rollback-descriptor.mjs"
import { verifyReleaseBundle } from "./verify-release-bundle.mjs"

export {
  commissioningEvidenceSha256,
  verifyInitialInstallDescriptor,
  verifyRollbackDescriptor,
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

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function targetReleaseIdentity(release, manifestSha256, corePackage) {
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

export function generateRollbackDescriptor({ currentRelease, previousBundle }) {
  exactKeys(
    currentRelease,
    [
      "version",
      "sourceCommit",
      "sourceTree",
      "corePackagePath",
      "corePackageSize",
      "corePackageSha256",
    ],
    "current release input",
  )
  const previous = verifyReleaseBundle(previousBundle)
  const descriptor = {
    schema: "llm-machines.rollback-descriptor.v2",
    status: "PACKAGED_UNQUALIFIED",
    mode: "SIGNED_PREDECESSOR",
    current: currentRelease,
    target: targetReleaseIdentity(
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
  validatePackagedRollbackDescriptor(descriptor, {
    release: currentRelease,
    corePackage: {
      path: currentRelease.corePackagePath,
      size: currentRelease.corePackageSize,
      sha256: currentRelease.corePackageSha256,
    },
  })
  return descriptor
}

export function generateInitialInstallDescriptor() {
  return {
    schema: "llm-machines.initial-install-descriptor.v1",
    status: "PACKAGED_UNQUALIFIED",
    mode: "INITIAL_INSTALL_NO_PREDECESSOR",
    predecessor: null,
    action: "NO_RELEASE_ROLLBACK",
    runtimeQualified: false,
    contractActivation: "INACTIVE",
    q0: "NOT_STARTED",
    recoveryRequirement: "Q0_PREINSTALL_BACKUP_AND_CLEAN_RESTORE",
  }
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
  let descriptor
  if (input.mode === "INITIAL_INSTALL_NO_PREDECESSOR") {
    exactKeys(input, ["mode"], "initial-install input")
    descriptor = generateInitialInstallDescriptor()
  } else if (input.mode === "SIGNED_PREDECESSOR") {
    exactKeys(
      input,
      ["mode", "currentRelease", "previousBundle"],
      "rollback input",
    )
    descriptor = generateRollbackDescriptor({
      currentRelease: input.currentRelease,
      previousBundle: input.previousBundle,
    })
  } else {
    fail("input mode must select initial install or a signed predecessor")
  }
  writeFileSync(resolve(arguments_[3]), canonicalJson(descriptor), {
    flag: "wx",
  })
}
