import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { requiredCoreImageIds } from "../validate-image-lock.mjs"
import { compareAssemblies } from "./compare-assemblies.mjs"

function inventory(digest = `sha256:${"a".repeat(64)}`) {
  return {
    schema: "llm-machines.vm103-l1b-assembly-inventory.v1",
    status: "UNSIGNED_UNQUALIFIED",
    release: {
      sourceCommit: "1".repeat(40),
      sourceTree: "2".repeat(40),
      version: "v1.0.0-rc.1",
    },
    platform: "linux/amd64",
    toolchainLockSha256: "3".repeat(64),
    trivyDatabase: {
      updatedAt: "2026-08-17T00:00:00Z",
      digest: "4".repeat(64),
    },
    images: requiredCoreImageIds.map((id, index) => ({
      id,
      ociArchivePath: `images/${id}.oci.tar.zst`,
      ociArchiveSha256: index === 0 ? digest : `sha256:${"b".repeat(64)}`,
      bytes: 1,
      indexDigest: `sha256:${"c".repeat(64)}`,
      platform: "linux/amd64",
      platformDigest: `sha256:${"d".repeat(64)}`,
      rawSbomSha256: "e".repeat(64),
      rawVulnerabilityReportSha256: "f".repeat(64),
    })),
  }
}

function write(root, name, value) {
  const path = join(root, name)
  writeFileSync(path, `${JSON.stringify(value)}\n`)
  return path
}

test("identical complete assemblies pass", () => {
  const root = mkdtempSync(join(tmpdir(), "llmm-l1b-compare-"))
  const first = write(root, "a.json", inventory())
  const second = write(root, "b.json", inventory())
  assert.equal(
    compareAssemblies(first, second).status,
    "BYTE_IDENTICAL_IMAGE_SET",
  )
})

test("one image digest drift fails closed", () => {
  const root = mkdtempSync(join(tmpdir(), "llmm-l1b-drift-"))
  const first = write(root, "a.json", inventory())
  const second = write(root, "b.json", inventory(`sha256:${"0".repeat(64)}`))
  assert.throws(() => compareAssemblies(first, second), /product-edge/)
})

test("fresh scan observations may differ when image artifacts are identical", () => {
  const root = mkdtempSync(join(tmpdir(), "llmm-l1b-observation-"))
  const firstValue = inventory()
  const secondValue = inventory()
  secondValue.trivyDatabase.updatedAt = "2026-08-17T01:00:00Z"
  secondValue.images[0].rawSbomSha256 = "0".repeat(64)
  const first = write(root, "a.json", firstValue)
  const second = write(root, "b.json", secondValue)
  const result = compareAssemblies(first, second)
  assert.equal(result.status, "BYTE_IDENTICAL_IMAGE_SET")
  assert.notEqual(result.firstInventorySha256, result.secondInventorySha256)
})

test("mutable or malformed image digests fail closed", () => {
  const root = mkdtempSync(join(tmpdir(), "llmm-l1b-invalid-"))
  const value = inventory()
  value.images[0].ociArchiveSha256 = "latest"
  const first = write(root, "a.json", value)
  const second = write(root, "b.json", value)
  assert.throws(
    () => compareAssemblies(first, second),
    /image digests are invalid/,
  )
})
