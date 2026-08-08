import { spawn } from "node:child_process"

const command = process.argv.slice(2)
if (command.length === 0) {
  throw new Error("The process-group supervisor requires a command.")
}

for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
  process.on(signal, () => {})
}

await send({ type: "supervisor-ready" })

const target = spawn(command[0], command.slice(1), {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "inherit", "inherit"],
})

target.once("error", (error) => {
  void send({ code: error.code ?? "spawn_failed", type: "target-error" }).catch(
    () => {},
  )
})
target.once("exit", (code, signal) => {
  void send({ code, signal, type: "target-exit" }).catch(() => {})
})

setInterval(() => {}, 2_147_483_647)

function send(message) {
  return new Promise((resolveSend, rejectSend) => {
    if (!process.connected) {
      rejectSend(new Error("The process-group supervisor IPC channel closed."))
      return
    }
    process.send(message, (error) => {
      if (error) {
        rejectSend(error)
      } else {
        resolveSend()
      }
    })
  })
}
