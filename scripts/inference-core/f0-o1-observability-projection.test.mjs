import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { test } from "node:test"

const repositoryRoot = resolve(import.meta.dirname, "../..")

test("F0-O1 remains a bounded read-only Console projection proof", async () => {
  const [decision, packageJson, browser] = await Promise.all([
    readJson(
      "docs/reduction/inference-core/f0-o1-observability-projection.json",
    ),
    readJson("package.json"),
    readSource("scripts/pre-genesis/reduced-core-browser-session.mjs"),
  ])

  assert.equal(decision.workPackage, "F0-O1")
  assert.equal(decision.accepted, false)
  assert.equal(decision.runtimeQualified, false)
  assert.equal(
    decision.evidenceClass,
    "LOCAL_BROWSER_OBSERVABILITY_PROJECTION_ONLY",
  )
  assert.match(
    packageJson.scripts["test:pre-genesis:observability"],
    /reduced-core-browser-session\.mjs --observability/,
  )
  assert.match(browser, /adminAndOperatorReadParity: "passed"/)
  assert.match(browser, /queueDepth: "not_configured"/)
  assert.match(browser, /grafanaAbsent: true/)
  assert.match(browser, /method === "GET"/)
  assert.match(browser, /\/api\/v1\/query_range/)
  assert.match(browser, /\/api\/v2\/alerts/)
  assert.match(browser, /\/user\/daily\/activity\/aggregated/)
  assert.doesNotMatch(
    browser,
    /method === "POST".*(?:prometheus|alertmanager)/s,
  )
  assert.ok(
    decision.preservedBoundaries.includes(
      "Grafana remains absent and inactive",
    ),
  )
  assert.doesNotMatch(
    browser,
    /(?:\b(?:ssh|kubectl|harbor|gitea)\b|\bvmid\s*115\b)/i,
  )
})

async function readSource(path) {
  return readFile(resolve(repositoryRoot, path), "utf8")
}

async function readJson(path) {
  return JSON.parse(await readSource(path))
}
