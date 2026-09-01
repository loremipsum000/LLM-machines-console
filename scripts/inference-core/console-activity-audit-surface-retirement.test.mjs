import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import { coreCompatibilityFingerprint } from "../../infra/inference/validate-profile.mjs"
import {
  activityAuditSurfaceRetirementPath,
  currentOverviewRetiredLogicalSurfaceContract,
  overviewTokenUsageRefinementBase,
  repositoryRoot,
  verifyActivityAuditSurfaceRetirementDocument,
  verifyPr11SourceBoundary,
} from "./guardrails.mjs"

const gitAt = (path) =>
  execFileSync("git", ["show", `${overviewTokenUsageRefinementBase}:${path}`], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })

test("the current Console boundary has five ordered customer surfaces", () => {
  assert.deepEqual(
    currentOverviewRetiredLogicalSurfaceContract.map(({ label, href }) => ({
      label,
      href,
    })),
    [
      { label: "Keys", href: "/keys" },
      { label: "Inference", href: "/inference" },
      { label: "Hardware", href: "/hardware" },
      { label: "Team", href: "/team" },
      { label: "Settings", href: "/settings" },
    ],
  )
})

test("the retirement decision preserves audit controls", () => {
  const decision = JSON.parse(
    readFileSync(resolve(repositoryRoot, activityAuditSurfaceRetirementPath)),
  )
  assert.deepEqual(verifyActivityAuditSurfaceRetirementDocument(decision), [])

  const forged = structuredClone(decision)
  forged.retainedControls.auditLedger = "REMOVED"
  assert.match(
    verifyActivityAuditSurfaceRetirementDocument(forged).join("\n"),
    /retained controls/,
  )
})

test("the current source has no Activity or Overview page contract", () => {
  assert.deepEqual(verifyPr11SourceBoundary(repositoryRoot), [])
  assert.throws(() =>
    readFileSync(resolve(repositoryRoot, "apps/web/src/app/activity/page.tsx")),
  )
  assert.throws(() =>
    readFileSync(
      resolve(
        repositoryRoot,
        "apps/web/src/components/console-v2/activity-v2-experience.tsx",
      ),
    ),
  )
  assert.throws(() =>
    readFileSync(
      resolve(
        repositoryRoot,
        "apps/web/src/components/console-v2/overview-v2-experience.tsx",
      ),
    ),
  )
})

test("the Activity retirement fingerprint remains bound to the predecessor source", () => {
  const contract = JSON.parse(
    gitAt("infra/inference/core-interface-contract.json"),
  )
  const decision = JSON.parse(
    readFileSync(resolve(repositoryRoot, activityAuditSurfaceRetirementPath)),
  )

  assert.equal(
    coreCompatibilityFingerprint(contract),
    decision.customerBoundary.coreCompatibilityFingerprint,
  )
})

test("the current Core compatibility contract has the five-surface boundary", () => {
  const contract = JSON.parse(
    readFileSync(
      resolve(repositoryRoot, "infra/inference/core-interface-contract.json"),
    ),
  )

  assert.deepEqual(contract.consoleSections, [
    "applications",
    "inference",
    "hardware",
    "team",
    "settings",
  ])
  assert.equal(
    coreCompatibilityFingerprint(contract),
    "sha256:3454120acc4928334bfbff130618f005f446c216034aec3db8de6e2127f77e40",
  )
})

test("signed audit evidence remains available without a customer page", () => {
  const requiredPaths = [
    "apps/bff/src/services/admin-audit.ts",
    "apps/bff/src/services/audit.ts",
    "apps/web/src/app/api/admin/audit/export/route.ts",
    "apps/web/src/app/api/admin/audit/export/verification-keys/route.ts",
    "apps/web/src/components/console-v2/audit-evidence-panel.tsx",
  ]
  for (const path of requiredPaths) {
    assert.doesNotThrow(() => readFileSync(resolve(repositoryRoot, path)))
  }
})
