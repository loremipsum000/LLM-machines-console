import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { removeEmptyBuildkitIngest } from "./run-admission-build.mjs"

test("BuildKit OCI output without ingest state is unchanged", () => {
  const root = mkdtempSync(join(tmpdir(), "llmm-portainer-oci-"))
  try {
    assert.equal(removeEmptyBuildkitIngest(root), false)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test("only an empty BuildKit ingest directory is removed", () => {
  const root = mkdtempSync(join(tmpdir(), "llmm-portainer-oci-"))
  try {
    mkdirSync(join(root, "ingest"))
    assert.equal(removeEmptyBuildkitIngest(root), true)
    assert.equal(removeEmptyBuildkitIngest(root), false)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test("nonempty or non-directory BuildKit ingest state fails closed", () => {
  for (const kind of ["file", "nonempty-directory"]) {
    const root = mkdtempSync(join(tmpdir(), "llmm-portainer-oci-"))
    try {
      if (kind === "file") {
        writeFileSync(join(root, "ingest"), "unexpected")
      } else {
        mkdirSync(join(root, "ingest"))
        writeFileSync(join(root, "ingest", "residue"), "unexpected")
      }
      assert.throws(
        () => removeEmptyBuildkitIngest(root),
        /BuildKit OCI ingest state is not an empty directory/,
      )
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  }
})
