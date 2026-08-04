import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  readSourcePackage,
  validateSourcePackage,
  verifyCheckedInSourcePackage,
} from "./validate-source-package.mjs"
import { validateReproducibilityEvidence } from "./verify-source-packet-reproducibility.mjs"

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

test("checked-in two-run reproducibility evidence is exact and unqualified", () => {
  const evidence = JSON.parse(
    readFileSync(
      path.join(releaseRoot, "reproducibility-evidence.json"),
      "utf8",
    ),
  )
  assert.deepEqual(validateReproducibilityEvidence(evidence), [])

  const tampered = clone(evidence)
  tampered.packetSha256 = "0".repeat(64)
  tampered.productBoundary.defaultEnabled = true
  assert.notDeepEqual(validateReproducibilityEvidence(tampered), [])
})

test("the reproducibility verifier requires explicit input and output", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(releaseRoot, "verify-source-packet-reproducibility.mjs")],
    { encoding: "utf8" },
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /--source-dir DIR --output PATH/)
})

test("the reproducibility verifier rejects archive-input drift", () => {
  const sourceDir = mkdtempSync(
    path.join(tmpdir(), "llmm-firecrawl-input-test-"),
  )
  const output = path.join(
    tmpdir(),
    `llmm-firecrawl-evidence-${process.pid}.json`,
  )
  try {
    writeFileSync(path.join(sourceDir, "unexpected.tar.gz"), "not an archive")
    const result = spawnSync(
      process.execPath,
      [
        path.join(releaseRoot, "verify-source-packet-reproducibility.mjs"),
        "--source-dir",
        sourceDir,
        "--output",
        output,
      ],
      { encoding: "utf8" },
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /exactly the locked upstream archives/)
  } finally {
    rmSync(sourceDir, { recursive: true, force: true })
    rmSync(output, { force: true })
  }
})

test("the reproducibility verifier keeps evidence outside archive inputs", () => {
  const sourceDir = mkdtempSync(
    path.join(tmpdir(), "llmm-firecrawl-input-test-"),
  )
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(releaseRoot, "verify-source-packet-reproducibility.mjs"),
        "--source-dir",
        sourceDir,
        "--output",
        path.join(sourceDir, "evidence.json"),
      ],
      { encoding: "utf8" },
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /outside the archive source directory/)
  } finally {
    rmSync(sourceDir, { recursive: true, force: true })
  }
})
