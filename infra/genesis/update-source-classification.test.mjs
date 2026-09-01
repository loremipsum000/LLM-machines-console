import assert from "node:assert/strict"
import { test } from "node:test"
import {
  buildClassification,
  classifyPath,
} from "./update-source-classification.mjs"

test("every retained path receives its narrow source class", () => {
  assert.equal(classifyPath("apps/web/src/app/page.tsx"), "PRODUCT_SOURCE")
  assert.equal(classifyPath("apps/web/src/app/page.test.tsx"), "PRODUCT_TEST")
  assert.equal(
    classifyPath("scripts/inference-core/pr05-keycloak-seed.test.mjs"),
    "PRODUCT_TEST",
  )
})

test("lab, historical and deferred paths remain excluded", () => {
  assert.equal(
    classifyPath("apps/bff/src/pre-genesis-f0-b1.test.ts"),
    "LAB_ONLY",
  )
  assert.equal(
    classifyPath("infra/release/l1b-executable-toolchain.test.mjs"),
    "LAB_ONLY",
  )
  assert.equal(
    classifyPath("infra/portainer/README.md"),
    "DEFERRED_NOT_ADMITTED",
  )
  assert.equal(
    classifyPath("docs/reduction/inference-core/evidence.json"),
    "HISTORICAL_EVIDENCE",
  )
  assert.equal(
    classifyPath("scripts/pre-genesis/reduced-core-dev.mjs"),
    "LAB_ONLY",
  )
})

test("unknown tracked paths fail closed", () => {
  assert.throws(
    () => classifyPath("misc/unreviewed.txt"),
    /unclassified tracked path/,
  )
})

test("classification output is in canonical byte order", () => {
  const result = buildClassification([
    "README.md",
    "apps/web/package.json",
    "COPYRIGHT",
  ])
  assert.deepEqual(
    result.entries.map((entry) => entry.path),
    ["COPYRIGHT", "README.md", "apps/web/package.json"],
  )
})
