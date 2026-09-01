import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import {
  overviewSurfaceRetirementPath,
  repositoryRoot,
  verifyOverviewSurfaceRetirementDocument,
  verifyPr11SourceBoundary,
} from "./guardrails.mjs"

const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8")

test("the prospective Overview retirement record is exact and status-bounded", () => {
  const decision = JSON.parse(read(overviewSurfaceRetirementPath))

  assert.deepEqual(verifyOverviewSurfaceRetirementDocument(decision), [])

  const forgedBoundary = structuredClone(decision)
  forgedBoundary.customerBoundary.rootTarget = "/inference"
  assert.match(
    verifyOverviewSurfaceRetirementDocument(forgedBoundary).join("\n"),
    /Overview retirement changed the customer boundary/,
  )

  const forgedStatus = structuredClone(decision)
  forgedStatus.productAccepted = true
  assert.match(
    verifyOverviewSurfaceRetirementDocument(forgedStatus).join("\n"),
    /Overview retirement overstated Product status/,
  )
})

test("the predecessor Overview-refinement record remains byte-identical", () => {
  const bytes = readFileSync(
    resolve(
      repositoryRoot,
      "docs/reduction/inference-core/console-overview-token-usage-refinement.json",
    ),
  )
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "b2895e5bd29d5779d65ef8ee1e1daa4c9dc0b0fca32d3dea85036493a4682394",
  )
})

test("Overview is absent while root safely lands on Keys", () => {
  const page = read("apps/web/src/app/page.tsx")
  const browserSession = read(
    "scripts/pre-genesis/reduced-core-browser-session.mjs",
  )
  const sections = read(
    "apps/web/src/components/console-v2/console-v2-sections.ts",
  )
  const routes = read("apps/bff/src/routes/admin.ts")
  const contract = JSON.parse(
    read("infra/inference/core-interface-contract.json"),
  )

  assert.match(page, /redirect\("\/keys"\)/)
  assert.match(
    browserSession,
    /completeIdentityLogin\(page, credentials\.operator\)[\s\S]*?assert\.equal\(new URL\(page\.url\(\)\)\.pathname, "\/keys"\)/,
  )
  assert.doesNotMatch(sections, /id: "overview"/)
  assert.doesNotMatch(routes, /\/api\/admin\/overview/)
  assert.deepEqual(contract.consoleSections, [
    "applications",
    "inference",
    "hardware",
    "team",
    "settings",
  ])

  for (const path of [
    "apps/web/src/components/console-v2/overview-v2-experience.tsx",
    "apps/web/src/components/console-v2/token-usage-grid.tsx",
    "apps/bff/src/services/admin-overview.ts",
    "apps/bff/src/services/admin-health.ts",
    "apps/bff/src/services/admin-ops.ts",
    "apps/bff/src/services/admin-ops-parsers.ts",
  ]) {
    assert.equal(existsSync(resolve(repositoryRoot, path)), false, path)
  }
})

test("Settings retains the Admin audit export and all audit backend controls", () => {
  const panel = read(
    "apps/web/src/components/console-v2/audit-evidence-panel.tsx",
  )
  const routes = read("apps/bff/src/routes/admin.ts")

  assert.match(panel, /Export last 30 days/)
  assert.match(panel, /action="\/api\/admin\/audit\/export"/)
  assert.match(panel, /accessRole !== "admin"/)
  for (const route of [
    "/api/admin/audit",
    "/api/admin/audit/export",
    "/api/admin/audit/export/verification-keys",
  ]) {
    assert.match(routes, new RegExp(route.replaceAll("/", "\\/")))
  }
})

test("the complete current source boundary accepts Overview retirement", () => {
  assert.deepEqual(verifyPr11SourceBoundary(repositoryRoot), [])
})
