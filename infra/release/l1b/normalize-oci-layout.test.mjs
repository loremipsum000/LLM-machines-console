import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { normalizeOciLayout } from "./normalize-oci-layout.mjs"

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function writeBlob(root, bytes) {
  const value = digest(bytes)
  writeFileSync(join(root, "blobs", "sha256", value.slice(7)), bytes)
  return { digest: value, size: bytes.length }
}

function fixture(root) {
  mkdirSync(join(root, "blobs", "sha256"), { recursive: true })
  writeFileSync(join(root, "oci-layout"), '{"imageLayoutVersion":"1.0.0"}\n')
  const layer = writeBlob(root, Buffer.from("layer"))
  const config = Buffer.from(
    JSON.stringify({
      architecture: "amd64",
      os: "linux",
      rootfs: { type: "layers", diff_ids: [digest(Buffer.from("diff"))] },
    }),
  )
  const configDescriptor = {
    mediaType: "application/vnd.oci.image.config.v1+json",
    ...writeBlob(root, config),
  }
  const manifest = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      config: configDescriptor,
      layers: [
        { mediaType: "application/vnd.oci.image.layer.v1.tar", ...layer },
      ],
    }),
  )
  const manifestDescriptor = {
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    ...writeBlob(root, manifest),
    platform: { os: "linux", architecture: "amd64" },
    annotations: { "org.opencontainers.image.ref.name": "must-be-removed" },
  }
  writeFileSync(
    join(root, "index.json"),
    JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.index.v1+json",
      manifests: [manifestDescriptor],
      annotations: { volatile: "removed" },
    }),
  )
}

test("normalization removes volatile index material and is byte-reproducible", () => {
  const workspace = mkdtempSync(join(tmpdir(), "llmm-l1b-normalize-"))
  const firstRoot = join(workspace, "first")
  const secondRoot = join(workspace, "second")
  fixture(firstRoot)
  fixture(secondRoot)
  const firstOutput = join(workspace, "first.tar.zst")
  const secondOutput = join(workspace, "second.tar.zst")
  const first = normalizeOciLayout({
    inputRoot: firstRoot,
    outputPath: firstOutput,
    sourceDateEpoch: 1_700_000_000,
  })
  const second = normalizeOciLayout({
    inputRoot: secondRoot,
    outputPath: secondOutput,
    sourceDateEpoch: 1_700_000_000,
  })
  assert.equal(first.sha256, second.sha256)
  assert.deepEqual(readFileSync(firstOutput), readFileSync(secondOutput))
  assert.equal(first.platform, "linux/amd64")
})

test("normalization rejects an ambiguous platform", () => {
  const workspace = mkdtempSync(join(tmpdir(), "llmm-l1b-ambiguous-"))
  fixture(workspace)
  const indexPath = join(workspace, "index.json")
  const index = JSON.parse(readFileSync(indexPath, "utf8"))
  index.manifests.push(index.manifests[0])
  writeFileSync(indexPath, JSON.stringify(index))
  assert.throws(
    () =>
      normalizeOciLayout({
        inputRoot: workspace,
        outputPath: join(tmpdir(), `ambiguous-${Date.now()}.tar.zst`),
        sourceDateEpoch: 1_700_000_000,
      }),
    /exactly one linux\/amd64/,
  )
})
