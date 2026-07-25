CREATE TABLE IF NOT EXISTS admin.connected_apps (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  description text NOT NULL,
  owner_group text NOT NULL,
  allowed_models jsonb NOT NULL DEFAULT '[]'::jsonb,
  rate_limit_rpm integer CHECK (rate_limit_rpm IS NULL OR rate_limit_rpm > 0),
  token_budget_7d integer CHECK (token_budget_7d IS NULL OR token_budget_7d > 0),
  status text NOT NULL CHECK (status IN ('enabled', 'disabled')),
  environments jsonb NOT NULL DEFAULT '[]'::jsonb,
  usage_summary jsonb NOT NULL DEFAULT '{"lastUsedAt":null,"requests7d":0,"tokens7d":0,"failures7d":0}'::jsonb,
  created_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  updated_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(allowed_models) = 'array'),
  CHECK (jsonb_typeof(environments) = 'array'),
  CHECK (jsonb_typeof(usage_summary) = 'object')
);

CREATE INDEX IF NOT EXISTS admin_connected_apps_status_updated_idx
  ON admin.connected_apps (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS admin_connected_apps_owner_group_idx
  ON admin.connected_apps (owner_group);
