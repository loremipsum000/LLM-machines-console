CREATE TABLE IF NOT EXISTS admin.connected_app_api_keys (
  id text PRIMARY KEY,
  app_id text NOT NULL REFERENCES admin.connected_apps(id) ON DELETE CASCADE,
  environment text NOT NULL CHECK (environment IN ('staging', 'production')),
  key_prefix text NOT NULL,
  key_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_connected_app_api_keys_hash_idx
  ON admin.connected_app_api_keys (key_hash);

CREATE INDEX IF NOT EXISTS admin_connected_app_api_keys_lookup_idx
  ON admin.connected_app_api_keys (key_prefix, status);

CREATE INDEX IF NOT EXISTS admin_connected_app_api_keys_app_env_idx
  ON admin.connected_app_api_keys (app_id, environment, status);
