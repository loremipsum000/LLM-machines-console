import type { Actor } from "../auth/persona"
import {
  getEnabledAdminMcpServerRuntimeRecords,
  getAdminConnectorRegistryReadModel,
  getAdminMcpServerRecord,
} from "./admin-connector-registry"
import { emitAudit } from "./audit"
import {
  getGovernedCorpusManifest,
  listAccessibleGovernedCorpora,
  queryGovernedKnowledgeRuntime,
  resolveGovernedCorpus,
} from "./knowledge/admin"
import { queryGovernedCorpusForQuestion } from "./knowledge/corpus-preflight"
import {
  egressMaxBytes,
  egressTimeoutMs,
  fetchPublicHttpEndpoint,
  validatePublicHttpEndpoint,
} from "./security/url-safety"

export interface McpGatewayRequest {
  id?: string | number | null
  jsonrpc?: string
  method?: string
  params?: unknown
}

type McpGatewayResponse =
  | {
      jsonrpc: "2.0"
      id: string | number | null
      result: unknown
    }
  | {
      jsonrpc: "2.0"
      id: string | number | null
      error: {
        code: number
        message: string
      }
    }

const INTERNAL_DOCS_CONNECTOR_ID = "internal-docs"
const ADMIN_MCP_SERVERS_CONNECTOR_ID = "admin-servers"
const ADMIN_MCP_TOOL_SEPARATOR = "__"

export async function handleInternalDocsMcpRequest(
  actor: Actor,
  request: McpGatewayRequest,
): Promise<McpGatewayResponse | null> {
  if (request.method?.startsWith("notifications/")) {
    return null
  }

  if (request.method === "initialize") {
    return result(request.id ?? null, {
      protocolVersion: "2025-03-26",
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "internal-docs",
        version: "0.1.0",
      },
    })
  }

  const connector = await getRunnableInternalDocsConnector()
  if (!connector.runnable) {
    await emitAudit({
      actorId: actor.subject,
      action: "connector.docs.denied",
      targetType: "mcp.connector",
      targetId: INTERNAL_DOCS_CONNECTOR_ID,
      reason: connector.detail,
      metadata: {
        method: request.method,
        source: "librechat_native_agent",
      },
    })
    return error(request.id ?? null, -32000, connector.detail)
  }

  if (request.method === "tools/list") {
    return result(request.id ?? null, {
      tools: [
        {
          name: "list_governed_corpora",
          description:
            "List published governed corpora available to the current user, including names, ids, language hints, and source summaries.",
          inputSchema: {
            type: "object",
            properties: {
              language: {
                type: "string",
                description: "Optional language filter such as hr or en.",
              },
              limit: {
                type: "integer",
                description: "Maximum corpora to return.",
              },
              query: {
                type: "string",
                description: "Optional corpus name, description, or source-title filter.",
              },
            },
          },
        },
        {
          name: "resolve_corpus",
          description:
            "Resolve a user-provided corpus name, slug, or id into accessible governed corpus ids before searching.",
          inputSchema: {
            type: "object",
            properties: {
              limit: {
                type: "integer",
                description: "Maximum candidates to return.",
              },
              reference: {
                type: "string",
                description: "Corpus name, slug, or UUID to resolve.",
              },
            },
            required: ["reference"],
          },
        },
        {
          name: "get_corpus_manifest",
          description:
            "Return redacted published-snapshot and source metadata for an accessible governed corpus. Accepts either corpus_id or corpus_ref; use corpus_ref when the user named a corpus such as ASML.",
          inputSchema: {
            type: "object",
            properties: {
              corpus_id: {
                type: "string",
                description: "Governed corpus UUID.",
              },
              corpus_ref: {
                type: "string",
                description: "Corpus name, slug, or UUID such as ASML.",
              },
            },
          },
        },
        {
          name: "query_governed_corpus",
          description:
            "Answer-ready retrieval for a named governed corpus. Use this first when the user names a corpus and asks a natural-language question; it resolves the corpus, expands vague queries, searches stored corpus chunks, and returns citations. This tool never performs live web fetches.",
          inputSchema: {
            type: "object",
            properties: {
              corpus_ref: {
                type: "string",
                description: "Corpus name, slug, or UUID such as ASML.",
              },
              language: {
                type: "string",
                description: "Optional language filter such as hr or en.",
              },
              question: {
                type: "string",
                description: "User question to retrieve evidence for.",
              },
              top_k: {
                type: "integer",
                description: "Maximum passages to return.",
              },
            },
            required: ["corpus_ref", "question"],
          },
        },
        {
          name: "search_internal_docs",
          description:
            "Search Admin-published governed corpora available to the current user. If the user names a corpus, pass that name in corpus_refs rather than searching blindly. This tool never performs live web fetches.",
          inputSchema: {
            type: "object",
            properties: {
              corpus_refs: {
                type: "array",
                description:
                  "Optional corpus names, slugs, or ids to resolve before search.",
                items: {
                  type: "string",
                },
              },
              corpus_ids: {
                type: "array",
                description:
                  "Optional additional corpus id filter. Draft, disabled, archived, deleted, and unauthorized corpora return no content.",
                items: {
                  type: "string",
                },
              },
              language: {
                type: "string",
                description: "Optional language filter such as hr or en.",
              },
              query: {
                type: "string",
                description: "Search query for governed corpus retrieval.",
              },
              source_types: {
                type: "array",
                description: "Optional source type filter.",
                items: {
                  enum: ["file", "url", "image", "table"],
                  type: "string",
                },
              },
              top_k: {
                type: "integer",
                description: "Maximum passages to return.",
              },
            },
            required: ["query"],
          },
        },
      ],
    })
  }

  if (request.method === "tools/call") {
    const toolCall = parseToolCall(request.params)
    if (toolCall.name === "list_governed_corpora") {
      await emitAudit({
        actorId: actor.subject,
        action: "connector.docs.list",
        targetType: "mcp.connector",
        targetId: INTERNAL_DOCS_CONNECTOR_ID,
        metadata: {
          query: toolCall.query || undefined,
          source: "librechat_native_agent",
        },
      })
      const response = await listAccessibleGovernedCorpora(actor, {
        language: toolCall.language,
        limit: toolCall.limit,
        query: toolCall.query || undefined,
      })
      return result(request.id ?? null, {
        content: [
          {
            type: "text",
            text: formatGovernedCorpusListResponse(response.corpora),
          },
        ],
        structuredContent: response,
      })
    }

    if (toolCall.name === "resolve_corpus") {
      if (!toolCall.reference) {
        return error(request.id ?? null, -32602, "Corpus reference required.")
      }
      await emitAudit({
        actorId: actor.subject,
        action: "connector.docs.resolve",
        targetType: "mcp.connector",
        targetId: INTERNAL_DOCS_CONNECTOR_ID,
        metadata: {
          reference: toolCall.reference,
          source: "librechat_native_agent",
        },
      })
      const response = await resolveGovernedCorpus(actor, {
        limit: toolCall.limit,
        reference: toolCall.reference,
      })
      return result(request.id ?? null, {
        content: [
          {
            type: "text",
            text: formatCorpusResolutionResponse(response),
          },
        ],
        structuredContent: response,
      })
    }

    if (toolCall.name === "get_corpus_manifest") {
      const corpusId = await resolveManifestToolCorpusId(actor, toolCall)
      if (!corpusId) {
        return error(
          request.id ?? null,
          -32602,
          "Corpus id or corpus reference required.",
        )
      }
      await emitAudit({
        actorId: actor.subject,
        action: "connector.docs.manifest",
        targetType: "knowledge.corpus",
        targetId: corpusId,
        metadata: {
          corpusRef: toolCall.corpusRef,
          source: "librechat_native_agent",
        },
      })
      const response = await getGovernedCorpusManifest(actor, corpusId)
      if (!response) {
        return error(request.id ?? null, -32000, "Published corpus not found.")
      }
      return result(request.id ?? null, {
        content: [
          {
            type: "text",
            text: formatCorpusManifestResponse(response),
          },
        ],
        structuredContent: response,
      })
    }

    if (toolCall.name === "query_governed_corpus") {
      if (!toolCall.corpusRef) {
        return error(request.id ?? null, -32602, "Corpus reference required.")
      }
      if (!toolCall.question) {
        return error(request.id ?? null, -32602, "Question required.")
      }
      await emitAudit({
        actorId: actor.subject,
        action: "connector.docs.query",
        targetType: "mcp.connector",
        targetId: INTERNAL_DOCS_CONNECTOR_ID,
        metadata: {
          corpusRef: toolCall.corpusRef,
          question: toolCall.question,
          source: "librechat_native_agent",
        },
      })
      const searchResult = await queryGovernedCorpusForQuestion(actor, {
        corpusRef: toolCall.corpusRef,
        language: toolCall.language,
        question: toolCall.question,
        topK: toolCall.topK,
      })
      return result(request.id ?? null, {
        content: [
          {
            type: "text",
            text: formatGovernedCorpusSearchResponse(searchResult),
          },
        ],
        structuredContent: {
          citations: searchResult.citations,
          expanded_queries: searchResult.expandedQueries,
          no_result_reason: searchResult.noResultReason,
          passages: searchResult.results,
          query: searchResult.query,
          retrieval_mode: searchResult.retrievalMode,
          selected_corpora: searchResult.selectedCorpora,
          unresolved_corpora: searchResult.unresolvedCorpora,
          warnings: searchResult.warnings,
        },
      })
    }

    if (toolCall.name !== "search_internal_docs") {
      return error(request.id ?? null, -32602, "Unsupported internal docs tool.")
    }
    if (!toolCall.query) {
      return error(request.id ?? null, -32602, "Search query required.")
    }

    await emitAudit({
      actorId: actor.subject,
      action: "connector.docs.search",
      targetType: "mcp.connector",
      targetId: INTERNAL_DOCS_CONNECTOR_ID,
      metadata: {
        corpusIds: toolCall.corpusIds,
        corpusRefs: toolCall.corpusRefs,
        query: toolCall.query,
        source: "librechat_native_agent",
      },
    })
    const searchResult = await queryGovernedKnowledgeRuntime(actor, {
      corpusIds: toolCall.corpusIds,
      corpusRefs: toolCall.corpusRefs,
      language: toolCall.language,
      query: toolCall.query,
      sourceTypes: toolCall.sourceTypes,
      topK: toolCall.topK,
    })

    return result(request.id ?? null, {
      content: [
        {
          type: "text",
          text: formatGovernedCorpusSearchResponse(searchResult),
        },
      ],
      structuredContent: {
        citations: searchResult.citations,
        no_result_reason: searchResult.noResultReason,
        passages: searchResult.results,
        query: searchResult.query,
        retrieval_mode: searchResult.retrievalMode,
        selected_corpora: searchResult.selectedCorpora,
        unresolved_corpora: searchResult.unresolvedCorpora,
        warnings: searchResult.warnings,
      },
    })
  }

  return error(request.id ?? null, -32601, "Unsupported MCP method.")
}

export async function handleAdminMcpServerRequest(
  actor: Actor,
  connectorId: string,
  request: McpGatewayRequest,
): Promise<McpGatewayResponse | null> {
  if (request.method?.startsWith("notifications/")) {
    return null
  }

  const connector = await getRunnableAdminMcpServerConnector(actor, connectorId)
  if (!connector.record) {
    return error(request.id ?? null, -32601, "Unknown MCP connector.")
  }
  if (!connector.runnable) {
    await emitAudit({
      actorId: actor.subject,
      action: "connector.mcp.denied",
      targetType: "mcp.connector",
      targetId: connectorId,
      reason: connector.detail,
      metadata: {
        method: request.method,
        source: "librechat_native_agent",
      },
    })
    return error(request.id ?? null, -32000, connector.detail)
  }

  if (connector.record.transport !== "url" || !connector.record.endpointUrl) {
    return error(
      request.id ?? null,
      -32000,
      "Only URL-backed Admin MCP servers can be invoked through the BFF gateway.",
    )
  }
  const endpointValidation = validatePublicHttpEndpoint(
    connector.record.endpointUrl,
  )
  if (!endpointValidation.ok || !endpointValidation.url) {
    await emitAudit({
      actorId: actor.subject,
      action: "connector.mcp.failed",
      targetType: "mcp.connector",
      targetId: connectorId,
      reason: "MCP upstream URL failed egress safety validation.",
      metadata: {
        method: request.method,
        source: "librechat_native_agent",
      },
    })
    return error(request.id ?? null, -32000, "MCP upstream request failed.")
  }

  const headers = new Headers({ "Content-Type": "application/json" })
  let bearerToken: string | null = null
  if (connector.record.authMode === "bearer") {
    const secretRef = connector.record.bearerTokenSecretRef ?? ""
    bearerToken = process.env[secretRef]?.trim() ?? ""
    if (!bearerToken) {
      return error(
        request.id ?? null,
        -32000,
        "Configured MCP bearer secret is not available to the BFF.",
      )
    }
    headers.set("Authorization", `Bearer ${bearerToken}`)
  }

  try {
    const upstream = await fetchPublicHttpEndpoint(
      endpointValidation.url.toString(),
      {
        body: JSON.stringify(request),
        headers,
        method: "POST",
        maxBytes: egressMaxBytes("BFF_MCP_MAX_RESPONSE_BYTES", 1024 * 1024),
        timeoutMs: egressTimeoutMs("BFF_MCP_FETCH_TIMEOUT_MS", 5000),
      },
    )
    if (!upstream.response.ok) {
      throw new Error("MCP upstream returned an HTTP error.")
    }
    const parsedPayload = parseMcpJsonResponse(upstream.bodyText)
    if (!isMcpGatewayResponse(parsedPayload)) {
      throw new Error("MCP upstream returned an invalid JSON-RPC response.")
    }
    const payload = redactMcpGatewayResponseSecrets(
      parsedPayload,
      [bearerToken, bearerToken ? `Bearer ${bearerToken}` : null],
    )
    await emitAudit({
      actorId: actor.subject,
      action: "connector.mcp.forwarded",
      targetType: "mcp.connector",
      targetId: connectorId,
      metadata: {
        method: request.method,
        source: "librechat_native_agent",
        transport: connector.record.transport,
      },
    })
    return payload
  } catch {
    const detail = "MCP upstream request failed."
    await emitAudit({
      actorId: actor.subject,
      action: "connector.mcp.failed",
      targetType: "mcp.connector",
      targetId: connectorId,
      reason: detail,
      metadata: {
        method: request.method,
        source: "librechat_native_agent",
      },
    })
    return error(request.id ?? null, -32000, detail)
  }
}

export async function handleAdminMcpServersAggregateRequest(
  actor: Actor,
  request: McpGatewayRequest,
): Promise<McpGatewayResponse | null> {
  if (request.method?.startsWith("notifications/")) {
    return null
  }

  if (request.method === "initialize") {
    return result(request.id ?? null, {
      protocolVersion: "2025-03-26",
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: ADMIN_MCP_SERVERS_CONNECTOR_ID,
        version: "0.1.0",
      },
    })
  }

  if (request.method === "tools/list") {
    const records = (await getEnabledAdminMcpServerRuntimeRecords()).filter(
      (record) => adminMcpServerAllowedForActor(record, actor),
    )
    const tools = []
    for (const record of records) {
      const response = await handleAdminMcpServerRequest(actor, record.id, {
        id: `list-${record.id}`,
        jsonrpc: "2.0",
        method: "tools/list",
      })
      tools.push(...prefixAdminMcpServerTools(record, response))
    }

    return result(request.id ?? null, { tools })
  }

  if (request.method === "tools/call") {
    const toolCall = parseAggregateToolCall(request.params)
    if (!toolCall) {
      return error(
        request.id ?? null,
        -32602,
        "Admin MCP tool names must use connectorId__toolName.",
      )
    }

    return handleAdminMcpServerRequest(actor, toolCall.connectorId, {
      ...request,
      params: rewriteAggregateToolCallParams(
        request.params,
        toolCall.upstreamToolName,
      ),
    })
  }

  return error(request.id ?? null, -32601, "Unsupported MCP method.")
}

function redactMcpGatewayResponseSecrets<T>(value: T, secrets: Array<string | null>): T {
  const activeSecrets = secrets.filter(
    (secret): secret is string => Boolean(secret),
  ).sort((left, right) => right.length - left.length)
  if (activeSecrets.length === 0) {
    return value
  }
  return redactJsonSecrets(value, activeSecrets) as T
}

function redactJsonSecrets(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") {
    return secrets.reduce(
      (redacted, secret) => redacted.split(secret).join("[redacted]"),
      value,
    )
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJsonSecrets(item, secrets))
  }
  if (!value || typeof value !== "object") {
    return value
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      redactJsonSecrets(nestedValue, secrets),
    ]),
  )
}

async function getRunnableInternalDocsConnector(): Promise<{
  detail: string
  runnable: boolean
}> {
  const registry = await getAdminConnectorRegistryReadModel({
    query: INTERNAL_DOCS_CONNECTOR_ID,
  })
  const item = registry.items.find((candidate) => {
    return candidate.id === INTERNAL_DOCS_CONNECTOR_ID
  })
  if (!item) {
    return {
      detail: "Internal Docs connector is not present in the signed catalog.",
      runnable: false,
    }
  }
  if (!item.runtimeSetup.runnable) {
    return {
      detail: item.runtimeSetup.detail,
      runnable: false,
    }
  }
  return {
    detail: "Internal Docs connector is runnable.",
    runnable: true,
  }
}

async function getRunnableAdminMcpServerConnector(
  actor: Actor,
  connectorId: string,
): Promise<{
  detail: string
  record: Awaited<ReturnType<typeof getAdminMcpServerRecord>>
  runnable: boolean
}> {
  const record = await getAdminMcpServerRecord(connectorId)
  if (!record) {
    return {
      detail: "Admin-created MCP server is not configured.",
      record,
      runnable: false,
    }
  }
  if (record.status !== "enabled") {
    return {
      detail: "Admin-created MCP server is not enabled.",
      record,
      runnable: false,
    }
  }
  if (record.transport !== "url") {
    return {
      detail:
        "STDIO MCP servers require the appliance runtime launcher before invocation.",
      record,
      runnable: false,
    }
  }
  if (!adminMcpServerAllowedForActor(record, actor)) {
    return {
      detail: "Admin-created MCP server is not allowed for this actor.",
      record,
      runnable: false,
    }
  }
  return {
    detail: "Admin-created MCP server is runnable.",
    record,
    runnable: true,
  }
}

function adminMcpServerAllowedForActor(
  record: NonNullable<Awaited<ReturnType<typeof getAdminMcpServerRecord>>>,
  actor: Actor,
): boolean {
  if (record.accessGroups.length === 0) {
    return true
  }
  const groups = new Set(
    (actor.groups ?? []).map((group) => group.toLowerCase()),
  )
  return record.accessGroups.some((group) => groups.has(group.toLowerCase()))
}

function prefixAdminMcpServerTools(
  record: NonNullable<Awaited<ReturnType<typeof getAdminMcpServerRecord>>>,
  response: McpGatewayResponse | null,
): Record<string, unknown>[] {
  if (!response || !("result" in response) || !isRecord(response.result)) {
    return []
  }
  const tools = response.result.tools
  if (!Array.isArray(tools)) {
    return []
  }
  return tools
    .map((tool) => prefixAdminMcpServerTool(record, tool))
    .filter((tool): tool is Record<string, unknown> => Boolean(tool))
}

function prefixAdminMcpServerTool(
  record: NonNullable<Awaited<ReturnType<typeof getAdminMcpServerRecord>>>,
  tool: unknown,
): Record<string, unknown> | null {
  if (!isRecord(tool) || typeof tool.name !== "string" || !tool.name) {
    return null
  }
  const description =
    typeof tool.description === "string" && tool.description.trim()
      ? `${record.name}: ${tool.description}`
      : `Tool from ${record.name}.`
  return {
    ...tool,
    description,
    name: `${record.id}${ADMIN_MCP_TOOL_SEPARATOR}${tool.name}`,
  }
}

function parseAggregateToolCall(params: unknown):
  | {
      connectorId: string
      upstreamToolName: string
    }
  | null {
  if (!isRecord(params) || typeof params.name !== "string") {
    return null
  }
  const separatorIndex = params.name.indexOf(ADMIN_MCP_TOOL_SEPARATOR)
  if (separatorIndex <= 0) {
    return null
  }
  const connectorId = params.name.slice(0, separatorIndex)
  const upstreamToolName = params.name.slice(
    separatorIndex + ADMIN_MCP_TOOL_SEPARATOR.length,
  )
  if (!connectorId || !upstreamToolName) {
    return null
  }
  return { connectorId, upstreamToolName }
}

function rewriteAggregateToolCallParams(
  params: unknown,
  upstreamToolName: string,
): Record<string, unknown> {
  return {
    ...(isRecord(params) ? params : {}),
    name: upstreamToolName,
  }
}

function parseToolCall(params: unknown): {
  corpusId?: string
  corpusIds?: string[]
  corpusRef?: string
  corpusRefs?: string[]
  language?: string
  limit?: number
  name: string
  question?: string
  query: string
  reference?: string
  sourceTypes?: Array<"file" | "image" | "table" | "url">
  topK?: number
} {
  if (!isRecord(params)) {
    return { name: "", query: "" }
  }
  const name = typeof params.name === "string" ? params.name : ""
  const args = isRecord(params.arguments) ? params.arguments : {}
  const query = typeof args.query === "string" ? args.query.trim() : ""
  return {
    corpusId:
      typeof args.corpus_id === "string" ? args.corpus_id.trim() : undefined,
    corpusIds: stringArray(args.corpus_ids),
    corpusRef:
      typeof args.corpus_ref === "string" ? args.corpus_ref.trim() : undefined,
    corpusRefs: stringArray(args.corpus_refs),
    language: typeof args.language === "string" ? args.language : undefined,
    limit:
      typeof args.limit === "number" && Number.isInteger(args.limit)
        ? args.limit
        : undefined,
    name,
    question:
      typeof args.question === "string" ? args.question.trim() : undefined,
    query,
    reference:
      typeof args.reference === "string" ? args.reference.trim() : undefined,
    sourceTypes: sourceTypeArray(args.source_types),
    topK:
      typeof args.top_k === "number" && Number.isInteger(args.top_k)
        ? args.top_k
        : undefined,
  }
}

async function resolveManifestToolCorpusId(
  actor: Actor,
  toolCall: {
    corpusId?: string
    corpusRef?: string
  },
): Promise<string | null> {
  if (toolCall.corpusId) {
    return toolCall.corpusId
  }
  if (!toolCall.corpusRef) {
    return null
  }
  const resolution = await resolveGovernedCorpus(actor, {
    reference: toolCall.corpusRef,
  })
  if (resolution.status !== "resolved") {
    return null
  }
  return resolution.candidates[0]?.id ?? null
}

function formatGovernedCorpusSearchResponse(
  searchResult: Awaited<ReturnType<typeof queryGovernedKnowledgeRuntime>>,
): string {
  if (searchResult.results.length === 0) {
    return `${searchResult.noResultReason ?? "No published governed corpus passages matched the query"} Query: ${searchResult.query}`
  }
  return searchResult.results
    .map((item, index) => {
      const citation = item.citation
      const locator =
        citation.page_number !== undefined
          ? `page ${citation.page_number}`
          : citation.row_range
            ? `rows ${citation.row_range}`
            : citation.image_region
              ? `image ${citation.image_region}`
              : (citation.section_path ?? "source")
      return [
        `${index + 1}. ${item.title} (${locator})`,
        item.excerpt,
        `citation_id=${citation.citation_id}`,
      ].join("\n")
    })
    .join("\n\n")
}

function formatGovernedCorpusListResponse(
  corpora: Awaited<
    ReturnType<typeof listAccessibleGovernedCorpora>
  >["corpora"],
): string {
  if (corpora.length === 0) {
    return "No published governed corpora are available to this user."
  }
  return corpora
    .map((corpus, index) => {
      const sourceSummary = corpus.sourceSummary
        .map((item) => `${item.sourceType}:${item.count}`)
        .join(", ")
      return `${index + 1}. ${corpus.name} id=${corpus.id} sources=${sourceSummary || "none"} chunks=${corpus.chunkCount}`
    })
    .join("\n")
}

function formatCorpusResolutionResponse(
  resolution: Awaited<ReturnType<typeof resolveGovernedCorpus>>,
): string {
  if (resolution.status === "not_found") {
    return `No accessible governed corpus matched: ${resolution.query}`
  }
  return resolution.candidates
    .map(
      (candidate, index) =>
        `${index + 1}. ${candidate.name} id=${candidate.id} match=${candidate.matchReason}`,
    )
    .join("\n")
}

function formatCorpusManifestResponse(
  manifest: NonNullable<Awaited<ReturnType<typeof getGovernedCorpusManifest>>>,
): string {
  const sources = manifest.sources
    .map((source) => `${source.title} (${source.sourceType})`)
    .join(", ")
  return [
    `${manifest.corpus.name} id=${manifest.corpus.id}`,
    `retrieval_ready=${manifest.retrievalReady}`,
    `chunks=${manifest.corpus.chunkCount}`,
    `sources=${sources || "none"}`,
  ].join("\n")
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const values = value.filter(
    (item): item is string => typeof item === "string",
  )
  return values.length > 0 ? values : undefined
}

function sourceTypeArray(
  value: unknown,
): Array<"file" | "image" | "table" | "url"> | undefined {
  const allowed = new Set(["file", "image", "table", "url"])
  const values = stringArray(value)?.filter(
    (item): item is "file" | "image" | "table" | "url" => allowed.has(item),
  )
  return values && values.length > 0 ? values : undefined
}

function result(
  id: string | number | null,
  value: unknown,
): McpGatewayResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: value,
  }
}

function error(
  id: string | number | null,
  code: number,
  message: string,
): McpGatewayResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseMcpJsonResponse(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText)
  } catch {
    throw new Error("MCP upstream returned invalid JSON.")
  }
}

function isMcpGatewayResponse(value: unknown): value is McpGatewayResponse {
  if (!isRecord(value) || value.jsonrpc !== "2.0") {
    return false
  }
  if (!("id" in value)) {
    return false
  }
  if ("result" in value) {
    return true
  }
  if (!isRecord(value.error)) {
    return false
  }
  return (
    typeof value.error.code === "number" &&
    typeof value.error.message === "string"
  )
}
