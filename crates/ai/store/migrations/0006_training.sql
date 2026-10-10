-- SPDX-License-Identifier: Apache-2.0
--
-- Local training registry (additive): SQLite mirror of the optional PostgreSQL `training`
-- registry of `aphrody-train` (ADR D11), same names and constraints, so any model and any
-- domain can record datasets, runs, artifacts, metrics and promotions without a server.

CREATE TABLE train_datasets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE CHECK (name <> ''),
    description   TEXT,
    created_at_ms INTEGER NOT NULL
);

CREATE TABLE train_dataset_versions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id     INTEGER NOT NULL REFERENCES train_datasets (id) ON DELETE CASCADE,
    parent_id      INTEGER REFERENCES train_dataset_versions (id) ON DELETE SET NULL,
    kind           TEXT NOT NULL DEFAULT 'full' CHECK (kind <> ''),
    source_commit  TEXT,
    content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
    row_count      INTEGER CHECK (row_count >= 0),
    uri            TEXT,
    metadata_json  TEXT NOT NULL DEFAULT '{}',
    created_at_ms  INTEGER NOT NULL,
    UNIQUE (dataset_id, kind, content_sha256)
);

CREATE TABLE train_examples (
    version_id    INTEGER NOT NULL REFERENCES train_dataset_versions (id) ON DELETE CASCADE,
    example_id    TEXT NOT NULL,
    kind          TEXT NOT NULL DEFAULT 'triple' CHECK (kind IN ('triple', 'instruction', 'pair', 'text')),
    split         TEXT NOT NULL DEFAULT 'train' CHECK (split IN ('train', 'validation', 'test', 'gold')),
    payload_json  TEXT NOT NULL,
    text_sha256   TEXT NOT NULL CHECK (length(text_sha256) = 64),
    PRIMARY KEY (version_id, example_id)
) WITHOUT ROWID;
CREATE INDEX train_examples_sha_idx ON train_examples (text_sha256, split);

-- Leak gate: a text present in a training split and in a held-out split.
CREATE VIEW train_split_leaks AS
SELECT t.text_sha256 AS text_sha256, t.version_id AS train_version_id,
       h.version_id AS heldout_version_id, h.split AS heldout_split
FROM train_examples t
JOIN train_examples h ON h.text_sha256 = t.text_sha256 AND h.split IN ('validation', 'test', 'gold')
WHERE t.split = 'train';

CREATE TABLE train_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    kind            TEXT NOT NULL CHECK (kind <> ''),
    status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    version_id      INTEGER REFERENCES train_dataset_versions (id) ON DELETE SET NULL,
    base_model      TEXT,
    params_json     TEXT NOT NULL DEFAULT '{}',
    code_commit     TEXT,
    job_id          TEXT,
    started_at_ms   INTEGER NOT NULL,
    finished_at_ms  INTEGER,
    error           TEXT,
    CHECK (finished_at_ms IS NULL OR finished_at_ms >= started_at_ms),
    CHECK (status <> 'failed' OR error IS NOT NULL)
);
CREATE INDEX train_runs_kind_idx ON train_runs (kind, started_at_ms DESC);

CREATE TABLE train_artifacts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id        INTEGER NOT NULL REFERENCES train_runs (id) ON DELETE CASCADE,
    kind          TEXT NOT NULL CHECK (kind <> ''),
    format        TEXT,
    uri           TEXT NOT NULL,
    sha256        TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
    size_bytes    INTEGER,
    created_at_ms INTEGER NOT NULL
);

CREATE TABLE train_metrics (
    run_id        INTEGER NOT NULL REFERENCES train_runs (id) ON DELETE CASCADE,
    name          TEXT NOT NULL CHECK (name <> ''),
    split         TEXT NOT NULL DEFAULT 'validation',
    step          INTEGER NOT NULL DEFAULT 0,
    value         REAL NOT NULL,
    PRIMARY KEY (run_id, name, split, step)
) WITHOUT ROWID;

CREATE TABLE train_promotions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    artifact_id   INTEGER NOT NULL REFERENCES train_artifacts (id) ON DELETE CASCADE,
    kind          TEXT NOT NULL CHECK (kind <> ''),
    alias         TEXT NOT NULL CHECK (alias <> ''),
    live          INTEGER NOT NULL DEFAULT 1 CHECK (live IN (0, 1)),
    reason        TEXT,
    promoted_at_ms INTEGER NOT NULL
);
-- One live promotion per (kind, alias).
CREATE UNIQUE INDEX train_promotions_live_idx ON train_promotions (kind, alias) WHERE live = 1;
