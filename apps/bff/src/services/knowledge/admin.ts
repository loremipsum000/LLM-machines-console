import { createHash, randomUUID } from "node:crypto"
import type {
  AddKnowledgeUploadSourceRequest,
  AddKnowledgeUrlSourceRequest,
  AdminTeamGroupUnlock,
  AgentCorpusBinding,
  CreateKnowledgeCorpusRequest,
  HardDeleteKnowledgeCorpusRequest,
  KnowledgeActionResponse,
  KnowledgeArchiveSourceBulkActionRequest,
  KnowledgeArchiveSourceListResponse,
  KnowledgeArchivedSource,
  KnowledgeCorpus,
  KnowledgeCorpusDetailResponse,
  KnowledgeCorpusListResponse,
  KnowledgeCorpusStatus,
  KnowledgeIngestionJob,
  KnowledgeQueryRequest,
  KnowledgeQueryResult,
  KnowledgeSnapshot,
  KnowledgeSource,
  KnowledgeSourceBulkActionRequest,
  KnowledgeSourceType,
  KnowledgeUrlScraper,
  UpdateKnowledgeCorpusAccessRequest,
} from "@llm-machines/contracts"
import { and, eq, inArray } from "drizzle-orm"
import type { Actor } from "../../auth/persona"
import { getDb } from "../../db/client"
import {
  knowledgeChunks,
  knowledgeCorpora,
  knowledgeCorpusAccessGroups,
  knowledgeSnapshots,
  knowledgeSources,
} from "../../db/schema"
import { evaluateAdminUrlPolicyForScope } from "../admin-settings"
import { emitAudit } from "../audit"
import { upsertActorUser } from "../users"
import {
  type ExtractedKnowledgeArtifact,
  type KnowledgeChunkRecord,
  hydrateKnowledgeChunks,
  ingestKnowledgeSourceContent,
  removeKnowledgeChunksForSources,
  resetKnowledgeChunksForTest,
  searchKnowledgeChunkRecords,
  searchKnowledgeChunks,
} from "./ingestion"
import {
  type KnowledgeRetrievalMode,
  scoreKnowledgeChunksByVector,
  storeKnowledgeChunkEmbeddings,
} from "./embeddings"
import {
  type KnowledgeObjectStore,
  type StoredKnowledgeObject,
  createKnowledgeObjectStoreFromEnv,
  toPublicKnowledgeObjectRef,
} from "./object-store"
import {
  type KnowledgeDurableRepository,
  type KnowledgeSourceArtifactInput,
  type KnowledgeSourceRemovalResult,
  type KnowledgeUrlAcquisitionJob,
  getKnowledgeDurableRepository,
  setKnowledgeDurableRepositoryForTest,
} from "./repository"
import {
  acquireKnowledgeUrl,
  acquisitionError,
  acquisitionErrorCode,
  checksumBuffer,
  knowledgeFirecrawlEnabled,
  normalizedKnowledgeUrlKey,
  validateKnowledgeUrl,
} from "./url-acquisition"

interface KnowledgeState {
  corpora: KnowledgeCorpus[]
  sources: KnowledgeSource[]
  jobs: KnowledgeIngestionJob[]
  snapshots: KnowledgeSnapshot[]
  sourceContents: Map<string, Buffer>
  urlAcquisitionJobs: KnowledgeUrlAcquisitionJob[]
  bindings: AgentCorpusBinding[]
}

export type KnowledgeMutationResult =
  | { status: "ok"; response: KnowledgeActionResponse }
  | { status: "not_found"; detail: string }
  | { status: "invalid"; detail: string }

const state: KnowledgeState = {
  corpora: [],
  sources: [],
  jobs: [],
  snapshots: [],
  sourceContents: new Map(),
  urlAcquisitionJobs: [],
  bindings: [],
}

export interface GovernedCorpusSourceSummary {
  count: number
  sourceType: KnowledgeSourceType
}

export interface GovernedCorpusSummary {
  chunkCount: number
  description: string
  id: string
  languageHints: string[]
  name: string
  publishedSnapshotId: string | null
  sourceCount: number
  sourceSummary: GovernedCorpusSourceSummary[]
  updatedAt: string
}

export interface GovernedCorpusResolveCandidate extends GovernedCorpusSummary {
  matchReason: "description" | "exact_name" | "id" | "name" | "slug"
}

export interface GovernedCorpusResolution {
  candidates: GovernedCorpusResolveCandidate[]
  query: string
  status: "ambiguous" | "not_found" | "resolved"
}

export interface GovernedCorpusManifest {
  corpus: GovernedCorpusSummary
  publishedSnapshot: {
    id: string
    version: number
  } | null
  retrievalReady: boolean
  sources: Array<{
    id: string
    language: string | null
    sourceType: KnowledgeSourceType
    title: string
  }>
}

export interface GovernedKnowledgeRuntimeQuery extends KnowledgeQueryRequest {
  corpusRefs?: string[]
}

export interface GovernedKnowledgeRuntimeResult extends KnowledgeQueryResult {
  noResultReason: string | null
  retrievalMode: KnowledgeRetrievalMode
  selectedCorpora: GovernedCorpusSummary[]
  unresolvedCorpora: GovernedCorpusResolution[]
  warnings: string[]
}

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const MAX_UPLOAD_FILE_NAME_LENGTH = 240
const DEFAULT_URL_ACQUISITION_JOB_STALE_AFTER_MS = 60_000
const ALLOWED_UPLOAD_FORMATS = [
  {
    extensions: ["pdf"],
    mimeTypes: ["application/pdf"],
  },
  {
    extensions: ["docx"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  },
  {
    extensions: ["pptx"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
  },
  {
    extensions: ["txt"],
    mimeTypes: ["text/plain"],
  },
  {
    extensions: ["md"],
    mimeTypes: ["text/markdown", "text/plain", "text/x-markdown"],
  },
  {
    extensions: ["html"],
    mimeTypes: ["text/html"],
  },
  {
    extensions: ["csv"],
    mimeTypes: ["text/csv", "application/csv"],
  },
  {
    extensions: ["tsv"],
    mimeTypes: ["text/tab-separated-values", "text/tsv"],
  },
  {
    extensions: ["xlsx"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
  },
  {
    extensions: ["odt"],
    mimeTypes: ["application/vnd.oasis.opendocument.text"],
  },
  {
    extensions: ["ods"],
    mimeTypes: ["application/vnd.oasis.opendocument.spreadsheet"],
  },
  {
    extensions: ["odp"],
    mimeTypes: ["application/vnd.oasis.opendocument.presentation"],
  },
  {
    extensions: ["rtf"],
    mimeTypes: ["application/rtf", "text/rtf"],
  },
  {
    extensions: ["eml"],
    mimeTypes: ["message/rfc822", "text/plain"],
  },
  {
    extensions: ["msg"],
    mimeTypes: ["application/octet-stream", "application/vnd.ms-outlook"],
  },
  {
    extensions: ["epub"],
    mimeTypes: ["application/epub+zip"],
  },
  {
    extensions: ["json"],
    mimeTypes: ["application/json", "text/json", "text/plain"],
  },
  {
    extensions: ["jsonl"],
    mimeTypes: ["application/jsonl", "application/x-ndjson", "text/plain"],
  },
  {
    extensions: ["xml"],
    mimeTypes: ["application/xml", "text/xml"],
  },
  {
    extensions: ["yaml", "yml"],
    mimeTypes: ["application/x-yaml", "text/plain", "text/yaml"],
  },
  {
    extensions: ["jpg", "jpeg"],
    mimeTypes: ["image/jpeg"],
  },
  {
    extensions: ["png"],
    mimeTypes: ["image/png"],
  },
  {
    extensions: ["tif", "tiff"],
    mimeTypes: ["image/tiff"],
  },
  {
    extensions: ["bmp"],
    mimeTypes: ["image/bmp"],
  },
  {
    extensions: ["webp"],
    mimeTypes: ["image/webp"],
  },
] as const
const TABLE_UPLOAD_EXTENSIONS = new Set([
  "csv",
  "json",
  "jsonl",
  "ods",
  "tsv",
  "xlsx",
  "xml",
  "yaml",
  "yml",
])
const TABLE_UPLOAD_MIME_TYPES = new Set([
  "application/csv",
  "application/json",
  "application/jsonl",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/x-ndjson",
  "application/x-yaml",
  "application/xml",
  "text/csv",
  "text/json",
  "text/tab-separated-values",
  "text/tsv",
  "text/xml",
  "text/yaml",
])

let durableStateHydrated = false
let objectStoreOverride: KnowledgeObjectStore | null | undefined
let cachedObjectStore: KnowledgeObjectStore | null | undefined

export async function listKnowledgeCorpora(
  _actor: Actor,
): Promise<KnowledgeCorpusListResponse> {
  await refreshDurableState()
  return {
    generatedAt: now(),
    corpora: [...state.corpora].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ),
  }
}

export async function listKnowledgeArchivedSources(
  _actor: Actor,
): Promise<KnowledgeArchiveSourceListResponse> {
  await ensureDurableStateHydrated()
  const repository = getKnowledgeDurableRepository()
  return {
    generatedAt: now(),
    sources: repository ? await repository.listArchivedSources() : [],
  }
}

export async function getKnowledgeCorpusDetail(
  _actor: Actor,
  corpusId: string,
): Promise<KnowledgeCorpusDetailResponse | null> {
  await refreshDurableState()
  const corpus = findCorpus(corpusId)
  if (!corpus) {
    return null
  }

  return detailFor(corpus)
}

export async function createKnowledgeCorpus(
  actor: Actor,
  input: CreateKnowledgeCorpusRequest,
): Promise<KnowledgeActionResponse> {
  await ensureDurableStateHydrated()
  const timestamp = now()
  const corpus: KnowledgeCorpus = {
    id: randomUUID(),
    name: input.name,
    description: input.description,
    status: "draft",
    languageHints: input.languageHints,
    publishedSnapshotId: null,
    sourceCount: 0,
    chunkCount: 0,
    accessGroups: normalizeAccessGroups(input.accessGroups),
    createdBy: actor.subject,
    updatedBy: actor.subject,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  state.corpora.push(corpus)
  await emitAudit({
    actorId: actor.subject,
    action: "knowledge.corpus.created",
    targetType: "knowledge.corpus",
    targetId: corpus.id,
    metadata: {
      name: corpus.name,
      accessGroupCount: corpus.accessGroups.length,
    },
  })
  await persistCorpus(actor, corpus)
  return { corpus }
}

export async function addKnowledgeUrlSource(
  actor: Actor,
  corpusId: string,
  input: AddKnowledgeUrlSourceRequest,
): Promise<KnowledgeMutationResult> {
  await ensureDurableStateHydrated()
  const corpus = findCorpus(corpusId)
  if (!corpus) {
    return { status: "not_found", detail: "Corpus not found." }
  }

  const urlValidation = validateKnowledgeUrl(input.url)
  if (!urlValidation.ok) {
    return {
      status: "invalid",
      detail: urlValidation.detail ?? "URL is invalid.",
    }
  }
  const normalizedUrl = normalizedKnowledgeUrlKey(urlValidation.url)
  const scraper = input.scraper ?? "safe_fetch"
  if (scraper === "firecrawl" && !knowledgeFirecrawlEnabled()) {
    return { status: "invalid", detail: "Firecrawl URL ingestion is disabled." }
  }
  const policyDecision = await evaluateAdminUrlPolicyForScope(
    normalizedUrl,
    "knowledge_ingestion",
  )
  if (policyDecision.status === "blocked") {
    await emitAudit({
      actorId: actor.subject,
      action: "knowledge.url_policy.blocked",
      targetType: "knowledge.corpus",
      targetId: corpus.id,
      metadata: {
        corpusId,
        matchedRuleIds: policyDecision.matchedRuleIds,
        mode: policyDecision.mode,
        normalizedUrl: policyDecision.normalizedUrl,
        requestedUrl: input.url,
        scope: "knowledge_ingestion",
      },
    })
    return { status: "invalid", detail: policyDecision.detail }
  }
  if (
    sourcesFor(corpus.id).some(
      (source) =>
        source.sourceType === "url" && sourceUrlKey(source) === normalizedUrl,
    )
  ) {
    return { status: "invalid", detail: "Duplicate URL source." }
  }

  const timestamp = now()
  const acquisitionJobId = randomUUID()
  const source = createSource(actor, corpus, {
    sourceType: "url",
    title: input.title ?? urlValidation.url.hostname,
    originalUri: normalizedUrl,
    finalUri: normalizedUrl,
    canonicalUri: null,
    mimeType: "text/html",
    checksum: checksum(normalizedUrl),
    status: "fetching",
    metadata: {
      admission: "admin_url",
      acquisition: {
        adapter: scraper,
        jobId: acquisitionJobId,
        mode: input.acquisitionMode ?? "single_page",
        status: "queued",
      },
      redirectChain: [],
      titleProvided: Boolean(input.title),
      urlPolicy: {
        matchedRuleIds: policyDecision.matchedRuleIds,
        mode: policyDecision.mode,
        scope: "knowledge_ingestion",
      },
    },
    timestamp,
  })
  const acquisitionJob: KnowledgeUrlAcquisitionJob = {
    adapter: scraper,
    attempts: 0,
    canonicalUrl: null,
    checksum: null,
    completedAt: null,
    contentType: null,
    corpusId,
    createdAt: timestamp,
    createdBy: actor.subject,
    errorCode: null,
    errorDetail: null,
    finalUrl: null,
    httpStatus: null,
    id: acquisitionJobId,
    lockedAt: null,
    lockedBy: null,
    normalizedUrl,
    policyMetadata: {
      matchedRuleIds: policyDecision.matchedRuleIds,
      mode: policyDecision.mode,
      scope: "knowledge_ingestion",
    },
    redirectChain: [],
    requestedUrl: input.url,
    sizeBytes: null,
    sourceId: source.id,
    status: "queued",
    updatedAt: timestamp,
  }
  state.urlAcquisitionJobs.push(acquisitionJob)

  await emitAudit({
    actorId: actor.subject,
    action: "knowledge.source.added",
    targetType: "knowledge.source",
    targetId: source.id,
    metadata: {
      acquisitionMode: input.acquisitionMode ?? "single_page",
      corpusId,
      matchedUrlPolicyRuleIds: policyDecision.matchedRuleIds,
      scraper,
      urlAcquisitionJobId: acquisitionJob.id,
      urlPolicyMode: policyDecision.mode,
      sourceType: source.sourceType,
      url: source.originalUri,
    },
  })
  await persistCorpus(actor, corpus)
  await persistSource(actor, source)
  await persistUrlAcquisitionJob(actor, acquisitionJob)

  return { status: "ok", response: { corpus, source } }
}

export async function addKnowledgeUploadSource(
  actor: Actor,
  corpusId: string,
  input: AddKnowledgeUploadSourceRequest,
): Promise<KnowledgeMutationResult> {
  await ensureDurableStateHydrated()
  const corpus = findCorpus(corpusId)
  if (!corpus) {
    return { status: "not_found", detail: "Corpus not found." }
  }

  const validation = validateUploadInput(input)
  if (!validation.ok) {
    return { status: "invalid", detail: validation.detail }
  }
  const body = validation.body
  if (body.length === 0) {
    return { status: "invalid", detail: "Uploaded source content is empty." }
  }
  const sourceChecksum = checksum(body)
  if (
    sourcesFor(corpus.id).some((source) => source.checksum === sourceChecksum)
  ) {
    return { status: "invalid", detail: "Duplicate upload source." }
  }

  const timestamp = now()
  const source = createSource(actor, corpus, {
    sourceType: sourceTypeForUpload(input.mimeType, input.fileName),
    title: input.title ?? input.fileName,
    originalUri: input.fileName,
    finalUri: null,
    canonicalUri: null,
    mimeType: input.mimeType,
    checksum: sourceChecksum,
    status: "pending",
    metadata: {
      admission: "admin_upload",
      sizeBytes: body.length,
    },
    timestamp,
  })
  state.sourceContents.set(source.id, body)
  const originalArtifact = await storeOriginalArtifact(
    corpus.id,
    source,
    body,
    input.mimeType,
  )
  source.metadata = {
    ...source.metadata,
    artifacts: artifactMetadata(
      corpus.id,
      source,
      "original",
      originalArtifact,
    ),
  }

  await emitAudit({
    actorId: actor.subject,
    action: "knowledge.source.added",
    targetType: "knowledge.source",
    targetId: source.id,
    metadata: {
      corpusId,
      sourceType: source.sourceType,
      fileName: input.fileName,
    },
  })
  await persistCorpus(actor, corpus)
  await persistSource(actor, source, originalArtifact)

  return { status: "ok", response: { corpus, source } }
}

export async function runKnowledgeUrlAcquisitionWorkerOnce(
  workerId = `knowledge-url-worker-${process.pid}`,
): Promise<number> {
  await ensureDurableStateHydrated()
  const job = await claimNextUrlAcquisitionJob(workerId)
  if (!job) {
    return 0
  }
  await processKnowledgeUrlAcquisitionJob(systemUrlAcquisitionActor(), job)
  return 1
}

export async function runKnowledgeUrlAcquisitionWorkerBatch({
  limit = 10,
  workerId = `knowledge-url-worker-${process.pid}`,
}: {
  limit?: number
  workerId?: string
} = {}): Promise<number> {
  let processed = 0
  for (let index = 0; index < limit; index += 1) {
    processed += await runKnowledgeUrlAcquisitionWorkerOnce(workerId)
    if (processed <= index) {
      break
    }
  }
  return processed
}

export function listKnowledgeUrlAcquisitionJobsForTest(): KnowledgeUrlAcquisitionJob[] {
  return JSON.parse(
    JSON.stringify(state.urlAcquisitionJobs),
  ) as KnowledgeUrlAcquisitionJob[]
}

async function claimNextUrlAcquisitionJob(
  workerId: string,
): Promise<KnowledgeUrlAcquisitionJob | null> {
  const timestamp = now()
  const staleBefore = urlAcquisitionJobStaleBefore(timestamp)
  const repository = getKnowledgeDurableRepository()
  if (repository) {
    const job = await repository.claimNextUrlAcquisitionJob(
      workerId,
      timestamp,
      staleBefore,
    )
    if (job) {
      await hydrateDurableState(repository)
      upsertUrlAcquisitionJobState(job)
    }
    return job
  }

  const job = state.urlAcquisitionJobs.find(
    (candidate) =>
      candidate.status === "queued" ||
      staleRunningUrlAcquisitionJob(candidate, staleBefore),
  )
  if (!job) {
    return null
  }
  Object.assign(job, {
    attempts: job.attempts + 1,
    lockedAt: timestamp,
    lockedBy: workerId,
    status: "running" satisfies KnowledgeUrlAcquisitionJob["status"],
    updatedAt: timestamp,
  })
  return job
}

async function processKnowledgeUrlAcquisitionJob(
  actor: Actor,
  job: KnowledgeUrlAcquisitionJob,
): Promise<void> {
  let source = state.sources.find((candidate) => candidate.id === job.sourceId)
  let corpus = state.corpora.find((candidate) => candidate.id === job.corpusId)
  if (!source || !corpus) {
    const repository = getKnowledgeDurableRepository()
    if (repository) {
      await hydrateDurableState(repository)
      source = state.sources.find((candidate) => candidate.id === job.sourceId)
      corpus = state.corpora.find((candidate) => candidate.id === job.corpusId)
    }
  }
  if (!source || !corpus) {
    await completeUrlAcquisitionJob(actor, {
      errorCode: "source_missing",
      errorDetail: "URL acquisition source is missing.",
      job,
      status: "failed",
    })
    return
  }

  try {
    const result = await acquireKnowledgeUrl({
      adapter: job.adapter,
      authorizeUrl: async (url) => {
        const decision = await evaluateAdminUrlPolicyForScope(
          url,
          "knowledge_ingestion",
        )
        if (decision.status === "blocked") {
          throw acquisitionError(
            "url_policy_blocked",
            decision.detail ?? "URL is blocked by URL governance policy.",
          )
        }
      },
      normalizedUrl: job.normalizedUrl,
      requestedUrl: job.requestedUrl,
    })
    if (duplicateFinalUrlExists(corpus.id, source.id, result)) {
      throw acquisitionError(
        "duplicate_final_url",
        "Duplicate URL source after redirects or canonical URL resolution.",
      )
    }

    const sourceChecksum = checksumBuffer(result.body)
    const report = {
      ...result.report,
      canonicalUrl: result.canonicalUrl,
      checksum: sourceChecksum,
      contentType: result.contentType,
      finalUrl: result.finalUrl,
      httpStatus: result.httpStatus,
      normalizedUrl: job.normalizedUrl,
      redirectChain: result.redirectChain,
    }
    const artifacts = await storeUrlAcquisitionArtifacts(
      corpus.id,
      source,
      result.body,
      result.contentType,
      result.normalizedText,
      report,
    )

    state.sourceContents.set(source.id, result.body)
    source.finalUri = result.finalUrl
    source.canonicalUri = result.canonicalUrl
    source.mimeType = result.contentType
    source.checksum = sourceChecksum
    source.status = "pending"
    source.errorDetail = null
    source.updatedAt = now()
    if (!source.metadata.titleProvided && result.title) {
      source.title = result.title.slice(0, 240)
    }
    source.metadata = {
      ...source.metadata,
      acquisition: {
        ...recordValue(source.metadata.acquisition),
        completedAt: source.updatedAt,
        jobId: job.id,
        status: "succeeded",
      },
      artifacts: {
        ...(artifactMetadataFor(source) ?? {}),
        ...artifactMetadataForInputs(artifacts),
      },
      fetchReport: report,
      fetchedAt: source.updatedAt,
      redirectChain: result.redirectChain,
    }

    await completeUrlAcquisitionJob(actor, {
      artifacts,
      checksum: sourceChecksum,
      contentType: result.contentType,
      finalUrl: result.finalUrl,
      canonicalUrl: result.canonicalUrl,
      httpStatus: result.httpStatus,
      job,
      redirectChain: result.redirectChain,
      sizeBytes: result.body.length,
      source,
      status: "succeeded",
    })
  } catch (error) {
    const status = urlAcquisitionFailureStatus(error)
    const errorDetail =
      error instanceof Error ? error.message : "URL acquisition failed."
    source.status = status === "blocked" ? "blocked" : "failed"
    source.errorDetail = errorDetail
    source.updatedAt = now()
    source.metadata = {
      ...source.metadata,
      acquisition: {
        ...recordValue(source.metadata.acquisition),
        completedAt: source.updatedAt,
        errorCode: acquisitionErrorCode(error),
        status,
      },
    }
    await completeUrlAcquisitionJob(actor, {
      errorCode: acquisitionErrorCode(error),
      errorDetail,
      job,
      source,
      status,
    })
  }
}

async function completeUrlAcquisitionJob(
  actor: Actor,
  input: {
    artifacts?: KnowledgeSourceArtifactInput[]
    canonicalUrl?: string | null
    checksum?: string
    contentType?: string
    errorCode?: string
    errorDetail?: string
    finalUrl?: string
    httpStatus?: number
    job: KnowledgeUrlAcquisitionJob
    redirectChain?: string[]
    sizeBytes?: number
    source?: KnowledgeSource
    status: KnowledgeUrlAcquisitionJob["status"]
  },
): Promise<void> {
  const timestamp = now()
  Object.assign(input.job, {
    canonicalUrl: input.canonicalUrl ?? input.job.canonicalUrl,
    checksum: input.checksum ?? input.job.checksum,
    completedAt:
      input.status === "succeeded" ||
      input.status === "failed" ||
      input.status === "blocked"
        ? timestamp
        : input.job.completedAt,
    contentType: input.contentType ?? input.job.contentType,
    errorCode: input.errorCode ?? null,
    errorDetail: input.errorDetail ?? null,
    finalUrl: input.finalUrl ?? input.job.finalUrl,
    httpStatus: input.httpStatus ?? input.job.httpStatus,
    redirectChain: input.redirectChain ?? input.job.redirectChain,
    sizeBytes: input.sizeBytes ?? input.job.sizeBytes,
    status: input.status,
    updatedAt: timestamp,
  })
  upsertUrlAcquisitionJobState(input.job)

  if (input.source) {
    await persistSourceWithArtifacts(actor, input.source, input.artifacts ?? [])
  }
  await persistUrlAcquisitionJob(actor, input.job)

  await emitAudit({
    actorId: actor.subject,
    action:
      input.status === "succeeded"
        ? "knowledge.url_acquisition.succeeded"
        : "knowledge.url_acquisition.failed",
    targetType: "knowledge.source",
    targetId: input.job.sourceId,
    metadata: {
      adapter: input.job.adapter,
      corpusId: input.job.corpusId,
      errorCode: input.errorCode,
      finalUrl: input.finalUrl,
      jobId: input.job.id,
      sourceId: input.job.sourceId,
      status: input.status,
    },
  })
}

function duplicateFinalUrlExists(
  corpusId: string,
  sourceId: string,
  result: { canonicalUrl: string | null; finalUrl: string },
): boolean {
  const keys = new Set(
    [result.finalUrl, result.canonicalUrl].filter(
      (value): value is string => typeof value === "string",
    ),
  )
  return sourcesFor(corpusId).some((source) => {
    if (source.id === sourceId || source.sourceType !== "url") {
      return false
    }
    const key = sourceUrlKey(source)
    return key !== null && keys.has(key)
  })
}

function artifactMetadataForInputs(
  artifacts: KnowledgeSourceArtifactInput[],
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  for (const artifact of artifacts) {
    metadata[`${artifact.artifactType}ObjectKey`] = artifact.object.objectKey
    metadata[`${artifact.artifactType}Object`] = toPublicKnowledgeObjectRef(
      artifact.object,
    )
  }
  return metadata
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function urlAcquisitionFailureStatus(
  error: unknown,
): Extract<KnowledgeUrlAcquisitionJob["status"], "blocked" | "failed"> {
  const code = acquisitionErrorCode(error)
  if (code === "url_policy_blocked" || code === "duplicate_final_url") {
    return "blocked"
  }
  const detail = error instanceof Error ? error.message.toLowerCase() : ""
  return detail.includes("blocked") ||
    detail.includes("private") ||
    detail.includes("loopback") ||
    detail.includes("link-local") ||
    detail.includes("credentials")
    ? "blocked"
    : "failed"
}

function upsertUrlAcquisitionJobState(job: KnowledgeUrlAcquisitionJob): void {
  const index = state.urlAcquisitionJobs.findIndex(
    (candidate) => candidate.id === job.id,
  )
  const clone = JSON.parse(JSON.stringify(job)) as KnowledgeUrlAcquisitionJob
  if (index >= 0) {
    state.urlAcquisitionJobs[index] = clone
    return
  }
  state.urlAcquisitionJobs.push(clone)
}

function urlAcquisitionJobStaleBefore(timestamp: string): string {
  const staleAfterMs = positiveIntFromEnv(
    "KNOWLEDGE_URL_WORKER_STALE_AFTER_MS",
    DEFAULT_URL_ACQUISITION_JOB_STALE_AFTER_MS,
  )
  return new Date(Date.parse(timestamp) - staleAfterMs).toISOString()
}

function staleRunningUrlAcquisitionJob(
  job: KnowledgeUrlAcquisitionJob,
  staleBefore: string,
): boolean {
  return (
    job.status === "running" &&
    typeof job.lockedAt === "string" &&
    Date.parse(job.lockedAt) < Date.parse(staleBefore)
  )
}

function retryScraperForSource(source: KnowledgeSource): KnowledgeUrlScraper {
  const acquisition = recordValue(source.metadata.acquisition)
  return acquisition.adapter === "firecrawl" ? "firecrawl" : "safe_fetch"
}

async function persistSourceWithArtifacts(
  actor: Actor,
  source: KnowledgeSource,
  artifacts: KnowledgeSourceArtifactInput[],
): Promise<void> {
  const repository = getKnowledgeDurableRepository()
  if (!repository) {
    return
  }
  await upsertActorUser(actor)
  await repository.saveSource(source, artifacts)
}

function systemUrlAcquisitionActor(): Actor {
  return {
    authMode: "service-forwarded",
    persona: "admin",
    roles: ["admin"],
    subject: "system:knowledge-url-acquisition",
  }
}

function validateUploadInput(
  input: AddKnowledgeUploadSourceRequest,
): { ok: true; body: Buffer } | { ok: false; detail: string } {
  const fileName = input.fileName.trim()
  if (
    fileName.length === 0 ||
    fileName.length > MAX_UPLOAD_FILE_NAME_LENGTH ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    hasControlCharacter(fileName)
  ) {
    return {
      ok: false,
      detail:
        "Uploaded source filename must be a simple filename under 240 characters.",
    }
  }

  const extension = uploadExtension(fileName)
  const mimeType = input.mimeType.trim().toLowerCase()
  if (!extension || !uploadFormatAllowed(extension, mimeType)) {
    return {
      ok: false,
      detail:
        "Uploaded source format is not supported or does not match its MIME type.",
    }
  }

  const base64 = input.contentBase64
  if (!isStrictBase64(base64)) {
    return {
      ok: false,
      detail: "Uploaded source content must be strict base64.",
    }
  }
  if (decodedBase64Length(base64) > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      detail: "Uploaded source content exceeds the 50 MiB limit.",
    }
  }
  const body = Buffer.from(base64, "base64")
  if (body.toString("base64") !== base64) {
    return {
      ok: false,
      detail: "Uploaded source content must be strict base64.",
    }
  }
  return { ok: true, body }
}

function uploadExtension(fileName: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(fileName)
  return match?.[1]?.toLowerCase() ?? null
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32)
}

function uploadFormatAllowed(extension: string, mimeType: string): boolean {
  return ALLOWED_UPLOAD_FORMATS.some(
    (format) =>
      (format.extensions as readonly string[]).includes(extension) &&
      (format.mimeTypes as readonly string[]).includes(mimeType),
  )
}

function isStrictBase64(value: string): boolean {
  return (
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(value) &&
    !/=.+?=/.test(value)
  )
}

function decodedBase64Length(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0
  return (value.length / 4) * 3 - padding
}

export async function startKnowledgeIngestion(
  actor: Actor,
  corpusId: string,
): Promise<KnowledgeMutationResult> {
  await ensureDurableStateHydrated()
  const corpus = findCorpus(corpusId)
  if (!corpus) {
    return { status: "not_found", detail: "Corpus not found." }
  }
  if (sourcesFor(corpus.id).length === 0) {
    return {
      status: "invalid",
      detail: "At least one source is required before ingestion.",
    }
  }

  const timestamp = now()
  const snapshotId = randomUUID()
  const sources = sourcesFor(corpus.id)
  const fetchingSource = sources.find((source) => source.status === "fetching")
  if (fetchingSource) {
    return {
      status: "invalid",
      detail: "URL acquisition is still running for at least one source.",
    }
  }
  let chunkCount = 0
  let failedSourceCount = 0
  const sourceWarnings: Record<string, string[]> = {}
  const sampleCitations: Array<Record<string, unknown>> = []
  const snapshotChunks: KnowledgeChunkRecord[] = []
  const sourceArtifacts = new Map<string, KnowledgeSourceArtifactInput[]>()

  for (const source of sources) {
    const content = await sourceContentForIngestion(source)
    if (!content) {
      source.status = "failed"
      source.errorDetail = "Source content is unavailable for ingestion."
      source.updatedAt = timestamp
      failedSourceCount += 1
      continue
    }

    try {
      const result = await ingestKnowledgeSourceContent({
        corpusId: corpus.id,
        snapshotId,
        source,
        content,
      })
      const normalizedArtifacts = await storeNormalizedArtifacts(
        corpus.id,
        source,
        snapshotId,
        result.extraction.artifacts,
      )
      if (normalizedArtifacts.length > 0) {
        sourceArtifacts.set(source.id, normalizedArtifacts)
      }
      source.status = "ready"
      source.language = result.extraction.language
      source.metadata = {
        ...source.metadata,
        artifacts: {
          ...(artifactMetadataFor(source) ?? {}),
          ...normalizedArtifactMetadata(
            corpus.id,
            source,
            snapshotId,
            normalizedArtifacts,
          ),
        },
        extraction: {
          ...result.extraction.metadata,
          normalizedArtifactCount: result.extraction.artifacts.length,
        },
        warnings: result.extraction.warnings,
      }
      source.errorDetail = null
      source.updatedAt = timestamp
      chunkCount += result.chunks.length
      snapshotChunks.push(...result.chunks)
      for (const chunk of result.chunks) {
        if (sampleCitations.length >= 5) {
          break
        }
        sampleCitations.push({
          checksum: chunk.checksum,
          image_region: chunk.imageRegion,
          page_number: chunk.pageNumber,
          row_range: chunk.rowRange,
          source_id: source.id,
          source_type: source.sourceType,
          title: source.title,
          uri: chunk.uri,
        })
      }
      if (result.extraction.warnings.length > 0) {
        sourceWarnings[source.id] = result.extraction.warnings
      }
    } catch (error) {
      source.status = "failed"
      source.errorDetail =
        error instanceof Error ? error.message : "Extraction failed."
      source.updatedAt = timestamp
      failedSourceCount += 1
    }
  }

  const job: KnowledgeIngestionJob = {
    id: randomUUID(),
    corpusId,
    sourceId: null,
    jobType: "ingest",
    status: chunkCount > 0 ? "succeeded" : "failed",
    progressPercent: 100,
    metrics: {
      chunkCount,
      failedSourceCount,
      mode: "in_memory_worker",
      sourceCount: sources.length,
    },
    errorDetail:
      chunkCount > 0
        ? null
        : "Ingestion failed for every source or produced no chunks.",
    retryCount: 0,
    createdBy: actor.subject,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const snapshot: KnowledgeSnapshot | null =
    chunkCount > 0
      ? {
          id: snapshotId,
          corpusId,
          version: nextSnapshotVersion(corpusId),
          status: "staged",
          sourceCount: sources.length,
          chunkCount,
          metadata: {
            failedSourceCount,
            ingestionJobId: job.id,
            sampleCitations,
            sourceWarnings,
          },
          publishedBy: null,
          publishedAt: null,
          createdAt: timestamp,
        }
      : null

  state.jobs.push(job)
  if (snapshot) {
    state.snapshots.push(snapshot)
  }
  updateCorpus(corpus, actor, {
    publishedSnapshotId: snapshot ? null : corpus.publishedSnapshotId,
    status: snapshot
      ? "staged"
      : corpus.publishedSnapshotId
        ? "published"
        : "failed",
    sourceCount: sources.length,
    chunkCount: snapshot?.chunkCount ?? corpus.chunkCount,
  })
  await persistIngestionState(
    actor,
    corpus,
    sources,
    job,
    snapshot,
    sourceArtifacts,
  )
  if (snapshot) {
    await persistSnapshotChunks(snapshot.id, snapshotChunks)
    await storeKnowledgeChunkEmbeddings(actor, snapshotChunks)
  }

  await emitAudit({
    actorId: actor.subject,
    action: "knowledge.ingest.started",
    targetType: "knowledge.corpus",
    targetId: corpus.id,
    metadata: {
      jobId: job.id,
      failedSourceCount,
      snapshotId: snapshot?.id ?? null,
      chunkCount,
      sourceCount: sources.length,
    },
  })

  return { status: "ok", response: { corpus, job, snapshot } }
}

export async function publishKnowledgeSnapshot(
  actor: Actor,
  corpusId: string,
  snapshotId: string,
): Promise<KnowledgeMutationResult> {
  await ensureDurableStateHydrated()
  const corpus = findCorpus(corpusId)
  const snapshot = findSnapshot(corpusId, snapshotId)
  if (!corpus || !snapshot) {
    return { status: "not_found", detail: "Corpus snapshot not found." }
  }
  if (snapshot.status !== "staged") {
    return { status: "invalid", detail: "Only staged snapshots can publish." }
  }
  const unreadySource = sourcesFor(corpus.id).find(sourceBlocksSnapshotPublish)
  if (unreadySource) {
    return {
      status: "invalid",
      detail:
        "All sources must finish acquisition and ingestion before publishing.",
    }
  }

  const timestamp = now()
  snapshot.status = "published"
  snapshot.publishedBy = actor.subject
  snapshot.publishedAt = timestamp
  updateCorpus(corpus, actor, {
    status: "published",
    publishedSnapshotId: snapshot.id,
    sourceCount: snapshot.sourceCount,
    chunkCount: snapshot.chunkCount,
  })

  await emitAudit({
    actorId: actor.subject,
    action: "knowledge.snapshot.published",
    targetType: "knowledge.snapshot",
    targetId: snapshot.id,
    metadata: {
      corpusId: corpus.id,
      version: snapshot.version,
    },
  })
  await persistSnapshot(actor, snapshot)
  await persistCorpus(actor, corpus)

  return { status: "ok", response: { corpus, snapshot } }
}

export async function discardKnowledgeSnapshot(
  actor: Actor,
  corpusId: string,
  snapshotId: string,
): Promise<KnowledgeMutationResult> {
  await ensureDurableStateHydrated()
  const corpus = findCorpus(corpusId)
  const snapshot = findSnapshot(corpusId, snapshotId)
  if (!corpus || !snapshot) {
    return { status: "not_found", detail: "Corpus snapshot not found." }
  }
  if (snapshot.status !== "staged") {
    return { status: "invalid", detail: "Only staged snapshots can discard." }
  }

  snapshot.status = "discarded"
  updateCorpus(corpus, actor, { status: "draft" })
  await persistSnapshot(actor, snapshot)
  await persistCorpus(actor, corpus)
  await emitAudit({
    actorId: actor.subject,
    action: "knowledge.snapshot.discarded",
    targetType: "knowledge.snapshot",
    targetId: snapshot.id,
    metadata: { corpusId: corpus.id },
  })

  return { status: "ok", response: { corpus, snapshot } }
}

export async function retryKnowledgeSource(
  actor: Actor,
  corpusId: string,
  sourceId: string,
): Promise<KnowledgeMutationResult> {
  await ensureDurableStateHydrated()
  const corpus = findCorpus(corpusId)
  const source = findSource(corpusId, sourceId)
  if (!corpus || !source) {
    return { status: "not_found", detail: "Corpus source not found." }
  }

  if (source.sourceType === "url") {
    return retryKnowledgeUrlSource(actor, corpus, source)
  }

  source.status = "pending"
  source.errorDetail = null
  source.updatedAt = now()
  const job = createJob(actor, corpus.id, source.id, "retry_source")
  await persistCorpus(actor, corpus)
  await persistSource(actor, source)
  await persistJob(actor, job)
  await emitAudit({
    actorId: actor.subject,
    action: "knowledge.ingest.started",
    targetType: "knowledge.source",
    targetId: source.id,
    metadata: { corpusId: corpus.id, jobId: job.id },
  })

  return { status: "ok", response: { corpus, source, job } }
}

async function retryKnowledgeUrlSource(
  actor: Actor,
  corpus: KnowledgeCorpus,
  source: KnowledgeSource,
): Promise<KnowledgeMutationResult> {
  if (source.status !== "failed") {
    return {
      status: "invalid",
      detail: "Only failed URL sources can be retried.",
    }
  }
  const retryUrl = source.originalUri ?? source.finalUri
  if (!retryUrl) {
    return {
      status: "invalid",
      detail: "URL source does not have a retryable URL.",
    }
  }
  const urlValidation = validateKnowledgeUrl(retryUrl)
  if (!urlValidation.ok) {
    return {
      status: "invalid",
      detail: urlValidation.detail ?? "URL is invalid.",
    }
  }
  const normalizedUrl = normalizedKnowledgeUrlKey(urlValidation.url)
  const scraper = retryScraperForSource(source)
  if (scraper === "firecrawl" && !knowledgeFirecrawlEnabled()) {
    return { status: "invalid", detail: "Firecrawl URL ingestion is disabled." }
  }
  const policyDecision = await evaluateAdminUrlPolicyForScope(
    normalizedUrl,
    "knowledge_ingestion",
  )
  if (policyDecision.status === "blocked") {
    return { status: "invalid", detail: policyDecision.detail }
  }

  const timestamp = now()
  const acquisitionMetadata = recordValue(source.metadata.acquisition)
  const acquisitionJob: KnowledgeUrlAcquisitionJob = {
    adapter: scraper,
    attempts: 0,
    canonicalUrl: null,
    checksum: null,
    completedAt: null,
    contentType: null,
    corpusId: corpus.id,
    createdAt: timestamp,
    createdBy: actor.subject,
    errorCode: null,
    errorDetail: null,
    finalUrl: null,
    httpStatus: null,
    id: randomUUID(),
    lockedAt: null,
    lockedBy: null,
    normalizedUrl,
    policyMetadata: {
      matchedRuleIds: policyDecision.matchedRuleIds,
      mode: policyDecision.mode,
      scope: "knowledge_ingestion",
    },
    redirectChain: [],
    requestedUrl: retryUrl,
    sizeBytes: null,
    sourceId: source.id,
    status: "queued",
    updatedAt: timestamp,
  }
  state.urlAcquisitionJobs.push(acquisitionJob)

  source.status = "fetching"
  source.errorDetail = null
  source.finalUri = normalizedUrl
  source.canonicalUri = null
  source.updatedAt = timestamp
  source.metadata = {
    ...source.metadata,
    acquisition: {
      ...acquisitionMetadata,
      adapter: scraper,
      jobId: acquisitionJob.id,
      mode: "single_page",
      retriedAt: timestamp,
      status: "queued",
    },
    redirectChain: [],
    urlPolicy: {
      matchedRuleIds: policyDecision.matchedRuleIds,
      mode: policyDecision.mode,
      scope: "knowledge_ingestion",
    },
  }

  await persistCorpus(actor, corpus)
  await persistSource(actor, source)
  await persistUrlAcquisitionJob(actor, acquisitionJob)
  await emitAudit({
    actorId: actor.subject,
    action: "knowledge.url_acquisition.retry_queued",
    targetType: "knowledge.source",
    targetId: source.id,
    metadata: {
      corpusId: corpus.id,
      jobId: acquisitionJob.id,
      scraper,
      sourceId: source.id,
      url: normalizedUrl,
    },
  })

  return { status: "ok", response: { corpus, source } }
}

export async function refreshKnowledgeCorpus(
  actor: Actor,
  corpusId: string,
): Promise<KnowledgeMutationResult> {
  await ensureDurableStateHydrated()
  const corpus = findCorpus(corpusId)
  if (!corpus) {
    return { status: "not_found", detail: "Corpus not found." }
  }
  const job = createJob(actor, corpus.id, null, "refresh")
  updateCorpus(corpus, actor, { status: "refreshing" })
  await persistCorpus(actor, corpus)
  await persistJob(actor, job)
  await emitAudit({
    actorId: actor.subject,
    action: "knowledge.refresh.started",
    targetType: "knowledge.corpus",
    targetId: corpus.id,
    metadata: { jobId: job.id },
  })

  return { status: "ok", response: { corpus, job } }
}

export async function updateKnowledgeCorpusAccess(
  actor: Actor,
  corpusId: string,
  input: UpdateKnowledgeCorpusAccessRequest,
): Promise<KnowledgeMutationResult> {
  await ensureDurableStateHydrated()
  const corpus = findCorpus(corpusId)
  if (!corpus) {
    return { status: "not_found", detail: "Corpus not found." }
  }

  updateCorpus(corpus, actor, {
    accessGroups: normalizeAccessGroups(input.accessGroups),
  })
  await persistCorpus(actor, corpus)
  await emitAudit({
    actorId: actor.subject,
    action: "knowledge.corpus.access_updated",
    targetType: "knowledge.corpus",
    targetId: corpus.id,
    metadata: {
      accessGroupCount: corpus.accessGroups.length,
      accessGroups: corpus.accessGroups,
    },
  })

  return { status: "ok", response: { corpus } }
}

export async function knowledgeUnlocksForAccessGroup(
  groupName: string,
): Promise<AdminTeamGroupUnlock[]> {
  await ensureDurableStateHydrated()
  return state.corpora
    .filter((corpus) => corpus.status !== "deleted")
    .filter((corpus) => corpusMatchesAccessGroup(corpus, groupName))
    .map((corpus) => ({
      href: `/knowledge?corpus=${encodeURIComponent(corpus.id)}`,
      id: corpus.id,
      name: corpus.name,
      type: "corpus" as const,
    }))
}

export async function renameKnowledgeAccessGroup(
  actor: Actor,
  oldName: string,
  newName: string,
): Promise<number> {
  await ensureDurableStateHydrated()
  let changedCount = 0
  for (const corpus of state.corpora) {
    const nextGroups = renameAccessGroup(corpus.accessGroups, oldName, newName)
    if (sameAccessGroups(corpus.accessGroups, nextGroups)) {
      continue
    }
    updateCorpus(corpus, actor, { accessGroups: nextGroups })
    await persistCorpus(actor, corpus)
    changedCount += 1
  }
  if (changedCount > 0) {
    await emitAudit({
      actorId: actor.subject,
      action: "knowledge.corpus.access_group_renamed",
      targetType: "knowledge.corpus",
      targetId: oldName,
      metadata: {
        changedCount,
        newName,
        oldName,
      },
    })
  }
  return changedCount
}

export async function disableKnowledgeCorpus(
  actor: Actor,
  corpusId: string,
): Promise<KnowledgeMutationResult> {
  return transitionCorpus(
    actor,
    corpusId,
    "disabled",
    "knowledge.corpus.disabled",
  )
}

export async function archiveKnowledgeCorpus(
  actor: Actor,
  corpusId: string,
): Promise<KnowledgeMutationResult> {
  return transitionCorpus(
    actor,
    corpusId,
    "archived",
    "knowledge.corpus.archived",
  )
}

export async function hardDeleteKnowledgeCorpus(
  actor: Actor,
  corpusId: string,
  input: HardDeleteKnowledgeCorpusRequest,
): Promise<KnowledgeMutationResult> {
  await ensureDurableStateHydrated()
  const corpus = findCorpus(corpusId)
  if (!corpus) {
    return { status: "not_found", detail: "Corpus not found." }
  }
  if (input.confirmation !== "DELETE") {
    return {
      status: "invalid",
      detail: "Corpus hard delete requires DELETE confirmation.",
    }
  }

  const sources = sourcesFor(corpus.id)
  const sourceIds = sources.map((source) => source.id)
  const objectKeys = objectKeysForSources(sources)
  const memoryRemovedChunkCount = removeKnowledgeChunksForSources(sourceIds)
  const durableRemoval = await removeDurableSources(sourceIds)
  const allObjectKeys = Array.from(
    new Set([...objectKeys, ...durableRemoval.objectKeys]),
  )
  await deleteKnowledgeObjects(allObjectKeys)
  removeSourcesFromState(sourceIds)
  for (const sourceId of sourceIds) {
    state.sourceContents.delete(sourceId)
  }
  updateCorpus(corpus, actor, {
    chunkCount: 0,
    publishedSnapshotId: null,
    sourceCount: 0,
    status: "deleted",
  })
  await persistCorpus(actor, corpus)
  await emitAudit({
    actorId: actor.subject,
    action: "knowledge.corpus.hard_deleted",
    targetType: "knowledge.corpus",
    targetId: corpus.id,
    metadata: {
      removedChunkCount: Math.max(
        memoryRemovedChunkCount,
        durableRemoval.removedChunkCount,
      ),
      sourceCount: sourceIds.length,
      sourceIds,
    },
  })

  return {
    status: "ok",
    response: {
      corpus,
      hardDeletedCorpusId: corpus.id,
      hardDeletedSourceIds: sourceIds,
      sourceIds,
    },
  }
}

export async function bulkApplyKnowledgeSourceAction(
  actor: Actor,
  corpusId: string,
  input: KnowledgeSourceBulkActionRequest,
): Promise<KnowledgeMutationResult> {
  await ensureDurableStateHydrated()
  const corpus = findCorpus(corpusId)
  if (!corpus) {
    return { status: "not_found", detail: "Corpus not found." }
  }

  const sourceIds = Array.from(new Set(input.sourceIds))
  const sources = sourceIds
    .map((sourceId) => findSource(corpus.id, sourceId))
    .filter((source): source is KnowledgeSource => Boolean(source))
  if (sources.length !== sourceIds.length) {
    return { status: "not_found", detail: "Corpus source not found." }
  }
  if (input.action === "hard_delete" && input.confirmation !== "DELETE") {
    return {
      status: "invalid",
      detail: "Hard delete requires DELETE confirmation.",
    }
  }

  const timestamp = now()
  if (input.action === "disable") {
    for (const source of sources) {
      source.status = "disabled"
      source.updatedAt = timestamp
      await persistSource(actor, source)
    }
    await emitAudit({
      actorId: actor.subject,
      action: "knowledge.source.disabled",
      targetType: "knowledge.source",
      targetId: corpus.id,
      metadata: {
        corpusId: corpus.id,
        sourceCount: sourceIds.length,
        sourceIds,
      },
    })
    return {
      status: "ok",
      response: { corpus, sourceIds },
    }
  }

  const objectKeys = objectKeysForSources(sources)
  if (input.action === "archive") {
    await persistArchivedSources(actor, sources, timestamp)
  } else {
    await deleteKnowledgeObjects(objectKeys)
  }

  const memoryRemovedChunkCount = removeKnowledgeChunksForSources(sourceIds)
  const durableRemoval = await removeDurableSources(sourceIds)
  const removedChunkCount = Math.max(
    memoryRemovedChunkCount,
    durableRemoval.removedChunkCount,
  )
  const allObjectKeys = Array.from(
    new Set([...objectKeys, ...durableRemoval.objectKeys]),
  )
  if (input.action === "hard_delete") {
    await deleteKnowledgeObjects(
      allObjectKeys.filter((key) => !objectKeys.includes(key)),
    )
  }

  removeSourcesFromState(sourceIds)
  for (const sourceId of sourceIds) {
    state.sourceContents.delete(sourceId)
  }
  updateCorpus(corpus, actor, {
    chunkCount: Math.max(0, corpus.chunkCount - removedChunkCount),
    sourceCount: sourcesFor(corpus.id).length,
  })
  await persistCorpus(actor, corpus)

  const action =
    input.action === "archive"
      ? "knowledge.source.archived"
      : "knowledge.source.hard_deleted"
  await emitAudit({
    actorId: actor.subject,
    action,
    targetType: "knowledge.source",
    targetId: corpus.id,
    metadata: {
      corpusId: corpus.id,
      sourceCount: sourceIds.length,
      sourceIds,
    },
  })

  return {
    status: "ok",
    response:
      input.action === "archive"
        ? { archivedSourceIds: sourceIds, corpus, sourceIds }
        : { corpus, hardDeletedSourceIds: sourceIds, sourceIds },
  }
}

export async function bulkApplyKnowledgeArchiveSourceAction(
  actor: Actor,
  input: KnowledgeArchiveSourceBulkActionRequest,
): Promise<KnowledgeMutationResult> {
  await ensureDurableStateHydrated()
  const repository = getKnowledgeDurableRepository()
  if (!repository) {
    return { status: "not_found", detail: "Knowledge archive not found." }
  }

  const archiveIds = Array.from(new Set(input.archivedSourceIds))
  const archivedSources = await repository.listArchivedSources()
  const selectedSources = archiveIds
    .map((archiveId) =>
      archivedSources.find((source) => source.id === archiveId),
    )
    .filter((source): source is KnowledgeArchivedSource => Boolean(source))
  if (selectedSources.length !== archiveIds.length) {
    return { status: "not_found", detail: "Archived source not found." }
  }
  if (input.action === "hard_delete" && input.confirmation !== "DELETE") {
    return {
      status: "invalid",
      detail: "Archived source hard delete requires DELETE confirmation.",
    }
  }

  if (input.action === "restore") {
    const restoredSources = await repository.restoreArchivedSources(archiveIds)
    const restoredSourceIds = restoredSources.map((source) => source.id)
    for (const source of restoredSources) {
      const existingIndex = state.sources.findIndex(
        (current) => current.id === source.id,
      )
      if (existingIndex >= 0) {
        state.sources[existingIndex] = source
      } else {
        state.sources.push(source)
      }
      const corpus = findCorpus(source.corpusId)
      if (corpus) {
        updateCorpus(corpus, actor, {
          sourceCount: sourcesFor(corpus.id).length,
        })
        await persistCorpus(actor, corpus)
      }
    }
    await emitAudit({
      actorId: actor.subject,
      action: "knowledge.source.restored",
      targetType: "knowledge.source",
      targetId: restoredSourceIds[0] ?? "unknown",
      metadata: {
        archiveIds,
        sourceCount: restoredSourceIds.length,
        sourceIds: restoredSourceIds,
      },
    })

    return {
      status: "ok",
      response: {
        corpus: primaryCorpusForArchivedSources(selectedSources),
        restoredSourceIds,
        sourceIds: restoredSourceIds,
      },
    }
  }

  const objectKeys = objectKeysForArchivedSources(selectedSources)
  await deleteKnowledgeObjects(objectKeys)
  await repository.deleteArchivedSources(archiveIds)
  await emitAudit({
    actorId: actor.subject,
    action: "knowledge.archive.source.hard_deleted",
    targetType: "knowledge.source",
    targetId: selectedSources[0]?.sourceId ?? "unknown",
    metadata: {
      archiveIds,
      sourceCount: selectedSources.length,
      sourceIds: selectedSources.map((source) => source.sourceId),
    },
  })

  return {
    status: "ok",
    response: {
      corpus: primaryCorpusForArchivedSources(selectedSources),
      hardDeletedArchivedSourceIds: archiveIds,
      sourceIds: selectedSources.map((source) => source.sourceId),
    },
  }
}

export async function testKnowledgeRetrieval(
  _actor: Actor,
  query: KnowledgeQueryRequest,
): Promise<KnowledgeQueryResult> {
  await ensureDurableStateHydrated()
  const publishedCorpusIds = state.corpora
    .filter((corpus) => corpus.status === "published")
    .map((corpus) => corpus.id)
  const allowedSourceIds = state.sources
    .filter((source) => source.status === "ready")
    .map((source) => source.id)
  return searchKnowledgeChunks(query, {
    allowedCorpusIds: publishedCorpusIds,
    allowedSourceIds,
    snapshots: state.snapshots,
  })
}

interface RuntimeCorpusSelection {
  corpusIds: string[]
  hasExplicitCorpusFilter: boolean
  selectedCorpora: GovernedCorpusSummary[]
  unresolvedCorpora: GovernedCorpusResolution[]
  warnings: string[]
}

export async function listAccessibleGovernedCorpora(
  actor: Actor,
  input: { language?: string; limit?: number; query?: string } = {},
): Promise<{ corpora: GovernedCorpusSummary[]; generatedAt: string }> {
  const dbCorpora = await listAccessibleGovernedCorporaFromDb(actor, input)
  if (dbCorpora) {
    return { corpora: dbCorpora, generatedAt: now() }
  }

  await ensureDurableStateHydrated()
  const sourceRows = state.sources.filter((source) => source.status === "ready")
  const corpora = state.corpora
    .filter((corpus) => corpus.status === "published")
    .filter((corpus) => corpusAllowedForActor(corpus, actor))
    .map((corpus) =>
      governedCorpusSummary(
        corpus,
        sourceRows.filter((source) => source.corpusId === corpus.id),
      ),
    )
    .filter((corpus) => governedCorpusMatches(corpus, input, sourceRows))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, boundedLimit(input.limit))

  return { corpora, generatedAt: now() }
}

export async function resolveGovernedCorpus(
  actor: Actor,
  input: { limit?: number; reference: string },
): Promise<GovernedCorpusResolution> {
  const reference = input.reference.trim()
  if (!reference) {
    return { candidates: [], query: reference, status: "not_found" }
  }
  const { corpora } = await listAccessibleGovernedCorpora(actor, {
    limit: 100,
  })
  const candidates = corpora
    .map((corpus) => corpusResolveCandidate(corpus, reference))
    .filter(
      (candidate): candidate is GovernedCorpusResolveCandidate =>
        candidate !== null,
    )
    .sort(resolveCandidateSort)
    .slice(0, boundedLimit(input.limit))

  if (candidates.length === 0) {
    return { candidates: [], query: reference, status: "not_found" }
  }
  return {
    candidates,
    query: reference,
    status: candidates.length === 1 ? "resolved" : "ambiguous",
  }
}

export async function getGovernedCorpusManifest(
  actor: Actor,
  corpusId: string,
): Promise<GovernedCorpusManifest | null> {
  const dbManifest = await getGovernedCorpusManifestFromDb(actor, corpusId)
  if (dbManifest) {
    return dbManifest
  }

  await ensureDurableStateHydrated()
  const corpus = state.corpora.find(
    (item) =>
      item.id === corpusId &&
      item.status === "published" &&
      corpusAllowedForActor(item, actor),
  )
  if (!corpus) {
    return null
  }
  const sources = state.sources
    .filter((source) => source.corpusId === corpus.id)
    .filter((source) => source.status === "ready")
  const snapshot = state.snapshots.find(
    (item) => item.id === corpus.publishedSnapshotId,
  )
  return {
    corpus: governedCorpusSummary(corpus, sources),
    publishedSnapshot: snapshot
      ? {
          id: snapshot.id,
          version: snapshot.version,
        }
      : null,
    retrievalReady: Boolean(snapshot && corpus.chunkCount > 0),
    sources: sources.map((source) => ({
      id: source.id,
      language: source.language,
      sourceType: source.sourceType,
      title: source.title,
    })),
  }
}

export async function queryGovernedKnowledgeRuntime(
  actor: Actor,
  input: GovernedKnowledgeRuntimeQuery,
): Promise<GovernedKnowledgeRuntimeResult> {
  const corpusSelection = await resolveRuntimeCorpusSelection(actor, input)
  if (
    corpusSelection.hasExplicitCorpusFilter &&
    corpusSelection.corpusIds.length === 0
  ) {
    return decorateRuntimeSearchResult(
      {
        citations: [],
        generatedAt: now(),
        query: input.query,
        results: [],
      },
      {
        retrievalMode: "lexical",
        selectedCorpora: corpusSelection.selectedCorpora,
        unresolvedCorpora: corpusSelection.unresolvedCorpora,
        warnings: corpusSelection.warnings,
      },
    )
  }
  const effectiveInput: KnowledgeQueryRequest = {
    corpusIds: corpusSelection.hasExplicitCorpusFilter
      ? corpusSelection.corpusIds
      : input.corpusIds,
    language: input.language,
    query: input.query,
    sourceTypes: input.sourceTypes,
    topK: input.topK,
  }
  const dbResult = await queryGovernedKnowledgeRuntimeFromDb(
    actor,
    effectiveInput,
    corpusSelection,
  )
  if (dbResult) {
    return dbResult
  }

  await ensureDurableStateHydrated()
  const publishedCorpora = state.corpora
    .filter((corpus) => corpus.status === "published")
    .filter((corpus) => corpusAllowedForActor(corpus, actor))
  const allowedCorpusIds = publishedCorpora
    .map((corpus) => corpus.id)
    .filter(
      (corpusId) =>
        !effectiveInput.corpusIds?.length ||
        effectiveInput.corpusIds.includes(corpusId),
    )
  const allowedSourceIds = state.sources
    .filter((source) => allowedCorpusIds.includes(source.corpusId))
    .filter((source) => source.status === "ready")
    .map((source) => source.id)
  const result = searchKnowledgeChunks(
    {
      corpusIds: effectiveInput.corpusIds,
      language: effectiveInput.language,
      query: effectiveInput.query,
      sourceTypes: effectiveInput.sourceTypes,
      topK: effectiveInput.topK,
    },
    {
      allowedCorpusIds,
      allowedSourceIds,
      snapshots: state.snapshots,
    },
  )
  return decorateRuntimeSearchResult(result, {
    retrievalMode: "lexical",
    selectedCorpora: corpusSelection.selectedCorpora,
    unresolvedCorpora: corpusSelection.unresolvedCorpora,
    warnings: corpusSelection.warnings,
  })
}

async function queryGovernedKnowledgeRuntimeFromDb(
  actor: Actor,
  input: KnowledgeQueryRequest,
  corpusSelection: RuntimeCorpusSelection,
): Promise<GovernedKnowledgeRuntimeResult | null> {
  const db = getDb()
  if (!db) {
    return null
  }

  const conditions = [
    eq(knowledgeCorpora.status, "published"),
    eq(knowledgeSnapshots.status, "published"),
    eq(knowledgeCorpora.publishedSnapshotId, knowledgeSnapshots.id),
    eq(knowledgeSources.status, "ready"),
  ]
  if (input.corpusIds?.length) {
    conditions.push(inArray(knowledgeChunks.corpusId, input.corpusIds))
  }
  if (input.language) {
    conditions.push(eq(knowledgeChunks.language, input.language))
  }
  if (input.sourceTypes?.length) {
    conditions.push(inArray(knowledgeSources.sourceType, input.sourceTypes))
  }

  const rows = await db
    .select({
      checksum: knowledgeChunks.checksum,
      chunkCreatedAt: knowledgeChunks.createdAt,
      chunkId: knowledgeChunks.id,
      chunkIndex: knowledgeChunks.chunkIndex,
      content: knowledgeChunks.content,
      corpusDescription: knowledgeCorpora.description,
      corpusId: knowledgeChunks.corpusId,
      corpusName: knowledgeCorpora.name,
      imageRegion: knowledgeChunks.imageRegion,
      language: knowledgeChunks.language,
      pageNumber: knowledgeChunks.pageNumber,
      rowRange: knowledgeChunks.rowRange,
      searchText: knowledgeChunks.searchText,
      sectionPath: knowledgeChunks.sectionPath,
      snapshotId: knowledgeChunks.snapshotId,
      sourceFinalUri: knowledgeSources.finalUri,
      sourceId: knowledgeChunks.sourceId,
      sourceOriginalUri: knowledgeSources.originalUri,
      sourceTitle: knowledgeSources.title,
      sourceType: knowledgeSources.sourceType,
    })
    .from(knowledgeChunks)
    .innerJoin(
      knowledgeCorpora,
      eq(knowledgeChunks.corpusId, knowledgeCorpora.id),
    )
    .innerJoin(
      knowledgeSnapshots,
      eq(knowledgeChunks.snapshotId, knowledgeSnapshots.id),
    )
    .innerJoin(
      knowledgeSources,
      eq(knowledgeChunks.sourceId, knowledgeSources.id),
    )
    .where(and(...conditions))
    .orderBy(knowledgeChunks.createdAt, knowledgeChunks.chunkIndex)

  const corpusIds = [...new Set(rows.map((row) => row.corpusId))]
  const accessGroupRows =
    corpusIds.length > 0
      ? await db
          .select({
            corpusId: knowledgeCorpusAccessGroups.corpusId,
            keycloakGroup: knowledgeCorpusAccessGroups.keycloakGroup,
          })
          .from(knowledgeCorpusAccessGroups)
          .where(inArray(knowledgeCorpusAccessGroups.corpusId, corpusIds))
      : []
  const accessGroupsByCorpus = new Map<string, string[]>()
  for (const row of accessGroupRows) {
    const groups = accessGroupsByCorpus.get(row.corpusId) ?? []
    groups.push(row.keycloakGroup)
    accessGroupsByCorpus.set(row.corpusId, groups)
  }

  const chunks = rows
    .filter((row) =>
      accessGroupsAllowedForActor(
        accessGroupsByCorpus.get(row.corpusId) ?? [],
        actor,
      ),
    )
    .map(
      (row): KnowledgeChunkRecord => ({
        checksum: row.checksum,
        chunkIndex: row.chunkIndex,
        content: row.content,
        corpusId: row.corpusId,
        createdAt: isoDate(row.chunkCreatedAt),
        id: row.chunkId,
        imageRegion: row.imageRegion ?? undefined,
        language: row.language,
        pageNumber: row.pageNumber ?? undefined,
        rowRange: row.rowRange ?? undefined,
        searchText: row.searchText,
        sectionPath: row.sectionPath ?? undefined,
        snapshotId: row.snapshotId,
        sourceId: row.sourceId,
        sourceType: runtimeSourceType(row.sourceType),
        title: row.sourceTitle,
        uri: row.sourceFinalUri ?? row.sourceOriginalUri,
      }),
    )

  const metadataScores = metadataScoresForChunks(
    rows.map((row) => ({
      chunkId: row.chunkId,
      corpusDescription: row.corpusDescription,
      corpusName: row.corpusName,
      sourceTitle: row.sourceTitle,
    })),
    input.query,
  )
  const vectorResult = await scoreKnowledgeChunksByVector({
    actor,
    chunks,
    query: input.query,
    topK: input.topK ?? 5,
  })
  const result = searchKnowledgeChunkRecords(chunks, input, {
    metadataScores,
    vectorScores: vectorResult.scores,
  })
  const warnings = [...corpusSelection.warnings]
  if (vectorResult.warning) {
    warnings.push(vectorResult.warning)
  }
  return decorateRuntimeSearchResult(result, {
    retrievalMode: vectorResult.mode,
    selectedCorpora: corpusSelection.selectedCorpora,
    unresolvedCorpora: corpusSelection.unresolvedCorpora,
    warnings,
  })
}

async function listAccessibleGovernedCorporaFromDb(
  actor: Actor,
  input: { language?: string; limit?: number; query?: string },
): Promise<GovernedCorpusSummary[] | null> {
  const db = getDb()
  if (!db) {
    return null
  }

  const corpusRows = await db
    .select({
      createdAt: knowledgeCorpora.createdAt,
      createdBy: knowledgeCorpora.createdBy,
      description: knowledgeCorpora.description,
      id: knowledgeCorpora.id,
      languageHints: knowledgeCorpora.languageHints,
      name: knowledgeCorpora.name,
      publishedSnapshotId: knowledgeCorpora.publishedSnapshotId,
      status: knowledgeCorpora.status,
      updatedAt: knowledgeCorpora.updatedAt,
      updatedBy: knowledgeCorpora.updatedBy,
    })
    .from(knowledgeCorpora)
    .where(eq(knowledgeCorpora.status, "published"))

  const corpusIds = corpusRows.map((row) => row.id)
  if (corpusIds.length === 0) {
    return []
  }

  const publishedSnapshotIds = corpusRows
    .map((row) => row.publishedSnapshotId)
    .filter((id): id is string => Boolean(id))
  const [sourceRows, accessGroupRows, snapshotRows] = await Promise.all([
    db
      .select({
        corpusId: knowledgeSources.corpusId,
        language: knowledgeSources.language,
        sourceType: knowledgeSources.sourceType,
        status: knowledgeSources.status,
        title: knowledgeSources.title,
      })
      .from(knowledgeSources)
      .where(inArray(knowledgeSources.corpusId, corpusIds)),
    db
      .select({
        corpusId: knowledgeCorpusAccessGroups.corpusId,
        keycloakGroup: knowledgeCorpusAccessGroups.keycloakGroup,
      })
      .from(knowledgeCorpusAccessGroups)
      .where(inArray(knowledgeCorpusAccessGroups.corpusId, corpusIds)),
    publishedSnapshotIds.length > 0
      ? db
          .select({
            chunkCount: knowledgeSnapshots.chunkCount,
            id: knowledgeSnapshots.id,
            sourceCount: knowledgeSnapshots.sourceCount,
          })
          .from(knowledgeSnapshots)
          .where(inArray(knowledgeSnapshots.id, publishedSnapshotIds))
      : [],
  ])
  const accessGroupsByCorpus = accessGroupsByCorpusId(accessGroupRows)
  const sourcesByCorpus = sourcesByCorpusId(
    sourceRows.map((row) => ({
      corpusId: row.corpusId,
      language: row.language,
      sourceType: runtimeSourceType(row.sourceType),
      status: row.status,
      title: row.title,
    })),
  )
  const snapshotsById = new Map(snapshotRows.map((row) => [row.id, row]))

  return corpusRows
    .map(
      (row): KnowledgeCorpus => ({
        accessGroups: accessGroupsByCorpus.get(row.id) ?? [],
        chunkCount:
          snapshotsById.get(row.publishedSnapshotId ?? "")?.chunkCount ?? 0,
        createdAt: isoDate(row.createdAt),
        createdBy: row.createdBy,
        description: row.description,
        id: row.id,
        languageHints: stringList(row.languageHints),
        name: row.name,
        publishedSnapshotId: row.publishedSnapshotId,
        sourceCount:
          snapshotsById.get(row.publishedSnapshotId ?? "")?.sourceCount ??
          (sourcesByCorpus.get(row.id) ?? []).length,
        status: "published",
        updatedAt: isoDate(row.updatedAt),
        updatedBy: row.updatedBy,
      }),
    )
    .filter((corpus) => corpusAllowedForActor(corpus, actor))
    .map((corpus) =>
      governedCorpusSummary(corpus, sourcesByCorpus.get(corpus.id) ?? []),
    )
    .filter((corpus) =>
      governedCorpusMatches(
        corpus,
        input,
        sourcesByCorpus.get(corpus.id) ?? [],
      ),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, boundedLimit(input.limit))
}

async function getGovernedCorpusManifestFromDb(
  actor: Actor,
  corpusId: string,
): Promise<GovernedCorpusManifest | null> {
  const db = getDb()
  if (!db) {
    return null
  }
  const { corpora } = await listAccessibleGovernedCorpora(actor, { limit: 100 })
  const corpus = corpora.find((item) => item.id === corpusId)
  if (!corpus) {
    return null
  }
  const sourceRows = await db
    .select({
      id: knowledgeSources.id,
      language: knowledgeSources.language,
      sourceType: knowledgeSources.sourceType,
      status: knowledgeSources.status,
      title: knowledgeSources.title,
    })
    .from(knowledgeSources)
    .where(eq(knowledgeSources.corpusId, corpusId))
  const snapshotRows = corpus.publishedSnapshotId
    ? await db
        .select({
          id: knowledgeSnapshots.id,
          version: knowledgeSnapshots.version,
        })
        .from(knowledgeSnapshots)
        .where(eq(knowledgeSnapshots.id, corpus.publishedSnapshotId))
    : []
  return {
    corpus,
    publishedSnapshot: snapshotRows[0]
      ? {
          id: snapshotRows[0].id,
          version: snapshotRows[0].version,
        }
      : null,
    retrievalReady: Boolean(
      corpus.publishedSnapshotId && corpus.chunkCount > 0,
    ),
    sources: sourceRows
      .filter((source) => source.status === "ready")
      .map((source) => ({
        id: source.id,
        language: source.language,
        sourceType: runtimeSourceType(source.sourceType),
        title: source.title,
      })),
  }
}

async function resolveRuntimeCorpusSelection(
  actor: Actor,
  input: GovernedKnowledgeRuntimeQuery,
): Promise<RuntimeCorpusSelection> {
  const corpusIds = new Set(input.corpusIds ?? [])
  const hasExplicitCorpusFilter = Boolean(
    input.corpusIds?.length || input.corpusRefs?.length,
  )
  const unresolvedCorpora: GovernedCorpusResolution[] = []
  const warnings: string[] = []

  for (const reference of input.corpusRefs ?? []) {
    const resolution = await resolveGovernedCorpus(actor, { reference })
    if (resolution.status === "resolved") {
      corpusIds.add(resolution.candidates[0].id)
    } else {
      unresolvedCorpora.push(resolution)
      warnings.push(`Corpus reference did not resolve uniquely: ${reference}`)
    }
  }

  const { corpora } = await listAccessibleGovernedCorpora(actor, { limit: 100 })
  const selectedCorpora = hasExplicitCorpusFilter
    ? corpora.filter((corpus) => corpusIds.has(corpus.id))
    : corpora

  return {
    corpusIds: selectedCorpora.map((corpus) => corpus.id),
    hasExplicitCorpusFilter,
    selectedCorpora,
    unresolvedCorpora,
    warnings,
  }
}

function decorateRuntimeSearchResult(
  result: KnowledgeQueryResult,
  options: {
    retrievalMode: KnowledgeRetrievalMode
    selectedCorpora: GovernedCorpusSummary[]
    unresolvedCorpora: GovernedCorpusResolution[]
    warnings: string[]
  },
): GovernedKnowledgeRuntimeResult {
  return {
    ...result,
    noResultReason: noResultReason(result, options),
    retrievalMode: options.retrievalMode,
    selectedCorpora: options.selectedCorpora,
    unresolvedCorpora: options.unresolvedCorpora,
    warnings: options.warnings,
  }
}

function noResultReason(
  result: KnowledgeQueryResult,
  options: {
    selectedCorpora: GovernedCorpusSummary[]
    unresolvedCorpora: GovernedCorpusResolution[]
  },
): string | null {
  if (result.results.length > 0) {
    return null
  }
  if (
    options.unresolvedCorpora.length > 0 &&
    options.selectedCorpora.length === 0
  ) {
    return "Requested corpora were not found, ambiguous, or inaccessible."
  }
  if (options.selectedCorpora.length > 0) {
    return "Selected corpus exists but no matching passages were found."
  }
  return "No published governed corpus passages matched the query."
}

function metadataScoresForChunks(
  rows: Array<{
    chunkId: string
    corpusDescription: string
    corpusName: string
    sourceTitle: string
  }>,
  query: string,
): Map<string, number> {
  const terms = queryTerms(query)
  const scores = new Map<string, number>()
  if (terms.length === 0) {
    return scores
  }
  for (const row of rows) {
    const metadata = [row.corpusName, row.corpusDescription, row.sourceTitle]
      .join(" ")
      .toLowerCase()
    const score = terms.reduce(
      (total, term) => total + (metadata.includes(term) ? 0.35 : 0),
      0,
    )
    if (score > 0) {
      scores.set(row.chunkId, score)
    }
  }
  return scores
}

function governedCorpusSummary(
  corpus: KnowledgeCorpus,
  sources: Array<{
    language: string | null
    sourceType: KnowledgeSourceType
    status: string
    title: string
  }>,
): GovernedCorpusSummary {
  const readySources = sources.filter((source) => source.status === "ready")
  return {
    chunkCount: corpus.chunkCount,
    description: corpus.description,
    id: corpus.id,
    languageHints: corpus.languageHints,
    name: corpus.name,
    publishedSnapshotId: corpus.publishedSnapshotId,
    sourceCount: corpus.sourceCount,
    sourceSummary: sourceSummary(readySources),
    updatedAt: corpus.updatedAt,
  }
}

function governedCorpusMatches(
  corpus: GovernedCorpusSummary,
  input: { language?: string; query?: string },
  sources: Array<{ language: string | null; title: string }>,
): boolean {
  if (
    input.language &&
    !corpus.languageHints.includes(input.language) &&
    !sources.some((source) => source.language === input.language)
  ) {
    return false
  }
  const query = input.query?.trim().toLowerCase()
  if (!query) {
    return true
  }
  return (
    corpus.name.toLowerCase().includes(query) ||
    corpus.description.toLowerCase().includes(query) ||
    sources.some((source) => source.title.toLowerCase().includes(query))
  )
}

function corpusResolveCandidate(
  corpus: GovernedCorpusSummary,
  reference: string,
): GovernedCorpusResolveCandidate | null {
  const normalized = reference.trim().toLowerCase()
  const name = corpus.name.toLowerCase()
  if (corpus.id === reference) {
    return { ...corpus, matchReason: "id" }
  }
  if (name === normalized) {
    return { ...corpus, matchReason: "exact_name" }
  }
  if (slugify(corpus.name) === slugify(reference)) {
    return { ...corpus, matchReason: "slug" }
  }
  if (name.includes(normalized)) {
    return { ...corpus, matchReason: "name" }
  }
  if (corpus.description.toLowerCase().includes(normalized)) {
    return { ...corpus, matchReason: "description" }
  }
  return null
}

function resolveCandidateSort(
  left: GovernedCorpusResolveCandidate,
  right: GovernedCorpusResolveCandidate,
): number {
  const rank = {
    id: 0,
    exact_name: 1,
    slug: 2,
    name: 3,
    description: 4,
  }
  return rank[left.matchReason] - rank[right.matchReason]
}

function sourceSummary(
  sources: Array<{ sourceType: KnowledgeSourceType }>,
): GovernedCorpusSourceSummary[] {
  const counts = new Map<KnowledgeSourceType, number>()
  for (const source of sources) {
    counts.set(source.sourceType, (counts.get(source.sourceType) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([sourceType, count]) => ({ count, sourceType }))
    .sort((a, b) => a.sourceType.localeCompare(b.sourceType))
}

function sourcesByCorpusId<T extends { corpusId: string }>(
  sources: T[],
): Map<string, T[]> {
  const byCorpus = new Map<string, T[]>()
  for (const source of sources) {
    const current = byCorpus.get(source.corpusId) ?? []
    current.push(source)
    byCorpus.set(source.corpusId, current)
  }
  return byCorpus
}

function accessGroupsByCorpusId(
  rows: Array<{ corpusId: string; keycloakGroup: string }>,
): Map<string, string[]> {
  const byCorpus = new Map<string, string[]>()
  for (const row of rows) {
    const groups = byCorpus.get(row.corpusId) ?? []
    groups.push(row.keycloakGroup)
    byCorpus.set(row.corpusId, groups)
  }
  return byCorpus
}

function boundedLimit(value: number | undefined): number {
  return Number.isInteger(value) && value !== undefined
    ? Math.min(Math.max(value, 1), 50)
    : 20
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9čćđšž]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length > 1)
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9čćđšž]+/gi, "-")
    .replace(/^-+|-+$/g, "")
}

export async function listPublishedKnowledgeCorporaForBuilder(
  actor: Actor,
): Promise<KnowledgeCorpusListResponse> {
  await ensureDurableStateHydrated()
  return {
    generatedAt: now(),
    corpora: state.corpora
      .filter((corpus) => corpus.status === "published")
      .filter((corpus) => corpusAllowedForActor(corpus, actor))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  }
}

export async function listKnowledgeAgentBindingsForBuilder(
  actor: Actor,
  agentResourceId: string,
): Promise<AgentCorpusBinding[]> {
  await ensureDurableStateHydrated()
  return state.bindings.filter(
    (binding) =>
      binding.agentResourceId === agentResourceId &&
      corpusAllowedForActorId(binding.corpusId, actor),
  )
}

export async function bindKnowledgeCorpusToAgent(
  actor: Actor,
  agentResourceId: string,
  corpusId: string,
): Promise<
  | { status: "ok"; binding: AgentCorpusBinding }
  | { status: "not_found"; detail: string }
  | { status: "invalid"; detail: string }
> {
  await ensureDurableStateHydrated()
  const corpus = findCorpus(corpusId)
  if (!corpus || corpus.status !== "published") {
    return { status: "not_found", detail: "Published corpus not found." }
  }
  if (!corpusAllowedForActor(corpus, actor)) {
    return { status: "not_found", detail: "Published corpus not found." }
  }

  const existing = state.bindings.find(
    (binding) =>
      binding.agentResourceId === agentResourceId &&
      binding.corpusId === corpusId,
  )
  if (existing) {
    return { status: "ok", binding: existing }
  }

  const binding: AgentCorpusBinding = {
    id: randomUUID(),
    agentResourceId,
    corpusId,
    createdBy: actor.subject,
    createdAt: now(),
  }
  state.bindings.push(binding)
  await emitAudit({
    actorId: actor.subject,
    action: "knowledge.agent_corpus.bound",
    targetType: "builder.agent",
    targetId: agentResourceId,
    metadata: {
      corpusId,
    },
  })
  await persistBinding(actor, binding)
  return { status: "ok", binding }
}

export function resetKnowledgeStateForTest(): void {
  state.corpora.length = 0
  state.sources.length = 0
  state.jobs.length = 0
  state.snapshots.length = 0
  state.sourceContents.clear()
  state.urlAcquisitionJobs.length = 0
  state.bindings.length = 0
  durableStateHydrated = false
  objectStoreOverride = undefined
  cachedObjectStore = undefined
  setKnowledgeDurableRepositoryForTest(undefined)
  resetKnowledgeChunksForTest()
}

export function setKnowledgeObjectStoreForTest(
  objectStore: KnowledgeObjectStore | null,
): void {
  objectStoreOverride = objectStore
  cachedObjectStore = undefined
}

export function setKnowledgeDurableRepositoryOverrideForTest(
  repository: KnowledgeDurableRepository | null,
): void {
  durableStateHydrated = false
  setKnowledgeDurableRepositoryForTest(repository)
}

async function ensureDurableStateHydrated(): Promise<void> {
  if (durableStateHydrated) {
    return
  }

  const repository = getKnowledgeDurableRepository()
  if (!repository) {
    durableStateHydrated = true
    return
  }

  await hydrateDurableState(repository)
}

async function refreshDurableState(): Promise<void> {
  const repository = getKnowledgeDurableRepository()
  if (!repository) {
    await ensureDurableStateHydrated()
    return
  }

  await hydrateDurableState(repository)
}

async function hydrateDurableState(
  repository: KnowledgeDurableRepository,
): Promise<void> {
  const durableState = await repository.load()
  state.corpora.splice(0, state.corpora.length, ...durableState.corpora)
  state.sources.splice(0, state.sources.length, ...durableState.sources)
  state.jobs.splice(0, state.jobs.length, ...durableState.jobs)
  state.snapshots.splice(0, state.snapshots.length, ...durableState.snapshots)
  state.urlAcquisitionJobs.splice(
    0,
    state.urlAcquisitionJobs.length,
    ...durableState.urlAcquisitionJobs,
  )
  state.bindings.splice(0, state.bindings.length, ...durableState.bindings)
  hydrateKnowledgeChunks(durableState.chunks)
  durableStateHydrated = true
}

async function persistCorpus(
  actor: Actor,
  corpus: KnowledgeCorpus,
): Promise<void> {
  const repository = getKnowledgeDurableRepository()
  if (!repository) {
    return
  }
  await upsertActorUser(actor)
  await repository.saveCorpus(corpus)
}

async function persistSource(
  actor: Actor,
  source: KnowledgeSource,
  artifact?: StoredKnowledgeObject | null,
): Promise<void> {
  const repository = getKnowledgeDurableRepository()
  if (!repository) {
    return
  }
  await upsertActorUser(actor)
  await repository.saveSource(source, sourceArtifactInput(artifact))
}

async function persistJob(
  actor: Actor,
  job: KnowledgeIngestionJob,
): Promise<void> {
  const repository = getKnowledgeDurableRepository()
  if (!repository) {
    return
  }
  await upsertActorUser(actor)
  await repository.saveJob(job)
}

async function persistUrlAcquisitionJob(
  actor: Actor,
  job: KnowledgeUrlAcquisitionJob,
): Promise<void> {
  const repository = getKnowledgeDurableRepository()
  if (!repository) {
    return
  }
  await upsertActorUser(actor)
  await repository.saveUrlAcquisitionJob(job)
}

async function persistSnapshot(
  actor: Actor,
  snapshot: KnowledgeSnapshot,
): Promise<void> {
  const repository = getKnowledgeDurableRepository()
  if (!repository) {
    return
  }
  if (snapshot.publishedBy) {
    await upsertActorUser(actor)
  }
  await repository.saveSnapshot(snapshot)
}

async function persistSnapshotChunks(
  snapshotId: string,
  chunks: KnowledgeChunkRecord[],
): Promise<void> {
  const repository = getKnowledgeDurableRepository()
  if (!repository) {
    return
  }
  await repository.saveChunksForSnapshot(snapshotId, chunks)
}

async function persistBinding(
  actor: Actor,
  binding: AgentCorpusBinding,
): Promise<void> {
  const repository = getKnowledgeDurableRepository()
  if (!repository) {
    return
  }
  await upsertActorUser(actor)
  await repository.saveBinding(binding)
}

async function persistArchivedSources(
  actor: Actor,
  sources: KnowledgeSource[],
  archivedAt: string,
): Promise<void> {
  const repository = getKnowledgeDurableRepository()
  if (!repository) {
    return
  }
  await upsertActorUser(actor)
  await repository.archiveSources({
    actorId: actor.subject,
    archivedAt,
    sources,
  })
}

async function removeDurableSources(
  sourceIds: string[],
): Promise<KnowledgeSourceRemovalResult> {
  const repository = getKnowledgeDurableRepository()
  if (!repository) {
    return { objectKeys: [], removedChunkCount: 0 }
  }
  return repository.removeSources(sourceIds)
}

async function persistIngestionState(
  actor: Actor,
  corpus: KnowledgeCorpus,
  sources: KnowledgeSource[],
  job: KnowledgeIngestionJob,
  snapshot: KnowledgeSnapshot | null,
  sourceArtifacts: Map<string, KnowledgeSourceArtifactInput[]> = new Map(),
): Promise<void> {
  const repository = getKnowledgeDurableRepository()
  if (!repository) {
    return
  }
  await upsertActorUser(actor)
  await repository.saveCorpus(corpus)
  await Promise.all(
    sources.map((source) =>
      repository.saveSource(source, sourceArtifacts.get(source.id)),
    ),
  )
  await repository.saveJob(job)
  if (snapshot) {
    await repository.saveSnapshot(snapshot)
  }
}

async function storeOriginalArtifact(
  corpusId: string,
  source: KnowledgeSource,
  body: Buffer,
  contentType: string,
): Promise<StoredKnowledgeObject | null> {
  return storeSourceLevelArtifact(
    corpusId,
    source,
    "original",
    body,
    contentType,
    safeArtifactName(source.originalUri ?? source.id),
  )
}

async function storeSourceLevelArtifact(
  corpusId: string,
  source: KnowledgeSource,
  artifactType: string,
  body: Buffer,
  contentType: string,
  fileName: string,
): Promise<StoredKnowledgeObject | null> {
  const objectStore = getConfiguredObjectStore()
  if (!objectStore) {
    return null
  }
  const objectKey = sourceLevelArtifactObjectKey(
    corpusId,
    source,
    artifactType,
    fileName,
  )
  await objectStore.ensureBucket()
  return objectStore.putObject({
    body,
    contentType,
    objectKey,
  })
}

async function storeUrlAcquisitionArtifacts(
  corpusId: string,
  source: KnowledgeSource,
  snapshotBody: Buffer,
  snapshotContentType: string,
  normalizedText: Buffer | null,
  report: Record<string, unknown>,
): Promise<KnowledgeSourceArtifactInput[]> {
  const artifactInputs: KnowledgeSourceArtifactInput[] = []
  const snapshotObject = await storeSourceLevelArtifact(
    corpusId,
    source,
    "url_snapshot",
    snapshotBody,
    snapshotContentType,
    "snapshot.html",
  )
  if (snapshotObject) {
    artifactInputs.push({
      artifactType: "url_snapshot",
      metadata: { name: "url_snapshot" },
      object: snapshotObject,
    })
  }

  if (normalizedText && normalizedText.length > 0) {
    const normalizedObject = await storeSourceLevelArtifact(
      corpusId,
      source,
      "normalized_text",
      normalizedText,
      "text/markdown",
      "normalized.md",
    )
    if (normalizedObject) {
      artifactInputs.push({
        artifactType: "normalized_text",
        metadata: { name: "normalized_text" },
        object: normalizedObject,
      })
    }
  }

  const reportObject = await storeSourceLevelArtifact(
    corpusId,
    source,
    "url_fetch_report",
    Buffer.from(JSON.stringify(report, null, 2), "utf8"),
    "application/json",
    "url-fetch-report.json",
  )
  if (reportObject) {
    artifactInputs.push({
      artifactType: "url_fetch_report",
      metadata: { name: "url_fetch_report" },
      object: reportObject,
    })
  }
  return artifactInputs
}

async function storeNormalizedArtifacts(
  corpusId: string,
  source: KnowledgeSource,
  snapshotId: string,
  artifacts: ExtractedKnowledgeArtifact[],
): Promise<KnowledgeSourceArtifactInput[]> {
  const objectStore = getConfiguredObjectStore()
  if (!objectStore || artifacts.length === 0) {
    return []
  }
  await objectStore.ensureBucket()
  const storedArtifacts: KnowledgeSourceArtifactInput[] = []
  for (const artifact of artifacts) {
    const object = await objectStore.putObject({
      body: artifact.body,
      contentType: artifact.contentType,
      objectKey: normalizedArtifactObjectKey(
        corpusId,
        source,
        snapshotId,
        artifact.fileName,
      ),
    })
    storedArtifacts.push({
      artifactType: artifact.artifactType,
      metadata: {
        ...artifact.metadata,
        fileName: artifact.fileName,
        name: artifact.name,
      },
      object,
    })
  }
  return storedArtifacts
}

function normalizedArtifactMetadata(
  corpusId: string,
  source: KnowledgeSource,
  snapshotId: string,
  artifacts: KnowledgeSourceArtifactInput[],
): Record<string, unknown> {
  const metadata: Record<string, unknown> = sourceArtifactPaths(
    corpusId,
    source,
    "normalized",
    snapshotId,
  )
  if (artifacts.length === 0) {
    return metadata
  }

  const normalizedArtifacts: Record<string, unknown> = {}
  const normalizedArtifactKeys: Record<string, string> = {}
  for (const artifact of artifacts) {
    const name =
      typeof artifact.metadata?.name === "string"
        ? artifact.metadata.name
        : artifact.artifactType
    const objectRef = toPublicKnowledgeObjectRef(artifact.object)
    metadata[`${artifact.artifactType}ObjectKey`] = artifact.object.objectKey
    metadata[`${artifact.artifactType}Object`] = objectRef
    normalizedArtifactKeys[name] = artifact.object.objectKey
    normalizedArtifacts[name] = objectRef
  }

  metadata.normalizedArtifactKeys = normalizedArtifactKeys
  metadata.normalizedArtifacts = normalizedArtifacts
  return metadata
}

async function deleteKnowledgeObjects(objectKeys: string[]): Promise<void> {
  const objectStore = getConfiguredObjectStore()
  if (!objectStore) {
    return
  }
  const uniqueObjectKeys = Array.from(new Set(objectKeys))
  await Promise.all(
    uniqueObjectKeys.map((objectKey) => objectStore.removeObject(objectKey)),
  )
}

function getConfiguredObjectStore(): KnowledgeObjectStore | null {
  if (objectStoreOverride !== undefined) {
    return objectStoreOverride
  }
  if (cachedObjectStore !== undefined) {
    return cachedObjectStore
  }

  if (!hasObjectStoreEnv(process.env)) {
    cachedObjectStore = null
    return cachedObjectStore
  }

  cachedObjectStore = createKnowledgeObjectStoreFromEnv()
  return cachedObjectStore
}

async function sourceContentForIngestion(
  source: KnowledgeSource,
): Promise<Buffer | string | null> {
  const inMemoryContent = state.sourceContents.get(source.id)
  if (inMemoryContent) {
    return inMemoryContent
  }

  const objectKey = originalObjectKeyForSource(source)
  const objectStore = objectKey ? getConfiguredObjectStore() : null
  if (!objectKey || !objectStore) {
    return null
  }

  try {
    const content = await objectStore.getObjectBuffer(objectKey)
    state.sourceContents.set(source.id, content)
    return content
  } catch {
    return null
  }
}

function originalObjectKeyForSource(source: KnowledgeSource): string | null {
  const artifacts = artifactMetadataFor(source)
  const value =
    artifacts?.url_snapshotObjectKey ??
    (typeof artifacts?.url_snapshotObject === "object" &&
    artifacts.url_snapshotObject !== null
      ? (artifacts.url_snapshotObject as Record<string, unknown>).objectKey
      : null) ??
    artifacts?.originalObjectKey ??
    (typeof artifacts?.originalObject === "object" &&
    artifacts.originalObject !== null
      ? (artifacts.originalObject as Record<string, unknown>).objectKey
      : null)
  return typeof value === "string" && value.length > 0 ? value : null
}

function hasObjectStoreEnv(env: NodeJS.ProcessEnv): boolean {
  return [
    "MINIO_ENDPOINT",
    "MINIO_ACCESS_KEY",
    "MINIO_SECRET_KEY",
    "KNOWLEDGE_MINIO_BUCKET",
  ].every((name) => Boolean(env[name]))
}

function artifactMetadata(
  corpusId: string,
  source: KnowledgeSource,
  kind: "normalized" | "original",
  artifact?: StoredKnowledgeObject | null,
  snapshotId?: string,
): Record<string, unknown> {
  const paths = sourceArtifactPaths(corpusId, source, kind, snapshotId)
  if (!artifact) {
    return paths
  }
  return {
    ...paths,
    [`${kind}Object`]: toPublicKnowledgeObjectRef(artifact),
  }
}

function sourceArtifactInput(
  artifact?: StoredKnowledgeObject | null,
): KnowledgeSourceArtifactInput | undefined {
  if (!artifact) {
    return undefined
  }
  return {
    artifactType: "original",
    object: artifact,
  }
}

export function dropKnowledgeSourceContentForTest(sourceId: string): void {
  state.sourceContents.delete(sourceId)
}

export function setKnowledgeCorpusStatusForTest(
  corpusId: string,
  status: KnowledgeCorpusStatus,
): void {
  const corpus = findCorpus(corpusId)
  if (corpus) {
    corpus.status = status
    corpus.updatedAt = now()
  }
}

function createSource(
  actor: Actor,
  corpus: KnowledgeCorpus,
  input: {
    sourceType: KnowledgeSourceType
    title: string
    originalUri: string
    finalUri: string | null
    canonicalUri: string | null
    mimeType: string
    checksum: string
    status: KnowledgeSource["status"]
    metadata: Record<string, unknown>
    timestamp: string
  },
): KnowledgeSource {
  const source: KnowledgeSource = {
    id: randomUUID(),
    corpusId: corpus.id,
    sourceType: input.sourceType,
    title: input.title,
    originalUri: input.originalUri,
    finalUri: input.finalUri,
    canonicalUri: input.canonicalUri,
    mimeType: input.mimeType,
    checksum: input.checksum,
    status: input.status,
    language: null,
    metadata: input.metadata,
    errorDetail: null,
    createdBy: actor.subject,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  }
  state.sources.push(source)
  updateCorpus(corpus, actor, { sourceCount: sourcesFor(corpus.id).length })
  return source
}

function createJob(
  actor: Actor,
  corpusId: string,
  sourceId: string | null,
  jobType: KnowledgeIngestionJob["jobType"],
): KnowledgeIngestionJob {
  const timestamp = now()
  const job: KnowledgeIngestionJob = {
    id: randomUUID(),
    corpusId,
    sourceId,
    jobType,
    status: "queued",
    progressPercent: 0,
    metrics: {},
    errorDetail: null,
    retryCount: 0,
    createdBy: actor.subject,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  state.jobs.push(job)
  return job
}

async function transitionCorpus(
  actor: Actor,
  corpusId: string,
  status: KnowledgeCorpusStatus,
  action: string,
): Promise<KnowledgeMutationResult> {
  await ensureDurableStateHydrated()
  const corpus = findCorpus(corpusId)
  if (!corpus) {
    return { status: "not_found", detail: "Corpus not found." }
  }

  updateCorpus(corpus, actor, { status })
  await persistCorpus(actor, corpus)
  await emitAudit({
    actorId: actor.subject,
    action,
    targetType: "knowledge.corpus",
    targetId: corpus.id,
    metadata: { status },
  })
  return { status: "ok", response: { corpus } }
}

function findCorpus(corpusId: string): KnowledgeCorpus | undefined {
  return state.corpora.find((corpus) => corpus.id === corpusId)
}

function findSource(
  corpusId: string,
  sourceId: string,
): KnowledgeSource | undefined {
  return state.sources.find(
    (source) => source.corpusId === corpusId && source.id === sourceId,
  )
}

function findSnapshot(
  corpusId: string,
  snapshotId: string,
): KnowledgeSnapshot | undefined {
  return state.snapshots.find(
    (snapshot) => snapshot.corpusId === corpusId && snapshot.id === snapshotId,
  )
}

function detailFor(corpus: KnowledgeCorpus): KnowledgeCorpusDetailResponse {
  return {
    corpus,
    sources: sourcesFor(corpus.id),
    jobs: state.jobs.filter((job) => job.corpusId === corpus.id),
    snapshots: state.snapshots.filter(
      (snapshot) => snapshot.corpusId === corpus.id,
    ),
  }
}

function sourcesFor(corpusId: string): KnowledgeSource[] {
  return state.sources.filter((source) => source.corpusId === corpusId)
}

function removeSourcesFromState(sourceIds: string[]): void {
  const sourceIdSet = new Set(sourceIds)
  const remaining = state.sources.filter(
    (source) => !sourceIdSet.has(source.id),
  )
  state.sources.splice(0, state.sources.length, ...remaining)
}

function objectKeysForSources(sources: KnowledgeSource[]): string[] {
  const objectKeys = new Set<string>()
  for (const source of sources) {
    const artifacts = artifactMetadataFor(source)
    if (!artifacts) {
      continue
    }
    for (const [key, value] of Object.entries(artifacts)) {
      if (key.endsWith("ObjectKey") && typeof value === "string") {
        objectKeys.add(value)
      }
      if (key.endsWith("Object") && isRecord(value)) {
        const objectKey = value.objectKey
        if (typeof objectKey === "string") {
          objectKeys.add(objectKey)
        }
      }
    }
  }
  return [...objectKeys]
}

function objectKeysForArchivedSources(
  sources: KnowledgeArchivedSource[],
): string[] {
  const objectKeys = new Set<string>()
  for (const source of sources) {
    const artifacts = source.metadata.artifacts
    if (!isRecord(artifacts)) {
      continue
    }
    for (const [key, value] of Object.entries(artifacts)) {
      if (key.endsWith("ObjectKey") && typeof value === "string") {
        objectKeys.add(value)
      }
      if (key.endsWith("Object") && isRecord(value)) {
        const objectKey = value.objectKey
        if (typeof objectKey === "string") {
          objectKeys.add(objectKey)
        }
      }
    }
  }
  return [...objectKeys]
}

function primaryCorpusForArchivedSources(
  sources: KnowledgeArchivedSource[],
): KnowledgeCorpus {
  const corpus = sources[0] ? findCorpus(sources[0].corpusId) : undefined
  if (corpus) {
    return corpus
  }
  const timestamp = now()
  return {
    accessGroups: [],
    chunkCount: 0,
    createdAt: timestamp,
    createdBy: "system",
    description: "Archive action did not resolve an active corpus.",
    id: sources[0]?.corpusId ?? randomUUID(),
    languageHints: [],
    name: sources[0]?.corpusName ?? "Archived corpus",
    publishedSnapshotId: null,
    sourceCount: 0,
    status: "archived",
    updatedAt: timestamp,
    updatedBy: "system",
  }
}

function corpusAllowedForActorId(corpusId: string, actor: Actor): boolean {
  const corpus = findCorpus(corpusId)
  return corpus
    ? corpus.status === "published" && corpusAllowedForActor(corpus, actor)
    : false
}

function corpusAllowedForActor(corpus: KnowledgeCorpus, actor: Actor): boolean {
  return accessGroupsAllowedForActor(corpus.accessGroups, actor)
}

function accessGroupsAllowedForActor(
  accessGroups: string[],
  actor: Actor,
): boolean {
  if (accessGroups.length === 0) {
    return true
  }
  const groups = new Set(
    (actor.groups ?? []).map((group) => group.toLowerCase()),
  )
  return accessGroups.some((group) => groups.has(group.toLowerCase()))
}

function corpusMatchesAccessGroup(
  corpus: KnowledgeCorpus,
  groupName: string,
): boolean {
  if (isEveryoneAccessGroup(groupName)) {
    return corpus.accessGroups.length === 0
  }
  const normalized = groupName.toLowerCase()
  return corpus.accessGroups.some((group) => group.toLowerCase() === normalized)
}

function renameAccessGroup(
  groups: string[],
  oldName: string,
  newName: string,
): string[] {
  const oldNormalized = oldName.toLowerCase()
  const renamed = groups.map((group) =>
    group.toLowerCase() === oldNormalized ? newName : group,
  )
  return normalizeAccessGroups(renamed)
}

function sameAccessGroups(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function normalizeAccessGroups(groups: string[]): string[] {
  return Array.from(
    new Set(
      groups
        .map((group) => group.trim())
        .filter((group) => group.length > 0 && !isEveryoneAccessGroup(group)),
    ),
  )
}

function isEveryoneAccessGroup(groupName: string): boolean {
  return groupName.toLowerCase() === "everyone"
}

function runtimeSourceType(sourceType: string): KnowledgeSourceType {
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

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

function updateCorpus(
  corpus: KnowledgeCorpus,
  actor: Actor,
  updates: Partial<
    Pick<
      KnowledgeCorpus,
      | "accessGroups"
      | "chunkCount"
      | "publishedSnapshotId"
      | "sourceCount"
      | "status"
    >
  >,
): void {
  Object.assign(corpus, updates, {
    updatedBy: actor.subject,
    updatedAt: now(),
  })
}

function sourceBlocksSnapshotPublish(source: KnowledgeSource): boolean {
  return (
    source.status === "fetching" ||
    source.status === "pending" ||
    source.status === "extracting"
  )
}

function nextSnapshotVersion(corpusId: string): number {
  return (
    Math.max(
      0,
      ...state.snapshots
        .filter((snapshot) => snapshot.corpusId === corpusId)
        .map((snapshot) => snapshot.version),
    ) + 1
  )
}

function sourceTypeForUpload(
  mimeType: string,
  fileName: string,
): KnowledgeSourceType {
  const normalizedMime = mimeType.toLowerCase()
  const normalizedName = fileName.toLowerCase()
  const extension = uploadExtension(normalizedName)
  if (normalizedMime.startsWith("image/")) {
    return "image"
  }
  if (
    TABLE_UPLOAD_MIME_TYPES.has(normalizedMime) ||
    (extension !== null && TABLE_UPLOAD_EXTENSIONS.has(extension))
  ) {
    return "table"
  }
  return "file"
}

function sourceUrlKey(source: KnowledgeSource): string | null {
  const uri = source.canonicalUri ?? source.finalUri ?? source.originalUri
  if (!uri) {
    return null
  }
  try {
    return normalizedKnowledgeUrlKey(new URL(uri))
  } catch {
    return uri.toLowerCase().replace(/\/+$/g, "")
  }
}

function checksum(input: string | Buffer): string {
  return `sha256:${createHash("sha256").update(input).digest("hex")}`
}

function sourceArtifactPaths(
  corpusId: string,
  source: KnowledgeSource,
  kind: "normalized" | "original",
  snapshotId?: string,
) {
  const prefix =
    kind === "original"
      ? `knowledge/corpora/${corpusId}/sources/${source.id}/original`
      : `knowledge/corpora/${corpusId}/snapshots/${snapshotId}/sources/${source.id}`
  const suffix =
    kind === "original"
      ? safeArtifactName(source.originalUri ?? source.id)
      : "normalized.json"
  return {
    [`${kind}ObjectKey`]: `${prefix}/${suffix}`,
  }
}

function normalizedArtifactObjectKey(
  corpusId: string,
  source: KnowledgeSource,
  snapshotId: string,
  fileName: string,
): string {
  return `knowledge/corpora/${corpusId}/snapshots/${snapshotId}/sources/${source.id}/${safeArtifactName(fileName)}`
}

function sourceLevelArtifactObjectKey(
  corpusId: string,
  source: KnowledgeSource,
  artifactType: string,
  fileName: string,
): string {
  return `knowledge/corpora/${corpusId}/sources/${source.id}/${artifactType}/${safeArtifactName(fileName)}`
}

function artifactMetadataFor(
  source: KnowledgeSource,
): Record<string, unknown> | null {
  const artifacts = source.metadata.artifacts
  return typeof artifacts === "object" && artifacts !== null
    ? (artifacts as Record<string, unknown>)
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function safeArtifactName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160)
}

function now(): string {
  return new Date().toISOString()
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
