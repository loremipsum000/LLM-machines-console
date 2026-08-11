import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const closurePath =
  "docs/reduction/inference-core/f0-v2-founder-handover-closure.json"
const inventoryPath = "docs/reduction/inference-core/f0-v2-git-inventory.json"

test("F0-V2 binds the complete protected founder epoch", async () => {
  const closure = await readJson(closurePath)

  assert.equal(closure.workPackage, "F0-V2")
  assert.equal(
    closure.status,
    "FOUNDER_HANDOVER_CANDIDATE_PENDING_PROTECTED_ADMISSION",
  )
  assert.equal(closure.accepted, false)
  assert.equal(closure.runtimeQualified, false)
  assert.equal(closure.contractActivation, "INACTIVE")
  assert.equal(closure.q0, "NOT_STARTED")
  assert.equal(closure.genesisPublished, false)
  assert.equal(
    git("rev-parse", `${closure.predecessorClosure.integrationCommit}^{tree}`),
    closure.predecessorClosure.integrationTree,
  )
  assert.equal(
    git("rev-parse", `${closure.protectedInput.commit}^{tree}`),
    closure.protectedInput.tree,
  )

  assert.deepEqual(
    closure.protectedPackages.map(({ id }) => id),
    [
      "F0-UAT0",
      "F0-UAT0-H1",
      "F0-UAT0-H2",
      "F0-UAT0-H3",
      "F0-UAT0-H4",
      "F0-UAT0-H5",
      "F0-E2E2",
      "F0-UX2",
      "F0-UX2-T1",
      "F0-UX2-F1",
    ],
  )
  for (const item of closure.protectedPackages) verifyProtectedMerge(item)

  assert.deepEqual(
    git(
      "rev-list",
      "--first-parent",
      "--reverse",
      `${closure.predecessorClosure.integrationCommit}..${closure.protectedInput.commit}`,
    ).split("\n"),
    closure.protectedPackages.map(({ integrationCommit }) => integrationCommit),
  )

  for (const binding of closure.evidenceBindings) {
    assert.equal(
      sha256(await readSource(binding.path)),
      binding.sha256,
      `${binding.path} evidence fingerprint changed`,
    )
  }
})

test("F0-V2 keeps the reduced founder environment private and complete", async () => {
  const [closure, edge, noBypass, imageInventory, routeBaseline] =
    await Promise.all([
      readJson(closurePath),
      readJson("infra/ingress/edge-policy.json"),
      readJson("infra/ingress/no-bypass-policy.json"),
      readJson("infra/release/core-image-inventory.json"),
      readJson("docs/reduction/inference-core/route-baseline.json"),
    ])

  assert.deepEqual(Object.keys(edge.edge.hostTemplates).sort(), [
    "api",
    "console",
    "firecrawl",
    "identity",
  ])
  assert.deepEqual(edge.upstreams.map(({ id }) => id).sort(), [
    "console-bff",
    "console-web",
    "keycloak-identity",
  ])
  assert.equal(noBypass.customerNetwork.allowedTcpPorts.join(","), "443")
  assert.equal(edge.headerPolicy.browserBearerForwarding, false)
  assert.equal(edge.headerPolicy.websocketUpgradeForwarded, false)
  assert.equal(edge.responsePolicy.nativeAdministrationRedirectAllowed, false)

  const requiredPrivateSystems = new Set([
    "firecrawl-native",
    "grafana",
    "keycloak-admin",
    "litellm",
    "postgresql",
    "prometheus",
    "sglang",
  ])
  for (const system of requiredPrivateSystems) {
    assert.ok(edge.privateNativeSystems.includes(system), system)
  }

  const retained = new Set(imageInventory.components.map(({ id }) => id))
  for (const component of [
    "product-edge",
    "console-web",
    "console-bff",
    "keycloak",
    "litellm",
    "product-postgresql",
    "prometheus",
    "alertmanager",
    "grafana-private",
    "firecrawl-api",
    "firecrawl-browser",
    "firecrawl-search",
    "firecrawl-egress",
  ]) {
    assert.ok(retained.has(component), component)
  }

  assert.deepEqual(routeBaseline.target.consoleLogicalSurfaces, [
    "overview",
    "applications",
    "inference",
    "hardware",
    "team",
    "activity-audit",
    "settings",
  ])
  assert.ok(
    closure.journeyEvidence.some((item) =>
      item.includes("external standard OpenAI SDK"),
    ),
  )
  assert.ok(
    closure.journeyEvidence.some((item) =>
      item.includes("actual reduced Firecrawl"),
    ),
  )
  assert.equal(
    closure.realSglangComposite.status,
    "DEFERRED_SEPARATE_INTERNAL_SUBGATE",
  )
  assert.match(closure.realSglangComposite.reason, /cross-host/)
  assert.equal(
    closure.realSglangComposite.productImpact,
    "none; the founder environment uses deterministic inference and makes no production-capacity claim",
  )
})

test("F0-V2 remains governance-only and preserves Git history", async () => {
  const [closure, inventory, decisionRegister, validationRegister] =
    await Promise.all([
      readJson(closurePath),
      readJson(inventoryPath),
      readText("docs/reduction/inference-core/decision-register.md"),
      readText("docs/reduction/inference-core/validation-register.md"),
    ])

  assert.equal(closure.admission.publicationRequiresSeparateApproval, true)
  assert.match(closure.admission.genesisBinding, /protected integration merge/)
  assert.equal(inventory.observedAtBase, closure.protectedInput.commit)
  assert.equal(inventory.destructiveActionPerformed, false)
  assert.equal(inventory.branchesDeleted, 0)
  assert.equal(inventory.worktreesDeleted, 0)
  assert.equal(inventory.localBranches.count, 80)
  assert.equal(inventory.worktrees.count, 71)
  assert.equal(inventory.worktrees.clean + inventory.worktrees.dirty, 71)
  assert.equal(inventory.dirtyWorktreesPreserved.length, 2)
  assert.ok(
    inventory.terminalEpochBranches.some(
      ({ branch }) => branch === "codex/pre-genesis-f0-v2",
    ),
  )
  assert.match(decisionRegister, /\| F0-V2 \|/)
  assert.match(validationRegister, /\| F0-V2 \|/)

  const changedPaths = git(
    "diff",
    "--name-only",
    `${closure.protectedInput.commit}..HEAD`,
  ).split("\n")
  assert.deepEqual(changedPaths, [
    "docs/reduction/inference-core/README.md",
    "docs/reduction/inference-core/decision-register.md",
    "docs/reduction/inference-core/f0-v2-founder-handover-closure.json",
    "docs/reduction/inference-core/f0-v2-git-inventory.json",
    "docs/reduction/inference-core/validation-register.md",
    "scripts/inference-core/f0-v2-founder-handover-closure.test.mjs",
  ])

  for (const source of [JSON.stringify(closure), JSON.stringify(inventory)]) {
    assert.doesNotMatch(
      source,
      /(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})/,
    )
    assert.doesNotMatch(
      source,
      /(?:PRIVATE KEY|BEGIN OPENSSH|password=|token=)/i,
    )
  }
})

function verifyProtectedMerge(item) {
  assert.match(item.candidateCommit, /^[0-9a-f]{40}$/)
  assert.match(item.candidateTree, /^[0-9a-f]{40}$/)
  assert.match(item.integrationCommit, /^[0-9a-f]{40}$/)
  const parents = git(
    "show",
    "-s",
    "--format=%P",
    item.integrationCommit,
  ).split(" ")
  assert.equal(parents.length, 2)
  assert.equal(parents[1], item.candidateCommit)
  assert.equal(
    git("rev-parse", `${item.candidateCommit}^{tree}`),
    item.candidateTree,
  )
  assert.equal(
    git("rev-parse", `${item.integrationCommit}^{tree}`),
    item.candidateTree,
  )
  assert.match(
    git("show", "-s", "--format=%s", item.integrationCommit),
    new RegExp(
      `^Merge pull request #${item.pullRequest} from loremipsum000/codex/`,
    ),
  )
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

async function readSource(path) {
  return readFile(resolve(root, path))
}

async function readJson(path) {
  return JSON.parse((await readSource(path)).toString("utf8"))
}

async function readText(path) {
  return (await readSource(path)).toString("utf8")
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex")
}
