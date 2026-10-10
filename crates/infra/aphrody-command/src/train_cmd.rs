// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! CLI commands for machine learning training, fine-tuning, and model promotion (P10).

use std::path::{Path, PathBuf};

use aphrody_train::{
    Registry, TrainKind, TrainingJob, acquire_training_lease, find_python_train_project,
    run_training_job,
};
use clap::{Args, Subcommand, ValueEnum};
use miette::{IntoDiagnostic, Result};

#[derive(Debug, Args)]
pub(crate) struct TrainArgs {
    #[command(subcommand)]
    action: TrainAction,
}

#[derive(Debug, Subcommand)]
enum TrainAction {
    /// Show training status, GPU lock availability, and active jobs.
    Status,
    /// Test acquiring the exclusive GPU training lease (preempts llama-server).
    Lease {
        /// Hold the lease for the given number of seconds before releasing.
        #[arg(long, default_value_t = 5)]
        seconds: u64,
    },
    /// Run a training or fine-tuning job.
    Run {
        /// Kind of training job to execute.
        #[arg(long, value_enum, default_value_t = JobKind::DryRun)]
        kind: JobKind,
        /// Unique job identifier.
        #[arg(long)]
        id: Option<String>,
        /// Number of training steps.
        #[arg(long, default_value_t = 10)]
        steps: usize,
        /// Allow CPU fallback if CUDA is unavailable.
        #[arg(long)]
        allow_cpu: bool,
        /// Output directory for artifacts and events.jsonl.
        #[arg(long)]
        out_dir: Option<PathBuf>,
        /// Input chunks, triples, or rollout directory, depending on kind.
        #[arg(long)]
        input: Option<PathBuf>,
        /// Untouched gold JSONL used by triples and rollout dataset guards.
        #[arg(long)]
        gold: Option<PathBuf>,
        /// Base model for embed, rerank, or LoRA training.
        #[arg(long)]
        base_model: Option<String>,
    },
    /// Apply the training registry migrations (schema `training`) over the direct
    /// `APHRODY_TRAINING_DATABASE_URL`.
    RegistryMigrate,
    /// Reserved for measured shadow-index A/B promotion; currently refuses installation.
    Promote {
        /// Path to the candidate model artifact file.
        #[arg(long)]
        artifact: PathBuf,
        /// Target model family name (e.g. "multilingual-e5-small-finetuned").
        #[arg(long)]
        name: String,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum JobKind {
    DryRun,
    Triples,
    Embed,
    Rerank,
    Lora,
    DatasetRollouts,
    DatasetDpo,
}

impl From<JobKind> for TrainKind {
    fn from(kind: JobKind) -> Self {
        match kind {
            JobKind::DryRun => TrainKind::DryRun,
            JobKind::Triples => TrainKind::Triples,
            JobKind::Embed => TrainKind::Embed,
            JobKind::Rerank => TrainKind::Rerank,
            JobKind::Lora => TrainKind::Lora,
            JobKind::DatasetRollouts => TrainKind::DatasetRollouts,
            JobKind::DatasetDpo => TrainKind::DatasetDpo,
        }
    }
}

/// Default `--input` for dbfr triple-based jobs: `<workspaces>/dbfr/training/triples.jsonl`,
/// only when `domain` is `dbfr` and the kind consumes triples.
fn default_dbfr_input(kind: JobKind, domain: Option<&str>, state: &Path) -> Option<PathBuf> {
    if !matches!(kind, JobKind::Embed | JobKind::Rerank | JobKind::Triples) {
        return None;
    }
    if domain.map(str::trim) != Some("dbfr") {
        return None;
    }
    Some(
        aphrody_agent_home::paths::named_profile_workspace(state, "dbfr")
            .join("training")
            .join("triples.jsonl"),
    )
}

pub(crate) async fn run(args: TrainArgs) -> Result<()> {
    if let TrainAction::Promote { artifact, name } = &args.action {
        return Err(miette::miette!(
            "Model `{name}` at {} was not installed: promotion requires measured baseline and \
             candidate Recall@5 plus per-tag scores from an untouched gold set and shadow index; \
             that workflow is not implemented",
            artifact.display()
        ));
    }
    if matches!(args.action, TrainAction::RegistryMigrate) {
        let report = Registry::migrate_from_env()
            .await
            .map_err(|e| miette::miette!("Training registry migration failed: {e}"))?
            .ok_or_else(|| {
                miette::miette!("APHRODY_TRAINING_DATABASE_URL is not set; nothing to migrate")
            })?;
        let applied: Vec<String> =
            report.applied.iter().map(|(v, name)| format!("{v:04}_{name}")).collect();
        let summary = serde_json::json!({
            "applied": applied,
            "already_applied": report.already_applied,
        });
        println!("{}", serde_json::to_string_pretty(&summary).into_diagnostic()?);
        return Ok(());
    }
    let state_dir = aphrody_models::paths::state_dir().into_diagnostic()?;
    let locks_dir = state_dir.join("locks");
    std::fs::create_dir_all(&locks_dir).into_diagnostic()?;

    match args.action {
        TrainAction::Status => {
            let gpu_lock = locks_dir.join("gpu.lock");
            let is_locked = gpu_lock.exists();
            let repo_root = std::env::current_dir().into_diagnostic()?;
            let py_root = find_python_train_project(&repo_root);
            let py_train_exists =
                py_root.join("packages/ai/py/aphrody-train/pyproject.toml").is_file();

            let status = serde_json::json!({
                "gpu_lock_active": is_locked,
                "locks_dir": locks_dir.display().to_string(),
                "python_train_project": py_train_exists,
                "python_workspace": py_root.display().to_string(),
                "state_dir": state_dir.display().to_string(),
            });
            println!("{}", serde_json::to_string_pretty(&status).into_diagnostic()?);
        },
        TrainAction::Lease { seconds } => {
            println!("Acquiring exclusive GPU training lease...");
            let lease = acquire_training_lease(
                &locks_dir,
                "train-cli-probe",
                std::time::Duration::from_secs(seconds),
            )
            .map_err(|e| miette::miette!("Failed to acquire GPU lease: {e}"))?;
            println!("GPU lease acquired successfully. Holding for {seconds} seconds...");
            tokio::time::sleep(tokio::time::Duration::from_secs(seconds)).await;
            drop(lease);
            println!("GPU lease released.");
        },
        TrainAction::Run { kind, id, steps, allow_cpu, out_dir, input, gold, base_model } => {
            let job_id = id.unwrap_or_else(|| format!("train-{}", chrono::Utc::now().timestamp()));
            let out = out_dir.unwrap_or_else(|| state_dir.join("train").join(&job_id));
            std::fs::create_dir_all(&out).into_diagnostic()?;

            let mut job = TrainingJob::new(&job_id, kind.into(), &out);
            job.steps = steps as u64;
            job.allow_cpu = allow_cpu;
            job.input_path = input.or_else(|| {
                let domain = std::env::var("APHRODY_AGENT_DOMAIN").ok();
                default_dbfr_input(kind, domain.as_deref(), &state_dir)
            });
            if let Some(path) = &job.input_path {
                println!("Input: {}", path.display());
            }
            job.gold_path = gold;
            job.base_model = base_model;

            let repo_root = std::env::current_dir().into_diagnostic()?;
            println!("Starting training job `{job_id}` (kind={kind:?}, steps={steps})...");

            let outcome = run_training_job(&job, &repo_root, &locks_dir)
                .await
                .map_err(|e| miette::miette!("Training job failed: {e}"))?;

            println!(
                "Job `{}` completed successfully. Emitted {} artifacts.",
                outcome.job_id,
                outcome.artifacts.len()
            );
            for (name, path, sha256) in &outcome.artifacts {
                println!("  - {name}: {} (sha256: {})", path.display(), sha256);
            }
        },
        TrainAction::Promote { .. } => unreachable!("promotion was refused before state access"),
        TrainAction::RegistryMigrate => {
            unreachable!("registry migration returned before state access")
        },
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn promote_refuses_unmeasured_artifact_before_state_access() {
        let args = TrainArgs {
            action: TrainAction::Promote {
                artifact: PathBuf::from("candidate.onnx"),
                name: "candidate".to_owned(),
            },
        };
        let error = run(args).await.unwrap_err().to_string();
        assert!(error.contains("was not installed"));
        assert!(error.contains("untouched gold set and shadow index"));
    }

    #[test]
    fn dbfr_domain_defaults_triple_input() {
        let state = tempfile::tempdir().unwrap();
        let canonical = state.path().join("workspaces").join("dbfr");
        std::fs::create_dir_all(&canonical).unwrap();
        let expected = canonical.join("training").join("triples.jsonl");
        for kind in [JobKind::Embed, JobKind::Rerank, JobKind::Triples] {
            assert_eq!(
                default_dbfr_input(kind, Some("dbfr"), state.path()).as_deref(),
                Some(expected.as_path())
            );
        }
        assert_eq!(default_dbfr_input(JobKind::Lora, Some("dbfr"), state.path()), None);
        assert_eq!(default_dbfr_input(JobKind::Embed, Some("aphrody"), state.path()), None);
        assert_eq!(default_dbfr_input(JobKind::Embed, None, state.path()), None);
    }
}
