import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  mapGrafanaRole,
  validateAlertmanager,
  validateGrafana,
  validateKeycloak,
  validateProfile,
  validatePrometheus,
  validatePublicSafety,
  validateRules,
  validateRuntimeContract,
} from "./validate-profile.mjs"

const root = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(root, "../..")

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8")
}

const sources = {
  alertmanager: read("alertmanager/alertmanager.yml"),
  alertRules: read("prometheus/rules/alert-rules.yml"),
  dashboard: read("grafana/dashboards/baseline/inference-core-overview.json"),
  dashboardProvider: read("grafana/provisioning/dashboards/baseline.yml"),
  datasource: read("grafana/provisioning/datasources/prometheus.yml"),
  folderBoundary: read("grafana/customer-folder-contract.json"),
  grafana: read("grafana/grafana.ini"),
  prometheus: read("prometheus/prometheus.yml"),
  recordingRules: read("prometheus/rules/recording-rules.yml"),
  runtimeContract: read("runtime-contract.json"),
  targets: read("prometheus/file-sd/inference-core.json"),
}

const keycloakSeed = readFileSync(
  path.join(repositoryRoot, "infra/keycloak/inference-core-realm-seed.json"),
  "utf8",
)
const keycloakCommissioning = readFileSync(
  path.join(repositoryRoot, "infra/keycloak/inference-core-commissioning.json"),
  "utf8",
)

test("the checked-in static observability package passes", () => {
  assert.deepEqual(validateProfile(), [])
})

test("retention contracts are exact and cannot be shortened", () => {
  const changed = sources.runtimeContract
    .replace('"retention": "30d"', '"retention": "7d"')
    .replace('"retention": "720h"', '"retention": "24h"')
  const errors = validateRuntimeContract(changed)
  assert.ok(errors.some((error) => error.includes("Prometheus retention")))
  assert.ok(errors.some((error) => error.includes("Alertmanager retention")))
})

test("the scrape timeout remains above the bounded BFF database ceiling", () => {
  const changedContract = sources.runtimeContract.replace(
    '"scrapeTimeout": "20s"',
    '"scrapeTimeout": "10s"',
  )
  const changedPrometheus = sources.prometheus.replace(
    "scrape_timeout: 20s",
    "scrape_timeout: 10s",
  )

  assert.match(
    validateRuntimeContract(changedContract).join("\n"),
    /scrape timeout/,
  )
  assert.match(
    validatePrometheus(changedPrometheus, sources.targets).join("\n"),
    /scrape timeout/,
  )
})

test("Prometheus source contains no checked-in target", () => {
  const errors = validatePrometheus(
    sources.prometheus,
    '[{"targets":["service.invalid"]}]\n',
  )
  assert.ok(errors.some((error) => error.includes("zero targets")))
})

test("scrape authentication cannot be removed", () => {
  const changed = sources.prometheus.replace(
    "    authorization:\n      credentials_file: /run/secrets/llmm_prometheus_scrape_bearer\n",
    "",
  )
  assert.ok(
    validatePrometheus(changed, sources.targets).some((error) =>
      error.includes("authentication"),
    ),
  )
})

test("internal IPs, internal hostnames, and lab paths are rejected", () => {
  for (const value of [
    "target: 192.168.4.10",
    "target: metrics.internal",
    "path: /Users/operator/lab/config",
  ]) {
    assert.ok(validatePublicSafety({ changed: value }).length > 0, value)
  }
})

test("common provider credential forms are rejected", () => {
  for (const value of [
    ["token: gh", "o_0123456789abcdefghijklmnop"].join(""),
    ["token: github", "_pat_0123456789abcdefghijklmnop"].join(""),
    ["token: sk-", "proj-0123456789abcdefghijklmnop"].join(""),
  ]) {
    assert.match(
      validatePublicSafety({ changed: value }).join("\n"),
      /credential/,
    )
  }
})

test("literal credentials and unreviewed bindings are rejected", () => {
  assert.ok(
    validatePublicSafety({ changed: "client_secret = plaintext-value" }).some(
      (error) => error.includes("credential"),
    ),
  )
  assert.ok(
    validatePublicSafety({ changed: "url: $UNREVIEWED_ENDPOINT" }).some(
      (error) => error.includes("unreviewed runtime binding"),
    ),
  )
})

test("unpinned placeholders are rejected", () => {
  for (const value of ["TODO", "value: CHANGEME", "image: service:latest"]) {
    assert.ok(validatePublicSafety({ changed: value }).length > 0, value)
  }
})

test("Alertmanager defaults to exactly one local null receiver", () => {
  assert.deepEqual(validateAlertmanager(sources.alertmanager), [])
  const changed = `${sources.alertmanager}\n  - name: outbound\n    webhook_configs:\n      - url: $WEBHOOK_URL\n`
  assert.ok(
    validateAlertmanager(changed).some((error) =>
      error.includes("outbound notification"),
    ),
  )
})

test("the failure ratio uses recent BFF gauges and a minimum volume", () => {
  const retainedDenominator = sources.recordingRules.replace(
    "max(llm_machines_inference_requests_5m), 1)",
    "max(llm_machines_inference_retained_requests), 1)",
  )
  assert.ok(
    validateRules(retainedDenominator, sources.alertRules).some((error) =>
      error.includes("five-minute numerator and denominator"),
    ),
  )
  const noGate = sources.alertRules.replace(
    " and (llm_machines:inference_requests:5m >= 20)",
    "",
  )
  assert.ok(
    validateRules(sources.recordingRules, noGate).some((error) =>
      error.includes("required operational rule"),
    ),
  )
})

test("queue depth cannot be inferred from in-flight requests", () => {
  const changed = sources.recordingRules.replace(
    "expr: max(llm_machines_inference_queue_depth)",
    "expr: max(llm_machines_inference_in_flight_requests)",
  )
  assert.ok(validateRules(changed, sources.alertRules).length > 0)
})

test("abbreviated metric aliases are rejected", () => {
  const changed = sources.recordingRules.replace(
    "llm_machines_inference_queue_depth",
    "llmm_inference_queue_depth",
  )
  assert.ok(
    validateRules(changed, sources.alertRules).some((error) =>
      error.includes("abbreviated"),
    ),
  )
})

test("alert annotations cannot interpolate source labels", () => {
  const changed = sources.alertRules.replace(
    "GPU utilization is persistently saturated",
    "GPU {{ $labels.instance }} is persistently saturated",
  )
  assert.ok(
    validateRules(sources.recordingRules, changed).some((error) =>
      error.includes("interpolate"),
    ),
  )
})

test("content-bearing alert labels are rejected", () => {
  const changed = sources.alertRules.replace(
    "          component: inference",
    "          component: inference\n          prompt: forbidden",
  )
  assert.ok(
    validateRules(sources.recordingRules, changed).some(
      (error) =>
        error.includes("content-bearing") || error.includes("labels must"),
    ),
  )
})

test("Grafana role mapping requires exactly one retained role", () => {
  assert.equal(mapGrafanaRole(["admin"]), "Editor")
  assert.equal(mapGrafanaRole(["operator"]), "Viewer")
  assert.equal(mapGrafanaRole(["operator", "admin"]), null)
  assert.equal(mapGrafanaRole(["unrelated"]), null)
  assert.deepEqual(
    validateGrafana(
      sources.grafana,
      sources.datasource,
      sources.dashboardProvider,
      sources.folderBoundary,
      sources.dashboard,
    ),
    [],
  )
})

test("Grafana cannot use a plaintext OIDC secret", () => {
  const changed = sources.grafana.replace(
    "$__file{/run/secrets/llmm_grafana_oidc_client_secret}",
    "plaintext-secret",
  )
  assert.ok(
    validateGrafana(
      changed,
      sources.datasource,
      sources.dashboardProvider,
      sources.folderBoundary,
      sources.dashboard,
    ).some((error) => error.includes("client_secret")),
  )
})

test("the provisioned baseline cannot become UI editable", () => {
  const changed = sources.dashboardProvider.replace(
    "allowUiUpdates: false",
    "allowUiUpdates: true",
  )
  assert.ok(
    validateGrafana(
      sources.grafana,
      sources.datasource,
      changed,
      sources.folderBoundary,
      sources.dashboard,
    ).some((error) => error.includes("allowUiUpdates")),
  )
})

test("the customer folder remains unprovisioned with Admin edit and Operator view", () => {
  const folder = JSON.parse(sources.folderBoundary)
  folder.customerEditable.operatorPermission = "Edit"
  assert.ok(
    validateGrafana(
      sources.grafana,
      sources.datasource,
      sources.dashboardProvider,
      JSON.stringify(folder),
      sources.dashboard,
    ).some((error) => error.includes("folder permissions")),
  )
})

test("the Keycloak Grafana client is exact and has no offline scope", () => {
  assert.deepEqual(validateKeycloak(keycloakSeed, keycloakCommissioning), [])
  const seed = JSON.parse(keycloakSeed)
  seed.clients
    .find(({ clientId }) => clientId === "grafana")
    .scopeMappings.realmRoles.push("unreviewed")
  seed.offlineAccessPolicy.retainedClientOptionalScopes.grafana.push(
    "offline_access",
  )
  const errors = validateKeycloak(JSON.stringify(seed), keycloakCommissioning)
  assert.ok(errors.some((error) => error.includes("exact reviewed contract")))
  assert.ok(errors.some((error) => error.includes("offline scopes")))
})

test("the validator CLI passes without network or runtime access", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "validate-profile.mjs")],
    {
      encoding: "utf8",
    },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /"status":"pass"/)
  assert.match(result.stdout, /"sourceOnly":true/)
})
