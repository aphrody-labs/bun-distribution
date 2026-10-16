-- SPDX-License-Identifier: Apache-2.0
-- Private, immutable copies of SQLite rows that differ from canonical bot tables.
BEGIN;
SET LOCAL ROLE shenron;
CREATE TABLE IF NOT EXISTS bot.sqlite_runtime_variants (
  source_id text NOT NULL,
  source_path text NOT NULL,
  source_device bigint NOT NULL,
  source_inode bigint NOT NULL,
  table_name text NOT NULL,
  source_key text NOT NULL,
  content_sha256 text NOT NULL,
  payload text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, table_name, source_key, content_sha256),
  CONSTRAINT sqlite_runtime_variants_table CHECK (table_name IN ('economy_index', 'race_level_roles', 'card_themes')),
  CONSTRAINT sqlite_runtime_variants_hash CHECK (content_sha256 ~ '^[a-f0-9]{64}$')
);
COMMIT;
