#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  readSourcePackage,
  sha256File,
  validateSourcePackage,
} from "./validate-source-package.mjs"

const releaseRoot = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(releaseRoot, "../../..")

function fail(message) {
  throw new Error(message)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  })
  if (result.status !== 0) {
    fail(`${command} failed: ${result.stderr.trim() || result.stdout.trim()}`)
  }
  return result.stdout
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith("--") || !value) {
      fail(
        "usage: assemble-source-packet.mjs --source-dir DIR --output-dir DIR",
      )
    }
    values.set(name, value)
  }
  const sourceDir = values.get("--source-dir")
  const outputDir = values.get("--output-dir")
  if (!sourceDir || !outputDir || values.size !== 2) {
    fail("usage: assemble-source-packet.mjs --source-dir DIR --output-dir DIR")
  }
  return {
    sourceDir: path.resolve(sourceDir),
    outputDir: path.resolve(outputDir),
  }
}

function assertArchiveNamesSafe(archive) {
  const entries = run("tar", ["-tzf", archive]).split(/\r?\n/).filter(Boolean)
  if (entries.length === 0) fail(`${path.basename(archive)} is empty`)
  for (const entry of entries) {
    if (
      path.posix.isAbsolute(entry) ||
      entry.split("/").some((segment) => segment === "..")
    ) {
      fail(`${path.basename(archive)} contains an unsafe path`)
    }
  }
}

function walkFiles(root, relative = "") {
  const directory = path.join(root, relative)
  const entries = readdirSync(directory).sort()
  const files = []
  for (const name of entries) {
    const childRelative = path.posix.join(relative, name)
    const child = path.join(root, childRelative)
    const stat = lstatSync(child)
    if (stat.isDirectory()) {
      files.push(...walkFiles(root, childRelative))
    } else if (stat.isFile() || stat.isSymbolicLink()) {
      files.push(childRelative)
    } else {
      fail(`${childRelative} is not a regular source-packet entry`)
    }
  }
  return files
}

function assertTreeSafe(root) {
  const rootReal = realpathSync(root)
  for (const relative of walkFiles(root)) {
    const file = path.join(root, relative)
    if (!lstatSync(file).isSymbolicLink()) continue
    const target = path.resolve(path.dirname(file), readlinkSync(file))
    if (target !== rootReal && !target.startsWith(`${rootReal}${path.sep}`)) {
      fail(`${relative} is an external symbolic link`)
    }
  }
}

function copyLockedFile(source, destination) {
  mkdirSync(path.dirname(destination), { recursive: true })
  cpSync(source, destination)
}

function packetSha256(file) {
  const stat = lstatSync(file)
  if (stat.isSymbolicLink()) {
    return createHash("sha256")
      .update(`symlink:${readlinkSync(file)}`)
      .digest("hex")
  }
  return sha256File(file)
}

export function assembleSourcePacket(
  { sourceDir, outputDir },
  root = repositoryRoot,
) {
  const manifest = readSourcePackage(root)
  const errors = validateSourcePackage(manifest, root)
  if (errors.length > 0) fail(errors.join("\n"))
  if (existsSync(outputDir)) fail("output directory already exists")
  if (!lstatSync(sourceDir).isDirectory())
    fail("source directory is not a directory")

  const workspace = mkdtempSync(path.join(tmpdir(), "llmm-firecrawl-source-"))
  try {
    const archives = new Map()
    for (const component of manifest.upstreamComponents) {
      const archive = path.join(sourceDir, component.archiveFile)
      if (!existsSync(archive) || !lstatSync(archive).isFile()) {
        fail(`${component.archiveFile} is missing`)
      }
      if (sha256File(archive) !== component.archiveSha256) {
        fail(`${component.archiveFile} differs from its locked SHA-256`)
      }
      assertArchiveNamesSafe(archive)
      archives.set(component.id, archive)
    }

    const extracted = path.join(workspace, "extracted")
    mkdirSync(extracted)
    run("tar", ["-xzf", archives.get("firecrawl"), "-C", extracted])
    const sourceRoot = path.join(
      extracted,
      `firecrawl-${manifest.upstreamComponents[0].revision}`,
    )
    if (!existsSync(sourceRoot) || !lstatSync(sourceRoot).isDirectory()) {
      fail("Firecrawl archive has an unexpected root")
    }
    assertTreeSafe(sourceRoot)

    for (const patch of manifest.patches) {
      const patchFile = path.resolve(root, patch.path)
      run("git", ["apply", "--check", patchFile], { cwd: sourceRoot })
      run("git", ["apply", patchFile], { cwd: sourceRoot })
    }
    for (const locked of manifest.lockedFiles) {
      copyLockedFile(
        path.resolve(root, locked.path),
        path.join(sourceRoot, locked.target),
      )
    }

    mkdirSync(outputDir, { recursive: false })
    const upstreamDir = path.join(outputDir, "upstream")
    const patchesDir = path.join(outputDir, "patches")
    const locksDir = path.join(outputDir, "locks")
    const productDir = path.join(outputDir, "product")
    mkdirSync(upstreamDir)
    mkdirSync(patchesDir)
    mkdirSync(locksDir)
    mkdirSync(productDir)

    for (const component of manifest.upstreamComponents) {
      cpSync(
        archives.get(component.id),
        path.join(upstreamDir, component.archiveFile),
      )
    }
    for (const entry of manifest.patches) {
      cpSync(
        path.resolve(root, entry.path),
        path.join(patchesDir, path.basename(entry.path)),
      )
    }
    for (const entry of manifest.lockedFiles) {
      cpSync(
        path.resolve(root, entry.path),
        path.join(locksDir, path.basename(entry.path)),
      )
    }
    for (const relative of [
      "infra/firecrawl/release/source-package.json",
      "infra/firecrawl/THIRD_PARTY_NOTICES.md",
      "infra/firecrawl/compose.yaml",
      "infra/firecrawl/egress/squid.conf",
      "infra/firecrawl/searxng/settings.yml",
    ]) {
      cpSync(
        path.resolve(root, relative),
        path.join(productDir, path.basename(relative)),
      )
    }
    cpSync(sourceRoot, path.join(outputDir, "patched-firecrawl"), {
      recursive: true,
      verbatimSymlinks: true,
    })

    writeFileSync(
      path.join(outputDir, "README.txt"),
      [
        "LLM Machines Firecrawl corresponding-source packet",
        "",
        "This credential-free packet binds Firecrawl v2.11.0 and the exact",
        "ancillary source, ordered patches, build locks, and Product profile",
        "used for the reduced search and static-scrape images.",
        "Runtime qualification, image admission, and signatures are separate.",
        "",
      ].join("\n"),
    )

    const sums = walkFiles(outputDir)
      .filter((relative) => relative !== "SHA256SUMS")
      .map(
        (relative) =>
          `${packetSha256(path.join(outputDir, relative))}  ${relative}`,
      )
      .join("\n")
    writeFileSync(path.join(outputDir, "SHA256SUMS"), `${sums}\n`)
    assertTreeSafe(outputDir)
  } catch (error) {
    if (existsSync(outputDir))
      rmSync(outputDir, { recursive: true, force: true })
    throw error
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    assembleSourcePacket(parseArguments(process.argv.slice(2)))
    console.log("Firecrawl corresponding-source packet assembled.")
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
