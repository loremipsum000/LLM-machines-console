import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import {
  pr09AddedRouteContract,
  pr09ContractBase,
  pr09ContractBaseTree,
  pr09ContractRevisionPath,
  pr09DecisionPath,
  pr09LaneAnchor,
  pr09ReviewedDispositions,
  pr09RevisionEvidencePaths,
  pr09RequiredFrozenRepositoryPaths,
  pr09SuccessorAwareHistoricalTestPaths,
  pr09StandaloneDbTestBoundary,
  pr09TargetContract,
  repositoryRoot,
  reviewedPr09NativeIdentifierEvidence,
  reviewedPr09ResolverFingerprints,
  reviewedPr09SourceFingerprints,
  reviewedPr09WebAuthenticationEvidence,
  routeBaselinePath,
  verifyPr09BaseEvidence,
  verifyPr09DecisionDocument,
  verifyPr09OperationBoundary,
  verifyPr09SourceBoundary,
  verifyPr09TargetState,
  verifyReviewedContractRevision,
  verifyReviewedPr09NativeIdentifierEvidence,
  verifyReviewedPr09SourceFingerprints,
} from "./guardrails.mjs"

test("PR-09 is anchored to the accepted PR-08 integration tree", () => {
  assert.equal(pr09ContractBase, "c07d651b1f7d16f777839c3c15783a61271239c3")
  assert.equal(pr09LaneAnchor, pr09ContractBase)
  assert.equal(pr09ContractBaseTree, "0b2e55ce2f4c9be726dde4443a9f0bee91556b69")
  assert.equal(
    git(["rev-parse", `${pr09ContractBase}^{tree}`]),
    pr09ContractBaseTree,
  )
})

test("PR-09 retains every PR-02 through PR-08 evidence file byte-identically", () => {
  assert.deepEqual(verifyPr09BaseEvidence(), [])
})

test("reviewed revision history recognizes only an exact PR-09 append", () => {
  const root = mkdtempSync(join(tmpdir(), "inference-core-pr09-"))
  try {
    execFileSync(
      "git",
      ["clone", "--quiet", "--shared", "--no-checkout", repositoryRoot, root],
      { stdio: "ignore" },
    )
    gitAt(root, ["checkout", "--quiet", pr09ContractBase])
    const baseAllowlist = readJson(
      join(
        root,
        "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
      ),
    )
    const baseRoutes = readJson(join(root, routeBaselinePath))
    const currentRoutes = structuredClone(baseRoutes)
    currentRoutes.reviewedRevisions.push({
      id: "PR-09",
      path: pr09ContractRevisionPath,
      sha256: "a".repeat(64),
    })
    const result = verifyReviewedContractRevision({
      root,
      baseCommit: pr09ContractBase,
      baseAllowlist,
      currentAllowlist: baseAllowlist,
      baseRoutes,
      currentRoutes,
    })

    assert.equal(result.present, true)
    assert.equal(result.id, "PR-09")
    assert.match(
      result.errors.join("\n"),
      /missing reviewed contract revision .*PR-09\.json/,
    )

    const reordered = structuredClone(currentRoutes)
    reordered.reviewedRevisions.reverse()
    assert.match(
      verifyReviewedContractRevision({
        root,
        baseCommit: pr09ContractBase,
        baseAllowlist,
        currentAllowlist: baseAllowlist,
        baseRoutes,
        currentRoutes: reordered,
      }).errors.join("\n"),
      /unsupported reviewed contract revision history transition/,
    )
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test("PR-09 fixes the source-only governance decisions", () => {
  const decision = readJson(resolve(repositoryRoot, pr09DecisionPath))
  assert.deepEqual(decision.reviewedDispositions, pr09ReviewedDispositions)
  assert.deepEqual(
    decision.standaloneDbTestBoundary,
    pr09StandaloneDbTestBoundary,
  )
  assert.deepEqual(
    decision.webAuthenticationEvidence,
    reviewedPr09WebAuthenticationEvidence,
  )
  assert.deepEqual(
    decision.resolverFingerprints,
    reviewedPr09ResolverFingerprints,
  )
  assert.deepEqual(
    decision.sourceFingerprints,
    reviewedPr09SourceFingerprints,
  )
  assert.deepEqual(
    decision.nativeIdentifierEvidence,
    reviewedPr09NativeIdentifierEvidence,
  )
  assert.deepEqual(decision.target, pr09TargetContract)
  assert.equal(decision.reviewStatus, "reviewed")
  assert.equal(
    decision.reviewedDispositions.activityAudit.nativeEventIdentity.persistedAs,
    "audit_events.id",
  )
  assert.equal(
    decision.reviewedDispositions.activityAudit.nativeEventIdentity
      .adapterContract,
    "source-namespaced-deterministic-uuidv5",
  )
  assert.equal(
    decision.reviewedDispositions.activityAudit.nativeEventIdentity
      .pr09Validation,
    "canonical-uuidv5-shape-only",
  )
  assert.equal(
    decision.reviewedDispositions.activityAudit.nativeEventIdentity
      .namespaceDerivationProvenInPr09,
    false,
  )
  assert.equal(
    decision.reviewedDispositions.activityAudit.nativeIdentifiers
      .providerTokenWholeValuePolicy.disposition,
    "reject",
  )
  assert.equal(
    decision.reviewedDispositions.activityAudit.nativeIdentifiers
      .providerTokenWholeValuePolicy.valuesRecordedInGovernance,
    false,
  )
  assert.equal(
    decision.reviewedDispositions.activityAudit.nativeEventIdentity
      .deduplicateByCorrelationId,
    false,
  )
  assert.equal(
    decision.reviewedDispositions.activityAudit.activityAndExportPageCursor
      .pagination,
    "deterministic-live-keyset",
  )
  assert.equal(
    decision.reviewedDispositions.activityAudit.activityAndExportPageCursor
      .crossPageSnapshot,
    false,
  )
  assert.equal(
    Object.hasOwn(
      decision.reviewedDispositions.activityAudit,
      "idempotencyKey",
    ),
    false,
  )
  assert.equal(
    decision.reviewedDispositions.activityAudit.allowedMetadataFields.includes(
      "sourceEventId",
    ),
    false,
  )
  assert.equal(
    decision.reviewedDispositions.activityAudit.allowedMetadataFields.includes(
      "targetType",
    ),
    false,
  )
  assert.equal(
    decision.reviewedDispositions.activityAudit.allowedMetadataFields.includes(
      "targetId",
    ),
    false,
  )
  assert.deepEqual(
    verifyPr09DecisionDocument(decision, { requireReady: true }),
    [],
  )
})

test("PR-09 operation policy is exact, source-only, and complete", () => {
  const decision = readJson(resolve(repositoryRoot, pr09DecisionPath))
  assert.deepEqual(verifyPr09OperationBoundary(decision.operationPolicy), [])
  const repositoryPaths = new Set([
    ...decision.operationPolicy.addedRepositoryPaths,
    ...decision.operationPolicy.changedRepositoryPaths,
  ])
  for (const path of pr09RequiredFrozenRepositoryPaths) {
    assert.equal(repositoryPaths.has(path), true, `missing frozen path ${path}`)
  }
  assert.deepEqual(
    pr09RevisionEvidencePaths.filter((path) =>
      pr09SuccessorAwareHistoricalTestPaths.includes(path),
    ),
    pr09SuccessorAwareHistoricalTestPaths,
  )
  assert.deepEqual(decision.operationPolicy.deletedSourcePaths, [])
  assert.deepEqual(decision.operationPolicy.deletedRepositoryPaths, [])

  const withSecret = structuredClone(decision.operationPolicy)
  withSecret.addedRepositoryPaths.push("infra/observability/signing-private.pem")
  assert.match(
    verifyPr09OperationBoundary(withSecret).join("\n"),
    /secret or key material path is forbidden|outside package boundary/,
  )

  const withRetiredSurface = structuredClone(decision.operationPolicy)
  withRetiredSurface.addedRepositoryPaths.push("apps/bff/src/routes/mcp.ts")
  assert.match(
    verifyPr09OperationBoundary(withRetiredSurface).join("\n"),
    /retired or deferred product path is forbidden|outside package boundary/,
  )
})

test("PR-09 adds only the reviewed activity, audit, alert-egress, and metrics routes", () => {
  assert.equal(pr09TargetContract.routes, 102)
  assert.equal(pr09AddedRouteContract.length, 8)
  assert.deepEqual(pr09TargetContract.routeClassifications, {
    "current-console-seam": 90,
    "operational-auth": 4,
    "private-operational": 4,
    "public-t2": 2,
    "required-now": 2,
  })
  assert.equal(pr09TargetContract.activityAuditPath, "/activity")
  assert.equal(pr09TargetContract.globalNavigationOwner, "PR-11")
  assert.equal(pr09TargetContract.nativeExpertLinksEnabled, false)
})

test("PR-09 source enforces zero-content observability and qualified-runtime deferrals", () => {
  assert.deepEqual(verifyReviewedPr09NativeIdentifierEvidence(), [])
  assert.deepEqual(verifyReviewedPr09SourceFingerprints(), [])
  assert.deepEqual(verifyPr09SourceBoundary(), [])
  assert.equal(pr09ReviewedDispositions.retention.workloadContentDays, 0)
  assert.equal(pr09ReviewedDispositions.auditExport.algorithm, "Ed25519")
  assert.equal(
    pr09ReviewedDispositions.observability.queueDepth.valueEmittedInPr09,
    false,
  )
  assert.equal(pr09ReviewedDispositions.alertEgress.runtimeDelivery, false)
})

test("the reviewed PR-09 baseline satisfies its exact target", () => {
  const currentAllowlist = readJson(
    resolve(
      repositoryRoot,
      "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
    ),
  )
  const currentRoutes = readJson(resolve(repositoryRoot, routeBaselinePath))
  assert.deepEqual(
    verifyPr09TargetState({ currentAllowlist, currentRoutes }),
    [],
  )
})

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
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
