// SPDX-License-Identifier: Apache-2.0
//! `aphrody_describe_image` — visual transcription over MCP.
//!
//! Backed by [`aphrody_vision`], which drives the same local GGUF models as the
//! OCR path. Where [`crate::ocr_tools`] answers "what does this page say", this
//! answers "what am I looking at".
//!
//! # Why this is a separate tool from `aphrody_ocr`
//!
//! Not for convenience — for correctness. The two tools grant the model
//! *different permissions*:
//!
//! - `aphrody_ocr` may not describe. A page with no readable text comes back as `markdown: null`,
//!   never as a caption, because a caption filed as a transcription corrupts a corpus in a way no
//!   later pass can detect.
//! - `aphrody_describe_image` may describe — that is the whole request.
//!
//! Merging them behind one tool with a flag would put that distinction one
//! wrong argument away from being erased. `aphrody_vision` enforces the same
//! asymmetry ahead of inference: a document model asked for a caption is
//! refused outright, because it *will* answer, in prose that reads like a
//! description and is not one.
//!
//! # Tool contract
//!
//! Input (exactly one of `image_path` / `image_base64`):
//! ```json
//! { "image_path": "C:/shots/screen.png", "mode": "caption" }
//! { "image_path": "C:/shots/screen.png", "mode": "vqa",
//!   "question": "which window is focused?" }
//! ```
//! Output:
//! ```json
//! { "image": "...", "mode": "caption", "model": "smolvlm-500m-q8",
//!   "text": "A terminal showing a build log.",
//!   "description": { "kind": "caption", "answer": { … } },
//!   "elapsed_ms": 900 }
//! ```
//!
//! `text` is the flattened prose, for a caller that just wants a line;
//! `description` is the structured verdict, including per-region boxes in
//! `dense_region` mode and the "no answer" case rather than an empty string.
//!
//! # Platform gating
//!
//! Native-only: the backend spawns a child process, which wasm32 cannot do.

#![cfg(not(target_arch = "wasm32"))]

use base64::Engine as _;
use rmcp::schemars::{self, JsonSchema};
use serde::{Deserialize, Serialize};
use serde_json::json;

/// Default model: [`aphrody_models::LocalRole::Vision`]. A describing model,
/// not a document one, so it can serve every mode this tool exposes — the
/// point of a default is that it never lands the caller on a refusal they
/// have to debug.
const DEFAULT_MODEL: &str = aphrody_models::LocalRole::Vision.default_model();

/// Hard cap on a decoded inline image (16 MiB). Stops a runaway base64 blob
/// from exhausting the MCP process.
const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;

/// Token ceiling, matching the OCR tool so the two behave alike.
const MAX_TOKENS_CEILING: u32 = 8192;

/// Cap on a VQA question. A prompt longer than this is not a question.
const MAX_QUESTION_BYTES: usize = 4096;

/// Input schema for `aphrody_describe_image`.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
pub(crate) struct DescribeImageRequest {
    /// Path to an image already on this machine.
    #[schemars(description = "Absolute path to the image. Mutually exclusive with image_base64.")]
    #[serde(default)]
    pub image_path: Option<String>,

    /// Inline image bytes, base64-encoded.
    #[schemars(
        description = "Base64-encoded image bytes. Mutually exclusive with image_path. \
                              Max 16 MiB decoded."
    )]
    #[serde(default)]
    pub image_base64: Option<String>,

    /// What to ask of the image.
    #[schemars(
        description = "caption (one short description), dense_region (per-region \
                              descriptions with boxes), full_page_ocr (text only, never a \
                              description), or vqa (needs `question`). Default caption."
    )]
    #[serde(default)]
    pub mode: Option<String>,

    /// The question, required in `vqa` mode.
    #[schemars(
        description = "The question to ask about the image. Required when mode is vqa, \
                              rejected otherwise."
    )]
    #[serde(default)]
    pub question: Option<String>,

    /// Catalog id of the vision model.
    #[schemars(
        description = "Catalog id of the vision model. Default smolvlm-500m-q8. A \
                              document model such as granite-docling-258m is refused for \
                              caption/vqa: it answers, but not with what you asked for."
    )]
    #[serde(default)]
    pub model: Option<String>,

    /// Token budget.
    #[schemars(description = "Max tokens generated. Defaults to the mode's budget, ceiling 8192.")]
    #[serde(default)]
    pub max_tokens: Option<u32>,

    /// Keep the model's raw stdout, for auditing a surprising answer.
    #[schemars(description = "Include the model's raw stdout in the response. Default false.")]
    #[serde(default)]
    pub keep_raw: Option<bool>,
}

fn pretty(value: &serde_json::Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}

fn error_envelope(code: &str, reason: impl Into<String>) -> String {
    pretty(&json!({ "error": code, "reason": reason.into() }))
}

/// The image on disk, plus the scratch directory keeping an inline payload
/// alive for the call.
#[derive(Debug)]
struct Source {
    path: std::path::PathBuf,
    /// Dropped (and deleted) when the call returns. Held, never read.
    _scratch: Option<tempfile::TempDir>,
}

/// Materialise the request's image: the backend hands a path to a child
/// process, so an inline payload has to become a real file.
fn resolve_source(req: &DescribeImageRequest) -> Result<Source, String> {
    match (req.image_path.as_deref(), req.image_base64.as_deref()) {
        (Some(path), None) => {
            let path = std::path::PathBuf::from(path);
            if !path.is_file() {
                return Err(format!(
                    "image_path {} is not a readable file",
                    path.display()
                ));
            }
            Ok(Source {
                path,
                _scratch: None,
            })
        }
        (None, Some(encoded)) => {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(encoded.as_bytes())
                .map_err(|e| format!("image_base64 decode failed: {e}"))?;
            if bytes.is_empty() {
                return Err("image payload is empty after base64 decode".to_owned());
            }
            if bytes.len() > MAX_IMAGE_BYTES {
                return Err(format!(
                    "image is {}B (> max {MAX_IMAGE_BYTES}B)",
                    bytes.len()
                ));
            }
            let dir =
                tempfile::tempdir().map_err(|e| format!("cannot create a work directory: {e}"))?;
            let path = dir.path().join("image.png");
            std::fs::write(&path, &bytes)
                .map_err(|e| format!("cannot stage the inline image: {e}"))?;
            Ok(Source {
                path,
                _scratch: Some(dir),
            })
        }
        (Some(_), Some(_)) => Err("image_path and image_base64 are mutually exclusive".to_owned()),
        (None, None) => Err("one of image_path or image_base64 is required".to_owned()),
    }
}

/// Build the mode from the request.
///
/// A `question` outside `vqa` is rejected rather than ignored: silently
/// dropping it would answer a different question than the caller asked, and
/// they would have no way to tell from the response.
fn resolve_mode(req: &DescribeImageRequest) -> Result<aphrody_vision::VisionMode, String> {
    let raw = req
        .mode
        .as_deref()
        .unwrap_or("caption")
        .trim()
        .to_ascii_lowercase();
    let question = req
        .question
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty());

    match raw.as_str() {
        "vqa" => {
            let question = question.ok_or("mode vqa requires a non-empty `question`")?;
            if question.len() > MAX_QUESTION_BYTES {
                return Err(format!(
                    "question is {}B (> max {MAX_QUESTION_BYTES}B)",
                    question.len()
                ));
            }
            Ok(aphrody_vision::VisionMode::Vqa {
                question: question.to_owned(),
            })
        }
        other => {
            if question.is_some() {
                return Err(format!(
                    "`question` is only meaningful in mode vqa, not `{other}`"
                ));
            }
            match other {
                "caption" => Ok(aphrody_vision::VisionMode::Caption),
                "dense_region" | "dense-region" => Ok(aphrody_vision::VisionMode::DenseRegion),
                "full_page_ocr" | "full-page-ocr" => Ok(aphrody_vision::VisionMode::FullPageOcr),
                unknown => Err(format!(
                    "unknown mode `{unknown}` (expected caption, dense_region, full_page_ocr, vqa)"
                )),
            }
        }
    }
}

/// Dispatch the `aphrody_describe_image` tool body.
pub(crate) async fn describe(req: DescribeImageRequest) -> String {
    let source = match resolve_source(&req) {
        Ok(s) => s,
        Err(reason) => return error_envelope("VISION_BAD_REQUEST", reason),
    };
    let mode = match resolve_mode(&req) {
        Ok(m) => m,
        Err(reason) => return error_envelope("VISION_BAD_REQUEST", reason),
    };

    let model = req
        .model
        .clone()
        .unwrap_or_else(|| DEFAULT_MODEL.to_owned());
    if model.trim().is_empty() {
        return error_envelope(
            "VISION_BAD_REQUEST",
            "model must be non-empty when provided",
        );
    }

    let mut options = aphrody_vision::VisionOptions::new(&model, mode);
    if let Some(tokens) = req.max_tokens {
        if tokens == 0 || tokens > MAX_TOKENS_CEILING {
            return error_envelope(
                "VISION_BAD_REQUEST",
                format!("max_tokens must be in 1..={MAX_TOKENS_CEILING} (got {tokens})"),
            );
        }
        options.max_tokens = tokens;
    }
    options.keep_raw = req.keep_raw.unwrap_or(false);

    // Loading a vision model and generating is seconds of blocking work in a
    // child process; on the reactor it would stall every other MCP tool.
    let image = source.path.clone();
    let joined = tokio::task::spawn_blocking(move || {
        let describer = aphrody_vision::Describer::new(options)?;
        describer.describe(&image)
    })
    .await;
    drop(source);

    let report = match joined {
        Ok(Ok(report)) => report,
        // A refused mode and a missing model are the caller's to act on, and
        // both carry the exact remedy in their message, so they are surfaced
        // under their own codes rather than as a generic backend failure.
        Ok(Err(err @ aphrody_vision::VisionError::ModeUnsupported { .. })) => {
            return error_envelope("VISION_MODE_UNSUPPORTED", err.to_string());
        }
        Ok(Err(err @ aphrody_vision::VisionError::ModelNotInstalled { .. })) => {
            return error_envelope("VISION_MODEL_NOT_INSTALLED", err.to_string());
        }
        Ok(Err(err)) => return error_envelope("VISION_BACKEND_ERROR", err.to_string()),
        Err(err) => {
            return error_envelope("VISION_INTERNAL", format!("vision task panicked: {err}"));
        }
    };

    // Both shapes are returned on purpose: `text` for a caller that wants one
    // line, `description` for one that needs the regions, the boxes, or the
    // "no answer" verdict that a flattened string cannot express.
    pretty(&json!({
        "image": report.image.display().to_string(),
        "mode": report.mode,
        "model": report.model_id,
        "text": report.description.as_text(),
        "description": report.description,
        "elapsed_ms": report.elapsed_ms,
        "raw": report.raw,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank() -> DescribeImageRequest {
        DescribeImageRequest {
            image_path: None,
            image_base64: None,
            mode: None,
            question: None,
            model: None,
            max_tokens: None,
            keep_raw: None,
        }
    }

    #[test]
    fn schema_exposes_the_documented_fields() {
        let schema = rmcp::schemars::schema_for!(DescribeImageRequest);
        let json = serde_json::to_string(&schema).expect("schema serialise");
        for field in [
            "image_path",
            "image_base64",
            "mode",
            "question",
            "model",
            "max_tokens",
            "keep_raw",
        ] {
            assert!(
                json.contains(&format!("\"{field}\"")),
                "schema missing {field}: {json}"
            );
        }
    }

    #[test]
    fn the_default_mode_is_caption() {
        assert!(matches!(
            resolve_mode(&blank()),
            Ok(aphrody_vision::VisionMode::Caption)
        ));
    }

    #[test]
    fn every_documented_mode_parses_including_its_hyphenated_spelling() {
        for (raw, expected) in [
            ("caption", aphrody_vision::ModeKind::Caption),
            ("dense_region", aphrody_vision::ModeKind::DenseRegion),
            ("dense-region", aphrody_vision::ModeKind::DenseRegion),
            ("full_page_ocr", aphrody_vision::ModeKind::FullPageOcr),
            ("full-page-ocr", aphrody_vision::ModeKind::FullPageOcr),
        ] {
            let req = DescribeImageRequest {
                mode: Some(raw.to_owned()),
                ..blank()
            };
            let mode = resolve_mode(&req).unwrap_or_else(|e| panic!("mode `{raw}` rejected: {e}"));
            assert_eq!(mode.kind(), expected, "for `{raw}`");
        }
    }

    #[test]
    fn mode_parsing_is_case_and_whitespace_insensitive() {
        let req = DescribeImageRequest {
            mode: Some("  CAPTION ".to_owned()),
            ..blank()
        };
        assert!(matches!(
            resolve_mode(&req),
            Ok(aphrody_vision::VisionMode::Caption)
        ));
    }

    #[test]
    fn vqa_without_a_question_is_refused_rather_than_silently_captioned() {
        let req = DescribeImageRequest {
            mode: Some("vqa".to_owned()),
            ..blank()
        };
        let err = resolve_mode(&req).unwrap_err();
        assert!(err.contains("question"), "{err}");
    }

    #[test]
    fn a_blank_question_does_not_count_as_a_question() {
        let req = DescribeImageRequest {
            mode: Some("vqa".to_owned()),
            question: Some("   ".to_owned()),
            ..blank()
        };
        assert!(resolve_mode(&req).is_err());
    }

    /// Dropping a question the caller sent would answer something else and
    /// give them no way to notice from the response.
    #[test]
    fn a_question_outside_vqa_is_an_error_not_an_ignored_field() {
        let req = DescribeImageRequest {
            mode: Some("caption".to_owned()),
            question: Some("what is this?".to_owned()),
            ..blank()
        };
        let err = resolve_mode(&req).unwrap_err();
        assert!(err.contains("vqa"), "{err}");
    }

    #[test]
    fn an_unknown_mode_lists_the_valid_ones() {
        let req = DescribeImageRequest {
            mode: Some("describe-please".to_owned()),
            ..blank()
        };
        let err = resolve_mode(&req).unwrap_err();
        for expected in ["caption", "dense_region", "full_page_ocr", "vqa"] {
            assert!(err.contains(expected), "`{expected}` missing from: {err}");
        }
    }

    #[test]
    fn an_oversize_question_is_capped() {
        let req = DescribeImageRequest {
            mode: Some("vqa".to_owned()),
            question: Some("q".repeat(MAX_QUESTION_BYTES + 1)),
            ..blank()
        };
        assert!(resolve_mode(&req).unwrap_err().contains("max"));
    }

    #[test]
    fn an_image_is_required_and_the_two_ways_are_exclusive() {
        assert!(resolve_source(&blank()).unwrap_err().contains("required"));
        let both = DescribeImageRequest {
            image_path: Some("a.png".to_owned()),
            image_base64: Some("Zm9v".to_owned()),
            ..blank()
        };
        assert!(
            resolve_source(&both)
                .unwrap_err()
                .contains("mutually exclusive")
        );
    }

    #[test]
    fn a_missing_file_is_named_in_the_error() {
        let req = DescribeImageRequest {
            image_path: Some("Z:/nope/absent.png".to_owned()),
            ..blank()
        };
        assert!(resolve_source(&req).unwrap_err().contains("absent.png"));
    }

    #[test]
    fn undecodable_base64_is_rejected_before_any_model_load() {
        let req = DescribeImageRequest {
            image_base64: Some("not base64!!".to_owned()),
            ..blank()
        };
        assert!(resolve_source(&req).unwrap_err().contains("decode"));
    }

    #[test]
    fn an_inline_image_is_staged_as_a_real_file_for_the_child_process() {
        let png = base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\nstub");
        let req = DescribeImageRequest {
            image_base64: Some(png),
            ..blank()
        };
        let source = resolve_source(&req).expect("inline image must stage");
        assert!(source.path.is_file(), "{}", source.path.display());
        assert!(
            source._scratch.is_some(),
            "the scratch dir must outlive the call"
        );
    }

    #[tokio::test]
    async fn a_bad_request_never_reaches_the_backend() {
        // No image at all: the response must be a request error, not a
        // backend or model error, on a machine with no model installed.
        let body = describe(blank()).await;
        let parsed: serde_json::Value = serde_json::from_str(&body).expect("valid JSON");
        assert_eq!(parsed["error"], "VISION_BAD_REQUEST", "{body}");
    }
}
