import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"

import { renderDeliveryProfile } from "../../infra/inference/render-profile.mjs"
import {
  canonicalJson,
  loadContracts,
  profileQualificationDigest,
  sha256,
} from "../../infra/inference/validate-profile.mjs"
import { founderRuntimeImportAllowedNames as captureRuntimeImportAllowedNames } from "./capture-vm103-founder-custody.mjs"
import { parseRuntimeSecretMaterial } from "./capture-vm103-founder-custody.mjs"
import { renderVm103FounderCandidate } from "./render-vm103-founder-candidate.mjs"
import {
  founderRuntimeImportAllowedNames,
  verifyFounderRuntimeCustody,
} from "./verify-vm103-founder-runtime-custody.mjs"

const contracts = loadContracts()
const now = new Date("2026-08-25T12:00:00.000Z")
const expectedUid = process.getuid()
const sourceCompose = new URL(
  "../../infra/deployment/vm103-founder-candidate.compose.yaml",
  import.meta.url,
)
const sourceMountFiles = [
  "infra/ingress/proxy-common.inc",
  "infra/ingress/request-headers-console-browser.inc",
  "infra/ingress/request-headers-customer-api.inc",
  "infra/ingress/request-headers-grafana-browser.inc",
  "infra/ingress/request-headers-identity-browser.inc",
  "infra/ingress/request-headers-keycloak-admin-browser.inc",
  "infra/ingress/request-headers-litellm-browser.inc",
  "infra/ingress/request-safety.inc",
]
const secretFiles = [
  "bff-service-api-key",
  "console-oidc-client-secret",
  "database-url",
  "keycloak-admin-client-secret",
  "keycloak-application-admin-client-secret",
  "litellm-key",
]

function activatedProfile() {
  const profile = JSON.parse(
    readFileSync(
      new URL(
        "../../infra/inference/fixtures/synthetic-single-node.json",
        import.meta.url,
      ),
      "utf8",
    ),
  )
  profile.metadata.admissionScope = "INTERNAL_TEST_ONLY"
  profile.metadata.lifecycleState = "ACTIVE_MEASURED_INTERNAL_TEST"
  profile.accelerator.productionSupportClaim = false
  profile.engine.image.sbomDigest = null
  profile.engine.image.provenanceDigest = null
  profile.network.port = 30_005
  profile.capacity = {
    state: "MEASURED",
    profileRevision: profile.metadata.revision,
    engineImageDigest: profile.engine.image.digest,
    modelArtifactDigest: profile.model.artifactDigest,
    evidenceDigest: `sha256:${"4".repeat(64)}`,
    measuredAt: "2026-08-24T17:08:51.086Z",
    validUntil: "2026-09-23T17:08:51.086Z",
    effectiveContextTokens: profile.limits.configuredContextTokens,
    maxOutputTokens: profile.limits.maxOutputTokens,
    throughputTokensPerSecond: 12.5,
    maxConcurrentRequests: 1,
    p95LatencyMilliseconds: 125,
    queue: { maxObservedDepth: 0, state: "measured" },
  }
  profile.activation.state = "ACTIVE_INTERNAL_TEST"
  profile.activation.qualifiedProfileDigest =
    profileQualificationDigest(profile)
  return profile
}

async function createFixture() {
  const initial = await mkdtemp(join(tmpdir(), "llmm-founder-custody-"))
  const root = await realpath(initial)
  const sourceRoot = join(root, "source")
  const configurationRoot = join(root, "configuration")
  const secretRoot = join(root, "secrets")
  const admissionRoot = join(root, "admission")
  const composePath = join(
    sourceRoot,
    "infra/deployment/vm103-founder-candidate.compose.yaml",
  )
  await mkdir(dirname(composePath), { mode: 0o755, recursive: true })
  await writeFile(composePath, await readFile(sourceCompose), { mode: 0o644 })
  for (const relative of sourceMountFiles) {
    const path = join(sourceRoot, relative)
    await mkdir(dirname(path), { mode: 0o755, recursive: true })
    await writeFile(path, "credential-free fixture\n", { mode: 0o644 })
  }
  await mkdir(secretRoot, { mode: 0o700 })
  await mkdir(admissionRoot, { mode: 0o700 })

  const sourceProfile = activatedProfile()
  const renderedProfile = renderDeliveryProfile(sourceProfile, contracts)
  const placement = {
    source: { commit: "b".repeat(40), tree: "c".repeat(40) },
    authorities: {
      api: "api.lab.example",
      console: "console.lab.example",
      firecrawl: "firecrawl.lab.example",
      grafana: "grafana.lab.example",
      identity: "identity.lab.example",
      keycloak: "keycloak.lab.example",
      litellm: "litellm.lab.example",
    },
    images: {
      bff: `sha256:${"a".repeat(64)}`,
      edge: `nginx@sha256:${"a".repeat(64)}`,
      web: `sha256:${"a".repeat(64)}`,
    },
    inferenceProfile: {
      coreCompatibilityFingerprint:
        renderedProfile.coreCompatibilityFingerprint,
      profileId: sourceProfile.metadata.profileId,
      qualifiedProfileDigest: sourceProfile.activation.qualifiedProfileDigest,
      renderedProfileDigest: sha256(canonicalJson(renderedProfile)),
      revision: sourceProfile.metadata.revision,
    },
    network: {
      edgeGateway: "10.30.0.1",
      gateway: "10.10.0.1",
      inference: "10.20.0.2",
      prometheus: "10.30.0.1",
      vm103: "10.30.0.3",
    },
    paths: {
      admission: admissionRoot,
      compose: composePath,
      configuration: configurationRoot,
      secret: secretRoot,
      source: sourceRoot,
    },
    ports: {
      alertmanager: 19093,
      bff: 44294,
      edge: 22443,
      grafana: 36257,
      keycloak: 40239,
      litellm: 39218,
      prometheus: 19090,
      sglang: 30005,
      web: 34954,
    },
  }
  await renderVm103FounderCandidate(placement, configurationRoot, {
    now,
    renderedProfile,
    sourceProfile,
  })
  await writeFile(
    join(configurationRoot, "runtime-import.env"),
    [
      "ADMIN_PROMETHEUS_BASE_URL=http://10.30.0.1:19090",
      "FIRECRAWL_APPLIANCE_KILL_SWITCH=false",
      "FIRECRAWL_EGRESS_ALLOWED_HOSTS=public.example",
      "FIRECRAWL_EGRESS_ALLOWLIST_DIR=/etc/llmm/firecrawl",
      "FIRECRAWL_EGRESS_POLICY_READY=true",
      "FIRECRAWL_INSTALLED=true",
      "FIRECRAWL_RESOURCE_PROFILE_QUALIFIED=true",
      "TEAM_ALLOWED_EMAIL_DOMAINS=example.test",
      "",
    ].join("\n"),
    { mode: 0o600 },
  )
  for (const name of [
    "edge-ca.crt",
    "edge.crt",
    "edge.key",
    "session-keyring.json",
  ]) {
    await writeFile(join(configurationRoot, name), "private fixture\n", {
      mode: 0o600,
    })
  }
  await mkdir(join(configurationRoot, "non-restorable-isolation"), {
    mode: 0o700,
  })
  for (const name of secretFiles) {
    await writeFile(join(secretRoot, name), "unread fixture value\n", {
      mode: 0o600,
    })
  }
  const profilePath = join(
    admissionRoot,
    `${sourceProfile.metadata.profileId}.json`,
  )
  await writeFile(profilePath, `${canonicalJson(renderedProfile)}\n`, {
    mode: 0o600,
  })
  const manifestBytes = await readFile(
    join(configurationRoot, "rendered-config-manifest.json"),
  )
  const expectedManifestDigest = `sha256:${createHash("sha256")
    .update(manifestBytes)
    .digest("hex")}`
  const runtimeBindingManifestBytes = await readFile(
    join(configurationRoot, "litellm-runtime-binding-manifest.json"),
  )
  const expectedRuntimeBindingManifestDigest = `sha256:${createHash("sha256")
    .update(runtimeBindingManifestBytes)
    .digest("hex")}`
  return {
    admissionRoot,
    composePath,
    configurationRoot,
    expectedCommit: placement.source.commit,
    expectedManifestDigest,
    expectedRuntimeBindingManifestDigest,
    expectedTree: placement.source.tree,
    expectedUid,
    now,
    profilePath,
    root,
    secretRoot,
    sourceRoot,
    verify(overrides = {}) {
      return verifyFounderRuntimeCustody({
        admissionRoot,
        composePath,
        configurationRoot,
        expectedCommit: placement.source.commit,
        expectedManifestDigest,
        expectedRuntimeBindingManifestDigest,
        expectedTree: placement.source.tree,
        expectedUid,
        now,
        secretRoot,
        sourceRoot,
        ...overrides,
      })
    },
  }
}

test("verifies every external founder runtime input without returning secret values", async () => {
  const fixture = await createFixture()
  try {
    const result = fixture.verify()
    assert.equal(result.state, "exact-runtime-custody")
    assert.equal(result.admission.profileId, "synthetic-single-node")
    assert.match(result.runtimeImport.sha256, /^sha256:[0-9a-f]{64}$/)
    assert.match(result.composeDigest, /^sha256:[0-9a-f]{64}$/)
    assert.equal(result.liteLlmRoute.modelAlias, "synthetic-model-a")
    assert.match(
      result.liteLlmRoute.runtimeBindingDigest,
      /^sha256:[0-9a-f]{64}$/,
    )
    assert.deepEqual(
      result.externalPrivateFiles.map(({ mode }) => mode),
      Array(result.externalPrivateFiles.length).fill("0600"),
    )
    const serialized = JSON.stringify(result)
    assert.doesNotMatch(serialized, /unread fixture value|private fixture/)
    assert.doesNotMatch(serialized, /database-url=/)
  } finally {
    await rm(fixture.root, { force: true, recursive: true })
  }
})

test("keeps the exact self-contained systemd custody blob root-only", async () => {
  const fixture = await createFixture()
  try {
    const script = await readFile(
      new URL("./verify-vm103-founder-runtime-custody.mjs", import.meta.url),
    )
    const invocation = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-",
        fixture.configurationRoot,
        fixture.secretRoot,
        fixture.admissionRoot,
        fixture.sourceRoot,
        fixture.composePath,
        fixture.expectedManifestDigest,
        fixture.expectedRuntimeBindingManifestDigest,
        fixture.expectedCommit,
        fixture.expectedTree,
      ],
      { encoding: "utf8", input: script },
    )
    if (expectedUid === 0) {
      assert.equal(invocation.status, 0)
      const result = JSON.parse(invocation.stdout)
      assert.equal(result.state, "exact-runtime-custody")
      assert.doesNotMatch(JSON.stringify(result), /unread fixture value/)
    } else {
      assert.notEqual(invocation.status, 0)
      assert.match(invocation.stderr, /runtime custody is invalid/)
    }
  } finally {
    await rm(fixture.root, { force: true, recursive: true })
  }
})

test("keeps custody capture and startup verification on one runtime-import allowlist", () => {
  assert.deepEqual(
    founderRuntimeImportAllowedNames,
    captureRuntimeImportAllowedNames,
  )
})

test("rejects unknown, secret-like, duplicate, unsorted, and unsafe runtime imports", async () => {
  for (const value of [
    "UNAPPROVED_SETTING=value\n",
    "DATABASE_URL=forbidden\n",
    "TEAM_ALLOWED_EMAIL_DOMAINS=example.test\nADMIN_PROMETHEUS_BASE_URL=http://10.30.0.1:19090\n",
    "FIRECRAWL_INSTALLED=true\nFIRECRAWL_INSTALLED=false\n",
    "ADMIN_PROMETHEUS_BASE_URL=http://user:password@10.30.0.1:19090\n",
    "ADMIN_PROMETHEUS_BASE_URL=http://10.30.0.1/$HOST\n",
    "FIRECRAWL_PUBLIC_BASE_URL=http://firecrawl.lab.example\n",
  ]) {
    const fixture = await createFixture()
    try {
      await writeFile(
        join(fixture.configurationRoot, "runtime-import.env"),
        value,
        {
          mode: 0o600,
        },
      )
      assert.throws(fixture.verify, /runtime custody is invalid/)
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  }
})

test("rejects Compose interpolation characters during custody capture", () => {
  assert.throws(
    () =>
      parseRuntimeSecretMaterial(
        Buffer.from(
          "BFF_SERVICE_API_KEY=value\0DATABASE_URL=value\0CONSOLE_SESSION_KEYRING_FILE=/run/session.json\0NODE_EXTRA_CA_CERTS=/run/ca.crt\0ADMIN_PROMETHEUS_BASE_URL=http://10.30.0.1/$HOST",
        ),
      ),
    /unsafe ADMIN_PROMETHEUS_BASE_URL/,
  )
})

test("accepts the capture contract's canonical empty credential-free import", async () => {
  const fixture = await createFixture()
  try {
    await writeFile(
      join(fixture.configurationRoot, "runtime-import.env"),
      "\n",
      {
        mode: 0o600,
      },
    )
    assert.deepEqual(fixture.verify().runtimeImport.names, [])
  } finally {
    await rm(fixture.root, { force: true, recursive: true })
  }
})

test("rejects private-file mode, ownership, and symlink substitutions", async () => {
  const fixture = await createFixture()
  try {
    const secret = join(fixture.secretRoot, "bff-service-api-key")
    await chmod(secret, 0o640)
    assert.throws(fixture.verify, /runtime custody is invalid/)
    await chmod(secret, 0o4600)
    assert.throws(fixture.verify, /runtime custody is invalid/)
    await chmod(secret, 0o600)
    assert.throws(
      () => fixture.verify({ expectedUid: expectedUid + 1 }),
      /runtime custody is invalid/,
    )
    const key = join(fixture.configurationRoot, "edge.key")
    await unlink(key)
    await symlink(join(fixture.configurationRoot, "edge.crt"), key)
    assert.throws(fixture.verify, /runtime custody is invalid/)
  } finally {
    await rm(fixture.root, { force: true, recursive: true })
  }
})

test("rejects profile drift, stale measurement, extra admission files, and symlinks", async () => {
  const fixture = await createFixture()
  try {
    const profile = JSON.parse(await readFile(fixture.profilePath, "utf8"))
    profile.qualification.qualifiedProfileDigest = `sha256:${"0".repeat(64)}`
    await writeFile(fixture.profilePath, `${canonicalJson(profile)}\n`, {
      mode: 0o600,
    })
    assert.throws(fixture.verify, /runtime custody is invalid/)
  } finally {
    await rm(fixture.root, { force: true, recursive: true })
  }

  const stale = await createFixture()
  try {
    const profile = JSON.parse(await readFile(stale.profilePath, "utf8"))
    profile.capabilityAdvertisement.freshness.validUntil =
      "2026-08-25T11:59:59.000Z"
    await writeFile(stale.profilePath, `${canonicalJson(profile)}\n`, {
      mode: 0o600,
    })
    assert.throws(stale.verify, /runtime custody is invalid/)
  } finally {
    await rm(stale.root, { force: true, recursive: true })
  }

  const extra = await createFixture()
  try {
    await writeFile(join(extra.admissionRoot, "extra.json"), "{}\n", {
      mode: 0o600,
    })
    assert.throws(extra.verify, /runtime custody is invalid/)
  } finally {
    await rm(extra.root, { force: true, recursive: true })
  }

  const linked = await createFixture()
  try {
    const target = join(linked.root, "profile-copy.json")
    await writeFile(target, await readFile(linked.profilePath), { mode: 0o600 })
    await unlink(linked.profilePath)
    await symlink(target, linked.profilePath)
    assert.throws(linked.verify, /runtime custody is invalid/)
  } finally {
    await rm(linked.root, { force: true, recursive: true })
  }
})

test("rejects manifest, placement, Compose mount, and source-mount drift", async () => {
  const manifest = await createFixture()
  try {
    assert.throws(
      () =>
        manifest.verify({
          expectedManifestDigest: `sha256:${"0".repeat(64)}`,
        }),
      /runtime custody is invalid/,
    )
  } finally {
    await rm(manifest.root, { force: true, recursive: true })
  }

  const compose = await createFixture()
  try {
    const source = await readFile(compose.composePath, "utf8")
    await writeFile(
      compose.composePath,
      source.replace(
        "${LLMM_CONFIGURATION_ROOT}/edge.key:/run/secrets/llmm_edge_tls_private_key:ro",
        "${LLMM_CONFIGURATION_ROOT}/edge.key:/run/secrets/llmm_edge_tls_private_key",
      ),
      { mode: 0o644 },
    )
    assert.throws(compose.verify, /runtime custody is invalid/)
  } finally {
    await rm(compose.root, { force: true, recursive: true })
  }

  const sourceMount = await createFixture()
  try {
    await unlink(join(sourceMount.sourceRoot, sourceMountFiles[0]))
    assert.throws(sourceMount.verify, /runtime custody is invalid/)
  } finally {
    await rm(sourceMount.root, { force: true, recursive: true })
  }

  for (const variable of [
    "${LLMM_UNVERIFIED_INPUT}",
    "${OTHER}",
    "$OTHER",
    "$LLMM_UNVERIFIED_INPUT",
  ]) {
    const undeclaredComposeVariable = await createFixture()
    try {
      const source = await readFile(
        undeclaredComposeVariable.composePath,
        "utf8",
      )
      await writeFile(
        undeclaredComposeVariable.composePath,
        `${source}\n# ${variable}\n`,
        { mode: 0o644 },
      )
      assert.throws(
        undeclaredComposeVariable.verify,
        /runtime custody is invalid/,
      )
    } finally {
      await rm(undeclaredComposeVariable.root, {
        force: true,
        recursive: true,
      })
    }
  }
})

test("rejects runtime-binding drift and group-writable source directories", async () => {
  const route = await createFixture()
  try {
    await writeFile(
      join(route.configurationRoot, "litellm-inference-route.yaml"),
      "model_list: []\n",
      { mode: 0o600 },
    )
    assert.throws(route.verify, /runtime custody is invalid/)
  } finally {
    await rm(route.root, { force: true, recursive: true })
  }

  const manifest = await createFixture()
  try {
    assert.throws(
      () =>
        manifest.verify({
          expectedRuntimeBindingManifestDigest: `sha256:${"0".repeat(64)}`,
        }),
      /runtime custody is invalid/,
    )
  } finally {
    await rm(manifest.root, { force: true, recursive: true })
  }

  const writable = await createFixture()
  try {
    await chmod(join(writable.sourceRoot, "infra/ingress"), 0o775)
    assert.throws(writable.verify, /runtime custody is invalid/)
  } finally {
    await rm(writable.root, { force: true, recursive: true })
  }
})
