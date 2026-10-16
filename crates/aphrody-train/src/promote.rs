// SPDX-License-Identifier: Apache-2.0
//! Promotion evaluation and model registration gates (P10).
//!
//! A newly trained candidate model is only promoted if it demonstrably beats
//! the untouched gold baseline without regressing specific tags:
//! - ΔRecall@5 ≥ +0.01 (min improvement)
//! - Max per-tag regression ≤ 0.03
//!
//! If rejected, an explanation is returned and exit code 3 is signaled.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use aphrody_models::{ModelStore, digest};

/// Promotion criteria thresholds.
#[derive(Debug, Clone)]
pub struct PromoteCriteria {
    /// Minimum required overall Recall@5 improvement relative to baseline.
    pub min_delta_recall_at_5: f64,
    /// Maximum permitted regression on any individual tag.
    pub max_tag_regression: f64,
}

impl Default for PromoteCriteria {
    fn default() -> Self {
        Self { min_delta_recall_at_5: 0.01, max_tag_regression: 0.03 }
    }
}

/// Outcome of a promotion evaluation.
#[derive(Debug, Clone, PartialEq)]
pub enum PromoteVerdict {
    /// Candidate met all gates and is accepted.
    Promoted {
        /// Generated or assigned model identifier.
        model_id: String,
        /// Measured improvement on Recall@5.
        delta_recall_at_5: f64,
        /// Absolute path to installed model weights.
        artifact_path: PathBuf,
        /// Verified SHA-256 hex digest.
        sha256: String,
    },
    /// Candidate failed one or more gates and is rejected.
    Rejected {
        /// Human-readable explanation.
        reason: String,
        /// Measured improvement (or degradation) on Recall@5.
        delta_recall_at_5: f64,
        /// Worst per-tag regression observed.
        max_regression_observed: f64,
    },
}

impl PromoteVerdict {
    /// Whether the candidate was promoted.
    #[must_use]
    pub fn is_promoted(&self) -> bool {
        matches!(self, Self::Promoted { .. })
    }
}

/// Evaluate whether a candidate model should be promoted.
#[must_use]
pub fn evaluate_candidate(
    baseline_recall_at_5: f64,
    candidate_recall_at_5: f64,
    baseline_tags: &BTreeMap<String, f64>,
    candidate_tags: &BTreeMap<String, f64>,
    artifact_path: &Path,
    criteria: &PromoteCriteria,
) -> PromoteVerdict {
    let delta = candidate_recall_at_5 - baseline_recall_at_5;

    let valid_score = |value: f64| value.is_finite() && (0.0..=1.0).contains(&value);
    if !valid_score(baseline_recall_at_5)
        || !valid_score(candidate_recall_at_5)
        || baseline_tags.is_empty()
        || baseline_tags.keys().ne(candidate_tags.keys())
        || baseline_tags.values().chain(candidate_tags.values()).any(|score| !valid_score(*score))
    {
        return PromoteVerdict::Rejected {
            reason: "scores must be finite probabilities with identical nonempty per-tag sets"
                .into(),
            delta_recall_at_5: delta,
            max_regression_observed: 0.0,
        };
    }
    let Ok(sha256) = digest::sha256_file(artifact_path) else {
        return PromoteVerdict::Rejected {
            reason: "candidate artifact is missing or unreadable".into(),
            delta_recall_at_5: delta,
            max_regression_observed: 0.0,
        };
    };

    let mut max_regression = 0.0_f64;
    for (tag, base_score) in baseline_tags {
        let cand_score = candidate_tags.get(tag).copied().unwrap_or(0.0);
        let reg = base_score - cand_score;
        if reg > max_regression {
            max_regression = reg;
        }
    }

    if delta < criteria.min_delta_recall_at_5 {
        return PromoteVerdict::Rejected {
            reason: format!(
                "Delta Recall@5 ({delta:+.4}) is below the required threshold of {:+.4}",
                criteria.min_delta_recall_at_5
            ),
            delta_recall_at_5: delta,
            max_regression_observed: max_regression,
        };
    }

    if max_regression > criteria.max_tag_regression {
        return PromoteVerdict::Rejected {
            reason: format!(
                "Per-tag regression ({max_regression:.4}) exceeds maximum allowed of {:.4}",
                criteria.max_tag_regression
            ),
            delta_recall_at_5: delta,
            max_regression_observed: max_regression,
        };
    }

    let filename = artifact_path.file_stem().and_then(|s| s.to_str()).unwrap_or("trained_model");

    PromoteVerdict::Promoted {
        model_id: format!("local:{filename}"),
        delta_recall_at_5: delta,
        artifact_path: artifact_path.to_path_buf(),
        sha256,
    }
}

impl PromoteVerdict {
    /// Record this verdict in the training registry (feature `registry`): a
    /// `recall@5.delta` metric, a proposal for `(kind, alias)` and the promotion
    /// or rejection. Returns the promotion id. Opt-in: callers decide when to
    /// record; nothing is written by [`evaluate_candidate`] itself.
    ///
    /// # Errors
    ///
    /// Returns [`crate::RegistryError`] on database failures.
    #[cfg(feature = "registry")]
    pub async fn record(
        &self,
        registry: &crate::registry::Registry,
        kind: &str,
        alias: &str,
        artifact_id: &str,
        decided_by: &str,
    ) -> Result<String, crate::registry::RegistryError> {
        registry.record_verdict(kind, alias, artifact_id, None, self, decided_by).await
    }
}

/// Register a promoted model into the local [`ModelStore`].
///
/// # Errors
///
/// Returns [`aphrody_models::ModelError`] if store adoption fails.
pub fn register_promoted_model(
    store: &ModelStore,
    artifact_path: &Path,
) -> aphrody_models::Result<aphrody_models::InstalledModel> {
    store.adopt_local(artifact_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_beating_threshold_is_promoted() {
        let temp = tempfile::tempdir().unwrap();
        let artifact = temp.path().join("model.onnx");
        std::fs::write(&artifact, b"MOCK_WEIGHTS_FOR_PROMOTION").unwrap();

        let mut base_tags = BTreeMap::new();
        base_tags.insert("anime".into(), 0.80);
        base_tags.insert("manga".into(), 0.85);

        let mut cand_tags = BTreeMap::new();
        cand_tags.insert("anime".into(), 0.82);
        cand_tags.insert("manga".into(), 0.86);

        let verdict = evaluate_candidate(
            0.82,
            0.84, // delta = +0.02 >= +0.01
            &base_tags,
            &cand_tags,
            &artifact,
            &PromoteCriteria::default(),
        );

        assert!(verdict.is_promoted());
    }

    #[test]
    fn candidate_with_tag_regression_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let artifact = temp.path().join("model.onnx");
        std::fs::write(&artifact, b"MOCK_WEIGHTS").unwrap();

        let mut base_tags = BTreeMap::new();
        base_tags.insert("anime".into(), 0.80);
        base_tags.insert("manga".into(), 0.85);

        let mut cand_tags = BTreeMap::new();
        cand_tags.insert("anime".into(), 0.90);
        cand_tags.insert("manga".into(), 0.75); // regressed by 0.10 > 0.03

        let verdict = evaluate_candidate(
            0.82,
            0.84, // delta overall is +0.02
            &base_tags,
            &cand_tags,
            &artifact,
            &PromoteCriteria::default(),
        );

        assert!(!verdict.is_promoted());
        match verdict {
            PromoteVerdict::Rejected { reason, .. } => {
                assert!(reason.contains("Per-tag regression"));
            },
            _ => panic!("expected rejection"),
        }
    }

    #[test]
    fn missing_artifact_or_missing_tag_evidence_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let missing = temp.path().join("missing.onnx");
        let mut tags = BTreeMap::new();
        tags.insert("anime".into(), 0.80);
        assert!(
            !evaluate_candidate(0.80, 0.90, &tags, &tags, &missing, &PromoteCriteria::default())
                .is_promoted()
        );
        let artifact = temp.path().join("model.onnx");
        std::fs::write(&artifact, b"weights").unwrap();
        assert!(
            !evaluate_candidate(
                0.80,
                0.90,
                &BTreeMap::new(),
                &BTreeMap::new(),
                &artifact,
                &PromoteCriteria::default()
            )
            .is_promoted()
        );
        assert!(
            !evaluate_candidate(
                f64::NAN,
                0.90,
                &tags,
                &tags,
                &artifact,
                &PromoteCriteria::default()
            )
            .is_promoted()
        );
    }
}
