// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Deterministic PP-OCR ONNX recognition primitives.
//!
//! The PP-OCRv5 recognizer has 18,383 configured glyphs plus CTC blank and
//! space classes. The mapping is loaded from the downloaded export, never
//! embedded approximately.

#![forbid(unsafe_code)]
#![warn(clippy::pedantic)]
#![warn(missing_docs)]
#![allow(clippy::module_name_repetitions)]

mod ctc;
mod detector;
mod error;
mod pipeline;
mod recognizer;

pub use ctc::{CtcDecoder, DecodedText};
pub use detector::{DetectedRegion, DetectionMap, PpOcrDetector};
pub use error::{OnnxOcrError, Result};
pub use pipeline::{PpOcr, RecognisedRegion};
pub use recognizer::{PpOcrRecognizer, Recognition};

/// Catalog id used when a caller does not name a PP-OCR model: paired
/// detector and recognizer weights for the fast deterministic ONNX path.
/// Restated by `aphrody-ocr` (as `DEFAULT_PPOCR_MODEL`) and by every
/// OCR-serving crate that offers this backend, so the literal is never
/// repeated.
pub const DEFAULT_MODEL: &str = "ppocr-v5-mobile";
