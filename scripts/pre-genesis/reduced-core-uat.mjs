import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { closeSync, openSync } from "node:fs"
import {
  access,
  chmod,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { loadFounderIdentitySecret } from "./founder-identity-secret.mjs"

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const command = process.argv[2]
const supportedCommands = new Set(["start", "status", "stop"])

if (!supportedCommands.has(command) || process.argv.length !== 3) {
  throw new Error("Usage: reduced-core-uat.mjs <start|status|stop>")
}

const controlRoot = resolve(
  process.env.F0_UAT0_CONTROL_ROOT?.trim() ||
    join(homedir(), ".local/state/llm-machines/founder-uat"),
)
const founderIdentityCredentialPath =
  process.env.F0_UAT0_IDENTITY_CREDENTIAL_FILE?.trim()
const paths = {
  control: join(controlRoot, "runtime/uat-control.json"),
  credentials: join(controlRoot, "runtime/credentials.json"),
  metadata: join(controlRoot, "supervisor.json"),
  runtime: join(controlRoot, "runtime"),
  stage: join(controlRoot, "runtime/commissioning-stage.json"),
  stderr: join(controlRoot, "supervisor.stderr.log"),
  stdout: join(controlRoot, "supervisor.stdout.log"),
  stop: join(controlRoot, "runtime/uat.stop"),
}

if (command === "start") await start()
if (command === "status") await status()
if (command === "stop") await stop()

async function start() {
  assert.equal(process.platform, "linux", "F0-UAT0 requires native Linux.")
  assert.equal(process.arch, "x64", "F0-UAT0 requires native amd64.")
  await assertSafeControlRoot()
  if (await exists(controlRoot)) {
    throw new Error(
      "F0-UAT0 state already exists. Use the status or stop command.",
    )
  }
  requireCommand("docker", ["version", "--format", "{{.Server.Version}}"])
  requireCommand("docker", ["compose", "version"])
  if (requireCommand("git", ["status", "--porcelain"]).trim()) {
    throw new Error("F0-UAT0 requires a clean Product worktree.")
  }
  if (founderIdentityCredentialPath) {
    await loadFounderIdentitySecret(founderIdentityCredentialPath)
  }

  const sourceCommit = git(["rev-parse", "HEAD"])
  const sourceTree = git(["rev-parse", "HEAD^{tree}"])
  await mkdir(controlRoot, { mode: 0o700, recursive: true })
  await chmod(controlRoot, 0o700)
  const stdout = openSync(paths.stdout, "a", 0o600)
  const stderr = openSync(paths.stderr, "a", 0o600)
  const child = spawn(
    process.execPath,
    [
      resolve(
        repositoryRoot,
        "scripts/pre-genesis/reduced-core-integrated.mjs",
      ),
      "--keep-running",
      "--incremental",
    ],
    {
      cwd: repositoryRoot,
      detached: true,
      env: {
        ...process.env,
        F0_UAT0_CONTROL_FILE: paths.control,
        F0_UAT0_CREDENTIAL_FILE: paths.credentials,
        F0_UAT0_KEEP_RUNNING: "true",
        ...(founderIdentityCredentialPath
          ? {
              F0_UAT0_IDENTITY_CREDENTIAL_FILE: founderIdentityCredentialPath,
            }
          : {}),
        F0_UAT0_NATIVE_AMD64: "true",
        F0_UAT0_STATE_ROOT: paths.runtime,
        F0_UAT0_STOP_FILE: paths.stop,
        LANG: "C",
        LC_ALL: "C",
        PRE_GENESIS_DOCKER_CONTEXT: "default",
      },
      stdio: ["ignore", stdout, stderr],
    },
  )
  closeSync(stdout)
  closeSync(stderr)
  child.unref()
  await writeFile(
    paths.metadata,
    `${JSON.stringify(
      {
        architecture: "linux/amd64",
        credentialRotationRequiredBeforeBroaderAccess: Boolean(
          founderIdentityCredentialPath,
        ),
        pid: child.pid,
        sourceCommit,
        sourceTree,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  )

  const deadline = performance.now() + 60 * 60_000
  while (performance.now() < deadline) {
    if (!(await processIsAlive(child.pid))) {
      throw new Error(
        `F0-UAT0 startup exited before readiness. Inspect ${paths.stderr}.`,
      )
    }
    if (await exists(paths.control)) {
      const report = await statusReport()
      const metadata = await readJson(paths.metadata)
      await writeFile(
        paths.metadata,
        `${JSON.stringify(
          {
            ...metadata,
            inventory: report.inventory,
            inventoryRecordedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
        { mode: 0o600 },
      )
      process.stdout.write(`${JSON.stringify(report)}\n`)
      return
    }
    await delay(500)
  }
  throw new Error("F0-UAT0 did not publish readiness within 60 minutes.")
}

async function status() {
  if (!(await exists(paths.metadata))) {
    process.stdout.write(
      `${JSON.stringify({ controlRoot, status: "NOT_STARTED" })}\n`,
    )
    return
  }
  process.stdout.write(`${JSON.stringify(await statusReport())}\n`)
}

async function stop() {
  if (!(await exists(paths.metadata))) {
    throw new Error("F0-UAT0 has no operator-owned state to stop.")
  }
  const metadata = await readJson(paths.metadata)
  const control = (await exists(paths.control))
    ? await readJson(paths.control)
    : null
  const inventory = control?.inventory ?? metadata.inventory ?? null
  if (!inventory) {
    throw new Error(
      "F0-UAT0 exact runtime inventory is unavailable; operator state was preserved.",
    )
  }
  if (await processIsAlive(metadata.pid)) {
    await writeFile(paths.stop, "stop\n", { mode: 0o600 })
    const deadline = performance.now() + 15 * 60_000
    while (
      (await processIsAlive(metadata.pid)) &&
      performance.now() < deadline
    ) {
      await delay(500)
    }
    if (await processIsAlive(metadata.pid)) {
      throw new Error(
        "F0-UAT0 did not stop cleanly; no forced cleanup was attempted.",
      )
    }
  }
  await assertNoOwnedRuntimeRemains(inventory)
  await rm(controlRoot, { force: true, recursive: true })
  process.stdout.write(
    `${JSON.stringify({ cleanupVerified: true, status: "STOPPED" })}\n`,
  )
}

async function statusReport() {
  const metadata = await readJson(paths.metadata)
  const running = await processIsAlive(metadata.pid)
  const control = (await exists(paths.control))
    ? await readJson(paths.control)
    : null
  const commissioningStage = (await exists(paths.stage))
    ? await readJson(paths.stage)
    : null
  const credentialMode = (await exists(paths.credentials))
    ? (await stat(paths.credentials)).mode & 0o777
    : null
  if (credentialMode !== null) assert.equal(credentialMode, 0o600)
  const healthy =
    running && control ? runtimeInventoryIsHealthy(control.inventory) : false
  return {
    architecture: metadata.architecture,
    authorities: control?.authorities ?? null,
    caFile: control?.caFile ?? null,
    commissioningStage,
    credentialFile: control?.credentialFile ?? null,
    credentialMode: credentialMode === null ? null : "0600",
    inventory: control?.inventory ?? null,
    keepRunning: control?.keepRunning === true,
    credentialRotationRequiredBeforeBroaderAccess:
      metadata.credentialRotationRequiredBeforeBroaderAccess === true,
    pid: metadata.pid,
    privateNativeServices: control?.privateNativeServices ?? [],
    sourceCommit: metadata.sourceCommit,
    sourceTree: metadata.sourceTree,
    status: !running
      ? "FAILED"
      : control?.status !== "READY"
        ? "STARTING"
        : healthy
          ? "READY"
          : "DEGRADED",
  }
}

async function assertSafeControlRoot() {
  if (!isAbsolute(controlRoot)) {
    throw new Error("F0-UAT0 control root must be absolute.")
  }
  const repository = await realpath(repositoryRoot)
  const parentPath = dirname(controlRoot)
  const lexicalCandidate = resolve(controlRoot)
  if (pathIsInside(repository, lexicalCandidate)) {
    throw new Error("F0-UAT0 state must remain outside the source worktree.")
  }
  await mkdir(parentPath, { mode: 0o700, recursive: true })
  const parent = await realpath(parentPath)
  const candidate = resolve(parent, controlRoot.slice(parentPath.length + 1))
  const fromRepository = relative(repository, candidate)
  if (
    fromRepository === "" ||
    (!fromRepository.startsWith(`..${sep}`) && fromRepository !== "..")
  ) {
    throw new Error("F0-UAT0 state must remain outside the source worktree.")
  }
}

function pathIsInside(parent, candidate) {
  const fromParent = relative(parent, candidate)
  return (
    fromParent === "" ||
    (!isAbsolute(fromParent) &&
      fromParent !== ".." &&
      !fromParent.startsWith(`..${sep}`))
  )
}

async function assertNoOwnedRuntimeRemains(inventory) {
  for (const container of inventoryContainers(inventory)) {
    const inspected = spawnSync(
      "docker",
      ["--context", "default", "inspect", container],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    )
    if (inspected.status === 0) {
      throw new Error(`F0-UAT0 owned container remains: ${container}.`)
    }
  }
  for (const [kind, name] of [
    ["network", inventory.outer?.network],
    ["volume", inventory.outer?.postgresVolume],
  ]) {
    if (!name) continue
    const inspected = spawnSync(
      "docker",
      ["--context", "default", kind, "inspect", name],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    )
    if (inspected.status === 0) {
      throw new Error(`F0-UAT0 owned ${kind} remains: ${name}.`)
    }
  }
}

function runtimeInventoryIsHealthy(inventory) {
  if (!inventory || !Number.isSafeInteger(inventory.edgeProcess)) return false
  try {
    process.kill(inventory.edgeProcess, 0)
  } catch {
    return false
  }
  for (const item of inventory.applicationProcesses ?? []) {
    if (!Number.isSafeInteger(item.pid) || item.pid <= 1) return false
    try {
      process.kill(item.pid, 0)
    } catch {
      return false
    }
  }
  for (const container of inventoryContainers(inventory)) {
    const inspected = spawnSync(
      "docker",
      [
        "--context",
        "default",
        "inspect",
        "--format",
        "{{.State.Running}}",
        container,
      ],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    )
    if (inspected.status !== 0 || inspected.stdout.trim() !== "true") {
      return false
    }
  }
  return true
}

function inventoryContainers(inventory) {
  const values = [
    inventory.edgeContainer,
    inventory.identity,
    inventory.liteLlm,
    ...Object.values(inventory.firecrawl ?? {}),
    ...Object.values(inventory.outer?.containers ?? {}),
  ]
  if (
    values.some(
      (value) =>
        typeof value !== "string" ||
        !/^[a-z0-9][a-z0-9_.-]{0,127}$/.test(value),
    )
  ) {
    throw new Error("F0-UAT0 container inventory is invalid.")
  }
  return [...new Set(values)]
}

function git(arguments_) {
  return requireCommand("git", arguments_).trim()
}

function requireCommand(commandName, arguments_) {
  const result = spawnSync(commandName, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, LANG: "C", LC_ALL: "C" },
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(`F0-UAT0 prerequisite failed: ${commandName}.`)
  }
  return result.stdout
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

async function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error?.code === "ESRCH") return false
    throw error
  }
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}
