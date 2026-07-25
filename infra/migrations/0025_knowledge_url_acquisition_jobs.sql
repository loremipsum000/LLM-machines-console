CREATE TABLE IF NOT EXISTS knowledge.url_acquisition_jobs (
  id uuid PRIMARY KEY,
  corpus_id uuid NOT NULL REFERENCES knowledge.corpora(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL REFERENCES knowledge.sources(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed', 'blocked', 'cancelled')
  ),
  adapter text NOT NULL CHECK (adapter IN ('safe_fetch', 'firecrawl')),
  requested_url text NOT NULL,
  normalized_url text NOT NULL,
  final_url text,
  canonical_url text,
  http_status integer CHECK (http_status IS NULL OR http_status > 0),
  content_type text,
  size_bytes integer CHECK (size_bytes IS NULL OR size_bytes >= 0),
  checksum text,
  redirect_chain jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error_code text,
  error_detail text,
  locked_by text,
  locked_at timestamptz,
  created_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS knowledge_url_acquisition_jobs_status_idx
  ON knowledge.url_acquisition_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS knowledge_url_acquisition_jobs_source_idx
  ON knowledge.url_acquisition_jobs (source_id);

CREATE INDEX IF NOT EXISTS knowledge_url_acquisition_jobs_corpus_status_idx
  ON knowledge.url_acquisition_jobs (corpus_id, status);

DO $$
DECLARE
  artifact_constraint record;
BEGIN
  FOR artifact_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'knowledge.source_artifacts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%artifact_type%'
  LOOP
    EXECUTE format('ALTER TABLE knowledge.source_artifacts DROP CONSTRAINT %I', artifact_constraint.conname);
  END LOOP;

  ALTER TABLE knowledge.source_artifacts
    ADD CONSTRAINT knowledge_source_artifacts_artifact_type_check
    CHECK (
      artifact_type IN (
        'original',
        'url_snapshot',
        'normalized',
        'normalizedMarkdown',
        'normalizedPageMap',
        'normalizedParserReport',
        'normalized_text',
        'ocr_text',
        'table_json',
        'preview',
        'url_fetch_report',
        'parser_report'
      )
    );
END $$;
