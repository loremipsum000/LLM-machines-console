#!/usr/bin/env node

import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { assembleSourcePacket } from "./assemble-source-packet.mjs"
import {
  readSourcePackage,
  sha256File,
  validateSourcePackage,
} from "./validate-source-package.mjs"

const releaseRoot = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(releaseRoot, "../../..")
const digestPattern = /^[a-f0-9]{64}$/

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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function assertExactArchiveInputs(sourceDir, manifest) {
  const expected = manifest.upstreamComponents
    .map(({ archiveFile }) => archiveFile)
    .sort()
  const entries = readdirSync(sourceDir, { withFileTypes: true }).sort(
    (left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)),
  )
  const actual = entries.map(({ name }) => name)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail("source directory must contain exactly the locked upstream archives")
  }
  for (const entry of entries) {
    const file = path.join(sourceDir, entry.name)
    if (!entry.isFile() || lstatSync(file).nlink !== 1) {
      fail(`${entry.name} must be a single-link regular archive`)
    }
  }
}

function packetEntrySha256(file) {
  const stat = lstatSync(file)
  if (stat.isSymbolicLink()) {
    return sha256(`symlink:${readlinkSync(file)}`)
  }
  if (!stat.isFile()) fail(`${file} is not a regular packet entry`)
  return sha256File(file)
}

function walkPacket(root, relative = "") {
  const directory = path.join(root, relative)
  const entries = readdirSync(directory).sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  )
  const files = []
  for (const name of entries) {
    const childRelative = path.posix.join(relative, name)
    const child = path.join(root, childRelative)
    const stat = lstatSync(child)
    if (stat.isDirectory()) {
      files.push(...walkPacket(root, childRelative))
    } else if (stat.isFile() || stat.isSymbolicLink()) {
      files.push(childRelative)
    } else {
      fail(`${childRelative} is not a regular packet entry`)
    }
  }
  return files
}

function inspectPacket(root) {
  const paths = walkPacket(root)
  const sumsPath = path.join(root, "SHA256SUMS")
  if (!paths.includes("SHA256SUMS")) fail("packet omits SHA256SUMS")
  const sumsSource = readFileSync(sumsPath, "utf8")
  const declared = new Map()
  for (const line of sumsSource.trimEnd().split("\n")) {
    const match = /^([a-f0-9]{64}) {2}([^\r\n]+)$/.exec(line)
    if (!match) fail("SHA256SUMS contains an invalid entry")
    const [, digest, relativePath] = match
    if (
      path.posix.isAbsolute(relativePath) ||
      relativePath
        .split("/")
        .some(
          (segment) => segment === "" || segment === "." || segment === "..",
        )
    ) {
      fail(`SHA256SUMS contains an unsafe path: ${relativePath}`)
    }
    if (declared.has(relativePath)) {
      fail(`SHA256SUMS contains a duplicate path: ${relativePath}`)
    }
    declared.set(relativePath, digest)
  }
  const contentPaths = paths.filter(
    (relativePath) => relativePath !== "SHA256SUMS",
  )
  if (declared.size !== contentPaths.length) {
    fail("SHA256SUMS does not cover the exact packet inventory")
  }
  for (const relativePath of contentPaths) {
    const actual = packetEntrySha256(path.join(root, relativePath))
    if (declared.get(relativePath) !== actual) {
      fail(`SHA256SUMS differs for ${relativePath}`)
    }
  }
  const inventory = paths.map((relativePath) => ({
    path: relativePath,
    sha256: packetEntrySha256(path.join(root, relativePath)),
    type: lstatSync(path.join(root, relativePath)).isSymbolicLink()
      ? "symlink"
      : "file",
  }))
  const inventorySource = JSON.stringify(inventory)
  const sha256SumsSha256 = sha256File(sumsPath)
  return {
    inventory,
    fileCount: inventory.length,
    symlinkCount: inventory.filter(({ type }) => type === "symlink").length,
    inventorySha256: sha256(inventorySource),
    sha256SumsSha256,
    packetSha256: sha256(`${inventorySource}\n${sha256SumsSha256}\n`),
    sumsSource,
  }
}

export function verifySourcePacketReproducibility(
  { sourceDir },
  root = repositoryRoot,
) {
  if (!sourceDir) fail("sourceDir is required")
  const manifest = readSourcePackage(root)
  const sourceErrors = validateSourcePackage(manifest, root)
  if (sourceErrors.length > 0) fail(sourceErrors.join("\n"))
  const resolvedSourceDir = path.resolve(sourceDir)
  if (
    !existsSync(resolvedSourceDir) ||
    !lstatSync(resolvedSourceDir).isDirectory()
  ) {
    fail("source directory is not a directory")
  }
  assertExactArchiveInputs(resolvedSourceDir, manifest)

  const workspace = mkdtempSync(
    path.join(tmpdir(), "llmm-firecrawl-reproducibility-"),
  )
  let first
  let second
  try {
    const firstPath = path.join(workspace, "packet-a")
    const secondPath = path.join(workspace, "packet-b")
    assembleSourcePacket(
      { sourceDir: resolvedSourceDir, outputDir: firstPath },
      root,
    )
    assembleSourcePacket(
      { sourceDir: resolvedSourceDir, outputDir: secondPath },
      root,
    )
    first = inspectPacket(firstPath)
    second = inspectPacket(secondPath)
    if (
      JSON.stringify(first.inventory) !== JSON.stringify(second.inventory) ||
      first.sumsSource !== second.sumsSource ||
      first.packetSha256 !== second.packetSha256
    ) {
      fail("Firecrawl source-packet assemblies are not reproducible")
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
  if (existsSync(workspace)) fail("reproducibility workspace cleanup failed")

  return {
    schema: "llm-machines.firecrawl-source-reproducibility.v1",
    status: "SOURCE_PACKET_REPRODUCIBLE_RUNTIME_UNQUALIFIED",
    containsCredentials: false,
    runtimeQualified: false,
    runs: 2,
    sourcePackageSha256: sha256File(
      path.join(root, "infra/firecrawl/release/source-package.json"),
    ),
    upstreamArchives: manifest.upstreamComponents.map(
      ({ id, archiveFile, archiveSha256 }) => ({
        id,
        archiveFile,
        archiveSha256,
      }),
    ),
    patchesApplied: manifest.patches.map(
      ({ order, path: patchPath, sha256 }) => ({
        order,
        path: patchPath,
        sha256,
      }),
    ),
    fileCount: first.fileCount,
    symlinkCount: first.symlinkCount,
    inventorySha256: first.inventorySha256,
    sha256SumsSha256: first.sha256SumsSha256,
    packetSha256: first.packetSha256,
    workspaceCleanupVerified: true,
    productBoundary: manifest.productBoundary,
  }
}

export function validateReproducibilityEvidence(
  evidence,
  root = repositoryRoot,
) {
  const errors = []
  try {
    exactKeys(
      evidence,
      [
        "schema",
        "status",
        "containsCredentials",
        "runtimeQualified",
        "runs",
        "sourcePackageSha256",
        "upstreamArchives",
        "patchesApplied",
        "fileCount",
        "symlinkCount",
        "inventorySha256",
        "sha256SumsSha256",
        "packetSha256",
        "workspaceCleanupVerified",
        "productBoundary",
      ],
      "Firecrawl reproducibility evidence",
    )
  } catch (error) {
    errors.push(error.message)
  }
  const manifest = readSourcePackage(root)
  if (
    evidence?.schema !== "llm-machines.firecrawl-source-reproducibility.v1" ||
    evidence?.status !== "SOURCE_PACKET_REPRODUCIBLE_RUNTIME_UNQUALIFIED" ||
    evidence?.containsCredentials !== false ||
    evidence?.runtimeQualified !== false ||
    evidence?.runs !== 2 ||
    evidence?.workspaceCleanupVerified !== true
  ) {
    errors.push(
      "Firecrawl reproducibility evidence overstates or omits its boundary",
    )
  }
  if (
    evidence?.sourcePackageSha256 !==
    sha256File(path.join(root, "infra/firecrawl/release/source-package.json"))
  ) {
    errors.push("Firecrawl reproducibility evidence source package differs")
  }
  const expectedArchives = manifest.upstreamComponents.map(
    ({ id, archiveFile, archiveSha256 }) => ({
      id,
      archiveFile,
      archiveSha256,
    }),
  )
  const expectedPatches = manifest.patches.map(
    ({ order, path: patchPath, sha256 }) => ({
      order,
      path: patchPath,
      sha256,
    }),
  )
  if (
    JSON.stringify(evidence?.upstreamArchives) !==
    JSON.stringify(expectedArchives)
  ) {
    errors.push("Firecrawl reproducibility evidence archive identities differ")
  }
  if (
    JSON.stringify(evidence?.patchesApplied) !== JSON.stringify(expectedPatches)
  ) {
    errors.push("Firecrawl reproducibility evidence patch identities differ")
  }
  if (!Number.isInteger(evidence?.fileCount) || evidence.fileCount < 1) {
    errors.push("Firecrawl reproducibility evidence file count is invalid")
  }
  if (!Number.isInteger(evidence?.symlinkCount) || evidence.symlinkCount < 0) {
    errors.push("Firecrawl reproducibility evidence symlink count is invalid")
  }
  for (const field of ["inventorySha256", "sha256SumsSha256", "packetSha256"]) {
    if (!digestPattern.test(evidence?.[field] ?? "")) {
      errors.push(`Firecrawl reproducibility evidence ${field} is invalid`)
    }
  }
  if (
    JSON.stringify(evidence?.productBoundary) !==
    JSON.stringify(manifest.productBoundary)
  ) {
    errors.push("Firecrawl reproducibility evidence product boundary differs")
  }
  return errors
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith("--") || !value) {
      fail(
        "usage: verify-source-packet-reproducibility.mjs --source-dir DIR --output PATH",
      )
    }
    values.set(name, value)
  }
  if (
    values.size !== 2 ||
    !values.has("--source-dir") ||
    !values.has("--output")
  ) {
    fail(
      "usage: verify-source-packet-reproducibility.mjs --source-dir DIR --output PATH",
    )
  }
  return {
    sourceDir: path.resolve(values.get("--source-dir")),
    output: path.resolve(values.get("--output")),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const arguments_ = parseArguments(process.argv.slice(2))
    if (existsSync(arguments_.output)) fail("evidence output already exists")
    const relativeOutput = path.relative(
      arguments_.sourceDir,
      arguments_.output,
    )
    if (
      relativeOutput === "" ||
      (!relativeOutput.startsWith(`..${path.sep}`) && relativeOutput !== "..")
    ) {
      fail("evidence output must be outside the archive source directory")
    }
    const evidence = verifySourcePacketReproducibility({
      sourceDir: arguments_.sourceDir,
    })
    writeFileSync(arguments_.output, canonicalJson(evidence), { flag: "wx" })
    console.log("Firecrawl corresponding-source reproducibility verified.")
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
