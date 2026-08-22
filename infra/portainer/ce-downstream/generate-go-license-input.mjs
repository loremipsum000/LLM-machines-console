#!/usr/bin/env node

import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { gunzipSync, inflateRawSync } from "node:zlib"

import {
  readArchiveEntry,
  withDeterministicArchive,
} from "../../release/deterministic-archive.mjs"
import { inspectOciArchive } from "../../release/inspect-oci-archive.mjs"
import {
  canonicalJson,
  isCommercialPortainerIdentifier,
} from "./generate-evidence.mjs"

const directory = dirname(fileURLToPath(import.meta.url))
const defaultSourcePackagePath = join(directory, "source-package.json")
const digestPattern = /^[a-f0-9]{64}$/
const ociDigestPattern = /^sha256:[a-f0-9]{64}$/
const goSumPattern = /^h1:[A-Za-z0-9+/=]+$/
const spdxExpressionPattern = /^[A-Za-z0-9.+() -]+$/
const strictRelativePathPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const rootLegalFilePattern =
  /^(?:licen[cs]e|unlicense|copying|copyright|notice|third[_-]party[_-]notices?|authors?|contributors?|credits?|attributions?|acknowledg(?:e)?ments?|patents?)(?:[._-].*)?$/i
const sourceCodeFilePattern =
  /\.(?:c|cc|cpp|cxx|go|h|hh|hpp|hxx|java|js|jsx|mjs|py|rs|sh|ts|tsx)$/i
const unknownLicenseExpressions = new Set([
  "NONE",
  "NOASSERTION",
  "UNKNOWN",
  "UNLICENSED",
])
const maximumArchiveBytes = 512 * 1024 * 1024

export const goToolchainSource = Object.freeze({
  goVersion: "go1.25.13",
  sourceArchiveUrl: "https://go.dev/dl/go1.25.13.src.tar.gz",
  sourceArchiveBytes: 32_023_100,
  sourceArchiveSha256:
    "1d7e2f70b1ee9b93c7df8efcca71f5adcc6a59797a4336c2d10171bd4c174614",
  licenseArchiveEntry: "go/LICENSE",
  licenseBytes: 1_453,
  licenseSha256:
    "911f8f5782931320f5b8d1160a76365b83aea6447ee6c04fa6d5591467db9dad",
})

function fail(message) {
  throw new Error(message)
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex")
}

function sha256File(file) {
  return sha256Bytes(readFileSync(file))
}

function exactKeys(value, keys, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${field} must be an object`)
  }
  const actual = Object.keys(value).sort(compareText)
  const expected = [...keys].sort(compareText)
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(`${field} keys must be exactly ${expected.join(", ")}`)
  }
}

function requireRegularFile(file, field) {
  let metadata
  try {
    metadata = lstatSync(file)
  } catch {
    fail(`${field} is missing`)
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    fail(`${field} is not a single-link regular file`)
  }
  return metadata
}

function requireDirectory(root, field) {
  let metadata
  try {
    metadata = lstatSync(root)
  } catch {
    fail(`${field} is missing`)
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail(`${field} is not a directory`)
  }
}

function readJson(file, field) {
  requireRegularFile(file, field)
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    fail(`${field} is not valid JSON`)
  }
}

function requireStrictRelativePath(value, field) {
  if (
    typeof value !== "string" ||
    !strictRelativePathPattern.test(value) ||
    value.startsWith("/") ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    fail(`${field} is not a safe custody path`)
  }
}

function requireSourceRelativePath(value, field) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\0") ||
    value.includes("\n") ||
    value.includes("\r") ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    fail(`${field} is not a safe source path`)
  }
}

function normalizedIsoTimestamp(value, field) {
  const milliseconds = Date.parse(value)
  if (!Number.isInteger(milliseconds)) fail(`${field} is not an ISO timestamp`)
  return new Date(milliseconds).toISOString()
}

function assertNoCommercialIdentifiers(values, field) {
  for (const value of values.flat(Number.POSITIVE_INFINITY)) {
    if (isCommercialPortainerIdentifier(value)) {
      fail(`${field} contains commercial Portainer material`)
    }
  }
}

function portableRelative(from, to, field) {
  const result = relative(resolve(from), resolve(to)).split(sep).join("/")
  requireStrictRelativePath(result, field)
  return result
}

function readOciConfigDigest(archive, manifestDigest) {
  const manifestPath = `blobs/sha256/${manifestDigest.slice(7)}`
  let manifestBytes
  withDeterministicArchive(archive, (entry) => {
    if (entry.type === "file" && entry.path === manifestPath) {
      manifestBytes = readArchiveEntry(entry)
    }
  })
  if (!manifestBytes) fail("OCI archive lacks its selected image manifest")
  let manifest
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"))
  } catch {
    fail("OCI image manifest is not valid JSON")
  }
  if (!ociDigestPattern.test(manifest?.config?.digest ?? "")) {
    fail("OCI image manifest lacks its config digest")
  }
  return manifest.config.digest
}

function inspectArtifact(archive, field) {
  requireRegularFile(archive, field)
  const inspection = inspectOciArchive(archive)
  return {
    ociArchiveSha256: inspection.ociArchiveSha256.slice("sha256:".length),
    manifestDigest: inspection.platformDigest,
    configDigest: readOciConfigDigest(archive, inspection.platformDigest),
  }
}

function walkSourceFiles(root, current = "") {
  const files = []
  for (const entry of readdirSync(join(root, current), {
    withFileTypes: true,
  })) {
    if (
      entry.isDirectory() &&
      [".git", "dist", "node_modules"].includes(entry.name)
    ) {
      continue
    }
    if (current === "" && entry.name === ".llmm-build") continue
    if (entry.name === ".DS_Store" || entry.name.startsWith("._")) continue
    const path = current ? `${current}/${entry.name}` : entry.name
    const absolute = join(root, path)
    const metadata = lstatSync(absolute)
    if (metadata.isSymbolicLink()) fail(`source contains symlink: ${path}`)
    if (metadata.isDirectory()) files.push(...walkSourceFiles(root, path))
    else if (metadata.isFile() && metadata.nlink === 1) files.push(path)
    else fail(`source contains unsupported file: ${path}`)
  }
  return files.sort(compareText)
}

function readSourceInventory(root, sourcePackage, field) {
  requireDirectory(root, field)
  const manifestPath = join(root, ".llmm-build", "SOURCE-SHA256SUMS")
  const metadata = requireRegularFile(manifestPath, `${field} inventory`)
  const manifest = readFileSync(manifestPath)
  const manifestSha256 = sha256Bytes(manifest)
  const expected = sourcePackage.downstream.sourceInventory
  if (manifestSha256 !== expected.sha256SumsSha256) {
    fail(`${field} inventory differs from source-package.json`)
  }
  const lines = manifest.toString("utf8").trimEnd().split("\n")
  const entries = new Map()
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64}) {2}\.\/(.+)$/)
    if (!match) fail(`${field} inventory has an invalid entry`)
    requireSourceRelativePath(match[2], `${field} inventory path`)
    if (entries.has(match[2])) fail(`${field} inventory is duplicated`)
    const file = resolve(root, match[2])
    if (
      relative(root, file).split(sep).join("/") !== match[2] ||
      requireRegularFile(file, `${field} inventory file`).size < 0 ||
      sha256File(file) !== match[1]
    ) {
      fail(`${field} inventory file differs: ${match[2]}`)
    }
    entries.set(match[2], match[1])
  }
  const files = walkSourceFiles(root)
  if (
    entries.size !== expected.fileCount ||
    canonicalJson([...entries.keys()]) !== canonicalJson(files)
  ) {
    fail(`${field} inventory count or file closure differs`)
  }
  for (const [path, sha256] of [
    ["go.mod", expected.goModSha256],
    ["go.sum", expected.goSumSha256],
  ]) {
    if (entries.get(path) !== sha256) fail(`${field} ${path} differs`)
  }
  return {
    root,
    manifest,
    manifestBytes: metadata.size,
    manifestSha256,
    entries,
  }
}

function mainModulePath(source) {
  const match = readFileSync(join(source.root, "go.mod"), "utf8").match(
    /^module[ \t]+([^\s]+)[ \t]*$/m,
  )
  if (!match) fail("go.mod lacks its main module identity")
  return match[1]
}

function goSums(source) {
  const sums = new Map()
  for (const line of readFileSync(join(source.root, "go.sum"), "utf8")
    .trimEnd()
    .split("\n")) {
    const [modulePath, version, sum, extra] = line.split(" ")
    if (
      !modulePath ||
      !version ||
      !goSumPattern.test(sum ?? "") ||
      extra ||
      sums.has(`${modulePath} ${version}`)
    ) {
      fail("go.sum contains an invalid or duplicate entry")
    }
    sums.set(`${modulePath} ${version}`, sum)
  }
  return sums
}

function parseGoPurl(purl, field) {
  if (
    typeof purl !== "string" ||
    !purl.startsWith("pkg:golang/") ||
    purl.includes("?") ||
    purl.includes("#")
  ) {
    fail(`${field} is not an exact Go package URL`)
  }
  const identity = purl.slice("pkg:golang/".length)
  const separator = identity.lastIndexOf("@")
  let modulePath
  let version = null
  try {
    modulePath = decodeURIComponent(
      separator === -1 ? identity : identity.slice(0, separator),
    )
    if (separator !== -1)
      version = decodeURIComponent(identity.slice(separator + 1))
  } catch {
    fail(`${field} contains invalid percent encoding`)
  }
  if (
    !modulePath ||
    modulePath.startsWith("/") ||
    modulePath.includes("\0") ||
    modulePath
      .split("/")
      .some((part) => part === "" || part === "." || part === "..") ||
    (separator !== -1 && !version)
  ) {
    fail(`${field} has an invalid Go module identity`)
  }
  return { modulePath, version }
}

function escapeGoCacheIdentity(value) {
  let escaped = ""
  for (const character of value) {
    if (character === "!") escaped += "!!"
    else if (character >= "A" && character <= "Z") {
      escaped += `!${character.toLowerCase()}`
    } else escaped += character
  }
  return escaped
}

function safeArchiveEntry(value, field) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\0") ||
    value.includes("\n") ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    fail(`${field} is unsafe`)
  }
}

function goDirHash(entries) {
  const summary = [...entries.entries()]
    .sort(([left], [right]) => Buffer.from(left).compare(Buffer.from(right)))
    .map(([name, contents]) => `${sha256Bytes(contents)}  ${name}\n`)
    .join("")
  return `h1:${createHash("sha256").update(summary).digest("base64")}`
}

function readZipEvidence(file, requiredEntries, moduleRoot, field) {
  const archive = readFileSync(file)
  if (archive.length > maximumArchiveBytes) fail(`${field} exceeds its limit`)
  const minimum = Math.max(0, archive.length - 65_557)
  let endOffset = -1
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset
      break
    }
  }
  if (endOffset === -1) fail(`${field} lacks its ZIP directory`)
  const entryCount = archive.readUInt16LE(endOffset + 10)
  const directoryBytes = archive.readUInt32LE(endOffset + 12)
  const directoryOffset = archive.readUInt32LE(endOffset + 16)
  if (entryCount === 0xffff || directoryOffset + directoryBytes > endOffset) {
    fail(`${field} uses unsupported ZIP64 or is malformed`)
  }
  const entries = []
  const names = new Set()
  let offset = directoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > archive.length ||
      archive.readUInt32LE(offset) !== 0x02014b50
    ) {
      fail(`${field} ZIP directory differs`)
    }
    const flags = archive.readUInt16LE(offset + 8)
    const method = archive.readUInt16LE(offset + 10)
    const compressedBytes = archive.readUInt32LE(offset + 20)
    const bytes = archive.readUInt32LE(offset + 24)
    const nameBytes = archive.readUInt16LE(offset + 28)
    const extraBytes = archive.readUInt16LE(offset + 30)
    const commentBytes = archive.readUInt16LE(offset + 32)
    const localOffset = archive.readUInt32LE(offset + 42)
    const name = archive
      .subarray(offset + 46, offset + 46 + nameBytes)
      .toString("utf8")
    safeArchiveEntry(
      name.endsWith("/") ? name.slice(0, -1) : name,
      `${field} entry`,
    )
    if (
      (flags & 1) !== 0 ||
      ![0, 8].includes(method) ||
      names.has(name) ||
      !name.startsWith(moduleRoot)
    ) {
      fail(
        `${field} contains an encrypted, unsupported, duplicate, or foreign entry`,
      )
    }
    names.add(name)
    entries.push({ name, method, compressedBytes, bytes, localOffset })
    offset += 46 + nameBytes + extraBytes + commentBytes
  }
  if (offset !== directoryOffset + directoryBytes) {
    fail(`${field} ZIP directory size differs`)
  }
  const contentsByName = new Map()
  for (const entry of entries) {
    if (
      entry.localOffset + 30 > archive.length ||
      archive.readUInt32LE(entry.localOffset) !== 0x04034b50
    ) {
      fail(`${field} ZIP local entry differs: ${entry.name}`)
    }
    const localNameBytes = archive.readUInt16LE(entry.localOffset + 26)
    const localExtraBytes = archive.readUInt16LE(entry.localOffset + 28)
    const localName = archive
      .subarray(entry.localOffset + 30, entry.localOffset + 30 + localNameBytes)
      .toString("utf8")
    if (localName !== entry.name) fail(`${field} ZIP entry names differ`)
    const start = entry.localOffset + 30 + localNameBytes + localExtraBytes
    const end = start + entry.compressedBytes
    if (end > archive.length) fail(`${field} ZIP entry is truncated`)
    let contents
    try {
      const compressed = archive.subarray(start, end)
      contents =
        entry.method === 0
          ? compressed
          : inflateRawSync(compressed, {
              maxOutputLength: Math.max(1, entry.bytes),
            })
    } catch {
      fail(`${field} ZIP entry cannot be decompressed: ${entry.name}`)
    }
    if (contents.length !== entry.bytes) {
      fail(`${field} ZIP entry size differs: ${entry.name}`)
    }
    contentsByName.set(entry.name, contents)
  }
  for (const name of requiredEntries) {
    if (!contentsByName.has(name))
      fail(`${field} lacks reviewed entry: ${name}`)
  }
  const legalCandidates = entries
    .map(({ name }) => name)
    .filter((name) => {
      if (name.endsWith("/") || !name.startsWith(moduleRoot)) return false
      const path = name.slice(moduleRoot.length)
      return (
        !path.includes("/") &&
        rootLegalFilePattern.test(path) &&
        !sourceCodeFilePattern.test(path)
      )
    })
    .sort(compareText)
  return {
    archive,
    contentsByName,
    legalCandidates,
    dirHash: goDirHash(contentsByName),
  }
}

function readTarOctal(header, start, length, field) {
  const raw = header
    .subarray(start, start + length)
    .toString("ascii")
    .replace(/\0.*$/, "")
    .trim()
  if (!/^[0-7]+$/.test(raw)) fail(`${field} is not an octal TAR field`)
  return Number.parseInt(raw, 8)
}

function readToolchainEntries(file, requiredEntries, identity) {
  const compressed = readFileSync(file)
  if (
    compressed.length !== identity.sourceArchiveBytes ||
    sha256Bytes(compressed) !== identity.sourceArchiveSha256
  ) {
    fail("Go toolchain source archive differs from its locked identity")
  }
  let archive
  try {
    archive = gunzipSync(compressed, { maxOutputLength: maximumArchiveBytes })
  } catch {
    fail("Go toolchain source archive is not valid bounded gzip")
  }
  const required = new Set(requiredEntries)
  const output = new Map()
  let offset = 0
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    offset += 512
    if (header.every((byte) => byte === 0)) break
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "")
    const prefix = header
      .subarray(345, 500)
      .toString("utf8")
      .replace(/\0.*$/, "")
    const path = prefix ? `${prefix}/${name}` : name
    const size = readTarOctal(header, 124, 12, "Go source TAR entry size")
    const type = String.fromCharCode(header[156])
    if (offset + size > archive.length) fail("Go source TAR is truncated")
    if ((type === "\0" || type === "0") && required.has(path)) {
      output.set(path, archive.subarray(offset, offset + size))
    }
    offset += size + ((512 - (size % 512)) % 512)
  }
  for (const path of required) {
    if (!output.has(path))
      fail(`Go source archive lacks reviewed entry: ${path}`)
  }
  const license = output.get(identity.licenseArchiveEntry)
  if (
    license.length !== identity.licenseBytes ||
    sha256Bytes(license) !== identity.licenseSha256
  ) {
    fail("Go toolchain LICENSE differs from its locked identity")
  }
  return { compressed, entries: output }
}

function normalizeReview(file) {
  const review = readJson(file, "Go license review")
  exactKeys(review, ["schema", "components"], "Go license review")
  if (
    review.schema !== "llm-machines.portainer-ce-go-license-review.v1" ||
    !Array.isArray(review.components) ||
    review.components.length === 0
  ) {
    fail("Go license review is empty or has the wrong schema")
  }
  const components = review.components.map((component, index) => {
    const field = `Go license review component ${index + 1}`
    exactKeys(
      component,
      [
        "purl",
        "declaredExpression",
        "concludedExpression",
        "licenseFiles",
        "noticeFiles",
        "disposition",
        "reviewer",
        "reviewedAt",
        "copyleft",
        "prohibited",
      ],
      field,
    )
    parseGoPurl(component.purl, `${field} purl`)
    for (const [expression, name] of [
      [component.declaredExpression, "declared expression"],
      [component.concludedExpression, "concluded expression"],
    ]) {
      if (
        typeof expression !== "string" ||
        !spdxExpressionPattern.test(expression) ||
        unknownLicenseExpressions.has(expression.toUpperCase()) ||
        isCommercialPortainerIdentifier(expression)
      ) {
        fail(`${field} ${name} is unknown or inadmissible`)
      }
    }
    const normalizePaths = (values, name) => {
      if (!Array.isArray(values)) fail(`${field} ${name} must be an array`)
      for (const value of values) safeArchiveEntry(value, `${field} ${name}`)
      const sorted = [...new Set(values)].sort(compareText)
      if (canonicalJson(values) !== canonicalJson(sorted)) {
        fail(`${field} ${name} must be sorted and unique`)
      }
      return sorted
    }
    const licenseFiles = normalizePaths(component.licenseFiles, "license files")
    const noticeFiles = normalizePaths(component.noticeFiles, "notice files")
    if (
      licenseFiles.length === 0 ||
      new Set([...licenseFiles, ...noticeFiles]).size !==
        licenseFiles.length + noticeFiles.length ||
      typeof component.disposition !== "string" ||
      component.disposition.length === 0 ||
      typeof component.reviewer !== "string" ||
      component.reviewer.length === 0 ||
      typeof component.copyleft !== "boolean" ||
      typeof component.prohibited !== "boolean" ||
      component.prohibited
    ) {
      fail(`${field} is incomplete or prohibited`)
    }
    assertNoCommercialIdentifiers(
      [component.purl, component.disposition, component.reviewer],
      field,
    )
    return {
      ...component,
      licenseFiles,
      noticeFiles,
      reviewedAt: normalizedIsoTimestamp(
        component.reviewedAt,
        `${field} reviewedAt`,
      ),
    }
  })
  const purls = components.map(({ purl }) => purl)
  if (
    new Set(purls).size !== purls.length ||
    canonicalJson(purls) !== canonicalJson([...purls].sort(compareText))
  ) {
    fail("Go license review components must be unique and sorted by purl")
  }
  return new Map(components.map((component) => [component.purl, component]))
}

function walkCustodyFiles(root, current = "") {
  const files = []
  for (const entry of readdirSync(join(root, current), {
    withFileTypes: true,
  })) {
    const path = current ? `${current}/${entry.name}` : entry.name
    const absolute = join(root, path)
    const metadata = lstatSync(absolute)
    if (metadata.isSymbolicLink()) fail(`custody contains symlink: ${path}`)
    if (metadata.isDirectory()) files.push(...walkCustodyFiles(root, path))
    else if (metadata.isFile() && metadata.nlink === 1) files.push(path)
    else fail(`custody contains unsupported file: ${path}`)
  }
  return files.sort(compareText)
}

function custodyWriter(root) {
  const absoluteRoot = resolve(root)
  const existing = existsSync(absoluteRoot)
  if (existing) requireDirectory(absoluteRoot, "license custody root")
  else mkdirSync(dirname(absoluteRoot), { recursive: true })
  const target = existing
    ? absoluteRoot
    : mkdtempSync(join(dirname(absoluteRoot), ".license-custody-"))
  const entries = new Map()
  const add = (path, contents, field) => {
    requireStrictRelativePath(path, `${field} custody path`)
    const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents)
    const sha256 = sha256Bytes(bytes)
    const duplicate = entries.get(path)
    if (duplicate) {
      if (duplicate.bytes !== bytes.length || duplicate.sha256 !== sha256) {
        fail(`${field} conflicts with an existing custody path`)
      }
      return duplicate
    }
    const destination = join(target, path)
    mkdirSync(dirname(destination), { recursive: true })
    if (existsSync(destination)) {
      const metadata = requireRegularFile(destination, field)
      if (
        metadata.size !== bytes.length ||
        sha256File(destination) !== sha256
      ) {
        fail(`${field} differs from existing custody`)
      }
    } else {
      writeFileSync(destination, bytes, { flag: "wx", mode: 0o644 })
    }
    const identity = { bytes: bytes.length, sha256 }
    entries.set(path, identity)
    return identity
  }
  const finish = () => {
    const manifestPath = "SHA256SUMS"
    const manifest = Buffer.from(
      `${[...entries.entries()]
        .sort(([left], [right]) => compareText(left, right))
        .map(([path, { sha256 }]) => `${sha256}  ./${path}`)
        .join("\n")}\n`,
    )
    const manifestFile = join(target, manifestPath)
    if (existsSync(manifestFile)) {
      if (!readFileSync(manifestFile).equals(manifest)) {
        fail("existing license custody manifest differs")
      }
    } else writeFileSync(manifestFile, manifest, { flag: "wx", mode: 0o644 })
    const expectedFiles = [...entries.keys(), manifestPath].sort(compareText)
    if (
      canonicalJson(walkCustodyFiles(target)) !== canonicalJson(expectedFiles)
    ) {
      fail("license custody contains missing or untracked files")
    }
    if (!existing) renameSync(target, absoluteRoot)
    return {
      manifestPath,
      manifestSha256: sha256Bytes(manifest),
    }
  }
  const abort = () => {
    if (!existing) rmSync(target, { recursive: true, force: true })
  }
  return { add, finish, abort, root: absoluteRoot }
}

function legalCustodyPath(scope, identity, archiveEntry) {
  const suffix =
    basename(archiveEntry).replace(/[^A-Za-z0-9._-]/g, "_") || "LEGAL"
  return `legal/${scope}/${identity}/${sha256Bytes(archiveEntry)}-${suffix}`
}

function reviewedLicense(review, files, noticeFiles) {
  return {
    declaredExpression: review.declaredExpression,
    concludedExpression: review.concludedExpression,
    files: [...files].sort((left, right) => compareText(left.path, right.path)),
    noticeFiles: [...noticeFiles].sort((left, right) =>
      compareText(left.path, right.path),
    ),
    disposition: review.disposition,
    reviewer: review.reviewer,
    reviewedAt: review.reviewedAt,
  }
}

function sourceLicense(review, source, requiredLicense, requiredNotice) {
  for (const path of [...review.licenseFiles, ...review.noticeFiles]) {
    requireSourceRelativePath(path, "main source legal path")
    if (!source.entries.has(path))
      fail(`main source lacks reviewed legal file: ${path}`)
  }
  for (const path of requiredLicense) {
    if (!review.licenseFiles.includes(path))
      fail(`main source review lacks ${path}`)
  }
  for (const path of requiredNotice) {
    if (!review.noticeFiles.includes(path))
      fail(`main source review lacks ${path}`)
  }
  const make = (path) => {
    const file = join(source.root, path)
    return {
      path,
      bytes: requireRegularFile(file, `main source ${path}`).size,
      sha256: source.entries.get(path),
      origin: "source-inventory",
    }
  }
  return reviewedLicense(
    review,
    review.licenseFiles.map(make),
    review.noticeFiles.map(make),
  )
}

function archiveLicense(review, evidence, custody, scope, identity, origin) {
  const reviewedEntries = [...review.licenseFiles, ...review.noticeFiles]
  const reviewedSet = new Set(reviewedEntries)
  for (const entry of evidence.legalCandidates ?? []) {
    if (!reviewedSet.has(entry)) {
      fail(`license review omits root legal entry: ${entry}`)
    }
  }
  const make = (archiveEntry) => {
    const contents = evidence.entries.get(archiveEntry)
    if (!contents) fail(`license archive lacks reviewed entry: ${archiveEntry}`)
    const path = legalCustodyPath(scope, identity, archiveEntry)
    const file = custody.add(
      path,
      contents,
      `extracted legal text ${archiveEntry}`,
    )
    return {
      path,
      archiveEntry,
      bytes: file.bytes,
      sha256: file.sha256,
      origin,
    }
  }
  return reviewedLicense(
    review,
    review.licenseFiles.map(make),
    review.noticeFiles.map(make),
  )
}

function componentIdentity(component, index) {
  if (
    !component ||
    typeof component !== "object" ||
    Array.isArray(component) ||
    typeof component["bom-ref"] !== "string" ||
    component["bom-ref"].length === 0 ||
    typeof component.name !== "string" ||
    component.name.length === 0
  ) {
    fail(`SBOM component ${index + 1} lacks an exact identity`)
  }
  return {
    sbomBomRef: component["bom-ref"],
    purl: component.purl ?? null,
    name: component.name,
    version: component.version ?? null,
  }
}

function moduleSource(component, parsed, sums, moduleCache, review, custody) {
  if (!parsed.version || component.version !== parsed.version) {
    fail(`SBOM module version differs from its purl: ${component.purl}`)
  }
  if (component.name !== parsed.modulePath) {
    fail(`SBOM module name differs from its purl: ${component.purl}`)
  }
  const escapedPath = escapeGoCacheIdentity(parsed.modulePath)
  const escapedVersion = escapeGoCacheIdentity(parsed.version)
  const cacheBase = join(
    moduleCache,
    "cache",
    "download",
    ...escapedPath.split("/"),
    "@v",
    escapedVersion,
  )
  const files = Object.fromEntries(
    ["zip", "ziphash", "mod", "info"].map((extension) => {
      const file = `${cacheBase}.${extension}`
      requireRegularFile(file, `${component.purl} module ${extension}`)
      return [extension, file]
    }),
  )
  const reviewedEntries = [...review.licenseFiles, ...review.noticeFiles]
  const root = `${parsed.modulePath}@${parsed.version}/`
  const zip = readZipEvidence(files.zip, reviewedEntries, root, component.purl)
  const expectedH1 = sums.get(`${parsed.modulePath} ${parsed.version}`)
  const ziphash = readFileSync(files.ziphash, "utf8")
  if (!expectedH1 || zip.dirHash !== expectedH1 || ziphash !== expectedH1) {
    fail(`${component.purl} module zip differs from go.sum`)
  }
  const goMod = readFileSync(files.mod)
  const goModH1 = goDirHash(new Map([["go.mod", goMod]]))
  if (sums.get(`${parsed.modulePath} ${parsed.version}/go.mod`) !== goModH1) {
    fail(`${component.purl} module go.mod differs from go.sum`)
  }
  let info
  try {
    info = JSON.parse(readFileSync(files.info, "utf8"))
  } catch {
    fail(`${component.purl} module info is not valid JSON`)
  }
  if (info.Version !== parsed.version) {
    fail(`${component.purl} module info version differs`)
  }
  const identity = sha256Bytes(component.purl)
  const custodyFiles = {}
  for (const [field, extension, contents] of [
    ["archive", "zip", zip.archive],
    ["goMod", "mod", goMod],
    ["info", "info", readFileSync(files.info)],
  ]) {
    const path = `go-modules/${identity}.${extension}`
    custodyFiles[field] = {
      path,
      ...custody.add(path, contents, `${component.purl} ${extension}`),
    }
  }
  const license = archiveLicense(
    review,
    {
      entries: zip.contentsByName,
      legalCandidates: zip.legalCandidates,
    },
    custody,
    "go-modules",
    identity,
    "module-archive",
  )
  return {
    component: {
      ...componentIdentity(component, 0),
      source: {
        kind: "go-module-zip",
        archivePath: custodyFiles.archive.path,
        archiveBytes: custodyFiles.archive.bytes,
        archiveSha256: custodyFiles.archive.sha256,
        goSumH1: expectedH1,
        goModPath: custodyFiles.goMod.path,
        goModBytes: custodyFiles.goMod.bytes,
        goModSha256: custodyFiles.goMod.sha256,
        goModSumH1: goModH1,
        infoPath: custodyFiles.info.path,
        infoBytes: custodyFiles.info.bytes,
        infoSha256: custodyFiles.info.sha256,
      },
      license,
    },
    copyleft: review.copyleft,
  }
}

function toolchainComponent(
  component,
  parsed,
  sourcePackage,
  review,
  archive,
  custody,
  identity,
) {
  if (
    parsed.modulePath !== "stdlib" ||
    parsed.version !== identity.goVersion.slice("go".length) ||
    component.name !== "stdlib" ||
    component.version !== identity.goVersion ||
    review.concludedExpression !== "BSD-3-Clause" ||
    canonicalJson(review.licenseFiles) !==
      canonicalJson([identity.licenseArchiveEntry]) ||
    review.noticeFiles.length !== 0
  ) {
    fail("Go standard library review or SBOM identity differs")
  }
  const evidence = readToolchainEntries(
    archive,
    [...review.licenseFiles, ...review.noticeFiles],
    identity,
  )
  const archivePath = `go-toolchain/${identity.goVersion}.src.tar.gz`
  const archiveFile = custody.add(
    archivePath,
    evidence.compressed,
    "Go toolchain source archive",
  )
  const license = archiveLicense(
    review,
    {
      entries: evidence.entries,
      legalCandidates: [identity.licenseArchiveEntry],
    },
    custody,
    "go-toolchain",
    identity.goVersion,
    "toolchain-source-archive",
  )
  const goBuilder = sourcePackage.downstream.buildInputs.find(
    ({ id }) => id === "go-builder",
  )
  if (!ociDigestPattern.test(goBuilder?.platformDigest ?? "")) {
    fail("source-package.json lacks the exact Go builder platform digest")
  }
  return {
    component: {
      ...componentIdentity(component, 0),
      source: {
        kind: "go-toolchain-source",
        goVersion: identity.goVersion,
        builderPlatformDigest: goBuilder.platformDigest,
        sourceArchiveUrl: identity.sourceArchiveUrl,
        sourceArchivePath: archivePath,
        sourceArchiveBytes: archiveFile.bytes,
        sourceArchiveSha256: archiveFile.sha256,
        licenseArchiveEntry: identity.licenseArchiveEntry,
      },
      license,
    },
    copyleft: review.copyleft,
  }
}

function runtimeFileSha256(component) {
  const hashes = (component.hashes ?? []).filter(({ alg }) => alg === "SHA-256")
  if (hashes.length !== 1 || !digestPattern.test(hashes[0].content ?? "")) {
    fail("runtime /portainer component lacks its exact SHA-256")
  }
  return hashes[0].content
}

function writeCanonical(file, value) {
  const ordered = JSON.parse(canonicalJson(value))
  writeFileSync(file, `${JSON.stringify(ordered, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  })
}

export function generateGoLicenseInput({
  assemblyA,
  assemblyB,
  sourceA,
  sourceB,
  sbomInput,
  moduleCache,
  goSourceArchive,
  reviewInput,
  custodyRoot,
  output,
  sourcePackagePath = defaultSourcePackagePath,
  expectedToolchain = goToolchainSource,
}) {
  for (const [value, field] of [
    [assemblyA, "Assembly A"],
    [assemblyB, "Assembly B"],
    [sourceA, "source A"],
    [sourceB, "source B"],
    [sbomInput, "raw runtime SBOM"],
    [moduleCache, "Go module cache"],
    [goSourceArchive, "Go source archive"],
    [reviewInput, "Go license review"],
    [custodyRoot, "license custody root"],
    [output, "runtime license output"],
    [sourcePackagePath, "source package"],
  ]) {
    if (typeof value !== "string" || value.length === 0)
      fail(`${field} path is missing`)
  }
  const outputPath = resolve(output)
  if (existsSync(outputPath)) fail("runtime license output already exists")
  mkdirSync(dirname(outputPath), { recursive: true })
  const custodyRelative = portableRelative(
    dirname(outputPath),
    custodyRoot,
    "license custody root",
  )
  const sourcePackage = readJson(sourcePackagePath, "source-package.json")
  const repositoryRoot = resolve(dirname(sourcePackagePath), "../../..")
  const patch = resolve(repositoryRoot, sourcePackage.downstream.patch.path)
  if (sha256File(patch) !== sourcePackage.downstream.patch.sha256) {
    fail("source-package.json patch identity differs")
  }
  if (
    sourcePackage.downstream.securityOverlay.go !==
      expectedToolchain.goVersion.slice("go".length) ||
    sourcePackage.upstream.license !== "Zlib"
  ) {
    fail("source-package.json Go or Zlib identity differs")
  }
  const artifactA = inspectArtifact(assemblyA, "Assembly A OCI archive")
  const artifactB = inspectArtifact(assemblyB, "Assembly B OCI archive")
  if (canonicalJson(artifactA) !== canonicalJson(artifactB)) {
    fail("Assembly A and B OCI archives are not byte-identical")
  }
  const admittedSourceA = readSourceInventory(
    sourceA,
    sourcePackage,
    "source A",
  )
  const admittedSourceB = readSourceInventory(
    sourceB,
    sourcePackage,
    "source B",
  )
  if (
    !admittedSourceA.manifest.equals(admittedSourceB.manifest) ||
    sha256File(join(sourceA, "go.mod")) !==
      sha256File(join(sourceB, "go.mod")) ||
    sha256File(join(sourceA, "go.sum")) !== sha256File(join(sourceB, "go.sum"))
  ) {
    fail("source A and B license inputs differ")
  }
  requireDirectory(moduleCache, "Go module cache")
  const rawSbomBytes = readFileSync(sbomInput)
  const rawSbom = readJson(sbomInput, "raw runtime SBOM")
  if (
    rawSbom.bomFormat !== "CycloneDX" ||
    !Array.isArray(rawSbom.components) ||
    rawSbom.components.length === 0
  ) {
    fail("raw runtime SBOM has no CycloneDX component inventory")
  }
  const sbomRefs = rawSbom.components.map((component, index) =>
    componentIdentity(component, index),
  )
  if (
    new Set(sbomRefs.map(({ sbomBomRef }) => sbomBomRef)).size !==
    sbomRefs.length
  ) {
    fail("raw runtime SBOM has duplicate bom-refs")
  }
  const reviewByPurl = normalizeReview(reviewInput)
  const mainPath = mainModulePath(admittedSourceA)
  const sums = goSums(admittedSourceA)
  const custody = custodyWriter(custodyRoot)
  try {
    const sourceManifestPath = "source/SOURCE-SHA256SUMS"
    custody.add(
      sourceManifestPath,
      admittedSourceA.manifest,
      "main source inventory",
    )
    const results = []
    let mainResult = null
    let runtimeFile = null
    for (const [index, rawComponent] of rawSbom.components.entries()) {
      const identity = componentIdentity(rawComponent, index)
      if (identity.purl === null) {
        if (rawComponent.type !== "file" || identity.name !== "/portainer") {
          fail(`unsupported runtime SBOM component: ${identity.sbomBomRef}`)
        }
        if (runtimeFile)
          fail("runtime SBOM contains duplicate /portainer files")
        runtimeFile = rawComponent
        continue
      }
      if (rawComponent.type !== "library") {
        fail(`Go purl component is not a library: ${identity.sbomBomRef}`)
      }
      const parsed = parseGoPurl(
        identity.purl,
        `SBOM component ${identity.sbomBomRef}`,
      )
      const review = reviewByPurl.get(identity.purl)
      if (!review) fail(`Go license review lacks ${identity.purl}`)
      let result
      if (parsed.modulePath === mainPath) {
        if (
          mainResult ||
          parsed.version !== null ||
          identity.name !== mainPath
        ) {
          fail("runtime SBOM main Portainer module identity differs")
        }
        if (
          review.declaredExpression !== "Zlib" ||
          review.concludedExpression !== "Zlib" ||
          review.copyleft
        ) {
          fail("main Portainer module must retain its reviewed Zlib license")
        }
        const license = sourceLicense(
          review,
          admittedSourceA,
          ["LICENSE"],
          ["ATTRIBUTIONS.md"],
        )
        result = {
          component: {
            ...identity,
            source: {
              kind: "main-module-source",
              revision: sourcePackage.upstream.revision,
              tree: sourcePackage.upstream.tree,
              overlaySha256: sourcePackage.downstream.patch.sha256,
              sourceManifestPath,
              sourceManifestBytes: admittedSourceA.manifestBytes,
              sourceManifestSha256: admittedSourceA.manifestSha256,
              sourceFileCount: admittedSourceA.entries.size,
              goModSha256: sourcePackage.downstream.sourceInventory.goModSha256,
              goSumSha256: sourcePackage.downstream.sourceInventory.goSumSha256,
            },
            license,
          },
          copyleft: false,
        }
        mainResult = result
      } else if (parsed.modulePath === "stdlib") {
        result = toolchainComponent(
          rawComponent,
          parsed,
          sourcePackage,
          review,
          goSourceArchive,
          custody,
          expectedToolchain,
        )
      } else {
        result = moduleSource(
          rawComponent,
          parsed,
          sums,
          moduleCache,
          review,
          custody,
        )
      }
      results.push(result)
    }
    if (!mainResult || !runtimeFile) {
      fail("runtime SBOM lacks main Portainer module or /portainer file")
    }
    results.push({
      component: {
        ...componentIdentity(runtimeFile, 0),
        source: {
          kind: "runtime-artifact-file",
          artifactPath: "/portainer",
          sha256: runtimeFileSha256(runtimeFile),
        },
        license: structuredClone(mainResult.component.license),
      },
      copyleft: false,
    })
    const reviewedPurls = new Set(
      results
        .map(({ component }) => component.purl)
        .filter((purl) => purl !== null),
    )
    if (
      reviewedPurls.size !== reviewByPurl.size ||
      [...reviewByPurl.keys()].some((purl) => !reviewedPurls.has(purl))
    ) {
      fail("Go license review contains missing or extra components")
    }
    results.sort((left, right) =>
      compareText(left.component.sbomBomRef, right.component.sbomBomRef),
    )
    const refs = results.map(({ component }) => component.sbomBomRef)
    if (
      results.length !== rawSbom.components.length ||
      new Set(refs).size !== refs.length ||
      new Set(
        sbomRefs
          .map(({ sbomBomRef }) => sbomBomRef)
          .filter((ref) => !refs.includes(ref)),
      ).size !== 0
    ) {
      fail("runtime license components do not exactly cover the raw SBOM")
    }
    assertNoCommercialIdentifiers(
      results.flatMap(({ component }) => [
        component.sbomBomRef,
        component.purl,
        component.name,
        component.license.declaredExpression,
        component.license.concludedExpression,
        component.license.files.map(({ archiveEntry, path }) => [
          archiveEntry,
          path,
        ]),
      ]),
      "runtime license evidence",
    )
    const custodyIdentity = custody.finish()
    const document = {
      schema: "llm-machines.portainer-ce-runtime-license-input.v2",
      generatedAt: new Date(
        sourcePackage.upstream.sourceDateEpoch * 1000,
      ).toISOString(),
      artifact: {
        ...artifactA,
        rawSbomSha256: sha256Bytes(rawSbomBytes),
      },
      custody: {
        root: custodyRelative,
        manifestPath: custodyIdentity.manifestPath,
        manifestSha256: custodyIdentity.manifestSha256,
      },
      components: results.map(({ component }) => component),
      coverage: {
        expectedComponentCount: refs.length,
        reviewedComponentCount: refs.length,
        expectedRefsSha256: sha256Bytes(`${canonicalJson(refs)}\n`),
        missingRefs: [],
        unknownExpressions: [],
        missingRequiredTexts: [],
        copyleftRefs: results
          .filter(({ copyleft }) => copyleft)
          .map(({ component }) => component.sbomBomRef),
        prohibitedRefs: [],
        complete: true,
      },
    }
    writeCanonical(outputPath, document)
    return {
      output: outputPath,
      outputSha256: sha256File(outputPath),
      custodyManifestSha256: custodyIdentity.manifestSha256,
      componentCount: refs.length,
      expectedRefsSha256: document.coverage.expectedRefsSha256,
    }
  } catch (error) {
    custody.abort()
    throw error
  }
}

export function parseArguments(argv) {
  if (argv.length % 2 !== 0)
    fail("Go license arguments must be key/value pairs")
  const mappings = {
    "--assembly-a": "assemblyA",
    "--assembly-b": "assemblyB",
    "--source-a": "sourceA",
    "--source-b": "sourceB",
    "--sbom-input": "sbomInput",
    "--module-cache": "moduleCache",
    "--go-source-archive": "goSourceArchive",
    "--review-input": "reviewInput",
    "--custody-root": "custodyRoot",
    "--output": "output",
    "--source-package": "sourcePackagePath",
  }
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (
      !key?.startsWith("--") ||
      !value ||
      values.has(key) ||
      !(key in mappings)
    ) {
      fail("Go license arguments are invalid, unknown, or duplicated")
    }
    values.set(key, value)
  }
  const required = Object.keys(mappings).filter(
    (key) => key !== "--source-package",
  )
  if (required.some((key) => !values.has(key))) {
    fail(`expected ${required.join(" ")}`)
  }
  return Object.fromEntries(
    [...values].map(([key, value]) => [mappings[key], value]),
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = generateGoLicenseInput(parseArguments(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
