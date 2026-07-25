CREATE SCHEMA IF NOT EXISTS knowledge_archive;

CREATE TABLE IF NOT EXISTS knowledge_archive.sources (
  id uuid PRIMARY KEY,
  corpus_id uuid NOT NULL REFERENCES knowledge.corpora(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL,
  source_type text NOT NULL CHECK (
    source_type IN ('file', 'url', 'image', 'table')
  ),
  title text NOT NULL,
  original_uri text,
  final_uri text,
  canonical_uri text,
  mime_type text NOT NULL,
  checksum text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('pending', 'fetching', 'extracting', 'ready', 'failed', 'blocked', 'removed')
  ),
  language text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_detail text,
  created_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  source_created_at timestamptz NOT NULL,
  source_updated_at timestamptz NOT NULL,
  archived_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  archived_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (corpus_id, source_id)
);

CREATE INDEX IF NOT EXISTS knowledge_archive_sources_corpus_archived_idx
  ON knowledge_archive.sources (corpus_id, archived_at DESC);

CREATE INDEX IF NOT EXISTS knowledge_archive_sources_source_idx
  ON knowledge_archive.sources (corpus_id, source_id);
