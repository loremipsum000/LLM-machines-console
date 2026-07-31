import { lookup as nodeLookup } from "node:dns/promises"
import { isIP } from "node:net"
import { domainToASCII } from "node:url"

const MAX_ALLOWED_HOSTS = 256
const FIRECRAWL_CLOUD_HOST = "api.firecrawl.dev"

export interface FirecrawlDnsAddress {
  address: string
  family: 4 | 6
}

export type FirecrawlDnsLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<readonly FirecrawlDnsAddress[]>

export type FirecrawlUrlSafetyFailureReason =
  | "cancelled"
  | "dns_unavailable"
  | "host_not_allowed"
  | "invalid_url"
  | "non_public_address"
  | "port_not_allowed"
  | "unsupported_scheme"
  | "userinfo_not_allowed"

export type FirecrawlUrlSafetyResult =
  | {
      addresses: readonly FirecrawlDnsAddress[]
      hostname: string
      normalizedUrl: string
      ok: true
    }
  | { ok: false; reason: FirecrawlUrlSafetyFailureReason }

export interface FirecrawlUrlSafetyOptions {
  allowedHosts: ReadonlySet<string> | null
  lookup?: FirecrawlDnsLookup
  signal?: AbortSignal
}

/**
 * Parses the system-owned, comma-separated exact-host egress configuration.
 * Wildcards, URLs, ports, userinfo, and invalid DNS names fail the whole value
 * closed rather than silently weakening the intended policy.
 */
export function parseFirecrawlEgressAllowedHosts(
  configuredHosts: string | undefined,
): ReadonlySet<string> | null {
  if (!configuredHosts?.trim()) {
    return null
  }

  const configured = configuredHosts.split(",")
  if (configured.length > MAX_ALLOWED_HOSTS) {
    return null
  }

  const hosts = new Set<string>()
  for (const candidate of configured) {
    const hostname = canonicalHostname(candidate)
    if (!hostname) {
      return null
    }
    hosts.add(hostname)
  }

  return hosts.size > 0 ? hosts : null
}

export function normalizeFirecrawlEgressAllowedHosts(
  configuredHosts: Iterable<string> | null | undefined,
): ReadonlySet<string> | null {
  if (!configuredHosts) {
    return null
  }

  const hosts = new Set<string>()
  let candidateCount = 0
  for (const candidate of configuredHosts) {
    candidateCount += 1
    if (candidateCount > MAX_ALLOWED_HOSTS) {
      return null
    }
    const hostname = canonicalHostname(candidate)
    if (!hostname) {
      return null
    }
    hosts.add(hostname)
  }

  return hosts.size > 0 ? hosts : null
}

export async function validateFirecrawlPublicUrl(
  input: string,
  options: FirecrawlUrlSafetyOptions,
): Promise<FirecrawlUrlSafetyResult> {
  if (options.signal?.aborted) {
    return { ok: false, reason: "cancelled" }
  }
  if (
    input.length === 0 ||
    input !== input.trim() ||
    containsControlOrBackslash(input)
  ) {
    return { ok: false, reason: "invalid_url" }
  }

  let url: URL
  try {
    url = new URL(input)
  } catch {
    return { ok: false, reason: "invalid_url" }
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "unsupported_scheme" }
  }
  if (url.username || url.password) {
    return { ok: false, reason: "userinfo_not_allowed" }
  }
  if (hasExplicitPort(input)) {
    return { ok: false, reason: "port_not_allowed" }
  }

  const hostname = canonicalHostname(url.hostname)
  if (!hostname) {
    return { ok: false, reason: "invalid_url" }
  }
  if (!options.allowedHosts?.has(hostname)) {
    return { ok: false, reason: "host_not_allowed" }
  }

  const literalFamily = isIP(stripIpv6Brackets(hostname))
  let addresses: readonly FirecrawlDnsAddress[]
  if (literalFamily === 4 || literalFamily === 6) {
    const address = stripIpv6Brackets(hostname)
    addresses = [{ address, family: literalFamily }]
  } else {
    try {
      addresses = await waitForLookup(
        (options.lookup ?? defaultLookup)(hostname, {
          all: true,
          verbatim: true,
        }),
        options.signal,
      )
    } catch {
      return {
        ok: false,
        reason: options.signal?.aborted ? "cancelled" : "dns_unavailable",
      }
    }
    if (addresses.length === 0) {
      return { ok: false, reason: "dns_unavailable" }
    }
  }

  for (const result of addresses) {
    const detectedFamily = isIP(result.address)
    if (
      (detectedFamily !== 4 && detectedFamily !== 6) ||
      detectedFamily !== result.family ||
      !isPublicFirecrawlIpAddress(result.address)
    ) {
      return { ok: false, reason: "non_public_address" }
    }
  }

  url.hostname = hostname
  url.hash = ""
  return {
    addresses,
    hostname,
    normalizedUrl: url.toString(),
    ok: true,
  }
}

export function isPublicFirecrawlIpAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    return isPublicIpv4(address)
  }
  if (family !== 6) {
    return false
  }

  const value = ipv6ToBigInt(address)
  if (value === null) {
    return false
  }

  // IPv4-mapped IPv6 is judged by its embedded IPv4 address.
  if (value >> 32n === 0xffffn) {
    const embedded = Number(value & 0xffff_ffffn)
    return isPublicIpv4(
      [
        (embedded >>> 24) & 0xff,
        (embedded >>> 16) & 0xff,
        (embedded >>> 8) & 0xff,
        embedded & 0xff,
      ].join("."),
    )
  }

  // Only global-unicast space is eligible. IETF protocol assignments,
  // 6to4, and documentation space inside that range remain ineligible.
  return (
    isIpv6InCidr(value, "2000::", 3) &&
    !isIpv6InCidr(value, "2001::", 23) &&
    !isIpv6InCidr(value, "2001:db8::", 32) &&
    !isIpv6InCidr(value, "2002::", 16) &&
    !isIpv6InCidr(value, "3fff::", 20)
  )
}

function canonicalHostname(candidate: string): string | null {
  let hostname = candidate.trim().toLowerCase()
  if (!hostname || hostname.includes("*") || /[\s/@?#\\]/u.test(hostname)) {
    return null
  }

  hostname = stripIpv6Brackets(hostname)
  if (hostname.endsWith(".")) {
    hostname = hostname.slice(0, -1)
  }
  if (!hostname || hostname.includes(":") || isIP(hostname) !== 0) {
    // Egress policy is expressed only as exact DNS hostnames. Literal IP
    // targets are never configurable, even when the address is public.
    return null
  }

  const ascii = domainToASCII(hostname).toLowerCase()
  if (!ascii || ascii.length > 253 || ascii === FIRECRAWL_CLOUD_HOST) {
    return null
  }
  const labels = ascii.split(".")
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    )
  ) {
    return null
  }
  return ascii
}

function hasExplicitPort(input: string): boolean {
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/iu.exec(input)?.[1]
  if (!authority) {
    return false
  }
  const host = authority.slice(authority.lastIndexOf("@") + 1)
  if (host.startsWith("[")) {
    const closingBracket = host.indexOf("]")
    return closingBracket >= 0 && host.slice(closingBracket + 1).startsWith(":")
  }
  return host.includes(":")
}

function containsControlOrBackslash(value: string): boolean {
  for (const character of value) {
    if (character === "\\" || (character.codePointAt(0) ?? 0) <= 0x20) {
      return true
    }
  }
  return false
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number)
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false
  }

  const [a = 0, b = 0, c = 0] = octets
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 31 && c === 196) ||
    (a === 192 && b === 52 && c === 193) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 175 && c === 48) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

function ipv6ToBigInt(address: string): bigint | null {
  let source = address.toLowerCase()
  if (source.includes("%")) {
    return null
  }

  if (source.includes(".")) {
    const lastColon = source.lastIndexOf(":")
    if (lastColon < 0) {
      return null
    }
    const ipv4 = source.slice(lastColon + 1)
    if (isIP(ipv4) !== 4) {
      return null
    }
    const octets = ipv4.split(".").map(Number)
    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0)
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0)
    source = `${source.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`
  }

  const compression = source.split("::")
  if (compression.length > 2) {
    return null
  }
  const left = compression[0] ? compression[0].split(":") : []
  const right = compression[1] ? compression[1].split(":") : []
  const missing = 8 - left.length - right.length
  if (
    (compression.length === 1 && missing !== 0) ||
    (compression.length === 2 && missing < 1)
  ) {
    return null
  }

  const groups = [
    ...left,
    ...Array.from({ length: Math.max(0, missing) }, () => "0"),
    ...right,
  ]
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))
  ) {
    return null
  }

  return groups.reduce(
    (value, group) => (value << 16n) | BigInt(Number.parseInt(group, 16)),
    0n,
  )
}

function isIpv6InCidr(
  value: bigint,
  networkAddress: string,
  prefixLength: number,
): boolean {
  const network = ipv6ToBigInt(networkAddress)
  if (network === null) {
    return false
  }
  const shift = BigInt(128 - prefixLength)
  return value >> shift === network >> shift
}

async function defaultLookup(
  hostname: string,
  options: { all: true; verbatim: true },
): Promise<readonly FirecrawlDnsAddress[]> {
  const addresses = await nodeLookup(hostname, options)
  if (addresses.some(({ family }) => family !== 4 && family !== 6)) {
    throw new Error("DNS returned an unsupported address family.")
  }
  return addresses.map(({ address, family }) => ({
    address,
    family: family as 4 | 6,
  }))
}

async function waitForLookup<T>(
  lookup: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) {
    return lookup
  }
  if (signal.aborted) {
    throw signal.reason
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason)
    signal.addEventListener("abort", onAbort, { once: true })
    lookup.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort)
    })
  })
}
