import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { validateSidebarFunctionalCandidate } from "./validate-sidebar-functional-candidate.mjs"

const directory = import.meta.dirname
const repositoryRoot = path.resolve(directory, "../../..")
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

test("Admin page dependencies remain proxy-admin-only and content-safe", () => {
  const patchPath = path.resolve(
    repositoryRoot,
    candidate.overlay.path,
  )
  const overlay = readFileSync(patchPath, "utf8")
  assert.match(overlay, /_require_llmm_proxy_admin/)
  assert.match(overlay, /not is_v2 and user_api_key_dict\.user_role not in/)
  assert.doesNotMatch(overlay, /^\+.*\/spend\/logs\/ui\/\{request_id\}/m)
  assert.match(overlay, /^-import AuditLogsPanel/m)
  assert.match(overlay, /^-import ModelSettingsModal/m)
  assert.match(overlay, /^-    # Append A2A agents to models list/m)
  assert.match(overlay, /^-    # Append A2A agents to model groups/m)
})
