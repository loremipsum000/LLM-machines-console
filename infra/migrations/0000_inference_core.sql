BEGIN;

CREATE SCHEMA common;
CREATE SCHEMA admin;

CREATE TABLE common.human_identities (
  subject_id text PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT human_identities_subject_id_check
    CHECK (char_length(subject_id) BETWEEN 1 AND 255)
);

CREATE TABLE common.human_identity_roles (
  subject_id text NOT NULL REFERENCES common.human_identities(subject_id) ON DELETE CASCADE,
  role text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT human_identity_roles_pkey PRIMARY KEY (subject_id, role),
  CONSTRAINT human_identity_roles_role_check CHECK (role IN ('admin', 'operator'))
);

CREATE TABLE common.audit_events (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  outcome text NOT NULL,
  source_system text NOT NULL,
  correlation_id text NOT NULL,
  keycloak_subject_id text,
  application_id text,
  credential_record_id text,
  credential_prefix text,
  recovery_reason_code text,
  CONSTRAINT audit_events_action_check
    CHECK (char_length(action) BETWEEN 1 AND 128),
  CONSTRAINT audit_events_outcome_check
    CHECK (outcome IN ('succeeded', 'failed', 'denied')),
  CONSTRAINT audit_events_source_system_check
    CHECK (
      source_system IN (
        'console',
        'keycloak',
        'litellm',
        'grafana',
        'alertmanager',
        'firecrawl',
        'lifecycle'
      )
    ),
  CONSTRAINT audit_events_correlation_id_check
    CHECK (char_length(correlation_id) BETWEEN 1 AND 128),
  CONSTRAINT audit_events_subject_id_check
    CHECK (
      keycloak_subject_id IS NULL
      OR char_length(keycloak_subject_id) BETWEEN 1 AND 255
    ),
  CONSTRAINT audit_events_application_id_check
    CHECK (
      application_id IS NULL
      OR char_length(application_id) BETWEEN 1 AND 128
    ),
  CONSTRAINT audit_events_credential_record_id_check
    CHECK (
      credential_record_id IS NULL
      OR char_length(credential_record_id) BETWEEN 1 AND 128
    ),
  CONSTRAINT audit_events_credential_prefix_check
    CHECK (
      credential_prefix IS NULL
      OR char_length(credential_prefix) BETWEEN 1 AND 32
    ),
  CONSTRAINT audit_events_credential_identifier_check
    CHECK (num_nonnulls(credential_record_id, credential_prefix) <= 1),
  CONSTRAINT audit_events_recovery_reason_code_check
    CHECK (
      recovery_reason_code IS NULL
      OR char_length(recovery_reason_code) BETWEEN 1 AND 64
    )
);

CREATE INDEX audit_events_occurred_at_idx
  ON common.audit_events (occurred_at);
CREATE INDEX audit_events_correlation_id_idx
  ON common.audit_events (correlation_id);
CREATE INDEX audit_events_application_occurred_idx
  ON common.audit_events (application_id, occurred_at);

CREATE TABLE admin.applications (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  auth_mode text NOT NULL,
  status text NOT NULL DEFAULT 'enabled',
  connection_status text NOT NULL DEFAULT 'not_connected',
  last_connected_at timestamptz,
  last_tested_at timestamptz,
  created_by text NOT NULL REFERENCES common.human_identities(subject_id) ON DELETE RESTRICT,
  updated_by text NOT NULL REFERENCES common.human_identities(subject_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT applications_id_check
    CHECK (char_length(id) BETWEEN 1 AND 128),
  CONSTRAINT applications_name_check
    CHECK (char_length(name) BETWEEN 1 AND 160),
  CONSTRAINT applications_auth_mode_check
    CHECK (auth_mode IN ('api_key', 'oauth_client_credentials')),
  CONSTRAINT applications_status_check
    CHECK (status IN ('enabled', 'disabled', 'deleted')),
  CONSTRAINT applications_connection_status_check
    CHECK (connection_status IN ('not_connected', 'connected', 'degraded'))
);

CREATE UNIQUE INDEX applications_id_auth_mode_idx
  ON admin.applications (id, auth_mode);
CREATE INDEX applications_status_updated_idx
  ON admin.applications (status, updated_at);

CREATE TABLE admin.application_credentials (
  id text PRIMARY KEY,
  app_id text NOT NULL,
  kind text NOT NULL,
  client_identifier text,
  external_credential_id text,
  key_prefix text,
  verifier_hash text,
  status text NOT NULL DEFAULT 'active',
  issued_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  rotated_at timestamptz,
  overlap_expires_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT application_credentials_app_auth_mode_fk
    FOREIGN KEY (app_id, kind)
    REFERENCES admin.applications(id, auth_mode)
    ON DELETE RESTRICT,
  CONSTRAINT application_credentials_id_check
    CHECK (char_length(id) BETWEEN 1 AND 128),
  CONSTRAINT application_credentials_kind_check
    CHECK (kind IN ('api_key', 'oauth_client_credentials')),
  CONSTRAINT application_credentials_status_check
    CHECK (status IN ('active', 'retiring', 'revoked')),
  CONSTRAINT application_credentials_material_check
    CHECK (
      (
        kind = 'api_key'
        AND client_identifier IS NULL
        AND external_credential_id IS NULL
        AND key_prefix IS NOT NULL
        AND char_length(key_prefix) BETWEEN 1 AND 32
        AND verifier_hash IS NOT NULL
        AND char_length(verifier_hash) = 64
      )
      OR
      (
        kind = 'oauth_client_credentials'
        AND client_identifier IS NOT NULL
        AND char_length(client_identifier) BETWEEN 1 AND 255
        AND external_credential_id IS NOT NULL
        AND char_length(external_credential_id) BETWEEN 1 AND 255
        AND key_prefix IS NULL
        AND verifier_hash IS NULL
      )
    ),
  CONSTRAINT application_credentials_kind_lifecycle_check
    CHECK (
      kind = 'api_key'
      OR (
        status <> 'retiring'
        AND rotated_at IS NULL
        AND overlap_expires_at IS NULL
      )
    ),
  CONSTRAINT application_credentials_lifecycle_check
    CHECK (
      (
        status = 'active'
        AND rotated_at IS NULL
        AND overlap_expires_at IS NULL
        AND revoked_at IS NULL
      )
      OR
      (
        status = 'retiring'
        AND rotated_at IS NOT NULL
        AND overlap_expires_at IS NOT NULL
        AND revoked_at IS NULL
      )
      OR
      (
        status = 'revoked'
        AND revoked_at IS NOT NULL
        AND (
          (
            rotated_at IS NULL
            AND overlap_expires_at IS NULL
          )
          OR
          (
            rotated_at IS NOT NULL
            AND overlap_expires_at IS NOT NULL
          )
        )
      )
    ),
  CONSTRAINT application_credentials_timestamps_check
    CHECK (
      (last_used_at IS NULL OR last_used_at >= issued_at)
      AND (rotated_at IS NULL OR rotated_at >= issued_at)
      AND (
        overlap_expires_at IS NULL
        OR overlap_expires_at > rotated_at
      )
      AND (
        revoked_at IS NULL
        OR (
          revoked_at >= issued_at
          AND (rotated_at IS NULL OR revoked_at >= rotated_at)
        )
      )
    )
);

CREATE UNIQUE INDEX application_credentials_id_app_idx
  ON admin.application_credentials (id, app_id);
CREATE UNIQUE INDEX application_credentials_verifier_hash_idx
  ON admin.application_credentials (verifier_hash)
  WHERE verifier_hash IS NOT NULL;
CREATE UNIQUE INDEX application_credentials_client_identifier_idx
  ON admin.application_credentials (client_identifier)
  WHERE client_identifier IS NOT NULL;
CREATE UNIQUE INDEX application_credentials_external_id_idx
  ON admin.application_credentials (external_credential_id)
  WHERE external_credential_id IS NOT NULL;
CREATE UNIQUE INDEX application_credentials_one_active_idx
  ON admin.application_credentials (app_id)
  WHERE status = 'active';
CREATE INDEX application_credentials_prefix_status_idx
  ON admin.application_credentials (key_prefix, status);
CREATE INDEX application_credentials_app_status_idx
  ON admin.application_credentials (app_id, status);

CREATE TABLE admin.application_model_allowlists (
  app_id text NOT NULL REFERENCES admin.applications(id) ON DELETE RESTRICT,
  model_alias text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_model_allowlists_pkey
    PRIMARY KEY (app_id, model_alias),
  CONSTRAINT application_model_allowlists_alias_check
    CHECK (char_length(model_alias) BETWEEN 1 AND 160)
);

CREATE TABLE admin.application_limits (
  app_id text PRIMARY KEY REFERENCES admin.applications(id) ON DELETE RESTRICT,
  requests_per_minute integer,
  tokens_per_7d bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_limits_requests_check
    CHECK (requests_per_minute IS NULL OR requests_per_minute > 0),
  CONSTRAINT application_limits_tokens_check
    CHECK (tokens_per_7d IS NULL OR tokens_per_7d > 0)
);

CREATE TABLE admin.application_rate_limit_windows (
  app_id text NOT NULL REFERENCES admin.applications(id) ON DELETE RESTRICT,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  CONSTRAINT application_rate_limit_windows_pkey
    PRIMARY KEY (app_id, window_started_at),
  CONSTRAINT application_rate_limit_windows_count_check
    CHECK (request_count >= 0),
  CONSTRAINT application_rate_limit_windows_expiry_check
    CHECK (expires_at > window_started_at)
);

CREATE INDEX application_rate_limit_windows_expiry_idx
  ON admin.application_rate_limit_windows (expires_at);

CREATE TABLE admin.application_usage_daily (
  app_id text NOT NULL REFERENCES admin.applications(id) ON DELETE RESTRICT,
  credential_id text NOT NULL,
  bucket_date date NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  total_tokens bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_usage_daily_credential_app_fk
    FOREIGN KEY (credential_id, app_id)
    REFERENCES admin.application_credentials(id, app_id)
    ON DELETE RESTRICT,
  CONSTRAINT application_usage_daily_pkey
    PRIMARY KEY (app_id, credential_id, bucket_date),
  CONSTRAINT application_usage_daily_counts_check
    CHECK (request_count >= 0 AND failure_count >= 0),
  CONSTRAINT application_usage_daily_tokens_check
    CHECK (
      input_tokens >= 0
      AND output_tokens >= 0
      AND total_tokens >= 0
    )
);

CREATE INDEX application_usage_daily_bucket_idx
  ON admin.application_usage_daily (bucket_date);
CREATE INDEX application_usage_daily_app_bucket_idx
  ON admin.application_usage_daily (app_id, bucket_date);

CREATE TABLE admin.idempotency_ledger (
  id uuid PRIMARY KEY,
  keycloak_subject_id text NOT NULL,
  operation_code text NOT NULL,
  idempotency_key_digest text NOT NULL,
  request_fingerprint text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  outcome text,
  resource_id text,
  correlation_id text NOT NULL,
  status_code integer,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_ledger_subject_id_check
    CHECK (char_length(keycloak_subject_id) BETWEEN 1 AND 255),
  CONSTRAINT idempotency_ledger_operation_check
    CHECK (char_length(operation_code) BETWEEN 1 AND 128),
  CONSTRAINT idempotency_ledger_key_check
    CHECK (char_length(idempotency_key_digest) = 64),
  CONSTRAINT idempotency_ledger_fingerprint_check
    CHECK (char_length(request_fingerprint) = 64),
  CONSTRAINT idempotency_ledger_correlation_id_check
    CHECK (char_length(correlation_id) BETWEEN 1 AND 128),
  CONSTRAINT idempotency_ledger_resource_id_check
    CHECK (
      resource_id IS NULL
      OR char_length(resource_id) BETWEEN 1 AND 128
    ),
  CONSTRAINT idempotency_ledger_state_check
    CHECK (state IN ('pending', 'completed', 'failed')),
  CONSTRAINT idempotency_ledger_outcome_check
    CHECK (
      outcome IS NULL
      OR outcome IN ('succeeded', 'failed', 'denied')
    ),
  CONSTRAINT idempotency_ledger_status_code_check
    CHECK (status_code IS NULL OR status_code BETWEEN 100 AND 599),
  CONSTRAINT idempotency_ledger_receipt_state_check
    CHECK (
      (
        state = 'pending'
        AND outcome IS NULL
        AND resource_id IS NULL
        AND status_code IS NULL
      )
      OR
      (
        state = 'completed'
        AND outcome = 'succeeded'
        AND status_code BETWEEN 200 AND 399
      )
      OR
      (
        state = 'failed'
        AND outcome IN ('failed', 'denied')
        AND status_code IS NOT NULL
      )
    ),
  CONSTRAINT idempotency_ledger_expiry_check
    CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX idempotency_ledger_identity_key_idx
  ON admin.idempotency_ledger (
    keycloak_subject_id,
    operation_code,
    idempotency_key_digest
  );
CREATE INDEX idempotency_ledger_expiry_idx
  ON admin.idempotency_ledger (expires_at);

CREATE TABLE admin.console_settings (
  id text PRIMARY KEY,
  organization_name text NOT NULL DEFAULT 'LLM Machines',
  default_language text NOT NULL DEFAULT 'en',
  full_logo jsonb,
  icon_logo jsonb,
  telemetry_enabled boolean NOT NULL DEFAULT false,
  telemetry_payload_preview jsonb NOT NULL DEFAULT '{}'::jsonb,
  privacy_policy_href text NOT NULL DEFAULT '/privacy',
  data_residency_statement text NOT NULL DEFAULT
    'LLM Machines managed components do not retain inference request or response content.',
  updated_by text REFERENCES common.human_identities(subject_id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT console_settings_id_check CHECK (id = 'singleton'),
  CONSTRAINT console_settings_language_check
    CHECK (default_language IN ('en', 'hr'))
);

CREATE TABLE admin.license_state (
  id text PRIMARY KEY,
  source_status text NOT NULL DEFAULT 'not_configured',
  subscription_state text NOT NULL DEFAULT 'not_configured',
  support_state text NOT NULL DEFAULT 'License service is not connected.',
  appliance_id text,
  certificate_expires_at timestamptz,
  last_entitlement_check_at timestamptz,
  offline_mode boolean NOT NULL DEFAULT true,
  telemetry_opt_in boolean NOT NULL DEFAULT false,
  allowed_update_channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT license_state_id_check CHECK (id = 'singleton'),
  CONSTRAINT license_state_source_status_check
    CHECK (
      source_status IN ('ok', 'degraded', 'unavailable', 'not_configured')
    ),
  CONSTRAINT license_state_subscription_check
    CHECK (
      subscription_state IN (
        'active',
        'soft_grace',
        'restricted',
        'terminated',
        'unknown',
        'not_configured'
      )
    )
);

CREATE TABLE admin.update_state (
  id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'not_configured',
  current_version text,
  available_version text,
  bundle_id text,
  bundle_digest text,
  rollback_snapshot_id text,
  last_checked_at timestamptz,
  last_applied_at timestamptz,
  updated_by text REFERENCES common.human_identities(subject_id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT update_state_id_check CHECK (id = 'singleton'),
  CONSTRAINT update_state_status_check
    CHECK (
      status IN (
        'not_configured',
        'idle',
        'available',
        'preflighting',
        'applying',
        'succeeded',
        'failed',
        'rolling_back',
        'rolled_back'
      )
    )
);

CREATE TABLE admin.backup_state (
  id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'not_configured',
  last_backup_id text,
  last_backup_digest text,
  last_backup_started_at timestamptz,
  last_backup_completed_at timestamptz,
  last_backup_verified_at timestamptz,
  encrypted boolean NOT NULL DEFAULT false,
  content_free boolean NOT NULL DEFAULT true,
  updated_by text REFERENCES common.human_identities(subject_id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backup_state_id_check CHECK (id = 'singleton'),
  CONSTRAINT backup_state_status_check
    CHECK (
      status IN ('not_configured', 'idle', 'running', 'succeeded', 'failed')
    )
);

CREATE TABLE admin.recovery_state (
  id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'not_configured',
  source_backup_id text,
  last_restore_id text,
  last_restore_started_at timestamptz,
  last_restore_completed_at timestamptz,
  last_recovery_check_at timestamptz,
  credential_rotation_required boolean NOT NULL DEFAULT false,
  updated_by text REFERENCES common.human_identities(subject_id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recovery_state_id_check CHECK (id = 'singleton'),
  CONSTRAINT recovery_state_status_check
    CHECK (
      status IN (
        'not_configured',
        'ready',
        'restoring',
        'succeeded',
        'failed',
        'rotation_required'
      )
    )
);

INSERT INTO admin.console_settings (id) VALUES ('singleton');
INSERT INTO admin.license_state (id) VALUES ('singleton');
INSERT INTO admin.update_state (id) VALUES ('singleton');
INSERT INTO admin.backup_state (id) VALUES ('singleton');
INSERT INTO admin.recovery_state (id) VALUES ('singleton');

COMMIT;
