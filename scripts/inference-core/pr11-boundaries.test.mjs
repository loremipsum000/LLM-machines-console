import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import {
  extractPr11ConsoleHrefManifest,
  pr10cDecisionPath,
  pr11AllowedRepositoryPaths,
  pr11ConsoleHrefManifest,
  pr11ContractBase,
  pr11ContractBaseTree,
  pr11DecisionPath,
  pr11GeneratedDestinationPaths,
  pr11GovernancePaths,
  pr11LaneAnchor,
  pr11LogicalSurfaceContract,
  pr11Pr09HistoricalNativeEvidenceBindings,
  pr11Pr09HistoricalSourceBoundaryBindings,
  pr11Pr09HistoricalWebAuthenticationEvidenceBindings,
  pr11RemovedRouteContract,
  pr11RetiredEnvExampleBlock,
  pr11ReviewedDispositions,
  pr11RouteFingerprintTransitions,
  pr11SourceEvidencePaths,
  pr11SuccessorHistoricalEvidenceBindings,
  pr11TargetContract,
  readPr11DecisionDocument,
  repositoryRoot,
  verifyPr10cDecisionDocument,
  verifyPr11BaseEvidence,
  verifyPr11ConsoleHrefManifest,
  verifyPr11ConsoleSourceLinkBoundary,
  verifyPr11DecisionDocument,
  verifyPr11EnvExampleTransition,
  verifyPr11ExpertPayloadSourceBoundary,
  verifyPr11GeneratedDestinationBoundary,
  verifyPr11OperationBoundary,
  verifyPr11OverviewHrefContractSource,
  verifyPr11OverviewRouteParseBoundary,
  verifyPr11RetainedRouteContract,
  verifyPr11SourceBoundary,
  verifyReviewedPr09NativeIdentifierEvidence,
  verifyReviewedPr09WebAuthenticationEvidence,
} from "./guardrails.mjs"

test("PR-11 is anchored to the accepted PR-10C integration tree", () => {
  assert.equal(pr11ContractBase, "6efab17a6f5f6a474a1dfe1444dcdd63e4973dd7")
  assert.equal(pr11LaneAnchor, pr11ContractBase)
  assert.equal(pr11ContractBaseTree, "44d6fb34db5f3d35e8b2f9bd2259756aec63b8a8")
  assert.equal(
    gitAt(["rev-parse", `${pr11ContractBase}^{tree}`]),
    pr11ContractBaseTree,
  )
})

test("PR-11 retains every PR-02 through PR-10C evidence file", () => {
  assert.deepEqual(verifyPr11BaseEvidence(), [])
})

test("PR-11 resolves changed predecessor evidence from reviewed commits", () => {
  assert.deepEqual(pr11Pr09HistoricalNativeEvidenceBindings, [
    {
      path: "apps/bff/src/services/audit.test.ts",
      evidenceCommit: pr11ContractBase,
    },
    {
      path: "apps/bff/src/services/audit.ts",
      evidenceCommit: pr11ContractBase,
    },
  ])
  assert.deepEqual(pr11Pr09HistoricalWebAuthenticationEvidenceBindings, [
    {
      path: "apps/web/src/middleware.test.ts",
      evidenceCommit: pr11ContractBase,
    },
    {
      path: "apps/web/src/middleware.ts",
      evidenceCommit: pr11ContractBase,
    },
  ])
  assert.deepEqual(pr11Pr09HistoricalSourceBoundaryBindings, [
    {
      path: "apps/web/src/components/console-v2/console-v2-sections.ts",
      evidenceCommit: pr11ContractBase,
    },
  ])
  assert.deepEqual(verifyReviewedPr09NativeIdentifierEvidence(), [])
  assert.deepEqual(verifyReviewedPr09WebAuthenticationEvidence(), [])
  const pr10cDecision = JSON.parse(
    readFileSync(resolve(repositoryRoot, pr10cDecisionPath), "utf8"),
  )
  assert.deepEqual(verifyPr10cDecisionDocument(pr10cDecision), [])
  assert.deepEqual(
    verifyPr10cDecisionDocument(pr10cDecision, { requireReady: true }),
    [],
  )
})

test("PR-11 fixes exactly seven ordered logical surfaces", () => {
  assert.deepEqual(
    pr11LogicalSurfaceContract.map(({ label, href }) => ({ label, href })),
    [
      { label: "Overview", href: "/" },
      { label: "Applications", href: "/applications" },
      { label: "Inference", href: "/inference" },
      { label: "Hardware", href: "/hardware" },
      { label: "Team", href: "/team" },
      { label: "Activity & Audit", href: "/activity" },
      { label: "Settings", href: "/settings" },
    ],
  )
  assert.equal(pr11TargetContract.rootSurface, "overview")
  assert.equal(pr11TargetContract.activityAuditPath, "/activity")
  assert.equal(pr11TargetContract.nativeExpertLinksEnabled, false)
  assert.equal(pr11TargetContract.portainerInProductNavigation, false)
  assert.equal(pr11TargetContract.agenticProductSurface, false)
  assert.equal(pr11TargetContract.routes, 104)
  assert.equal(
    pr11TargetContract.routeClassifications["current-console-seam"],
    92,
  )
  assert.deepEqual(
    pr11TargetContract.removedRoutesByPr11,
    pr11RemovedRouteContract,
  )
})

test("PR-11 decision evidence binds the final frozen delta", () => {
  const decision = readPr11DecisionDocument()
  assert.deepEqual(decision.reviewedDispositions, pr11ReviewedDispositions)
  assert.deepEqual(decision.target, pr11TargetContract)
  assert.equal(decision.reviewStatus, "reviewed")
  assert.deepEqual(verifyPr11DecisionDocument(decision), [])
  assert.deepEqual(
    verifyPr11DecisionDocument(decision, { requireReady: true }),
    [],
  )
})

test("PR-11 keeps inference and Firecrawl credentials separate", () => {
  const applications = pr11ReviewedDispositions.applications
  assert.equal(applications.combinedConsoleSurface, true)
  assert.deepEqual(applications.capabilities, ["inference", "firecrawl"])
  assert.deepEqual(applications.credentialNamespaces, [
    "inference",
    "firecrawl",
  ])
  assert.equal(applications.credentialsRemainSeparate, true)
  assert.equal(applications.firecrawlDefaultEnabled, false)
})

test("PR-11 removes exactly the simulated model-update route", () => {
  assert.deepEqual(pr11RemovedRouteContract, [
    {
      surface: "bff",
      method: "POST",
      path: "/api/admin/inference/model-updates/apply",
      source: "apps/bff/src/routes/admin.ts",
      classification: "current-console-seam",
    },
  ])
  assert.deepEqual(pr11ReviewedDispositions.routeTransition, {
    removedRoutes: pr11RemovedRouteContract,
    addedRoutes: [],
    reclassifiedRoutes: [],
    fastifyRegistrarChanges: 0,
    resolverFingerprintTransitions: pr11RouteFingerprintTransitions,
  })
})

test("PR-11 exposes reduced previews without native expert links", () => {
  const expertServices = pr11ReviewedDispositions.expertServices
  assert.deepEqual(
    expertServices.previews.map(({ service }) => service),
    ["grafana", "litellm", "keycloak"],
  )
  for (const preview of expertServices.previews) {
    assert.equal(preview.consoleMode, "reduced-preview")
    assert.equal(preview.nativeAccessAffordance, "disabled")
    assert.equal(preview.liveUrlAvailable, false)
  }
  assert.equal(expertServices.nativeLinksEnabled, false)
  assert.equal(expertServices.noBypassQualificationOwner, "PR-12")
})

test("PR-11 rejects literal, aliased, and BFF-supplied external hrefs", () => {
  const overviewPath =
    "apps/web/src/components/console-v2/overview-v2-experience.tsx"
  const hardcodedSource =
    'export function Escape() { return <a href="https://grafana.example.test">Open</a> }'
  assert.deepEqual(
    extractPr11ConsoleHrefManifest(overviewPath, hardcodedSource),
    [
      {
        path: overviewPath,
        expression: "literal:https://grafana.example.test",
      },
    ],
  )
  assert.match(
    verifyPr11ConsoleSourceLinkBoundary(overviewPath, hardcodedSource).join(
      "\n",
    ),
    /external URL literal remains/,
  )

  const hardcodedManifest = structuredClone(pr11ConsoleHrefManifest)
  const staticIndex = hardcodedManifest.findIndex(
    ({ path, expression }) =>
      path === overviewPath && expression === "literal:/activity",
  )
  hardcodedManifest[staticIndex] = {
    path: overviewPath,
    expression: "literal:https://grafana.example.test",
  }
  hardcodedManifest.sort(compareHrefEntries)
  assert.match(
    verifyPr11ConsoleHrefManifest(hardcodedManifest).join("\n"),
    /Console href manifest changed/,
  )

  const aliasedManifest = structuredClone(pr11ConsoleHrefManifest)
  const aliasIndex = aliasedManifest.findIndex(
    ({ path, expression }) =>
      path === overviewPath && expression === "expression:tile.href",
  )
  aliasedManifest[aliasIndex] = {
    path: overviewPath,
    expression: "expression:nativeTarget",
  }
  aliasedManifest.sort(compareHrefEntries)
  assert.match(
    verifyPr11ConsoleHrefManifest(aliasedManifest).join("\n"),
    /Console href manifest changed/,
  )

  const contractsPath = resolve(
    repositoryRoot,
    "packages/contracts/src/inference-core.ts",
  )
  const contractsSource = readFileSync(contractsPath, "utf8")
  assert.deepEqual(verifyPr11OverviewHrefContractSource(contractsSource), [])
  const broadTileContract = contractsSource.replace(
    /href: z\.enum\(\[[\s\S]*?\]\),/,
    "href: z.string().url(),",
  )
  assert.match(
    verifyPr11OverviewHrefContractSource(broadTileContract).join("\n"),
    /Overview tile href contract is not internal-only/,
  )

  const adminRouteSource = readFileSync(
    resolve(repositoryRoot, "apps/bff/src/routes/admin.ts"),
    "utf8",
  )
  assert.deepEqual(verifyPr11OverviewRouteParseBoundary(adminRouteSource), [])
  assert.match(
    verifyPr11OverviewRouteParseBoundary(
      adminRouteSource.replace(
        /adminOverviewResponseSchema\.parse\(\s*await\s+getAdminOverview\(\s*requireActor\(request\)\s*\)\s*,?\s*\)/,
        "await getAdminOverview(requireActor(request))",
      ),
    ).join("\n"),
    /BFF Overview response is not contract-parsed/,
  )
})

test("PR-11 native expert payload fields are null-only", () => {
  assert.deepEqual(
    verifyPr11ExpertPayloadSourceBoundary(
      "apps/bff/src/services/admin-hardware.ts",
      "return {\n  grafanaUrl: null,\n}",
    ),
    [],
  )
  assert.deepEqual(
    verifyPr11ExpertPayloadSourceBoundary(
      "packages/contracts/src/inference-core.ts",
      "const schema = z.object({\n  liteLlmUrl: z.null(),\n})",
    ),
    [],
  )
  assert.match(
    verifyPr11ExpertPayloadSourceBoundary(
      "apps/bff/src/services/admin-hardware.ts",
      "const nativeTarget = dashboard.grafanaUrl",
    ).join("\n"),
    /native expert payload field is not null-only/,
  )
  assert.match(
    verifyPr11ExpertPayloadSourceBoundary(
      "packages/contracts/src/inference-core.ts",
      "grafanaUrl: z.string().url(),",
    ).join("\n"),
    /native expert payload field is not null-only/,
  )
})

test("PR-11 .env.example exception deletes one exact retired block", () => {
  const base = `KEEP=value${pr11RetiredEnvExampleBlock}`
  assert.deepEqual(verifyPr11EnvExampleTransition(base, "KEEP=value"), [])
  assert.match(
    verifyPr11EnvExampleTransition(base, "KEEP=changed").join("\n"),
    /may only delete the exact retired model-update block/,
  )
  assert.match(
    verifyPr11EnvExampleTransition(base, "KEEP=value\nADDED=value").join("\n"),
    /may only delete the exact retired model-update block/,
  )
})

test("PR-11 operation policy is exact and source-only", () => {
  const incompletePolicy = {
    addedSourcePaths: [],
    changedSourcePaths: [],
    deletedSourcePaths: [],
    addedRepositoryPaths: [],
    changedRepositoryPaths: [],
    deletedRepositoryPaths: [],
  }
  assert.deepEqual(
    verifyPr11OperationBoundary(incompletePolicy, { requireComplete: false }),
    [],
  )

  const completeFrozenPolicy = {
    ...incompletePolicy,
    addedRepositoryPaths: [...pr11AllowedRepositoryPaths],
  }
  assert.deepEqual(verifyPr11OperationBoundary(completeFrozenPolicy), [])
  assert.equal(pr11AllowedRepositoryPaths.length, 65)
  assert.equal(pr11SourceEvidencePaths.length, 56)
  assert.equal(pr11AllowedRepositoryPaths.includes(".env.example"), true)
  assert.deepEqual(
    pr11AllowedRepositoryPaths.filter(
      (path) =>
        !pr11SourceEvidencePaths.includes(path) &&
        !pr11GovernancePaths.includes(path),
    ),
    [],
  )

  const escaped = structuredClone(completeFrozenPolicy)
  escaped.addedRepositoryPaths.push("infra/runtime/native-expert-links.yaml")
  assert.match(
    verifyPr11OperationBoundary(escaped).join("\n"),
    /outside package boundary/,
  )

  const secretEnvironment = structuredClone(completeFrozenPolicy)
  secretEnvironment.changedRepositoryPaths.push(".env.production")
  assert.match(
    verifyPr11OperationBoundary(secretEnvironment).join("\n"),
    /secret or key material path is forbidden/,
  )

  const deleting = structuredClone(completeFrozenPolicy)
  deleting.deletedRepositoryPaths.push("apps/web/src/app/chat/page.tsx")
  assert.match(
    verifyPr11OperationBoundary(deleting).join("\n"),
    /must not delete Product paths/,
  )
})

test("PR-11 generated destinations remain generator-owned", () => {
  assert.deepEqual(pr11GeneratedDestinationPaths, [
    "docs/reduction/inference-core/contract-revisions/PR-11.json",
    "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
    "docs/reduction/inference-core/route-baseline.json",
  ])
  assert.deepEqual(verifyPr11GeneratedDestinationBoundary([]), [])
  assert.deepEqual(
    verifyPr11GeneratedDestinationBoundary(pr11GeneratedDestinationPaths),
    pr11GeneratedDestinationPaths.map(
      (path) =>
        `PR-11 generated destination must not be staged before generation ${path}`,
    ),
  )
})

test("PR-11 live register updates retain PR-08 historical fingerprints", () => {
  assert.deepEqual(pr11SuccessorHistoricalEvidenceBindings, [
    {
      retainedRevision: "PR-08",
      path: "docs/reduction/inference-core/decision-register.md",
      evidenceCommit: pr11ContractBase,
    },
    {
      retainedRevision: "PR-08",
      path: "docs/reduction/inference-core/validation-register.md",
      evidenceCommit: pr11ContractBase,
    },
  ])
  const pr08Revision = JSON.parse(
    readFileSync(
      resolve(
        repositoryRoot,
        "docs/reduction/inference-core/contract-revisions/PR-08.json",
      ),
      "utf8",
    ),
  )
  for (const {
    path,
    evidenceCommit,
  } of pr11SuccessorHistoricalEvidenceBindings) {
    const retained = pr08Revision.evidenceFiles.find(
      (entry) => entry.path === path,
    )
    assert.equal(
      sha256(gitAtBuffer(["show", `${evidenceCommit}:${path}`])),
      retained?.sha256,
      `${path} historical bytes must remain bound to PR-08`,
    )
  }
})

test("PR-11 applies one exact route removal and retains the registrar inventory", () => {
  const base = JSON.parse(
    gitAt([
      "show",
      `${pr11ContractBase}:docs/reduction/inference-core/route-baseline.json`,
    ]),
  )
  const current = structuredClone(base)
  current.routes = current.routes.filter(
    (route) =>
      !pr11RemovedRouteContract.some(
        (removedRoute) =>
          JSON.stringify(route) === JSON.stringify(removedRoute),
      ),
  )
  for (const transition of pr11RouteFingerprintTransitions) {
    const fingerprint = current.fingerprints.find(
      (entry) =>
        entry.path === transition.path && entry.symbol === transition.symbol,
    )
    assert.equal(fingerprint?.sha256, transition.beforeSha256)
    fingerprint.sha256 = transition.afterSha256
  }
  assert.deepEqual(verifyPr11RetainedRouteContract(base, current), [])
  const changed = structuredClone(current)
  changed.routes.pop()
  assert.match(
    verifyPr11RetainedRouteContract(base, changed).join("\n"),
    /retained route boundary changed routes/,
  )
  const changedFingerprint = structuredClone(current)
  changedFingerprint.fingerprints.find(
    (entry) => entry.path === pr11RouteFingerprintTransitions[0].path,
  ).sha256 = "0".repeat(64)
  assert.match(
    verifyPr11RetainedRouteContract(base, changedFingerprint).join("\n"),
    /route fingerprint transition changed/,
  )
})

test("PR-11 source boundary enforces the final seven-surface UI", () => {
  assert.deepEqual(
    verifyPr11SourceBoundary(repositoryRoot, currentWorktreePaths()),
    [],
  )
})

test("PR-11 decision file has no unreviewed extra keys", () => {
  const parsed = JSON.parse(
    readFileSync(resolve(repositoryRoot, pr11DecisionPath), "utf8"),
  )
  assert.deepEqual(parsed, readPr11DecisionDocument())
})

function gitAt(args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim()
}

function gitAtBuffer(args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: null,
  })
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function currentWorktreePaths() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repositoryRoot, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
}

function compareHrefEntries(left, right) {
  if (left.path !== right.path) {
    return left.path < right.path ? -1 : 1
  }
  if (left.expression !== right.expression) {
    return left.expression < right.expression ? -1 : 1
  }
  return 0
}
