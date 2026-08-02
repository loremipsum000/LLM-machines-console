import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import {
  extractBffRoutes,
  extractFastifyRegistrarManifest,
  pr05AdminOnlyRoutePolicyKeys,
  pr05ContractBase,
  pr05ContractRevisionPath,
  pr05DecisionPath,
  pr05LaneAnchor,
  pr05RecoveryRouteContract,
  pr05ReviewedDispositions,
  pr05StandaloneDbTestBoundary,
  pr06ContractBase,
  repositoryRoot,
  reviewedPr05ResolverFingerprints,
  reviewedPr05WebAuthenticationEvidence,
  reviewedPr09WebAuthenticationEvidence,
  routeBaselinePath,
  verifyPr05BaseEvidence,
  verifyPr05DecisionDocument,
  verifyPr05FindingTransition,
  verifyPr05OperationBoundary,
  verifyPr05TargetState,
  verifyReviewedContractRevision,
  verifyReviewedPr05WebAuthenticationEvidence,
  verifyReviewedPr09WebAuthenticationEvidence,
} from "./guardrails.mjs"

test("PR-05 is anchored to the reviewed PR-04 integration tree", () => {
  assert.equal(pr05ContractBase, "9c502a6d4d79435f469288aa66001db7c4be4aa5")
  assert.equal(pr05LaneAnchor, pr05ContractBase)
  assert.equal(
    git(["rev-parse", `${pr05ContractBase}^{tree}`]),
    "eb80cbc13bec1477a68796a4f1b0c521675a4338",
  )
})

test("PR-05 retains all PR-02, PR-03, and PR-04 evidence byte-identically", () => {
  assert.deepEqual(verifyPr05BaseEvidence(), [])
})

test("reviewed revision history recognizes only an exact PR-05 append", () => {
  const root = mkdtempSync(join(tmpdir(), "inference-core-pr05-"))
  try {
    execFileSync(
      "git",
      ["clone", "--quiet", "--shared", "--no-checkout", repositoryRoot, root],
      { stdio: "ignore" },
    )
    gitAt(root, ["checkout", "--quiet", pr05ContractBase])
    const baseAllowlist = readJson(
      join(
        root,
        "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
      ),
    )
    const baseRoutes = readJson(join(root, routeBaselinePath))
    const currentRoutes = structuredClone(baseRoutes)
    currentRoutes.reviewedRevisions.push({
      id: "PR-05",
      path: pr05ContractRevisionPath,
      sha256: "a".repeat(64),
    })
    const result = verifyReviewedContractRevision({
      root,
      baseCommit: pr05ContractBase,
      baseAllowlist,
      currentAllowlist: baseAllowlist,
      baseRoutes,
      currentRoutes,
    })

    assert.equal(result.present, true)
    assert.equal(result.id, "PR-05")
    assert.match(
      result.errors.join("\n"),
      /missing reviewed contract revision .*PR-05\.json/,
    )

    const reorderedRoutes = structuredClone(currentRoutes)
    reorderedRoutes.reviewedRevisions.reverse()
    assert.match(
      verifyReviewedContractRevision({
        root,
        baseCommit: pr05ContractBase,
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

test("PR-05 decision retains the accepted identity dispositions", () => {
  const decision = readJson(resolve(repositoryRoot, pr05DecisionPath))

  assert.deepEqual(decision.reviewedDispositions, pr05ReviewedDispositions)
  assert.deepEqual(
    pr05ReviewedDispositions.emergencyRecovery.activationAbuseControl,
    {
      concurrentVerifierCapacity: 1,
      admittedAttemptsPerSubject: 5,
      windowSeconds: 60,
      subjectStateCapacity: 1024,
      implementation: "process-local",
      qualification: {
        workPackage: "PR-12",
        exactBffProcessCount: 1,
        multiReplicaRequires: "postgresql-backed-atomic-counter-and-lease",
      },
    },
  )
  assert.deepEqual(
    pr05ReviewedDispositions.delegatedKeycloakAdministration
      .allowedBuiltInNavigationRoles,
    ["query-users", "query-groups"],
  )
  assert.deepEqual(pr05ReviewedDispositions.identityMutationBounds, {
    maximumUnresolvedMutations: 1,
    cooperativeDeadlineMs: 30_000,
    queueAcquireTimeoutMs: 2_000,
    teamBatchMaxItems: 100,
    csvContractMaxBytes: 240 * 1024,
    csvRouteBodyMaxBytes: 256 * 1024,
  })
  assert.deepEqual(verifyPr05DecisionDocument(decision), [])
  if (existsSync(resolve(repositoryRoot, pr05ContractRevisionPath))) {
    assert.deepEqual(
      verifyPr05DecisionDocument(decision, { requireReady: true }),
      [],
    )
  }
})

test("PR-05 operation policy rejects paths outside the identity package", () => {
  const valid = emptyOperationPolicy()
  valid.addedRepositoryPaths = [
    "apps/bff/src/auth/keycloak-jwt-token-type.test.ts",
    "infra/keycloak/inference-core-realm-seed.json",
  ]
  assert.deepEqual(verifyPr05OperationBoundary(valid), [])

  const outside = structuredClone(valid)
  outside.changedRepositoryPaths = ["apps/bff/src/routes/app-gateway.ts"]
  assert.match(
    verifyPr05OperationBoundary(outside).join("\n"),
    /outside package boundary/,
  )

  const priorEvidence = structuredClone(valid)
  priorEvidence.changedRepositoryPaths = [
    "docs/reduction/inference-core/pr-04-data-decisions.json",
  ]
  assert.match(
    verifyPr05OperationBoundary(priorEvidence).join("\n"),
    /immutable prior evidence/,
  )
})

test("PR-05 recovery route target is exact and Console-only", () => {
  assert.deepEqual(
    pr05RecoveryRouteContract.map(({ method, path }) => ({ method, path })),
    [
      { method: "POST", path: "/api/admin/recovery/factor/commission" },
      { method: "POST", path: "/api/admin/recovery/sessions" },
      {
        method: "POST",
        path: "/api/admin/recovery/sessions/:id/revoke",
      },
      { method: "GET", path: "/api/admin/recovery/status" },
    ],
  )
  assert.ok(
    pr05RecoveryRouteContract.every(
      ({ classification, source, surface }) =>
        surface === "bff" &&
        source === "apps/bff/src/routes/admin.ts" &&
        classification === "current-console-seam",
    ),
  )
  assert.deepEqual(pr05AdminOnlyRoutePolicyKeys, [
    "GET /api/admin/recovery/status",
    "POST /api/admin/recovery/factor/commission",
    "POST /api/admin/settings/organization",
    "POST /api/admin/settings/telemetry",
  ])
})

test("PR-05 authorization hook is the only reviewed human pre-handler", () => {
  const root = mkdtempSync(join(tmpdir(), "inference-core-pr05-auth-"))
  try {
    const path = "apps/bff/src/auth/authorization.ts"
    const source = readFileSync(resolve(repositoryRoot, path), "utf8")
    const absolutePath = resolve(root, path)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, source)
    assert.doesNotThrow(() => extractBffRoutes({ root, paths: [path] }))

    const mutated = source.replace(
      'server.addHook("preHandler", authorizationHook(options))',
      'server.addHook("preHandler", unreviewedHook(options))',
    )
    assert.notEqual(mutated, source)
    writeFileSync(absolutePath, mutated)
    assert.throws(
      () => extractBffRoutes({ root, paths: [path] }),
      /Unreviewed Fastify route-control API addHook/,
    )
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test("PR-05 runtime authorization registration is fail-closed", () => {
  const root = mkdtempSync(join(tmpdir(), "inference-core-pr05-runtime-auth-"))
  const path = "apps/bff/src/index.ts"
  const absolutePath = resolve(root, path)
  const source = readFileSync(resolve(repositoryRoot, path), "utf8")
  assert.deepEqual(
    reviewedPr05ResolverFingerprints.slice(0, 3).map(({ path }) => path),
    [
      "apps/bff/src/auth/authorization.ts",
      "apps/bff/src/auth/runtime-live-authority.ts",
      "apps/bff/src/index.ts",
    ],
  )
  const paths = [
    path,
    "apps/bff/src/auth/authorization.ts",
    "apps/bff/src/routes/admin.ts",
    "apps/bff/src/routes/app-gateway.ts",
  ]
  try {
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, source)
    assert.deepEqual(
      extractFastifyRegistrarManifest({ root, paths }).map(
        ({ exportName }) => exportName,
      ),
      [
        "registerAdminRoutes",
        "registerAppGatewayRoutes",
        "registerAuthorization",
      ],
    )

    const oneArgument = source.replace(
      "registerAuthorization(server, authorizationOptions)",
      "registerAuthorization(server)",
    )
    assert.notEqual(oneArgument, source)
    writeFileSync(absolutePath, oneArgument)
    assert.throws(
      () => extractFastifyRegistrarManifest({ root, paths }),
      /registrar arguments changed for registerAuthorization/,
    )

    const productionFixture = source.replace(
      ": createRuntimeAuthorizationOptions(emergencyRecoveryService)",
      ": createTestFixtureAuthorizationOptions(emergencyRecoveryService)",
    )
    assert.notEqual(productionFixture, source)
    writeFileSync(absolutePath, productionFixture)
    assert.throws(
      () => extractFastifyRegistrarManifest({ root, paths }),
      /runtime authority binding changed for authorizationOptions/,
    )
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test("PR-05 route options accept only reviewed capability or exact admin policy", () => {
  const root = mkdtempSync(join(tmpdir(), "inference-core-pr05-policy-"))
  const path = "apps/bff/src/routes/admin.ts"
  const absolutePath = resolve(root, path)
  const source = [
    'import type { FastifyInstance } from "fastify"',
    "declare const handler: unknown",
    "declare function withCapability(capability: string): unknown",
    "declare function reviewedAdminOnly(route: string): unknown",
    "export interface AdminRouteOptions { emergencyIsolationService: unknown; emergencyRecoveryService: unknown }",
    "export function registerAdminRoutes(",
    "  server: FastifyInstance,",
    "  options: AdminRouteOptions = { emergencyIsolationService: null, emergencyRecoveryService: null, },",
    "): void {",
    '  server.get("/api/admin/audit", withCapability("console.operational.view"), handler)',
    '  server.post("/api/admin/settings/organization", reviewedAdminOnly("POST /api/admin/settings/organization"), handler)',
    "  void options",
    "}",
    "",
  ].join("\n")
  try {
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, source)
    assert.doesNotThrow(() => extractBffRoutes({ root, paths: [path] }))

    writeFileSync(
      absolutePath,
      source.replace(
        'withCapability("console.operational.view")',
        'withCapability("unreviewed.capability")',
      ),
    )
    assert.throws(
      () => extractBffRoutes({ root, paths: [path] }),
      /Fastify shorthand route options must be reviewed inline options/,
    )

    writeFileSync(
      absolutePath,
      source.replace(
        'server.get("/api/admin/audit", withCapability("console.operational.view"), handler)',
        'server.get("/api/admin/audit", handler)',
      ),
    )
    assert.throws(
      () => extractBffRoutes({ root, paths: [path] }),
      /Protected Admin route requires a reviewed authorization policy/,
    )

    writeFileSync(
      absolutePath,
      source.replace(
        'reviewedAdminOnly("POST /api/admin/settings/organization")',
        'reviewedAdminOnly("POST /api/admin/other")',
      ),
    )
    assert.throws(
      () => extractBffRoutes({ root, paths: [path] }),
      /Fastify shorthand route options must be reviewed inline options/,
    )

    writeFileSync(
      absolutePath,
      source.replaceAll(
        "/api/admin/settings/organization",
        "/api/admin/unreviewed",
      ),
    )
    assert.throws(
      () => extractBffRoutes({ root, paths: [path] }),
      /Fastify shorthand route options must be reviewed inline options/,
    )
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test("PR-05 extends the standalone DB workspace only with identity and recovery tests", () => {
  assert.deepEqual(
    pr05StandaloneDbTestBoundary.allowedPaths.filter((path) =>
      path.includes("/pr05-"),
    ),
    [
      "test-support/inference-core-db-tests/src/pr05-emergency-recovery.test.ts",
      "test-support/inference-core-db-tests/src/pr05-identity-mutation-journal.test.ts",
    ],
  )
})

test("PR-05 removes every due Persona finding and retains only the builder tombstone", () => {
  const tombstone = {
    ruleId: "FS105_BUILDER_HUB",
    path: "apps/web/src/middleware.test.ts",
    count: 1,
    fingerprints: { retained: 1 },
    removeBy: "PR-12",
  }
  const persona = {
    ruleId: "FS109_LEGACY_PERSONA",
    path: "apps/bff/src/auth/persona.ts",
    count: 1,
    fingerprints: { due: 1 },
    removeBy: "PR-05",
  }

  assert.deepEqual(
    verifyPr05FindingTransition([tombstone, persona], [tombstone]),
    [],
  )
  assert.match(
    verifyPr05FindingTransition(
      [tombstone, persona],
      [tombstone, persona],
    ).join("\n"),
    /legacy Persona findings remain/,
  )
})

test("PR-05 evidence remains historical while PR-09 owns the live successor", () => {
  const root = mkdtempSync(join(tmpdir(), "inference-core-pr05-web-evidence-"))
  try {
    execFileSync(
      "git",
      ["clone", "--quiet", "--shared", "--no-checkout", repositoryRoot, root],
      { stdio: "ignore" },
    )
    gitAt(root, ["checkout", "--quiet", pr06ContractBase])
    assert.equal(reviewedPr05WebAuthenticationEvidence.length, 2)
    assert.deepEqual(verifyReviewedPr05WebAuthenticationEvidence(root), [])
  } finally {
    rmSync(root, { force: true, recursive: true })
  }

  assert.equal(reviewedPr09WebAuthenticationEvidence.length, 2)
  assert.deepEqual(verifyReviewedPr09WebAuthenticationEvidence(), [])
})

test("an activated PR-05 baseline satisfies the identity target", () => {
  const baseline = readJson(resolve(repositoryRoot, routeBaselinePath))
  if (!(baseline.reviewedRevisions ?? []).some(({ id }) => id === "PR-05")) {
    return
  }

  const allowlist = readJson(
    resolve(
      repositoryRoot,
      "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
    ),
  )
  assert.deepEqual(
    verifyPr05TargetState({
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
