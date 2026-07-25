CREATE TABLE IF NOT EXISTS admin.agentic_runtime_snapshots (
  id uuid PRIMARY KEY,
  runtime text NOT NULL CHECK (runtime IN ('openclaw', 'hermes')),
  profile text NOT NULL CHECK (
    profile IN (
      'openclaw-restricted',
      'openclaw-tools',
      'hermes-restricted',
      'hermes-tools'
    )
  ),
  configured boolean NOT NULL,
  healthy boolean NOT NULL,
  base_url text,
  detail text,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agentic_runtime_snapshots_runtime_captured_idx
  ON admin.agentic_runtime_snapshots (runtime, captured_at DESC);
