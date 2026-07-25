import type {
  AgentCorpusBinding,
  KnowledgeArchiveSourceListResponse,
  KnowledgeArchivedSource,
  KnowledgeCorpus,
  KnowledgeCorpusDetailResponse,
  KnowledgeCorpusListResponse,
  KnowledgeIngestionJob,
  KnowledgeQueryResult,
  KnowledgeSnapshot,
  KnowledgeSource,
} from "@llm-machines/contracts"

const generatedAt = "2026-05-27T10:30:00.000Z"

export const knowledgeCorpora: KnowledgeCorpus[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "HR Policies",
    description: "Published Croatian and English policy corpus.",
    status: "published",
    languageHints: ["hr", "en"],
    publishedSnapshotId: "22222222-2222-4222-8222-222222222222",
    sourceCount: 5,
    chunkCount: 18,
    accessGroups: [],
    createdBy: "admin-1",
    updatedBy: "admin-1",
    createdAt: "2026-05-27T08:00:00.000Z",
    updatedAt: generatedAt,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Security Runbooks",
    description: "Staged snapshot awaiting Admin publish.",
    status: "staged",
    languageHints: ["en"],
    publishedSnapshotId: null,
    sourceCount: 3,
    chunkCount: 12,
    accessGroups: ["security"],
    createdBy: "admin-1",
    updatedBy: "admin-1",
    createdAt: "2026-05-27T08:20:00.000Z",
    updatedAt: "2026-05-27T10:20:00.000Z",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Draft Finance FAQ",
    description: "Draft corpus with no published runtime access.",
    status: "draft",
    languageHints: ["en"],
    publishedSnapshotId: null,
    sourceCount: 1,
    chunkCount: 0,
    accessGroups: ["finance"],
    createdBy: "admin-1",
    updatedBy: "admin-1",
    createdAt: "2026-05-27T09:00:00.000Z",
    updatedAt: "2026-05-27T09:00:00.000Z",
  },
  {
    id: "13131313-1313-4131-8131-131313131313",
    name: "Archived Legacy Policies",
    description: "Archived corpus hidden from the active runtime inventory.",
    status: "archived",
    languageHints: ["en"],
    publishedSnapshotId: null,
    sourceCount: 0,
    chunkCount: 0,
    accessGroups: ["legacy"],
    createdBy: "admin-1",
    updatedBy: "admin-1",
    createdAt: "2026-05-27T06:00:00.000Z",
    updatedAt: "2026-05-27T09:30:00.000Z",
  },
]

export const knowledgeCorpusList: KnowledgeCorpusListResponse = {
  generatedAt,
  corpora: knowledgeCorpora,
}

export const knowledgeArchivedSources: KnowledgeArchivedSource[] = [
  {
    id: "abababab-abab-4aba-8bab-abababababab",
    sourceId: "cdcdcdcd-cdcd-4cdc-8dcd-cdcdcdcdcdcd",
    corpusId: knowledgeCorpora[0].id,
    corpusName: knowledgeCorpora[0].name,
    sourceType: "file",
    title: "Archived onboarding handbook.pdf",
    originalUri: "onboarding-handbook.pdf",
    finalUri: null,
    canonicalUri: null,
    mimeType: "application/pdf",
    checksum: "sha256:archived-onboarding",
    status: "ready",
    language: "en",
    metadata: {
      artifacts: {
        originalObjectKey:
          "knowledge/corpora/11111111-1111-4111-8111-111111111111/sources/cdcdcdcd-cdcd-4cdc-8dcd-cdcdcdcdcdcd/original/onboarding-handbook.pdf",
      },
      warnings: [],
    },
    errorDetail: null,
    createdBy: "admin-1",
    createdAt: "2026-05-27T07:30:00.000Z",
    updatedAt: "2026-05-27T08:45:00.000Z",
    archivedBy: "admin-1",
    archivedAt: "2026-05-27T10:45:00.000Z",
  },
]

export const knowledgeArchivedSourceList: KnowledgeArchiveSourceListResponse = {
  generatedAt,
  sources: knowledgeArchivedSources,
}

export const knowledgeCorpusDetails: KnowledgeCorpusDetailResponse[] = [
  {
    corpus: knowledgeCorpora[0],
    sources: [
      fileSource({
        checksum: "sha256:hr-policy",
        id: "55555555-5555-4555-8555-555555555555",
        language: "hr",
        title: "Croatian employee handbook",
      }),
      fileSource({
        checksum: "sha256:en-safety",
        id: "66666666-6666-4666-8666-666666666666",
        language: "en",
        mimeType: "application/pdf",
        title: "English safety PDF",
      }),
      tableSource({
        checksum: "sha256:table-policy",
        id: "77777777-7777-4777-8777-777777777777",
        title: "Policy ownership table",
      }),
      imageSource({
        checksum: "sha256:image-ocr",
        id: "88888888-8888-4888-8888-888888888888",
        language: "hr",
        title: "Signed approval image",
      }),
      fileSource({
        checksum: "sha256:disabled-legacy",
        id: "12121212-3434-4121-8121-121212121212",
        language: "en",
        status: "disabled",
        title: "Disabled legacy procedure",
      }),
    ],
    jobs: [
      job({
        corpusId: knowledgeCorpora[0].id,
        id: "99999999-9999-4999-8999-999999999999",
        status: "succeeded",
      }),
    ],
    snapshots: [
      snapshot({
        corpusId: knowledgeCorpora[0].id,
        id: "22222222-2222-4222-8222-222222222222",
        status: "published",
      }),
    ],
  },
  {
    corpus: knowledgeCorpora[1],
    sources: [
      urlSource({
        checksum: "sha256:security-url",
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Security URL snapshot",
      }),
      tableSource({
        checksum: "sha256:security-table",
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        title: "Incident severity CSV",
      }),
      imageSource({
        checksum: "sha256:weak-image",
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        status: "failed",
        title: "Blurry escalation screenshot",
        warning: "weak_ocr",
      }),
    ],
    jobs: [
      job({
        corpusId: knowledgeCorpora[1].id,
        failedSourceCount: 1,
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        status: "succeeded",
      }),
    ],
    snapshots: [
      snapshot({
        corpusId: knowledgeCorpora[1].id,
        failedSourceCount: 1,
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        status: "staged",
      }),
    ],
  },
  {
    corpus: knowledgeCorpora[2],
    sources: [
      fileSource({
        checksum: "sha256:finance-faq",
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        title: "Finance FAQ draft",
      }),
    ],
    jobs: [],
    snapshots: [],
  },
]

export const builderKnowledgeCorpusList: KnowledgeCorpusListResponse = {
  generatedAt,
  corpora: knowledgeCorpora.filter((corpus) => corpus.status === "published"),
}

export const builderAgentCorpusBindings: AgentCorpusBinding[] = [
  {
    id: "12121212-1212-4121-8121-121212121212",
    agentResourceId: "66666666-6666-4666-8666-666666666666",
    corpusId: "11111111-1111-4111-8111-111111111111",
    createdBy: "builder-1",
    createdAt: generatedAt,
  },
]

export const knowledgeRetrievalTestResult: KnowledgeQueryResult = {
  generatedAt,
  query: "korpuse znanja",
  results: [
    retrievalResult({
      checksum: "sha256:hr-policy",
      excerpt: "Administrator odobrava korpuse znanja za interne pravilnike.",
      pageNumber: 1,
      score: 0.94,
      sourceId: "55555555-5555-4555-8555-555555555555",
      sourceType: "file",
      title: "Croatian employee handbook",
    }),
    retrievalResult({
      checksum: "sha256:en-safety",
      excerpt: "Published snapshots make the corpus immutable for retrieval.",
      pageNumber: 1,
      score: 0.9,
      sourceId: "66666666-6666-4666-8666-666666666666",
      sourceType: "file",
      title: "English safety PDF",
    }),
    retrievalResult({
      checksum: "sha256:table-policy",
      excerpt: "Admin-only corpus ingestion, Builder attach, Consumer query.",
      rowRange: "2-4",
      score: 0.86,
      sourceId: "77777777-7777-4777-8777-777777777777",
      sourceType: "table",
      title: "Policy ownership table",
    }),
    retrievalResult({
      checksum: "sha256:image-ocr",
      excerpt:
        "Slika potvrduje da administrator pregledava izvor prije objave.",
      imageRegion: "full-image",
      score: 0.82,
      sourceId: "88888888-8888-4888-8888-888888888888",
      sourceType: "image",
      title: "Signed approval image",
    }),
    retrievalResult({
      checksum: "sha256:security-url",
      excerpt: "The stored snapshot is searched without a live web fetch.",
      score: 0.78,
      sourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sourceType: "url",
      title: "Security URL snapshot",
      uri: "https://docs.example.test/security-runbook",
    }),
  ],
  citations: [],
}
knowledgeRetrievalTestResult.citations =
  knowledgeRetrievalTestResult.results.map((result) => result.citation)

function fileSource(input: {
  checksum: string
  id: string
  language?: string
  mimeType?: string
  status?: KnowledgeSource["status"]
  title: string
}): KnowledgeSource {
  return source({
    ...input,
    mimeType: input.mimeType ?? "text/plain",
    sourceType: "file",
  })
}

function urlSource(input: {
  checksum: string
  id: string
  title: string
}): KnowledgeSource {
  return source({
    ...input,
    finalUri: "https://docs.example.test/security-runbook",
    metadata: {
      artifacts: {
        normalizedObjectKey:
          "knowledge/corpora/33333333-3333-4333-8333-333333333333/snapshots/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/sources/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/normalized.json",
        originalObjectKey:
          "knowledge/corpora/33333333-3333-4333-8333-333333333333/sources/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/original/security-runbook.html",
      },
      extraction: {
        canonicalUri: "https://docs.example.test/security-runbook",
        finalUri: "https://docs.example.test/security-runbook",
        redirectChain: [],
      },
      fetchedAt: generatedAt,
      warnings: [],
    },
    mimeType: "text/html",
    originalUri: "https://docs.example.test/security-runbook",
    sourceType: "url",
  })
}

function tableSource(input: {
  checksum: string
  id: string
  title: string
}): KnowledgeSource {
  return source({
    ...input,
    metadata: {
      extraction: { rowCount: 4 },
      warnings: [],
    },
    mimeType: "text/csv",
    sourceType: "table",
  })
}

function imageSource(input: {
  checksum: string
  id: string
  language?: string
  status?: KnowledgeSource["status"]
  title: string
  warning?: string
}): KnowledgeSource {
  return source({
    ...input,
    metadata: {
      extraction: { ocrMode: "fixture_text" },
      warnings: input.warning ? [input.warning] : [],
    },
    mimeType: "image/png",
    sourceType: "image",
  })
}

function source(input: {
  checksum: string
  finalUri?: string | null
  id: string
  language?: string
  metadata?: Record<string, unknown>
  mimeType: string
  originalUri?: string
  sourceType: KnowledgeSource["sourceType"]
  status?: KnowledgeSource["status"]
  title: string
}): KnowledgeSource {
  return {
    id: input.id,
    corpusId: input.id.startsWith("f")
      ? knowledgeCorpora[2].id
      : input.id.startsWith("a") ||
          input.id.startsWith("b") ||
          input.id.startsWith("c")
        ? knowledgeCorpora[1].id
        : knowledgeCorpora[0].id,
    sourceType: input.sourceType,
    title: input.title,
    originalUri: input.originalUri ?? input.title,
    finalUri: input.finalUri ?? null,
    canonicalUri: null,
    mimeType: input.mimeType,
    checksum: input.checksum,
    status: input.status ?? "ready",
    language: input.language ?? "en",
    metadata: input.metadata ?? { warnings: [] },
    errorDetail: input.status === "failed" ? "Weak OCR output." : null,
    createdBy: "admin-1",
    createdAt: "2026-05-27T08:30:00.000Z",
    updatedAt: generatedAt,
  }
}

function retrievalResult(input: {
  checksum: string
  excerpt: string
  imageRegion?: string
  pageNumber?: number
  rowRange?: string
  score: number
  sourceId: string
  sourceType: "file" | "image" | "table" | "url"
  title: string
  uri?: string
}): KnowledgeQueryResult["results"][number] {
  const citation = {
    citation_id: `fixture-${input.sourceId}`,
    corpus_id: knowledgeCorpora[0].id,
    snapshot_id: "22222222-2222-4222-8222-222222222222",
    source_id: input.sourceId,
    source_type: input.sourceType,
    title: input.title,
    ...(input.uri ? { uri: input.uri } : {}),
    ...(input.pageNumber ? { page_number: input.pageNumber } : {}),
    ...(input.rowRange ? { row_range: input.rowRange } : {}),
    ...(input.imageRegion ? { image_region: input.imageRegion } : {}),
    excerpt: input.excerpt,
    score: input.score,
    checksum: input.checksum,
    retrieved_at: generatedAt,
  }

  return {
    citation,
    corpusId: knowledgeCorpora[0].id,
    excerpt: input.excerpt,
    score: input.score,
    snapshotId: "22222222-2222-4222-8222-222222222222",
    sourceId: input.sourceId,
    title: input.title,
  }
}

function job(input: {
  corpusId: string
  failedSourceCount?: number
  id: string
  status: KnowledgeIngestionJob["status"]
}): KnowledgeIngestionJob {
  return {
    id: input.id,
    corpusId: input.corpusId,
    sourceId: null,
    jobType: "ingest",
    status: input.status,
    progressPercent: 100,
    metrics: {
      failedSourceCount: input.failedSourceCount ?? 0,
      mode: "in_memory_worker",
    },
    errorDetail: null,
    retryCount: 0,
    createdBy: "admin-1",
    createdAt: "2026-05-27T10:00:00.000Z",
    updatedAt: generatedAt,
  }
}

function snapshot(input: {
  corpusId: string
  failedSourceCount?: number
  id: string
  status: KnowledgeSnapshot["status"]
}): KnowledgeSnapshot {
  return {
    id: input.id,
    corpusId: input.corpusId,
    version: 1,
    status: input.status,
    sourceCount: input.failedSourceCount ? 3 : 4,
    chunkCount: input.failedSourceCount ? 12 : 18,
    metadata: {
      failedSourceCount: input.failedSourceCount ?? 0,
      sampleCitations: [
        {
          page_number: 1,
          title: "English safety PDF",
        },
        {
          row_range: "2-4",
          title: "Policy ownership table",
        },
      ],
    },
    publishedBy: input.status === "published" ? "admin-1" : null,
    publishedAt: input.status === "published" ? generatedAt : null,
    createdAt: "2026-05-27T10:15:00.000Z",
  }
}
