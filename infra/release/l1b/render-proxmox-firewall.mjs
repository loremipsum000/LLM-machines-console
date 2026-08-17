#!/usr/bin/env node

import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const directory = dirname(fileURLToPath(import.meta.url))
const ipv4Pattern =
  /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

function fail(message) {
  throw new Error(message)
}

export function renderFirewall(policy, resolution, profile) {
  const policyBytes = readFileSync(resolve(directory, "egress-allowlist.json"))
  const expectedPolicyHash = `sha256:${createHash("sha256").update(policyBytes).digest("hex")}`
  if (
    resolution?.schema !== "llm-machines.vm103-l1b-egress-resolution.v2" ||
    resolution?.policySha256 !== expectedPolicyHash ||
    resolution?.dnsResolver !== policy.dnsResolver ||
    JSON.stringify(Object.keys(resolution?.resolutions ?? {}).sort()) !==
      JSON.stringify(policy.hosts)
  ) {
    fail("egress resolution does not bind the exact allowlist")
  }
  const addresses = []
  for (const host of policy.hosts) {
    const values = resolution.resolutions[host]
    if (
      !Array.isArray(values) ||
      values.length === 0 ||
      values.some((value) => !ipv4Pattern.test(value))
    ) {
      fail(`${host} resolution is invalid`)
    }
    addresses.push(...values.map((value) => ({ value, host })))
  }
  const unique = new Map(addresses.map((entry) => [entry.value, entry.host]))
  return [
    "[OPTIONS]",
    "enable: 1",
    "policy_in: DROP",
    "policy_out: DROP",
    "log_level_in: warning",
    "log_level_out: warning",
    "",
    "[IPSET llmm-l1b-egress]",
    ...[...unique.entries()]
      .sort(([left], [right]) =>
        left.localeCompare(right, "en", { numeric: true }),
      )
      .map(([address, host]) => `${address} # ${host}`),
    "",
    "[RULES]",
    `IN ACCEPT -source ${profile.network.operatorSsh.sourceCidr} -p tcp -dport 22 -log nolog`,
    "IN ACCEPT -source 10.33.74.1 -p udp -sport 67 -dport 68 -log nolog",
    "OUT ACCEPT -dest 255.255.255.255 -p udp -sport 68 -dport 67 -log nolog",
    `OUT ACCEPT -dest ${policy.dnsResolver} -p udp -dport 53 -log nolog`,
    `OUT ACCEPT -dest ${policy.dnsResolver} -p tcp -dport 53 -log nolog`,
    `OUT ACCEPT -dest ${policy.dnsResolver} -p udp -dport 123 -log nolog`,
    "OUT ACCEPT -dest +llmm-l1b-egress -p tcp -dport 443 -log nolog",
    "",
  ].join("\n")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (
    process.argv.length !== 6 ||
    process.argv[2] !== "--resolution" ||
    process.argv[4] !== "--output"
  ) {
    fail("expected --resolution FILE --output FILE")
  }
  const policy = JSON.parse(
    readFileSync(resolve(directory, "egress-allowlist.json"), "utf8"),
  )
  const profile = JSON.parse(
    readFileSync(resolve(directory, "builder-profile.json"), "utf8"),
  )
  const resolution = JSON.parse(readFileSync(resolve(process.argv[3]), "utf8"))
  writeFileSync(
    resolve(process.argv[5]),
    renderFirewall(policy, resolution, profile),
    { flag: "wx", mode: 0o600 },
  )
}
