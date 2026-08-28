#!/usr/bin/env node

import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assembleDeterministicArchive } from "../deterministic-archive.mjs"
import { inspectOciArchive } from "../inspect-oci-archive.mjs"

const digestPattern = /^sha256:[a-f0-9]{64}$/
const indexMediaType = "application/vnd.oci.image.index.v1+json"
const manifestMediaType = "application/vnd.oci.image.manifest.v1+json"

function fail(message) {
  throw new Error(message)
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function readJson(path, field) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    fail(`${field} is not valid JSON`)
  }
}

function requireBlob(root, descriptor, field) {
  if (
    descriptor?.mediaType === undefined ||
    !digestPattern.test(descriptor?.digest ?? "") ||
    !Number.isInteger(descriptor?.size) ||
    descriptor.size < 1
  ) {
    fail(`${field} descriptor is invalid`)
  }
  const path = join(root, "blobs", "sha256", descriptor.digest.slice(7))
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    fail(`${field} blob is missing`)
  }
  const contents = readFileSync(path)
  if (
    contents.length !== descriptor.size ||
    sha256(contents) !== descriptor.digest
  ) {
    fail(`${field} blob differs from its descriptor`)
  }
  return contents
}

function validateTree(root) {
  const allowedRoot = new Set(["blobs", "index.json", "oci-layout"])
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!allowedRoot.has(entry.name))
      fail(`unsupported OCI root entry: ${entry.name}`)
    if (entry.isSymbolicLink())
      fail(`symbolic link is forbidden: ${entry.name}`)
  }
  const algorithmRoot = join(root, "blobs")
  const algorithms = readdirSync(algorithmRoot, { withFileTypes: true })
  if (
    algorithms.length !== 1 ||
    algorithms[0].name !== "sha256" ||
    !algorithms[0].isDirectory()
  ) {
    fail("OCI blobs must use exactly the sha256 algorithm directory")
  }
  for (const entry of readdirSync(join(algorithmRoot, "sha256"), {
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !/^[a-f0-9]{64}$/.test(entry.name)) {
      fail(`unsupported OCI blob entry: ${entry.name}`)
    }
  }
}

export function normalizeOciLayout({ inputRoot, outputPath, sourceDateEpoch }) {
  const root = resolve(inputRoot)
  const output = resolve(outputPath)
  if (!lstatSync(root).isDirectory()) fail("OCI input root is not a directory")
  if (existsSync(output)) fail("normalized OCI output already exists")
  validateTree(root)

  const layout = readJson(join(root, "oci-layout"), "OCI layout")
  if (
    Object.keys(layout).length !== 1 ||
    layout.imageLayoutVersion !== "1.0.0"
  ) {
    fail("OCI layout version is not exactly 1.0.0")
  }
  const index = readJson(join(root, "index.json"), "OCI index")
  const candidates = Array.isArray(index?.manifests)
    ? index.manifests.filter(
        (entry) =>
          entry?.platform?.os === "linux" &&
          entry?.platform?.architecture === "amd64",
      )
    : []
  if (candidates.length !== 1) {
    fail("OCI input must contain exactly one linux/amd64 manifest")
  }
  const descriptor = candidates[0]
  if (descriptor.mediaType !== manifestMediaType) {
    fail("OCI input manifest must use the OCI image manifest media type")
  }
  const manifestBytes = requireBlob(root, descriptor, "image manifest")
  const manifest = JSON.parse(manifestBytes)
  if (
    manifest?.schemaVersion !== 2 ||
    manifest?.mediaType !== manifestMediaType ||
    !manifest?.config ||
    !Array.isArray(manifest?.layers) ||
    manifest.layers.length === 0
  ) {
    fail("OCI image manifest is invalid")
  }
  const config = JSON.parse(requireBlob(root, manifest.config, "image config"))
  if (config?.os !== "linux" || config?.architecture !== "amd64") {
    fail("OCI image config is not linux/amd64")
  }
  for (const [index_, layer] of manifest.layers.entries()) {
    requireBlob(root, layer, `image layer ${index_}`)
  }

  const canonicalIndex = {
    schemaVersion: 2,
    mediaType: indexMediaType,
    manifests: [
      {
        mediaType: manifestMediaType,
        digest: descriptor.digest,
        size: descriptor.size,
        platform: { architecture: "amd64", os: "linux" },
      },
    ],
  }
  writeFileSync(
    join(root, "index.json"),
    `${canonicalJson(canonicalIndex)}\n`,
    {
      mode: 0o644,
    },
  )
  const archive = assembleDeterministicArchive({
    inputRoot: root,
    outputPath: output,
    sourceDateEpoch,
  })
  return { ...archive, ...inspectOciArchive(output) }
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    values.set(argv[index], argv[index + 1])
  }
  if (
    values.size !== 3 ||
    !values.get("--input-root") ||
    !values.get("--output") ||
    !values.get("--source-date-epoch")
  ) {
    fail("expected --input-root DIR --output FILE --source-date-epoch INTEGER")
  }
  return {
    inputRoot: values.get("--input-root"),
    outputPath: values.get("--output"),
    sourceDateEpoch: Number.parseInt(values.get("--source-date-epoch"), 10),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = normalizeOciLayout(parseArguments(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
