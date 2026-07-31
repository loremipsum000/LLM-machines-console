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
  buildRepositoryClosureFromCommit,
  buildRouteBaseline,
  pr02ContractRevisionPath,
  repositoryRoot,
  routeBaselinePath,
} from "./guardrails.mjs"

const integrationBase = "bb60cb0dfe46a39189e2a80fe1839e8288201492"
const evidencePaths = [
  "docs/reduction/inference-core/pr-02-boundary-decisions.json",
  "scripts/inference-core/pr02-boundaries.test.mjs",
  "scripts/inference-core/pr02-contract-revision.mjs",
]

if (process.argv.length !== 3 || process.argv[2] !== "--write") {
  throw new Error(
    "Pass exactly --write to regenerate the PR-02 contract files.",
  )
}

assertNoUnexpectedEnvironmentFiles(repositoryRoot)
assertExactBaseHead()

const baseAllowlist = readJsonFromCommit(integrationBase, allowlistPath)
const baseRoutes = readJsonFromCommit(integrationBase, routeBaselinePath)
const reviewedBaseRoutes = {
  ...baseRoutes,
  repositoryClosure: buildRepositoryClosureFromCommit(
    repositoryRoot,
    integrationBase,
  ),
}
const currentAllowlist = buildForbiddenAllowlist({
  baseCommit: baseAllowlist.baseCommit,
})
const currentRoutesBeforeRevision = buildRouteBaseline({
  baseCommit: baseRoutes.baseCommit,
})
const evidenceFiles = evidencePaths.map((path) => ({
  path,
  sha256: sha256(readFileSync(resolve(repositoryRoot, path))),
}))
const revision = buildContractRevisionDocument({
  baseCommit: integrationBase,
  baseTree: gitOutput(["rev-parse", `${integrationBase}^{tree}`]),
  baseAllowlist,
  currentAllowlist,
  baseRoutes: reviewedBaseRoutes,
  currentRoutes: currentRoutesBeforeRevision,
  evidenceFiles,
})
const revisionContent = serializeJson(revision)
const currentRoutes = {
  ...currentRoutesBeforeRevision,
  reviewedRevisions: [
    {
      id: "PR-02",
      path: pr02ContractRevisionPath,
      sha256: sha256(revisionContent),
    },
  ],
}
const allowlistContent = serializeJson(currentAllowlist)
const routeBaselineContent = serializeJson(currentRoutes)

writeJsonTransaction([
  { path: pr02ContractRevisionPath, content: revisionContent },
  { path: allowlistPath, content: allowlistContent },
  { path: routeBaselinePath, content: routeBaselineContent },
])

process.stdout.write(
  `${[
    `PR02_CONTRACT_REVISION_SHA256=${sha256(revisionContent)}`,
    `FORBIDDEN_ALLOWLIST_SHA256=${sha256(allowlistContent)}`,
    `ROUTE_BASELINE_SHA256=${sha256(routeBaselineContent)}`,
  ].join("\n")}\n`,
)

function assertExactBaseHead() {
  const head = gitOutput(["rev-parse", "HEAD"])
  if (head !== integrationBase) {
    throw new Error(
      `PR-02 generator requires exact integration-base HEAD ${integrationBase}; actual ${head}.`,
    )
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
