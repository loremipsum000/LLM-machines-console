import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { test } from "node:test"

const repositoryRoot = resolve(import.meta.dirname, "../..")

test("F0-L1 remains a deterministic Application-flow proof", async () => {
  const [decision, source] = await Promise.all([
    readJson("docs/reduction/inference-core/f0-l1-application-inference.json"),
    readFile(
      resolve(repositoryRoot, "scripts/pre-genesis/reduced-core-dev.mjs"),
      "utf8",
    ),
  ])

  assert.equal(decision.workPackage, "F0-L1")
  assert.equal(decision.accepted, false)
  assert.equal(decision.runtimeQualified, false)
  assert.equal(
    decision.evidenceClass,
    "LOCAL_DETERMINISTIC_APPLICATION_FLOW_ONLY",
  )
  assert.equal(
    decision.command,
    "node scripts/pre-genesis/reduced-core-dev.mjs --vertical-slice",
  )
  assert.equal(decision.dataPlane.publicAuthority, "api.localhost")
  assert.deepEqual(decision.dataPlane.routes, ["POST /v1/chat/completions"])
  assert.ok(decision.proved.includes("usage and last-use accounting"))
  assert.ok(decision.notEvidenceFor.includes("SGLang runtime or capacity"))
  assert.match(source, /--vertical-slice/)
  assert.match(source, /\/v1\/chat\/completions/)
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
