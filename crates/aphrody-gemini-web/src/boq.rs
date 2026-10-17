// SPDX-License-Identifier: Apache-2.0
//! Google Boq `batchexecute` codec for the Gemini web client.
//!
//! Wire format captured live from `gemini.google.com/_/BardChatUi` (build
//! `boq_assistant-bard-web-server_20260511.16_p20`, 2026-05-21). Gemini and `NotebookLM` share the
//! same Boq router, so the codec (request encoder, anti-XSSI strip, length-prefixed chunk parser,
//! `wrb.fr` envelope extraction) has one owner, [`aphrody_boq`]; this module re-exports it and maps
//! its failures to [`GeminiError`].

use serde_json::Value;

pub use aphrody_boq::{extract_chunks, parse_envelopes, strip_xssi, XSSI_PREFIX};

use crate::error::{GeminiError, Result};

/// Encode a single-RPC `f.req` body string.
///
/// # Errors
///
/// Returns [`GeminiError::Parse`] if `payload` cannot be serialised.
pub fn encode_f_req(rpc_id: &str, payload: &Value) -> Result<String> {
    Ok(aphrody_boq::encode_f_req(rpc_id, payload)?)
}

/// Return the first `wrb.fr` envelope or fail with [`GeminiError::Parse`].
///
/// # Errors
///
/// Returns [`GeminiError::Parse`] when the response carries no `wrb.fr` chunk.
pub fn first_envelope(raw: &str) -> Result<Value> {
    aphrody_boq::first_envelope(raw)
        .ok_or_else(|| GeminiError::Parse("no wrb.fr envelope in response".to_string()))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn encode_wraps_the_shared_codec() {
        let encoded = encode_f_req("MaZiqc", &json!([20, "inner", [0, null, 1]])).unwrap();
        assert!(encoded.contains("MaZiqc"));
        assert!(encoded.contains("\\\"inner\\\""));
    }

    #[test]
    fn first_envelope_maps_the_missing_envelope_to_a_parse_error() {
        assert!(matches!(
            first_envelope(")]}'\n"),
            Err(GeminiError::Parse(_))
        ));
    }
}
