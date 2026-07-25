ALTER TABLE builder.resources
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS template_id text;

CREATE INDEX IF NOT EXISTS builder_resources_owner_state_idx
  ON builder.resources (owner_id, state, updated_at DESC);

CREATE TABLE IF NOT EXISTS builder.resource_versions (
  id uuid PRIMARY KEY,
  resource_id uuid NOT NULL REFERENCES builder.resources(id) ON DELETE RESTRICT,
  semver text NOT NULL,
  created_by text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_id, semver)
);

CREATE INDEX IF NOT EXISTS builder_resource_versions_resource_idx
  ON builder.resource_versions (resource_id, created_at DESC);

CREATE TABLE IF NOT EXISTS builder.lifecycle_events (
  id uuid PRIMARY KEY,
  resource_id uuid NOT NULL REFERENCES builder.resources(id) ON DELETE RESTRICT,
  resource_version_id uuid REFERENCES builder.resource_versions(id) ON DELETE RESTRICT,
  actor_id text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  from_state text CHECK (
    from_state IN ('draft', 'submitted', 'published', 'deprecated')
  ),
  to_state text NOT NULL CHECK (
    to_state IN (
      'draft',
      'submitted',
      'published',
      'deprecated',
      'rejected',
      'withdrawn'
    )
  ),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS builder_lifecycle_events_resource_idx
  ON builder.lifecycle_events (resource_id, created_at DESC);
