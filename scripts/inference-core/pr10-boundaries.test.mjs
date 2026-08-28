import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
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
import { pathToFileURL } from "node:url"
import {
  pr10AllowedRepositoryPaths,
  pr10ContractBase,
  pr10ContractBaseTree,
  pr10ContractRevisionPath,
  pr10DecisionPath,
  pr10ExpectedOperationPolicy,
  pr10GeneratedDestinationPaths,
  pr10GovernancePaths,
  pr10LaneAnchor,
  pr10LifecycleCodePaths,
  pr10LifecycleComponents,
  pr10Pr06FixtureRepair,
  pr10ProductionSourcePaths,
  pr10RequiredFrozenRepositoryPaths,
  pr10ReviewedDispositions,
  pr10RevisionEvidencePaths,
  pr10SourceEvidencePaths,
  pr10StandaloneDbTestBoundary,
  pr10TargetContract,
  pr10cContractBase,
  pr10cContractBaseTree,
  repositoryRoot,
  routeBaselinePath,
  verifyPr10BaseEvidence,
  verifyPr10DecisionDocument,
  verifyPr10GeneratedDestinationBoundary,
  verifyPr10HistoricalFixtureRepair,
  verifyPr10OperationBoundary,
  verifyPr10SourceBoundary,
  verifyPr10TargetState,
  verifyReviewedContractRevision,
} from "./guardrails.mjs"

test("PR-10 is anchored to the accepted PR-09 integration tree", () => {
  assert.equal(pr10ContractBase, "e9f2516585dccec69317fd0426ac4fcf6fa0d9b1")
  assert.equal(pr10LaneAnchor, pr10ContractBase)
  assert.equal(pr10ContractBaseTree, "e0046213fa9641f606a575c3dd85407806ba2874")
  assert.equal(
    gitAt(repositoryRoot, ["rev-parse", `${pr10ContractBase}^{tree}`]),
    pr10ContractBaseTree,
  )
})

test("PR-10 retains every PR-02 through PR-09 evidence file byte-identically", () => {
  assert.deepEqual(verifyPr10BaseEvidence(), [])
})

test("reviewed revision history recognizes only an exact PR-10 append", () => {
  withBaseClone("revision", (root) => {
    const baseAllowlist = readJson(
      join(
        root,
        "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
      ),
    )
    const baseRoutes = readJson(join(root, routeBaselinePath))
    const currentRoutes = structuredClone(baseRoutes)
    currentRoutes.reviewedRevisions.push({
      id: "PR-10",
      path: pr10ContractRevisionPath,
      sha256: "a".repeat(64),
    })

    const result = verifyReviewedContractRevision({
      root,
      baseCommit: pr10ContractBase,
      baseAllowlist,
      currentAllowlist: baseAllowlist,
      baseRoutes,
      currentRoutes,
    })
    assert.equal(result.present, true)
    assert.equal(result.id, "PR-10")
    assert.match(
      result.errors.join("\n"),
      /missing reviewed contract revision .*PR-10\.json/,
    )

    const reordered = structuredClone(currentRoutes)
    reordered.reviewedRevisions.reverse()
    assert.match(
      verifyReviewedContractRevision({
        root,
        baseCommit: pr10ContractBase,
        baseAllowlist,
        currentAllowlist: baseAllowlist,
        baseRoutes,
        currentRoutes: reordered,
      }).errors.join("\n"),
      /unsupported reviewed contract revision history transition/,
    )

    for (const path of [
      ...pr10SourceEvidencePaths,
      ...pr10RevisionEvidencePaths,
    ]) {
      copyAcceptedPr10Path(root, path)
    }
    const rootedDecisionPath = resolve(root, pr10DecisionPath)
    const rootedDecision = readJson(rootedDecisionPath)
    rootedDecision.sourceEvidence = pr10SourceEvidencePaths.map((path) => ({
      path,
      sha256: sha256(readFileSync(resolve(root, path))),
    }))
    writeFileSync(rootedDecisionPath, `${JSON.stringify(rootedDecision)}\n`)
    const revisionPath = resolve(root, pr10ContractRevisionPath)
    mkdirSync(dirname(revisionPath), { recursive: true })
    writeFileSync(revisionPath, "{}\n")
    const rootedResult = verifyReviewedContractRevision({
      root,
      baseCommit: pr10ContractBase,
      baseAllowlist,
      currentAllowlist: baseAllowlist,
      baseRoutes,
      currentRoutes,
    })
    assert.doesNotMatch(
      rootedResult.errors.join("\n"),
      /invalid PR-10 source evidence/,
    )

    const changedEvidencePath = resolve(root, pr10SourceEvidencePaths[0])
    writeFileSync(
      changedEvidencePath,
      `${readFileSync(changedEvidencePath, "utf8")}\n`,
    )
    assert.match(
      verifyReviewedContractRevision({
        root,
        baseCommit: pr10ContractBase,
        baseAllowlist,
        currentAllowlist: baseAllowlist,
        baseRoutes,
        currentRoutes,
      }).errors.join("\n"),
      /invalid PR-10 source evidence/,
    )
  })
})

test("PR-10 fixes a source-only lifecycle foundation decision", () => {
  const decision = readJson(resolve(repositoryRoot, pr10DecisionPath))
  assert.deepEqual(decision.reviewedDispositions, pr10ReviewedDispositions)
  assert.deepEqual(
    decision.standaloneDbTestBoundary,
    pr10StandaloneDbTestBoundary,
  )
  assert.deepEqual(decision.target, pr10TargetContract)
  assert.equal(
    ["pending-final-staged-delta", "reviewed"].includes(decision.reviewStatus),
    true,
  )
  assert.deepEqual(
    decision.reviewedDispositions.lifecycleFoundation.components,
    pr10LifecycleComponents,
  )
  assert.equal(
    decision.reviewedDispositions.lifecycleFoundation.consistencyModel,
    "coordinated-quiescence-not-cross-service-acid",
  )
  assert.equal(decision.reviewedDispositions.snapshotManifest.contentFree, true)
  assert.equal(
    decision.reviewedDispositions.snapshotManifest.workloadContentIncluded,
    false,
  )
  assert.deepEqual(decision.reviewedDispositions.restoreSafety, {
    validateManifestBeforeOperationAdmission: true,
    prepareEveryComponentBeforeActiveRestore: true,
    preparationMutatesActiveState: false,
    rollbackCapabilityRequiredBeforeActiveRestore: true,
    restoreOrder: pr10LifecycleComponents,
    rollbackOrder: [...pr10LifecycleComponents].reverse(),
    preparationDiscardOrder: "reverse",
    uncertainResumeAttemptState: "possibly-live",
    reQuiescePossiblyLiveComponentsBeforeRollback: true,
    activationFence: {
      acquisition: "before-first-active-restore",
      hold: "through-active-restore-verification-and-safe-resume-or-compensation",
      close: "only-after-safe-resume-or-compensation",
      reopenBeforeRollbackAfterClose: true,
      resetImmediatelyAfterReopen: true,
      reopenOrResetFailure: "recovery_required-with-fence-held-when-acquired",
    },
    zeroEmergencySessionsBeforeActiveRestore: true,
    zeroEmergencySessionsAfterRestoreOrCompensation: true,
    inconsistentCredentialState: "fail-closed-and-rollback",
    rollingBackAdmissionFailure:
      "recovery_required-preserve-quiescence-and-held-fence",
    rollbackFailureState: "recovery_required",
  })
  assert.equal(
    decision.reviewedDispositions.deferredBindings.configuredRuntimeAdapters,
    0,
  )
  assert.equal(
    decision.reviewedDispositions.deferredBindings.lifecycleRoutesRegistered,
    0,
  )
  withAcceptedPr10Snapshot("decision", (root) => {
    assert.deepEqual(verifyPr10DecisionDocument(decision, { root }), [])
    if (decision.reviewStatus === "reviewed") {
      assert.deepEqual(
        verifyPr10DecisionDocument(decision, { requireReady: true, root }),
        [],
      )
    } else {
      assert.match(
        verifyPr10DecisionDocument(decision, {
          requireReady: true,
          root,
        }).join("\n"),
        /operation policy is not reviewed/,
      )
    }
  })
})

test("PR-10 decision source evidence is evaluated against the supplied root", () => {
  withAcceptedPr10Snapshot("decision-root", (root) => {
    const decision = readJson(resolve(root, pr10DecisionPath))
    assert.deepEqual(verifyPr10DecisionDocument(decision, { root }), [])

    const changedPath = resolve(root, pr10SourceEvidencePaths[0])
    writeFileSync(changedPath, `${readFileSync(changedPath, "utf8")}\n`)
    assert.match(
      verifyPr10DecisionDocument(decision, { root }).join("\n"),
      /invalid PR-10 source evidence/,
    )
  })
})

test("PR-10 operation policy is exact and cannot escape its package", () => {
  const decision = readJson(resolve(repositoryRoot, pr10DecisionPath))
  const pendingOperationPolicy = {
    addedSourcePaths: [],
    changedSourcePaths: [],
    deletedSourcePaths: [],
    addedRepositoryPaths: [],
    changedRepositoryPaths: [],
    deletedRepositoryPaths: [],
  }
  assert.deepEqual(
    verifyPr10OperationBoundary(pendingOperationPolicy, {
      requireComplete: false,
    }),
    [],
  )
  assert.match(
    verifyPr10OperationBoundary(pendingOperationPolicy).join("\n"),
    /frozen repository path is missing/,
  )
  assert.deepEqual(
    decision.operationPolicy,
    decision.reviewStatus === "reviewed"
      ? pr10ExpectedOperationPolicy
      : pendingOperationPolicy,
  )
  assert.deepEqual(verifyPr10OperationBoundary(pr10ExpectedOperationPolicy), [])
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(pr10ExpectedOperationPolicy).map(([key, paths]) => [
        key,
        paths.length,
      ]),
    ),
    {
      addedSourcePaths: 5,
      changedSourcePaths: 4,
      deletedSourcePaths: 0,
      addedRepositoryPaths: 15,
      changedRepositoryPaths: 11,
      deletedRepositoryPaths: 0,
    },
  )
  assert.equal(pr10AllowedRepositoryPaths.length, 26)
  assert.equal(pr10LifecycleCodePaths.length, 20)
  assert.equal(pr10GovernancePaths.length, 6)
  assert.deepEqual(
    pr10RequiredFrozenRepositoryPaths,
    pr10AllowedRepositoryPaths,
  )
  assert.deepEqual(pr10RevisionEvidencePaths, [
    pr10DecisionPath,
    "scripts/inference-core/pr10-boundaries.test.mjs",
    "scripts/inference-core/pr10-contract-revision.mjs",
  ])

  const withRuntimeBinding = structuredClone(decision.operationPolicy)
  withRuntimeBinding.addedSourcePaths.push("apps/bff/src/routes/lifecycle.ts")
  withRuntimeBinding.addedRepositoryPaths.push(
    "apps/bff/src/routes/lifecycle.ts",
  )
  assert.match(
    verifyPr10OperationBoundary(withRuntimeBinding, {
      requireComplete: false,
    }).join("\n"),
    /outside package boundary/,
  )
})

test("PR-10 generated destinations are generator-owned", () => {
  assert.deepEqual(pr10GeneratedDestinationPaths, [
    "docs/reduction/inference-core/contract-revisions/PR-10.json",
    "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
    "docs/reduction/inference-core/route-baseline.json",
  ])
  assert.deepEqual(verifyPr10GeneratedDestinationBoundary([]), [])
  for (const path of pr10GeneratedDestinationPaths) {
    assert.match(
      verifyPr10GeneratedDestinationBoundary([path]).join("\n"),
      new RegExp(`must not be staged before generation ${escapeRegExp(path)}`),
    )
  }
})

test("PR-10 write path is fail-closed across interrupted multi-file replacement", () => {
  const generatorSource = readFileSync(
    resolve(
      repositoryRoot,
      "scripts/inference-core/pr10-contract-revision.mjs",
    ),
    "utf8",
  )
  for (const fingerprint of [
    "assertGeneratedTransactionPreflight()",
    "writeJsonCrashRecoverableTransaction",
    'transaction: "PR-10-generated-artifacts"',
    "transaction marker retained",
    "flush: true",
  ]) {
    assert.equal(generatorSource.includes(fingerprint), true)
  }
  assert.doesNotMatch(generatorSource, /crash[- ]atomic|cross[- ]file atomic/i)
})

test("PR-10 policy mode is no-write and fails closed on generated transaction state", () => {
  withBaseClone("generator-policy", (root) => {
    for (const path of pr10AllowedRepositoryPaths) {
      copyAcceptedPr10Path(root, path)
    }
    const decisionPath = resolve(root, pr10DecisionPath)
    const decision = readJson(decisionPath)
    decision.sourceEvidence = pr10SourceEvidencePaths.map((path) => ({
      path,
      sha256: sha256(readFileSync(resolve(root, path))),
    }))
    writeFileSync(decisionPath, `${JSON.stringify(decision, null, 2)}\n`)
    const currentNodeModules = resolve(repositoryRoot, "node_modules")
    assert.equal(existsSync(currentNodeModules), true)
    const rootedGuardrailsPath = resolve(
      root,
      "scripts/inference-core/guardrails.mjs",
    )
    const rootedGuardrails = readFileSync(rootedGuardrailsPath, "utf8")
    const typeScriptModuleUrl = pathToFileURL(
      resolve(currentNodeModules, "typescript/lib/typescript.js"),
    ).href
    writeFileSync(
      rootedGuardrailsPath,
      rootedGuardrails.replace(
        'import ts from "typescript"',
        `import ts from ${JSON.stringify(typeScriptModuleUrl)}`,
      ),
    )
    gitAt(root, ["add", "--all", "--"])

    const beforePrint = generatedArtifactState(root)
    const output = execFileSync(
      process.execPath,
      [
        "scripts/inference-core/pr10-contract-revision.mjs",
        "--print-operation-policy",
      ],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
    assert.deepEqual(JSON.parse(output), pr10ExpectedOperationPolicy)
    assert.deepEqual(generatedArtifactState(root), beforePrint)

    for (const path of pr10GeneratedDestinationPaths) {
      const poisonedPath = resolve(root, path)
      const previous = existsSync(poisonedPath)
        ? readFileSync(poisonedPath)
        : null
      writeFileSync(
        poisonedPath,
        previous === null
          ? "{}\n"
          : `${previous.toString("utf8").trimEnd()}\n `,
      )
      gitAt(root, ["add", "--", path])
      const beforePoisonedPrint = generatedArtifactState(root)
      assertSubprocessFailure(
        root,
        new RegExp(
          `generated destination must not be staged before generation ${escapeRegExp(
            path,
          )}`,
        ),
      )
      assert.deepEqual(generatedArtifactState(root), beforePoisonedPrint)
      if (previous === null) {
        rmSync(poisonedPath)
      } else {
        writeFileSync(poisonedPath, previous)
      }
      gitAt(root, ["add", "--all", "--", path])
    }

    const markerPath = resolve(
      root,
      "docs/reduction/inference-core/.pr10-contract-revision.transaction.json",
    )
    writeFileSync(markerPath, "{}\n")
    const beforeMarkedPrint = generatedArtifactState(root)
    assertSubprocessFailure(
      root,
      /incomplete prior generated-artifact transaction/,
    )
    assert.deepEqual(generatedArtifactState(root), beforeMarkedPrint)
  })
})

test("PR-10 permits only the exact historical PR-06 expiry repair", () => {
  assert.deepEqual(verifyPr10HistoricalFixtureRepair(), [])
  withBaseClone("fixture", (root) => {
    const path = resolve(root, pr10Pr06FixtureRepair.path)
    const baseSource = readFileSync(path, "utf8")
    writeFileSync(
      path,
      baseSource.replace(
        pr10Pr06FixtureRepair.removedFragment,
        pr10Pr06FixtureRepair.replacementFragment,
      ),
    )
    assert.deepEqual(verifyPr10HistoricalFixtureRepair(root), [])
    writeFileSync(path, `${readFileSync(path, "utf8")}\n`)
    assert.match(
      verifyPr10HistoricalFixtureRepair(root).join("\n"),
      /differs from the exact reviewed replacement/,
    )
  })
})

test("PR-10 source has no runtime binding, route, or content persistence", () => {
  withAcceptedPr10Snapshot("source", (root) => {
    const paths = repositoryPaths(root)
    assert.deepEqual(verifyPr10SourceBoundary(root, paths), [])
  })

  withAcceptedPr10Snapshot("persistence", (root) => {
    const clonePaths = repositoryPaths(root)
    assert.deepEqual(verifyPr10SourceBoundary(root, clonePaths), [])

    const schemaPath = resolve(root, "apps/bff/src/db/inference-core-schema.ts")
    const schemaSource = readFileSync(schemaPath, "utf8")
    writeFileSync(
      schemaPath,
      schemaSource.replace(
        "export const lifecycleOperations = admin.table(",
        "export const renamedLifecycleOperations = admin.table(",
      ),
    )
    assert.match(
      verifyPr10SourceBoundary(root, clonePaths).join("\n"),
      /lifecycle schema symbol is missing or ambiguous lifecycleOperations|lifecycle schema section marker is missing/,
    )

    writeFileSync(schemaPath, schemaSource)
    const migrationPath = resolve(
      root,
      "infra/migrations/0000_inference_core.sql",
    )
    const migrationSource = readFileSync(migrationPath, "utf8")
    const lifecycleStart = migrationSource.indexOf(
      "CREATE TABLE admin.lifecycle_operations (",
    )
    assert.notEqual(lifecycleStart, -1)
    writeFileSync(
      migrationPath,
      `${migrationSource.slice(0, lifecycleStart)}${migrationSource
        .slice(lifecycleStart)
        .replace(
          "  correlation_id text NOT NULL,",
          "  correlation_id text NOT NULL,\n  request_headers text,",
        )}`,
    )
    assert.match(
      verifyPr10SourceBoundary(root, clonePaths).join("\n"),
      /lifecycle migration columns changed lifecycle_operations|lifecycle persistence contains forbidden content fields/,
    )

    writeFileSync(migrationPath, migrationSource)
    writeFileSync(
      migrationPath,
      migrationSource.replace(
        "INSERT INTO admin.console_settings",
        'ALTER TABLE "admin"."lifecycle_operations" ADD COLUMN extra text;\n\nINSERT INTO admin.console_settings',
      ),
    )
    assert.match(
      verifyPr10SourceBoundary(root, clonePaths).join("\n"),
      /lifecycle migration alteration is forbidden/,
    )

    writeFileSync(
      migrationPath,
      migrationSource.replace(
        "INSERT INTO admin.console_settings",
        "ALTER/*comment*/TABLE admin.lifecycle_operations ADD COLUMN operational_note text;\n\nINSERT INTO admin.console_settings",
      ),
    )
    assert.match(
      verifyPr10SourceBoundary(root, clonePaths).join("\n"),
      /lifecycle migration alteration is forbidden/,
    )

    writeFileSync(migrationPath, migrationSource)
    for (const path of pr10ProductionSourcePaths) {
      const absolutePath = resolve(root, path)
      const source = readFileSync(absolutePath, "utf8")
      writeFileSync(
        absolutePath,
        path === "package.json"
          ? source.replace(
              "{",
              '{\n  "runtimeBindingProbe": "process.env.LIFECYCLE_ENDPOINT",',
            )
          : `const endpoint = process.env.LIFECYCLE_ENDPOINT\n${source}`,
      )
      assert.match(
        verifyPr10SourceBoundary(root, clonePaths).join("\n"),
        new RegExp(`concrete runtime binding change ${escapeRegExp(path)}`),
      )
      writeFileSync(absolutePath, source)
    }

    const adapterPath = resolve(
      root,
      "apps/bff/src/services/lifecycle-component-adapters.ts",
    )
    const adapterSource = readFileSync(adapterPath, "utf8")
    writeFileSync(
      adapterPath,
      `const { env } = process\nvoid env\n${adapterSource}`,
    )
    assert.match(
      verifyPr10SourceBoundary(root, clonePaths).join("\n"),
      /concrete runtime binding change .*lifecycle-component-adapters\.ts/,
    )
    writeFileSync(adapterPath, adapterSource)

    writeFileSync(
      adapterPath,
      `const runtimeGlobal = Function("return process")()\nvoid runtimeGlobal["env"]\n${adapterSource}`,
    )
    assert.match(
      verifyPr10SourceBoundary(root, clonePaths).join("\n"),
      /concrete runtime binding change .*lifecycle-component-adapters\.ts/,
    )
    writeFileSync(adapterPath, adapterSource)

    const packagePath = resolve(root, "package.json")
    const packageSource = readFileSync(packagePath, "utf8")
    writeFileSync(
      packagePath,
      packageSource.replace(
        "{",
        `{\n  "runtimeBindingProbe": ${JSON.stringify(
          'Function("return fetch")()',
        )},`,
      ),
    )
    assert.match(
      verifyPr10SourceBoundary(root, clonePaths).join("\n"),
      /concrete runtime binding change package\.json/,
    )
    writeFileSync(packagePath, packageSource)

    const clientPath = resolve(root, "apps/bff/src/db/inference-core-client.ts")
    const clientSource = readFileSync(clientPath, "utf8")
    writeFileSync(
      clientPath,
      `import { createLitellmChatTransport } from "../services/litellm-chat-transport"\n${clientSource}`,
    )
    assert.match(
      verifyPr10SourceBoundary(root, clonePaths).join("\n"),
      /lifecycle import binding boundary changed .*inference-core-client\.ts/,
    )
    writeFileSync(clientPath, clientSource)

    const journalPath = resolve(
      root,
      "apps/bff/src/services/lifecycle-operation-journal.ts",
    )
    const journalSource = readFileSync(journalPath, "utf8")
    writeFileSync(
      journalPath,
      `import { request } from "node:http"\n${journalSource}`,
    )
    const importBoundaryErrors = verifyPr10SourceBoundary(
      root,
      clonePaths,
    ).join("\n")
    assert.match(
      importBoundaryErrors,
      /lifecycle import binding boundary changed/,
    )
    assert.match(importBoundaryErrors, /concrete runtime binding change/)
  })
})

test("the PR-09 baseline plus PR-10 source satisfies the PR-10 target", () => {
  withAcceptedPr10Snapshot("target", (root) => {
    const currentAllowlist = readJson(
      resolve(
        root,
        "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
      ),
    )
    const currentRoutes = readJson(resolve(root, routeBaselinePath))
    assert.deepEqual(
      verifyPr10TargetState({
        root,
        currentAllowlist,
        currentRoutes,
        paths: repositoryPaths(root),
      }),
      [],
    )
  })
  assert.equal(pr10TargetContract.addedRoutes.length, 0)
  assert.equal(pr10TargetContract.configuredRuntimeAdapters, 0)
  assert.equal(pr10TargetContract.lifecycleRoutes, 0)
  assert.equal(pr10TargetContract.runtimeQualified, false)
})

function withBaseClone(label, run) {
  const root = mkdtempSync(join(tmpdir(), `inference-core-pr10-${label}-`))
  try {
    execFileSync(
      "git",
      ["clone", "--quiet", "--shared", "--no-checkout", repositoryRoot, root],
      { stdio: "ignore" },
    )
    gitAt(root, ["checkout", "--quiet", pr10ContractBase])
    run(root)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

function withAcceptedPr10Snapshot(label, run) {
  const root = mkdtempSync(
    join(tmpdir(), `inference-core-pr10-accepted-${label}-`),
  )
  try {
    execFileSync(
      "git",
      ["clone", "--quiet", "--shared", "--no-checkout", repositoryRoot, root],
      { stdio: "ignore" },
    )
    gitAt(root, ["checkout", "--quiet", pr10cContractBase])
    assert.equal(gitAt(root, ["rev-parse", "HEAD"]), pr10cContractBase)
    assert.equal(
      gitAt(root, ["rev-parse", `${pr10cContractBase}^{tree}`]),
      pr10cContractBaseTree,
    )
    run(root)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

function copyAcceptedPr10Path(root, path) {
  const destination = resolve(root, path)
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(
    destination,
    execFileSync(
      "git",
      [
        "show",
        "--no-ext-diff",
        "--no-textconv",
        "--end-of-options",
        `${pr10cContractBase}:${path}`,
      ],
      {
        cwd: repositoryRoot,
        encoding: null,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  )
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
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

function gitAt(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

function generatedArtifactState(root) {
  return Object.fromEntries(
    pr10GeneratedDestinationPaths.map((path) => {
      const absolutePath = resolve(root, path)
      return [
        path,
        existsSync(absolutePath) ? sha256(readFileSync(absolutePath)) : null,
      ]
    }),
  )
}

function assertSubprocessFailure(root, pattern) {
  let failure
  try {
    execFileSync(
      process.execPath,
      [
        "scripts/inference-core/pr10-contract-revision.mjs",
        "--print-operation-policy",
      ],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
  } catch (error) {
    failure = error
  }
  assert.ok(failure)
  assert.match(`${failure.message}\n${failure.stderr ?? ""}`, pattern)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
