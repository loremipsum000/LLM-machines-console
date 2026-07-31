import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import {
  analyzeRootPgliteBoundary,
  assertNoUnexpectedEnvironmentFiles,
  buildContractRevisionDocument,
  buildEntryChanges,
  buildExactClosureOperationPolicy,
  buildForbiddenAllowlist,
  buildRepositoryClosureFromCommit,
  compareExactFindings,
  compareForbiddenBaselineMetadata,
  extractBffRoutes,
  extractFastifyRegistrarManifest,
  extractWebInferenceConsumers,
  extractWebRoutes,
  listCandidatePaths,
  pr02ContractRevisionPath,
  pr03ContractRevisionPath,
  pr03DecisionPath,
  pr04ContractRevisionPath,
  pr04DecisionPath,
  pr04StandaloneDbTestBoundary,
  pr05ContractBase,
  pr06ContractBase,
  repositoryRoot,
  routeBaselinePath,
  scanForbiddenSurfaces,
  verifyActiveReviewedRevisionId,
  verifyBaseCommitLineage,
  verifyCorePackageClosure,
  verifyLegacyRouteShrink,
  verifyPolicyStability,
  verifyPr03BaseEvidence,
  verifyPr03DecisionDocument,
  verifyPr03FindingTransition,
  verifyPr03TargetState,
  verifyPr04BaseEvidence,
  verifyPr04DecisionDocument,
  verifyPr04FindingTransition,
  verifyPr04TargetState,
  verifyPr05TargetState,
  verifyProtectedGuardrailStability,
  verifyRepository,
  verifyRetentionCharacterization,
  verifyRetiredDataDependencyBoundary,
  verifyReviewedContractRevision,
  verifyReviewedFindingReduction,
  verifyReviewedPr04WebAuthenticationEvidence,
  verifyReviewedWebAuthenticationEvidence,
  verifyRouteBaselineMetadata,
  verifyShrinkOnly,
  verifyStandaloneDbTestBoundary,
  verifyWebAuthenticationBoundary,
} from "./guardrails.mjs"

const temporaryRoots = []

after(() => {
  for (const root of temporaryRoots) {
    rmSync(root, { recursive: true, force: true })
  }
})

test("forbidden findings are exact path and fingerprint multisets", () => {
  const root = temporaryRoot()
  const path = "apps/bff/src/routes/example.ts"
  writeFixture(
    root,
    path,
    'const first = "agentic"\nconst second = "agentic"\n',
  )
  const accepted = scanForbiddenSurfaces({ root, paths: [path] })

  assert.equal(accepted.length, 1)
  assert.equal(accepted[0].ruleId, "FS101_AGENTIC_RUNTIME")
  assert.equal(accepted[0].count, 2)
  assert.equal(Object.keys(accepted[0].fingerprints).length, 2)
  assert.deepEqual(compareExactFindings(accepted, accepted), [])

  writeFixture(
    root,
    path,
    'const first = "agentic"\nconst second = "agentic"\nconst third = "hermes"\n',
  )
  const expanded = scanForbiddenSurfaces({ root, paths: [path] })
  assert.match(compareExactFindings(accepted, expanded)[0], /changed finding/)
})

test("a stale allowlist entry fails until the allowlist shrinks", () => {
  const root = temporaryRoot()
  const path = "apps/bff/src/routes/example.ts"
  writeFixture(root, path, 'const value = "mcp"\n')
  const accepted = scanForbiddenSurfaces({ root, paths: [path] })

  writeFixture(root, path, "const value = true\n")
  const reduced = scanForbiddenSurfaces({ root, paths: [path] })

  assert.deepEqual(compareExactFindings(accepted, reduced), [
    `stale allowlist entry FS102_MCP\0${path}`,
  ])
  assert.deepEqual(verifyShrinkOnly(accepted, reduced), [])
})

test("base comparison accepts only a multiset reduction", () => {
  const base = [
    {
      ruleId: "FS101_AGENTIC_RUNTIME",
      path: "example.ts",
      count: 2,
      fingerprints: { a: 1, b: 1 },
      removeBy: "PR-04",
    },
  ]
  const reduced = [
    {
      ...base[0],
      count: 1,
      fingerprints: { a: 1 },
    },
  ]
  const replaced = [
    {
      ...base[0],
      count: 1,
      fingerprints: { c: 1 },
    },
  ]

  assert.deepEqual(verifyShrinkOnly(base, reduced), [])
  assert.deepEqual(verifyShrinkOnly(base, replaced), [
    "legacy finding changed or grew FS101_AGENTIC_RUNTIME\u0000example.ts",
  ])
  assert.deepEqual(
    verifyShrinkOnly(base, [{ ...reduced[0], removeBy: "PR-12" }]),
    ["legacy disposition changed FS101_AGENTIC_RUNTIME\u0000example.ts"],
  )
})

test("reviewed finding reductions allow bound fingerprint replacement without growth", () => {
  const base = [
    {
      ruleId: "FS102_MCP",
      path: "retained.ts",
      count: 2,
      fingerprints: { a: 1, b: 1 },
      removeBy: "PR-03",
    },
  ]

  assert.deepEqual(
    verifyReviewedFindingReduction(base, [
      {
        ...base[0],
        fingerprints: { c: 1, d: 1 },
      },
    ]),
    [],
  )
  assert.deepEqual(
    verifyReviewedFindingReduction(base, [
      {
        ...base[0],
        count: 1,
        fingerprints: { replacement: 1 },
      },
    ]),
    [],
  )
})

test("reviewed finding reductions reject new keys, count growth, and disposition changes", () => {
  const base = [
    {
      ruleId: "FS102_MCP",
      path: "retained.ts",
      count: 1,
      fingerprints: { a: 1 },
      removeBy: "PR-03",
    },
  ]
  const errors = verifyReviewedFindingReduction(base, [
    {
      ...base[0],
      count: 2,
      fingerprints: { a: 1, b: 1 },
      removeBy: "PR-12",
    },
    {
      ...base[0],
      path: "new.ts",
    },
  ])

  assert.deepEqual(errors, [
    "new reviewed legacy finding FS102_MCP\u0000new.ts",
    "reviewed legacy disposition changed FS102_MCP\u0000retained.ts",
    "reviewed legacy finding count grew FS102_MCP\u0000retained.ts",
  ])
})

test("PR-03 applies only exact reviewed finding dispositions", () => {
  const root = temporaryRoot()
  const paths = [
    "apps/bff/src/auth/persona.ts",
    "apps/web/src/middleware.test.ts",
    "infra/migrations/0003_builder_lifecycle_tables.sql",
    "packages/contracts/src/common.ts",
    "apps/bff/src/routes/retained.ts",
  ]
  for (const path of paths) {
    writeFixture(root, path, "export const BuilderRole = true\n")
  }

  const findings = scanForbiddenSurfaces({ root, paths })
  assert.deepEqual(
    findings.map(({ path, removeBy }) => ({ path, removeBy })),
    [
      { path: "apps/bff/src/auth/persona.ts", removeBy: "PR-05" },
      { path: "apps/bff/src/routes/retained.ts", removeBy: "PR-03" },
      { path: "apps/web/src/middleware.test.ts", removeBy: "PR-12" },
      {
        path: "infra/migrations/0003_builder_lifecycle_tables.sql",
        removeBy: "PR-04",
      },
      { path: "packages/contracts/src/common.ts", removeBy: "PR-05" },
    ],
  )
})

test("PR-03 finding transition permits only reviewed exact-path deferrals", () => {
  const base = [
    {
      ruleId: "FS105_BUILDER_HUB",
      path: "apps/bff/src/auth/persona.ts",
      count: 2,
      fingerprints: { before: 2 },
      removeBy: "PR-03",
    },
    {
      ruleId: "FS105_BUILDER_HUB",
      path: "packages/contracts/src/common.ts",
      count: 2,
      fingerprints: { before: 2 },
      removeBy: "PR-03",
    },
  ]
  const current = base.map((entry) => ({
    ...entry,
    count: 1,
    fingerprints: { reviewedReplacement: 1 },
    removeBy: "PR-05",
  }))

  assert.deepEqual(verifyPr03FindingTransition(base, current), [])

  const unreviewed = [
    ...base,
    {
      ruleId: "FS105_BUILDER_HUB",
      path: "apps/web/src/other.ts",
      count: 1,
      fingerprints: { before: 1 },
      removeBy: "PR-03",
    },
  ]
  assert.match(
    verifyPr03FindingTransition(unreviewed, [
      ...current,
      {
        ...unreviewed[2],
        removeBy: "PR-05",
      },
    ]).join("\n"),
    /outside policy|unreviewed PR-03 Builder\/Hub deferral/,
  )
  assert.match(
    verifyPr03FindingTransition(base, [base[0]]).join("\n"),
    /PR-03 findings remain/,
  )
})

test("PR-04 finding transition requires every due finding to be absent", () => {
  const due = {
    ruleId: "FS107_RETIRED_DATA_DEPENDENCY",
    path: "apps/bff/package.json",
    count: 1,
    fingerprints: { before: 1 },
    removeBy: "PR-04",
  }
  const retained = {
    ruleId: "FS109_LEGACY_PERSONA",
    path: "apps/bff/src/auth/persona.ts",
    count: 2,
    fingerprints: { before: 2 },
    removeBy: "PR-05",
  }

  assert.deepEqual(verifyPr04FindingTransition([due, retained], [retained]), [])
  assert.match(
    verifyPr04FindingTransition([due, retained], [due, retained]).join("\n"),
    /PR-04 findings remain/,
  )
  assert.match(
    verifyPr04FindingTransition(
      [due, retained],
      [{ ...due, removeBy: "PR-05" }, retained],
    ).join("\n"),
    /disposition changed outside policy/,
  )
  assert.match(
    verifyPr04FindingTransition(
      [retained],
      [retained, { ...due, path: "apps/bff/src/new.ts" }],
    ).join("\n"),
    /new PR-04 reviewed legacy finding/,
  )
})

test("PR-03 ignores only the reviewed pnpm integrity false positive", () => {
  const root = temporaryRoot()
  const path = "pnpm-lock.yaml"
  const integrity =
    "resolution: {integrity: sha512-8SbC8BR40pS6baCM8sbtYDSwEVQd4JlFTOlaD3gWGHfThTcABnNDBda6eTZeqbofalIJhFx0qKzgHJmcPTnGdw==}"
  writeFixture(root, path, `${integrity}\n`)

  assert.deepEqual(scanForbiddenSurfaces({ root, paths: [path] }), [])

  writeFixture(root, path, `${integrity}\nMCP_SERVER_ENABLED=true\n`)
  const findings = scanForbiddenSurfaces({ root, paths: [path] })
  assert.equal(findings.length, 1)
  assert.equal(findings[0].ruleId, "FS102_MCP")
  assert.equal(findings[0].path, path)
  assert.equal(findings[0].count, 1)
  assert.equal(
    Object.keys(findings[0].fingerprints)[0],
    testSha256("FS102_MCP\0MCP_SERVER_ENABLED=true\0mcp"),
  )
})

test("PR-03 decision evidence requires reviewed exact path matrices", () => {
  const decision = JSON.parse(
    readFileSync(join(repositoryRoot, pr03DecisionPath), "utf8"),
  )

  assert.deepEqual(verifyPr03DecisionDocument(decision), [])
  assert.deepEqual(
    verifyPr03DecisionDocument(decision, { requireReady: true }),
    [],
  )

  const pending = structuredClone(decision)
  pending.reviewStatus = "pending-final-staged-delta"
  assert.deepEqual(verifyPr03DecisionDocument(pending), [])
  assert.deepEqual(
    verifyPr03DecisionDocument(pending, { requireReady: true }),
    ["PR-03 operation policy is not reviewed"],
  )

  const overlappingClosures = structuredClone(decision)
  overlappingClosures.operationPolicy.changedSourcePaths = [
    "apps/bff/src/auth/persona.ts",
  ]
  overlappingClosures.operationPolicy.changedRepositoryPaths = [
    "apps/bff/src/auth/persona.ts",
  ]
  assert.deepEqual(verifyPr03DecisionDocument(overlappingClosures), [])
})

test("PR-03 generation requires byte-identical retained PR-02 evidence", () => {
  assert.deepEqual(verifyPr03BaseEvidence(), [])

  const root = temporaryRoot()
  execFileSync(
    "git",
    ["clone", "--quiet", "--shared", "--no-checkout", repositoryRoot, root],
    {
      stdio: "ignore",
    },
  )
  git(root, ["checkout", "--quiet", "43c11ace1b80d5241cf2a6a06670fe01f49e3e10"])
  assert.deepEqual(verifyPr03BaseEvidence(root), [])

  writeFixture(
    root,
    pr02ContractRevisionPath,
    `${readFileSync(join(root, pr02ContractRevisionPath), "utf8")}\n`,
  )
  assert.deepEqual(verifyPr03BaseEvidence(root), [
    `PR-03 retained PR-02 evidence changed ${pr02ContractRevisionPath}`,
  ])
})

test("PR-04 decision evidence requires reviewed exact path matrices", () => {
  const decision = JSON.parse(
    readFileSync(join(repositoryRoot, pr04DecisionPath), "utf8"),
  )

  assert.deepEqual(verifyPr04DecisionDocument(decision), [])
  assert.deepEqual(
    verifyPr04DecisionDocument(decision, { requireReady: true }),
    decision.reviewStatus === "reviewed"
      ? []
      : ["PR-04 operation policy is not reviewed"],
  )

  const invalidDisposition = structuredClone(decision)
  invalidDisposition.reviewedDispositions.auditProducerAtomicity.pr04Outbox = true
  assert.match(
    verifyPr04DecisionDocument(invalidDisposition).join("\n"),
    /invalid PR-04 reviewed dispositions/,
  )

  const invalidException = structuredClone(decision)
  invalidException.structuralExceptions[0].requiredOccurrences = 3
  assert.match(
    verifyPr04DecisionDocument(invalidException).join("\n"),
    /invalid PR-04 structural exceptions/,
  )

  const invalidTestBoundary = structuredClone(decision)
  invalidTestBoundary.standaloneDbTestBoundary.allowedPaths.pop()
  assert.match(
    verifyPr04DecisionDocument(invalidTestBoundary).join("\n"),
    /invalid PR-04 standalone DB test boundary/,
  )

  const invalidWebAuthenticationEvidence = structuredClone(decision)
  invalidWebAuthenticationEvidence.webAuthenticationEvidence[0].sha256 =
    "0".repeat(64)
  assert.match(
    verifyPr04DecisionDocument(invalidWebAuthenticationEvidence).join("\n"),
    /invalid PR-04 Web authentication evidence/,
  )
})

test("PR-04 generation requires byte-identical retained PR-02 and PR-03 evidence", () => {
  assert.deepEqual(verifyPr04BaseEvidence(), [])

  for (const path of [pr02ContractRevisionPath, pr03DecisionPath]) {
    const root = temporaryRoot()
    execFileSync(
      "git",
      ["clone", "--quiet", "--shared", "--no-checkout", repositoryRoot, root],
      { stdio: "ignore" },
    )
    git(root, [
      "checkout",
      "--quiet",
      "fb36b9de38396af79c82056963ae3f4833a12fef",
    ])
    assert.deepEqual(verifyPr04BaseEvidence(root), [])
    writeFixture(root, path, `${readFileSync(join(root, path), "utf8")}\n`)
    assert.deepEqual(verifyPr04BaseEvidence(root), [
      `PR-04 retained prior evidence changed ${path}`,
    ])
  }
})

test("PR-03 Web authentication boundary is fail-closed and self-contained", () => {
  const root = temporaryRoot()
  const path = "apps/web/src/middleware.ts"
  const validSource = [
    'import { auth } from "@/lib/auth/auth"',
    'import { NextResponse } from "next/server"',
    "export default function middleware(request) {",
    "  if (!isProtectedConsolePath(request.nextUrl.pathname)) {",
    "    return NextResponse.next()",
    "  }",
    "  return auth((request) => {",
    "    if (request.auth) return NextResponse.next()",
    '    const signInUrl = new URL("/auth/signin", request.url)',
    '    signInUrl.searchParams.set("callbackUrl", request.url)',
    "    return NextResponse.redirect(signInUrl)",
    "  })(request)",
    "}",
    "function isProtectedConsolePath(pathname) {",
    "  return (",
    '    pathname === "/" ||',
    '    pathname === "/applications" ||',
    '    pathname === "/hardware" ||',
    '    pathname === "/inference" ||',
    '    pathname === "/settings" ||',
    '    pathname === "/team"',
    "  )",
    "}",
    "export const config = {",
    '  matcher: ["/((?!api|_next/static|_next/image|apple-touch-icon.png|favicon.ico|favicon-16x16.png|favicon-32x32.png|favicon-48x48.png|icon.svg).*)"],',
    "}",
    "",
  ].join("\n")
  writeFixture(root, path, validSource)

  assert.deepEqual(verifyWebAuthenticationBoundary(root), [])
  writeFixture(
    root,
    path,
    validSource.replace(
      "/((?!api|_next/static|_next/image|apple-touch-icon.png|favicon.ico|favicon-16x16.png|favicon-32x32.png|favicon-48x48.png|icon.svg).*)",
      "/protected",
    ),
  )
  assert.match(
    verifyWebAuthenticationBoundary(root).join("\n"),
    /missing reviewed middleware matcher/,
  )
  writeFixture(
    root,
    path,
    `${validSource}\nconst CONSOLE_REQUIRE_AUTH = false\n`,
  )
  assert.match(
    verifyWebAuthenticationBoundary(root).join("\n"),
    /fail-open auth override/,
  )
})

test("PR-03 binds exact Web authentication implementation and tests", () => {
  const root = temporaryRoot()
  execFileSync(
    "git",
    ["clone", "--quiet", "--shared", "--no-checkout", repositoryRoot, root],
    { stdio: "ignore" },
  )
  git(root, ["checkout", "--quiet", "fb36b9de38396af79c82056963ae3f4833a12fef"])
  assert.deepEqual(verifyReviewedWebAuthenticationEvidence(root), [])
  assert.match(
    verifyReviewedPr04WebAuthenticationEvidence(root).join("\n"),
    /PR-04 Web authentication evidence changed apps\/web\/src\/middleware\.test\.ts/,
  )

  writeFixture(
    root,
    "apps/web/src/middleware.ts",
    `${readFileSync(join(root, "apps/web/src/middleware.ts"), "utf8")}\n`,
  )
  assert.match(
    verifyReviewedWebAuthenticationEvidence(root).join("\n"),
    /reviewed Web authentication evidence changed apps\/web\/src\/middleware\.ts/,
  )
})

test("PR-04 binds its successor Web authentication implementation and tests", () => {
  assert.deepEqual(verifyReviewedPr04WebAuthenticationEvidence(), [])

  for (const path of [
    "apps/web/src/middleware.test.ts",
    "apps/web/src/middleware.ts",
  ]) {
    const root = temporaryRoot()
    for (const evidencePath of [
      "apps/web/src/middleware.test.ts",
      "apps/web/src/middleware.ts",
    ]) {
      writeFixture(
        root,
        evidencePath,
        execFileSync(
          "git",
          [
            "show",
            "--no-ext-diff",
            "--no-textconv",
            "--end-of-options",
            `${pr05ContractBase}:${evidencePath}`,
          ],
          { cwd: repositoryRoot },
        ),
      )
    }
    assert.deepEqual(verifyReviewedPr04WebAuthenticationEvidence(root), [])

    writeFixture(root, path, `${readFileSync(join(root, path), "utf8")}\n`)
    assert.match(
      verifyReviewedPr04WebAuthenticationEvidence(root).join("\n"),
      new RegExp(
        `PR-04 Web authentication evidence changed ${path.replaceAll("/", "\\/").replaceAll(".", "\\.")}`,
      ),
    )
  }
})

test("guard policy changes require a reviewed contract revision", () => {
  assert.deepEqual(
    verifyPolicyStability(
      { policyDigest: "reviewed" },
      { policyDigest: "reviewed" },
      "route",
    ),
    [],
  )
  assert.deepEqual(
    verifyPolicyStability(
      { policyDigest: "reviewed" },
      { policyDigest: "changed" },
      "route",
    ),
    ["route policy changed; reviewed contract revision required"],
  )
  assert.deepEqual(
    verifyProtectedGuardrailStability(
      { protectedFiles: [{ path: "guard.mjs", sha256: "reviewed" }] },
      { protectedFiles: [{ path: "guard.mjs", sha256: "changed" }] },
    ),
    ["protected guardrail files changed; reviewed contract revision required"],
  )
})

test("reviewed contract revisions bind every changed entry and policy digest", () => {
  const baseAllowlist = {
    policyDigest: "forbidden-before",
    protectedFiles: [{ path: "guard.mjs", sha256: "a".repeat(64) }],
    entries: [
      {
        ruleId: "FS102_MCP",
        path: "legacy.ts",
        count: 1,
        fingerprints: { legacy: 1 },
        removeBy: "PR-03",
      },
    ],
  }
  const currentAllowlist = {
    policyDigest: "forbidden-after",
    protectedFiles: [{ path: "guard.mjs", sha256: "b".repeat(64) }],
    entries: [],
  }
  const baseRoutes = {
    policyDigest: "route-before",
    routes: [
      {
        surface: "bff",
        method: "POST",
        path: "/v1/chat/completions",
        source: "apps/bff/src/routes/openai-compatible.ts",
        classification: "legacy-retired",
      },
    ],
    fastifyRegistrars: [{ exportName: "registerLegacy", sourcePath: "old.ts" }],
    webInferenceConsumers: [],
    sourceClosure: [{ path: "apps/bff/src/index.ts", sha256: "c".repeat(64) }],
    repositoryClosure: [
      {
        path: "apps/bff/src/index.ts",
        mode: "100644",
        objectId: "a".repeat(40),
      },
    ],
    escapeHatches: [],
  }
  const currentRoutes = {
    ...baseRoutes,
    policyDigest: "route-after",
    routes: [],
    fastifyRegistrars: [],
    sourceClosure: [{ path: "apps/bff/src/index.ts", sha256: "d".repeat(64) }],
    repositoryClosure: [
      {
        path: "apps/bff/src/index.ts",
        mode: "100644",
        objectId: "b".repeat(40),
      },
    ],
  }
  const evidenceFiles = [{ path: "decision.json", sha256: "e".repeat(64) }]

  const revision = buildContractRevisionDocument({
    baseCommit: "f".repeat(40),
    baseTree: "1".repeat(40),
    baseAllowlist,
    currentAllowlist,
    baseRoutes,
    currentRoutes,
    evidenceFiles,
  })

  assert.equal(revision.id, "PR-02")
  assert.deepEqual(revision.changes.forbiddenEntries, [
    {
      key: "FS102_MCP legacy.ts",
      before: baseAllowlist.entries,
      after: [],
    },
  ])
  assert.deepEqual(revision.changes.routes, [
    {
      key: "bff POST /v1/chat/completions apps/bff/src/routes/openai-compatible.ts",
      before: baseRoutes.routes,
      after: [],
    },
  ])
  assert.deepEqual(revision.changes.sourceClosure, [
    {
      key: "apps/bff/src/index.ts",
      before: baseRoutes.sourceClosure,
      after: currentRoutes.sourceClosure,
    },
  ])
  assert.deepEqual(revision.changes.repositoryClosure, [
    {
      key: "apps/bff/src/index.ts",
      before: baseRoutes.repositoryClosure,
      after: currentRoutes.repositoryClosure,
    },
  ])
  assert.deepEqual(revision.evidenceFiles, evidenceFiles)
})

test("entry-change manifests preserve multiplicity and reject silent replacement", () => {
  const base = [
    { path: "same.ts", sha256: "a" },
    { path: "same.ts", sha256: "b" },
  ]
  const current = [
    { path: "same.ts", sha256: "a" },
    { path: "same.ts", sha256: "c" },
  ]

  assert.deepEqual(
    buildEntryChanges(base, current, (entry) => entry.path),
    [
      {
        key: "same.ts",
        before: base,
        after: current,
      },
    ],
  )
})

test("PR-04 operation policy is derived as exact sorted closure paths", () => {
  const baseRoutes = {
    sourceClosure: [
      { path: "changed.ts", sha256: "before" },
      { path: "deleted.ts", sha256: "before" },
    ],
    repositoryClosure: [{ path: "repo-changed.ts", sha256: "before" }],
  }
  const currentRoutes = {
    sourceClosure: [
      { path: "added.ts", sha256: "after" },
      { path: "changed.ts", sha256: "after" },
    ],
    repositoryClosure: [
      { path: "repo-added.ts", sha256: "after" },
      { path: "repo-changed.ts", sha256: "after" },
    ],
  }

  assert.deepEqual(
    buildExactClosureOperationPolicy(baseRoutes, currentRoutes),
    {
      addedSourcePaths: ["added.ts"],
      changedSourcePaths: ["changed.ts"],
      deletedSourcePaths: ["deleted.ts"],
      addedRepositoryPaths: ["repo-added.ts"],
      changedRepositoryPaths: ["repo-changed.ts"],
      deletedRepositoryPaths: [],
    },
  )
})

test("candidate discovery rejects gitlinks and unstaged missing cached files", () => {
  const missingRoot = initializedGitRoot()
  const trackedPath = "apps/bff/src/tracked.ts"
  writeFixture(missingRoot, trackedPath, "export const tracked = true\n")
  git(missingRoot, ["add", trackedPath])
  assert.deepEqual(listCandidatePaths(missingRoot), [trackedPath])

  rmSync(join(missingRoot, trackedPath))
  assert.throws(
    () => listCandidatePaths(missingRoot),
    /stage its deletion before verification/,
  )
  git(missingRoot, ["add", "--update"])
  assert.deepEqual(listCandidatePaths(missingRoot), [])

  const gitlinkRoot = initializedGitRoot()
  writeFixture(gitlinkRoot, "seed.txt", "seed\n")
  git(gitlinkRoot, ["add", "seed.txt"])
  git(gitlinkRoot, ["commit", "--quiet", "-m", "seed"])
  const commit = git(gitlinkRoot, ["rev-parse", "HEAD"])
  git(gitlinkRoot, [
    "update-index",
    "--add",
    "--cacheinfo",
    "160000",
    commit,
    "vendor/core",
  ])
  assert.throws(
    () => listCandidatePaths(gitlinkRoot),
    /Unsupported gitlink 160000 at vendor\/core/,
  )

  const divergentRoot = initializedGitRoot()
  const divergentPath = "apps/bff/src/divergent.ts"
  writeFixture(divergentRoot, divergentPath, "export const staged = true\n")
  git(divergentRoot, ["add", divergentPath])
  writeFixture(divergentRoot, divergentPath, "export const staged = false\n")
  assert.throws(
    () => listCandidatePaths(divergentRoot),
    /Cached content differs from the worktree/,
  )

  for (const indexFlag of ["--assume-unchanged", "--skip-worktree"]) {
    const flaggedRoot = initializedGitRoot()
    const flaggedPath = "apps/bff/src/flagged.ts"
    writeFixture(flaggedRoot, flaggedPath, "export const mcp = true\n")
    git(flaggedRoot, ["add", flaggedPath])
    writeFixture(flaggedRoot, flaggedPath, "export const safe = true\n")
    git(flaggedRoot, ["update-index", indexFlag, flaggedPath])
    assert.throws(
      () => listCandidatePaths(flaggedRoot),
      /Cached content differs from the worktree/,
      indexFlag,
    )
  }

  const missingObjectRoot = initializedGitRoot()
  const missingObjectPath = "apps/bff/src/missing-object.ts"
  writeFixture(
    missingObjectRoot,
    missingObjectPath,
    "export const safe = true\n",
  )
  git(missingObjectRoot, [
    "update-index",
    "--add",
    "--cacheinfo",
    "100644",
    "f".repeat(40),
    missingObjectPath,
  ])
  assert.throws(
    () => listCandidatePaths(missingObjectRoot),
    /Cached Git object is missing or not a blob/,
  )

  const treeObjectRoot = initializedGitRoot()
  writeFixture(treeObjectRoot, "seed.txt", "seed\n")
  git(treeObjectRoot, ["add", "seed.txt"])
  git(treeObjectRoot, ["commit", "--quiet", "-m", "seed"])
  const treeObjectId = git(treeObjectRoot, ["rev-parse", "HEAD^{tree}"])
  const treeObjectPath = "apps/bff/src/tree-object.ts"
  writeFixture(treeObjectRoot, treeObjectPath, "export const safe = true\n")
  git(treeObjectRoot, [
    "update-index",
    "--add",
    "--cacheinfo",
    "100644",
    treeObjectId,
    treeObjectPath,
  ])
  assert.throws(
    () => listCandidatePaths(treeObjectRoot),
    /Cached Git object is missing or not a blob/,
  )
})

test("repository closure binds configs, infrastructure, and test reachability", () => {
  const closurePaths = new Set(
    buildRepositoryClosureFromCommit(
      repositoryRoot,
      "bb60cb0dfe46a39189e2a80fe1839e8288201492",
    ).map(({ path }) => path),
  )

  assert.equal(closurePaths.has(".env.example"), true)
  assert.equal(
    closurePaths.has("infra/migrations/0026_knowledge_chunk_embeddings.sql"),
    true,
  )
  assert.equal(
    closurePaths.has("apps/bff/src/routes/app-gateway.test.ts"),
    true,
  )
  assert.equal(closurePaths.has(routeBaselinePath), false)
  assert.equal(
    closurePaths.has(
      "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
    ),
    false,
  )
})

test("a valid exact PR-02 revision passes the scoped verifier", () => {
  const fixture = pr02RevisionFixture()
  const result = verifyReviewedContractRevision(fixture)

  assert.equal(result.present, true)
  assert.deepEqual(result.errors, [])
})

test("PR-02 revision verification rejects evidence, history, target, and resolver tampering", () => {
  const evidenceFixture = pr02RevisionFixture()
  writeFixture(
    evidenceFixture.root,
    "docs/reduction/inference-core/pr-02-boundary-decisions.json",
    '{"tampered":true}\n',
  )
  assert.match(
    verifyReviewedContractRevision(evidenceFixture).errors.join("\n"),
    /reviewed contract revision does not match exact changes/,
  )

  const historyFixture = pr02RevisionFixture()
  historyFixture.currentRoutes.reviewedRevisions[0].sha256 = "0".repeat(64)
  assert.match(
    verifyReviewedContractRevision(historyFixture).errors.join("\n"),
    /reviewed contract revision history changed/,
  )

  const targetFixture = pr02RevisionFixture({
    mutate({ currentRoutes }) {
      currentRoutes.target = { changed: true }
    },
  })
  assert.match(
    verifyReviewedContractRevision(targetFixture).errors.join("\n"),
    /route target contract changed outside PR-02 scope/,
  )

  const resolverFixture = pr02RevisionFixture({
    mutate({ currentRoutes }) {
      currentRoutes.fingerprints = [{ path: "changed", sha256: "f".repeat(64) }]
    },
  })
  assert.match(
    verifyReviewedContractRevision(resolverFixture).errors.join("\n"),
    /route resolver fingerprints changed outside PR-02 scope/,
  )
})

test("PR-02 revision verification rejects an incorrect base even with equal revision arrays", () => {
  const routes = {
    target: {},
    routes: [],
    fingerprints: [],
    reviewedRevisions: [],
  }
  const result = verifyReviewedContractRevision({
    root: repositoryRoot,
    baseCommit: "a".repeat(40),
    baseAllowlist: {},
    currentAllowlist: {},
    baseRoutes: routes,
    currentRoutes: routes,
    operationPolicy: emptyPr02OperationPolicy(),
  })

  assert.equal(result.present, false)
  assert.match(result.errors.join("\n"), /PR-02 contract revision base changed/)
})

test("future shrink-only comparisons retain an already reviewed PR-02 revision", () => {
  const fixture = pr02RevisionFixture()
  fixture.baseRoutes.reviewedRevisions = structuredClone(
    fixture.currentRoutes.reviewedRevisions,
  )
  const result = verifyReviewedContractRevision(fixture)

  assert.equal(result.present, false)
  assert.deepEqual(result.errors, [])

  writeFixture(
    fixture.root,
    "docs/reduction/inference-core/pr-02-boundary-decisions.json",
    '{"tampered":true}\n',
  )
  assert.match(
    verifyReviewedContractRevision(fixture).errors.join("\n"),
    /retained PR-02 revision evidence changed/,
  )
})

test("reviewed revision history recognizes only an exact PR-03 append", () => {
  const root = temporaryRoot()
  execFileSync(
    "git",
    ["clone", "--quiet", "--shared", "--no-checkout", repositoryRoot, root],
    { stdio: "ignore" },
  )
  git(root, ["checkout", "--quiet", "43c11ace1b80d5241cf2a6a06670fe01f49e3e10"])

  const baseAllowlist = JSON.parse(
    readFileSync(
      join(
        root,
        "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
      ),
      "utf8",
    ),
  )
  const baseRoutes = JSON.parse(
    readFileSync(join(root, routeBaselinePath), "utf8"),
  )
  const currentRoutes = structuredClone(baseRoutes)
  currentRoutes.reviewedRevisions.push({
    id: "PR-03",
    path: pr03ContractRevisionPath,
    sha256: "a".repeat(64),
  })
  const result = verifyReviewedContractRevision({
    root,
    baseCommit: "964ff087f39111862c90f72ec57ab33bb937f5d2",
    baseAllowlist,
    currentAllowlist: baseAllowlist,
    baseRoutes,
    currentRoutes,
  })

  assert.equal(result.present, true)
  assert.equal(result.id, "PR-03")
  assert.match(
    result.errors.join("\n"),
    /missing reviewed contract revision .*PR-03\.json/,
  )

  const reorderedRoutes = structuredClone(currentRoutes)
  reorderedRoutes.reviewedRevisions.reverse()
  assert.match(
    verifyReviewedContractRevision({
      root,
      baseCommit: "964ff087f39111862c90f72ec57ab33bb937f5d2",
      baseAllowlist,
      currentAllowlist: baseAllowlist,
      baseRoutes,
      currentRoutes: reorderedRoutes,
    }).errors.join("\n"),
    /unsupported reviewed contract revision history transition/,
  )
})

test("reviewed revision history recognizes only an exact PR-04 append", () => {
  const root = temporaryRoot()
  execFileSync(
    "git",
    ["clone", "--quiet", "--shared", "--no-checkout", repositoryRoot, root],
    { stdio: "ignore" },
  )
  git(root, ["checkout", "--quiet", "fb36b9de38396af79c82056963ae3f4833a12fef"])
  const baseAllowlist = JSON.parse(
    readFileSync(
      join(
        root,
        "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
      ),
      "utf8",
    ),
  )
  const baseRoutes = JSON.parse(
    readFileSync(join(root, routeBaselinePath), "utf8"),
  )
  const currentRoutes = structuredClone(baseRoutes)
  currentRoutes.reviewedRevisions.push({
    id: "PR-04",
    path: pr04ContractRevisionPath,
    sha256: "a".repeat(64),
  })
  const result = verifyReviewedContractRevision({
    root,
    baseCommit: "fb36b9de38396af79c82056963ae3f4833a12fef",
    baseAllowlist,
    currentAllowlist: baseAllowlist,
    baseRoutes,
    currentRoutes,
  })

  assert.equal(result.present, true)
  assert.equal(result.id, "PR-04")
  assert.match(
    result.errors.join("\n"),
    /missing reviewed contract revision .*PR-04\.json/,
  )

  const reorderedRoutes = structuredClone(currentRoutes)
  reorderedRoutes.reviewedRevisions.reverse()
  assert.match(
    verifyReviewedContractRevision({
      root,
      baseCommit: "fb36b9de38396af79c82056963ae3f4833a12fef",
      baseAllowlist,
      currentAllowlist: baseAllowlist,
      baseRoutes,
      currentRoutes: reorderedRoutes,
    }).errors.join("\n"),
    /unsupported reviewed contract revision history transition/,
  )
})

test("base comparison requires a proper ancestor of candidate HEAD", () => {
  const root = initializedGitRoot()
  writeFixture(root, "seed.txt", "base\n")
  git(root, ["add", "seed.txt"])
  git(root, ["commit", "--quiet", "-m", "base"])
  const base = git(root, ["rev-parse", "HEAD"])
  writeFixture(root, "seed.txt", "candidate\n")
  git(root, ["add", "seed.txt"])
  git(root, ["commit", "--quiet", "-m", "candidate"])
  const head = git(root, ["rev-parse", "HEAD"])

  assert.deepEqual(verifyBaseCommitLineage(root, base), [])
  assert.match(
    verifyBaseCommitLineage(root, head).join("\n"),
    /proper ancestor outside the fixed precommit bases/,
  )
  assert.match(
    verifyBaseCommitLineage(root, head, head).join("\n"),
    /proper ancestor of clean candidate HEAD/,
  )
  writeFixture(root, "candidate-untracked.txt", "candidate\n")
  assert.match(
    verifyBaseCommitLineage(root, head).join("\n"),
    /proper ancestor outside the fixed precommit bases/,
  )
  assert.deepEqual(verifyBaseCommitLineage(root, head, head), [])
  const unrelated = git(root, [
    "commit-tree",
    `${base}^{tree}`,
    "-m",
    "unrelated",
  ])
  assert.match(
    verifyBaseCommitLineage(root, unrelated).join("\n"),
    /not an ancestor/,
  )
})

test("PR-05 base comparison accepts its dirty same-head candidate", () => {
  assert.deepEqual(
    verifyBaseCommitLineage(repositoryRoot, pr05ContractBase),
    [],
  )
})

test("PR-06 base comparison accepts its dirty same-head candidate", () => {
  assert.deepEqual(
    verifyBaseCommitLineage(repositoryRoot, pr06ContractBase),
    [],
  )
})

test("PR-02 revision operation matrix rejects added runtime surfaces", () => {
  const scenarios = [
    {
      expected: /PR-02 route added or changed/,
      mutate({ currentRoutes }) {
        currentRoutes.routes.push({
          surface: "bff",
          method: "POST",
          path: "/api/admin/backdoor",
          source: "apps/bff/src/routes/admin.ts",
          classification: "current-console-seam",
        })
      },
    },
    {
      expected: /PR-02 Fastify registrar added or changed/,
      mutate({ currentRoutes }) {
        currentRoutes.fastifyRegistrars.push({
          exportName: "registerBackdoorRoutes",
          importSource: "./routes/backdoor",
          sourcePath: "apps/bff/src/routes/backdoor.ts",
        })
      },
    },
    {
      expected: /PR-02 Web inference consumer added or changed/,
      mutate({ currentRoutes }) {
        currentRoutes.webInferenceConsumers.push({
          path: "apps/web/src/lib/backdoor.ts",
          invocationCount: 1,
          fingerprints: { backdoor: 1 },
        })
      },
    },
    {
      expected: /PR-02 addedSourcePaths differ/,
      mutate({ currentRoutes }) {
        currentRoutes.sourceClosure.push({
          path: "apps/bff/src/routes/backdoor.ts",
          sha256: "b".repeat(64),
        })
      },
    },
    {
      expected: /PR-02 addedRepositoryPaths differ/,
      mutate({ currentRoutes }) {
        currentRoutes.repositoryClosure.push({
          path: ".github/workflows/unreviewed.yml",
          mode: "100644",
          objectId: "b".repeat(40),
        })
      },
    },
  ]

  for (const scenario of scenarios) {
    const fixture = pr02RevisionFixture({ mutate: scenario.mutate })
    assert.match(
      verifyReviewedContractRevision(fixture).errors.join("\n"),
      scenario.expected,
    )
  }
})

test("PR-02 revision operation matrix preserves the reviewed Web authentication boundary", () => {
  const middlewarePath = "apps/web/src/middleware.ts"
  const fixture = pr02RevisionFixture({
    operationPolicy: {
      ...emptyPr02OperationPolicy(),
      deletedSourcePaths: [middlewarePath],
    },
    mutate({ baseRoutes, currentRoutes }) {
      const middleware = {
        path: middlewarePath,
        sha256: "c".repeat(64),
      }
      baseRoutes.sourceClosure.push(middleware)
      currentRoutes.sourceClosure = []
    },
  })

  assert.match(
    verifyReviewedContractRevision(fixture).errors.join("\n"),
    /reviewed Web authentication boundary changed or disappeared/,
  )
})

test("baseline metadata rejects unknown fields and altered bootstrap identity", () => {
  const reviewed = {
    schemaVersion: 1,
    baseCommit: "0faf8a7da0a77ffb6bf45cb6c01dbc17c51f855a",
    policyDigest: "reviewed",
    protectedFiles: [],
    entries: [],
  }

  assert.deepEqual(compareForbiddenBaselineMetadata(reviewed, reviewed), [])
  assert.deepEqual(
    compareForbiddenBaselineMetadata(
      { ...reviewed, unreviewedClaim: true },
      reviewed,
    ),
    ["forbidden-surface baseline metadata changed"],
  )
  assert.deepEqual(
    compareForbiddenBaselineMetadata(
      { ...reviewed, baseCommit: "0".repeat(40) },
      reviewed,
    ),
    ["forbidden-surface baseline metadata changed"],
  )

  const routeBaseline = {
    schemaVersion: 3,
    baseCommit: "0faf8a7da0a77ffb6bf45cb6c01dbc17c51f855a",
    policyDigest: "reviewed",
    target: {},
    routes: [],
    fastifyRegistrars: [],
    webInferenceConsumers: [],
    sourceClosure: [],
    repositoryClosure: [],
    fingerprints: [],
    escapeHatches: [],
    reviewedRevisions: [],
  }
  assert.deepEqual(verifyRouteBaselineMetadata(routeBaseline), [])
  assert.deepEqual(
    verifyRouteBaselineMetadata({
      ...routeBaseline,
      unreviewedClaim: true,
    }),
    ["route baseline metadata changed"],
  )
})

test("self-describing exclusions are exact and text scanning is extension independent", () => {
  const root = temporaryRoot()
  const paths = [
    "scripts/inference-core/unreviewed.ts",
    "docs/reduction/inference-core/unreviewed.md",
    "tools/unreviewed.py",
    "tools/unreviewed.sh",
    "web/unreviewed.html",
  ]
  writeFixture(root, paths[0], 'export const mode = "agentic"\n')
  writeFixture(root, paths[1], "knowledge corpus\n")
  writeFixture(root, paths[2], 'mode = "mcp"\n')
  writeFixture(root, paths[3], 'mode="ragflow"\n')
  writeFixture(root, paths[4], "<p>librechat</p>\n")

  const findings = scanForbiddenSurfaces({ root, paths })
  assert.deepEqual(
    findings.map(({ ruleId, path }) => ({ ruleId, path })),
    [
      {
        ruleId: "FS101_AGENTIC_RUNTIME",
        path: "scripts/inference-core/unreviewed.ts",
      },
      { ruleId: "FS102_MCP", path: "tools/unreviewed.py" },
      {
        ruleId: "FS103_KNOWLEDGE_RAG",
        path: "docs/reduction/inference-core/unreviewed.md",
      },
      { ruleId: "FS103_KNOWLEDGE_RAG", path: "tools/unreviewed.sh" },
      { ruleId: "FS104_LIBRECHAT", path: "web/unreviewed.html" },
    ],
  )
})

test("dedicated negative-boundary tests are excluded only as protected files", () => {
  const paths = [
    "apps/bff/src/db/inference-core-schema.test.ts",
    "apps/bff/src/routes/app-gateway-boundary.test.ts",
    "apps/bff/src/services/inference-core-keycloak-admin.test.ts",
    "apps/web/src/lib/admin/retained-core-boundaries.test.ts",
    "packages/contracts/src/inference-core.test.ts",
  ]
  const evidencePaths = [
    "docs/reduction/inference-core/pr-02-boundary-decisions.json",
    "scripts/inference-core/pr02-boundaries.test.mjs",
    "scripts/inference-core/pr02-contract-revision.mjs",
  ]
  assert.deepEqual(scanForbiddenSurfaces({ paths }), [])

  const protectedPaths = new Set(
    buildForbiddenAllowlist({
      paths: [],
      baseCommit: "0faf8a7da0a77ffb6bf45cb6c01dbc17c51f855a",
    }).protectedFiles.map(({ path }) => path),
  )
  for (const path of [...paths, ...evidencePaths]) {
    assert.equal(protectedPaths.has(path), true, `${path} is not protected`)
  }
})

test("content scanning rejects invalid source bytes and scans NUL-containing UTF-8", () => {
  const root = temporaryRoot()
  const nulPath = "apps/bff/src/routes/nul.ts"
  const invalidPath = "apps/bff/src/routes/invalid.ts"
  writeFixture(root, nulPath, '//\0\nexport const transport = "mcp"\n')
  writeFixture(
    root,
    invalidPath,
    Buffer.concat([
      Buffer.from("//"),
      Buffer.from([0xff]),
      Buffer.from('\nexport const transport = "mcp"\n'),
    ]),
  )

  assert.equal(
    scanForbiddenSurfaces({ root, paths: [nulPath] })[0]?.ruleId,
    "FS102_MCP",
  )
  assert.throws(
    () => scanForbiddenSurfaces({ root, paths: [invalidPath] }),
    /Invalid UTF-8/,
  )
})

test("legacy identifiers are matched without case-sensitive gaps", () => {
  const root = temporaryRoot()
  const path = "apps/bff/src/services/legacy.ts"
  writeFixture(
    root,
    path,
    [
      'const oldRole = "Consumer"',
      'const oldPolicy = "URL_POLICY"',
      'const oldRegistry = "CONNECTOR_REGISTRY"',
      'const oldStatus = "PENDING_VETTING"',
      'const ordinaryWords = "chubby rebuilder"',
      "",
    ].join("\n"),
  )

  assert.deepEqual(
    scanForbiddenSurfaces({ root, paths: [path] }).map(({ ruleId, count }) => ({
      ruleId,
      count,
    })),
    [
      { ruleId: "FS108_RETIRED_GOVERNANCE", count: 1 },
      { ruleId: "FS109_LEGACY_PERSONA", count: 1 },
      { ruleId: "FS111_CONNECTOR_GOVERNANCE", count: 2 },
    ],
  )
})

test("retired module paths cover every supported JavaScript and TypeScript extension", () => {
  const root = temporaryRoot()
  const paths = [
    "apps/bff/src/routes/knowledge.js",
    "packages/contracts/src/knowledge.mts",
  ]
  for (const path of paths) {
    writeFixture(root, path, "export const retained = false\n")
  }

  assert.deepEqual(
    scanForbiddenSurfaces({ root, paths }).map(({ ruleId, path }) => ({
      ruleId,
      path,
    })),
    [
      {
        ruleId: "FS001_RETIRED_BFF_MODULE",
        path: "apps/bff/src/routes/knowledge.js",
      },
      {
        ruleId: "FS003_RETIRED_CONTRACT_MODULE",
        path: "packages/contracts/src/knowledge.mts",
      },
    ],
  )
})

test("the workspace lockfile participates in legacy dependency shrinkage", () => {
  const root = temporaryRoot()
  const path = "pnpm-lock.yaml"
  writeFixture(
    root,
    path,
    "importers:\n  apps/agentic-adapter:\n    dependencies:\n      ioredis: 5.0.0\n",
  )

  assert.deepEqual(
    scanForbiddenSurfaces({ root, paths: [path] }).map(({ ruleId, count }) => ({
      ruleId,
      count,
    })),
    [
      { ruleId: "FS101_AGENTIC_RUNTIME", count: 1 },
      { ruleId: "FS107_RETIRED_DATA_DEPENDENCY", count: 1 },
    ],
  )
})

test("Drizzle optional Upstash peer metadata is the only structural Redis lock exception", () => {
  const validLockfile = [
    "lockfileVersion: '9.0'",
    "importers:",
    "  apps/bff:",
    "    dependencies:",
    "      drizzle-orm:",
    "        version: 0.44.2(postgres@3.4.7)",
    "packages:",
    "  drizzle-orm@0.44.2:",
    "    peerDependencies:",
    "      '@upstash/redis': '>=1.34.7'",
    "    peerDependenciesMeta:",
    "      '@upstash/redis':",
    "        optional: true",
    "snapshots:",
    "  drizzle-orm@0.44.2(postgres@3.4.7): {}",
    "",
  ].join("\n")
  const root = temporaryRoot()
  const rootLockPath = "pnpm-lock.yaml"
  writeFixture(root, rootLockPath, validLockfile)

  assert.deepEqual(scanForbiddenSurfaces({ root, paths: [rootLockPath] }), [])
  assert.deepEqual(
    verifyRetiredDataDependencyBoundary(root, [rootLockPath]),
    [],
  )

  const invalidVariants = [
    validLockfile.replace(
      "  apps/bff:\n    dependencies:",
      "  apps/bff:\n    dependencies:\n      '@upstash/redis':\n        version: 1.34.7",
    ),
    validLockfile.replace(
      "snapshots:\n",
      "snapshots:\n  '@upstash/redis@1.34.7': {}\n",
    ),
    validLockfile.replace(">=1.34.7", ">=1.35.0"),
    validLockfile.replace("        optional: true\n", ""),
  ]
  for (const source of invalidVariants) {
    writeFixture(root, rootLockPath, source)
    assert.equal(
      scanForbiddenSurfaces({ root, paths: [rootLockPath] }).some(
        ({ ruleId }) => ruleId === "FS107_RETIRED_DATA_DEPENDENCY",
      ),
      true,
    )
    assert.notDeepEqual(
      verifyRetiredDataDependencyBoundary(root, [rootLockPath]),
      [],
    )
  }

  const nestedLockPath = "test-support/inference-core-db-tests/pnpm-lock.yaml"
  writeFixture(root, nestedLockPath, validLockfile)
  assert.deepEqual(scanForbiddenSurfaces({ root, paths: [nestedLockPath] }), [])
  for (const source of invalidVariants) {
    writeFixture(root, nestedLockPath, source)
    assert.equal(
      scanForbiddenSurfaces({ root, paths: [nestedLockPath] }).some(
        ({ ruleId }) => ruleId === "FS107_RETIRED_DATA_DEPENDENCY",
      ),
      true,
    )
  }
})

test("the standalone PGlite DB test workspace cannot enter production dependency scope", () => {
  const paths = [
    ...pr04StandaloneDbTestBoundary.allowedPaths,
    "apps/bff/package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ]
  assert.deepEqual(verifyStandaloneDbTestBoundary(repositoryRoot, paths), [])

  const rootLock = readFileSync(join(repositoryRoot, "pnpm-lock.yaml"), "utf8")
  assert.deepEqual(analyzeRootPgliteBoundary(rootLock), [])
  assert.match(
    analyzeRootPgliteBoundary(
      rootLock.replace(
        "snapshots:\n",
        "snapshots:\n  '@electric-sql/pglite@0.5.4': {}\n",
      ),
    ).join("\n"),
    /active or resolved PGlite root lock edge/,
  )

  const root = temporaryRoot()
  const boundaryPaths = [
    ...pr04StandaloneDbTestBoundary.allowedPaths,
    "apps/bff/package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ]
  for (const path of boundaryPaths) {
    writeFixture(root, path, readFileSync(join(repositoryRoot, path)))
  }
  const bffManifest = JSON.parse(
    readFileSync(join(root, "apps/bff/package.json"), "utf8"),
  )
  bffManifest.devDependencies["@electric-sql/pglite"] = "0.5.4"
  writeFixture(
    root,
    "apps/bff/package.json",
    `${JSON.stringify(bffManifest)}\n`,
  )
  assert.match(
    verifyStandaloneDbTestBoundary(root, boundaryPaths).join("\n"),
    /PGlite dependency is not allowed/,
  )

  writeFixture(
    root,
    "apps/bff/package.json",
    readFileSync(join(repositoryRoot, "apps/bff/package.json")),
  )
  const nestedManifest = JSON.parse(
    readFileSync(
      join(root, pr04StandaloneDbTestBoundary.packageManifest.path),
      "utf8",
    ),
  )
  nestedManifest.scripts.test = "true"
  writeFixture(
    root,
    pr04StandaloneDbTestBoundary.packageManifest.path,
    `${JSON.stringify(nestedManifest)}\n`,
  )
  assert.match(
    verifyStandaloneDbTestBoundary(root, boundaryPaths).join("\n"),
    /invalid standalone DB test package manifest/,
  )

  writeFixture(
    root,
    pr04StandaloneDbTestBoundary.packageManifest.path,
    readFileSync(
      join(repositoryRoot, pr04StandaloneDbTestBoundary.packageManifest.path),
    ),
  )
  writeFixture(
    root,
    pr04StandaloneDbTestBoundary.lockfile.path,
    `${readFileSync(
      join(repositoryRoot, pr04StandaloneDbTestBoundary.lockfile.path),
      "utf8",
    )}\n`,
  )
  assert.match(
    verifyStandaloneDbTestBoundary(root, boundaryPaths).join("\n"),
    /standalone DB test boundary changed .*pnpm-lock\.yaml/,
  )
})

test("the structural lock exception does not weaken active dependency checks", () => {
  const root = temporaryRoot()
  const lockfilePath = "pnpm-lock.yaml"
  const manifestPath = "apps/bff/package.json"
  writeFixture(
    root,
    lockfilePath,
    [
      "packages:",
      "  drizzle-orm@0.44.2:",
      "    peerDependencies:",
      "      '@upstash/redis': '>=1.34.7'",
      "    peerDependenciesMeta:",
      "      '@upstash/redis':",
      "        optional: true",
      "",
    ].join("\n"),
  )
  writeFixture(
    root,
    manifestPath,
    `${JSON.stringify({ dependencies: { ioredis: "5.6.1" } })}\n`,
  )
  assert.match(
    verifyRetiredDataDependencyBoundary(root, [
      lockfilePath,
      manifestPath,
    ]).join("\n"),
    /retired active dependency ioredis/,
  )

  for (const [path, source] of [
    ["apps/bff/src/redis.ts", 'import Redis from "ioredis"\n'],
    ["apps/bff/src/upstash.ts", 'import { Redis } from "@upstash/redis"\n'],
    [".env.example", "REDIS_URL=redis://localhost:6379\n"],
    ["apps/bff/src/runtime.ts", "const client = new Redis()\n"],
  ]) {
    writeFixture(root, path, source)
    assert.equal(
      scanForbiddenSurfaces({ root, paths: [path] }).some(
        ({ ruleId }) => ruleId === "FS107_RETIRED_DATA_DEPENDENCY",
      ),
      true,
    )
  }
})

test("retired binary Knowledge fixtures are frozen by path and hash", () => {
  const root = temporaryRoot()
  const path = "test-fixtures/knowledge/example.pdf"
  writeFixture(root, path, Buffer.from([0, 1, 2, 3]))

  const findings = scanForbiddenSurfaces({ root, paths: [path] })
  assert.equal(findings.length, 1)
  assert.equal(findings[0].ruleId, "FS005_RETIRED_KNOWLEDGE_FIXTURE")
  assert.equal(findings[0].count, 1)
  assert.equal(Object.keys(findings[0].fingerprints).length, 1)
})

test("base route comparison rejects additions and reclassification", () => {
  const legacyRoute = {
    surface: "bff",
    method: "POST",
    path: "/v1/chat/completions",
    source: "apps/bff/src/routes/openai-compatible.ts",
    classification: "legacy-retired",
  }
  const base = { routes: [legacyRoute] }

  assert.deepEqual(verifyLegacyRouteShrink(base, { routes: [] }), [])
  assert.deepEqual(
    verifyLegacyRouteShrink(base, {
      routes: [legacyRoute, legacyRoute],
    }),
    [
      "route multiplicity increased POST /v1/chat/completions apps/bff/src/routes/openai-compatible.ts",
    ],
  )
  const escapeHatch = {
    path: "apps/bff/src/auth/persona.ts",
    sha256: "a".repeat(64),
    removeBy: "PR-05",
  }
  assert.deepEqual(
    verifyLegacyRouteShrink(
      { routes: [], escapeHatches: [escapeHatch] },
      { routes: [], escapeHatches: [] },
    ),
    [],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink(
      { routes: [], escapeHatches: [escapeHatch] },
      {
        routes: [],
        escapeHatches: [
          {
            ...escapeHatch,
            sha256: "b".repeat(64),
          },
        ],
      },
    ),
    ["legacy route escape hatch changed apps/bff/src/auth/persona.ts"],
  )
  const middlewareEscapeHatch = {
    path: "apps/web/src/middleware.ts",
    sha256: "a".repeat(64),
    removeBy: "PR-03",
  }
  const middlewareBoundary = {
    path: middlewareEscapeHatch.path,
    sha256: middlewareEscapeHatch.sha256,
  }
  assert.deepEqual(
    verifyLegacyRouteShrink(
      {
        routes: [],
        escapeHatches: [middlewareEscapeHatch],
        sourceClosure: [middlewareBoundary],
      },
      {
        routes: [],
        escapeHatches: [
          {
            ...middlewareEscapeHatch,
            sha256: "b".repeat(64),
          },
        ],
        sourceClosure: [middlewareBoundary],
      },
    ),
    ["legacy route escape hatch changed apps/web/src/middleware.ts"],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink(
      {
        routes: [],
        escapeHatches: [middlewareEscapeHatch],
        sourceClosure: [middlewareBoundary],
      },
      { routes: [], escapeHatches: [] },
    ),
    [
      "reviewed Web authentication boundary changed or disappeared apps/web/src/middleware.ts",
    ],
  )
  const retainedSource = {
    path: "apps/web/postcss.config.mjs",
    sha256: "c".repeat(64),
  }
  assert.deepEqual(
    verifyLegacyRouteShrink(
      { routes: [], sourceClosure: [retainedSource] },
      {
        routes: [],
        sourceClosure: [
          { ...retainedSource, sha256: "d".repeat(64) },
          {
            path: "apps/web/babel.config.cjs",
            sha256: "e".repeat(64),
          },
        ],
      },
    ),
    [
      "production source closure changed apps/web/babel.config.cjs",
      "production source closure changed apps/web/postcss.config.mjs",
    ],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink(
      { routes: [], sourceClosure: [retainedSource] },
      { routes: [], sourceClosure: [] },
    ),
    [],
  )
  const retainedRepositoryEntry = {
    path: ".env.example",
    mode: "100644",
    objectId: "a".repeat(40),
  }
  assert.deepEqual(
    verifyLegacyRouteShrink(
      { routes: [], repositoryClosure: [retainedRepositoryEntry] },
      {
        routes: [],
        repositoryClosure: [
          {
            ...retainedRepositoryEntry,
            objectId: "b".repeat(40),
          },
          {
            path: ".github/workflows/unreviewed.yml",
            mode: "100644",
            objectId: "c".repeat(40),
          },
        ],
      },
    ),
    [
      "repository closure changed .env.example",
      "repository closure changed .github/workflows/unreviewed.yml",
    ],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink(
      { routes: [], repositoryClosure: [retainedRepositoryEntry] },
      { routes: [], repositoryClosure: [] },
    ),
    [],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink(
      { routes: [], reviewedRevisions: [] },
      {
        routes: [],
        reviewedRevisions: [
          {
            id: "PR-02",
            path: pr02ContractRevisionPath,
            sha256: "a".repeat(64),
          },
        ],
      },
    ),
    ["reviewed contract revision history changed"],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink(base, {
      routes: [{ ...legacyRoute, classification: "required-now" }],
    }),
    [
      "route reclassified POST /v1/chat/completions apps/bff/src/routes/openai-compatible.ts",
    ],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink({ routes: [] }, { routes: [legacyRoute] }),
    [
      "new route requires a reviewed contract revision POST /v1/chat/completions apps/bff/src/routes/openai-compatible.ts",
    ],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink(
      { routes: [] },
      {
        routes: [
          {
            ...legacyRoute,
            path: "/api/admin/chat",
            source: "apps/bff/src/routes/admin.ts",
            classification: "current-console-seam",
          },
        ],
      },
    ),
    [
      "new route requires a reviewed contract revision POST /api/admin/chat apps/bff/src/routes/admin.ts",
    ],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink(
      {
        target: {
          requiredPublicInference: [
            {
              method: "POST",
              path: "/api/app-gateway/v1/chat/completions",
            },
          ],
        },
        routes: [
          {
            surface: "bff",
            method: "POST",
            path: "/api/app-gateway/v1/chat/completions",
            source: "apps/bff/src/routes/app-gateway.ts",
            classification: "required-now",
          },
        ],
      },
      {
        target: {
          requiredPublicInference: [
            {
              method: "POST",
              path: "/api/app-gateway/v1/chat/completions",
            },
          ],
        },
        routes: [],
      },
    ),
    [
      "required route missing or ambiguous POST /api/app-gateway/v1/chat/completions",
    ],
  )
})

test("route parsing distinguishes retained Application routes from legacy compatibility routes", () => {
  const root = temporaryRoot()
  const paths = [
    "apps/bff/src/index.ts",
    "apps/bff/src/routes/app-gateway.ts",
    "apps/bff/src/routes/openai-compatible.ts",
  ]
  writeFixture(
    root,
    paths[0],
    [
      'import Fastify, { type FastifyInstance } from "fastify"',
      "export function buildServer(): FastifyInstance {",
      "  const server = Fastify({ bodyLimit: bffBodyLimitBytes(), logger: true })",
      '  server.get("/livez", handler)',
      '  server.get("/healthz", handler)',
      '  server.get("/readyz", handler)',
      "  return server",
      "}",
      "",
    ].join("\n"),
  )
  writeFixture(
    root,
    paths[1],
    [
      'import type { FastifyInstance } from "fastify"',
      "export function registerAppGatewayRoutes(server: FastifyInstance) {",
      '  server.get("/api/app-gateway/v1/models", handler)',
      '  server.post("/api/app-gateway/v1/chat/completions", handler)',
      "}",
      "",
    ].join("\n"),
  )
  writeFixture(
    root,
    paths[2],
    [
      'import type { FastifyInstance } from "fastify"',
      "export function registerOpenAICompatibleRoutes(server: FastifyInstance) {",
      '  server.get("/v1/models", handler)',
      '  server.post("/v1/chat/completions", handler)',
      "}",
      "",
    ].join("\n"),
  )

  const routes = extractBffRoutes({ root, paths })
  assert.equal(
    routes.filter((route) => route.classification === "required-now").length,
    2,
  )
  assert.equal(
    routes.filter((route) => route.classification === "private-operational")
      .length,
    3,
  )
  assert.equal(
    routes.filter((route) => route.classification === "legacy-retired").length,
    2,
  )
})

test("route parsing covers aliases, route options, nested paths, and TSX", () => {
  const root = temporaryRoot()
  const paths = [
    "apps/bff/src/routes/v2/example.ts",
    "apps/bff/src/plugins/example.tsx",
  ]
  writeFixture(
    root,
    paths[0],
    [
      "interface RouteHost {",
      "  route(options: unknown): void",
      "}",
      "export function register(server: RouteHost) {",
      "  const api = server",
      '  api.route({ method: ["GET", "POST"], url: "/nested" })',
      "}",
      "",
    ].join("\n"),
  )
  writeFixture(
    root,
    paths[1],
    [
      "interface RouteHost {",
      "  get(path: string, handler: unknown): void",
      "}",
      "export function register(api: RouteHost) {",
      '  api.get("/outside-routes", async () => null)',
      "}",
      "",
    ].join("\n"),
  )

  assert.deepEqual(
    extractBffRoutes({ root, paths }).map(({ method, path }) => ({
      method,
      path,
    })),
    [
      { method: "GET", path: "/nested" },
      { method: "POST", path: "/nested" },
      { method: "GET", path: "/outside-routes" },
    ],
  )
})

test("BFF route discovery covers JavaScript modules and custom route hosts", () => {
  const root = temporaryRoot()
  const javascriptPaths = [
    "apps/bff/src/routes/v2/javascript.js",
    "apps/bff/src/routes/v2/module.mjs",
    "apps/bff/src/routes/v2/common.cjs",
  ]
  for (const path of javascriptPaths) {
    writeFixture(root, path, 'server.post("/api/admin/chat", handler)\n')
  }
  assert.deepEqual(
    extractBffRoutes({ root, paths: javascriptPaths }).map(
      ({ method, path }) => ({ method, path }),
    ),
    [
      { method: "POST", path: "/api/admin/chat" },
      { method: "POST", path: "/api/admin/chat" },
      { method: "POST", path: "/api/admin/chat" },
    ],
  )

  const dynamicPath = "apps/bff/src/services/custom-host.ts"
  writeFixture(
    root,
    dynamicPath,
    [
      "interface EndpointHost { post(path: string, handler: unknown): void }",
      "declare const routePath: string",
      "declare const handler: unknown",
      "export function register(x: EndpointHost) {",
      "  x.post(routePath, handler)",
      "}",
      "",
    ].join("\n"),
  )
  assert.throws(
    () => extractBffRoutes({ root, paths: [dynamicPath] }),
    /Fastify shorthand route path must be a static absolute literal/,
  )

  const foldedPath = "apps/bff/src/services/folded-host.ts"
  writeFixture(
    root,
    foldedPath,
    [
      'const routePath = "/api/admin/" + "chat"',
      "export function attach(target: any) {",
      "  target.post(routePath, handler)",
      "}",
      "",
    ].join("\n"),
  )
  assert.deepEqual(
    extractBffRoutes({ root, paths: [foldedPath] }).map(({ method, path }) => ({
      method,
      path,
    })),
    [{ method: "POST", path: "/api/admin/chat" }],
  )

  const shadowedPath = "apps/bff/src/routes/v2/shadowed.ts"
  writeFixture(
    root,
    shadowedPath,
    [
      'const routePath = "/api/admin/reviewed"',
      "interface RouteHost { post(path: string, handler: unknown): void }",
      "declare const handler: unknown",
      "declare function runtimePath(): string",
      "export function register(server: RouteHost) {",
      "  const routePath = runtimePath()",
      "  server.post(routePath, handler)",
      "}",
      "",
    ].join("\n"),
  )
  assert.throws(
    () => extractBffRoutes({ root, paths: [shadowedPath] }),
    /Fastify shorthand route path must be a static absolute literal/,
  )
})

test("unsupported or dynamic Fastify route registration fails closed", () => {
  const fixtures = [
    "server.get(routePath, handler)",
    "server.route(routeOptions)",
    'server.route({ ...routeOptions, method: "GET", url: "/spread" })',
    'server[method]("/dynamic", handler)',
    "const post = server.post.bind(server)",
    'server.post.call(server, "/call", handler)',
    'server.post.apply(server, ["/apply", handler])',
    'Reflect.apply(server.post, server, ["/reflect", handler])',
    'server.post("/constrained", { constraints: { version: "1.0.0" } }, handler)',
    'server.post("/variable-options", routeOptions, handler)',
    'server.post("/spread-options", { ...routeOptions }, handler)',
    'server.route({ method: "POST", url: "/versioned", version: "1.0.0", handler })',
    'server.all("/all", handler)',
    "server.register(plugin)",
    'server.addHttpMethod("PURGE", handler)',
    "server.setNotFoundHandler(handler)",
    'server.addHook("preHandler", authHook)',
    'server.server.prependListener("request", handler)',
    'server["ser" + "ver"].prependListener("request", handler)',
  ]

  for (const [index, statement] of fixtures.entries()) {
    const root = temporaryRoot()
    const path = `apps/bff/src/routes/v2/rejected-${index}.ts`
    writeFixture(
      root,
      path,
      [
        'import type { FastifyInstance } from "fastify"',
        "declare const routePath: string",
        "declare const routeOptions: unknown",
        "declare const method: string",
        "declare const handler: unknown",
        "declare const authHook: unknown",
        "declare const plugin: unknown",
        "export function register(server: FastifyInstance) {",
        `  ${statement}`,
        "}",
        "",
      ].join("\n"),
    )
    assert.throws(
      () => extractBffRoutes({ root, paths: [path] }),
      /Fastify (?:route|shorthand|raw server)|Unsupported Fastify|Dynamic Fastify|Unreviewed Fastify/,
    )
  }
})

test("the PR-04 database close hook is exact and fail-closed", () => {
  const root = temporaryRoot()
  const path = "apps/bff/src/index.ts"
  const source = readFileSync(join(repositoryRoot, path), "utf8")
  writeFixture(root, path, source)
  assert.doesNotThrow(() => extractBffRoutes({ root, paths: [path] }))

  writeFixture(
    root,
    path,
    source.replace(
      'server.addHook("onClose", closeInferenceCoreDb)',
      'server.addHook("onClose", unreviewedClose)',
    ),
  )
  assert.throws(
    () => extractBffRoutes({ root, paths: [path] }),
    /Unreviewed Fastify route-control API addHook/,
  )
})

test("Fastify instances cannot escape to production-only or misbound registrars", () => {
  const fixtures = [
    {
      importLine: 'import { attach } from "./services/stealth"',
      invocation: "attach(server)",
    },
    {
      importLine: 'import { registerAdminRoutes } from "./services/stealth"',
      invocation: "registerAdminRoutes(server)",
    },
    {
      importLine: 'import { attach } from "./services/stealth"',
      invocation: "attach(() => server)",
    },
    {
      importLine: 'import { attach } from "./services/stealth"',
      invocation: "Reflect.apply(attach, null, [server])",
    },
  ]

  for (const fixture of fixtures) {
    const root = temporaryRoot()
    const indexPath = "apps/bff/src/index.ts"
    writeFixture(
      root,
      indexPath,
      [
        'import Fastify, { type FastifyInstance } from "fastify"',
        fixture.importLine,
        "export function buildServer(): FastifyInstance {",
        "  const server = Fastify({ bodyLimit: bffBodyLimitBytes(), logger: true })",
        '  if (process.env.NODE_ENV === "production") {',
        `    ${fixture.invocation}`,
        "  }",
        "  return server",
        "}",
        "",
      ].join("\n"),
    )
    assert.throws(
      () => extractBffRoutes({ root, paths: [indexPath] }),
      /Fastify instance may not escape|Reviewed Fastify registrar/,
    )
  }
})

test("Fastify instances cannot be captured, assigned, or exported", () => {
  const statements = [
    "const leaked = { server }",
    "globalThis.leaked = server",
    "const leaked = [server]",
    "const leaked = () => server",
  ]

  for (const statement of statements) {
    const root = temporaryRoot()
    const indexPath = "apps/bff/src/index.ts"
    writeFixture(
      root,
      indexPath,
      [
        'import Fastify, { type FastifyInstance } from "fastify"',
        "export function buildServer(): FastifyInstance {",
        "  const server = Fastify({ bodyLimit: bffBodyLimitBytes(), logger: true })",
        `  ${statement}`,
        "  return server",
        "}",
        "",
      ].join("\n"),
    )
    assert.throws(
      () => extractBffRoutes({ root, paths: [indexPath] }),
      /Fastify instance may not be captured|Fastify instance may not be assigned|Fastify instance may not be exported/,
    )
  }
})

test("Fastify factory, receiver, and registrar capabilities are default deny", () => {
  const rejectedBodies = [
    ["  const make = Fastify", "  const server = make()", "  return server"],
    [
      "  const server = Fastify({ bodyLimit: bffBodyLimitBytes(), logger: true })",
      "  const hidden = server as any",
      '  hidden.server.prependListener("request", () => undefined)',
      "  return server",
    ],
    [
      "  const server = Fastify({ bodyLimit: bffBodyLimitBytes(), logger: true })",
      "  let hidden: any",
      "  hidden ||= server",
      "  return server",
    ],
    [
      "  const server = Fastify({ bodyLimit: bffBodyLimitBytes(), logger: true })",
      "  new AttachRoutes(server)",
      "  return server",
    ],
    [
      "  const server = Fastify({ bodyLimit: bffBodyLimitBytes(), logger: true, rewriteUrl })",
      "  return server",
    ],
  ]
  for (const [index, body] of rejectedBodies.entries()) {
    const root = temporaryRoot()
    const path = "apps/bff/src/index.ts"
    writeFixture(
      root,
      path,
      [
        'import Fastify, { type FastifyInstance } from "fastify"',
        "declare const AttachRoutes: new (server: unknown) => unknown",
        "declare const rewriteUrl: (request: unknown) => string",
        "export function buildServer(): FastifyInstance {",
        ...body,
        "}",
        "",
      ].join("\n"),
    )
    assert.throws(
      () => extractBffRoutes({ root, paths: [path] }),
      /Fastify factory|Fastify instance|Unreviewed Fastify/,
      `rejected body ${index}`,
    )
  }

  const shadowRoot = temporaryRoot()
  const shadowPath = "apps/bff/src/index.ts"
  writeFixture(
    shadowRoot,
    shadowPath,
    [
      'import Fastify, { type FastifyInstance } from "fastify"',
      'import { registerAdminRoutes } from "./routes/admin"',
      "declare const attach: (server: FastifyInstance) => void",
      "export function buildServer(registerAdminRoutes = attach): FastifyInstance {",
      "  const server = Fastify({ bodyLimit: bffBodyLimitBytes(), logger: true })",
      "  registerAdminRoutes(server)",
      "  return server",
      "}",
      "",
    ].join("\n"),
  )
  assert.throws(
    () => extractBffRoutes({ root: shadowRoot, paths: [shadowPath] }),
    /Reviewed buildServer definition changed|registrar binding may not be shadowed/,
  )
})

test("workspace package route-control APIs are part of the BFF closure", () => {
  for (const [index, statement] of [
    "target.setNotFoundHandler(handler)",
    "target.setErrorHandler(handler)",
    'target.addHook("onRequest", handler)',
    "target.register(plugin)",
  ].entries()) {
    const root = temporaryRoot()
    const path = `packages/contracts/src/stealth-${index}.ts`
    writeFixture(
      root,
      path,
      [
        "declare const handler: unknown",
        "declare const plugin: unknown",
        "export function attach(target: any) {",
        `  ${statement}`,
        "}",
        "",
      ].join("\n"),
    )
    assert.throws(
      () => extractBffRoutes({ root, paths: [path] }),
      /Unsupported Fastify|Unreviewed Fastify/,
    )
  }
})

test("reviewed Fastify registrar wiring is exact and shrink-only", () => {
  const root = temporaryRoot()
  const indexPath = "apps/bff/src/index.ts"
  const adminPath = "apps/bff/src/routes/admin.ts"
  const paths = [indexPath, adminPath]
  writeFixture(
    root,
    indexPath,
    [
      'import Fastify, { type FastifyInstance } from "fastify"',
      'import { registerAdminRoutes } from "./routes/admin"',
      "export function buildServer(): FastifyInstance {",
      "  const server = Fastify({ bodyLimit: bffBodyLimitBytes(), logger: true })",
      "  const emergencyRecoveryService = null",
      "  registerAdminRoutes(server, { emergencyRecoveryService })",
      "  return server",
      "}",
      "",
    ].join("\n"),
  )
  writeFixture(
    root,
    adminPath,
    [
      'import type { FastifyInstance } from "fastify"',
      "declare function withCapability(capability: string): unknown",
      "export interface AdminRouteOptions { emergencyRecoveryService: unknown }",
      "export function registerAdminRoutes(",
      "  server: FastifyInstance,",
      "  options: AdminRouteOptions = { emergencyRecoveryService: null },",
      "): void {",
      '  server.get("/api/admin/overview", withCapability("console.operational.view"), async () => options.emergencyRecoveryService)',
      "}",
      "",
    ].join("\n"),
  )

  assert.deepEqual(
    extractBffRoutes({ root, paths }).map(({ method, path }) => ({
      method,
      path,
    })),
    [{ method: "GET", path: "/api/admin/overview" }],
  )
  assert.deepEqual(extractFastifyRegistrarManifest({ root, paths }), [
    {
      exportName: "registerAdminRoutes",
      importSource: "./routes/admin",
      sourcePath: adminPath,
    },
  ])
})

test("unreviewed Fastify imports and dynamic code loading fail closed", () => {
  const root = temporaryRoot()
  const importPath = "packages/contracts/src/fastify.ts"
  writeFixture(
    root,
    importPath,
    'import Fastify from "fastify"\nexport const server = Fastify()\n',
  )
  assert.throws(
    () => extractBffRoutes({ root, paths: [importPath] }),
    /Unreviewed Fastify import/,
  )

  const dynamicPath = "packages/contracts/src/dynamic.ts"
  writeFixture(root, dynamicPath, 'export const plugin = require("./plugin")\n')
  assert.throws(
    () => extractBffRoutes({ root, paths: [dynamicPath] }),
    /Dynamic code loading is not allowed/,
  )

  const deepImportPath = "packages/contracts/src/deep-fastify.ts"
  writeFixture(
    root,
    deepImportPath,
    'import createServer from "fastify/fastify"\nexport const server = createServer()\n',
  )
  assert.throws(
    () => extractBffRoutes({ root, paths: [deepImportPath] }),
    /Unreviewed Fastify subpath import/,
  )

  const createRequirePath = "packages/contracts/src/create-require.ts"
  writeFixture(
    root,
    createRequirePath,
    [
      'import { createRequire } from "node:module"',
      "const load = createRequire(import.meta.url)",
      'export const createServer = load("fastify")',
      "",
    ].join("\n"),
  )
  assert.throws(
    () => extractBffRoutes({ root, paths: [createRequirePath] }),
    /Dynamic CommonJS loader creation|Dynamic Fastify loading/,
  )
})

test("non-route Map and Headers method calls remain ignored", () => {
  const root = temporaryRoot()
  const path = "apps/bff/src/services/example.ts"
  writeFixture(
    root,
    path,
    [
      'const values = new Map([["key", "value"]])',
      'values.get("key")',
      'new Headers().get("content-type")',
      "",
    ].join("\n"),
  )

  assert.deepEqual(extractBffRoutes({ root, paths: [path] }), [])
})

test("Web inference endpoint-string invocation sites are frozen shrink-only", () => {
  const root = temporaryRoot()
  const legacyPath = "apps/web/src/app/api/hub/chat/route.ts"
  const applicationPath =
    "apps/web/src/components/console-v2/applications-v2-experience.tsx"
  const referenceOnlyPath = "apps/web/src/lib/admin/mock-data.ts"
  const shadowedPath = "apps/web/src/components/shadowed.ts"
  writeFixture(
    root,
    legacyPath,
    [
      "declare const baseUrl: string",
      "export async function POST() {",
      "  return fetch(`${baseUrl}/v1/chat/completions`)",
      "}",
      "",
    ].join("\n"),
  )
  writeFixture(
    root,
    applicationPath,
    [
      'const endpoint = "/api/app-gateway/v1/" + "chat/completions"',
      "declare const baseUrl: string",
      "export async function sendPrompt() {",
      "  await fetch(endpoint)",
      '  await fetch("/api/app-gateway/v1/chat/" + "completions")',
      "  await fetch(`${baseUrl}/v1/chat/completions`)",
      "}",
      "",
    ].join("\n"),
  )
  writeFixture(
    root,
    referenceOnlyPath,
    'export const example = { baseUrl: "/v1/chat/completions" }\n',
  )
  writeFixture(
    root,
    shadowedPath,
    [
      'const endpoint = "/safe"',
      "export function invoke() {",
      '  const endpoint = "/v1/chat/completions"',
      "  return fetch(endpoint)",
      "}",
      "",
    ].join("\n"),
  )

  const legacy = extractWebInferenceConsumers({
    root,
    paths: [legacyPath, referenceOnlyPath],
  })
  const expanded = extractWebInferenceConsumers({
    root,
    paths: [legacyPath, applicationPath, referenceOnlyPath, shadowedPath],
  })

  assert.deepEqual(
    legacy.map(({ path, invocationCount }) => ({ path, invocationCount })),
    [{ path: legacyPath, invocationCount: 1 }],
  )
  assert.deepEqual(
    expanded.map(({ path, invocationCount }) => ({ path, invocationCount })),
    [
      { path: legacyPath, invocationCount: 1 },
      { path: applicationPath, invocationCount: 3 },
      { path: shadowedPath, invocationCount: 1 },
    ],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink(
      { routes: [], webInferenceConsumers: legacy },
      { routes: [], webInferenceConsumers: expanded },
    ),
    [
      `Web inference consumer changed ${applicationPath}`,
      `Web inference consumer changed ${shadowedPath}`,
    ],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink(
      { routes: [], webInferenceConsumers: legacy },
      { routes: [], webInferenceConsumers: [] },
    ),
    [],
  )
})

test("Web route discovery covers every supported JavaScript and TypeScript extension", () => {
  const root = temporaryRoot()
  const paths = [
    "apps/web/src/app/from-js/page.js",
    "apps/web/src/app/from-jsx/page.jsx",
    "apps/web/src/app/from-ts/page.ts",
    "apps/web/src/app/from-tsx/page.tsx",
    "apps/web/app/from-root/page.tsx",
    "apps/web/src/app/api/from-js/route.js",
    "apps/web/src/app/api/from-jsx/route.jsx",
    "apps/web/src/app/api/from-ts/route.ts",
    "apps/web/src/app/api/from-tsx/route.tsx",
    "apps/web/app/api/from-root/route.ts",
  ]
  for (const path of paths) {
    writeFixture(
      root,
      path,
      path.includes("/api/")
        ? path.includes("from-root")
          ? "export const GET = () => null\n"
          : "export async function POST() {}\n"
        : "export default function Page() { return null }\n",
    )
  }

  const routes = extractWebRoutes({ root, paths })
  assert.deepEqual(
    routes.map(({ method, path }) => ({ method, path })),
    [
      { method: "PAGE", path: "/from-js" },
      { method: "PAGE", path: "/from-jsx" },
      { method: "PAGE", path: "/from-ts" },
      { method: "PAGE", path: "/from-tsx" },
      { method: "PAGE", path: "/from-root" },
      { method: "POST", path: "/api/from-js" },
      { method: "POST", path: "/api/from-jsx" },
      { method: "POST", path: "/api/from-ts" },
      { method: "POST", path: "/api/from-tsx" },
      { method: "GET", path: "/api/from-root" },
    ],
  )
})

test("alternate Next routing entrypoints fail closed", () => {
  const root = temporaryRoot()
  const paths = [
    "apps/web/src/pages/hidden-chat.tsx",
    "apps/web/middleware.mjs",
    "apps/web/next.config.mjs",
    "apps/web/src/proxy.ts",
    "apps/web/src/app/not-found.tsx",
  ]
  for (const path of paths) {
    writeFixture(root, path, "export default function hidden() {}\n")
    assert.throws(
      () => extractWebRoutes({ root, paths: [path] }),
      /Next Pages Router|Unreviewed Next/,
    )
  }
})

test("Next static assets and metadata routes are inventoried", () => {
  const root = temporaryRoot()
  const paths = [
    "apps/web/public/chat.html",
    "apps/web/src/app/icon.svg",
    "apps/web/app/robots.ts",
    "apps/web/app/opengraph-image.tsx",
  ]
  for (const path of paths) {
    writeFixture(root, path, "fixture\n")
  }

  assert.deepEqual(
    extractWebRoutes({ root, paths }).map(({ surface, method, path }) => ({
      surface,
      method,
      path,
    })),
    [
      {
        surface: "web-static",
        method: "STATIC",
        path: "/chat.html",
      },
      {
        surface: "web-metadata",
        method: "METADATA",
        path: "/icon.svg",
      },
      {
        surface: "web-metadata",
        method: "METADATA",
        path: "/robots.txt",
      },
      {
        surface: "web-metadata",
        method: "METADATA",
        path: "/opengraph-image",
      },
    ],
  )
})

test("Next middleware rewrites cannot hide route surfaces", () => {
  const root = temporaryRoot()
  const paths = ["apps/web/src/middleware.ts", "apps/web/src/lib/proxy.ts"]
  writeFixture(
    root,
    paths[0],
    'export default () => NextResponse.rewrite(new URL("/chat", "https://example.invalid"))\n',
  )
  writeFixture(root, paths[1], 'export const proxy = NextResponse["rewrite"]\n')

  for (const path of paths) {
    assert.throws(
      () => extractWebRoutes({ root, paths: [path] }),
      /Next middleware rewrite registration is not allowed/,
    )
  }
})

test("Next middleware cannot create direct response surfaces", () => {
  const root = temporaryRoot()
  const path = "apps/web/src/middleware.ts"
  writeFixture(
    root,
    path,
    [
      'import { NextResponse } from "next/server"',
      'import { auth } from "@/lib/auth/auth"',
      "const createAuthMiddleware = auth",
      "const requireAuthenticatedSession = createAuthMiddleware(() => NextResponse.next())",
      "export default function middleware() {",
      '  return new Response("<html>chat</html>")',
      "}",
      "",
    ].join("\n"),
  )

  assert.throws(
    () => extractWebRoutes({ root, paths: [path] }),
    /Next middleware may not construct response bodies|Unreviewed Next middleware return form/,
  )
})

test("Next middleware helpers must have reviewed provenance", () => {
  const root = temporaryRoot()
  const path = "apps/web/src/middleware.ts"
  writeFixture(
    root,
    path,
    [
      'import { NextResponse } from "next/server"',
      'import { auth, maliciousCallback } from "./evil"',
      "const createAuthMiddleware = auth",
      "const requireAuthenticatedSession = createAuthMiddleware(maliciousCallback)",
      "export default function middleware(request, event) {",
      "  return requireAuthenticatedSession(request, event)",
      "}",
      "",
    ].join("\n"),
  )

  assert.throws(
    () => extractWebRoutes({ root, paths: [path] }),
    /Missing reviewed Next middleware import|authenticated-session wrapper changed/,
  )
})

test("Next middleware accepts self-contained non-response helpers", () => {
  const root = temporaryRoot()
  const path = "apps/web/src/middleware.ts"
  writeFixture(
    root,
    path,
    [
      'import { NextResponse } from "next/server"',
      'import { auth } from "@/lib/auth/auth"',
      "const createAuthMiddleware = auth",
      "export default function middleware(request, event) {",
      "  if (!isProtectedConsolePath(request.nextUrl.pathname)) {",
      "    return NextResponse.next()",
      "  }",
      "  const requireAuthenticatedSession = createAuthMiddleware((request) => {",
      "    if (request.auth) return NextResponse.next()",
      "    return NextResponse.redirect(getSignInRedirectUrl(request.nextUrl.href))",
      "  })",
      "  return requireAuthenticatedSession(request, event)",
      "}",
      "function isProtectedConsolePath(pathname) {",
      '  return pathname === "/" || isPathWithin(pathname, "/applications")',
      "}",
      "function getSignInRedirectUrl(requestUrl) {",
      '  const signInUrl = new URL("/auth/signin", requestUrl)',
      '  signInUrl.searchParams.set("callbackUrl", requestUrl)',
      "  return signInUrl",
      "}",
      "function isPathWithin(pathname, root) {",
      "  return pathname === root || pathname.startsWith(`${root}/`)",
      "}",
      "",
    ].join("\n"),
  )

  assert.doesNotThrow(() => extractWebRoutes({ root, paths: [path] }))
})

test("sanitized Core commands reject environment files in any package", () => {
  const root = temporaryRoot()
  writeFixture(root, "packages/contracts/.env.local", "TOKEN=example\n")

  assert.throws(
    () => assertNoUnexpectedEnvironmentFiles(root),
    /packages\/contracts\/\.env\.local/,
  )

  const symlinkRoot = temporaryRoot()
  writeFixture(symlinkRoot, "outside.env", "TOKEN=example\n")
  mkdirSync(join(symlinkRoot, "packages"), { recursive: true })
  symlinkSync("../outside.env", join(symlinkRoot, "packages/.env.local"))
  assert.throws(
    () => assertNoUnexpectedEnvironmentFiles(symlinkRoot),
    /packages\/\.env\.local/,
  )
})

test("Core package scripts cannot be replaced with no-op commands", () => {
  const root = temporaryRoot()
  const manifests = [
    ["apps/bff/package.json", "@llm-machines/bff"],
    ["apps/web/package.json", "@llm-machines/web"],
    ["packages/contracts/package.json", "@llm-machines/contracts"],
    ["packages/copy/package.json", "@llm-machines/copy"],
  ]
  for (const [path, name] of manifests) {
    writeFixture(
      root,
      path,
      `${JSON.stringify({
        name,
        dependencies:
          name === "@llm-machines/bff"
            ? { "@llm-machines/contracts": "workspace:*" }
            : name === "@llm-machines/web"
              ? {
                  "@llm-machines/contracts": "workspace:*",
                  "@llm-machines/copy": "workspace:*",
                }
              : {},
        scripts: { build: "true", test: "true", typecheck: "true" },
      })}\n`,
    )
  }
  writeFixture(root, "package.json", '{"scripts":{}}\n')
  writeFixture(
    root,
    "pnpm-workspace.yaml",
    "packages:\n  - apps/*\n  - packages/*\n",
  )

  const errors = verifyCorePackageClosure(
    root,
    manifests.map(([path]) => path),
  )
  assert.equal(
    errors.filter((error) => error.startsWith("invalid @llm-machines/")).length,
    12,
  )
})

test("Core lifecycle companion scripts cannot bypass locked commands", () => {
  const root = temporaryRoot()
  const manifestPaths = [
    "apps/bff/package.json",
    "apps/web/package.json",
    "packages/contracts/package.json",
    "packages/copy/package.json",
  ]
  const lifecycleNames = ["prebuild", "posttypecheck", "pretest", "posttest"]
  for (const [index, path] of manifestPaths.entries()) {
    const manifest = JSON.parse(
      readFileSync(join(repositoryRoot, path), "utf8"),
    )
    manifest.scripts[lifecycleNames[index]] = "node unreviewed.mjs"
    writeFixture(root, path, `${JSON.stringify(manifest)}\n`)
  }
  const rootManifest = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  )
  rootManifest.scripts.pretest = "node unreviewed.mjs"
  rootManifest.scripts["postbuild:inference-core"] = "node unreviewed.mjs"
  writeFixture(root, "package.json", `${JSON.stringify(rootManifest)}\n`)
  writeFixture(
    root,
    "pnpm-workspace.yaml",
    "packages:\n  - apps/*\n  - packages/*\n",
  )
  const configPaths = ["apps/bff/vitest.config.ts", "apps/web/vitest.config.ts"]
  for (const path of configPaths) {
    writeFixture(root, path, "export default {}\n")
  }

  const errors = verifyCorePackageClosure(root, [
    ...manifestPaths,
    ...configPaths,
  ])
  assert.equal(
    errors.filter((error) => error.includes("lifecycle script")).length,
    6,
  )
})

test("Core root scripts lock the current base and standalone DB commands", () => {
  const root = temporaryRoot()
  const paths = [
    "apps/bff/package.json",
    "apps/bff/vitest.config.ts",
    "apps/web/package.json",
    "apps/web/vitest.config.ts",
    "packages/contracts/package.json",
    "packages/copy/package.json",
  ]
  for (const path of [...paths, "package.json", "pnpm-workspace.yaml"]) {
    writeFixture(root, path, readFileSync(join(repositoryRoot, path)))
  }

  assert.doesNotMatch(
    verifyCorePackageClosure(root, paths).join("\n"),
    /invalid Core-only script check:inference-core:base/,
  )

  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  manifest.scripts["check:inference-core:base"] =
    "node scripts/inference-core/guardrails.mjs --base-ref 9c502a6d4d79435f469288aa66001db7c4be4aa5"
  manifest.scripts["test:inference-core-db"] = "true"
  manifest.scripts["typecheck:inference-core-db"] = "true"
  writeFixture(root, "package.json", `${JSON.stringify(manifest)}\n`)

  const errors = verifyCorePackageClosure(root, paths)
  assert.match(
    errors.join("\n"),
    /invalid Core-only script check:inference-core:base/,
  )
  assert.match(
    errors.join("\n"),
    /invalid Core-only script test:inference-core-db/,
  )
  assert.match(
    errors.join("\n"),
    /invalid Core-only script typecheck:inference-core-db/,
  )
})

test("retention register rejects unreviewed top-level claims", () => {
  const root = temporaryRoot()
  const path = "docs/reduction/inference-core/retention-characterization.json"
  const register = JSON.parse(readFileSync(join(repositoryRoot, path), "utf8"))
  register.productionZeroRetention = "PASS"
  writeFixture(root, path, `${JSON.stringify(register)}\n`)

  assert.match(
    verifyRetentionCharacterization(root).join("\n"),
    /overstates PR-01 evidence/,
  )
})

test("the live repository matches its current reviewed baselines", () => {
  const result = verifyRepository({
    baseRef: process.env.INFERENCE_CORE_BASE_REF ?? pr06ContractBase,
  })
  assert.deepEqual(result.errors, [])
  assert.equal(result.ok, true)
  assert.equal(result.routeCount > 0, true)
  assert.equal(result.findingCount > 0, true)
})

test("historical target verifiers defer only to reviewed successors", () => {
  const currentAllowlist = { entries: [] }
  const currentRoutes = {
    routes: [],
    fastifyRegistrars: [],
    webInferenceConsumers: [],
    fingerprints: [],
    escapeHatches: [],
    reviewedRevisions: [{ id: "PR-05" }],
  }

  assert.deepEqual(
    verifyPr03TargetState({ currentAllowlist, currentRoutes }),
    [],
  )
  assert.deepEqual(
    verifyPr04TargetState({
      currentAllowlist,
      currentRoutes,
      paths: [],
    }),
    [],
  )

  const pr04Successor = structuredClone(currentRoutes)
  pr04Successor.reviewedRevisions = [{ id: "PR-04" }]
  assert.deepEqual(
    verifyPr03TargetState({
      currentAllowlist,
      currentRoutes: pr04Successor,
    }),
    [],
  )

  const pr06Successor = structuredClone(currentRoutes)
  pr06Successor.reviewedRevisions = [{ id: "PR-06" }]
  assert.deepEqual(
    verifyPr03TargetState({
      currentAllowlist,
      currentRoutes: pr06Successor,
    }),
    [],
  )
  assert.deepEqual(
    verifyPr04TargetState({
      currentAllowlist,
      currentRoutes: pr06Successor,
      paths: [],
    }),
    [],
  )
  assert.deepEqual(
    verifyPr05TargetState({
      currentAllowlist,
      currentRoutes: pr06Successor,
      paths: [],
    }),
    [],
  )

  const unknownSuccessor = structuredClone(currentRoutes)
  unknownSuccessor.reviewedRevisions = [{ id: "PR-07" }]
  assert.match(
    verifyPr03TargetState({
      currentAllowlist,
      currentRoutes: unknownSuccessor,
    }).join("\n"),
    /PR-03 total route count changed/,
  )
  assert.match(
    verifyPr04TargetState({
      currentAllowlist,
      currentRoutes: unknownSuccessor,
      paths: [],
    }).join("\n"),
    /PR-04 total route count changed/,
  )
  assert.match(
    verifyPr05TargetState({
      currentAllowlist,
      currentRoutes: unknownSuccessor,
      paths: [],
    }).join("\n"),
    /PR-05 total route count changed/,
  )
})

test("unknown active reviewed revisions fail closed", () => {
  assert.deepEqual(verifyActiveReviewedRevisionId("PR-02"), [])
  assert.deepEqual(verifyActiveReviewedRevisionId("PR-06"), [])
  assert.deepEqual(verifyActiveReviewedRevisionId(undefined), [])
  assert.deepEqual(verifyActiveReviewedRevisionId("PR-07"), [
    "unsupported active reviewed revision PR-07",
  ])
})

test("the production closure contains every package and container entrypoint", () => {
  const baseline = JSON.parse(
    readFileSync(
      join(repositoryRoot, "docs/reduction/inference-core/route-baseline.json"),
      "utf8",
    ),
  )
  const paths = new Set(baseline.sourceClosure.map((entry) => entry.path))
  for (const path of [
    ".dockerignore",
    "apps/bff/Dockerfile",
    "apps/bff/package.json",
    "apps/web/Dockerfile",
    "apps/web/package.json",
    "apps/web/postcss.config.mjs",
    "package.json",
    "packages/contracts/package.json",
    "packages/copy/package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ]) {
    assert.equal(paths.has(path), true, `missing production boundary ${path}`)
  }
})

test("leading-dash base refs fail closed", () => {
  const result = verifyRepository({ baseRef: "--help" })
  assert.equal(result.baseStatus, "unavailable")
  assert.match(result.errors.join("\n"), /base ref is unavailable --help/)
})

function initializedGitRoot() {
  const root = temporaryRoot()
  git(root, ["init", "--quiet"])
  git(root, ["config", "user.name", "Guardrail Test"])
  git(root, ["config", "user.email", "guardrail@example.invalid"])
  return root
}

function pr02RevisionFixture({
  mutate,
  operationPolicy = emptyPr02OperationPolicy(),
} = {}) {
  const root = temporaryRoot()
  execFileSync(
    "git",
    ["clone", "--quiet", "--shared", "--no-checkout", repositoryRoot, root],
    {
      stdio: "ignore",
    },
  )
  const baseCommit = "bb60cb0dfe46a39189e2a80fe1839e8288201492"
  const baseAllowlist = {
    policyDigest: "forbidden-before",
    protectedFiles: [],
    entries: [],
  }
  const currentAllowlist = {
    policyDigest: "forbidden-after",
    protectedFiles: [],
    entries: [],
  }
  const baseRoutes = {
    policyDigest: "route-before",
    target: {
      requiredPublicInference: [],
      requiredPrivateOperational: [],
    },
    routes: [],
    fastifyRegistrars: [],
    webInferenceConsumers: [],
    sourceClosure: [],
    repositoryClosure: [],
    fingerprints: [],
    escapeHatches: [],
    reviewedRevisions: [],
  }
  const currentRoutes = structuredClone(baseRoutes)
  currentRoutes.policyDigest = "route-after"
  mutate?.({
    baseAllowlist,
    currentAllowlist,
    baseRoutes,
    currentRoutes,
  })

  const evidencePaths = [
    "docs/reduction/inference-core/pr-02-boundary-decisions.json",
    "scripts/inference-core/pr02-boundaries.test.mjs",
    "scripts/inference-core/pr02-contract-revision.mjs",
  ]
  for (const path of evidencePaths) {
    writeFixture(root, path, `${path}\n`)
  }
  const evidenceFiles = evidencePaths.map((path) => ({
    path,
    sha256: testSha256(readFileSync(join(root, path))),
  }))
  const revision = buildContractRevisionDocument({
    baseCommit,
    baseTree: git(root, ["rev-parse", `${baseCommit}^{tree}`]),
    baseAllowlist,
    currentAllowlist,
    baseRoutes,
    currentRoutes,
    evidenceFiles,
  })
  const serializedRevision = `${JSON.stringify(revision, null, 2)}\n`
  writeFixture(root, pr02ContractRevisionPath, serializedRevision)
  currentRoutes.reviewedRevisions = [
    {
      id: "PR-02",
      path: pr02ContractRevisionPath,
      sha256: testSha256(serializedRevision),
    },
  ]

  return {
    root,
    baseCommit,
    baseAllowlist,
    currentAllowlist,
    baseRoutes,
    currentRoutes,
    operationPolicy,
  }
}

function emptyPr02OperationPolicy() {
  return {
    addedSourcePaths: [],
    changedSourcePaths: [],
    deletedSourcePaths: [],
    addedRepositoryPaths: [],
    changedRepositoryPaths: [],
    deletedRepositoryPaths: [],
    mutableEscapeHatchPaths: [],
  }
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

function testSha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "llmm-pr01-"))
  temporaryRoots.push(root)
  return root
}

function writeFixture(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}
