import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
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
  pr06AddedApplicationRouteContract,
  pr06ContractBase,
  pr06ContractRevisionPath,
  pr06DecisionPath,
  pr06LaneAnchor,
  pr06RetiredApplicationBoundaryPaths,
  pr06ReviewedDispositions,
  pr06StandaloneDbTestBoundary,
  pr06TargetContract,
  repositoryRoot,
  reviewedPr05ResolverFingerprints,
  reviewedPr06ResolverFingerprints,
  routeBaselinePath,
  verifyPr06BaseEvidence,
  verifyPr06DecisionDocument,
  verifyPr06FindingTransition,
  verifyPr06OperationBoundary,
  verifyPr06RetiredApplicationBoundary,
  verifyPr06TargetState,
  verifyReviewedContractRevision,
} from "./guardrails.mjs"

test("PR-06 is anchored to the reviewed PR-05 integration tree", () => {
  assert.equal(pr06ContractBase, "da6f0c0a2b5e477449a09527a28c7e51ef432c20")
  assert.equal(pr06LaneAnchor, pr06ContractBase)
  assert.equal(
    git(["rev-parse", `${pr06ContractBase}^{tree}`]),
    "51d910bc0aef02ead3d17e270e63cd33ef10cb11",
  )
})

test("PR-06 retains all PR-02 through PR-05 evidence byte-identically", () => {
  assert.deepEqual(verifyPr06BaseEvidence(), [])
})

test("reviewed revision history recognizes only an exact PR-06 append", () => {
  const root = mkdtempSync(join(tmpdir(), "inference-core-pr06-"))
  try {
    execFileSync(
      "git",
      ["clone", "--quiet", "--shared", "--no-checkout", repositoryRoot, root],
      { stdio: "ignore" },
    )
    gitAt(root, ["checkout", "--quiet", pr06ContractBase])
    const baseAllowlist = readJson(
      join(
        root,
        "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
      ),
    )
    const baseRoutes = readJson(join(root, routeBaselinePath))
    const currentRoutes = structuredClone(baseRoutes)
    currentRoutes.reviewedRevisions.push({
      id: "PR-06",
      path: pr06ContractRevisionPath,
      sha256: "a".repeat(64),
    })
    const result = verifyReviewedContractRevision({
      root,
      baseCommit: pr06ContractBase,
      baseAllowlist,
      currentAllowlist: baseAllowlist,
      baseRoutes,
      currentRoutes,
    })

    assert.equal(result.present, true)
    assert.equal(result.id, "PR-06")
    assert.match(
      result.errors.join("\n"),
      /missing reviewed contract revision .*PR-06\.json/,
    )

    const reorderedRoutes = structuredClone(currentRoutes)
    reorderedRoutes.reviewedRevisions.reverse()
    assert.match(
      verifyReviewedContractRevision({
        root,
        baseCommit: pr06ContractBase,
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

test("PR-06 decision records the reviewed staged Application package", () => {
  const decision = readJson(resolve(repositoryRoot, pr06DecisionPath))

  assert.deepEqual(decision.reviewedDispositions, pr06ReviewedDispositions)
  assert.deepEqual(
    decision.standaloneDbTestBoundary,
    pr06StandaloneDbTestBoundary,
  )
  assert.deepEqual(decision.target, pr06TargetContract)
  assert.deepEqual(verifyPr06DecisionDocument(decision), [])
  assert.equal(decision.reviewStatus, "reviewed")
  assert.deepEqual(
    {
      addedRepositoryPaths:
        decision.operationPolicy.addedRepositoryPaths.length,
      addedSourcePaths: decision.operationPolicy.addedSourcePaths.length,
      changedRepositoryPaths:
        decision.operationPolicy.changedRepositoryPaths.length,
      changedSourcePaths: decision.operationPolicy.changedSourcePaths.length,
      deletedRepositoryPaths:
        decision.operationPolicy.deletedRepositoryPaths.length,
      deletedSourcePaths: decision.operationPolicy.deletedSourcePaths.length,
    },
    {
      addedRepositoryPaths: 12,
      addedSourcePaths: 0,
      changedRepositoryPaths: 50,
      changedSourcePaths: 20,
      deletedRepositoryPaths: 0,
      deletedSourcePaths: 0,
    },
  )
  assert.equal(
    decision.reviewedDispositions.credentialLifecycle
      .oauthAccessTokenLifetimeSeconds,
    300,
  )
  assert.equal(
    decision.reviewedDispositions.keycloakApplicationAdministration
      .realmTopology,
    "dedicated-application-realm",
  )

  assert.deepEqual(
    verifyPr06DecisionDocument(decision, { requireReady: true }),
    [],
  )

  for (const rejectedLifetime of [null, 299]) {
    const invalidLifetime = structuredClone(decision)
    invalidLifetime.reviewedDispositions.credentialLifecycle.oauthAccessTokenLifetimeSeconds =
      rejectedLifetime
    assert.match(
      verifyPr06DecisionDocument(invalidLifetime, { requireReady: true }).join(
        "\n",
      ),
      /OAuth access-token lifetime must equal 300 seconds/,
    )
  }

  for (const rejectedTopology of [
    null,
    "shared-realm-exhaustive-protected-client-denies",
  ]) {
    const unselectedTopology = structuredClone(decision)
    unselectedTopology.reviewedDispositions.keycloakApplicationAdministration.realmTopology =
      rejectedTopology
    assert.match(
      verifyPr06DecisionDocument(unselectedTopology, {
        requireReady: true,
      }).join("\n"),
      /Keycloak Application realm topology must equal dedicated-application-realm/,
    )
  }

  const invalidTopology = structuredClone(decision)
  invalidTopology.reviewedDispositions.keycloakApplicationAdministration.realmTopology =
    "same-realm-with-broad-client-authority"
  assert.match(
    verifyPr06DecisionDocument(invalidTopology).join("\n"),
    /invalid PR-06 Keycloak Application realm topology/,
  )
  assert.deepEqual(
    pr06ReviewedDispositions.keycloakApplicationAdministration
      .allowedRealmTopologies,
    ["dedicated-application-realm"],
  )
  assert.ok(
    pr06RetiredApplicationBoundaryPaths.includes(
      "apps/bff/src/routes/admin.ts",
    ),
  )
  assert.ok(
    pr06RetiredApplicationBoundaryPaths.includes(
      "apps/web/src/lib/admin/actions-core.ts",
    ),
  )
  assert.ok(
    pr06RetiredApplicationBoundaryPaths.includes(
      "infra/migrations/0000_inference_core.sql",
    ),
  )
})

test("PR-06 route extraction reviews the Application re-enable capability", () => {
  const root = mkdtempSync(join(tmpdir(), "inference-core-pr06-policy-"))
  const path = "apps/bff/src/routes/admin.ts"
  const absolutePath = resolve(root, path)
  const source = [
    'import type { FastifyInstance } from "fastify"',
    "declare const handler: unknown",
    "declare function withCapability(capability: string): unknown",
    "export interface AdminRouteOptions { emergencyIsolationService: unknown; emergencyRecoveryService: unknown }",
    "export function registerAdminRoutes(",
    "  server: FastifyInstance,",
    "  options: AdminRouteOptions = { emergencyIsolationService: null, emergencyRecoveryService: null, },",
    "): void {",
    '  server.post("/api/admin/applications/connected-apps/:id/enable", withCapability("applications.reenable"), handler)',
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
        'withCapability("applications.reenable")',
        'withCapability("applications.unreviewed")',
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

test("PR-06 resolver evidence changes only the reviewed BFF startup preflight", () => {
  assert.deepEqual(
    reviewedPr06ResolverFingerprints.map(({ path }) => path),
    reviewedPr05ResolverFingerprints.map(({ path }) => path),
  )
  assert.deepEqual(
    reviewedPr06ResolverFingerprints
      .filter(
        (fingerprint, index) =>
          fingerprint.sha256 !==
          reviewedPr05ResolverFingerprints[index]?.sha256,
      )
      .map(({ path, sha256 }) => ({ path, sha256 })),
    [
      {
        path: "apps/bff/src/index.ts",
        sha256:
          "86e9f1722a5fef97f64aadd09b61eb51cc4f028a54c91595e6d633bc5273c475",
      },
    ],
  )
})

test("PR-06 operation policy rejects paths outside the Application package", () => {
  const valid = emptyOperationPolicy()
  valid.addedRepositoryPaths = [
    "apps/bff/src/config/fixture-mode.test.ts",
    "apps/bff/src/services/litellm-chat-transport.test.ts",
    "docs/reduction/inference-core/pr-06-application-decisions.json",
    "scripts/inference-core/pr06-boundaries.test.mjs",
  ]
  valid.changedRepositoryPaths = [
    "apps/bff/src/config/fixture-mode.ts",
    "apps/bff/src/index.test.ts",
    "apps/bff/src/index.ts",
    "apps/bff/src/services/admin-team-live-authority.test.ts",
    "apps/bff/src/services/expert-capabilities.test.ts",
    "apps/bff/src/services/users.ts",
    "test-support/inference-core-db-tests/src/pr05-identity-mutation-journal.test.ts",
  ]
  assert.deepEqual(verifyPr06OperationBoundary(valid), [])

  const outside = structuredClone(valid)
  outside.changedRepositoryPaths = ["apps/bff/src/services/admin-team.ts"]
  assert.match(
    verifyPr06OperationBoundary(outside).join("\n"),
    /outside package boundary/,
  )

  const priorEvidence = structuredClone(valid)
  priorEvidence.changedRepositoryPaths = [
    "docs/reduction/inference-core/pr-05-identity-decisions.json",
  ]
  assert.match(
    verifyPr06OperationBoundary(priorEvidence).join("\n"),
    /immutable prior evidence/,
  )
})

test("PR-06 extends the standalone DB workspace only for OAuth reconciliation", () => {
  assert.deepEqual(
    pr06StandaloneDbTestBoundary.allowedPaths.filter((path) =>
      path.includes("/pr06-"),
    ),
    [
      "test-support/inference-core-db-tests/src/pr06-application-credential-reconciliation.test.ts",
    ],
  )
})

test("PR-06 removes every due finding and retains only the PR-12 tombstone", () => {
  const tombstone = {
    ruleId: "FS105_BUILDER_HUB",
    path: "apps/web/src/middleware.test.ts",
    count: 1,
    fingerprints: { retained: 1 },
    removeBy: "PR-12",
  }
  const due = {
    ruleId: "FS108_RETIRED_GOVERNANCE",
    path: "apps/bff/src/routes/admin.test.ts",
    count: 1,
    fingerprints: { due: 1 },
    removeBy: "PR-06",
  }

  assert.deepEqual(
    verifyPr06FindingTransition([tombstone, due], [tombstone]),
    [],
  )
  assert.match(
    verifyPr06FindingTransition([tombstone, due], [tombstone, due]).join("\n"),
    /PR-06 findings remain/,
  )
})

test("PR-06 route target adds exactly enable, soft-delete, and revoke", () => {
  assert.deepEqual(
    pr06AddedApplicationRouteContract.map(({ method, path }) => ({
      method,
      path,
    })),
    [
      { method: "DELETE", path: "/api/admin/applications/connected-apps/:id" },
      {
        method: "POST",
        path: "/api/admin/applications/connected-apps/:id/credentials/:credentialId/revoke",
      },
      {
        method: "POST",
        path: "/api/admin/applications/connected-apps/:id/enable",
      },
    ],
  )
  assert.equal(pr06TargetContract.routes, 86)
  assert.equal(
    pr06TargetContract.routeClassifications["current-console-seam"],
    77,
  )
})

test("PR-06 retired Application identifiers are a fail-closed boundary", () => {
  const root = mkdtempSync(join(tmpdir(), "inference-core-pr06-surface-"))
  try {
    for (const path of pr06RetiredApplicationBoundaryPaths) {
      writeFixture(root, path, "export const retainedApplication = true\n")
    }
    writeFixture(
      root,
      "apps/bff/src/routes/admin-connected-apps-lifecycle.test.ts",
      "export const ownerGroup = true\n",
    )
    writeFixture(
      root,
      "docs/reduction/inference-core/pr-06-application-decisions.json",
      '{"environmentQualifiedCredentials":false}\n',
    )
    assert.deepEqual(verifyPr06RetiredApplicationBoundary(root), [])

    const servicePath = "apps/bff/src/services/admin-connected-apps.ts"
    writeFixture(root, servicePath, "export const productionReady = true\n")
    assert.match(
      verifyPr06RetiredApplicationBoundary(root).join("\n"),
      /retired Application identifier remains productionReady/,
    )

    writeFixture(root, servicePath, "export const retainedApplication = true\n")
    const actionPath = "apps/web/src/lib/admin/actions-core.ts"
    writeFixture(root, actionPath, "export const ownerGroup = true\n")
    assert.match(
      verifyPr06RetiredApplicationBoundary(root).join("\n"),
      /retired Application identifier remains ownerGroup/,
    )

    writeFixture(root, actionPath, "export const retainedApplication = true\n")
    const migrationPath = "infra/migrations/0000_inference_core.sql"
    writeFixture(
      root,
      migrationPath,
      "ALTER TABLE admin.applications ADD last_tested_at timestamptz;\n",
    )
    assert.match(
      verifyPr06RetiredApplicationBoundary(root).join("\n"),
      /retired Application identifier remains last_tested_at/,
    )

    writeFixture(root, migrationPath, "SELECT 1;\n")
    const routePath = "apps/bff/src/routes/admin.ts"
    writeFixture(root, routePath, 'const path = "/promote-production"\n')
    assert.match(
      verifyPr06RetiredApplicationBoundary(root).join("\n"),
      /retired Application identifier remains promote-production/,
    )
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test("an activated PR-06 baseline satisfies the Application target", () => {
  const baseline = readJson(resolve(repositoryRoot, routeBaselinePath))
  if (!(baseline.reviewedRevisions ?? []).some(({ id }) => id === "PR-06")) {
    return
  }

  const allowlist = readJson(
    resolve(
      repositoryRoot,
      "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
    ),
  )
  assert.deepEqual(
    verifyPr06TargetState({
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

function writeFixture(root, path, content) {
  const absolutePath = join(root, path)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, content)
}
