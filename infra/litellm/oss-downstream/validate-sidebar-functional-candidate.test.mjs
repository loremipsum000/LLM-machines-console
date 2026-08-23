import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { validateSidebarFunctionalCandidate } from "./validate-sidebar-functional-candidate.mjs"

const directory = import.meta.dirname
const candidate = JSON.parse(
  readFileSync(path.resolve(directory, "sidebar-functional-candidate.json")),
)
const sourcePackage = JSON.parse(
  readFileSync(path.resolve(directory, "source-package.json")),
)

test("checked-in LiteLLM sidebar candidate passes", () => {
  assert.deepEqual(
    validateSidebarFunctionalCandidate(candidate, sourcePackage),
    [],
  )
})

test("release or Product-boundary overclaims fail", () => {
  for (const mutate of [
    (value) => {
      value.releaseAdmitted = true
    },
    (value) => {
      value.labArtifact.buildCount = 2
    },
    (value) => {
      value.labArtifact.completeReleaseEvidence = true
    },
    (value) => {
      value.productBoundary.operatorPages.push("models")
    },
    (value) => {
      value.productBoundary.consoleSessionForwarding = true
    },
  ]) {
    const value = structuredClone(candidate)
    mutate(value)
    assert.notDeepEqual(
      validateSidebarFunctionalCandidate(value, sourcePackage),
      [],
    )
  }
})
