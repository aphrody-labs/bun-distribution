// SPDX-License-Identifier: Apache-2.0
//! `aphrody-train` — training surface for aphrody (P10, docs/plans/codex-oss.md).
//!
//! Provides:
//! - Exclusive GPU lease acquisition preempting `llama-server` inference.
//! - Subprocess runner driving the shared `py/` workspace with live NDJSON event streaming.
//! - Gold-leak guarded dataset triples generation.
//! - Metric-driven candidate promotion gates (ΔRecall@5 ≥ +0.01, per-tag regression ≤ 0.03).
//! - Automatic model registration in [`aphrody_models::ModelStore`].
//! - Optional PostgreSQL training registry (feature `registry`, ADR D11): dataset lineage, runs,
//!   artifacts, metrics and promotions, recorded only when `APHRODY_TRAINING_DATABASE_URL[_POOLED]`
//!   is set.

mod cli;
mod events;
mod job;
mod lease;
mod promote;
#[cfg(feature = "registry")]
pub mod registry;
mod runner;

pub use cli::cli_main;
pub use events::TrainEvent;
pub use job::{TrainKind, TrainingJob};
pub use lease::acquire_training_lease;
pub use promote::{PromoteCriteria, PromoteVerdict, evaluate_candidate, register_promoted_model};
#[cfg(feature = "registry")]
pub use registry::{Registry, RegistryError, RunRecorder};
pub use runner::{JobOutcome, TrainError, find_python_train_project, run_training_job};

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn dataset_rollouts_invokes_python_and_verifies_artifact() {
        let temp = tempfile::tempdir().unwrap();
        let locks_dir = temp.path().join("locks");
        let input = temp.path().join("rollouts");
        std::fs::create_dir_all(&input).unwrap();
        let items = [
            serde_json::json!({"type":"session_meta","payload":{"id":"test-session"}}),
            serde_json::json!({"type":"history_item","message":{"role":"user","parts":[{"text":"Explain this code"}]}}),
            serde_json::json!({"id":"e1","msg":{"type":"turn_started"}}),
            serde_json::json!({"type":"history_item","message":{"role":"model","parts":[{"text":"It reads a file."}]}}),
            serde_json::json!({"id":"e2","msg":{"type":"turn_complete","last_agent_message":"It reads a file."}}),
        ];
        let lines = items
            .iter()
            .map(|item| serde_json::json!({"ts":"2026-09-24T00:00:00Z","item":item}).to_string())
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(input.join("rollout-test.jsonl"), format!("{lines}\n")).unwrap();
        let gold = temp.path().join("gold.jsonl");
        std::fs::write(
            &gold,
            "{\"q\":\"unrelated gold query\",\"expectUrl\":[\"https://example.invalid/gold\"]}\n",
        )
        .unwrap();
        let out_dir = temp.path().join("out");
        let mut job = TrainingJob::new("test-dataset-001", TrainKind::DatasetRollouts, &out_dir);
        job.input_path = Some(input);
        job.gold_path = Some(gold);

        let repo_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf();

        let outcome = run_training_job(&job, &repo_root, &locks_dir)
            .await
            .expect("dataset extraction should execute successfully");

        assert_eq!(outcome.job_id, "test-dataset-001");
        assert_eq!(outcome.artifacts.len(), 1);
        assert!(outcome.artifacts[0].1.is_file(), "artifact file must exist on disk");

        // Validate that events.jsonl was written
        let events_file = out_dir.join("events.jsonl");
        assert!(events_file.is_file());
        let lines = std::fs::read_to_string(&events_file).unwrap();
        assert!(lines.contains(r#""type": "start""#) || lines.contains(r#""type":"start""#));
        assert!(lines.contains(r#""type": "done""#) || lines.contains(r#""type":"done""#));

        assert!(lines.contains(r#""type": "artifact""#) || lines.contains(r#""type":"artifact""#));
    }
}
