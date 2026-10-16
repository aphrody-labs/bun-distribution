<!-- SPDX-License-Identifier: Apache-2.0 -->
# Training registry (`aphrody-train`, feature `registry`)

Generic registry for any training (embedding, reranker, LoRA/SFT/DPO, ...):
decision D11 of [sql-convergence](../../decisions/infra/sql-convergence.md).
Code: `crates/ai/train/src/registry.rs`; migration:
`crates/ai/train/migrations/0001_registry.sql` (schema `training`, PostgreSQL
18 for `uuidv7()`; the migration refuses older servers). The migration runner
and pool come from [`aphrody-sql`](../../../../crates/aphrody-sql/README.md).

## Configuration

| Variable | Used for |
|---|---|
| `APHRODY_TRAINING_DATABASE_URL` | direct URL: `Registry::migrate_from_env()` (DDL) |
| `APHRODY_TRAINING_DATABASE_URL_POOLED` | runtime writes (falls back to the direct URL) |
| `APHRODY_TRAINING_CODE_COMMIT` | overrides `git rev-parse HEAD` as `runs.code_commit` |
| `APHRODY_TRAINING_DATASET` | dataset name for a job input (default: input file stem) |

Everything is inert without a URL: `run_training_job` behaves exactly as before
and nothing connects. The schema is created only by an explicit
`Registry::migrate_from_env()` run; it is never created implicitly. Runtime
writes use unnamed typed statements, so they work on the Neon `-pooler`
endpoint. Neon Free keeps a 1 GiB branch limit: the registry stores metadata
and digests only, never weights or datasets.

## Tables

| Table | Content |
|---|---|
| `datasets` | named dataset families |
| `dataset_versions` | `parent_id` lineage, `kind`, `source_commit`, `content_sha256` (`^[0-9a-f]{64}$`), `row_count`, `uri`; unique per `(dataset, kind, sha256)` |
| `text_hashes` | NFC-normalised text SHA-256 per row and split (`train`, `validation`, `test`, `gold`) |
| `split_leaks` (view) | train texts that also appear in a held-out split; the gate requires `count(*) = 0` |
| `runs` | `kind`, `status`, `dataset_version_id`, `base_model`, `params jsonb`, `code_commit`, `job_id`, timestamps, `error` |
| `artifacts` | `run_id`, `format`, `uri`, `content_sha256` (unique), `size_bytes` |
| `eval_metrics` | `run_id` and/or `artifact_id`, `metric`, finite `value`, `baseline`, `params jsonb` (k, ANN `ef_search`, iterative scan, ...) |
| `promotions` | `kind`, `alias`, `artifact_id`, evidence (`eval_metric_id`, baseline artifact and metric), `status`; partial `UNIQUE (kind, alias) WHERE status = 'promoted'` |

## Writer API

`Registry::from_env()` returns `None` when no URL is set. Methods:
`upsert_dataset`, `record_dataset_version`, `record_text_hashes`,
`count_leaks`, `start_run`, `finish_run`, `record_artifact`, `record_metric`,
`propose_promotion`, `promote` (atomic: supersedes the live promotion of the
same `(kind, alias)`), `reject_promotion`, `promoted`, `record_verdict`.
Identifiers are UUIDv7 rendered as text.

Hooks, both opt-in and best effort (a registry failure is logged, never fails
training):

* `run_training_job` records the run, the input dataset version (file inputs:
  SHA-256 and line count), artifacts and the final eval metrics through
  `RunRecorder`.
* `PromoteVerdict::record(&registry, kind, alias, artifact_id, decided_by)`
  stores a `recall@5.delta` metric, a proposal and the promotion or rejection.

## Leak gate

```sql
SELECT count(*) FROM training.split_leaks WHERE train_version_id = $1;  -- must be 0
```

Near-duplicate clustering (MinHash) stays in `aphrody-py` and runs before split
assignment.
