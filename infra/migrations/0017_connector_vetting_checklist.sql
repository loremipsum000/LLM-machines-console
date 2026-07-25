ALTER TABLE admin.connector_vetting_decisions
  ADD COLUMN IF NOT EXISTS checklist jsonb NOT NULL DEFAULT '{}'::jsonb;
