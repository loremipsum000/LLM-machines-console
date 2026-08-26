#!/usr/bin/env node

import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"

const mappings =
  process.env.LLMM_RUNTIME_SECRET_FILES?.split(",").filter(Boolean) ?? []
const command = process.argv.slice(2)

if (command.length === 0) {
  throw new Error("The runtime secret entrypoint requires a command.")
}

const environment = { ...process.env }
environment.LLMM_RUNTIME_SECRET_FILES = undefined

for (const mapping of mappings) {
  const separator = mapping.indexOf("=")
  const name = mapping.slice(0, separator)
  const file = mapping.slice(separator + 1)
  if (
    separator < 1 ||
    !/^[A-Z][A-Z0-9_]{1,95}$/.test(name) ||
    !file.startsWith("/run/secrets/llmm_") ||
    file.includes("..")
  ) {
    throw new Error("The runtime secret mapping is invalid.")
  }
  const value = readFileSync(file, "utf8").trim()
  if (!value) throw new Error(`The runtime secret file for ${name} is empty.`)
  environment[name] = value
}

const child = spawn(command[0], command.slice(1), {
  env: environment,
  stdio: "inherit",
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal))
}

child.once("error", (error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exitCode = code ?? 1
})
