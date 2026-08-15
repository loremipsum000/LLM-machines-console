import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")

test("F0-F2R binds the narrow native-Linux Firecrawl correction", async () => {
  const [evidence, allowlist, development, integration] = await Promise.all([
    readJson(
      "docs/reduction/inference-core/f0-f2r-firecrawl-linux-runtime.json",
    ),
    readSource("scripts/pre-genesis/firecrawl-egress-allowlist.mjs"),
    readSource("scripts/pre-genesis/reduced-core-dev.mjs"),
    readSource("scripts/pre-genesis/reduced-core-firecrawl-integration.mjs"),
  ])

  assert.equal(evidence.workPackage, "F0-F2R")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.runtimeEvidence.status, "passed")
  assert.equal(evidence.runtimeEvidence.restrictiveUmask, "0077")
  assert.equal(evidence.runtimeEvidence.retention.workloadContentCanaries, 0)
  assert.equal(evidence.correction.egressExpanded, false)
  assert.equal(evidence.correction.newCredential, false)
  assert.deepEqual(evidence.correction.allowedHosts, [
    "en.wikipedia.org",
    "example.com",
  ])
  assert.match(allowlist, /await chmod\(directory, 0o755\)/)
  assert.match(allowlist, /await chmod\(path, 0o644\)/)
  assert.match(
    integration,
    /const allowedHosts = \["en\.wikipedia\.org", "example\.com"\]/,
  )
  assert.match(development, /transport\.hostname = "127\.0\.0\.1"/)
  assert.match(development, /Readable\.toWeb\(response\)/)
  assert.match(
    development,
    /\["api\.localhost", "firecrawl\.localhost"\]\.includes/,
  )
})

test("F0-F2R preserves historical F0-F2 evidence byte-for-byte", async () => {
  const evidence = await readJson(
    "docs/reduction/inference-core/f0-f2r-firecrawl-linux-runtime.json",
  )
  const historical = await readSource(evidence.historicalEvidence.path)
  assert.equal(
    createHash("sha256").update(historical).digest("hex"),
    evidence.historicalEvidence.sha256,
  )
  assert.equal(evidence.historicalEvidence.rewritten, false)
})

async function readSource(path) {
  return readFile(resolve(root, path), "utf8")
}

async function readJson(path) {
  return JSON.parse(await readSource(path))
}
