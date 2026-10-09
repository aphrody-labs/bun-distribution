// SPDX-License-Identifier: Apache-2.0
//! Generic training registry writer (ADR D11, feature `registry`).
//!
//! Schema `training` (migration `migrations/0001_registry.sql`): datasets with
//! lineage and `content_sha256`, runs with `code_commit`, artifacts, generic
//! evaluation metrics, promotions with one live promotion per `(kind, alias)`,
//! and normalised-text hashes for leak anti-joins. Works for any model and any
//! domain: `kind` and `format` are free-form labels.
//!
//! * Runtime writes go through the process pool on
//!   `APHRODY_TRAINING_DATABASE_URL_POOLED` (falling back to the direct URL) and
//!   only use unnamed typed statements (`query_typed` / `execute_typed`), so
//!   they are safe behind a transaction pooler such as the Neon `-pooler`
//!   endpoint.
//! * Migrations use the **direct** URL `APHRODY_TRAINING_DATABASE_URL`
//!   ([`Registry::migrate_from_env`]); the schema is never created implicitly.
//! * Everything is inert when no URL is configured: [`Registry::from_env`]
//!   returns `None` and [`RunRecorder`] records nothing.
//!
//! Identifiers are UUIDv7 rendered as text (`id::text`).

use aphrody_proc::NoWindow as _;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use aphrody_sql::{
    DatabaseEnv, DatabaseUrl, MigrateOptions, MigrationReport, MigrationSet, PgPool, SqlError,
    migrate_postgres,
    pg::tokio_postgres::{
        self,
        types::{ToSql, Type},
    },
};
use serde_json::{Value, json};

use crate::{
    job::TrainingJob,
    promote::PromoteVerdict,
    runner::{JobOutcome, TrainError},
};

/// Environment prefix: `APHRODY_TRAINING_DATABASE_URL[_POOLED]`.
pub const ENV_PREFIX: &str = "APHRODY_TRAINING";

/// Schema holding the registry (and its migration tracking table).
pub const SCHEMA: &str = "training";

/// Upper bound for a single registry call made on behalf of a training job.
const CALL_TIMEOUT: Duration = Duration::from_secs(15);

/// Hashes sent to PostgreSQL per statement.
const HASH_CHUNK: usize = 10_000;

/// Errors of the registry writer.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum RegistryError {
    /// Pool, URL or migration failure.
    #[error(transparent)]
    Sql(#[from] SqlError),
    /// PostgreSQL protocol or constraint error.
    #[error("registry query failed: {0}")]
    Postgres(#[from] tokio_postgres::Error),
    /// JSON encoding failure.
    #[error("registry JSON error: {0}")]
    Json(#[from] serde_json::Error),
    /// A caller-supplied value is invalid (digest, metric, size).
    #[error("invalid registry input: {0}")]
    Invalid(String),
    /// The referenced promotion does not exist.
    #[error("promotion `{0}` not found")]
    NotFound(String),
    /// The promotion is not in the `proposed` state.
    #[error("promotion `{0}` is not in the `proposed` state")]
    Conflict(String),
    /// A registry call exceeded its timeout.
    #[error("registry call timed out")]
    Timeout,
}

/// Result alias of this module.
pub type Result<T, E = RegistryError> = std::result::Result<T, E>;

/// The embedded migrations of the registry.
///
/// # Panics
///
/// Never in practice: the embedded file name is validated by a unit test.
#[must_use]
pub fn migrations() -> MigrationSet {
    MigrationSet::from_files(&[(
        "0001_registry.sql",
        include_str!("../migrations/0001_registry.sql"),
    )])
    .expect("embedded registry migration names are valid")
}

/// Held-out/training split label of a text hash.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Split {
    /// Training rows.
    Train,
    /// Validation rows.
    Validation,
    /// Test rows.
    Test,
    /// Gold evaluation rows.
    Gold,
}

impl Split {
    /// SQL label.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Train => "train",
            Self::Validation => "validation",
            Self::Test => "test",
            Self::Gold => "gold",
        }
    }
}

/// A dataset snapshot to register.
#[derive(Debug, Clone)]
pub struct NewDatasetVersion {
    /// Parent dataset (from [`Registry::upsert_dataset`]).
    pub dataset_id: String,
    /// Version this one was derived from.
    pub parent_id: Option<String>,
    /// `full`, `train`, `validation`, `test`, `gold`, `triples`, ...
    pub kind: String,
    /// Commit of the code/data repository the snapshot was built from.
    pub source_commit: Option<String>,
    /// Lower-case hex SHA-256 of the snapshot content.
    pub content_sha256: String,
    /// Number of rows.
    pub row_count: Option<i64>,
    /// Where the snapshot lives.
    pub uri: Option<String>,
    /// Free-form metadata.
    pub metadata: Value,
}

/// A run to register when it starts.
#[derive(Debug, Clone, Default)]
pub struct NewRun {
    /// Workload kind (`embed`, `rerank`, `lora`, ...).
    pub kind: String,
    /// Training dataset snapshot.
    pub dataset_version_id: Option<String>,
    /// Base model reference.
    pub base_model: Option<String>,
    /// Hyper-parameters and settings.
    pub params: Value,
    /// Commit of the training code.
    pub code_commit: Option<String>,
    /// External job identifier.
    pub job_id: Option<String>,
}

/// How a run ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunOutcome {
    /// Completed successfully.
    Succeeded,
    /// Failed with a message.
    Failed(String),
    /// Cancelled before completion.
    Cancelled,
}

/// An artifact produced by a run.
#[derive(Debug, Clone)]
pub struct NewArtifact {
    /// Producing run.
    pub run_id: String,
    /// `safetensors`, `onnx`, `gguf`, `lora-adapter`, ...
    pub format: String,
    /// Location (URI or path).
    pub uri: String,
    /// Lower-case hex SHA-256 of the file.
    pub content_sha256: String,
    /// Size in bytes.
    pub size_bytes: u64,
    /// Free-form metadata.
    pub metadata: Value,
}

/// One evaluation measurement.
#[derive(Debug, Clone, Default)]
pub struct NewMetric {
    /// Measured run (at least one of `run_id` / `artifact_id` is required).
    pub run_id: Option<String>,
    /// Measured artifact.
    pub artifact_id: Option<String>,
    /// Evaluation set.
    pub eval_dataset_version_id: Option<String>,
    /// Metric name, e.g. `recall@5`, `ndcg@10`.
    pub metric: String,
    /// Finite value.
    pub value: f64,
    /// Baseline value on the same set, if any.
    pub baseline: Option<f64>,
    /// Evaluation settings (k, ANN `ef_search`, iterative scan, ...).
    pub params: Value,
}

/// A promotion proposal.
#[derive(Debug, Clone, Default)]
pub struct NewPromotion {
    /// Model kind.
    pub kind: String,
    /// Alias being claimed (`production`, `staging`, ...).
    pub alias: String,
    /// Candidate artifact.
    pub artifact_id: String,
    /// Candidate measurement.
    pub eval_metric_id: Option<String>,
    /// Artifact it is compared to.
    pub baseline_artifact_id: Option<String>,
    /// Baseline measurement.
    pub baseline_metric_id: Option<String>,
    /// Why.
    pub reason: Option<String>,
}

/// The artifact currently serving a `(kind, alias)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromotedArtifact {
    /// Promotion id.
    pub promotion_id: String,
    /// Artifact id.
    pub artifact_id: String,
    /// Artifact location.
    pub uri: String,
    /// Artifact digest.
    pub content_sha256: String,
}

fn validate_sha256(label: &str, value: &str) -> Result<()> {
    if value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Ok(())
    } else {
        Err(RegistryError::Invalid(format!("{label} must be 64 lower-case hex digits")))
    }
}

fn validate_label(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        Err(RegistryError::Invalid(format!("{label} must not be empty")))
    } else {
        Ok(())
    }
}

/// Writer over the `training` schema.
#[derive(Debug, Clone)]
pub struct Registry {
    pool: PgPool,
}

type Params<'a> = &'a [(&'a (dyn ToSql + Sync), Type)];

impl Registry {
    /// Wrap an existing pool.
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// The registry configured through `APHRODY_TRAINING_DATABASE_URL_POOLED`
    /// (or `APHRODY_TRAINING_DATABASE_URL`); `None` when neither is set. Opens
    /// no connection.
    ///
    /// # Errors
    ///
    /// [`RegistryError::Sql`] when the URL is invalid.
    pub fn from_env() -> Result<Option<Self>> {
        let Some(resolved) = DatabaseEnv::new(ENV_PREFIX).runtime() else {
            return Ok(None);
        };
        let pool =
            PgPool::builder(resolved.url).application_name("aphrody-train").max_size(4).build()?;
        Ok(Some(Self::new(pool)))
    }

    /// Apply the registry migrations over the **direct** URL
    /// (`APHRODY_TRAINING_DATABASE_URL`, pooled URL as a last resort).
    /// `Ok(None)` when no URL is configured.
    ///
    /// # Errors
    ///
    /// Migration, checksum or connection errors.
    pub async fn migrate_from_env() -> Result<Option<MigrationReport>> {
        let Some(resolved) = DatabaseEnv::new(ENV_PREFIX).migration() else {
            return Ok(None);
        };
        Self::migrate(&resolved.url).await.map(Some)
    }

    /// Apply the registry migrations to the database at `url`.
    ///
    /// # Errors
    ///
    /// Migration, checksum or connection errors.
    pub async fn migrate(url: &DatabaseUrl) -> Result<MigrationReport> {
        let pool = PgPool::builder(url.clone())
            .application_name("aphrody-train-migrate")
            .max_size(1)
            .build()?;
        let mut client = pool.get().await?;
        let report =
            migrate_postgres(&mut client, &migrations(), &MigrateOptions::in_schema(SCHEMA))
                .await?;
        Ok(report)
    }

    async fn query(&self, sql: &str, params: Params<'_>) -> Result<Vec<tokio_postgres::Row>> {
        let client = self.pool.get().await.map_err(SqlError::from)?;
        Ok(client.query_typed(sql, params).await?)
    }

    async fn query_id(&self, sql: &str, params: Params<'_>) -> Result<String> {
        let rows = self.query(sql, params).await?;
        let row = rows
            .first()
            .ok_or_else(|| RegistryError::Invalid("statement returned no row".into()))?;
        Ok(row.try_get::<_, String>(0)?)
    }

    async fn execute(&self, sql: &str, params: Params<'_>) -> Result<u64> {
        let client = self.pool.get().await.map_err(SqlError::from)?;
        Ok(client.execute_typed(sql, params).await?)
    }

    /// Create or fetch a dataset family by name.
    ///
    /// # Errors
    ///
    /// Invalid name or database errors.
    pub async fn upsert_dataset(&self, name: &str, description: Option<&str>) -> Result<String> {
        validate_label("dataset name", name)?;
        self.query_id(
            "INSERT INTO training.datasets (name, description) VALUES ($1, $2) \
             ON CONFLICT (name) DO UPDATE SET \
             description = COALESCE(EXCLUDED.description, training.datasets.description) \
             RETURNING id::text",
            &[(&name, Type::TEXT), (&description, Type::TEXT)],
        )
        .await
    }

    /// Register a dataset snapshot; idempotent per `(dataset, kind, sha256)`
    /// (returns the existing id).
    ///
    /// # Errors
    ///
    /// Invalid digest or database errors.
    pub async fn record_dataset_version(&self, version: &NewDatasetVersion) -> Result<String> {
        validate_sha256("content_sha256", &version.content_sha256)?;
        validate_label("kind", &version.kind)?;
        self.query_id(
            "INSERT INTO training.dataset_versions \
             (dataset_id, parent_id, kind, source_commit, content_sha256, row_count, uri, metadata) \
             VALUES ($1::text::uuid, $2::text::uuid, $3, $4, $5, $6, $7, $8) \
             ON CONFLICT (dataset_id, kind, content_sha256) DO UPDATE SET \
             row_count = COALESCE(EXCLUDED.row_count, training.dataset_versions.row_count), \
             uri = COALESCE(EXCLUDED.uri, training.dataset_versions.uri), \
             source_commit = COALESCE(training.dataset_versions.source_commit, EXCLUDED.source_commit) \
             RETURNING id::text",
            &[
                (&version.dataset_id, Type::TEXT),
                (&version.parent_id, Type::TEXT),
                (&version.kind, Type::TEXT),
                (&version.source_commit, Type::TEXT),
                (&version.content_sha256, Type::TEXT),
                (&version.row_count, Type::INT8),
                (&version.uri, Type::TEXT),
                (&version.metadata, Type::JSONB),
            ],
        )
        .await
    }

    /// Store normalised-text SHA-256 hashes of a snapshot for leak gates.
    /// Returns the number of new rows.
    ///
    /// # Errors
    ///
    /// Invalid digest or database errors.
    pub async fn record_text_hashes(
        &self,
        dataset_version_id: &str,
        split: Split,
        hashes: &[String],
    ) -> Result<u64> {
        for hash in hashes {
            validate_sha256("text_sha256", hash)?;
        }
        let split = split.as_str();
        let mut inserted = 0;
        for chunk in hashes.chunks(HASH_CHUNK) {
            let chunk = chunk.to_vec();
            inserted += self
                .execute(
                    "INSERT INTO training.text_hashes (dataset_version_id, text_sha256, split) \
                     SELECT $1::text::uuid, h, $3 FROM unnest($2::text[]) AS h \
                     ON CONFLICT DO NOTHING",
                    &[
                        (&dataset_version_id, Type::TEXT),
                        (&chunk, Type::TEXT_ARRAY),
                        (&split, Type::TEXT),
                    ],
                )
                .await?;
        }
        Ok(inserted)
    }

    /// Number of training texts of `train_version_id` that also appear in a
    /// validation, test or gold split. The leak gate requires `0`.
    ///
    /// # Errors
    ///
    /// Database errors.
    pub async fn count_leaks(&self, train_version_id: &str) -> Result<i64> {
        let rows = self
            .query(
                "SELECT count(*) FROM training.split_leaks WHERE train_version_id = $1::text::uuid",
                &[(&train_version_id, Type::TEXT)],
            )
            .await?;
        Ok(rows.first().map_or(Ok(0), |row| row.try_get::<_, i64>(0))?)
    }

    /// Register a run (status `running`).
    ///
    /// # Errors
    ///
    /// Database errors.
    pub async fn start_run(&self, run: &NewRun) -> Result<String> {
        validate_label("run kind", &run.kind)?;
        let params = if run.params.is_null() { json!({}) } else { run.params.clone() };
        self.query_id(
            "INSERT INTO training.runs \
             (kind, dataset_version_id, base_model, params, code_commit, job_id) \
             VALUES ($1, $2::text::uuid, $3, $4, $5, $6) RETURNING id::text",
            &[
                (&run.kind, Type::TEXT),
                (&run.dataset_version_id, Type::TEXT),
                (&run.base_model, Type::TEXT),
                (&params, Type::JSONB),
                (&run.code_commit, Type::TEXT),
                (&run.job_id, Type::TEXT),
            ],
        )
        .await
    }

    /// Close a run. Returns `false` when the run was already finished.
    ///
    /// # Errors
    ///
    /// Database errors.
    pub async fn finish_run(&self, run_id: &str, outcome: &RunOutcome) -> Result<bool> {
        let (status, error) = match outcome {
            RunOutcome::Succeeded => ("succeeded", None),
            RunOutcome::Failed(message) => ("failed", Some(message.as_str())),
            RunOutcome::Cancelled => ("cancelled", None),
        };
        let error = error.map(|message| message.chars().take(4000).collect::<String>());
        let updated = self
            .execute(
                "UPDATE training.runs SET status = $2, finished_at = now(), error = $3 \
                 WHERE id = $1::text::uuid AND status IN ('queued', 'running')",
                &[(&run_id, Type::TEXT), (&status, Type::TEXT), (&error, Type::TEXT)],
            )
            .await?;
        Ok(updated == 1)
    }

    /// Register an artifact; idempotent per `content_sha256` (returns the
    /// existing id, whatever run first produced it).
    ///
    /// # Errors
    ///
    /// Invalid digest or size, or database errors.
    pub async fn record_artifact(&self, artifact: &NewArtifact) -> Result<String> {
        validate_sha256("content_sha256", &artifact.content_sha256)?;
        validate_label("format", &artifact.format)?;
        validate_label("uri", &artifact.uri)?;
        let size = i64::try_from(artifact.size_bytes)
            .map_err(|_| RegistryError::Invalid("size_bytes exceeds i64".into()))?;
        let metadata =
            if artifact.metadata.is_null() { json!({}) } else { artifact.metadata.clone() };
        self.query_id(
            "INSERT INTO training.artifacts (run_id, format, uri, content_sha256, size_bytes, metadata) \
             VALUES ($1::text::uuid, $2, $3, $4, $5, $6) \
             ON CONFLICT (content_sha256) DO UPDATE SET uri = training.artifacts.uri \
             RETURNING id::text",
            &[
                (&artifact.run_id, Type::TEXT),
                (&artifact.format, Type::TEXT),
                (&artifact.uri, Type::TEXT),
                (&artifact.content_sha256, Type::TEXT),
                (&size, Type::INT8),
                (&metadata, Type::JSONB),
            ],
        )
        .await
    }

    /// Record one evaluation measurement.
    ///
    /// # Errors
    ///
    /// Non-finite values, a metric without run or artifact, or database errors.
    pub async fn record_metric(&self, metric: &NewMetric) -> Result<String> {
        validate_label("metric", &metric.metric)?;
        if !metric.value.is_finite() || metric.baseline.is_some_and(|b| !b.is_finite()) {
            return Err(RegistryError::Invalid("metric values must be finite".into()));
        }
        if metric.run_id.is_none() && metric.artifact_id.is_none() {
            return Err(RegistryError::Invalid("a metric needs a run_id or an artifact_id".into()));
        }
        let params = if metric.params.is_null() { json!({}) } else { metric.params.clone() };
        self.query_id(
            "INSERT INTO training.eval_metrics \
             (run_id, artifact_id, eval_dataset_version_id, metric, value, baseline, params) \
             VALUES ($1::text::uuid, $2::text::uuid, $3::text::uuid, $4, $5, $6, $7) \
             RETURNING id::text",
            &[
                (&metric.run_id, Type::TEXT),
                (&metric.artifact_id, Type::TEXT),
                (&metric.eval_dataset_version_id, Type::TEXT),
                (&metric.metric, Type::TEXT),
                (&metric.value, Type::FLOAT8),
                (&metric.baseline, Type::FLOAT8),
                (&params, Type::JSONB),
            ],
        )
        .await
    }

    /// Propose `artifact_id` for `(kind, alias)`; nothing is live yet.
    ///
    /// # Errors
    ///
    /// Database errors.
    pub async fn propose_promotion(&self, promotion: &NewPromotion) -> Result<String> {
        validate_label("kind", &promotion.kind)?;
        validate_label("alias", &promotion.alias)?;
        self.query_id(
            "INSERT INTO training.promotions \
             (kind, alias, artifact_id, eval_metric_id, baseline_artifact_id, baseline_metric_id, reason) \
             VALUES ($1, $2, $3::text::uuid, $4::text::uuid, $5::text::uuid, $6::text::uuid, $7) \
             RETURNING id::text",
            &[
                (&promotion.kind, Type::TEXT),
                (&promotion.alias, Type::TEXT),
                (&promotion.artifact_id, Type::TEXT),
                (&promotion.eval_metric_id, Type::TEXT),
                (&promotion.baseline_artifact_id, Type::TEXT),
                (&promotion.baseline_metric_id, Type::TEXT),
                (&promotion.reason, Type::TEXT),
            ],
        )
        .await
    }

    /// Make a proposed promotion live and supersede the previous live one of
    /// the same `(kind, alias)`, atomically.
    ///
    /// # Errors
    ///
    /// [`RegistryError::NotFound`], [`RegistryError::Conflict`] when it is not
    /// `proposed`, or database errors.
    pub async fn promote(&self, promotion_id: &str, decided_by: &str) -> Result<()> {
        let mut client = self.pool.get().await.map_err(SqlError::from)?;
        let found = client
            .query_typed(
                "SELECT kind, alias, status FROM training.promotions WHERE id = $1::text::uuid",
                &[(&promotion_id, Type::TEXT)],
            )
            .await?;
        let row = found.first().ok_or_else(|| RegistryError::NotFound(promotion_id.to_owned()))?;
        let kind: String = row.try_get(0)?;
        let alias: String = row.try_get(1)?;
        let status: String = row.try_get(2)?;
        if status != "proposed" {
            return Err(RegistryError::Conflict(promotion_id.to_owned()));
        }

        let tx = client.transaction().await?;
        tx.query_typed(
            "SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))",
            &[(&kind, Type::TEXT), (&alias, Type::TEXT)],
        )
        .await?;
        tx.execute_typed(
            "UPDATE training.promotions SET status = 'superseded', decided_at = now() \
             WHERE kind = $1 AND alias = $2 AND status = 'promoted'",
            &[(&kind, Type::TEXT), (&alias, Type::TEXT)],
        )
        .await?;
        let promoted = tx
            .execute_typed(
                "UPDATE training.promotions SET status = 'promoted', decided_by = $2, decided_at = now() \
                 WHERE id = $1::text::uuid AND status = 'proposed'",
                &[(&promotion_id, Type::TEXT), (&decided_by, Type::TEXT)],
            )
            .await?;
        if promoted != 1 {
            return Err(RegistryError::Conflict(promotion_id.to_owned()));
        }
        tx.commit().await?;
        Ok(())
    }

    /// Reject a proposed promotion.
    ///
    /// # Errors
    ///
    /// [`RegistryError::Conflict`] when it is not `proposed`, or database errors.
    pub async fn reject_promotion(
        &self,
        promotion_id: &str,
        decided_by: &str,
        reason: &str,
    ) -> Result<()> {
        let updated = self
            .execute(
                "UPDATE training.promotions SET status = 'rejected', decided_by = $2, \
                 reason = COALESCE($3, reason), decided_at = now() \
                 WHERE id = $1::text::uuid AND status = 'proposed'",
                &[(&promotion_id, Type::TEXT), (&decided_by, Type::TEXT), (&reason, Type::TEXT)],
            )
            .await?;
        if updated == 1 { Ok(()) } else { Err(RegistryError::Conflict(promotion_id.to_owned())) }
    }

    /// The artifact currently promoted for `(kind, alias)`.
    ///
    /// # Errors
    ///
    /// Database errors.
    pub async fn promoted(&self, kind: &str, alias: &str) -> Result<Option<PromotedArtifact>> {
        let rows = self
            .query(
                "SELECT p.id::text, a.id::text, a.uri, a.content_sha256 \
                 FROM training.promotions p JOIN training.artifacts a ON a.id = p.artifact_id \
                 WHERE p.kind = $1 AND p.alias = $2 AND p.status = 'promoted'",
                &[(&kind, Type::TEXT), (&alias, Type::TEXT)],
            )
            .await?;
        rows.first()
            .map(|row| {
                Ok(PromotedArtifact {
                    promotion_id: row.try_get(0)?,
                    artifact_id: row.try_get(1)?,
                    uri: row.try_get(2)?,
                    content_sha256: row.try_get(3)?,
                })
            })
            .transpose()
    }

    /// Record a [`PromoteVerdict`]: a `recall@5.delta` metric on the candidate,
    /// a proposal, and either the promotion or the rejection. Returns the
    /// promotion id.
    ///
    /// # Errors
    ///
    /// Database errors, or [`RegistryError::Conflict`] if the new proposal
    /// cannot be decided.
    pub async fn record_verdict(
        &self,
        kind: &str,
        alias: &str,
        artifact_id: &str,
        baseline_artifact_id: Option<&str>,
        verdict: &PromoteVerdict,
        decided_by: &str,
    ) -> Result<String> {
        let (delta, reason) = match verdict {
            PromoteVerdict::Promoted { delta_recall_at_5, .. } => (*delta_recall_at_5, None),
            PromoteVerdict::Rejected { delta_recall_at_5, reason, .. } => {
                (*delta_recall_at_5, Some(reason.clone()))
            },
        };
        let metric_id = self
            .record_metric(&NewMetric {
                artifact_id: Some(artifact_id.to_owned()),
                metric: "recall@5.delta".to_owned(),
                value: delta,
                baseline: Some(0.0),
                params: json!({"source": "promote", "kind": kind, "alias": alias}),
                ..NewMetric::default()
            })
            .await?;
        let promotion_id = self
            .propose_promotion(&NewPromotion {
                kind: kind.to_owned(),
                alias: alias.to_owned(),
                artifact_id: artifact_id.to_owned(),
                eval_metric_id: Some(metric_id),
                baseline_artifact_id: baseline_artifact_id.map(str::to_owned),
                baseline_metric_id: None,
                reason: reason.clone(),
            })
            .await?;
        match reason {
            None => self.promote(&promotion_id, decided_by).await?,
            Some(reason) => self.reject_promotion(&promotion_id, decided_by, &reason).await?,
        }
        Ok(promotion_id)
    }
}

// ---------------------------------------------------------------------------
// Runner hook
// ---------------------------------------------------------------------------

/// Records one training job in the registry. Best effort: every failure is
/// logged and swallowed, training never fails because of the registry.
#[derive(Debug)]
pub struct RunRecorder {
    registry: Registry,
    run_id: String,
}

async fn bounded<T>(future: impl Future<Output = Result<T>>) -> Result<T> {
    tokio::time::timeout(CALL_TIMEOUT, future).await.map_err(|_| RegistryError::Timeout)?
}

async fn git_head(repo_root: &Path) -> Option<String> {
    if let Ok(commit) = std::env::var("APHRODY_TRAINING_CODE_COMMIT") {
        let commit = commit.trim().to_owned();
        if !commit.is_empty() {
            return Some(commit);
        }
    }
    let output = tokio::process::Command::new("git").no_window()
        .arg("-C")
        .arg(repo_root)
        .args(["rev-parse", "HEAD"])
        .stderr(std::process::Stdio::null())
        .output()
        .await
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .filter(|c| !c.is_empty())
}

fn count_lines(path: &Path) -> Option<i64> {
    use std::io::Read as _;

    let mut file = std::fs::File::open(path).ok()?;
    let mut buffer = [0_u8; 64 * 1024];
    let mut lines = 0_i64;
    loop {
        let read = file.read(&mut buffer).ok()?;
        if read == 0 {
            return Some(lines);
        }
        lines +=
            i64::try_from(buffer[..read].iter().filter(|&&byte| byte == b'\n').count()).ok()?;
    }
}

/// SHA-256 and line count of the input file, off the async threads.
async fn fingerprint(path: PathBuf) -> Option<(String, Option<i64>)> {
    tokio::task::spawn_blocking(move || {
        let sha256 = aphrody_models::digest::sha256_file(&path).ok()?;
        let counts_lines = path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| matches!(ext, "jsonl" | "ndjson" | "txt" | "tsv" | "csv"));
        let rows = if counts_lines { count_lines(&path) } else { None };
        Some((sha256.to_ascii_lowercase(), rows))
    })
    .await
    .ok()
    .flatten()
}

fn file_uri(path: &Path) -> String {
    let absolute = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    format!("file://{}", absolute.display())
}

fn artifact_format(role: &str, path: &Path) -> String {
    path.extension()
        .and_then(|ext| ext.to_str())
        .filter(|ext| !ext.is_empty())
        .map_or_else(|| role.to_owned(), str::to_ascii_lowercase)
}

impl RunRecorder {
    /// Start recording `job`. `None` when no registry is configured or it is
    /// unreachable (a warning is logged).
    pub async fn begin_from_env(job: &TrainingJob, repo_root: &Path) -> Option<Self> {
        let registry = match Registry::from_env() {
            Ok(Some(registry)) => registry,
            Ok(None) => return None,
            Err(error) => {
                tracing::warn!(%error, "training registry disabled: invalid database URL");
                return None;
            },
        };
        let code_commit = git_head(repo_root).await;
        let dataset_version_id =
            Self::dataset_version(&registry, job, code_commit.as_deref()).await;
        let params = serde_json::to_value(job).unwrap_or(Value::Null);
        let run = NewRun {
            kind: job.kind.as_str().to_owned(),
            dataset_version_id,
            base_model: job.base_model.clone(),
            params,
            code_commit,
            job_id: Some(job.id.clone()),
        };
        match bounded(registry.start_run(&run)).await {
            Ok(run_id) => Some(Self { registry, run_id }),
            Err(error) => {
                tracing::warn!(%error, job = %job.id, "training registry unreachable: run not recorded");
                None
            },
        }
    }

    async fn dataset_version(
        registry: &Registry,
        job: &TrainingJob,
        code_commit: Option<&str>,
    ) -> Option<String> {
        let input = job.input_path.as_ref().filter(|path| path.is_file())?;
        let (sha256, rows) = fingerprint(input.clone()).await?;
        let name = std::env::var("APHRODY_TRAINING_DATASET")
            .ok()
            .filter(|name| !name.trim().is_empty())
            .or_else(|| input.file_stem().and_then(|stem| stem.to_str()).map(str::to_owned))?;
        let result = async {
            let dataset_id = registry.upsert_dataset(&name, None).await?;
            registry
                .record_dataset_version(&NewDatasetVersion {
                    dataset_id,
                    parent_id: None,
                    kind: job.kind.as_str().to_owned(),
                    source_commit: code_commit.map(str::to_owned),
                    content_sha256: sha256,
                    row_count: rows,
                    uri: Some(file_uri(input)),
                    metadata: json!({"recorded_by": "aphrody-train"}),
                })
                .await
        };
        match bounded(result).await {
            Ok(id) => Some(id),
            Err(error) => {
                tracing::warn!(%error, "training registry: dataset version not recorded");
                None
            },
        }
    }

    /// The registry run id.
    #[must_use]
    pub fn run_id(&self) -> &str {
        &self.run_id
    }

    /// Record the outcome: artifacts and metrics on success, the error message
    /// on failure, then close the run.
    pub async fn finish(self, result: &std::result::Result<JobOutcome, TrainError>) {
        let outcome = match result {
            Ok(outcome) => {
                self.record_success(outcome).await;
                RunOutcome::Succeeded
            },
            Err(error) => RunOutcome::Failed(error.to_string()),
        };
        if let Err(error) = bounded(self.registry.finish_run(&self.run_id, &outcome)).await {
            tracing::warn!(%error, run = %self.run_id, "training registry: run not closed");
        }
    }

    async fn record_success(&self, outcome: &JobOutcome) {
        for (role, path, sha256) in &outcome.artifacts {
            let size_bytes = std::fs::metadata(path).map_or(0, |metadata| metadata.len());
            let artifact = NewArtifact {
                run_id: self.run_id.clone(),
                format: artifact_format(role, path),
                uri: file_uri(path),
                content_sha256: sha256.to_ascii_lowercase(),
                size_bytes,
                metadata: json!({"role": role}),
            };
            if let Err(error) = bounded(self.registry.record_artifact(&artifact)).await {
                tracing::warn!(%error, role = %role, "training registry: artifact not recorded");
            }
        }
        for (metric, value) in &outcome.eval_metrics {
            let record = NewMetric {
                run_id: Some(self.run_id.clone()),
                metric: metric.clone(),
                value: *value,
                params: json!({"source": "runner", "job_id": outcome.job_id}),
                ..NewMetric::default()
            };
            if let Err(error) = bounded(self.registry.record_metric(&record)).await {
                tracing::warn!(%error, metric = %metric, "training registry: metric not recorded");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_migration_parses_and_defines_the_contract() {
        let set = migrations();
        assert_eq!(set.len(), 1);
        let migration = set.iter().next().unwrap();
        assert_eq!((migration.version, migration.name.as_str()), (1, "registry"));
        let sql = &migration.sql;
        for needle in [
            "CREATE SCHEMA IF NOT EXISTS training",
            "CREATE TABLE training.datasets",
            "CREATE TABLE training.dataset_versions",
            "parent_id",
            "source_commit",
            "content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$')",
            "CREATE TABLE training.runs",
            "code_commit",
            "CREATE TABLE training.artifacts",
            "content_sha256 text NOT NULL UNIQUE",
            "CREATE TABLE training.eval_metrics",
            "baseline",
            "CREATE TABLE training.promotions",
            "ON training.promotions (kind, alias) WHERE status = 'promoted'",
            "CREATE TABLE training.text_hashes",
            "CREATE VIEW training.split_leaks",
            "DEFAULT uuidv7()",
        ] {
            assert!(sql.contains(needle), "migration is missing `{needle}`");
        }
    }

    #[test]
    fn digest_and_label_validation() {
        assert!(validate_sha256("x", &"a".repeat(64)).is_ok());
        assert!(validate_sha256("x", &"A".repeat(64)).is_err());
        assert!(validate_sha256("x", &"a".repeat(63)).is_err());
        assert!(validate_sha256("x", &format!("{}g", "a".repeat(63))).is_err());
        assert!(validate_label("kind", "  ").is_err());
        assert!(validate_label("kind", "embed").is_ok());
    }

    #[test]
    fn split_labels_match_the_sql_check_constraint() {
        let sql = migrations().iter().next().unwrap().sql.clone();
        for split in [Split::Train, Split::Validation, Split::Test, Split::Gold] {
            assert!(sql.contains(&format!("'{}'", split.as_str())));
        }
    }

    #[test]
    fn artifact_format_prefers_the_extension() {
        assert_eq!(artifact_format("onnx_model", Path::new("/m/model.ONNX")), "onnx");
        assert_eq!(artifact_format("lora_adapter", Path::new("/m/adapter")), "lora_adapter");
    }

    #[test]
    fn file_uri_is_absolute() {
        assert!(file_uri(Path::new("/tmp/a.onnx")).starts_with("file:///tmp/"));
    }

    #[tokio::test]
    async fn invalid_inputs_are_rejected_before_any_connection() {
        let pool = PgPool::connect_lazy("postgres://u@127.0.0.1:1/none").unwrap();
        let registry = Registry::new(pool);
        assert!(matches!(
            registry
                .record_metric(&NewMetric {
                    metric: "ndcg@10".into(),
                    value: f64::NAN,
                    run_id: Some("x".into()),
                    ..NewMetric::default()
                })
                .await,
            Err(RegistryError::Invalid(_))
        ));
        assert!(matches!(
            registry
                .record_metric(&NewMetric {
                    metric: "ndcg@10".into(),
                    value: 0.5,
                    ..NewMetric::default()
                })
                .await,
            Err(RegistryError::Invalid(_))
        ));
        assert!(matches!(
            registry
                .record_artifact(&NewArtifact {
                    run_id: "x".into(),
                    format: "onnx".into(),
                    uri: "file:///m".into(),
                    content_sha256: "nothex".into(),
                    size_bytes: 1,
                    metadata: Value::Null,
                })
                .await,
            Err(RegistryError::Invalid(_))
        ));
        assert!(matches!(
            registry.record_text_hashes("v", Split::Train, &["zz".to_owned()]).await,
            Err(RegistryError::Invalid(_))
        ));
    }
}
