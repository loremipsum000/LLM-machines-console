import { createHash } from "node:crypto"
import type { KnowledgeUrlScraper } from "@llm-machines/contracts"
import {
  egressMaxBytes,
  egressTimeoutMs,
  fetchPublicHttpEndpoint,
  validatePublicHttpEndpoint,
} from "../security/url-safety"

export interface KnowledgeUrlAcquisitionResult {
  body: Buffer
  canonicalUrl: string | null
  contentType: string
  finalUrl: string
  httpStatus: number
  normalizedText: Buffer | null
  redirectChain: string[]
  report: Record<string, unknown>
  title: string | null
}

export interface KnowledgeUrlAcquisitionInput {
  adapter: KnowledgeUrlScraper
  authorizeUrl?: (url: string) => Promise<void>
  normalizedUrl: string
  requestedUrl: string
}

const DEFAULT_URL_FETCH_TIMEOUT_MS = 10_000
const DEFAULT_URL_FETCH_MAX_BYTES = 5 * 1024 * 1024
const ACCEPTED_TEXT_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
]

export async function acquireKnowledgeUrl(
  input: KnowledgeUrlAcquisitionInput,
): Promise<KnowledgeUrlAcquisitionResult> {
  if (input.adapter === "firecrawl") {
    return scrapeWithFirecrawl(input)
  }
  return scrapeWithSafeFetch(input)
}

export function knowledgeFirecrawlEnabled(): boolean {
  return (
    process.env.KNOWLEDGE_FIRECRAWL_ENABLED?.trim().toLowerCase() === "true"
  )
}

export function validateKnowledgeUrl(
  rawUrl: string,
): { ok: true; url: URL } | { detail?: string; ok: false } {
  const validation = validatePublicHttpEndpoint(rawUrl)
  if (!validation.ok || !validation.url) {
    return {
      detail:
        validation.detail?.replace("Endpoint", "URL") ?? "URL is blocked.",
      ok: false,
    }
  }
  return { ok: true, url: validation.url }
}

export function normalizedKnowledgeUrlKey(url: URL): string {
  const normalized = new URL(url.toString())
  normalized.hash = ""
  normalized.username = ""
  normalized.password = ""
  normalized.hostname = normalized.hostname.toLowerCase()
  if (normalized.pathname.length > 1) {
    normalized.pathname = normalized.pathname.replace(/\/+$/g, "")
  }
  normalized.searchParams.sort()
  return normalized.toString()
}

async function scrapeWithSafeFetch(
  input: KnowledgeUrlAcquisitionInput,
): Promise<KnowledgeUrlAcquisitionResult> {
  const startedAt = Date.now()
  const result = await fetchPublicHttpEndpoint(input.normalizedUrl, {
    maxBytes: egressMaxBytes(
      "KNOWLEDGE_URL_FETCH_MAX_BYTES",
      DEFAULT_URL_FETCH_MAX_BYTES,
    ),
    timeoutMs: egressTimeoutMs(
      "KNOWLEDGE_URL_FETCH_TIMEOUT_MS",
      DEFAULT_URL_FETCH_TIMEOUT_MS,
    ),
    onUrl: input.authorizeUrl
      ? async (url) => input.authorizeUrl?.(normalizedKnowledgeUrlKey(url))
      : undefined,
  })
  const contentType = normalizeContentType(result.contentType)
  if (!contentTypeAccepted(contentType)) {
    throw acquisitionError(
      "unsupported_content_type",
      `URL content type ${contentType || "unknown"} is not supported for v1 URL ingestion.`,
    )
  }
  if (!result.response.ok) {
    throw acquisitionError(
      "http_error",
      `URL fetch failed with HTTP ${result.response.status}.`,
    )
  }
  const body = Buffer.from(result.bodyText, "utf8")
  const canonicalUrl = validatedReturnedUrl(
    extractCanonicalUrl(result.bodyText),
    result.url,
  )
  const title = extractHtmlTitle(result.bodyText)
  const normalizedText =
    contentType === "text/markdown" ||
    contentType === "text/x-markdown" ||
    contentType === "text/plain"
      ? body
      : null
  return {
    body,
    canonicalUrl,
    contentType: contentType || "text/html",
    finalUrl: normalizedKnowledgeUrlKey(result.url),
    httpStatus: result.response.status,
    normalizedText,
    redirectChain: result.redirectChain,
    report: {
      adapter: "safe_fetch",
      byteLength: body.length,
      durationMs: Date.now() - startedAt,
      requestedUrl: input.requestedUrl,
      responseUrl: result.url.toString(),
    },
    title,
  }
}

async function scrapeWithFirecrawl(
  input: KnowledgeUrlAcquisitionInput,
): Promise<KnowledgeUrlAcquisitionResult> {
  if (!knowledgeFirecrawlEnabled()) {
    throw acquisitionError(
      "firecrawl_disabled",
      "Firecrawl URL ingestion is disabled.",
    )
  }
  const baseUrl = process.env.KNOWLEDGE_FIRECRAWL_API_URL?.trim()
  if (!baseUrl) {
    throw acquisitionError(
      "firecrawl_unconfigured",
      "KNOWLEDGE_FIRECRAWL_API_URL is required when Firecrawl ingestion is enabled.",
    )
  }

  const startedAt = Date.now()
  const version = normalizeFirecrawlVersion(
    process.env.KNOWLEDGE_FIRECRAWL_VERSION,
  )
  const timeoutMs = egressTimeoutMs(
    "KNOWLEDGE_URL_FETCH_TIMEOUT_MS",
    DEFAULT_URL_FETCH_TIMEOUT_MS,
  )
  const response = await fetch(
    new URL(`/${version}/scrape`, baseUrl).toString(),
    {
      body: JSON.stringify({
        formats: ["markdown", "html"],
        onlyMainContent: true,
        timeout: timeoutMs,
        url: input.normalizedUrl,
      }),
      headers: firecrawlHeaders(),
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
    },
  )
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >
  if (!response.ok) {
    throw acquisitionError(
      "firecrawl_http_error",
      `Firecrawl scrape failed with HTTP ${response.status}.`,
    )
  }

  const data = recordValue(payload, "data") ?? payload
  const markdown = stringValue(data, "markdown")
  const html = stringValue(data, "html") ?? stringValue(data, "rawHtml")
  const metadata = recordValue(data, "metadata")
  const finalUrl =
    validatedReturnedUrl(
      stringValue(metadata, "sourceURL") ??
        stringValue(metadata, "url") ??
        stringValue(data, "url"),
      new URL(input.normalizedUrl),
    ) ?? input.normalizedUrl
  await input.authorizeUrl?.(finalUrl)
  const canonicalUrl = validatedReturnedUrl(
    stringValue(metadata, "canonicalUrl") ?? stringValue(metadata, "canonical"),
    new URL(finalUrl),
  )
  if (canonicalUrl) {
    await input.authorizeUrl?.(canonicalUrl)
  }
  const title =
    stringValue(metadata, "title") ?? (html ? extractHtmlTitle(html) : null)
  const bodyText =
    html ?? renderMarkdownSnapshot(markdown ?? "", title, finalUrl)
  const body = Buffer.from(bodyText, "utf8")
  const maxBytes = egressMaxBytes(
    "KNOWLEDGE_URL_FETCH_MAX_BYTES",
    DEFAULT_URL_FETCH_MAX_BYTES,
  )
  if (
    body.length > maxBytes ||
    (markdown && Buffer.byteLength(markdown) > maxBytes)
  ) {
    throw acquisitionError(
      "response_too_large",
      "Firecrawl response exceeded the allowed size.",
    )
  }

  return {
    body,
    canonicalUrl,
    contentType: html ? "text/html" : "text/html",
    finalUrl,
    httpStatus: response.status,
    normalizedText: markdown ? Buffer.from(markdown, "utf8") : null,
    redirectChain: [],
    report: {
      adapter: "firecrawl",
      byteLength: body.length,
      durationMs: Date.now() - startedAt,
      firecrawlVersion: version,
      hasHtml: Boolean(html),
      hasMarkdown: Boolean(markdown),
      requestedUrl: input.requestedUrl,
    },
    title,
  }
}

export function acquisitionError(code: string, detail: string): Error {
  const error = new Error(detail)
  Object.assign(error, { code })
  return error
}

export function acquisitionErrorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code
  }
  return "url_acquisition_failed"
}

export function checksumBuffer(input: Buffer): string {
  return `sha256:${createHash("sha256").update(input).digest("hex")}`
}

function contentTypeAccepted(contentType: string): boolean {
  return ACCEPTED_TEXT_CONTENT_TYPES.some((accepted) =>
    contentType.startsWith(accepted),
  )
}

function normalizeContentType(contentType: string | null): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? ""
}

function extractCanonicalUrl(html: string): string | null {
  const match =
    /<link\b[^>]*\brel=["']?canonical["']?[^>]*\bhref=["']([^"']+)["']/i.exec(
      html,
    ) ??
    /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']?canonical["']?/i.exec(
      html,
    )
  return match?.[1] ?? null
}

function extractHtmlTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (!match?.[1]) {
    return null
  }
  return htmlDecode(match[1]).replace(/\s+/g, " ").trim() || null
}

function validatedReturnedUrl(
  value: string | null,
  baseUrl: URL,
): string | null {
  if (!value) {
    return null
  }
  try {
    const resolved = new URL(value, baseUrl)
    const validation = validatePublicHttpEndpoint(resolved.toString())
    return validation.ok && validation.url
      ? normalizedKnowledgeUrlKey(validation.url)
      : null
  } catch {
    return null
  }
}

function renderMarkdownSnapshot(
  markdown: string,
  title: string | null,
  url: string,
): string {
  return `<html><head><link rel="canonical" href="${escapeHtml(
    url,
  )}"><title>${escapeHtml(title ?? url)}</title></head><body><pre>${escapeHtml(
    markdown,
  )}</pre></body></html>`
}

function firecrawlHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  const apiKey = process.env.KNOWLEDGE_FIRECRAWL_API_KEY?.trim()
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return headers
}

function normalizeFirecrawlVersion(value: string | undefined): "v1" | "v2" {
  return value?.trim() === "v2" ? "v2" : "v1"
}

function recordValue(
  value: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  const child = value?.[key]
  return child && typeof child === "object" && !Array.isArray(child)
    ? (child as Record<string, unknown>)
    : null
}

function stringValue(
  value: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const child = value?.[key]
  return typeof child === "string" && child.trim().length > 0
    ? child.trim()
    : null
}

function htmlDecode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
