import type {
  AdminInternalDocsMcpPosture,
  HubSourceStatus,
} from "@llm-machines/contracts"
import type { Actor } from "../auth/persona"
import { emitAudit, getRecentAuditEvents } from "./audit"
import { getKnowledgeEmbeddingPosture } from "./knowledge/embeddings"
import { listAccessibleGovernedCorpora } from "./knowledge/admin"

const internalDocsTools = [
  "list_governed_corpora",
  "resolve_corpus",
  "get_corpus_manifest",
  "query_governed_corpus",
  "search_internal_docs",
]

export async function getInternalDocsMcpPosture(
  actor: Actor,
): Promise<AdminInternalDocsMcpPosture> {
  const [embedding, corpusList, recentAudit] = await Promise.all([
    getKnowledgeEmbeddingPosture(),
    listAccessibleGovernedCorpora(actor, { limit: 100 }),
    getRecentAuditEvents(50),
  ])
  const recentFailures = recentAudit
    .filter(
      (event) =>
        event.action === "auth.denied" ||
        event.action === "connector.docs.embedding_failed",
    )
    .filter((event) => event.reason)
    .slice(0, 10)
    .map((event) => ({
      action: event.action,
      createdAt: event.createdAt,
      reason: event.reason ?? "unknown",
    }))

  await emitAudit({
    actorId: actor.subject,
    action: "admin.internal_docs_mcp.posture.read",
    targetType: "mcp.connector",
    targetId: "internal-docs",
    metadata: {
      publishedAccessibleCount: corpusList.corpora.length,
      routeScopedServiceAuthEnabled: mcpServiceAuthEnabled(),
      toolCount: internalDocsTools.length,
    },
  })

  return {
    generatedAt: new Date().toISOString(),
    sourceStatus: postureSourceStatus(embedding.sourceStatus, recentFailures.length),
    auth: {
      routeScopedServiceAuthEnabled: mcpServiceAuthEnabled(),
      unresolvedPlaceholderProtection: true,
    },
    tools: internalDocsTools,
    embedding: {
      coverage: embedding.coverage,
      dimensions: embedding.dimensions,
      enabled: embedding.enabled,
      model: embedding.model,
      searchMode: embedding.searchMode,
      sourceStatus: embedding.sourceStatus,
    },
    corpora: {
      publishedAccessibleCount: corpusList.corpora.length,
      totalChunkCount: corpusList.corpora.reduce(
        (total, corpus) => total + corpus.chunkCount,
        0,
      ),
    },
    recentFailures,
  }
}

function postureSourceStatus(
  embeddingStatus: HubSourceStatus,
  failureCount: number,
): HubSourceStatus {
  if (embeddingStatus === "degraded" || failureCount > 0) {
    return "degraded"
  }
  return embeddingStatus === "ok" ? "ok" : "not_configured"
}

function mcpServiceAuthEnabled(): boolean {
  const value = process.env.BFF_MCP_ALLOW_SERVICE_FORWARDED_AUTH
  if (!value) {
    return true
  }
  return ["1", "true", "yes"].includes(value.trim().toLowerCase())
}
