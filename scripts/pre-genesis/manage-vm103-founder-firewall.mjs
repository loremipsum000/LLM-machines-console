#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process"
import { isIP } from "node:net"
import { fileURLToPath } from "node:url"

const nft = "/usr/sbin/nft"
const family = "inet"
const table = "llmm_filter"
const chain = "input"
const interfaceName = "ens18"
const allowComment = "llmm-founder-candidate-edge-allow"

export function inspectFounderFirewall(
  document,
  gateway,
  port,
  { permitForeignPortRules = false } = {},
) {
  const entries = document?.nftables
  if (!Array.isArray(entries))
    throw new Error("Founder firewall inspection is invalid.")
  const chainEntries = entries.filter(
    (entry) =>
      entry.chain?.family === family &&
      entry.chain?.table === table &&
      entry.chain?.name === chain,
  )
  if (
    chainEntries.length !== 1 ||
    chainEntries[0].chain.type !== "filter" ||
    chainEntries[0].chain.hook !== "input" ||
    chainEntries[0].chain.prio !== -10 ||
    chainEntries[0].chain.policy !== "drop"
  ) {
    throw new Error("Founder firewall base-chain contract is invalid.")
  }

  let owned
  for (const entry of entries) {
    const rule = entry.rule
    if (
      !rule ||
      rule.family !== family ||
      rule.table !== table ||
      rule.chain !== chain
    )
      continue
    const mentionsPort = expressionMentionsPort(rule.expr, port)
    if (rule.comment === allowComment) {
      if (
        owned !== undefined ||
        !Number.isInteger(rule.handle) ||
        !mentionsPort ||
        !isExactOwnedRule(rule.expr, gateway, port)
      ) {
        throw new Error(
          "Founder firewall ownership collides with another rule.",
        )
      }
      owned = rule.handle
    } else if (mentionsPort && !permitForeignPortRules) {
      throw new Error("Founder firewall port collides with another rule.")
    }
  }
  return owned === undefined
    ? { state: "absent" }
    : { handle: owned, state: "exact" }
}

export function manageFounderFirewall(action, gateway, portValue) {
  if (process.getuid?.() !== 0)
    throw new Error("Founder firewall requires root.")
  if (!privateIpv4(gateway) || !/^\d+$/.test(portValue ?? "")) {
    throw new Error("Founder firewall arguments are invalid.")
  }
  const port = Number.parseInt(portValue, 10)
  if (port < 1024 || port > 65_535)
    throw new Error("Founder firewall arguments are invalid.")

  return reconcileFounderFirewall(action, gateway, port, {
    execute: run,
    inspectOwned: ownedCurrent,
    inspectStrict: current,
  })
}

export function reconcileFounderFirewall(
  action,
  gateway,
  port,
  { execute, inspectOwned, inspectStrict },
) {
  if (action === "apply") {
    let state = inspectStrict(gateway, port)
    if (state.state === "absent") {
      execute([
        "add",
        "rule",
        family,
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
        allowComment,
      ])
      try {
        state = inspectStrict(gateway, port)
      } catch (error) {
        cleanupOwnedRule(gateway, port, { execute, inspectOwned })
        throw error
      }
    }
    if (state.state !== "exact")
      throw new Error("Founder firewall did not apply.")
    return state
  }
  if (action === "remove") {
    const state = inspectOwned(gateway, port)
    if (state.state === "exact") {
      execute([
        "delete",
        "rule",
        family,
        table,
        chain,
        "handle",
        String(state.handle),
      ])
    }
    if (
      inspectStrict(gateway, port, { permitForeignPortRules: true }).state !==
      "absent"
    )
      throw new Error("Founder firewall did not clean up.")
    return { state: "absent" }
  }
  if (action === "status") return inspectStrict(gateway, port)
  throw new Error("Founder firewall action is invalid.")
}

function current(gateway, port, options) {
  return inspectFounderFirewall(readCurrentDocument(), gateway, port, options)
}

function ownedCurrent(gateway, port) {
  return inspectOwnedRule(readCurrentDocument(), gateway, port)
}

function readCurrentDocument() {
  const result = spawnSync(
    nft,
    ["-j", "-a", "list", "chain", family, table, chain],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  if (result.status !== 0)
    throw new Error("Founder firewall inspection failed.")
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error("Founder firewall inspection failed.")
    throw error
  }
}

function inspectOwnedRule(document, gateway, port) {
  const entries = document?.nftables
  if (!Array.isArray(entries))
    throw new Error("Founder firewall inspection is invalid.")
  let owned
  for (const entry of entries) {
    const rule = entry.rule
    if (
      !rule ||
      rule.family !== family ||
      rule.table !== table ||
      rule.chain !== chain ||
      rule.comment !== allowComment
    )
      continue
    if (
      owned !== undefined ||
      !Number.isInteger(rule.handle) ||
      !isExactOwnedRule(rule.expr, gateway, port)
    )
      throw new Error("Founder firewall ownership collides with another rule.")
    owned = rule.handle
  }
  return owned === undefined
    ? { state: "absent" }
    : { handle: owned, state: "exact" }
}

function cleanupOwnedRule(gateway, port, { execute, inspectOwned }) {
  const state = inspectOwned(gateway, port)
  if (state.state === "exact") {
    execute([
      "delete",
      "rule",
      family,
      table,
      chain,
      "handle",
      String(state.handle),
    ])
  }
  if (inspectOwned(gateway, port).state !== "absent")
    throw new Error("Founder firewall failed-apply cleanup failed.")
}

function expressionMentionsPort(expressions, port) {
  return (expressions ?? []).some((expression) => {
    const match = expression.match
    if (
      match?.left?.payload?.protocol !== "tcp" ||
      match.left.payload.field !== "dport"
    )
      return false
    return valueMayContainPort(match.right, port)
  })
}

function valueMayContainPort(value, port) {
  if (typeof value === "number") return value === port
  if (typeof value === "string") return true
  if (Array.isArray(value))
    return value.some((item) => valueMayContainPort(item, port))
  if (!value || typeof value !== "object") return false
  if (
    Array.isArray(value.range) &&
    value.range.length === 2 &&
    value.range.every(Number.isInteger)
  )
    return value.range[0] <= port && port <= value.range[1]
  return Object.values(value).some((item) => valueMayContainPort(item, port))
}

function isExactOwnedRule(expressions, gateway, port) {
  return (
    expressions?.length === 4 &&
    exactMetaMatch(expressions[0], "iifname", interfaceName) &&
    exactPayloadMatch(expressions[1], "ip", "saddr", gateway) &&
    exactPayloadMatch(expressions[2], "tcp", "dport", port) &&
    expressions[3]?.accept === null &&
    Object.keys(expressions[3]).length === 1
  )
}

function exactMetaMatch(expression, key, right) {
  const match = expression?.match
  return (
    Object.keys(expression ?? {}).length === 1 &&
    Object.keys(match ?? {}).length === 3 &&
    match.op === "==" &&
    match.right === right &&
    match.left?.meta?.key === key &&
    Object.keys(match.left ?? {}).length === 1 &&
    Object.keys(match.left.meta).length === 1
  )
}

function exactPayloadMatch(expression, protocol, field, right) {
  const match = expression?.match
  return (
    Object.keys(expression ?? {}).length === 1 &&
    Object.keys(match ?? {}).length === 3 &&
    match.op === "==" &&
    match.right === right &&
    match.left?.payload?.protocol === protocol &&
    match.left.payload.field === field &&
    Object.keys(match.left ?? {}).length === 1 &&
    Object.keys(match.left.payload).length === 2
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
  process.stdout.write(
    `${JSON.stringify(manageFounderFirewall(action, gateway, port))}\n`,
  )
}
