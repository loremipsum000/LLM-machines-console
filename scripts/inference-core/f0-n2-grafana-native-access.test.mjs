import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"
import {
  mapGrafanaRole,
  validateGrafana,
} from "../../infra/observability/validate-profile.mjs"

const root = resolve(import.meta.dirname, "../..")
const base = "74d6a13ea4ffc0ea97fbda0abfec67cb957c5d26"

test("F0-N2 binds exact Grafana 13.1.3 without activating it", async () => {
  const [evidence, routes, inventory] = await Promise.all([
    readJson("docs/reduction/inference-core/f0-n2-grafana-native-access.json"),
    readJson(
      "docs/reduction/inference-core/f0-n2-grafana-native-route-characterization.json",
    ),
    readJson("infra/release/core-image-inventory.json"),
  ])
  const grafana = inventory.components.find(
    ({ id }) => id === "grafana-private",
  )

  assert.equal(evidence.workPackage, "F0-N2")
  assert.equal(evidence.status, "SOURCE_CHARACTERIZED_NOT_ACTIVATED")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.genesisPublished, false)
  assert.equal(evidence.protectedInput.commit, base)
  assert.equal(git("rev-parse", `${base}^{tree}`), evidence.protectedInput.tree)
  assert.equal(routes.status, "CHARACTERIZED_NOT_ACTIVATED")
  assert.match(routes.f0N5ReviewRequired.activation, /^INACTIVE_PENDING_/)
  assert.deepEqual(grafana, {
    id: "grafana-private",
    kind: "third-party-mirror",
    required: true,
    customerExposure: "product-edge-admin-only-native-sso",
    repository: "docker.io/grafana/grafana",
    version: "13.1.3",
    indexDigest:
      "sha256:ab5cb380e3ff3172d6c8bd2e7cfd31cce977d2881b260e1f5bc089bf0b759b43",
    platform: "linux/amd64",
    platformDigest:
      "sha256:e27e68cfd5795c1bea54950766078a02e84dfa3bafe0a4d0e5382f713dfd8e4e",
    sourceRevision: "45a27d64b64a82d666b06aa5c5bb3521587edb0d",
    license: "AGPL-3.0-only",
    mirrorRepository: "core/grafana",
  })
})

test("F0-N2 admits only Admin as Editor and never Grafana server admin", async () => {
  const [evidence, routes, sources] = await Promise.all([
    readJson("docs/reduction/inference-core/f0-n2-grafana-native-access.json"),
    readJson(
      "docs/reduction/inference-core/f0-n2-grafana-native-route-characterization.json",
    ),
    readObservabilitySources(),
  ])

  assert.equal(mapGrafanaRole(["admin"]), "Editor")
  for (const roles of [["operator"], ["admin", "operator"], ["unrelated"], []])
    assert.equal(mapGrafanaRole(roles), null)
  assert.equal(
    evidence.authenticationAndRoles.grafanaServerAdministrator,
    false,
  )
  assert.equal(
    evidence.authenticationAndRoles.editorDatasourceMutationStatus,
    403,
  )
  assert.equal(routes.qualifiedRoleBoundary.Admin, "Editor")
  assert.equal(routes.qualifiedRoleBoundary.Operator, "DENY")
  assert.equal(routes.qualifiedRoleBoundary.mixedAdminOperator, "DENY")
  assert.equal(routes.qualifiedRoleBoundary.grafanaServerAdministrator, false)
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

test("F0-N2 vulnerability exceptions are bounded by tested nonreachability controls", async () => {
  const [evidence, routes, grafanaIni] = await Promise.all([
    readJson("docs/reduction/inference-core/f0-n2-grafana-native-access.json"),
    readJson(
      "docs/reduction/inference-core/f0-n2-grafana-native-route-characterization.json",
    ),
    readText("infra/observability/grafana/grafana.ini"),
  ])
  const admission = evidence.securityAdmission
  const findingIds = new Set(
    admission.highFindingGroups.flatMap(({ findingIds }) => findingIds),
  )
  const approvedAt = Date.parse(admission.approvedAt)
  const expiresAt = Date.parse(admission.expiresAt)

  assert.equal(
    admission.decision,
    "PASS_WITH_TIME_BOUNDED_NONREACHABILITY_EXCEPTIONS",
  )
  assert.equal(admission.occurrenceCounts.critical, 0)
  assert.equal(admission.occurrenceCounts.high, 15)
  assert.equal(admission.uniqueFindingCounts.high, 12)
  assert.equal(admission.secretsFound, 0)
  assert.equal(findingIds.size, 12)
  assert.ok(expiresAt > approvedAt)
  assert.ok(expiresAt > Date.now())
  assert.ok(expiresAt - approvedAt <= 30 * 24 * 60 * 60 * 1000)
  assert.equal(routes.securityControls.disabledPluginSettingsStatus, 404)
  assert.equal(routes.securityControls.disabledPluginsAbsentFromInventory, true)
  assert.equal(routes.securityControls.editorDatasourceMutationStatus, 403)
  assert.deepEqual(routes.securityControls.disabledPlugins, [
    "elasticsearch",
    "tempo",
    "zipkin",
  ])
  assert.match(grafanaIni, /^disable_plugins = elasticsearch,tempo,zipkin$/m)
})

test("F0-N2 preserves native OAuth, cookie, redirect, and CSRF behavior for F0-N5", async () => {
  const [evidence, routes, runtime] = await Promise.all([
    readJson("docs/reduction/inference-core/f0-n2-grafana-native-access.json"),
    readJson(
      "docs/reduction/inference-core/f0-n2-grafana-native-route-characterization.json",
    ),
    readText("scripts/pre-genesis/grafana-native-characterization.mjs"),
  ])

  assert.equal(routes.authentication.flow, "Authorization Code with PKCE S256")
  assert.equal(routes.authentication.callback, "GET /login/generic_oauth")
  assert.equal(routes.authentication.consoleSessionForwarded, false)
  assert.equal(routes.authentication.sharedCookie, false)
  assert.deepEqual(routes.authentication.nativeCookieNames, [
    "grafana_session",
    "grafana_session_expiry",
  ])
  assert.equal(routes.csrf.crossOriginMutationStatus, 403)
  assert.equal(routes.nativeUi.webSocketRequired, false)
  assert.equal(routes.nativeUi.sseRequired, false)
  assert.ok(routes.nativeUi.responseHeadersToPreserve.includes("Set-Cookie"))
  assert.ok(routes.nativeUi.responseHeadersToPreserve.includes("Location"))
  assert.equal(
    evidence.sessionAndFailureEvidence.nativeCookieSecureInProductProfile,
    true,
  )
  assert.match(runtime, /GF_SECURITY_COOKIE_SECURE=false/)
  assert.match(runtime, /127\.0\.0\.1:\$\{runtime\.ports\.grafana\}:3000/)
  assert.match(runtime, /consoleSessionForwarded: false/)
})

test("F0-N2 records no credential or internal-address material", async () => {
  const documents = await Promise.all([
    readText("docs/reduction/inference-core/f0-n2-grafana-native-access.json"),
    readText(
      "docs/reduction/inference-core/f0-n2-grafana-native-route-characterization.json",
    ),
  ])
  for (const document of documents) {
    assert.doesNotMatch(
      document,
      /(?:PRIVATE KEY|BEGIN OPENSSH|password=|token=|10\.\d{1,3}\.\d{1,3}\.\d{1,3})/i,
    )
  }
})

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

async function readObservabilitySources() {
  const [grafana, datasource, dashboardProvider, folderBoundary, dashboard] =
    await Promise.all([
      readText("infra/observability/grafana/grafana.ini"),
      readText(
        "infra/observability/grafana/provisioning/datasources/prometheus.yml",
      ),
      readText(
        "infra/observability/grafana/provisioning/dashboards/baseline.yml",
      ),
      readText("infra/observability/grafana/customer-folder-contract.json"),
      readText(
        "infra/observability/grafana/dashboards/baseline/inference-core-overview.json",
      ),
    ])
  return { grafana, datasource, dashboardProvider, folderBoundary, dashboard }
}

async function readJson(path) {
  return JSON.parse(await readText(path))
}

async function readText(path) {
  return readFile(resolve(root, path), "utf8")
}
