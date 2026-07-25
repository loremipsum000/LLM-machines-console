import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  KnowledgeSnapshot,
  KnowledgeSource,
} from "@llm-machines/contracts"
import {
  ingestKnowledgeSourceContent,
  resetKnowledgeChunksForTest,
  searchKnowledgeChunks,
} from "./ingestion"

const fixtureRoot = join(process.cwd(), "../../test-fixtures/knowledge")
const corpusId = "11111111-1111-4111-8111-111111111111"
const snapshotId = "22222222-2222-4222-8222-222222222222"
const publishedSnapshot: KnowledgeSnapshot = {
  id: snapshotId,
  corpusId,
  version: 1,
  status: "published",
  sourceCount: 1,
  chunkCount: 1,
  metadata: {},
  publishedBy: "admin-1",
  publishedAt: "2026-05-27T10:00:00.000Z",
  createdAt: "2026-05-27T09:00:00.000Z",
}

describe("knowledge ingestion and search", () => {
  beforeEach(() => {
    resetKnowledgeChunksForTest()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("produces Croatian chunks with page-aware citations", async () => {
    const source = sourceFixture("file", "hr-pravilnik.txt", "text/plain")
    const { chunks, extraction } = await ingestKnowledgeSourceContent({
      corpusId,
      snapshotId,
      source,
      content: readFixture("hr-pravilnik.txt"),
    })
    const result = searchKnowledgeChunks(
      { query: "korpuse znanja", topK: 5 },
      { allowedCorpusIds: [corpusId], snapshots: [publishedSnapshot] },
    )

    expect(extraction.language).toBe("hr")
    expect(chunks[0]).toMatchObject({
      language: "hr",
      pageNumber: 1,
    })
    expect(result.results[0]?.citation.page_number).toBe(1)
  })

  it("stores URL snapshot metadata and does not need a live fetch for search", async () => {
    const source = {
      ...sourceFixture("url", "url-policy.html", "text/html"),
      originalUri: "https://docs.example.test/governed-url-corpus",
      finalUri: "https://docs.example.test/governed-url-corpus",
    }
    const { extraction } = await ingestKnowledgeSourceContent({
      corpusId,
      snapshotId,
      source,
      content: readFixture("url-policy.html"),
    })
    const result = searchKnowledgeChunks(
      { query: "stored snapshot", topK: 5 },
      { allowedCorpusIds: [corpusId], snapshots: [publishedSnapshot] },
    )

    expect(extraction.metadata).toMatchObject({
      finalUri: "https://docs.example.test/governed-url-corpus",
      canonicalUri: "https://docs.example.test/governed-url-corpus",
      redirectChain: [],
    })
    expect(result.results[0]?.citation.uri).toBe(
      "https://docs.example.test/governed-url-corpus",
    )
  })

  it("chunks CSV/XLSX-style table rows with row-range citations", async () => {
    const source = sourceFixture("table", "table-policy.csv", "text/csv")
    const { chunks } = await ingestKnowledgeSourceContent({
      corpusId,
      snapshotId,
      source,
      content: readFixture("table-policy.csv"),
    })
    const result = searchKnowledgeChunks(
      { query: "Admin-only corpus ingestion", topK: 5 },
      { allowedCorpusIds: [corpusId], snapshots: [publishedSnapshot] },
    )

    expect(chunks[0]?.rowRange).toBe("2")
    expect(result.results[0]?.citation.row_range).toBe("2")
  })

  it("extracts image OCR fixtures or records weak OCR warnings", async () => {
    const source = sourceFixture("image", "image-ocr.jpg", "image/jpeg")
    const { chunks, extraction } = await ingestKnowledgeSourceContent({
      corpusId,
      snapshotId,
      source,
      content: readFixture("image-ocr.jpg"),
    })
    const result = searchKnowledgeChunks(
      { query: "administrator odobrava", topK: 5 },
      { allowedCorpusIds: [corpusId], snapshots: [publishedSnapshot] },
    )

    expect(extraction.warnings).toEqual([])
    expect(chunks[0]?.imageRegion).toBe("full-image")
    expect(result.results[0]?.citation.image_region).toBe("full-image")
  })

  it("limits retrieval to published snapshots", async () => {
    const source = sourceFixture("file", "en-safety.pdf", "application/pdf")
    await ingestKnowledgeSourceContent({
      corpusId,
      snapshotId,
      source,
      content: readFixture("en-safety.pdf"),
    })

    const result = searchKnowledgeChunks(
      { query: "immutable corpus snapshot", topK: 5 },
      {
        allowedCorpusIds: [corpusId],
        snapshots: [{ ...publishedSnapshot, status: "staged" }],
      },
    )

    expect(result.results).toEqual([])
  })

  it("routes extraction through the configured sidecar", async () => {
    vi.stubEnv("KNOWLEDGE_SIDECAR_URL", "http://sidecar.test")
    vi.stubEnv("KNOWLEDGE_SIDECAR_SERVICE_TOKEN", "sidecar-token")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              chunks: [
                {
                  content: "Sidecar extracted Croatian korpus znanja.",
                  language: "hr",
                  page_number: 3,
                  search_text: "Sidecar extracted Croatian korpus znanja.",
                },
              ],
              language: "hr",
              metadata: { parser: "sidecar" },
              text: "Sidecar extracted Croatian korpus znanja.",
              warnings: [],
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
      ) as unknown as typeof fetch,
    )
    const source = sourceFixture(
      "file",
      "hr-pravilnik.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )

    const { chunks, extraction } = await ingestKnowledgeSourceContent({
      content: readFixture("hr-pravilnik.docx"),
      corpusId,
      snapshotId,
      source,
    })

    expect(fetch).toHaveBeenCalledWith(
      "http://sidecar.test/v1/knowledge/extract",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-LLM-Machines-Sidecar-Token": "sidecar-token",
        }),
        method: "POST",
      }),
    )
    expect(extraction.metadata).toMatchObject({ parser: "sidecar" })
    expect(chunks[0]).toMatchObject({
      language: "hr",
      pageNumber: 3,
    })
  })

  it("routes PDF extraction through the configured PDF parser", async () => {
    vi.stubEnv("KNOWLEDGE_PDF_PARSER_URL", "http://pdf-parser.test")
    vi.stubEnv("KNOWLEDGE_PDF_PARSER_SERVICE_TOKEN", "pdf-parser-token")
    vi.stubEnv("KNOWLEDGE_SIDECAR_URL", "http://sidecar.test")
    vi.stubEnv("KNOWLEDGE_SIDECAR_SERVICE_TOKEN", "sidecar-token")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              chunks: [
                {
                  content: "PDF parser extracted immutable corpus snapshot.",
                  language: "en",
                  page_number: 2,
                  search_text: "PDF parser extracted immutable corpus snapshot.",
                  section_path: "Policy > Publishing",
                },
              ],
              language: "en",
              metadata: {
                elapsed_ms: 42,
                element_count: 3,
                page_count: 2,
                parser: "opendataloader-pdf",
                parser_version: "2.4.7",
              },
              text: "PDF parser extracted immutable corpus snapshot.",
              warnings: [],
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
      ) as unknown as typeof fetch,
    )
    const source = sourceFixture("file", "digital-policy.pdf", "application/pdf")

    const { chunks, extraction } = await ingestKnowledgeSourceContent({
      content: readFixture("pdf-parser/digital-english-policy.pdf"),
      corpusId,
      snapshotId,
      source,
    })

    expect(fetch).toHaveBeenCalledWith(
      "http://pdf-parser.test/v1/pdf/extract",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-LLM-Machines-Pdf-Parser-Token": "pdf-parser-token",
        }),
        method: "POST",
      }),
    )
    expect(extraction.metadata).toMatchObject({
      parser: "opendataloader-pdf",
      parser_version: "2.4.7",
    })
    expect(chunks[0]).toMatchObject({
      pageNumber: 2,
      sectionPath: "Policy > Publishing",
    })
  })

  it("keeps non-PDF extraction on the sidecar when the PDF parser is configured", async () => {
    vi.stubEnv("KNOWLEDGE_PDF_PARSER_URL", "http://pdf-parser.test")
    vi.stubEnv("KNOWLEDGE_PDF_PARSER_SERVICE_TOKEN", "pdf-parser-token")
    vi.stubEnv("KNOWLEDGE_SIDECAR_URL", "http://sidecar.test")
    vi.stubEnv("KNOWLEDGE_SIDECAR_SERVICE_TOKEN", "sidecar-token")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              chunks: [
                {
                  content: "Sidecar still handles DOCX extraction.",
                  language: "en",
                  page_number: 1,
                  search_text: "Sidecar still handles DOCX extraction.",
                },
              ],
              language: "en",
              metadata: { parser: "sidecar" },
              text: "Sidecar still handles DOCX extraction.",
              warnings: [],
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
      ) as unknown as typeof fetch,
    )
    const source = sourceFixture(
      "file",
      "hr-pravilnik.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )

    await ingestKnowledgeSourceContent({
      content: readFixture("hr-pravilnik.docx"),
      corpusId,
      snapshotId,
      source,
    })

    expect(fetch).toHaveBeenCalledWith(
      "http://sidecar.test/v1/knowledge/extract",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-LLM-Machines-Sidecar-Token": "sidecar-token",
        }),
        method: "POST",
      }),
    )
  })

  it("fails closed when PDF parser URL is configured without a service token", async () => {
    vi.stubEnv("KNOWLEDGE_PDF_PARSER_URL", "http://pdf-parser.test")
    vi.stubEnv("KNOWLEDGE_SIDECAR_URL", "http://sidecar.test")
    vi.stubEnv("KNOWLEDGE_SIDECAR_SERVICE_TOKEN", "sidecar-token")
    const source = sourceFixture("file", "digital-policy.pdf", "application/pdf")

    await expect(
      ingestKnowledgeSourceContent({
        content: readFixture("pdf-parser/digital-english-policy.pdf"),
        corpusId,
        snapshotId,
        source,
      }),
    ).rejects.toThrow("Knowledge PDF parser service token is not configured.")
  })

  it("fails closed when sidecar URL is configured without a service token", async () => {
    vi.stubEnv("KNOWLEDGE_SIDECAR_URL", "http://sidecar.test")
    const source = sourceFixture("file", "hr-pravilnik.txt", "text/plain")

    await expect(
      ingestKnowledgeSourceContent({
        content: readFixture("hr-pravilnik.txt"),
        corpusId,
        snapshotId,
        source,
      }),
    ).rejects.toThrow("Knowledge sidecar service token is not configured.")
  })

  it("rejects sidecar responses above the configured response cap", async () => {
    vi.stubEnv("KNOWLEDGE_SIDECAR_URL", "http://sidecar.test")
    vi.stubEnv("KNOWLEDGE_SIDECAR_SERVICE_TOKEN", "sidecar-token")
    vi.stubEnv("KNOWLEDGE_SIDECAR_MAX_RESPONSE_BYTES", "32")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ text: "x".repeat(100) }), {
            headers: { "Content-Length": "128" },
            status: 200,
          }),
      ) as unknown as typeof fetch,
    )
    const source = sourceFixture("file", "hr-pravilnik.txt", "text/plain")

    await expect(
      ingestKnowledgeSourceContent({
        content: readFixture("hr-pravilnik.txt"),
        corpusId,
        snapshotId,
        source,
      }),
    ).rejects.toThrow("Knowledge sidecar response exceeded the allowed size.")
  })
})

function sourceFixture(
  sourceType: KnowledgeSource["sourceType"],
  fileName: string,
  mimeType: string,
): KnowledgeSource {
  return {
    id: randomUUID(),
    corpusId,
    sourceType,
    title: fileName,
    originalUri: fileName,
    finalUri: null,
    canonicalUri: null,
    mimeType,
    checksum: `sha256:${fileName}`,
    status: "ready",
    language: null,
    metadata: {},
    errorDetail: null,
    createdBy: "admin-1",
    createdAt: "2026-05-27T09:00:00.000Z",
    updatedAt: "2026-05-27T09:00:00.000Z",
  }
}

function readFixture(name: string): Buffer {
  return readFileSync(join(fixtureRoot, name))
}
