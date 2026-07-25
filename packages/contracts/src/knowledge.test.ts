import { describe, expect, it } from "vitest"
import {
  addKnowledgeUrlSourceRequestSchema,
  createKnowledgeCorpusRequestSchema,
  hardDeleteKnowledgeCorpusRequestSchema,
  knowledgeArchiveSourceBulkActionRequestSchema,
  knowledgeArchivedSourceSchema,
  knowledgeCitationSchema,
  knowledgeCorpusSchema,
  knowledgeQueryRequestSchema,
  knowledgeSourceBulkActionRequestSchema,
  updateKnowledgeCorpusAccessRequestSchema,
} from "./knowledge"

describe("knowledge contracts", () => {
  it("parses governed corpus records without approve/reject states", () => {
    const corpus = knowledgeCorpusSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Security Policies",
      description: "Admin-published policy corpus.",
      status: "published",
      languageHints: ["hr", "en"],
      publishedSnapshotId: "22222222-2222-4222-8222-222222222222",
      sourceCount: 3,
      chunkCount: 42,
      accessGroups: ["security"],
      createdBy: "admin-1",
      updatedBy: "admin-1",
      createdAt: "2026-05-27T08:00:00.000Z",
      updatedAt: "2026-05-27T09:00:00.000Z",
    })

    expect(corpus.status).toBe("published")
    expect(
      knowledgeCorpusSchema.safeParse({ ...corpus, status: "approved" })
        .success,
    ).toBe(false)
    expect(
      knowledgeCorpusSchema.safeParse({ ...corpus, status: "rejected" })
        .success,
    ).toBe(false)
  })

  it("parses citation fields for file, URL, image, and table answers", () => {
    const citation = knowledgeCitationSchema.parse({
      citation_id: "cite-1",
      corpus_id: "11111111-1111-4111-8111-111111111111",
      snapshot_id: "22222222-2222-4222-8222-222222222222",
      source_id: "33333333-3333-4333-8333-333333333333",
      source_type: "table",
      title: "Policy table",
      row_range: "2-4",
      excerpt: "Admin-only corpus ingestion",
      score: 0.92,
      checksum: "sha256:fixture",
      retrieved_at: "2026-05-27T09:00:00.000Z",
    })

    expect(citation.row_range).toBe("2-4")
  })

  it("normalizes create requests and rejects empty queries", () => {
    expect(
      createKnowledgeCorpusRequestSchema.parse({
        name: "Operations",
      }),
    ).toMatchObject({
      description: "",
      languageHints: [],
      accessGroups: [],
    })
    expect(knowledgeQueryRequestSchema.safeParse({ query: "" }).success).toBe(
      false,
    )
  })

  it("parses URL source acquisition defaults and rejects unsupported modes", () => {
    expect(
      addKnowledgeUrlSourceRequestSchema.parse({
        url: "https://docs.example.test/policy",
      }),
    ).toMatchObject({
      acquisitionMode: "single_page",
      scraper: "safe_fetch",
      url: "https://docs.example.test/policy",
    })
    expect(
      addKnowledgeUrlSourceRequestSchema.parse({
        acquisitionMode: "single_page",
        scraper: "firecrawl",
        title: "Policy",
        url: "https://docs.example.test/policy",
      }),
    ).toMatchObject({
      acquisitionMode: "single_page",
      scraper: "firecrawl",
      title: "Policy",
    })
    expect(
      addKnowledgeUrlSourceRequestSchema.safeParse({
        acquisitionMode: "same_site_crawl",
        url: "https://docs.example.test/policy",
      }).success,
    ).toBe(false)
    expect(
      addKnowledgeUrlSourceRequestSchema.safeParse({
        scraper: "browserless",
        url: "https://docs.example.test/policy",
      }).success,
    ).toBe(false)
  })

  it("parses bounded source bulk lifecycle actions", () => {
    expect(
      knowledgeSourceBulkActionRequestSchema.parse({
        action: "disable",
        sourceIds: ["33333333-3333-4333-8333-333333333333"],
      }),
    ).toMatchObject({
      action: "disable",
      sourceIds: ["33333333-3333-4333-8333-333333333333"],
    })
    expect(
      knowledgeSourceBulkActionRequestSchema.parse({
        action: "hard_delete",
        confirmation: "DELETE",
        sourceIds: ["33333333-3333-4333-8333-333333333333"],
      }),
    ).toMatchObject({
      action: "hard_delete",
      sourceIds: ["33333333-3333-4333-8333-333333333333"],
    })
    expect(
      knowledgeSourceBulkActionRequestSchema.safeParse({
        action: "archive",
        sourceIds: [],
      }).success,
    ).toBe(false)
  })

  it("parses corpus access updates and hard-delete confirmation", () => {
    expect(
      updateKnowledgeCorpusAccessRequestSchema.parse({
        accessGroups: ["security", "hr"],
      }),
    ).toEqual({ accessGroups: ["security", "hr"] })
    expect(updateKnowledgeCorpusAccessRequestSchema.parse({})).toEqual({
      accessGroups: [],
    })
    expect(
      hardDeleteKnowledgeCorpusRequestSchema.parse({
        confirmation: "DELETE",
      }),
    ).toEqual({ confirmation: "DELETE" })
    expect(
      hardDeleteKnowledgeCorpusRequestSchema.safeParse({
        confirmation: "delete",
      }).success,
    ).toBe(false)
  })

  it("parses archived source inventory and restore/delete actions", () => {
    const archivedSource = knowledgeArchivedSourceSchema.parse({
      id: "44444444-4444-4444-8444-444444444444",
      sourceId: "33333333-3333-4333-8333-333333333333",
      corpusId: "11111111-1111-4111-8111-111111111111",
      corpusName: "Security Policies",
      sourceType: "file",
      title: "Archived policy.pdf",
      originalUri: "policy.pdf",
      finalUri: null,
      canonicalUri: null,
      mimeType: "application/pdf",
      checksum: "sha256:archive",
      status: "ready",
      language: "en",
      metadata: {},
      errorDetail: null,
      createdBy: "admin-1",
      createdAt: "2026-05-27T08:00:00.000Z",
      updatedAt: "2026-05-27T08:15:00.000Z",
      archivedBy: "admin-1",
      archivedAt: "2026-05-27T09:00:00.000Z",
    })

    expect(archivedSource.corpusName).toBe("Security Policies")
    expect(
      knowledgeArchiveSourceBulkActionRequestSchema.parse({
        action: "restore",
        archivedSourceIds: [archivedSource.id],
      }),
    ).toMatchObject({
      action: "restore",
      archivedSourceIds: [archivedSource.id],
    })
    expect(
      knowledgeArchiveSourceBulkActionRequestSchema.safeParse({
        action: "hard_delete",
        archivedSourceIds: [],
        confirmation: "DELETE",
      }).success,
    ).toBe(false)
  })
})
