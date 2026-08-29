import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import "../pre-genesis/manage-vm103-inference-route.test.mjs"
import "../pre-genesis/manage-vm103-gateway-route.test.mjs"
import "../pre-genesis/render-vm103-litellm-route.test.mjs"
import "../pre-genesis/verify-vm103-founder-runtime-custody.test.mjs"
import "../pre-genesis/verify-vm103-litellm-route-runtime.test.mjs"

import { renderDeliveryProfile } from "../../infra/inference/render-profile.mjs"
import {
  canonicalJson,
  coreCompatibilityFingerprint,
  loadContracts,
  profileQualificationDigest,
  sha256,
} from "../../infra/inference/validate-profile.mjs"
import {
  parseKeycloakControlSecretMaterial,
  parseLiteLlmSecretMaterial,
  parseRuntimeSecretMaterial,
  processNamespacePath,
  validateLiteLlmOidcBinding,
} from "../pre-genesis/capture-vm103-founder-custody.mjs"
import {
  inspectFounderFirewall,
  reconcileFounderFirewall,
} from "../pre-genesis/manage-vm103-founder-firewall.mjs"
import { renderVm103FounderCandidate } from "../pre-genesis/render-vm103-founder-candidate.mjs"
import { vm103CoreCompatibilityFingerprint } from "../pre-genesis/render-vm103-litellm-route.mjs"
import {
  validateApplicationJwks,
  validateApplicationTokenClaims,
} from "../pre-genesis/verify-vm103-application-identity.mjs"
import { verifyFounderRenderedConfiguration } from "../pre-genesis/verify-vm103-founder-config.mjs"
import { validateFounderImageInspections } from "../pre-genesis/verify-vm103-founder-images.mjs"
import { verifyFounderSourceCheckout } from "../pre-genesis/verify-vm103-founder-source.mjs"

const digest = `sha256:${"a".repeat(64)}`

test("founder LiteLLM route is pinned to the current canonical Core contract", () => {
  assert.equal(
    vm103CoreCompatibilityFingerprint,
    coreCompatibilityFingerprint(loadContracts().core),
  )
})

function placement() {
  const documents = inferenceDocuments()
  return {
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
      bff: digest,
      edge: `nginx@${digest}`,
      web: digest,
    },
    inferenceProfile: {
      coreCompatibilityFingerprint:
        documents.renderedProfile.coreCompatibilityFingerprint,
      profileId: documents.sourceProfile.metadata.profileId,
      qualifiedProfileDigest:
        documents.sourceProfile.activation.qualifiedProfileDigest,
      renderedProfileDigest: sha256(canonicalJson(documents.renderedProfile)),
      revision: documents.sourceProfile.metadata.revision,
    },
    network: {
      edgeGateway: "10.30.0.1",
      gateway: "10.10.0.1",
      inference: "10.20.0.2",
      prometheus: "10.30.0.1",
      vm103: "10.30.0.3",
    },
    paths: {
      admission: "/etc/llmm/admission",
      compose:
        "/opt/llmm/source/infra/deployment/vm103-founder-candidate.compose.yaml",
      configuration: "/etc/llmm/configuration",
      secret: "/etc/llmm/secrets",
      source: "/opt/llmm/source",
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
}

function inferenceDocuments() {
  const sourceProfile = JSON.parse(
    readFileSync(
      new URL(
        "../../infra/inference/fixtures/synthetic-single-node.json",
        import.meta.url,
      ),
      "utf8",
    ),
  )
  sourceProfile.metadata.admissionScope = "INTERNAL_TEST_ONLY"
  sourceProfile.metadata.lifecycleState = "ACTIVE_MEASURED_INTERNAL_TEST"
  sourceProfile.accelerator.productionSupportClaim = false
  sourceProfile.engine.image.sbomDigest = null
  sourceProfile.engine.image.provenanceDigest = null
  sourceProfile.network.port = 30_005
  sourceProfile.capacity = {
    effectiveContextTokens: sourceProfile.limits.configuredContextTokens,
    engineImageDigest: sourceProfile.engine.image.digest,
    evidenceDigest: `sha256:${"4".repeat(64)}`,
    maxConcurrentRequests: 1,
    maxOutputTokens: sourceProfile.limits.maxOutputTokens,
    measuredAt: "2026-08-24T17:08:51.086Z",
    modelArtifactDigest: sourceProfile.model.artifactDigest,
    p95LatencyMilliseconds: 125,
    profileRevision: sourceProfile.metadata.revision,
    queue: { maxObservedDepth: 0, state: "measured" },
    state: "MEASURED",
    throughputTokensPerSecond: 12.5,
    validUntil: "2026-09-23T17:08:51.086Z",
  }
  sourceProfile.activation.state = "ACTIVE_INTERNAL_TEST"
  sourceProfile.activation.qualifiedProfileDigest =
    profileQualificationDigest(sourceProfile)
  return {
    now: new Date("2026-08-25T12:00:00.000Z"),
    renderedProfile: renderDeliveryProfile(sourceProfile, loadContracts()),
    sourceProfile,
  }
}

test("founder placement renders exact edge, supervision, and private inference contracts", async () => {
  const root = join(
    tmpdir(),
    `llmm-founder-render-${process.pid}-${Date.now()}`,
  )
  try {
    const documents = inferenceDocuments()
    const first = await renderVm103FounderCandidate(
      placement(),
      root,
      documents,
    )
    const edge = await readFile(join(root, "product-edge.nginx.conf"), "utf8")
    const firewall = await readFile(
      join(root, "inference-firewall.nft"),
      "utf8",
    )
    const gateway = await readFile(
      join(root, "gateway-inference-route.service"),
      "utf8",
    )
    const renderedGatewayRouteManager = await readFile(
      join(root, "manage-vm103-gateway-route.mjs"),
      "utf8",
    )
    const inferenceUnit = await readFile(
      join(root, "inference-private-route.service"),
      "utf8",
    )
    const renderedInferenceRouteManager = await readFile(
      join(root, "manage-vm103-inference-route.mjs"),
      "utf8",
    )
    const liteLlmRoute = await readFile(
      join(root, "litellm-inference-route.yaml"),
      "utf8",
    )
    const liteLlmReceipt = JSON.parse(
      await readFile(join(root, "litellm-route-receipt.json"), "utf8"),
    )
    const runtimeBindingManifest = JSON.parse(
      await readFile(
        join(root, "litellm-runtime-binding-manifest.json"),
        "utf8",
      ),
    )
    const bffEnvironment = await readFile(join(root, "bff.env"), "utf8")
    const webEnvironment = await readFile(join(root, "web.env"), "utf8")
    const vm103 = await readFile(
      join(root, "llmm-founder-candidate.service"),
      "utf8",
    )
    const imageBindings = JSON.parse(
      await readFile(join(root, "image-bindings.json"), "utf8"),
    )
    const placementEnvironment = await readFile(
      join(root, "placement.env"),
      "utf8",
    )
    const renderedConfigurationManifest = await readFile(
      join(root, "rendered-config-manifest.json"),
    )
    const vm103Firewall = await readFile(
      join(root, "llmm-founder-edge-firewall.service"),
      "utf8",
    )
    assert.equal(first.internalTestOnly, true)
    assert.equal(first.productionAcceptance, false)
    assert.equal(first.runtimeQualification, false)
    assert.equal(first.portainerAdmitted, false)
    assert.match(edge, /server 127\.0\.0\.1:34954;/)
    assert.match(edge, /server 127\.0\.0\.1:44294;/)
    assert.match(edge, /listen 22443 ssl;/)
    assert.doesNotMatch(edge, /@@|console-web:3000|console-bff:4001/)
    assert.match(firewall, /ip saddr 10\.30\.0\.3 tcp dport 30005 accept/)
    assert.match(firewall, /tcp dport 30005 drop/)
    assert.doesNotMatch(gateway, /iptables|\/bin\/sh|route replace/)
    assert.equal(
      renderedGatewayRouteManager,
      readFileSync(
        new URL(
          "../pre-genesis/manage-vm103-gateway-route.mjs",
          import.meta.url,
        ),
        "utf8",
      ),
    )
    const renderedGatewayRouteManagerDigest = `sha256:${createHash("sha256")
      .update(renderedGatewayRouteManager)
      .digest("hex")}`
    assert.deepEqual(gateway.match(/^ExecStart=(.+)$/m)?.[1].split(" "), [
      "/opt/node-v22.23.2/bin/node",
      "/etc/llm-machines/manage-vm103-gateway-route.mjs",
      "apply",
      renderedGatewayRouteManagerDigest,
      "10.30.0.3",
      "10.20.0.2",
      "30005",
    ])
    assert.deepEqual(gateway.match(/^ExecStop=(.+)$/m)?.[1].split(" "), [
      "/opt/node-v22.23.2/bin/node",
      "/etc/llm-machines/manage-vm103-gateway-route.mjs",
      "remove",
      renderedGatewayRouteManagerDigest,
      "10.30.0.3",
      "10.20.0.2",
      "30005",
    ])
    assert.match(
      gateway,
      new RegExp(
        `manage-vm103-gateway-route\\.mjs apply ${renderedGatewayRouteManagerDigest} 10\\.30\\.0\\.3 10\\.20\\.0\\.2 30005`,
      ),
    )
    assert.match(
      gateway,
      new RegExp(
        `manage-vm103-gateway-route\\.mjs remove ${renderedGatewayRouteManagerDigest} 10\\.30\\.0\\.3 10\\.20\\.0\\.2 30005`,
      ),
    )
    assert.match(
      inferenceUnit,
      /\/etc\/llm-machines\/manage-vm103-inference-route\.mjs apply/,
    )
    assert.match(
      inferenceUnit,
      /\/etc\/llm-machines\/manage-vm103-inference-route\.mjs remove/,
    )
    assert.doesNotMatch(inferenceUnit, /ip route (?:replace|del)/)
    assert.equal(
      renderedInferenceRouteManager,
      readFileSync(
        new URL(
          "../pre-genesis/manage-vm103-inference-route.mjs",
          import.meta.url,
        ),
        "utf8",
      ),
    )
    const renderedInferenceRouteManagerDigest = `sha256:${createHash("sha256")
      .update(renderedInferenceRouteManager)
      .digest("hex")}`
    assert.deepEqual(inferenceUnit.match(/^ExecStart=(.+)$/m)?.[1].split(" "), [
      "/opt/node-v22.23.2/bin/node",
      "/etc/llm-machines/manage-vm103-inference-route.mjs",
      "apply",
      renderedInferenceRouteManagerDigest,
      "10.30.0.3",
      "10.10.0.1",
      "eno1",
      "10.30.0.3",
      "30005",
      "/etc/llm-machines/inference-firewall.nft",
    ])
    assert.deepEqual(inferenceUnit.match(/^ExecStop=(.+)$/m)?.[1].split(" "), [
      "/opt/node-v22.23.2/bin/node",
      "/etc/llm-machines/manage-vm103-inference-route.mjs",
      "remove",
      renderedInferenceRouteManagerDigest,
      "10.30.0.3",
      "10.10.0.1",
      "eno1",
      "10.30.0.3",
      "30005",
      "/etc/llm-machines/inference-firewall.nft",
    ])
    assert.match(
      inferenceUnit,
      new RegExp(
        `manage-vm103-inference-route\\.mjs apply ${renderedInferenceRouteManagerDigest}`,
      ),
    )
    assert.match(
      inferenceUnit,
      new RegExp(
        `manage-vm103-inference-route\\.mjs remove ${renderedInferenceRouteManagerDigest}`,
      ),
    )
    assert.match(
      liteLlmRoute,
      new RegExp(
        `model_name: ${documents.renderedProfile.capabilityAdvertisement.models[0].alias}`,
      ),
    )
    assert.equal(
      liteLlmReceipt.configDigest,
      `sha256:${createHash("sha256").update(liteLlmRoute).digest("hex")}`,
    )
    assert.equal(
      runtimeBindingManifest.renderedConfigurationManifestDigest,
      `sha256:${createHash("sha256")
        .update(renderedConfigurationManifest)
        .digest("hex")}`,
    )
    assert.match(
      bffEnvironment,
      /KEYCLOAK_ISSUER_URL=https:\/\/identity\.lab\.example\/realms\/llm-machines/,
    )
    assert.match(
      bffEnvironment,
      /ADMIN_LITELLM_BASE_URL=http:\/\/127\.0\.0\.1:39218/,
    )
    assert.match(
      bffEnvironment,
      /ADMIN_ALERTMANAGER_BASE_URL=http:\/\/10\.30\.0\.1:19093/,
    )
    assert.match(
      bffEnvironment,
      /ADMIN_PROMETHEUS_BASE_URL=http:\/\/10\.30\.0\.1:19090/,
    )
    assert.match(
      bffEnvironment,
      /KEYCLOAK_ADMIN_BASE_URL=http:\/\/127\.0\.0\.1:40239/,
    )
    assert.match(bffEnvironment, /NODE_ENV=production/)
    assert.doesNotMatch(
      bffEnvironment,
      /BFF_FALLBACK_MODELS|BFF_FIXTURE_MODE|CONNECTED_APPS_KEYCLOAK_FIXTURE|fixture-model/,
    )
    assert.doesNotMatch(
      bffEnvironment,
      /identity\.lab\.example\/keycloak\/realms/,
    )
    assert.match(webEnvironment, /PRODUCT_GRAFANA_HOST=grafana\.lab\.example/)
    assert.match(webEnvironment, /PRODUCT_LITELLM_HOST=litellm\.lab\.example/)
    assert.match(
      webEnvironment,
      /PRODUCT_KEYCLOAK_ADMIN_HOST=keycloak\.lab\.example/,
    )
    assert.match(vm103, /docker compose .* up --detach --wait/)
    const cleanCompose =
      "/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/docker compose"
    assert.match(vm103, new RegExp(`ExecStart=${cleanCompose}`))
    assert.match(vm103, new RegExp(`ExecStop=${cleanCompose}`))
    assert.doesNotMatch(vm103, /^ExecReload=/m)
    assert.doesNotMatch(vm103, /^Exec(?:Start|Reload|Stop)=\/usr\/bin\/docker/m)
    assert.match(vm103, /verify-vm103-founder-images\.mjs/)
    assert.match(
      vm103,
      new RegExp(
        `--no-replace-objects -c safe\\.directory=/opt/llmm/source -C /opt/llmm/source cat-file blob ${"b".repeat(40)}:scripts/pre-genesis/verify-vm103-founder-source\\.mjs \\| /opt/node-v22\\.23\\.2/bin/node --input-type=module - /opt/llmm/source ${"b".repeat(40)} ${"c".repeat(40)}`,
      ),
    )
    assert.doesNotMatch(
      vm103,
      /node \/opt\/llmm\/source\/scripts\/pre-genesis\/verify-vm103-founder-source\.mjs/,
    )
    assert.match(
      vm103,
      new RegExp(
        `cat-file blob ${"b".repeat(40)}:scripts/pre-genesis/verify-vm103-founder-config\\.mjs`,
      ),
    )
    assert.match(
      vm103,
      new RegExp(
        `cat-file blob ${"b".repeat(40)}:scripts/pre-genesis/verify-vm103-founder-runtime-custody\\.mjs`,
      ),
    )
    assert.match(
      vm103,
      new RegExp(
        `cat-file blob ${"b".repeat(40)}:scripts/pre-genesis/verify-vm103-litellm-route-runtime\\.mjs`,
      ),
    )
    assert.match(vm103, /verify-vm103-application-identity\.mjs/)
    assert.match(
      vm103,
      /http:\/\/127\.0\.0\.1:40239 https:\/\/identity\.lab\.example\/realms\/llm-machines-applications llm-machines-applications console-application-admin/,
    )
    assert.deepEqual(imageBindings, {
      images: { bff: digest, web: digest },
      schema: "llm-machines.vm103-founder-images.v1",
      source: { commit: "b".repeat(40), tree: "c".repeat(40) },
    })
    assert.equal(
      placementEnvironment,
      [
        `LLMM_BFF_IMAGE=${digest}`,
        "LLMM_CONFIGURATION_ROOT=/etc/llmm/configuration",
        `LLMM_EDGE_IMAGE=nginx@${digest}`,
        `LLMM_INFERENCE_CORE_COMPATIBILITY_FINGERPRINT=${documents.renderedProfile.coreCompatibilityFingerprint}`,
        "LLMM_INFERENCE_HOST=10.20.0.2",
        "LLMM_INFERENCE_MODEL_ADMISSION_DIR=/etc/llmm/admission",
        `LLMM_INFERENCE_PROFILE_FILE=${documents.sourceProfile.metadata.profileId}.json`,
        `LLMM_INFERENCE_PROFILE_ID=${documents.sourceProfile.metadata.profileId}`,
        `LLMM_INFERENCE_PROFILE_REVISION=${documents.sourceProfile.metadata.revision}`,
        `LLMM_INFERENCE_QUALIFIED_PROFILE_DIGEST=${documents.sourceProfile.activation.qualifiedProfileDigest}`,
        `LLMM_INFERENCE_RENDERED_PROFILE_DIGEST=${sha256(canonicalJson(documents.renderedProfile))}`,
        "LLMM_SECRET_ROOT=/etc/llmm/secrets",
        "LLMM_SOURCE_ROOT=/opt/llmm/source",
        `LLMM_WEB_IMAGE=${digest}`,
        "",
      ].join("\n"),
    )
    const renderedManifestDigest = `sha256:${createHash("sha256")
      .update(renderedConfigurationManifest)
      .digest("hex")}`
    assert.match(vm103, new RegExp(renderedManifestDigest))
    const canonicalRoot = await realpath(root)
    assert.deepEqual(
      verifyFounderRenderedConfiguration(
        canonicalRoot,
        join(canonicalRoot, "rendered-config-manifest.json"),
        renderedManifestDigest,
        "b".repeat(40),
        "c".repeat(40),
      ),
      {
        manifestDigest: renderedManifestDigest,
        source: { commit: "b".repeat(40), tree: "c".repeat(40) },
        state: "exact-rendered-configuration",
      },
    )
    assert.match(
      vm103,
      /Requires=docker\.service llmm-founder-edge-firewall\.service/,
    )
    assert.match(vm103Firewall, /apply 10\.30\.0\.1 22443/)
    assert.match(vm103Firewall, /remove 10\.30\.0\.1 22443/)
    assert.match(vm103Firewall, /\/opt\/node-v22\.23\.2\/bin\/node/)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("founder firewall integrates one owned allow into the admitted default-drop chain", () => {
  const exact = founderFirewallDocument({ owned: true })
  assert.deepEqual(inspectFounderFirewall(exact, "10.30.0.1", 22443), {
    handle: 42,
    state: "exact",
  })
  assert.deepEqual(
    inspectFounderFirewall(founderFirewallDocument(), "10.30.0.1", 22443),
    {
      state: "absent",
    },
  )
  assert.throws(
    () =>
      inspectFounderFirewall(
        founderFirewallDocument({ gateway: "10.30.0.2", owned: true }),
        "10.30.0.1",
        22443,
      ),
    /collides/,
  )
  assert.throws(
    () =>
      inspectFounderFirewall(
        founderFirewallDocument({ foreignPort: { range: [22_000, 23_000] } }),
        "10.30.0.1",
        22443,
      ),
    /collides/,
  )
  assert.throws(
    () =>
      inspectFounderFirewall(
        founderFirewallDocument({ foreignPort: "@candidate_ports" }),
        "10.30.0.1",
        22443,
      ),
    /collides/,
  )
  assert.throws(
    () =>
      inspectFounderFirewall(
        founderFirewallDocument({ foreignPort: 22443 }),
        "10.30.0.1",
        22443,
      ),
    /collides/,
  )
  assert.throws(
    () =>
      inspectFounderFirewall(
        founderFirewallDocument({ foreignPort: { set: [22, 22443] } }),
        "10.30.0.1",
        22443,
      ),
    /collides/,
  )
  assert.throws(
    () =>
      inspectFounderFirewall(
        founderFirewallDocument({ policy: "accept" }),
        "10.30.0.1",
        22443,
      ),
    /base-chain contract/,
  )
})

test("founder firewall removes its exact rule when post-apply inspection fails", () => {
  const commands = []
  const ownedStates = [{ handle: 42, state: "exact" }, { state: "absent" }]
  let strictCalls = 0
  assert.throws(
    () =>
      reconcileFounderFirewall("apply", "10.30.0.1", 22443, {
        execute: (command) => commands.push(command),
        inspectOwned: () => ownedStates.shift(),
        inspectStrict: () => {
          strictCalls += 1
          if (strictCalls === 1) return { state: "absent" }
          throw new Error("Founder firewall port collides with another rule.")
        },
      }),
    /collides/,
  )
  assert.equal(commands.length, 2)
  assert.equal(commands[0][0], "add")
  assert.deepEqual(commands[1].slice(-2), ["handle", "42"])
  assert.equal(ownedStates.length, 0)
})

test("founder firewall removes its exact rule while preserving a later foreign collision", () => {
  const commands = []
  const result = reconcileFounderFirewall("remove", "10.30.0.1", 22443, {
    execute: (command) => commands.push(command),
    inspectOwned: () => ({ handle: 42, state: "exact" }),
    inspectStrict: (_gateway, _port, options) => {
      assert.deepEqual(options, { permitForeignPortRules: true })
      return { state: "absent" }
    },
  })
  assert.deepEqual(result, { state: "absent" })
  assert.deepEqual(commands[0].slice(-2), ["handle", "42"])
})

function founderFirewallDocument({
  foreignPort,
  gateway = "10.30.0.1",
  owned = false,
  policy = "drop",
} = {}) {
  const nftables = [
    { metainfo: { json_schema_version: 1 } },
    {
      chain: {
        family: "inet",
        hook: "input",
        name: "input",
        policy,
        prio: -10,
        table: "llmm_filter",
        type: "filter",
      },
    },
  ]
  if (owned) {
    nftables.push({
      rule: {
        chain: "input",
        comment: "llmm-founder-candidate-edge-allow",
        expr: [
          {
            match: {
              left: { meta: { key: "iifname" } },
              op: "==",
              right: "ens18",
            },
          },
          {
            match: {
              left: { payload: { field: "saddr", protocol: "ip" } },
              op: "==",
              right: gateway,
            },
          },
          {
            match: {
              left: { payload: { field: "dport", protocol: "tcp" } },
              op: "==",
              right: 22443,
            },
          },
          { accept: null },
        ],
        family: "inet",
        handle: 42,
        table: "llmm_filter",
      },
    })
  }
  if (foreignPort) {
    nftables.push({
      rule: {
        chain: "input",
        expr: [
          {
            match: {
              left: { payload: { field: "dport", protocol: "tcp" } },
              op: "==",
              right: foreignPort,
            },
          },
          { accept: null },
        ],
        family: "inet",
        handle: 55,
        table: "llmm_filter",
      },
    })
  }
  return { nftables }
}

test("founder Web and BFF image IDs must carry the exact source labels", () => {
  const binding = {
    images: { bff: digest, web: digest },
    schema: "llm-machines.vm103-founder-images.v1",
    source: { commit: "b".repeat(40), tree: "c".repeat(40) },
  }
  const inspected = Object.fromEntries(
    ["bff", "web"].map((name) => [
      name,
      {
        Config: {
          Labels: {
            "com.llm-machines.source.tree": "c".repeat(40),
            "org.opencontainers.image.revision": "b".repeat(40),
          },
        },
        Id: digest,
      },
    ]),
  )
  assert.deepEqual(validateFounderImageInspections(binding, inspected), {
    state: "exact",
  })
  inspected.web.Config.Labels["org.opencontainers.image.revision"] = "d".repeat(
    40,
  )
  assert.throws(
    () => validateFounderImageInspections(binding, inspected),
    /source binding is invalid/,
  )
})

test("founder placement rejects mutable images, duplicate ports, and public network inputs", async () => {
  for (const mutate of [
    (value) => {
      value.images.web = "llmm/web:latest"
    },
    (value) => {
      value.ports.web = value.ports.bff
    },
    (value) => {
      value.network.inference = "203.0.113.8"
    },
    (value) => {
      value.network.prometheus = "203.0.113.9"
    },
    (value) => {
      value.paths.source = "/opt/llmm/source value"
    },
    (value) => {
      value.paths.secret = value.paths.configuration
    },
    (value) => {
      value.paths.compose = "/opt/llmm/source/alternate.compose.yaml"
    },
  ]) {
    const value = placement()
    mutate(value)
    await assert.rejects(
      renderVm103FounderCandidate(
        value,
        join(tmpdir(), `llmm-invalid-${Date.now()}`),
        inferenceDocuments(),
      ),
      /invalid/,
    )
  }
})

test("founder source checkout must match the exact clean commit and tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "llmm-founder-source-"))
  try {
    const checkoutRoot = await realpath(root)
    execFileSync("/usr/bin/git", ["init", "--quiet", root])
    execFileSync("/usr/bin/git", [
      "-C",
      root,
      "config",
      "user.email",
      "founder-test@example.invalid",
    ])
    execFileSync("/usr/bin/git", [
      "-C",
      root,
      "config",
      "user.name",
      "Founder Test",
    ])
    await writeFile(join(root, "tracked.txt"), "exact\n")
    await writeFile(
      join(root, "verify.mjs"),
      await readFile("scripts/pre-genesis/verify-vm103-founder-source.mjs"),
    )
    execFileSync("/usr/bin/git", [
      "-C",
      root,
      "add",
      "tracked.txt",
      "verify.mjs",
    ])
    execFileSync("/usr/bin/git", [
      "-C",
      root,
      "commit",
      "--quiet",
      "-m",
      "exact",
    ])
    const commit = execFileSync(
      "/usr/bin/git",
      ["-C", root, "rev-parse", "HEAD"],
      {
        encoding: "utf8",
      },
    ).trim()
    const tree = execFileSync(
      "/usr/bin/git",
      ["-C", root, "rev-parse", "HEAD^{tree}"],
      { encoding: "utf8" },
    ).trim()

    assert.deepEqual(verifyFounderSourceCheckout(checkoutRoot, commit, tree), {
      commit,
      state: "exact-clean-checkout",
      tree,
    })
    const exactBlobResult = execFileSync(
      "/bin/bash",
      [
        "-o",
        "pipefail",
        "-ec",
        `/usr/bin/git --no-replace-objects -c safe.directory=${checkoutRoot} -C ${checkoutRoot} cat-file blob ${commit}:verify.mjs | ${process.execPath} --input-type=module - ${checkoutRoot} ${commit} ${tree}`,
      ],
      { encoding: "utf8" },
    )
    assert.deepEqual(JSON.parse(exactBlobResult), {
      commit,
      state: "exact-clean-checkout",
      tree,
    })
    assert.throws(
      () => verifyFounderSourceCheckout(checkoutRoot, "d".repeat(40), tree),
      /source checkout binding is invalid/,
    )
    assert.throws(
      () => verifyFounderSourceCheckout(checkoutRoot, commit, "e".repeat(40)),
      /source checkout binding is invalid/,
    )

    await writeFile(join(root, "tracked.txt"), "dirty\n")
    assert.throws(
      () => verifyFounderSourceCheckout(checkoutRoot, commit, tree),
      /source checkout binding is invalid/,
    )
    execFileSync("/usr/bin/git", ["-C", root, "checkout", "--", "tracked.txt"])
    await writeFile(join(root, "untracked.txt"), "untracked\n")
    assert.throws(
      () => verifyFounderSourceCheckout(checkoutRoot, commit, tree),
      /source checkout binding is invalid/,
    )
    await rm(join(root, "untracked.txt"))

    execFileSync("/usr/bin/git", [
      "-C",
      root,
      "update-index",
      "--assume-unchanged",
      "tracked.txt",
    ])
    await writeFile(join(root, "tracked.txt"), "assume-unchanged bypass\n")
    assert.throws(
      () => verifyFounderSourceCheckout(checkoutRoot, commit, tree),
      /source checkout binding is invalid/,
    )
    execFileSync("/usr/bin/git", [
      "-C",
      root,
      "update-index",
      "--no-assume-unchanged",
      "tracked.txt",
    ])
    execFileSync("/usr/bin/git", ["-C", root, "checkout", "--", "tracked.txt"])

    execFileSync("/usr/bin/git", [
      "-C",
      root,
      "update-index",
      "--skip-worktree",
      "tracked.txt",
    ])
    assert.throws(
      () => verifyFounderSourceCheckout(checkoutRoot, commit, tree),
      /source checkout binding is invalid/,
    )
    execFileSync("/usr/bin/git", [
      "-C",
      root,
      "update-index",
      "--no-skip-worktree",
      "tracked.txt",
    ])
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("founder rendered configuration fails closed on config and manifest drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "llmm-founder-config-"))
  try {
    await renderVm103FounderCandidate(placement(), root, inferenceDocuments())
    const canonicalRoot = await realpath(root)
    const manifestPath = join(canonicalRoot, "rendered-config-manifest.json")
    const manifestBytes = await readFile(manifestPath)
    const manifestDigest = `sha256:${createHash("sha256")
      .update(manifestBytes)
      .digest("hex")}`
    const verify = () =>
      verifyFounderRenderedConfiguration(
        canonicalRoot,
        manifestPath,
        manifestDigest,
        "b".repeat(40),
        "c".repeat(40),
      )

    assert.equal(verify().state, "exact-rendered-configuration")
    await writeFile(join(root, "placement.env"), "LLMM_WEB_IMAGE=drift\n", {
      mode: 0o600,
    })
    assert.throws(verify, /rendered configuration binding is invalid/)

    await renderVm103FounderCandidate(placement(), root, inferenceDocuments())
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    manifest.artifacts[0].sha256 = `sha256:${"f".repeat(64)}`
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
    })
    assert.throws(verify, /rendered configuration binding is invalid/)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("founder placement rejects ports that disagree with fixed container listeners", async () => {
  for (const mutate of [
    (value) => {
      value.ports.web = 34955
    },
    (value) => {
      value.ports.prometheus = 19091
    },
    (value) => {
      value.ports.alertmanager = 19094
    },
  ]) {
    const value = placement()
    mutate(value)
    await assert.rejects(
      renderVm103FounderCandidate(
        value,
        join(tmpdir(), `llmm-invalid-fixed-port-${Date.now()}`),
        inferenceDocuments(),
      ),
      /founder candidate port contract/,
    )
  }
})

test("custody capture extracts only exact secret classes without logging values", () => {
  const material = parseRuntimeSecretMaterial(
    Buffer.from(
      [
        "BFF_SERVICE_API_KEY=bff-value",
        "CONSOLE_SESSION_KEYRING_FILE=/run/source/session.json",
        "DATABASE_URL=postgres-value",
        "NODE_EXTRA_CA_CERTS=/run/source/ca.crt",
        "ADMIN_PROMETHEUS_BASE_URL=http://127.0.0.1:9090",
        "UNRELATED_SECRET=must-not-copy",
      ].join("\0"),
    ),
  )
  assert.deepEqual(Object.keys(material.secrets).sort(), [
    "bff-service-api-key",
    "database-url",
  ])
  assert.doesNotMatch(
    JSON.stringify(Object.keys(material.secrets)),
    /UNRELATED/,
  )
  assert.deepEqual(material.nonSecrets, {
    ADMIN_PROMETHEUS_BASE_URL: "http://127.0.0.1:9090",
  })
  assert.deepEqual(
    parseLiteLlmSecretMaterial(
      Buffer.from(
        "LITELLM_MASTER_KEY=litellm-value\0GENERIC_CLIENT_ID=litellm-native\0GENERIC_CLIENT_SECRET=oidc-value\0UNRELATED_SECRET=must-not-copy",
      ),
    ),
    {
      oidcClientId: "litellm-native",
      oidcClientSecret: "oidc-value",
      secrets: { "litellm-key": "litellm-value" },
    },
  )
  assert.throws(
    () => parseLiteLlmSecretMaterial(Buffer.from("OTHER=value\0")),
    /missing LITELLM_MASTER_KEY/,
  )
  assert.deepEqual(
    parseKeycloakControlSecretMaterial(
      Buffer.from(
        JSON.stringify({
          credentials: {
            applicationAdmin: "app-value",
            humanAdmin: "human-value",
            liteLlm: "litellm-oidc-value",
            oidcClient: "oidc-value",
          },
        }),
      ),
    ),
    {
      "console-oidc-client-secret": "oidc-value",
      "keycloak-application-admin-client-secret": "app-value",
      "keycloak-admin-client-secret": "human-value",
      "litellm-oidc-client-secret": "litellm-oidc-value",
    },
  )
  validateLiteLlmOidcBinding(
    {
      oidcClientId: "litellm-native",
      oidcClientSecret: "litellm-oidc-value",
    },
    { "litellm-oidc-client-secret": "litellm-oidc-value" },
  )
  assert.throws(
    () =>
      validateLiteLlmOidcBinding(
        { oidcClientId: "litellm-native", oidcClientSecret: "stale-value" },
        { "litellm-oidc-client-secret": "current-value" },
      ),
    /does not match commissioned Keycloak custody/,
  )
  assert.throws(
    () =>
      validateLiteLlmOidcBinding(
        { oidcClientId: "other-client", oidcClientSecret: "current-value" },
        { "litellm-oidc-client-secret": "current-value" },
      ),
    /does not match commissioned Keycloak custody/,
  )
  assert.throws(
    () =>
      parseKeycloakControlSecretMaterial(
        Buffer.from(
          JSON.stringify({
            credentials: {
              applicationAdmin: "app-value",
              humanAdmin: "human-value",
              liteLlm: "litellm-oidc-value",
            },
          }),
        ),
      ),
    /missing credentials\.oidcClient/,
  )
  assert.equal(
    processNamespacePath(42, "/run/llm-machines/session-keyring.json"),
    "/proc/42/root/run/llm-machines/session-keyring.json",
  )
  assert.throws(
    () => processNamespacePath(42, "run/llm-machines/session-keyring.json"),
    /process path is invalid/,
  )
  assert.throws(
    () =>
      parseKeycloakControlSecretMaterial(
        Buffer.from(
          JSON.stringify({
            credentials: {
              humanAdmin: "human-value",
              liteLlm: "litellm-oidc-value",
              oidcClient: "value",
            },
          }),
        ),
      ),
    /missing credentials\.applicationAdmin/,
  )
  assert.throws(
    () =>
      parseKeycloakControlSecretMaterial(
        Buffer.from(
          JSON.stringify({
            credentials: {
              applicationAdmin: "app-value",
              liteLlm: "litellm-oidc-value",
              oidcClient: "oidc-value",
            },
          }),
        ),
      ),
    /missing credentials\.humanAdmin/,
  )
})

test("founder containers use file custody and production BFF authority", async () => {
  const custody = await readFile(
    "scripts/pre-genesis/capture-vm103-founder-custody.mjs",
    "utf8",
  )
  const compose = await readFile(
    "infra/deployment/vm103-founder-candidate.compose.yaml",
    "utf8",
  )
  const dockerfile = await readFile(
    "infra/deployment/vm103-founder-bff.Dockerfile",
    "utf8",
  )
  const entrypoint = await readFile(
    "scripts/pre-genesis/runtime-secret-entrypoint.mjs",
    "utf8",
  )
  assert.match(compose, /\/run\/secrets\/llmm_bff_service_api_key/)
  assert.doesNotMatch(compose, /password|maliper|proxy_admin/i)
  assert.match(compose, /CONSOLE_OIDC_CLIENT_SECRET=/)
  assert.match(compose, /KEYCLOAK_APPLICATION_ADMIN_CLIENT_SECRET=/)
  assert.match(compose, /llmm_keycloak_application_admin_client_secret/)
  assert.match(
    compose,
    /EMERGENCY_ISOLATION_MARKER_DIRECTORY: \/run\/llm-machines\/non-restorable-isolation/,
  )
  assert.match(
    compose,
    /\$\{LLMM_CONFIGURATION_ROOT\}\/non-restorable-isolation:\/run\/llm-machines\/non-restorable-isolation/,
  )
  assert.doesNotMatch(compose, /F0_S1_OIDC_CLIENT_SECRET=/)
  assert.match(custody, /oidcClient: "console-oidc-client-secret"/)
  assert.match(custody, /humanAdmin: "keycloak-admin-client-secret"/)
  assert.match(custody, /liteLlm: "litellm-oidc-client-secret"/)
  assert.match(custody, /CONSOLE_SESSION_KEYRING_FILE/)
  assert.match(custody, /NODE_EXTRA_CA_CERTS/)
  assert.match(custody, /parseKeycloakControlSecretMaterial/)
  assert.doesNotMatch(
    custody,
    /F0_S1_OIDC_CLIENT_SECRET|F0_P1_SESSION_KEYRING_FILE|F0_S1_CA_FILE/,
  )
  assert.match(dockerfile, /ENV NODE_ENV=production/)
  assert.match(dockerfile, /org\.opencontainers\.image\.revision/)
  assert.match(dockerfile, /com\.llm-machines\.source\.tree/)
  assert.match(dockerfile, /apps\/bff\/src\/production-entrypoint\.ts/)
  assert.doesNotMatch(dockerfile, /apps\/bff\/src\/index\.ts/)
  assert.doesNotMatch(dockerfile, /reduced-core-session-bff-fixture/)
  assert.match(entrypoint, /environment\.LLMM_RUNTIME_SECRET_FILES = undefined/)
  assert.doesNotMatch(entrypoint, /console\.log|JSON\.stringify\(environment/)
  assert.match(custody, /await chown\(target, 0, 0\)/)
})

test("founder Application identity readiness is exact and short-lived", () => {
  const issuer =
    "https://identity.lab.llm-machines.com/realms/llm-machines-applications"
  validateApplicationJwks({
    keys: [{ kid: "fixture_key_id", kty: "RSA" }],
  })
  assert.throws(() => validateApplicationJwks({ keys: [] }))
  validateApplicationTokenClaims(
    {
      azp: "console-application-admin",
      exp: 1_060,
      iat: 1_000,
      iss: issuer,
    },
    issuer,
    "console-application-admin",
  )
  assert.throws(
    () =>
      validateApplicationTokenClaims(
        {
          azp: "console-application-admin",
          exp: 1_061,
          iat: 1_000,
          iss: issuer,
        },
        issuer,
        "console-application-admin",
      ),
    /claims\.exp - claims\.iat <= 60/,
  )
})

test("founder Compose gives rendered candidate settings precedence", async () => {
  const compose = await readFile(
    "infra/deployment/vm103-founder-candidate.compose.yaml",
    "utf8",
  )
  const imported = compose.indexOf("runtime-import.env")
  const rendered = compose.indexOf("bff.env")
  assert.ok(imported >= 0 && rendered > imported)
  assert.match(compose, /extra_hosts:\n\s+- "firecrawl-api:127\.0\.0\.1"/)
})

test("Keycloak errors provide a bounded fresh-login recovery action", async () => {
  const errorTemplate = await readFile(
    "infra/keycloak/themes/llm-machines/login/error.ftl",
    "utf8",
  )
  const edge = await readFile(
    "infra/ingress/product-edge.nginx.conf.template",
    "utf8",
  )
  assert.match(errorTemplate, /id="backToLogin"/)
  assert.match(errorTemplate, /href="\/__llmm\/console-login"/)
  assert.doesNotMatch(
    errorTemplate,
    /session_code|redirect_uri|client\.baseUrl/,
  )
  assert.match(
    edge,
    /location = \/__llmm\/console-login[\s\S]*?return 303 https:\/\/@@PRODUCT_CONSOLE_HOST@@\/;/,
  )
})
