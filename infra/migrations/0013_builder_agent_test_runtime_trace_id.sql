ALTER TABLE builder.agent_test_runs
  ADD COLUMN IF NOT EXISTS runtime_trace_id text NOT NULL DEFAULT 'unavailable' CHECK (
    char_length(runtime_trace_id) BETWEEN 1 AND 120
  );
