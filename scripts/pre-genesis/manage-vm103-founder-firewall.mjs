#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process"
import { isIP } from "node:net"
import { fileURLToPath } from "node:url"

const nft = "/usr/sbin/nft"
const table = "llmm_founder_edge"
const chain = "input"
const interfaceName = "ens18"
const allowComment = "llmm-founder-candidate-edge-allow"
const denyComment = "llmm-founder-candidate-edge-deny"

export function inspectFounderFirewall(listing, gateway, port) {
  if (!listing.trim()) return { state: "absent" }
  const lines = listing
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\s+/g, " "))
  const expectedAllow = `iifname \"${interfaceName}\" ip saddr ${gateway} tcp dport ${port} accept comment \"${allowComment}\"`
  const expectedDeny = `tcp dport ${port} drop comment \"${denyComment}\"`
  if (
    lines.length !== 7 ||
    lines[0] !== `table inet ${table} {` ||
    lines[1] !== `chain ${chain} {` ||
    !/^type filter hook input priority (?:-5|filter - 5); policy accept;$/.test(
      lines[2],
    ) ||
    lines[3] !== expectedAllow ||
    lines[4] !== expectedDeny ||
    lines[5] !== "}" ||
    lines[6] !== "}"
  ) {
    throw new Error("Founder firewall ownership collides with another rule.")
  }
  return { state: "exact" }
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
      run(["-f", "-"], renderFirewall(gateway, port))
      state = current(gateway, port)
    }
    if (state.state !== "exact")
      throw new Error("Founder firewall did not apply.")
    return state
  }
  if (action === "remove") {
    if (state.state === "exact") {
      run(["delete", "table", "inet", table])
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
  const result = spawnSync(nft, ["list", "table", "inet", table], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.status === 0)
    return inspectFounderFirewall(result.stdout, gateway, port)
  if (/No such file or directory/i.test(result.stderr))
    return { state: "absent" }
  throw new Error("Founder firewall inspection failed.")
}

function run(arguments_, input) {
  return execFileSync(nft, arguments_, {
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  })
}

function renderFirewall(gateway, port) {
  return `table inet ${table} {
  chain ${chain} {
    type filter hook input priority -5; policy accept;
    iifname "${interfaceName}" ip saddr ${gateway} tcp dport ${port} accept comment "${allowComment}"
    tcp dport ${port} drop comment "${denyComment}"
  }
}
`
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
