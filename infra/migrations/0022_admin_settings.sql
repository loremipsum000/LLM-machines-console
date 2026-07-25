CREATE TABLE IF NOT EXISTS admin.console_settings (
  id text PRIMARY KEY CHECK (id = 'singleton'),
  organization_name text NOT NULL DEFAULT 'LLM Machines',
  default_language text NOT NULL DEFAULT 'en' CHECK (default_language IN ('en', 'hr')),
  full_logo jsonb,
  icon_logo jsonb,
  telemetry_enabled boolean NOT NULL DEFAULT false,
  telemetry_payload_preview jsonb NOT NULL DEFAULT '{}'::jsonb,
  privacy_policy_href text NOT NULL DEFAULT '/privacy',
  data_residency_statement text NOT NULL DEFAULT 'Customer data stays on the deployed appliance by default.',
  break_glass_admin_id text,
  break_glass_updated_by text,
  break_glass_updated_at timestamptz,
  updated_by text REFERENCES common.users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO admin.console_settings (
  id,
  organization_name,
  default_language,
  telemetry_enabled,
  telemetry_payload_preview,
  privacy_policy_href,
  data_residency_statement,
  updated_at
)
VALUES (
  'singleton',
  'LLM Machines',
  'en',
  false,
  '{
    "applianceId": null,
    "installedVersion": null,
    "updateAgentVersion": null,
    "lastUpdateCheck": null,
    "lastAppliedUpdate": null,
    "subscriptionStateSeenByAppliance": "not_configured"
  }'::jsonb,
  '/privacy',
  'Customer data stays on the deployed appliance by default.',
  now()
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin.url_policy_rules (
  id uuid PRIMARY KEY,
  rule_type text NOT NULL CHECK (rule_type IN ('trusted', 'forbidden')),
  pattern text NOT NULL,
  normalized_pattern text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('knowledge_ingestion', 'web_fetch', 'mcp_egress', 'all')),
  reason text NOT NULL CHECK (char_length(reason) >= 3),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  updated_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_type, normalized_pattern, scope)
);

CREATE INDEX IF NOT EXISTS admin_url_policy_rules_status_scope_idx
  ON admin.url_policy_rules (status, scope, updated_at DESC);

CREATE TABLE IF NOT EXISTS admin.license_state (
  id text PRIMARY KEY CHECK (id = 'singleton'),
  source_status text NOT NULL DEFAULT 'not_configured' CHECK (source_status IN ('ok', 'degraded', 'unavailable', 'not_configured')),
  subscription_state text NOT NULL DEFAULT 'not_configured' CHECK (subscription_state IN ('active', 'soft_grace', 'restricted', 'terminated', 'unknown', 'not_configured')),
  support_state text NOT NULL DEFAULT 'License daemon not connected.',
  appliance_id text,
  certificate_expires_at timestamptz,
  last_entitlement_check_at timestamptz,
  offline_mode boolean NOT NULL DEFAULT true,
  telemetry_opt_in boolean NOT NULL DEFAULT false,
  allowed_update_channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO admin.license_state (
  id,
  source_status,
  subscription_state,
  support_state,
  offline_mode,
  telemetry_opt_in,
  allowed_update_channels,
  updated_at
)
VALUES (
  'singleton',
  'not_configured',
  'not_configured',
  'License daemon not connected.',
  true,
  false,
  '[]'::jsonb,
  now()
)
ON CONFLICT (id) DO NOTHING;
