import { z } from "zod"

export const knowledgeCorpusStatusSchema = z.enum([
  "draft",
  "ingesting",
  "staged",
  "published",
  "refreshing",
  "failed",
  "disabled",
  "archived",
  "deleted",
])
export type KnowledgeCorpusStatus = z.infer<typeof knowledgeCorpusStatusSchema>

export const knowledgeSourceTypeSchema = z.enum([
  "file",
  "url",
  "image",
  "table",
])
export type KnowledgeSourceType = z.infer<typeof knowledgeSourceTypeSchema>

export const knowledgeSourceStatusSchema = z.enum([
  "pending",
  "fetching",
  "extracting",
  "ready",
  "failed",
  "blocked",
  "removed",
  "disabled",
])
export type KnowledgeSourceStatus = z.infer<typeof knowledgeSourceStatusSchema>

export const knowledgeIngestionJobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
])
export type KnowledgeIngestionJobStatus = z.infer<
  typeof knowledgeIngestionJobStatusSchema
>

export const knowledgeSnapshotStatusSchema = z.enum([
  "staged",
  "published",
  "discarded",
])
export type KnowledgeSnapshotStatus = z.infer<
  typeof knowledgeSnapshotStatusSchema
>

export const knowledgeCorpusSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(1000),
  status: knowledgeCorpusStatusSchema,
  languageHints: z.array(z.string().min(2).max(12)),
  publishedSnapshotId: z.string().uuid().nullable(),
  sourceCount: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  accessGroups: z.array(z.string().min(1).max(160)),
  createdBy: z.string().min(1),
  updatedBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type KnowledgeCorpus = z.infer<typeof knowledgeCorpusSchema>

export const knowledgeSourceSchema = z.object({
  id: z.string().uuid(),
  corpusId: z.string().uuid(),
  sourceType: knowledgeSourceTypeSchema,
  title: z.string().min(1).max(240),
  originalUri: z.string().min(1).nullable(),
  finalUri: z.string().min(1).nullable(),
  canonicalUri: z.string().min(1).nullable(),
  mimeType: z.string().min(1).max(160),
  checksum: z.string().min(1),
  status: knowledgeSourceStatusSchema,
  language: z.string().min(2).max(12).nullable(),
  metadata: z.record(z.unknown()),
  errorDetail: z.string().min(1).nullable(),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>

export const knowledgeArchivedSourceSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  corpusId: z.string().uuid(),
  corpusName: z.string().min(1).max(120),
  sourceType: knowledgeSourceTypeSchema,
  title: z.string().min(1).max(240),
  originalUri: z.string().min(1).nullable(),
  finalUri: z.string().min(1).nullable(),
  canonicalUri: z.string().min(1).nullable(),
  mimeType: z.string().min(1).max(160),
  checksum: z.string().min(1),
  status: knowledgeSourceStatusSchema,
  language: z.string().min(2).max(12).nullable(),
  metadata: z.record(z.unknown()),
  errorDetail: z.string().min(1).nullable(),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedBy: z.string().min(1),
  archivedAt: z.string().datetime(),
})
export type KnowledgeArchivedSource = z.infer<
  typeof knowledgeArchivedSourceSchema
>

export const knowledgeIngestionJobSchema = z.object({
  id: z.string().uuid(),
  corpusId: z.string().uuid(),
  sourceId: z.string().uuid().nullable(),
  jobType: z.enum(["ingest", "refresh", "retry_source"]),
  status: knowledgeIngestionJobStatusSchema,
  progressPercent: z.number().int().min(0).max(100),
  metrics: z.record(z.unknown()),
  errorDetail: z.string().min(1).nullable(),
  retryCount: z.number().int().nonnegative(),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type KnowledgeIngestionJob = z.infer<typeof knowledgeIngestionJobSchema>

export const knowledgeSnapshotSchema = z.object({
  id: z.string().uuid(),
  corpusId: z.string().uuid(),
  version: z.number().int().positive(),
  status: knowledgeSnapshotStatusSchema,
  sourceCount: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  metadata: z.record(z.unknown()),
  publishedBy: z.string().min(1).nullable(),
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})
export type KnowledgeSnapshot = z.infer<typeof knowledgeSnapshotSchema>

export const knowledgeCitationSchema = z.object({
  citation_id: z.string().min(1),
  corpus_id: z.string().uuid(),
  snapshot_id: z.string().uuid(),
  source_id: z.string().uuid(),
  source_type: knowledgeSourceTypeSchema,
  title: z.string().min(1),
  uri: z.string().min(1).optional(),
  page_number: z.number().int().positive().optional(),
  section_path: z.string().min(1).optional(),
  row_range: z.string().min(1).optional(),
  image_region: z.string().min(1).optional(),
  excerpt: z.string(),
  score: z.number(),
  checksum: z.string().min(1),
  retrieved_at: z.string().datetime(),
})
export type KnowledgeCitation = z.infer<typeof knowledgeCitationSchema>

export const knowledgeQueryRequestSchema = z.object({
  query: z.string().min(1).max(1000),
  corpusIds: z.array(z.string().uuid()).max(20).optional(),
  language: z.string().min(2).max(12).optional(),
  sourceTypes: z.array(knowledgeSourceTypeSchema).max(4).optional(),
  topK: z.number().int().min(1).max(20).optional(),
})
export type KnowledgeQueryRequest = z.infer<typeof knowledgeQueryRequestSchema>

export const knowledgeQueryResultSchema = z.object({
  query: z.string().min(1),
  results: z.array(
    z.object({
      corpusId: z.string().uuid(),
      snapshotId: z.string().uuid(),
      sourceId: z.string().uuid(),
      title: z.string().min(1),
      excerpt: z.string(),
      score: z.number(),
      citation: knowledgeCitationSchema,
    }),
  ),
  citations: z.array(knowledgeCitationSchema),
  generatedAt: z.string().datetime(),
})
export type KnowledgeQueryResult = z.infer<typeof knowledgeQueryResultSchema>

export const agentCorpusBindingSchema = z.object({
  id: z.string().uuid(),
  agentResourceId: z.string().uuid(),
  corpusId: z.string().uuid(),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
})
export type AgentCorpusBinding = z.infer<typeof agentCorpusBindingSchema>

export const createKnowledgeCorpusRequestSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(""),
  languageHints: z.array(z.string().min(2).max(12)).max(8).default([]),
  accessGroups: z.array(z.string().min(1).max(160)).max(50).default([]),
})
export type CreateKnowledgeCorpusRequest = z.infer<
  typeof createKnowledgeCorpusRequestSchema
>

export const knowledgeUrlAcquisitionModeSchema = z.enum(["single_page"])
export type KnowledgeUrlAcquisitionMode = z.infer<
  typeof knowledgeUrlAcquisitionModeSchema
>

export const knowledgeUrlScraperSchema = z.enum(["safe_fetch", "firecrawl"])
export type KnowledgeUrlScraper = z.infer<typeof knowledgeUrlScraperSchema>

export const addKnowledgeUrlSourceRequestSchema = z.object({
  url: z.string().min(1).max(2000),
  title: z.string().min(1).max(240).optional(),
  acquisitionMode: knowledgeUrlAcquisitionModeSchema.default("single_page"),
  scraper: knowledgeUrlScraperSchema.default("safe_fetch"),
})
export type AddKnowledgeUrlSourceRequest = z.infer<
  typeof addKnowledgeUrlSourceRequestSchema
>

export const addKnowledgeUploadSourceRequestSchema = z.object({
  fileName: z.string().min(1).max(240),
  title: z.string().min(1).max(240).optional(),
  mimeType: z.string().min(1).max(160),
  contentBase64: z.string().min(1).max(70_000_000),
})
export type AddKnowledgeUploadSourceRequest = z.infer<
  typeof addKnowledgeUploadSourceRequestSchema
>

export const updateKnowledgeCorpusAccessRequestSchema = z.object({
  accessGroups: z.array(z.string().min(1).max(160)).max(50).default([]),
})
export type UpdateKnowledgeCorpusAccessRequest = z.infer<
  typeof updateKnowledgeCorpusAccessRequestSchema
>

export const hardDeleteKnowledgeCorpusRequestSchema = z.object({
  confirmation: z.literal("DELETE"),
})
export type HardDeleteKnowledgeCorpusRequest = z.infer<
  typeof hardDeleteKnowledgeCorpusRequestSchema
>

export const knowledgeSourceBulkActionRequestSchema = z.object({
  action: z.enum(["archive", "disable", "hard_delete"]),
  sourceIds: z.array(z.string().uuid()).min(1).max(100),
  confirmation: z.string().max(80).optional(),
})
export type KnowledgeSourceBulkActionRequest = z.infer<
  typeof knowledgeSourceBulkActionRequestSchema
>

export const knowledgeArchiveSourceBulkActionRequestSchema = z.object({
  action: z.enum(["restore", "hard_delete"]),
  archivedSourceIds: z.array(z.string().uuid()).min(1).max(100),
  confirmation: z.string().max(80).optional(),
})
export type KnowledgeArchiveSourceBulkActionRequest = z.infer<
  typeof knowledgeArchiveSourceBulkActionRequestSchema
>

export const knowledgeCorpusListResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  corpora: z.array(knowledgeCorpusSchema),
})
export type KnowledgeCorpusListResponse = z.infer<
  typeof knowledgeCorpusListResponseSchema
>

export const knowledgeArchiveSourceListResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  sources: z.array(knowledgeArchivedSourceSchema),
})
export type KnowledgeArchiveSourceListResponse = z.infer<
  typeof knowledgeArchiveSourceListResponseSchema
>

export const knowledgeCorpusDetailResponseSchema = z.object({
  corpus: knowledgeCorpusSchema,
  sources: z.array(knowledgeSourceSchema),
  jobs: z.array(knowledgeIngestionJobSchema),
  snapshots: z.array(knowledgeSnapshotSchema),
})
export type KnowledgeCorpusDetailResponse = z.infer<
  typeof knowledgeCorpusDetailResponseSchema
>

export const knowledgeActionResponseSchema = z.object({
  corpus: knowledgeCorpusSchema,
  archivedSourceIds: z.array(z.string().uuid()).optional(),
  hardDeletedArchivedSourceIds: z.array(z.string().uuid()).optional(),
  hardDeletedCorpusId: z.string().uuid().optional(),
  hardDeletedSourceIds: z.array(z.string().uuid()).optional(),
  restoredSourceIds: z.array(z.string().uuid()).optional(),
  source: knowledgeSourceSchema.nullable().optional(),
  sourceIds: z.array(z.string().uuid()).optional(),
  job: knowledgeIngestionJobSchema.nullable().optional(),
  snapshot: knowledgeSnapshotSchema.nullable().optional(),
})
export type KnowledgeActionResponse = z.infer<
  typeof knowledgeActionResponseSchema
>
