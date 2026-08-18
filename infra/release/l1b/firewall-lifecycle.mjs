#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const sysctlKeys = [
  "net.ipv4.ip_forward",
  "net.ipv6.conf.all.forwarding",
  "net.bridge.bridge-nf-call-iptables",
  "net.bridge.bridge-nf-call-ip6tables",
  "net.bridge.bridge-nf-call-arptables",
]

function fail(message) {
  throw new Error(message)
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function command(command_, args, { allowFailure = false } = {}) {
  const result = spawnSync(command_, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
  if (!allowFailure && result.status !== 0) {
    fail(`${command_} failed with status ${result.status}`)
  }
  return result
}

export function parseIptablesSave(source) {
  const tables = {}
  let current
  for (const line_ of source.split(/\r?\n/)) {
    const line = line_.trim()
    if (!line || line.startsWith("#")) continue
    if (line.startsWith("*")) {
      current = line.slice(1)
      if (tables[current]) fail("iptables state contains a duplicate table")
      tables[current] = { chains: {}, order: [] }
      continue
    }
    if (line === "COMMIT") {
      current = undefined
      continue
    }
    if (!current) fail("iptables state contains content outside a table")
    if (line.startsWith(":")) {
      const match = line.match(/^:([^ ]+) ([^ ]+) \[[0-9]+:[0-9]+\]$/)
      if (!match) fail("iptables chain declaration is invalid")
      const [, name, policy] = match
      tables[current].chains[name] = { policy, rules: [] }
      tables[current].order.push(name)
      continue
    }
    const match = line.match(/^-A ([^ ]+) (.+)$/)
    if (!match || !tables[current].chains[match[1]]) {
      fail("iptables rule is not bound to a declared chain")
    }
    tables[current].chains[match[1]].rules.push(line)
  }
  if (current) fail("iptables table is missing COMMIT")
  return tables
}

export function normalizeNft(source) {
  return source
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("# Warning:"))
    .map((line) =>
      line.replace(
        /counter packets [0-9]+ bytes [0-9]+/g,
        "counter packets 0 bytes 0",
      ),
    )
    .join("\n")
    .trim()
}

function nftTables(source) {
  const tables = new Map()
  const lines = source.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(
      /^table (ip6?|inet|arp|bridge|netdev) ([^ ]+) \{$/,
    )
    if (!match) continue
    let depth = 0
    const block = []
    for (; index < lines.length; index += 1) {
      const line = lines[index]
      block.push(line)
      depth += (line.match(/\{/g) ?? []).length
      depth -= (line.match(/\}/g) ?? []).length
      if (depth === 0) break
    }
    tables.set(`${match[1]}:${match[2]}`, block.join("\n"))
  }
  return tables
}

function readState(path) {
  const state = JSON.parse(readFileSync(resolve(path, "state.json"), "utf8"))
  if (state?.schema !== "llm-machines.vm103-l1b-firewall-state.v1") {
    fail("firewall state schema differs")
  }
  return state
}

function writeExclusive(path, value) {
  writeFileSync(path, value, { flag: "wx", mode: 0o600 })
  chmodSync(path, 0o600)
}

export function captureFirewallState(outputDirectory, run = command) {
  const output = resolve(outputDirectory)
  mkdirSync(output, { mode: 0o700 })
  const rawV4 = run("iptables-save", []).stdout
  const rawV6 = run("ip6tables-save", []).stdout
  const rawNft = run("nft", ["list", "ruleset"]).stdout
  const sysctls = Object.fromEntries(
    sysctlKeys.map((key) => {
      const result = run("sysctl", ["-n", key])
      return [key, result.stdout.trim()]
    }),
  )
  const state = {
    schema: "llm-machines.vm103-l1b-firewall-state.v1",
    iptablesV4: parseIptablesSave(rawV4),
    iptablesV6: parseIptablesSave(rawV6),
    nft: normalizeNft(rawNft),
    sysctls,
  }
  const stateBytes = `${canonicalJson(state)}\n`
  writeExclusive(resolve(output, "iptables-v4.raw"), rawV4)
  writeExclusive(resolve(output, "iptables-v6.raw"), rawV6)
  writeExclusive(resolve(output, "nft.raw"), rawNft)
  writeExclusive(resolve(output, "state.json"), stateBytes)
  writeExclusive(
    resolve(output, "manifest.json"),
    `${canonicalJson({
      schema: "llm-machines.vm103-l1b-firewall-state-manifest.v1",
      stateSha256: sha256(stateBytes),
      containsCredentials: false,
    })}\n`,
  )
  return state
}

function mentionsRunnerIdentity(rule, { bridge, cidr, gateway }) {
  return (
    rule.includes(bridge) ||
    rule.includes(cidr) ||
    rule.includes(gateway) ||
    /(?:^| )-j DOCKER(?:-| |$)/.test(rule)
  )
}

const dockerChains = new Set([
  "DOCKER",
  "DOCKER-BRIDGE",
  "DOCKER-CT",
  "DOCKER-FORWARD",
  "DOCKER-INTERNAL",
  "DOCKER-USER",
])

function runnerIptablesRules(family, table, chain, profile) {
  const { bridge, cidr } = profile
  const rules = new Set()
  if (table === "filter" && chain === "FORWARD") {
    rules.add("-A FORWARD -j DOCKER-USER")
    rules.add("-A FORWARD -j DOCKER-FORWARD")
  }
  if (family === "ip" && table === "filter") {
    if (chain === "DOCKER")
      rules.add(`-A DOCKER ! -i ${bridge} -o ${bridge} -j DROP`)
    if (chain === "DOCKER-BRIDGE")
      rules.add(`-A DOCKER-BRIDGE -o ${bridge} -j DOCKER`)
    if (chain === "DOCKER-CT")
      rules.add(
        `-A DOCKER-CT -o ${bridge} -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT`,
      )
    if (chain === "DOCKER-FORWARD") {
      rules.add("-A DOCKER-FORWARD -j DOCKER-CT")
      rules.add("-A DOCKER-FORWARD -j DOCKER-INTERNAL")
      rules.add("-A DOCKER-FORWARD -j DOCKER-BRIDGE")
      rules.add(`-A DOCKER-FORWARD -i ${bridge} -j ACCEPT`)
    }
  }
  if (family === "ip6" && table === "filter" && chain === "DOCKER-FORWARD") {
    rules.add("-A DOCKER-FORWARD -j DOCKER-CT")
    rules.add("-A DOCKER-FORWARD -j DOCKER-INTERNAL")
    rules.add("-A DOCKER-FORWARD -j DOCKER-BRIDGE")
  }
  if (table === "nat") {
    if (chain === "PREROUTING")
      rules.add("-A PREROUTING -m addrtype --dst-type LOCAL -j DOCKER")
    if (chain === "OUTPUT") {
      rules.add(
        family === "ip"
          ? "-A OUTPUT ! -d 127.0.0.0/8 -m addrtype --dst-type LOCAL -j DOCKER"
          : "-A OUTPUT ! -d ::1/128 -m addrtype --dst-type LOCAL -j DOCKER",
      )
    }
    if (family === "ip" && chain === "POSTROUTING")
      rules.add(`-A POSTROUTING -s ${cidr} ! -o ${bridge} -j MASQUERADE`)
  }
  return rules
}

function ruleOwned(rule, family, table, chain, profile) {
  return runnerIptablesRules(family, table, chain, profile).has(rule)
}

export function assertNoFirewallCollision(state, profile) {
  for (const family of ["iptablesV4", "iptablesV6"]) {
    for (const table of Object.values(state[family])) {
      for (const [name, chain] of Object.entries(table.chains)) {
        if (dockerChains.has(name)) fail("pre-existing Docker chain is denied")
        if (
          chain.rules.some(
            (rule) =>
              mentionsRunnerIdentity(rule, profile) ||
              /(?:^| )-j DOCKER(?:-| |$)/.test(rule),
          )
        ) {
          fail("pre-existing runner firewall rule is denied")
        }
      }
    }
  }
  if (
    state.nft.includes("docker-bridges") ||
    state.nft.includes(profile.bridge) ||
    state.nft.includes(profile.cidr) ||
    state.nft.includes(profile.gateway)
  ) {
    fail("pre-existing runner nftables state is denied")
  }
}

function addedRuleIndexes(baseline, current) {
  const added = []
  let baselineIndex = 0
  for (let index = 0; index < current.length; index += 1) {
    if (current[index] === baseline[baselineIndex]) {
      baselineIndex += 1
    } else {
      added.push(index + 1)
    }
  }
  if (baselineIndex !== baseline.length) {
    fail("an unrelated iptables rule was removed or reordered")
  }
  return added
}

const builtins = {
  filter: new Set(["INPUT", "FORWARD", "OUTPUT"]),
  nat: new Set(["PREROUTING", "INPUT", "OUTPUT", "POSTROUTING"]),
}

function planFamily(baseline, current, family, profile) {
  const operations = []
  for (const tableName of Object.keys(baseline)) {
    if (!current[tableName]) fail("an unrelated iptables table was removed")
  }
  for (const [tableName, table] of Object.entries(current)) {
    const prior = baseline[tableName]
    if (!prior) {
      if (!builtins[tableName]) fail("an unapproved iptables table appeared")
      for (const [chainName, chain] of Object.entries(table.chains)) {
        if (
          !builtins[tableName].has(chainName) &&
          !dockerChains.has(chainName)
        ) {
          fail("an unapproved chain appeared in a runner-created table")
        }
        if (
          chain.rules.some(
            (rule) => !ruleOwned(rule, family, tableName, chainName, profile),
          )
        )
          fail("a runner-created table contains an unrelated rule")
      }
      operations.push({ action: "delete-nft-table", family, table: tableName })
      continue
    }
    for (const chainName of Object.keys(prior.chains)) {
      if (!table.chains[chainName])
        fail("an unrelated iptables chain was removed")
    }
    const newChains = Object.keys(table.chains).filter(
      (name) => !prior.chains[name],
    )
    if (newChains.some((name) => !dockerChains.has(name))) {
      fail("an unapproved iptables chain appeared")
    }
    for (const chainName of newChains) {
      if (
        table.chains[chainName].rules.some(
          (rule) => !ruleOwned(rule, family, tableName, chainName, profile),
        )
      )
        fail("a runner-created chain contains an unrelated rule")
    }
    for (const [chainName, chain] of Object.entries(prior.chains)) {
      const currentChain = table.chains[chainName]
      const indexes = addedRuleIndexes(chain.rules, currentChain.rules)
      for (const index of indexes) {
        if (
          !ruleOwned(
            currentChain.rules[index - 1],
            family,
            tableName,
            chainName,
            profile,
          )
        ) {
          fail("an unrelated iptables rule appeared")
        }
      }
      for (const index of indexes.reverse()) {
        operations.push({
          action: "delete-rule-index",
          family,
          table: tableName,
          chain: chainName,
          index,
        })
      }
      if (chain.policy !== currentChain.policy) {
        if (chainName !== "FORWARD") fail("an unrelated chain policy changed")
        operations.push({
          action: "restore-policy",
          family,
          table: tableName,
          chain: chainName,
          policy: chain.policy,
        })
      }
    }
    for (const chainName of newChains) {
      operations.push({
        action: "flush-chain",
        family,
        table: tableName,
        chain: chainName,
      })
    }
    for (const chainName of [...newChains].reverse()) {
      operations.push({
        action: "delete-chain",
        family,
        table: tableName,
        chain: chainName,
      })
    }
  }
  return operations
}

function nftAddedLines(baseline, current) {
  const before = baseline === "" ? [] : baseline.split("\n")
  const after = current === "" ? [] : current.split("\n")
  const added = []
  let beforeIndex = 0
  for (const line of after) {
    if (line === before[beforeIndex]) beforeIndex += 1
    else added.push(line.trim())
  }
  if (beforeIndex !== before.length)
    fail("an unrelated nftables rule was removed or reordered")
  return added
}

function nftLineOwned(line, profile) {
  const { bridge, cidr } = profile
  return new Set([
    "",
    "}",
    "table ip filter {",
    "table ip nat {",
    "table ip6 filter {",
    "table ip6 nat {",
    "chain INPUT {",
    "chain FORWARD {",
    "chain OUTPUT {",
    "chain PREROUTING {",
    "chain POSTROUTING {",
    "chain DOCKER {",
    "chain DOCKER-BRIDGE {",
    "chain DOCKER-CT {",
    "chain DOCKER-FORWARD {",
    "chain DOCKER-INTERNAL {",
    "chain DOCKER-USER {",
    "type filter hook forward priority filter; policy accept;",
    "type filter hook forward priority filter; policy drop;",
    "type nat hook prerouting priority dstnat; policy accept;",
    "type nat hook output priority dstnat; policy accept;",
    "type nat hook postrouting priority srcnat; policy accept;",
    "fib daddr type local counter packets 0 bytes 0 jump DOCKER",
    "ip daddr != 127.0.0.0/8 fib daddr type local counter packets 0 bytes 0 jump DOCKER",
    "ip6 daddr != ::1 fib daddr type local counter packets 0 bytes 0 jump DOCKER",
    `ip saddr ${cidr} oifname != "${bridge}" counter packets 0 bytes 0 masquerade`,
    `iifname != "${bridge}" oifname "${bridge}" counter packets 0 bytes 0 drop`,
    "counter packets 0 bytes 0 jump DOCKER-CT",
    "counter packets 0 bytes 0 jump DOCKER-INTERNAL",
    "counter packets 0 bytes 0 jump DOCKER-BRIDGE",
    `iifname "${bridge}" counter packets 0 bytes 0 accept`,
    `oifname "${bridge}" counter packets 0 bytes 0 jump DOCKER`,
    `oifname "${bridge}" ct state related,established counter packets 0 bytes 0 accept`,
    "counter packets 0 bytes 0 jump DOCKER-USER",
    "counter packets 0 bytes 0 jump DOCKER-FORWARD",
  ]).has(line)
}

function validateNftDelta(baseline, current, plannedFamilies, profile) {
  const before = nftTables(baseline)
  const after = nftTables(current)
  for (const [identity, block] of before) {
    if (!after.has(identity)) fail("an unrelated nftables table was removed")
    if (after.get(identity) !== block) {
      if (!plannedFamilies.has(identity))
        fail("an unrelated nftables table changed")
      if (
        nftAddedLines(block, after.get(identity)).some(
          (line) => !nftLineOwned(line, profile),
        )
      ) {
        fail("a Docker-touched nftables table contains an unrelated rule")
      }
    }
  }
  for (const [identity, block] of after) {
    if (!before.has(identity) && !plannedFamilies.has(identity)) {
      fail("an unapproved nftables table appeared")
    }
    if (
      !before.has(identity) &&
      block
        .split("\n")
        .map((line) => line.trim())
        .some((line) => !nftLineOwned(line, profile))
    ) {
      fail("a runner-created nftables table contains an unrelated rule")
    }
  }
}

export function planFirewallCleanup(baseline, current, profile) {
  const operations = [
    ...planFamily(baseline.iptablesV4, current.iptablesV4, "ip", profile),
    ...planFamily(baseline.iptablesV6, current.iptablesV6, "ip6", profile),
  ]
  const plannedFamilies = new Set(
    operations
      .filter(({ action }) => action === "delete-nft-table")
      .map(({ family, table }) => `${family}:${table}`),
  )
  for (const operation of operations) {
    if (operation.action !== "delete-nft-table") {
      plannedFamilies.add(`${operation.family}:${operation.table}`)
    }
  }
  validateNftDelta(baseline.nft, current.nft, plannedFamilies, profile)
  for (const key of sysctlKeys) {
    const before = baseline.sysctls[key]
    const after = current.sysctls[key]
    if (before === after) continue
    if (before === null || after === null) {
      fail("a relevant sysctl appeared or disappeared")
    }
    operations.push({ action: "restore-sysctl", key, value: before })
  }
  return {
    schema: "llm-machines.vm103-l1b-firewall-cleanup-plan.v1",
    profile,
    operations,
  }
}

function pushDelta(records, value) {
  records.push(canonicalJson(value))
}

function iptablesDeltaRecords(baseline, current, family) {
  const records = []
  for (const [tableName, table] of Object.entries(current)) {
    const prior = baseline[tableName]
    if (!prior) {
      pushDelta(records, { family, table: tableName, kind: "table" })
    }
    for (const [chainName, chain] of Object.entries(table.chains)) {
      const priorChain = prior?.chains[chainName]
      if (!priorChain) {
        pushDelta(records, {
          family,
          table: tableName,
          chain: chainName,
          kind: "chain",
          policy: chain.policy,
        })
        for (const rule of chain.rules) {
          pushDelta(records, {
            family,
            table: tableName,
            chain: chainName,
            kind: "rule",
            rule,
          })
        }
        continue
      }
      const addedIndexes = addedRuleIndexes(priorChain.rules, chain.rules)
      for (const index of addedIndexes) {
        pushDelta(records, {
          family,
          table: tableName,
          chain: chainName,
          kind: "rule",
          rule: chain.rules[index - 1],
        })
      }
      if (priorChain.policy !== chain.policy) {
        pushDelta(records, {
          family,
          table: tableName,
          chain: chainName,
          kind: "policy",
          value: chain.policy,
        })
      }
    }
  }
  return records
}

function firewallDeltaRecords(baseline, current) {
  const records = [
    ...iptablesDeltaRecords(baseline.iptablesV4, current.iptablesV4, "ip"),
    ...iptablesDeltaRecords(baseline.iptablesV6, current.iptablesV6, "ip6"),
  ]
  for (const line of nftAddedLines(baseline.nft, current.nft)) {
    pushDelta(records, { kind: "nft-line", line })
  }
  for (const key of sysctlKeys) {
    if (baseline.sysctls[key] !== current.sysctls[key]) {
      pushDelta(records, {
        kind: "sysctl",
        key,
        value: current.sysctls[key],
      })
    }
  }
  return records
}

function assertMultisetSubset(allowed, observed) {
  const counts = new Map()
  for (const value of allowed) counts.set(value, (counts.get(value) ?? 0) + 1)
  for (const value of observed) {
    const count = counts.get(value) ?? 0
    if (count === 0)
      fail("post-graceful firewall delta exceeds the captured active delta")
    counts.set(value, count - 1)
  }
}

export function assertCleanupWithinActiveDelta(
  baseline,
  active,
  current,
  profile,
) {
  planFirewallCleanup(baseline, active, profile)
  planFirewallCleanup(baseline, current, profile)
  assertMultisetSubset(
    firewallDeltaRecords(baseline, active),
    firewallDeltaRecords(baseline, current),
  )
}

function executePlan(plan, run = command) {
  for (const operation of plan.operations) {
    const iptables = operation.family === "ip6" ? "ip6tables" : "iptables"
    switch (operation.action) {
      case "delete-nft-table":
        run("nft", ["delete", "table", operation.family, operation.table])
        break
      case "delete-rule-index":
        run(iptables, [
          "-t",
          operation.table,
          "-D",
          operation.chain,
          String(operation.index),
        ])
        break
      case "flush-chain":
        run(iptables, ["-t", operation.table, "-F", operation.chain])
        break
      case "delete-chain":
        run(iptables, ["-t", operation.table, "-X", operation.chain])
        break
      case "restore-policy":
        run(iptables, [
          "-t",
          operation.table,
          "-P",
          operation.chain,
          operation.policy,
        ])
        break
      case "restore-sysctl":
        run("sysctl", ["-q", "-w", `${operation.key}=${operation.value}`])
        break
      default:
        fail("firewall cleanup plan contains an unsupported action")
    }
  }
}

export function statesEquivalent(baseline, current) {
  return canonicalJson(baseline) === canonicalJson(current)
}

function values() {
  const result = new Map()
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index]
    const value = process.argv[index + 1]
    if (!key?.startsWith("--") || value === undefined || result.has(key)) {
      fail("firewall lifecycle arguments are invalid")
    }
    result.set(key, value)
  }
  return result
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = values()
  const action = args.get("--action")
  const profile = {
    bridge: args.get("--bridge"),
    cidr: args.get("--cidr"),
    gateway: args.get("--gateway"),
  }
  if (action === "capture" && args.size === 2) {
    captureFirewallState(args.get("--output"))
  } else if (action === "assert-clean" && args.size === 5) {
    assertNoFirewallCollision(readState(args.get("--snapshot")), profile)
  } else if (action === "plan" && args.size === 7) {
    const baseline = readState(args.get("--baseline"))
    const current = readState(args.get("--current"))
    const plan = planFirewallCleanup(baseline, current, profile)
    const planBytes = `${canonicalJson(plan)}\n`
    writeExclusive(resolve(args.get("--plan")), planBytes)
  } else if (action === "cleanup" && args.size === 8) {
    const baseline = readState(args.get("--baseline"))
    const active = readState(args.get("--active"))
    const current = readState(args.get("--current"))
    assertCleanupWithinActiveDelta(baseline, active, current, profile)
    const plan = planFirewallCleanup(baseline, current, profile)
    const planBytes = `${canonicalJson(plan)}\n`
    writeExclusive(resolve(args.get("--plan")), planBytes)
    executePlan(plan)
  } else if (action === "verify-equivalent" && args.size === 3) {
    if (
      !statesEquivalent(
        readState(args.get("--baseline")),
        readState(args.get("--current")),
      )
    ) {
      fail("post-cleanup firewall state differs from the pre-start baseline")
    }
  } else {
    fail("firewall lifecycle action arguments differ")
  }
}
