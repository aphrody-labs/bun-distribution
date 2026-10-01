// SPDX-License-Identifier: Apache-2.0
//! Errors of the engine crate: configuration, availability, loading.
//!
//! Request-time failures travel as `aphrody_model_client::ModelError`, the type
//! every [`ModelClient`](aphrody_model_client::ModelClient) speaks. This type
//! covers what happens before a request exists.

use std::fmt;

use thiserror::Error;

/// Why the engine cannot run in this build.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnavailableReason {
    /// The crate was compiled without its `engine` cargo feature.
    FeatureDisabled,
    /// The target cannot host mistral.rs (wasm32).
    UnsupportedTarget,
}

impl fmt::Display for UnavailableReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FeatureDisabled => f.write_str(
                "aphrody-engine-mistralrs was compiled without its `engine` feature \
                 (rebuild with `--features engine`, plus `cuda` or `metal` for a GPU)",
            ),
            Self::UnsupportedTarget => {
                f.write_str("mistral.rs runs on host targets only, not on wasm32")
            },
        }
    }
}

/// Errors raised while configuring or loading the engine.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum EngineError {
    /// The engine is not part of this build or cannot run on this target.
    #[error("mistral.rs engine unavailable: {reason}")]
    Unavailable {
        /// What is missing.
        reason: UnavailableReason,
    },
    /// The configuration is inconsistent or names an unknown value.
    #[error("invalid engine configuration: {0}")]
    Config(String),
    /// mistral.rs failed to load the model (download, parse, device placement).
    #[error("failed to load model `{model}`: {message}")]
    Load {
        /// The model id or path that was being loaded.
        model: String,
        /// mistral.rs' own error chain, rendered.
        message: String,
    },
    /// The engine failed outside a streamed request (for example an embedding call).
    #[error("inference failed: {0}")]
    Inference(String),
}

impl EngineError {
    /// `Unavailable` for the missing `engine` feature.
    #[must_use]
    pub const fn feature_disabled() -> Self {
        Self::Unavailable { reason: UnavailableReason::FeatureDisabled }
    }

    /// `Unavailable` for a target that cannot host the engine.
    #[must_use]
    pub const fn unsupported_target() -> Self {
        Self::Unavailable { reason: UnavailableReason::UnsupportedTarget }
    }

    /// Whether this is the `Unavailable` variant.
    #[must_use]
    pub const fn is_unavailable(&self) -> bool {
        matches!(self, Self::Unavailable { .. })
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl From<EngineError> for aphrody_model_client::ModelError {
    /// Map onto the wire-level error: `503` for `Unavailable`, `400` for a bad
    /// configuration, `500` otherwise.
    fn from(error: EngineError) -> Self {
        let status = match &error {
            EngineError::Unavailable { .. } => 503,
            EngineError::Config(_) => 400,
            EngineError::Load { .. } | EngineError::Inference(_) => 500,
        };
        Self::Api { status, message: error.to_string() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_messages_name_the_remedy() {
        let disabled = EngineError::feature_disabled().to_string();
        assert!(disabled.contains("`engine` feature"), "{disabled}");
        let target = EngineError::unsupported_target().to_string();
        assert!(target.contains("wasm32"), "{target}");
        assert!(EngineError::feature_disabled().is_unavailable());
        assert!(!EngineError::Config("x".into()).is_unavailable());
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn engine_errors_map_onto_http_statuses() {
        use aphrody_model_client::ModelError;

        let status = |error: EngineError| match ModelError::from(error) {
            ModelError::Api { status, .. } => status,
            other => panic!("expected Api, got {other:?}"),
        };
        assert_eq!(status(EngineError::feature_disabled()), 503);
        assert_eq!(status(EngineError::Config("bad".into())), 400);
        assert_eq!(status(EngineError::Inference("boom".into())), 500);
        assert_eq!(status(EngineError::Load { model: "m".into(), message: "x".into() }), 500);
    }
}
