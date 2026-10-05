-- SPDX-License-Identifier: Apache-2.0
--
-- Home core (additive): corpus sources, per-file fingerprints with the last completed
-- pipeline stage (resumability), the pipeline run journal, sync state and the backup ledger.

-- A corpus root or logical origin: a directory, a git tree, a URL space, an imported legacy
-- store or a session mirror. `label` is the stable human key used as the document path prefix.
CREATE TABLE sources (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT NOT NULL CHECK (kind <> ''),
    label         TEXT NOT NULL UNIQUE CHECK (label <> ''),
    root          TEXT,
    meta_json     TEXT NOT NULL DEFAULT '{}',
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);

-- One row per scanned file. `stage` is the highest pipeline stage completed for the stored
-- `blake3`; a changed hash resets it to `scan`, an unchanged hash resumes after `stage`.
CREATE TABLE files (
    source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    rel_path      TEXT NOT NULL,
    blake3        TEXT NOT NULL,
    size_bytes    INTEGER NOT NULL CHECK (size_bytes >= 0),
    mtime_ms      INTEGER NOT NULL,
    class         TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (class IN ('code', 'doc', 'data', 'generated', 'binary', 'ignored', 'unknown')),
    lang          TEXT,
    stage         TEXT NOT NULL DEFAULT 'scan'
                  CHECK (stage IN ('scan', 'classify', 'extract', 'chunk', 'embed', 'index')),
    scanned_at_ms INTEGER NOT NULL,
    PRIMARY KEY (source_id, rel_path)
) WITHOUT ROWID;

CREATE INDEX files_blake3_idx ON files (blake3);
CREATE INDEX files_class_idx ON files (source_id, class);
CREATE INDEX files_stage_idx ON files (source_id, stage);

-- Documents may belong to a source (NULL for documents indexed before sources existed).
ALTER TABLE docs ADD COLUMN source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL;
CREATE INDEX docs_source_idx ON docs (source_id);

-- Journal of pipeline stage runs; a run left `running` by a dead process is marked `interrupted`.
CREATE TABLE pipeline_runs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id      INTEGER REFERENCES sources(id) ON DELETE SET NULL,
    stage          TEXT NOT NULL CHECK (stage <> ''),
    status         TEXT NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running', 'succeeded', 'failed', 'interrupted')),
    started_at_ms  INTEGER NOT NULL,
    finished_at_ms INTEGER,
    stats_json     TEXT NOT NULL DEFAULT '{}',
    error          TEXT,
    CHECK (status <> 'failed' OR error IS NOT NULL)
);
CREATE INDEX pipeline_runs_stage_idx ON pipeline_runs (stage, started_at_ms DESC);

-- Key/value synchronisation cursors and fingerprints (session mirror offsets, import marks...).
CREATE TABLE sync_state (
    scope         TEXT NOT NULL CHECK (scope <> ''),
    key           TEXT NOT NULL CHECK (key <> ''),
    value         TEXT NOT NULL,
    blake3        TEXT,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (scope, key)
) WITHOUT ROWID;

-- Ledger of verified backups of this database (the file itself lives under
-- private/backups/aphrody-unique/<date>/).
CREATE TABLE backups (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    path           TEXT NOT NULL,
    sha256         TEXT NOT NULL CHECK (length(sha256) = 64),
    size_bytes     INTEGER NOT NULL CHECK (size_bytes >= 0),
    schema_version INTEGER NOT NULL,
    reason         TEXT NOT NULL,
    created_at_ms  INTEGER NOT NULL
);
