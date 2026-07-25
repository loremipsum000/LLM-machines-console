CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA common;

CREATE TABLE IF NOT EXISTS common.embeddings_knowledge_chunks (
  id uuid PRIMARY KEY,
  owner_schema text NOT NULL DEFAULT 'knowledge',
  owner_table text NOT NULL DEFAULT 'chunks',
  owner_id uuid NOT NULL,
  corpus_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  source_id uuid NOT NULL,
  checksum text NOT NULL,
  model text NOT NULL,
  dimensions integer NOT NULL CHECK (dimensions = 1024),
  embedding common.vector(1024),
  status text NOT NULL CHECK (status IN ('ready', 'failed')),
  error_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_schema, owner_table, owner_id, model)
);

CREATE INDEX IF NOT EXISTS common_embeddings_knowledge_chunks_lookup_idx
  ON common.embeddings_knowledge_chunks
  (corpus_id, snapshot_id, status);

CREATE INDEX IF NOT EXISTS common_embeddings_knowledge_chunks_vector_idx
  ON common.embeddings_knowledge_chunks
  USING ivfflat (embedding common.vector_cosine_ops)
  WITH (lists = 100)
  WHERE status = 'ready' AND dimensions = 1024;
