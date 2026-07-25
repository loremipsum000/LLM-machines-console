import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildServer, type FetchLike } from "./index"

describe("reranker api", () => {
  beforeEach(() => {
    vi.stubEnv("RERANKER_API_KEY", "reranker-token")
    vi.stubEnv("TEI_RERANK_URL", "http://tei.example.test/rerank")
    vi.stubEnv("RERANKER_MODEL", "BAAI/bge-reranker-v2-m3")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("keeps liveness public and minimal", async () => {
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/healthz",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      service: "reranker-api",
      status: "ok",
    })
    await server.close()
  })

  it("requires bearer auth for rerank requests", async () => {
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/rerank",
      payload: {
        query: "test",
        documents: ["alpha"],
      },
    })

    expect(response.statusCode).toBe(401)
    await server.close()
  })

  it("maps Jina-style requests to TEI rerank and returns Jina-style results", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        query?: unknown
        texts?: unknown
        raw_scores?: unknown
      }
      expect(body).toEqual({
        query: "sto je suvereni AI appliance",
        texts: ["Croatian appliance note", "Sovereign AI appliance overview"],
        raw_scores: false,
      })
      return Response.json([
        { index: 1, score: 0.93 },
        { index: 0, score: 0.31 },
      ])
    })
    const server = buildServer({ fetchImpl })

    const response = await server.inject({
      method: "POST",
      url: "/v1/rerank",
      headers: {
        authorization: "Bearer reranker-token",
      },
      payload: {
        model: "BAAI/bge-reranker-v2-m3",
        query: "sto je suvereni AI appliance",
        documents: [
          "Croatian appliance note",
          "Sovereign AI appliance overview",
        ],
        top_n: 2,
        return_documents: true,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      model: "BAAI/bge-reranker-v2-m3",
      results: [
        {
          index: 1,
          relevance_score: 0.93,
          document: {
            text: "Sovereign AI appliance overview",
          },
        },
        {
          index: 0,
          relevance_score: 0.31,
          document: {
            text: "Croatian appliance note",
          },
        },
      ],
      usage: {
        total_tokens: 0,
      },
      metadata: {
        input_document_count: 2,
        ranked_document_count: 2,
        truncated_candidates: false,
        truncated_documents: false,
      },
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://tei.example.test/rerank",
      expect.objectContaining({
        method: "POST",
      }),
    )
    await server.close()
  })

  it("truncates candidate lists to the configured default limit", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        texts?: unknown
      }
      expect(Array.isArray(body.texts)).toBe(true)
      expect(body.texts).toHaveLength(24)
      return Response.json([{ index: 23, score: 0.5 }])
    })
    const server = buildServer({ fetchImpl })

    const response = await server.inject({
      method: "POST",
      url: "/v1/rerank",
      headers: {
        authorization: "Bearer reranker-token",
      },
      payload: {
        query: "candidate cap",
        documents: Array.from(
          { length: 30 },
          (_, index) => `document ${index}`,
        ),
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      metadata: {
        input_document_count: 30,
        ranked_document_count: 24,
        truncated_candidates: true,
      },
    })
    await server.close()
  })

  it("rejects malformed documents before calling TEI", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => Response.json([]))
    const server = buildServer({ fetchImpl })

    const response = await server.inject({
      method: "POST",
      url: "/v1/rerank",
      headers: {
        authorization: "Bearer reranker-token",
      },
      payload: {
        query: "bad docs",
        documents: [{ title: "missing body" }],
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      title: "Invalid rerank request",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    await server.close()
  })

  it("returns controlled fallback metadata when TEI fails", async () => {
    const fetchImpl = vi.fn<FetchLike>(
      async () => new Response("upstream failed", { status: 500 }),
    )
    const server = buildServer({ fetchImpl })

    const response = await server.inject({
      method: "POST",
      url: "/v1/rerank",
      headers: {
        authorization: "Bearer reranker-token",
      },
      payload: {
        query: "tei failure",
        documents: ["alpha"],
      },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({
      type: "about:blank",
      title: "Reranker unavailable",
      status: 503,
      detail: "TEI returned HTTP 500.",
      fallback: {
        rerankerType: "none",
      },
    })
    await server.close()
  })
})
