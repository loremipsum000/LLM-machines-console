ALTER TABLE builder.agent_test_runs
  ADD COLUMN IF NOT EXISTS finish_reason text CHECK (
    finish_reason IS NULL OR char_length(finish_reason) <= 80
  );

ALTER TABLE builder.agent_test_runs
  ADD COLUMN IF NOT EXISTS prompt_tokens integer CHECK (
    prompt_tokens IS NULL OR prompt_tokens >= 0
  );

ALTER TABLE builder.agent_test_runs
  ADD COLUMN IF NOT EXISTS completion_tokens integer CHECK (
    completion_tokens IS NULL OR completion_tokens >= 0
  );

ALTER TABLE builder.agent_test_runs
  ADD COLUMN IF NOT EXISTS total_tokens integer CHECK (
    total_tokens IS NULL OR total_tokens >= 0
  );
