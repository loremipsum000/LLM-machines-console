import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const evidencePath =
  "docs/reduction/inference-core/f0-n6-console-technical-tools.json"
const admittedCandidate = "8b81412792feb57d7c89b82fc4b04d28b3f4d939"

test("F0-N6 binds the exact protected input and remains source-only", async () => {
  const evidence = await readJson(evidencePath)

  assert.equal(evidence.workPackage, "F0-N6")
  assert.equal(evidence.status, "SOURCE_UI_COMPLETE_RUNTIME_VALIDATION_PENDING")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE_PENDING_F0_N7")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.genesisPublished, false)
  assert.equal(
    evidence.protectedInput.commit,
    "ace103d9bdc6db24e616444e6e5d8a234a3c9414",
  )
  assert.equal(
    git("rev-parse", `${evidence.protectedInput.commit}^{tree}`),
    evidence.protectedInput.tree,
  )
  assert.equal(evidence.sourceChangeBoundary.nativeIngressActivated, false)
  assert.equal(evidence.sourceChangeBoundary.runtimeChanged, false)
})

test("F0-N6 exposes only the approved role-filtered Technical Tools", async () => {
  const evidence = await readJson(evidencePath)
  const resolver = await readText("apps/web/src/lib/admin/technical-tools.ts")

  assert.deepEqual(evidence.roleNavigation.Admin, [
    "grafana",
    "litellm",
    "keycloak",
  ])
  assert.deepEqual(evidence.roleNavigation.Operator, ["litellm"])
  assert.equal(
    evidence.roleNavigation.portainer,
    "DEFERRED_UPSTREAM_SECURITY_ABSENT",
  )
  assert.match(resolver, /roles: \["admin"\]/)
  assert.match(resolver, /roles: \["admin", "operator"\]/)
  assert.doesNotMatch(resolver, /portainer/i)
})

test("F0-N6 derives exact credential-free HTTPS links from host inputs", async () => {
  const evidence = await readJson(evidencePath)
  const environment = await readText(".env.example")
  const panel = await readText(
    "apps/web/src/components/technical-tools-panel.tsx",
  )

  assert.deepEqual(
    evidence.authorities.map(({ hostInput, fixedPath }) => ({
      fixedPath,
      hostInput,
    })),
    [
      { fixedPath: "/", hostInput: "PRODUCT_GRAFANA_HOST" },
      { fixedPath: "/ui/", hostInput: "PRODUCT_LITELLM_HOST" },
      {
        fixedPath: "/keycloak/admin/llm-machines/console/",
        hostInput: "PRODUCT_KEYCLOAK_ADMIN_HOST",
      },
    ],
  )
  for (const { hostInput } of evidence.authorities) {
    assert.match(environment, new RegExp(`^${hostInput}=[^/?:#@]+$`, "m"))
  }
  assert.match(panel, /target="_blank"/)
  assert.match(panel, /rel="noopener noreferrer"/)
  assert.equal(evidence.securityBoundary.scheme, "HTTPS_ONLY")
  assert.equal(evidence.securityBoundary.query, "FORBIDDEN")
  assert.equal(evidence.securityBoundary.userinfo, "FORBIDDEN")
  assert.equal(evidence.securityBoundary.consoleSessionForwarded, false)
  assert.equal(evidence.securityBoundary.consoleTokenForwarded, false)
})

test("F0-N6 keeps Console Keys distinct from native LiteLLM keys", async () => {
  const evidence = await readJson(evidencePath)
  const panel = await readText(
    "apps/web/src/components/technical-tools-panel.tsx",
  )

  assert.equal(
    evidence.copyBoundary.consoleApplicationCredentials,
    "RECOMMENDED_CUSTOMER_INTEGRATION_PATH",
  )
  assert.equal(
    evidence.copyBoundary.litellmVirtualKeys,
    "SEPARATE_ADVANCED_NATIVE_TECHNICAL_PATH",
  )
  assert.match(panel, /Console Keys remain the default/)
  assert.match(panel, /not Console Keys/)
})

test("F0-N6 source fingerprints and changed-path inventory are exact", async () => {
  const evidence = await readJson(evidencePath)
  const changedPaths = git(
    "diff",
    "--name-only",
    `${evidence.protectedInput.commit}..${admittedCandidate}`,
  )
    .split("\n")
    .filter(Boolean)
    .sort()

  assert.deepEqual(
    changedPaths,
    [...evidence.sourceChangeBoundary.changedPaths].sort(),
  )
  for (const [path, expected] of Object.entries(evidence.sourceArtifacts)) {
    assert.equal(
      `sha256:${sha256(gitRaw("show", `${admittedCandidate}:${path}`))}`,
      expected,
      path,
    )
  }
})

test("F0-N6 preserves F0-N5 evidence and retains no secret-bearing navigation", async () => {
  const evidence = await readJson(evidencePath)
  const base = evidence.protectedInput.commit
  const preservedPath = "docs/reduction/inference-core/f0-n5-native-edge.json"
  const current = (await readText(preservedPath)).trim()

  assert.equal(current, git("show", `${base}:${preservedPath}`))
  for (const path of [
    evidencePath,
    "apps/web/src/lib/admin/technical-tools.ts",
    "apps/web/src/components/technical-tools-panel.tsx",
  ]) {
    const source = await readText(path)
    assert.doesNotMatch(
      source,
      /(?:PRIVATE KEY|BEGIN OPENSSH|Bearer\s+|eyJ[A-Za-z0-9_-]{20}|llmm_(?:t4|fc)_[A-Za-z0-9_-]{20})/i,
    )
  }
})

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

function gitRaw(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" })
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

async function readJson(path) {
  return JSON.parse(await readText(path))
}

async function readText(path) {
  return readFile(resolve(root, path), "utf8")
}
