import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { writeFirecrawlEgressAllowlist } from "../pre-genesis/firecrawl-egress-allowlist.mjs"

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
  assert.match(development, /transport\.hostname = "127\.0\.0\.1"/)
  assert.match(
    development,
    /headers: \{ \.\.\.options\.headers, host: authority\.host \}/,
  )
  assert.match(development, /Readable\.toWeb\(response\)/)
  assert.match(
    development,
    /\["api\.localhost", "firecrawl\.localhost"\]\.includes/,
  )
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

test("F0-F2 renders a Squid-readable allowlist under a restrictive umask", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llmm-f0-f2r-allowlist-"))
  const previousUmask = process.umask(0o077)
  try {
    const path = await writeFirecrawlEgressAllowlist(directory, [
      "en.wikipedia.org",
      "example.com",
    ])
    assert.equal((await stat(directory)).mode & 0o777, 0o755)
    assert.equal((await stat(path)).mode & 0o777, 0o644)
    assert.equal(
      await readFile(path, "utf8"),
      "en.wikipedia.org\nexample.com\n",
    )
  } finally {
    process.umask(previousUmask)
    await rm(directory, { force: true, recursive: true })
  }
})

async function readSource(path) {
  return readFile(resolve(root, path), "utf8")
}

async function readJson(path) {
  return JSON.parse(await readSource(path))
}
