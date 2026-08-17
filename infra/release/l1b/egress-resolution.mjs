import { createHash } from "node:crypto"
import { isIPv4 } from "node:net"

function fail(message) {
  throw new Error(message)
}

export function validateEgressResolution(policy, policyBytes, resolution) {
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

  const entries = []
  for (const host of policy.hosts) {
    const addresses = resolution.resolutions[host]
    if (
      !Array.isArray(addresses) ||
      addresses.length === 0 ||
      addresses.some((address) => !isIPv4(address)) ||
      JSON.stringify(addresses) !==
        JSON.stringify([...new Set(addresses)].sort())
    ) {
      fail(`${host} resolution is invalid or non-canonical`)
    }
    entries.push({ host, addresses })
  }
  return entries
}
