import assert from "node:assert/strict"
import { readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { parseRuntimeSecretMaterial } from "../pre-genesis/capture-vm103-founder-custody.mjs"
import { inspectFounderFirewall } from "../pre-genesis/manage-vm103-founder-firewall.mjs"
import { renderVm103FounderCandidate } from "../pre-genesis/render-vm103-founder-candidate.mjs"

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
    const vm103 = await readFile(
      join(root, "llmm-founder-candidate.service"),
      "utf8",
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
    assert.match(bffEnvironment, /F0_S1_IDENTITY_TARGET_HOST=10\.30\.0\.3/)
    assert.match(
      bffEnvironment,
      /F0_S1_IDENTITY_ISSUER=https:\/\/identity\.lab\.example\/realms\/llm-machines/,
    )
    assert.doesNotMatch(
      bffEnvironment,
      /identity\.lab\.example\/keycloak\/realms/,
    )
    assert.doesNotMatch(
      bffEnvironment,
      /F0_S1_IDENTITY_TARGET_HOST=127\.0\.0\.1/,
    )
    assert.match(vm103, /docker compose .* up --detach --wait/)
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

test("founder firewall accepts one exact owned rule and rejects collisions", () => {
  const exact =
    'iifname "ens18" ip saddr 10.30.0.1 tcp dport 22443 accept comment "llmm-founder-candidate-edge" # handle 17'
  assert.deepEqual(inspectFounderFirewall(exact, "10.30.0.1", 22443), {
    handle: "17",
    state: "exact",
  })
  assert.deepEqual(inspectFounderFirewall("", "10.30.0.1", 22443), {
    state: "absent",
  })
  assert.throws(
    () =>
      inspectFounderFirewall(
        exact.replace("10.30.0.1", "10.30.0.2"),
        "10.30.0.1",
        22443,
      ),
    /collides/,
  )
  assert.throws(
    () => inspectFounderFirewall(`${exact}\n${exact}`, "10.30.0.1", 22443),
    /ambiguous/,
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
        "DATABASE_URL=postgres-value",
        "F0_S1_OIDC_CLIENT_SECRET=oidc-value",
        "KEYCLOAK_ADMIN_CLIENT_SECRET=keycloak-value",
        "LITELLM_KEY=litellm-value",
        "F0_P1_SESSION_KEYRING_FILE=/run/source/session.json",
        "F0_S1_CA_FILE=/run/source/ca.crt",
        "ADMIN_PROMETHEUS_BASE_URL=http://127.0.0.1:9090",
        "UNRELATED_SECRET=must-not-copy",
      ].join("\0"),
    ),
  )
  assert.deepEqual(Object.keys(material.secrets).sort(), [
    "bff-service-api-key",
    "console-oidc-client-secret",
    "database-url",
    "keycloak-admin-client-secret",
    "litellm-key",
  ])
  assert.doesNotMatch(
    JSON.stringify(Object.keys(material.secrets)),
    /UNRELATED/,
  )
  assert.deepEqual(material.nonSecrets, {
    ADMIN_PROMETHEUS_BASE_URL: "http://127.0.0.1:9090",
  })
})

test("founder containers use file custody and the BFF uses a real clock", async () => {
  const custody = await readFile(
    "scripts/pre-genesis/capture-vm103-founder-custody.mjs",
    "utf8",
  )
  const compose = await readFile(
    "infra/deployment/vm103-founder-candidate.compose.yaml",
    "utf8",
  )
  const fixture = await readFile(
    "scripts/pre-genesis/reduced-core-session-bff-fixture.mts",
    "utf8",
  )
  const entrypoint = await readFile(
    "scripts/pre-genesis/runtime-secret-entrypoint.mjs",
    "utf8",
  )
  assert.match(compose, /\/run\/secrets\/llmm_bff_service_api_key/)
  assert.doesNotMatch(compose, /password|maliper|proxy_admin/i)
  assert.match(fixture, /F0_S1_REAL_CLOCK/)
  assert.match(entrypoint, /environment\.LLMM_RUNTIME_SECRET_FILES = undefined/)
  assert.doesNotMatch(entrypoint, /console\.log|JSON\.stringify\(environment/)
  assert.match(custody, /await chown\(target, 0, 0\)/)
})
