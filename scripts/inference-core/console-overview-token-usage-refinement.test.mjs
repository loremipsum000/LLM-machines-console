import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import {
  overviewSurfaceRetirementBase,
  overviewTokenUsageRefinementPath,
  repositoryRoot,
  verifyOverviewTokenUsageRefinementDocument,
  verifyPr11SourceBoundary,
} from "./guardrails.mjs"

const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8")
const readAtOverviewRetirementBase = (path) =>
  execFileSync("git", ["show", `${overviewSurfaceRetirementBase}:${path}`], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })

test("the prospective refinement record is exact and status-bounded", () => {
  const bytes = readFileSync(
    resolve(repositoryRoot, overviewTokenUsageRefinementPath),
  )
  const decision = JSON.parse(bytes)

  assert.deepEqual(verifyOverviewTokenUsageRefinementDocument(decision), [])
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "b2895e5bd29d5779d65ef8ee1e1daa4c9dc0b0fca32d3dea85036493a4682394",
  )
  const forged = structuredClone(decision)
  forged.overview.tokenUsage.range = "365d"
  assert.match(
    verifyOverviewTokenUsageRefinementDocument(forged).join("\n"),
    /token-usage refinement boundary changed/,
  )
})

test("the historical Activity retirement record remains byte-identical", () => {
  const bytes = readFileSync(
    resolve(
      repositoryRoot,
      "docs/reduction/inference-core/console-activity-audit-surface-retirement.json",
    ),
  )
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "7d058e96b5dae588aa19ae14c77d5517db633639ab6b3a27ff16087329cfeb92",
  )
})

test("the bound predecessor used one-column cards and authoritative 90-day token usage", () => {
  const overview = readAtOverviewRetirementBase(
    "apps/web/src/components/console-v2/overview-v2-experience.tsx",
  )
  const grid = readAtOverviewRetirementBase(
    "apps/web/src/components/console-v2/token-usage-grid.tsx",
  )
  const service = readAtOverviewRetirementBase(
    "apps/bff/src/services/admin-overview.ts",
  )
  const contracts = readAtOverviewRetirementBase(
    "packages/contracts/src/inference-core.ts",
  )

  assert.match(overview, /TokenUsageGrid/)
  assert.match(overview, /className="mt-8 grid gap-3"/)
  assert.doesNotMatch(overview, /Recent activity/)
  assert.match(grid, /RANGE_DAYS = 90/)
  assert.match(grid, /No token usage reported/)
  assert.match(grid, /bg-\[#009fff\]/)
  assert.match(service, /getAdminInference\(actor, \{ range: "90d" \}\)/)
  assert.doesNotMatch(service, /getRecentAuditEvents/)
  assert.match(contracts, /adminOverviewTokenUsageSchema/)
  assert.doesNotMatch(contracts, /adminActivityEventSchema/)
})

test("the current successor removes the Overview implementation and API", () => {
  for (const path of [
    "apps/web/src/components/console-v2/overview-v2-experience.tsx",
    "apps/web/src/components/console-v2/token-usage-grid.tsx",
    "apps/bff/src/services/admin-overview.ts",
  ]) {
    assert.throws(() => read(path))
  }

  assert.match(read("apps/web/src/app/page.tsx"), /redirect\("\/keys"\)/)
  assert.doesNotMatch(
    read("apps/bff/src/routes/admin.ts"),
    /\/api\/admin\/overview|adminOverviewResponseSchema|getAdminOverview/,
  )
  assert.doesNotMatch(
    read("packages/contracts/src/inference-core.ts"),
    /adminOverview(?:Response|TokenUsage)Schema/,
  )
})

test("Settings has one Admin export control while audit APIs remain", () => {
  const panel = read(
    "apps/web/src/components/console-v2/audit-evidence-panel.tsx",
  )
  const routes = read("apps/bff/src/routes/admin.ts")

  assert.equal((panel.match(/<button\b/g) ?? []).length, 1)
  assert.match(panel, /Export last 30 days/)
  assert.match(panel, /action="\/api\/admin\/audit\/export"/)
  assert.doesNotMatch(panel, /export\/verification-keys/)
  assert.match(panel, /accessRole !== "admin"/)
  for (const route of [
    "/api/admin/audit",
    "/api/admin/audit/export",
    "/api/admin/audit/export/verification-keys",
  ]) {
    assert.match(routes, new RegExp(route.replaceAll("/", "\\/")))
  }
})

test("the complete current source boundary accepts the successor", () => {
  assert.deepEqual(verifyPr11SourceBoundary(repositoryRoot), [])
})

test("the browser proof initializes its logout fixture before execution", () => {
  const browserProof = read(
    "scripts/pre-genesis/reduced-core-browser-session.mjs",
  )
  assert.ok(
    browserProof.indexOf("const liteLlmGlobalLogoutScript") <
      browserProof.indexOf("const evidence = await runBrowserSessionProof()"),
  )
})
