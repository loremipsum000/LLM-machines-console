import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  constants,
  closeSync,
  copyFileSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  rmSync,
  writeSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, relative, resolve, sep } from "node:path"

const blockSize = 512
const copyBufferSize = 1024 * 1024
const safePathPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*\/?$/
const zstdVersion = "1.5.7"

function fail(message) {
  throw new Error(message)
}

function portablePath(path) {
  return path.split(sep).join("/")
}

function validatePath(path, field = "archive entry") {
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path
  if (
    !safePathPattern.test(path) ||
    path.startsWith("/") ||
    normalized.length === 0 ||
    normalized
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    fail(`unsafe ${field} path: ${path}`)
  }
}

function compareBytes(left, right) {
  return Buffer.from(left).compare(Buffer.from(right))
}

function writeString(buffer, offset, length, value, field) {
  const bytes = Buffer.from(value, "utf8")
  if (bytes.length > length) fail(`${field} exceeds the USTAR field limit`)
  bytes.copy(buffer, offset)
}

function writeOctal(buffer, offset, length, value, field) {
  const encoded = value.toString(8).padStart(length - 1, "0")
  if (encoded.length > length - 1)
    fail(`${field} exceeds the USTAR field limit`)
  writeString(buffer, offset, length - 1, encoded, field)
  buffer[offset + length - 1] = 0
}

function splitUstarPath(path) {
  const directory = path.endsWith("/")
  const value = directory ? path.slice(0, -1) : path
  if (Buffer.byteLength(value) <= 100) {
    return { name: directory ? `${value}/` : value, prefix: "" }
  }
  for (
    let index = value.lastIndexOf("/");
    index > 0;
    index = value.lastIndexOf("/", index - 1)
  ) {
    const prefix = value.slice(0, index)
    const name = `${value.slice(index + 1)}${directory ? "/" : ""}`
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix }
    }
  }
  fail(`archive path exceeds the USTAR limit: ${path}`)
}

function createHeader(entry, sourceDateEpoch) {
  const buffer = Buffer.alloc(blockSize)
  const { name, prefix } = splitUstarPath(entry.path)
  writeString(buffer, 0, 100, name, "path")
  writeOctal(buffer, 100, 8, entry.type === "directory" ? 0o755 : 0o644, "mode")
  writeOctal(buffer, 108, 8, 0, "uid")
  writeOctal(buffer, 116, 8, 0, "gid")
  writeOctal(buffer, 124, 12, entry.type === "file" ? entry.size : 0, "size")
  writeOctal(buffer, 136, 12, sourceDateEpoch, "mtime")
  buffer.fill(0x20, 148, 156)
  buffer[156] = entry.type === "directory" ? 0x35 : 0x30
  writeString(buffer, 257, 6, "ustar\0", "magic")
  writeString(buffer, 263, 2, "00", "version")
  writeString(buffer, 265, 32, "root", "owner")
  writeString(buffer, 297, 32, "root", "group")
  writeString(buffer, 345, 155, prefix, "prefix")
  const checksum = buffer.reduce((sum, byte) => sum + byte, 0)
  const encodedChecksum = checksum.toString(8).padStart(6, "0")
  writeString(buffer, 148, 6, encodedChecksum, "checksum")
  buffer[154] = 0
  buffer[155] = 0x20
  return buffer
}

function listEntries(root, current = root) {
  const entries = []
  for (const directoryEntry of readdirSync(current, { withFileTypes: true })) {
    const absolutePath = resolve(current, directoryEntry.name)
    const path = portablePath(relative(root, absolutePath))
    validatePath(path)
    if (directoryEntry.isSymbolicLink())
      fail(`symbolic links are forbidden: ${path}`)
    if (directoryEntry.isDirectory()) {
      entries.push({
        path: `${path}/`,
        absolutePath,
        type: "directory",
        size: 0,
      })
      entries.push(...listEntries(root, absolutePath))
      continue
    }
    if (!directoryEntry.isFile()) fail(`non-regular archive input: ${path}`)
    const metadata = lstatSync(absolutePath)
    if (metadata.nlink !== 1) fail(`hard-linked archive input: ${path}`)
    entries.push({ path, absolutePath, type: "file", size: metadata.size })
  }
  return entries.sort((left, right) => compareBytes(left.path, right.path))
}

function copyFileToDescriptor(path, outputDescriptor) {
  const inputDescriptor = openSync(path, constants.O_RDONLY)
  const buffer = Buffer.allocUnsafe(copyBufferSize)
  try {
    while (true) {
      const bytesRead = readSync(
        inputDescriptor,
        buffer,
        0,
        buffer.length,
        null,
      )
      if (bytesRead === 0) break
      writeSync(outputDescriptor, buffer, 0, bytesRead)
    }
  } finally {
    closeSync(inputDescriptor)
  }
}

function assertedZstd() {
  const output = execFileSync("zstd", ["--version"], { encoding: "utf8" })
  if (
    !new RegExp(`\\bv${zstdVersion.replaceAll(".", "\\.")}\\b`).test(output)
  ) {
    fail(`zstd ${zstdVersion} is required for deterministic assembly`)
  }
}

export function assembleDeterministicArchive({
  inputRoot,
  outputPath,
  sourceDateEpoch,
}) {
  if (!Number.isInteger(sourceDateEpoch) || sourceDateEpoch < 1) {
    fail("sourceDateEpoch must be a positive integer")
  }
  const root = resolve(inputRoot)
  const output = resolve(outputPath)
  const outputRelative = relative(root, output)
  if (
    outputRelative === "" ||
    (!outputRelative.startsWith(`..${sep}`) && outputRelative !== "..")
  ) {
    fail("archive output must remain outside its input root")
  }
  if (existsSync(output)) fail("archive output already exists")
  assertedZstd()
  const entries = listEntries(root)
  if (entries.length === 0) fail("archive input must not be empty")
  const workspace = mkdtempSync(resolve(tmpdir(), "llmm-release-archive-"))
  const tarPath = resolve(workspace, "payload.tar")
  const compressedPath = resolve(workspace, "payload.tar.zst")
  const descriptor = openSync(
    tarPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  )
  try {
    for (const entry of entries) {
      writeSync(descriptor, createHeader(entry, sourceDateEpoch))
      if (entry.type === "file") {
        copyFileToDescriptor(entry.absolutePath, descriptor)
        const padding = (blockSize - (entry.size % blockSize)) % blockSize
        if (padding > 0) writeSync(descriptor, Buffer.alloc(padding))
      }
    }
    writeSync(descriptor, Buffer.alloc(blockSize * 2))
  } finally {
    closeSync(descriptor)
  }
  try {
    execFileSync(
      "zstd",
      [
        "-19",
        "--threads=1",
        "--no-progress",
        "--no-check",
        "-o",
        compressedPath,
        tarPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    )
    mkdirSync(dirname(output), { recursive: true })
    copyFileSync(compressedPath, output, constants.COPYFILE_EXCL)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
  return {
    entries: entries.map(({ path, size, type }) => ({ path, size, type })),
    sha256: sha256File(output),
    size: lstatSync(output).size,
    zstdVersion,
  }
}

function readField(buffer, start, length) {
  return buffer
    .subarray(start, start + length)
    .toString("utf8")
    .replace(/\0.*$/, "")
    .trim()
}

function readOctal(buffer, start, length, field) {
  const value = readField(buffer, start, length)
  if (!/^[0-7]+$/.test(value)) fail(`invalid USTAR ${field}`)
  return Number.parseInt(value, 8)
}

function isZeroBlock(buffer) {
  return buffer.every((byte) => byte === 0)
}

export function withDeterministicArchive(archivePath, visitor) {
  assertedZstd()
  const workspace = mkdtempSync(resolve(tmpdir(), "llmm-release-read-"))
  const tarPath = resolve(workspace, "payload.tar")
  try {
    execFileSync(
      "zstd",
      ["-d", "--no-progress", "-o", tarPath, resolve(archivePath)],
      {
        stdio: ["ignore", "ignore", "pipe"],
      },
    )
    const descriptor = openSync(tarPath, constants.O_RDONLY)
    const fileSize = fstatSync(descriptor).size
    const seen = new Set()
    let offset = 0
    let zeroBlocks = 0
    try {
      while (offset < fileSize) {
        const header = Buffer.alloc(blockSize)
        if (readSync(descriptor, header, 0, blockSize, offset) !== blockSize) {
          fail("truncated USTAR header")
        }
        offset += blockSize
        if (isZeroBlock(header)) {
          zeroBlocks += 1
          if (zeroBlocks === 2) break
          continue
        }
        if (zeroBlocks !== 0) fail("non-terminal USTAR zero block")
        const checksum = readOctal(header, 148, 8, "checksum")
        const checksumHeader = Buffer.from(header)
        checksumHeader.fill(0x20, 148, 156)
        if (checksumHeader.reduce((sum, byte) => sum + byte, 0) !== checksum) {
          fail("USTAR checksum mismatch")
        }
        if (header.subarray(257, 263).toString("utf8") !== "ustar\0") {
          fail("unsupported archive format")
        }
        const name = readField(header, 0, 100)
        const prefix = readField(header, 345, 155)
        const path = prefix ? `${prefix}/${name}` : name
        validatePath(path)
        if (seen.has(path)) fail(`duplicate archive entry: ${path}`)
        seen.add(path)
        const typeFlag = String.fromCharCode(header[156])
        const type =
          typeFlag === "5"
            ? "directory"
            : typeFlag === "0"
              ? "file"
              : fail(`unsupported archive entry type: ${typeFlag}`)
        const size = readOctal(header, 124, 12, "size")
        const mode = readOctal(header, 100, 8, "mode")
        const uid = readOctal(header, 108, 8, "uid")
        const gid = readOctal(header, 116, 8, "gid")
        const mtime = readOctal(header, 136, 12, "mtime")
        if (
          uid !== 0 ||
          gid !== 0 ||
          (type === "file" ? mode !== 0o644 : mode !== 0o755) ||
          (type === "directory"
            ? size !== 0 || !path.endsWith("/")
            : path.endsWith("/"))
        ) {
          fail(`non-normalized archive entry: ${path}`)
        }
        visitor({ descriptor, offset, path, size, type, mtime })
        offset += size + ((blockSize - (size % blockSize)) % blockSize)
      }
    } finally {
      closeSync(descriptor)
    }
    if (zeroBlocks !== 2 || offset !== fileSize)
      fail("archive has missing or trailing data")
    return [...seen].sort(compareBytes)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}

export function copyArchiveEntry({ descriptor, offset, size }, outputPath) {
  const output = openSync(
    outputPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  )
  const buffer = Buffer.allocUnsafe(copyBufferSize)
  let remaining = size
  let position = offset
  try {
    while (remaining > 0) {
      const length = Math.min(buffer.length, remaining)
      const bytesRead = readSync(descriptor, buffer, 0, length, position)
      if (bytesRead !== length) fail("truncated archive entry")
      writeSync(output, buffer, 0, bytesRead)
      remaining -= bytesRead
      position += bytesRead
    }
  } finally {
    closeSync(output)
  }
}

export function sha256File(path) {
  const hash = createHash("sha256")
  const descriptor = openSync(path, constants.O_RDONLY)
  const buffer = Buffer.allocUnsafe(copyBufferSize)
  try {
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    closeSync(descriptor)
  }
  return `sha256:${hash.digest("hex")}`
}

export { zstdVersion }
