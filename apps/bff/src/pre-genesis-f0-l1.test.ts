import { type ChildProcessByStdio, spawn } from "node:child_process"
import { resolve } from "node:path"
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
      60_000,
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
          requests7d: 5,
          tokens7d: 20,
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
          boundedOverlapRecorded: true,
          rotatedCredentialAccepted: true,
        },
        separateApplicationCredentials: true,
        streamingChatCompletions: "passed",
      },
      status: "passed",
      temporaryStateRemoved: true,
    })
    expect(result.stdout).not.toMatch(
      /Bearer |llmm_t4_|apiKey|fixture-response|disposable fixture input/,
    )
  }, 60_000)
})

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
      rejectRun(new Error("F0-L1 vertical slice timed out."))
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

type RuntimeChild = ChildProcessByStdio<null, Readable, Readable>
