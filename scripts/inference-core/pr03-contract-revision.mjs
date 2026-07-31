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
  buildForbiddenAllowlist,
  buildRouteBaseline,
  pr03ContractBase,
  pr03ContractRevisionPath,
  pr03DecisionPath,
  pr03LaneAnchor,
  pr03RevisionEvidencePaths,
  repositoryRoot,
  routeBaselinePath,
  verifyPr03BaseEvidence,
  verifyPr03CandidateContract,
  verifyPr03DecisionDocument,
} from "./guardrails.mjs"

if (process.argv.length !== 3 || process.argv[2] !== "--write") {
  throw new Error(
    "Pass exactly --write to regenerate the PR-03 contract files.",
  )
}

assertNoUnexpectedEnvironmentFiles(repositoryRoot)
assertExactLaneHead()
assertStagedCandidate()
const baseEvidenceErrors = verifyPr03BaseEvidence(repositoryRoot)
if (baseEvidenceErrors.length > 0) {
  throw new Error(
    `PR-03 retained PR-02 evidence changed: ${baseEvidenceErrors.join("; ")}`,
  )
}

const decision = readJson(resolve(repositoryRoot, pr03DecisionPath))
const decisionErrors = verifyPr03DecisionDocument(decision, {
  requireReady: true,
})
if (decisionErrors.length > 0) {
  throw new Error(
    `PR-03 decision evidence is not ready: ${decisionErrors.join("; ")}`,
  )
}

const baseAllowlist = readJsonFromCommit(pr03ContractBase, allowlistPath)
const baseRoutes = readJsonFromCommit(pr03ContractBase, routeBaselinePath)
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
const evidenceFiles = pr03RevisionEvidencePaths.map((path) => ({
  path,
  sha256: sha256(readFileSync(resolve(repositoryRoot, path))),
}))
const revision = buildContractRevisionDocument({
  revisionId: "PR-03",
  scope: "legacy-source-removal",
  baseCommit: pr03ContractBase,
  baseTree: gitOutput(["rev-parse", `${pr03ContractBase}^{tree}`]),
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
      id: "PR-03",
      path: pr03ContractRevisionPath,
      sha256: sha256(revisionContent),
    },
  ],
}
const candidateErrors = verifyPr03CandidateContract({
  root: repositoryRoot,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
  operationPolicy: decision.operationPolicy,
})
if (candidateErrors.length > 0) {
  throw new Error(
    `PR-03 candidate violates the reviewed contract: ${candidateErrors.join("; ")}`,
  )
}

const allowlistContent = serializeJson(currentAllowlist)
const routeBaselineContent = serializeJson(currentRoutes)
writeJsonTransaction([
  { path: pr03ContractRevisionPath, content: revisionContent },
  { path: allowlistPath, content: allowlistContent },
  { path: routeBaselinePath, content: routeBaselineContent },
])

process.stdout.write(
  `${[
    `PR03_CONTRACT_REVISION_SHA256=${sha256(revisionContent)}`,
    `FORBIDDEN_ALLOWLIST_SHA256=${sha256(allowlistContent)}`,
    `ROUTE_BASELINE_SHA256=${sha256(routeBaselineContent)}`,
  ].join("\n")}\n`,
)

function assertExactLaneHead() {
  const head = gitOutput(["rev-parse", "HEAD"])
  if (head !== pr03LaneAnchor) {
    throw new Error(
      `PR-03 generator requires exact lane-anchor HEAD ${pr03LaneAnchor}; actual ${head}.`,
    )
  }
  execFileSync(
    "git",
    ["merge-base", "--is-ancestor", pr03ContractBase, pr03LaneAnchor],
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
      "PR-03 generator requires every tracked candidate change to be staged.",
    )
  }
  const untracked = gitOutput(["ls-files", "--others", "--exclude-standard"])
  if (untracked.length > 0) {
    throw new Error(
      `PR-03 generator rejects untracked candidate paths: ${untracked
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
    throw new Error("PR-03 generator requires a staged candidate delta.")
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
