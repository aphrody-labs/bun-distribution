// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! `aphrody_transcribe` — fully local speech-to-text over MCP.
//!
//! Backed by [`aphrody_voice::stt::whisper_cpp::WhisperCppBackend`], which
//! spawns the upstream whisper.cpp release binary and resolves its weights
//! from a catalog id (`whisper-base-en`) through the `~/.aphrody` model store.
//!
//! # Why this is a second tool and not a flag on `voice_transcribe`
//!
//! `voice_transcribe` (see [`crate::voice_tools`]) is the *API* path: it tries
//! an in-process Whisper build and then falls back to a REST endpoint that
//! sends the caller's audio to a third party. That fallback is exactly what
//! makes it unsuitable as the local tool — a caller asking for local
//! transcription of private audio must not get a silent network upload when a
//! binary is missing. This tool never falls back: no runtime, no weights, no
//! transcription, and the error says which one is missing. Keeping both means
//! the choice is made by the tool name, at the call site, and is auditable.
//!
//! # Tool contract
//!
//! Input:
//! ```json
//! { "audio_base64": "<16 kHz mono WAV>", "model": "whisper-base-en", "language": "en" }
//! ```
//! Output:
//! ```json
//! { "text": "…", "language": "en", "duration_s": 3.2, "segments": [...],
//!   "backend": "whisper.cpp", "model": "whisper-base-en" }
//! ```
//!
//! # Platform gating
//!
//! Native-only: the backend spawns a child process.

#![cfg(not(target_arch = "wasm32"))]

use base64::Engine;
use rmcp::schemars::{self, JsonSchema};
use serde::{Deserialize, Serialize};
use serde_json::json;

/// Default catalog id: [`aphrody_models::LocalRole::Stt`].
const DEFAULT_MODEL: &str = aphrody_models::LocalRole::Stt.default_model();

/// Hard cap on decoded audio (64 MiB). At the 16 kHz mono 16-bit PCM the
/// backend requires that is roughly 35 minutes — long enough for real work,
/// small enough that one call cannot exhaust the MCP process.
const MAX_AUDIO_BYTES: usize = 64 * 1024 * 1024;

/// Input schema for `aphrody_transcribe`.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
pub(crate) struct LocalTranscribeRequest {
    /// Inline audio bytes, standard base64 (padded). Max 64 MiB decoded.
    #[schemars(
        description = "Base64-encoded audio (standard alphabet, padded). Max 64 MiB \
                              after decode. Must be 16 kHz mono PCM WAV, or raw little-endian \
                              f32 samples at 16 kHz. Mutually exclusive with audio_path."
    )]
    #[serde(default)]
    pub audio_base64: Option<String>,

    /// Path to an audio file on the machine running the MCP server.
    #[schemars(
        description = "Filesystem path to a 16 kHz mono WAV file. Mutually exclusive \
                              with audio_base64; exactly one of the two is required."
    )]
    #[serde(default)]
    pub audio_path: Option<String>,

    /// Catalog id (`whisper-base-en`) or a path to a GGML file.
    #[schemars(
        description = "Catalog id (whisper-large-v3-turbo-q8, whisper-base-en) or a path \
                              to a GGML file. Default whisper-large-v3-turbo-q8. Nothing is \
                              downloaded: run `aphrody model pull <id>` first."
    )]
    #[serde(default)]
    pub model: Option<String>,

    /// BCP-47 language hint. Omit to auto-detect.
    #[schemars(
        description = "BCP-47 language tag hint (e.g. \"en\", \"fr\"). Omit to auto-detect."
    )]
    #[serde(default)]
    pub language: Option<String>,

    /// Worker threads handed to whisper.cpp (1..=64).
    #[schemars(description = "Worker threads for whisper.cpp (1-64). Omit to let it choose.")]
    #[serde(default)]
    pub threads: Option<u16>,
}

fn pretty(value: &serde_json::Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}

fn error_envelope(code: &str, reason: impl Into<String>) -> String {
    pretty(&json!({ "error": code, "reason": reason.into() }))
}

/// Read the request's audio into memory, enforcing the size cap on both paths.
///
/// The file branch checks the size from metadata *before* reading, so an
/// oversized file is refused without ever being allocated.
fn load_audio(req: &LocalTranscribeRequest) -> Result<Vec<u8>, String> {
    let bytes = match (req.audio_base64.as_deref(), req.audio_path.as_deref()) {
        (Some(encoded), None) => base64::engine::general_purpose::STANDARD
            .decode(encoded.as_bytes())
            .map_err(|e| format!("audio_base64 decode failed: {e}"))?,
        (None, Some(path)) => {
            let path = std::path::Path::new(path);
            let len = std::fs::metadata(path)
                .map_err(|e| format!("audio_path {}: {e}", path.display()))?
                .len();
            if len > MAX_AUDIO_BYTES as u64 {
                return Err(format!("audio is {len}B (> max {MAX_AUDIO_BYTES}B)"));
            }
            std::fs::read(path).map_err(|e| format!("audio_path {}: {e}", path.display()))?
        }
        (Some(_), Some(_)) => {
            return Err("audio_base64 and audio_path are mutually exclusive".to_owned());
        }
        (None, None) => return Err("one of audio_base64 or audio_path is required".to_owned()),
    };

    if bytes.is_empty() {
        return Err("audio payload is empty".to_owned());
    }
    if bytes.len() > MAX_AUDIO_BYTES {
        return Err(format!(
            "audio is {}B (> max {MAX_AUDIO_BYTES}B)",
            bytes.len()
        ));
    }
    Ok(bytes)
}

/// Dispatch the `aphrody_transcribe` tool body.
pub(crate) async fn transcribe(req: LocalTranscribeRequest) -> String {
    let audio = match load_audio(&req) {
        Ok(bytes) => bytes,
        Err(reason) => return error_envelope("STT_BAD_REQUEST", reason),
    };

    let model = req
        .model
        .clone()
        .unwrap_or_else(|| DEFAULT_MODEL.to_owned());
    if model.trim().is_empty() {
        return error_envelope("STT_BAD_REQUEST", "model must be non-empty when provided");
    }
    if let Some(threads) = req.threads
        && (threads == 0 || threads > 64)
    {
        return error_envelope(
            "STT_BAD_REQUEST",
            format!("threads must be in 1..=64 (got {threads})"),
        );
    }

    let mut backend = aphrody_voice::stt::whisper_cpp::WhisperCppBackend::new(model.clone());
    if let Some(threads) = req.threads {
        backend = backend.with_threads(threads);
    }

    // Probing first turns "no runtime" and "no weights" into distinct, fixable
    // errors before any audio is written to a temporary file.
    let (source, weights) = match backend.probe() {
        Ok(pair) => pair,
        Err(err) => {
            return error_envelope("STT_BACKEND_UNAVAILABLE", err.to_string());
        }
    };

    let opts = aphrody_voice::stt::SttOptions {
        language: req.language.clone(),
        model: model.clone(),
        prompt: None,
        temperature: 0.0,
        response_format: aphrody_voice::stt::TranscriptFormat::VerboseJson,
    };

    let transcript = match aphrody_voice::stt::SttProvider::transcribe(&backend, &audio, opts).await
    {
        Ok(t) => t,
        Err(err) => return error_envelope("STT_BACKEND_ERROR", format!("whisper.cpp: {err}")),
    };

    let segments: Vec<serde_json::Value> = transcript
        .segments
        .iter()
        .map(|s| json!({ "id": s.id, "start": s.start, "end": s.end, "text": s.text }))
        .collect();

    pretty(&json!({
        "text": transcript.text,
        "language": transcript.language,
        "duration_s": transcript.duration_s,
        "segments": segments,
        "backend": "whisper.cpp",
        "binary": source.path().display().to_string(),
        "binary_source": source.label(),
        "model": model,
        "weights": weights.display().to_string(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank() -> LocalTranscribeRequest {
        LocalTranscribeRequest {
            audio_base64: None,
            audio_path: None,
            model: None,
            language: None,
            threads: None,
        }
    }

    #[test]
    fn schema_exposes_the_documented_fields() {
        let schema = rmcp::schemars::schema_for!(LocalTranscribeRequest);
        let json = serde_json::to_string(&schema).expect("schema serialise");
        for field in ["audio_base64", "audio_path", "model", "language", "threads"] {
            assert!(
                json.contains(&format!("\"{field}\"")),
                "schema missing {field}: {json}"
            );
        }
    }

    #[test]
    fn exactly_one_audio_source_is_accepted() {
        assert!(load_audio(&blank()).is_err());
        let mut both = blank();
        both.audio_base64 = Some("QQ==".to_owned());
        both.audio_path = Some("a.wav".to_owned());
        assert!(load_audio(&both).is_err());
    }

    #[test]
    fn inline_audio_round_trips_through_standard_base64() {
        let mut req = blank();
        req.audio_base64 = Some("QUJD".to_owned());
        assert_eq!(load_audio(&req).expect("decode"), b"ABC".to_vec());
    }

    #[test]
    fn a_file_source_is_read_from_disk() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("a.wav");
        std::fs::write(&path, b"RIFF....").expect("write");
        let mut req = blank();
        req.audio_path = Some(path.display().to_string());
        assert_eq!(load_audio(&req).expect("read"), b"RIFF....".to_vec());
    }

    #[test]
    fn oversized_and_empty_payloads_are_refused() {
        let mut req = blank();
        req.audio_base64 = Some(String::new());
        assert!(load_audio(&req).is_err());

        req.audio_base64 =
            Some(base64::engine::general_purpose::STANDARD.encode(vec![0u8; MAX_AUDIO_BYTES + 1]));
        let err = load_audio(&req).unwrap_err();
        assert!(err.contains("max"), "unexpected reason: {err}");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn missing_audio_yields_a_structured_error() {
        let value: serde_json::Value =
            serde_json::from_str(&transcribe(blank()).await).expect("parse envelope");
        assert_eq!(value["error"], "STT_BAD_REQUEST");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn an_out_of_range_thread_count_is_refused() {
        let mut req = blank();
        req.audio_base64 = Some("QUJD".to_owned());
        req.threads = Some(0);
        let value: serde_json::Value =
            serde_json::from_str(&transcribe(req).await).expect("parse envelope");
        assert_eq!(value["error"], "STT_BAD_REQUEST");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn an_unknown_model_is_reported_without_any_network_fallback() {
        // The contract that separates this tool from `voice_transcribe`: a
        // missing local artefact must be an error, never a silent upload.
        let mut req = blank();
        req.audio_base64 = Some("QUJD".to_owned());
        req.model = Some("definitely-not-a-catalog-id-42".to_owned());
        let out = transcribe(req).await;
        let value: serde_json::Value = serde_json::from_str(&out).expect("parse envelope");
        assert_eq!(value["error"], "STT_BACKEND_UNAVAILABLE", "{out}");
        assert!(
            value.get("text").is_none(),
            "no transcript may be invented: {out}"
        );
    }
}
