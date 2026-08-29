import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import {
  buildPr11ConsoleHrefManifest,
  repositoryRoot,
  teamDeferredCapabilitiesBoundaryPath,
  teamDeferredCapabilitiesRetiredConsoleHrefManifest,
  verifyPr11ConsoleHrefManifest,
  verifyTeamDeferredCapabilitiesBoundaryDocument,
} from "./guardrails.mjs"

const f0I2EvidencePath =
  "docs/reduction/inference-core/f0-i2-keycloak-team.json"
const teamRoutesPath = "apps/web/src/lib/admin/console-v2-routes-core.tsx"
const teamExperiencePath =
  "apps/web/src/components/console-v2/team-v2-experience.tsx"
const webActionsPath = "apps/web/src/lib/admin/actions-core.ts"
const bffRoutesPath = "apps/bff/src/routes/admin.ts"
const csvTemplateRoutePath = "apps/web/src/app/team/import/template/route.ts"

test("the current Team boundary preserves F0-I2 deferrals", () => {
  const historicalEvidence = JSON.parse(
    readFileSync(resolve(repositoryRoot, f0I2EvidencePath), "utf8"),
  )
  assert.ok(
    historicalEvidence.notEvidenceFor.includes(
      "email delivery, CSV import, arbitrary group CRUD, or identity migration",
    ),
  )

  const routeSource = source(teamRoutesPath)
  assert.doesNotMatch(routeSource, /section\[0\] === "(?:import|groups)"/)
  assert.match(routeSource, /section\[0\] === "members"/)

  const experienceSource = source(teamExperiencePath)
  assert.doesNotMatch(experienceSource, /\/team\/(?:import|groups)/)
  assert.doesNotMatch(
    experienceSource,
    /(?:Send invite email|Send reset email|Create group|Import CSV)/,
  )
  assert.match(experienceSource, /href="\/team\/members\/new"/)
  assert.match(experienceSource, /generateAdminTeamPasswordAction/)
  assert.match(experienceSource, /disableAdminTeamMemberAction/)
  assert.match(experienceSource, /reactivateAdminTeamMemberAction/)
  assert.match(experienceSource, /deleteAdminTeamMemberAction/)
  assert.match(experienceSource, /Type DELETE(?: to confirm)?/)

  const actionSource = source(webActionsPath)
  assert.doesNotMatch(
    actionSource,
    /\/api\/admin\/team\/(?:csv-template|import|groups)/,
  )
  assert.doesNotMatch(
    actionSource,
    /\/api\/admin\/team\/members\/[^"`]+\/(?:invite|reset-password-email)/,
  )
  assert.match(actionSource, /sendInvite: false/)
  assert.match(actionSource, /role === "admin" \? "Admins" : "Operators"/)
  assert.match(actionSource, /confirmation !== "DELETE"/)
  assert.match(
    actionSource,
    /members\/\$\{encodeURIComponent\(memberId\)\}\/delete/,
  )

  const bffSource = source(bffRoutesPath)
  assert.doesNotMatch(
    bffSource,
    /"\/api\/admin\/team\/(?:csv-template|import|groups)/,
  )
  assert.doesNotMatch(
    bffSource,
    /"\/api\/admin\/team\/members\/:id\/(?:invite|reset-password-email)"/,
  )
  assert.match(bffSource, /"\/api\/admin\/team\/members"/)
  assert.match(bffSource, /members\/:id\/generate-password/)
  assert.match(bffSource, /members\/:id\/disable/)
  assert.match(bffSource, /members\/:id\/reactivate/)
  assert.match(bffSource, /members\/:id\/delete/)
  assert.match(bffSource, /requires exact DELETE confirmation/)
  assert.match(bffSource, /body\.data\.sendInvite/)

  const csvTemplateRouteSource = source(csvTemplateRoutePath)
  assert.match(csvTemplateRouteSource, /status: 404/)
  assert.match(csvTemplateRouteSource, /"Cache-Control": "no-store"/)
  assert.doesNotMatch(csvTemplateRouteSource, /getBffRequest|fetch\(/)
  assert.deepEqual(
    buildPr11ConsoleHrefManifest(repositoryRoot, currentWorktreePaths()),
    teamDeferredCapabilitiesRetiredConsoleHrefManifest,
  )
  assert.deepEqual(
    verifyPr11ConsoleHrefManifest(
      teamDeferredCapabilitiesRetiredConsoleHrefManifest,
    ),
    [],
  )

  const boundary = JSON.parse(source(teamDeferredCapabilitiesBoundaryPath))
  assert.deepEqual(verifyTeamDeferredCapabilitiesBoundaryDocument(boundary), [])
  assert.deepEqual(boundary.currentBoundary.tombstonedWebRoutes, [
    {
      cacheControl: "no-store",
      method: "GET",
      path: "/team/import/template",
      status: 404,
    },
  ])
  assert.equal(boundary.historicalEvidence, "PRESERVED_UNCHANGED")
  assert.equal(boundary.productAccepted, false)
  assert.equal(boundary.runtimeQualified, false)
  assert.equal(boundary.contractActivation, "INACTIVE")
  assert.equal(boundary.genesis, "UNPUBLISHED")
})

function source(path) {
  return readFileSync(resolve(repositoryRoot, path), "utf8")
}

function currentWorktreePaths() {
  return execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean)
}
