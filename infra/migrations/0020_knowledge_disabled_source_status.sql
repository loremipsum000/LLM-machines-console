DO $$
DECLARE
  source_constraint record;
  archive_constraint record;
BEGIN
  FOR source_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'knowledge.sources'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE knowledge.sources DROP CONSTRAINT %I', source_constraint.conname);
  END LOOP;

  ALTER TABLE knowledge.sources
    ADD CONSTRAINT knowledge_sources_status_check
    CHECK (status IN ('pending', 'fetching', 'extracting', 'ready', 'failed', 'blocked', 'removed', 'disabled'));

  FOR archive_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'knowledge_archive.sources'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE knowledge_archive.sources DROP CONSTRAINT %I', archive_constraint.conname);
  END LOOP;

  ALTER TABLE knowledge_archive.sources
    ADD CONSTRAINT knowledge_archive_sources_status_check
    CHECK (status IN ('pending', 'fetching', 'extracting', 'ready', 'failed', 'blocked', 'removed', 'disabled'));
END $$;
