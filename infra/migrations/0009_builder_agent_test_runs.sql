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
