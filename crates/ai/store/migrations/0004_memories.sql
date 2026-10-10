-- SPDX-License-Identifier: Apache-2.0
--
-- Memories (additive): one table for every memory layout (`memory_items` of the SQLite backend,
-- `memory_records` of the local provider, agent-home directive records). `ns` holds the
-- namespace or agent id; `origin` records the import or writer so imports stay idempotent.

CREATE TABLE memories (
    pk              INTEGER PRIMARY KEY AUTOINCREMENT,
    id              TEXT NOT NULL,
    ns              TEXT NOT NULL,
    content         TEXT NOT NULL,
    tags_json       TEXT NOT NULL DEFAULT '[]',
    metadata_json   TEXT NOT NULL DEFAULT '{}',
    embedding       BLOB,
    embedding_model TEXT,
    origin          TEXT NOT NULL DEFAULT 'native',
    created_at_ms   INTEGER NOT NULL,
    updated_at_ms   INTEGER NOT NULL,
    UNIQUE (ns, id)
);
CREATE INDEX memories_created_idx ON memories (created_at_ms DESC);
CREATE INDEX memories_origin_idx ON memories (origin);

CREATE VIRTUAL TABLE memories_fts USING fts5(
    content,
    content = memories,
    content_rowid = pk,
    tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts (rowid, content) VALUES (new.pk, new.content);
END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts (memories_fts, rowid, content) VALUES ('delete', old.pk, old.content);
END;
CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts (memories_fts, rowid, content) VALUES ('delete', old.pk, old.content);
    INSERT INTO memories_fts (rowid, content) VALUES (new.pk, new.content);
END;
