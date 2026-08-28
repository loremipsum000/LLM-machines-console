#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(root, "../..")

const profileFiles = {
  alertmanager: "alertmanager/alertmanager.yml",
  dashboard: "grafana/dashboards/baseline/inference-core-overview.json",
  hardwareDashboard: "grafana/dashboards/baseline/infra-overview.json",
  dashboardProvider: "grafana/provisioning/dashboards/baseline.yml",
  datasource: "grafana/provisioning/datasources/prometheus.yml",
  hardwareDatasource:
    "grafana/provisioning/datasources/hardware-prometheus.yml",
  folderBoundary: "grafana/customer-folder-contract.json",
  grafana: "grafana/grafana.ini",
  prometheus: "prometheus/prometheus.yml",
  recordingRules: "prometheus/rules/recording-rules.yml",
  alertRules: "prometheus/rules/alert-rules.yml",
  runtimeContract: "runtime-contract.json",
  targets: "prometheus/file-sd/inference-core.json",
}

const expectedFiles = new Set([
  "README.md",
  "alertmanager/alertmanager.yml",
  "grafana/customer-folder-contract.json",
  "grafana/dashboards/baseline/inference-core-overview.json",
  "grafana/dashboards/baseline/infra-overview.json",
  "grafana/grafana.ini",
  "grafana/provisioning/dashboards/baseline.yml",
  "grafana/provisioning/datasources/prometheus.yml",
  "grafana/provisioning/datasources/hardware-prometheus.yml",
  "prometheus/file-sd/inference-core.json",
  "prometheus/prometheus.yml",
  "prometheus/rules/alert-rules.yml",
  "prometheus/rules/recording-rules.yml",
  "runtime-contract.json",
  "validate-profile.mjs",
  "validate-profile.test.mjs",
])

const expectedGrafanaClient = {
  accessTokenClaims: ["amr", "auth_time", "realm_access.roles", "sub"],
  clientAuthentication: "client-secret-generated-outside-seed",
  clientId: "grafana",
  credentialIncluded: false,
  defaultClientScopes: ["basic", "email", "llm-machines-amr", "profile"],
  flows: ["authorization-code-pkce"],
  fullScopeAllowed: false,
  idTokenClaims: ["email", "email_verified", "realm_access.roles", "sub"],
  optionalClientScopes: [],
  pkceCodeChallengeMethod: "S256",
  protocol: "openid-connect",
  protocolMappers: [
    {
      config: {
        "access.token.claim": "true",
        "claim.name": "realm_access.roles",
        "id.token.claim": "true",
        "jsonType.label": "String",
        multivalued: "true",
        "userinfo.token.claim": "true",
      },
      consentRequired: false,
      name: "grafana-realm-roles",
      protocol: "openid-connect",
      protocolMapper: "oidc-usermodel-realm-role-mapper",
    },
  ],
  runtimeBindings: {
    redirectUri: "grafana-root-plus-login-generic-oauth",
    webOrigin: "grafana-root-origin",
  },
  scopeMappings: {
    realmRoles: ["admin", "operator"],
  },
  serviceAccountsEnabled: false,
}

const expectedAlertNames = [
  "LLMMGpuSaturation",
  "LLMMInferenceFailureRatioHigh",
  "LLMMInferenceQueueDepthPersisting",
  "LLMMInferenceQueueDepthSignalMissing",
]

const allowedDashboardExpressions = new Set([
  "llm_machines:gpu_utilization_ratio:max",
  "llm_machines:inference_failure_ratio:5m",
  "llm_machines:inference_in_flight_requests:max",
  "llm_machines:inference_queue_depth:max",
  "llm_machines:inference_requests:5m",
  "llm_machines:inference_retained_latency_milliseconds:max",
  "llm_machines:inference_retained_total_tokens:max",
])

const allowedHardwareDashboardExpressions = new Set([
  '1 - avg by (host) (rate(node_cpu_seconds_total{job="node",mode="idle"}[5m]))',
  'hw_temperature_celsius{job="xpu",hw_sensor_location=~"gpu|memory",statistic="max"}',
  '100 * hw_memory_utilization_ratio{job="xpu",hw_memory_location="device"}',
  'node_memory_MemTotal_bytes{job="node"} - node_memory_MemAvailable_bytes{job="node"}',
  'node_memory_MemTotal_bytes{job="node"}',
  '100 * (1 - (node_filesystem_avail_bytes{job="node",fstype!~"tmpfs|devtmpfs|overlay|squashfs|fuse.*",device!~"/dev/fuse",mountpoint!~"/run.*|/var/lib/docker/.+"} / node_filesystem_size_bytes{job="node",fstype!~"tmpfs|devtmpfs|overlay|squashfs|fuse.*",device!~"/dev/fuse",mountpoint!~"/run.*|/var/lib/docker/.+"}))',
  '100 * hw_gpu_utilization_ratio{job="xpu",hw_gpu_task="all"}',
  'rate(node_network_receive_bytes_total{job="node",device!~"lo|veth.*|br-.*|docker.*"}[5m])',
  'rate(node_network_transmit_bytes_total{job="node",device!~"lo|veth.*|br-.*|docker.*"}[5m])',
  'rate(node_network_receive_errs_total{job="node",device!~"lo|veth.*|br-.*|docker.*"}[5m]) + rate(node_network_transmit_errs_total{job="node",device!~"lo|veth.*|br-.*|docker.*"}[5m]) + rate(node_network_receive_drop_total{job="node",device!~"lo|veth.*|br-.*|docker.*"}[5m]) + rate(node_network_transmit_drop_total{job="node",device!~"lo|veth.*|br-.*|docker.*"}[5m])',
  '1 - hw_status{job="xpu",hw_type="gpu",hw_state="reset_needed"}',
  'hw_status{job="xpu",hw_type="frequency",hw_state=~"ok|throttled"}',
  'hw_power_watts{job="xpu",hw_sensor_location=~"card|package"}',
  'ipmi_temperature_celsius{job="ipmi"}',
  'ipmi_fan_speed_rpm{job="ipmi"}',
  '{__name__=~"ipmi_(temperature|fan_speed|voltage|current|power|sensor)_state",job="ipmi"}',
  'ALERTS{alertstate="firing"}',
  'ipmi_power_watts{job="ipmi",name="PW consumption"}',
  'avg_over_time(ipmi_power_watts{job="ipmi",name="PW consumption"}[30d]) * 24 * 30 / 1000',
  'ipmi_chassis_power_state{job="ipmi"}',
  'rate(node_disk_reads_completed_total{job="node",device!~"loop.*|ram.*"}[5m])',
  'rate(node_disk_writes_completed_total{job="node",device!~"loop.*|ram.*"}[5m])',
])

const allowedBindings = new Set([
  "$LLMM_PROMETHEUS_URL",
  "$LLMM_HARDWARE_PROMETHEUS_URL",
  "$__env{LLMM_KEYCLOAK_AUTH_URL}",
  "$__env{LLMM_KEYCLOAK_JWKS_URL}",
  "$__env{LLMM_KEYCLOAK_TOKEN_URL}",
  "$__env{LLMM_KEYCLOAK_USERINFO_URL}",
  "$__env{LLMM_GRAFANA_SIGNOUT_REDIRECT_URL}",
  "$__file{/run/secrets/llmm_grafana_oidc_client_secret}",
])

function add(errors, message) {
  errors.push(message)
}

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8")
}

function parseJson(source, label, errors) {
  try {
    return JSON.parse(source)
  } catch (error) {
    add(errors, `${label} is not valid JSON: ${error.message}`)
    return null
  }
}

function listFiles(directory, prefix = "") {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...listFiles(path.join(directory, entry.name), relative))
    } else {
      files.push(relative)
    }
  }
  return files.sort()
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function extractRuleBlocks(source, key) {
  const blocks = new Map()
  let current = null
  for (const line of source.split(/\r?\n/)) {
    const start = line.match(new RegExp(`^ {6}- ${key}: (.+)$`))
    if (start) {
      current = start[1]
      blocks.set(current, [])
    } else if (current) {
      blocks.get(current).push(line)
    }
  }
  return blocks
}

function nestedRuleMap(lines, key) {
  const start = lines.findIndex((line) => line === `        ${key}:`)
  if (start < 0) return {}
  const values = {}
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^ {10}([a-z_]+): (.+)$/)
    if (!match) break
    values[match[1]] = match[2]
  }
  return values
}

function extractBindings(source) {
  return (
    source.match(
      /\$__env\{[A-Z0-9_]+\}|\$__file\{[^}\n]+\}|\$[A-Z][A-Z0-9_]*/g,
    ) ?? []
  )
}

export function mapGrafanaRole(roles) {
  const admin = roles.includes("admin")
  const operator = roles.includes("operator")
  if (admin && !operator) return "Editor"
  return null
}

export function validatePublicSafety(sources) {
  const errors = []
  const joined = Object.entries(sources)
    .map(([name, source]) => `\n${name}\n${source}`)
    .join("\n")

  for (const [pattern, message] of [
    [
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
      "private key material is forbidden",
    ],
    [
      /\b(?:gh[pousr]_[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-(?:proj-)?[A-Za-z0-9_-]{16,})\b/i,
      "credential-like token is forbidden",
    ],
    [
      /(?:^|[\s"'])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?:$|[\s"'])/m,
      "internal IP literal is forbidden",
    ],
    [
      /\b(?:localhost|lab-[a-z0-9-]+|proxmox|pve|vm\d{2,})\b|\.(?:home|internal|lan|local)\b/i,
      "internal hostname is forbidden",
    ],
    [
      /(?:\/Users\/|\/Volumes\/|\/home\/[^\s]+\/|docs\/lab\/|\.ovpn\b)/i,
      "lab or workstation path is forbidden",
    ],
    [/https?:\/\/(?!\$)[^\s"']+/i, "literal network endpoint is forbidden"],
    [
      /\b(?:TODO|TBD|CHANGEME|REPLACE_ME)\b|<[^>\n]+>|(?:^|[\s/:])latest(?:$|[\s"'])/im,
      "unresolved or unpinned placeholder is forbidden",
    ],
  ]) {
    if (pattern.test(joined)) add(errors, message)
  }

  for (const binding of extractBindings(joined)) {
    if (!allowedBindings.has(binding)) {
      add(errors, `unreviewed runtime binding ${binding}`)
    }
  }

  const secretAssignments = joined.matchAll(
    /^\s*(?:client_secret|password|api[_-]?key|access[_-]?token|bearer[_-]?token)\s*[:=]\s*(.+)$/gim,
  )
  for (const assignment of secretAssignments) {
    if (
      assignment[1].trim() !==
      "$__file{/run/secrets/llmm_grafana_oidc_client_secret}"
    ) {
      add(errors, "literal credential assignment is forbidden")
    }
  }
  return errors
}

export function validateRuntimeContract(source) {
  const errors = []
  const contract = parseJson(source, "runtime contract", errors)
  if (!contract) return errors

  if (
    contract?.metadata?.activation !== "PR-12" ||
    contract?.metadata?.changePackage !== "PR-09" ||
    contract?.metadata?.containsCredentials !== false ||
    contract?.metadata?.sourceOnly !== true
  ) {
    add(
      errors,
      "runtime contract must remain source-only PR-09 material for PR-12 activation",
    )
  }
  if (
    contract?.prometheus?.retention !== "30d" ||
    contract?.prometheus?.scrapeTimeout !== "20s" ||
    !sameJson(contract?.prometheus?.requiredRuntimeArguments, [
      "--storage.tsdb.retention.time=30d",
    ])
  ) {
    add(errors, "Prometheus retention and scrape timeout must be exact")
  }
  if (
    contract?.alertmanager?.retention !== "720h" ||
    !sameJson(contract?.alertmanager?.requiredRuntimeArguments, [
      "--data.retention=720h",
    ])
  ) {
    add(errors, "Alertmanager retention must be exactly 720h")
  }
  if (
    contract?.prometheus?.scrapeAuthentication?.required !== true ||
    contract?.prometheus?.scrapeAuthentication?.credentialSource !==
      "mounted-file"
  ) {
    add(
      errors,
      "Prometheus scrape authentication must use a mounted credential file",
    )
  }
  if (
    contract?.prometheus?.scrapeDiscovery?.seedTargetCount !== 0 ||
    contract?.prometheus?.scrapeDiscovery?.targetValuesOwner !==
      "packaging-pr12" ||
    contract?.prometheus?.queueDepthFallback !== "none"
  ) {
    add(
      errors,
      "runtime targets and queue fallback must remain absent from PR-09 source",
    )
  }
  if (
    contract?.prometheus?.ruleManagement?.provisioned !== true ||
    contract?.prometheus?.ruleManagement?.runtimeMount !== "read-only" ||
    contract?.prometheus?.ruleManagement?.uiEditable !== false
  ) {
    add(errors, "Prometheus baseline rules must be locked provisioned files")
  }
  const metrics = contract?.prometheus?.normalizedMetrics ?? []
  const names = metrics.map(({ name }) => name)
  const expectedNames = [
    "llm_machines_gpu_utilization_ratio",
    "llm_machines_inference_requests_5m",
    "llm_machines_inference_failures_5m",
    "llm_machines_inference_server_failures_5m",
    "llm_machines_inference_in_flight_requests",
    "llm_machines_inference_queue_depth_source_info",
    "llm_machines_inference_queue_depth",
    "llm_machines_inference_retained_requests",
    "llm_machines_inference_retained_failures",
    "llm_machines_inference_retained_input_tokens",
    "llm_machines_inference_retained_output_tokens",
    "llm_machines_inference_retained_total_tokens",
    "llm_machines_inference_retained_latency_milliseconds_sum",
    "llm_machines_inference_retained_latency_milliseconds_max",
  ]
  if (!sameJson(names, expectedNames)) {
    add(errors, "normalized metric set changed")
  }
  for (const metric of metrics) {
    if (metric.type !== "gauge") {
      add(errors, `${metric.name} must be a gauge`)
    }
    const expectedAvailability = [
      "llm_machines_gpu_utilization_ratio",
      "llm_machines_inference_queue_depth",
    ].includes(metric.name)
      ? "pr12-qualified-adapter"
      : "pr09-bff"
    if (metric.availability !== expectedAvailability) {
      add(errors, `${metric.name} has an incorrect availability boundary`)
    }
  }
  const forbiddenLabels = new Set([
    "prompt",
    "response",
    "search_term",
    "url",
    "request_body",
    "response_body",
    "header",
    "username",
    "email",
    "source_ip",
    "tool_arguments",
    "tool_results",
  ])
  for (const metric of metrics) {
    for (const label of metric.labels ?? []) {
      if (forbiddenLabels.has(label))
        add(errors, `content-bearing metric label ${label}`)
    }
  }
  if (
    contract?.alertmanager?.defaultReceiver !== "local-null" ||
    contract?.alertmanager?.externalReceiverState !== "disabled" ||
    !sameJson(contract?.alertmanager?.externalReceiverActivationRequires, [
      "admin-egress-warning-acknowledgement",
      "audited-console-action",
      "customer-owned-destination",
      "explicit-egress-policy",
    ])
  ) {
    add(
      errors,
      "external notification delivery must remain disabled and governed",
    )
  }
  if (
    contract?.grafana?.baseline?.allowUiUpdates !== false ||
    contract?.grafana?.baseline?.datasourceEditable !== false ||
    contract?.grafana?.baseline?.disableDeletion !== true ||
    contract?.grafana?.customerFolder?.provisioned !== false
  ) {
    add(errors, "Grafana baseline and customer folder boundary changed")
  }
  if (
    contract?.grafana?.alertAuthority?.backend !== "standalone-alertmanager" ||
    contract?.grafana?.alertAuthority?.grafanaUnifiedAlerting !== "disabled" ||
    contract?.grafana?.alertAuthority?.prometheusAlertsPanel !== "retained" ||
    contract?.grafana?.alertAuthority?.unavailableMeansZeroActive !== false
  ) {
    add(errors, "Grafana must defer alert authority to standalone Alertmanager")
  }
  if (
    contract?.grafana?.hardwareDatasource?.managementTargetsInVm103 !== false ||
    contract?.grafana?.hardwareDatasource?.operatorAccess !== "DENY" ||
    contract?.grafana?.hardwareDatasource?.publicAccess !== false ||
    contract?.grafana?.hardwareDatasource?.queryOnly !== true ||
    contract?.grafana?.hardwareDatasource?.runtimeBinding !==
      "$LLMM_HARDWARE_PROMETHEUS_URL" ||
    contract?.grafana?.hardwareDatasource?.uid !== "llmm-hardware-prometheus"
  ) {
    add(errors, "Grafana hardware datasource boundary changed")
  }
  if (
    contract?.grafana?.oidc?.adminRole !== "Editor" ||
    contract?.grafana?.oidc?.ambiguousRetainedRoles !== "deny" ||
    contract?.grafana?.oidc?.operatorRole !== "DENY" ||
    contract?.grafana?.oidc?.strict !== true ||
    contract?.grafana?.oidc?.unknownRole !== "deny"
  ) {
    add(
      errors,
      "Grafana OIDC roles must be Admin Editor and strict deny otherwise",
    )
  }
  return errors
}

export function validatePrometheus(prometheus, targets) {
  const errors = []
  const parsedTargets = parseJson(targets, "Prometheus file_sd seed", errors)
  if (!sameJson(parsedTargets, [])) {
    add(errors, "Prometheus file_sd seed must contain zero targets")
  }
  for (const requirement of [
    [
      "authorization:\n      credentials_file: /run/secrets/llmm_prometheus_scrape_bearer",
      "scrape authentication file is required",
    ],
    ["scrape_timeout: 20s", "scrape timeout must exceed the BFF DB ceiling"],
    [
      "- /etc/prometheus/file_sd/inference-core.json",
      "only the PR-12 file_sd binding is allowed",
    ],
    [
      "- /etc/prometheus/rules/recording-rules.yml",
      "recording rules must be provisioned",
    ],
    [
      "- /etc/prometheus/rules/alert-rules.yml",
      "alert rules must be provisioned",
    ],
    ["action: labelkeep", "metric labels must fail closed"],
    ["regex: __name__|job|component|status", "metric label allowlist changed"],
  ]) {
    if (!prometheus.includes(requirement[0])) add(errors, requirement[1])
  }
  if (/\bstatic_configs\b|\btargets:\s*\[(?!\s*\])/m.test(prometheus)) {
    add(errors, "literal Prometheus scrape targets are forbidden")
  }
  return errors
}

export function validateRules(recordingRules, alertRules) {
  const errors = []
  const expectedRecordExpressions = {
    "llm_machines:gpu_utilization_ratio:max":
      "max(clamp_max(clamp_min(llm_machines_gpu_utilization_ratio, 0), 1))",
    "llm_machines:inference_requests:5m":
      "max(llm_machines_inference_requests_5m)",
    "llm_machines:inference_failures:5m":
      "max(llm_machines_inference_failures_5m)",
    "llm_machines:inference_server_failures:5m":
      "max(llm_machines_inference_server_failures_5m)",
    "llm_machines:inference_failure_ratio:5m":
      "max(llm_machines_inference_failures_5m) / clamp_min(max(llm_machines_inference_requests_5m), 1)",
    "llm_machines:inference_in_flight_requests:max":
      "max(llm_machines_inference_in_flight_requests)",
    "llm_machines:inference_queue_depth:max":
      "max(llm_machines_inference_queue_depth)",
    "llm_machines:inference_retained_total_tokens:max":
      "max(llm_machines_inference_retained_total_tokens)",
    "llm_machines:inference_retained_latency_milliseconds:max":
      "max(llm_machines_inference_retained_latency_milliseconds_max)",
  }
  const expectedAlerts = {
    LLMMGpuSaturation: {
      annotations: {
        summary: "GPU utilization is persistently saturated",
        description:
          "Available accelerator compute has remained highly utilized.",
      },
      expr: "llm_machines:gpu_utilization_ratio:max > 0.95",
      for: "10m",
      labels: { severity: "warning", component: "inference" },
    },
    LLMMInferenceFailureRatioHigh: {
      annotations: {
        summary: "Inference failures exceed the operational threshold",
        description:
          "The failure ratio is elevated after the minimum request volume was reached.",
      },
      expr: "(llm_machines:inference_failure_ratio:5m > 0.05) and (llm_machines:inference_requests:5m >= 20)",
      for: "5m",
      labels: { severity: "warning", component: "inference" },
    },
    LLMMInferenceQueueDepthPersisting: {
      annotations: {
        summary: "Inference work is persistently queued",
        description: "Genuine runtime queue depth has remained above zero.",
      },
      expr: "llm_machines:inference_queue_depth:max > 0",
      for: "10m",
      labels: { severity: "warning", component: "inference" },
    },
    LLMMInferenceQueueDepthSignalMissing: {
      annotations: {
        summary: "Queue depth telemetry is unavailable",
        description:
          "The runtime is not publishing the normalized queue depth signal.",
      },
      expr: "absent(llm_machines_inference_queue_depth) == 1",
      for: "10m",
      labels: { severity: "info", component: "inference" },
    },
  }
  for (const required of [
    "expr: max(llm_machines_inference_queue_depth)",
    "expr: absent(llm_machines_inference_queue_depth) == 1",
    "expr: llm_machines:inference_queue_depth:max > 0",
    "expr: (llm_machines:inference_failure_ratio:5m > 0.05) and (llm_machines:inference_requests:5m >= 20)",
    "expr: llm_machines:gpu_utilization_ratio:max > 0.95",
  ]) {
    if (!`${recordingRules}\n${alertRules}`.includes(required)) {
      add(errors, `required operational rule is missing: ${required}`)
    }
  }
  const alertNames = [
    ...alertRules.matchAll(/^\s*- alert: ([A-Za-z0-9]+)$/gm),
  ].map((match) => match[1])
  if (!sameJson(alertNames, expectedAlertNames)) {
    add(errors, "alert rule names or order changed")
  }
  const recordNames = [
    ...recordingRules.matchAll(/^\s*- record: ([a-z0-9_:]+)$/gm),
  ].map((match) => match[1])
  if (
    !sameJson(recordNames, [
      "llm_machines:gpu_utilization_ratio:max",
      "llm_machines:inference_requests:5m",
      "llm_machines:inference_failures:5m",
      "llm_machines:inference_server_failures:5m",
      "llm_machines:inference_failure_ratio:5m",
      "llm_machines:inference_in_flight_requests:max",
      "llm_machines:inference_queue_depth:max",
      "llm_machines:inference_retained_total_tokens:max",
      "llm_machines:inference_retained_latency_milliseconds:max",
    ])
  ) {
    add(errors, "recording rule set changed")
  }
  const recordBlocks = extractRuleBlocks(recordingRules, "record")
  for (const [name, expression] of Object.entries(expectedRecordExpressions)) {
    const actual = recordBlocks
      .get(name)
      ?.find((line) => line.startsWith("        expr: "))
    if (actual !== `        expr: ${expression}`) {
      add(errors, `recording rule expression changed for ${name}`)
    }
  }
  const alertBlocks = extractRuleBlocks(alertRules, "alert")
  for (const [name, expected] of Object.entries(expectedAlerts)) {
    const lines = alertBlocks.get(name) ?? []
    const expr = lines
      .find((line) => line.startsWith("        expr: "))
      ?.slice(14)
    const duration = lines
      .find((line) => line.startsWith("        for: "))
      ?.slice(13)
    const labels = nestedRuleMap(lines, "labels")
    const annotations = nestedRuleMap(lines, "annotations")
    if (
      expr !== expected.expr ||
      duration !== expected.for ||
      !sameJson(labels, expected.labels) ||
      !sameJson(annotations, expected.annotations)
    ) {
      add(errors, `alert rule contract changed for ${name}`)
    }
  }
  const queueLines = `${recordingRules}\n${alertRules}`
    .split("\n")
    .filter((line) => /queue/i.test(line))
    .join("\n")
  if (
    /concurrent|active_requests|in_flight|running_requests/i.test(queueLines)
  ) {
    add(errors, "queue depth must not be inferred from concurrency")
  }
  if (/\bllmm[_:]/.test(`${recordingRules}\n${alertRules}`)) {
    add(errors, "abbreviated llmm metric aliases are forbidden")
  }
  const failureRatioBlock = recordingRules.match(
    /- record: llm_machines:inference_failure_ratio:5m\n\s+expr: ([^\n]+)/,
  )?.[1]
  if (
    failureRatioBlock !==
    "max(llm_machines_inference_failures_5m) / clamp_min(max(llm_machines_inference_requests_5m), 1)"
  ) {
    add(
      errors,
      "failure ratio must use the BFF five-minute numerator and denominator gauges",
    )
  }
  if (/\{\{\s*\$|\$labels|\$value/i.test(alertRules)) {
    add(
      errors,
      "alert annotations must not interpolate metric labels or values",
    )
  }
  for (const forbidden of [
    "prompt",
    "response body",
    "search term",
    "target url",
    "request body",
    "header",
    "username",
    "email",
    "source ip",
    "tool argument",
    "tool result",
  ]) {
    if (alertRules.toLowerCase().includes(forbidden)) {
      add(errors, `content-bearing alert annotation or label: ${forbidden}`)
    }
  }
  const labelKeys = [
    ...alertRules.matchAll(/\n\s{8}labels:\n((?:\s{10}[a-z_]+: [^\n]+\n?)+)/g),
  ]
    .flatMap((match) => [...match[1].matchAll(/^\s{10}([a-z_]+):/gm)])
    .map((match) => match[1])
  if (labelKeys.some((key) => !["component", "severity"].includes(key))) {
    add(errors, "alert labels must be limited to component and severity")
  }
  return errors
}

export function validateAlertmanager(source) {
  const errors = []
  const required = [
    "receiver: local-null",
    "- alertname",
    "- severity",
    "- component",
    "receivers:\n  - name: local-null",
  ]
  for (const value of required) {
    if (!source.includes(value)) add(errors, `Alertmanager is missing ${value}`)
  }
  if (
    /(?:email|webhook|slack|pagerduty|opsgenie|victorops|sns|telegram|discord|msteams|webex)_configs:|^\s*smtp_|^\s*(?:api_)?url:/im.test(
      source,
    )
  ) {
    add(errors, "Alertmanager contains an outbound notification receiver")
  }
  const receivers = [...source.matchAll(/^\s*- name: ([a-z0-9-]+)$/gm)].map(
    (match) => match[1],
  )
  if (!sameJson(receivers, ["local-null"])) {
    add(errors, "Alertmanager receiver set must be exactly local-null")
  }
  return errors
}

function iniValue(source, key) {
  return source.match(
    new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} = (.+)$`, "m"),
  )?.[1]
}

export function validateGrafana(
  grafana,
  datasource,
  dashboardProvider,
  folderSource,
  dashboardSource,
) {
  const errors = []
  const roleExpression =
    "contains(realm_access.roles[*], 'admin') && !contains(realm_access.roles[*], 'operator') && 'Editor'"
  const exactIniValues = new Map([
    ["auto_login", "true"],
    ["client_id", "grafana"],
    ["client_secret", "$__file{/run/secrets/llmm_grafana_oidc_client_secret}"],
    ["scopes", "openid profile email"],
    ["use_pkce", "true"],
    ["use_refresh_token", "true"],
    ["validate_id_token", "true"],
    ["login_attribute_path", "sub"],
    ["role_attribute_path", roleExpression],
    ["role_attribute_strict", "true"],
    ["skip_org_role_sync", "false"],
    ["allow_assign_grafana_admin", "false"],
    ["tls_skip_verify_insecure", "false"],
    ["login_maximum_inactive_lifetime_duration", "8h"],
    ["login_maximum_lifetime_duration", "24h"],
    ["token_rotation_interval_minutes", "10"],
    ["signout_redirect_url", "$__env{LLMM_GRAFANA_SIGNOUT_REDIRECT_URL}"],
    ["cookie_secure", "true"],
    ["cookie_samesite", "lax"],
    ["disable_plugins", "elasticsearch,tempo,zipkin"],
    ["disable_login_form", "true"],
  ])
  for (const [key, expected] of exactIniValues) {
    if (iniValue(grafana, key) !== expected) {
      add(errors, `Grafana ${key} must be exactly ${expected}`)
    }
  }
  if (!grafana.includes("[auth.generic_oauth]\nenabled = true")) {
    add(errors, "Grafana Generic OAuth must be enabled")
  }
  if (!grafana.includes("[unified_alerting]\nenabled = false")) {
    add(errors, "Grafana unified alerting must remain disabled")
  }
  for (const binding of [
    "auth_url = $__env{LLMM_KEYCLOAK_AUTH_URL}",
    "token_url = $__env{LLMM_KEYCLOAK_TOKEN_URL}",
    "api_url = $__env{LLMM_KEYCLOAK_USERINFO_URL}",
    "jwk_set_url = $__env{LLMM_KEYCLOAK_JWKS_URL}",
  ]) {
    if (!grafana.includes(binding)) add(errors, `Grafana is missing ${binding}`)
  }
  if (!grafana.includes("[auth.basic]\nenabled = false")) {
    add(errors, "Grafana basic authentication must be disabled")
  }
  if (!grafana.includes("[auth.anonymous]\nenabled = false")) {
    add(errors, "Grafana anonymous authentication must be disabled")
  }
  for (const required of [
    "url: $LLMM_PROMETHEUS_URL",
    "isDefault: true",
    "editable: false",
    "uid: llmm-prometheus",
  ]) {
    if (!datasource.includes(required))
      add(errors, `Grafana datasource is missing ${required}`)
  }
  for (const required of [
    "folder: ''",
    "disableDeletion: true",
    "allowUiUpdates: false",
    "path: /etc/grafana/provisioning/dashboards/baseline",
  ]) {
    if (!dashboardProvider.includes(required)) {
      add(errors, `Grafana baseline provider is missing ${required}`)
    }
  }
  const folder = parseJson(folderSource, "Grafana folder boundary", errors)
  if (
    folder?.baseline?.provisioned !== true ||
    folder?.baseline?.allowUiUpdates !== false ||
    folder?.baseline?.disableDeletion !== true ||
    folder?.baseline?.placement !== "grafana-root" ||
    folder?.baseline?.provider !== "llmm-baseline" ||
    folder?.customerEditable?.provisioned !== false ||
    folder?.customerEditable?.adminPermission !== "Edit" ||
    folder?.customerEditable?.operatorPermission !== "DENY" ||
    folder?.ossRoleBoundary?.adminOrgRole !== "Editor" ||
    folder?.ossRoleBoundary?.operatorOrgRole !== "DENY" ||
    folder?.ossRoleBoundary?.strictFolderOnlyEditing !== false
  ) {
    add(errors, "Grafana folder permissions do not match the OSS role boundary")
  }
  const dashboard = parseJson(
    dashboardSource,
    "Grafana baseline dashboard",
    errors,
  )
  if (dashboard) {
    if (
      dashboard.editable !== false ||
      !sameJson(dashboard.annotations, { list: [] }) ||
      !sameJson(dashboard.templating, { list: [] }) ||
      !sameJson(dashboard.links, [])
    ) {
      add(
        errors,
        "Grafana baseline dashboard must be locked and contain no annotations, variables, or links",
      )
    }
    for (const panel of dashboard.panels ?? []) {
      if (panel?.datasource?.uid !== "llmm-prometheus") {
        add(errors, "Grafana baseline panel uses an unreviewed datasource")
      }
      for (const target of panel.targets ?? []) {
        if (!allowedDashboardExpressions.has(target.expr)) {
          add(
            errors,
            `Grafana baseline panel uses an unreviewed expression ${target.expr}`,
          )
        }
      }
    }
  }
  return errors
}

export function validateHardwareGrafana(datasourceSource, dashboardSource) {
  const errors = []
  for (const required of [
    "url: $LLMM_HARDWARE_PROMETHEUS_URL",
    "isDefault: false",
    "editable: false",
    "uid: llmm-hardware-prometheus",
  ]) {
    if (!datasourceSource.includes(required)) {
      add(errors, `Grafana hardware datasource is missing ${required}`)
    }
  }

  const dashboard = parseJson(
    dashboardSource,
    "Grafana hardware dashboard",
    errors,
  )
  if (!dashboard) return errors

  if (
    dashboard.uid !== "llmm-infra-overview" ||
    dashboard.title !== "LLM Machines Infrastructure Overview" ||
    dashboard.editable !== false ||
    !sameJson(dashboard.annotations, { list: [] }) ||
    !sameJson(dashboard.templating, { list: [] }) ||
    !sameJson(dashboard.links, [])
  ) {
    add(
      errors,
      "Grafana hardware dashboard identity and locked provisioning must remain exact",
    )
  }

  const expressions = []
  for (const panel of dashboard.panels ?? []) {
    if (panel.type === "text") {
      if (
        panel.title !== "PDM telemetry" ||
        !panel.options?.content?.includes("stopped and unavailable")
      ) {
        add(errors, "PDM must remain explicitly stopped and unavailable")
      }
      continue
    }
    if (panel?.datasource?.uid !== "llmm-hardware-prometheus") {
      add(errors, "Grafana hardware panel uses an unreviewed datasource")
    }
    for (const target of panel.targets ?? []) {
      expressions.push(target.expr)
      if (target?.datasource?.uid !== "llmm-hardware-prometheus") {
        add(errors, "Grafana hardware query uses an unreviewed datasource")
      }
      if (!allowedHardwareDashboardExpressions.has(target.expr)) {
        add(
          errors,
          `Grafana hardware panel uses an unreviewed expression ${target.expr}`,
        )
      }
    }
  }
  if (
    expressions.length !== allowedHardwareDashboardExpressions.size ||
    new Set(expressions).size !== allowedHardwareDashboardExpressions.size
  ) {
    add(errors, "Grafana hardware expression set is incomplete or duplicated")
  }
  if (/DCGM_|llmm_nvidia/i.test(dashboardSource)) {
    add(errors, "historical NVIDIA or DCGM expressions are forbidden")
  }
  return errors
}

export function validateKeycloak(seedSource, commissioningSource) {
  const errors = []
  const seed = parseJson(seedSource, "Keycloak human-realm seed", errors)
  const commissioning = parseJson(
    commissioningSource,
    "Keycloak commissioning plan",
    errors,
  )
  if (!seed || !commissioning) return errors

  if (seed?.metadata?.changePackage !== "PR-09") {
    add(errors, "Keycloak human-realm seed must identify PR-09")
  }
  const clients = (seed.clients ?? []).filter(
    ({ clientId }) => clientId === "grafana",
  )
  if (clients.length !== 1 || !sameJson(clients[0], expectedGrafanaClient)) {
    add(
      errors,
      "Keycloak Grafana client does not match the exact reviewed contract",
    )
  }
  if (
    !sameJson(
      seed?.offlineAccessPolicy?.retainedClientOptionalScopes?.grafana,
      [],
    )
  ) {
    add(
      errors,
      "Keycloak Grafana client must not receive optional or offline scopes",
    )
  }
  const assertions = (commissioning.phases ?? []).flatMap(
    ({ completionAssertions }) => completionAssertions ?? [],
  )
  for (const assertion of [
    "grafana-client-is-confidential-and-credential-free-in-source",
    "grafana-client-uses-authorization-code-pkce-s256-only",
    "grafana-client-scope-is-limited-to-admin-and-operator",
    "grafana-admin-token-maps-to-Editor",
    "grafana-operator-native-login-is-denied",
    "grafana-unrecognized-role-is-denied",
    "grafana-admin-is-not-Grafana-Admin",
    "grafana-native-access-remains-inactive-until-F0-N5-admission",
  ]) {
    if (!assertions.includes(assertion)) {
      add(errors, `Keycloak commissioning is missing ${assertion}`)
    }
  }
  const offlineTest = (commissioning.tokenNegativeTests ?? []).find(
    ({ id }) => id === "offline-access-not-issued",
  )
  if (!(offlineTest?.requestingClients ?? []).includes("grafana")) {
    add(errors, "Keycloak offline-token negative test must cover Grafana")
  }
  return errors
}

export function validateProfile(overrides = {}) {
  const errors = []
  const sources = Object.fromEntries(
    Object.entries(profileFiles).map(([name, relative]) => [
      name,
      overrides[name] ?? read(relative),
    ]),
  )
  const actualFiles = listFiles(root)
  if (!sameJson(actualFiles, [...expectedFiles].sort())) {
    add(
      errors,
      "observability source file set contains a missing or unreviewed file",
    )
  }
  errors.push(...validatePublicSafety(sources))
  errors.push(...validateRuntimeContract(sources.runtimeContract))
  errors.push(...validatePrometheus(sources.prometheus, sources.targets))
  errors.push(...validateRules(sources.recordingRules, sources.alertRules))
  errors.push(...validateAlertmanager(sources.alertmanager))
  errors.push(
    ...validateHardwareGrafana(
      sources.hardwareDatasource,
      sources.hardwareDashboard,
    ),
  )
  errors.push(
    ...validateGrafana(
      sources.grafana,
      sources.datasource,
      sources.dashboardProvider,
      sources.folderBoundary,
      sources.dashboard,
    ),
  )
  errors.push(
    ...validateKeycloak(
      overrides.keycloakSeed ??
        readFileSync(
          path.join(
            repositoryRoot,
            "infra/keycloak/inference-core-realm-seed.json",
          ),
          "utf8",
        ),
      overrides.keycloakCommissioning ??
        readFileSync(
          path.join(
            repositoryRoot,
            "infra/keycloak/inference-core-commissioning.json",
          ),
          "utf8",
        ),
    ),
  )
  return errors
}

function main() {
  const errors = validateProfile()
  if (errors.length > 0) {
    process.stderr.write(`${errors.map((error) => `- ${error}`).join("\n")}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(
    `${JSON.stringify({ status: "pass", profile: "inference-core-observability-pr09", sourceOnly: true })}\n`,
  )
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main()
}
