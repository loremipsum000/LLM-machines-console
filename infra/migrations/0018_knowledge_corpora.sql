CREATE SCHEMA IF NOT EXISTS knowledge;

CREATE TABLE IF NOT EXISTS knowledge.corpora (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (
    status IN (
      'draft',
      'ingesting',
      'staged',
      'published',
      'refreshing',
      'failed',
      'disabled',
      'archived',
      'deleted'
    )
  ),
  language_hints jsonb NOT NULL DEFAULT '[]'::jsonb,
  published_snapshot_id uuid,
  created_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  updated_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_corpora_status_updated_idx
  ON knowledge.corpora (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS knowledge.sources (
  id uuid PRIMARY KEY,
  corpus_id uuid NOT NULL REFERENCES knowledge.corpora(id) ON DELETE RESTRICT,
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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_sources_corpus_status_idx
  ON knowledge.sources (corpus_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS knowledge.source_artifacts (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES knowledge.sources(id) ON DELETE RESTRICT,
  artifact_type text NOT NULL CHECK (
    artifact_type IN ('original', 'url_snapshot', 'normalized_text', 'ocr_text', 'table_json', 'preview')
  ),
  object_key text NOT NULL,
  mime_type text NOT NULL,
  checksum text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, artifact_type, object_key)
);

CREATE INDEX IF NOT EXISTS knowledge_source_artifacts_source_idx
  ON knowledge.source_artifacts (source_id, artifact_type);

CREATE TABLE IF NOT EXISTS knowledge.ingestion_jobs (
  id uuid PRIMARY KEY,
  corpus_id uuid NOT NULL REFERENCES knowledge.corpora(id) ON DELETE RESTRICT,
  source_id uuid REFERENCES knowledge.sources(id) ON DELETE RESTRICT,
  job_type text NOT NULL CHECK (job_type IN ('ingest', 'refresh', 'retry_source')),
  status text NOT NULL CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  progress_percent integer NOT NULL DEFAULT 0 CHECK (
    progress_percent >= 0 AND progress_percent <= 100
  ),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_detail text,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  locked_by text,
  locked_at timestamptz,
  created_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_ingestion_jobs_status_idx
  ON knowledge.ingestion_jobs (status, created_at);

CREATE TABLE IF NOT EXISTS knowledge.snapshots (
  id uuid PRIMARY KEY,
  corpus_id uuid NOT NULL REFERENCES knowledge.corpora(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('staged', 'published', 'discarded')),
  source_count integer NOT NULL DEFAULT 0 CHECK (source_count >= 0),
  chunk_count integer NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_by text REFERENCES common.users(id) ON DELETE RESTRICT,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (corpus_id, version)
);

CREATE INDEX IF NOT EXISTS knowledge_snapshots_corpus_status_idx
  ON knowledge.snapshots (corpus_id, status, created_at DESC);

ALTER TABLE knowledge.corpora
  ADD CONSTRAINT knowledge_corpora_published_snapshot_fk
  FOREIGN KEY (published_snapshot_id)
  REFERENCES knowledge.snapshots(id)
  ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS knowledge.chunks (
  id uuid PRIMARY KEY,
  corpus_id uuid NOT NULL REFERENCES knowledge.corpora(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES knowledge.snapshots(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL REFERENCES knowledge.sources(id) ON DELETE RESTRICT,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  content text NOT NULL,
  search_text text NOT NULL,
  language text,
  page_number integer CHECK (page_number IS NULL OR page_number > 0),
  section_path text,
  row_range text,
  image_region text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  checksum text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, source_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS knowledge_chunks_snapshot_idx
  ON knowledge.chunks (snapshot_id, source_id, chunk_index);

CREATE INDEX IF NOT EXISTS knowledge_chunks_search_idx
  ON knowledge.chunks
  USING gin (to_tsvector('simple', search_text));

CREATE TABLE IF NOT EXISTS knowledge.corpus_access_groups (
  corpus_id uuid NOT NULL REFERENCES knowledge.corpora(id) ON DELETE RESTRICT,
  keycloak_group text NOT NULL,
  created_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (corpus_id, keycloak_group)
);

CREATE TABLE IF NOT EXISTS knowledge.agent_corpus_bindings (
  id uuid PRIMARY KEY,
  agent_resource_id uuid NOT NULL,
  corpus_id uuid NOT NULL REFERENCES knowledge.corpora(id) ON DELETE RESTRICT,
  created_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_resource_id, corpus_id)
);

CREATE INDEX IF NOT EXISTS knowledge_agent_corpus_bindings_agent_idx
  ON knowledge.agent_corpus_bindings (agent_resource_id);
