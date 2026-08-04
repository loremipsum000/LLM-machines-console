import { lstatSync, readFileSync, readdirSync } from "node:fs"
import { relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import {
  assembleDeterministicArchive,
  withDeterministicArchive,
} from "./deterministic-archive.mjs"

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

export function assembleCorePackage(options) {
  verifyPayloadRoot(options.inputRoot)
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
    arguments_.length !== 6 ||
    arguments_[0] !== "--input-root" ||
    arguments_[2] !== "--output" ||
    arguments_[4] !== "--source-date-epoch"
  ) {
    fail("expected --input-root PATH --output PATH --source-date-epoch INTEGER")
  }
  const sourceDateEpoch = Number.parseInt(arguments_[5], 10)
  const result = assembleCorePackage({
    inputRoot: arguments_[1],
    outputPath: arguments_[3],
    sourceDateEpoch,
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
