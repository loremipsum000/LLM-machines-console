import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

export interface SafeUrlResult {
  detail?: string
  ok: boolean
  url?: URL
}

export interface SafeFetchOptions {
  body?: RequestInit["body"]
  headers?: RequestInit["headers"]
  maxBytes?: number
  method?: string
  onUrl?: (url: URL) => Promise<void> | void
  timeoutMs?: number
}

export interface SafeFetchResult {
  bodyText: string
  contentType: string | null
  redirectChain: string[]
  response: Response
  url: URL
}

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_MAX_BYTES = 1024 * 1024
const MAX_REDIRECTS = 3

export function validatePublicHttpEndpoint(endpointUrl: string): SafeUrlResult {
  let url: URL
  try {
    url = new URL(endpointUrl)
  } catch {
    return { ok: false, detail: "Endpoint URL is invalid." }
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, detail: "Endpoint URL must use HTTP or HTTPS." }
  }
  if (url.username || url.password) {
    return { ok: false, detail: "Endpoint URL cannot contain credentials." }
  }
  const hostBlock = blockedHostDetail(url.hostname)
  if (hostBlock) {
    return { ok: false, detail: hostBlock }
  }

  return { ok: true, url }
}

export async function fetchPublicHttpEndpoint(
  endpointUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = positiveInt(
    options.timeoutMs ?? Number.NaN,
    DEFAULT_TIMEOUT_MS,
  )
  const maxBytes = positiveInt(
    options.maxBytes ?? Number.NaN,
    DEFAULT_MAX_BYTES,
  )
  let current = endpointUrl
  const redirectChain: string[] = []

  for (
    let redirectCount = 0;
    redirectCount <= MAX_REDIRECTS;
    redirectCount += 1
  ) {
    const validation = validatePublicHttpEndpoint(current)
    if (!validation.ok || !validation.url) {
      throw new Error(validation.detail ?? "Endpoint URL is blocked.")
    }
    await assertResolvedAddressesArePublic(validation.url)
    await options.onUrl?.(validation.url)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(validation.url.toString(), {
        body: options.body,
        headers: options.headers,
        method: options.method ?? "GET",
        redirect: "manual",
        signal: controller.signal,
      })

      if (isRedirect(response.status)) {
        if (redirectCount >= MAX_REDIRECTS) {
          throw new Error("Endpoint redirected too many times.")
        }
        const location = response.headers.get("location")
        if (!location) {
          throw new Error("Endpoint redirect did not include a location.")
        }
        current = new URL(location, validation.url).toString()
        redirectChain.push(current)
        continue
      }

      const bodyText = await readResponseText(response, maxBytes)
      return {
        bodyText,
        contentType: response.headers.get("content-type"),
        redirectChain,
        response,
        url: validation.url,
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Endpoint request timed out.")
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new Error("Endpoint redirected too many times.")
}

export function egressTimeoutMs(envName: string, fallback: number): number {
  return positiveInt(Number.parseInt(process.env[envName] ?? "", 10), fallback)
}

export function egressMaxBytes(envName: string, fallback: number): number {
  return positiveInt(Number.parseInt(process.env[envName] ?? "", 10), fallback)
}

async function assertResolvedAddressesArePublic(url: URL): Promise<void> {
  if (!shouldValidateDnsResolution()) {
    return
  }
  const records = await lookup(url.hostname, { all: true, verbatim: true })
  if (records.length === 0) {
    throw new Error("Endpoint hostname did not resolve.")
  }
  for (const record of records) {
    const detail = blockedIpDetail(record.address)
    if (detail) {
      throw new Error(detail)
    }
  }
}

function blockedHostDetail(hostname: string): string | null {
  const normalized = normalizeHostname(hostname)
  if (!normalized) {
    return "Endpoint host is required."
  }
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized === "metadata.google.internal"
  ) {
    return "Localhost and local-only hosts are blocked."
  }
  const ipBlock = blockedIpDetail(normalized)
  if (ipBlock) {
    return ipBlock
  }
  return null
}

function blockedIpDetail(host: string): string | null {
  const normalizedHost = normalizeIpCandidate(host)
  const family = isIP(normalizedHost)
  if (family === 4) {
    const octets = normalizedHost
      .split(".")
      .map((part) => Number.parseInt(part, 10))
    const [a, b] = octets
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 0) ||
      a >= 224
    ) {
      return "Private, loopback, link-local, multicast, and reserved IP ranges are blocked."
    }
    return null
  }
  if (family === 6) {
    const normalized = normalizedHost.toLowerCase()
    if (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("::ffff:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("ff")
    ) {
      return "Private, loopback, link-local, multicast, and reserved IP ranges are blocked."
    }
  }
  return null
}

function normalizeHostname(hostname: string): string {
  return normalizeIpCandidate(hostname).replace(/\.$/, "")
}

function normalizeIpCandidate(value: string): string {
  const trimmed = value.trim().toLowerCase()
  const withoutBrackets =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : trimmed
  return withoutBrackets.split("%")[0] ?? withoutBrackets
}

function shouldValidateDnsResolution(): boolean {
  const configured = process.env.BFF_EGRESS_DNS_RESOLUTION_CHECK?.trim()
  if (configured) {
    return configured.toLowerCase() === "true"
  }
  return process.env.NODE_ENV !== "test"
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400
}

async function readResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get("content-length")
  if (contentLength && Number.parseInt(contentLength, 10) > maxBytes) {
    throw new Error("Endpoint response exceeded the allowed size.")
  }
  const reader = response.body?.getReader()
  if (!reader) {
    return ""
  }
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    total += value.byteLength
    if (total > maxBytes) {
      throw new Error("Endpoint response exceeded the allowed size.")
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

function positiveInt(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback
}
