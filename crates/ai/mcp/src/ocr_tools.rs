// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! `aphrody_ocr` — local vision-language OCR over MCP.
//!
//! Backed by [`aphrody_ocr_vlm::VlmRunner`], which drives a GGUF vision model
//! through llama.cpp's `llama-mtmd-cli`. Nothing here downloads anything: the
//! runner resolves an already-installed catalog entry, and a missing artefact
//! is reported as a structured error naming the `aphrody model pull` that
//! fixes it.
//!
//! # The distinction this tool must not erase
//!
//! A page with no readable text is **not** a page transcribed to the empty
//! string, and it is certainly not a description of the picture. The crate
//! carries that distinction in [`PageText::None`]; this tool forwards it as an
//! explicit `"markdown": null` plus `"textless": true`. Collapsing the two is
//! how a caption ends up committed to a corpus as if it were a transcription —
//! a wrong claim that no later pass can detect, because it reads as text.
//!
//! # The other way a bad reading looks fine
//!
//! A vision model can also get **stuck**, returning one sentence repeated
//! until the token budget runs out. That was observed on this machine, with
//! granite-docling, on a three-line image. It is text, so `textless` is false
//! and nothing about the response looks wrong. Every transcription is
//! therefore audited on the way out ([`aphrody_ocr_core::audit`]) and the
//! response carries `suspect` plus the individual `findings`.
//!
//! The audit **annotates, it does not filter**: suppressing flagged text would
//! return nothing for a page that does hold text, and would leave no trace of
//! what was dropped. The caller decides.
//!
//! # Tool contract
//!
//! Input (exactly one of `image_path` / `image_base64`):
//! ```json
//! { "image_path": "C:/plates/p001.png", "model": "granite-docling-258m" }
//! ```
//! Output:
//! ```json
//! { "image": "...", "markdown": "# Title\n…", "textless": false,
//!   "suspect": false, "findings": [],
//!   "elapsed_ms": 1200, "model": "granite-docling-258m" }
//! ```
//!
//! # Platform gating
//!
//! Native-only: the runner spawns a child process, which wasm32 cannot do.

#![cfg(not(target_arch = "wasm32"))]

use base64::Engine;
use rmcp::schemars::{self, JsonSchema};
use serde::{Deserialize, Serialize};
use serde_json::json;

/// Default vision model: [`aphrody_ocr::DEFAULT_VLM_MODEL`], restated here so
/// the MCP schema documents a concrete id to callers.
const DEFAULT_VLM_MODEL: &str = aphrody_ocr::DEFAULT_VLM_MODEL;

/// Default PP-OCRv5 model for the fast deterministic ONNX path:
/// [`aphrody_ocr::DEFAULT_PPOCR_MODEL`].
const DEFAULT_PPOCR_MODEL: &str = aphrody_ocr::DEFAULT_PPOCR_MODEL;

/// Hard cap on a decoded inline image (16 MiB). A page scan is ~1-4 MiB; the
/// cap exists so one oversized base64 blob cannot exhaust the MCP process,
/// which serves every other tool from the same address space.
const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;

/// Ceiling on the per-page token budget. A runaway generation burns GPU time
/// on a page that has nothing to say.
const MAX_TOKENS_CEILING: u32 = 8192;

/// Input schema for `aphrody_ocr`.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
pub(crate) struct OcrReadRequest {
    /// Path to the image on the machine running the MCP server.
    #[schemars(description = "Filesystem path to the image to read. Mutually exclusive with \
                              image_base64; exactly one of the two is required.")]
    #[serde(default)]
    pub image_path: Option<String>,

    /// Inline image bytes, standard base64 (padded). Max 16 MiB decoded.
    #[schemars(description = "Base64-encoded image bytes (standard alphabet, padded). Max 16 \
                              MiB after decode. Mutually exclusive with image_path.")]
    #[serde(default)]
    pub image_base64: Option<String>,

    /// Catalog id of the vision model.
    #[schemars(description = "Catalog id of the vision or PP-OCR model (default \
                              granite-docling-258m for VLM, or ppocr-v5-mobile for PP-OCR). The \
                              weights must already be installed: run `aphrody model pull <id>`.")]
    #[serde(default)]
    pub model: Option<String>,

    /// OCR execution engine to select ("auto", "ppocr", "vlm").
    #[schemars(description = "OCR execution engine: 'auto' (default, selects based on model), \
                              'ppocr' (deterministic fast ONNX pipeline), or 'vlm' \
                              (vision-language model through llama.cpp).")]
    #[serde(default)]
    pub engine: Option<String>,

    /// Override the trained prompt. Rarely correct — see the crate docs.
    #[schemars(description = "Override the model's trained prompt. Leave unset: the prompt is \
                              not interchangeable between model families, and a wrong prompt \
                              looks exactly like a page with no text.")]
    #[serde(default)]
    pub prompt: Option<String>,

    /// Token budget per page (default 1024, max 8192).
    #[schemars(description = "Max tokens generated for the page. Default 1024, ceiling 8192.")]
    #[serde(default)]
    pub max_tokens: Option<u32>,

    /// Return the model's raw output alongside the markdown, for auditing.
    #[schemars(description = "Include the model's raw stdout in the response, for auditing a \
                              surprising result. Default false.")]
    #[serde(default)]
    pub keep_raw: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OcrEngine {
    PpOcr,
    Vlm,
}

fn resolve_engine(
    engine_param: Option<&str>,
    model_param: Option<&str>,
) -> Result<(OcrEngine, String), String> {
    let raw_engine = engine_param.map(str::trim).unwrap_or("auto");
    let lower_engine = raw_engine.to_lowercase();
    match lower_engine.as_str() {
        "ppocr" => {
            let model = model_param
                .map(str::trim)
                .filter(|m| !m.is_empty())
                .unwrap_or(DEFAULT_PPOCR_MODEL)
                .to_owned();
            Ok((OcrEngine::PpOcr, model))
        },
        "vlm" => {
            let model = model_param
                .map(str::trim)
                .filter(|m| !m.is_empty())
                .unwrap_or(DEFAULT_VLM_MODEL)
                .to_owned();
            Ok((OcrEngine::Vlm, model))
        },
        "auto" => {
            if let Some(m) = model_param.map(str::trim).filter(|m| !m.is_empty()) {
                if m.to_lowercase().contains("ppocr") {
                    Ok((OcrEngine::PpOcr, m.to_owned()))
                } else {
                    Ok((OcrEngine::Vlm, m.to_owned()))
                }
            } else {
                Ok((OcrEngine::Vlm, DEFAULT_VLM_MODEL.to_owned()))
            }
        },
        other => Err(format!("unknown engine '{other}': expected 'auto', 'ppocr', or 'vlm'")),
    }
}

fn pretty(value: &serde_json::Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}

fn error_envelope(code: &str, reason: impl Into<String>) -> String {
    pretty(&json!({ "error": code, "reason": reason.into() }))
}

/// The image to read, plus the temporary directory keeping an inline payload
/// alive for the duration of the call.
#[derive(Debug)]
struct Source {
    path: std::path::PathBuf,
    /// Dropped (and deleted) when the call returns. Held, never read.
    _scratch: Option<tempfile::TempDir>,
}

/// Materialise the request's image on disk: `VlmRunner::read` hands a path to
/// a child process, so an inline payload has to become a real file.
fn resolve_source(req: &OcrReadRequest) -> Result<Source, String> {
    match (req.image_path.as_deref(), req.image_base64.as_deref()) {
        (Some(path), None) => {
            let path = std::path::PathBuf::from(path);
            if !path.is_file() {
                return Err(format!("image_path {} is not a readable file", path.display()));
            }
            Ok(Source { path, _scratch: None })
        },
        (None, Some(encoded)) => {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(encoded.as_bytes())
                .map_err(|e| format!("image_base64 decode failed: {e}"))?;
            if bytes.is_empty() {
                return Err("image payload is empty after base64 decode".to_owned());
            }
            if bytes.len() > MAX_IMAGE_BYTES {
                return Err(format!("image is {}B (> max {MAX_IMAGE_BYTES}B)", bytes.len()));
            }
            let dir =
                tempfile::tempdir().map_err(|e| format!("cannot create a work directory: {e}"))?;
            // The extension matters: llama.cpp's mtmd loader sniffs content,
            // but a plausible name keeps the child's diagnostics readable.
            let path = dir.path().join("page.png");
            std::fs::write(&path, &bytes)
                .map_err(|e| format!("cannot stage the inline image: {e}"))?;
            Ok(Source { path, _scratch: Some(dir) })
        },
        (Some(_), Some(_)) => Err("image_path and image_base64 are mutually exclusive".to_owned()),
        (None, None) => Err("one of image_path or image_base64 is required".to_owned()),
    }
}

/// Dispatch the `aphrody_ocr` tool body.
pub(crate) async fn read(req: OcrReadRequest) -> String {
    let source = match resolve_source(&req) {
        Ok(s) => s,
        Err(reason) => return error_envelope("OCR_BAD_REQUEST", reason),
    };

    if let Some(ref m) = req.model
        && m.trim().is_empty()
    {
        return error_envelope("OCR_BAD_REQUEST", "model must be non-empty when provided");
    }
    if let Some(ref e) = req.engine
        && e.trim().is_empty()
    {
        return error_envelope("OCR_BAD_REQUEST", "engine must be non-empty when provided");
    }

    let (engine, model) = match resolve_engine(req.engine.as_deref(), req.model.as_deref()) {
        Ok(pair) => pair,
        Err(reason) => return error_envelope("OCR_BAD_REQUEST", reason),
    };

    match engine {
        OcrEngine::PpOcr => {
            let image = source.path.clone();
            let model_id = model.clone();
            let keep_raw = req.keep_raw.unwrap_or(false);
            let joined = tokio::task::spawn_blocking(move || {
                let started = std::time::Instant::now();
                let profile = aphrody_models::accel::probe();
                let config = aphrody_infer::SessionConfig::from_profile(&profile);
                let mut runner = match aphrody_ocr::PpOcr::load(&model_id, &config) {
                    Ok(runner) => runner,
                    Err(error)
                        if config
                            .providers
                            .first()
                            .is_some_and(|p| *p != aphrody_models::Accelerator::Cpu) =>
                    {
                        tracing::warn!(%error, "PP-OCR load failed on preferred provider; retrying on CPU");
                        let cpu =
                            aphrody_infer::SessionConfig::with_only(aphrody_models::Accelerator::Cpu);
                        aphrody_ocr::PpOcr::load(&model_id, &cpu).map_err(|e| anyhow::anyhow!("{e}"))?
                    },
                    Err(err) => return Err(anyhow::anyhow!("{err}")),
                };
                let providers = runner.providers();
                let runner_name = if providers[0] == providers[1] {
                    format!("ppocr-onnx ({})", providers[0].as_str())
                } else {
                    format!("ppocr-onnx ({}, {})", providers[0].as_str(), providers[1].as_str())
                };
                let regions =
                    runner.recognise_path(&image).map_err(|e| anyhow::anyhow!("{e}"))?;
                let elapsed_ms = started.elapsed().as_millis();
                Ok::<_, anyhow::Error>((regions, runner_name, elapsed_ms))
            })
            .await;
            let image_path = source.path.display().to_string();
            drop(source);

            let (regions, runner_name, elapsed_ms) = match joined {
                Ok(Ok(tuple)) => tuple,
                Ok(Err(err)) => return error_envelope("OCR_BACKEND_ERROR", err.to_string()),
                Err(err) => {
                    return error_envelope("OCR_INTERNAL", format!("OCR task panicked: {err}"));
                },
            };

            let texts = regions
                .iter()
                .map(|r| r.recognition.decoded.text.trim())
                .filter(|t| !t.is_empty())
                .collect::<Vec<_>>();
            let markdown = if texts.is_empty() { None } else { Some(texts.join("\n\n")) };

            let findings =
                markdown.as_deref().map(aphrody_ocr_core::audit::audit_text).unwrap_or_default();
            let blocking = findings.iter().any(aphrody_ocr_core::audit::Finding::is_blocking);

            let raw = if keep_raw {
                let blocks = regions.into_iter().map(aphrody_ocr::PpOcr::block).collect::<Vec<_>>();
                serde_json::to_string(&blocks).ok()
            } else {
                None
            };

            pretty(&json!({
                "image": image_path,
                "markdown": markdown,
                "textless": markdown.is_none(),
                "suspect": blocking,
                "findings": findings,
                "elapsed_ms": elapsed_ms,
                "model": model,
                "runner": runner_name,
                "raw": raw,
            }))
        },
        OcrEngine::Vlm => {
            let mut options = aphrody_ocr_vlm::OcrOptions::for_model(&model);
            if let Some(prompt) = req.prompt.as_deref() {
                if prompt.trim().is_empty() {
                    return error_envelope(
                        "OCR_BAD_REQUEST",
                        "prompt must be non-empty when provided",
                    );
                }
                prompt.clone_into(&mut options.prompt);
            }
            if let Some(tokens) = req.max_tokens {
                if tokens == 0 || tokens > MAX_TOKENS_CEILING {
                    return error_envelope(
                        "OCR_BAD_REQUEST",
                        format!("max_tokens must be in 1..={MAX_TOKENS_CEILING} (got {tokens})"),
                    );
                }
                options.max_tokens = tokens;
            }
            options.keep_raw = req.keep_raw.unwrap_or(false);

            // Model load + a full page of generation is seconds of blocking CPU/GPU
            // work in a child process; running it on the async reactor would stall
            // every other MCP tool sharing this runtime.
            let image = source.path.clone();
            let joined = tokio::task::spawn_blocking(move || {
                let runner = aphrody_ocr_vlm::VlmRunner::new(options)?;
                let binary = runner.binary().display().to_string();
                runner.read(&image).map(|page| (page, binary))
            })
            .await;
            drop(source);

            let (page, binary) = match joined {
                Ok(Ok(pair)) => pair,
                Ok(Err(err)) => return error_envelope("OCR_BACKEND_ERROR", err.to_string()),
                Err(err) => {
                    return error_envelope("OCR_INTERNAL", format!("OCR task panicked: {err}"));
                },
            };

            // `markdown: null` + `textless: true` is the whole point of this tool: a
            // plate with no readable text must never arrive as an empty string, which
            // reads as "transcribed to nothing".
            let markdown = page.text.markdown();

            // Every transcription is audited before it leaves the process. This is not
            // theoretical: granite-docling was observed here returning one sentence
            // repeated five times for a three-line image. Handing that to a caller as
            // plain markdown is how a degenerate generation ends up deposited in a
            // corpus as if it were a reading.
            //
            // The findings ANNOTATE, they do not filter. Dropping the text would make
            // the tool silently return nothing for a page that does hold text, and a
            // detector that removes what it flags leaves no trace of what it removed
            // (CLAUDE.md §7). The caller gets the text, the verdict, and enough detail
            // to decide.
            let findings = markdown.map(aphrody_ocr_core::audit::audit_text).unwrap_or_default();
            let blocking = findings.iter().any(aphrody_ocr_core::audit::Finding::is_blocking);

            pretty(&json!({
                "image": page.image.display().to_string(),
                "markdown": markdown,
                "textless": markdown.is_none(),
                // True when the text carries a defect that should stop a deposit: a
                // stuck generation, a leaked control token, surviving markup.
                "suspect": blocking,
                "findings": findings,
                "elapsed_ms": page.elapsed_ms,
                "model": model,
                "runner": binary,
                "raw": page.raw,
            }))
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank(image_path: Option<&str>, image_base64: Option<&str>) -> OcrReadRequest {
        OcrReadRequest {
            image_path: image_path.map(ToOwned::to_owned),
            image_base64: image_base64.map(ToOwned::to_owned),
            model: None,
            engine: None,
            prompt: None,
            max_tokens: None,
            keep_raw: None,
        }
    }

    /// The exact failure observed on this machine: granite-docling handed back
    /// one sentence repeated five times for a three-line image. It is text, so
    /// `textless` stays false and nothing else in the response looks wrong —
    /// the audit is the only thing that says so.
    #[test]
    fn a_stuck_generation_is_flagged_rather_than_passed_off_as_a_reading() {
        let stuck = "the the the the the the the the the the";
        let findings = aphrody_ocr_core::audit::audit_text(stuck);
        assert!(
            findings.iter().any(|f| matches!(f, aphrody_ocr_core::audit::Finding::Loop { .. })),
            "a stuck generation must be reported: {findings:?}"
        );
        assert!(findings.iter().any(aphrody_ocr_core::audit::Finding::is_blocking));
    }

    /// And the audit must not cry wolf: ordinary prose has to come back clean,
    /// or every caller learns to ignore `suspect`.
    #[test]
    fn a_normal_reading_carries_no_blocking_finding() {
        let clean = "The quick brown fox jumps over the lazy dog.";
        let findings = aphrody_ocr_core::audit::audit_text(clean);
        assert!(
            !findings.iter().any(aphrody_ocr_core::audit::Finding::is_blocking),
            "ordinary prose must not be flagged: {findings:?}"
        );
    }

    /// A textless page has nothing to audit — and auditing `None` as if it
    /// were an empty string would invent a finding about a page that simply
    /// holds no text.
    #[test]
    fn a_textless_page_is_not_audited_into_a_finding() {
        let none = aphrody_ocr_vlm::PageText::None;
        let findings = none.markdown().map(aphrody_ocr_core::audit::audit_text).unwrap_or_default();
        assert!(findings.is_empty(), "{findings:?}");
    }

    #[test]
    fn schema_exposes_the_documented_fields() {
        let schema = rmcp::schemars::schema_for!(OcrReadRequest);
        let json = serde_json::to_string(&schema).expect("schema serialise");
        for field in
            ["image_path", "image_base64", "model", "engine", "prompt", "max_tokens", "keep_raw"]
        {
            assert!(json.contains(&format!("\"{field}\"")), "schema missing {field}: {json}");
        }
    }

    #[test]
    fn resolve_engine_correctly_routes() {
        assert_eq!(
            resolve_engine(None, None).unwrap(),
            (OcrEngine::Vlm, DEFAULT_VLM_MODEL.to_owned())
        );
        assert_eq!(
            resolve_engine(Some("auto"), None).unwrap(),
            (OcrEngine::Vlm, DEFAULT_VLM_MODEL.to_owned())
        );
        assert_eq!(
            resolve_engine(Some("auto"), Some("ppocr-v5-server")).unwrap(),
            (OcrEngine::PpOcr, "ppocr-v5-server".to_owned())
        );
        assert_eq!(
            resolve_engine(None, Some("ppocr-v5-mobile")).unwrap(),
            (OcrEngine::PpOcr, "ppocr-v5-mobile".to_owned())
        );
        assert_eq!(
            resolve_engine(Some("ppocr"), None).unwrap(),
            (OcrEngine::PpOcr, DEFAULT_PPOCR_MODEL.to_owned())
        );
        assert_eq!(
            resolve_engine(Some("ppocr"), Some("custom-ppocr")).unwrap(),
            (OcrEngine::PpOcr, "custom-ppocr".to_owned())
        );
        assert_eq!(
            resolve_engine(Some("vlm"), None).unwrap(),
            (OcrEngine::Vlm, DEFAULT_VLM_MODEL.to_owned())
        );
        assert_eq!(
            resolve_engine(Some("vlm"), Some("dots-ocr")).unwrap(),
            (OcrEngine::Vlm, "dots-ocr".to_owned())
        );
        assert!(resolve_engine(Some("invalid"), None).is_err());
    }

    #[test]
    fn exactly_one_image_source_is_accepted() {
        assert!(resolve_source(&blank(None, None)).is_err());
        assert!(resolve_source(&blank(Some("a.png"), Some("QQ=="))).is_err());
        assert!(resolve_source(&blank(Some("does-not-exist-xyz.png"), None)).is_err());
    }

    #[test]
    fn inline_payload_is_staged_on_disk() {
        // 1x1 transparent PNG, the smallest real image that proves the write
        // path rather than the base64 decoder alone.
        const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk\
                           YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
        let source = resolve_source(&blank(None, Some(PNG))).expect("stage inline image");
        assert!(source.path.is_file());
        let written = std::fs::read(&source.path).expect("read back");
        assert_eq!(&written[..8], b"\x89PNG\r\n\x1a\n");
        let staged = source.path.clone();
        drop(source);
        // The scratch directory must not outlive the call.
        assert!(!staged.exists());
    }

    #[test]
    fn oversized_and_empty_inline_payloads_are_refused() {
        let oversized =
            base64::engine::general_purpose::STANDARD.encode(vec![0u8; MAX_IMAGE_BYTES + 1]);
        let err = resolve_source(&blank(None, Some(&oversized))).unwrap_err();
        assert!(err.contains("max"), "unexpected reason: {err}");
        assert!(resolve_source(&blank(None, Some(""))).is_err());
        assert!(resolve_source(&blank(None, Some("not base64!!"))).is_err());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn missing_image_yields_a_structured_error() {
        let out = read(blank(None, None)).await;
        let value: serde_json::Value = serde_json::from_str(&out).expect("parse envelope");
        assert_eq!(value["error"], "OCR_BAD_REQUEST");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn out_of_range_token_budget_is_refused_before_touching_the_model() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("p.png");
        std::fs::write(&path, b"\x89PNG\r\n\x1a\n").expect("write");
        let mut req = blank(Some(&path.display().to_string()), None);
        req.max_tokens = Some(MAX_TOKENS_CEILING + 1);
        let value: serde_json::Value =
            serde_json::from_str(&read(req).await).expect("parse envelope");
        assert_eq!(value["error"], "OCR_BAD_REQUEST");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn invalid_engine_yields_structured_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("p.png");
        std::fs::write(&path, b"\x89PNG\r\n\x1a\n").expect("write");
        let mut req = blank(Some(&path.display().to_string()), None);
        req.engine = Some("unknown-engine".into());
        let value: serde_json::Value =
            serde_json::from_str(&read(req).await).expect("parse envelope");
        assert_eq!(value["error"], "OCR_BAD_REQUEST");
    }

    #[test]
    fn textless_pages_serialise_as_null_never_as_empty_string() {
        // The contract the corpus depends on, asserted on the crate type the
        // dispatcher forwards.
        let none = aphrody_ocr_vlm::PageText::None;
        assert!(none.markdown().is_none());
        let body = json!({ "markdown": none.markdown(), "textless": none.markdown().is_none() });
        assert!(body["markdown"].is_null(), "textless page must serialise as null: {body}");
        assert_eq!(body["textless"], true);

        let some = aphrody_ocr_vlm::PageText::Text { markdown: "# Plate".to_owned() };
        let body = json!({ "markdown": some.markdown(), "textless": some.markdown().is_none() });
        assert_eq!(body["markdown"], "# Plate");
        assert_eq!(body["textless"], false);
    }
}
