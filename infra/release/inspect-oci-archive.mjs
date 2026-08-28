import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import {
  readArchiveEntry,
  sha256ArchiveEntry,
  sha256File,
  withDeterministicArchive,
} from "./deterministic-archive.mjs"

const digestPattern = /^sha256:[a-f0-9]{64}$/
const indexMediaType = "application/vnd.oci.image.index.v1+json"
const manifestMediaType = "application/vnd.oci.image.manifest.v1+json"
const maximumMetadataBytes = 8 * 1024 * 1024
const maximumRetainedMetadataBytes = 64 * 1024 * 1024

function fail(message) {
  throw new Error(message)
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function parseJson(bytes, field) {
  try {
    return JSON.parse(bytes.toString("utf8"))
  } catch {
    fail(`${field} is not valid JSON`)
  }
}

function exactDescriptor(descriptor, field) {
  if (
    !descriptor ||
    typeof descriptor !== "object" ||
    Array.isArray(descriptor) ||
    !digestPattern.test(descriptor.digest ?? "") ||
    !Number.isInteger(descriptor.size) ||
    descriptor.size < 1
  ) {
    fail(`${field} descriptor is invalid`)
  }
}

export function inspectOciArchive(archivePath) {
  const entries = new Map()
  let retainedMetadataBytes = 0
  withDeterministicArchive(archivePath, (entry) => {
    if (entry.type !== "file") return
    if (
      (entry.path === "oci-layout" || entry.path === "index.json") &&
      entry.size > maximumMetadataBytes
    ) {
      fail(`${entry.path} exceeds the OCI metadata limit`)
    }
    const retainContents = entry.size <= maximumMetadataBytes
    if (retainContents) {
      retainedMetadataBytes += entry.size
      if (retainedMetadataBytes > maximumRetainedMetadataBytes) {
        fail("OCI archive exceeds the bounded metadata retention limit")
      }
    }
    entries.set(entry.path, {
      bytes: retainContents ? readArchiveEntry(entry) : null,
      sha256: sha256ArchiveEntry(entry),
      size: entry.size,
    })
  })
  const required = ["oci-layout", "index.json"]
  for (const path of required) {
    if (!entries.has(path)) fail(`OCI archive is missing ${path}`)
  }
  const layout = parseJson(entries.get("oci-layout").bytes, "oci-layout")
  if (
    Object.keys(layout).length !== 1 ||
    layout.imageLayoutVersion !== "1.0.0"
  ) {
    fail("OCI archive layout version is not 1.0.0")
  }

  const indexBytes = entries.get("index.json").bytes
  const index = parseJson(indexBytes, "index.json")
  if (
    index.schemaVersion !== 2 ||
    index.mediaType !== indexMediaType ||
    !Array.isArray(index.manifests) ||
    index.manifests.length !== 1
  ) {
    fail("OCI index must contain exactly one image manifest")
  }
  const manifestDescriptor = index.manifests[0]
  exactDescriptor(manifestDescriptor, "OCI image manifest")
  if (
    manifestDescriptor.mediaType !== manifestMediaType ||
    manifestDescriptor.platform?.os !== "linux" ||
    manifestDescriptor.platform?.architecture !== "amd64"
  ) {
    fail("OCI image manifest must target linux/amd64")
  }

  const referenced = new Set()
  function checkedBlob(descriptor, field, requireContents = false) {
    exactDescriptor(descriptor, field)
    const path = `blobs/sha256/${descriptor.digest.slice("sha256:".length)}`
    const entry = entries.get(path)
    if (!entry) fail(`${field} blob is missing`)
    if (entry.size !== descriptor.size || entry.sha256 !== descriptor.digest) {
      fail(`${field} blob differs from its OCI descriptor`)
    }
    if (requireContents && entry.bytes === null) {
      fail(`${field} exceeds the OCI metadata limit`)
    }
    referenced.add(path)
    return entry.bytes
  }

  const manifestBytes = checkedBlob(
    manifestDescriptor,
    "OCI image manifest",
    true,
  )
  const manifest = parseJson(manifestBytes, "OCI image manifest")
  if (
    manifest.schemaVersion !== 2 ||
    manifest.mediaType !== manifestMediaType ||
    !manifest.config ||
    manifest.config.mediaType !== "application/vnd.oci.image.config.v1+json" ||
    !Array.isArray(manifest.layers) ||
    manifest.layers.length === 0 ||
    manifest.layers.some(
      ({ mediaType }) =>
        ![
          "application/vnd.oci.image.layer.v1.tar",
          "application/vnd.oci.image.layer.v1.tar+gzip",
          "application/vnd.oci.image.layer.v1.tar+zstd",
        ].includes(mediaType),
    )
  ) {
    fail("OCI image manifest document is invalid")
  }
  const config = parseJson(
    checkedBlob(manifest.config, "OCI image config", true),
    "OCI image config",
  )
  if (
    config.architecture !== "amd64" ||
    config.os !== "linux" ||
    config.rootfs?.type !== "layers" ||
    !Array.isArray(config.rootfs?.diff_ids) ||
    config.rootfs.diff_ids.length !== manifest.layers.length ||
    config.rootfs.diff_ids.some((value) => !digestPattern.test(value))
  ) {
    fail("OCI image config must bind linux/amd64 layer identities")
  }
  for (const [index, layer] of manifest.layers.entries()) {
    checkedBlob(layer, `OCI image layer ${index}`)
  }

  const actualBlobPaths = [...entries.keys()]
    .filter((path) => path.startsWith("blobs/sha256/"))
    .sort()
  if (
    JSON.stringify(actualBlobPaths) !== JSON.stringify([...referenced].sort())
  ) {
    fail("OCI archive contains an unreferenced or omitted blob")
  }
  for (const path of entries.keys()) {
    if (
      path !== "oci-layout" &&
      path !== "index.json" &&
      !path.startsWith("blobs/sha256/")
    ) {
      fail(`OCI archive contains an unsupported file: ${path}`)
    }
  }

  return {
    ociArchiveSha256: sha256File(archivePath),
    indexDigest: digest(indexBytes),
    platform: "linux/amd64",
    platformDigest: manifestDescriptor.digest,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    fail("expected OCI archive path")
  }
  process.stdout.write(
    `${JSON.stringify(inspectOciArchive(process.argv[2]), null, 2)}\n`,
  )
}
