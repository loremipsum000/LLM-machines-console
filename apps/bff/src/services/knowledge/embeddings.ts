import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import type { Actor } from "../../auth/persona"
import { getDb } from "../../db/client"
import { emitAudit } from "../audit"
import type { KnowledgeChunkRecord } from "./ingestion"

type Db = NonNullable<ReturnType<typeof getDb>>

export type KnowledgeRetrievalMode = "hybrid" | "lexical" | "lexical_fallback"

export interface KnowledgeEmbeddingConfig {
  dimensions: number
  enabled: boolean
  model: string
  searchMode: "hybrid" | "lexical"
}

export interface KnowledgeEmbeddingCoverage {
  failedCount: number
  readyCount: number
  totalCount: number
}

export interface KnowledgeEmbeddingPosture extends KnowledgeEmbeddingConfig {
  coverage: KnowledgeEmbeddingCoverage
  sourceStatus: "ok" | "degraded" | "not_configured"
}

type EmbeddingProvider = (input: string[]) => Promise<number[][]>

interface VectorScoreRow extends Record<string, unknown> {
  owner_id: string
  similarity: number | string
}

let embeddingProviderOverride: EmbeddingProvider | null | undefined

export function setKnowledgeEmbeddingProviderForTest(
  provider: EmbeddingProvider | null | undefined,
): void {
  embeddingProviderOverride = provider
}

export function getKnowledgeEmbeddingConfig(): KnowledgeEmbeddingConfig {
  return {
    dimensions: positiveInt("KNOWLEDGE_EMBEDDING_DIMENSIONS", 1024),
    enabled: envFlag("KNOWLEDGE_VECTOR_RETRIEVAL", true),
    model: process.env.KNOWLEDGE_EMBEDDING_MODEL ?? "knowledge-embedding-local",
    searchMode:
      process.env.KNOWLEDGE_SEARCH_MODE?.trim().toLowerCase() === "lexical"
        ? "lexical"
        : "hybrid",
  }
}

export async function getKnowledgeEmbeddingPosture(): Promise<KnowledgeEmbeddingPosture> {
  const config = getKnowledgeEmbeddingConfig()
  const coverage = await getKnowledgeEmbeddingCoverage()
  const sourceStatus =
    config.enabled && config.searchMode === "hybrid"
      ? !embeddingBackendConfigured() || coverage.failedCount > 0
        ? "degraded"
        : "ok"
      : "not_configured"
  return {
    ...config,
    coverage,
    sourceStatus,
  }
}

function embeddingBackendConfigured(): boolean {
  if (embeddingProviderOverride !== undefined) {
    return Boolean(embeddingProviderOverride)
  }
  return Boolean(process.env.LITELLM_URL?.trim() && process.env.LITELLM_KEY)
}

export async function storeKnowledgeChunkEmbeddings(
  actor: Actor,
  chunks: KnowledgeChunkRecord[],
): Promise<void> {
  const config = getKnowledgeEmbeddingConfig()
  const db = getDb()
  if (!db || !config.enabled || config.searchMode !== "hybrid") {
    return
  }
  if (chunks.length === 0) {
    return
  }

  try {
    const embeddings = await embedTexts(
      chunks.map((chunk) => embeddingInputForChunk(chunk)),
      config,
    )
    await Promise.all(
      chunks.map((chunk, index) =>
        upsertChunkEmbedding(db, chunk, embeddings[index], config, null),
      ),
    )
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Knowledge embedding generation failed."
    await Promise.all(
      chunks.map((chunk) => upsertChunkEmbedding(db, chunk, null, config, detail)),
    )
    await emitAudit({
      actorId: actor.subject,
      action: "connector.docs.embedding_failed",
      targetType: "knowledge.snapshot",
      targetId: chunks[0]?.snapshotId ?? "unknown",
      reason: "embedding_failed",
      metadata: {
        chunkCount: chunks.length,
        model: config.model,
      },
    })
  }
}

export async function scoreKnowledgeChunksByVector(input: {
  actor: Actor
  chunks: KnowledgeChunkRecord[]
  query: string
  topK: number
}): Promise<{
  mode: KnowledgeRetrievalMode
  scores: Map<string, number>
  warning?: string
}> {
  const config = getKnowledgeEmbeddingConfig()
  const db = getDb()
  if (
    !db ||
    !config.enabled ||
    config.searchMode !== "hybrid" ||
    input.chunks.length === 0
  ) {
    return { mode: "lexical", scores: new Map() }
  }

  try {
    const [queryEmbedding] = await embedTexts([input.query], config)
    const scores = await readVectorScores(db, {
      chunkIds: input.chunks.map((chunk) => chunk.id),
      embedding: queryEmbedding,
      limit: Math.max(input.topK * 4, input.topK),
      model: config.model,
    })
    return { mode: "hybrid", scores }
  } catch (error) {
    await emitAudit({
      actorId: input.actor.subject,
      action: "connector.docs.embedding_failed",
      targetType: "mcp.connector",
      targetId: "internal-docs",
      reason: "embedding_failed",
      metadata: {
        model: config.model,
        queryLength: input.query.length,
      },
    })
    return {
      mode: "lexical_fallback",
      scores: new Map(),
      warning:
        error instanceof Error
          ? error.message
          : "Knowledge vector retrieval is unavailable.",
    }
  }
}

export async function backfillKnowledgeChunkEmbeddings(
  actor: Actor,
  chunks: KnowledgeChunkRecord[],
): Promise<{ chunkCount: number }> {
  await storeKnowledgeChunkEmbeddings(actor, chunks)
  return { chunkCount: chunks.length }
}

async function getKnowledgeEmbeddingCoverage(): Promise<KnowledgeEmbeddingCoverage> {
  const db = getDb()
  if (!db) {
    return { failedCount: 0, readyCount: 0, totalCount: 0 }
  }
  try {
    const rows = await db.execute<{
      failed_count: number | string
      ready_count: number | string
      total_count: number | string
    }>(sql`
      SELECT
        COUNT(*)::integer AS total_count,
        COUNT(*) FILTER (WHERE status = 'ready')::integer AS ready_count,
        COUNT(*) FILTER (WHERE status = 'failed')::integer AS failed_count
      FROM common.embeddings_knowledge_chunks
    `)
    const row = Array.isArray(rows) ? rows[0] : undefined
    return {
      failedCount: numberField(row?.failed_count),
      readyCount: numberField(row?.ready_count),
      totalCount: numberField(row?.total_count),
    }
  } catch {
    return { failedCount: 0, readyCount: 0, totalCount: 0 }
  }
}

async function embedTexts(
  input: string[],
  config: KnowledgeEmbeddingConfig,
): Promise<number[][]> {
  if (embeddingProviderOverride !== undefined) {
    if (!embeddingProviderOverride) {
      throw new Error("Knowledge embedding provider is not configured.")
    }
    return validateEmbeddings(await embeddingProviderOverride(input), config)
  }

  const litellmUrl = process.env.LITELLM_URL?.replace(/\/+$/, "")
  const litellmKey = process.env.LITELLM_KEY
  if (!litellmUrl || !litellmKey) {
    throw new Error("Set LITELLM_URL and LITELLM_KEY for knowledge embeddings.")
  }

  const response = await fetch(`${litellmUrl}/v1/embeddings`, {
    body: JSON.stringify({
      input,
      model: config.model,
    }),
    headers: {
      Authorization: `Bearer ${litellmKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  })
  if (!response.ok) {
    throw new Error(`LiteLLM embeddings returned HTTP ${response.status}.`)
  }
  return validateEmbeddings(parseEmbeddingResponse(await response.json()), config)
}

function parseEmbeddingResponse(payload: unknown): number[][] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("LiteLLM embeddings response is invalid.")
  }
  return payload.data.map((item) => {
    if (!isRecord(item) || !Array.isArray(item.embedding)) {
      throw new Error("LiteLLM embeddings response is invalid.")
    }
    return item.embedding.map((value) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error("LiteLLM embeddings response is invalid.")
      }
      return value
    })
  })
}

function validateEmbeddings(
  embeddings: number[][],
  config: KnowledgeEmbeddingConfig,
): number[][] {
  for (const embedding of embeddings) {
    if (embedding.length !== config.dimensions) {
      throw new Error("Knowledge embedding dimensions do not match config.")
    }
  }
  return embeddings
}

async function upsertChunkEmbedding(
  db: Db,
  chunk: KnowledgeChunkRecord,
  embedding: number[] | null,
  config: KnowledgeEmbeddingConfig,
  errorDetail: string | null,
): Promise<void> {
  const now = new Date()
  const vectorValue = embedding ? vectorLiteral(embedding) : null
  await db.execute(sql`
    INSERT INTO common.embeddings_knowledge_chunks (
      id,
      owner_schema,
      owner_table,
      owner_id,
      corpus_id,
      snapshot_id,
      source_id,
      checksum,
      model,
      dimensions,
      embedding,
      status,
      error_detail,
      created_at,
      updated_at
    )
    VALUES (
      ${randomUUID()},
      'knowledge',
      'chunks',
      ${chunk.id},
      ${chunk.corpusId},
      ${chunk.snapshotId},
      ${chunk.sourceId},
      ${chunk.checksum},
      ${config.model},
      ${config.dimensions},
      ${vectorValue}::common.vector,
      ${embedding ? "ready" : "failed"},
      ${errorDetail},
      ${now},
      ${now}
    )
    ON CONFLICT (owner_schema, owner_table, owner_id, model)
    DO UPDATE SET
      corpus_id = EXCLUDED.corpus_id,
      snapshot_id = EXCLUDED.snapshot_id,
      source_id = EXCLUDED.source_id,
      checksum = EXCLUDED.checksum,
      dimensions = EXCLUDED.dimensions,
      embedding = EXCLUDED.embedding,
      status = EXCLUDED.status,
      error_detail = EXCLUDED.error_detail,
      updated_at = EXCLUDED.updated_at
  `)
}

async function readVectorScores(
  db: Db,
  input: {
    chunkIds: string[]
    embedding: number[]
    limit: number
    model: string
  },
): Promise<Map<string, number>> {
  if (input.chunkIds.length === 0) {
    return new Map()
  }
  const chunkIdSql = sql.join(
    input.chunkIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )
  const vectorValue = vectorLiteral(input.embedding)
  const rows = await db.execute<VectorScoreRow>(sql`
    SELECT
      owner_id::text,
      1 - (embedding <=> ${vectorValue}::common.vector) AS similarity
    FROM common.embeddings_knowledge_chunks
    WHERE owner_schema = 'knowledge'
      AND owner_table = 'chunks'
      AND owner_id IN (${chunkIdSql})
      AND model = ${input.model}
      AND status = 'ready'
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vectorValue}::common.vector
    LIMIT ${input.limit}
  `)
  const scores = new Map<string, number>()
  for (const row of Array.isArray(rows) ? rows : []) {
    scores.set(row.owner_id, numberField(row.similarity))
  }
  return scores
}

function embeddingInputForChunk(chunk: KnowledgeChunkRecord): string {
  return [chunk.title, chunk.sectionPath, chunk.searchText]
    .filter((value): value is string => Boolean(value))
    .join("\n")
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.map((value) => Number(value).toFixed(8)).join(",")}]`
}

function numberField(value: number | string | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function positiveInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  if (value === "true" || value === "1" || value === "yes") {
    return true
  }
  if (value === "false" || value === "0" || value === "no") {
    return false
  }
  return fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
