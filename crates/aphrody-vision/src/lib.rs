// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Visual transcription over local vision models: what am I looking at?
//!
//! Where `aphrody-ocr` answers *what does this page say*, this crate answers
//! *what is in this image*, in four modes: [`VisionMode::Caption`],
//! [`VisionMode::DenseRegion`], [`VisionMode::FullPageOcr`] and
//! [`VisionMode::Vqa`].
//!
//! # The asymmetry this crate is built around
//!
//! A vision model shown an image with no text in it does not say "there is no
//! text": it describes the picture, fluently and at length. That is the right
//! answer for a caption and a corpus-corrupting one for a transcription — a
//! description filed as page text is wrong in a way nobody notices until the
//! data is read by someone else.
//!
//! So the two paths are deliberately not symmetric:
//!
//! * [`VisionMode::Caption`] and [`VisionMode::Vqa`] **may describe**. Their answers are classified
//!   by [`quality::classify`], which rejects only degenerate output (a stuck loop, the filler motif
//!   a model emits for glyphs it cannot read) — never mere absence of text in the image.
//! * [`VisionMode::FullPageOcr`] **may not describe**. It delegates verbatim to `aphrody-ocr-vlm`
//!   and forwards its [`PageText`] unchanged, so that `PageText::None` — "this page holds no text"
//!   — reaches the caller as a verdict rather than being softened into an empty string or, worse,
//!   into whatever the model felt like saying about the illustration.
//!
//! The same asymmetry is enforced ahead of inference: a document model is
//! refused [`VisionMode::Caption`] outright, because it *will* answer, in
//! prose that reads like a description and is not one.
//!
//! # Nothing is downloaded, ever
//!
//! Weights are resolved from the `aphrody-models` store. A model that is not
//! installed produces [`VisionError::ModelNotInstalled`], which carries the
//! exact `aphrody model pull <id>` command; pulling hundreds of megabytes in
//! the middle of an inference call would be a network decision taken on behalf
//! of a caller who asked for a local, offline path.
//!
//! # Example
//!
//! ```no_run
//! use aphrody_vision::{Describer, VisionMode, VisionOptions};
//!
//! let describer = Describer::new(VisionOptions::new("smolvlm-500m-q8", VisionMode::Caption))?;
//! let report = describer.describe(std::path::Path::new("screenshot.png"))?;
//! println!("{}", report.description.as_text().unwrap_or_default());
//! # Ok::<(), aphrody_vision::VisionError>(())
//! ```

#![forbid(unsafe_code)]
#![warn(clippy::pedantic)]
#![warn(missing_docs)]
#![allow(clippy::module_name_repetitions)]

/// Screenshot input (feature `capture`, real backend on Windows only).
#[cfg(feature = "capture")]
pub mod capture;
/// Driving a local vision model over an image.
pub mod describe;
/// Modes, model families and the prompt each pair calls for.
pub mod mode;
/// Telling an answer apart from a degenerate generation.
pub mod quality;
/// Regions and their bounding boxes.
pub mod region;

/// Re-exported so a consumer can match the textless verdict without also
/// depending on the OCR backend crate.
pub use aphrody_ocr_vlm::PageText;
pub use describe::{
    DEFAULT_CAPTION_MODEL, DEFAULT_DOCUMENT_MODEL, Describer, Description, VisionOptions,
    VisionReport, pull_command,
};
pub use mode::{Family, ModeKind, VisionMode};
pub use quality::{Answer, Unusable};
pub use region::{BBox, Region};

/// Error returned by the visual transcription surface.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum VisionError {
    /// The model was not trained to answer this mode.
    #[error(
        "`{model_id}` cannot serve mode `{mode:?}` — it will answer, but not with what you asked \
         for; use `{alternative}` instead"
    )]
    ModeUnsupported {
        /// The mode that was asked for.
        mode: ModeKind,
        /// The model that cannot serve it.
        model_id: String,
        /// A catalog id that can.
        alternative: &'static str,
    },

    /// The model's weights are not on this machine.
    #[error("model `{model_id}` is not installed — run `{command}`")]
    ModelNotInstalled {
        /// The catalog id.
        model_id: String,
        /// The command that installs it.
        command: String,
    },

    /// The llama.cpp backend failed.
    #[error("{0}")]
    Backend(#[from] aphrody_ocr_vlm::OcrError),

    /// Screen or window capture failed.
    #[cfg(feature = "capture")]
    #[error("capture failed: {0}")]
    Capture(#[from] aphrody_capture::CaptureError),

    /// A filesystem operation failed.
    #[error("i/o error on `{path}`: {source}")]
    Io {
        /// The path involved.
        path: std::path::PathBuf,
        /// The underlying error.
        #[source]
        source: std::io::Error,
    },
}

/// Result alias for this crate.
pub type Result<T> = core::result::Result<T, VisionError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unsupported_mode_error_says_what_to_use_instead() {
        let error = VisionError::ModeUnsupported {
            mode: ModeKind::Caption,
            model_id: "granite-docling-258m".into(),
            alternative: "smolvlm-500m-q8",
        };
        let rendered = error.to_string();
        assert!(rendered.contains("granite-docling-258m"), "{rendered}");
        assert!(rendered.contains("smolvlm-500m-q8"), "{rendered}");
    }

    #[test]
    fn a_missing_model_error_carries_a_runnable_command() {
        let error = VisionError::ModelNotInstalled {
            model_id: "smolvlm-500m-q8".into(),
            command: pull_command("smolvlm-500m-q8"),
        };
        assert!(
            error
                .to_string()
                .contains("aphrody model pull smolvlm-500m-q8")
        );
    }

    #[test]
    fn the_textless_verdict_is_reachable_without_the_ocr_crate() {
        // Consumers branch on this; re-exporting it keeps them off a direct
        // dependency on the backend they are not supposed to drive.
        assert!(!PageText::None.has_text());
    }
}
