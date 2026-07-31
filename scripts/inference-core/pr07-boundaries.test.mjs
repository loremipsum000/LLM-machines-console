import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import {
  pr07ContractBase,
  pr07ContractRevisionPath,
  pr07DecisionPath,
  pr07LaneAnchor,
  pr07PublicInferenceRouteContract,
  pr07ReviewedDispositions,
  pr07StandaloneDbTestBoundary,
  pr07TargetContract,
  repositoryRoot,
  routeBaselinePath,
  verifyPr07BaseEvidence,
  verifyPr07DecisionDocument,
  verifyPr07FindingTransition,
  verifyPr07OperationBoundary,
  verifyPr07RetainedFirecrawlBoundary,
  verifyPr07TargetState,
  verifyReviewedContractRevision,
} from "./guardrails.mjs"

test("PR-07 is anchored to the accepted PR-06 integration tree", () => {
  assert.equal(pr07ContractBase, "cd5a389cde949d07aa64ef7a0513cb585bb8bb7a")
  assert.equal(pr07LaneAnchor, pr07ContractBase)
  assert.equal(
    git(["rev-parse", `${pr07ContractBase}^{tree}`]),
    "3a5189b785371ff44ad4ac8700f54564b52aab22",
  )
})

test("PR-07 retains every PR-02 through PR-06 evidence file byte-identically", () => {
  assert.deepEqual(verifyPr07BaseEvidence(), [])
})

test("reviewed revision history recognizes only an exact PR-07 append", () => {
  const root = mkdtempSync(join(tmpdir(), "inference-core-pr07-"))
  try {
    execFileSync(
      "git",
      ["clone", "--quiet", "--shared", "--no-checkout", repositoryRoot, root],
      { stdio: "ignore" },
    )
    gitAt(root, ["checkout", "--quiet", pr07ContractBase])
    const baseAllowlist = readJson(
      join(
        root,
        "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
      ),
    )
    const baseRoutes = readJson(join(root, routeBaselinePath))
    const currentRoutes = structuredClone(baseRoutes)
    currentRoutes.reviewedRevisions.push({
      id: "PR-07",
      path: pr07ContractRevisionPath,
      sha256: "a".repeat(64),
    })
    const result = verifyReviewedContractRevision({
      root,
      baseCommit: pr07ContractBase,
      baseAllowlist,
      currentAllowlist: baseAllowlist,
      baseRoutes,
      currentRoutes,
    })

    assert.equal(result.present, true)
    assert.equal(result.id, "PR-07")
    assert.match(
      result.errors.join("\n"),
      /missing reviewed contract revision .*PR-07\.json/,
    )

    const reorderedRoutes = structuredClone(currentRoutes)
    reorderedRoutes.reviewedRevisions.reverse()
    assert.match(
      verifyReviewedContractRevision({
        root,
        baseCommit: pr07ContractBase,
        baseAllowlist,
        currentAllowlist: baseAllowlist,
        baseRoutes,
        currentRoutes: reorderedRoutes,
      }).errors.join("\n"),
      /unsupported reviewed contract revision history transition/,
    )
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test("PR-07 decision records the bounded inference data-plane package", () => {
  const decision = readJson(resolve(repositoryRoot, pr07DecisionPath))

  assert.deepEqual(decision.reviewedDispositions, pr07ReviewedDispositions)
  assert.deepEqual(
    decision.standaloneDbTestBoundary,
    pr07StandaloneDbTestBoundary,
  )
  assert.deepEqual(decision.target, pr07TargetContract)
  assert.deepEqual(verifyPr07DecisionDocument(decision), [])
  assert.equal(decision.reviewStatus, "reviewed")
  assert.deepEqual(
    verifyPr07DecisionDocument(decision, { requireReady: true }),
    [],
  )
  assert.ok(decision.operationPolicy.addedSourcePaths.length > 0)
  assert.ok(decision.operationPolicy.changedSourcePaths.length > 0)
  assert.ok(decision.operationPolicy.addedRepositoryPaths.length > 0)
  assert.ok(decision.operationPolicy.changedRepositoryPaths.length > 0)
})

test("PR-07 fixes the customer-owned-hardware policy and PR-09 alert boundary", () => {
  const policy = pr07ReviewedDispositions.customerOwnedHardwarePolicy
  assert.deepEqual(policy.priorityOrder, [
    "usage-accounting",
    "rate-protection",
    "application-permissions",
    "operational-alerts",
  ])
  assert.equal(policy.usageOrTokenThreshold, "metadata-signal-non-blocking")
  assert.deepEqual(policy.usageAccountingSignals, [
    "requests",
    "failures",
    "input-output-total-tokens",
    "latency",
    "exact-allowed-model-alias",
  ])
  assert.deepEqual(policy.optionalRateProtectionControls, [
    "requests-per-second",
    "concurrency",
  ])
  assert.deepEqual(policy.applicationPermissions, [
    "model-alias-allowlist",
    "max-context-size",
  ])
  assert.deepEqual(policy.operationalAlertSignals, [
    "gpu-saturation",
    "queue-depth",
    "failures",
  ])
  assert.equal(
    policy.rateProtectionPurpose,
    "protect-appliance-without-arbitrary-usage-rationing",
  )
  assert.equal(policy.firecrawlPermissionOwner, "PR-08")
  assert.equal(policy.metadataSignalOwner, "PR-07")
  assert.equal(policy.alertPresentationAndDeliveryOwner, "PR-09")

  const decision = readJson(resolve(repositoryRoot, pr07DecisionPath))
  const invalid = structuredClone(decision)
  invalid.reviewedDispositions.customerOwnedHardwarePolicy.usageOrTokenThreshold =
    "blocking-budget"
  assert.match(
    verifyPr07DecisionDocument(invalid).join("\n"),
    /customer-owned-hardware signal boundary changed/,
  )
})

test("PR-07 fixes authentication, alias, transport, and retention boundaries", () => {
  const dispositions = pr07ReviewedDispositions
  assert.equal(
    dispositions.applicationAuthentication.realmTopology,
    "dedicated-application-realm",
  )
  assert.equal(
    dispositions.applicationAuthentication
      .oauthAccessTokenMaximumLifetimeSeconds,
    300,
  )
  assert.equal(dispositions.modelAliasPolicy.silentSubstitution, false)
  assert.equal(
    dispositions.publicInferenceApi.toolCalls,
    "transport-only-never-executed",
  )
  assert.equal(dispositions.retention.workloadContentPersistence, false)
  assert.equal(dispositions.scopeBoundaries.firecrawl, "excluded-PR-08")
  assert.equal(
    dispositions.scopeBoundaries.runtimeDeploymentAndQualification,
    "excluded-PR-12",
  )

  const decision = readJson(resolve(repositoryRoot, pr07DecisionPath))
  for (const mutate of [
    (candidate) => {
      candidate.reviewedDispositions.applicationAuthentication.oauthAccessTokenMaximumLifetimeSeconds = 301
    },
    (candidate) => {
      candidate.reviewedDispositions.modelAliasPolicy.silentSubstitution = true
    },
    (candidate) => {
      candidate.reviewedDispositions.publicInferenceApi.toolCalls =
        "execute-server-side"
    },
    (candidate) => {
      candidate.reviewedDispositions.retention.promptsPersisted = true
    },
  ]) {
    const invalid = structuredClone(decision)
    mutate(invalid)
    assert.notDeepEqual(verifyPr07DecisionDocument(invalid), [])
  }
})

test("PR-07 operation policy admits only the reviewed data-plane package", () => {
  const valid = emptyOperationPolicy()
  valid.addedRepositoryPaths = [
    "apps/bff/src/auth/application-access-token.test.ts",
    "apps/bff/src/auth/application-access-token.ts",
    "apps/bff/src/inference/chat-completions.ts",
    "apps/bff/src/inference/chat-completions.test.ts",
    "scripts/inference-core/pr07-boundaries.test.mjs",
    "test-support/inference-core-db-tests/src/pr07-inference-data-plane.test.ts",
  ].sort()
  valid.addedSourcePaths = [
    "apps/bff/src/auth/application-access-token.ts",
    "apps/bff/src/inference/chat-completions.ts",
  ].sort()
  valid.changedRepositoryPaths = [
    "apps/bff/src/auth/keycloak-jwt.ts",
    "apps/bff/src/routes/app-gateway.ts",
    "apps/web/src/components/console-v2/applications-v2-experience.test.tsx",
    "apps/web/src/lib/admin/actions-core.test.ts",
    "docs/reduction/inference-core/retention-characterization.json",
    "infra/migrations/0000_inference_core.sql",
  ].sort()
  valid.changedSourcePaths = [
    "apps/bff/src/auth/keycloak-jwt.ts",
    "apps/bff/src/routes/app-gateway.ts",
  ].sort()
  assert.deepEqual(verifyPr07OperationBoundary(valid), [])

  for (const path of [
    "apps/bff/src/routes/firecrawl.ts",
    "apps/bff/src/auth/unreviewed-runtime.ts",
    "apps/web/src/components/console-v2/activity-audit.tsx",
    "infra/keycloak/inference-core-application-realm-seed.json",
  ]) {
    const outside = emptyOperationPolicy()
    outside.changedRepositoryPaths = [path]
    assert.match(
      verifyPr07OperationBoundary(outside).join("\n"),
      /outside package boundary/,
    )
  }

  const priorEvidence = emptyOperationPolicy()
  priorEvidence.changedRepositoryPaths = [
    "docs/reduction/inference-core/pr-06-application-decisions.json",
  ]
  assert.match(
    verifyPr07OperationBoundary(priorEvidence).join("\n"),
    /immutable prior evidence/,
  )
})

test("PR-07 retains Firecrawl configuration and product references exactly", () => {
  assert.deepEqual(verifyPr07RetainedFirecrawlBoundary(), [])
  const root = mkdtempSync(join(tmpdir(), "inference-core-pr07-firecrawl-"))
  try {
    execFileSync(
      "git",
      ["clone", "--quiet", "--shared", "--no-checkout", repositoryRoot, root],
      { stdio: "ignore" },
    )
    gitAt(root, ["checkout", "--quiet", pr07ContractBase])
    const path = join(root, ".env.example")
    writeFileSync(
      path,
      `${readFileSync(path, "utf8")}FIRECRAWL_PR07_MUTATION=true\n`,
    )
    assert.match(
      verifyPr07RetainedFirecrawlBoundary(root).join("\n"),
      /PR-07 Firecrawl boundary changed \.env\.example/,
    )
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test("PR-07 standalone DB boundary adds only the inference data-plane test", () => {
  assert.deepEqual(
    pr07StandaloneDbTestBoundary.allowedPaths.filter((path) =>
      path.includes("/pr07-"),
    ),
    [
      "test-support/inference-core-db-tests/src/pr07-inference-data-plane.test.ts",
    ],
  )
})

test("PR-07 retains exactly two public inference routes", () => {
  assert.deepEqual(
    pr07PublicInferenceRouteContract.map(({ method, path }) => ({
      method,
      path,
    })),
    [
      { method: "GET", path: "/api/app-gateway/v1/models" },
      { method: "POST", path: "/api/app-gateway/v1/chat/completions" },
    ],
  )
  assert.equal(pr07TargetContract.routes, 86)
  assert.equal(pr07TargetContract.routeClassifications["required-now"], 2)
})

test("PR-07 retains the PR-12 tombstone and introduces no due finding", () => {
  const tombstone = {
    ruleId: "FS105_BUILDER_HUB",
    path: "apps/web/src/middleware.test.ts",
    count: 1,
    fingerprints: { retained: 1 },
    removeBy: "PR-12",
  }
  assert.deepEqual(verifyPr07FindingTransition([tombstone], [tombstone]), [])
})

test("PR-07 records a source no-content-retention contract without runtime overclaim", () => {
  const register = readJson(
    resolve(
      repositoryRoot,
      "docs/reduction/inference-core/retention-characterization.json",
    ),
  )
  assert.deepEqual(register.sourceRetentionContract, {
    scope: "public-inference-data-plane",
    workloadContentPersistence: false,
    metadataOnly: true,
    runtimeQualificationOwner: "PR-12",
  })
  assert.equal(register.runtimeZeroRetentionCompliance, "NOT_EVALUATED")
  assert.equal(
    register.legacyGaps.some(({ id }) => id === "ZR-LEGACY-001"),
    false,
  )
})

test("an activated PR-07 baseline satisfies the reviewed data-plane target", () => {
  const baseline = readJson(resolve(repositoryRoot, routeBaselinePath))
  if (!(baseline.reviewedRevisions ?? []).some(({ id }) => id === "PR-07")) {
    return
  }
  const allowlist = readJson(
    resolve(
      repositoryRoot,
      "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
    ),
  )
  assert.deepEqual(
    verifyPr07TargetState({
      root: repositoryRoot,
      currentAllowlist: allowlist,
      currentRoutes: baseline,
      paths: baseline.repositoryClosure.map(({ path }) => path),
    }),
    [],
  )
})

function emptyOperationPolicy() {
  return {
    addedSourcePaths: [],
    changedSourcePaths: [],
    deletedSourcePaths: [],
    addedRepositoryPaths: [],
    changedRepositoryPaths: [],
    deletedRepositoryPaths: [],
  }
}

function git(args) {
  return gitAt(repositoryRoot, args)
}

function gitAt(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
  }).trim()
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}
