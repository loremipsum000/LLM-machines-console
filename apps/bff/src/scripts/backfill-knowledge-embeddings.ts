import type { Actor } from "../auth/persona"
import { backfillKnowledgeChunkEmbeddings } from "../services/knowledge/embeddings"
import { getKnowledgeDurableRepository } from "../services/knowledge/repository"

const actor: Actor = {
  authMode: "service-forwarded",
  email: "system@example.invalid",
  groups: [],
  persona: "admin",
  roles: ["admin"],
  subject: "knowledge-embedding-backfill",
}

const repository = getKnowledgeDurableRepository()
if (!repository) {
  throw new Error("DATABASE_URL is required for knowledge embedding backfill.")
}

const state = await repository.load()
const publishedSnapshotIds = new Set(
  state.corpora
    .filter((corpus) => corpus.status === "published")
    .map((corpus) => corpus.publishedSnapshotId)
    .filter((snapshotId): snapshotId is string => Boolean(snapshotId)),
)
const readySourceIds = new Set(
  state.sources
    .filter((source) => source.status === "ready")
    .map((source) => source.id),
)
const chunks = state.chunks.filter(
  (chunk) =>
    publishedSnapshotIds.has(chunk.snapshotId) &&
    readySourceIds.has(chunk.sourceId),
)

const result = await backfillKnowledgeChunkEmbeddings(actor, chunks)
process.stdout.write(
  JSON.stringify(
    {
      chunkCount: result.chunkCount,
      status: "ok",
    },
    null,
    2,
  ),
)
process.stdout.write("\n")
