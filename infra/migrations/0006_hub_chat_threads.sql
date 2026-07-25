CREATE TABLE IF NOT EXISTS hub.chat_threads (
  owner_id text NOT NULL REFERENCES common.users(id) ON DELETE RESTRICT,
  thread_id text NOT NULL,
  title text NOT NULL,
  preview text NOT NULL,
  model text,
  resource_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, thread_id)
);

CREATE INDEX IF NOT EXISTS hub_chat_threads_owner_updated_idx
  ON hub.chat_threads (owner_id, updated_at DESC);
