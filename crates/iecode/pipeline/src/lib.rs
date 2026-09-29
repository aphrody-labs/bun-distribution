//! Portable, process-free pipeline contracts shared by every IECODE binding.
//!
//! A manifest describes *what* a host wants to do and which registered owner is responsible for
//! each stage. It never opens an image, starts an emulator, loads a dynamic library, or invokes a
//! command. Hosts execute a validated manifest through their native Rust, FFI or WebAssembly
//! binding.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Maximum number of stages accepted in one portable pipeline.
pub const MAX_STAGES: usize = 32;

/// A single operation in a platform pipeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StageKind {
    /// Read a container or game file without changing it.
    Inspect,
    /// Extract a read-only staging representation.
    Extract,
    /// Decode or encode a canonical IECODE format.
    Convert,
    /// Apply a validated overlay or mod manifest.
    Mod,
    /// Hand the prepared input to an in-process runtime boundary.
    Execute,
    /// Persist a supported save representation.
    Save,
}

/// One bounded stage declaration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stage {
    /// Stable stage identifier, unique inside its manifest.
    pub id: String,
    /// Operation performed by the stage owner.
    pub kind: StageKind,
    /// IECODE owner or explicitly registered adapter.
    pub owner: String,
    /// Optional previous stage whose output is this stage's input.
    pub input: Option<String>,
}

/// A complete, serializable pipeline request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineManifest {
    /// Stable caller-defined identifier.
    pub id: String,
    /// Platform-specific label such as `ds`, `3ds` or `wii`.
    pub platform: String,
    /// Ordered stages; dependencies must point backwards in this list.
    pub stages: Vec<Stage>,
}

/// Validation failure for a pipeline manifest.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ManifestError {
    /// The manifest has no stable identifier.
    #[error("pipeline identifier must not be empty")]
    EmptyId,
    /// The platform field is missing.
    #[error("pipeline platform must not be empty")]
    EmptyPlatform,
    /// Too many stages were supplied.
    #[error("pipeline contains {actual} stages; maximum is {max}")]
    TooManyStages {
        /// Number of supplied stages.
        actual: usize,
        /// Maximum accepted stage count.
        max: usize,
    },
    /// A stage identifier is empty or repeated.
    #[error("stage identifier is empty or duplicated: {0}")]
    DuplicateStage(String),
    /// An owner is not declared.
    #[error("stage {stage} has no owner")]
    EmptyOwner {
        /// Stage with the missing owner.
        stage: String,
    },
    /// A stage refers to a later or missing stage.
    #[error("stage {stage} refers to invalid input {input}")]
    InvalidInput {
        /// Stage containing the invalid dependency.
        stage: String,
        /// Referenced stage identifier.
        input: String,
    },
}

impl PipelineManifest {
    /// Validate identifiers, ownership and the ordered dependency graph.
    pub fn validate(&self) -> Result<(), ManifestError> {
        if self.id.trim().is_empty() {
            return Err(ManifestError::EmptyId);
        }
        if self.platform.trim().is_empty() {
            return Err(ManifestError::EmptyPlatform);
        }
        if self.stages.len() > MAX_STAGES {
            return Err(ManifestError::TooManyStages {
                actual: self.stages.len(),
                max: MAX_STAGES,
            });
        }

        for (index, stage) in self.stages.iter().enumerate() {
            if stage.id.trim().is_empty()
                || self.stages[..index].iter().any(|previous| previous.id == stage.id)
            {
                return Err(ManifestError::DuplicateStage(stage.id.clone()));
            }
            if stage.owner.trim().is_empty() {
                return Err(ManifestError::EmptyOwner { stage: stage.id.clone() });
            }
            if let Some(input) = &stage.input
                && !self.stages[..index].iter().any(|previous| previous.id == *input)
            {
                return Err(ManifestError::InvalidInput {
                    stage: stage.id.clone(),
                    input: input.clone(),
                });
            }
        }
        Ok(())
    }

    /// Serialize a validated manifest for FFI or a host binding.
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> PipelineManifest {
        PipelineManifest {
            id: "ds-inspect".into(),
            platform: "ds".into(),
            stages: vec![
                Stage {
                    id: "inspect".into(),
                    kind: StageKind::Inspect,
                    owner: "iecode-formats".into(),
                    input: None,
                },
                Stage {
                    id: "extract".into(),
                    kind: StageKind::Extract,
                    owner: "ninfs".into(),
                    input: Some("inspect".into()),
                },
            ],
        }
    }

    #[test]
    fn validates_ordered_pipeline_and_camel_case_json() {
        let manifest = sample();
        manifest.validate().unwrap();
        let json = manifest.to_json().unwrap();
        assert!(json.contains("\"platform\":\"ds\""));
        assert!(json.contains("\"input\":\"inspect\""));
    }

    #[test]
    fn rejects_forward_dependencies_and_duplicate_stages() {
        let mut manifest = sample();
        manifest.stages[0].input = Some("extract".into());
        assert!(matches!(manifest.validate(), Err(ManifestError::InvalidInput { .. })));

        let mut duplicate = sample();
        duplicate.stages[1].id = "inspect".into();
        assert!(matches!(duplicate.validate(), Err(ManifestError::DuplicateStage(_))));
    }
}
