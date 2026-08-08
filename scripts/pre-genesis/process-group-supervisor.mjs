import { spawn } from "node:child_process"

const command = process.argv.slice(2)
if (command.length === 0) {
  throw new Error("The process-group supervisor requires a command.")
}

for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
  process.on(signal, () => {})
}

const target = spawn(command[0], command.slice(1), {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "inherit", "inherit"],
})

target.once("error", (error) => {
  send({ code: error.code ?? "spawn_failed", type: "target-error" })
})
target.once("exit", (code, signal) => {
  send({ code, signal, type: "target-exit" })
})

setInterval(() => {}, 2_147_483_647)

function send(message) {
  if (process.connected) {
    process.send(message)
  }
}
