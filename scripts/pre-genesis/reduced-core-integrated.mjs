import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createWriteStream } from "node:fs"
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { terminateProcessGroup } from "./process-group.mjs"
import { restoreWorkspaceBuildArtifacts } from "./workspace-artifacts.mjs"

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const keepRunning = process.argv.includes("--keep-running")
if (
  process.argv.slice(2).some((argument) => argument !== "--keep-running") ||
  process.argv.slice(2).length > 1
) {
  throw new Error("Usage: reduced-core-integrated.mjs [--keep-running]")
}
const nativeAmd64 = process.env.F0_UAT0_NATIVE_AMD64 === "true"
if (
  keepRunning &&
  (!nativeAmd64 || process.platform !== "linux" || process.arch !== "x64")
) {
  throw new Error("F0-UAT0 keep-running mode requires native Linux/amd64.")
}
const inventory = JSON.parse(
  await readFile(
    resolve(repositoryRoot, "infra/release/core-image-inventory.json"),
    "utf8",
  ),
)
const images = Object.fromEntries(
  [
    "alertmanager",
    "grafana-private",
    "product-edge",
    "product-postgresql",
    "prometheus",
  ].map((id) => [id, exactImage(id)]),
)
const runId = randomBytes(8).toString("hex")
const packageId = "F0-C1"
const firecrawlProfile = `llmm-f0-f2-${runId}`
const firecrawlDockerContext = nativeAmd64
  ? "default"
  : `colima-${firecrawlProfile}`
const network = `llmm-f0-c1-${runId}`
const postgresVolume = `llmm-f0-uat0-postgres-${runId}`
const containers = {
  alertmanager: `llmm-f0-c1-alertmanager-${runId}`,
  grafana: `llmm-f0-c1-grafana-${runId}`,
  metrics: `llmm-f0-c1-metrics-${runId}`,
  postgres: `llmm-f0-c1-postgres-${runId}`,
  prometheus: `llmm-f0-c1-prometheus-${runId}`,
}
const database = "llmm_f0_c1"
const databaseUser = "llmm_f0_c1"
const databasePassword = opaqueValue()
const grafanaOidcSecret = opaqueValue()
const cacheRoot = resolve(repositoryRoot, "node_modules/.cache")
await mkdir(cacheRoot, { mode: 0o700, recursive: true })
const browserTemporaryRoot = await realpath(tmpdir())
const stateRoot = keepRunning
  ? await createControlledUatStateRoot()
  : await mkdtemp(join(await realpath(cacheRoot), "llmm-f0-c1-integrated-"))
const files = {
  alertmanagerConfig: join(stateRoot, "alertmanager.yml"),
  browserState: keepRunning
    ? join(stateRoot, `llmm-f0-c1-browser-${runId}`)
    : join(browserTemporaryRoot, `llmm-f0-c1-browser-${runId}`),
  firecrawlControl: join(stateRoot, "firecrawl-control.json"),
  firecrawlState: join(stateRoot, "firecrawl-state"),
  firecrawlStop: join(stateRoot, "firecrawl.stop"),
  grafanaSecret: join(stateRoot, "grafana-oidc-secret"),
  grafanaProvisioning: join(stateRoot, "grafana-provisioning"),
  keycloakControl: join(stateRoot, "keycloak-control.json"),
  keycloakStop: join(stateRoot, "keycloak.stop"),
  liteLlmControl: join(stateRoot, "litellm-control.json"),
  liteLlmStop: join(stateRoot, "litellm.stop"),
  metricsConfig: join(stateRoot, "metrics-nginx.conf"),
  metricsPayload: join(stateRoot, "metrics"),
  observabilityControl: join(stateRoot, "observability-control.json"),
  postgresEnvironment: join(stateRoot, "postgres.env"),
  prometheusConfig: join(stateRoot, "prometheus.yml"),
  uatControl: join(stateRoot, "uat-control.json"),
  uatCredentials: join(stateRoot, "credentials.json"),
  uatStop: join(stateRoot, "uat.stop"),
  workspaceBuildBackup: join(stateRoot, "workspace-build-backup"),
}
const workspaceBuildArtifacts = [
  {
    backupName: "contracts-dist",
    path: resolve(repositoryRoot, "packages/contracts/dist"),
  },
  {
    backupName: "contracts-build-info",
    path: resolve(
      repositoryRoot,
      "packages/contracts/tsconfig.build.tsbuildinfo",
    ),
  },
  {
    backupName: "contracts-typecheck-info",
    path: resolve(repositoryRoot, "packages/contracts/tsconfig.tsbuildinfo"),
  },
  {
    backupName: "copy-dist",
    path: resolve(repositoryRoot, "packages/copy/dist"),
  },
  {
    backupName: "copy-build-info",
    path: resolve(repositoryRoot, "packages/copy/tsconfig.build.tsbuildinfo"),
  },
  {
    backupName: "copy-typecheck-info",
    path: resolve(repositoryRoot, "packages/copy/tsconfig.tsbuildinfo"),
  },
]
const workspaceBuildSnapshot = []
const created = {
  containers: new Set(),
  network: false,
  postgresVolume: false,
}
const services = []
const sensitiveValues = [databasePassword, grafanaOidcSecret]
let dockerContext = null
let evidence = null
let failure = null

try {
  await chmod(stateRoot, 0o700)
  await preserveWorkspaceBuildArtifacts()
  buildWorkspaceFixturePackages()
  const edgePort = await reservePort()
  await mkdir(files.firecrawlState, { mode: 0o700 })
  const firecrawl = startService(
    "firecrawl",
    {
      F0_C1_SERVICE_CONTROL_FILE: files.firecrawlControl,
      F0_C1_FIRECRAWL_RUN_ID: runId,
      F0_C1_SERVICE_STOP_FILE: files.firecrawlStop,
      F0_C1_SERVICE_STATE_ROOT: files.firecrawlState,
      ...(nativeAmd64
        ? {
            F0_UAT0_NATIVE_AMD64: "true",
            F0_UAT0_STATE_ROOT: stateRoot,
            PRE_GENESIS_DOCKER_CONTEXT: "default",
          }
        : {}),
    },
    "reduced-core-firecrawl-integration.mjs",
  )
  services.push(firecrawl)
  const firecrawlControl = await waitForControl(
    files.firecrawlControl,
    firecrawl,
    45 * 60_000,
  )
  dockerContext = exactDockerContext(firecrawlControl.dockerContext)
  assert.equal(dockerContext, firecrawlDockerContext)
  docker(["info", "--format", "{{.ServerVersion}}"])
  await startProductPostgres()

  const liteLlm = startService(
    "litellm",
    {
      F0_C1_SERVICE_CONTROL_FILE: files.liteLlmControl,
      F0_C1_SERVICE_STOP_FILE: files.liteLlmStop,
      PRE_GENESIS_DOCKER_CONTEXT: dockerContext,
    },
    "reduced-core-litellm-integration.mjs",
  )
  services.push(liteLlm)
  const liteLlmControl = await waitForControl(
    files.liteLlmControl,
    liteLlm,
    5 * 60_000,
  )
  sensitiveValues.push(
    liteLlmControl.adminKey,
    liteLlmControl.routingKey,
    ...Object.values(liteLlmControl.canaries),
  )

  const keycloak = startService(
    "keycloak",
    {
      F0_C1_EDGE_PORT: String(edgePort),
      F0_C1_SERVICE_CONTROL_FILE: files.keycloakControl,
      F0_C1_SERVICE_STOP_FILE: files.keycloakStop,
      PRE_GENESIS_DOCKER_CONTEXT: dockerContext,
    },
    "reduced-core-keycloak-identity.mjs",
  )
  services.push(keycloak)
  const keycloakControl = await waitForControl(
    files.keycloakControl,
    keycloak,
    5 * 60_000,
  )
  sensitiveValues.push(
    keycloakControl.credentials.admin.password,
    keycloakControl.credentials.admin.otpSecret,
    keycloakControl.credentials.operator.password,
    keycloakControl.credentials.operator.otpSecret,
    keycloakControl.credentials.bffService,
    keycloakControl.credentials.oidcClient,
  )

  await startMetricsFixture()
  const observabilityControl = await startObservability(edgePort)
  await writeFile(
    files.observabilityControl,
    `${JSON.stringify(observabilityControl)}\n`,
    { mode: 0o600 },
  )

  const databaseUrl = `postgresql://${databaseUser}:${encodeURIComponent(databasePassword)}@127.0.0.1:${postgresPort()}/${database}`
  const browser = await runBrowser({
    databaseUrl,
    firecrawlControl,
    keycloakControl,
    liteLlmControl,
  })
  assert.equal(browser.status, "passed")
  assert.equal(browser.evidenceClass, "LOCAL_INTEGRATED_REDUCED_CORE_ONLY")
  assert.equal(browser.runtimeQualified, false)

  const retention = await verifyProductRetention({
    firecrawlControl,
    keycloakControl,
    liteLlmControl,
  })
  evidence = {
    architecture: process.arch,
    browser,
    cleanupVerified: true,
    credentialMaterialPrinted: false,
    evidenceClass: "LOCAL_INTEGRATED_REDUCED_CORE_ONLY",
    exactImages: images,
    firecrawl: {
      defaultOff: true,
      private: true,
      sourceRevision: "ef12eb36b2f3382838dfe0a0c1a5add3d5df7fe5",
    },
    privateLoopbackControls: [
      "keycloak",
      "litellm",
      "postgresql",
      "prometheus",
      "alertmanager",
      "grafana",
      "firecrawl-bridge",
    ],
    retention,
    runtimeQualified: false,
    status: "passed",
  }
} catch (error) {
  failure = safeError(error)
} finally {
  const cleanupFailures = []
  await stopServiceByName("keycloak", files.keycloakStop, cleanupFailures)
  await stopServiceByName("litellm", files.liteLlmStop, cleanupFailures)
  for (const container of [
    containers.grafana,
    containers.alertmanager,
    containers.prometheus,
    containers.metrics,
    containers.postgres,
  ]) {
    if (created.containers.has(container)) {
      collectCleanup(cleanupFailures, () =>
        docker(["rm", "--force", container]),
      )
    }
  }
  if (created.network) {
    collectCleanup(cleanupFailures, () => docker(["network", "rm", network]))
  }
  if (created.postgresVolume) {
    collectCleanup(cleanupFailures, () =>
      docker(["volume", "rm", postgresVolume]),
    )
  }
  await stopServiceByName("firecrawl", files.firecrawlStop, cleanupFailures)
  for (const service of services) {
    if (!service.exited) {
      signalServiceGroup(service, "SIGTERM")
      await waitForExit(service, 5_000).catch(() => undefined)
    }
  }
  collectCleanup(cleanupFailures, cleanupFirecrawlProfile)
  await rm(files.browserState, { force: true, recursive: true })
  if (await exists(files.browserState)) {
    cleanupFailures.push(new Error("F0-C1 browser temporary state remains."))
  }
  for (const path of [
    files.firecrawlControl,
    files.keycloakControl,
    files.liteLlmControl,
    files.postgresEnvironment,
    files.grafanaSecret,
    files.uatControl,
    files.uatCredentials,
    files.uatStop,
  ]) {
    await rm(path, { force: true })
  }
  try {
    await assertStateFreeOfSensitiveValues(stateRoot, sensitiveValues)
  } catch (error) {
    cleanupFailures.push(safeError(error))
  }
  let workspaceArtifactsRestored = false
  try {
    await restoreWorkspaceBuildArtifacts(workspaceBuildSnapshot, { runId })
    workspaceArtifactsRestored = true
  } catch (error) {
    cleanupFailures.push(safeError(error))
  }
  if (workspaceArtifactsRestored) {
    await rm(stateRoot, { force: true, recursive: true })
  }
  if (workspaceArtifactsRestored && (await exists(stateRoot))) {
    cleanupFailures.push(new Error("F0-C1 temporary state remains."))
  }
  if (
    !workspaceArtifactsRestored &&
    !(await exists(files.workspaceBuildBackup))
  ) {
    cleanupFailures.push(
      new Error("F0-C1 workspace recovery backup is unavailable."),
    )
  }
  if (dockerContext) {
    for (const container of Object.values(containers)) {
      if (dockerResult(["inspect", container]).status === 0) {
        cleanupFailures.push(
          new Error(`F0-C1 container remains: ${container}.`),
        )
      }
    }
    if (dockerResult(["network", "inspect", network]).status === 0) {
      cleanupFailures.push(new Error("F0-C1 Docker network remains."))
    }
  }
  if (cleanupFailures.length > 0) {
    failure = new AggregateError(
      failure ? [failure, ...cleanupFailures] : cleanupFailures,
      "F0-C1 cleanup failed.",
    )
  }
}

if (failure) throw failure
assert.ok(evidence)
process.stdout.write(`${JSON.stringify(evidence)}\n`)

async function startProductPostgres() {
  const hostPort = await reservePort()
  await writeFile(
    files.postgresEnvironment,
    [
      `POSTGRES_DB=${database}`,
      `POSTGRES_PASSWORD=${databasePassword}`,
      `POSTGRES_USER=${databaseUser}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  )
  docker([
    "network",
    "create",
    "--label",
    `com.llm-machines.test-package=${packageId}`,
    network,
  ])
  created.network = true
  if (keepRunning) {
    docker([
      "volume",
      "create",
      "--label",
      "com.llm-machines.test-package=F0-C1",
      postgresVolume,
    ])
    created.postgresVolume = true
  }
  docker([
    "run",
    "--detach",
    "--name",
    containers.postgres,
    "--label",
    `com.llm-machines.test-package=${packageId}`,
    "--log-driver",
    "local",
    "--log-opt",
    "max-file=2",
    "--log-opt",
    "max-size=1m",
    "--network",
    network,
    "--network-alias",
    "product-postgres",
    "--env-file",
    files.postgresEnvironment,
    "--publish",
    `127.0.0.1:${hostPort}:5432`,
    ...(keepRunning
      ? [
          "--mount",
          `type=volume,source=${postgresVolume},target=/var/lib/postgresql/data`,
        ]
      : ["--tmpfs", "/var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=2g"]),
    images["product-postgresql"],
  ])
  created.containers.add(containers.postgres)
  const deadline = performance.now() + 90_000
  let postgresReady = false
  while (performance.now() < deadline) {
    if (
      dockerResult([
        "exec",
        containers.postgres,
        "pg_isready",
        "--host",
        "127.0.0.1",
        "--port",
        "5432",
        "--dbname",
        database,
        "--username",
        databaseUser,
      ]).status === 0
    ) {
      postgresReady = true
      break
    }
    await delay(250)
  }
  if (!postgresReady) {
    const logs = dockerResult(["logs", containers.postgres])
    throw new Error(
      `F0-C1 PostgreSQL did not become ready: ${sanitize(logs.stderr || logs.stdout)}`,
    )
  }
  const migration = await readFile(
    resolve(repositoryRoot, "infra/migrations/0000_inference_core.sql"),
    "utf8",
  )
  postgres(migration)
  const relations = Number.parseInt(
    postgres(`
      SELECT count(*)
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname IN ('common', 'admin')
        AND relation.relkind = 'r';
    `),
    10,
  )
  assert.equal(relations, 34)
}

async function startObservability(edgePort) {
  const prometheusHostPort = await reservePort()
  const alertmanagerHostPort = await reservePort()
  const grafanaHostPort = await reservePort()
  assert.equal(
    new Set([prometheusHostPort, alertmanagerHostPort, grafanaHostPort]).size,
    3,
  )
  await cp(
    resolve(repositoryRoot, "infra/observability/grafana/provisioning"),
    files.grafanaProvisioning,
    { recursive: true },
  )
  await cp(
    resolve(repositoryRoot, "infra/observability/grafana/dashboards/baseline"),
    join(files.grafanaProvisioning, "dashboards/baseline"),
    { recursive: true },
  )
  await Promise.all([
    writeFile(
      files.prometheusConfig,
      [
        "global:",
        "  scrape_interval: 1s",
        "  scrape_timeout: 1s",
        "scrape_configs:",
        "  - job_name: node",
        "    static_configs:",
        '      - targets: ["metrics-fixture:8080"]',
        "",
      ].join("\n"),
      { mode: 0o644 },
    ),
    writeFile(
      files.alertmanagerConfig,
      await readFile(
        resolve(
          repositoryRoot,
          "infra/observability/alertmanager/alertmanager.yml",
        ),
      ),
      { mode: 0o644 },
    ),
    writeFile(files.grafanaSecret, `${grafanaOidcSecret}\n`, { mode: 0o444 }),
  ])
  docker([
    "run",
    "--detach",
    "--name",
    containers.prometheus,
    "--label",
    `com.llm-machines.test-package=${packageId}`,
    "--log-driver",
    "local",
    "--log-opt",
    "max-file=2",
    "--log-opt",
    "max-size=1m",
    "--network",
    network,
    "--network-alias",
    "prometheus",
    "--publish",
    `127.0.0.1:${prometheusHostPort}:9090`,
    "--read-only",
    "--tmpfs",
    "/prometheus:rw,noexec,nosuid,nodev,size=512m,uid=65534,gid=65534,mode=0750",
    "--mount",
    `type=bind,source=${files.prometheusConfig},target=/etc/prometheus/prometheus.yml,readonly`,
    images.prometheus,
    "--config.file=/etc/prometheus/prometheus.yml",
    "--storage.tsdb.path=/prometheus",
    "--storage.tsdb.retention.time=1h",
  ])
  created.containers.add(containers.prometheus)
  docker([
    "run",
    "--detach",
    "--name",
    containers.alertmanager,
    "--label",
    `com.llm-machines.test-package=${packageId}`,
    "--log-driver",
    "local",
    "--log-opt",
    "max-file=2",
    "--log-opt",
    "max-size=1m",
    "--network",
    network,
    "--network-alias",
    "alertmanager",
    "--publish",
    `127.0.0.1:${alertmanagerHostPort}:9093`,
    "--read-only",
    "--tmpfs",
    "/alertmanager:rw,noexec,nosuid,nodev,size=128m,uid=65534,gid=65534,mode=0750",
    "--mount",
    `type=bind,source=${files.alertmanagerConfig},target=/etc/alertmanager/alertmanager.yml,readonly`,
    images.alertmanager,
    "--config.file=/etc/alertmanager/alertmanager.yml",
    "--storage.path=/alertmanager",
    "--data.retention=1h",
  ])
  created.containers.add(containers.alertmanager)
  const prometheusBaseUrl = `http://127.0.0.1:${prometheusHostPort}`
  const alertmanagerBaseUrl = `http://127.0.0.1:${alertmanagerHostPort}`
  await waitForHttp(`${prometheusBaseUrl}/-/ready`, 120_000)
  await waitForHttp(`${alertmanagerBaseUrl}/-/ready`, 120_000)
  await postAlert(alertmanagerBaseUrl)

  docker([
    "run",
    "--detach",
    "--name",
    containers.grafana,
    "--label",
    `com.llm-machines.test-package=${packageId}`,
    "--log-driver",
    "local",
    "--log-opt",
    "max-file=2",
    "--log-opt",
    "max-size=1m",
    "--network",
    network,
    "--network-alias",
    "grafana",
    "--publish",
    `127.0.0.1:${grafanaHostPort}:3000`,
    "--read-only",
    "--tmpfs",
    "/var/lib/grafana:rw,noexec,nosuid,nodev,size=256m,uid=472,gid=0,mode=0750",
    "--tmpfs",
    "/var/log/grafana:rw,noexec,nosuid,nodev,size=64m,uid=472,gid=0,mode=0750",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777",
    "--mount",
    `type=bind,source=${resolve(repositoryRoot, "infra/observability/grafana/grafana.ini")},target=/etc/grafana/grafana.ini,readonly`,
    "--mount",
    `type=bind,source=${files.grafanaProvisioning},target=/etc/grafana/provisioning,readonly`,
    "--mount",
    `type=bind,source=${files.grafanaSecret},target=/run/secrets/llmm_grafana_oidc_client_secret,readonly`,
    "--env",
    `LLMM_KEYCLOAK_AUTH_URL=https://identity.llmm.test:${edgePort}/realms/llm-machines/protocol/openid-connect/auth`,
    "--env",
    `LLMM_KEYCLOAK_JWKS_URL=https://identity.llmm.test:${edgePort}/realms/llm-machines/protocol/openid-connect/certs`,
    "--env",
    `LLMM_KEYCLOAK_TOKEN_URL=https://identity.llmm.test:${edgePort}/realms/llm-machines/protocol/openid-connect/token`,
    "--env",
    `LLMM_KEYCLOAK_USERINFO_URL=https://identity.llmm.test:${edgePort}/realms/llm-machines/protocol/openid-connect/userinfo`,
    "--env",
    "LLMM_PROMETHEUS_URL=http://prometheus:9090",
    images["grafana-private"],
  ])
  created.containers.add(containers.grafana)
  const grafanaBaseUrl = `http://127.0.0.1:${grafanaHostPort}`
  await waitForHttp(`${grafanaBaseUrl}/api/health`, 120_000)
  await waitForPrometheusSignals(prometheusBaseUrl)
  return { alertmanagerBaseUrl, grafanaBaseUrl, prometheusBaseUrl }
}

async function runBrowser({
  databaseUrl,
  firecrawlControl,
  keycloakControl,
  liteLlmControl,
}) {
  await mkdir(files.browserState, { mode: 0o700 })
  const result = await runChild(
    process.execPath,
    [
      resolve(
        repositoryRoot,
        "scripts/pre-genesis/reduced-core-browser-session.mjs",
      ),
      "--integrated-core",
    ],
    {
      F0_C1_FIRECRAWL_CONFIG_FILE: files.firecrawlControl,
      F0_C1_OBSERVABILITY_CONFIG_FILE: files.observabilityControl,
      F0_C1_BROWSER_STATE_ROOT: files.browserState,
      F0_C1_BROWSER_TEMP_ROOT: keepRunning ? stateRoot : browserTemporaryRoot,
      F0_I1_KEYCLOAK_CONFIG_FILE: files.keycloakControl,
      F0_L2_LITELLM_CONFIG_FILE: files.liteLlmControl,
      F0_P1_DATABASE_URL: databaseUrl,
      F0_P1_DOCKER_CONTEXT: dockerContext,
      F0_P1_POSTGRES_CONTAINER: containers.postgres,
      F0_P1_POSTGRES_DB: database,
      F0_P1_POSTGRES_USER: databaseUser,
      ...(keepRunning
        ? {
            F0_UAT0_CONTROL_FILE: files.uatControl,
            F0_UAT0_CREDENTIAL_FILE: files.uatCredentials,
            F0_UAT0_OUTER_INVENTORY: JSON.stringify({
              containers,
              network,
              postgresVolume,
            }),
            F0_UAT0_STOP_FILE: files.uatStop,
          }
        : {}),
      PLAYWRIGHT_CHROME_EXECUTABLE:
        process.env.PLAYWRIGHT_CHROME_EXECUTABLE ?? "",
    },
    keepRunning ? null : 25 * 60_000,
  )
  if (result.timedOut && !result.processGroupRemoved) {
    throw new Error("F0-C1 browser proof left its process group running.")
  }
  if (result.status !== 0) {
    throw new Error(
      `F0-C1 browser proof failed: ${sanitize(result.stderr || result.stdout)}`,
    )
  }
  const parsed = JSON.parse(result.stdout.trim().split("\n").at(-1))
  assert.equal(keycloakControl.edgePort > 0, true)
  assert.equal(liteLlmControl.baseUrl.startsWith("http://127.0.0.1:"), true)
  assert.equal(firecrawlControl.baseUrl.startsWith("http://127.0.0.1:"), true)
  return parsed
}

async function verifyProductRetention({
  firecrawlControl,
  keycloakControl,
  liteLlmControl,
}) {
  const dump = docker([
    "exec",
    containers.postgres,
    "pg_dump",
    "--data-only",
    "--no-owner",
    "--no-privileges",
    "--dbname",
    database,
    "--username",
    databaseUser,
  ])
  assertNoSensitive([dump], sensitiveValues)
  for (const service of services) {
    const [stdout, stderr] = await Promise.all([
      readFile(service.stdoutPath, "utf8"),
      readFile(service.stderrPath, "utf8"),
    ])
    assertNoSensitive([stdout, stderr], sensitiveValues)
  }
  const firecrawlContainers = new Set(
    Object.values(firecrawlControl.containers ?? {}),
  )
  const inspectedContainers = new Set([
    ...created.containers,
    keycloakControl.container,
    liteLlmControl.container,
    ...firecrawlContainers,
  ])
  for (const container of inspectedContainers) {
    assert.equal(typeof container, "string")
    const logDriver = docker([
      "inspect",
      "--format",
      "{{.HostConfig.LogConfig.Type}}",
      container,
    ]).trim()
    if (logDriver === "none") {
      if (!firecrawlContainers.has(container)) {
        throw new Error(`F0-C1 could not inspect logs for ${container}.`)
      }
      continue
    }
    assert.ok(["json-file", "local"].includes(logDriver))
    const logs = dockerResult(["logs", container])
    if (logs.status !== 0) {
      throw new Error(`F0-C1 could not read logs for ${container}.`)
    }
    assertNoSensitive([logs.stdout, logs.stderr], sensitiveValues)
  }
  return {
    browserAndProductLogs: "canaries-absent",
    postgres: "metadata-only",
    temporaryState: "removed-on-exit",
    workloadContentCanaries: 0,
  }
}

function startService(name, extraEnvironment, script) {
  const stdoutPath = join(stateRoot, `${name}.stdout.log`)
  const stderrPath = join(stateRoot, `${name}.stderr.log`)
  const stdout = createWriteStream(stdoutPath, { mode: 0o600 })
  const stderr = createWriteStream(stderrPath, { mode: 0o600 })
  const child = spawn(
    process.execPath,
    [resolve(repositoryRoot, "scripts/pre-genesis", script)],
    {
      cwd: repositoryRoot,
      env: commandEnvironment(extraEnvironment),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  const record = {
    child,
    exited: false,
    exitStatus: null,
    name,
    ready: false,
    stderr,
    stderrPath,
    stdout,
    stdoutPath,
  }
  child.stdout.pipe(stdout)
  child.stderr.pipe(stderr)
  child.once("exit", (status) => {
    record.exited = true
    record.exitStatus = status
  })
  return record
}

async function waitForControl(path, service, timeout) {
  const deadline = performance.now() + timeout
  while (performance.now() < deadline) {
    if (service.exited) {
      throw new Error(
        `${service.name} exited before readiness: ${await serviceDiagnostics(service)}`,
      )
    }
    try {
      const value = JSON.parse(await readFile(path, "utf8"))
      service.ready = true
      return value
    } catch {}
    await delay(250)
  }
  throw new Error(`${service.name} did not publish F0-C1 readiness.`)
}

async function stopServiceByName(name, stopFile, failures) {
  const service = services.find((candidate) => candidate.name === name)
  if (!service) return
  try {
    if (!service.exited) {
      await writeFile(stopFile, "stop\n", { mode: 0o600 })
      try {
        const gracefulTimeout =
          service.name === "firecrawl" && service.ready ? 10 * 60_000 : 30_000
        await waitForExit(service, gracefulTimeout)
      } catch {
        signalServiceGroup(service, "SIGTERM")
        await waitForExit(service, 10_000).catch(() => undefined)
        if (!service.exited) {
          signalServiceGroup(service, "SIGKILL")
          await waitForExit(service, 5_000).catch(() => undefined)
        }
        throw new Error(`${service.name} required forced termination.`)
      }
    }
    await Promise.all([endStream(service.stdout), endStream(service.stderr)])
    if (service.exitStatus !== 0) {
      throw new Error(
        `${service.name} cleanup failed: ${await serviceDiagnostics(service)}`,
      )
    }
  } catch (error) {
    failures.push(safeError(error))
  }
}

function signalServiceGroup(service, signal) {
  if (service.exited) return
  try {
    process.kill(-service.child.pid, signal)
  } catch (error) {
    if (error?.code !== "ESRCH") throw error
  }
}

function cleanupFirecrawlProfile() {
  if (nativeAmd64) return
  if (!colimaProfiles().has(firecrawlProfile)) return
  const result = spawnSync(
    "colima",
    ["delete", "--profile", firecrawlProfile, "--data", "--force"],
    {
      encoding: "utf8",
      env: commandEnvironment(),
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  if (result.status !== 0) {
    throw new Error(
      `F0-C1 could not remove its Firecrawl profile: ${sanitize(result.stderr || result.stdout)}`,
    )
  }
  if (colimaProfiles().has(firecrawlProfile)) {
    throw new Error("F0-C1 Firecrawl profile remains after cleanup.")
  }
}

function colimaProfiles() {
  const result = spawnSync("colima", ["list", "--json"], {
    encoding: "utf8",
    env: commandEnvironment(),
    maxBuffer: 8 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(
      `F0-C1 could not enumerate Colima profiles: ${sanitize(result.stderr || result.stdout)}`,
    )
  }
  return new Set(
    result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line).name),
  )
}

function waitForExit(service, timeout) {
  if (service.exited) return Promise.resolve(service.exitStatus)
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(
      () => rejectExit(new Error(`${service.name} did not exit.`)),
      timeout,
    )
    service.child.once("exit", (status) => {
      clearTimeout(timer)
      resolveExit(status)
    })
  })
}

async function serviceDiagnostics(service) {
  const [stdout, stderr] = await Promise.all([
    readFile(service.stdoutPath, "utf8").catch(() => ""),
    readFile(service.stderrPath, "utf8").catch(() => ""),
  ])
  return sanitize(`${stderr}\n${stdout}`)
}

async function startMetricsFixture() {
  await Promise.all([
    writeFile(
      files.metricsConfig,
      [
        "pid /tmp/nginx.pid;",
        "error_log /dev/stderr warn;",
        "events {}",
        "http {",
        "  access_log off;",
        "  client_body_temp_path /tmp/client_temp;",
        "  proxy_temp_path /tmp/proxy_temp;",
        "  fastcgi_temp_path /tmp/fastcgi_temp;",
        "  uwsgi_temp_path /tmp/uwsgi_temp;",
        "  scgi_temp_path /tmp/scgi_temp;",
        "  server {",
        "    listen 8080;",
        "    location = /metrics { root /srv; default_type text/plain; }",
        "    location / { return 404; }",
        "  }",
        "}",
        "",
      ].join("\n"),
      { mode: 0o644 },
    ),
    writeFile(files.metricsPayload, metricsPayload(), { mode: 0o644 }),
  ])
  docker([
    "run",
    "--detach",
    "--name",
    containers.metrics,
    "--label",
    `com.llm-machines.test-package=${packageId}`,
    "--log-driver",
    "local",
    "--log-opt",
    "max-file=2",
    "--log-opt",
    "max-size=1m",
    "--network",
    network,
    "--network-alias",
    "metrics-fixture",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=16m,uid=101,gid=101,mode=0700",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges=true",
    "--user",
    "101:101",
    "--mount",
    `type=bind,source=${files.metricsConfig},target=/etc/llmm/nginx.conf,readonly`,
    "--mount",
    `type=bind,source=${files.metricsPayload},target=/srv/metrics,readonly`,
    "--entrypoint",
    "/usr/sbin/nginx",
    images["product-edge"],
    "-c",
    "/etc/llmm/nginx.conf",
    "-g",
    "daemon off;",
  ])
  created.containers.add(containers.metrics)
  await waitForMetricsFixture()
}

function metricsPayload() {
  return [
    "# TYPE node_cpu_seconds_total counter",
    'node_cpu_seconds_total{cpu="0",host="core-a",job="node",mode="idle"} 1000',
    "# TYPE node_memory_MemAvailable_bytes gauge",
    'node_memory_MemAvailable_bytes{host="core-a",job="node"} 17179869184',
    "# TYPE node_memory_MemTotal_bytes gauge",
    'node_memory_MemTotal_bytes{host="core-a",job="node"} 34359738368',
    "# TYPE node_filesystem_avail_bytes gauge",
    'node_filesystem_avail_bytes{device="/dev/vda1",fstype="zfs",host="core-a",job="node",mountpoint="/"} 53687091200',
    "# TYPE node_filesystem_size_bytes gauge",
    'node_filesystem_size_bytes{device="/dev/vda1",fstype="zfs",host="core-a",job="node",mountpoint="/"} 107374182400',
    "# TYPE DCGM_FI_DEV_GPU_TEMP gauge",
    'DCGM_FI_DEV_GPU_TEMP{gpu="0",host="inference-a"} 55',
    "# TYPE DCGM_FI_DEV_GPU_UTIL gauge",
    'DCGM_FI_DEV_GPU_UTIL{gpu="0",host="inference-a"} 42',
    "# TYPE ipmi_dcmi_power_consumption_watts gauge",
    'ipmi_dcmi_power_consumption_watts{host="compute-node-a"} 410',
    "# TYPE node_network_receive_bytes_total counter",
    'node_network_receive_bytes_total{device="eth0",host="core-a",job="node"} 1000000',
    "# TYPE node_network_transmit_bytes_total counter",
    'node_network_transmit_bytes_total{device="eth0",host="core-a",job="node"} 2000000',
    "",
  ].join("\n")
}

async function waitForMetricsFixture() {
  const deadline = performance.now() + 30_000
  while (performance.now() < deadline) {
    const result = dockerResult([
      "exec",
      containers.metrics,
      "wget",
      "-qO-",
      "http://127.0.0.1:8080/metrics",
    ])
    if (
      result.status === 0 &&
      result.stdout.includes("node_cpu_seconds_total")
    ) {
      return
    }
    await delay(250)
  }
  const logs = dockerResult(["logs", containers.metrics])
  throw new Error(
    `F0-C1 private metrics fixture did not become ready: ${sanitize(logs.stderr || logs.stdout)}`,
  )
}

async function postAlert(baseUrl) {
  const now = Date.now()
  const response = await fetch(`${baseUrl}/api/v2/alerts`, {
    body: JSON.stringify([
      {
        annotations: { summary: "Disposable Core warning" },
        endsAt: new Date(now + 10 * 60_000).toISOString(),
        labels: {
          alertname: "F0C1CoreWarning",
          component: "core",
          severity: "warning",
        },
        startsAt: new Date(now - 1_000).toISOString(),
      },
    ]),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  })
  assert.equal(response.status, 200)
}

async function waitForPrometheusSignals(baseUrl) {
  const deadline = performance.now() + 30_000
  while (performance.now() < deadline) {
    const response = await fetch(
      `${baseUrl}/api/v1/query?query=${encodeURIComponent('up{job="node"}')}`,
      { signal: AbortSignal.timeout(2_000) },
    ).catch(() => null)
    if (response?.ok) {
      const value = await response.json()
      if (
        value?.data?.result?.some(
          (sample) => Array.isArray(sample.value) && sample.value[1] === "1",
        )
      ) {
        await delay(2_500)
        return
      }
    }
    await delay(500)
  }
  throw new Error("F0-C1 Prometheus did not scrape its fixture.")
}

function postgres(sql) {
  const result = dockerResult(
    [
      "exec",
      "--interactive",
      containers.postgres,
      "psql",
      "--no-align",
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--tuples-only",
      "--dbname",
      database,
      "--username",
      databaseUser,
    ],
    sql,
  )
  if (result.status !== 0) {
    throw new Error(
      `F0-C1 PostgreSQL command failed: ${sanitize(result.stderr)}`,
    )
  }
  return result.stdout.trim()
}

function postgresPort() {
  return containerPort(containers.postgres, 5432)
}

function containerPort(container, port) {
  const output = docker(["port", container, `${port}/tcp`]).trim()
  const match = output.match(/127\.0\.0\.1:(\d+)$/m)
  if (!match) throw new Error(`F0-C1 could not resolve ${container} port.`)
  return Number.parseInt(match[1], 10)
}

function exactImage(id) {
  const component = inventory.components.find((entry) => entry.id === id)
  if (
    !component?.repository ||
    !component.version ||
    !/^sha256:[a-f0-9]{64}$/.test(component.indexDigest)
  ) {
    throw new Error(`F0-C1 lacks an immutable ${id} image.`)
  }
  return `${component.repository}:${component.version}@${component.indexDigest}`
}

function exactDockerContext(value) {
  if (nativeAmd64) {
    if (value !== "default") {
      throw new Error("F0-C1 rejected the native Docker context.")
    }
    return value
  }
  if (
    typeof value !== "string" ||
    !/^colima-llmm-f0-f2-[a-f0-9]{16}$/.test(value)
  ) {
    throw new Error("F0-C1 rejected the disposable Docker context.")
  }
  return value
}

function docker(arguments_, input) {
  const result = dockerResult(arguments_, input)
  if (result.status !== 0) {
    throw new Error(
      `F0-C1 Docker command failed: ${sanitize(result.stderr || result.stdout)}`,
    )
  }
  return result.stdout
}

function dockerResult(arguments_, input) {
  assert.ok(dockerContext)
  return spawnSync("docker", ["--context", dockerContext, ...arguments_], {
    encoding: "utf8",
    env: commandEnvironment(),
    input,
    maxBuffer: 256 * 1024 * 1024,
  })
}

function runChild(command, arguments_, environment, timeout) {
  return new Promise((resolveChild, rejectChild) => {
    const child = spawn(command, arguments_, {
      cwd: repositoryRoot,
      detached: true,
      env: commandEnvironment(environment),
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let terminationPromise = null
    let timedOut = false
    const terminate = () => {
      if (timedOut) return
      timedOut = true
      terminationPromise = terminateProcessGroup(child.pid).then(
        (removed) => ({ error: null, removed }),
        (error) => ({ error, removed: false }),
      )
    }
    child.stdout.on("data", (chunk) => {
      stdout += chunk
      if (stdout.length > 64 * 1024 * 1024) terminate()
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
      if (stderr.length > 64 * 1024 * 1024) terminate()
    })
    const timer = timeout === null ? null : setTimeout(terminate, timeout)
    child.once("error", rejectChild)
    child.once("exit", async (status) => {
      if (timer) clearTimeout(timer)
      const termination = timedOut
        ? await terminationPromise
        : { error: null, removed: true }
      if (termination.error) {
        rejectChild(termination.error)
        return
      }
      resolveChild({
        processGroupRemoved: termination.removed,
        status,
        stderr,
        stdout,
        timedOut,
      })
    })
  })
}

async function createControlledUatStateRoot() {
  const controlled = process.env.F0_UAT0_STATE_ROOT?.trim()
  if (!controlled || !isAbsolute(controlled)) {
    throw new Error("F0-UAT0 requires an absolute runtime state root.")
  }
  const repository = await realpath(repositoryRoot)
  const candidate = resolve(controlled)
  const fromRepository = relative(repository, candidate)
  if (
    fromRepository === "" ||
    (!fromRepository.startsWith(`..${sep}`) && fromRepository !== "..")
  ) {
    throw new Error("F0-UAT0 state must remain outside the source worktree.")
  }
  await mkdir(dirname(candidate), { mode: 0o700, recursive: true })
  await mkdir(candidate, { mode: 0o700 })
  return realpath(candidate)
}

function commandEnvironment(extra = {}) {
  return {
    HOME: process.env.HOME ?? "",
    LANG: "C",
    LC_ALL: "C",
    PATH: process.env.PATH ?? "",
    ...extra,
  }
}

function buildWorkspaceFixturePackages() {
  for (const packageName of ["@llm-machines/contracts", "@llm-machines/copy"]) {
    const result = spawnSync(
      "corepack",
      ["pnpm", "--filter", packageName, "--fail-if-no-match", "build"],
      {
        cwd: repositoryRoot,
        env: commandEnvironment(),
        stdio: "inherit",
      },
    )
    if (result.status !== 0) {
      throw new Error(`F0-C1 could not build ${packageName}.`)
    }
  }
}

async function preserveWorkspaceBuildArtifacts() {
  await mkdir(files.workspaceBuildBackup, { mode: 0o700, recursive: true })
  for (const artifact of workspaceBuildArtifacts) {
    const backup = join(files.workspaceBuildBackup, artifact.backupName)
    const existed = await exists(artifact.path)
    if (existed) {
      const pending = `${backup}.pending`
      await cp(artifact.path, pending, {
        preserveTimestamps: true,
        recursive: true,
      })
      await rename(pending, backup)
    }
    workspaceBuildSnapshot.push({ ...artifact, backup, existed })
  }
}

function collectCleanup(failures, operation) {
  try {
    operation()
  } catch (error) {
    failures.push(safeError(error))
  }
}

async function assertStateFreeOfSensitiveValues(root, values) {
  for (const path of await collectFiles(root)) {
    const content = await readFile(path)
    for (const value of values.filter(Boolean)) {
      assert.equal(
        content.includes(Buffer.from(value)),
        false,
        `F0-C1 retained sensitive material in ${path}.`,
      )
    }
  }
}

async function collectFiles(root) {
  const output = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) output.push(...(await collectFiles(path)))
    else if (entry.isFile() && (await stat(path)).size <= 8 * 1024 * 1024) {
      output.push(path)
    }
  }
  return output
}

function assertNoSensitive(values, sensitive) {
  for (const value of values) {
    for (const secret of sensitive.filter(Boolean)) {
      if (String(value).includes(secret)) {
        throw new Error("F0-C1 retained workload or credential content.")
      }
    }
  }
}

async function waitForHttp(url, timeout) {
  const deadline = performance.now() + timeout
  while (performance.now() < deadline) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(2_000),
    }).catch(() => null)
    if (response?.ok) return
    await delay(500)
  }
  throw new Error(
    `F0-C1 service did not become ready: ${new URL(url).pathname}`,
  )
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen)
    server.listen(0, "127.0.0.1", resolveListen)
  })
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : null
  await closeServer(server)
  assert.ok(Number.isSafeInteger(port))
  return port
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()))
    server.closeAllConnections?.()
  })
}

function endStream(stream) {
  if (stream.closed) return Promise.resolve()
  return new Promise((resolveEnd) => {
    stream.once("close", resolveEnd)
    stream.end()
  })
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function opaqueValue() {
  return randomBytes(32).toString("base64url")
}

function sanitize(value) {
  let output = String(value ?? "")
  for (const sensitive of sensitiveValues.filter(Boolean)) {
    output = output.replaceAll(sensitive, "[redacted]")
  }
  return output
    .replaceAll(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replaceAll(/[A-Za-z0-9_-]{43,}/g, "[opaque]")
    .slice(-12_000)
}

function safeError(error) {
  return new Error(
    sanitize(error instanceof Error ? (error.stack ?? error.message) : error),
  )
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}
