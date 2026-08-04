import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import {
  pr12ReleaseTestGateBindingPath,
  verifyPr12ReleaseTestGateBinding,
} from "./guardrails.mjs"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"))
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

test("PR-12 release-test gate binding matches the checked-in source", () => {
  assert.deepEqual(verifyPr12ReleaseTestGateBinding(repositoryRoot), [])
})

test("PR-12 release-test gate rejects changed commands and protected files", () => {
  const binding = readJson(pr12ReleaseTestGateBindingPath)
  const changedCommand = clone(binding)
  changedCommand.commands.release =
    "node --test scripts/inference-core/*.test.mjs"
  assert.match(
    verifyPr12ReleaseTestGateBinding(repositoryRoot, changedCommand).join("\n"),
    /invalid PR-12 release-test gate command binding/,
  )

  const changedFingerprint = clone(binding)
  changedFingerprint.protectedFiles[0].sha256 = "0".repeat(64)
  assert.match(
    verifyPr12ReleaseTestGateBinding(repositoryRoot, changedFingerprint).join(
      "\n",
    ),
    /PR-12 release-test protected file changed package\.json/,
  )
})

test("full Product test runs the exact mandatory release gate once", () => {
  const manifest = readJson("package.json")
  const binding = readJson(pr12ReleaseTestGateBindingPath)
  assert.equal(manifest.scripts["test:release"], binding.commands.release)
  assert.equal(manifest.scripts.test, binding.commands.product)
  assert.equal(
    manifest.scripts.test.match(/corepack pnpm run test:release/g)?.length,
    1,
  )
})

test("every bound release suite resolves to checked-in tests", () => {
  const binding = readJson(pr12ReleaseTestGateBindingPath)
  const expectedDirectories = new Map([
    ["infra/inference/*.test.mjs", "infra/inference"],
    ["infra/release/*.test.mjs", "infra/release"],
    ["infra/firecrawl/release/*.test.mjs", "infra/firecrawl/release"],
    ["infra/keycloak/*.test.mjs", "infra/keycloak"],
    ["scripts/inference-core/pr12-*.test.mjs", "scripts/inference-core"],
  ])
  for (const suite of binding.suites) {
    const directory = expectedDirectories.get(suite)
    assert.ok(directory, `unreviewed release-test suite ${suite}`)
    const prefix = suite.includes("pr12-*") ? "pr12-" : ""
    const tests = readdirSync(resolve(repositoryRoot, directory)).filter(
      (name) => name.startsWith(prefix) && name.endsWith(".test.mjs"),
    )
    assert.notEqual(tests.length, 0, `empty release-test suite ${suite}`)
  }
  assert.ok(
    readdirSync(resolve(repositoryRoot, "infra/keycloak")).includes(
      "validate-pr11a-session-policy.test.mjs",
    ),
  )
})
