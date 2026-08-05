import { type ChildProcessByStdio, spawn } from "node:child_process"
import { access, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { Readable } from "node:stream"
import { describe, expect, test } from "vitest"

const repositoryRoot = resolve(import.meta.dirname, "../../..")

describe("F0-L1 disposable Application-to-inference lane", () => {
  test("proves credential lifecycle, streaming, accounting, and isolation", async () => {
    const result = await collectProcess(
      spawn(
        process.execPath,
        ["scripts/pre-genesis/reduced-core-dev.mjs", "--vertical-slice"],
        {
          cwd: repositoryRoot,
          env: poisonedParentEnvironment(),
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
      45_000,
    )

    expect(result.code, result.stderr).toBe(0)
    const summary = JSON.parse(result.stdout.trim())
    expect(summary).toMatchObject({
      architecture: process.arch,
      credentialMaterialPrinted: false,
      evidenceClass: "LOCAL_DETERMINISTIC_APPLICATION_FLOW_ONLY",
      flow: {
        accounting: {
          lastUseRecorded: true,
          requests7d: 6,
          tokens7d: 25,
        },
        applicationCreation: "passed",
        connectionTest: "passed",
        inferenceClient: "OPENAI_COMPATIBLE_HTTP",
        isolation: {
          accountingAttributedToCredentialApplication: true,
          crossApplicationCredentialMutationDenied: true,
          crossApplicationModelUseDenied: true,
        },
        nonStreamingChatCompletions: "passed",
        revocation: {
          activeCredentialDenied: true,
          retiringCredentialDenied: true,
        },
        rotation: {
          automaticOverlapExpiryDenied: true,
          boundedOverlapRecorded: true,
          retiringCredentialAcceptedDuringOverlap: true,
          rotatedCredentialAccepted: true,
        },
        separateApplicationCredentials: true,
        streamingChatCompletions: "passed",
      },
      status: "passed",
      temporaryStateRemoved: true,
    })
    expect(`${result.stdout}\n${result.stderr}`).not.toMatch(
      /Bearer |llmm_t4_|apiKey|fixture-response|disposable fixture input|parent-(?:database|value)-must-not-cross/,
    )
  }, 75_000)

  test("interrupts the vertical slice and removes its temporary runtime", async () => {
    const temporaryParent = await mkdtemp(
      join(tmpdir(), "llmm-f0-l1-signal-test-"),
    )
    const child = spawn(
      process.execPath,
      ["scripts/pre-genesis/reduced-core-dev.mjs", "--vertical-slice"],
      {
        cwd: repositoryRoot,
        env: poisonedParentEnvironment({
          TEMP: temporaryParent,
          TMP: temporaryParent,
          TMPDIR: temporaryParent,
        }),
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
    const completed = collectProcess(child, 45_000)
    try {
      const stateRoot = await waitForStateRoot(temporaryParent)
      child.kill("SIGTERM")
      const result = await completed

      expect(result.code, result.stderr).toBe(130)
      expect(result.stdout).toBe("")
      await expect(access(stateRoot)).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM")
      }
      await completed.catch(() => undefined)
      await rm(temporaryParent, { force: true, recursive: true })
    }
  }, 60_000)
})

async function waitForStateRoot(temporaryParent: string): Promise<string> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const entries = await readdir(temporaryParent, { withFileTypes: true })
    const stateRoot = entries.find(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith("llmm-reduced-core-dev-"),
    )
    if (stateRoot) {
      return join(temporaryParent, stateRoot.name)
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  throw new Error("F0-L1 did not create its disposable state root.")
}

function collectProcess(
  child: RuntimeChild,
  timeoutMs: number,
): Promise<ProcessResult> {
  return new Promise((resolveRun, rejectRun) => {
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let forceKill: NodeJS.Timeout | undefined
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
      forceKill = setTimeout(() => child.kill("SIGKILL"), 20_000)
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
      clearTimeout(forceKill)
      rejectRun(error)
    })
    child.once("exit", (code) => {
      clearTimeout(timeout)
      clearTimeout(forceKill)
      if (timedOut) {
        rejectRun(
          new Error(
            `F0-L1 vertical slice timed out and exited after cleanup (code=${code ?? "none"}).`,
          ),
        )
        return
      }
      resolveRun({ code, stderr, stdout })
    })
  })
}

function poisonedParentEnvironment(
  environment: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ADMIN_LITELLM_API_KEY: "parent-value-must-not-cross",
    DATABASE_URL: "parent-database-must-not-cross",
    KEYCLOAK_ADMIN_CLIENT_SECRET: "parent-value-must-not-cross",
    NODE_ENV: "production",
    ...environment,
  }
}

interface ProcessResult {
  code: number | null
  stderr: string
  stdout: string
}

type RuntimeChild = ChildProcessByStdio<null, Readable, Readable>
