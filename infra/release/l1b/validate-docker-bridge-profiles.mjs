#!/usr/bin/env node

import { readFileSync } from "node:fs"
import { isIP } from "node:net"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const directory = dirname(fileURLToPath(import.meta.url))

function ipv4Number(value) {
  if (isIP(value) !== 4) throw new Error(`invalid IPv4 address: ${value}`)
  return (
    value
      .split(".")
      .map(Number)
      .reduce((result, octet) => (result << 8) + octet, 0) >>> 0
  )
}

function parseCidr(value) {
  const [address, prefixText, ...extra] = String(value).split("/")
  const prefix = Number.parseInt(prefixText, 10)
  if (extra.length > 0 || prefix !== 24)
    throw new Error(`bridge CIDR must be an exact /24: ${value}`)
  const addressNumber = ipv4Number(address)
  const mask = 0xffffff00
  return {
    address,
    prefix,
    network: (addressNumber & mask) >>> 0,
    broadcast: ((addressNumber & mask) >>> 0) + 255,
  }
}

function exactKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expected].sort())
  )
}

export function validateDockerBridgeProfiles(document) {
  const errors = []
  if (
    !exactKeys(document, [
      "schema",
      "status",
      "containsCredentials",
      "requiredPrivilege",
      "profiles",
    ]) ||
    document.schema !== "llm-machines.vm103-l1b-docker-bridge-profiles.v1" ||
    document.status !== "LOCKED_SOURCE_PROFILE" ||
    document.containsCredentials !== false ||
    document.requiredPrivilege !== "ROOT"
  ) {
    errors.push("Docker bridge profile identity differs")
  }

  if (!Array.isArray(document?.profiles) || document.profiles.length !== 2) {
    errors.push("Docker bridge profile must contain exactly Assembly A and B")
    return errors
  }

  const expected = new Map([
    [
      "A",
      {
        assembly: "A",
        bridge: "llmml1ba0",
        networkCidr: "172.30.118.0/24",
        gatewayAddress: "172.30.118.1",
        gatewayCidr: "172.30.118.1/24",
        addressPrefix: "172.30.118.",
      },
    ],
    [
      "B",
      {
        assembly: "B",
        bridge: "llmml1bb0",
        networkCidr: "172.31.118.0/24",
        gatewayAddress: "172.31.118.1",
        gatewayCidr: "172.31.118.1/24",
        addressPrefix: "172.31.118.",
      },
    ],
  ])
  const observedAssemblies = new Set()
  const observedBridges = new Set()
  const observedCidrs = new Set()
  const networks = []

  for (const profile of document.profiles) {
    if (
      !exactKeys(profile, [
        "assembly",
        "bridge",
        "networkCidr",
        "gatewayAddress",
        "gatewayCidr",
        "addressPrefix",
      ])
    ) {
      errors.push("Docker bridge profile fields differ")
      continue
    }
    const expectedProfile = expected.get(profile.assembly)
    if (!expectedProfile || observedAssemblies.has(profile.assembly)) {
      errors.push("Docker bridge assembly identity is invalid or duplicated")
      continue
    }
    observedAssemblies.add(profile.assembly)
    if (observedBridges.has(profile.bridge))
      errors.push("Docker bridge name is duplicated")
    observedBridges.add(profile.bridge)
    if (observedCidrs.has(profile.networkCidr))
      errors.push("Docker bridge CIDR is duplicated")
    observedCidrs.add(profile.networkCidr)
    if (JSON.stringify(profile) !== JSON.stringify(expectedProfile)) {
      errors.push(`Assembly ${profile.assembly} bridge profile differs`)
    }
    if (!/^[a-z0-9]{1,15}$/.test(profile.bridge)) {
      errors.push(`Assembly ${profile.assembly} bridge name is invalid`)
    }
    try {
      const network = parseCidr(profile.networkCidr)
      const gateway = parseCidr(profile.gatewayCidr)
      if (
        gateway.address !== profile.gatewayAddress ||
        gateway.network !== network.network ||
        ipv4Number(profile.gatewayAddress) !== network.network + 1 ||
        !profile.gatewayAddress.startsWith(profile.addressPrefix)
      ) {
        errors.push(
          `Assembly ${profile.assembly} gateway does not bind its network`,
        )
      }
      networks.push({ assembly: profile.assembly, ...network })
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : "invalid bridge profile",
      )
    }
  }

  if (
    observedAssemblies.size !== 2 ||
    !observedAssemblies.has("A") ||
    !observedAssemblies.has("B")
  ) {
    errors.push("Docker bridge profiles do not bind both assemblies")
  }
  if (
    networks.length === 2 &&
    networks[0].network <= networks[1].broadcast &&
    networks[1].network <= networks[0].broadcast
  ) {
    errors.push("Docker bridge networks overlap")
  }
  return errors
}

export function readDockerBridgeProfiles() {
  return JSON.parse(
    readFileSync(resolve(directory, "docker-bridge-profiles.json"), "utf8"),
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = validateDockerBridgeProfiles(readDockerBridgeProfiles())
  if (errors.length > 0) {
    for (const error of errors) console.error(error)
    process.exitCode = 1
  } else {
    console.log("VM103-L1B Docker bridge profiles passed")
  }
}
