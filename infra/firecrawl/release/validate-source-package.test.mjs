import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import test from "node:test"

import {
  readSourcePackage,
  validateSourcePackage,
  verifyCheckedInSourcePackage,
} from "./validate-source-package.mjs"

const releaseRoot = import.meta.dirname

function clone(value) {
  return structuredClone(value)
}

test("checked-in Firecrawl source package passes", () => {
  assert.deepEqual(verifyCheckedInSourcePackage(), [])
})

test("source package cannot claim runtime or release admission", () => {
  const manifest = clone(readSourcePackage())
  manifest.status = "RELEASE_ADMITTED"
  manifest.runtimeQualified = true
  const errors = validateSourcePackage(manifest)
  assert.ok(errors.some((error) => error.includes("runtime-unqualified")))
  assert.ok(errors.some((error) => error.includes("runtime qualification")))
})

test("source component omissions and mutable identities fail closed", () => {
  const manifest = clone(readSourcePackage())
  manifest.upstreamComponents.pop()
  manifest.buildInputs[0].version = "latest"
  const errors = validateSourcePackage(manifest)
  assert.ok(errors.some((error) => error.includes("incomplete component set")))
  assert.ok(errors.some((error) => error.includes("mutable identity")))
})

test("local patch and lock fingerprints are mandatory", () => {
  const manifest = clone(readSourcePackage())
  manifest.patches[0].sha256 = "0".repeat(64)
  manifest.lockedFiles[0].target = "../outside"
  const errors = validateSourcePackage(manifest)
  assert.ok(errors.some((error) => error.includes("locked SHA-256")))
  assert.ok(errors.some((error) => error.includes("invalid target")))
})

test("ancillary source identity drift fails closed", () => {
  const manifest = clone(readSourcePackage())
  manifest.upstreamComponents[1].revision = "0".repeat(40)
  const errors = validateSourcePackage(manifest)
  assert.ok(errors.some((error) => error.includes("admitted source identity")))
})

test("the source assembler requires explicit input and output directories", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(releaseRoot, "assemble-source-packet.mjs")],
    { encoding: "utf8" },
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /--source-dir DIR --output-dir DIR/)
})
