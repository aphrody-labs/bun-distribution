-- SPDX-License-Identifier: Apache-2.0
--
-- Generic training registry (ADR docs/decisions/infra/sql-convergence.md, D11).
-- Any model, any domain: embeddings, rerankers, LoRA/SFT/DPO, ... Owned by
-- `aphrody-train` (feature `registry`) and applied by the `aphrody-sql` runner
-- over the direct URL (`APHRODY_TRAINING_DATABASE_URL`); tracking table:
-- training.aphrody_migrations. Requires PostgreSQL 18 (`uuidv7()`).

DO $$
BEGIN
    IF current_setting('server_version_num')::int < 180000 THEN
        RAISE EXCEPTION 'the training registry requires PostgreSQL 18 (uuidv7()), found %',
            current_setting('server_version');
    END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS training;

COMMENT ON SCHEMA training IS
    'Generic training registry: dataset lineage, runs, artifacts, evaluation metrics, promotions.';

-- A named dataset family; concrete content lives in dataset_versions.
CREATE TABLE training.datasets (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    name        text NOT NULL UNIQUE CHECK (name <> ''),
    description text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Immutable, content-addressed snapshot of a dataset with lineage.
CREATE TABLE training.dataset_versions (
    id             uuid PRIMARY KEY DEFAULT uuidv7(),
    dataset_id     uuid NOT NULL REFERENCES training.datasets (id) ON DELETE CASCADE,
    parent_id      uuid REFERENCES training.dataset_versions (id) ON DELETE SET NULL,
    -- What the snapshot is: 'full', 'train', 'validation', 'test', 'gold', 'triples', 'sft', ...
    kind           text NOT NULL DEFAULT 'full' CHECK (kind <> ''),
    source_commit  text,
    content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    row_count      bigint CHECK (row_count >= 0),
    uri            text,
    metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (dataset_id, kind, content_sha256)
);
CREATE INDEX dataset_versions_parent_idx ON training.dataset_versions (parent_id);
CREATE INDEX dataset_versions_sha_idx ON training.dataset_versions (content_sha256);

-- Normalised-text SHA-256 (NFC) of every row, for leak and dedup anti-joins.
CREATE TABLE training.text_hashes (
    dataset_version_id uuid NOT NULL REFERENCES training.dataset_versions (id) ON DELETE CASCADE,
    text_sha256        text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
    split              text NOT NULL CHECK (split IN ('train', 'validation', 'test', 'gold')),
    PRIMARY KEY (dataset_version_id, text_sha256, split)
);
CREATE INDEX text_hashes_sha_idx ON training.text_hashes (text_sha256);

-- Leak gate: a text that sits in a training split and in a held-out split.
-- `SELECT count(*) FROM training.split_leaks WHERE train_version_id = $1` must be 0.
CREATE VIEW training.split_leaks AS
SELECT t.text_sha256,
       t.dataset_version_id AS train_version_id,
       h.dataset_version_id AS heldout_version_id,
       h.split              AS heldout_split
FROM training.text_hashes t
JOIN training.text_hashes h
  ON h.text_sha256 = t.text_sha256
 AND h.split IN ('validation', 'test', 'gold')
WHERE t.split = 'train';

CREATE TABLE training.runs (
    id                 uuid PRIMARY KEY DEFAULT uuidv7(),
    -- Workload kind: 'embed', 'rerank', 'lora', 'sft', 'dpo', 'triples', ...
    kind               text NOT NULL CHECK (kind <> ''),
    status             text NOT NULL DEFAULT 'running'
                       CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    dataset_version_id uuid REFERENCES training.dataset_versions (id) ON DELETE SET NULL,
    base_model         text,
    params             jsonb NOT NULL DEFAULT '{}'::jsonb,
    code_commit        text,
    job_id             text,
    started_at         timestamptz NOT NULL DEFAULT now(),
    finished_at        timestamptz,
    error              text,
    CHECK (finished_at IS NULL OR finished_at >= started_at),
    CHECK (status <> 'failed' OR error IS NOT NULL)
);
CREATE INDEX runs_kind_started_idx ON training.runs (kind, started_at DESC);
CREATE INDEX runs_dataset_version_idx ON training.runs (dataset_version_id);
CREATE INDEX runs_job_id_idx ON training.runs (job_id) WHERE job_id IS NOT NULL;

CREATE TABLE training.artifacts (
    id             uuid PRIMARY KEY DEFAULT uuidv7(),
    run_id         uuid NOT NULL REFERENCES training.runs (id) ON DELETE CASCADE,
    -- 'safetensors', 'onnx', 'gguf', 'lora-adapter', 'jsonl', ...
    format         text NOT NULL CHECK (format <> ''),
    uri            text NOT NULL CHECK (uri <> ''),
    content_sha256 text NOT NULL UNIQUE CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    size_bytes     bigint NOT NULL CHECK (size_bytes >= 0),
    metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artifacts_run_idx ON training.artifacts (run_id);

-- One measurement of a run or an artifact on an evaluation set.
-- `params` stores the evaluation settings (k, ANN ef_search, iterative scan, ...).
CREATE TABLE training.eval_metrics (
    id                 uuid PRIMARY KEY DEFAULT uuidv7(),
    run_id             uuid REFERENCES training.runs (id) ON DELETE CASCADE,
    artifact_id        uuid REFERENCES training.artifacts (id) ON DELETE CASCADE,
    eval_dataset_version_id uuid REFERENCES training.dataset_versions (id) ON DELETE SET NULL,
    metric             text NOT NULL CHECK (metric <> ''),
    value              double precision NOT NULL
                       CHECK (value > '-Infinity'::float8 AND value < 'Infinity'::float8),
    baseline           double precision
                       CHECK (baseline IS NULL OR (baseline > '-Infinity'::float8 AND baseline < 'Infinity'::float8)),
    params             jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_at        timestamptz NOT NULL DEFAULT now(),
    CHECK (run_id IS NOT NULL OR artifact_id IS NOT NULL)
);
CREATE INDEX eval_metrics_run_idx ON training.eval_metrics (run_id, metric);
CREATE INDEX eval_metrics_artifact_idx ON training.eval_metrics (artifact_id, metric);

-- A candidate artifact proposed for an alias of a model kind; one live
-- promotion per (kind, alias).
CREATE TABLE training.promotions (
    id                 uuid PRIMARY KEY DEFAULT uuidv7(),
    kind               text NOT NULL CHECK (kind <> ''),
    alias              text NOT NULL CHECK (alias <> ''),
    artifact_id        uuid NOT NULL REFERENCES training.artifacts (id),
    -- Evidence: the candidate measurement and the baseline it was compared to.
    eval_metric_id     uuid REFERENCES training.eval_metrics (id) ON DELETE SET NULL,
    baseline_artifact_id uuid REFERENCES training.artifacts (id) ON DELETE SET NULL,
    baseline_metric_id uuid REFERENCES training.eval_metrics (id) ON DELETE SET NULL,
    status             text NOT NULL DEFAULT 'proposed'
                       CHECK (status IN ('proposed', 'promoted', 'rejected', 'superseded')),
    reason             text,
    decided_by         text,
    proposed_at        timestamptz NOT NULL DEFAULT now(),
    decided_at         timestamptz,
    CHECK (status = 'proposed' OR decided_at IS NOT NULL)
);
CREATE UNIQUE INDEX promotions_one_live_idx
    ON training.promotions (kind, alias) WHERE status = 'promoted';
CREATE INDEX promotions_artifact_idx ON training.promotions (artifact_id);
CREATE INDEX promotions_kind_alias_idx ON training.promotions (kind, alias, proposed_at DESC);
