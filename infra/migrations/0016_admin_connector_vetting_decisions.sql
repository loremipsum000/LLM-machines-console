CREATE TABLE IF NOT EXISTS admin.connector_vetting_decisions (
  id uuid PRIMARY KEY,
  connector_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved_read_only', 'approved_read_write', 'blocked', 'disabled')),
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text NOT NULL,
  decided_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  source_ref text NOT NULL,
  checksum text NOT NULL,
  required_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_endpoints jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connector_vetting_decisions_connector_created_idx
  ON admin.connector_vetting_decisions (connector_id, created_at DESC);
