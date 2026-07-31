import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import {
  pr08ContractBase,
  pr08ContractBaseTree,
  pr08ContractRevisionPath,
  pr08DecisionPath,
  pr08ExpectedMappedTargetPaths,
  pr08FirecrawlAdminRouteContract,
  pr08FirecrawlRouteContract,
  pr08LaneAnchor,
  pr08PrivateCheckpoint,
  pr08ReviewedDispositions,
  pr08SourceManifestPath,
  pr08SourceMapPath,
  pr08StandaloneDbTestBoundary,
  pr08TargetContract,
  pr08WebContractCompatibilityTestPaths,
  repositoryRoot,
  routeBaselinePath,
  verifyPr08BaseEvidence,
  verifyPr08DecisionDocument,
  verifyPr08OperationBoundary,
  verifyPr08PilotAncestry,
  verifyPr08QueryFreeLoggingBoundary,
  verifyPr08SourceManifestDocument,
  verifyPr08SourceMapDocument,
  verifyPr08TargetState,
  verifyReviewedContractRevision,
} from "./guardrails.mjs"

test("PR-08 is anchored to the accepted PR-07 integration tree", () => {
  assert.equal(pr08ContractBase, "c47ffd38661ce9a7561f967aecbb9bae15cdadf5")
  assert.equal(pr08LaneAnchor, pr08ContractBase)
  assert.equal(pr08ContractBaseTree, "6071f1aa62690c509346cf1af7017a4cc669d28b")
  assert.equal(
    git(["rev-parse", `${pr08ContractBase}^{tree}`]),
    pr08ContractBaseTree,
  )
})

test("PR-08 retains every PR-02 through PR-07 evidence file byte-identically", () => {
  assert.deepEqual(verifyPr08BaseEvidence(), [])
})

test("reviewed revision history recognizes only an exact PR-08 append", () => {
  const root = mkdtempSync(join(tmpdir(), "inference-core-pr08-"))
  try {
    execFileSync(
      "git",
      ["clone", "--quiet", "--shared", "--no-checkout", repositoryRoot, root],
      { stdio: "ignore" },
    )
    gitAt(root, ["checkout", "--quiet", pr08ContractBase])
    const baseAllowlist = readJson(
      join(
        root,
        "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
      ),
    )
    const baseRoutes = readJson(join(root, routeBaselinePath))
    const currentRoutes = structuredClone(baseRoutes)
    currentRoutes.reviewedRevisions.push({
      id: "PR-08",
      path: pr08ContractRevisionPath,
      sha256: "a".repeat(64),
    })
    const result = verifyReviewedContractRevision({
      root,
      baseCommit: pr08ContractBase,
      baseAllowlist,
      currentAllowlist: baseAllowlist,
      baseRoutes,
      currentRoutes,
    })

    assert.equal(result.present, true)
    assert.equal(result.id, "PR-08")
    assert.match(
      result.errors.join("\n"),
      /missing reviewed contract revision .*PR-08\.json/,
    )

    const reordered = structuredClone(currentRoutes)
    reordered.reviewedRevisions.reverse()
    assert.match(
      verifyReviewedContractRevision({
        root,
        baseCommit: pr08ContractBase,
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

test("PR-08 fixes the source-only Firecrawl decisions", () => {
  const decision = readJson(resolve(repositoryRoot, pr08DecisionPath))
  assert.deepEqual(decision.reviewedDispositions, pr08ReviewedDispositions)
  assert.deepEqual(
    decision.standaloneDbTestBoundary,
    pr08StandaloneDbTestBoundary,
  )
  assert.deepEqual(decision.target, pr08TargetContract)
  assert.equal(decision.reviewStatus, "reviewed")
  assert.deepEqual(verifyPr08DecisionDocument(decision), [])
  assert.deepEqual(
    verifyPr08DecisionDocument(decision, { requireReady: true }),
    [],
  )
  assert.equal(decision.reviewedDispositions.scopeBoundaries.sourceOnly, true)
  assert.equal(
    decision.reviewedDispositions.installationAndActivation.uiVisibilityOwner,
    "PR-11",
  )
  assert.equal(
    decision.reviewedDispositions.scopeBoundaries
      .runtimeDeploymentAndQualificationOwner,
    "PR-12",
  )
})

test("PR-08 binds exact private provenance without requiring private objects", () => {
  const manifest = readJson(resolve(repositoryRoot, pr08SourceManifestPath))
  const sourceMap = readFileSync(
    resolve(repositoryRoot, pr08SourceMapPath),
    "utf8",
  )
  assert.deepEqual(verifyPr08SourceManifestDocument(manifest), [])
  assert.deepEqual(verifyPr08SourceMapDocument(sourceMap), [])
  for (const field of [
    "privateHoldRef",
    "selectedManifestV2Sha256",
    "exclusionLedgerV2Sha256",
    "combinedBindingV2Sha256",
  ]) {
    const tampered = structuredClone(manifest)
    tampered.privateCheckpoint[field] = `tampered-${field}`
    assert.match(
      verifyPr08SourceManifestDocument(tampered).join("\n"),
      /invalid PR-08 private checkpoint binding/,
    )
  }
  const publicClone = mkdtempSync(join(tmpdir(), "inference-core-pr08-public-"))
  try {
    gitAt(publicClone, ["init", "--quiet"])
    gitAt(publicClone, ["config", "user.name", "Guardrail Test"])
    gitAt(publicClone, ["config", "user.email", "guardrail@example.invalid"])
    gitAt(publicClone, ["commit", "--quiet", "--allow-empty", "-m", "public"])
    assert.throws(() =>
      gitAt(publicClone, [
        "cat-file",
        "-e",
        `${pr08PrivateCheckpoint.commit}^{commit}`,
      ]),
    )
    assert.deepEqual(verifyPr08PilotAncestry(publicClone), [])
  } finally {
    rmSync(publicClone, { force: true, recursive: true })
  }
})

test("PR-08 source map is target-file-level and deterministic", () => {
  const rows = readFileSync(resolve(repositoryRoot, pr08SourceMapPath), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  assert.equal(rows[0].kind, "binding")
  assert.equal(rows.length - 1, 46)
  assert.deepEqual(
    rows.slice(1).map(({ targetPath }) => targetPath),
    pr08ExpectedMappedTargetPaths,
  )
  for (let index = 1; index < rows.length; index++) {
    for (const field of ["sourcePaths", "semanticUnits"]) {
      const tampered = structuredClone(rows)
      tampered[index][field] = [...tampered[index][field], `tampered-${field}`]
      assert.ok(
        verifyPr08SourceMapDocument(
          `${tampered.map((row) => JSON.stringify(row)).join("\n")}\n`,
        ).includes(`invalid PR-08 source map row ${rows[index].targetPath}`),
      )
    }
  }
})

test("PR-08 operation policy admits source-only target paths", () => {
  const valid = emptyOperationPolicy()
  valid.addedRepositoryPaths = [
    "apps/bff/src/index-firecrawl-logging.test.ts",
    "apps/bff/src/routes/firecrawl-gateway.ts",
    ...pr08WebContractCompatibilityTestPaths,
    "infra/firecrawl/compose.yaml",
    "scripts/inference-core/pr08-boundaries.test.mjs",
  ].sort()
  valid.addedSourcePaths = [
    "apps/bff/src/routes/firecrawl-gateway.ts",
    "infra/firecrawl/compose.yaml",
  ].sort()
  valid.changedRepositoryPaths = [
    "apps/bff/src/index.ts",
    "package.json",
  ].sort()
  valid.changedSourcePaths = ["apps/bff/src/index.ts", "package.json"].sort()
  assert.deepEqual(verifyPr08OperationBoundary(valid), [])

  for (const path of [
    "apps/web/src/components/console-v2/applications-v2-experience.tsx",
    "infra/migrations/0027_admin_firecrawl_gateway_clients.sql",
    "infra/librechat/web-search/hermes-firecrawl/docker-compose.yml",
    "apps/bff/src/routes/firecrawl-native.ts",
  ]) {
    const invalid = emptyOperationPolicy()
    invalid.changedRepositoryPaths = [path]
    assert.match(
      verifyPr08OperationBoundary(invalid).join("\n"),
      /outside package boundary|forbidden/,
    )
  }

  const deletion = emptyOperationPolicy()
  deletion.deletedRepositoryPaths = [".env.example"]
  deletion.deletedSourcePaths = [".env.example"]
  assert.match(
    verifyPr08OperationBoundary(deletion).join("\n"),
    /must not delete Product paths/,
  )
})

test("PR-08 fixes six admin routes, two public T2 routes, and unchanged inference", () => {
  assert.deepEqual(
    pr08FirecrawlRouteContract.map(({ method, path }) => ({ method, path })),
    [
      { method: "POST", path: "/v2/scrape" },
      { method: "POST", path: "/v2/search" },
    ],
  )
  assert.deepEqual(
    pr08FirecrawlAdminRouteContract.map(({ method, path }) => ({
      method,
      path,
    })),
    [
      {
        method: "POST",
        path: "/api/admin/applications/connected-apps/:id/firecrawl/enable",
      },
      {
        method: "PATCH",
        path: "/api/admin/applications/connected-apps/:id/firecrawl",
      },
      {
        method: "POST",
        path: "/api/admin/applications/connected-apps/:id/firecrawl/test",
      },
      {
        method: "POST",
        path: "/api/admin/applications/connected-apps/:id/firecrawl/rotate-credentials",
      },
      {
        method: "POST",
        path: "/api/admin/applications/connected-apps/:id/firecrawl/disable",
      },
      {
        method: "POST",
        path: "/api/admin/applications/connected-apps/:id/firecrawl/credentials/:credentialId/revoke",
      },
    ],
  )
  assert.equal(pr08TargetContract.routes, 94)
  assert.equal(
    pr08TargetContract.routeClassifications["current-console-seam"],
    83,
  )
  assert.equal(pr08TargetContract.routeClassifications["public-t2"], 2)
  assert.equal(pr08TargetContract.routeClassifications["required-now"], 2)
  assert.equal(pr08TargetContract.webUiVisible, false)
  assert.deepEqual(
    pr08TargetContract.webContractCompatibilityTestPaths,
    pr08WebContractCompatibilityTestPaths,
  )
  assert.equal(pr08TargetContract.runtimeQualified, false)
})

test("PR-08 query-free request logging boundary is exact", () => {
  assert.deepEqual(verifyPr08QueryFreeLoggingBoundary(), [])
})

test("activated PR-08 baseline satisfies the source-only target", () => {
  const baseline = readJson(resolve(repositoryRoot, routeBaselinePath))
  if (baseline.reviewedRevisions?.at(-1)?.id !== "PR-08") {
    return
  }
  const allowlist = readJson(
    resolve(
      repositoryRoot,
      "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
    ),
  )
  assert.deepEqual(
    verifyPr08TargetState({
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
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}
