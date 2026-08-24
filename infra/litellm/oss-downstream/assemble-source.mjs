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
import { stripEnterpriseBridges } from "./strip-enterprise-bridges.mjs"
import { validateSidebarFunctionalCandidate } from "./validate-sidebar-functional-candidate.mjs"
import { validateSourcePackage } from "./validate-source-package.mjs"

const directory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(directory, "../../..")
const manifest = JSON.parse(
  readFileSync(path.resolve(directory, "source-package.json"), "utf8"),
)

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
    throw new Error(
      `${command} failed: ${result.stderr || result.stdout || result.status}`,
    )
  }
  return result.stdout
}

function parseArgs(args) {
  const values = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith("--") || !value) {
      throw new Error(
        "expected --archive PATH --output PATH [--packet PATH] [--candidate PATH]",
      )
    }
    values[key.slice(2)] = value
  }
  if (!values.archive || !values.output) {
    throw new Error("--archive and --output are required")
  }
  return values
}

function validateArchiveEntries(archive) {
  const entries = run("tar", ["-tzf", archive]).split(/\r?\n/).filter(Boolean)
  const root = manifest.upstream.archiveRoot
  if (entries.length === 0) throw new Error("upstream archive is empty")
  for (const entry of entries) {
    const normalized = path.posix.normalize(entry)
    if (
      entry.startsWith("/") ||
      normalized === ".." ||
      normalized.startsWith("../") ||
      (normalized !== root && !normalized.startsWith(`${root}/`))
    ) {
      throw new Error(`unsafe or unexpected archive entry: ${entry}`)
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
      throw new Error(
        `sanitized source contains symlink: ${relative} -> ${readlinkSync(absolute)}`,
      )
    }
    if (entry.isDirectory()) files.push(...walkFiles(root, relative))
    else if (entry.isFile()) files.push(relative)
    else
      throw new Error(
        `sanitized source contains unsupported entry: ${relative}`,
      )
  }
  return files
}

function buildInventory(source) {
  const files = walkFiles(source).sort()
  const sums = files
    .map(
      (relative) => `${sha256File(path.join(source, relative))}  ${relative}`,
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
    else if (!entry.isFile())
      throw new Error(
        `sanitized source contains unsupported entry: ${relative}`,
      )
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

function requireRemovalTarget(target, relative) {
  try {
    lstatSync(target)
  } catch {
    throw new Error(`expected removal path is missing: ${relative}`)
  }
}

export function assembleSource({ archive, output, packet, candidate }) {
  const errors = validateSourcePackage(manifest, repositoryRoot)
  if (errors.length > 0) throw new Error(errors.join("\n"))
  let functionalCandidate = null
  if (candidate) {
    const candidatePath = path.resolve(candidate)
    const expectedPath = path.resolve(
      directory,
      "sidebar-functional-candidate.json",
    )
    if (candidatePath !== expectedPath) {
      throw new Error(
        "functional candidate path is not the checked-in contract",
      )
    }
    functionalCandidate = JSON.parse(readFileSync(candidatePath, "utf8"))
    const candidateErrors = validateSidebarFunctionalCandidate(
      functionalCandidate,
      manifest,
      repositoryRoot,
    )
    if (candidateErrors.length > 0) {
      throw new Error(candidateErrors.join("\n"))
    }
  }
  const archivePath = path.resolve(archive)
  const outputPath = path.resolve(output)
  if (!lstatSync(archivePath).isFile()) throw new Error("archive is not a file")
  if (existsSync(outputPath)) throw new Error("output already exists")
  if (sha256File(archivePath) !== manifest.upstream.archiveSha256) {
    throw new Error("upstream archive SHA-256 differs")
  }
  validateArchiveEntries(archivePath)

  mkdirSync(path.dirname(outputPath), { recursive: true })
  const temporary = mkdtempSync(
    path.join(path.dirname(outputPath), ".litellm-oss-assemble-"),
  )
  try {
    run("tar", ["-xzf", archivePath, "-C", temporary])
    const source = path.join(temporary, manifest.upstream.archiveRoot)
    const patch = path.resolve(repositoryRoot, manifest.downstream.patch.path)
    run("git", ["apply", "--check", "--whitespace=nowarn", patch], {
      cwd: source,
    })
    run("git", ["apply", "--whitespace=nowarn", patch], { cwd: source })

    for (const relative of manifest.downstream.removedPaths) {
      if (
        path.isAbsolute(relative) ||
        relative.split("/").some((part) => part === "..")
      ) {
        throw new Error(`unsafe removal path: ${relative}`)
      }
      const target = path.join(source, relative)
      requireRemovalTarget(target, relative)
      rmSync(target, { recursive: true })
    }
    stripEnterpriseBridges(source)
    if (functionalCandidate) {
      const overlay = path.resolve(
        repositoryRoot,
        functionalCandidate.overlay.path,
      )
      run(
        "git",
        ["apply", "--check", "--unidiff-zero", "--whitespace=nowarn", overlay],
        {
          cwd: source,
        },
      )
      run("git", ["apply", "--unidiff-zero", "--whitespace=nowarn", overlay], {
        cwd: source,
      })
    }

    const sourceName = "litellm-oss-1.96.2"
    const prepared = path.join(temporary, sourceName)
    renameSync(source, prepared)
    normalizeTimestamps(prepared)
    const inventory = buildInventory(prepared)
    const expectedInventory =
      functionalCandidate?.sourceInventory ??
      manifest.downstream.sourceInventory
    if (
      inventory.files.length !== expectedInventory.fileCount ||
      inventory.sha256 !== expectedInventory.sha256SumsSha256
    ) {
      throw new Error(
        `sanitized source inventory differs: files=${inventory.files.length}, sha256=${inventory.sha256}`,
      )
    }
    for (const relative of inventory.files) {
      if (/(?:^|\/)(?:enterprise|commercial)(?:$|[._/-])/i.test(relative)) {
        throw new Error(`enterprise path survived sanitization: ${relative}`)
      }
    }
    const stagedOutput = path.join(temporary, "output")
    mkdirSync(stagedOutput)
    renameSync(prepared, path.join(stagedOutput, sourceName))
    writeFileSync(path.join(stagedOutput, "SHA256SUMS"), inventory.sums, {
      mode: 0o644,
    })
    const inventoryDocument = `${JSON.stringify(
      {
        schema: "llm-machines.litellm-oss-source-inventory.v1",
        upstreamRevision: manifest.upstream.revision,
        patchSha256: manifest.downstream.patch.sha256,
        ...(functionalCandidate
          ? {
              overlayPatchSha256: functionalCandidate.overlay.sha256,
              version: functionalCandidate.version,
            }
          : {}),
        fileCount: inventory.files.length,
        sha256SumsSha256: inventory.sha256,
      },
      null,
      2,
    )}\n`
    if (
      functionalCandidate &&
      createHash("sha256").update(inventoryDocument).digest("hex") !==
        functionalCandidate.sourceInventory.inventoryDocumentSha256
    ) {
      throw new Error("functional candidate inventory document differs")
    }
    writeFileSync(
      path.join(stagedOutput, "source-inventory.json"),
      inventoryDocument,
      { mode: 0o644 },
    )
    let packetSha256 = null
    let stagedPacket = null
    if (packet) {
      const packetPath = path.resolve(packet)
      if (existsSync(packetPath)) throw new Error("packet already exists")
      const tarVersion = run("tar", ["--version"])
      if (!tarVersion.includes("GNU tar")) {
        throw new Error("deterministic packet creation requires GNU tar")
      }
      stagedPacket = path.join(temporary, "litellm-oss-1.96.2.tar")
      run("tar", [
        "--sort=name",
        `--mtime=@${manifest.upstream.sourceDateEpoch}`,
        "--owner=0",
        "--group=0",
        "--numeric-owner",
        "--pax-option=delete=atime,delete=ctime",
        "-cf",
        stagedPacket,
        "-C",
        stagedOutput,
        sourceName,
        "SHA256SUMS",
        "source-inventory.json",
      ])
      packetSha256 = sha256File(stagedPacket)
    }
    renameSync(stagedOutput, outputPath)
    if (stagedPacket) renameSync(stagedPacket, path.resolve(packet))
    return {
      sourceDirectory: path.join(outputPath, sourceName),
      fileCount: inventory.files.length,
      sha256SumsSha256: inventory.sha256,
      packetSha256,
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = assembleSource(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
}
