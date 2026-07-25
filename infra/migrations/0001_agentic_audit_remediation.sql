ALTER TABLE admin.egress_approvals
  DROP CONSTRAINT IF EXISTS egress_approvals_status_check;

ALTER TABLE admin.egress_approvals
  ADD CONSTRAINT egress_approvals_status_check
  CHECK (status IN ('pending', 'active', 'dry_run', 'failed', 'revoked', 'expired'));

ALTER TABLE admin.egress_approvals
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS request_hash text,
  ADD COLUMN IF NOT EXISTS adapter_status text,
  ADD COLUMN IF NOT EXISTS executed_command jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rollback_command jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS stdout text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stderr text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS failure_detail text,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS egress_approvals_idempotency_idx
  ON admin.egress_approvals (approved_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
