import { createHash } from "node:crypto"
import { isIPv4 } from "node:net"

export const canonicalIpv4Order = "IPV4_NUMERIC_ASCENDING"

function fail(message) {
  throw new Error(message)
}

export function compareIpv4Numeric(left, right) {
  const leftParts = left.split(".").map(Number)
  const rightParts = right.split(".").map(Number)
  for (let index = 0; index < 4; index += 1) {
    const difference = leftParts[index] - rightParts[index]
    if (difference !== 0) return difference
  }
  return 0
}

export function validateEgressResolution(policy, policyBytes, resolution) {
  const expectedPolicyHash = `sha256:${createHash("sha256").update(policyBytes).digest("hex")}`
  if (
    policy?.addressOrder !== canonicalIpv4Order ||
    resolution?.schema !== "llm-machines.vm103-l1b-egress-resolution.v3" ||
    resolution?.policySha256 !== expectedPolicyHash ||
    resolution?.dnsResolver !== policy.dnsResolver ||
    resolution?.addressOrder !== canonicalIpv4Order ||
    JSON.stringify(Object.keys(resolution?.resolutions ?? {}).sort()) !==
      JSON.stringify(policy.hosts)
  ) {
    fail("egress resolution does not bind the exact allowlist")
  }

  const entries = []
  for (const host of policy.hosts) {
    const addresses = resolution.resolutions[host]
    if (
      !Array.isArray(addresses) ||
      addresses.length === 0 ||
      addresses.some((address) => !isIPv4(address)) ||
      JSON.stringify(addresses) !==
        JSON.stringify([...new Set(addresses)].sort(compareIpv4Numeric))
    ) {
      fail(`${host} resolution is invalid or non-canonical`)
    }
    entries.push({ host, addresses })
  }
  return entries
}
