import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const POSTGRES_IMAGE =
  "docker.io/library/postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3"
const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const dockerContext = process.env.PRE_GENESIS_DOCKER_CONTEXT?.trim() || null
const runId = randomBytes(8).toString("hex")
const containerName = `llmm-f0-p1-postgres-${runId}`
const volumeName = `llmm-f0-p1-postgres-${runId}`
const databaseName = "llmm_f0_p1"
const databaseUser = "llmm_f0_p1"
const databasePassword = randomBytes(32).toString("base64url")
const stateRoot = await mkdtemp(
  join(await realpath(tmpdir()), "llmm-f0-p1-postgres-"),
)
const environmentFile = join(stateRoot, "postgres.env")
let containerCreated = false
let volumeCreated = false
let evidence
let failure

try {
  await chmod(stateRoot, 0o700)
  await writeFile(
    environmentFile,
    [
      `POSTGRES_DB=${databaseName}`,
      `POSTGRES_PASSWORD=${databasePassword}`,
      `POSTGRES_USER=${databaseUser}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  )
  docker(["info", "--format", "{{.ServerVersion}}"])
  docker([
    "volume",
    "create",
    "--label",
    "com.llm-machines.test-package=F0-P1",
    volumeName,
  ])
  volumeCreated = true
  docker([
    "run",
    "--detach",
    "--name",
    containerName,
    "--label",
    "com.llm-machines.test-package=F0-P1",
    "--env-file",
    environmentFile,
    "--publish",
    "127.0.0.1::5432",
    "--mount",
    `type=volume,source=${volumeName},target=/var/lib/postgresql/data`,
    POSTGRES_IMAGE,
  ])
  containerCreated = true
  await waitForPostgres()

  const migration = await readFile(
    resolve(repositoryRoot, "infra/migrations/0000_inference_core.sql"),
    "utf8",
  )
  const emptySchemaCount = Number.parseInt(
    psql(
      "SELECT count(*) FROM pg_namespace WHERE nspname IN ('common','admin');",
    ),
    10,
  )
  assert.equal(emptySchemaCount, 0)
  psql(migration)
  const relationCount = requiredRelationCount()
  assert.equal(relationCount, 34)

  const repeatedMigration = psqlResult(migration)
  assert.notEqual(
    repeatedMigration.status,
    0,
    "Reapplying the initial migration unexpectedly succeeded.",
  )
  assert.equal(requiredRelationCount(), relationCount)

  const mappedPort = postgresPort()
  const databaseUrl = `postgresql://${databaseUser}:${encodeURIComponent(databasePassword)}@127.0.0.1:${mappedPort}/${databaseName}`
  const browser = spawnSync(
    process.execPath,
    [
      resolve(
        repositoryRoot,
        "scripts/pre-genesis/reduced-core-browser-session.mjs",
      ),
      "--postgres-persistence",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: browserEnvironment(databaseUrl),
      maxBuffer: 64 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
    },
  )
  if (browser.status !== 0) {
    throw new Error(
      `F0-P1 browser persistence proof failed: ${sanitize(browser.stderr || browser.stdout)}`,
    )
  }
  const browserEvidence = JSON.parse(browser.stdout.trim().split("\n").at(-1))
  assert.equal(browserEvidence.status, "passed")
  assert.equal(
    browserEvidence.evidenceClass,
    "LOCAL_POSTGRES_RESTART_PERSISTENCE_ONLY",
  )
  evidence = {
    architecture: process.arch,
    browser: browserEvidence,
    credentialMaterialPrinted: false,
    evidenceClass: "LOCAL_POSTGRES_RESTART_PERSISTENCE_ONLY",
    failedMigrationRollback: "passed",
    migration: {
      emptyInitialization: "passed",
      requiredRelationCount: relationCount,
    },
    postgresImage: POSTGRES_IMAGE,
    status: "passed",
    temporaryStateRemoved: true,
  }
} catch (error) {
  const containerLogs = containerCreated
    ? dockerResult(["logs", "--tail", "200", containerName])
    : null
  const diagnostic =
    containerLogs && (containerLogs.stdout || containerLogs.stderr)
      ? new Error(
          `F0-P1 PostgreSQL metadata:\n${sanitize(`${containerLogs.stdout}\n${containerLogs.stderr}`)}`,
        )
      : null
  failure = diagnostic
    ? new AggregateError([safeError(error), diagnostic], "F0-P1 failed.")
    : safeError(error)
} finally {
  const cleanupFailures = []
  if (containerCreated) {
    const result = dockerResult(["rm", "--force", containerName])
    if (result.status !== 0) cleanupFailures.push(safeError(result.stderr))
  }
  if (volumeCreated) {
    const result = dockerResult(["volume", "rm", volumeName])
    if (result.status !== 0) cleanupFailures.push(safeError(result.stderr))
  }
  await rm(environmentFile, { force: true })
  try {
    await assertTemporaryFilesSecretFree(stateRoot, [databasePassword])
  } catch (error) {
    cleanupFailures.push(safeError(error))
  }
  await rm(stateRoot, { force: true, recursive: true })
  if (
    containerCreated &&
    dockerResult(["inspect", containerName]).status === 0
  ) {
    cleanupFailures.push(new Error("F0-P1 PostgreSQL container remains."))
  }
  if (
    volumeCreated &&
    dockerResult(["volume", "inspect", volumeName]).status === 0
  ) {
    cleanupFailures.push(new Error("F0-P1 PostgreSQL volume remains."))
  }
  if (cleanupFailures.length > 0) {
    failure = new AggregateError(
      failure ? [failure, ...cleanupFailures] : cleanupFailures,
      "F0-P1 PostgreSQL cleanup failed.",
    )
  }
}

if (failure) throw failure
assert.ok(evidence)
process.stdout.write(`${JSON.stringify(evidence)}\n`)

function browserEnvironment(databaseUrl) {
  const environment = {
    F0_P1_DATABASE_URL: databaseUrl,
    F0_P1_POSTGRES_CONTAINER: containerName,
    F0_P1_POSTGRES_DB: databaseName,
    F0_P1_POSTGRES_USER: databaseUser,
    LANG: "C",
    LC_ALL: "C",
    PATH: process.env.PATH ?? "",
  }
  if (dockerContext) {
    environment.F0_P1_DOCKER_CONTEXT = dockerContext
  }
  if (process.env.PLAYWRIGHT_CHROME_EXECUTABLE) {
    environment.PLAYWRIGHT_CHROME_EXECUTABLE =
      process.env.PLAYWRIGHT_CHROME_EXECUTABLE
  }
  return environment
}

function requiredRelationCount() {
  return Number.parseInt(
    psql(`
      SELECT count(*)
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname IN ('common', 'admin')
        AND relation.relkind = 'r';
    `),
    10,
  )
}

function postgresPort() {
  const output = docker(["port", containerName, "5432/tcp"]).trim()
  const match = output.match(/127\.0\.0\.1:(\d+)$/m)
  if (!match) throw new Error("F0-P1 could not resolve the PostgreSQL port.")
  return Number.parseInt(match[1], 10)
}

async function waitForPostgres() {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const result = dockerResult([
      "exec",
      containerName,
      "pg_isready",
      "--dbname",
      databaseName,
      "--username",
      databaseUser,
    ])
    if (result.status === 0) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error("F0-P1 PostgreSQL did not become ready.")
}

function psql(sql) {
  const result = psqlResult(sql)
  if (result.status !== 0) {
    throw new Error(
      `F0-P1 PostgreSQL command failed: ${sanitize(result.stderr)}`,
    )
  }
  return result.stdout.trim()
}

function psqlResult(sql) {
  return dockerResult(
    [
      "exec",
      "--interactive",
      containerName,
      "psql",
      "--no-align",
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--tuples-only",
      "--dbname",
      databaseName,
      "--username",
      databaseUser,
    ],
    sql,
  )
}

function docker(arguments_, input) {
  const result = dockerResult(arguments_, input)
  if (result.status !== 0) {
    throw new Error(`F0-P1 Docker command failed: ${sanitize(result.stderr)}`)
  }
  return result.stdout
}

function dockerResult(arguments_, input) {
  return spawnSync(
    "docker",
    [...(dockerContext ? ["--context", dockerContext] : []), ...arguments_],
    {
      encoding: "utf8",
      env: dockerEnvironment(),
      input,
      maxBuffer: 64 * 1024 * 1024,
    },
  )
}

function dockerEnvironment() {
  return {
    HOME: process.env.HOME ?? "",
    LANG: "C",
    LC_ALL: "C",
    PATH: process.env.PATH ?? "",
  }
}

async function assertTemporaryFilesSecretFree(root, sensitiveValues) {
  for (const path of await walk(root)) {
    const content = await readFile(path)
    for (const value of sensitiveValues) {
      assert.equal(
        content.includes(Buffer.from(value)),
        false,
        `F0-P1 retained secret material in ${path}.`,
      )
    }
  }
}

async function walk(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const paths = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) paths.push(...(await walk(path)))
    else if (entry.isFile()) paths.push(path)
  }
  return paths
}

function safeError(error) {
  return new Error(
    sanitize(error instanceof Error ? error.stack : String(error)),
  )
}

function sanitize(value) {
  return String(value)
    .slice(-8_000)
    .replaceAll(databasePassword, "[database-secret]")
    .replaceAll(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replaceAll(/[A-Za-z0-9_-]{43,}/g, "[opaque]")
}
