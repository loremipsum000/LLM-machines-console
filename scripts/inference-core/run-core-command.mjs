import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertNoUnexpectedEnvironmentFiles } from "./guardrails.mjs"

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const inheritedEnvironmentNames = [
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PATH",
  "TEMP",
  "TMP",
  "TMPDIR",
]

export function isAgenticEnvironmentName(name) {
  return /(?:^|_)(?:AGENTIC|OPENCLAW|HERMES|NEMOCLAW|OPENSHELL)(?:_|$)/.test(
    name,
  )
}

export function buildCoreEnvironment(source = process.env) {
  const environment = {
    CI: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    NO_COLOR: "1",
  }
  for (const name of inheritedEnvironmentNames) {
    const value = source[name]
    if (typeof value === "string" && value.length > 0) {
      environment[name] = value
    }
  }
  return environment
}

export function runCoreCommand(command) {
  if (!["build", "typecheck"].includes(command)) {
    throw new Error("Expected one Core command: build or typecheck")
  }

  assertNoUnexpectedEnvironmentFiles(root)
  const result = spawnSync(
    "corepack",
    [
      "pnpm",
      "--filter",
      "@llm-machines/bff...",
      "--filter",
      "@llm-machines/web...",
      "--fail-if-no-match",
      command,
    ],
    {
      cwd: root,
      env: buildCoreEnvironment(),
      stdio: "inherit",
    },
  )

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ""
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCoreCommand(process.argv[2])
}
