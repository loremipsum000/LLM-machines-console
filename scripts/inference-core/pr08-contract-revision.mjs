import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve } from "node:path"
import {
  allowlistPath,
  assertNoUnexpectedEnvironmentFiles,
  buildContractRevisionDocument,
  buildExactClosureOperationPolicy,
  buildForbiddenAllowlist,
  buildRouteBaseline,
  pr08ContractBase,
  pr08ContractRevisionPath,
  pr08DecisionPath,
  pr08LaneAnchor,
  pr08RevisionEvidencePaths,
  repositoryRoot,
  routeBaselinePath,
  verifyPr08BaseEvidence,
  verifyPr08CandidateContract,
  verifyPr08DecisionDocument,
  verifyPr08OperationBoundary,
} from "./guardrails.mjs"

const mode = process.argv[2]
if (
  process.argv.length !== 3 ||
  !["--print-operation-policy", "--write"].includes(mode)
) {
  throw new Error(
    "Pass exactly --print-operation-policy or --write for the PR-08 contract.",
  )
}

assertNoUnexpectedEnvironmentFiles(repositoryRoot)
assertExactLaneHead()
assertStagedCandidate()
const baseEvidenceErrors = verifyPr08BaseEvidence(repositoryRoot)
if (baseEvidenceErrors.length > 0) {
  throw new Error(
    `PR-08 retained prior evidence changed: ${baseEvidenceErrors.join("; ")}`,
  )
}

const baseAllowlist = readJsonFromCommit(pr08ContractBase, allowlistPath)
const baseRoutes = readJsonFromCommit(pr08ContractBase, routeBaselinePath)
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
const boundaryErrors = verifyPr08OperationBoundary(operationPolicy)
if (boundaryErrors.length > 0) {
  throw new Error(
    `PR-08 candidate leaves its approved package boundary: ${boundaryErrors.join("; ")}`,
  )
}
const candidateErrors = verifyPr08CandidateContract({
  root: repositoryRoot,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes: currentRoutesBeforeRevision,
  operationPolicy,
})
if (candidateErrors.length > 0) {
  throw new Error(
    `PR-08 candidate violates the reviewed contract: ${candidateErrors.join("; ")}`,
  )
}

if (mode === "--print-operation-policy") {
  process.stdout.write(`${JSON.stringify(operationPolicy, null, 2)}\n`)
  process.exit(0)
}

const decision = readJson(resolve(repositoryRoot, pr08DecisionPath))
const decisionErrors = verifyPr08DecisionDocument(decision, {
  requireReady: true,
})
if (decisionErrors.length > 0) {
  throw new Error(
    `PR-08 decision evidence is not ready: ${decisionErrors.join("; ")}`,
  )
}
if (
  JSON.stringify(decision.operationPolicy) !== JSON.stringify(operationPolicy)
) {
  throw new Error(
    "PR-08 reviewed operation policy differs from staged candidate.",
  )
}

const evidenceFiles = pr08RevisionEvidencePaths.map((path) => ({
  path,
  sha256: sha256(readFileSync(resolve(repositoryRoot, path))),
}))
const revision = buildContractRevisionDocument({
  revisionId: "PR-08",
  scope: "firecrawl-search-static-scrape-source-only",
  baseCommit: pr08ContractBase,
  baseTree: gitOutput(["rev-parse", `${pr08ContractBase}^{tree}`]),
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
      id: "PR-08",
      path: pr08ContractRevisionPath,
      sha256: sha256(revisionContent),
    },
  ],
}

const allowlistContent = serializeJson(currentAllowlist)
const routeBaselineContent = serializeJson(currentRoutes)
writeJsonTransaction([
  { path: pr08ContractRevisionPath, content: revisionContent },
  { path: allowlistPath, content: allowlistContent },
  { path: routeBaselinePath, content: routeBaselineContent },
])

process.stdout.write(
  `${[
    `PR08_CONTRACT_REVISION_SHA256=${sha256(revisionContent)}`,
    `FORBIDDEN_ALLOWLIST_SHA256=${sha256(allowlistContent)}`,
    `ROUTE_BASELINE_SHA256=${sha256(routeBaselineContent)}`,
  ].join("\n")}\n`,
)

function assertExactLaneHead() {
  const head = gitOutput(["rev-parse", "HEAD"])
  if (head !== pr08LaneAnchor) {
    throw new Error(
      `PR-08 generator requires exact lane-anchor HEAD ${pr08LaneAnchor}; actual ${head}.`,
    )
  }
  execFileSync(
    "git",
    ["merge-base", "--is-ancestor", pr08ContractBase, pr08LaneAnchor],
    {
      cwd: repositoryRoot,
      stdio: "ignore",
    },
  )
}

function assertStagedCandidate() {
  try {
    execFileSync("git", ["diff", "--quiet"], {
      cwd: repositoryRoot,
      stdio: "ignore",
    })
  } catch {
    throw new Error(
      "PR-08 generator requires every tracked candidate change to be staged.",
    )
  }
  const untracked = gitOutput(["ls-files", "--others", "--exclude-standard"])
  if (untracked.length > 0) {
    throw new Error(
      `PR-08 generator rejects untracked candidate paths: ${untracked
        .split("\n")
        .join(", ")}`,
    )
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
    throw new Error("PR-08 generator requires a staged candidate delta.")
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

function writeJsonTransaction(entries) {
  const nonce = `${process.pid}-${Date.now()}`
  const prepared = []
  try {
    for (const [index, { path, content }] of entries.entries()) {
      const absolutePath = resolve(repositoryRoot, path)
      mkdirSync(dirname(absolutePath), { recursive: true })
      const temporaryPath = `${absolutePath}.tmp-${nonce}-${index}`
      writeFileSync(temporaryPath, content, { flag: "wx" })
      prepared.push({
        absolutePath,
        previous: existsSync(absolutePath) ? readFileSync(absolutePath) : null,
        temporaryPath,
      })
    }
  } catch (error) {
    for (const entry of prepared) {
      rmSync(entry.temporaryPath, { force: true })
    }
    throw error
  }
  const replaced = []
  try {
    for (const entry of prepared) {
      renameSync(entry.temporaryPath, entry.absolutePath)
      replaced.push(entry)
    }
  } catch (error) {
    for (const entry of replaced.reverse()) {
      if (entry.previous === null) {
        rmSync(entry.absolutePath, { force: true })
        continue
      }
      const rollbackPath = `${entry.absolutePath}.rollback-${nonce}`
      writeFileSync(rollbackPath, entry.previous, { flag: "wx" })
      renameSync(rollbackPath, entry.absolutePath)
    }
    throw error
  } finally {
    for (const entry of prepared) {
      rmSync(entry.temporaryPath, { force: true })
    }
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
