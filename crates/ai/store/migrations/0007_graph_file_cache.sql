-- SPDX-License-Identifier: Apache-2.0
--
-- Per-file extraction cache of the code graph (additive): the raw nodes, edges and call sites
-- extracted from one file, valid for the stored BLAKE3 of that file. Corpus assembly (call
-- resolution, stub folding, communities) re-runs from these rows, so only changed files are
-- parsed again.

CREATE TABLE graph_file_cache (
    source_id    INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    rel_path     TEXT NOT NULL,
    blake3       TEXT NOT NULL,
    extract_json TEXT NOT NULL,
    PRIMARY KEY (source_id, rel_path)
) WITHOUT ROWID;
