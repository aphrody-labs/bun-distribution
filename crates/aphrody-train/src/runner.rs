// SPDX-License-Identifier: Apache-2.0
//! Subprocess runner and event streaming engine for training jobs (P10).

use aphrody_proc::NoWindow as _;
use std::{
    fs::OpenOptions,
    io::Write as _,
    path::{Path, PathBuf},
    time::Duration,
};

use aphrody_models::accel::{self, HardwareProfile};
use tokio::{
    io::{AsyncBufReadExt as _, BufReader},
    process::Command,
};

use crate::{events::TrainEvent, job::TrainingJob, lease::acquire_training_lease};

/// Errors occurring during training job execution.
#[derive(Debug, thiserror::Error)]
pub enum TrainError {
    /// No CUDA GPU found on this machine and `allow_cpu` was false.
    #[error(
        "training requires a CUDA GPU; no compatible accelerator found and allow_cpu was not set"
    )]
    NoCudaGpu,
    /// A required input file/directory or gold set was not provided.
    #[error("training job requires {0}")]
    MissingInput(&'static str),
    /// GPU lease acquisition failed.
    #[error("failed to acquire exclusive GPU lease: {0}")]
    Lease(#[from] aphrody_proc::LeaseError),
    /// Subprocess spawn or execution error.
    #[error("training process error: {0}")]
    Process(#[from] std::io::Error),
    /// Training failed with an error message or non-zero exit code.
    #[error("training job '{job_id}' failed: {message}")]
    JobFailed {
        /// Job ID.
        job_id: String,
        /// Failure message.
        message: String,
    },
}

/// Final outcome of a training job run.
#[derive(Debug, Clone)]
pub struct JobOutcome {
    /// Job ID.
    pub job_id: String,
    /// Produced artifacts `(role, path, sha256)`.
    pub artifacts: Vec<(String, PathBuf, String)>,
    /// Final evaluation metrics if any were reported.
    pub eval_metrics: std::collections::BTreeMap<String, f64>,
    /// Total duration in seconds.
    pub duration_secs: f64,
}

/// Locate the shared Python workspace: `APHRODY_PY_ROOT`, else the `py/` directory of the checkout.
#[must_use]
pub fn find_python_train_project(repo_root: &Path) -> PathBuf {
    if let Some(configured) = std::env::var_os("APHRODY_PY_ROOT") {
        return PathBuf::from(configured);
    }

    let is_workspace = |root: &Path| {
        root.join("uv.lock").is_file()
            && root.join("packages/aphrody-train/pyproject.toml").is_file()
    };
    if is_workspace(repo_root) {
        return repo_root.to_path_buf();
    }

    repo_root.join("py")
}

/// Execute a training job under an exclusive GPU lease.
///
/// Refuses to run on hosts without a CUDA GPU unless `job.allow_cpu` is true.
///
/// With the `registry` feature and `APHRODY_TRAINING_DATABASE_URL[_POOLED]` set, the run, its
/// artifacts and its metrics are also recorded in the training registry (best effort: registry
/// failures are logged and never fail the job). Without the feature or the variable the behaviour
/// is unchanged.
///
/// # Errors
///
/// Returns [`TrainError`] if GPU requirements are not met, lease cannot be acquired,
/// or the training process fails.
pub async fn run_training_job(
    job: &TrainingJob,
    repo_root: &Path,
    locks_dir: &Path,
) -> Result<JobOutcome, TrainError> {
    #[cfg(feature = "registry")]
    let recorder = crate::registry::RunRecorder::begin_from_env(job, repo_root).await;
    let result = run_training_job_unrecorded(job, repo_root, locks_dir).await;
    #[cfg(feature = "registry")]
    if let Some(recorder) = recorder {
        recorder.finish(&result).await;
    }
    result
}

async fn run_training_job_unrecorded(
    job: &TrainingJob,
    repo_root: &Path,
    locks_dir: &Path,
) -> Result<JobOutcome, TrainError> {
    let requires_input = !matches!(job.kind, crate::job::TrainKind::DryRun);
    if requires_input && job.input_path.is_none() {
        return Err(TrainError::MissingInput("--input"));
    }
    if matches!(
        job.kind,
        crate::job::TrainKind::DatasetRollouts
            | crate::job::TrainKind::DatasetDpo
            | crate::job::TrainKind::Lora
    ) && job.gold_path.is_none()
    {
        return Err(TrainError::MissingInput("--gold"));
    }
    if matches!(job.kind, crate::job::TrainKind::Lora) && job.base_model.is_none() {
        return Err(TrainError::MissingInput("--base-model"));
    }
    // 1. Hardware verification
    let hw: HardwareProfile = accel::probe();
    let requires_gpu = matches!(
        job.kind,
        crate::job::TrainKind::Embed | crate::job::TrainKind::Rerank | crate::job::TrainKind::Lora
    );
    if requires_gpu && !job.allow_cpu && hw.cuda_toolkit.is_none() && hw.gpus.is_empty() {
        return Err(TrainError::NoCudaGpu);
    }

    // 2. Acquire exclusive GPU lease (will stop/preempt inference if needed)
    let _lease = if requires_gpu {
        Some(acquire_training_lease(
            locks_dir,
            &job.id,
            Duration::from_secs(30),
        )?)
    } else {
        None
    };

    // 3. Prepare directories
    std::fs::create_dir_all(&job.output_dir)?;
    let events_path = job.output_dir.join("events.jsonl");
    let mut events_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&events_path)?;

    // 4. Build command
    let py_project = find_python_train_project(repo_root);
    let mut cmd = Command::new(aphrody_toolchains::Toolchain::Uv.executable()).no_window();
    cmd.args(["run", "--project"])
        .arg(&py_project)
        .args(["--package", "aphrody-train"]);
    if matches!(
        job.kind,
        crate::job::TrainKind::Embed | crate::job::TrainKind::Rerank | crate::job::TrainKind::Lora
    ) {
        cmd.args(["--extra", "full"]);
    }
    cmd.arg("python").arg("-m").arg(job.kind.module_name());
    match job.kind {
        crate::job::TrainKind::DatasetRollouts => {
            cmd.arg("rollouts");
        }
        crate::job::TrainKind::DatasetDpo => {
            cmd.arg("dpo");
        }
        _ => {}
    }
    cmd.arg("--job-id")
        .arg(&job.id)
        .arg("--output-dir")
        .arg(&job.output_dir)
        .arg("--steps")
        .arg(job.steps.to_string());

    if let Some(ref base) = job.base_model {
        cmd.arg("--base-model").arg(base);
    }
    if let Some(ref input) = job.input_path {
        match job.kind {
            crate::job::TrainKind::Triples => {
                cmd.arg("--input-chunks").arg(input);
                cmd.arg("--output-triples")
                    .arg(job.output_dir.join("triples.jsonl"));
            }
            crate::job::TrainKind::Embed | crate::job::TrainKind::Rerank => {
                cmd.arg("--triples-file").arg(input);
            }
            crate::job::TrainKind::Lora => {
                cmd.arg("--rollout-dir").arg(input);
            }
            crate::job::TrainKind::DatasetRollouts | crate::job::TrainKind::DatasetDpo => {
                cmd.arg("--rollout-dir").arg(input);
            }
            crate::job::TrainKind::DryRun => {}
        }
    }
    if let Some(ref gold) = job.gold_path {
        cmd.arg("--gold-file").arg(gold);
    }

    // Inject python path so in-tree packages resolve
    let python_path = py_project.join("packages/aphrody-train/src");
    cmd.env("PYTHONPATH", python_path);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());

    let mut child = cmd.spawn()?;
    let stdout = child.stdout.take().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::BrokenPipe, "missing stdout pipe")
    })?;

    let mut reader = BufReader::new(stdout).lines();
    let mut artifacts = Vec::new();
    let mut last_metrics = std::collections::BTreeMap::new();
    let mut total_duration = 0.0_f64;
    let mut completed = false;

    while let Some(line) = reader.next_line().await? {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Persist to events.jsonl
        let _ = writeln!(events_file, "{trimmed}");

        if let Ok(event) = TrainEvent::parse_line(trimmed) {
            if event.job_id() != job.id {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err(TrainError::JobFailed {
                    job_id: job.id.clone(),
                    message: "event belongs to another job".to_owned(),
                });
            }
            match event {
                TrainEvent::Artifact {
                    role,
                    path,
                    sha256,
                    bytes,
                    ..
                } => {
                    artifacts.push((role, PathBuf::from(path), sha256, bytes));
                }
                TrainEvent::Eval { metrics, .. } => {
                    last_metrics = metrics;
                }
                TrainEvent::Done { duration_secs, .. } => {
                    total_duration = duration_secs;
                    completed = true;
                }
                TrainEvent::Error { message, code, .. } => {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                    return Err(TrainError::JobFailed {
                        job_id: job.id.clone(),
                        message: format!("code {code}: {message}"),
                    });
                }
                _ => {}
            }
        }
    }

    let status = child.wait().await?;
    if !status.success() {
        return Err(TrainError::JobFailed {
            job_id: job.id.clone(),
            message: format!("process exited with code {}", status.code().unwrap_or(-1)),
        });
    }
    if !completed {
        return Err(TrainError::JobFailed {
            job_id: job.id.clone(),
            message: "process exited without a done event".to_owned(),
        });
    }
    if artifacts.is_empty() {
        return Err(TrainError::JobFailed {
            job_id: job.id.clone(),
            message: "process exited without an artifact event".to_owned(),
        });
    }
    let artifacts = verify_artifacts(&job.id, artifacts)?;

    Ok(JobOutcome {
        job_id: job.id.clone(),
        artifacts,
        eval_metrics: last_metrics,
        duration_secs: total_duration,
    })
}

fn verify_artifacts(
    job_id: &str,
    artifacts: Vec<(String, PathBuf, String, u64)>,
) -> Result<Vec<(String, PathBuf, String)>, TrainError> {
    artifacts
        .into_iter()
        .map(|(role, path, claimed_hash, claimed_size)| {
            let metadata = std::fs::metadata(&path).map_err(|_| TrainError::JobFailed {
                job_id: job_id.to_owned(),
                message: format!("artifact `{role}` is missing or unreadable"),
            })?;
            if !metadata.is_file() || metadata.len() != claimed_size {
                return Err(TrainError::JobFailed {
                    job_id: job_id.to_owned(),
                    message: format!("artifact `{role}` size does not match its event"),
                });
            }
            let actual_hash =
                aphrody_models::digest::sha256_file(&path).map_err(|_| TrainError::JobFailed {
                    job_id: job_id.to_owned(),
                    message: format!("artifact `{role}` could not be hashed"),
                })?;
            if !actual_hash.eq_ignore_ascii_case(&claimed_hash) {
                return Err(TrainError::JobFailed {
                    job_id: job_id.to_owned(),
                    message: format!("artifact `{role}` digest does not match its event"),
                });
            }
            Ok((role, path, actual_hash))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lora_requires_gold_and_local_model_before_launch() {
        let temp = tempfile::tempdir().unwrap();
        let mut job = TrainingJob::new(
            "lora-guard",
            crate::job::TrainKind::Lora,
            temp.path().join("out"),
        );
        job.input_path = Some(temp.path().join("prepared"));
        let error = run_training_job(&job, temp.path(), temp.path())
            .await
            .err()
            .unwrap();
        assert!(matches!(error, TrainError::MissingInput("--gold")));
        job.gold_path = Some(temp.path().join("gold.jsonl"));
        let error = run_training_job(&job, temp.path(), temp.path())
            .await
            .err()
            .unwrap();
        assert!(matches!(error, TrainError::MissingInput("--base-model")));
        assert!(!job.output_dir.exists());
    }

    #[test]
    fn refuses_artifact_with_forged_digest() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("model.onnx");
        std::fs::write(&path, b"model").unwrap();
        let result = verify_artifacts("job", vec![("onnx".into(), path, "0".repeat(64), 5)]);
        assert!(matches!(result, Err(TrainError::JobFailed { .. })));
    }
}
