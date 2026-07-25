import { randomUUID } from "node:crypto"
import type {
  AdminUrlPolicyRule,
  CreateAdminUrlPolicyRuleRequest,
  KnowledgeArchivedSource,
} from "@llm-machines/contracts"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import { resetAdminSettingsForTest } from "../services/admin-settings"
import {
  getAuditEventsForTest,
  resetAuditEventsForTest,
} from "../services/audit"
import { resetIdempotencyForTest } from "../services/idempotency"
import {
  dropKnowledgeSourceContentForTest,
  listKnowledgeUrlAcquisitionJobsForTest,
  resetKnowledgeStateForTest,
  runKnowledgeUrlAcquisitionWorkerBatch,
  setKnowledgeDurableRepositoryOverrideForTest,
  setKnowledgeObjectStoreForTest,
} from "../services/knowledge/admin"
import {
  KnowledgeObjectStore,
  type KnowledgeObjectStoreClient,
} from "../services/knowledge/object-store"
import type {
  KnowledgeDurableRepository,
  KnowledgeDurableState,
  KnowledgeSourceArtifactInput,
  KnowledgeUrlAcquisitionJob,
} from "../services/knowledge/repository"

const adminHeaders = {
  authorization: "Bearer test-service-key",
  "x-llm-machines-keycloak-token": "",
  "x-llm-machines-user-sub": "admin-1",
  "x-llm-machines-user-email": "admin@example.test",
  "x-llm-machines-user-roles": "admin",
}

const builderHeaders = {
  ...adminHeaders,
  "x-llm-machines-user-sub": "builder-1",
  "x-llm-machines-user-email": "builder@example.test",
  "x-llm-machines-user-roles": "builder",
}

const consumerHeaders = {
  ...adminHeaders,
  "x-llm-machines-user-sub": "consumer-1",
  "x-llm-machines-user-email": "consumer@example.test",
  "x-llm-machines-user-roles": "consumer",
}

describe("Knowledge Admin routes", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetAuditEventsForTest()
    resetIdempotencyForTest()
    resetAdminSettingsForTest()
    resetKnowledgeStateForTest()
  })

  it("lets admins create a corpus and add URL/upload sources", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/admin/knowledge/corpora",
      headers: {
        ...adminHeaders,
        "idempotency-key": "knowledge-create-1",
      },
      payload: {
        name: "Security Policies",
        description: "Admin-governed policy corpus.",
        languageHints: ["hr", "en"],
        accessGroups: ["security"],
      },
    })
    const corpusId = createResponse.json().corpus.id as string

    const urlResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/url`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "knowledge-url-1",
      },
      payload: {
        url: "https://docs.example.test/security-policy",
        title: "Security policy URL",
      },
    })
    const uploadResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/upload`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "knowledge-upload-1",
      },
      payload: {
        fileName: "policy.csv",
        mimeType: "text/csv",
        contentBase64: Buffer.from("id,title\n1,Admin-only").toString("base64"),
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })

    expect(createResponse.statusCode).toBe(201)
    expect(urlResponse.statusCode).toBe(200)
    expect(uploadResponse.statusCode).toBe(200)
    expect(detailResponse.json()).toMatchObject({
      corpus: {
        id: corpusId,
        sourceCount: 2,
      },
      sources: [
        expect.objectContaining({
          sourceType: "url",
          originalUri: "https://docs.example.test/security-policy",
          status: "fetching",
          metadata: expect.objectContaining({
            acquisition: expect.objectContaining({
              adapter: "safe_fetch",
              mode: "single_page",
              status: "queued",
            }),
          }),
        }),
        expect.objectContaining({
          sourceType: "table",
          mimeType: "text/csv",
        }),
      ],
    })
    expect(listKnowledgeUrlAcquisitionJobsForTest()).toEqual([
      expect.objectContaining({
        adapter: "safe_fetch",
        normalizedUrl: "https://docs.example.test/security-policy",
        sourceId: urlResponse.json().source.id,
        status: "queued",
      }),
    ])
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "knowledge.corpus.created",
          targetType: "knowledge.corpus",
        }),
        expect.objectContaining({
          action: "knowledge.source.added",
          targetType: "knowledge.source",
        }),
      ]),
    )

    await server.close()
  })

  it("accepts markdown uploads as file sources", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const corpusId = await createCorpus(server)

    const uploadResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/upload`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "knowledge-upload-md",
      },
      payload: {
        fileName: "runbook.md",
        mimeType: "text/markdown",
        contentBase64: Buffer.from("# Runbook\nCroatian: pravila.").toString(
          "base64",
        ),
      },
    })

    expect(uploadResponse.statusCode).toBe(200)
    expect(uploadResponse.json().source).toMatchObject({
      sourceType: "file",
      mimeType: "text/markdown",
      originalUri: "runbook.md",
    })

    await server.close()
  })

  it("stores uploaded originals in object storage without exposing credentials", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const objectClient = new RecordingObjectStoreClient()
    setKnowledgeObjectStoreForTest(
      new KnowledgeObjectStore(objectClient, "console-knowledge"),
    )
    const server = buildServer()
    const corpusId = await createCorpus(server)

    await uploadSource(server, corpusId, {
      fileName: "policy.pdf",
      mimeType: "application/pdf",
      content: "Governed PDF text",
      idempotencyKey: "object-store-upload",
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })
    const serialized = JSON.stringify(detailResponse.json())

    expect([...objectClient.stored.keys()][0]).toContain(
      `console-knowledge/knowledge/corpora/${corpusId}/sources/`,
    )
    expect(detailResponse.json().sources[0].metadata).toMatchObject({
      artifacts: expect.objectContaining({
        originalObject: expect.objectContaining({
          checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          contentType: "application/pdf",
          sizeBytes: 17,
        }),
        originalObjectKey: expect.stringContaining(
          `/corpora/${corpusId}/sources/`,
        ),
      }),
    })
    expect(serialized).not.toContain("MINIO_ACCESS_KEY")
    expect(serialized).not.toContain("MINIO_SECRET_KEY")
    expect(serialized).not.toContain("console-dev-only")
    expect(serialized).not.toContain("console-knowledge")

    await server.close()
  })

  it("hydrates uploaded corpus metadata from the durable repository after restart", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const repository = new MemoryKnowledgeDurableRepository()
    setKnowledgeDurableRepositoryOverrideForTest(repository)
    const server = buildServer()
    const corpusId = await createCorpus(server)
    const sourceId = await uploadSource(server, corpusId, {
      fileName: "handbook.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content: "Handbook document",
      idempotencyKey: "durable-upload",
    })
    await server.close()

    resetKnowledgeStateForTest()
    setKnowledgeDurableRepositoryOverrideForTest(repository)
    const restartedServer = buildServer()
    const detailResponse = await restartedServer.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })

    expect(detailResponse.statusCode).toBe(200)
    expect(detailResponse.json()).toMatchObject({
      corpus: {
        id: corpusId,
        sourceCount: 1,
      },
      sources: [
        expect.objectContaining({
          id: sourceId,
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          title: "handbook.docx",
        }),
      ],
    })

    await restartedServer.close()
  })

  it("hydrates uploaded originals and published chunks from durable storage after restart", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const repository = new MemoryKnowledgeDurableRepository()
    const objectClient = new RecordingObjectStoreClient()
    const objectStore = new KnowledgeObjectStore(
      objectClient,
      "console-knowledge",
    )
    setKnowledgeDurableRepositoryOverrideForTest(repository)
    setKnowledgeObjectStoreForTest(objectStore)
    const server = buildServer()
    const corpusId = await createCorpus(server)
    await uploadSource(server, corpusId, {
      fileName: "durable.txt",
      mimeType: "text/plain",
      content: "Durable governed chunks survive BFF restart.",
      idempotencyKey: "durable-chunk-upload",
    })
    await server.close()

    resetKnowledgeStateForTest()
    setKnowledgeDurableRepositoryOverrideForTest(repository)
    setKnowledgeObjectStoreForTest(objectStore)
    const ingestionServer = buildServer()
    const ingestResponse = await ingestionServer.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/ingest`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "durable-chunk-ingest",
      },
    })
    const snapshotId = ingestResponse.json().snapshot.id as string
    const publishResponse = await ingestionServer.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/snapshots/${snapshotId}/publish`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "durable-chunk-publish",
      },
    })
    await ingestionServer.close()

    resetKnowledgeStateForTest()
    setKnowledgeDurableRepositoryOverrideForTest(repository)
    setKnowledgeObjectStoreForTest(objectStore)
    const restartedServer = buildServer()
    const retrievalResponse = await restartedServer.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/retrieval-test`,
      headers: adminHeaders,
      payload: {
        corpusIds: [corpusId],
        query: "governed chunks survive",
        topK: 5,
      },
    })

    expect(ingestResponse.statusCode).toBe(200)
    expect(ingestResponse.json().snapshot).toMatchObject({
      chunkCount: 1,
      sourceCount: 1,
      status: "staged",
    })
    expect(publishResponse.statusCode).toBe(200)
    expect(retrievalResponse.statusCode).toBe(200)
    expect(retrievalResponse.json().results[0]).toMatchObject({
      excerpt: expect.stringContaining("governed chunks survive"),
      citation: expect.objectContaining({
        corpus_id: corpusId,
        snapshot_id: snapshotId,
      }),
    })

    await restartedServer.close()
  })

  it("rejects upload JSON bodies above the configured BFF limit", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_BODY_LIMIT_BYTES", "512")
    const server = buildServer()
    const corpusId = await createCorpus(server)

    const response = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/upload`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "body-limit-upload",
      },
      payload: {
        fileName: "large.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("x".repeat(2000)).toString("base64"),
      },
    })

    expect(response.statusCode).toBe(413)

    await server.close()
  })

  it("rejects direct uploads that bypass Web file validation", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const corpusId = await createCorpus(server)
    const oversizedBody = Buffer.alloc(50 * 1024 * 1024 + 1, "x")
    const blockedUploads = [
      {
        idempotencyKey: "upload-oversized-decoded",
        payload: {
          fileName: "large.txt",
          mimeType: "text/plain",
          contentBase64: oversizedBody.toString("base64"),
        },
        expectedDetail: "50 MiB",
      },
      {
        idempotencyKey: "upload-unsupported-extension",
        payload: {
          fileName: "payload.exe",
          mimeType: "text/plain",
          contentBase64: Buffer.from("blocked").toString("base64"),
        },
        expectedDetail: "format is not supported",
      },
      {
        idempotencyKey: "upload-mime-mismatch",
        payload: {
          fileName: "policy.pdf",
          mimeType: "text/plain",
          contentBase64: Buffer.from("%PDF-1.7").toString("base64"),
        },
        expectedDetail: "format is not supported",
      },
      {
        idempotencyKey: "upload-malformed-base64",
        payload: {
          fileName: "policy.txt",
          mimeType: "text/plain",
          contentBase64: "not-base64!!",
        },
        expectedDetail: "strict base64",
      },
      {
        idempotencyKey: "upload-path-filename",
        payload: {
          fileName: "../policy.txt",
          mimeType: "text/plain",
          contentBase64: Buffer.from("blocked").toString("base64"),
        },
        expectedDetail: "simple filename",
      },
    ]

    for (const blocked of blockedUploads) {
      const response = await server.inject({
        method: "POST",
        url: `/api/admin/knowledge/corpora/${corpusId}/sources/upload`,
        headers: {
          ...adminHeaders,
          "idempotency-key": blocked.idempotencyKey,
        },
        payload: blocked.payload,
      })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({
        title: expect.stringContaining(blocked.expectedDetail),
      })
    }

    await server.close()
  })

  it("accepts all supported upload formats through the direct BFF route", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const corpusId = await createCorpus(server)
    const supportedUploads = [
      ["policy.pdf", "application/pdf"],
      [
        "policy.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      ["policy.txt", "text/plain"],
      ["policy.md", "text/markdown"],
      ["policy.html", "text/html"],
      ["policy.csv", "text/csv"],
      ["policy.tsv", "text/tab-separated-values"],
      [
        "policy.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      [
        "policy.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ],
      ["policy.odt", "application/vnd.oasis.opendocument.text"],
      ["policy.ods", "application/vnd.oasis.opendocument.spreadsheet"],
      ["policy.odp", "application/vnd.oasis.opendocument.presentation"],
      ["policy.rtf", "application/rtf"],
      ["policy.eml", "message/rfc822"],
      ["policy.msg", "application/vnd.ms-outlook"],
      ["policy.epub", "application/epub+zip"],
      ["policy.json", "application/json"],
      ["policy.jsonl", "application/x-ndjson"],
      ["policy.xml", "application/xml"],
      ["policy.yaml", "application/x-yaml"],
      ["policy.yml", "text/yaml"],
      ["policy.jpg", "image/jpeg"],
      ["policy.jpeg", "image/jpeg"],
      ["policy.png", "image/png"],
      ["policy.tif", "image/tiff"],
      ["policy.tiff", "image/tiff"],
      ["policy.bmp", "image/bmp"],
      ["policy.webp", "image/webp"],
    ] as const

    for (const [index, [fileName, mimeType]] of supportedUploads.entries()) {
      const response = await server.inject({
        method: "POST",
        url: `/api/admin/knowledge/corpora/${corpusId}/sources/upload`,
        headers: {
          ...adminHeaders,
          "idempotency-key": `upload-supported-${index}`,
        },
        payload: {
          fileName,
          mimeType,
          contentBase64: Buffer.from(`fixture-${index}-${fileName}`).toString(
            "base64",
          ),
        },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().source).toMatchObject({
        mimeType,
        originalUri: fileName,
      })
    }

    await server.close()
  })

  it("blocks Builder and Consumer actors from corpus mutations", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const corpusId = "11111111-1111-4111-8111-111111111111"
    const sourceId = "22222222-2222-4222-8222-222222222222"
    const snapshotId = "33333333-3333-4333-8333-333333333333"
    const mutationRequests = [
      {
        url: "/api/admin/knowledge/corpora",
        payload: { name: "Denied" },
      },
      {
        url: `/api/admin/knowledge/corpora/${corpusId}/sources/url`,
        payload: { url: "https://docs.example.test/denied" },
      },
      {
        url: `/api/admin/knowledge/corpora/${corpusId}/sources/upload`,
        payload: {
          fileName: "denied.txt",
          mimeType: "text/plain",
          contentBase64: Buffer.from("denied").toString("base64"),
        },
      },
      {
        url: `/api/admin/knowledge/corpora/${corpusId}/ingest`,
        payload: undefined,
      },
      {
        url: `/api/admin/knowledge/corpora/${corpusId}/snapshots/${snapshotId}/publish`,
        payload: undefined,
      },
      {
        url: `/api/admin/knowledge/corpora/${corpusId}/snapshots/${snapshotId}/discard`,
        payload: undefined,
      },
      {
        url: `/api/admin/knowledge/corpora/${corpusId}/sources/${sourceId}/retry`,
        payload: undefined,
      },
      {
        url: `/api/admin/knowledge/corpora/${corpusId}/sources/bulk-action`,
        payload: {
          action: "archive",
          sourceIds: [sourceId],
        },
      },
      {
        url: `/api/admin/knowledge/corpora/${corpusId}/sources/bulk-action`,
        payload: {
          action: "disable",
          sourceIds: [sourceId],
        },
      },
      {
        url: "/api/admin/knowledge/archive/sources/bulk-action",
        payload: {
          action: "restore",
          archivedSourceIds: [sourceId],
        },
      },
      {
        url: `/api/admin/knowledge/corpora/${corpusId}/access`,
        payload: {
          accessGroups: ["security"],
        },
      },
      {
        url: `/api/admin/knowledge/corpora/${corpusId}/hard-delete`,
        payload: {
          confirmation: "DELETE",
        },
      },
      {
        url: `/api/admin/knowledge/corpora/${corpusId}/refresh`,
        payload: undefined,
      },
      {
        url: `/api/admin/knowledge/corpora/${corpusId}/disable`,
        payload: undefined,
      },
      {
        url: `/api/admin/knowledge/corpora/${corpusId}/archive`,
        payload: undefined,
      },
    ]

    for (const headers of [builderHeaders, consumerHeaders]) {
      for (const [index, request] of mutationRequests.entries()) {
        const response = await server.inject({
          method: "POST",
          url: request.url,
          headers: {
            ...headers,
            "idempotency-key": `denied-${headers["x-llm-machines-user-sub"]}-${index}`,
          },
          payload: request.payload,
        })
        expect(response.statusCode).toBe(403)
      }
    }

    await server.close()
  })

  it("updates corpus access groups and audits the permission boundary", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const corpusId = await createCorpus(server)

    const response = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/access`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "access-update-1",
      },
      payload: {
        accessGroups: ["security", "hr", "security", "Everyone"],
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().corpus.accessGroups).toEqual(["security", "hr"])
    expect(detailResponse.json().corpus.accessGroups).toEqual([
      "security",
      "hr",
    ])
    expect(getAuditEventsForTest().map((event) => event.action)).toContain(
      "knowledge.corpus.access_updated",
    )

    await server.close()
  })

  it("normalizes virtual Everyone to unrestricted access on corpus create", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/knowledge/corpora",
      headers: {
        ...adminHeaders,
        "idempotency-key": "knowledge-create-everyone",
      },
      payload: {
        name: "Open Knowledge",
        accessGroups: ["Everyone"],
      },
    })
    const corpusId = response.json().corpus.id as string
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().corpus.accessGroups).toEqual([])
    expect(detailResponse.json().corpus.accessGroups).toEqual([])

    await server.close()
  })

  it("rejects duplicate URL and upload sources in a corpus", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const corpusId = await createCorpus(server)

    const firstUrlResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/url`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "duplicate-url-1",
      },
      payload: {
        url: "https://docs.example.test/policy?a=1&b=2#section",
      },
    })
    const duplicateUrlResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/url`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "duplicate-url-2",
      },
      payload: {
        url: "https://docs.example.test/policy/?b=2&a=1",
      },
    })
    const firstUploadResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/upload`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "duplicate-upload-1",
      },
      payload: {
        contentBase64: Buffer.from("same uploaded body").toString("base64"),
        fileName: "policy-a.txt",
        mimeType: "text/plain",
      },
    })
    const duplicateUploadResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/upload`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "duplicate-upload-2",
      },
      payload: {
        contentBase64: Buffer.from("same uploaded body").toString("base64"),
        fileName: "policy-b.txt",
        mimeType: "text/plain",
      },
    })

    expect(firstUrlResponse.statusCode).toBe(200)
    expect(duplicateUrlResponse.statusCode).toBe(409)
    expect(duplicateUrlResponse.json()).toMatchObject({
      title: "Duplicate URL source.",
    })
    expect(firstUploadResponse.statusCode).toBe(200)
    expect(duplicateUploadResponse.statusCode).toBe(409)
    expect(duplicateUploadResponse.json()).toMatchObject({
      title: "Duplicate upload source.",
    })

    await server.close()
  })

  it("requires idempotency keys for Admin corpus mutations", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/knowledge/corpora",
      headers: adminHeaders,
      payload: {
        name: "Missing idempotency",
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      title: "Idempotency key is required",
    })

    await server.close()
  })

  it("rejects invalid URL schemes and private/local targets", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const corpusId = await createCorpus(server)

    for (const [index, url] of [
      "file:///tmp/source.html",
      "http://localhost/source.html",
      "http://127.0.0.1/source.html",
      "http://10.0.0.8/source.html",
      "http://192.168.1.20/source.html",
      "http://169.254.1.20/source.html",
      "http://[::1]/source.html",
      "http://[fe80::1]/source.html",
      "http://[fc00::1]/source.html",
      "http://[fd00::1]/source.html",
    ].entries()) {
      const response = await server.inject({
        method: "POST",
        url: `/api/admin/knowledge/corpora/${corpusId}/sources/url`,
        headers: {
          ...adminHeaders,
          "idempotency-key": `invalid-url-${index}`,
        },
        payload: { url },
      })
      expect(response.statusCode).toBe(409)
    }

    await server.close()
  })

  it("applies URL governance rules to Knowledge URL ingestion", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const corpusId = await createCorpus(server)

    const trustedRule = await createUrlPolicyRule(server, {
      type: "trusted",
      pattern: "docs.example.test",
      scope: "knowledge_ingestion",
      reason: "Approved documentation domain.",
    })
    const trustedResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/url`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "url-policy-trusted-knowledge",
      },
      payload: {
        url: "https://docs.example.test/policy",
      },
    })

    const forbiddenRule = await createUrlPolicyRule(server, {
      type: "forbidden",
      pattern: "blocked.example.test",
      scope: "all",
      reason: "Blocked by governance policy.",
    })
    const blockedResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/url`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "url-policy-forbidden-knowledge",
      },
      payload: {
        url: "https://blocked.example.test/policy",
      },
    })

    await createUrlPolicyRule(server, {
      type: "trusted",
      pattern: "example.test",
      scope: "all",
      reason: "Broad trusted parent domain.",
    })
    const overlappingForbiddenRule = await createUrlPolicyRule(server, {
      type: "forbidden",
      pattern: "docs.example.test",
      scope: "knowledge_ingestion",
      reason: "Specific domain temporarily blocked.",
    })
    const overlapResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/url`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "url-policy-forbidden-wins",
      },
      payload: {
        url: "https://docs.example.test/blocked-after-trust",
      },
    })

    expect(trustedResponse.statusCode).toBe(200)
    expect(trustedResponse.json().source.metadata).toMatchObject({
      urlPolicy: {
        matchedRuleIds: [trustedRule.id],
        mode: "trusted",
        scope: "knowledge_ingestion",
      },
    })
    expect(blockedResponse.statusCode).toBe(409)
    expect(blockedResponse.json()).toMatchObject({
      title: "URL is blocked by URL governance policy.",
    })
    expect(overlapResponse.statusCode).toBe(409)
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "knowledge.url_policy.blocked",
          metadata: expect.objectContaining({
            matchedRuleIds: [forbiddenRule.id],
            mode: "forbidden",
            normalizedUrl: "https://blocked.example.test/policy",
            scope: "knowledge_ingestion",
          }),
        }),
        expect.objectContaining({
          action: "knowledge.url_policy.blocked",
          metadata: expect.objectContaining({
            matchedRuleIds: [overlappingForbiddenRule.id],
            mode: "forbidden",
            normalizedUrl: "https://docs.example.test/blocked-after-trust",
          }),
        }),
      ]),
    )

    await server.close()
  })

  it("rejects Firecrawl URL ingestion unless it is explicitly enabled", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const corpusId = await createCorpus(server)

    const response = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/url`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "url-firecrawl-disabled",
      },
      payload: {
        scraper: "firecrawl",
        url: "https://docs.example.test/policy",
      },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({
      title: "Firecrawl URL ingestion is disabled.",
    })
    expect(listKnowledgeUrlAcquisitionJobsForTest()).toHaveLength(0)

    await server.close()
  })

  it("acquires Firecrawl URL snapshots when explicitly enabled", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("KNOWLEDGE_FIRECRAWL_ENABLED", "true")
    vi.stubEnv("KNOWLEDGE_FIRECRAWL_API_URL", "http://firecrawl.test")
    vi.stubEnv("KNOWLEDGE_FIRECRAWL_VERSION", "v1")
    const objectClient = new RecordingObjectStoreClient()
    setKnowledgeObjectStoreForTest(
      new KnowledgeObjectStore(objectClient, "console-knowledge"),
    )
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              html: "<html><head><title>Firecrawl Policy</title></head><body><main><p>Firecrawl HTML content.</p></main></body></html>",
              markdown: "# Firecrawl Policy\n\nFirecrawl markdown content.",
              metadata: {
                canonicalUrl: "https://docs.example.test/firecrawl-canonical",
                sourceURL: "https://docs.example.test/firecrawl-final",
                title: "Firecrawl Policy",
              },
            },
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        ),
    )
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch)
    const server = buildServer()
    const corpusId = await createCorpus(server)
    const addResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/url`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "url-firecrawl-source",
      },
      payload: {
        scraper: "firecrawl",
        url: "https://docs.example.test/firecrawl",
      },
    })

    const processed = await runKnowledgeUrlAcquisitionWorkerBatch()
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })
    const storedBodies = [...objectClient.stored.values()].map((body) =>
      body.toString("utf8"),
    )

    expect(addResponse.statusCode).toBe(200)
    expect(processed).toBe(1)
    expect(fetchMock).toHaveBeenCalledWith(
      "http://firecrawl.test/v1/scrape",
      expect.objectContaining({
        body: expect.stringContaining('"formats":["markdown","html"]'),
        method: "POST",
      }),
    )
    expect(detailResponse.json().sources[0]).toMatchObject({
      canonicalUri: "https://docs.example.test/firecrawl-canonical",
      finalUri: "https://docs.example.test/firecrawl-final",
      status: "pending",
      title: "Firecrawl Policy",
      metadata: expect.objectContaining({
        artifacts: expect.objectContaining({
          normalized_textObjectKey: expect.stringContaining("normalized_text"),
          url_snapshotObjectKey: expect.stringContaining("url_snapshot"),
        }),
        fetchReport: expect.objectContaining({
          adapter: "firecrawl",
          hasMarkdown: true,
        }),
      }),
    })
    expect(storedBodies.join("\n")).toContain("Firecrawl HTML content.")
    expect(storedBodies.join("\n")).toContain("Firecrawl markdown content.")

    await server.close()
  })

  it("acquires a safe-fetch URL snapshot before ingestion without storing placeholder HTML", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const objectClient = new RecordingObjectStoreClient()
    setKnowledgeObjectStoreForTest(
      new KnowledgeObjectStore(objectClient, "console-knowledge"),
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            '<!doctype html><html><head><title>Fetched Policy</title><link rel="canonical" href="https://docs.example.test/policy-canonical"></head><body><main><h1>Fetched Policy</h1><p>Real URL corpus content.</p></main></body></html>',
            {
              headers: { "Content-Type": "text/html; charset=utf-8" },
              status: 200,
            },
          ),
      ) as unknown as typeof fetch,
    )
    const server = buildServer()
    const corpusId = await createCorpus(server)
    const addResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/url`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "url-safe-fetch-source",
      },
      payload: {
        url: "https://docs.example.test/policy",
      },
    })
    const sourceId = addResponse.json().source.id as string

    const processed = await runKnowledgeUrlAcquisitionWorkerBatch()
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })
    const storedBodies = [...objectClient.stored.values()].map((body) =>
      body.toString("utf8"),
    )

    expect(processed).toBe(1)
    expect(listKnowledgeUrlAcquisitionJobsForTest()).toEqual([
      expect.objectContaining({
        checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        finalUrl: "https://docs.example.test/policy",
        canonicalUrl: "https://docs.example.test/policy-canonical",
        status: "succeeded",
      }),
    ])
    expect(detailResponse.json().sources[0]).toMatchObject({
      id: sourceId,
      canonicalUri: "https://docs.example.test/policy-canonical",
      finalUri: "https://docs.example.test/policy",
      status: "pending",
      title: "Fetched Policy",
      metadata: expect.objectContaining({
        acquisition: expect.objectContaining({ status: "succeeded" }),
        artifacts: expect.objectContaining({
          url_fetch_reportObjectKey:
            expect.stringContaining("url_fetch_report"),
          url_snapshotObjectKey: expect.stringContaining("url_snapshot"),
        }),
        fetchReport: expect.objectContaining({
          adapter: "safe_fetch",
          httpStatus: 200,
        }),
      }),
    })
    expect(storedBodies.join("\n")).toContain("Real URL corpus content.")
    expect(storedBodies.join("\n")).not.toContain(
      "stored snapshot for governed corpus retrieval",
    )

    await server.close()
  })

  it("marks unsupported URL content as failed during acquisition", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("binary", {
            headers: { "Content-Type": "application/pdf" },
            status: 200,
          }),
      ) as unknown as typeof fetch,
    )
    const server = buildServer()
    const corpusId = await createCorpus(server)
    const addResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/url`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "url-unsupported-content",
      },
      payload: {
        url: "https://docs.example.test/policy.pdf",
      },
    })
    const sourceId = addResponse.json().source.id as string

    await runKnowledgeUrlAcquisitionWorkerBatch()
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })

    expect(detailResponse.json().sources).toEqual([
      expect.objectContaining({
        errorDetail: expect.stringContaining("not supported"),
        id: sourceId,
        status: "failed",
      }),
    ])
    expect(listKnowledgeUrlAcquisitionJobsForTest()[0]).toMatchObject({
      errorCode: "unsupported_content_type",
      status: "failed",
    })

    await server.close()
  })

  it("does not enforce disabled forbidden URL rules for future Knowledge ingestion", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const corpusId = await createCorpus(server)
    const forbiddenRule = await createUrlPolicyRule(server, {
      type: "forbidden",
      pattern: "disabled-block.example.test",
      scope: "knowledge_ingestion",
      reason: "Temporarily blocked.",
    })

    const disableResponse = await server.inject({
      method: "POST",
      url: `/api/admin/settings/url-policy/rules/${forbiddenRule.id}/disable`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "url-policy-disable-for-knowledge",
      },
    })
    const addResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/url`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "url-policy-disabled-forbidden-knowledge",
      },
      payload: {
        url: "https://disabled-block.example.test/source",
      },
    })

    expect(disableResponse.statusCode).toBe(200)
    expect(addResponse.statusCode).toBe(200)
    expect(addResponse.json().source.metadata).toMatchObject({
      urlPolicy: {
        matchedRuleIds: [],
        mode: "default_allow",
        scope: "knowledge_ingestion",
      },
    })

    await server.close()
  })

  it("audits ingest, publish, disable, and archive lifecycle actions", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            "<html><head><title>Audit URL</title></head><body>Audit URL source content.</body></html>",
            {
              headers: { "Content-Type": "text/html" },
              status: 200,
            },
          ),
      ) as unknown as typeof fetch,
    )
    const server = buildServer()
    const corpusId = await createCorpus(server)
    await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/url`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "audit-url-1",
      },
      payload: {
        url: "https://docs.example.test/source",
      },
    })
    await runKnowledgeUrlAcquisitionWorkerBatch()
    const ingestResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/ingest`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "audit-ingest-1",
      },
    })
    const snapshotId = ingestResponse.json().snapshot.id as string
    const publishResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/snapshots/${snapshotId}/publish`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "audit-publish-1",
      },
    })
    const disableResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/disable`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "audit-disable-1",
      },
    })
    const archiveResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/archive`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "audit-archive-1",
      },
    })

    expect(ingestResponse.statusCode).toBe(200)
    expect(publishResponse.statusCode).toBe(200)
    expect(disableResponse.statusCode).toBe(200)
    expect(archiveResponse.statusCode).toBe(200)
    expect(getAuditEventsForTest().map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "knowledge.corpus.created",
        "knowledge.source.added",
        "knowledge.ingest.started",
        "knowledge.snapshot.published",
        "knowledge.corpus.disabled",
        "knowledge.corpus.archived",
      ]),
    )

    await server.close()
  })

  it("ingests staged source chunks and returns cited retrieval after publish", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            "<html><head><title>Governed URL Corpus</title></head><body><main><h1>Governed URL Corpus</h1><p>URL corpus supports governed source retrieval.</p></main></body></html>",
            {
              headers: { "Content-Type": "text/html" },
              status: 200,
            },
          ),
      ) as unknown as typeof fetch,
    )
    const server = buildServer()
    const corpusId = await createCorpus(server)

    await uploadSource(server, corpusId, {
      fileName: "hr-pravilnik.txt",
      mimeType: "text/plain",
      content: "Administrator odobrava korpuse znanja za interne pravilnike.",
      idempotencyKey: "retrieval-upload-hr",
    })
    await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/url`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "retrieval-url-1",
      },
      payload: {
        url: "https://docs.example.test/governed-url-corpus",
        title: "Governed URL Corpus",
      },
    })
    await runKnowledgeUrlAcquisitionWorkerBatch()

    const ingestResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/ingest`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "retrieval-ingest-1",
      },
    })
    const snapshotId = ingestResponse.json().snapshot.id as string
    await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/snapshots/${snapshotId}/publish`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "fx-pub",
      },
    })
    const retrievalResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/retrieval-test`,
      headers: adminHeaders,
      payload: {
        corpusIds: [corpusId],
        query: "korpuse znanja",
        topK: 5,
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })

    expect(ingestResponse.statusCode).toBe(200)
    expect(ingestResponse.json().snapshot).toMatchObject({
      status: "staged",
      chunkCount: 2,
    })
    expect(retrievalResponse.statusCode).toBe(200)
    expect(retrievalResponse.json().results[0]).toMatchObject({
      excerpt: expect.stringContaining("korpuse znanja"),
      citation: expect.objectContaining({
        corpus_id: corpusId,
        page_number: 1,
      }),
    })
    expect(detailResponse.json().sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({
            artifacts: expect.objectContaining({
              normalizedObjectKey: expect.stringContaining(
                `/snapshots/${snapshotId}/sources/`,
              ),
              originalObjectKey: expect.stringContaining(
                `/corpora/${corpusId}/sources/`,
              ),
            }),
          }),
        }),
      ]),
    )

    await server.close()
  })

  it("stores sidecar parser reports for admin detail without leaking warnings into retrieval", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("KNOWLEDGE_SIDECAR_URL", "http://sidecar.test")
    vi.stubEnv("KNOWLEDGE_SIDECAR_SERVICE_TOKEN", "sidecar-token")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              artifacts: {
                parser_report: {
                  bytes: 48,
                  chunksCreated: 1,
                  citationsCreated: 1,
                  detectedType: "txt",
                  durationMs: 4,
                  fallbackParser: "local_text_family",
                  licenseStatus: "Apache-2.0/MIT pending dependency",
                  pageUnits: 1,
                  parserPriority: 90,
                  qualityScore: 0.85,
                  qualityWarnings: ["tesseract_unavailable"],
                  registryProfile: "unstructured_markitdown_fallback_pending",
                  selectedParser: "unstructured_markitdown_fallback_pending",
                },
              },
              chunks: [
                {
                  content: "Parser report corpus answers cite local chunks.",
                  language: "en",
                  page_number: 1,
                  search_text:
                    "Parser report corpus answers cite local chunks.",
                  section_path: "Parser Report",
                },
              ],
              language: "en",
              metadata: {
                parser_report: {
                  selectedParser: "unstructured_markitdown_fallback_pending",
                  qualityWarnings: ["tesseract_unavailable"],
                },
              },
              text: "Parser report corpus answers cite local chunks.",
              warnings: ["tesseract_unavailable"],
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
      ) as unknown as typeof fetch,
    )
    const server = buildServer()
    const corpusId = await createCorpus(server)

    await uploadSource(server, corpusId, {
      fileName: "parser-report.txt",
      mimeType: "text/plain",
      content: "Parser report corpus source.",
      idempotencyKey: "parser-report-upload",
    })

    const ingestResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/ingest`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "parser-report-ingest",
      },
    })
    const snapshotId = ingestResponse.json().snapshot.id as string
    const publishResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/snapshots/${snapshotId}/publish`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "parser-report-publish",
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })
    const retrievalResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/retrieval-test`,
      headers: adminHeaders,
      payload: {
        corpusIds: [corpusId],
        query: "Parser report corpus",
        topK: 5,
      },
    })

    expect(ingestResponse.statusCode).toBe(200)
    expect(publishResponse.statusCode).toBe(200)
    expect(detailResponse.json().sources[0].metadata).toMatchObject({
      extraction: expect.objectContaining({
        parser_report: expect.objectContaining({
          qualityWarnings: ["tesseract_unavailable"],
          selectedParser: "unstructured_markitdown_fallback_pending",
        }),
      }),
    })
    expect(retrievalResponse.statusCode).toBe(200)
    expect(retrievalResponse.json().results[0]).toMatchObject({
      citation: expect.objectContaining({
        corpus_id: corpusId,
        page_number: 1,
      }),
      excerpt: expect.stringContaining("Parser report corpus"),
    })
    expect(JSON.stringify(retrievalResponse.json())).not.toContain(
      "qualityWarnings",
    )
    expect(JSON.stringify(retrievalResponse.json())).not.toContain(
      "tesseract_unavailable",
    )

    await server.close()
  })

  it("stores OpenDataLoader PDF artifacts and returns page-aware PDF citations", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("KNOWLEDGE_PDF_PARSER_URL", "http://pdf-parser.test")
    vi.stubEnv("KNOWLEDGE_PDF_PARSER_SERVICE_TOKEN", "pdf-parser-token")
    const objectClient = new RecordingObjectStoreClient()
    setKnowledgeObjectStoreForTest(
      new KnowledgeObjectStore(objectClient, "console-knowledge"),
    )
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          artifacts: {
            json: {
              kids: [
                { content: "English retention policy.", "page number": 1 },
                { content: "Hrvatski pravilnik.", "page number": 2 },
              ],
              "number of pages": 3,
            },
            markdown:
              "# Policy\nEnglish retention policy.\n\n## Pravilnik\nHrvatski pravilnik.",
            page_map: [
              {
                bounding_box: { height: 10, width: 120, x: 10, y: 20 },
                chunk_index: 0,
                element_id: "en-1",
                page_number: 1,
              },
              {
                bounding_box: { height: 11, width: 130, x: 12, y: 22 },
                chunk_index: 1,
                element_id: "hr-1",
                page_number: 2,
              },
            ],
            parser_report: {
              ocr_mode: "disabled",
              parser: "opendataloader-pdf",
            },
          },
          chunks: [
            {
              content: "English retention policy requires immutable evidence.",
              language: "en",
              page_number: 1,
              search_text:
                "English retention policy requires immutable evidence.",
              section_path: "Policy > Retention",
            },
            {
              content: "Hrvatski pravilnik opisuje odobrenje korpusa.",
              language: "hr",
              page_number: 2,
              search_text: "Hrvatski pravilnik opisuje odobrenje korpusa.",
              section_path: "Pravilnik",
            },
            {
              content: "| owner | control |\n| Admin | ingestion |",
              language: "en",
              page_number: 3,
              row_range: "1-2",
              search_text: "table controls owner control Admin ingestion",
              section_path: "Tables",
            },
          ],
          language: "en",
          metadata: {
            elapsed_ms: 42,
            element_count: 9,
            opendataloader_options: ["--format", "json,markdown"],
            page_count: 3,
            parser: "opendataloader-pdf",
            parser_version: "2.4.7",
          },
          text: "English retention policy. Hrvatski pravilnik. table controls.",
          warnings: ["table_structure_detected"],
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const corpusId = await createCorpus(server)

    await uploadSource(server, corpusId, {
      fileName: "opendataloader-policy.pdf",
      mimeType: "application/pdf",
      content: "%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF",
      idempotencyKey: "opendataloader-pdf-upload",
    })

    const ingestResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/ingest`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "opendataloader-pdf-ingest",
      },
    })
    const snapshotId = ingestResponse.json().snapshot.id as string
    await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/snapshots/${snapshotId}/publish`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "opendataloader-pdf-publish",
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })
    const englishResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/retrieval-test`,
      headers: adminHeaders,
      payload: {
        corpusIds: [corpusId],
        query: "immutable evidence",
        topK: 5,
      },
    })
    const croatianResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/retrieval-test`,
      headers: adminHeaders,
      payload: {
        corpusIds: [corpusId],
        query: "Hrvatski pravilnik",
        topK: 5,
      },
    })
    const tableResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/retrieval-test`,
      headers: adminHeaders,
      payload: {
        corpusIds: [corpusId],
        query: "table controls",
        topK: 5,
      },
    })

    const detail = detailResponse.json()
    const artifacts = detail.sources[0].metadata.artifacts
    const serializedDetail = JSON.stringify(detail)
    const storedKeys = [...objectClient.stored.keys()]
    const normalizedJsonKey = storedKeys.find((key) =>
      key.endsWith("/normalized.json"),
    )

    expect(fetchMock).toHaveBeenCalledWith(
      "http://pdf-parser.test/v1/pdf/extract",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-LLM-Machines-Pdf-Parser-Token": "pdf-parser-token",
        }),
      }),
    )
    expect(ingestResponse.statusCode).toBe(200)
    expect(ingestResponse.json().snapshot).toMatchObject({
      chunkCount: 3,
      metadata: expect.objectContaining({
        sourceWarnings: expect.objectContaining({
          [detail.sources[0].id]: ["table_structure_detected"],
        }),
      }),
    })
    expect(artifacts).toMatchObject({
      normalizedArtifactKeys: expect.objectContaining({
        json: expect.stringContaining("/normalized.json"),
        markdown: expect.stringContaining("/normalized.md"),
        pageMap: expect.stringContaining("/page-map.json"),
        parserReport: expect.stringContaining("/parser-report.json"),
      }),
      normalizedArtifacts: expect.objectContaining({
        json: expect.objectContaining({
          checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          contentType: "application/json",
        }),
        markdown: expect.objectContaining({
          contentType: "text/markdown; charset=utf-8",
        }),
      }),
      normalizedMarkdownObjectKey: expect.stringContaining("/normalized.md"),
      normalizedObjectKey: expect.stringContaining("/normalized.json"),
      normalizedPageMapObjectKey: expect.stringContaining("/page-map.json"),
      normalizedParserReportObjectKey: expect.stringContaining(
        "/parser-report.json",
      ),
      originalObjectKey: expect.stringContaining(
        `/corpora/${corpusId}/sources/`,
      ),
    })
    expect(detail.sources[0].metadata.extraction).toMatchObject({
      normalizedArtifactCount: 4,
      page_count: 3,
      parser: "opendataloader-pdf",
      parser_version: "2.4.7",
    })
    expect(storedKeys).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/normalized.json"),
        expect.stringContaining("/normalized.md"),
        expect.stringContaining("/page-map.json"),
        expect.stringContaining("/parser-report.json"),
      ]),
    )
    expect(normalizedJsonKey).toBeDefined()
    expect(objectClient.metadata.get(normalizedJsonKey ?? "")).toMatchObject({
      "Content-Type": "application/json",
      "X-Amz-Meta-Sha256": expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    })
    expect(englishResponse.json().results[0].citation).toMatchObject({
      page_number: 1,
    })
    expect(croatianResponse.json().results[0].citation).toMatchObject({
      page_number: 2,
    })
    expect(tableResponse.json().results[0].citation).toMatchObject({
      page_number: 3,
      row_range: "1-2",
    })
    expect(serializedDetail).not.toContain("pdf-parser-token")
    expect(serializedDetail).not.toContain("MINIO_ACCESS_KEY")
    expect(serializedDetail).not.toContain("MINIO_SECRET_KEY")
    expect(serializedDetail).not.toContain("/tmp/")

    await server.close()
  })

  it("lets Admin review, publish, and retrieval-test uploaded document, table, image, and URL content", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            "<html><head><title>Governed URL Corpus</title></head><body><main><h1>Governed URL Corpus</h1><p>Real acquired URL content supports governed retrieval.</p></main></body></html>",
            {
              headers: { "Content-Type": "text/html" },
              status: 200,
            },
          ),
      ) as unknown as typeof fetch,
    )
    const server = buildServer()
    const corpusId = await createCorpus(server)

    await uploadSource(server, corpusId, {
      fileName: "en-safety.pdf",
      mimeType: "application/pdf",
      content: "Published immutable corpus snapshot for English safety.",
      idempotencyKey: "di4-upload-pdf",
    })
    await uploadSource(server, corpusId, {
      fileName: "hr-pravilnik.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content: "Hrvatski pravilnik u docx-nazvanoj datoteci.",
      idempotencyKey: "di4-upload-docx",
    })
    await uploadSource(server, corpusId, {
      fileName: "table-policy.csv",
      mimeType: "text/csv",
      content: "owner,policy\nAdmin-only,corpus ingestion",
      idempotencyKey: "di4-upload-csv",
    })
    await uploadSource(server, corpusId, {
      fileName: "image-ocr.jpg",
      mimeType: "image/jpeg",
      content: "administrator pregledava izvor prije objave",
      idempotencyKey: "di4-upload-image",
    })
    const urlResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/url`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "di4-url-source",
      },
      payload: {
        title: "Governed URL Corpus",
        url: "https://docs.example.test/governed-url-corpus",
      },
    })
    expect(urlResponse.statusCode).toBe(200)
    await runKnowledgeUrlAcquisitionWorkerBatch()

    const ingestResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/ingest`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "di4-ingest",
      },
    })
    const snapshotId = ingestResponse.json().snapshot.id as string
    const stagedDetailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })
    const publishResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/snapshots/${snapshotId}/publish`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "di4-publish",
      },
    })

    expect(ingestResponse.statusCode).toBe(200)
    expect(stagedDetailResponse.json().snapshots[0]).toMatchObject({
      status: "staged",
      sourceCount: 5,
      metadata: expect.objectContaining({
        failedSourceCount: 0,
        sampleCitations: expect.arrayContaining([
          expect.objectContaining({ page_number: 1, title: "en-safety.pdf" }),
          expect.objectContaining({
            row_range: "2",
            title: "table-policy.csv",
          }),
          expect.objectContaining({
            image_region: "full-image",
            title: "image-ocr.jpg",
          }),
        ]),
      }),
    })
    expect(publishResponse.statusCode).toBe(200)

    await expectRetrievalHit(server, corpusId, {
      query: "immutable corpus snapshot",
      sourceTypes: ["file"],
      citation: { page_number: 1, source_type: "file" },
    })
    await expectRetrievalHit(server, corpusId, {
      query: "docx-nazvanoj",
      sourceTypes: ["file"],
      citation: { page_number: 1, title: "hr-pravilnik.docx" },
    })
    await expectRetrievalHit(server, corpusId, {
      query: "Admin-only corpus ingestion",
      sourceTypes: ["table"],
      citation: { row_range: "2", source_type: "table" },
    })
    await expectRetrievalHit(server, corpusId, {
      query: "prije objave",
      sourceTypes: ["image"],
      citation: { image_region: "full-image", source_type: "image" },
    })
    await expectRetrievalHit(server, corpusId, {
      query: "Real acquired URL content",
      sourceTypes: ["url"],
      citation: {
        source_type: "url",
        uri: "https://docs.example.test/governed-url-corpus",
      },
    })

    await server.close()
  })

  it("marks only failed sources failed without corrupting the staged corpus", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const corpusId = await createCorpus(server)
    const readySourceId = await uploadSource(server, corpusId, {
      fileName: "ready.txt",
      mimeType: "text/plain",
      content: "This source should produce a searchable chunk.",
      idempotencyKey: "partial-ready-upload",
    })
    const missingSourceId = await uploadSource(server, corpusId, {
      fileName: "missing.txt",
      mimeType: "text/plain",
      content: "This source content will be removed before ingestion.",
      idempotencyKey: "partial-missing-upload",
    })
    dropKnowledgeSourceContentForTest(missingSourceId)

    const ingestResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/ingest`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "partial-ingest",
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })

    expect(ingestResponse.statusCode).toBe(200)
    expect(ingestResponse.json().snapshot).toMatchObject({
      status: "staged",
      chunkCount: 1,
      metadata: expect.objectContaining({
        failedSourceCount: 1,
      }),
    })
    expect(detailResponse.json().sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: readySourceId, status: "ready" }),
        expect.objectContaining({ id: missingSourceId, status: "failed" }),
      ]),
    )

    await server.close()
  })

  it("marks only sidecar-timed-out sources failed without corrupting the staged corpus", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("KNOWLEDGE_SIDECAR_URL", "http://sidecar.test")
    vi.stubEnv("KNOWLEDGE_SIDECAR_SERVICE_TOKEN", "sidecar-token")
    vi.stubEnv("KNOWLEDGE_SIDECAR_TIMEOUT_MS", "1")
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        if (fetchMock.mock.calls.length === 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("aborted")
              error.name = "AbortError"
              reject(error)
            })
          })
        }
        return new Response(
          JSON.stringify({
            chunks: [
              {
                content: "The healthy source remained searchable.",
                language: "en",
                page_number: 1,
                search_text: "The healthy source remained searchable.",
              },
            ],
            language: "en",
            metadata: { parser: "sidecar" },
            text: "The healthy source remained searchable.",
            warnings: [],
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        )
      },
    )
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch)
    const server = buildServer()
    const corpusId = await createCorpus(server)
    const timedOutSourceId = await uploadSource(server, corpusId, {
      fileName: "timeout.txt",
      mimeType: "text/plain",
      content: "This source will hit the sidecar timeout.",
      idempotencyKey: "sidecar-timeout-upload",
    })
    const readySourceId = await uploadSource(server, corpusId, {
      fileName: "ready-after-timeout.txt",
      mimeType: "text/plain",
      content: "This source should still ingest.",
      idempotencyKey: "sidecar-ready-upload",
    })

    const ingestResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/ingest`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "sidecar-partial-ingest",
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })

    expect(ingestResponse.statusCode).toBe(200)
    expect(ingestResponse.json().snapshot).toMatchObject({
      status: "staged",
      chunkCount: 1,
      metadata: expect.objectContaining({
        failedSourceCount: 1,
      }),
    })
    expect(detailResponse.json().sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: timedOutSourceId,
          errorDetail: "Knowledge sidecar extraction timed out.",
          status: "failed",
        }),
        expect.objectContaining({ id: readySourceId, status: "ready" }),
      ]),
    )

    await server.close()
  })

  it("marks only PDF-parser-timed-out sources failed without corrupting the staged corpus", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("KNOWLEDGE_PDF_PARSER_URL", "http://pdf-parser.test")
    vi.stubEnv("KNOWLEDGE_PDF_PARSER_SERVICE_TOKEN", "pdf-parser-token")
    vi.stubEnv("KNOWLEDGE_PDF_PARSER_TIMEOUT_MS", "1")
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        if (fetchMock.mock.calls.length === 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("aborted")
              error.name = "AbortError"
              reject(error)
            })
          })
        }
        throw new Error("Only the PDF parser should be called in this test.")
      },
    )
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch)
    const server = buildServer()
    const corpusId = await createCorpus(server)
    const timedOutSourceId = await uploadSource(server, corpusId, {
      fileName: "timeout.pdf",
      mimeType: "application/pdf",
      content: "%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF",
      idempotencyKey: "pdf-parser-timeout-upload",
    })
    const readySourceId = await uploadSource(server, corpusId, {
      fileName: "ready-after-pdf-timeout.txt",
      mimeType: "text/plain",
      content: "This source should still ingest after PDF parser timeout.",
      idempotencyKey: "pdf-parser-ready-upload",
    })

    const ingestResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/ingest`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "pdf-parser-partial-ingest",
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })

    expect(ingestResponse.statusCode).toBe(200)
    expect(ingestResponse.json().snapshot).toMatchObject({
      status: "staged",
      chunkCount: 1,
      metadata: expect.objectContaining({
        failedSourceCount: 1,
      }),
    })
    expect(detailResponse.json().sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: timedOutSourceId,
          errorDetail: "Knowledge PDF parser extraction timed out.",
          status: "failed",
        }),
        expect.objectContaining({ id: readySourceId, status: "ready" }),
      ]),
    )

    await server.close()
  })

  it("marks only corrupt PDF parser failures failed without corrupting the staged corpus", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("KNOWLEDGE_PDF_PARSER_URL", "http://pdf-parser.test")
    vi.stubEnv("KNOWLEDGE_PDF_PARSER_SERVICE_TOKEN", "pdf-parser-token")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: "PDF extraction failed." }), {
            headers: { "Content-Type": "application/json" },
            status: 422,
          }),
      ) as unknown as typeof fetch,
    )
    const server = buildServer()
    const corpusId = await createCorpus(server)
    const corruptSourceId = await uploadSource(server, corpusId, {
      fileName: "corrupt.pdf",
      mimeType: "application/pdf",
      content: "%PDF-1.4\ncorrupt-body\n%%EOF",
      idempotencyKey: "pdf-parser-corrupt-upload",
    })
    const readySourceId = await uploadSource(server, corpusId, {
      fileName: "ready-after-corrupt-pdf.txt",
      mimeType: "text/plain",
      content:
        "This source should still ingest after corrupt PDF parser failure.",
      idempotencyKey: "pdf-parser-corrupt-ready-upload",
    })

    const ingestResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/ingest`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "pdf-parser-corrupt-partial-ingest",
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })

    expect(ingestResponse.statusCode).toBe(200)
    expect(ingestResponse.json().snapshot).toMatchObject({
      status: "staged",
      chunkCount: 1,
      metadata: expect.objectContaining({
        failedSourceCount: 1,
      }),
    })
    expect(detailResponse.json().sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: corruptSourceId,
          errorDetail: "Knowledge PDF parser extraction failed with 422.",
          status: "failed",
        }),
        expect.objectContaining({ id: readySourceId, status: "ready" }),
      ]),
    )

    await server.close()
  })

  it("archives selected sources into the archive store and removes their retrieval content", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const repository = new MemoryKnowledgeDurableRepository()
    setKnowledgeDurableRepositoryOverrideForTest(repository)
    const server = buildServer()
    const corpusId = await createCorpus(server)
    const archivedSourceId = await uploadSource(server, corpusId, {
      fileName: "archive-me.txt",
      mimeType: "text/plain",
      content: "Archive-only content must disappear from retrieval.",
      idempotencyKey: "archive-source-upload",
    })
    const keptSourceId = await uploadSource(server, corpusId, {
      fileName: "keep-me.txt",
      mimeType: "text/plain",
      content: "Kept corpus content remains searchable.",
      idempotencyKey: "archive-kept-upload",
    })
    const ingestResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/ingest`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "archive-source-ingest",
      },
    })
    const snapshotId = ingestResponse.json().snapshot.id as string
    await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/snapshots/${snapshotId}/publish`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "archive-source-publish",
      },
    })

    const archiveResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/bulk-action`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "archive-source-action",
      },
      payload: {
        action: "archive",
        sourceIds: [archivedSourceId],
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })
    const archivedRetrievalResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/retrieval-test`,
      headers: adminHeaders,
      payload: {
        corpusIds: [corpusId],
        query: "Archive-only",
        topK: 5,
      },
    })
    const keptRetrievalResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/retrieval-test`,
      headers: adminHeaders,
      payload: {
        corpusIds: [corpusId],
        query: "Kept corpus",
        topK: 5,
      },
    })

    expect(archiveResponse.statusCode).toBe(200)
    expect(archiveResponse.json()).toMatchObject({
      archivedSourceIds: [archivedSourceId],
      corpus: {
        chunkCount: 1,
        sourceCount: 1,
      },
    })
    expect(repository.archivedSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: archivedSourceId,
          title: "archive-me.txt",
        }),
      ]),
    )
    expect(
      detailResponse.json().sources.map((source: { id: string }) => source.id),
    ).toEqual([keptSourceId])
    expect(archivedRetrievalResponse.json().results).toHaveLength(0)
    expect(keptRetrievalResponse.json().results[0]).toMatchObject({
      sourceId: keptSourceId,
    })
    expect(getAuditEventsForTest().map((event) => event.action)).toContain(
      "knowledge.source.archived",
    )

    await server.close()
  })

  it("lists and restores archived sources from the dedicated archive", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const repository = new MemoryKnowledgeDurableRepository()
    setKnowledgeDurableRepositoryOverrideForTest(repository)
    const server = buildServer()
    const corpusId = await createCorpus(server)
    const sourceId = await uploadSource(server, corpusId, {
      fileName: "restore-me.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content: "Restore this archived source into active intake.",
      idempotencyKey: "restore-archive-upload",
    })
    await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/bulk-action`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "restore-archive-source",
      },
      payload: {
        action: "archive",
        sourceIds: [sourceId],
      },
    })

    const archiveListResponse = await server.inject({
      method: "GET",
      url: "/api/admin/knowledge/archive/sources",
      headers: adminHeaders,
    })
    const archivedSource = archiveListResponse.json()
      .sources[0] as KnowledgeArchivedSource
    const restoreResponse = await server.inject({
      method: "POST",
      url: "/api/admin/knowledge/archive/sources/bulk-action",
      headers: {
        ...adminHeaders,
        "idempotency-key": "restore-archive-action",
      },
      payload: {
        action: "restore",
        archivedSourceIds: [archivedSource.id],
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })
    const archiveListAfterRestoreResponse = await server.inject({
      method: "GET",
      url: "/api/admin/knowledge/archive/sources",
      headers: adminHeaders,
    })

    expect(archiveListResponse.statusCode).toBe(200)
    expect(archivedSource).toMatchObject({
      corpusId,
      corpusName: "Fixture Corpus",
      sourceId,
      title: "restore-me.docx",
    })
    expect(restoreResponse.statusCode).toBe(200)
    expect(restoreResponse.json()).toMatchObject({
      restoredSourceIds: [sourceId],
    })
    expect(detailResponse.json()).toMatchObject({
      corpus: {
        sourceCount: 1,
      },
      sources: [
        expect.objectContaining({
          id: sourceId,
          status: "pending",
          title: "restore-me.docx",
        }),
      ],
    })
    expect(archiveListAfterRestoreResponse.json().sources).toEqual([])
    expect(getAuditEventsForTest().map((event) => event.action)).toContain(
      "knowledge.source.restored",
    )

    await server.close()
  })

  it("hard deletes archived sources only after confirmation and removes stored objects", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const repository = new MemoryKnowledgeDurableRepository()
    const objectClient = new RecordingObjectStoreClient()
    setKnowledgeDurableRepositoryOverrideForTest(repository)
    setKnowledgeObjectStoreForTest(
      new KnowledgeObjectStore(objectClient, "console-knowledge"),
    )
    const server = buildServer()
    const corpusId = await createCorpus(server)
    const sourceId = await uploadSource(server, corpusId, {
      fileName: "archive-delete.png",
      mimeType: "image/png",
      content: "Archived object should be removed only by archive hard delete.",
      idempotencyKey: "delete-archive-upload",
    })
    expect(objectClient.stored.size).toBe(1)
    await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/bulk-action`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "delete-archive-source",
      },
      payload: {
        action: "archive",
        sourceIds: [sourceId],
      },
    })
    const archiveListResponse = await server.inject({
      method: "GET",
      url: "/api/admin/knowledge/archive/sources",
      headers: adminHeaders,
    })
    const archivedSource = archiveListResponse.json()
      .sources[0] as KnowledgeArchivedSource

    const rejectedResponse = await server.inject({
      method: "POST",
      url: "/api/admin/knowledge/archive/sources/bulk-action",
      headers: {
        ...adminHeaders,
        "idempotency-key": "delete-archive-rejected",
      },
      payload: {
        action: "hard_delete",
        archivedSourceIds: [archivedSource.id],
        confirmation: "delete",
      },
    })
    const deleteResponse = await server.inject({
      method: "POST",
      url: "/api/admin/knowledge/archive/sources/bulk-action",
      headers: {
        ...adminHeaders,
        "idempotency-key": "delete-archive-confirmed",
      },
      payload: {
        action: "hard_delete",
        archivedSourceIds: [archivedSource.id],
        confirmation: "DELETE",
      },
    })
    const archiveListAfterDeleteResponse = await server.inject({
      method: "GET",
      url: "/api/admin/knowledge/archive/sources",
      headers: adminHeaders,
    })

    expect(rejectedResponse.statusCode).toBe(409)
    expect(deleteResponse.statusCode).toBe(200)
    expect(deleteResponse.json()).toMatchObject({
      hardDeletedArchivedSourceIds: [archivedSource.id],
    })
    expect(objectClient.stored.size).toBe(0)
    expect(archiveListAfterDeleteResponse.json().sources).toEqual([])
    expect(getAuditEventsForTest().map((event) => event.action)).toContain(
      "knowledge.archive.source.hard_deleted",
    )

    await server.close()
  })

  it("hard deletes selected sources only after explicit confirmation and removes stored objects", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const objectClient = new RecordingObjectStoreClient()
    setKnowledgeObjectStoreForTest(
      new KnowledgeObjectStore(objectClient, "console-knowledge"),
    )
    const server = buildServer()
    const corpusId = await createCorpus(server)
    const sourceId = await uploadSource(server, corpusId, {
      fileName: "delete-me.pdf",
      mimeType: "application/pdf",
      content: "Hard delete object content",
      idempotencyKey: "delete-source-upload",
    })
    expect(objectClient.stored.size).toBe(1)

    const rejectedResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/bulk-action`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "delete-source-rejected",
      },
      payload: {
        action: "hard_delete",
        confirmation: "delete",
        sourceIds: [sourceId],
      },
    })
    const deleteResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/bulk-action`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "delete-source-confirmed",
      },
      payload: {
        action: "hard_delete",
        confirmation: "DELETE",
        sourceIds: [sourceId],
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })

    expect(rejectedResponse.statusCode).toBe(409)
    expect(deleteResponse.statusCode).toBe(200)
    expect(deleteResponse.json()).toMatchObject({
      hardDeletedSourceIds: [sourceId],
      corpus: { sourceCount: 0 },
    })
    expect(detailResponse.json().sources).toEqual([])
    expect(objectClient.stored.size).toBe(0)
    expect(getAuditEventsForTest().map((event) => event.action)).toContain(
      "knowledge.source.hard_deleted",
    )

    await server.close()
  })

  it("disables selected sources while keeping them visible and non-retrievable", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const corpusId = await createCorpus(server)
    const sourceId = await uploadSource(server, corpusId, {
      fileName: "disable-me.txt",
      mimeType: "text/plain",
      content: "Disable-only retrieval content.",
      idempotencyKey: "disable-source-upload",
    })
    const ingestResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/ingest`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "disable-source-ingest",
      },
    })
    const snapshotId = ingestResponse.json().snapshot.id as string
    await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/snapshots/${snapshotId}/publish`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "disable-source-publish",
      },
    })

    const disableResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/bulk-action`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "disable-source-confirmed",
      },
      payload: {
        action: "disable",
        sourceIds: [sourceId],
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })
    const retrievalResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/retrieval-test`,
      headers: adminHeaders,
      payload: {
        corpusIds: [corpusId],
        query: "Disable-only",
        topK: 5,
      },
    })

    expect(disableResponse.statusCode).toBe(200)
    expect(detailResponse.json().sources).toEqual([
      expect.objectContaining({
        id: sourceId,
        status: "disabled",
      }),
    ])
    expect(retrievalResponse.json().results).toEqual([])
    expect(getAuditEventsForTest().map((event) => event.action)).toContain(
      "knowledge.source.disabled",
    )

    await server.close()
  })

  it("hard deletes a corpus only after confirmation and removes its runtime content", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const objectClient = new RecordingObjectStoreClient()
    setKnowledgeObjectStoreForTest(
      new KnowledgeObjectStore(objectClient, "console-knowledge"),
    )
    const server = buildServer()
    const corpusId = await createCorpus(server)
    await uploadSource(server, corpusId, {
      fileName: "corpus-delete.txt",
      mimeType: "text/plain",
      content: "Corpus hard delete retrieval content.",
      idempotencyKey: "delete-corpus-upload",
    })
    const rejectedResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/hard-delete`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "delete-corpus-rejected",
      },
      payload: {
        confirmation: "delete",
      },
    })
    const deleteResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/hard-delete`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "delete-corpus-confirmed",
      },
      payload: {
        confirmation: "DELETE",
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/knowledge/corpora/${corpusId}`,
      headers: adminHeaders,
    })

    expect(rejectedResponse.statusCode).toBe(400)
    expect(deleteResponse.statusCode).toBe(200)
    expect(deleteResponse.json()).toMatchObject({
      corpus: {
        id: corpusId,
        publishedSnapshotId: null,
        sourceCount: 0,
        status: "deleted",
      },
      hardDeletedCorpusId: corpusId,
    })
    expect(detailResponse.json()).toMatchObject({
      corpus: {
        id: corpusId,
        sourceCount: 0,
        status: "deleted",
      },
      sources: [],
    })
    expect(objectClient.stored.size).toBe(0)
    expect(getAuditEventsForTest().map((event) => event.action)).toContain(
      "knowledge.corpus.hard_deleted",
    )

    await server.close()
  })
})

async function createCorpus(server: ReturnType<typeof buildServer>) {
  const response = await server.inject({
    method: "POST",
    url: "/api/admin/knowledge/corpora",
    headers: {
      ...adminHeaders,
      "idempotency-key": `create-${randomUUID()}`,
    },
    payload: {
      name: "Fixture Corpus",
    },
  })
  expect(response.statusCode).toBe(201)
  return response.json().corpus.id as string
}

async function createUrlPolicyRule(
  server: ReturnType<typeof buildServer>,
  input: CreateAdminUrlPolicyRuleRequest,
): Promise<AdminUrlPolicyRule> {
  const response = await server.inject({
    method: "POST",
    url: "/api/admin/settings/url-policy/rules",
    headers: {
      ...adminHeaders,
      "idempotency-key": `url-policy-${randomUUID()}`,
    },
    payload: input,
  })
  expect(response.statusCode).toBe(200)
  const rule = response
    .json()
    .urlPolicyRules.find(
      (candidate: AdminUrlPolicyRule) =>
        candidate.pattern === input.pattern && candidate.type === input.type,
    ) as AdminUrlPolicyRule | undefined
  expect(rule).toBeDefined()
  return rule as AdminUrlPolicyRule
}

async function uploadSource(
  server: ReturnType<typeof buildServer>,
  corpusId: string,
  input: {
    fileName: string
    mimeType: string
    content: string
    idempotencyKey: string
  },
) {
  const response = await server.inject({
    method: "POST",
    url: `/api/admin/knowledge/corpora/${corpusId}/sources/upload`,
    headers: {
      ...adminHeaders,
      "idempotency-key": input.idempotencyKey,
    },
    payload: {
      fileName: input.fileName,
      mimeType: input.mimeType,
      contentBase64: Buffer.from(input.content).toString("base64"),
    },
  })
  expect(response.statusCode).toBe(200)
  return response.json().source.id as string
}

async function expectRetrievalHit(
  server: ReturnType<typeof buildServer>,
  corpusId: string,
  input: {
    citation: Record<string, unknown>
    query: string
    sourceTypes: Array<"file" | "image" | "table" | "url">
  },
) {
  const response = await server.inject({
    method: "POST",
    url: `/api/admin/knowledge/corpora/${corpusId}/retrieval-test`,
    headers: adminHeaders,
    payload: {
      corpusIds: [corpusId],
      query: input.query,
      sourceTypes: input.sourceTypes,
      topK: 5,
    },
  })

  expect(response.statusCode).toBe(200)
  expect(response.json().results[0]).toMatchObject({
    citation: expect.objectContaining(input.citation),
    excerpt: expect.stringContaining(input.query.split(" ")[0]),
  })
}

class RecordingObjectStoreClient implements KnowledgeObjectStoreClient {
  bucketCreated = false
  metadata = new Map<string, Record<string, string>>()
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
    _size?: number,
    metaData?: Record<string, string>,
  ): Promise<void> {
    this.stored.set(`${bucketName}/${objectName}`, Buffer.from(stream))
    this.metadata.set(`${bucketName}/${objectName}`, metaData ?? {})
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
      throw new Error("missing object")
    }
    return object
  }

  async removeObject(bucketName: string, objectName: string): Promise<void> {
    this.stored.delete(`${bucketName}/${objectName}`)
  }
}

class MemoryKnowledgeDurableRepository implements KnowledgeDurableRepository {
  archivedSources: KnowledgeArchivedSource[] = []
  private state: KnowledgeDurableState = {
    bindings: [],
    chunks: [],
    corpora: [],
    jobs: [],
    snapshots: [],
    sources: [],
    urlAcquisitionJobs: [],
  }

  async load(): Promise<KnowledgeDurableState> {
    return clone(this.state)
  }

  async archiveSources(input: {
    actorId: string
    archivedAt: string
    sources: KnowledgeDurableState["sources"]
  }): Promise<void> {
    for (const source of input.sources) {
      const corpus = this.state.corpora.find(
        (current) => current.id === source.corpusId,
      )
      this.archivedSources.push({
        ...clone(source),
        archivedAt: input.archivedAt,
        archivedBy: input.actorId,
        corpusName: corpus?.name ?? source.corpusId,
        sourceId: source.id,
        id: randomUUID(),
      })
    }
  }

  async listArchivedSources(): Promise<KnowledgeArchivedSource[]> {
    return clone(this.archivedSources)
  }

  async restoreArchivedSources(
    archiveIds: string[],
  ): Promise<KnowledgeDurableState["sources"]> {
    const archiveIdSet = new Set(archiveIds)
    const restoredSources = this.archivedSources
      .filter((source) => archiveIdSet.has(source.id))
      .map((source) => ({
        canonicalUri: source.canonicalUri,
        checksum: source.checksum,
        corpusId: source.corpusId,
        createdAt: source.createdAt,
        createdBy: source.createdBy,
        errorDetail: null,
        finalUri: source.finalUri,
        id: source.sourceId,
        language: source.language,
        metadata: {
          ...source.metadata,
          restoredFromArchive: {
            archivedAt: source.archivedAt,
            archiveId: source.id,
          },
        },
        mimeType: source.mimeType,
        originalUri: source.originalUri,
        sourceType: source.sourceType,
        status: "pending" as const,
        title: source.title,
        updatedAt: "2026-05-27T12:00:00.000Z",
      }))
    for (const source of restoredSources) {
      upsert(this.state.sources, source)
    }
    await this.deleteArchivedSources(archiveIds)
    return clone(restoredSources)
  }

  async deleteArchivedSources(archiveIds: string[]): Promise<void> {
    const archiveIdSet = new Set(archiveIds)
    this.archivedSources = this.archivedSources.filter(
      (source) => !archiveIdSet.has(source.id),
    )
  }

  async removeSources(sourceIds: string[]): Promise<{
    objectKeys: string[]
    removedChunkCount: number
  }> {
    const sourceIdSet = new Set(sourceIds)
    const objectKeys: string[] = []
    for (const source of this.state.sources) {
      if (!sourceIdSet.has(source.id)) {
        continue
      }
      const artifacts =
        typeof source.metadata.artifacts === "object" &&
        source.metadata.artifacts !== null
          ? (source.metadata.artifacts as Record<string, unknown>)
          : {}
      for (const value of Object.values(artifacts)) {
        if (typeof value === "string") {
          objectKeys.push(value)
        }
      }
    }
    const removedChunkCount = this.state.chunks.filter((chunk) =>
      sourceIdSet.has(chunk.sourceId),
    ).length
    this.state.chunks = this.state.chunks.filter(
      (chunk) => !sourceIdSet.has(chunk.sourceId),
    )
    this.state.sources = this.state.sources.filter(
      (source) => !sourceIdSet.has(source.id),
    )
    this.state.urlAcquisitionJobs = this.state.urlAcquisitionJobs.filter(
      (job) => !sourceIdSet.has(job.sourceId),
    )
    this.state.jobs = this.state.jobs.map((job) =>
      job.sourceId && sourceIdSet.has(job.sourceId)
        ? { ...job, sourceId: null }
        : job,
    )
    return { objectKeys, removedChunkCount }
  }

  async saveBinding(
    binding: KnowledgeDurableState["bindings"][number],
  ): Promise<void> {
    upsert(this.state.bindings, binding)
  }

  async saveChunksForSnapshot(
    snapshotId: string,
    chunks: KnowledgeDurableState["chunks"],
  ): Promise<void> {
    this.state.chunks = this.state.chunks.filter(
      (chunk) => chunk.snapshotId !== snapshotId,
    )
    this.state.chunks.push(...clone(chunks))
  }

  async saveCorpus(
    corpus: KnowledgeDurableState["corpora"][number],
  ): Promise<void> {
    upsert(this.state.corpora, corpus)
  }

  async saveJob(job: KnowledgeDurableState["jobs"][number]): Promise<void> {
    upsert(this.state.jobs, job)
  }

  async claimNextUrlAcquisitionJob(
    workerId: string,
    lockedAt: string,
  ): Promise<KnowledgeUrlAcquisitionJob | null> {
    const job = this.state.urlAcquisitionJobs.find(
      (candidate) => candidate.status === "queued",
    )
    if (!job) {
      return null
    }
    Object.assign(job, {
      attempts: job.attempts + 1,
      lockedAt,
      lockedBy: workerId,
      status: "running" satisfies KnowledgeUrlAcquisitionJob["status"],
      updatedAt: lockedAt,
    })
    return clone(job)
  }

  async saveUrlAcquisitionJob(job: KnowledgeUrlAcquisitionJob): Promise<void> {
    upsert(this.state.urlAcquisitionJobs, job)
  }

  async saveSnapshot(
    snapshot: KnowledgeDurableState["snapshots"][number],
  ): Promise<void> {
    upsert(this.state.snapshots, snapshot)
  }

  async saveSource(
    source: KnowledgeDurableState["sources"][number],
    artifact?: KnowledgeSourceArtifactInput | KnowledgeSourceArtifactInput[],
  ): Promise<void> {
    const artifacts = Array.isArray(artifact)
      ? artifact
      : artifact
        ? [artifact]
        : []
    const metadata = artifacts.length
      ? {
          ...source.metadata,
          artifacts: {
            ...(typeof source.metadata.artifacts === "object" &&
            source.metadata.artifacts !== null
              ? source.metadata.artifacts
              : {}),
            ...Object.fromEntries(
              artifacts.map((artifactInput) => [
                `${artifactInput.artifactType}ObjectKey`,
                artifactInput.object.objectKey,
              ]),
            ),
          },
        }
      : source.metadata
    upsert(this.state.sources, { ...source, metadata })
  }
}

function upsert<T extends { id: string }>(rows: T[], row: T): void {
  const index = rows.findIndex((current) => current.id === row.id)
  if (index >= 0) {
    rows[index] = clone(row)
  } else {
    rows.push(clone(row))
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
