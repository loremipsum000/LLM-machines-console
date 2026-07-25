import { timingSafeEqual } from "node:crypto"
import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify"

const DEFAULT_MODEL = "BAAI/bge-reranker-v2-m3"
const DEFAULT_MAX_CANDIDATES = 24
const HARD_MAX_CANDIDATES = 40
const DEFAULT_MAX_DOCUMENT_CHARS = 4_800
const HARD_MAX_DOCUMENT_CHARS = 6_000
const DEFAULT_TIMEOUT_MS = 2_500
const HARD_TIMEOUT_MS = 5_000
const DEFAULT_TEI_RERANK_URL = "http://reranker-tei:80/rerank"

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

type RerankDocumentInput =
  | string
  | {
      text?: string
      content?: string
      title?: string
      url?: string
    }

type NormalizedDocument = {
  index: number
  text: string
  original: RerankDocumentInput
  truncated: boolean
}

type ParsedRerankRequest = {
  model: string
  query: string
  documents: NormalizedDocument[]
  inputDocumentCount: number
  topN: number
  returnDocuments: boolean
  truncatedCandidates: boolean
  truncatedDocuments: boolean
}

type RuntimeConfig = {
  model: string
  teiRerankUrl: string
  maxCandidates: number
  maxDocumentChars: number
  timeoutMs: number
}

type ParseResult =
  | { ok: true; value: ParsedRerankRequest }
  | { ok: false; detail: string }

type TeiRerankItem = {
  index: number
  score: number
}

export function buildServer(
  options: { fetchImpl?: FetchLike } = {},
): FastifyInstance {
  const fetchImpl = options.fetchImpl ?? fetch
  const server = Fastify({
    logger: true,
  })

  server.addHook("preHandler", authenticateRerankRequest)

  const liveness = async () => ({
    service: "reranker-api",
    status: "ok",
  })

  server.get("/livez", liveness)
  server.get("/healthz", liveness)

  server.post("/v1/rerank", async (request, reply) => {
    const config = readRuntimeConfig()
    const parsed = parseRerankRequest(request.body, config)
    if (!parsed.ok) {
      return problem(reply, 400, "Invalid rerank request", parsed.detail)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

    let response: Response
    try {
      response = await fetchImpl(config.teiRerankUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: parsed.value.query,
          texts: parsed.value.documents.map((document) => document.text),
          raw_scores: false,
        }),
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timeout)
      if (isAbortError(error)) {
        return problem(
          reply,
          504,
          "Reranker timeout",
          "TEI did not respond before the configured reranker timeout.",
        )
      }
      return problem(
        reply,
        503,
        "Reranker unavailable",
        "TEI rerank request failed.",
      )
    }

    clearTimeout(timeout)

    if (!response.ok) {
      return problem(
        reply,
        503,
        "Reranker unavailable",
        `TEI returned HTTP ${response.status}.`,
      )
    }

    const teiPayload = await parseJsonResponse(response)
    if (!teiPayload.ok) {
      return problem(
        reply,
        502,
        "Invalid reranker response",
        "TEI returned a non-JSON rerank response.",
      )
    }

    const ranked = parseTeiRerankItems(teiPayload.value)
    if (!ranked.ok) {
      return problem(reply, 502, "Invalid reranker response", ranked.detail)
    }

    const documentsByIndex = new Map(
      parsed.value.documents.map((document) => [document.index, document]),
    )
    const results = ranked.value
      .filter((item) => documentsByIndex.has(item.index))
      .slice(0, parsed.value.topN)
      .map((item) => {
        const document = documentsByIndex.get(item.index)
        return {
          index: item.index,
          relevance_score: item.score,
          ...(parsed.value.returnDocuments && document
            ? { document: documentForResponse(document) }
            : {}),
        }
      })

    return {
      model: parsed.value.model,
      results,
      usage: {
        total_tokens: 0,
      },
      metadata: {
        input_document_count: parsed.value.inputDocumentCount,
        ranked_document_count: parsed.value.documents.length,
        truncated_candidates: parsed.value.truncatedCandidates,
        truncated_documents: parsed.value.truncatedDocuments,
      },
    }
  })

  return server
}

async function authenticateRerankRequest(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (request.url === "/healthz" || request.url === "/livez") {
    return
  }

  const expectedToken = process.env.RERANKER_API_KEY
  if (!expectedToken) {
    return reply.code(503).send({
      type: "about:blank",
      title: "Reranker auth is not configured",
      status: 503,
      detail: "RERANKER_API_KEY must be set before reranking is enabled.",
    })
  }

  const suppliedToken =
    request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (!suppliedToken || !constantTimeEqual(suppliedToken, expectedToken)) {
    return reply.code(401).send({
      type: "about:blank",
      title: "Unauthenticated",
      status: 401,
      detail: "A valid reranker bearer token is required.",
    })
  }
}

function parseRerankRequest(body: unknown, config: RuntimeConfig): ParseResult {
  if (!isRecord(body)) {
    return { ok: false, detail: "Request body must be a JSON object." }
  }

  const query = body.query
  if (typeof query !== "string" || query.trim().length === 0) {
    return { ok: false, detail: "query must be a non-empty string." }
  }

  const documents = body.documents
  if (!Array.isArray(documents) || documents.length === 0) {
    return { ok: false, detail: "documents must be a non-empty array." }
  }

  const limitedDocuments = documents.slice(0, config.maxCandidates)
  const normalizedDocuments: NormalizedDocument[] = []
  let truncatedDocuments = false

  for (let index = 0; index < limitedDocuments.length; index += 1) {
    const normalized = normalizeDocument(
      limitedDocuments[index],
      index,
      config.maxDocumentChars,
    )
    if (!normalized.ok) {
      return normalized
    }
    truncatedDocuments = truncatedDocuments || normalized.value.truncated
    normalizedDocuments.push(normalized.value)
  }

  const topN = normalizePositiveInteger(body.top_n, normalizedDocuments.length)
  if (!topN.ok) {
    return { ok: false, detail: "top_n must be a positive integer." }
  }

  const returnDocuments =
    typeof body.return_documents === "boolean" ? body.return_documents : false
  return {
    ok: true,
    value: {
      model: config.model,
      query: query.trim(),
      documents: normalizedDocuments,
      inputDocumentCount: documents.length,
      topN: Math.min(topN.value, normalizedDocuments.length),
      returnDocuments,
      truncatedCandidates: documents.length > limitedDocuments.length,
      truncatedDocuments,
    },
  }
}

function normalizeDocument(
  value: unknown,
  index: number,
  maxDocumentChars: number,
): { ok: true; value: NormalizedDocument } | { ok: false; detail: string } {
  const extracted = extractDocumentText(value)
  if (!extracted.ok) {
    return {
      ok: false,
      detail: `documents[${index}] must be a string or object with text/content.`,
    }
  }

  const trimmed = extracted.text.trim()
  if (trimmed.length === 0) {
    return {
      ok: false,
      detail: `documents[${index}] must not be empty.`,
    }
  }

  const text = trimmed.slice(0, maxDocumentChars)
  return {
    ok: true,
    value: {
      index,
      text,
      original: extracted.original,
      truncated: trimmed.length > text.length,
    },
  }
}

function extractDocumentText(
  value: unknown,
): { ok: true; text: string; original: RerankDocumentInput } | { ok: false } {
  if (typeof value === "string") {
    return { ok: true, text: value, original: value }
  }
  if (!isRecord(value)) {
    return { ok: false }
  }

  const text = value.text
  if (typeof text === "string") {
    return {
      ok: true,
      text,
      original: documentObject(value, text),
    }
  }

  const content = value.content
  if (typeof content === "string") {
    return {
      ok: true,
      text: content,
      original: documentObject(value, content),
    }
  }

  return { ok: false }
}

function documentObject(
  value: Record<string, unknown>,
  text: string,
): Exclude<RerankDocumentInput, string> {
  return {
    text,
    ...(typeof value.content === "string" ? { content: value.content } : {}),
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.url === "string" ? { url: value.url } : {}),
  }
}

function documentForResponse(
  document: NormalizedDocument,
): Exclude<RerankDocumentInput, string> {
  if (typeof document.original === "string") {
    return { text: document.text }
  }
  return {
    ...document.original,
    text: document.text,
  }
}

function normalizePositiveInteger(
  value: unknown,
  fallback: number,
): { ok: true; value: number } | { ok: false } {
  if (value === undefined) {
    return { ok: true, value: fallback }
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > HARD_MAX_CANDIDATES
  ) {
    return { ok: false }
  }
  return { ok: true, value }
}

async function parseJsonResponse(
  response: Response,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await response.json() }
  } catch {
    return { ok: false }
  }
}

function parseTeiRerankItems(
  value: unknown,
): { ok: true; value: TeiRerankItem[] } | { ok: false; detail: string } {
  const rawItems = Array.isArray(value)
    ? value
    : isRecord(value)
      ? value.results
      : undefined
  if (!Array.isArray(rawItems)) {
    return { ok: false, detail: "TEI response must be an array of results." }
  }

  const items: TeiRerankItem[] = []
  for (const item of rawItems) {
    if (!isRecord(item)) {
      return { ok: false, detail: "TEI result item must be an object." }
    }
    const index = item.index
    const score =
      typeof item.score === "number" ? item.score : item.relevance_score
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      typeof score !== "number" ||
      !Number.isFinite(score)
    ) {
      return {
        ok: false,
        detail: "TEI result items must include numeric index and score.",
      }
    }
    items.push({ index, score })
  }

  return { ok: true, value: items }
}

function readRuntimeConfig(): RuntimeConfig {
  return {
    model: process.env.RERANKER_MODEL?.trim() || DEFAULT_MODEL,
    teiRerankUrl: process.env.TEI_RERANK_URL?.trim() || DEFAULT_TEI_RERANK_URL,
    maxCandidates: readBoundedInteger(
      "RERANKER_MAX_CANDIDATES",
      DEFAULT_MAX_CANDIDATES,
      HARD_MAX_CANDIDATES,
    ),
    maxDocumentChars: readBoundedInteger(
      "RERANKER_MAX_DOCUMENT_CHARS",
      DEFAULT_MAX_DOCUMENT_CHARS,
      HARD_MAX_DOCUMENT_CHARS,
    ),
    timeoutMs: readBoundedInteger(
      "RERANKER_TIMEOUT_MS",
      DEFAULT_TIMEOUT_MS,
      HARD_TIMEOUT_MS,
    ),
  }
}

function readBoundedInteger(
  envName: string,
  fallback: number,
  hardMax: number,
): number {
  const value = Number.parseInt(process.env[envName] ?? "", 10)
  if (!Number.isFinite(value) || value < 1) {
    return fallback
  }
  return Math.min(value, hardMax)
}

function problem(
  reply: FastifyReply,
  status: 400 | 401 | 502 | 503 | 504,
  title: string,
  detail: string,
): FastifyReply {
  return reply.code(status).send({
    type: "about:blank",
    title,
    status,
    detail,
    fallback: {
      rerankerType: "none",
    },
  })
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function constantTimeEqual(supplied: string, expected: string): boolean {
  const suppliedBuffer = Buffer.from(supplied)
  const expectedBuffer = Buffer.from(expected)
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  )
}

const isEntrypoint =
  Boolean(process.argv[1]) &&
  realpathOrResolved(process.argv[1] ?? "") ===
    realpathOrResolved(fileURLToPath(import.meta.url))

function realpathOrResolved(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

if (isEntrypoint) {
  const server = buildServer()
  const port = Number.parseInt(process.env.PORT ?? "8000", 10)
  const host = process.env.HOST ?? "127.0.0.1"

  await server.listen({ host, port })
}
