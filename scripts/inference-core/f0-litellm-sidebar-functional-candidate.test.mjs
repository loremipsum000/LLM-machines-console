import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { validateSidebarFunctionalCandidate } from "../../infra/litellm/oss-downstream/validate-sidebar-functional-candidate.mjs"

const root = path.resolve(import.meta.dirname, "../..")
const candidate = readJson(
  "infra/litellm/oss-downstream/sidebar-functional-candidate.json",
)
const sourcePackage = readJson(
  "infra/litellm/oss-downstream/source-package.json",
)
const edge = readText("infra/ingress/product-edge.nginx.conf.template")

test("LiteLLM sidebar candidate is reproducible without changing the admitted release image", () => {
  assert.deepEqual(
    validateSidebarFunctionalCandidate(candidate, sourcePackage, root),
    [],
  )
  assert.equal(sourcePackage.downstream.version, "v1.96.2-llmm.1")
  assert.equal(candidate.version, "v1.96.2-llmm.2")
  assert.equal(candidate.releaseAdmitted, false)
  assert.equal(candidate.labArtifact.deterministicRebuildCompared, false)
})

test("admitted LiteLLM UI shells canonicalize internally while retired surfaces remain denied", () => {
  assert.match(
    edge,
    /location ~ \^\/ui\/(?:[^\n]+)\$ \{[\s\S]*?return 308 https:\/\/@@PRODUCT_LITELLM_HOST@@\$uri\/;/,
  )
  assert.match(edge, /get\/ui_settings/)
  assert.ok(
    edge.includes(
      "location ~* ^/(?:public/litellm_blog_posts|v1/agents)(?:/|$) {",
    ),
  )
  assert.doesNotMatch(
    edge,
    /location[^\n]*\/ui\/(?:mcp-servers|skills|model-hub-table|agents|vector-stores)/,
  )
})

function readJson(relative) {
  return JSON.parse(readText(relative))
}

function readText(relative) {
  return readFileSync(path.resolve(root, relative), "utf8")
}
