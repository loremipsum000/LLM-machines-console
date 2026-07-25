import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import { resetConnectorVettingDecisionsForTest } from "../services/admin-connector-registry"
import {
  getAuditEventsForTest,
  resetAuditEventsForTest,
} from "../services/audit"
import { resetIdempotencyForTest } from "../services/idempotency"
import {
  resetKnowledgeStateForTest,
  runKnowledgeUrlAcquisitionWorkerBatch,
  setKnowledgeCorpusStatusForTest,
} from "../services/knowledge/admin"

const serviceHeaders = {
  authorization: "Bearer test-service-key",
  "x-llm-machines-keycloak-token": "",
  "x-llm-machines-user-sub": "user-1",
  "x-llm-machines-user-email": "user@example.test",
  "x-llm-machines-user-roles": "consumer",
}

const securityGroupHeaders = {
  ...serviceHeaders,
  "x-llm-machines-user-groups": "security",
}

const builderHeaders = {
  ...serviceHeaders,
  "x-llm-machines-user-sub": "builder-1",
  "x-llm-machines-user-email": "builder@example.test",
  "x-llm-machines-user-roles": "builder",
}

const securityBuilderHeaders = {
  ...builderHeaders,
  "x-llm-machines-user-groups": "security",
}

const adminHeaders = {
  ...serviceHeaders,
  "x-llm-machines-user-sub": "admin-1",
  "x-llm-machines-user-email": "admin@example.test",
  "x-llm-machines-user-roles": "admin",
}

const fixtureRoot = join(process.cwd(), "../../test-fixtures/knowledge")

describe("MCP gateway routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    resetAuditEventsForTest()
    resetConnectorVettingDecisionsForTest()
    resetIdempotencyForTest()
    resetKnowledgeStateForTest()
  })

  it("requires authentication for the Internal Docs MCP gateway", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/mcp/internal-docs",
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      },
    })

    expect(response.statusCode).toBe(401)
    await server.close()
  })

  it("lists only the approved Internal Docs tools", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/mcp/internal-docs",
      headers: serviceHeaders,
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          {
            name: "list_governed_corpora",
          },
          {
            name: "resolve_corpus",
          },
          {
            name: "get_corpus_manifest",
          },
          {
            name: "query_governed_corpus",
          },
          {
            name: "search_internal_docs",
          },
        ],
      },
    })
    expect(JSON.stringify(response.json())).not.toContain("Slack")
    expect(JSON.stringify(response.json())).not.toContain("Notion")
    await server.close()
  })

  it("lists, resolves, manifests, and searches governed corpora by reference", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const corpusId = await createPublishedFixtureCorpus(server, "test2")

    const listResponse = await internalDocsToolCall(server, {
      arguments: {
        query: "test2",
      },
      name: "list_governed_corpora",
    })
    const resolveResponse = await internalDocsToolCall(server, {
      arguments: {
        reference: "test2",
      },
      name: "resolve_corpus",
    })
    const manifestResponse = await internalDocsToolCall(server, {
      arguments: {
        corpus_ref: "test2",
      },
      name: "get_corpus_manifest",
    })
    const queryResponse = await internalDocsToolCall(server, {
      arguments: {
        corpus_ref: "test2",
        question: "retrieve the immutable corpus snapshot",
      },
      name: "query_governed_corpus",
    })
    const searchResponse = await internalDocsToolCall(server, {
      arguments: {
        corpus_refs: ["test2"],
        query: "immutable corpus snapshot",
      },
      name: "search_internal_docs",
    })
    const missingRefResponse = await internalDocsToolCall(server, {
      arguments: {
        corpus_refs: ["missing-corpus"],
        query: "immutable corpus snapshot",
      },
      name: "search_internal_docs",
    })

    expect(listResponse.result.structuredContent).toMatchObject({
      corpora: [expect.objectContaining({ id: corpusId, name: "test2" })],
    })
    expect(JSON.stringify(listResponse.result.structuredContent)).not.toContain(
      "accessGroups",
    )
    expect(resolveResponse.result.structuredContent).toMatchObject({
      status: "resolved",
      candidates: [expect.objectContaining({ id: corpusId })],
    })
    expect(manifestResponse.result.structuredContent).toMatchObject({
      corpus: expect.objectContaining({ id: corpusId, name: "test2" }),
      retrievalReady: true,
    })
    expect(queryResponse.result.structuredContent).toMatchObject({
      expanded_queries: expect.arrayContaining([
        expect.stringContaining("immutable corpus snapshot"),
      ]),
      retrieval_mode: expect.stringMatching(/^(hybrid|lexical|lexical_fallback)$/),
      selected_corpora: [expect.objectContaining({ id: corpusId })],
    })
    expect(
      queryResponse.result.structuredContent.passages as unknown[],
    ).not.toHaveLength(0)
    expect(searchResponse.result.structuredContent).toMatchObject({
      retrieval_mode: expect.stringMatching(/^(hybrid|lexical|lexical_fallback)$/),
      selected_corpora: [expect.objectContaining({ id: corpusId })],
    })
    expect(missingRefResponse.result.structuredContent).toMatchObject({
      passages: [],
      selected_corpora: [],
      unresolved_corpora: [expect.objectContaining({ status: "not_found" })],
    })
    await server.close()
  })

  it("rejects regular consumers from Admin-created MCP server gateways", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const aggregateResponse = await server.inject({
      method: "POST",
      url: "/api/mcp/admin-servers",
      headers: serviceHeaders,
      payload: {
        jsonrpc: "2.0",
        id: "consumer-list-admin",
        method: "tools/list",
      },
    })
    const directResponse = await server.inject({
      method: "POST",
      url: "/api/mcp/example-docs",
      headers: serviceHeaders,
      payload: {
        jsonrpc: "2.0",
        id: "consumer-call-direct",
        method: "tools/list",
      },
    })

    expect(aggregateResponse.statusCode).toBe(403)
    expect(aggregateResponse.json()).toMatchObject({
      detail: "Route requires builder access.",
    })
    expect(directResponse.statusCode).toBe(403)
    expect(directResponse.json()).toMatchObject({
      detail: "Route requires builder access.",
    })
    await server.close()
  })

  it("forwards Admin-created URL MCP server calls through the BFF gateway", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "call-remote",
              jsonrpc: "2.0",
              result: {
                content: [{ text: "Remote MCP response", type: "text" }],
              },
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
      ),
    )
    const server = buildServer()

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-gateway-create-remote-docs",
      },
      payload: {
        accessGroups: ["Everyone"],
        accessLevel: "read_only",
        authMode: "none",
        chatCommand: "@remote-docs",
        description: "Remote docs MCP endpoint.",
        endpointUrl: "https://mcp.example.test/rpc",
        name: "Remote Docs",
        transport: "url",
      },
    })
    const invokeResponse = await server.inject({
      method: "POST",
      url: "/api/mcp/remote-docs",
      headers: builderHeaders,
      payload: {
        id: "call-remote",
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: { query: "governance" },
          name: "search_docs",
        },
      },
    })

    expect(createResponse.statusCode).toBe(200)
    expect(invokeResponse.statusCode).toBe(200)
    expect(invokeResponse.json()).toMatchObject({
      id: "call-remote",
      jsonrpc: "2.0",
      result: {
        content: [{ text: "Remote MCP response", type: "text" }],
      },
    })
    expect(fetch).toHaveBeenCalledWith(
      "https://mcp.example.test/rpc",
      expect.objectContaining({
        body: expect.stringContaining("search_docs"),
        method: "POST",
      }),
    )
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "connector.mcp.forwarded",
          actorId: "builder-1",
          targetId: "remote-docs",
          targetType: "mcp.connector",
        }),
      ]),
    )
    await server.close()
  })

  it("redacts bearer secrets from Admin-created MCP gateway responses", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("REMOTE_MCP_TOKEN", "super-secret-token")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "call-secret",
              jsonrpc: "2.0",
              result: {
                content: [
                  {
                    text: "authorization=Bearer super-secret-token token=super-secret-token",
                    type: "text",
                  },
                ],
                echoed: {
                  authorization: "Bearer super-secret-token",
                },
              },
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
      ),
    )
    const server = buildServer()

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-gateway-create-secret-docs",
      },
      payload: {
        accessGroups: ["Everyone"],
        accessLevel: "read_only",
        authMode: "bearer",
        bearerTokenSecretRef: "REMOTE_MCP_TOKEN",
        chatCommand: "@secret-docs",
        description: "Remote docs MCP endpoint.",
        endpointUrl: "https://mcp.example.test/rpc",
        name: "Secret Docs",
        transport: "url",
      },
    })
    const invokeResponse = await server.inject({
      method: "POST",
      url: "/api/mcp/secret-docs",
      headers: builderHeaders,
      payload: {
        id: "call-secret",
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: { query: "governance" },
          name: "search_docs",
        },
      },
    })

    expect(createResponse.statusCode).toBe(200)
    expect(invokeResponse.statusCode).toBe(200)
    expect(JSON.stringify(invokeResponse.json())).not.toContain(
      "super-secret-token",
    )
    expect(JSON.stringify(invokeResponse.json())).not.toContain(
      "Bearer super-secret-token",
    )
    expect(invokeResponse.json()).toMatchObject({
      result: {
        content: [
          {
            text: "authorization=[redacted] token=[redacted]",
          },
        ],
        echoed: {
          authorization: "[redacted]",
        },
      },
    })
    expect(fetch).toHaveBeenCalledWith(
      "https://mcp.example.test/rpc",
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    )
    await server.close()
  })

  it("blocks Admin MCP redirects to private network targets", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const fetchMock = vi.fn(
      async () =>
        new Response("", {
          headers: { Location: "http://127.0.0.1:9000/private-rpc" },
          status: 302,
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-gateway-create-redirect-docs",
      },
      payload: {
        accessGroups: ["Everyone"],
        accessLevel: "read_only",
        authMode: "none",
        chatCommand: "@redirect-docs",
        description: "Remote docs MCP endpoint.",
        endpointUrl: "https://mcp.example.test/rpc",
        name: "Redirect Docs",
        transport: "url",
      },
    })

    const invokeResponse = await server.inject({
      method: "POST",
      url: "/api/mcp/redirect-docs",
      headers: builderHeaders,
      payload: {
        id: "call-redirect",
        jsonrpc: "2.0",
        method: "tools/list",
      },
    })

    expect(invokeResponse.statusCode).toBe(200)
    expect(invokeResponse.json()).toMatchObject({
      error: {
        message: "MCP upstream request failed.",
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await server.close()
  })

  it("times out slow Admin MCP runtime endpoints", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_MCP_FETCH_TIMEOUT_MS", "5")
    const fetchMock = vi.fn(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (init as RequestInit).signal
          signal?.addEventListener("abort", () => {
            const abortError = new Error("aborted")
            abortError.name = "AbortError"
            reject(abortError)
          })
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-gateway-create-slow-docs",
      },
      payload: {
        accessGroups: ["Everyone"],
        accessLevel: "read_only",
        authMode: "none",
        chatCommand: "@slow-docs",
        description: "Slow docs MCP endpoint.",
        endpointUrl: "https://slow.example.test/rpc",
        name: "Slow Docs",
        transport: "url",
      },
    })

    const invokeResponse = await server.inject({
      method: "POST",
      url: "/api/mcp/slow-docs",
      headers: builderHeaders,
      payload: {
        id: "call-slow",
        jsonrpc: "2.0",
        method: "tools/list",
      },
    })

    expect(invokeResponse.statusCode).toBe(200)
    expect(invokeResponse.json()).toMatchObject({
      error: {
        message: "MCP upstream request failed.",
      },
    })
    await server.close()
  })

  it("rejects oversized Admin MCP runtime responses", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_MCP_MAX_RESPONSE_BYTES", "64")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "call-large",
              jsonrpc: "2.0",
              result: {
                content: [{ text: "x".repeat(256), type: "text" }],
              },
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
      ),
    )
    const server = buildServer()

    await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-gateway-create-large-docs",
      },
      payload: {
        accessGroups: ["Everyone"],
        accessLevel: "read_only",
        authMode: "none",
        chatCommand: "@large-docs",
        description: "Large docs MCP endpoint.",
        endpointUrl: "https://large.example.test/rpc",
        name: "Large Docs",
        transport: "url",
      },
    })

    const invokeResponse = await server.inject({
      method: "POST",
      url: "/api/mcp/large-docs",
      headers: builderHeaders,
      payload: {
        id: "call-large",
        jsonrpc: "2.0",
        method: "tools/list",
      },
    })

    expect(invokeResponse.statusCode).toBe(200)
    expect(invokeResponse.json()).toMatchObject({
      error: {
        message: "MCP upstream request failed.",
      },
    })
    await server.close()
  })

  it("rejects invalid JSON-RPC Admin MCP runtime responses", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
      ),
    )
    const server = buildServer()

    await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-gateway-create-invalid-docs",
      },
      payload: {
        accessGroups: ["Everyone"],
        accessLevel: "read_only",
        authMode: "none",
        chatCommand: "@invalid-docs",
        description: "Invalid docs MCP endpoint.",
        endpointUrl: "https://invalid.example.test/rpc",
        name: "Invalid Docs",
        transport: "url",
      },
    })

    const invokeResponse = await server.inject({
      method: "POST",
      url: "/api/mcp/invalid-docs",
      headers: builderHeaders,
      payload: {
        id: "call-invalid",
        jsonrpc: "2.0",
        method: "tools/list",
      },
    })

    expect(invokeResponse.statusCode).toBe(200)
    expect(invokeResponse.json()).toMatchObject({
      error: {
        message: "MCP upstream request failed.",
      },
    })
    await server.close()
  })

  it("lists enabled Admin-created URL MCP tools through the aggregate LibreChat gateway", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "list-remote-docs",
            jsonrpc: "2.0",
            result: {
              tools: [
                {
                  description: "Search remote docs.",
                  inputSchema: {
                    properties: { query: { type: "string" } },
                    required: ["query"],
                    type: "object",
                  },
                  name: "search_docs",
                },
              ],
            },
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        ),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-gateway-create-aggregate-remote",
      },
      payload: {
        accessGroups: ["Everyone"],
        accessLevel: "read_only",
        authMode: "none",
        chatCommand: "@remote-docs",
        description: "Remote docs MCP endpoint.",
        endpointUrl: "https://mcp.example.test/rpc",
        name: "Remote Docs",
        transport: "url",
      },
    })
    await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-gateway-create-aggregate-draft",
      },
      payload: {
        accessGroups: ["Everyone"],
        accessLevel: "read_only",
        authMode: "none",
        chatCommand: "@draft-docs",
        description: "Draft docs MCP endpoint.",
        endpointUrl: "https://draft.example.test/rpc",
        name: "Draft Docs",
        saveMode: "draft",
        transport: "url",
      },
    })
    await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-gateway-create-aggregate-stdio",
      },
      payload: {
        accessGroups: ["Everyone"],
        accessLevel: "read_only",
        authMode: "none",
        chatCommand: "@local-files",
        description: "Local STDIO MCP endpoint.",
        name: "Local Files",
        stdioCommand: "node local-files.mjs",
        transport: "stdio",
      },
    })

    const listResponse = await server.inject({
      method: "POST",
      url: "/api/mcp/admin-servers",
      headers: builderHeaders,
      payload: {
        id: "list-admin",
        jsonrpc: "2.0",
        method: "tools/list",
      },
    })

    expect(listResponse.statusCode).toBe(200)
    expect(listResponse.json()).toMatchObject({
      id: "list-admin",
      jsonrpc: "2.0",
      result: {
        tools: [
          {
            description: "Remote Docs: Search remote docs.",
            name: "remote-docs__search_docs",
          },
        ],
      },
    })
    expect(JSON.stringify(listResponse.json())).not.toContain("draft-docs")
    expect(JSON.stringify(listResponse.json())).not.toContain("local-files")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await server.close()
  })

  it("routes aggregate LibreChat tool calls to the selected Admin-created MCP server", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      expect(body.params.name).toBe("search_docs")
      expect(body.params.name).not.toBe("remote-docs__search_docs")
      return new Response(
        JSON.stringify({
          id: "call-admin",
          jsonrpc: "2.0",
          result: {
            content: [{ text: "Aggregate MCP response", type: "text" }],
          },
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-gateway-create-aggregate-call",
      },
      payload: {
        accessGroups: ["Everyone"],
        accessLevel: "read_only",
        authMode: "none",
        chatCommand: "@remote-docs",
        description: "Remote docs MCP endpoint.",
        endpointUrl: "https://mcp.example.test/rpc",
        name: "Remote Docs",
        transport: "url",
      },
    })

    const invokeResponse = await server.inject({
      method: "POST",
      url: "/api/mcp/admin-servers",
      headers: builderHeaders,
      payload: {
        id: "call-admin",
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: { query: "governance" },
          name: "remote-docs__search_docs",
        },
      },
    })

    expect(invokeResponse.statusCode).toBe(200)
    expect(invokeResponse.json()).toMatchObject({
      result: {
        content: [{ text: "Aggregate MCP response", type: "text" }],
      },
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "connector.mcp.forwarded",
          actorId: "builder-1",
          targetId: "remote-docs",
          targetType: "mcp.connector",
        }),
      ]),
    )
    await server.close()
  })

  it("hides access-group restricted Admin MCP tools from unauthorized LibreChat actors", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "list-security",
            jsonrpc: "2.0",
            result: {
              tools: [{ name: "search_security" }],
            },
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        ),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-gateway-create-security-docs",
      },
      payload: {
        accessGroups: ["security"],
        accessLevel: "read_only",
        authMode: "none",
        chatCommand: "@security-docs",
        description: "Security docs MCP endpoint.",
        endpointUrl: "https://security.example.test/rpc",
        name: "Security Docs",
        transport: "url",
      },
    })

    const listResponse = await server.inject({
      method: "POST",
      url: "/api/mcp/admin-servers",
      headers: builderHeaders,
      payload: {
        id: "list-security",
        jsonrpc: "2.0",
        method: "tools/list",
      },
    })
    const deniedInvokeResponse = await server.inject({
      method: "POST",
      url: "/api/mcp/admin-servers",
      headers: builderHeaders,
      payload: {
        id: "call-security",
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: { query: "policy" },
          name: "security-docs__search_security",
        },
      },
    })
    const authorizedListResponse = await server.inject({
      method: "POST",
      url: "/api/mcp/admin-servers",
      headers: securityBuilderHeaders,
      payload: {
        id: "list-security-authorized",
        jsonrpc: "2.0",
        method: "tools/list",
      },
    })

    expect(listResponse.statusCode).toBe(200)
    expect(listResponse.json()).toMatchObject({
      result: {
        tools: [],
      },
    })
    expect(deniedInvokeResponse.statusCode).toBe(200)
    expect(deniedInvokeResponse.json()).toMatchObject({
      error: {
        message: "Admin-created MCP server is not allowed for this actor.",
      },
    })
    expect(authorizedListResponse.statusCode).toBe(200)
    expect(authorizedListResponse.json()).toMatchObject({
      result: {
        tools: [expect.objectContaining({ name: "security-docs__search_security" })],
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await server.close()
  })

  it("audits Internal Docs tool calls from native LibreChat agents", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/mcp/internal-docs",
      headers: serviceHeaders,
      payload: {
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "search_internal_docs",
          arguments: {
            query: "agent governance",
          },
        },
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: "call-1",
      result: {
        content: [
          {
            type: "text",
            text: expect.stringContaining("agent governance"),
          },
        ],
        structuredContent: {
          citations: [],
          passages: [],
        },
      },
    })
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        actorId: "user-1",
        action: "connector.docs.search",
        targetId: "internal-docs",
        targetType: "mcp.connector",
      }),
    ])
    await server.close()
  })

  it("queries published governed corpora with structured citations without Builder binding", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const corpusId = await createPublishedFixtureCorpus(server)

    const croatian = await mcpSearch(server, {
      query: "korpuse znanja",
      top_k: 5,
    })
    const english = await mcpSearch(server, {
      query: "immutable corpus snapshot",
      top_k: 5,
    })
    const docx = await mcpSearch(server, {
      query: "docx-nazvanoj",
      top_k: 5,
    })
    const table = await mcpSearch(server, {
      query: "Admin-only corpus ingestion",
      source_types: ["table"],
      top_k: 5,
    })
    const image = await mcpSearch(server, {
      query: "prije objave",
      source_types: ["image"],
      top_k: 5,
    })
    const url = await mcpSearch(server, {
      query: "stored snapshot",
      source_types: ["url"],
      top_k: 5,
    })

    expect(croatian.result.structuredContent.passages[0]).toMatchObject({
      citation: expect.objectContaining({
        corpus_id: corpusId,
      }),
      excerpt: expect.stringContaining("korpuse znanja"),
    })
    expect(english.result.structuredContent.passages[0]).toMatchObject({
      citation: expect.objectContaining({
        page_number: 1,
        source_type: "file",
      }),
      excerpt: expect.stringContaining("immutable corpus snapshot"),
    })
    expect(docx.result.structuredContent.passages[0]).toMatchObject({
      citation: expect.objectContaining({
        page_number: 1,
        source_type: "file",
        title: "hr-pravilnik.docx",
      }),
      excerpt: expect.stringContaining("docx-nazvanoj"),
    })
    expect(table.result.structuredContent.citations[0]).toMatchObject({
      row_range: "2",
      source_type: "table",
    })
    expect(image.result.structuredContent.citations[0]).toMatchObject({
      image_region: "full-image",
      source_type: "image",
    })
    expect(url.result.structuredContent.citations[0]).toMatchObject({
      source_type: "url",
      uri: "https://docs.example.test/governed-url-corpus",
    })

    await server.close()
  })

  it("returns no content for draft, disabled, archived, deleted, and unauthorized corpora", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const draftId = await createCorpus(server, { name: "Draft Runtime Corpus" })
    const disabledId = await createPublishedFixtureCorpus(
      server,
      "Disabled Corpus",
    )
    const archivedId = await createPublishedFixtureCorpus(
      server,
      "Archived Corpus",
    )
    const deletedId = await createPublishedFixtureCorpus(
      server,
      "Deleted Corpus",
    )
    const unauthorizedId = await createPublishedFixtureCorpus(
      server,
      "Security Corpus",
      ["security"],
    )
    await transitionCorpus(server, disabledId, "disable")
    await transitionCorpus(server, archivedId, "archive")
    setKnowledgeCorpusStatusForTest(deletedId, "deleted")

    for (const corpusId of [
      draftId,
      disabledId,
      archivedId,
      deletedId,
      unauthorizedId,
    ]) {
      const response = await mcpSearch(server, {
        corpus_ids: [corpusId],
        query: "immutable corpus snapshot",
        top_k: 5,
      })
      expect(response.result.structuredContent.passages).toEqual([])
      expect(response.result.structuredContent.citations).toEqual([])
      expect(response.result.content[0].text).toContain(
        "No published governed corpus passages matched",
      )
    }

    const allowedResponse = await mcpSearch(
      server,
      {
        corpus_ids: [unauthorizedId],
        query: "immutable corpus snapshot",
        top_k: 5,
      },
      securityGroupHeaders,
    )
    const removedGroupResponse = await mcpSearch(server, {
      corpus_ids: [unauthorizedId],
      query: "immutable corpus snapshot",
      top_k: 5,
    })

    expect(allowedResponse.result.structuredContent.passages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          excerpt: expect.stringContaining("immutable corpus snapshot"),
        }),
      ]),
    )
    expect(removedGroupResponse.result.structuredContent.passages).toEqual([])

    await server.close()
  })

  it("does not return disabled source passages from a published corpus", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const corpusId = await createCorpus(server, {
      name: "Disabled Source Runtime Corpus",
    })
    const sourceId = await uploadFixtureSource(
      server,
      corpusId,
      "hr-pravilnik.txt",
      "text/plain",
    )
    const ingestResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/ingest`,
      headers: {
        ...adminHeaders,
        "idempotency-key": randomUUID(),
      },
    })
    expect(ingestResponse.statusCode).toBe(200)
    const snapshotId = ingestResponse.json().snapshot.id as string
    const publishResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/snapshots/${snapshotId}/publish`,
      headers: {
        ...adminHeaders,
        "idempotency-key": randomUUID(),
      },
    })
    expect(publishResponse.statusCode).toBe(200)
    const disableResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/sources/bulk-action`,
      headers: {
        ...adminHeaders,
        "idempotency-key": randomUUID(),
      },
      payload: {
        action: "disable",
        sourceIds: [sourceId],
      },
    })
    expect(disableResponse.statusCode).toBe(200)

    const response = await mcpSearch(server, {
      corpus_ids: [corpusId],
      query: "korpuse znanja",
      top_k: 5,
    })

    expect(response.result.structuredContent.passages).toEqual([])
    expect(response.result.structuredContent.citations).toEqual([])

    await server.close()
  })

  it("returns published OpenDataLoader PDF chunks through Internal Docs MCP only from stored retrieval state", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const { corpusId, fetchMock } = await createPublishedPdfParserCorpus(server)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Runtime retrieval must not call fetch.")
      }),
    )

    const english = await mcpSearch(server, {
      corpus_ids: [corpusId],
      query: "PDF immutable evidence",
      top_k: 5,
    })
    const croatian = await mcpSearch(server, {
      corpus_ids: [corpusId],
      query: "Hrvatski PDF pravilnik",
      top_k: 5,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(english.result.structuredContent.passages[0]).toMatchObject({
      citation: expect.objectContaining({
        corpus_id: corpusId,
        page_number: 1,
        source_type: "file",
        title: "runtime-opendataloader.pdf",
      }),
      excerpt: expect.stringContaining("PDF immutable evidence"),
    })
    expect(croatian.result.structuredContent.passages[0]).toMatchObject({
      citation: expect.objectContaining({
        corpus_id: corpusId,
        page_number: 2,
        source_type: "file",
      }),
      excerpt: expect.stringContaining("Hrvatski PDF pravilnik"),
    })

    await server.close()
  })

  it("excludes draft, disabled-source, and hard-deleted PDF parser corpora from MCP retrieval", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const draft = await createPdfParserCorpus(server, {
      idempotencyKeyPrefix: "pdf-mcp-draft",
      publish: false,
    })
    const disabledSource = await createPdfParserCorpus(server, {
      idempotencyKeyPrefix: "pdf-mcp-disabled-source",
      publish: true,
    })
    const deleted = await createPdfParserCorpus(server, {
      idempotencyKeyPrefix: "pdf-mcp-deleted",
      publish: true,
    })
    const disableResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${disabledSource.corpusId}/sources/bulk-action`,
      headers: {
        ...adminHeaders,
        "idempotency-key": randomUUID(),
      },
      payload: {
        action: "disable",
        sourceIds: [disabledSource.sourceId],
      },
    })
    const deleteResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${deleted.corpusId}/hard-delete`,
      headers: {
        ...adminHeaders,
        "idempotency-key": randomUUID(),
      },
      payload: {
        confirmation: "DELETE",
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Runtime retrieval must not call fetch.")
      }),
    )

    expect(disableResponse.statusCode).toBe(200)
    expect(deleteResponse.statusCode).toBe(200)
    for (const [corpusId, expectedText] of [
      [draft.corpusId, "No published governed corpus passages matched"],
      [
        disabledSource.corpusId,
        "Selected corpus exists but no matching passages were found",
      ],
      [deleted.corpusId, "No published governed corpus passages matched"],
    ] as const) {
      const response = await mcpSearch(server, {
        corpus_ids: [corpusId],
        query: "PDF immutable evidence",
        top_k: 5,
      })
      expect(response.result.structuredContent.passages).toEqual([])
      expect(response.result.structuredContent.citations).toEqual([])
      expect(response.result.content[0].text).toContain(expectedText)
    }

    await server.close()
  })
})

async function createPublishedFixtureCorpus(
  server: ReturnType<typeof buildServer>,
  name = "Runtime Fixture Corpus",
  accessGroups: string[] = [],
) {
  const corpusId = await createCorpus(server, { accessGroups, name })
  await uploadFixtureSource(server, corpusId, "hr-pravilnik.txt", "text/plain")
  await uploadFixtureSource(
    server,
    corpusId,
    "en-safety.pdf",
    "application/pdf",
  )
  await uploadFixtureSource(
    server,
    corpusId,
    "hr-pravilnik.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  )
  await uploadFixtureSource(server, corpusId, "table-policy.csv", "text/csv")
  await uploadFixtureSource(server, corpusId, "image-ocr.jpg", "image/jpeg")
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          "<html><head><title>Governed URL Corpus</title></head><body><main><h1>Governed URL Corpus</h1><p>stored snapshot for governed corpus retrieval.</p></main></body></html>",
          {
            headers: { "Content-Type": "text/html" },
            status: 200,
          },
        ),
    ) as unknown as typeof fetch,
  )
  const urlResponse = await server.inject({
    method: "POST",
    url: `/api/admin/knowledge/corpora/${corpusId}/sources/url`,
    headers: {
      ...adminHeaders,
      "idempotency-key": randomUUID(),
    },
    payload: {
      title: "Governed URL Corpus",
      url: "https://docs.example.test/governed-url-corpus",
    },
  })
  expect(urlResponse.statusCode).toBe(200)
  expect(await runKnowledgeUrlAcquisitionWorkerBatch()).toBe(1)
  const ingestResponse = await server.inject({
    method: "POST",
    url: `/api/admin/knowledge/corpora/${corpusId}/ingest`,
    headers: {
      ...adminHeaders,
      "idempotency-key": randomUUID(),
    },
  })
  expect(ingestResponse.statusCode).toBe(200)
  const snapshotId = ingestResponse.json().snapshot.id as string
  const publishResponse = await server.inject({
    method: "POST",
    url: `/api/admin/knowledge/corpora/${corpusId}/snapshots/${snapshotId}/publish`,
    headers: {
      ...adminHeaders,
      "idempotency-key": randomUUID(),
    },
  })
  expect(publishResponse.statusCode).toBe(200)
  return corpusId
}

async function createPublishedPdfParserCorpus(
  server: ReturnType<typeof buildServer>,
) {
  return createPdfParserCorpus(server, {
    idempotencyKeyPrefix: "pdf-mcp-published",
    publish: true,
  })
}

async function createPdfParserCorpus(
  server: ReturnType<typeof buildServer>,
  input: {
    idempotencyKeyPrefix: string
    publish: boolean
  },
): Promise<{
  corpusId: string
  fetchMock: ReturnType<typeof vi.fn>
  sourceId: string
}> {
  vi.stubEnv("KNOWLEDGE_PDF_PARSER_URL", "http://pdf-parser.test")
  vi.stubEnv("KNOWLEDGE_PDF_PARSER_SERVICE_TOKEN", "pdf-parser-token")
  const fetchMock = vi.fn(async () => {
    return new Response(
      JSON.stringify({
        artifacts: {
          json: {
            kids: [
              {
                content: "PDF immutable evidence for runtime retrieval.",
                "page number": 1,
              },
              {
                content: "Hrvatski PDF pravilnik za korpus.",
                "page number": 2,
              },
            ],
            "number of pages": 2,
          },
          markdown:
            "# PDF Runtime\nPDF immutable evidence.\n\n## Pravilnik\nHrvatski PDF pravilnik.",
          page_map: [
            {
              chunk_index: 0,
              element_id: "pdf-en-1",
              page_number: 1,
            },
            {
              chunk_index: 1,
              element_id: "pdf-hr-1",
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
            content: "PDF immutable evidence for runtime retrieval.",
            language: "en",
            page_number: 1,
            search_text: "PDF immutable evidence for runtime retrieval.",
            section_path: "PDF Runtime",
          },
          {
            content: "Hrvatski PDF pravilnik za korpus.",
            language: "hr",
            page_number: 2,
            search_text: "Hrvatski PDF pravilnik za korpus.",
            section_path: "Pravilnik",
          },
        ],
        language: "en",
        metadata: {
          elapsed_ms: 21,
          element_count: 4,
          opendataloader_options: ["--format", "json,markdown"],
          page_count: 2,
          parser: "opendataloader-pdf",
          parser_version: "2.4.7",
        },
        text: "PDF immutable evidence. Hrvatski PDF pravilnik.",
        warnings: [],
      }),
      {
        headers: { "content-type": "application/json" },
        status: 200,
      },
    )
  })
  vi.stubGlobal("fetch", fetchMock)

  const corpusId = await createCorpus(server, {
    name: `PDF Runtime Corpus ${input.idempotencyKeyPrefix}`,
  })
  const sourceId = await uploadRawSource(server, corpusId, {
    content: "%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF",
    fileName: "runtime-opendataloader.pdf",
    idempotencyKey: `${input.idempotencyKeyPrefix}-upload`,
    mimeType: "application/pdf",
  })
  const ingestResponse = await server.inject({
    method: "POST",
    url: `/api/admin/knowledge/corpora/${corpusId}/ingest`,
    headers: {
      ...adminHeaders,
      "idempotency-key": `${input.idempotencyKeyPrefix}-ingest`,
    },
  })
  expect(ingestResponse.statusCode).toBe(200)
  if (input.publish) {
    const snapshotId = ingestResponse.json().snapshot.id as string
    const publishResponse = await server.inject({
      method: "POST",
      url: `/api/admin/knowledge/corpora/${corpusId}/snapshots/${snapshotId}/publish`,
      headers: {
        ...adminHeaders,
        "idempotency-key": `${input.idempotencyKeyPrefix}-publish`,
      },
    })
    expect(publishResponse.statusCode).toBe(200)
  }
  return { corpusId, fetchMock, sourceId }
}

async function createCorpus(
  server: ReturnType<typeof buildServer>,
  input: {
    accessGroups?: string[]
    name: string
  },
) {
  const response = await server.inject({
    method: "POST",
    url: "/api/admin/knowledge/corpora",
    headers: {
      ...adminHeaders,
      "idempotency-key": randomUUID(),
    },
    payload: {
      accessGroups: input.accessGroups ?? [],
      name: input.name,
    },
  })
  expect(response.statusCode).toBe(201)
  return response.json().corpus.id as string
}

async function uploadFixtureSource(
  server: ReturnType<typeof buildServer>,
  corpusId: string,
  fileName: string,
  mimeType: string,
) {
  const response = await server.inject({
    method: "POST",
    url: `/api/admin/knowledge/corpora/${corpusId}/sources/upload`,
    headers: {
      ...adminHeaders,
      "idempotency-key": randomUUID(),
    },
    payload: {
      contentBase64: readFileSync(join(fixtureRoot, fileName)).toString(
        "base64",
      ),
      fileName,
      mimeType,
    },
  })
  expect(response.statusCode).toBe(200)
  return response.json().source.id as string
}

async function uploadRawSource(
  server: ReturnType<typeof buildServer>,
  corpusId: string,
  input: {
    content: string
    fileName: string
    idempotencyKey: string
    mimeType: string
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
      contentBase64: Buffer.from(input.content).toString("base64"),
      fileName: input.fileName,
      mimeType: input.mimeType,
    },
  })
  expect(response.statusCode).toBe(200)
  return response.json().source.id as string
}

async function transitionCorpus(
  server: ReturnType<typeof buildServer>,
  corpusId: string,
  action: "archive" | "disable",
) {
  const response = await server.inject({
    method: "POST",
    url: `/api/admin/knowledge/corpora/${corpusId}/${action}`,
    headers: {
      ...adminHeaders,
      "idempotency-key": randomUUID(),
    },
  })
  expect(response.statusCode).toBe(200)
}

async function mcpSearch(
  server: ReturnType<typeof buildServer>,
  args: Record<string, unknown>,
  headers: typeof serviceHeaders = serviceHeaders,
) {
  const response = await server.inject({
    method: "POST",
    url: "/api/mcp/internal-docs",
    headers,
    payload: {
      jsonrpc: "2.0",
      id: randomUUID(),
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
      content: Array<{
        text: string
        type: string
      }>
      structuredContent: {
        citations: Array<Record<string, unknown>>
        passages: Array<{
          citation: Record<string, unknown>
          excerpt: string
        }>
      }
    }
  }
}

async function internalDocsToolCall(
  server: ReturnType<typeof buildServer>,
  params: {
    arguments: Record<string, unknown>
    name: string
  },
) {
  const response = await server.inject({
    method: "POST",
    url: "/api/mcp/internal-docs",
    headers: serviceHeaders,
    payload: {
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "tools/call",
      params,
    },
  })
  expect(response.statusCode).toBe(200)
  return response.json() as {
    result: {
      structuredContent: Record<string, unknown>
    }
  }
}
