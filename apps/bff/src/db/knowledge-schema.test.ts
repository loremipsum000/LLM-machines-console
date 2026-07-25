import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const archiveMigration = readFileSync(
  join(
    process.cwd(),
    "../../infra/migrations/0019_knowledge_source_archive.sql",
  ),
  "utf8",
)
const disabledSourceStatusMigration = readFileSync(
  join(
    process.cwd(),
    "../../infra/migrations/0020_knowledge_disabled_source_status.sql",
  ),
  "utf8",
)
const embeddingMigration = readFileSync(
  join(
    process.cwd(),
    "../../infra/migrations/0026_knowledge_chunk_embeddings.sql",
  ),
  "utf8",
)
const migration = [
  "0018_knowledge_corpora.sql",
  "0019_knowledge_source_archive.sql",
  "0020_knowledge_disabled_source_status.sql",
  "0021_admin_mcp_servers.sql",
  "0023_admin_connected_apps.sql",
  "0024_admin_connected_app_api_keys.sql",
  "0025_knowledge_url_acquisition_jobs.sql",
  "0026_knowledge_chunk_embeddings.sql",
]
  .map((fileName) =>
    readFileSync(
      join(process.cwd(), "../../infra/migrations", fileName),
      "utf8",
    ),
  )
  .join("\n")

describe("knowledge schema migration", () => {
  it("defines the governed corpus table set", () => {
    const tables = [
      "knowledge.corpora",
      "knowledge.sources",
      "knowledge.source_artifacts",
      "knowledge_archive.sources",
      "knowledge.ingestion_jobs",
      "knowledge.url_acquisition_jobs",
      "knowledge.snapshots",
      "knowledge.chunks",
      "knowledge.corpus_access_groups",
      "knowledge.agent_corpus_bindings",
    ]

    for (const table of tables) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
    }
  })

  it("rejects corpus states outside the governed lifecycle", () => {
    const allowedStates = [
      "draft",
      "ingesting",
      "staged",
      "published",
      "refreshing",
      "failed",
      "disabled",
      "archived",
      "deleted",
    ]

    for (const state of allowedStates) {
      expect(migration).toContain(`'${state}'`)
    }
    expect(migration).not.toContain("'approved'")
    expect(migration).not.toContain("'rejected'")
  })

  it("moves archived corpus sources out of active retrieval tables", () => {
    expect(archiveMigration).toContain(
      "CREATE SCHEMA IF NOT EXISTS knowledge_archive",
    )
    expect(archiveMigration).toContain("UNIQUE (corpus_id, source_id)")
    expect(archiveMigration).toContain("source_id uuid NOT NULL")
    expect(archiveMigration).not.toContain(
      "source_id uuid NOT NULL REFERENCES knowledge.sources",
    )
  })

  it("allows disabled source states with robust constraint replacement", () => {
    expect(disabledSourceStatusMigration).toContain(
      "ALTER TABLE knowledge.sources DROP CONSTRAINT",
    )
    expect(disabledSourceStatusMigration).toContain(
      "ALTER TABLE knowledge_archive.sources DROP CONSTRAINT",
    )
    expect(disabledSourceStatusMigration).toContain(
      "pg_get_constraintdef(oid) ILIKE '%status%'",
    )
    expect(disabledSourceStatusMigration).toContain("'disabled'")
    expect(disabledSourceStatusMigration).not.toContain("LIKE '%status IN%'")
  })

  it("defines URL acquisition jobs and URL artifact report types", () => {
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS knowledge.url_acquisition_jobs",
    )
    expect(migration).toContain(
      "status IN ('queued', 'running', 'succeeded', 'failed', 'blocked', 'cancelled')",
    )
    expect(migration).toContain("adapter IN ('safe_fetch', 'firecrawl')")
    expect(migration).toContain("knowledge_url_acquisition_jobs_status_idx")
    expect(migration).toContain("'url_fetch_report'")
    expect(migration).toContain("'parser_report'")
  })

  it("defines admin-created MCP server inventory without exposing secrets", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS admin.mcp_servers")
    expect(migration).toContain("chat_command text NOT NULL UNIQUE")
    expect(migration).toContain("transport IN ('url', 'stdio')")
    expect(migration).toContain("auth_mode IN ('bearer', 'none')")
    expect(migration).toContain("bearer_token_secret_ref text")
    expect(migration).not.toContain("bearer_token text")
  })

  it("defines connected app inventory without persisted client secrets", () => {
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS admin.connected_apps",
    )
    expect(migration).toContain("owner_group text NOT NULL")
    expect(migration).toContain("allowed_models jsonb NOT NULL")
    expect(migration).toContain(
      "rate_limit_rpm integer CHECK (rate_limit_rpm IS NULL OR rate_limit_rpm > 0)",
    )
    expect(migration).toContain(
      "token_budget_7d integer CHECK (token_budget_7d IS NULL OR token_budget_7d > 0)",
    )
    expect(migration).toContain("status IN ('enabled', 'disabled')")
    expect(migration).toContain("environments jsonb NOT NULL")
    expect(migration).toContain("usage_summary jsonb NOT NULL")
    expect(migration).not.toContain("client_secret")
  })

  it("defines connected app static API keys with hashes only", () => {
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS admin.connected_app_api_keys",
    )
    expect(migration).toContain("app_id text NOT NULL")
    expect(migration).toContain(
      "environment text NOT NULL CHECK (environment IN ('staging', 'production'))",
    )
    expect(migration).toContain("key_prefix text NOT NULL")
    expect(migration).toContain("key_hash text NOT NULL")
    expect(migration).toContain(
      "status text NOT NULL CHECK (status IN ('active', 'revoked'))",
    )
    expect(migration).toContain("last_used_at timestamptz")
    expect(migration).not.toContain("api_key text")
    expect(migration).not.toContain("raw_key")
  })

  it("defines governed corpus embeddings in common pgvector tables", () => {
    expect(embeddingMigration).toContain(
      "CREATE EXTENSION IF NOT EXISTS vector",
    )
    expect(embeddingMigration).toContain(
      "CREATE TABLE IF NOT EXISTS common.embeddings_knowledge_chunks",
    )
    expect(embeddingMigration).toContain(
      "owner_schema text NOT NULL DEFAULT 'knowledge'",
    )
    expect(embeddingMigration).toContain("embedding common.vector(1024)")
    expect(embeddingMigration).toContain("common.vector_cosine_ops")
    expect(embeddingMigration).not.toContain("REFERENCES knowledge.chunks")
  })
})
