import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, resolve } from "node:path"
import {
  allowlistPath,
  assertNoUnexpectedEnvironmentFiles,
  buildContractRevisionDocument,
  buildExactClosureOperationPolicy,
  buildForbiddenAllowlist,
  buildRouteBaseline,
  pr10ContractBase,
  pr10ContractRevisionPath,
  pr10DecisionPath,
  pr10GeneratedDestinationPaths,
  pr10LaneAnchor,
  pr10RevisionEvidencePaths,
  repositoryRoot,
  routeBaselinePath,
  verifyPr10BaseEvidence,
  verifyPr10CandidateContract,
  verifyPr10DecisionDocument,
  verifyPr10GeneratedDestinationBoundary,
  verifyPr10HistoricalFixtureRepair,
  verifyPr10OperationBoundary,
  verifyPr10SourceBoundary,
} from "./guardrails.mjs"

const mode = process.argv[2]
const transactionMarkerPath = resolve(
  repositoryRoot,
  "docs/reduction/inference-core/.pr10-contract-revision.transaction.json",
)
if (
  process.argv.length !== 3 ||
  !["--print-operation-policy", "--write"].includes(mode)
) {
  throw new Error(
    "Pass exactly --print-operation-policy or --write for the PR-10 contract.",
  )
}

assertNoUnexpectedEnvironmentFiles(repositoryRoot)
assertExactLaneHead()
assertGeneratedTransactionPreflight()
assertStagedCandidate()

const baseEvidenceErrors = verifyPr10BaseEvidence(repositoryRoot)
if (baseEvidenceErrors.length > 0) {
  throw new Error(
    `PR-10 retained prior evidence changed: ${baseEvidenceErrors.join("; ")}`,
  )
}
const fixtureRepairErrors = verifyPr10HistoricalFixtureRepair(repositoryRoot)
if (fixtureRepairErrors.length > 0) {
  throw new Error(
    `PR-10 historical test-only repair changed: ${fixtureRepairErrors.join("; ")}`,
  )
}
const sourceBoundaryErrors = verifyPr10SourceBoundary(repositoryRoot)
if (sourceBoundaryErrors.length > 0) {
  throw new Error(
    `PR-10 lifecycle source boundary changed: ${sourceBoundaryErrors.join("; ")}`,
  )
}

const baseAllowlist = readJsonFromCommit(pr10ContractBase, allowlistPath)
const baseRoutes = readJsonFromCommit(pr10ContractBase, routeBaselinePath)
const currentAllowlist = buildForbiddenAllowlist({
  baseCommit: baseAllowlist.baseCommit,
})
const generatedRoutes = buildRouteBaseline({
  baseCommit: baseRoutes.baseCommit,
})
const currentRoutesBeforeRevision = {
  ...generatedRoutes,
  reviewedRevisions: structuredClone(baseRoutes.reviewedRevisions ?? []),
}
const operationPolicy = buildExactClosureOperationPolicy(
  baseRoutes,
  currentRoutesBeforeRevision,
)
const boundaryErrors = verifyPr10OperationBoundary(operationPolicy, {
  requireComplete: true,
})
if (boundaryErrors.length > 0) {
  throw new Error(
    `PR-10 candidate leaves its approved package boundary: ${boundaryErrors.join("; ")}`,
  )
}
const candidateErrors = verifyPr10CandidateContract({
  root: repositoryRoot,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes: currentRoutesBeforeRevision,
  operationPolicy,
})
if (candidateErrors.length > 0) {
  throw new Error(
    `PR-10 candidate violates the reviewed contract: ${candidateErrors.join("; ")}`,
  )
}

const decision = readJson(resolve(repositoryRoot, pr10DecisionPath))
const decisionErrors = verifyPr10DecisionDocument(decision, {
  requireReady: mode === "--write" || decision.reviewStatus === "reviewed",
  root: repositoryRoot,
})
if (decisionErrors.length > 0) {
  throw new Error(
    `PR-10 decision evidence is not ready: ${decisionErrors.join("; ")}`,
  )
}
if (
  decision.reviewStatus === "reviewed" &&
  JSON.stringify(decision.operationPolicy) !== JSON.stringify(operationPolicy)
) {
  throw new Error(
    "PR-10 reviewed operation policy differs from staged candidate.",
  )
}

if (mode === "--print-operation-policy") {
  process.stdout.write(`${JSON.stringify(operationPolicy, null, 2)}\n`)
  process.exit(0)
}

const evidenceFiles = pr10RevisionEvidencePaths.map((path) => ({
  path,
  sha256: sha256(readFileSync(resolve(repositoryRoot, path))),
}))
const revision = buildContractRevisionDocument({
  revisionId: "PR-10",
  scope: "lifecycle-snapshot-restore-foundation-source-only",
  baseCommit: pr10ContractBase,
  baseTree: gitOutput(["rev-parse", `${pr10ContractBase}^{tree}`]),
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes: currentRoutesBeforeRevision,
  evidenceFiles,
})
const revisionContent = serializeJson(revision)
const currentRoutes = {
  ...currentRoutesBeforeRevision,
  reviewedRevisions: [
    ...(baseRoutes.reviewedRevisions ?? []),
    {
      id: "PR-10",
      path: pr10ContractRevisionPath,
      sha256: sha256(revisionContent),
    },
  ],
}

const allowlistContent = serializeJson(currentAllowlist)
const routeBaselineContent = serializeJson(currentRoutes)
writeJsonCrashRecoverableTransaction([
  { path: pr10ContractRevisionPath, content: revisionContent },
  { path: allowlistPath, content: allowlistContent },
  { path: routeBaselinePath, content: routeBaselineContent },
])

process.stdout.write(
  `${[
    `PR10_CONTRACT_REVISION_SHA256=${sha256(revisionContent)}`,
    `FORBIDDEN_ALLOWLIST_SHA256=${sha256(allowlistContent)}`,
    `ROUTE_BASELINE_SHA256=${sha256(routeBaselineContent)}`,
  ].join("\n")}\n`,
)

function assertExactLaneHead() {
  const head = gitOutput(["rev-parse", "HEAD"])
  if (head !== pr10LaneAnchor) {
    throw new Error(
      `PR-10 generator requires exact lane-anchor HEAD ${pr10LaneAnchor}; actual ${head}.`,
    )
  }
  execFileSync(
    "git",
    ["merge-base", "--is-ancestor", pr10ContractBase, pr10LaneAnchor],
    {
      cwd: repositoryRoot,
      stdio: "ignore",
    },
  )
}

function assertGeneratedTransactionPreflight() {
  const residuePaths = []
  if (existsSync(transactionMarkerPath)) {
    residuePaths.push(transactionMarkerPath)
  }
  for (const path of pr10GeneratedDestinationPaths) {
    const absolutePath = resolve(repositoryRoot, path)
    const parent = dirname(absolutePath)
    if (!existsSync(parent)) {
      continue
    }
    const name = basename(absolutePath)
    for (const entry of readdirSync(parent)) {
      if (
        entry.startsWith(`${name}.tmp-`) ||
        entry.startsWith(`${name}.rollback-`)
      ) {
        residuePaths.push(resolve(parent, entry))
      }
    }
  }
  if (residuePaths.length > 0) {
    throw new Error(
      `PR-10 generator found an incomplete prior generated-artifact transaction: ${residuePaths
        .sort()
        .join(", ")}`,
    )
  }
  if (
    mode === "--write" &&
    existsSync(resolve(repositoryRoot, pr10ContractRevisionPath))
  ) {
    throw new Error(
      "PR-10 generator refuses to overwrite an existing PR-10 contract revision.",
    )
  }
}

function assertStagedCandidate() {
  try {
    execFileSync("git", ["diff", "--quiet"], {
      cwd: repositoryRoot,
      stdio: "ignore",
    })
  } catch {
    throw new Error(
      "PR-10 generator requires every tracked candidate change to be staged.",
    )
  }
  const untracked = gitOutput(["ls-files", "--others", "--exclude-standard"])
  if (untracked.length > 0) {
    throw new Error(
      `PR-10 generator rejects untracked candidate paths: ${untracked
        .split("\n")
        .join(", ")}`,
    )
  }
  const stagedPaths = execFileSync(
    "git",
    [
      "diff",
      "--cached",
      "--name-only",
      "--no-renames",
      "--diff-filter=ACDMRTUXB",
      "-z",
      "--",
    ],
    { cwd: repositoryRoot, encoding: "buffer" },
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
  const generatedDestinationErrors =
    verifyPr10GeneratedDestinationBoundary(stagedPaths)
  if (generatedDestinationErrors.length > 0) {
    throw new Error(generatedDestinationErrors.join("; "))
  }
  let hasStagedChanges = false
  try {
    execFileSync("git", ["diff", "--cached", "--quiet"], {
      cwd: repositoryRoot,
      stdio: "ignore",
    })
  } catch {
    hasStagedChanges = true
  }
  if (!hasStagedChanges) {
    throw new Error("PR-10 generator requires a staged candidate delta.")
  }
}

function readJsonFromCommit(commit, path) {
  return JSON.parse(
    gitOutput([
      "show",
      "--no-ext-diff",
      "--no-textconv",
      "--end-of-options",
      `${commit}:${path}`,
    ]),
  )
}

function gitOutput(args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim()
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function serializeJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
}

function writeJsonCrashRecoverableTransaction(entries) {
  const nonce = `${process.pid}-${Date.now()}`
  const prepared = entries.map(({ path, content }, index) => {
    const absolutePath = resolve(repositoryRoot, path)
    mkdirSync(dirname(absolutePath), { recursive: true })
    return {
      absolutePath,
      content,
      path,
      previous: existsSync(absolutePath) ? readFileSync(absolutePath) : null,
      temporaryPath: `${absolutePath}.tmp-${nonce}-${index}`,
    }
  })
  const marker = {
    schemaVersion: 1,
    transaction: "PR-10-generated-artifacts",
    nonce,
    destinations: prepared.map(({ content, path, previous }) => ({
      path,
      previousSha256: previous === null ? null : sha256(previous),
      nextSha256: sha256(content),
    })),
  }
  writeFileSync(transactionMarkerPath, serializeJson(marker), {
    flag: "wx",
    flush: true,
  })
  try {
    for (const entry of prepared) {
      writeFileSync(entry.temporaryPath, entry.content, {
        flag: "wx",
        flush: true,
      })
    }
  } catch (error) {
    for (const entry of prepared) {
      rmSync(entry.temporaryPath, { force: true })
    }
    rmSync(transactionMarkerPath, { force: true })
    throw error
  }
  const replaced = []
  try {
    for (const entry of prepared) {
      renameSync(entry.temporaryPath, entry.absolutePath)
      replaced.push(entry)
    }
  } catch (error) {
    const rollbackErrors = []
    for (const entry of replaced.reverse()) {
      try {
        if (entry.previous === null) {
          rmSync(entry.absolutePath, { force: true })
          continue
        }
        const rollbackPath = `${entry.absolutePath}.rollback-${nonce}`
        writeFileSync(rollbackPath, entry.previous, {
          flag: "wx",
          flush: true,
        })
        renameSync(rollbackPath, entry.absolutePath)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `PR-10 generated-artifact rollback is incomplete; transaction marker retained at ${transactionMarkerPath}`,
      )
    }
    rmSync(transactionMarkerPath, { force: true })
    throw error
  } finally {
    for (const entry of prepared) {
      rmSync(entry.temporaryPath, { force: true })
    }
  }
  rmSync(transactionMarkerPath)
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
