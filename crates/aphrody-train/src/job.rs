// SPDX-License-Identifier: Apache-2.0
//! Training job definition and parameters (P10).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Target training workload kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrainKind {
    /// Fine-tune dense text embeddings.
    Embed,
    /// Fine-tune cross-encoder rerankers.
    Rerank,
    /// Train agent QLoRA adapter from rollouts.
    Lora,
    /// Generate dataset triples from chunked corpus with gold-leak guard.
    Triples,
    /// Fast CPU dry-run simulator.
    DryRun,
    /// Export completed, redacted agent turns from rollouts.
    DatasetRollouts,
    /// Export verified same-turn repaired tool preferences.
    DatasetDpo,
}

impl TrainKind {
    /// Python module entry point under `aphrody_train`.
    #[must_use]
    pub const fn module_name(self) -> &'static str {
        match self {
            Self::Embed => "aphrody_train.embed",
            Self::Rerank => "aphrody_train.rerank",
            Self::Lora => "aphrody_train.lora",
            Self::Triples => "aphrody_train.triples",
            Self::DryRun => "aphrody_train.dry_run",
            Self::DatasetRollouts | Self::DatasetDpo => "aphrody_train.dataset",
        }
    }

    /// CLI argument representation.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Embed => "embed",
            Self::Rerank => "rerank",
            Self::Lora => "lora",
            Self::Triples => "triples",
            Self::DryRun => "dry_run",
            Self::DatasetRollouts => "dataset_rollouts",
            Self::DatasetDpo => "dataset_dpo",
        }
    }
}

/// Specifications for launching a training job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainingJob {
    /// Unique job identifier (e.g. `train-embed-20260919-01`).
    pub id: String,
    /// Workload kind.
    pub kind: TrainKind,
    /// Output directory where checkpoints and final artifacts are placed.
    pub output_dir: PathBuf,
    /// Base model name or catalog reference.
    #[serde(default)]
    pub base_model: Option<String>,
    /// Path to input data file (chunks JSONL, triples JSONL, or rollout directory).
    #[serde(default)]
    pub input_path: Option<PathBuf>,
    /// Path to gold evaluation set for leakage guard check.
    #[serde(default)]
    pub gold_path: Option<PathBuf>,
    /// Total training steps planned.
    #[serde(default = "default_steps")]
    pub steps: u64,
    /// Whether to permit running without an active CUDA GPU (e.g. for dry-run).
    #[serde(default)]
    pub allow_cpu: bool,
}

const fn default_steps() -> u64 {
    10
}

impl TrainingJob {
    /// Construct a new training job.
    #[must_use]
    pub fn new(id: impl Into<String>, kind: TrainKind, output_dir: impl Into<PathBuf>) -> Self {
        Self {
            id: id.into(),
            kind,
            output_dir: output_dir.into(),
            base_model: None,
            input_path: None,
            gold_path: None,
            steps: 10,
            allow_cpu: false,
        }
    }
}
