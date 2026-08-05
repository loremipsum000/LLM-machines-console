import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"))
}

test("F0-E0 supersedes only the current public-authority topology", () => {
  const historical = readJson(
    "docs/reduction/inference-core/pr-11a-r1-e1-product-edge-decisions.json",
  )
  const decision = readJson(
    "docs/reduction/inference-core/f0-e0-public-authority-decisions.json",
  )
  const edge = readJson("infra/ingress/edge-policy.json")
  const noBypass = readJson("infra/ingress/no-bypass-policy.json")

  assert.deepEqual(historical.bindingDecisions.edge.publicHostIds, [
    "console",
    "identity",
  ])
  assert.equal(decision.workPackage, "F0-E0")
  assert.equal(decision.status, "source-candidate-not-runtime-qualified")
  assert.equal(decision.accepted, false)
  assert.equal(decision.runtimeQualified, false)
  assert.equal(
    decision.historicalEvidence.r1E1SourceHeadCommit,
    historical.sourceHeadCommit,
  )
  assert.equal(
    decision.historicalEvidence.disposition,
    "immutable-history-superseded-only-for-current-public-authority-topology",
  )

  const authorities = Object.keys(decision.bindingDecisions.publicAuthorities)
  assert.deepEqual(authorities, ["console", "api", "identity", "firecrawl"])
  assert.deepEqual(Object.keys(edge.edge.hostTemplates).sort(), [
    "api",
    "console",
    "firecrawl",
    "identity",
  ])
  assert.equal(edge.workPackage, "F0-E0")
  assert.equal(noBypass.workPackage, "F0-E0")
  assert.deepEqual(
    decision.bindingDecisions.privateNativeSystems,
    edge.privateNativeSystems,
  )
  assert.deepEqual(decision.bindingDecisions.customerTcpPorts, [443])
  assert.deepEqual(noBypass.customerNetwork.allowedTcpPorts, [443])
  assert.deepEqual(decision.bindingDecisions.runtimeAuthorityBinding, {
    applicationApiBase: "exact-product-api-host",
    applicationIdentityIssuer: "exact-product-identity-host",
    consoleOrigin: "exact-product-console-host",
    firecrawlPublicBase: "exact-product-firecrawl-host",
    humanIdentityIssuer: "exact-product-identity-host",
  })
})

test("F0-E0 retains only approved API and Firecrawl customer routes", () => {
  const decision = readJson(
    "docs/reduction/inference-core/f0-e0-public-authority-decisions.json",
  )
  const edge = readJson("infra/ingress/edge-policy.json")
  const customerRoutes = edge.routes
    .filter((route) => ["inference", "firecrawl"].includes(route.surface))
    .map((route) => `${route.methods.join(",")} ${route.path.value}`)

  assert.deepEqual(customerRoutes, [
    "GET,HEAD /v1/models",
    "POST /v1/chat/completions",
    "POST /v2/search",
    "POST /v2/scrape",
  ])
  assert.deepEqual(decision.bindingDecisions.publicAuthorities.api.routes, [
    "GET /v1/models",
    "POST /v1/chat/completions",
  ])
  assert.deepEqual(
    decision.bindingDecisions.publicAuthorities.firecrawl.routes,
    ["POST /v2/search", "POST /v2/scrape"],
  )
  assert.equal(
    edge.runtimeQualification.directNetworkNoBypass,
    "NOT_EVALUATED_RUNTIME",
  )
  assert.equal(
    decision.bindingDecisions.edgeValidation.runtimeNoBypass,
    "NOT_EVALUATED_RUNTIME",
  )
})
