DROP INDEX IF EXISTS admin.egress_approvals_expiry_idx;

CREATE INDEX egress_approvals_expiry_idx
  ON admin.egress_approvals (expires_at)
  WHERE expires_at IS NOT NULL AND status = 'active';
