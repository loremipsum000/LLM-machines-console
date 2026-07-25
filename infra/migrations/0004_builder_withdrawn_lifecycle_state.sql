ALTER TABLE builder.lifecycle_events
  DROP CONSTRAINT IF EXISTS lifecycle_events_to_state_check;

ALTER TABLE builder.lifecycle_events
  ADD CONSTRAINT lifecycle_events_to_state_check
  CHECK (
    to_state IN (
      'draft',
      'submitted',
      'published',
      'deprecated',
      'rejected',
      'withdrawn'
    )
  );
