CREATE TABLE IF NOT EXISTS builder.agent_configs (
  resource_id uuid PRIMARY KEY REFERENCES builder.resources(id) ON DELETE RESTRICT,
  config jsonb NOT NULL,
  updated_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);
