import { type ChildProcessByStdio, spawn } from "node:child_process"
import { resolve } from "node:path"
import type { Readable } from "node:stream"
import { describe, expect, test } from "vitest"

const repositoryRoot = resolve(import.meta.dirname, "../../..")

describe("F0-W1 disposable per-Application Firecrawl lane", () => {
  test("proves governed access, credential isolation, and cleanup", async () => {
    const result = await collectProcess(
      spawn(
        process.execPath,
        ["scripts/pre-genesis/reduced-core-dev.mjs", "--firecrawl-slice"],
        {
          cwd: repositoryRoot,
          env: poisonedParentEnvironment(),
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
      45_000,
    )

    expect(result.code, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      architecture: process.arch,
      credentialMaterialPrinted: false,
      evidenceClass: "LOCAL_DETERMINISTIC_FIRECRAWL_APPLICATION_FLOW_ONLY",
      flow: {
        applicationIsolation: "passed",
        credentialNamespacesSeparated: true,
        defaultOff: "passed",
        disclaimerBoundEnablement: "passed",
        egressAllowlist: "passed",
        immutableCredentialPolicy: "passed",
        lastUseMetadata: "passed",
        revocation: "passed",
        search: "passed",
        staticScrape: "passed",
        unsupportedRoutesDenied: true,
        upstreamCredentialForwarding: false,
        zeroRetentionRequestFlags: true,
      },
      status: "passed",
      temporaryStateRemoved: true,
    })
    expect(`${result.stdout}\n${result.stderr}`).not.toMatch(
      /Bearer |llmm_(?:fc|t4)_|apiKey|Deterministic (?:search|scrape) result|parent-(?:database|value)-must-not-cross/,
    )
  }, 75_000)
})

function collectProcess(
  child: RuntimeChild,
  timeoutMs: number,
): Promise<ProcessResult> {
  return new Promise((resolveRun, rejectRun) => {
    let stdout = ""
    let stderr = ""
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
      setTimeout(() => child.kill("SIGKILL"), 20_000).unref()
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
      if (timedOut) {
        rejectRun(new Error("F0-W1 timed out after cleanup."))
        return
      }
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
