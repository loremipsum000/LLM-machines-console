import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { test } from "node:test"

const repositoryRoot = resolve(import.meta.dirname, "../..")

test("F0-W1 remains a deterministic Firecrawl Application-flow proof", async () => {
  const [decision, harness, fixture] = await Promise.all([
    readJson("docs/reduction/inference-core/f0-w1-firecrawl-application.json"),
    readFile(
      resolve(repositoryRoot, "scripts/pre-genesis/reduced-core-dev.mjs"),
      "utf8",
    ),
    readFile(
      resolve(
        repositoryRoot,
        "scripts/pre-genesis/reduced-core-bff-fixture.mts",
      ),
      "utf8",
    ),
  ])

  assert.equal(decision.workPackage, "F0-W1")
  assert.equal(decision.accepted, false)
  assert.equal(decision.runtimeQualified, false)
  assert.equal(
    decision.evidenceClass,
    "LOCAL_DETERMINISTIC_FIRECRAWL_APPLICATION_FLOW_ONLY",
  )
  assert.equal(
    decision.command,
    "node scripts/pre-genesis/reduced-core-dev.mjs --firecrawl-slice",
  )
  assert.equal(decision.dataPlane.publicAuthority, "firecrawl.localhost")
  assert.deepEqual(decision.dataPlane.routes, [
    "POST /v2/search",
    "POST /v2/scrape",
  ])
  assert.ok(decision.proved.includes("Firecrawl default-off Application state"))
  assert.ok(
    decision.notEvidenceFor.includes(
      "real Firecrawl service behavior or external web access",
    ),
  )
  assert.match(harness, /--firecrawl-slice/)
  assert.match(
    harness,
    /FIRECRAWL_UPSTREAM_BASE_URL: "http:\/\/firecrawl-api:3002"/,
  )
  assert.match(fixture, /NODE_ENV !== "test"/)
  assert.match(fixture, /BFF_FIXTURE_MODE !== "true"/)
  assert.match(fixture, /requested\.origin !== "http:\/\/firecrawl-api:3002"/)
  assert.doesNotMatch(harness, /(?:docker|ssh|kubectl|harbor|gitea)/i)
  assert.doesNotMatch(fixture, /(?:docker|ssh|kubectl|harbor|gitea)/i)
  assert.doesNotMatch(harness, /\.\.\.process\.env/)
  assert.doesNotMatch(fixture, /\.\.\.process\.env/)
})

async function readJson(path) {
  return JSON.parse(
    await readFile(
      path.startsWith("/") ? path : resolve(repositoryRoot, path),
      "utf8",
    ),
  )
}
