-- SPDX-License-Identifier: Apache-2.0
-- Apply with search_path set to a private, owner-selected schema.
CREATE TABLE IF NOT EXISTS aphrody_rag_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    corpus text NOT NULL,
    entity_id text NOT NULL,
    title text NOT NULL,
    url text,
    content text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (corpus, entity_id)
);
CREATE INDEX IF NOT EXISTS aphrody_rag_source_generation
    ON aphrody_rag_documents (corpus, (metadata->>'originSourceId'), (metadata->>'syncGeneration'));
CREATE INDEX IF NOT EXISTS aphrody_rag_editorial_fts
    ON aphrody_rag_documents USING gin (to_tsvector('simple', title || ' ' || content));
CREATE TABLE IF NOT EXISTS aphrody_shenron_vectors (
    document_id uuid PRIMARY KEY REFERENCES aphrody_rag_documents(id) ON DELETE CASCADE,
    model text NOT NULL CHECK (model = 'Xenova/multilingual-e5-small'),
    embedding vector(384) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aphrody_shenron_vectors_cosine
    ON aphrody_shenron_vectors USING hnsw (embedding vector_cosine_ops);
-- Invalidate retrieval on every metadata/vector mutation, including retirement.
CREATE TABLE IF NOT EXISTS aphrody_rag_cache_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    epoch uuid NOT NULL DEFAULT gen_random_uuid(),
    revision bigint NOT NULL DEFAULT 0
);
ALTER TABLE aphrody_rag_cache_state ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;
INSERT INTO aphrody_rag_cache_state (singleton) VALUES (true) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION aphrody_rag_bump_cache_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- Transactional: a revision is never visible before its document commit.
    UPDATE aphrody_rag_cache_state SET revision = revision + 1 WHERE singleton;
    RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER aphrody_rag_document_cache_revision
    AFTER INSERT OR UPDATE OR DELETE ON aphrody_rag_documents
    FOR EACH STATEMENT EXECUTE FUNCTION aphrody_rag_bump_cache_revision();
CREATE OR REPLACE TRIGGER aphrody_rag_vector_cache_revision
    AFTER INSERT OR UPDATE OR DELETE ON aphrody_shenron_vectors
    FOR EACH STATEMENT EXECUTE FUNCTION aphrody_rag_bump_cache_revision();
