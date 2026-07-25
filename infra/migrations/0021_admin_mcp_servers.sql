CREATE TABLE IF NOT EXISTS admin.mcp_servers (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  description text NOT NULL,
  chat_command text NOT NULL UNIQUE,
  transport text NOT NULL CHECK (transport IN ('url', 'stdio')),
  endpoint_url text,
  stdio_command text,
  auth_mode text NOT NULL CHECK (auth_mode IN ('bearer', 'none')),
  bearer_token_secret_ref text,
  access_groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  access_level text NOT NULL CHECK (access_level IN ('read_only', 'read_write')),
  status text NOT NULL CHECK (status IN ('draft', 'enabled', 'disabled')),
  created_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  updated_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (transport = 'url' AND endpoint_url IS NOT NULL AND stdio_command IS NULL)
    OR
    (transport = 'stdio' AND stdio_command IS NOT NULL AND endpoint_url IS NULL)
  ),
  CHECK (
    (auth_mode = 'bearer' AND bearer_token_secret_ref IS NOT NULL)
    OR
    (auth_mode = 'none' AND bearer_token_secret_ref IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS admin_mcp_servers_command_idx
  ON admin.mcp_servers (chat_command);

CREATE INDEX IF NOT EXISTS admin_mcp_servers_status_updated_idx
  ON admin.mcp_servers (status, updated_at DESC);
