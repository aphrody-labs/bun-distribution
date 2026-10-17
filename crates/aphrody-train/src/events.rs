// SPDX-License-Identifier: Apache-2.0
//! NDJSON streaming events emitted by the training subprocess (P10).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// High-level training event type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TrainEvent {
    /// Job started.
    Start {
        /// Job identifier.
        job_id: String,
        /// Training kind (embed, rerank, lora, triples, dry_run).
        kind: String,
        /// Total steps planned.
        total_steps: u64,
        /// Arbitrary job metadata.
        #[serde(default)]
        metadata: BTreeMap<String, serde_json::Value>,
    },
    /// Step progress.
    Progress {
        /// Job identifier.
        job_id: String,
        /// Current step index (1-based).
        step: u64,
        /// Total steps.
        total_steps: u64,
        /// Training loss.
        loss: f64,
        /// Learning rate.
        #[serde(default)]
        lr: f64,
        /// Elapsed seconds since start.
        #[serde(default)]
        elapsed_secs: f64,
    },
    /// Evaluation check against validation split.
    Eval {
        /// Job identifier.
        job_id: String,
        /// Step at which evaluation occurred.
        step: u64,
        /// Key-value metrics (e.g. `recall@5`, `mrr`).
        metrics: BTreeMap<String, f64>,
        /// Metric deltas relative to baseline.
        #[serde(default)]
        delta: BTreeMap<String, f64>,
    },
    /// Intermediate checkpoint saved.
    Checkpoint {
        /// Job identifier.
        job_id: String,
        /// Step checkpoint was saved at.
        step: u64,
        /// Path to checkpoint directory or weights file.
        path: String,
    },
    /// Produced final model artifact.
    Artifact {
        /// Job identifier.
        job_id: String,
        /// Artifact role (`onnx_model`, `lora_adapter`, `triples`, etc.).
        role: String,
        /// Absolute or relative path to artifact file.
        path: String,
        /// Hex SHA-256 digest of the artifact.
        sha256: String,
        /// Size in bytes.
        bytes: u64,
    },
    /// Job completed successfully.
    Done {
        /// Job identifier.
        job_id: String,
        /// Total execution duration in seconds.
        duration_secs: f64,
        /// Summary message.
        #[serde(default)]
        summary: String,
    },
    /// Job encountered a fatal error.
    Error {
        /// Job identifier.
        job_id: String,
        /// Error explanation.
        message: String,
        /// Exit code.
        #[serde(default)]
        code: i32,
    },
}

impl TrainEvent {
    /// Identifier of the job that emitted this event.
    #[must_use]
    pub fn job_id(&self) -> &str {
        match self {
            Self::Start { job_id, .. }
            | Self::Progress { job_id, .. }
            | Self::Eval { job_id, .. }
            | Self::Checkpoint { job_id, .. }
            | Self::Artifact { job_id, .. }
            | Self::Done { job_id, .. }
            | Self::Error { job_id, .. } => job_id,
        }
    }

    /// Parse an event from a single line of NDJSON.
    ///
    /// # Errors
    ///
    /// Returns [`serde_json::Error`] if the line does not match the event schema.
    pub fn parse_line(line: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(line.trim())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_all_event_variants() {
        let start_json = r#"{"type":"start","job_id":"j1","kind":"embed","total_steps":100}"#;
        let event = TrainEvent::parse_line(start_json).unwrap();
        match event {
            TrainEvent::Start {
                job_id,
                kind,
                total_steps,
                ..
            } => {
                assert_eq!(job_id, "j1");
                assert_eq!(kind, "embed");
                assert_eq!(total_steps, 100);
            }
            other => panic!("unexpected event: {other:?}"),
        }

        let progress_json = r#"{"type":"progress","job_id":"j1","step":5,"total_steps":100,"loss":0.42,"lr":1e-4,"elapsed_secs":1.2}"#;
        let event = TrainEvent::parse_line(progress_json).unwrap();
        match event {
            TrainEvent::Progress { step, loss, .. } => {
                assert_eq!(step, 5);
                assert!((loss - 0.42).abs() < 1e-6);
            }
            other => panic!("unexpected event: {other:?}"),
        }

        let artifact_json = r#"{"type":"artifact","job_id":"j1","role":"onnx_model","path":"/path/model.onnx","sha256":"abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890","bytes":1024}"#;
        let event = TrainEvent::parse_line(artifact_json).unwrap();
        match event {
            TrainEvent::Artifact {
                role,
                bytes,
                sha256,
                ..
            } => {
                assert_eq!(role, "onnx_model");
                assert_eq!(bytes, 1024);
                assert_eq!(sha256.len(), 64);
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[test]
    fn done_event_keeps_its_own_job_id() {
        let done =
            TrainEvent::parse_line(r#"{"type":"done","job_id":"other-job","duration_secs":0.1}"#)
                .unwrap();
        assert_eq!(done.job_id(), "other-job");
    }
}
