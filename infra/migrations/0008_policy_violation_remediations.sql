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
