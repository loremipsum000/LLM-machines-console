import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const aggregatePath =
  "docs/reduction/inference-core/pr-12-aggregate-evidence.json"

function git(...args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim()
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"))
}

function sha256AtCommit(commit, path) {
  return createHash("sha256")
    .update(
      execFileSync("git", ["show", `${commit}:${path}`], {
        cwd: repositoryRoot,
      }),
    )
    .digest("hex")
}

test("PR-12 aggregate binds the complete protected package chain", () => {
  const aggregate = readJson(aggregatePath)
  assert.equal(
    git("rev-parse", `${aggregate.initialInput.commit}^{tree}`),
    aggregate.initialInput.tree,
  )
  assert.equal(
    git("rev-parse", `${aggregate.releaseSource.commit}^{tree}`),
    aggregate.releaseSource.tree,
  )

  let expectedFirstParent = aggregate.initialInput.commit
  for (const entry of aggregate.packages) {
    assert.equal(entry.firstParent, expectedFirstParent)
    assert.equal(git("rev-parse", `${entry.mergeCommit}^1`), entry.firstParent)
    assert.equal(git("rev-parse", `${entry.mergeCommit}^2`), entry.packageHead)
    assert.equal(
      git("rev-parse", `${entry.packageHead}^{tree}`),
      entry.packageHeadTree,
    )
    assert.equal(
      git("rev-parse", `${entry.mergeCommit}^{tree}`),
      entry.mergeTree,
    )
    assert.equal(entry.packageHeadTree, entry.mergeTree)

    const changedPaths = git(
      "diff",
      "--name-status",
      "--no-renames",
      entry.firstParent,
      entry.mergeCommit,
    )
      .split("\n")
      .filter(Boolean)
      .map((line) => line.replace("\t", " "))
    assert.deepEqual(changedPaths, entry.changedPaths)

    for (const evidence of entry.evidence) {
      assert.equal(
        sha256AtCommit(entry.mergeCommit, evidence.path),
        evidence.sha256,
      )
    }
    expectedFirstParent = entry.mergeCommit
  }
  assert.equal(expectedFirstParent, aggregate.releaseSource.commit)
})

test("PR-12 release source evidence fingerprints are exact", () => {
  const aggregate = readJson(aggregatePath)
  for (const evidence of Object.values(aggregate.sourceEvidence)) {
    assert.equal(
      sha256AtCommit(aggregate.releaseSource.commit, evidence.path),
      evidence.sha256,
    )
  }
})

test("PR-12 aggregate preserves the source-only qualification boundary", () => {
  const aggregate = readJson(aggregatePath)
  const releasePlan = readJson("infra/release/release-plan.json")
  const sglang = readJson("infra/inference/sglang-engine-contract.json")

  assert.deepEqual(aggregate.status, {
    sourcePackaging: "IMPLEMENTATION_PACKAGES_MERGED",
    aggregateAdmission: "PENDING",
    accepted: false,
    runtimeQualified: false,
    contractActivation: "INACTIVE",
    d2aRc: "NOT_STARTED",
    q0: "NOT_STARTED",
    deployment: "INACTIVE",
    productMain: "UNCHANGED",
  })
  assert.equal(releasePlan.runtimeQualified, false)
  assert.equal(releasePlan.qualification.manifestStatus, "PACKAGED_UNQUALIFIED")
  assert.equal(releasePlan.qualification.q0, "NOT_STARTED")
  assert.equal(releasePlan.qualification.contractActivation, "INACTIVE")
  assert.equal(
    releasePlan.qualification.nativeAccessSourceProfile,
    "ADMITTED_INACTIVE_PENDING_VM103_DEPLOYMENT",
  )
  assert.equal(
    releasePlan.qualification.grafanaCustomerAccess,
    "ADMIN_EDITOR_ONLY_NO_SERVER_ADMIN",
  )
  assert.equal(
    releasePlan.qualification.nativeLiteLlmAccess,
    "ADMIN_PROXY_ADMIN_OPERATOR_INTERNAL_USER_OWN_KEYS_AND_SPEND_ONLY",
  )
  assert.equal(
    releasePlan.qualification.nativeKeycloakAdminAccess,
    "ADMIN_APPLIANCE_REALM_SCOPED_USER_DELETE_EDGE_DENIED",
  )
  assert.equal(
    releasePlan.qualification.portainerAccess,
    "DEFERRED_UPSTREAM_SECURITY",
  )
  assert.equal(sglang.engine.name, "sglang")
  assert.equal(sglang.engine.version, "0.5.13")
  assert.deepEqual(sglang.engine.excludedEngines, ["vllm"])
  assert.equal(sglang.imageBinding.historicalLabImageAdmitted, false)
})

test("PR-12 aggregate retains the fixed Core and reduced Firecrawl boundaries", () => {
  const boundary = readJson(aggregatePath).productBoundary
  assert.deepEqual(boundary.coreProfile, {
    id: "core-v1-linux-amd64",
    vcpus: 8,
    memoryGiB: 32,
    localDiskGiB: 100,
    backupRepository: "separate-customer-owned-target",
    bulkModelWeights: "excluded",
  })
  assert.deepEqual(boundary.firecrawl.routes, [
    "POST /v2/search",
    "POST /v2/scrape",
  ])
  assert.equal(boundary.firecrawl.installation, "installed-default-off")
  assert.equal(boundary.firecrawl.network, "private-product-edge-only")
  assert.equal(boundary.firecrawl.credential, "separate-per-application")
  assert.equal(boundary.firecrawl.runtimeQualification, "NOT_STARTED")
  assert.deepEqual(boundary.nativeSurfaces, {
    grafanaCustomerAccess: "DEFERRED_V1",
    litellm: "PRIVATE_CONSOLE_READ_ONLY_PROJECTION_ONLY",
    keycloakAdmin: "ABSENT_V1",
  })
})
