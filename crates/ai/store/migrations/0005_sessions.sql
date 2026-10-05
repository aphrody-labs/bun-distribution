-- SPDX-License-Identifier: Apache-2.0
--
-- Sessions (additive): a queryable index over the JSONL transcripts, which stay the transcript
-- store. `messages` is filled only on explicit request (transcripts are private); the default
-- import records session metadata and the mirror byte offsets only.

CREATE TABLE sessions (
    id             TEXT NOT NULL,
    agent          TEXT NOT NULL CHECK (agent <> ''),
    domain         TEXT,
    title          TEXT,
    started_at_ms  INTEGER,
    ended_at_ms    INTEGER,
    source_path    TEXT,
    source_bytes   INTEGER,
    source_blake3  TEXT,
    records        INTEGER NOT NULL DEFAULT 0,
    meta_json      TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (agent, id)
) WITHOUT ROWID;
CREATE INDEX sessions_started_idx ON sessions (started_at_ms DESC);

CREATE TABLE messages (
    pk            INTEGER PRIMARY KEY AUTOINCREMENT,
    agent         TEXT NOT NULL,
    session_id    TEXT NOT NULL,
    seq           INTEGER NOT NULL,
    role          TEXT NOT NULL,
    content       TEXT NOT NULL,
    ts_ms         INTEGER,
    tokens_in     INTEGER,
    tokens_out    INTEGER,
    cost_usd      REAL,
    tool_json     TEXT,
    UNIQUE (agent, session_id, seq),
    FOREIGN KEY (agent, session_id) REFERENCES sessions (agent, id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    content = messages,
    content_rowid = pk,
    tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts (rowid, content) VALUES (new.pk, new.content);
END;
CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts (messages_fts, rowid, content) VALUES ('delete', old.pk, old.content);
END;
CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts (messages_fts, rowid, content) VALUES ('delete', old.pk, old.content);
    INSERT INTO messages_fts (rowid, content) VALUES (new.pk, new.content);
END;
