import assert from "node:assert/strict"
import { type ChildProcessByStdio, spawn } from "node:child_process"
import { access, readFile } from "node:fs/promises"
import { connect } from "node:net"
import { join, resolve } from "node:path"
import type { Readable } from "node:stream"
import { describe, expect, test } from "vitest"

const repositoryRoot = resolve(import.meta.dirname, "../../..")

describe("F0-B1 disposable reduced-Core development lane", () => {
  test("starts, verifies, and cleans its temporary state", async () => {
    const result = await runCheck()

    expect(result.code, result.stderr).toBe(0)
    const summary = JSON.parse(result.stdout.trim())
    expect(summary).toMatchObject({
      architecture: process.arch,
      credentialMaterialPrinted: false,
      evidenceClass: "LOCAL_DETERMINISTIC_CONTROL_PLANE_ONLY",
      status: "passed",
      temporaryStateRemoved: true,
    })
    expect(Object.keys(summary.services)).toEqual([
      "api",
      "console",
      "firecrawl",
      "identity",
    ])
    for (const [authority, url] of Object.entries(summary.services)) {
      expect(url).toMatch(
        new RegExp(`^http://${authority}\\.localhost:[0-9]+$`),
      )
    }
    expect(result.stdout).not.toMatch(/Bearer |bffServiceApiKey|liteLlmApiKey/)
  }, 60_000)

  test("forces stalled connections closed and removes every child process group", async () => {
    const running = await startInteractiveRuntime()
    const { child, summary } = running

    expect(summary.stateRoot).toMatch(/llmm-reduced-core-dev-/)
    await access(join(summary.stateRoot, "throwaway-credentials.json"))
    await access(join(summary.stateRoot, "web", ".next"))
    const runtime = JSON.parse(
      await readFile(join(summary.stateRoot, "runtime.json"), "utf8"),
    )
    const stalledClient = await openIncompleteRequest(summary.services.console)

    child.kill("SIGTERM")
    const result = await running.completed
    expect(result.code, result.stderr).toBe(0)
    await stalledClient.closed
    await expect(access(summary.stateRoot)).rejects.toMatchObject({
      code: "ENOENT",
    })
    for (const processGroupId of runtime.processGroupIds) {
      assert.throws(() => process.kill(-processGroupId, 0), { code: "ESRCH" })
    }
    await expect(
      fetch(summary.services.console, {
        signal: AbortSignal.timeout(1_000),
      }),
    ).rejects.toThrow()
  }, 60_000)
})

function openIncompleteRequest(
  url: string,
): Promise<{ closed: Promise<void> }> {
  const target = new URL(url)
  return new Promise((resolveOpen, rejectOpen) => {
    const socket = connect(Number(target.port), target.hostname)
    socket.once("error", rejectOpen)
    socket.once("connect", () => {
      socket.write(`GET / HTTP/1.1\r\nHost: ${target.hostname}\r\n`)
      resolveOpen({
        closed: new Promise((resolveClosed) =>
          socket.once("close", resolveClosed),
        ),
      })
    })
  })
}

function runCheck(): Promise<ProcessResult> {
  return collectProcess(
    spawn(
      process.execPath,
      ["scripts/pre-genesis/reduced-core-dev.mjs", "--check"],
      {
        cwd: repositoryRoot,
        env: poisonedParentEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
    60_000,
  )
}

function startInteractiveRuntime(): Promise<RunningRuntime> {
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
    let resolveCompleted: (result: ProcessResult) => void
    const completed = new Promise<ProcessResult>((resolveExit) => {
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

function collectProcess(
  child: RuntimeChild,
  timeoutMs: number,
): Promise<ProcessResult> {
  return new Promise((resolveRun, rejectRun) => {
    let stdout = ""
    let stderr = ""
    const timeout = setTimeout(() => {
      child.kill("SIGTERM")
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref()
      rejectRun(new Error("Reduced-Core bootstrap check timed out."))
    }, timeoutMs)
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

function poisonedParentEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ADMIN_LITELLM_API_KEY: "parent-value-must-not-cross",
    DATABASE_URL: "parent-database-must-not-cross",
    KEYCLOAK_ADMIN_CLIENT_SECRET: "parent-value-must-not-cross",
    NODE_ENV: "production",
  }
}

interface ProcessResult {
  code: number | null
  stderr: string
  stdout: string
}

interface RunningRuntime {
  child: RuntimeChild
  completed: Promise<ProcessResult>
  summary: {
    services: { console: string }
    stateRoot: string
  }
}

type RuntimeChild = ChildProcessByStdio<null, Readable, Readable>
