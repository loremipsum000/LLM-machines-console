#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { lstatSync, readFileSync, realpathSync } from "node:fs"
import { isIP } from "node:net"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ip = "/usr/sbin/ip"
const nft = "/usr/sbin/nft"
const routeProtocol = 186
const routeMetric = 42_711
const nftFamily = "inet"
const nftTable = "llmm_sglang"

export function renderInferenceFirewallContract(source, port) {
  if (!privateIpv4(source) || !validPort(port)) fail("firewall contract")
  return `table inet llmm_sglang {\n  chain input {\n    type filter hook input priority -5; policy accept;\n    iifname "lo" tcp dport ${port} accept\n    ip saddr ${source} tcp dport ${port} accept\n    tcp dport ${port} drop\n  }\n}\n`
}

export function inspectInferenceRoute(document, destination, gateway, device) {
  if (!Array.isArray(document)) fail("inspection")
  if (document.length === 0) return { state: "absent" }
  if (document.length !== 1) return { state: "collision" }
  const route = document[0]
  const protocol = Number(route?.protocol)
  const allowedKeys = [
    "dev",
    "dst",
    "flags",
    "gateway",
    "metric",
    "protocol",
    "scope",
    "type",
  ]
  return route?.dst === `${destination}/32` &&
    route.gateway === gateway &&
    route.dev === device &&
    protocol === routeProtocol &&
    route.metric === routeMetric &&
    Array.isArray(route.flags) &&
    route.flags.length === 0 &&
    (route.scope === undefined || route.scope === "global") &&
    (route.type === undefined || route.type === "unicast") &&
    Object.keys(route).every((key) => allowedKeys.includes(key))
    ? { state: "exact" }
    : { state: "collision" }
}

export function inspectInferenceNft(document, source, port) {
  if (document === null) return { state: "absent" }
  const entries = document?.nftables?.filter((entry) => !entry.metainfo)
  if (!Array.isArray(entries)) fail("nft inspection")
  const table = entries.filter(
    (entry) =>
      entry.table?.family === nftFamily && entry.table?.name === nftTable,
  )
  const chain = entries.filter(
    (entry) =>
      entry.chain?.family === nftFamily &&
      entry.chain?.table === nftTable &&
      entry.chain?.name === "input",
  )
  const rules = entries.filter(
    (entry) =>
      entry.rule?.family === nftFamily &&
      entry.rule?.table === nftTable &&
      entry.rule?.chain === "input",
  )
  if (
    entries.length !== 5 ||
    table.length !== 1 ||
    !exactObjectKeys(table[0], ["table"]) ||
    !exactObjectKeys(
      table[0].table,
      ["family", "handle", "name"],
      ["handle"],
    ) ||
    chain.length !== 1 ||
    !exactObjectKeys(chain[0], ["chain"]) ||
    !exactObjectKeys(
      chain[0].chain,
      ["family", "handle", "hook", "name", "policy", "prio", "table", "type"],
      ["handle"],
    ) ||
    chain[0].chain.type !== "filter" ||
    chain[0].chain.hook !== "input" ||
    chain[0].chain.prio !== -5 ||
    chain[0].chain.policy !== "accept" ||
    rules.length !== 3 ||
    rules.some(
      (entry) =>
        !exactObjectKeys(entry, ["rule"]) ||
        !exactObjectKeys(
          entry.rule,
          ["chain", "expr", "family", "handle", "table"],
          ["handle"],
        ),
    ) ||
    !exactRule(rules[0].rule.expr, [
      ["meta", "iifname", "lo"],
      ["payload", "tcp", "dport", port],
      ["verdict", "accept"],
    ]) ||
    !exactRule(rules[1].rule.expr, [
      ["payload", "ip", "saddr", source],
      ["payload", "tcp", "dport", port],
      ["verdict", "accept"],
    ]) ||
    !exactRule(rules[2].rule.expr, [
      ["payload", "tcp", "dport", port],
      ["verdict", "drop"],
    ])
  ) {
    return { state: "collision" }
  }
  return { state: "exact" }
}

export function reconcileInferenceRoute(
  action,
  { addNft, addRoute, deleteNft, deleteRoute, inspectNft, inspectRoute },
) {
  if (action === "apply") {
    if (inspectRoute().state !== "absent" || inspectNft().state !== "absent") {
      fail("pre-existing state")
    }
    let routeCreated = false
    let nftCreated = false
    try {
      addRoute()
      routeCreated = true
      if (inspectRoute().state !== "exact") fail("route apply")
      addNft()
      nftCreated = true
      if (inspectNft().state !== "exact") fail("nft apply")
      return { preimage: "absent", state: "exact" }
    } catch (error) {
      cleanupOwnedState({
        deleteNft,
        deleteRoute,
        inspectNft,
        inspectRoute,
        nftCreated,
        routeCreated,
      })
      throw error
    }
  }
  if (action === "remove") {
    const route = inspectRoute()
    const table = inspectNft()
    if (route.state === "absent" && table.state === "absent") {
      return { state: "absent" }
    }
    if (route.state !== "exact" || table.state !== "exact") {
      fail("rollback ownership")
    }
    deleteRoute()
    if (inspectRoute().state !== "absent") fail("route rollback")
    deleteNft()
    if (inspectNft().state !== "absent") fail("nft rollback")
    return { state: "absent" }
  }
  if (action === "status") {
    return { nft: inspectNft(), route: inspectRoute() }
  }
  fail("action")
}

export function manageInferenceRoute(action, options) {
  validateOptions(options)
  verifyManagedScript(options.managerPath, options.managerDigest, 0)
  if (process.getuid?.() !== 0) fail("privilege")
  verifyInferenceFirewallFile(options.nftFile, options.source, options.port)
  const routeArguments = [
    "route",
    "add",
    `${options.destination}/32`,
    "via",
    options.gateway,
    "dev",
    options.device,
    "proto",
    String(routeProtocol),
    "metric",
    String(routeMetric),
  ]
  return reconcileInferenceRoute(action, {
    addNft: () => run(nft, ["-f", options.nftFile]),
    addRoute: () => run(ip, routeArguments),
    deleteNft: () => run(nft, ["delete", "table", nftFamily, nftTable]),
    deleteRoute: () =>
      run(ip, [routeArguments[0], "del", ...routeArguments.slice(2)]),
    inspectNft: () => currentNft(options.source, options.port),
    inspectRoute: () =>
      inspectInferenceRoute(
        readJson(ip, [
          "-N",
          "-j",
          "route",
          "show",
          "exact",
          `${options.destination}/32`,
        ]),
        options.destination,
        options.gateway,
        options.device,
      ),
  })
}

export function verifyManagedScript(path, expectedDigest, expectedUid = 0) {
  if (
    typeof expectedDigest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(expectedDigest) ||
    !Number.isSafeInteger(expectedUid) ||
    expectedUid < 0
  ) {
    fail("manager identity")
  }
  let stat
  let canonical
  let content
  try {
    stat = lstatSync(path)
    canonical = realpathSync(path)
    content = readFileSync(path)
  } catch {
    fail("manager identity")
  }
  if (
    resolve(path) !== canonical ||
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.uid !== expectedUid ||
    (stat.mode & 0o7777) !== 0o600 ||
    `sha256:${createHash("sha256").update(content).digest("hex")}` !==
      expectedDigest
  ) {
    fail("manager identity")
  }
}

function cleanupOwnedState({
  deleteNft,
  deleteRoute,
  inspectNft,
  inspectRoute,
  nftCreated,
  routeCreated,
}) {
  if (routeCreated) {
    const route = inspectRoute()
    if (route.state === "exact") deleteRoute()
    else if (route.state !== "absent") fail("failed-apply route ownership")
    if (inspectRoute().state !== "absent") fail("failed-apply route cleanup")
  }
  if (nftCreated) {
    const table = inspectNft()
    if (table.state === "exact") deleteNft()
    else if (table.state !== "absent") fail("failed-apply nft ownership")
    if (inspectNft().state !== "absent") fail("failed-apply nft cleanup")
  }
}

function currentNft(source, port) {
  const tables = commandResult(nft, ["-j", "list", "tables"])
  if (tables.status !== 0) fail("nft inspection")
  try {
    const document = JSON.parse(tables.stdout)
    const matching = document?.nftables?.filter(
      (entry) =>
        entry.table?.family === nftFamily && entry.table?.name === nftTable,
    )
    if (!Array.isArray(matching)) fail("nft inspection")
    if (matching.length === 0) return { state: "absent" }
    if (matching.length !== 1) return { state: "collision" }
    const table = commandResult(nft, [
      "-j",
      "list",
      "table",
      nftFamily,
      nftTable,
    ])
    if (table.status !== 0) fail("nft inspection")
    return inspectInferenceNft(JSON.parse(table.stdout), source, port)
  } catch {
    fail("nft inspection")
  }
}

function exactRule(expressions, expected) {
  if (!Array.isArray(expressions) || expressions.length !== expected.length) {
    return false
  }
  return expected.every((item, index) => {
    const expression = expressions[index]
    if (item[0] === "verdict") {
      return (
        exactObjectKeys(expression, [item[1]]) && expression[item[1]] === null
      )
    }
    const match = expression?.match
    if (
      !exactObjectKeys(expression, ["match"]) ||
      !exactObjectKeys(match, ["left", "op", "right"])
    ) {
      return false
    }
    if (item[0] === "meta") {
      return (
        match?.op === "==" &&
        match?.right === item[2] &&
        exactObjectKeys(match.left, ["meta"]) &&
        exactObjectKeys(match.left.meta, ["key"]) &&
        match?.left?.meta?.key === item[1]
      )
    }
    return (
      match?.op === "==" &&
      match?.right === item[3] &&
      exactObjectKeys(match.left, ["payload"]) &&
      exactObjectKeys(match.left.payload, ["field", "protocol"]) &&
      match?.left?.payload?.protocol === item[1] &&
      match?.left?.payload?.field === item[2]
    )
  })
}

function exactObjectKeys(value, expected, optional = []) {
  if (!value || Array.isArray(value) || typeof value !== "object") return false
  const actual = Object.keys(value).sort()
  const required = expected.filter((key) => !optional.includes(key))
  if (required.some((key) => !actual.includes(key))) return false
  return actual.every((key) => expected.includes(key))
}

function validateOptions(value) {
  if (
    !privateIpv4(value.destination) ||
    !privateIpv4(value.gateway) ||
    !privateIpv4(value.source) ||
    !/^[a-z][a-z0-9_.-]{1,14}$/.test(value.device) ||
    !validPort(value.port) ||
    typeof value.managerDigest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(value.managerDigest) ||
    typeof value.managerPath !== "string" ||
    !/^\/(?:[A-Za-z0-9._-]+\/?)+$/.test(value.managerPath) ||
    value.managerPath.includes("..") ||
    !/^\/(?:[A-Za-z0-9._-]+\/?)+$/.test(value.nftFile) ||
    value.nftFile.includes("..")
  ) {
    fail("arguments")
  }
}

function verifyInferenceFirewallFile(path, source, port) {
  let stat
  let canonical
  let content
  try {
    stat = lstatSync(path)
    canonical = realpathSync(path)
    content = readFileSync(path, "utf8")
  } catch {
    fail("firewall file")
  }
  if (
    resolve(path) !== canonical ||
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.uid !== 0 ||
    (stat.mode & 0o7777) !== 0o600 ||
    content !== renderInferenceFirewallContract(source, port)
  ) {
    fail("firewall file")
  }
}

function readJson(command, arguments_) {
  try {
    return JSON.parse(run(command, arguments_))
  } catch {
    fail("inspection")
  }
}

function run(command, arguments_) {
  return execFileSync(command, arguments_, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function commandResult(command, arguments_) {
  return spawnSync(command, arguments_, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function privateIpv4(value) {
  if (isIP(value) !== 4) return false
  const [first, second] = value.split(".").map(Number)
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

function validPort(value) {
  return Number.isInteger(value) && value >= 1024 && value <= 65_535
}

function fail(reason) {
  throw new Error(`VM103 inference route lifecycle is invalid: ${reason}.`)
}

function isMainInvocation() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (isMainInvocation()) {
  if (process.argv.length !== 10) fail("arguments")
  const [
    action,
    managerDigest,
    destination,
    gateway,
    device,
    source,
    port,
    nftFile,
  ] = process.argv.slice(2)
  process.stdout.write(
    `${JSON.stringify(
      manageInferenceRoute(action, {
        destination,
        device,
        gateway,
        managerDigest,
        managerPath: process.argv[1],
        nftFile,
        port: Number(port),
        source,
      }),
    )}\n`,
  )
}
