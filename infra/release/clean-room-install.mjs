import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  copyArchiveEntry,
  withDeterministicArchive,
} from "./deterministic-archive.mjs"
import { canonicalJson } from "./generate-release-manifest.mjs"
import { verifyReleaseBundle } from "./verify-release-bundle.mjs"

const allowedRoots = ["config", "images", "lifecycle", "seeds", "verification"]

function fail(message) {
  throw new Error(message)
}

export function installCleanRoom({ targetRoot, ...bundle }) {
  const target = resolve(targetRoot)
  if (existsSync(target)) fail("clean-room target must not already exist")
  const parent = dirname(target)
  mkdirSync(parent, { recursive: true })
  const verified = verifyReleaseBundle(bundle)
  const corePackagePath = resolve(
    bundle.artifactRoot,
    verified.corePackage.path,
  )
  const staging = mkdtempSync(resolve(parent, `.${basename(target)}.staging-`))
  try {
    const paths = withDeterministicArchive(corePackagePath, (entry) => {
      const root = entry.path.split("/")[0]
      if (!allowedRoots.includes(root)) {
        fail(`unapproved Core package root: ${root}`)
      }
      const output = resolve(staging, entry.path)
      if (!output.startsWith(`${staging}/`))
        fail("archive entry escapes staging root")
      if (entry.type === "directory") {
        mkdirSync(output, { recursive: false, mode: 0o755 })
        return
      }
      mkdirSync(dirname(output), { recursive: true, mode: 0o755 })
      copyArchiveEntry(entry, output)
      chmodSync(output, 0o644)
    })
    for (const root of allowedRoots) {
      if (
        !paths.some(
          (path) => path === `${root}/` || path.startsWith(`${root}/`),
        )
      ) {
        fail(`Core package is missing required root: ${root}`)
      }
    }
    const installation = {
      schema: "llm-machines.clean-room-installation.v1",
      status: "INSTALLED_UNQUALIFIED",
      release: {
        version: verified.manifest.release.version,
        sourceCommit: verified.manifest.release.sourceCommit,
        sourceTree: verified.manifest.release.sourceTree,
        manifestSha256: verified.manifestSha256,
        corePackageSha256: verified.corePackage.sha256,
      },
      extractedPaths: paths,
      qualification: {
        runtimeQualified: false,
        q0: "NOT_STARTED",
        contractActivation: "INACTIVE",
      },
    }
    writeFileSync(
      resolve(staging, "installation.json"),
      canonicalJson(installation),
      {
        flag: "wx",
        mode: 0o644,
      },
    )
    renameSync(staging, target)
    return installation
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arguments_ = process.argv.slice(2)
  if (
    arguments_.length !== 12 ||
    arguments_[0] !== "--manifest" ||
    arguments_[2] !== "--signature" ||
    arguments_[4] !== "--trust" ||
    arguments_[6] !== "--artifact-root" ||
    arguments_[8] !== "--trusted-root-sha256" ||
    arguments_[10] !== "--target-root"
  ) {
    fail(
      "expected --manifest PATH --signature PATH --trust PATH --artifact-root PATH --trusted-root-sha256 SHA256 --target-root PATH",
    )
  }
  const result = installCleanRoom({
    manifestPath: arguments_[1],
    signaturePath: arguments_[3],
    trustPath: arguments_[5],
    artifactRoot: arguments_[7],
    trustedRootSha256: arguments_[9],
    targetRoot: arguments_[11],
  })
  process.stdout.write(canonicalJson(result))
}
