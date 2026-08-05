import { lstatSync, readFileSync, readdirSync } from "node:fs"
import { relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import {
  assembleDeterministicArchive,
  withDeterministicArchive,
} from "./deterministic-archive.mjs"
import { inspectOciArchive } from "./inspect-oci-archive.mjs"
import {
  readCoreImageInventory,
  validateCoreImageLock,
} from "./validate-image-lock.mjs"

const requiredRoots = ["config", "images", "lifecycle", "seeds", "verification"]
const privateMaterialPattern = /-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----/

function fail(message) {
  throw new Error(message)
}

function verifyPayloadRoot(inputRoot) {
  const root = resolve(inputRoot)
  const entries = readdirSync(root, { withFileTypes: true })
  const names = entries.map(({ name }) => name).sort()
  if (JSON.stringify(names) !== JSON.stringify(requiredRoots)) {
    fail(`Core payload roots must be exactly ${requiredRoots.join(", ")}`)
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      fail(`Core payload root is not a directory: ${entry.name}`)
    }
    const directory = resolve(root, entry.name)
    if (readdirSync(directory).length === 0) {
      fail(`Core payload root is empty: ${entry.name}`)
    }
  }
  const visit = (current = root) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name)
      const portable = relative(root, path).split(sep).join("/")
      if (entry.isSymbolicLink())
        fail(`symbolic link is forbidden: ${portable}`)
      if (entry.isDirectory()) {
        visit(path)
        continue
      }
      if (!entry.isFile()) fail(`non-regular payload is forbidden: ${portable}`)
      const metadata = lstatSync(path)
      if (metadata.nlink !== 1)
        fail(`hard-linked payload is forbidden: ${portable}`)
      if (/\.(?:key|pem|p12|pfx|jks)$/i.test(entry.name)) {
        fail(`private-key-like payload filename is forbidden: ${portable}`)
      }
      if (metadata.size <= 4 * 1024 * 1024) {
        const contents = readFileSync(path, "utf8")
        if (privateMaterialPattern.test(contents)) {
          fail(`private signing material is forbidden: ${portable}`)
        }
      }
    }
  }
  visit()
}

function verifyLockedImageArchives(inputRoot, coreLock) {
  const errors = validateCoreImageLock(coreLock, readCoreImageInventory())
  if (errors.length > 0) {
    fail(`Core image lock is invalid: ${errors.join("; ")}`)
  }
  const imageRoot = resolve(inputRoot, "images")
  const actual = readdirSync(imageRoot).sort()
  const expected = coreLock.images
    .map(({ ociArchivePath }) => ociArchivePath.slice("images/".length))
    .sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail("Core image payload differs from the exact locked OCI archive set")
  }
  for (const image of coreLock.images) {
    const archivePath = resolve(inputRoot, image.ociArchivePath)
    const observed = inspectOciArchive(archivePath)
    if (
      observed.ociArchiveSha256 !== image.ociArchiveSha256 ||
      observed.indexDigest !== image.indexDigest ||
      observed.platform !== image.platform ||
      observed.platformDigest !== image.platformDigest
    ) {
      fail(`${image.id} OCI archive identity differs from the Core image lock`)
    }
  }
}

export function assembleCorePackage(options) {
  if (!options.coreLock) fail("Core image lock is required for assembly")
  verifyPayloadRoot(options.inputRoot)
  verifyLockedImageArchives(options.inputRoot, options.coreLock)
  const result = assembleDeterministicArchive(options)
  const paths = withDeterministicArchive(options.outputPath, () => undefined)
  for (const root of requiredRoots) {
    if (
      !paths.some((path) => path === `${root}/` || path.startsWith(`${root}/`))
    ) {
      fail(`assembled Core package is missing ${root}`)
    }
  }
  return { ...result, paths }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arguments_ = process.argv.slice(2)
  if (
    arguments_.length !== 8 ||
    arguments_[0] !== "--input-root" ||
    arguments_[2] !== "--output" ||
    arguments_[4] !== "--source-date-epoch" ||
    arguments_[6] !== "--core-lock"
  ) {
    fail(
      "expected --input-root PATH --output PATH --source-date-epoch INTEGER --core-lock PATH",
    )
  }
  const sourceDateEpoch = Number.parseInt(arguments_[5], 10)
  const result = assembleCorePackage({
    inputRoot: arguments_[1],
    outputPath: arguments_[3],
    sourceDateEpoch,
    coreLock: JSON.parse(readFileSync(arguments_[7], "utf8")),
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
