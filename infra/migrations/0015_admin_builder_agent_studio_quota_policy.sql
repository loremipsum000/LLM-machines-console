CREATE TABLE IF NOT EXISTS admin.builder_agent_studio_quota_policies (
  id text PRIMARY KEY,
  run_limit integer CHECK (run_limit IS NULL OR run_limit >= 0),
  token_limit integer CHECK (token_limit IS NULL OR token_limit >= 0),
  updated_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  note text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
