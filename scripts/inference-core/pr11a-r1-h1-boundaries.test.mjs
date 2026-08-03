import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"
import {
  buildForbiddenAllowlist,
  buildRouteBaseline,
  listCandidatePaths,
  pr11aR1H1DecisionPath,
  pr11aR1H1GovernancePaths,
  pr11aR1H1HygienePaths,
  pr11aR1H1IntegrationBase,
  pr11aR1H1IntegrationBaseTree,
  pr11aR1H1SourceCandidatePaths,
  verifyPr11aR1H1Decision,
} from "./guardrails.mjs"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const temporaryRoots = []

after(() => {
  for (const root of temporaryRoots) {
    rmSync(root, { recursive: true, force: true })
  }
})

function git(...args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim()
}

function readDecision() {
  return JSON.parse(
    readFileSync(resolve(repositoryRoot, pr11aR1H1DecisionPath), "utf8"),
  )
}

function candidatePaths() {
  const output = git(
    "diff",
    "--name-only",
    "--no-ext-diff",
    "--no-renames",
    pr11aR1H1IntegrationBase,
    "--",
  )
  return output ? output.split("\n").sort() : []
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function detachedBaseRoot() {
  const root = mkdtempSync(join(tmpdir(), "llmm-r1-h1-base-"))
  temporaryRoots.push(root)
  execFileSync(
    "git",
    ["clone", "--quiet", "--shared", "--no-checkout", repositoryRoot, root],
    { stdio: "ignore" },
  )
  execFileSync("git", ["checkout", "--quiet", pr11aR1H1IntegrationBase], {
    cwd: root,
    stdio: "ignore",
  })
  return root
}

test("R1-H1 starts from the D1 hygiene integration merge", () => {
  assert.equal(
    git("rev-parse", `${pr11aR1H1IntegrationBase}^{tree}`),
    pr11aR1H1IntegrationBaseTree,
  )
  assert.doesNotThrow(() =>
    git("merge-base", "--is-ancestor", pr11aR1H1IntegrationBase, "HEAD"),
  )
})

test("R1-H1 is an exact unaccepted source-only successor", () => {
  const decision = readDecision()
  assert.deepEqual(verifyPr11aR1H1Decision(decision), [])
  assert.deepEqual(decision.hygienePathInventory, pr11aR1H1HygienePaths)
  assert.deepEqual(decision.governancePathInventory, pr11aR1H1GovernancePaths)
  assert.deepEqual(decision.sourcePathInventory, pr11aR1H1SourceCandidatePaths)
  assert.deepEqual(candidatePaths(), pr11aR1H1SourceCandidatePaths)
  assert.equal(decision.accepted, false)
  assert.equal(decision.revisionBound, false)
  assert.equal(decision.runtimeQualified, false)
  assert.equal(
    decision.sourceHeadCommit,
    "49ad418408aab32f30e7f6008aa71ad66ba5e708",
  )
  assert.equal(
    decision.sourceHeadTree,
    "eb9b31503d575e6587f4cf7957b74f9c001cd632",
  )
  assert.equal(
    existsSync(
      resolve(
        repositoryRoot,
        "docs/reduction/inference-core/contract-revisions/PR-11A.json",
      ),
    ),
    false,
  )
})

test("R1-H1 binds every base and formatted source fingerprint", () => {
  const decision = readDecision()
  for (const path of pr11aR1H1HygienePaths) {
    const baseSource = execFileSync(
      "git",
      ["show", `${pr11aR1H1IntegrationBase}:${path}`],
      { cwd: repositoryRoot },
    )
    assert.equal(decision.baseFingerprints[path], sha256(baseSource))
    assert.equal(
      decision.sourceFingerprints[path],
      sha256(readFileSync(resolve(repositoryRoot, path))),
    )
  }
})

test("R1-H1 preserves the parsed historical PR-09 decision", () => {
  const decision = readDecision()
  const path = decision.historicalJsonEvidence.path
  const base = JSON.parse(
    execFileSync("git", ["show", `${pr11aR1H1IntegrationBase}:${path}`], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }),
  )
  const current = JSON.parse(
    readFileSync(resolve(repositoryRoot, path), "utf8"),
  )
  assert.deepEqual(current, base)
})

test("R1-H1 preserves forbidden findings and route behavior from its exact base", () => {
  const baseRoot = detachedBaseRoot()
  const decision = readDecision()
  const baseForbidden = buildForbiddenAllowlist({
    root: baseRoot,
    paths: listCandidatePaths(baseRoot),
  })
  const sourceForbidden = buildForbiddenAllowlist({
    root: repositoryRoot,
    paths: listCandidatePaths(repositoryRoot),
  })
  assert.deepEqual(sourceForbidden.entries, baseForbidden.entries)

  const baseRoutes = buildRouteBaseline({
    root: baseRoot,
    paths: listCandidatePaths(baseRoot),
  })
  const sourceRoutes = buildRouteBaseline({
    root: repositoryRoot,
    paths: listCandidatePaths(repositoryRoot),
  })
  for (const key of [
    "target",
    "routes",
    "fastifyRegistrars",
    "webInferenceConsumers",
    "escapeHatches",
  ]) {
    assert.deepEqual(sourceRoutes[key], baseRoutes[key], key)
  }

  assert.deepEqual(
    sourceRoutes.sourceClosure.map(({ path }) => path),
    baseRoutes.sourceClosure.map(({ path }) => path),
  )
  for (const sourceEntry of sourceRoutes.sourceClosure) {
    const baseEntry = baseRoutes.sourceClosure.find(
      ({ path }) => path === sourceEntry.path,
    )
    assert.ok(baseEntry)
    if (sourceEntry.sha256 !== baseEntry.sha256) {
      assert.equal(pr11aR1H1HygienePaths.includes(sourceEntry.path), true)
      assert.equal(
        decision.baseFingerprints[sourceEntry.path],
        baseEntry.sha256,
      )
      assert.equal(
        decision.sourceFingerprints[sourceEntry.path],
        sourceEntry.sha256,
      )
    }
  }

  assert.deepEqual(
    sourceRoutes.fingerprints.map(({ path, symbol }) => ({ path, symbol })),
    baseRoutes.fingerprints.map(({ path, symbol }) => ({ path, symbol })),
  )
  const routeFingerprintTransitions = []
  for (const sourceEntry of sourceRoutes.fingerprints) {
    const baseEntry = baseRoutes.fingerprints.find(
      ({ path, symbol }) =>
        path === sourceEntry.path && symbol === sourceEntry.symbol,
    )
    assert.ok(baseEntry)
    if (sourceEntry.sha256 !== baseEntry.sha256) {
      assert.equal(pr11aR1H1HygienePaths.includes(sourceEntry.path), true)
      routeFingerprintTransitions.push({
        path: sourceEntry.path,
        symbol: sourceEntry.symbol,
        beforeSha256: baseEntry.sha256,
        afterSha256: sourceEntry.sha256,
      })
    }
  }
  assert.deepEqual(routeFingerprintTransitions, [
    {
      path: "apps/web/src/lib/auth/session-client.ts",
      symbol: "<file>",
      beforeSha256:
        "4d978b0d82a5a79face8547b0f85afb4bfe671cbd1556b661e062081d8b1e065",
      afterSha256:
        "49261f257de5282c615fcf3079a295fb3e404ff0942890d1f5f0765c63f1ef27",
    },
  ])
})

test("R1-H1 decision tampering fails closed", () => {
  const accepted = structuredClone(readDecision())
  accepted.accepted = true
  assert.match(
    verifyPr11aR1H1Decision(accepted).join("\n"),
    /invalid R1-H1 source package identity/,
  )

  const extraPath = structuredClone(readDecision())
  extraPath.sourcePathInventory.push("apps/web/src/unauthorized.ts")
  assert.match(
    verifyPr11aR1H1Decision(extraPath).join("\n"),
    /invalid R1-H1 source package identity/,
  )

  const runtime = structuredClone(readDecision())
  runtime.behaviorBoundary.runtimeActivated = true
  assert.match(
    verifyPr11aR1H1Decision(runtime).join("\n"),
    /invalid R1-H1 behavior boundary/,
  )

  const fingerprint = structuredClone(readDecision())
  fingerprint.sourceFingerprints[pr11aR1H1HygienePaths[0]] = "invalid"
  assert.match(
    verifyPr11aR1H1Decision(fingerprint).join("\n"),
    /invalid R1-H1 source fingerprint inventory/,
  )

  const unreviewed = structuredClone(readDecision())
  unreviewed.reviewStatus = "source-candidate-awaiting-independent-review"
  unreviewed.sourceHeadCommit = null
  unreviewed.sourceHeadTree = null
  assert.match(
    verifyPr11aR1H1Decision(unreviewed).join("\n"),
    /invalid R1-H1 source package identity/,
  )
})

test("R1-H1 registers remain explicit about reviewed but unaccepted status", () => {
  const decisionRegister = readFileSync(
    resolve(
      repositoryRoot,
      "docs/reduction/inference-core/decision-register.md",
    ),
    "utf8",
  )
  const validationRegister = readFileSync(
    resolve(
      repositoryRoot,
      "docs/reduction/inference-core/validation-register.md",
    ),
    "utf8",
  )
  assert.match(
    decisionRegister,
    /R1-H1[^\n]+independently reviewed source candidate[^\n]+full detached source validation passed[^\n]+unaccepted[^\n]+not revision-bound[^\n]+not runtime-qualified/i,
  )
  assert.match(
    validationRegister,
    /R1-H1[^\n]+clean detached full source validation plus independent review[^\n]+49ad418408aab32f30e7f6008aa71ad66ba5e708[^\n]+unaccepted[^\n]+not revision-bound[^\n]+not runtime-qualified/i,
  )
})
