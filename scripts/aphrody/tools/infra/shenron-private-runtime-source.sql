-- SPDX-License-Identifier: Apache-2.0
-- Tracks only rows explicitly imported from the active bot SQLite instance.
BEGIN;
SET LOCAL ROLE shenron;
CREATE TABLE IF NOT EXISTS bot.sqlite_runtime_sources (
  source_id text NOT NULL,
  table_name text NOT NULL,
  source_key text NOT NULL,
  target_key text NOT NULL,
  row_hash text NOT NULL,
  PRIMARY KEY (source_id, table_name, source_key),
  UNIQUE (table_name, target_key),
  CONSTRAINT sqlite_runtime_sources_table CHECK (table_name IN ('dm_contacts', 'dm_messages', 'jails')),
  CONSTRAINT sqlite_runtime_sources_hash CHECK (row_hash ~ '^[a-f0-9]{64}$')
);
COMMIT;
