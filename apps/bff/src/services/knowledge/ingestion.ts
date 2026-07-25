import { createHash, randomUUID } from "node:crypto"
import type {
  KnowledgeCitation,
  KnowledgeQueryRequest,
  KnowledgeQueryResult,
  KnowledgeSnapshot,
  KnowledgeSource,
  KnowledgeSourceType,
} from "@llm-machines/contracts"
import { egressMaxBytes, egressTimeoutMs } from "../security/url-safety"

export interface ExtractedKnowledgeChunk {
  content: string
  searchText: string
  language: string | null
  pageNumber?: number
  sectionPath?: string
  rowRange?: string
  imageRegion?: string
}

export interface ExtractedKnowledgeSource {
  artifacts: ExtractedKnowledgeArtifact[]
  text: string
  chunks: ExtractedKnowledgeChunk[]
  language: string | null
  warnings: string[]
  metadata: Record<string, unknown>
}

export interface ExtractedKnowledgeArtifact {
  artifactType:
    | "normalized"
    | "normalizedMarkdown"
    | "normalizedPageMap"
    | "normalizedParserReport"
  body: Buffer | string
  contentType: string
  fileName: string
  metadata: Record<string, unknown>
  name: "json" | "markdown" | "pageMap" | "parserReport"
}

export interface KnowledgeChunkRecord extends ExtractedKnowledgeChunk {
  id: string
  corpusId: string
  snapshotId: string
  sourceId: string
  sourceType: KnowledgeSourceType
  title: string
  uri: string | null
  checksum: string
  chunkIndex: number
  createdAt: string
}

const memoryChunks: KnowledgeChunkRecord[] = []
const SIDECAR_SERVICE_TOKEN_HEADER = "X-LLM-Machines-Sidecar-Token"
const PDF_PARSER_SERVICE_TOKEN_HEADER = "X-LLM-Machines-Pdf-Parser-Token"
const DEFAULT_SIDECAR_TIMEOUT_MS = 10_000
const DEFAULT_SIDECAR_MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const DEFAULT_PDF_PARSER_TIMEOUT_MS = 30_000
const DEFAULT_PDF_PARSER_MAX_RESPONSE_BYTES = 8 * 1024 * 1024

export async function ingestKnowledgeSourceContent(input: {
  corpusId: string
  snapshotId: string
  source: KnowledgeSource
  content: Buffer | string
}): Promise<{
  chunks: KnowledgeChunkRecord[]
  extraction: ExtractedKnowledgeSource
}> {
  const extraction = await extractKnowledgeSourceForIngestion(
    input.source,
    input.content,
  )
  const createdAt = new Date().toISOString()
  const chunks = extraction.chunks.map((chunk, index) => ({
    ...chunk,
    id: randomUUID(),
    corpusId: input.corpusId,
    snapshotId: input.snapshotId,
    sourceId: input.source.id,
    sourceType: input.source.sourceType,
    title: input.source.title,
    uri: input.source.finalUri ?? input.source.originalUri,
    checksum: checksum(`${input.source.checksum}:${index}:${chunk.content}`),
    chunkIndex: index,
    createdAt,
  }))
  memoryChunks.push(...chunks)
  return { chunks, extraction }
}

async function extractKnowledgeSourceForIngestion(
  source: KnowledgeSource,
  content: Buffer | string,
): Promise<ExtractedKnowledgeSource> {
  const pdfParserUrl = process.env.KNOWLEDGE_PDF_PARSER_URL
  if (pdfParserUrl && isPdfSource(source)) {
    return extractKnowledgeSourceViaPdfParser(source, content, pdfParserUrl)
  }
  const sidecarUrl = process.env.KNOWLEDGE_SIDECAR_URL
  if (sidecarUrl) {
    return extractKnowledgeSourceViaSidecar(source, content, sidecarUrl)
  }

  return extractKnowledgeSource(
    source,
    Buffer.isBuffer(content) ? content.toString("utf8") : content,
  )
}

async function extractKnowledgeSourceViaSidecar(
  source: KnowledgeSource,
  content: Buffer | string,
  sidecarUrl: string,
): Promise<ExtractedKnowledgeSource> {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content)
  const token = process.env.KNOWLEDGE_SIDECAR_SERVICE_TOKEN?.trim()
  if (!token) {
    throw new Error("Knowledge sidecar service token is not configured.")
  }

  const endpoint = sidecarExtractionEndpoint(sidecarUrl)
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    egressTimeoutMs("KNOWLEDGE_SIDECAR_TIMEOUT_MS", DEFAULT_SIDECAR_TIMEOUT_MS),
  )
  let response: Response
  try {
    response = await fetch(endpoint, {
      body: JSON.stringify({
        content_base64: body.toString("base64"),
        file_name: sourceFileNameForSidecar(source),
        mime_type: source.mimeType,
        original_uri: source.finalUri ?? source.originalUri,
        source_type: source.sourceType,
      }),
      headers: {
        "Content-Type": "application/json",
        [SIDECAR_SERVICE_TOKEN_HEADER]: token,
      },
      method: "POST",
      redirect: "error",
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Knowledge sidecar extraction timed out.")
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) {
    throw new Error(
      `Knowledge sidecar extraction failed with ${response.status}.`,
    )
  }

  const bodyText = await readSidecarResponseText(
    response,
    egressMaxBytes(
      "KNOWLEDGE_SIDECAR_MAX_RESPONSE_BYTES",
      DEFAULT_SIDECAR_MAX_RESPONSE_BYTES,
    ),
  )
  return parseSidecarExtraction(JSON.parse(bodyText) as unknown)
}

async function extractKnowledgeSourceViaPdfParser(
  source: KnowledgeSource,
  content: Buffer | string,
  pdfParserUrl: string,
): Promise<ExtractedKnowledgeSource> {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content)
  const token = process.env.KNOWLEDGE_PDF_PARSER_SERVICE_TOKEN?.trim()
  if (!token) {
    throw new Error("Knowledge PDF parser service token is not configured.")
  }

  const form = new FormData()
  form.set("source_id", source.id)
  form.set("file_name", source.originalUri ?? source.title)
  form.set("checksum", source.checksum)
  form.set(
    "file",
    new Blob([body], { type: source.mimeType || "application/pdf" }),
    source.originalUri ?? source.title,
  )

  const endpoint = pdfParserExtractionEndpoint(pdfParserUrl)
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    egressTimeoutMs(
      "KNOWLEDGE_PDF_PARSER_TIMEOUT_MS",
      DEFAULT_PDF_PARSER_TIMEOUT_MS,
    ),
  )
  let response: Response
  try {
    response = await fetch(endpoint, {
      body: form,
      headers: {
        [PDF_PARSER_SERVICE_TOKEN_HEADER]: token,
      },
      method: "POST",
      redirect: "error",
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Knowledge PDF parser extraction timed out.")
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) {
    throw new Error(
      `Knowledge PDF parser extraction failed with ${response.status}.`,
    )
  }

  const bodyText = await readBoundedResponseText(
    response,
    egressMaxBytes(
      "KNOWLEDGE_PDF_PARSER_MAX_RESPONSE_BYTES",
      DEFAULT_PDF_PARSER_MAX_RESPONSE_BYTES,
    ),
    "Knowledge PDF parser response exceeded the allowed size.",
  )
  return parseSidecarExtraction(JSON.parse(bodyText) as unknown)
}

function sourceFileNameForSidecar(source: KnowledgeSource): string {
  if (source.sourceType !== "url") {
    return source.originalUri ?? source.title
  }
  const mimeType = source.mimeType.toLowerCase()
  if (
    mimeType.startsWith("text/markdown") ||
    mimeType.startsWith("text/x-markdown")
  ) {
    return "url-snapshot.md"
  }
  if (mimeType.startsWith("text/plain")) {
    return "url-snapshot.txt"
  }
  return "url-snapshot.html"
}

export function extractKnowledgeSource(
  source: KnowledgeSource,
  rawContent: string,
): ExtractedKnowledgeSource {
  if (source.sourceType === "url" || source.mimeType === "text/html") {
    return extractHtml(rawContent, source)
  }
  if (source.sourceType === "table") {
    return extractTable(rawContent)
  }
  if (source.sourceType === "image") {
    return extractImage(rawContent)
  }
  if (
    source.mimeType === "application/pdf" ||
    source.originalUri?.endsWith(".pdf")
  ) {
    return extractPagedText(rawContent, "pdf_fixture_text_extractor")
  }
  if (
    source.mimeType.includes("wordprocessingml") ||
    source.originalUri?.endsWith(".docx")
  ) {
    return extractPagedText(rawContent, "docx_fixture_text_extractor")
  }
  return extractPagedText(rawContent)
}

function parseSidecarExtraction(payload: unknown): ExtractedKnowledgeSource {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Knowledge sidecar returned an invalid extraction payload.")
  }
  const record = payload as Record<string, unknown>
  const chunks = Array.isArray(record.chunks) ? record.chunks : []
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.filter(
        (warning): warning is string => typeof warning === "string",
      )
    : []

  return {
    artifacts: parseExtractionArtifacts(record.artifacts),
    chunks: chunks.map((chunk) => parseSidecarChunk(chunk)),
    language: typeof record.language === "string" ? record.language : null,
    metadata:
      typeof record.metadata === "object" && record.metadata !== null
        ? (record.metadata as Record<string, unknown>)
        : {},
    text: typeof record.text === "string" ? record.text : "",
    warnings,
  }
}

function parseExtractionArtifacts(
  artifacts: unknown,
): ExtractedKnowledgeArtifact[] {
  if (typeof artifacts !== "object" || artifacts === null) {
    return []
  }
  const record = artifacts as Record<string, unknown>
  const parsed: ExtractedKnowledgeArtifact[] = []

  if (record.json !== undefined) {
    parsed.push({
      artifactType: "normalized",
      body: JSON.stringify(record.json, null, 2),
      contentType: "application/json",
      fileName: "normalized.json",
      metadata: { format: "opendataloader-json" },
      name: "json",
    })
  }
  if (typeof record.markdown === "string") {
    parsed.push({
      artifactType: "normalizedMarkdown",
      body: record.markdown,
      contentType: "text/markdown; charset=utf-8",
      fileName: "normalized.md",
      metadata: { format: "opendataloader-markdown" },
      name: "markdown",
    })
  }
  if (record.page_map !== undefined) {
    parsed.push({
      artifactType: "normalizedPageMap",
      body: JSON.stringify(record.page_map, null, 2),
      contentType: "application/json",
      fileName: "page-map.json",
      metadata: { format: "opendataloader-page-map" },
      name: "pageMap",
    })
  }
  if (record.parser_report !== undefined) {
    parsed.push({
      artifactType: "normalizedParserReport",
      body: JSON.stringify(record.parser_report, null, 2),
      contentType: "application/json",
      fileName: "parser-report.json",
      metadata: { format: "opendataloader-parser-report" },
      name: "parserReport",
    })
  }

  return parsed
}

function parseSidecarChunk(chunk: unknown): ExtractedKnowledgeChunk {
  if (typeof chunk !== "object" || chunk === null) {
    return {
      content: "",
      language: null,
      searchText: "",
    }
  }
  const record = chunk as Record<string, unknown>
  return {
    content: typeof record.content === "string" ? record.content : "",
    imageRegion:
      typeof record.image_region === "string" ? record.image_region : undefined,
    language: typeof record.language === "string" ? record.language : null,
    pageNumber:
      typeof record.page_number === "number" ? record.page_number : undefined,
    rowRange:
      typeof record.row_range === "string" ? record.row_range : undefined,
    searchText:
      typeof record.search_text === "string" ? record.search_text : "",
    sectionPath:
      typeof record.section_path === "string" ? record.section_path : undefined,
  }
}

function sidecarExtractionEndpoint(sidecarUrl: string): string {
  let baseUrl: URL
  try {
    baseUrl = new URL(sidecarUrl)
  } catch {
    throw new Error("Knowledge sidecar URL is invalid.")
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error("Knowledge sidecar URL must use HTTP or HTTPS.")
  }
  if (baseUrl.username || baseUrl.password) {
    throw new Error("Knowledge sidecar URL cannot contain credentials.")
  }
  return new URL("/v1/knowledge/extract", baseUrl).toString()
}

function pdfParserExtractionEndpoint(pdfParserUrl: string): string {
  let baseUrl: URL
  try {
    baseUrl = new URL(pdfParserUrl)
  } catch {
    throw new Error("Knowledge PDF parser URL is invalid.")
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error("Knowledge PDF parser URL must use HTTP or HTTPS.")
  }
  if (baseUrl.username || baseUrl.password) {
    throw new Error("Knowledge PDF parser URL cannot contain credentials.")
  }
  return new URL("/v1/pdf/extract", baseUrl).toString()
}

async function readSidecarResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  return readBoundedResponseText(
    response,
    maxBytes,
    "Knowledge sidecar response exceeded the allowed size.",
  )
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  errorMessage: string,
): Promise<string> {
  const contentLength = response.headers.get("content-length")
  if (contentLength && Number.parseInt(contentLength, 10) > maxBytes) {
    throw new Error(errorMessage)
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
      throw new Error(errorMessage)
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

function isPdfSource(source: KnowledgeSource): boolean {
  return (
    source.mimeType === "application/pdf" ||
    source.originalUri?.toLowerCase().endsWith(".pdf") === true ||
    source.title.toLowerCase().endsWith(".pdf")
  )
}

export function searchKnowledgeChunks(
  query: KnowledgeQueryRequest,
  options: {
    allowedCorpusIds?: string[]
    allowedSourceIds?: string[]
    metadataScores?: Map<string, number>
    snapshots?: KnowledgeSnapshot[]
    vectorScores?: Map<string, number>
  } = {},
): KnowledgeQueryResult {
  return searchKnowledgeChunkRecords(memoryChunks, query, options)
}

export function searchKnowledgeChunkRecords(
  chunks: KnowledgeChunkRecord[],
  query: KnowledgeQueryRequest,
  options: {
    allowedCorpusIds?: string[]
    allowedSourceIds?: string[]
    metadataScores?: Map<string, number>
    snapshots?: KnowledgeSnapshot[]
    vectorScores?: Map<string, number>
  } = {},
): KnowledgeQueryResult {
  const terms = tokenize(query.query)
  const allowedSnapshots = new Map(
    (options.snapshots ?? [])
      .filter((snapshot) => snapshot.status === "published")
      .map((snapshot) => [snapshot.id, snapshot]),
  )
  const restrictSnapshots = Array.isArray(options.snapshots)
  const allowedCorpusIds = new Set(options.allowedCorpusIds ?? [])
  const restrictCorpusIds = Array.isArray(options.allowedCorpusIds)
  const allowedSourceIds = new Set(options.allowedSourceIds ?? [])
  const restrictSourceIds = Array.isArray(options.allowedSourceIds)
  const candidates = chunks
    .filter((chunk) => {
      if (
        query.corpusIds?.length &&
        !query.corpusIds.includes(chunk.corpusId)
      ) {
        return false
      }
      if (restrictCorpusIds && !allowedCorpusIds.has(chunk.corpusId)) {
        return false
      }
      if (restrictSourceIds && !allowedSourceIds.has(chunk.sourceId)) {
        return false
      }
      if (restrictSnapshots && !allowedSnapshots.has(chunk.snapshotId)) {
        return false
      }
      if (
        query.sourceTypes?.length &&
        !query.sourceTypes.includes(chunk.sourceType)
      ) {
        return false
      }
      if (query.language && chunk.language !== query.language) {
        return false
      }
      return true
    })
    .map((chunk) => ({
      chunk,
      score:
        scoreChunk(chunk, terms) +
        (options.metadataScores?.get(chunk.id) ?? 0) +
        (options.vectorScores?.get(chunk.id) ?? 0),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, query.topK ?? 5)

  const retrievedAt = new Date().toISOString()
  const results = candidates.map(({ chunk, score }) => {
    const citation: KnowledgeCitation = {
      citation_id: `cite-${chunk.id}`,
      corpus_id: chunk.corpusId,
      snapshot_id: chunk.snapshotId,
      source_id: chunk.sourceId,
      source_type: chunk.sourceType,
      title: chunk.title,
      uri: chunk.uri ?? undefined,
      page_number: chunk.pageNumber,
      section_path: chunk.sectionPath,
      row_range: chunk.rowRange,
      image_region: chunk.imageRegion,
      excerpt: chunk.content,
      score,
      checksum: chunk.checksum,
      retrieved_at: retrievedAt,
    }
    return {
      corpusId: chunk.corpusId,
      snapshotId: chunk.snapshotId,
      sourceId: chunk.sourceId,
      title: chunk.title,
      excerpt: chunk.content,
      score,
      citation,
    }
  })

  return {
    query: query.query,
    results,
    citations: results.map((result) => result.citation),
    generatedAt: retrievedAt,
  }
}

export function resetKnowledgeChunksForTest(): void {
  memoryChunks.length = 0
}

export function hydrateKnowledgeChunks(chunks: KnowledgeChunkRecord[]): void {
  memoryChunks.splice(0, memoryChunks.length, ...chunks)
}

export function removeKnowledgeChunksForSources(sourceIds: string[]): number {
  const sourceIdSet = new Set(sourceIds)
  const originalCount = memoryChunks.length
  const remaining = memoryChunks.filter(
    (chunk) => !sourceIdSet.has(chunk.sourceId),
  )
  memoryChunks.splice(0, memoryChunks.length, ...remaining)
  return originalCount - memoryChunks.length
}

function extractHtml(
  rawContent: string,
  source: KnowledgeSource,
): ExtractedKnowledgeSource {
  const canonicalUri = rawContent.match(
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
  )?.[1]
  const text = normalizeWhitespace(
    rawContent
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
  return {
    artifacts: [],
    text,
    chunks: [
      {
        content: text,
        searchText: text,
        language: detectLanguage(text),
        sectionPath: "html.body",
      },
    ],
    language: detectLanguage(text),
    warnings: [],
    metadata: {
      finalUri: source.finalUri ?? source.originalUri,
      canonicalUri: canonicalUri ?? source.canonicalUri,
      redirectChain: source.metadata.redirectChain ?? [],
    },
  }
}

function extractTable(rawContent: string): ExtractedKnowledgeSource {
  const rows = rawContent.trim().split(/\r?\n/)
  const header = rows[0]?.split(",") ?? []
  const chunks = rows.slice(1).map((row, index) => {
    const cells = row.split(",")
    const content = cells
      .map(
        (cell, cellIndex) =>
          `${header[cellIndex] ?? `column_${cellIndex + 1}`}: ${cell}`,
      )
      .join("; ")
    return {
      content,
      searchText: content,
      language: detectLanguage(content),
      rowRange: String(index + 2),
    }
  })
  const text = chunks.map((chunk) => chunk.content).join("\n")
  return {
    artifacts: [],
    text,
    chunks,
    language: detectLanguage(text),
    warnings: [],
    metadata: {
      rowCount: chunks.length,
    },
  }
}

function extractImage(rawContent: string): ExtractedKnowledgeSource {
  const text = normalizeWhitespace(rawContent)
  return {
    artifacts: [],
    text,
    chunks: text
      ? [
          {
            content: text,
            searchText: text,
            language: detectLanguage(text),
            imageRegion: "full-image",
          },
        ]
      : [],
    language: detectLanguage(text),
    warnings: text ? [] : ["weak_ocr"],
    metadata: {
      ocrMode: "fixture_text",
    },
  }
}

function extractPagedText(
  rawContent: string,
  warning?: string,
): ExtractedKnowledgeSource {
  const text = normalizeWhitespace(rawContent)
  return {
    artifacts: [],
    text,
    chunks: text
      ? [
          {
            content: text,
            searchText: text,
            language: detectLanguage(text),
            pageNumber: 1,
          },
        ]
      : [],
    language: detectLanguage(text),
    warnings: warning ? [warning] : [],
    metadata: {
      pageCount: text ? 1 : 0,
    },
  }
}

function scoreChunk(chunk: KnowledgeChunkRecord, terms: string[]): number {
  const haystack = chunk.searchText.toLowerCase()
  return terms.reduce((score, term) => {
    return haystack.includes(term) ? score + 1 : score
  }, 0)
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function detectLanguage(text: string): string | null {
  const lowered = text.toLowerCase()
  if (
    ["korpus", "znanja", "odobrav", "administratori"].some((term) =>
      lowered.includes(term),
    )
  ) {
    return "hr"
  }
  return text ? "en" : null
}

function checksum(input: string): string {
  return `sha256:${createHash("sha256").update(input).digest("hex")}`
}
