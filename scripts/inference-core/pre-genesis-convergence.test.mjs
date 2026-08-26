import assert from "node:assert/strict"
import { readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

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
import {
  validateApplicationJwks,
  validateApplicationTokenClaims,
} from "../pre-genesis/verify-vm103-application-identity.mjs"
import { validateFounderImageInspections } from "../pre-genesis/verify-vm103-founder-images.mjs"

const digest = `sha256:${"a".repeat(64)}`

function placement() {
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
    network: {
      edgeGateway: "10.30.0.1",
      gateway: "10.10.0.1",
      inference: "10.20.0.2",
      vm103: "10.30.0.3",
    },
    paths: {
      admission: "/etc/llmm/admission",
      compose: "/opt/llmm/candidate.compose.yaml",
      configuration: "/etc/llmm/configuration",
      secret: "/etc/llmm/secrets",
      source: "/opt/llmm/source",
    },
    ports: {
      bff: 44294,
      edge: 22443,
      grafana: 36257,
      keycloak: 40239,
      litellm: 39218,
      sglang: 30005,
      web: 34954,
    },
  }
}

test("founder placement renders exact edge, supervision, and private inference contracts", async () => {
  const root = join(
    tmpdir(),
    `llmm-founder-render-${process.pid}-${Date.now()}`,
  )
  try {
    const first = await renderVm103FounderCandidate(placement(), root)
    const edge = await readFile(join(root, "product-edge.nginx.conf"), "utf8")
    const firewall = await readFile(
      join(root, "inference-firewall.nft"),
      "utf8",
    )
    const gateway = await readFile(
      join(root, "gateway-inference-route.service"),
      "utf8",
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
    assert.match(gateway, /--comment llmm-vm103-sglang/)
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
    assert.match(vm103, /verify-vm103-founder-images\.mjs/)
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
  ]) {
    const value = placement()
    mutate(value)
    await assert.rejects(
      renderVm103FounderCandidate(
        value,
        join(tmpdir(), `llmm-invalid-${Date.now()}`),
      ),
      /invalid/,
    )
  }
})

test("founder placement rejects ports that disagree with fixed container listeners", async () => {
  const value = placement()
  value.ports.web = 34955
  await assert.rejects(
    renderVm103FounderCandidate(
      value,
      join(tmpdir(), `llmm-invalid-fixed-port-${Date.now()}`),
    ),
    /founder candidate port contract/,
  )
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
  assert.match(dockerfile, /apps\/bff\/src\/index\.ts/)
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
