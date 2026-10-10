<!-- SPDX-License-Identifier: Apache-2.0 -->
# PostgreSQL 18 operations for AI data workloads (2026-10-01)

Workloads covered: document and chunk ingest, embedding tables, training-run
metadata (datasets, runs, artifacts, evals, promotions), evaluation logs.
Primary sources are linked inline. `UNVERIFIED` marks claims without one.
Local toolchain observed on 2026-10-01: `psql 18.6` (PGDG, Ubuntu 24.04).

## 1. Versions

| Line | Status on 2026-10-01 | Source |
|---|---|---|
| PG 18 | GA 2025-09-25; latest minor **18.6** (2026-08-13; 18.5 was skipped because of a regression; fixes 28 CVEs). Supported until 2030-11-14. | [release notes](https://www.postgresql.org/docs/18/release-18.html), [18.6 news](https://www.postgresql.org/about/news/postgresql-186-1711-1615-1519-1424-and-19-beta-3-released-3365/), [versioning](https://www.postgresql.org/support/versioning/) |
| PG 19 | Beta 4 (2026-09-24); RC planned for early October. SQL/PGQ, online checksums, `FOR PORTION OF` and `MERGE/SPLIT PARTITIONS` were reverted. Do not plan on any PG19 feature before GA. | [beta 4](https://www.postgresql.org/about/news/postgresql-19-beta-4-released-3386/) |
| PG 14 | End of life 2026-11-12 | versioning |

**Checks after upgrading to 18.6** (from the release notes):
- GIN-indexed tables whose `reltuples` is NaN or Infinity: run `ANALYZE`.
- btree_gist indexes on float or bit columns: `REINDEX`.
- btree indexes on long ltree values: `REINDEX`.

## 2. PG 18 features that matter here

- **Asynchronous I/O.** `io_method = worker` (default) or `io_uring`, which
  needs a build `--with-liburing`. `io_workers` defaults to 3 and
  `effective_io_concurrency` now defaults to 16. It speeds up sequential and
  bitmap scans and vacuum, which are typical of corpus re-embedding passes.
  [docs](https://www.postgresql.org/docs/18/runtime-config-resource.html)
- **`uuidv7()`** generates time-ordered keys. Prefer it over
  `gen_random_uuid()` for append-heavy run and chunk tables, because inserts
  stay index-local.
- **Generated columns are VIRTUAL by default.** A virtual column cannot be
  indexed or carry a UNIQUE constraint
  ([indexcmds.c](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/commands/indexcmds.c)),
  so **dedup hash columns must be `STORED`**.
- **B-tree skip scan.** An index on `(kind, created_at)` now also serves
  queries filtered only on `created_at`.
- **`RETURNING OLD.*, NEW.*`** on INSERT, UPDATE, DELETE and MERGE. It tells an
  idempotent upsert whether the row was new, changed or unchanged in one round
  trip.
- **pg_upgrade keeps planner statistics,** so there is no cold-plan period
  after a major upgrade. It also adds `--swap`.
- **Data checksums are on by default in `initdb`.** Clusters created earlier
  without checksums need `--no-data-checksums` on the new cluster to remain
  pg_upgrade-compatible (UNVERIFIED nuance).
- **Authentication.** OAuth is available (`oauth_validator_libraries`). MD5
  passwords are deprecated; move to SCRAM.
- **Vacuum.** `autovacuum_vacuum_max_threshold` (default 100M) caps the
  dead-tuple trigger on huge tables. `autovacuum_worker_slots` lets the worker
  count change at runtime.

## 3. Bulk ingest recipe

Guidance from [Populating a Database](https://www.postgresql.org/docs/18/populate.html)
and [COPY](https://www.postgresql.org/docs/18/sql-copy.html):

1. **Load into staging.** `COPY ... FROM STDIN` into an `UNLOGGED` staging
   table: no WAL, not crash-safe, not replicated.
   - Binary format is fastest.
   - `ON_ERROR ignore` (PG17) and `REJECT_LIMIT n` (PG18) only work with
     text/csv. Choose speed (binary) or tolerance (csv).
2. **Merge into the target.** `INSERT INTO target SELECT ... FROM staging ON
   CONFLICT (content_sha256) DO NOTHING`, or `MERGE ... RETURNING merge_action(), old, new`.
3. **Indexes.** For first loads or rebuilds, create HNSW/GIN/BM25 indexes
   **after** the data is in. Raise `maintenance_work_mem` (default 64MB) and
   `max_parallel_maintenance_workers` for the build session.
4. **WAL.** For the ingest window, raise `max_wal_size` and
   `checkpoint_timeout`, set `wal_compression = lz4` or `zstd` (PG15+), and run
   `SET LOCAL synchronous_commit = off` in ingest sessions only. A crash can
   lose the last few commits but cannot corrupt data.
   [WAL config](https://www.postgresql.org/docs/18/runtime-config-wal.html)
5. **Finish.** `VACUUM (ANALYZE) target;` sets the visibility map and
   statistics so index-only scans and planner estimates are right
   immediately.
6. **Batch size.** Commit every 10k–100k rows per COPY (common practice;
   UNVERIFIED as an official recommendation).

```sql
-- Dedup-by-content table (PG18): STORED hash column, unique, time-ordered key.
CREATE TABLE corpus.chunks (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  doc_id uuid NOT NULL,
  body text NOT NULL,
  content_sha256 bytea GENERATED ALWAYS AS (sha256(convert_to(body, 'UTF8'))) STORED UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Normalise text (NFC, whitespace) before insert; the hash covers bytes, not meaning.

ALTER TABLE corpus.chunks SET (
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.02
);
```

## 4. Partitioning

[DDL partitioning](https://www.postgresql.org/docs/18/ddl-partitioning.html):
- **Choosing the key:**
  - Range by ingest month for logs and eval events.
  - List by corpus or source for multi-tenant chunk stores.
  - Hash by document id only when no natural pruning key exists.
- **Pruning** happens at plan time and at execution time. Every query must
  filter on the partition key, or it scans all partitions.
- **Archiving:** `ALTER TABLE ... DETACH PARTITION ... CONCURRENTLY` (PG14+)
  detaches an old corpus without a blocking lock. Dump it with `pg_dump -t`,
  then drop it.
- **Constraints:** a generated column cannot be part of the partition key.
  Global uniqueness across partitions needs the key in the constraint, so a
  table-wide unique content hash needs `UNIQUE (corpus, content_sha256)`.
- **ANN indexes are per partition.** Partitioning by corpus keeps HNSW graphs
  small and filters exact.
- **Training registry:** at Aphrody scale (thousands of runs) it needs no
  partitioning.

## 5. Autovacuum for append and upsert tables

[vacuum config](https://www.postgresql.org/docs/18/runtime-config-vacuum.html)
- Defaults: insert threshold 1000, insert scale factor 0.2, vacuum scale
  factor 0.2, analyze scale factor 0.1.
- For chunk and embedding tables that grow by millions of rows, lower the
  scale factors per table (example above). Otherwise autovacuum runs rarely
  and the visibility map lags, which hurts index-only scans and HNSW vacuum
  cost.
- Re-embedding a column (`UPDATE ... SET embedding = ...`) rewrites every row
  and doubles the table. Prefer writing to a new
  `embeddings(model_id, chunk_id)` table and swapping, over updating in place.

## 6. Backups

| Tool | Version | Licence | Use |
|---|---|---|---|
| `pg_dump` / `pg_dumpall` | 18.6 | PostgreSQL | Logical backups: `-Fc` single archive, `-Fd -j N` parallel; `--schema-only` for DDL review; `pg_dumpall --globals-only` for roles |
| `pg_basebackup --incremental` + `pg_combinebackup` | PG17+ | PostgreSQL | Physical incremental backups; needs `summarize_wal = on`. [docs](https://www.postgresql.org/docs/18/continuous-archiving.html) |
| pgBackRest | 2.59.2 (2026-09-27) | MIT | Parallel, block-incremental, multi-repo, S3/Azure/GCS, point-in-time recovery. Announced unmaintained 2026-04-27, then "Will Continue!" 2026-05-18 with funding from a coalition including AWS, Supabase and Tiger Data. Watch the funding. [news](https://pgbackrest.org/news.html), [repo](https://github.com/pgbackrest/pgbackrest) |
| Barman | 3.20.1 (2026-09-29) | GPL-3.0 | EDB backup manager. [repo](https://github.com/EnterpriseDB/barman) |
| WAL-G | 3.0.9 (2026-08-20) | Apache-2.0 | WAL archiving to object stores. [repo](https://github.com/wal-g/wal-g) |

Policy for a single-host Aphrody Postgres:
- Nightly `pg_dump -Fc` of the metadata schemas (small, portable across
  majors).
- pgBackRest or `pg_basebackup` incremental for the chunk/vector cluster.
- Restore-test monthly into a scratch cluster.
- Embeddings can be regenerated but expensive. Back them up unless the source
  text and model are pinned and the time to re-embed is acceptable.

## 7. Schema and data comparison

| Tool | Version | Licence | Notes |
|---|---|---|---|
| `pg_dump --schema-only --no-owner --no-privileges` + `diff` | core | PostgreSQL | Zero-dependency baseline; noisy ordering. |
| stripe/pg-schema-diff | 1.0.9 (2026-08-06) | MIT | Generates low-lock online migration plans (for example `CREATE INDEX CONCURRENTLY`) and reports hazards. [repo](https://github.com/stripe/pg-schema-diff) |
| Atlas | 1.3.0 (2026-08-02) | Apache-2.0 Community Edition; default binary under the Atlas licence agreement | Community Edition lacks views, functions, extensions, RLS and partitions, which is a problem for pgvector schemas. [CE limits](https://atlasgo.io/community-edition) |
| migra | final 2022 release, **deprecated** | Unlicense | Successor is `results` (BSD-3-Clause). [repo](https://github.com/djrobstep/migra) |
| pgAdmin 4 Schema Diff | REL-9_18 | PostgreSQL (UNVERIFIED) | GUI. |
| Neon `compare_database_schema` / branch diff | hosted | n/a | Diffs a branch against its parent (Neon MCP/console). |

**Data diff:** use `FULL JOIN ... ON a.content_sha256 = b.content_sha256 WHERE
a.id IS NULL OR b.id IS NULL`, or `EXCEPT`, across two schemas or a
`postgres_fdw` link. The unique content hash makes the diff cheap and exact.

## 8. Neon specifics (training registry)

- **Pooled (`-pooler`) endpoint:** PgBouncer in transaction mode. No
  session-level `SET`, `LISTEN/NOTIFY`, SQL `PREPARE`, temp tables or session
  advisory locks. Protocol-level prepared statements work (up to 1000).
  [pooling](https://neon.com/docs/connect/connection-pooling)
- **Direct endpoint:** use it for migrations, `pg_dump`, index builds and any
  session-scoped `SET`.
- **Branches:** copy-on-write, instant, can have a TTL, and can be reset from
  their parent. `--schema-only` branches have no parent.
  [branching](https://neon.com/docs/introduction/branching)
- **Scale to zero** after 5 minutes idle; resume takes a few hundred
  milliseconds. The first query after idle pays that cost, so set client
  connection timeouts to at least 10 s.
  [scale to zero](https://neon.com/docs/introduction/scale-to-zero)
- **Extensions on PG18:** pgvector 0.8.6 and `lakebase_text` (BM25).
  pg_search was removed on 2026-09-21.

## 9. Self-hosted Supabase (RG stack)

- The compose stack ships `supabase/postgres:17.6.1.136`, i.e. **PG17**, with
  pgvector up to 0.8.2 and no BM25 extension.
  [docker](https://github.com/supabase/supabase/tree/master/docker)
- Supavisor is the pooler. The same transaction-mode caveats apply as on Neon.
- Back it up with the same tools, pointed at the Supabase Postgres container.
  `pg_dumpall --globals-only` captures the Supabase roles (`anon`,
  `authenticated`, `service_role`).
