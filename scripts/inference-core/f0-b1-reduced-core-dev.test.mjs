import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { test } from "node:test"

const repositoryRoot = resolve(import.meta.dirname, "../..")

test("F0-B1 remains a local deterministic, non-production lane", async () => {
  const [decision, source] = await Promise.all([
    readJson("docs/reduction/inference-core/f0-b1-reduced-core-bootstrap.json"),
    readFile(
      resolve(repositoryRoot, "scripts/pre-genesis/reduced-core-dev.mjs"),
      "utf8",
    ),
  ])

  assert.equal(decision.workPackage, "F0-B1")
  assert.equal(decision.accepted, false)
  assert.equal(decision.runtimeQualified, false)
  assert.equal(decision.evidenceClass, "LOCAL_DETERMINISTIC_CONTROL_PLANE_ONLY")
  assert.deepEqual(decision.publicAuthoritySimulation, [
    "console.localhost",
    "api.localhost",
    "identity.localhost",
    "firecrawl.localhost",
  ])
  assert.ok(decision.notEvidenceFor.includes("SGLang-runtime-or-capacity"))
  assert.equal(
    decision.command,
    "node scripts/pre-genesis/reduced-core-dev.mjs",
  )
  assert.doesNotMatch(source, /NODE_ENV:\s*"production"/)
  assert.doesNotMatch(source, /(?:docker|ssh|kubectl|harbor|gitea)/i)
  assert.doesNotMatch(source, /\.\.\.process\.env/)
})

async function readJson(path) {
  return JSON.parse(
    await readFile(
      path.startsWith("/") ? path : resolve(repositoryRoot, path),
      "utf8",
    ),
  )
}
