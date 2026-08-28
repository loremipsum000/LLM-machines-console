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
  ingested_at timestamptz NOT NULL DEFAULT now(),
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
  CONSTRAINT audit_events_native_metadata_check
    CHECK (
      source_system NOT IN ('keycloak', 'litellm', 'grafana', 'alertmanager')
      OR (
        id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND correlation_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (
          (
            source_system = 'keycloak'
            AND action IN (
              'keycloak.authentication.failed',
              'keycloak.authentication.succeeded',
              'keycloak.credential.updated',
              'keycloak.role.assigned',
              'keycloak.role.revoked',
              'keycloak.user.created',
              'keycloak.user.deleted',
              'keycloak.user.updated'
            )
            AND (
              recovery_reason_code IS NULL
              OR recovery_reason_code IN (
                'account_disabled',
                'authentication_failed',
                'authorization_denied',
                'invalid_credentials',
                'policy_rejected'
              )
            )
          ) OR (
            source_system = 'litellm'
            AND action IN (
              'litellm.request.denied',
              'litellm.request.failed',
              'litellm.request.succeeded',
              'litellm.route.created',
              'litellm.route.deleted',
              'litellm.route.updated',
              'litellm.virtual_key.created',
              'litellm.virtual_key.revoked',
              'litellm.virtual_key.rotated',
              'litellm.virtual_key.updated'
            )
            AND (
              recovery_reason_code IS NULL
              OR recovery_reason_code IN (
                'model_denied',
                'rate_limited',
                'request_failed',
                'route_unavailable'
              )
            )
          ) OR (
            source_system = 'grafana'
            AND action IN (
              'grafana.alert_rule.created',
              'grafana.alert_rule.deleted',
              'grafana.alert_rule.updated',
              'grafana.dashboard.created',
              'grafana.dashboard.deleted',
              'grafana.dashboard.updated',
              'grafana.datasource.updated',
              'grafana.folder.created',
              'grafana.folder.deleted',
              'grafana.folder.updated'
            )
            AND (
              recovery_reason_code IS NULL
              OR recovery_reason_code IN (
                'operation_failed',
                'permission_denied',
                'validation_failed'
              )
            )
          ) OR (
            source_system = 'alertmanager'
            AND action IN (
              'alertmanager.configuration.reloaded',
              'alertmanager.notification.failed',
              'alertmanager.notification.succeeded',
              'alertmanager.silence.created',
              'alertmanager.silence.deleted',
              'alertmanager.silence.expired'
            )
            AND (
              recovery_reason_code IS NULL
              OR recovery_reason_code IN (
                'delivery_failed',
                'receiver_unavailable',
                'silence_rejected'
              )
            )
          )
        )
        AND (
          keycloak_subject_id IS NULL
          OR (
            keycloak_subject_id ~ '^[A-Za-z0-9][A-Za-z0-9_:-]{0,254}$'
            AND keycloak_subject_id !~* '^(llmm_|bearer[:_-]|token[:_-]|secret[:_-]|password[:_-]|api[_-]?key[:_-])'
            AND keycloak_subject_id !~* '^[0-9a-f]{64,}$'
            AND keycloak_subject_id !~ '^(sk[-_](live|test|proj)[-_][A-Za-z0-9_-]{1,120}|github_pat_[A-Za-z0-9_]{1,120}|gh[pousr]_[A-Za-z0-9]{1,120}|xox[baprs]-[A-Za-z0-9-]{1,120}|eyJ[A-Za-z0-9_-]{5,120}[.][A-Za-z0-9_-]{4,120}[.][A-Za-z0-9_-]{4,120}|(AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,120})$'
          )
        )
        AND (
          application_id IS NULL
          OR (
            application_id ~ '^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$'
            AND application_id !~* '^(llmm_|bearer[:_-]|token[:_-]|secret[:_-]|password[:_-]|api[_-]?key[:_-])'
            AND application_id !~* '^[0-9a-f]{64,}$'
            AND application_id !~ '^(sk[-_](live|test|proj)[-_][A-Za-z0-9_-]{1,120}|github_pat_[A-Za-z0-9_]{1,120}|gh[pousr]_[A-Za-z0-9]{1,120}|xox[baprs]-[A-Za-z0-9-]{1,120}|eyJ[A-Za-z0-9_-]{5,120}[.][A-Za-z0-9_-]{4,120}[.][A-Za-z0-9_-]{4,120}|(AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,120})$'
          )
        )
        AND (
          credential_record_id IS NULL
          OR (
            credential_record_id ~ '^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$'
            AND credential_record_id !~* '^(llmm_|bearer[:_-]|token[:_-]|secret[:_-]|password[:_-]|api[_-]?key[:_-])'
            AND credential_record_id !~* '^[0-9a-f]{64,}$'
            AND credential_record_id !~ '^(sk[-_](live|test|proj)[-_][A-Za-z0-9_-]{1,120}|github_pat_[A-Za-z0-9_]{1,120}|gh[pousr]_[A-Za-z0-9]{1,120}|xox[baprs]-[A-Za-z0-9-]{1,120}|eyJ[A-Za-z0-9_-]{5,120}[.][A-Za-z0-9_-]{4,120}[.][A-Za-z0-9_-]{4,120}|(AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,120})$'
          )
        )
        AND (
          credential_prefix IS NULL
          OR credential_prefix ~ '^(llmm_t4_[0-9a-f]{18}|llmm_fc_[0-9a-f]{16})$'
        )
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
CREATE INDEX audit_events_stable_order_idx
  ON common.audit_events (occurred_at, id);
CREATE INDEX audit_events_correlation_id_idx
  ON common.audit_events (correlation_id);
CREATE INDEX audit_events_application_occurred_idx
  ON common.audit_events (application_id, occurred_at);
CREATE TABLE common.audit_source_cursors (
  source_system text PRIMARY KEY,
  cursor_version integer,
  cursor_watermark timestamptz,
  cursor_tie_breaker uuid,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_event_occurred_at timestamptz,
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_source_cursors_source_check
    CHECK (
      source_system IN ('keycloak', 'litellm', 'grafana', 'alertmanager')
    ),
  CONSTRAINT audit_source_cursors_cursor_check
    CHECK (
      num_nonnulls(cursor_version, cursor_watermark, cursor_tie_breaker)
        IN (0, 3)
      AND (cursor_version IS NULL OR cursor_version = 1)
      AND (
        cursor_tie_breaker IS NULL
        OR cursor_tie_breaker::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
    ),
  CONSTRAINT audit_source_cursors_error_code_check
    CHECK (
      last_error_code IS NULL
      OR (
        char_length(last_error_code) BETWEEN 1 AND 64
        AND last_error_code ~ '^[a-z][a-z0-9._:-]*$'
      )
    )
);

CREATE INDEX audit_source_cursors_health_idx
  ON common.audit_source_cursors (last_success_at, last_attempt_at);

CREATE TABLE common.console_login_transactions (
  handle_digest text PRIMARY KEY,
  state_digest text NOT NULL UNIQUE,
  subject_digest text,
  encrypted_payload jsonb NOT NULL,
  encryption_kid text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT console_login_transactions_handle_digest_check
    CHECK (handle_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT console_login_transactions_state_digest_check
    CHECK (state_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT console_login_transactions_subject_digest_check
    CHECK (
      subject_digest IS NULL
      OR subject_digest ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT console_login_transactions_encryption_kid_check
    CHECK (encryption_kid ~ '^[A-Za-z0-9._-]{1,64}$'),
  CONSTRAINT console_login_transactions_encrypted_payload_check
    CHECK (
      jsonb_typeof(encrypted_payload) = 'object'
      AND encrypted_payload ?& ARRAY[
        'version',
        'kid',
        'iv',
        'tag',
        'ciphertext'
      ]
      AND (
        encrypted_payload
          - 'version'
          - 'kid'
          - 'iv'
          - 'tag'
          - 'ciphertext'
      ) = '{}'::jsonb
      AND encrypted_payload -> 'version' = '1'::jsonb
      AND jsonb_typeof(encrypted_payload -> 'kid') = 'string'
      AND jsonb_typeof(encrypted_payload -> 'iv') = 'string'
      AND jsonb_typeof(encrypted_payload -> 'tag') = 'string'
      AND jsonb_typeof(encrypted_payload -> 'ciphertext') = 'string'
      AND encrypted_payload ->> 'kid' = encryption_kid
      AND encrypted_payload ->> 'iv' ~ '^[A-Za-z0-9_-]{16}$'
      AND encrypted_payload ->> 'tag' ~ '^[A-Za-z0-9_-]{22}$'
      AND encrypted_payload ->> 'ciphertext' ~ '^[A-Za-z0-9_-]+$'
      AND octet_length(encrypted_payload::text) BETWEEN 80 AND 131072
    ),
  CONSTRAINT console_login_transactions_lifetime_check
    CHECK (expires_at = created_at + interval '2 minutes')
);

CREATE INDEX console_login_transactions_expiry_idx
  ON common.console_login_transactions (expires_at);

CREATE TABLE common.console_sessions (
  handle_digest text PRIMARY KEY,
  subject_digest text NOT NULL,
  keycloak_session_digest text,
  encrypted_payload jsonb NOT NULL,
  encryption_kid text NOT NULL,
  refresh_generation bigint NOT NULL DEFAULT 0,
  refresh_blocked_until timestamptz,
  refresh_failure_reason text,
  access_expires_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT console_sessions_handle_digest_check
    CHECK (handle_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT console_sessions_subject_digest_check
    CHECK (subject_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT console_sessions_keycloak_session_digest_check
    CHECK (
      keycloak_session_digest IS NULL
      OR keycloak_session_digest ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT console_sessions_encryption_kid_check
    CHECK (encryption_kid ~ '^[A-Za-z0-9._-]{1,64}$'),
  CONSTRAINT console_sessions_encrypted_payload_check
    CHECK (
      jsonb_typeof(encrypted_payload) = 'object'
      AND encrypted_payload ?& ARRAY[
        'version',
        'kid',
        'iv',
        'tag',
        'ciphertext'
      ]
      AND (
        encrypted_payload
          - 'version'
          - 'kid'
          - 'iv'
          - 'tag'
          - 'ciphertext'
      ) = '{}'::jsonb
      AND encrypted_payload -> 'version' = '1'::jsonb
      AND jsonb_typeof(encrypted_payload -> 'kid') = 'string'
      AND jsonb_typeof(encrypted_payload -> 'iv') = 'string'
      AND jsonb_typeof(encrypted_payload -> 'tag') = 'string'
      AND jsonb_typeof(encrypted_payload -> 'ciphertext') = 'string'
      AND encrypted_payload ->> 'kid' = encryption_kid
      AND encrypted_payload ->> 'iv' ~ '^[A-Za-z0-9_-]{16}$'
      AND encrypted_payload ->> 'tag' ~ '^[A-Za-z0-9_-]{22}$'
      AND encrypted_payload ->> 'ciphertext' ~ '^[A-Za-z0-9_-]+$'
      AND octet_length(encrypted_payload::text) BETWEEN 80 AND 131072
    ),
  CONSTRAINT console_sessions_refresh_generation_check
    CHECK (refresh_generation BETWEEN 0 AND 9007199254740991),
  CONSTRAINT console_sessions_refresh_block_check
    CHECK (
      (refresh_blocked_until IS NULL AND refresh_failure_reason IS NULL)
      OR (
        refresh_blocked_until IS NOT NULL
        AND refresh_failure_reason IN (
          'identity_restart',
          'identity_timeout',
          'identity_unavailable'
        )
      )
    ),
  CONSTRAINT console_sessions_lifetime_check
    CHECK (
      absolute_expires_at = created_at + interval '24 hours'
      AND created_at <= last_seen_at
      AND last_seen_at <= updated_at
      AND updated_at < absolute_expires_at
      AND idle_expires_at = LEAST(
        last_seen_at + interval '8 hours',
        absolute_expires_at
      )
      AND access_expires_at >= updated_at - interval '1 minute'
      AND access_expires_at <= updated_at + interval '6 minutes'
    )
);

CREATE INDEX console_sessions_idle_expiry_idx
  ON common.console_sessions (idle_expires_at);
CREATE INDEX console_sessions_subject_digest_idx
  ON common.console_sessions (subject_digest);
CREATE INDEX console_sessions_keycloak_session_digest_idx
  ON common.console_sessions (keycloak_session_digest)
  WHERE keycloak_session_digest IS NOT NULL;
CREATE INDEX console_sessions_encryption_kid_idx
  ON common.console_sessions (encryption_kid);

CREATE TABLE common.console_logout_token_replays (
  jti_digest text PRIMARY KEY,
  consumed_at timestamptz NOT NULL,
  retain_until timestamptz NOT NULL,
  CONSTRAINT console_logout_token_replays_jti_digest_check
    CHECK (jti_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT console_logout_token_replays_lifetime_check
    CHECK (
      retain_until > consumed_at
      AND retain_until <= consumed_at + interval '7 minutes'
    )
);

CREATE INDEX console_logout_token_replays_retention_idx
  ON common.console_logout_token_replays (retain_until);

REVOKE ALL ON common.console_login_transactions FROM PUBLIC;
REVOKE ALL ON common.console_sessions FROM PUBLIC;
REVOKE ALL ON common.console_logout_token_replays FROM PUBLIC;

CREATE TABLE admin.applications (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  auth_mode text NOT NULL,
  status text NOT NULL DEFAULT 'enabled',
  connection_status text NOT NULL DEFAULT 'not_connected',
  last_connected_at timestamptz,
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
        AND overlap_expires_at IS NULL
      )
    ),
  CONSTRAINT application_credentials_lifecycle_check
    CHECK (
      (
        kind = 'api_key'
        AND (
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
        )
      )
      OR
      (
        kind = 'oauth_client_credentials'
        AND overlap_expires_at IS NULL
        AND (
          (
            status = 'active'
            AND revoked_at IS NULL
          )
          OR
          (
            status = 'revoked'
            AND revoked_at IS NOT NULL
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
        OR (
          rotated_at IS NOT NULL
          AND overlap_expires_at = rotated_at + interval '86400 seconds'
        )
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
CREATE UNIQUE INDEX application_credentials_one_retiring_idx
  ON admin.application_credentials (app_id)
  WHERE kind = 'api_key' AND status = 'retiring';
CREATE INDEX application_credentials_prefix_status_idx
  ON admin.application_credentials (key_prefix, status);
CREATE INDEX application_credentials_app_status_idx
  ON admin.application_credentials (app_id, status);

CREATE TABLE admin.application_firecrawl_access (
  app_id text PRIMARY KEY REFERENCES admin.applications(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'disabled',
  disclaimer_version text,
  disclaimer_accepted_by text REFERENCES common.human_identities(subject_id) ON DELETE RESTRICT,
  disclaimer_accepted_at timestamptz,
  connection_status text NOT NULL DEFAULT 'not_connected',
  last_connected_at timestamptz,
  search_rate_limit_rps integer,
  scrape_rate_limit_rps integer,
  max_concurrent_scrapes integer,
  updated_by text NOT NULL REFERENCES common.human_identities(subject_id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_firecrawl_access_status_check
    CHECK (status IN ('disabled', 'enabled')),
  CONSTRAINT application_firecrawl_access_disclaimer_version_check
    CHECK (
      disclaimer_version IS NULL
      OR char_length(disclaimer_version) BETWEEN 1 AND 64
    ),
  CONSTRAINT application_firecrawl_access_disclaimer_pair_check
    CHECK (
      num_nonnulls(
        disclaimer_version,
        disclaimer_accepted_by,
        disclaimer_accepted_at
      ) IN (0, 3)
    ),
  CONSTRAINT application_firecrawl_access_enabled_disclaimer_check
    CHECK (
      status = 'disabled'
      OR disclaimer_accepted_at IS NOT NULL
    ),
  CONSTRAINT application_firecrawl_access_connection_check
    CHECK (
      (
        connection_status = 'not_connected'
        AND last_connected_at IS NULL
      )
      OR (
        connection_status IN ('connected', 'degraded')
        AND last_connected_at IS NOT NULL
      )
    ),
  CONSTRAINT application_firecrawl_access_search_rate_check
    CHECK (
      search_rate_limit_rps IS NULL
      OR search_rate_limit_rps BETWEEN 1 AND 1000
    ),
  CONSTRAINT application_firecrawl_access_scrape_rate_check
    CHECK (
      scrape_rate_limit_rps IS NULL
      OR scrape_rate_limit_rps BETWEEN 1 AND 1000
    ),
  CONSTRAINT application_firecrawl_access_concurrency_check
    CHECK (
      max_concurrent_scrapes IS NULL
      OR max_concurrent_scrapes BETWEEN 1 AND 100
    )
);

CREATE INDEX application_firecrawl_access_status_updated_idx
  ON admin.application_firecrawl_access (status, updated_at);

CREATE TABLE admin.application_firecrawl_credentials (
  id text PRIMARY KEY,
  app_id text NOT NULL REFERENCES admin.application_firecrawl_access(app_id) ON DELETE RESTRICT,
  key_prefix text NOT NULL,
  verifier_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  issued_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  rotated_at timestamptz,
  overlap_expires_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT application_firecrawl_credentials_id_check
    CHECK (char_length(id) BETWEEN 1 AND 128),
  CONSTRAINT application_firecrawl_credentials_prefix_check
    CHECK (key_prefix ~ '^llmm_fc_[0-9a-f]{16}$'),
  CONSTRAINT application_firecrawl_credentials_hash_check
    CHECK (verifier_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT application_firecrawl_credentials_status_check
    CHECK (status IN ('active', 'retiring', 'revoked')),
  CONSTRAINT application_firecrawl_credentials_lifecycle_check
    CHECK (
      (
        status = 'active'
        AND rotated_at IS NULL
        AND overlap_expires_at IS NULL
        AND revoked_at IS NULL
      )
      OR (
        status = 'retiring'
        AND rotated_at IS NOT NULL
        AND overlap_expires_at IS NOT NULL
        AND revoked_at IS NULL
      )
      OR (
        status = 'revoked'
        AND revoked_at IS NOT NULL
        AND (
          (
            rotated_at IS NULL
            AND overlap_expires_at IS NULL
          )
          OR (
            rotated_at IS NOT NULL
            AND overlap_expires_at IS NOT NULL
          )
        )
      )
    ),
  CONSTRAINT application_firecrawl_credentials_timestamps_check
    CHECK (
      (last_used_at IS NULL OR last_used_at >= issued_at)
      AND (rotated_at IS NULL OR rotated_at >= issued_at)
      AND (
        overlap_expires_at IS NULL
        OR (
          rotated_at IS NOT NULL
          AND overlap_expires_at = rotated_at + interval '86400 seconds'
        )
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

CREATE UNIQUE INDEX application_firecrawl_credentials_id_app_idx
  ON admin.application_firecrawl_credentials (id, app_id);
CREATE UNIQUE INDEX application_firecrawl_credentials_verifier_hash_idx
  ON admin.application_firecrawl_credentials (verifier_hash);
CREATE UNIQUE INDEX application_firecrawl_credentials_one_active_idx
  ON admin.application_firecrawl_credentials (app_id)
  WHERE status = 'active';
CREATE UNIQUE INDEX application_firecrawl_credentials_one_retiring_idx
  ON admin.application_firecrawl_credentials (app_id)
  WHERE status = 'retiring';
CREATE INDEX application_firecrawl_credentials_prefix_status_idx
  ON admin.application_firecrawl_credentials (key_prefix, status);
CREATE INDEX application_firecrawl_credentials_app_status_idx
  ON admin.application_firecrawl_credentials (app_id, status);

CREATE TABLE admin.application_firecrawl_rate_limit_windows (
  app_id text NOT NULL REFERENCES admin.application_firecrawl_access(app_id) ON DELETE RESTRICT,
  route_kind text NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  CONSTRAINT application_firecrawl_rate_limit_windows_pkey
    PRIMARY KEY (app_id, route_kind, window_started_at),
  CONSTRAINT application_firecrawl_rate_limit_windows_route_check
    CHECK (route_kind IN ('search', 'scrape')),
  CONSTRAINT application_firecrawl_rate_limit_windows_count_check
    CHECK (request_count >= 0),
  CONSTRAINT application_firecrawl_rate_limit_windows_expiry_check
    CHECK (expires_at > window_started_at)
);

CREATE INDEX application_firecrawl_rate_limit_windows_expiry_idx
  ON admin.application_firecrawl_rate_limit_windows (expires_at);

CREATE TABLE admin.application_firecrawl_request_ledger (
  id uuid PRIMARY KEY,
  app_id text NOT NULL,
  credential_id text NOT NULL,
  route_kind text NOT NULL,
  state text NOT NULL DEFAULT 'active',
  status_code integer,
  latency_ms integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz NOT NULL,
  settled_at timestamptz,
  CONSTRAINT application_firecrawl_request_ledger_credential_app_fk
    FOREIGN KEY (credential_id, app_id)
    REFERENCES admin.application_firecrawl_credentials(id, app_id)
    ON DELETE RESTRICT,
  CONSTRAINT application_firecrawl_request_ledger_route_check
    CHECK (route_kind IN ('search', 'scrape')),
  CONSTRAINT application_firecrawl_request_ledger_state_check
    CHECK (state IN ('active', 'settled')),
  CONSTRAINT application_firecrawl_request_ledger_status_code_check
    CHECK (status_code IS NULL OR status_code BETWEEN 100 AND 599),
  CONSTRAINT application_firecrawl_request_ledger_latency_check
    CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CONSTRAINT application_firecrawl_request_ledger_lifecycle_check
    CHECK (
      (
        state = 'active'
        AND status_code IS NULL
        AND latency_ms IS NULL
        AND settled_at IS NULL
      )
      OR (
        state = 'settled'
        AND status_code IS NOT NULL
        AND latency_ms IS NOT NULL
        AND settled_at IS NOT NULL
      )
    ),
  CONSTRAINT application_firecrawl_request_ledger_timestamps_check
    CHECK (
      lease_expires_at > started_at
      AND (settled_at IS NULL OR settled_at >= started_at)
    )
);

CREATE INDEX application_firecrawl_request_ledger_active_idx
  ON admin.application_firecrawl_request_ledger (app_id, route_kind, lease_expires_at)
  WHERE state = 'active';
CREATE INDEX application_firecrawl_request_ledger_settled_started_idx
  ON admin.application_firecrawl_request_ledger (started_at)
  WHERE state = 'settled';

CREATE TABLE admin.application_firecrawl_usage_daily (
  app_id text NOT NULL,
  credential_id text NOT NULL,
  bucket_date date NOT NULL,
  route_kind text NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  latency_ms_sum bigint NOT NULL DEFAULT 0,
  latency_ms_max integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_firecrawl_usage_daily_credential_app_fk
    FOREIGN KEY (credential_id, app_id)
    REFERENCES admin.application_firecrawl_credentials(id, app_id)
    ON DELETE RESTRICT,
  CONSTRAINT application_firecrawl_usage_daily_pkey
    PRIMARY KEY (app_id, credential_id, bucket_date, route_kind),
  CONSTRAINT application_firecrawl_usage_daily_route_check
    CHECK (route_kind IN ('search', 'scrape')),
  CONSTRAINT application_firecrawl_usage_daily_counts_check
    CHECK (
      request_count >= 0
      AND failure_count >= 0
      AND failure_count <= request_count
    ),
  CONSTRAINT application_firecrawl_usage_daily_latency_check
    CHECK (
      latency_ms_sum >= 0
      AND latency_ms_max >= 0
      AND latency_ms_max <= latency_ms_sum
    )
);

CREATE INDEX application_firecrawl_usage_daily_bucket_idx
  ON admin.application_firecrawl_usage_daily (bucket_date);
CREATE INDEX application_firecrawl_usage_daily_app_bucket_idx
  ON admin.application_firecrawl_usage_daily (app_id, bucket_date);

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
  requests_per_second integer,
  token_alert_threshold_7d bigint,
  max_concurrent_requests integer,
  max_context_bytes bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_limits_requests_check
    CHECK (
      requests_per_second IS NULL
      OR requests_per_second BETWEEN 1 AND 10000
    ),
  CONSTRAINT application_limits_token_alert_check
    CHECK (
      token_alert_threshold_7d IS NULL
      OR token_alert_threshold_7d BETWEEN 1 AND 100000000
    ),
  CONSTRAINT application_limits_concurrency_check
    CHECK (
      max_concurrent_requests IS NULL
      OR max_concurrent_requests BETWEEN 1 AND 10000
    ),
  CONSTRAINT application_limits_context_bytes_check
    CHECK (
      max_context_bytes IS NULL
      OR max_context_bytes BETWEEN 1 AND 9007199254740991
    )
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

CREATE TABLE admin.application_request_ledger (
  id uuid PRIMARY KEY,
  app_id text NOT NULL,
  credential_id text NOT NULL,
  route_kind text NOT NULL,
  model_alias text,
  context_bytes bigint NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'active',
  status_code integer,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  total_tokens bigint NOT NULL DEFAULT 0,
  latency_ms integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz NOT NULL,
  settled_at timestamptz,
  CONSTRAINT application_request_ledger_credential_app_fk
    FOREIGN KEY (credential_id, app_id)
    REFERENCES admin.application_credentials(id, app_id)
    ON DELETE RESTRICT,
  CONSTRAINT application_request_ledger_route_check
    CHECK (route_kind IN ('models', 'chat_completions')),
  CONSTRAINT application_request_ledger_model_check
    CHECK (
      (route_kind = 'models' AND model_alias IS NULL)
      OR (
        route_kind = 'chat_completions'
        AND (
          char_length(model_alias) BETWEEN 1 AND 160
          OR (
            state = 'settled'
            AND model_alias IS NULL
            AND status_code >= 400
          )
        )
      )
    ),
  CONSTRAINT application_request_ledger_context_bytes_check
    CHECK (context_bytes >= 0),
  CONSTRAINT application_request_ledger_state_check
    CHECK (state IN ('active', 'settled')),
  CONSTRAINT application_request_ledger_status_code_check
    CHECK (status_code IS NULL OR status_code BETWEEN 100 AND 599),
  CONSTRAINT application_request_ledger_tokens_check
    CHECK (
      input_tokens >= 0
      AND output_tokens >= 0
      AND total_tokens >= input_tokens + output_tokens
    ),
  CONSTRAINT application_request_ledger_latency_check
    CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CONSTRAINT application_request_ledger_lifecycle_check
    CHECK (
      (
        state = 'active'
        AND status_code IS NULL
        AND input_tokens = 0
        AND output_tokens = 0
        AND total_tokens = 0
        AND latency_ms IS NULL
        AND settled_at IS NULL
      )
      OR (
        state = 'settled'
        AND status_code IS NOT NULL
        AND latency_ms IS NOT NULL
        AND settled_at IS NOT NULL
      )
    ),
  CONSTRAINT application_request_ledger_timestamps_check
    CHECK (
      lease_expires_at > started_at
      AND (settled_at IS NULL OR settled_at >= started_at)
    )
);

CREATE INDEX application_request_ledger_active_idx
  ON admin.application_request_ledger (app_id, lease_expires_at)
  WHERE state = 'active';
CREATE INDEX application_request_ledger_settled_started_idx
  ON admin.application_request_ledger (started_at)
  WHERE state = 'settled';

CREATE TABLE admin.application_usage_daily (
  app_id text NOT NULL REFERENCES admin.applications(id) ON DELETE RESTRICT,
  credential_id text NOT NULL,
  bucket_date date NOT NULL,
  route_kind text NOT NULL,
  model_alias text NOT NULL DEFAULT '',
  request_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  total_tokens bigint NOT NULL DEFAULT 0,
  latency_ms_sum bigint NOT NULL DEFAULT 0,
  latency_ms_max integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_usage_daily_credential_app_fk
    FOREIGN KEY (credential_id, app_id)
    REFERENCES admin.application_credentials(id, app_id)
    ON DELETE RESTRICT,
  CONSTRAINT application_usage_daily_pkey
    PRIMARY KEY (
      app_id,
      credential_id,
      bucket_date,
      route_kind,
      model_alias
    ),
  CONSTRAINT application_usage_daily_route_check
    CHECK (route_kind IN ('models', 'chat_completions')),
  CONSTRAINT application_usage_daily_model_check
    CHECK (
      (route_kind = 'models' AND model_alias = '')
      OR (
        route_kind = 'chat_completions'
        AND (
          char_length(model_alias) BETWEEN 1 AND 160
          OR (
            model_alias = ''
            AND failure_count = request_count
          )
        )
      )
    ),
  CONSTRAINT application_usage_daily_counts_check
    CHECK (
      request_count >= 0
      AND failure_count >= 0
      AND failure_count <= request_count
    ),
  CONSTRAINT application_usage_daily_tokens_check
    CHECK (
      input_tokens >= 0
      AND output_tokens >= 0
      AND total_tokens >= input_tokens + output_tokens
    ),
  CONSTRAINT application_usage_daily_latency_check
    CHECK (
      latency_ms_sum >= 0
      AND latency_ms_max >= 0
      AND latency_ms_max <= latency_ms_sum
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

CREATE TABLE admin.identity_mutation_journal (
  id uuid PRIMARY KEY,
  idempotency_ledger_id uuid NOT NULL UNIQUE REFERENCES admin.idempotency_ledger(id) ON DELETE CASCADE,
  keycloak_subject_id text NOT NULL,
  operation_code text NOT NULL,
  request_fingerprint text NOT NULL,
  target_type text NOT NULL,
  target_identifier text NOT NULL,
  state text NOT NULL DEFAULT 'prepared',
  resource_id text,
  reconciliation_reason text,
  keycloak_applied_at timestamptz,
  reconciliation_required_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_mutation_journal_subject_check
    CHECK (char_length(keycloak_subject_id) BETWEEN 1 AND 255),
  CONSTRAINT identity_mutation_journal_operation_check
    CHECK (char_length(operation_code) BETWEEN 1 AND 128),
  CONSTRAINT identity_mutation_journal_fingerprint_check
    CHECK (char_length(request_fingerprint) = 64),
  CONSTRAINT identity_mutation_journal_target_type_check
    CHECK (target_type IN ('user', 'group', 'oauth_client')),
  CONSTRAINT identity_mutation_journal_target_identifier_check
    CHECK (char_length(target_identifier) BETWEEN 1 AND 255),
  CONSTRAINT identity_mutation_journal_state_check
    CHECK (
      state IN (
        'prepared',
        'keycloak_applied',
        'completed',
        'failed',
        'reconciliation_required'
      )
    ),
  CONSTRAINT identity_mutation_journal_resource_id_check
    CHECK (
      resource_id IS NULL
      OR char_length(resource_id) BETWEEN 1 AND 255
    ),
  CONSTRAINT identity_mutation_journal_reconciliation_reason_check
    CHECK (
      reconciliation_reason IS NULL
      OR reconciliation_reason IN (
        'keycloak_outcome_unknown',
        'keycloak_applied_persistence_failed',
        'finalization_failed',
        'completion_persistence_failed'
      )
    ),
  CONSTRAINT identity_mutation_journal_lifecycle_check
    CHECK (
      (
        state = 'prepared'
        AND keycloak_applied_at IS NULL
        AND reconciliation_required_at IS NULL
        AND completed_at IS NULL
        AND resource_id IS NULL
        AND reconciliation_reason IS NULL
      )
      OR
      (
        state = 'keycloak_applied'
        AND keycloak_applied_at IS NOT NULL
        AND reconciliation_required_at IS NULL
        AND completed_at IS NULL
        AND reconciliation_reason IS NULL
      )
      OR
      (
        state = 'completed'
        AND keycloak_applied_at IS NOT NULL
        AND reconciliation_required_at IS NULL
        AND completed_at IS NOT NULL
        AND reconciliation_reason IS NULL
      )
      OR
      (
        state = 'failed'
        AND keycloak_applied_at IS NULL
        AND reconciliation_required_at IS NULL
        AND completed_at IS NOT NULL
        AND resource_id IS NULL
        AND reconciliation_reason IS NULL
      )
      OR
      (
        state = 'reconciliation_required'
        AND reconciliation_required_at IS NOT NULL
        AND completed_at IS NULL
        AND reconciliation_reason IS NOT NULL
      )
    ),
  CONSTRAINT identity_mutation_journal_timestamps_check
    CHECK (
      updated_at >= created_at
      AND (
        keycloak_applied_at IS NULL
        OR keycloak_applied_at >= created_at
      )
      AND (
        reconciliation_required_at IS NULL
        OR reconciliation_required_at >= COALESCE(keycloak_applied_at, created_at)
      )
      AND (
        completed_at IS NULL
        OR completed_at >= COALESCE(keycloak_applied_at, created_at)
      )
    )
);

CREATE INDEX identity_mutation_journal_state_updated_idx
  ON admin.identity_mutation_journal (state, updated_at);
CREATE UNIQUE INDEX identity_mutation_journal_one_unresolved_idx
  ON admin.identity_mutation_journal ((true))
  WHERE state IN ('prepared', 'keycloak_applied', 'reconciliation_required');

CREATE TABLE admin.identity_mutation_journal_targets (
  id uuid PRIMARY KEY,
  journal_id uuid NOT NULL REFERENCES admin.identity_mutation_journal(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  target_type text NOT NULL,
  target_identifier text NOT NULL,
  intent jsonb NOT NULL,
  state text NOT NULL DEFAULT 'unattempted',
  resource_id text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_mutation_journal_targets_ordinal_check
    CHECK (ordinal BETWEEN 0 AND 99),
  CONSTRAINT identity_mutation_journal_targets_type_check
    CHECK (target_type IN ('user', 'group_membership')),
  CONSTRAINT identity_mutation_journal_targets_identifier_check
    CHECK (char_length(target_identifier) BETWEEN 1 AND 511),
  CONSTRAINT identity_mutation_journal_targets_intent_check
    CHECK (
      (
        intent ->> 'kind' = 'csv_user'
        AND intent ?& ARRAY[
          'displayName', 'email', 'enabled', 'group', 'kind', 'line',
          'role', 'sendInvite', 'username'
        ]
        AND intent - ARRAY[
          'displayName', 'email', 'enabled', 'group', 'kind', 'line',
          'role', 'sendInvite', 'username'
        ] = '{}'::jsonb
        AND jsonb_typeof(intent -> 'displayName') = 'string'
        AND jsonb_typeof(intent -> 'email') = 'string'
        AND jsonb_typeof(intent -> 'enabled') = 'boolean'
        AND jsonb_typeof(intent -> 'group') = 'string'
        AND jsonb_typeof(intent -> 'line') = 'number'
        AND intent ->> 'role' IN ('admin', 'operator')
        AND jsonb_typeof(intent -> 'sendInvite') = 'boolean'
        AND jsonb_typeof(intent -> 'username') = 'string'
      )
      OR
      (
        intent ->> 'kind' = 'group_membership'
        AND intent ?& ARRAY['groupId', 'kind', 'memberId']
        AND intent - ARRAY['groupId', 'kind', 'memberId'] = '{}'::jsonb
        AND jsonb_typeof(intent -> 'groupId') = 'string'
        AND jsonb_typeof(intent -> 'memberId') = 'string'
      )
    ),
  CONSTRAINT identity_mutation_journal_targets_state_check
    CHECK (state IN ('unattempted', 'unknown', 'applied', 'failed')),
  CONSTRAINT identity_mutation_journal_targets_resource_id_check
    CHECK (
      resource_id IS NULL
      OR char_length(resource_id) BETWEEN 1 AND 255
    ),
  CONSTRAINT identity_mutation_journal_targets_lifecycle_check
    CHECK (
      (
        state = 'unattempted'
        AND resource_id IS NULL
        AND started_at IS NULL
        AND completed_at IS NULL
      )
      OR
      (
        state = 'unknown'
        AND started_at IS NOT NULL
        AND completed_at IS NULL
      )
      OR
      (
        state = 'applied'
        AND started_at IS NOT NULL
        AND completed_at IS NOT NULL
        AND (
          target_type <> 'user'
          OR resource_id IS NOT NULL
        )
      )
      OR
      (
        state = 'failed'
        AND resource_id IS NULL
        AND started_at IS NOT NULL
        AND completed_at IS NOT NULL
      )
    ),
  CONSTRAINT identity_mutation_journal_targets_timestamps_check
    CHECK (
      updated_at >= created_at
      AND (
        started_at IS NULL
        OR started_at >= created_at
      )
      AND (
        completed_at IS NULL
        OR completed_at >= started_at
      )
    )
);

CREATE UNIQUE INDEX identity_mutation_journal_targets_ordinal_idx
  ON admin.identity_mutation_journal_targets (journal_id, ordinal);
CREATE UNIQUE INDEX identity_mutation_journal_targets_identifier_idx
  ON admin.identity_mutation_journal_targets (journal_id, target_identifier);
CREATE INDEX identity_mutation_journal_targets_state_idx
  ON admin.identity_mutation_journal_targets (journal_id, state);

CREATE TABLE admin.console_settings (
  id text PRIMARY KEY,
  organization_name text NOT NULL DEFAULT 'LLM Machines',
  default_language text NOT NULL DEFAULT 'en',
  full_logo jsonb,
  icon_logo jsonb,
  telemetry_enabled boolean NOT NULL DEFAULT false,
  telemetry_payload_preview jsonb NOT NULL DEFAULT
    '{"applianceId": null, "installedVersion": null, "updateAgentVersion": null, "lastUpdateCheck": null, "lastAppliedUpdate": null, "subscriptionStateSeenByAppliance": "not_configured"}'::jsonb,
  privacy_policy_href text NOT NULL DEFAULT '/privacy',
  data_residency_statement text NOT NULL DEFAULT
    'LLM Machines managed components do not retain inference request or response content.',
  alert_delivery_mode text NOT NULL DEFAULT 'local_only',
  alert_delivery_transport text,
  alert_egress_warning_version text,
  alert_egress_revision bigint NOT NULL DEFAULT 0,
  alert_egress_acknowledged_at timestamptz,
  alert_egress_acknowledged_by text REFERENCES common.human_identities(subject_id) ON DELETE RESTRICT,
  alert_egress_updated_by text REFERENCES common.human_identities(subject_id) ON DELETE RESTRICT,
  alert_egress_updated_at timestamptz,
  updated_by text REFERENCES common.human_identities(subject_id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT console_settings_id_check CHECK (id = 'singleton'),
  CONSTRAINT console_settings_language_check
    CHECK (default_language IN ('en', 'hr')),
  CONSTRAINT console_settings_alert_delivery_mode_check
    CHECK (alert_delivery_mode IN ('local_only', 'customer_owned')),
  CONSTRAINT console_settings_alert_transport_check
    CHECK (
      alert_delivery_transport IS NULL
      OR alert_delivery_transport IN ('smtp', 'webhook')
    ),
  CONSTRAINT console_settings_alert_warning_check
    CHECK (
      alert_egress_warning_version IS NULL
      OR char_length(alert_egress_warning_version) BETWEEN 1 AND 64
    ),
  CONSTRAINT console_settings_alert_revision_check
    CHECK (alert_egress_revision >= 0),
  CONSTRAINT console_settings_alert_updater_check
    CHECK (
      (
        alert_egress_revision = 0
        AND num_nonnulls(alert_egress_updated_at, alert_egress_updated_by) = 0
      )
      OR
      (
        alert_egress_revision > 0
        AND num_nonnulls(alert_egress_updated_at, alert_egress_updated_by) = 2
      )
    ),
  CONSTRAINT console_settings_alert_delivery_lifecycle_check
    CHECK (
      (
        alert_delivery_mode = 'local_only'
        AND num_nonnulls(
          alert_delivery_transport,
          alert_egress_warning_version,
          alert_egress_acknowledged_at,
          alert_egress_acknowledged_by
        ) = 0
      )
      OR
      (
        alert_delivery_mode = 'customer_owned'
        AND num_nonnulls(
          alert_delivery_transport,
          alert_egress_warning_version,
          alert_egress_acknowledged_at,
          alert_egress_acknowledged_by
        ) = 4
      )
    )
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

CREATE TABLE admin.emergency_recovery_factor (
  id text PRIMARY KEY,
  algorithm text NOT NULL,
  verifier_hash text NOT NULL,
  salt text NOT NULL,
  cost integer NOT NULL,
  block_size integer NOT NULL,
  parallelization integer NOT NULL,
  key_length integer NOT NULL,
  max_memory integer NOT NULL,
  commissioned_by text NOT NULL,
  commissioned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT emergency_recovery_factor_id_check CHECK (id = 'appliance'),
  CONSTRAINT emergency_recovery_factor_algorithm_check
    CHECK (algorithm = 'scrypt'),
  CONSTRAINT emergency_recovery_factor_verifier_check
    CHECK (verifier_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT emergency_recovery_factor_salt_check
    CHECK (salt ~ '^[0-9a-f]{32}$'),
  CONSTRAINT emergency_recovery_factor_parameters_check
    CHECK (
      cost = 16384
      AND block_size = 8
      AND parallelization = 1
      AND key_length = 32
      AND max_memory = 67108864
    ),
  CONSTRAINT emergency_recovery_factor_subject_check
    CHECK (char_length(commissioned_by) BETWEEN 1 AND 255)
);

CREATE TABLE admin.emergency_recovery_sessions (
  id uuid PRIMARY KEY,
  keycloak_subject_id text NOT NULL,
  reason_code text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  activated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by text,
  correlation_id text NOT NULL,
  CONSTRAINT emergency_recovery_sessions_subject_check
    CHECK (char_length(keycloak_subject_id) BETWEEN 1 AND 255),
  CONSTRAINT emergency_recovery_sessions_reason_check
    CHECK (
      reason_code IN (
        'admin_lockout',
        'admin_role_repair',
        'admin_mfa_repair'
      )
    ),
  CONSTRAINT emergency_recovery_sessions_status_check
    CHECK (status IN ('active', 'revoked', 'expired')),
  CONSTRAINT emergency_recovery_sessions_correlation_check
    CHECK (char_length(correlation_id) BETWEEN 1 AND 128),
  CONSTRAINT emergency_recovery_sessions_revoked_by_check
    CHECK (
      revoked_by IS NULL
      OR char_length(revoked_by) BETWEEN 1 AND 255
    ),
  CONSTRAINT emergency_recovery_sessions_ttl_check
    CHECK (expires_at = activated_at + interval '15 minutes'),
  CONSTRAINT emergency_recovery_sessions_lifecycle_check
    CHECK (
      (
        status = 'active'
        AND revoked_at IS NULL
        AND revoked_by IS NULL
      )
      OR
      (
        status = 'revoked'
        AND revoked_at IS NOT NULL
        AND revoked_by IS NOT NULL
        AND revoked_at >= activated_at
        AND revoked_at < expires_at
      )
      OR
      (
        status = 'expired'
        AND revoked_at IS NULL
        AND revoked_by IS NULL
      )
    )
);

CREATE UNIQUE INDEX emergency_recovery_sessions_one_active_idx
  ON admin.emergency_recovery_sessions (status)
  WHERE status = 'active';
CREATE INDEX emergency_recovery_sessions_expiry_idx
  ON admin.emergency_recovery_sessions (expires_at);

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

CREATE TABLE admin.emergency_isolation_state (
  id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'inactive',
  revision bigint NOT NULL DEFAULT 0,
  transition_id uuid,
  correlation_id text,
  changed_by_subject_id text,
  failure_code text,
  activated_at timestamptz,
  activated_by_subject_id text,
  transition_started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT emergency_isolation_state_id_check
    CHECK (id = 'appliance'),
  CONSTRAINT emergency_isolation_state_status_check
    CHECK (
      status IN (
        'inactive',
        'engaging',
        'active',
        'disengaging',
        'recovery_required'
      )
    ),
  CONSTRAINT emergency_isolation_state_revision_check
    CHECK (revision BETWEEN 0 AND 9007199254740991),
  CONSTRAINT emergency_isolation_state_correlation_check
    CHECK (
      correlation_id IS NULL
      OR char_length(correlation_id) BETWEEN 1 AND 128
    ),
  CONSTRAINT emergency_isolation_state_subject_check
    CHECK (
      (
        changed_by_subject_id IS NULL
        OR char_length(changed_by_subject_id) BETWEEN 1 AND 255
      )
      AND
      (
        activated_by_subject_id IS NULL
        OR char_length(activated_by_subject_id) BETWEEN 1 AND 255
      )
    ),
  CONSTRAINT emergency_isolation_state_failure_check
    CHECK (
      failure_code IS NULL
      OR failure_code IN (
        'state_invalid',
        'admission_fence_failed',
        'inflight_abort_failed',
        'enforcement_failed',
        'verification_failed',
        'restore_reassertion_failed',
        'journal_failed'
      )
    ),
  CONSTRAINT emergency_isolation_state_timestamps_check
    CHECK (
      (
        transition_started_at IS NULL
        OR updated_at >= transition_started_at
      )
      AND
      (
        activated_at IS NULL
        OR updated_at >= activated_at
      )
    ),
  CONSTRAINT emergency_isolation_state_metadata_check
    CHECK (
      (
        revision = 0
        AND status = 'inactive'
        AND transition_id IS NULL
        AND correlation_id IS NULL
        AND changed_by_subject_id IS NULL
        AND failure_code IS NULL
        AND activated_at IS NULL
        AND activated_by_subject_id IS NULL
        AND transition_started_at IS NULL
      )
      OR
      (
        revision > 0
        AND (
          (
            status = 'recovery_required'
            AND failure_code IS NOT NULL
          )
          OR
          (
            status <> 'recovery_required'
            AND failure_code IS NULL
            AND changed_by_subject_id IS NOT NULL
          )
        )
        AND (
          (
            status IN ('engaging', 'disengaging')
            AND transition_id IS NOT NULL
            AND correlation_id IS NOT NULL
            AND transition_started_at IS NOT NULL
          )
          OR
          (
            status IN ('inactive', 'active', 'recovery_required')
            AND transition_id IS NULL
            AND correlation_id IS NULL
            AND transition_started_at IS NULL
          )
        )
        AND (
          (
            status IN ('inactive', 'engaging')
            AND activated_at IS NULL
            AND activated_by_subject_id IS NULL
          )
          OR
          (
            status IN ('active', 'disengaging')
            AND activated_at IS NOT NULL
            AND activated_by_subject_id IS NOT NULL
          )
          OR
          (
            status = 'recovery_required'
            AND (
              (
                activated_at IS NULL
                AND activated_by_subject_id IS NULL
              )
              OR
              (
                activated_at IS NOT NULL
                AND activated_by_subject_id IS NOT NULL
              )
            )
          )
        )
      )
    )
);

CREATE TABLE admin.lifecycle_operations (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  state text NOT NULL DEFAULT 'prepared',
  actor_subject_id text NOT NULL REFERENCES common.human_identities(subject_id) ON DELETE RESTRICT,
  correlation_id text NOT NULL,
  snapshot_id uuid NOT NULL,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT lifecycle_operations_kind_check
    CHECK (kind IN ('snapshot', 'restore')),
  CONSTRAINT lifecycle_operations_state_check
    CHECK (
      state IN (
        'prepared',
        'quiescing',
        'capturing',
        'validating',
        'restoring',
        'verifying',
        'resuming',
        'rolling_back',
        'succeeded',
        'rolled_back',
        'failed',
        'recovery_required'
      )
    ),
  CONSTRAINT lifecycle_operations_failure_code_check
    CHECK (
      failure_code IS NULL
      OR failure_code IN (
        'adapter_unavailable',
        'quiesce_failed',
        'capture_failed',
        'manifest_invalid',
        'consistency_mismatch',
        'restore_failed',
        'verification_failed',
        'rollback_failed',
        'resume_failed',
        'journal_failed'
      )
    ),
  CONSTRAINT lifecycle_operations_kind_state_check
    CHECK (
      (
        kind = 'snapshot'
        AND state IN (
          'prepared',
          'quiescing',
          'capturing',
          'validating',
          'resuming',
          'succeeded',
          'failed',
          'recovery_required'
        )
      ) OR (
        kind = 'restore'
        AND state IN (
          'prepared',
          'quiescing',
          'validating',
          'restoring',
          'verifying',
          'resuming',
          'rolling_back',
          'succeeded',
          'rolled_back',
          'failed',
          'recovery_required'
        )
      )
    ),
  CONSTRAINT lifecycle_operations_terminal_check
    CHECK (
      (
        state IN (
          'prepared',
          'quiescing',
          'capturing',
          'validating',
          'restoring',
          'verifying',
          'resuming'
        )
        AND completed_at IS NULL
        AND failure_code IS NULL
      ) OR (
        state = 'rolling_back'
        AND completed_at IS NULL
        AND failure_code IS NOT NULL
      ) OR (
        state = 'succeeded'
        AND completed_at IS NOT NULL
        AND failure_code IS NULL
      ) OR (
        state IN ('rolled_back', 'failed', 'recovery_required')
        AND completed_at IS NOT NULL
        AND failure_code IS NOT NULL
      )
    ),
  CONSTRAINT lifecycle_operations_correlation_id_check
    CHECK (char_length(correlation_id) BETWEEN 1 AND 128),
  CONSTRAINT lifecycle_operations_timestamps_check
    CHECK (
      updated_at >= created_at
      AND (
        completed_at IS NULL
        OR (
          completed_at >= created_at
          AND completed_at <= updated_at
        )
      )
    )
);

CREATE UNIQUE INDEX lifecycle_operations_one_active_idx
  ON admin.lifecycle_operations ((true))
  WHERE state IN (
    'prepared',
    'quiescing',
    'capturing',
    'validating',
    'restoring',
    'verifying',
    'resuming',
    'rolling_back',
    'recovery_required'
  );

CREATE UNIQUE INDEX lifecycle_operations_id_snapshot_idx
  ON admin.lifecycle_operations (id, snapshot_id);

CREATE TABLE admin.lifecycle_operation_events (
  operation_id uuid NOT NULL REFERENCES admin.lifecycle_operations(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  operation_state text NOT NULL,
  phase text NOT NULL,
  component text,
  outcome text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  failure_code text,
  CONSTRAINT lifecycle_operation_events_pkey PRIMARY KEY (operation_id, sequence),
  CONSTRAINT lifecycle_operation_events_sequence_check
    CHECK (sequence >= 0),
  CONSTRAINT lifecycle_operation_events_state_check
    CHECK (
      operation_state IN (
        'prepared',
        'quiescing',
        'capturing',
        'validating',
        'restoring',
        'verifying',
        'resuming',
        'rolling_back',
        'succeeded',
        'rolled_back',
        'failed',
        'recovery_required'
      )
    ),
  CONSTRAINT lifecycle_operation_events_phase_check
    CHECK (
      phase IN (
        'operation',
        'quiesce',
        'capture',
        'validate',
        'restore',
        'verify',
        'resume',
        'rollback',
        'emergency_isolation_fence',
        'emergency_isolation_reassertion',
        'emergency_session_fence',
        'emergency_session_reset',
        'credential_consistency',
        'discard_preparation'
      )
    ),
  CONSTRAINT lifecycle_operation_events_component_check
    CHECK (
      component IS NULL
      OR component IN (
        'console_database',
        'keycloak',
        'litellm',
        'grafana'
      )
    ),
  CONSTRAINT lifecycle_operation_events_phase_component_check
    CHECK (
      (
        phase IN (
          'operation',
          'emergency_isolation_fence',
          'emergency_isolation_reassertion',
          'emergency_session_fence',
          'emergency_session_reset',
          'credential_consistency'
        )
        AND component IS NULL
      ) OR (
        phase IN (
          'quiesce',
          'capture',
          'validate',
          'restore',
          'verify',
          'resume',
          'rollback',
          'discard_preparation'
        )
        AND component IS NOT NULL
      )
    ),
  CONSTRAINT lifecycle_operation_events_phase_state_check
    CHECK (
      (phase = 'operation')
      OR (
        phase = 'quiesce'
        AND operation_state IN ('quiescing', 'rolling_back')
      )
      OR (
        phase = 'capture'
        AND operation_state = 'capturing'
      )
      OR (
        phase = 'validate'
        AND operation_state = 'validating'
      )
      OR (
        phase = 'restore'
        AND operation_state = 'restoring'
      )
      OR (
        phase = 'verify'
        AND operation_state = 'verifying'
      )
      OR (
        phase = 'resume'
        AND operation_state = 'resuming'
      )
      OR (
        phase = 'rollback'
        AND operation_state = 'rolling_back'
      )
      OR (
        phase = 'emergency_isolation_fence'
        AND operation_state IN (
          'prepared',
          'quiescing',
          'resuming'
        )
      )
      OR (
        phase = 'emergency_isolation_reassertion'
        AND operation_state IN (
          'prepared',
          'validating',
          'quiescing',
          'restoring',
          'verifying',
          'rolling_back',
          'resuming',
          'recovery_required'
        )
      )
      OR (
        phase = 'emergency_session_fence'
        AND operation_state IN (
          'quiescing',
          'resuming',
          'rolling_back'
        )
      )
      OR (
        phase = 'emergency_session_reset'
        AND operation_state IN (
          'quiescing',
          'restoring',
          'resuming',
          'rolling_back'
        )
      )
      OR (
        phase = 'credential_consistency'
        AND operation_state = 'verifying'
      )
      OR (
        phase = 'discard_preparation'
        AND operation_state IN (
          'validating',
          'verifying',
          'rolling_back'
        )
      )
    ),
  CONSTRAINT lifecycle_operation_events_outcome_check
    CHECK (outcome IN ('started', 'succeeded', 'failed')),
  CONSTRAINT lifecycle_operation_events_failure_code_check
    CHECK (
      failure_code IS NULL
      OR failure_code IN (
        'adapter_unavailable',
        'quiesce_failed',
        'capture_failed',
        'manifest_invalid',
        'consistency_mismatch',
        'restore_failed',
        'verification_failed',
        'rollback_failed',
        'resume_failed',
        'journal_failed'
      )
    ),
  CONSTRAINT lifecycle_operation_events_outcome_failure_check
    CHECK (
      (
        outcome = 'failed'
        AND failure_code IS NOT NULL
      ) OR (
        outcome IN ('started', 'succeeded')
        AND failure_code IS NULL
      )
    )
);

CREATE TABLE admin.lifecycle_snapshot_manifests (
  snapshot_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE,
  schema_version integer NOT NULL DEFAULT 1,
  manifest_sha256 text NOT NULL,
  captured_at timestamptz NOT NULL,
  content_free boolean NOT NULL DEFAULT true,
  workload_content_included boolean NOT NULL DEFAULT false,
  plaintext_secrets_included boolean NOT NULL DEFAULT false,
  emergency_sessions_included boolean NOT NULL DEFAULT false,
  component_count integer NOT NULL DEFAULT 4,
  CONSTRAINT lifecycle_snapshot_manifests_operation_snapshot_fkey
    FOREIGN KEY (operation_id, snapshot_id)
    REFERENCES admin.lifecycle_operations(id, snapshot_id)
    ON DELETE RESTRICT,
  CONSTRAINT lifecycle_snapshot_manifests_schema_version_check
    CHECK (schema_version = 1),
  CONSTRAINT lifecycle_snapshot_manifests_hash_check
    CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT lifecycle_snapshot_manifests_content_boundary_check
    CHECK (
      content_free = true
      AND workload_content_included = false
      AND plaintext_secrets_included = false
      AND emergency_sessions_included = false
    ),
  CONSTRAINT lifecycle_snapshot_manifests_component_count_check
    CHECK (component_count = 4)
);

CREATE TABLE admin.lifecycle_snapshot_components (
  snapshot_id uuid NOT NULL REFERENCES admin.lifecycle_snapshot_manifests(snapshot_id) ON DELETE CASCADE,
  component text NOT NULL,
  ordinal integer NOT NULL,
  revision text NOT NULL,
  artifact_sha256 text NOT NULL,
  CONSTRAINT lifecycle_snapshot_components_pkey PRIMARY KEY (snapshot_id, component),
  CONSTRAINT lifecycle_snapshot_components_mapping_check
    CHECK (
      (
        component = 'console_database'
        AND ordinal = 0
      ) OR (
        component = 'keycloak'
        AND ordinal = 1
      ) OR (
        component = 'litellm'
        AND ordinal = 2
      ) OR (
        component = 'grafana'
        AND ordinal = 3
      )
    ),
  CONSTRAINT lifecycle_snapshot_components_revision_check
    CHECK (revision ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$'),
  CONSTRAINT lifecycle_snapshot_components_hash_check
    CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX lifecycle_snapshot_components_snapshot_ordinal_idx
  ON admin.lifecycle_snapshot_components (snapshot_id, ordinal);

INSERT INTO admin.console_settings (id) VALUES ('singleton');
INSERT INTO admin.license_state (id) VALUES ('singleton');
INSERT INTO admin.update_state (id) VALUES ('singleton');
INSERT INTO admin.backup_state (id) VALUES ('singleton');
INSERT INTO admin.recovery_state (id) VALUES ('singleton');
INSERT INTO admin.emergency_isolation_state (id) VALUES ('appliance');

COMMIT;
