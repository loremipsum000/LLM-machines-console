import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { access, readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { test } from "node:test"

const repositoryRoot = resolve(import.meta.dirname, "../..")

test("F0-B1 starts and cleans the disposable reduced-Core lane", async () => {
  const result = await runCheck()

  assert.equal(result.code, 0, result.stderr)
  const summary = JSON.parse(result.stdout.trim())
  assert.equal(summary.architecture, process.arch)
  assert.equal(summary.credentialMaterialPrinted, false)
  assert.equal(summary.evidenceClass, "LOCAL_DETERMINISTIC_CONTROL_PLANE_ONLY")
  assert.equal(summary.status, "passed")
  assert.equal(summary.temporaryStateRemoved, true)
  assert.deepEqual(Object.keys(summary.services), [
    "api",
    "console",
    "firecrawl",
    "identity",
  ])
  for (const [authority, url] of Object.entries(summary.services)) {
    assert.match(url, new RegExp(`^http://${authority}\\.localhost:[0-9]+$`))
  }
  assert.doesNotMatch(result.stdout, /Bearer |bffServiceApiKey|liteLlmApiKey/)
})

test("F0-B1 remains a local deterministic, non-production lane", async () => {
  const [decision, source] = await Promise.all([
    readJson("docs/reduction/inference-core/f0-b1-reduced-core-bootstrap.json"),
    readFile(
      resolve(repositoryRoot, "scripts/pre-genesis/reduced-core-dev.mjs"),
      "utf8",
    ),
  ])

  assert.equal(decision.workPackage, "F0-B1")
  assert.equal(decision.accepted, false)
  assert.equal(decision.runtimeQualified, false)
  assert.equal(decision.evidenceClass, "LOCAL_DETERMINISTIC_CONTROL_PLANE_ONLY")
  assert.deepEqual(decision.publicAuthoritySimulation, [
    "console.localhost",
    "api.localhost",
    "identity.localhost",
    "firecrawl.localhost",
  ])
  assert.ok(decision.notEvidenceFor.includes("SGLang-runtime-or-capacity"))
  assert.equal(
    decision.command,
    "node scripts/pre-genesis/reduced-core-dev.mjs",
  )
  assert.doesNotMatch(source, /NODE_ENV:\s*"production"/)
  assert.doesNotMatch(source, /(?:docker|ssh|kubectl|harbor|gitea)/i)
  assert.doesNotMatch(source, /\.\.\.process\.env/)
})

test("F0-B1 handles SIGTERM by stopping the process group and removing all runtime state", async () => {
  const running = await startInteractiveRuntime()
  const { child, summary } = running

  assert.match(summary.stateRoot, /llmm-reduced-core-dev-/)
  await access(join(summary.stateRoot, "throwaway-credentials.json"))
  await access(join(summary.stateRoot, "web", ".next"))

  child.kill("SIGTERM")
  const result = await running.completed
  assert.equal(result.code, 0, result.stderr)
  await assert.rejects(access(summary.stateRoot), { code: "ENOENT" })
  await assert.rejects(
    fetch(summary.services.console, { signal: AbortSignal.timeout(1_000) }),
  )
})

function runCheck() {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      ["scripts/pre-genesis/reduced-core-dev.mjs", "--check"],
      {
        cwd: repositoryRoot,
        env: poisonedParentEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
    let stdout = ""
    let stderr = ""
    const timeout = setTimeout(() => {
      child.kill("SIGTERM")
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref()
      rejectRun(new Error("Reduced-Core bootstrap check timed out."))
    }, 60_000)
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.once("error", (error) => {
      clearTimeout(timeout)
      rejectRun(error)
    })
    child.once("exit", (code) => {
      clearTimeout(timeout)
      resolveRun({ code, stderr, stdout })
    })
  })
}

function startInteractiveRuntime() {
  return new Promise((resolveReady, rejectReady) => {
    const child = spawn(
      process.execPath,
      ["scripts/pre-genesis/reduced-core-dev.mjs"],
      {
        cwd: repositoryRoot,
        env: poisonedParentEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
    let stdout = ""
    let stderr = ""
    let ready = false
    let resolveCompleted
    const completed = new Promise((resolveExit) => {
      resolveCompleted = resolveExit
    })
    const timeout = setTimeout(() => {
      child.kill("SIGTERM")
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref()
      rejectReady(new Error("Reduced-Core interactive startup timed out."))
    }, 45_000)
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
      const marker = "\nPress Ctrl-C to stop and remove temporary state.\n"
      const markerIndex = stdout.indexOf(marker)
      if (!ready && markerIndex >= 0) {
        ready = true
        clearTimeout(timeout)
        resolveReady({
          child,
          completed,
          summary: JSON.parse(stdout.slice(0, markerIndex)),
        })
      }
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.once("error", (error) => {
      clearTimeout(timeout)
      if (!ready) {
        rejectReady(error)
      }
    })
    child.once("exit", (code) => {
      clearTimeout(timeout)
      resolveCompleted({ code, stderr, stdout })
      if (!ready) {
        rejectReady(
          new Error(`Reduced-Core runtime exited before readiness: ${stderr}`),
        )
      }
    })
  })
}

function poisonedParentEnvironment() {
  return {
    ...process.env,
    ADMIN_LITELLM_API_KEY: "parent-value-must-not-cross",
    DATABASE_URL: "parent-database-must-not-cross",
    KEYCLOAK_ADMIN_CLIENT_SECRET: "parent-value-must-not-cross",
    NODE_ENV: "production",
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8"))
}
