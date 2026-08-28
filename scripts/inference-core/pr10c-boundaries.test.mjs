import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import {
  buildPr10cSourceEvidence,
  extractBffRoutes,
  extractFastifyRegistrarManifest,
  pr10ContractRevisionPath,
  pr10cAddedRouteContract,
  pr10cAdminOnlyRoutePolicyKeys,
  pr10cContractBase,
  pr10cContractBaseTree,
  pr10cContractRevisionPath,
  pr10cDecisionPath,
  pr10cGeneratedDestinationPaths,
  pr10cGovernancePaths,
  pr10cIsolationFailureCodes,
  pr10cIsolationStates,
  pr10cLaneAnchor,
  pr10cMutationAdminOnlyRoutePolicyKeys,
  pr10cReviewedDispositions,
  pr10cRouteFingerprintTransitions,
  pr10cSourceEvidencePaths,
  pr10cTargetContract,
  repositoryRoot,
  routeBaselinePath,
  verifyPr10cBaseEvidence,
  verifyPr10cDecisionDocument,
  verifyPr10cGeneratedDestinationBoundary,
  verifyPr10cOperationBoundary,
  verifyPr10cRetainedRouteContract,
  verifyPr10cSourceBoundary,
  verifyReviewedContractRevision,
} from "./guardrails.mjs"

test("PR-10C is anchored to the accepted PR-10 integration tree", () => {
  assert.equal(pr10cContractBase, "f29ea2a0c69871973ea553d3edf83b783d6c9879")
  assert.equal(pr10cLaneAnchor, pr10cContractBase)
  assert.equal(
    pr10cContractBaseTree,
    "991109ad85e0c454af62ed42c4a5a69068b301e0",
  )
  assert.equal(
    gitAt(repositoryRoot, ["rev-parse", `${pr10cContractBase}^{tree}`]),
    pr10cContractBaseTree,
  )
})

test("PR-10C retains every PR-02 through PR-10 evidence file byte-identically", () => {
  assert.deepEqual(verifyPr10cBaseEvidence(), [])
})

test("PR-10C fixes exactly three source-only emergency isolation routes", () => {
  const decision = readJson(resolve(repositoryRoot, pr10cDecisionPath))
  assert.deepEqual(decision.reviewedDispositions, pr10cReviewedDispositions)
  assert.deepEqual(decision.target, pr10cTargetContract)
  assert.deepEqual(decision.target.addedRoutes, pr10cAddedRouteContract)
  assert.equal(decision.target.routes, 105)
  assert.equal(decision.target.routeClassifications["current-console-seam"], 93)
  assert.equal(decision.target.isolationRoutes, 3)
  assert.equal(decision.target.runtimeQualified, false)
  assert.equal(decision.target.liveQualificationOwner, "PR-12")
  assert.equal(decision.target.vendorMaintenanceAccessOwner, "PR-10D")
  assert.deepEqual(
    decision.target.routeFingerprintTransitions,
    pr10cRouteFingerprintTransitions,
  )
  assert.deepEqual(verifyPr10cDecisionDocument(decision), [])
  assert.equal(decision.reviewStatus, "reviewed")
  assert.deepEqual(
    verifyPr10cDecisionDocument(decision, { requireReady: true }),
    [],
  )
})

test("PR-10C binds standing-Admin mutations, fresh MFA, and bounded failures", () => {
  const dispositions = pr10cReviewedDispositions
  assert.deepEqual(dispositions.isolationState.states, pr10cIsolationStates)
  assert.deepEqual(
    dispositions.isolationState.failureCodes,
    pr10cIsolationFailureCodes,
  )
  assert.deepEqual(pr10cIsolationFailureCodes, [
    "state_invalid",
    "admission_fence_failed",
    "inflight_abort_failed",
    "enforcement_failed",
    "verification_failed",
    "restore_reassertion_failed",
    "journal_failed",
  ])
  assert.deepEqual(dispositions.routeAuthorization.status, {
    method: "GET",
    path: "/api/admin/isolation",
    capability: "console.operational.view",
    allowedRoles: ["Admin", "Operator"],
  })
  assert.deepEqual(
    dispositions.routeAuthorization.mutations.map(
      ({ method, path, standingRole, emergencyElevatedOperatorAllowed }) => ({
        method,
        path,
        standingRole,
        emergencyElevatedOperatorAllowed,
      }),
    ),
    [
      {
        method: "POST",
        path: "/api/admin/isolation/activate",
        standingRole: "Admin",
        emergencyElevatedOperatorAllowed: false,
      },
      {
        method: "POST",
        path: "/api/admin/isolation/deactivate",
        standingRole: "Admin",
        emergencyElevatedOperatorAllowed: false,
      },
    ],
  )
  assert.deepEqual(pr10cMutationAdminOnlyRoutePolicyKeys, [
    "POST /api/admin/isolation/activate",
    "POST /api/admin/isolation/deactivate",
  ])
  assert.equal(
    dispositions.routeAuthorization.mutationReauthentication
      .maxAuthenticationAgeSeconds,
    300,
  )
  assert.deepEqual(
    dispositions.routeAuthorization.mutationReauthentication.acceptedMfaMethods,
    ["otp", "hwk", "webauthn", "webauthn-passwordless"],
  )
  assert.equal(
    dispositions.trafficEnforcement
      .activationWaitsForInflightAbortAndZeroLocalLeases,
    true,
  )
  for (const property of [
    "terminalFinalizationReservation",
    "successAccountingAndResponseShareFinalizationLane",
    "engagementWaitsForFinalizingResponseRelease",
    "isolationFirstSettlesFailureExactlyOnce",
    "deactivationCommitReservation",
    "admissionsCannotInvalidatePreparedDeactivation",
    "localOpenOccursOnlyAfterDurableInactiveCommit",
  ]) {
    assert.equal(dispositions.trafficEnforcement[property], true)
  }
  assert.equal(
    dispositions.restoreSafety.everyAdmittedRestoreEndsDurableRecoveryRequired,
    true,
  )
  assert.equal(
    dispositions.restoreSafety
      .fenceAcquisitionPersistsAndReadsBackRecoveryRequiredBeforeAnyActiveRestore,
    true,
  )
  for (const property of [
    "nonRestorableAuthorityRequired",
    "unboundOrUnavailableAuthorityFailsClosed",
    "operationScopedMarkerCompareAndSet",
    "startupReconcilesMarkerBeforeInactiveCanOpen",
    "markerAcquisitionFailureAttemptsConsoleRecoveryBeforeReject",
    "mutationsBlockedUntilMarkerClearLinearization",
    "markerClearRequiresConsoleRecoveryReadback",
    "unfencedJournalAdmissionSealsUntilReconciled",
    "preparedUnfencedRestoreCasToRecoveryRequiredBeforeValidation",
    "survivingMarkerClearRequiresMatchingTerminalRestore",
    "unresolvedOrUnknownMarkerOwnerNeverClearedAtBootstrap",
    "lifecycleReconciliationLockedAndIdempotent",
  ]) {
    assert.equal(dispositions.restoreSafety[property], true)
  }
  assert.deepEqual(dispositions.restoreSafety.postAdmissionOrdering, [
    "journal.begin-created",
    "durable-recovery-required-fence-acquired-and-read-back",
    "prepareRestore-validation",
    "quiesce",
  ])
  assert.equal(
    dispositions.restoreSafety.fenceOrderingExemption,
    "pre-admission-manifest-rejection-only",
  )
  assert.equal(
    dispositions.restoreSafety
      .recoveryRequiredReassertedAfterEveryAppliedOrPartialRestoreFailureBeforeReturnOrResume,
    true,
  )
  assert.equal(
    dispositions.deferredWork
      .nonRestorableAuthorityBackendAndQualificationOwner,
    "PR-12",
  )
  for (const key of pr10cMutationAdminOnlyRoutePolicyKeys) {
    assert.equal(pr10cAdminOnlyRoutePolicyKeys.includes(key), true)
  }
})

test("PR-10C operation policy is reviewed, exact, and package bounded", () => {
  const decision = readJson(resolve(repositoryRoot, pr10cDecisionPath))
  assert.equal(decision.reviewStatus, "reviewed")
  assert.deepEqual(
    verifyPr10cOperationBoundary(decision.operationPolicy, {
      requireComplete: false,
    }),
    [],
  )
  assert.deepEqual(verifyPr10cOperationBoundary(decision.operationPolicy), [])

  const completeGovernancePolicy = {
    addedSourcePaths: [],
    changedSourcePaths: [],
    deletedSourcePaths: [],
    addedRepositoryPaths: [...pr10cGovernancePaths],
    changedRepositoryPaths: [],
    deletedRepositoryPaths: [],
  }
  assert.deepEqual(verifyPr10cOperationBoundary(completeGovernancePolicy), [])

  const escaped = structuredClone(completeGovernancePolicy)
  escaped.addedRepositoryPaths.push("infra/runtime/firewall-isolation.yaml")
  assert.match(
    verifyPr10cOperationBoundary(escaped).join("\n"),
    /outside package boundary/,
  )

  const historicalRewrite = structuredClone(completeGovernancePolicy)
  historicalRewrite.addedRepositoryPaths.push(pr10ContractRevisionPath)
  assert.match(
    verifyPr10cOperationBoundary(historicalRewrite).join("\n"),
    /immutable prior evidence appears in operation policy/,
  )
})

test("PR-10C generated destinations remain generator-owned", () => {
  assert.deepEqual(pr10cGeneratedDestinationPaths, [
    "docs/reduction/inference-core/contract-revisions/PR-10C.json",
    "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
    "docs/reduction/inference-core/route-baseline.json",
  ])
  assert.deepEqual(verifyPr10cGeneratedDestinationBoundary([]), [])
  assert.deepEqual(
    verifyPr10cGeneratedDestinationBoundary(pr10cGeneratedDestinationPaths),
    pr10cGeneratedDestinationPaths.map(
      (path) =>
        `PR-10C generated destination must not be staged before generation ${path}`,
    ),
  )
})

test("PR-10C retains every accepted route and appends only its three routes", () => {
  const baseRoutes = readJsonAtCommit(pr10cContractBase, routeBaselinePath)
  const currentRoutes = structuredClone(baseRoutes)
  currentRoutes.routes.push(...structuredClone(pr10cAddedRouteContract))
  for (const transition of pr10cRouteFingerprintTransitions) {
    const fingerprint = currentRoutes.fingerprints.find(
      (entry) =>
        entry.path === transition.path && entry.symbol === transition.symbol,
    )
    assert.ok(fingerprint)
    assert.equal(fingerprint.sha256, transition.beforeSha256)
    fingerprint.sha256 = transition.afterSha256
  }
  assert.deepEqual(
    verifyPr10cRetainedRouteContract(baseRoutes, currentRoutes),
    [],
  )

  currentRoutes.routes[0].classification = "legacy-retired"
  assert.match(
    verifyPr10cRetainedRouteContract(baseRoutes, currentRoutes).join("\n"),
    /retained route inventory changed/,
  )
})

test("PR-10C source exposes only the reviewed route and registrar surface", () => {
  const paths = repositoryPaths(repositoryRoot)
  const r1s1Source = existsSync(
    resolve(repositoryRoot, "infra/keycloak/pr11a-console-session-policy.json"),
  )
  const isolationRoutes = extractBffRoutes({
    root: repositoryRoot,
    paths,
  }).filter((route) => route.path.startsWith("/api/admin/isolation"))
  assert.deepEqual(isolationRoutes, pr10cAddedRouteContract)
  assert.deepEqual(
    extractFastifyRegistrarManifest({ root: repositoryRoot, paths }),
    r1s1Source
      ? [
          ...pr10cTargetContract.fastifyRegistrars.slice(0, 3),
          {
            exportName: "registerConsoleSessionRoutes",
            importSource: "./routes/console-session",
            sourcePath: "apps/bff/src/routes/console-session.ts",
          },
          ...pr10cTargetContract.fastifyRegistrars.slice(3),
        ]
      : pr10cTargetContract.fastifyRegistrars,
  )
  assert.deepEqual(verifyPr10cSourceBoundary(repositoryRoot, paths), [])
})

test("reviewed history recognizes only an exact PR-10C append", () => {
  withBaseClone("revision", (root) => {
    const baseAllowlist = readJson(
      resolve(
        root,
        "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
      ),
    )
    const baseRoutes = readJson(resolve(root, routeBaselinePath))
    const currentRoutes = structuredClone(baseRoutes)
    currentRoutes.reviewedRevisions.push({
      id: "PR-10C",
      path: pr10cContractRevisionPath,
      sha256: "a".repeat(64),
    })

    const result = verifyReviewedContractRevision({
      root,
      baseCommit: pr10cContractBase,
      baseAllowlist,
      currentAllowlist: baseAllowlist,
      baseRoutes,
      currentRoutes,
    })
    assert.equal(result.present, true)
    assert.equal(result.id, "PR-10C")
    assert.match(
      result.errors.join("\n"),
      /missing reviewed contract revision .*PR-10C\.json/,
    )

    const reordered = structuredClone(currentRoutes)
    reordered.reviewedRevisions.reverse()
    assert.match(
      verifyReviewedContractRevision({
        root,
        baseCommit: pr10cContractBase,
        baseAllowlist,
        currentAllowlist: baseAllowlist,
        baseRoutes,
        currentRoutes: reordered,
      }).errors.join("\n"),
      /unsupported reviewed contract revision history transition/,
    )
  })
})

test("reviewed PR-10C source evidence is evaluated against the supplied root", () => {
  const root = mkdtempSync(joinTmp("inference-core-pr10c-evidence-"))
  try {
    for (const path of pr10cSourceEvidencePaths) {
      copyCurrentPath(root, path)
    }
    const decision = readJson(resolve(repositoryRoot, pr10cDecisionPath))
    decision.reviewStatus = "reviewed"
    decision.sourceEvidence = buildPr10cSourceEvidence(root)
    assert.doesNotMatch(
      verifyPr10cDecisionDocument(decision, { root }).join("\n"),
      /invalid PR-10C source evidence/,
    )

    const changedPath = resolve(root, pr10cSourceEvidencePaths[0])
    writeFileSync(changedPath, `${readFileSync(changedPath, "utf8")}\n`)
    assert.match(
      verifyPr10cDecisionDocument(decision, { root }).join("\n"),
      /invalid PR-10C source evidence/,
    )
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

function withBaseClone(label, run) {
  const root = mkdtempSync(joinTmp(`inference-core-pr10c-${label}-`))
  try {
    execFileSync(
      "git",
      ["clone", "--quiet", "--shared", "--no-checkout", repositoryRoot, root],
      { stdio: "ignore" },
    )
    gitAt(root, ["checkout", "--quiet", pr10cContractBase])
    run(root)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

function copyCurrentPath(root, path) {
  const destination = resolve(root, path)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(resolve(repositoryRoot, path), destination)
}

function joinTmp(prefix) {
  return resolve(tmpdir(), prefix)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function readJsonAtCommit(commit, path) {
  return JSON.parse(
    execFileSync(
      "git",
      ["show", "--no-ext-diff", "--no-textconv", `${commit}:${path}`],
      { cwd: repositoryRoot, encoding: "utf8" },
    ),
  )
}

function gitAt(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

function repositoryPaths(root) {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "buffer" },
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort()
}
