ALTER TABLE builder.agent_test_runs
  ADD COLUMN IF NOT EXISTS trace jsonb NOT NULL DEFAULT '[]'::jsonb;
