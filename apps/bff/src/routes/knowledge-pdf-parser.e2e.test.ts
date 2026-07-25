import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { KnowledgeSource } from "@llm-machines/contracts"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import { resetAuditEventsForTest } from "../services/audit"
import { resetIdempotencyForTest } from "../services/idempotency"
import {
  resetKnowledgeStateForTest,
  setKnowledgeObjectStoreForTest,
} from "../services/knowledge/admin"
import {
  KnowledgeObjectStore,
  type KnowledgeObjectStoreClient,
} from "../services/knowledge/object-store"

const runPdfParserE2E = process.env.KNOWLEDGE_PDF_PARSER_E2E === "1"
const describePdfParserE2E = runPdfParserE2E ? describe : describe.skip

const adminHeaders = {
  authorization: "Bearer test-service-key",
  "x-llm-machines-keycloak-token": "",
  "x-llm-machines-user-sub": "admin-1",
  "x-llm-machines-user-email": "admin@example.test",
  "x-llm-machines-user-roles": "admin",
}

const serviceHeaders = {
  ...adminHeaders,
  "x-llm-machines-user-sub": "user-1",
  "x-llm-machines-user-email": "user@example.test",
  "x-llm-machines-user-roles": "consumer",
}

const fixtureRoot = join(process.cwd(), "../../test-fixtures/knowledge")
const pdfFixtureRoot = join(fixtureRoot, "pdf-parser")

describePdfParserE2E("Knowledge OpenDataLoader PDF parser E2E", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetAuditEventsForTest()
    resetIdempotencyForTest()
    resetKnowledgeStateForTest()
  })

  it("ingests real OpenDataLoader PDF output into governed corpus retrieval and MCP citations", async () => {
    const parserUrl =
      process.env.KNOWLEDGE_PDF_PARSER_URL ?? "http://127.0.0.1:18002"
    const parserToken =
      process.env.KNOWLEDGE_PDF_PARSER_SERVICE_TOKEN ??
      "pdf-parser-e2e-token"
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("KNOWLEDGE_PDF_PARSER_URL", parserUrl)
    vi.stubEnv("KNOWLEDGE_PDF_PARSER_SERVICE_TOKEN", parserToken)
    vi.stubEnv("KNOWLEDGE_PDF_PARSER_TIMEOUT_MS", "30000")
    vi.stubEnv("KNOWLEDGE_PDF_PARSER_MAX_RESPONSE_BYTES", "8388608")

    const objectClient = new RecordingObjectStoreClient()
    setKnowledgeObjectStoreForTest(
      new KnowledgeObjectStore(objectClient, "console-knowledge"),
    )
    const server = buildServer()
    const corpusId = await createCorpus(server, "PDF Parser E2E Corpus")
    await uploadPdfFixture(server, corpusId, "digital-english-policy.pdf")
    await uploadPdfFixture(server, corpusId, "digital-croatian-policy.pdf")
    await uploadPdfFixture(server, corpusId, "multi-page-operations.pdf")
    await uploadPdfFixture(server, corpusId, "table-heavy-policy.pdf")
    await uploadPdfFixture(server, corpusId, "scanned-croatian-placeholder.pdf")

    const ingestResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/ingest`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "pdf-parser-e2e-ingest",
      },
    })
    expect(ingestResponse.statusCode).toBe(200)
    expect(ingestResponse.json().snapshot).toMatchObject({
      corpusId,
      metadata: expect.objectContaining({
        failedSourceCount: 0,
      }),
      sourceCount: 5,
      status: "staged",
    })

    const detailAfterIngest = await getCorpusDetail(server, corpusId)
    const sources = detailAfterIngest.sources as KnowledgeSource[]
    expect(sources).toHaveLength(5)
    for (const source of sources) {
      expect(source.status).toBe("ready")
      expect(source.metadata).toMatchObject({
        extraction: expect.objectContaining({
          parser: "opendataloader-pdf",
          parser_version: expect.any(String),
        }),
      })
    }
    const englishSource = sourceByTitle(sources, "digital-english-policy.pdf")
    expect(englishSource).toMatchObject({
      language: "en",
      metadata: expect.objectContaining({
        artifacts: expect.objectContaining({
          normalizedArtifactKeys: expect.objectContaining({
            json: expect.stringContaining("/normalized.json"),
            markdown: expect.stringContaining("/normalized.md"),
            pageMap: expect.stringContaining("/page-map.json"),
            parserReport: expect.stringContaining("/parser-report.json"),
          }),
        }),
      }),
    })
    const normalizedArtifactKeys = (
      englishSource.metadata.artifacts as {
        normalizedArtifactKeys: Record<string, string>
      }
    ).normalizedArtifactKeys
    expect(sourceByTitle(sources, "digital-croatian-policy.pdf")).toMatchObject({
      language: "hr",
    })
    expect(
      sourceByTitle(sources, "scanned-croatian-placeholder.pdf").metadata
        .warnings,
    ).toContain("weak_ocr")
    for (const objectKey of Object.values(normalizedArtifactKeys)) {
      expect(objectClient.storedKeys()).toEqual(
        expect.arrayContaining([expect.stringContaining(objectKey)]),
      )
    }

    const snapshotId = ingestResponse.json().snapshot.id as string
    const publishResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/snapshots/${snapshotId}/publish`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "pdf-parser-e2e-publish",
      },
    })
    expect(publishResponse.statusCode).toBe(200)

    vi.stubGlobal("fetch", async () => {
      throw new Error("Runtime retrieval must use stored chunks, not fetch.")
    })

    const english = await mcpSearch(server, {
      corpus_ids: [corpusId],
      query: "immutable corpus snapshot",
      top_k: 5,
    })
    const croatian = await mcpSearch(server, {
      corpus_ids: [corpusId],
      query: "korpuse znanja",
      top_k: 5,
    })
    const multiPage = await mcpSearch(server, {
      corpus_ids: [corpusId],
      query: "runtime citations",
      top_k: 5,
    })
    const table = await mcpSearch(server, {
      corpus_ids: [corpusId],
      query: "Policy Table Fixture Control",
      top_k: 5,
    })

    expect(english.result.structuredContent.passages[0]).toMatchObject({
      citation: expect.objectContaining({
        corpus_id: corpusId,
        page_number: 1,
        source_type: "file",
        title: "digital-english-policy.pdf",
      }),
      excerpt: expect.stringContaining("immutable corpus snapshot"),
    })
    expect(croatian.result.structuredContent.passages[0]).toMatchObject({
      citation: expect.objectContaining({
        corpus_id: corpusId,
        page_number: 1,
        title: "digital-croatian-policy.pdf",
      }),
      excerpt: expect.stringContaining("korpuse znanja"),
    })
    expect(multiPage.result.structuredContent.passages[0]).toMatchObject({
      citation: expect.objectContaining({
        page_number: 2,
        title: "multi-page-operations.pdf",
      }),
      excerpt: expect.stringContaining("runtime citations"),
    })
    expect(table.result.structuredContent.passages[0]).toMatchObject({
      citation: expect.objectContaining({
        page_number: 1,
        title: "table-heavy-policy.pdf",
      }),
      excerpt: expect.stringContaining("Policy Table Fixture Control"),
    })

    const disabledSourceId = sourceByTitle(
      sources,
      "digital-english-policy.pdf",
    ).id
    const disableSourceResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/bulk-action`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "pdf-parser-e2e-disable-source",
      },
      payload: {
        action: "disable",
        sourceIds: [disabledSourceId],
      },
    })
    expect(disableSourceResponse.statusCode).toBe(200)
    const disabledSourceSearch = await mcpSearch(server, {
      corpus_ids: [corpusId],
      query: "immutable corpus snapshot",
      top_k: 5,
    })
    expect(disabledSourceSearch.result.structuredContent.passages).toEqual([])

    const draftCorpusId = await createCorpus(server, "Unpublished PDF Corpus")
    await uploadPdfFixture(server, draftCorpusId, "digital-english-policy.pdf")
    const draftIngestResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${draftCorpusId}/ingest`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "pdf-parser-e2e-draft-ingest",
      },
    })
    expect(draftIngestResponse.statusCode).toBe(200)
    const unpublishedSearch = await mcpSearch(server, {
      corpus_ids: [draftCorpusId],
      query: "immutable corpus snapshot",
      top_k: 5,
    })
    expect(unpublishedSearch.result.structuredContent.passages).toEqual([])

    await server.close()
  }, 120_000)
})

async function createCorpus(
  server: ReturnType<typeof buildServer>,
  name: string,
) {
  const response = await server.inject({
    method: "POST",
    url: "/api/admin/knowledge/corpora",
    headers: {
      ...adminHeaders,
      "idempotency-key": randomUUID(),
    },
    payload: {
      accessGroups: [],
      description: "PDF parser E2E acceptance corpus.",
      languageHints: ["en", "hr"],
      name,
    },
  })
  expect(response.statusCode).toBe(201)
  return response.json().corpus.id as string
}

async function uploadPdfFixture(
  server: ReturnType<typeof buildServer>,
  corpusId: string,
  fileName: string,
) {
  const response = await server.inject({
    method: "POST",
    url: `/api/admin/knowledge/corpora/${corpusId}/sources/upload`,
    headers: {
      ...adminHeaders,
      "idempotency-key": randomUUID(),
    },
    payload: {
      contentBase64: readFileSync(join(pdfFixtureRoot, fileName)).toString(
        "base64",
      ),
      fileName,
      mimeType: "application/pdf",
    },
  })
  expect(response.statusCode).toBe(200)
  return response.json().source.id as string
}

async function getCorpusDetail(
  server: ReturnType<typeof buildServer>,
  corpusId: string,
) {
  const response = await server.inject({
    method: "GET",
    url: `/api/admin/knowledge/corpora/${corpusId}`,
    headers: adminHeaders,
  })
  expect(response.statusCode).toBe(200)
  return response.json() as {
    corpus: Record<string, unknown>
    sources: KnowledgeSource[]
  }
}

function sourceByTitle(sources: KnowledgeSource[], title: string) {
  const source = sources.find((candidate) => candidate.title === title)
  expect(source).toBeDefined()
  return source as KnowledgeSource
}

async function mcpSearch(
  server: ReturnType<typeof buildServer>,
  args: Record<string, unknown>,
) {
  const response = await server.inject({
    method: "POST",
    url: "/api/mcp/internal-docs",
    headers: serviceHeaders,
    payload: {
      id: randomUUID(),
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        arguments: args,
        name: "search_internal_docs",
      },
    },
  })
  expect(response.statusCode).toBe(200)
  return response.json() as {
    result: {
      structuredContent: {
        passages: Array<{
          citation: Record<string, unknown>
          excerpt: string
        }>
      }
    }
  }
}

class RecordingObjectStoreClient implements KnowledgeObjectStoreClient {
  bucketCreated = false
  stored = new Map<string, Buffer>()

  async bucketExists(): Promise<boolean> {
    return this.bucketCreated
  }

  async makeBucket(): Promise<void> {
    this.bucketCreated = true
  }

  async putObject(
    bucketName: string,
    objectName: string,
    stream: Buffer | string,
  ): Promise<void> {
    this.stored.set(`${bucketName}/${objectName}`, Buffer.from(stream))
  }

  async presignedGetObject(
    bucketName: string,
    objectName: string,
  ): Promise<string> {
    return `http://minio.test/${bucketName}/${objectName}?signature=test`
  }

  async getObject(bucketName: string, objectName: string): Promise<Buffer> {
    const object = this.stored.get(`${bucketName}/${objectName}`)
    if (!object) {
      throw new Error(`Missing object ${objectName}`)
    }
    return object
  }

  async removeObject(bucketName: string, objectName: string): Promise<void> {
    this.stored.delete(`${bucketName}/${objectName}`)
  }

  storedKeys(): string[] {
    return [...this.stored.keys()]
  }
}
