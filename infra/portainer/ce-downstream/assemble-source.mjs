#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const directory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(directory, "../../..")
const manifest = JSON.parse(
  readFileSync(path.join(directory, "source-package.json"), "utf8"),
)

function fail(message) {
  throw new Error(message)
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  })
  if (result.status !== 0) {
    fail(
      `${command} failed: ${result.stderr || result.stdout || result.status}`,
    )
  }
  return result.stdout
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || !value) {
      fail(
        "usage: assemble-source.mjs --archive PATH --pnpm-tarball PATH --output PATH",
      )
    }
    values.set(key, value)
  }
  if (values.size !== 3) {
    fail(
      "usage: assemble-source.mjs --archive PATH --pnpm-tarball PATH --output PATH",
    )
  }
  return {
    archive: path.resolve(values.get("--archive") ?? ""),
    pnpmTarball: path.resolve(values.get("--pnpm-tarball") ?? ""),
    output: path.resolve(values.get("--output") ?? ""),
  }
}

function archiveEntries(archive) {
  return run("tar", ["-tzf", archive]).split(/\r?\n/).filter(Boolean)
}

function assertArchiveSafe(archive) {
  const root = manifest.upstream.archiveRoot
  const entries = archiveEntries(archive)
  if (entries.length === 0) fail("Portainer source archive is empty")
  for (const entry of entries) {
    const normalized = path.posix.normalize(entry)
    if (
      entry.startsWith("/") ||
      normalized === ".." ||
      normalized.startsWith("../") ||
      (normalized !== root && !normalized.startsWith(`${root}/`))
    ) {
      fail(`unsafe or unexpected archive entry: ${entry}`)
    }
  }
}

function walkFiles(root, current = "") {
  const files = []
  for (const entry of readdirSync(path.join(root, current), {
    withFileTypes: true,
  })) {
    const relative = path.posix.join(current, entry.name)
    const absolute = path.join(root, relative)
    if (entry.isSymbolicLink()) {
      fail(`source contains symlink: ${relative} -> ${readlinkSync(absolute)}`)
    }
    if (entry.isDirectory()) files.push(...walkFiles(root, relative))
    else if (entry.isFile()) files.push(relative)
    else fail(`source contains unsupported entry: ${relative}`)
  }
  return files
}

function buildInventory(source) {
  const files = walkFiles(source).sort()
  const sums = files
    .map(
      (relative) => `${sha256File(path.join(source, relative))}  ./${relative}`,
    )
    .join("\n")
  return {
    files,
    sums: `${sums}\n`,
    sha256: createHash("sha256").update(`${sums}\n`).digest("hex"),
  }
}

function normalizeTimestamps(root, current = "") {
  for (const entry of readdirSync(path.join(root, current), {
    withFileTypes: true,
  })) {
    const relative = path.posix.join(current, entry.name)
    const absolute = path.join(root, relative)
    if (entry.isDirectory()) normalizeTimestamps(root, relative)
    else if (!entry.isFile()) fail(`unsupported source entry: ${relative}`)
    utimesSync(
      absolute,
      manifest.upstream.sourceDateEpoch,
      manifest.upstream.sourceDateEpoch,
    )
  }
  utimesSync(
    path.join(root, current),
    manifest.upstream.sourceDateEpoch,
    manifest.upstream.sourceDateEpoch,
  )
}

function assertReachabilityBoundary(source, files) {
  const goFiles = files.filter((entry) => entry.endsWith(".go"))
  for (const relative of goFiles) {
    const text = readFileSync(path.join(source, relative), "utf8")
    if (text.includes('"github.com/moby/go-archive"')) {
      fail(`Portainer directly imports moby/go-archive: ${relative}`)
    }
    if (/\bcomposeService\.Copy\s*\(/.test(text)) {
      fail(`Portainer calls the vulnerable Compose copy path: ${relative}`)
    }
  }
}

function assertCeOnly(source, files) {
  for (const relative of files) {
    if (
      /(?:^|\/)(?:portainer-ee|business-edition)(?:$|[._/-])/i.test(relative) ||
      /(?:^|\/)(?:license|trial)[._-]?(?:key|token)(?:$|[._-])/i.test(relative)
    ) {
      fail(`commercial or trial material present: ${relative}`)
    }
  }
  if (
    readFileSync(path.join(source, "LICENSE"), "utf8").trim() !==
    readFileSync(path.join(directory, "LICENSE.upstream"), "utf8").trim()
  ) {
    fail("upstream Zlib license text differs")
  }
}

export function assembleSource({ archive, pnpmTarball, output }) {
  if (existsSync(output)) fail("output already exists")
  for (const [file, expected, label] of [
    [archive, manifest.upstream.archiveSha256, "source archive"],
    [pnpmTarball, manifest.downstream.pnpm.tarballSha256, "pnpm tarball"],
  ]) {
    if (!existsSync(file) || !lstatSync(file).isFile())
      fail(`${label} is missing`)
    if (sha256File(file) !== expected) fail(`${label} SHA-256 differs`)
  }
  assertArchiveSafe(archive)

  mkdirSync(path.dirname(output), { recursive: true })
  const temporary = mkdtempSync(
    path.join(path.dirname(output), ".portainer-ce-assemble-"),
  )
  try {
    run("tar", ["-xzf", archive, "-C", temporary])
    const source = path.join(temporary, manifest.upstream.archiveRoot)
    const patch = path.resolve(repositoryRoot, manifest.downstream.patch.path)
    run("git", ["apply", "--check", "--whitespace=nowarn", patch], {
      cwd: source,
    })
    run("git", ["apply", "--whitespace=nowarn", patch], { cwd: source })

    if (
      sha256File(path.join(source, "go.mod")) !==
      manifest.downstream.sourceInventory.goModSha256
    ) {
      fail("patched go.mod differs")
    }
    if (
      sha256File(path.join(source, "go.sum")) !==
      manifest.downstream.sourceInventory.goSumSha256
    ) {
      fail("patched go.sum differs")
    }

    const inventory = buildInventory(source)
    if (
      inventory.files.length !==
        manifest.downstream.sourceInventory.fileCount ||
      inventory.sha256 !== manifest.downstream.sourceInventory.sha256SumsSha256
    ) {
      fail(
        `patched source inventory differs: files=${inventory.files.length} sha256=${inventory.sha256}`,
      )
    }
    assertReachabilityBoundary(source, inventory.files)
    assertCeOnly(source, inventory.files)
    normalizeTimestamps(source)

    const buildInputs = path.join(source, ".llmm-build")
    mkdirSync(buildInputs, { mode: 0o755 })
    const pnpmTarget = path.join(buildInputs, "pnpm-10.26.2.tgz")
    writeFileSync(pnpmTarget, readFileSync(pnpmTarball), { mode: 0o644 })
    writeFileSync(path.join(buildInputs, "SOURCE-SHA256SUMS"), inventory.sums, {
      mode: 0o644,
    })
    normalizeTimestamps(buildInputs)
    renameSync(source, output)
    return {
      sourceDirectory: output,
      fileCount: inventory.files.length,
      sha256SumsSha256: inventory.sha256,
      pnpmTarballSha256: sha256File(
        path.join(output, ".llmm-build/pnpm-10.26.2.tgz"),
      ),
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(
        assembleSource(parseArguments(process.argv.slice(2))),
        null,
        2,
      ),
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
