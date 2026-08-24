#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { isIP } from "node:net"
import { fileURLToPath } from "node:url"

const nft = "/usr/sbin/nft"
const table = "llmm_filter"
const chain = "input"
const interfaceName = "ens18"
const comment = "llmm-founder-candidate-edge"

export function inspectFounderFirewall(listing, gateway, port) {
  const owned = listing
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(`comment \"${comment}\"`))
  if (owned.length === 0) return { state: "absent" }
  if (owned.length !== 1)
    throw new Error("Founder firewall ownership is ambiguous.")
  const line = owned[0]
  const handle = line.match(/# handle ([1-9][0-9]*)$/)?.[1]
  const expected = `iifname \"${interfaceName}\" ip saddr ${gateway} tcp dport ${port} accept comment \"${comment}\"`
  if (!handle || !line.startsWith(expected)) {
    throw new Error("Founder firewall ownership collides with another rule.")
  }
  return { handle, state: "exact" }
}

export function manageFounderFirewall(action, gateway, portValue) {
  if (process.getuid?.() !== 0)
    throw new Error("Founder firewall requires root.")
  if (!privateIpv4(gateway) || !/^\d+$/.test(portValue ?? "")) {
    throw new Error("Founder firewall arguments are invalid.")
  }
  const port = Number.parseInt(portValue, 10)
  if (port < 1024 || port > 65_535) {
    throw new Error("Founder firewall arguments are invalid.")
  }
  let state = current(gateway, port)
  if (action === "apply") {
    if (state.state === "absent") {
      run([
        "insert",
        "rule",
        "inet",
        table,
        chain,
        "iifname",
        interfaceName,
        "ip",
        "saddr",
        gateway,
        "tcp",
        "dport",
        String(port),
        "accept",
        "comment",
        comment,
      ])
      state = current(gateway, port)
    }
    if (state.state !== "exact")
      throw new Error("Founder firewall did not apply.")
    return state
  }
  if (action === "remove") {
    if (state.state === "exact") {
      run(["delete", "rule", "inet", table, chain, "handle", state.handle])
    }
    if (current(gateway, port).state !== "absent") {
      throw new Error("Founder firewall did not clean up.")
    }
    return { state: "absent" }
  }
  if (action === "status") return state
  throw new Error("Founder firewall action is invalid.")
}

function current(gateway, port) {
  return inspectFounderFirewall(
    run(["-a", "list", "chain", "inet", table, chain]),
    gateway,
    port,
  )
}

function run(arguments_) {
  return execFileSync(nft, arguments_, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function privateIpv4(value) {
  if (typeof value !== "string" || isIP(value) !== 4) return false
  const [first, second] = value.split(".").map(Number)
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [action, gateway, port] = process.argv.slice(2)
  const result = manageFounderFirewall(action, gateway, port)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
