import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import {
  readSourcePackage,
  verifyCheckedInSourcePackage,
} from "../../infra/firecrawl/release/validate-source-package.mjs"
import { validateReproducibilityEvidence } from "../../infra/firecrawl/release/verify-source-packet-reproducibility.mjs"
import { buildForbiddenAllowlist } from "./guardrails.mjs"

const root = path.resolve(import.meta.dirname, "../..")

test("PR-12 Firecrawl release package stays source-only and reduced", () => {
  assert.deepEqual(verifyCheckedInSourcePackage(), [])
  const manifest = readSourcePackage()
  assert.equal(manifest.runtimeQualified, false)
  assert.deepEqual(manifest.productBoundary.routes, [
    "POST /v2/search",
    "POST /v2/scrape",
  ])
  assert.equal(manifest.productBoundary.defaultEnabled, false)
  assert.equal(manifest.productBoundary.nativeUi, false)
  const evidence = JSON.parse(
    readFileSync(
      path.join(root, "infra/firecrawl/release/reproducibility-evidence.json"),
      "utf8",
    ),
  )
  assert.deepEqual(validateReproducibilityEvidence(evidence), [])
})

test("the Product profile launches only the reduced Firecrawl entrypoint", () => {
  const compose = readFileSync(
    path.join(root, "infra/firecrawl/compose.yaml"),
    "utf8",
  )
  assert.match(compose, /dist\/src\/llm-machines-server\.js/)
  assert.doesNotMatch(compose, /harness\.js|--start-docker/)
})

test("release evidence excludes queue and persistence workers", () => {
  const source = JSON.stringify(readSourcePackage())
  assert.doesNotMatch(source, /(?:nuq|rabbitmq|coordination-redis)/i)
  assert.doesNotMatch(source, /(?:intel[-_ ]arc[-_ ]b50|sglang-xpu)/i)
})

test("corresponding-source artifacts do not redefine the Product surface", () => {
  const evidencePaths = [
    "infra/firecrawl/release/locks/Cargo.lock",
    "infra/firecrawl/release/locks/api-wolfi.sha256",
    "infra/firecrawl/release/locks/playwright-wolfi.sha256",
    "infra/firecrawl/release/patches/build-hardening.patch",
    "infra/firecrawl/release/patches/reduced-runtime.patch",
    "infra/firecrawl/release/source-package.json",
    "infra/firecrawl/release/reproducibility-evidence.json",
    "infra/firecrawl/release/verify-source-packet-reproducibility.mjs",
    "scripts/inference-core/pr12-firecrawl-release.test.mjs",
  ]
  const result = buildForbiddenAllowlist({
    root,
    paths: evidencePaths,
    baseCommit: "0".repeat(40),
  })
  assert.deepEqual(result.entries, [])
})
