import { randomUUID } from "node:crypto"
import type {
  AgentCorpusBinding,
  KnowledgeArchivedSource,
  KnowledgeCorpus,
  KnowledgeIngestionJob,
  KnowledgeSnapshot,
  KnowledgeSource,
} from "@llm-machines/contracts"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { getDb } from "../../db/client"
import {
  knowledgeAgentCorpusBindings,
  knowledgeArchivedSources,
  knowledgeChunks,
  knowledgeCorpusAccessGroups,
  knowledgeCorpora,
  knowledgeIngestionJobs,
  knowledgeSnapshots,
  knowledgeSourceArtifacts,
  knowledgeSources,
  knowledgeUrlAcquisitionJobs,
} from "../../db/schema"
import type { KnowledgeChunkRecord } from "./ingestion"
import type { StoredKnowledgeObject } from "./object-store"

type Db = NonNullable<ReturnType<typeof getDb>>

export interface KnowledgeDurableState {
  bindings: AgentCorpusBinding[]
  chunks: KnowledgeChunkRecord[]
  corpora: KnowledgeCorpus[]
  jobs: KnowledgeIngestionJob[]
  snapshots: KnowledgeSnapshot[]
  sources: KnowledgeSource[]
  urlAcquisitionJobs: KnowledgeUrlAcquisitionJob[]
}

export type KnowledgeUrlAcquisitionAdapter = "safe_fetch" | "firecrawl"

export type KnowledgeUrlAcquisitionStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "cancelled"

export interface KnowledgeUrlAcquisitionJob {
  adapter: KnowledgeUrlAcquisitionAdapter
  attempts: number
  canonicalUrl: string | null
  checksum: string | null
  completedAt: string | null
  contentType: string | null
  corpusId: string
  createdAt: string
  createdBy: string
  errorCode: string | null
  errorDetail: string | null
  finalUrl: string | null
  httpStatus: number | null
  id: string
  lockedAt: string | null
  lockedBy: string | null
  normalizedUrl: string
  policyMetadata: Record<string, unknown>
  redirectChain: string[]
  requestedUrl: string
  sizeBytes: number | null
  sourceId: string
  status: KnowledgeUrlAcquisitionStatus
  updatedAt: string
}

export interface KnowledgeSourceArtifactInput {
  artifactType: string
  metadata?: Record<string, unknown>
  object: StoredKnowledgeObject
}

export interface KnowledgeSourceRemovalResult {
  objectKeys: string[]
  removedChunkCount: number
}

export interface KnowledgeDurableRepository {
  archiveSources(input: {
    actorId: string
    archivedAt: string
    sources: KnowledgeSource[]
  }): Promise<void>
  deleteArchivedSources(archiveIds: string[]): Promise<void>
  listArchivedSources(): Promise<KnowledgeArchivedSource[]>
  load(): Promise<KnowledgeDurableState>
  removeSources(sourceIds: string[]): Promise<KnowledgeSourceRemovalResult>
  restoreArchivedSources(archiveIds: string[]): Promise<KnowledgeSource[]>
  saveBinding(binding: AgentCorpusBinding): Promise<void>
  saveChunksForSnapshot(
    snapshotId: string,
    chunks: KnowledgeChunkRecord[],
  ): Promise<void>
  saveCorpus(corpus: KnowledgeCorpus): Promise<void>
  saveJob(job: KnowledgeIngestionJob): Promise<void>
  saveSnapshot(snapshot: KnowledgeSnapshot): Promise<void>
  saveSource(
    source: KnowledgeSource,
    artifact?: KnowledgeSourceArtifactInput | KnowledgeSourceArtifactInput[],
  ): Promise<void>
  claimNextUrlAcquisitionJob(
    workerId: string,
    lockedAt: string,
    staleBefore: string,
  ): Promise<KnowledgeUrlAcquisitionJob | null>
  saveUrlAcquisitionJob(job: KnowledgeUrlAcquisitionJob): Promise<void>
}

let repositoryOverride: KnowledgeDurableRepository | null | undefined
let cachedRepository: KnowledgeDurableRepository | null | undefined

export function getKnowledgeDurableRepository(): KnowledgeDurableRepository | null {
  if (repositoryOverride !== undefined) {
    return repositoryOverride
  }
  if (cachedRepository !== undefined) {
    return cachedRepository
  }

  const db = getDb()
  cachedRepository = db ? new PostgresKnowledgeDurableRepository(db) : null
  return cachedRepository
}

export function setKnowledgeDurableRepositoryForTest(
  repository: KnowledgeDurableRepository | null | undefined,
): void {
  repositoryOverride = repository
  cachedRepository = undefined
}

class PostgresKnowledgeDurableRepository implements KnowledgeDurableRepository {
  constructor(private readonly db: Db) {}

  async load(): Promise<KnowledgeDurableState> {
    const [
      corpusRows,
      sourceRows,
      artifactRows,
      jobRows,
      urlAcquisitionJobRows,
      snapshotRows,
      chunkRows,
      accessGroupRows,
      bindingRows,
    ] = await Promise.all([
      this.db
        .select()
        .from(knowledgeCorpora)
        .orderBy(desc(knowledgeCorpora.updatedAt)),
      this.db
        .select()
        .from(knowledgeSources)
        .orderBy(desc(knowledgeSources.updatedAt)),
      this.db.select().from(knowledgeSourceArtifacts),
      this.db
        .select()
        .from(knowledgeIngestionJobs)
        .orderBy(desc(knowledgeIngestionJobs.updatedAt)),
      this.db
        .select()
        .from(knowledgeUrlAcquisitionJobs)
        .orderBy(desc(knowledgeUrlAcquisitionJobs.updatedAt)),
      this.db
        .select()
        .from(knowledgeSnapshots)
        .orderBy(desc(knowledgeSnapshots.createdAt)),
      this.db
        .select()
        .from(knowledgeChunks)
        .orderBy(knowledgeChunks.createdAt, knowledgeChunks.chunkIndex),
      this.db.select().from(knowledgeCorpusAccessGroups),
      this.db.select().from(knowledgeAgentCorpusBindings),
    ])

    const accessGroupsByCorpus = new Map<string, string[]>()
    for (const row of accessGroupRows) {
      const groups = accessGroupsByCorpus.get(row.corpusId) ?? []
      groups.push(row.keycloakGroup)
      accessGroupsByCorpus.set(row.corpusId, groups)
    }

    const artifactsBySource = new Map<string, Record<string, unknown>>()
    for (const row of artifactRows) {
      const current = artifactsBySource.get(row.sourceId) ?? {}
      current[`${row.artifactType}ObjectKey`] = row.objectKey
      current[`${row.artifactType}Object`] = {
        checksum: row.checksum,
        contentType: row.mimeType,
        objectKey: row.objectKey,
        sizeBytes: row.sizeBytes,
      }
      artifactsBySource.set(row.sourceId, current)
    }

    const sources = sourceRows.map((row) => {
      const artifacts = artifactsBySource.get(row.id)
      const metadata = record(row.metadata)
      return {
        canonicalUri: row.canonicalUri,
        checksum: row.checksum,
        corpusId: row.corpusId,
        createdAt: iso(row.createdAt),
        createdBy: row.createdBy,
        errorDetail: row.errorDetail,
        finalUri: row.finalUri,
        id: row.id,
        language: row.language,
        metadata: artifacts
          ? {
              ...metadata,
              artifacts: {
                ...record(metadata.artifacts),
                ...artifacts,
              },
            }
          : metadata,
        mimeType: row.mimeType,
        originalUri: row.originalUri,
        sourceType: sourceType(row.sourceType),
        status: sourceStatus(row.status),
        title: row.title,
        updatedAt: iso(row.updatedAt),
      } satisfies KnowledgeSource
    })

    const snapshots = snapshotRows.map((row) => ({
      chunkCount: row.chunkCount,
      corpusId: row.corpusId,
      createdAt: iso(row.createdAt),
      id: row.id,
      metadata: record(row.metadata),
      publishedAt: row.publishedAt ? iso(row.publishedAt) : null,
      publishedBy: row.publishedBy,
      sourceCount: row.sourceCount,
      status: snapshotStatus(row.status),
      version: row.version,
    }))
    const sourcesById = new Map(sources.map((source) => [source.id, source]))
    const chunks = chunkRows.map((row) => {
      const source = sourcesById.get(row.sourceId)
      const metadata = record(row.metadata)
      return {
        checksum: row.checksum,
        chunkIndex: row.chunkIndex,
        content: row.content,
        corpusId: row.corpusId,
        createdAt: iso(row.createdAt),
        id: row.id,
        imageRegion: row.imageRegion ?? undefined,
        language: row.language,
        pageNumber: row.pageNumber ?? undefined,
        rowRange: row.rowRange ?? undefined,
        searchText: row.searchText,
        sectionPath: row.sectionPath ?? undefined,
        snapshotId: row.snapshotId,
        sourceId: row.sourceId,
        sourceType:
          source?.sourceType ?? sourceType(String(metadata.sourceType)),
        title:
          source?.title ??
          (typeof metadata.title === "string" ? metadata.title : row.sourceId),
        uri:
          source?.finalUri ??
          source?.originalUri ??
          (typeof metadata.uri === "string" ? metadata.uri : null),
      } satisfies KnowledgeChunkRecord
    })

    return {
      bindings: bindingRows.map((row) => ({
        agentResourceId: row.agentResourceId,
        corpusId: row.corpusId,
        createdAt: iso(row.createdAt),
        createdBy: row.createdBy,
        id: row.id,
      })),
      chunks,
      corpora: corpusRows.map((row) => {
        const publishedSnapshot = snapshots.find(
          (snapshot) => snapshot.id === row.publishedSnapshotId,
        )
        const latestSnapshot = snapshots.find(
          (snapshot) => snapshot.corpusId === row.id,
        )
        return {
          accessGroups: accessGroupsByCorpus.get(row.id) ?? [],
          chunkCount: (publishedSnapshot ?? latestSnapshot)?.chunkCount ?? 0,
          createdAt: iso(row.createdAt),
          createdBy: row.createdBy,
          description: row.description,
          id: row.id,
          languageHints: stringArray(row.languageHints),
          name: row.name,
          publishedSnapshotId: row.publishedSnapshotId,
          sourceCount: sources.filter((source) => source.corpusId === row.id)
            .length,
          status: corpusStatus(row.status),
          updatedAt: iso(row.updatedAt),
          updatedBy: row.updatedBy,
        } satisfies KnowledgeCorpus
      }),
      jobs: jobRows.map((row) => ({
        corpusId: row.corpusId,
        createdAt: iso(row.createdAt),
        createdBy: row.createdBy,
        errorDetail: row.errorDetail,
        id: row.id,
        jobType: jobType(row.jobType),
        metrics: record(row.metrics),
        progressPercent: row.progressPercent,
        retryCount: row.retryCount,
        sourceId: row.sourceId,
        status: jobStatus(row.status),
        updatedAt: iso(row.updatedAt),
      })),
      urlAcquisitionJobs: urlAcquisitionJobRows.map((row) =>
        urlAcquisitionJob(row),
      ),
      snapshots,
      sources,
    }
  }

  async saveCorpus(corpus: KnowledgeCorpus): Promise<void> {
    await this.db
      .insert(knowledgeCorpora)
      .values({
        createdAt: date(corpus.createdAt),
        createdBy: corpus.createdBy,
        description: corpus.description,
        id: corpus.id,
        languageHints: corpus.languageHints,
        name: corpus.name,
        publishedSnapshotId: corpus.publishedSnapshotId,
        status: corpus.status,
        updatedAt: date(corpus.updatedAt),
        updatedBy: corpus.updatedBy,
      })
      .onConflictDoUpdate({
        target: knowledgeCorpora.id,
        set: {
          description: sql`excluded.description`,
          languageHints: sql`excluded.language_hints`,
          name: sql`excluded.name`,
          publishedSnapshotId: sql`excluded.published_snapshot_id`,
          status: sql`excluded.status`,
          updatedAt: sql`excluded.updated_at`,
          updatedBy: sql`excluded.updated_by`,
        },
      })

    await this.db
      .delete(knowledgeCorpusAccessGroups)
      .where(eq(knowledgeCorpusAccessGroups.corpusId, corpus.id))

    if (corpus.accessGroups.length > 0) {
      await this.db.insert(knowledgeCorpusAccessGroups).values(
        corpus.accessGroups.map((group) => ({
          corpusId: corpus.id,
          createdAt: date(corpus.createdAt),
          createdBy: corpus.createdBy,
          keycloakGroup: group,
        })),
      )
    }
  }

  async saveSource(
    source: KnowledgeSource,
    artifact?: KnowledgeSourceArtifactInput | KnowledgeSourceArtifactInput[],
  ): Promise<void> {
    await this.db
      .insert(knowledgeSources)
      .values({
        canonicalUri: source.canonicalUri,
        checksum: source.checksum,
        corpusId: source.corpusId,
        createdAt: date(source.createdAt),
        createdBy: source.createdBy,
        errorDetail: source.errorDetail,
        finalUri: source.finalUri,
        id: source.id,
        language: source.language,
        metadata: source.metadata,
        mimeType: source.mimeType,
        originalUri: source.originalUri,
        sourceType: source.sourceType,
        status: source.status,
        title: source.title,
        updatedAt: date(source.updatedAt),
      })
      .onConflictDoUpdate({
        target: knowledgeSources.id,
        set: {
          canonicalUri: sql`excluded.canonical_uri`,
          checksum: sql`excluded.checksum`,
          errorDetail: sql`excluded.error_detail`,
          finalUri: sql`excluded.final_uri`,
          language: sql`excluded.language`,
          metadata: sql`excluded.metadata`,
          mimeType: sql`excluded.mime_type`,
          status: sql`excluded.status`,
          title: sql`excluded.title`,
          updatedAt: sql`excluded.updated_at`,
        },
      })

    const artifacts = Array.isArray(artifact)
      ? artifact
      : artifact
        ? [artifact]
        : []
    for (const artifactInput of artifacts) {
      await this.db
        .delete(knowledgeSourceArtifacts)
        .where(
          and(
            eq(knowledgeSourceArtifacts.sourceId, source.id),
            eq(
              knowledgeSourceArtifacts.artifactType,
              artifactInput.artifactType,
            ),
          ),
        )
      await this.db.insert(knowledgeSourceArtifacts).values({
        artifactType: artifactInput.artifactType,
        checksum: artifactInput.object.checksum,
        createdAt: date(source.updatedAt),
        id: randomUUID(),
        metadata: artifactInput.metadata ?? {},
        mimeType: artifactInput.object.contentType,
        objectKey: artifactInput.object.objectKey,
        sizeBytes: artifactInput.object.sizeBytes,
        sourceId: source.id,
      })
    }
  }

  async saveJob(job: KnowledgeIngestionJob): Promise<void> {
    await this.db
      .insert(knowledgeIngestionJobs)
      .values({
        corpusId: job.corpusId,
        createdAt: date(job.createdAt),
        createdBy: job.createdBy,
        errorDetail: job.errorDetail,
        id: job.id,
        jobType: job.jobType,
        metrics: job.metrics,
        progressPercent: job.progressPercent,
        retryCount: job.retryCount,
        sourceId: job.sourceId,
        status: job.status,
        updatedAt: date(job.updatedAt),
      })
      .onConflictDoUpdate({
        target: knowledgeIngestionJobs.id,
        set: {
          errorDetail: sql`excluded.error_detail`,
          metrics: sql`excluded.metrics`,
          progressPercent: sql`excluded.progress_percent`,
          retryCount: sql`excluded.retry_count`,
          status: sql`excluded.status`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
  }

  async claimNextUrlAcquisitionJob(
    workerId: string,
    lockedAt: string,
    staleBefore: string,
  ): Promise<KnowledgeUrlAcquisitionJob | null> {
    const rows = await this.db
      .update(knowledgeUrlAcquisitionJobs)
      .set({
        attempts: sql`${knowledgeUrlAcquisitionJobs.attempts} + 1`,
        lockedAt: date(lockedAt),
        lockedBy: workerId,
        status: "running",
        updatedAt: date(lockedAt),
      })
      .where(
        sql`${knowledgeUrlAcquisitionJobs.id} = (
          SELECT id
          FROM knowledge.url_acquisition_jobs
          WHERE status = 'queued'
             OR (
               status = 'running'
               AND locked_at IS NOT NULL
               AND locked_at < ${staleBefore}
             )
          ORDER BY
            CASE WHEN status = 'queued' THEN 0 ELSE 1 END,
            created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )`,
      )
      .returning()

    return rows[0] ? urlAcquisitionJob(rows[0]) : null
  }

  async saveUrlAcquisitionJob(job: KnowledgeUrlAcquisitionJob): Promise<void> {
    await this.db
      .insert(knowledgeUrlAcquisitionJobs)
      .values({
        adapter: job.adapter,
        attempts: job.attempts,
        canonicalUrl: job.canonicalUrl,
        checksum: job.checksum,
        completedAt: job.completedAt ? date(job.completedAt) : null,
        contentType: job.contentType,
        corpusId: job.corpusId,
        createdAt: date(job.createdAt),
        createdBy: job.createdBy,
        errorCode: job.errorCode,
        errorDetail: job.errorDetail,
        finalUrl: job.finalUrl,
        httpStatus: job.httpStatus,
        id: job.id,
        lockedAt: job.lockedAt ? date(job.lockedAt) : null,
        lockedBy: job.lockedBy,
        normalizedUrl: job.normalizedUrl,
        policyMetadata: job.policyMetadata,
        redirectChain: job.redirectChain,
        requestedUrl: job.requestedUrl,
        sizeBytes: job.sizeBytes,
        sourceId: job.sourceId,
        status: job.status,
        updatedAt: date(job.updatedAt),
      })
      .onConflictDoUpdate({
        target: knowledgeUrlAcquisitionJobs.id,
        set: {
          attempts: sql`excluded.attempts`,
          canonicalUrl: sql`excluded.canonical_url`,
          checksum: sql`excluded.checksum`,
          completedAt: sql`excluded.completed_at`,
          contentType: sql`excluded.content_type`,
          errorCode: sql`excluded.error_code`,
          errorDetail: sql`excluded.error_detail`,
          finalUrl: sql`excluded.final_url`,
          httpStatus: sql`excluded.http_status`,
          lockedAt: sql`excluded.locked_at`,
          lockedBy: sql`excluded.locked_by`,
          policyMetadata: sql`excluded.policy_metadata`,
          redirectChain: sql`excluded.redirect_chain`,
          sizeBytes: sql`excluded.size_bytes`,
          status: sql`excluded.status`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
  }

  async saveSnapshot(snapshot: KnowledgeSnapshot): Promise<void> {
    await this.db
      .insert(knowledgeSnapshots)
      .values({
        chunkCount: snapshot.chunkCount,
        corpusId: snapshot.corpusId,
        createdAt: date(snapshot.createdAt),
        id: snapshot.id,
        metadata: snapshot.metadata,
        publishedAt: snapshot.publishedAt ? date(snapshot.publishedAt) : null,
        publishedBy: snapshot.publishedBy,
        sourceCount: snapshot.sourceCount,
        status: snapshot.status,
        version: snapshot.version,
      })
      .onConflictDoUpdate({
        target: knowledgeSnapshots.id,
        set: {
          chunkCount: sql`excluded.chunk_count`,
          metadata: sql`excluded.metadata`,
          publishedAt: sql`excluded.published_at`,
          publishedBy: sql`excluded.published_by`,
          sourceCount: sql`excluded.source_count`,
          status: sql`excluded.status`,
        },
      })
  }

  async saveBinding(binding: AgentCorpusBinding): Promise<void> {
    await this.db
      .insert(knowledgeAgentCorpusBindings)
      .values({
        agentResourceId: binding.agentResourceId,
        corpusId: binding.corpusId,
        createdAt: date(binding.createdAt),
        createdBy: binding.createdBy,
        id: binding.id,
      })
      .onConflictDoNothing()
  }

  async saveChunksForSnapshot(
    snapshotId: string,
    chunks: KnowledgeChunkRecord[],
  ): Promise<void> {
    await this.db
      .delete(knowledgeChunks)
      .where(eq(knowledgeChunks.snapshotId, snapshotId))

    if (chunks.length === 0) {
      return
    }

    await this.db.insert(knowledgeChunks).values(
      chunks.map((chunk) => ({
        checksum: chunk.checksum,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        corpusId: chunk.corpusId,
        createdAt: date(chunk.createdAt),
        id: chunk.id,
        imageRegion: chunk.imageRegion,
        language: chunk.language,
        metadata: {
          sourceType: chunk.sourceType,
          title: chunk.title,
          uri: chunk.uri,
        },
        pageNumber: chunk.pageNumber,
        rowRange: chunk.rowRange,
        searchText: chunk.searchText,
        sectionPath: chunk.sectionPath,
        snapshotId: chunk.snapshotId,
        sourceId: chunk.sourceId,
      })),
    )
  }

  async archiveSources(input: {
    actorId: string
    archivedAt: string
    sources: KnowledgeSource[]
  }): Promise<void> {
    if (input.sources.length === 0) {
      return
    }

    await this.db
      .insert(knowledgeArchivedSources)
      .values(
        input.sources.map((source) => ({
          archivedAt: date(input.archivedAt),
          archivedBy: input.actorId,
          canonicalUri: source.canonicalUri,
          checksum: source.checksum,
          corpusId: source.corpusId,
          createdBy: source.createdBy,
          errorDetail: source.errorDetail,
          finalUri: source.finalUri,
          id: randomUUID(),
          language: source.language,
          metadata: source.metadata,
          mimeType: source.mimeType,
          originalUri: source.originalUri,
          sourceCreatedAt: date(source.createdAt),
          sourceId: source.id,
          sourceType: source.sourceType,
          sourceUpdatedAt: date(source.updatedAt),
          status: source.status,
          title: source.title,
        })),
      )
      .onConflictDoNothing()
  }

  async listArchivedSources(): Promise<KnowledgeArchivedSource[]> {
    const [archiveRows, corpusRows] = await Promise.all([
      this.db
        .select()
        .from(knowledgeArchivedSources)
        .orderBy(desc(knowledgeArchivedSources.archivedAt)),
      this.db.select().from(knowledgeCorpora),
    ])
    const corpusNames = new Map(
      corpusRows.map((corpus) => [corpus.id, corpus.name]),
    )

    return archiveRows.map((row) => ({
      archivedAt: iso(row.archivedAt),
      archivedBy: row.archivedBy,
      canonicalUri: row.canonicalUri,
      checksum: row.checksum,
      corpusId: row.corpusId,
      corpusName: corpusNames.get(row.corpusId) ?? row.corpusId,
      createdAt: iso(row.sourceCreatedAt),
      createdBy: row.createdBy,
      errorDetail: row.errorDetail,
      finalUri: row.finalUri,
      id: row.id,
      language: row.language,
      metadata: record(row.metadata),
      mimeType: row.mimeType,
      originalUri: row.originalUri,
      sourceId: row.sourceId,
      sourceType: sourceType(row.sourceType),
      status: sourceStatus(row.status),
      title: row.title,
      updatedAt: iso(row.sourceUpdatedAt),
    }))
  }

  async restoreArchivedSources(
    archiveIds: string[],
  ): Promise<KnowledgeSource[]> {
    if (archiveIds.length === 0) {
      return []
    }

    const rows = await this.db
      .select()
      .from(knowledgeArchivedSources)
      .where(inArray(knowledgeArchivedSources.id, archiveIds))

    const sources = rows.map((row) => ({
      canonicalUri: row.canonicalUri,
      checksum: row.checksum,
      corpusId: row.corpusId,
      createdAt: iso(row.sourceCreatedAt),
      createdBy: row.createdBy,
      errorDetail: null,
      finalUri: row.finalUri,
      id: row.sourceId,
      language: row.language,
      metadata: {
        ...record(row.metadata),
        restoredFromArchive: {
          archivedAt: iso(row.archivedAt),
          archiveId: row.id,
        },
      },
      mimeType: row.mimeType,
      originalUri: row.originalUri,
      sourceType: sourceType(row.sourceType),
      status: "pending",
      title: row.title,
      updatedAt: new Date().toISOString(),
    })) satisfies KnowledgeSource[]

    await Promise.all(sources.map((source) => this.saveSource(source)))
    await this.deleteArchivedSources(rows.map((row) => row.id))
    return sources
  }

  async deleteArchivedSources(archiveIds: string[]): Promise<void> {
    if (archiveIds.length === 0) {
      return
    }

    await this.db
      .delete(knowledgeArchivedSources)
      .where(inArray(knowledgeArchivedSources.id, archiveIds))
  }

  async removeSources(
    sourceIds: string[],
  ): Promise<KnowledgeSourceRemovalResult> {
    if (sourceIds.length === 0) {
      return { objectKeys: [], removedChunkCount: 0 }
    }

    const [artifactRows, chunkRows] = await Promise.all([
      this.db
        .select({ objectKey: knowledgeSourceArtifacts.objectKey })
        .from(knowledgeSourceArtifacts)
        .where(inArray(knowledgeSourceArtifacts.sourceId, sourceIds)),
      this.db
        .select({ id: knowledgeChunks.id })
        .from(knowledgeChunks)
        .where(inArray(knowledgeChunks.sourceId, sourceIds)),
    ])

    await this.db
      .update(knowledgeIngestionJobs)
      .set({ sourceId: null })
      .where(inArray(knowledgeIngestionJobs.sourceId, sourceIds))

    await this.db
      .delete(knowledgeChunks)
      .where(inArray(knowledgeChunks.sourceId, sourceIds))

    await this.db
      .delete(knowledgeSourceArtifacts)
      .where(inArray(knowledgeSourceArtifacts.sourceId, sourceIds))

    await this.db
      .delete(knowledgeUrlAcquisitionJobs)
      .where(inArray(knowledgeUrlAcquisitionJobs.sourceId, sourceIds))

    await this.db
      .delete(knowledgeSources)
      .where(inArray(knowledgeSources.id, sourceIds))

    return {
      objectKeys: artifactRows.map((row) => row.objectKey),
      removedChunkCount: chunkRows.length,
    }
  }
}

function corpusStatus(status: string): KnowledgeCorpus["status"] {
  if (
    status === "draft" ||
    status === "ingesting" ||
    status === "staged" ||
    status === "published" ||
    status === "refreshing" ||
    status === "failed" ||
    status === "disabled" ||
    status === "archived" ||
    status === "deleted"
  ) {
    return status
  }
  return "draft"
}

function sourceStatus(status: string): KnowledgeSource["status"] {
  if (
    status === "pending" ||
    status === "fetching" ||
    status === "extracting" ||
    status === "ready" ||
    status === "failed" ||
    status === "blocked" ||
    status === "removed" ||
    status === "disabled"
  ) {
    return status
  }
  return "pending"
}

function sourceType(sourceType: string): KnowledgeSource["sourceType"] {
  if (
    sourceType === "file" ||
    sourceType === "url" ||
    sourceType === "image" ||
    sourceType === "table"
  ) {
    return sourceType
  }
  return "file"
}

function jobStatus(status: string): KnowledgeIngestionJob["status"] {
  if (
    status === "queued" ||
    status === "running" ||
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled"
  ) {
    return status
  }
  return "queued"
}

function jobType(jobTypeValue: string): KnowledgeIngestionJob["jobType"] {
  if (
    jobTypeValue === "ingest" ||
    jobTypeValue === "refresh" ||
    jobTypeValue === "retry_source"
  ) {
    return jobTypeValue
  }
  return "ingest"
}

function urlAcquisitionJob(
  row: typeof knowledgeUrlAcquisitionJobs.$inferSelect,
) {
  return {
    adapter: urlAcquisitionAdapter(row.adapter),
    attempts: row.attempts,
    canonicalUrl: row.canonicalUrl,
    checksum: row.checksum,
    completedAt: row.completedAt ? iso(row.completedAt) : null,
    contentType: row.contentType,
    corpusId: row.corpusId,
    createdAt: iso(row.createdAt),
    createdBy: row.createdBy,
    errorCode: row.errorCode,
    errorDetail: row.errorDetail,
    finalUrl: row.finalUrl,
    httpStatus: row.httpStatus,
    id: row.id,
    lockedAt: row.lockedAt ? iso(row.lockedAt) : null,
    lockedBy: row.lockedBy,
    normalizedUrl: row.normalizedUrl,
    policyMetadata: record(row.policyMetadata),
    redirectChain: stringArray(row.redirectChain),
    requestedUrl: row.requestedUrl,
    sizeBytes: row.sizeBytes,
    sourceId: row.sourceId,
    status: urlAcquisitionStatus(row.status),
    updatedAt: iso(row.updatedAt),
  } satisfies KnowledgeUrlAcquisitionJob
}

function urlAcquisitionAdapter(
  adapter: string,
): KnowledgeUrlAcquisitionAdapter {
  return adapter === "firecrawl" ? "firecrawl" : "safe_fetch"
}

function urlAcquisitionStatus(status: string): KnowledgeUrlAcquisitionStatus {
  if (
    status === "queued" ||
    status === "running" ||
    status === "succeeded" ||
    status === "failed" ||
    status === "blocked" ||
    status === "cancelled"
  ) {
    return status
  }
  return "queued"
}

function snapshotStatus(status: string): KnowledgeSnapshot["status"] {
  if (status === "staged" || status === "published" || status === "discarded") {
    return status
  }
  return "staged"
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function date(value: string): Date {
  return new Date(value)
}

function iso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString()
}
