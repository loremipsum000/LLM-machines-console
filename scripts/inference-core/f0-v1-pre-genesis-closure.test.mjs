import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const closurePath =
  "docs/reduction/inference-core/f0-v1-pre-genesis-closure.json"
const inventoryPath = "docs/reduction/inference-core/f0-v1-git-inventory.json"
const closurePathBindingCommit = "c60abf27f7b812ff5b70cb654417b6f5ec7aef4c"

test("F0-V1 binds every protected functional package without rewriting history", async () => {
  const closure = await readJson(closurePath)

  assert.equal(closure.workPackage, "F0-V1")
  assert.equal(
    closure.status,
    "AGGREGATE_CANDIDATE_PENDING_PROTECTED_ADMISSION",
  )
  assert.equal(closure.accepted, false)
  assert.equal(closure.runtimeQualified, false)
  assert.equal(closure.contractActivation, "INACTIVE")
  assert.equal(closure.q0, "NOT_STARTED")
  assert.equal(closure.genesisPublished, false)
  assert.equal(closure.functionalPackages.length, 15)
  assert.deepEqual(closure.aggregateValidation.functional, [
    "node scripts/pre-genesis/reduced-core-integrated.mjs",
    "PRE_GENESIS_DOCKER_CONTEXT=<isolated-context> node scripts/pre-genesis/reduced-core-keycloak-identity.mjs --team",
  ])
  assert.equal(
    git("rev-parse", `${closure.protectedInput.commit}^{tree}`),
    closure.protectedInput.tree,
  )
  assert.equal(
    git("rev-parse", `${closure.functionalProgramBase.commit}^{tree}`),
    closure.functionalProgramBase.tree,
  )

  const packageIds = closure.functionalPackages.map(({ id }) => id)
  assert.deepEqual(packageIds, [
    "F0-E0",
    "F0-B1",
    "F0-L1",
    "F0-W1",
    "F0-S1",
    "F0-U1",
    "F0-U2",
    "F0-P1",
    "F0-O1",
    "F0-I1",
    "F0-I2",
    "F0-L2",
    "F0-F2",
    "F0-C1",
    "F0-SG1",
  ])

  for (const item of closure.functionalPackages) {
    verifyProtectedMerge(item)
    assert.equal(
      sha256(await readSource(item.evidencePath)),
      item.evidenceSha256,
      `${item.id} evidence fingerprint changed`,
    )
    const packageEvidence = await readJson(item.evidencePath)
    assert.equal(packageEvidence.workPackage, item.id)
    assert.notEqual(packageEvidence.accepted, true)
    assert.notEqual(packageEvidence.runtimeQualified, true)
    if (item.successor) verifyProtectedMerge(item.successor)
  }

  for (const item of closure.preservedInterveningHistory) {
    verifyProtectedMerge(item)
  }

  const firstParentSequence = git(
    "rev-list",
    "--first-parent",
    "--reverse",
    `${closure.functionalProgramBase.commit}..${closure.protectedInput.commit}`,
  ).split("\n")
  assert.deepEqual(firstParentSequence, [
    "2f97c5cbad70cbfc68987e9d8f5722107534537a",
    "22b007fb4ec3094a1336d65d706d53b9b652843a",
    "4f8ab8e087adc30cda5ea194daaee1fe8c68d2f8",
    "94d2011787642ed757b63ab03fa59df300bf1ef5",
    "6810a6077d5af1f3e99253924e36a4458729bc1d",
    "393d76561ab7922903497ce194e1c82550cf835a",
    "2eba73cfe74ce1e26e9768bcca9ac3f4b990e936",
    "a13d19749dc8a152cc1902180e4069687af56c4b",
    "5cd3a695283ad565dae2dd8764bda05d9657bec1",
    "03997c40fec20a2b7303ebc14c62abdb1a5c40ca",
    "6fb13ba3674a69fec7a9496b81bf2feeef09599b",
    "868153cf07221f450a468523ee5e08f5d6c9922c",
    "d3fa915d999f92b489822f4dcfd9c09732cebea3",
    "01c51555256ffcb741f1539ce2498ea858a314e1",
    "059866dc07dbc2af95df84ee834fca598a9a64a9",
    "e8e61f88e1fe101df7963a9e5df35050ce116bed",
    "5e7761b178e7a21a7679f6b9ede834caada994b0",
    "daec93eadb898f62ad1263b56b0793812ddb032c",
    "eefb9c3eb372a5b6789223458ccc319fa9784a04",
    "6220fbec6b6b2609f603e1ff3fc37af33f0fd704",
    "9fd7b12576cedeec4805ede4c419bbfc49815b28",
    "3d0b590608a58153e3285aafcaf96b711ac684e4",
    "4c5601f337b7c65b66039f1abd96c158513aa256",
  ])
})

test("F0-V1 fixes the reduced startup map and keeps native services private", async () => {
  const [closure, edge, imageInventory, noBypass, routeBaseline] =
    await Promise.all([
      readJson(closurePath),
      readJson("infra/ingress/edge-policy.json"),
      readJson("infra/release/core-image-inventory.json"),
      readJson("infra/ingress/no-bypass-policy.json"),
      readJson("docs/reduction/inference-core/route-baseline.json"),
    ])

  assert.deepEqual(Object.keys(edge.edge.hostTemplates).sort(), [
    "api",
    "console",
    "firecrawl",
    "identity",
  ])
  assert.deepEqual(
    closure.reducedStartupMap.map(({ id }) => id),
    [
      "product-edge",
      "console-web",
      "console-bff",
      "keycloak",
      "litellm",
      "product-postgresql",
      "prometheus",
      "alertmanager",
      "grafana-private",
      "firecrawl",
      "inference",
    ],
  )
  assert.ok(
    closure.reducedStartupMap.every(({ nativeExposure }) => !nativeExposure),
  )
  assert.deepEqual(edge.upstreams.map(({ id }) => id).sort(), [
    "console-bff",
    "console-web",
    "keycloak-identity",
  ])
  assert.deepEqual(edge.privateNativeSystems, [
    "alertmanager",
    "firecrawl-native",
    "grafana",
    "keycloak-admin",
    "litellm",
    "portainer",
    "postgresql",
    "prometheus",
    "sglang",
  ])
  assert.equal(edge.responsePolicy.nativeAdministrationRedirectAllowed, false)
  assert.equal(edge.headerPolicy.browserBearerForwarding, false)
  assert.equal(edge.headerPolicy.websocketUpgradeForwarded, false)
  assert.equal(noBypass.customerNetwork.allowedTcpPorts.join(","), "443")

  const retainedComponents = new Set(
    imageInventory.components.map(({ id }) => id),
  )
  for (const id of [
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
    assert.ok(retainedComponents.has(id), `missing retained component ${id}`)
  }
  assert.deepEqual(imageInventory.excluded, ["portainer"])

  const retiredRouteSegments = [
    "Y2hhdA==",
    "a25vd2xlZGdl",
    "cmFn",
    "Y29ycG9yYQ==",
    "bWNw",
  ].map((value) => Buffer.from(value, "base64").toString("utf8"))
  const customerUxRoutes = routeBaseline.routes.filter(
    ({ path, surface }) =>
      surface === "web-page" || path.startsWith("/api/admin/"),
  )
  assert.ok(
    customerUxRoutes.every(({ path }) => {
      const segments = path.toLowerCase().split("/").filter(Boolean)
      return retiredRouteSegments.every(
        (retired) => !segments.includes(retired),
      )
    }),
  )
  assert.deepEqual(routeBaseline.target.consoleLogicalSurfaces, [
    "overview",
    "applications",
    "inference",
    "hardware",
    "team",
    "activity-audit",
    "settings",
  ])
})

test("F0-V1 keeps aggregate acceptance and publication fail closed", async () => {
  const [
    closure,
    inventory,
    packageJson,
    decisionRegister,
    validationRegister,
  ] = await Promise.all([
    readJson(closurePath),
    readJson(inventoryPath),
    readJson("package.json"),
    readSource("docs/reduction/inference-core/decision-register.md"),
    readSource("docs/reduction/inference-core/validation-register.md"),
  ])

  assert.equal(closure.admission.publicationRequiresSeparateApproval, true)
  assert.match(closure.admission.genesisBinding, /protected integration merge/)
  assert.equal(inventory.destructiveActionPerformed, false)
  assert.equal(inventory.branchesDeleted, 0)
  assert.equal(inventory.worktreesDeleted, 0)
  assert.equal(inventory.localBranches.count, 69)
  assert.equal(inventory.worktrees.count, 60)
  assert.equal(inventory.worktrees.clean + inventory.worktrees.dirty, 60)
  assert.equal(inventory.dirtyWorktreesPreserved.length, 2)
  assert.ok(
    inventory.preGenesisBranches.some(
      ({ branch }) => branch === "codex/pre-genesis-f0-v1",
    ),
  )
  assert.match(packageJson.scripts.test, /test:inference-core-guardrails/)
  assert.match(packageJson.scripts.test, /test:release/)
  assert.match(
    packageJson.scripts["test:inference-core-guardrails"],
    /scripts\/inference-core\/\*\.test\.mjs/,
  )
  assert.match(decisionRegister, /\| F0-V1 \|/)
  assert.match(validationRegister, /\| F0-V1 \|/)
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

test("F0-V1 binds its reviewed governance and validation path set", async () => {
  const closure = await readJson(closurePath)
  assert.equal(
    git("rev-parse", closurePathBindingCommit),
    closurePathBindingCommit,
  )

  const changedPaths = git(
    "diff",
    "--name-only",
    `${closure.protectedInput.commit}..${closurePathBindingCommit}`,
  ).split("\n")
  assert.deepEqual(changedPaths, [
    "docs/reduction/inference-core/README.md",
    "docs/reduction/inference-core/decision-register.md",
    "docs/reduction/inference-core/f0-v1-git-inventory.json",
    "docs/reduction/inference-core/f0-v1-pre-genesis-closure.json",
    "docs/reduction/inference-core/validation-register.md",
    "scripts/inference-core/f0-i2-keycloak-team.test.mjs",
    "scripts/inference-core/f0-v1-pre-genesis-closure.test.mjs",
    "scripts/pre-genesis/reduced-core-keycloak-identity.mjs",
  ])
})

function verifyProtectedMerge(item) {
  assert.match(item.candidateCommit, /^[0-9a-f]{40}$/)
  assert.match(item.integrationCommit, /^[0-9a-f]{40}$/)
  const parents = git(
    "show",
    "-s",
    "--format=%P",
    item.integrationCommit,
  ).split(" ")
  assert.equal(parents.length, 2)
  assert.equal(parents[1], item.candidateCommit)
  const candidateTree = git("rev-parse", `${item.candidateCommit}^{tree}`)
  const integrationTree = git("rev-parse", `${item.integrationCommit}^{tree}`)
  assert.equal(candidateTree, integrationTree)
  if (item.candidateTree) assert.equal(candidateTree, item.candidateTree)
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

async function readJson(path) {
  return JSON.parse(await readSource(path))
}

async function readSource(path) {
  return readFile(resolve(root, path), "utf8")
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
