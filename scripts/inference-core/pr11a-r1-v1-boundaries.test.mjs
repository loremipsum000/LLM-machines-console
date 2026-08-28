import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import {
  buildPr11aR1V1OperationPolicy,
  pr11aAggregateEvidencePath,
  pr11aContractBase,
  pr11aContractBaseTree,
  pr11aContractRevisionPath,
  pr11aR1V1HistoricalLocalHead,
  pr11aR1V1HistoricalLocalTree,
  pr11aR1V1HistoricalRemoteRef,
  pr11aR1V1Input,
  pr11aR1V1InputTree,
  pr11aR1V1PackageMerges,
  pr11aR1V1ProtectedAdmission,
  pr11aR1V1SourceClosurePath,
  pr11aR1V1SourcePaths,
  pr11aR1V1ValidatedCandidate,
  verifyPr11aAggregateEvidenceDocument,
  verifyPr11aR1V1ContractRevisionDocument,
} from "./guardrails.mjs"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

function git(...args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim()
}

function gitBytes(...args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: null,
  })
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"))
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

test("R1-V1 successor is anchored to the exact post-H1 integration input", () => {
  assert.equal(
    git("rev-parse", `${pr11aContractBase}^{tree}`),
    pr11aContractBaseTree,
  )
  assert.equal(git("rev-parse", `${pr11aR1V1Input}^{tree}`), pr11aR1V1InputTree)
  assert.doesNotThrow(() =>
    git("merge-base", "--is-ancestor", pr11aR1V1Input, "HEAD"),
  )
  for (const entry of pr11aR1V1PackageMerges) {
    assert.equal(git("rev-parse", `${entry.mergeCommit}^1`), entry.firstParent)
    assert.equal(git("rev-parse", `${entry.mergeCommit}^2`), entry.packageHead)
    assert.equal(
      git("rev-parse", `${entry.mergeCommit}^{tree}`),
      entry.mergeTree,
    )
  }
})

test("blocked historical V1 evidence remains immutable and is not the successor base", () => {
  assert.equal(
    git("rev-parse", `${pr11aR1V1HistoricalRemoteRef}^{tree}`),
    "4795e390f6d204be71de9c52b8b142c6724f8825",
  )
  let localTree = null
  try {
    localTree = git("rev-parse", `${pr11aR1V1HistoricalLocalHead}^{tree}`)
  } catch {}
  if (localTree !== null) assert.equal(localTree, pr11aR1V1HistoricalLocalTree)
  assert.notEqual(pr11aR1V1Input, pr11aR1V1HistoricalRemoteRef)
  const aggregate = readJson(pr11aAggregateEvidencePath)
  assert.equal(
    aggregate.historicalBlockedAttempt.disposition,
    "read-only-historical-evidence-not-a-successor-base-or-portable-validation-dependency",
  )
})

test("R1-V1 successor changes only the exact aggregate closure paths", () => {
  const output = git(
    "diff",
    "--name-only",
    "--no-renames",
    pr11aR1V1Input,
    pr11aR1V1ValidatedCandidate,
    "--",
  )
  assert.deepEqual(output ? output.split("\n") : [], pr11aR1V1SourcePaths)
  assert.equal(
    pr11aR1V1SourcePaths.some((path) =>
      /^(?:apps|packages\/contracts|infra\/(?:ingress|keycloak|storage))\//.test(
        path,
      ),
    ),
    false,
  )
  for (const path of [
    "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
    "docs/reduction/inference-core/route-baseline.json",
  ]) {
    assert.equal(
      sha256(readFileSync(resolve(repositoryRoot, path))),
      sha256(gitBytes("show", `${pr11aR1V1Input}:${path}`)),
    )
  }
})

test("aggregate package identities and evidence fingerprints are exact", () => {
  const aggregate = readJson(pr11aAggregateEvidencePath)
  assert.deepEqual(
    aggregate.packages.map(({ id, mergeCommit, mergeTree, pullRequest }) => ({
      id,
      mergeCommit,
      mergeTree,
      pullRequest,
    })),
    pr11aR1V1PackageMerges.map(
      ({ id, mergeCommit, mergeTree, pullRequest }) => ({
        id,
        mergeCommit,
        mergeTree,
        pullRequest,
      }),
    ),
  )
  for (const packageEntry of aggregate.packages) {
    for (const evidence of packageEntry.evidence) {
      assert.equal(
        evidence.sha256,
        sha256(
          gitBytes("show", `${packageEntry.mergeCommit}:${evidence.path}`),
        ),
      )
    }
  }
})

test("S1 and D1 inconsistencies are reconciled without rewriting records", () => {
  const aggregate = readJson(pr11aAggregateEvidencePath)
  const s1Path =
    "docs/reduction/inference-core/pr-11a-r1-s1-console-session-decisions.json"
  const d1Path =
    "docs/reduction/inference-core/pr-11a-r1-d1-storage-recovery-decisions.json"
  const s1 = readJson(s1Path)
  const d1 = readJson(d1Path)
  assert.equal(s1.sourceHeadCommit, "f9ca423533ba74f7a8d2fe205e27f7561285830b")
  assert.equal(s1.accepted, false)
  assert.equal(d1.sourceHeadCommit, "46295906c3d733b0e56abe94d9732d8eb0549c29")
  assert.equal(d1.accepted, false)
  assert.equal(d1.revisionBound, false)
  assert.equal(d1.runtimeQualified, false)
  assert.equal(
    aggregate.recordReconciliation.find(({ package: id }) => id === "R1-S1")
      .historicalRecordSha256,
    sha256(readFileSync(resolve(repositoryRoot, s1Path))),
  )
  assert.equal(
    aggregate.recordReconciliation.find(({ package: id }) => id === "R1-D1")
      .historicalRecordSha256,
    sha256(readFileSync(resolve(repositoryRoot, d1Path))),
  )
})

test("aggregate and contract revision are deterministic unaccepted artifacts", () => {
  assert.equal(
    existsSync(resolve(repositoryRoot, pr11aAggregateEvidencePath)),
    true,
  )
  assert.equal(
    existsSync(resolve(repositoryRoot, pr11aContractRevisionPath)),
    true,
  )
  const state = buildPr11aR1V1OperationPolicy(repositoryRoot)
  const aggregate = readJson(pr11aAggregateEvidencePath)
  const aggregateContent = readFileSync(
    resolve(repositoryRoot, pr11aAggregateEvidencePath),
  )
  if (existsSync(resolve(repositoryRoot, pr11aR1V1SourceClosurePath))) {
    assert.equal(
      sha256(aggregateContent),
      sha256(
        gitBytes(
          "show",
          `${pr11aR1V1ProtectedAdmission}:${pr11aAggregateEvidencePath}`,
        ),
      ),
    )
    assert.equal(
      sha256(readFileSync(resolve(repositoryRoot, pr11aContractRevisionPath))),
      sha256(
        gitBytes(
          "show",
          `${pr11aR1V1ProtectedAdmission}:${pr11aContractRevisionPath}`,
        ),
      ),
    )
  } else {
    assert.deepEqual(
      verifyPr11aAggregateEvidenceDocument(aggregate, {
        root: repositoryRoot,
        operationPolicy: state.operationPolicy,
      }),
      [],
    )
    assert.deepEqual(
      verifyPr11aR1V1ContractRevisionDocument(
        readJson(pr11aContractRevisionPath),
        { root: repositoryRoot, aggregateContent },
      ),
      [],
    )
  }
  assert.deepEqual(aggregate.status, {
    accepted: false,
    revisionBound: false,
    runtimeQualified: false,
    contractRevision: "generated-unaccepted-source-candidate",
    protectedAdmission: "pending-user-approval-and-protected-pr",
    runtimeQualification: "Q0-not-started",
  })
  const routes = readJson("docs/reduction/inference-core/route-baseline.json")
  assert.equal(routes.reviewedRevisions.at(-1)?.id, "PR-11")
})

test("private native surfaces stay absent and Grafana remains optional inactive", () => {
  const aggregate = readJson(pr11aAggregateEvidencePath)
  assert.equal(
    aggregate.productBoundary.litellm,
    "private-console-read-only-projection-only",
  )
  assert.equal(
    aggregate.productBoundary.keycloak,
    "private-identity-provider-console-basic-identity-mutations-only",
  )
  assert.match(
    aggregate.productBoundary.grafanaNativeAccess,
    /^optional-inactive-/,
  )
  assert.equal(aggregate.productBoundary.expertIngressActivated, false)
  assert.equal(aggregate.productBoundary.pr12Started, false)
  assert.equal(aggregate.productBoundary.q0Started, false)
  assert.equal(
    existsSync(
      resolve(repositoryRoot, "apps/bff/src/services/expert-capabilities.ts"),
    ),
    false,
  )
})

test("aggregate and contract tampering fail closed", () => {
  const state = buildPr11aR1V1OperationPolicy(repositoryRoot)
  const aggregate = readJson(pr11aAggregateEvidencePath)
  const tamperedAggregate = structuredClone(aggregate)
  tamperedAggregate.status.accepted = true
  assert.notDeepEqual(
    verifyPr11aAggregateEvidenceDocument(tamperedAggregate, {
      root: repositoryRoot,
      operationPolicy: state.operationPolicy,
    }),
    [],
  )
  const aggregateContent = readFileSync(
    resolve(repositoryRoot, pr11aAggregateEvidencePath),
  )
  const revision = readJson(pr11aContractRevisionPath)
  const tamperedRevision = structuredClone(revision)
  tamperedRevision.scope = "broadened"
  assert.notDeepEqual(
    verifyPr11aR1V1ContractRevisionDocument(tamperedRevision, {
      root: repositoryRoot,
      aggregateContent,
    }),
    [],
  )
})
