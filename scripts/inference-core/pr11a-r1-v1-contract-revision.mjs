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
  assertNoUnexpectedEnvironmentFiles,
  buildPr11aAggregateEvidenceDocument,
  buildPr11aR1V1ContractRevisionDocument,
  buildPr11aR1V1OperationPolicy,
  pr11aAggregateEvidencePath,
  pr11aContractRevisionPath,
  pr11aR1V1Input,
  pr11aR1V1InputTree,
  pr11aR1V1SourcePaths,
  repositoryRoot,
  verifyPr11aAggregateEvidenceDocument,
  verifyPr11aR1V1ContractRevisionDocument,
} from "./guardrails.mjs"

const mode = process.argv[2]
const branch = "codex/inference-core-pr-11a-r1-v1-successor"
const generatedDestinations = [
  pr11aAggregateEvidencePath,
  pr11aContractRevisionPath,
]
const markerPath = resolve(
  repositoryRoot,
  "docs/reduction/inference-core/.pr11a-r1-v1-successor-transaction.json",
)

if (
  process.argv.length !== 3 ||
  !["--print-operation-policy", "--write"].includes(mode)
) {
  throw new Error(
    "Pass exactly --print-operation-policy or --write for the PR-11A R1-V1 successor contract.",
  )
}

assertNoUnexpectedEnvironmentFiles(repositoryRoot)
assertLane()
assertTransactionPreflight()
assertStagedCandidate()
assertV1ClosureOnly()

const state = buildPr11aR1V1OperationPolicy(repositoryRoot)
assertProductBehaviorUnchanged(state)

if (mode === "--print-operation-policy") {
  process.stdout.write(`${JSON.stringify(state.operationPolicy, null, 2)}\n`)
  process.exit(0)
}

const aggregate = buildPr11aAggregateEvidenceDocument({
  root: repositoryRoot,
  operationPolicy: state.operationPolicy,
})
const aggregateErrors = verifyPr11aAggregateEvidenceDocument(aggregate, {
  root: repositoryRoot,
  operationPolicy: state.operationPolicy,
})
if (aggregateErrors.length > 0) {
  throw new Error(
    `Invalid R1-V1 successor aggregate evidence: ${aggregateErrors.join("; ")}`,
  )
}
const aggregateContent = serializeJson(aggregate)
const revision = buildPr11aR1V1ContractRevisionDocument({
  root: repositoryRoot,
  aggregateContent,
})
const revisionErrors = verifyPr11aR1V1ContractRevisionDocument(revision, {
  root: repositoryRoot,
  aggregateContent,
})
if (revisionErrors.length > 0) {
  throw new Error(
    `Invalid R1-V1 successor contract revision: ${revisionErrors.join("; ")}`,
  )
}
const revisionContent = serializeJson(revision)

writeTransaction([
  { path: pr11aAggregateEvidencePath, content: aggregateContent },
  { path: pr11aContractRevisionPath, content: revisionContent },
])

process.stdout.write(
  `${[
    `PR11A_AGGREGATE_EVIDENCE_SHA256=${sha256(aggregateContent)}`,
    `PR11A_CONTRACT_REVISION_SHA256=${sha256(revisionContent)}`,
  ].join("\n")}\n`,
)

function assertLane() {
  if (git(["branch", "--show-current"]) !== branch) {
    throw new Error(`R1-V1 successor generator requires branch ${branch}.`)
  }
  if (
    git(["rev-parse", `${pr11aR1V1Input}^{commit}`]) !== pr11aR1V1Input ||
    git(["rev-parse", `${pr11aR1V1Input}^{tree}`]) !== pr11aR1V1InputTree
  ) {
    throw new Error("R1-V1 successor exact input identity changed.")
  }
  execFileSync("git", ["merge-base", "--is-ancestor", pr11aR1V1Input, "HEAD"], {
    cwd: repositoryRoot,
    stdio: "ignore",
  })
}

function assertTransactionPreflight() {
  const residue = []
  if (existsSync(markerPath)) residue.push(markerPath)
  for (const path of generatedDestinations) {
    const absolutePath = resolve(repositoryRoot, path)
    const parent = dirname(absolutePath)
    if (!existsSync(parent)) continue
    const name = basename(absolutePath)
    for (const entry of readdirSync(parent)) {
      if (
        entry.startsWith(`${name}.tmp-`) ||
        entry.startsWith(`${name}.rollback-`)
      ) {
        residue.push(resolve(parent, entry))
      }
    }
  }
  if (residue.length > 0) {
    throw new Error(
      `Incomplete R1-V1 successor transaction: ${residue.sort().join(", ")}`,
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
      "R1-V1 successor generator requires every tracked change staged.",
    )
  }
  const untracked = git(["ls-files", "--others", "--exclude-standard"])
  if (untracked.length > 0) {
    throw new Error(
      `R1-V1 successor generator rejects untracked paths: ${untracked}`,
    )
  }
  try {
    execFileSync("git", ["diff", "--cached", "--quiet"], {
      cwd: repositoryRoot,
      stdio: "ignore",
    })
    throw new Error("R1-V1 successor generator requires a staged source delta.")
  } catch (error) {
    if (
      error?.message ===
      "R1-V1 successor generator requires a staged source delta."
    ) {
      throw error
    }
  }
}

function assertV1ClosureOnly() {
  const output = git([
    "diff",
    "--name-only",
    "--no-renames",
    pr11aR1V1Input,
    "--",
  ])
  const paths = output ? output.split("\n") : []
  const allowed = new Set(pr11aR1V1SourcePaths)
  const escaped = paths.filter((path) => !allowed.has(path))
  if (escaped.length > 0) {
    throw new Error(
      `R1-V1 successor changed a non-closure path: ${escaped.join(", ")}`,
    )
  }
}

function assertProductBehaviorUnchanged(state) {
  const expectedFindings = [
    {
      ruleId: "FS105_BUILDER_HUB",
      path: "apps/web/src/middleware.test.ts",
      count: 1,
      fingerprints: {
        "9c44a0853099d038b8ee6b801fc303a2f61257830666d6a0e5b51413562a58cd": 1,
      },
      removeBy: "PR-12",
    },
    {
      ruleId: "FS107_RETIRED_DATA_DEPENDENCY",
      path: "infra/storage/README.md",
      count: 1,
      fingerprints: {
        e33c1b5482aab59fd8b594c8f0bd28a315a411c9da6effe11aa63f28853d2755: 1,
      },
      removeBy: "PR-04",
    },
  ]
  const classifications = Object.fromEntries(
    [
      ...new Set(
        state.currentRoutes.routes.map(({ classification }) => classification),
      ),
    ]
      .sort()
      .map((classification) => [
        classification,
        state.currentRoutes.routes.filter(
          (route) => route.classification === classification,
        ).length,
      ]),
  )
  if (
    JSON.stringify(state.currentAllowlist.entries) !==
      JSON.stringify(expectedFindings) ||
    JSON.stringify(classifications) !==
      JSON.stringify({
        "current-console-seam": 92,
        "legacy-retired": 8,
        "operational-auth": 1,
        "private-operational": 4,
        "public-t2": 2,
        "required-now": 2,
      }) ||
    state.currentRoutes.routes.length !== 109 ||
    state.currentRoutes.fastifyRegistrars.length !== 6 ||
    state.currentRoutes.webInferenceConsumers.length !== 0 ||
    state.currentRoutes.escapeHatches.length !== 0
  ) {
    throw new Error(
      "R1-V1 successor integrated source shape differs from the exact post-H1 input.",
    )
  }
}

function git(args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim()
}

function serializeJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function writeTransaction(entries) {
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
  writeFileSync(
    markerPath,
    serializeJson({
      schemaVersion: 1,
      transaction: "PR-11A-R1-V1-successor-generated-artifacts",
      nonce,
      destinations: prepared.map(({ content, path, previous }) => ({
        path,
        previousSha256: previous === null ? null : sha256(previous),
        nextSha256: sha256(content),
      })),
    }),
    { flag: "wx", flush: true },
  )
  try {
    for (const entry of prepared) {
      writeFileSync(entry.temporaryPath, entry.content, {
        flag: "wx",
        flush: true,
      })
    }
    for (const entry of prepared) {
      renameSync(entry.temporaryPath, entry.absolutePath)
    }
    rmSync(markerPath)
  } catch (error) {
    for (const entry of prepared) {
      rmSync(entry.temporaryPath, { force: true })
      if (entry.previous === null) {
        rmSync(entry.absolutePath, { force: true })
      } else {
        writeFileSync(entry.absolutePath, entry.previous, { flush: true })
      }
    }
    rmSync(markerPath, { force: true })
    throw error
  }
}
