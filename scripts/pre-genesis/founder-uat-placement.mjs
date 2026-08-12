import { readFileSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"

const authorityNames = ["api", "console", "firecrawl", "identity"]

export function loadFounderUatPlacement(pathValue) {
  const path = pathValue?.trim()
  if (!path) return null
  if (!isAbsolute(path)) {
    throw new Error("F0-UAT0 placement path must be absolute.")
  }
  let document
  try {
    document = JSON.parse(readFileSync(resolve(path), "utf8"))
  } catch {
    throw new Error("F0-UAT0 placement is not valid JSON.")
  }
  return parseFounderUatPlacement(document)
}

export function parseFounderUatPlacement(document) {
  if (
    !exactObject(document, [
      "authorities",
      "edgeBindAddress",
      "edgePort",
      "schemaVersion",
      "tls",
    ])
  ) {
    throw new Error("F0-UAT0 placement has an invalid top-level shape.")
  }
  if (document.schemaVersion !== 1) {
    throw new Error("F0-UAT0 placement schema version is unsupported.")
  }
  if (!exactObject(document.authorities, authorityNames)) {
    throw new Error("F0-UAT0 placement authorities are incomplete.")
  }
  const authorities = Object.fromEntries(
    authorityNames.map((name) => [
      name,
      exactHttpsOrigin(document.authorities[name], name),
    ]),
  )
  const hosts = Object.values(authorities).map(
    (origin) => new URL(origin).hostname,
  )
  if (new Set(hosts).size !== hosts.length) {
    throw new Error("F0-UAT0 placement authorities must be distinct.")
  }
  if (!privateIpv4(document.edgeBindAddress)) {
    throw new Error(
      "F0-UAT0 placement edge bind address must be a private non-loopback IPv4 address.",
    )
  }
  if (
    !Number.isSafeInteger(document.edgePort) ||
    document.edgePort < 1024 ||
    document.edgePort > 65535
  ) {
    throw new Error("F0-UAT0 placement edge port is invalid.")
  }
  if (
    !exactObject(document.tls, ["caFile", "certificateFile", "privateKeyFile"])
  ) {
    throw new Error("F0-UAT0 placement TLS paths are incomplete.")
  }
  const tls = Object.fromEntries(
    Object.entries(document.tls).map(([name, value]) => {
      if (typeof value !== "string" || !isAbsolute(value)) {
        throw new Error(`F0-UAT0 placement TLS path is invalid: ${name}.`)
      }
      return [name, resolve(value)]
    }),
  )
  if (new Set(Object.values(tls)).size !== 3) {
    throw new Error("F0-UAT0 placement TLS paths must be distinct.")
  }
  return {
    authorities,
    edgeBindAddress: document.edgeBindAddress,
    edgePort: document.edgePort,
    schemaVersion: 1,
    tls,
  }
}

export function authorityOrigin(placement, name, edgePort) {
  if (!authorityNames.includes(name)) {
    throw new Error(`Unknown F0-UAT0 authority: ${name}.`)
  }
  if (placement) return placement.authorities[name]
  const host = `${name}.llmm.test`
  return `https://${host}:${edgePort}`
}

function exactHttpsOrigin(value, name) {
  if (typeof value !== "string") {
    throw new Error(`F0-UAT0 ${name} authority must be an HTTPS origin.`)
  }
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`F0-UAT0 ${name} authority must be an HTTPS origin.`)
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== value ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    !dnsName(parsed.hostname)
  ) {
    throw new Error(
      `F0-UAT0 ${name} authority must be one canonical HTTPS DNS origin on port 443.`,
    )
  }
  return parsed.origin
}

function dnsName(value) {
  return (
    value === value.toLowerCase() &&
    value.length <= 253 &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)
  )
}

function privateIpv4(value) {
  if (typeof value !== "string" || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    return false
  }
  const octets = value.split(".").map(Number)
  if (octets.some((octet) => octet < 0 || octet > 255)) return false
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  )
}

function exactObject(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  )
}
