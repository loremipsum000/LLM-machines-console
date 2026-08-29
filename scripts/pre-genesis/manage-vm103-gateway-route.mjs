#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
} from "node:fs"
import { isIP } from "node:net"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const iptables = "/usr/sbin/iptables"
const table = "nat"
const chain = "POSTROUTING"
const ownerComment = "llmm-vm103-sglang"
const lifecycleLock = "/run/llmm-vm103-gateway-route.lock"
const commandEnvironment = {
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
}

export function renderGatewayRuleArguments(source, destination, port) {
  validateNetworkContract({ destination, port, source })
  return [
    "-s",
    `${source}/32`,
    "-d",
    `${destination}/32`,
    "-p",
    "tcp",
    "--dport",
    String(port),
    "-m",
    "comment",
    "--comment",
    ownerComment,
    "-j",
    "ACCEPT",
  ]
}

export function inspectGatewayFirewall(document, source, destination, port) {
  validateNetworkContract({ destination, port, source })
  if (typeof document !== "string" || document.includes("\0")) {
    fail("firewall inspection")
  }
  const expected = [
    "-A",
    chain,
    "-s",
    `${source}/32`,
    "-d",
    `${destination}/32`,
    "-p",
    "tcp",
    "-m",
    "tcp",
    "--dport",
    String(port),
    "-m",
    "comment",
    "--comment",
    ownerComment,
    "-j",
    "ACCEPT",
  ]
  let exactOwnedCount = 0
  let collisionCount = 0
  for (const line of document.split("\n")) {
    if (!line.trim()) continue
    const words = parseIptablesWords(line)
    if (words[0] !== "-A") continue
    const exact = sameWords(words, expected)
    if (exact) {
      exactOwnedCount += 1
      continue
    }
    if (
      optionValues(words, "--comment").includes(ownerComment) ||
      overlapsOwnedTraffic(words, source, destination, port)
    ) {
      collisionCount += 1
    }
  }
  if (exactOwnedCount === 0 && collisionCount === 0) {
    return { exactOwnedCount: 0, state: "absent" }
  }
  if (exactOwnedCount === 1 && collisionCount === 0) {
    return { exactOwnedCount: 1, state: "exact" }
  }
  return { exactOwnedCount, state: "collision" }
}

export function reconcileGatewayFirewall(
  action,
  { acquireLock, addRule, deleteRule, inspect },
) {
  const releaseLock = acquireLock()
  if (typeof releaseLock !== "function") fail("lifecycle lock")
  try {
    if (action === "apply") {
      if (inspect().state !== "absent") fail("pre-existing state")
      let ruleCreated = false
      try {
        addRule()
        ruleCreated = true
        if (inspect().state !== "exact") fail("apply")
        return { preimage: "absent", state: "exact" }
      } catch (error) {
        if (ruleCreated) cleanupFailedApply({ deleteRule, inspect })
        throw error
      }
    }
    if (action === "remove") {
      const current = inspect()
      if (current.state === "absent") return { state: "absent" }
      if (current.state !== "exact") fail("rollback ownership")
      deleteRule()
      const after = inspect()
      if (after.exactOwnedCount !== 0 || after.state !== "absent") {
        fail("rollback")
      }
      return { state: "absent" }
    }
    if (action === "status") return inspect()
    fail("action")
  } finally {
    releaseLock()
  }
}

export function acquireGatewayLifecycleLock(
  path = lifecycleLock,
  expectedUid = 0,
) {
  if (!/^\/(?:[A-Za-z0-9._-]+\/?)+$/.test(path) || path.includes("..")) {
    fail("lifecycle lock path")
  }
  const parent = dirname(path)
  let parentStat
  let parentCanonical
  try {
    parentStat = lstatSync(parent)
    parentCanonical = realpathSync(parent)
  } catch {
    fail("lifecycle lock parent")
  }
  if (
    resolve(parent) !== parentCanonical ||
    parentStat.isSymbolicLink() ||
    !parentStat.isDirectory() ||
    parentStat.uid !== expectedUid ||
    (parentStat.mode & 0o002) !== 0
  ) {
    fail("lifecycle lock parent")
  }
  try {
    mkdirSync(path, { mode: 0o700 })
  } catch {
    fail("lifecycle lock collision")
  }
  try {
    verifyLockDirectory(path, expectedUid)
  } catch (error) {
    try {
      rmdirSync(path)
    } catch {
      fail("lifecycle lock ownership")
    }
    throw error
  }
  return () => {
    verifyLockDirectory(path, expectedUid)
    if (readdirSync(path).length !== 0) fail("lifecycle lock ownership")
    rmdirSync(path)
    try {
      lstatSync(path)
      fail("lifecycle lock cleanup")
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
  }
}

export function verifyManagedGatewayScript(
  path,
  expectedDigest,
  expectedUid = 0,
) {
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedDigest)) {
    fail("script digest")
  }
  let stat
  let canonical
  let content
  try {
    stat = lstatSync(path)
    canonical = realpathSync(path)
    content = readFileSync(path)
  } catch {
    fail("managed script")
  }
  const actualDigest = `sha256:${createHash("sha256").update(content).digest("hex")}`
  if (
    resolve(path) !== canonical ||
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.uid !== expectedUid ||
    (stat.mode & 0o7777) !== 0o600 ||
    actualDigest !== expectedDigest
  ) {
    fail("managed script")
  }
  return { sha256: actualDigest }
}

export function manageGatewayFirewall(action, options) {
  validateNetworkContract(options)
  verifyManagedGatewayScript(options.scriptPath, options.scriptDigest)
  if (process.getuid?.() !== 0) fail("privilege")
  const ruleArguments = renderGatewayRuleArguments(
    options.source,
    options.destination,
    options.port,
  )
  return reconcileGatewayFirewall(action, {
    acquireLock: () => acquireGatewayLifecycleLock(),
    addRule: () =>
      run(["-w", "10", "-t", table, "-I", chain, "1", ...ruleArguments]),
    deleteRule: () =>
      run(["-w", "10", "-t", table, "-D", chain, ...ruleArguments]),
    inspect: () =>
      inspectGatewayFirewall(
        run(["-w", "10", "-t", table, "-S"]),
        options.source,
        options.destination,
        options.port,
      ),
  })
}

function verifyLockDirectory(path, expectedUid) {
  let stat
  let canonical
  try {
    stat = lstatSync(path)
    canonical = realpathSync(path)
  } catch {
    fail("lifecycle lock ownership")
  }
  if (
    resolve(path) !== canonical ||
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    stat.uid !== expectedUid ||
    (stat.mode & 0o7777) !== 0o700
  ) {
    fail("lifecycle lock ownership")
  }
}

function cleanupFailedApply({ deleteRule, inspect }) {
  const current = inspect()
  if (current.exactOwnedCount !== 1) {
    fail("failed-apply ownership")
  }
  deleteRule()
  const after = inspect()
  if (after.exactOwnedCount !== 0) fail("failed-apply cleanup")
}

function overlapsOwnedTraffic(words, source, destination, port) {
  if (words[1] !== chain) return false
  const sources = optionValues(words, "-s")
  const destinations = optionValues(words, "-d")
  if (
    !sources.includes(`${source}/32`) ||
    !destinations.includes(`${destination}/32`)
  ) {
    return false
  }
  const ports = optionValues(words, "--dport")
  return ports.length === 0 || ports.includes(String(port))
}

function optionValues(words, option) {
  const values = []
  for (let index = 0; index < words.length - 1; index += 1) {
    if (words[index] === option) values.push(words[index + 1])
  }
  return values
}

function parseIptablesWords(line) {
  const words = []
  let word = ""
  let quote = ""
  let escaped = false
  let started = false
  for (const character of line.trim()) {
    if (escaped) {
      word += character
      escaped = false
      started = true
      continue
    }
    if (character === "\\") {
      escaped = true
      started = true
      continue
    }
    if (quote) {
      if (character === quote) quote = ""
      else word += character
      started = true
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      started = true
      continue
    }
    if (/\s/.test(character)) {
      if (started) {
        words.push(word)
        word = ""
        started = false
      }
      continue
    }
    word += character
    started = true
  }
  if (escaped || quote) fail("firewall inspection")
  if (started) words.push(word)
  return words
}

function sameWords(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((word, index) => word === expected[index])
  )
}

function validateNetworkContract(value) {
  if (
    !privateIpv4(value.source) ||
    !privateIpv4(value.destination) ||
    !Number.isInteger(value.port) ||
    value.port < 1024 ||
    value.port > 65_535
  ) {
    fail("arguments")
  }
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

function run(arguments_) {
  return execFileSync(iptables, arguments_, {
    encoding: "utf8",
    env: commandEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function fail(reason) {
  throw new Error(`VM103 gateway route lifecycle is invalid: ${reason}.`)
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
  if (process.argv.length !== 7) fail("arguments")
  const [action, scriptDigest, source, destination, port] =
    process.argv.slice(2)
  process.stdout.write(
    `${JSON.stringify(
      manageGatewayFirewall(action, {
        destination,
        port: Number(port),
        scriptDigest,
        scriptPath: process.argv[1],
        source,
      }),
    )}\n`,
  )
}
