CREATE SCHEMA IF NOT EXISTS common;
CREATE SCHEMA IF NOT EXISTS admin;
CREATE SCHEMA IF NOT EXISTS builder;
CREATE SCHEMA IF NOT EXISTS hub;

CREATE TABLE IF NOT EXISTS common.audit_events (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS common.users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  persona text NOT NULL CHECK (persona IN ('consumer', 'builder', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS builder.resources (
  id uuid PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('agent', 'workflow', 'connector', 'custom_app', 'rag_corpus')),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  owner_id text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('draft', 'submitted', 'published', 'deprecated')),
  template_id text,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS builder_resources_owner_state_idx
  ON builder.resources (owner_id, state, updated_at DESC);

CREATE TABLE IF NOT EXISTS builder.resource_versions (
  id uuid PRIMARY KEY,
  resource_id uuid NOT NULL REFERENCES builder.resources(id) ON DELETE RESTRICT,
  semver text NOT NULL,
  created_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_id, semver)
);

CREATE INDEX IF NOT EXISTS builder_resource_versions_resource_idx
  ON builder.resource_versions (resource_id, created_at DESC);

CREATE TABLE IF NOT EXISTS builder.agent_configs (
  resource_id uuid PRIMARY KEY REFERENCES builder.resources(id) ON DELETE RESTRICT,
  config jsonb NOT NULL,
  updated_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS builder.agent_test_runs (
  id uuid PRIMARY KEY,
  resource_id uuid NOT NULL REFERENCES builder.resources(id) ON DELETE RESTRICT,
  actor_id text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  input text NOT NULL,
  output text,
  source text NOT NULL CHECK (source IN ('local_preview', 'agentic_runtime')),
  status text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  model text NOT NULL,
  sandbox_profile text NOT NULL,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  runtime_trace_id text NOT NULL DEFAULT 'unavailable' CHECK (
    char_length(runtime_trace_id) BETWEEN 1 AND 120
  ),
  finish_reason text CHECK (finish_reason IS NULL OR char_length(finish_reason) <= 80),
  prompt_tokens integer CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
  completion_tokens integer CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
  total_tokens integer CHECK (total_tokens IS NULL OR total_tokens >= 0),
  error_detail text,
  trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  tool_calls jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS builder_agent_test_runs_resource_idx
  ON builder.agent_test_runs (resource_id, created_at DESC);

CREATE TABLE IF NOT EXISTS builder.lifecycle_events (
  id uuid PRIMARY KEY,
  resource_id uuid NOT NULL REFERENCES builder.resources(id) ON DELETE RESTRICT,
  resource_version_id uuid REFERENCES builder.resource_versions(id) ON DELETE RESTRICT,
  actor_id text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  from_state text CHECK (from_state IN ('draft', 'submitted', 'published', 'deprecated')),
  to_state text NOT NULL CHECK (to_state IN ('draft', 'submitted', 'published', 'deprecated', 'rejected', 'withdrawn')),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS builder_lifecycle_events_resource_idx
  ON builder.lifecycle_events (resource_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hub.user_preferences (
  user_id text PRIMARY KEY REFERENCES common.users(id) ON DELETE RESTRICT,
  default_model text,
  notification_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub.notification_reads (
  user_id text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  notification_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_id)
);

CREATE TABLE IF NOT EXISTS hub.chat_threads (
  owner_id text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  thread_id text NOT NULL,
  title text NOT NULL,
  preview text NOT NULL,
  model text,
  resource_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, thread_id)
);

CREATE INDEX IF NOT EXISTS hub_chat_threads_owner_updated_idx
  ON hub.chat_threads (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS hub.task_sessions (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'waiting', 'completed', 'failed')),
  context jsonb NOT NULL DEFAULT '[]'::jsonb,
  diffs jsonb NOT NULL DEFAULT '[]'::jsonb,
  test_output jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_sessions_owner_updated_idx
  ON hub.task_sessions (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS hub.artifacts (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  task_id uuid REFERENCES hub.task_sessions(id) ON DELETE RESTRICT,
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('markdown', 'json', 'sql', 'diff', 'log', 'file')),
  preview text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artifacts_owner_created_idx
  ON hub.artifacts (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS artifacts_task_idx
  ON hub.artifacts (task_id)
  WHERE task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS admin.policies (
  id uuid PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('content_safety', 'access_control', 'data_governance')),
  version integer NOT NULL,
  definition jsonb NOT NULL,
  created_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin.builder_agent_studio_quota_policies (
  id text PRIMARY KEY,
  run_limit integer CHECK (run_limit IS NULL OR run_limit >= 0),
  token_limit integer CHECK (token_limit IS NULL OR token_limit >= 0),
  updated_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  note text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin.policy_violations (
  id uuid PRIMARY KEY,
  policy_id uuid REFERENCES admin.policies(id) ON DELETE RESTRICT,
  policy_type text NOT NULL CHECK (policy_type IN ('content_safety', 'access_control', 'data_governance')),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  action_taken text NOT NULL CHECK (action_taken IN ('audit', 'warn', 'block')),
  actor_id text REFERENCES common.users(id) ON DELETE RESTRICT,
  target_type text NOT NULL,
  target_id text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS policy_violations_created_idx
  ON admin.policy_violations (created_at DESC);

CREATE INDEX IF NOT EXISTS policy_violations_severity_idx
  ON admin.policy_violations (severity, created_at DESC);

CREATE TABLE IF NOT EXISTS admin.policy_violation_remediations (
  id uuid PRIMARY KEY,
  violation_id uuid NOT NULL REFERENCES admin.policy_violations(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('acknowledged', 'resolved')),
  note text NOT NULL,
  actor_id text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS policy_violation_remediations_violation_idx
  ON admin.policy_violation_remediations (violation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin.pure_mode_state (
  id text PRIMARY KEY CHECK (id = 'singleton'),
  active boolean NOT NULL DEFAULT false,
  reason text,
  activated_by text REFERENCES common.users(id) ON DELETE RESTRICT,
  activated_at timestamptz,
  deactivated_at timestamptz,
  affected_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO admin.pure_mode_state (id, active, affected_components, updated_at)
VALUES ('singleton', false, '[]'::jsonb, now())
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin.egress_approvals (
  id uuid PRIMARY KEY,
  sandbox_name text NOT NULL,
  profile text NOT NULL CHECK (
    profile IN (
      'openclaw-restricted',
      'openclaw-tools',
      'hermes-restricted',
      'hermes-tools'
    )
  ),
  endpoint_host text NOT NULL,
  endpoint_port integer NOT NULL CHECK (endpoint_port > 0 AND endpoint_port <= 65535),
  access_mode text NOT NULL CHECK (access_mode IN ('read_only', 'read_write')),
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'active', 'dry_run', 'failed', 'revoked', 'expired')),
  approved_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  expires_at timestamptz,
  idempotency_key text,
  request_hash text,
  adapter_status text,
  executed_command jsonb NOT NULL DEFAULT '[]'::jsonb,
  rollback_command jsonb NOT NULL DEFAULT '[]'::jsonb,
  stdout text NOT NULL DEFAULT '',
  stderr text NOT NULL DEFAULT '',
  failure_detail text,
  rollback_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS egress_approvals_sandbox_idx
  ON admin.egress_approvals (sandbox_name, status);

CREATE INDEX IF NOT EXISTS egress_approvals_expiry_idx
  ON admin.egress_approvals (expires_at)
  WHERE expires_at IS NOT NULL AND status = 'active';

CREATE TABLE IF NOT EXISTS admin.agentic_runtime_snapshots (
  id uuid PRIMARY KEY,
  runtime text NOT NULL CHECK (runtime IN ('openclaw', 'hermes')),
  profile text NOT NULL CHECK (
    profile IN (
      'openclaw-restricted',
      'openclaw-tools',
      'hermes-restricted',
      'hermes-tools'
    )
  ),
  configured boolean NOT NULL,
  healthy boolean NOT NULL,
  base_url text,
  detail text,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agentic_runtime_snapshots_runtime_captured_idx
  ON admin.agentic_runtime_snapshots (runtime, captured_at DESC);
