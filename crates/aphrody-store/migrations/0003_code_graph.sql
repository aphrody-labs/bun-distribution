-- SPDX-License-Identifier: Apache-2.0
--
-- Code graph (additive): nodes and typed edges with EXTRACTED / INFERRED / AMBIGUOUS
-- confidence, communities, and a lexical index over node labels. The shape follows the
-- Graphify `graph.json` contract so that graphs can be imported and exported unchanged.

CREATE TABLE graph_nodes (
    pk            INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    node_id       TEXT NOT NULL,
    label         TEXT NOT NULL,
    kind          TEXT NOT NULL DEFAULT 'code' CHECK (kind IN ('code', 'document', 'concept', 'rationale')),
    file_path     TEXT,
    loc           TEXT,
    lang          TEXT,
    community     INTEGER,
    attrs_json    TEXT NOT NULL DEFAULT '{}',
    UNIQUE (source_id, node_id)
);
CREATE INDEX graph_nodes_file_idx ON graph_nodes (source_id, file_path);
CREATE INDEX graph_nodes_community_idx ON graph_nodes (source_id, community);
CREATE INDEX graph_nodes_label_idx ON graph_nodes (source_id, label);

CREATE TABLE graph_edges (
    pk            INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    src           TEXT NOT NULL,
    dst           TEXT NOT NULL,
    relation      TEXT NOT NULL CHECK (relation <> ''),
    confidence    TEXT NOT NULL DEFAULT 'EXTRACTED' CHECK (confidence IN ('EXTRACTED', 'INFERRED', 'AMBIGUOUS')),
    score         REAL,
    file_path     TEXT,
    loc           TEXT,
    weight        REAL NOT NULL DEFAULT 1.0,
    context       TEXT
);
CREATE INDEX graph_edges_src_idx ON graph_edges (source_id, src, relation);
CREATE INDEX graph_edges_dst_idx ON graph_edges (source_id, dst, relation);
CREATE INDEX graph_edges_file_idx ON graph_edges (source_id, file_path);

CREATE TABLE graph_communities (
    source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    id            INTEGER NOT NULL,
    name          TEXT,
    size          INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (source_id, id)
) WITHOUT ROWID;

CREATE VIRTUAL TABLE graph_nodes_fts USING fts5(
    label,
    file_path,
    content = graph_nodes,
    content_rowid = pk,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER graph_nodes_ai AFTER INSERT ON graph_nodes BEGIN
    INSERT INTO graph_nodes_fts (rowid, label, file_path) VALUES (new.pk, new.label, new.file_path);
END;
CREATE TRIGGER graph_nodes_ad AFTER DELETE ON graph_nodes BEGIN
    INSERT INTO graph_nodes_fts (graph_nodes_fts, rowid, label, file_path)
    VALUES ('delete', old.pk, old.label, old.file_path);
END;
CREATE TRIGGER graph_nodes_au AFTER UPDATE ON graph_nodes BEGIN
    INSERT INTO graph_nodes_fts (graph_nodes_fts, rowid, label, file_path)
    VALUES ('delete', old.pk, old.label, old.file_path);
    INSERT INTO graph_nodes_fts (rowid, label, file_path) VALUES (new.pk, new.label, new.file_path);
END;
