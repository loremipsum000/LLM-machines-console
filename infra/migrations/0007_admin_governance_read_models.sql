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
