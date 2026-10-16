-- SPDX-License-Identifier: Apache-2.0
-- Shared Aphrody product metadata only. Dedicated database allocation required.
-- No credentials, raw sessions, cookies, document bodies, datasets or model weights.
CREATE SCHEMA IF NOT EXISTS aphrody_product;
REVOKE ALL ON SCHEMA aphrody_product FROM PUBLIC;

CREATE TABLE IF NOT EXISTS aphrody_product.scopes (
    profile TEXT PRIMARY KEY CHECK (profile IN ('aphrody', 'dbfr', 'ie')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aphrody_product.identity_refs (
    profile TEXT NOT NULL REFERENCES aphrody_product.scopes(profile),
    identity_id TEXT NOT NULL CHECK (identity_id <> ''),
    auth_subject_ref TEXT NOT NULL CHECK (auth_subject_ref <> ''),
    PRIMARY KEY (profile, identity_id),
    UNIQUE (profile, auth_subject_ref)
);

CREATE TABLE IF NOT EXISTS aphrody_product.catalog (
    profile TEXT NOT NULL REFERENCES aphrody_product.scopes(profile),
    entity_id TEXT NOT NULL CHECK (entity_id <> ''),
    kind TEXT NOT NULL CHECK (kind IN ('tool', 'cli', 'mcp', 'dataset', 'model', 'repository', 'document')),
    owner TEXT NOT NULL CHECK (owner <> ''),
    label TEXT NOT NULL CHECK (label <> ''),
    source_ref TEXT NOT NULL CHECK (source_ref <> ''),
    content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (profile, entity_id)
);
CREATE INDEX IF NOT EXISTS catalog_kind_idx ON aphrody_product.catalog(profile, kind);

CREATE TABLE IF NOT EXISTS aphrody_product.rag_refs (
    profile TEXT NOT NULL,
    document_id TEXT NOT NULL,
    chunk_id TEXT NOT NULL CHECK (chunk_id <> ''),
    source_ref TEXT NOT NULL CHECK (source_ref <> ''),
    content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    PRIMARY KEY (profile, document_id, chunk_id),
    FOREIGN KEY (profile, document_id) REFERENCES aphrody_product.catalog(profile, entity_id)
);

CREATE TABLE IF NOT EXISTS aphrody_product.graph_nodes (
    profile TEXT NOT NULL,
    repository_id TEXT NOT NULL,
    node_id TEXT NOT NULL CHECK (node_id <> ''),
    symbol TEXT NOT NULL CHECK (symbol <> ''),
    relative_path TEXT NOT NULL CHECK (relative_path <> '' AND relative_path !~ ':' AND relative_path !~ '^[/\\]' AND relative_path !~ '(^|[/\\])\.\.([/\\]|$)'),
    kind TEXT NOT NULL CHECK (kind <> ''),
    PRIMARY KEY (profile, repository_id, node_id),
    FOREIGN KEY (profile, repository_id) REFERENCES aphrody_product.catalog(profile, entity_id)
);
CREATE TABLE IF NOT EXISTS aphrody_product.graph_edges (
    profile TEXT NOT NULL,
    repository_id TEXT NOT NULL,
    src TEXT NOT NULL,
    dst TEXT NOT NULL,
    relation TEXT NOT NULL CHECK (relation <> ''),
    confidence TEXT NOT NULL CHECK (confidence IN ('EXTRACTED', 'INFERRED', 'AMBIGUOUS')),
    PRIMARY KEY (profile, repository_id, src, dst, relation),
    FOREIGN KEY (profile, repository_id, src) REFERENCES aphrody_product.graph_nodes(profile, repository_id, node_id),
    FOREIGN KEY (profile, repository_id, dst) REFERENCES aphrody_product.graph_nodes(profile, repository_id, node_id)
);
CREATE INDEX IF NOT EXISTS graph_edges_dst_idx ON aphrody_product.graph_edges(profile, repository_id, dst);

CREATE TABLE IF NOT EXISTS aphrody_product.training_refs (
    profile TEXT NOT NULL,
    run_id TEXT NOT NULL CHECK (run_id <> ''),
    dataset_id TEXT NOT NULL,
    model_ref TEXT NOT NULL CHECK (model_ref <> ''),
    source_commit TEXT NOT NULL CHECK (source_commit ~ '^[0-9a-f]{40,64}$'),
    state TEXT NOT NULL CHECK (state IN ('planned', 'running', 'succeeded', 'failed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (profile, run_id),
    FOREIGN KEY (profile, dataset_id) REFERENCES aphrody_product.catalog(profile, entity_id)
);

-- Durable transaction outbox. Payload is a reference/version, never source data.
CREATE TABLE IF NOT EXISTS aphrody_product.outbox (
    event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    profile TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    entity_version BIGINT NOT NULL CHECK (entity_version > 0),
    topic TEXT NOT NULL CHECK (topic IN ('catalog.changed', 'rag.changed', 'graph.changed', 'training.changed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    FOREIGN KEY (profile, entity_id) REFERENCES aphrody_product.catalog(profile, entity_id),
    UNIQUE (profile, entity_id, entity_version, topic)
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON aphrody_product.outbox(event_id) WHERE published_at IS NULL;

REVOKE ALL ON ALL TABLES IN SCHEMA aphrody_product FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA aphrody_product FROM PUBLIC;
