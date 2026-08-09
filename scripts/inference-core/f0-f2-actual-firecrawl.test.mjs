import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")

test("F0-F2 binds the reviewed reduced Firecrawl source to the Product flow", async () => {
  const [evidence, harness, development, fixture, sourcePackage, profile] =
    await Promise.all([
      readJson("docs/reduction/inference-core/f0-f2-actual-firecrawl.json"),
      readSource("scripts/pre-genesis/reduced-core-firecrawl-integration.mjs"),
      readSource("scripts/pre-genesis/reduced-core-dev.mjs"),
      readSource("scripts/pre-genesis/reduced-core-bff-fixture.mts"),
      readJson("infra/firecrawl/release/source-package.json"),
      readSource("infra/firecrawl/compose.yaml"),
    ])

  assert.equal(evidence.workPackage, "F0-F2")
  assert.equal(evidence.baseCommit, "6220fbec6b6b2609f603e1ff3fc37af33f0fd704")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(
    evidence.command,
    "corepack pnpm --filter @llm-machines/contracts --fail-if-no-match build && corepack pnpm --filter @llm-machines/copy --fail-if-no-match build && node scripts/pre-genesis/reduced-core-firecrawl-integration.mjs",
  )
  assert.match(harness, /assemble-source-packet\.mjs/)
  assert.match(harness, /--platform[\s\S]*linux\/amd64/)
  assert.match(harness, /exactPlatformImageByVersion\("22\.23\.2-bookworm"\)/)
  assert.match(
    harness,
    /exactPlatformImageByVersion\("22\.23\.2-bookworm-slim"\)/,
  )
  assert.match(harness, /exactPlatformImage\("searxng-runtime-source"\)/)
  assert.match(harness, /exactPlatformImage\("squid-runtime-source"\)/)
  assert.match(harness, /--firecrawl-actual-slice/)
  assert.match(development, /LOCAL_ACTUAL_REDUCED_FIRECRAWL_INTEGRATION_ONLY/)
  assert.match(fixture, /requested\.origin !== "http:\/\/firecrawl-api:3002"/)
  assert.match(fixture, /lookup\(hostname, \{ all: true, verbatim: true \}\)/)
  assert.match(profile, /profiles:\n {4}- firecrawl/)
  assert.doesNotMatch(profile, /^ {4}ports:/m)
  assert.deepEqual(sourcePackage.productBoundary.routes, [
    "POST /v2/search",
    "POST /v2/scrape",
  ])
})

test("F0-F2 remains isolated, zero-retention, and non-qualifying", async () => {
  const [evidence, harness] = await Promise.all([
    readJson("docs/reduction/inference-core/f0-f2-actual-firecrawl.json"),
    readSource("scripts/pre-genesis/reduced-core-firecrawl-integration.mjs"),
  ])

  assert.ok(evidence.command.endsWith("reduced-core-firecrawl-integration.mjs"))
  assert.match(harness, /--vz-rosetta/)
  assert.match(harness, /--activate=false/)
  assert.match(harness, /--ssh-config=false/)
  assert.match(harness, /deniedUnapprovedHost: true/)
  assert.match(harness, /workloadContentCanaries: 0/)
  assert.match(harness, /delete[\s\S]*--data[\s\S]*--force/)
  assert.match(harness, /down[\s\S]*--remove-orphans/)
  assert.doesNotMatch(harness, /CHARACTERIZATION_CACHE|colima-llmm-f0-f2-r2/)
  assert.doesNotMatch(harness, /(?:Harbor|Gitea|VM103|signing key)/i)
  assert.ok(
    evidence.notEvidenceFor.includes(
      "release packaging, signing, deployment, backup, restore, or Q0",
    ),
  )
  assert.equal(
    evidence.nextPackage,
    "F0-C1 integrated reduced-Core disposable startup",
  )
})

async function readSource(path) {
  return readFile(resolve(root, path), "utf8")
}

async function readJson(path) {
  return JSON.parse(await readSource(path))
}
