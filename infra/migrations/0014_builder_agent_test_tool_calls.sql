ALTER TABLE builder.agent_test_runs
  ADD COLUMN IF NOT EXISTS tool_calls jsonb NOT NULL DEFAULT '[]'::jsonb;
