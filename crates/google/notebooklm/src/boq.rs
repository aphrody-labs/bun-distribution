// SPDX-License-Identifier: Apache-2.0
//! Google Boq `batchexecute` codec for the `NotebookLM` client.
//!
//! The wire format (request encoder, anti-XSSI strip, length-prefixed chunk parser, `wrb.fr`
//! envelope extraction) has one owner, [`aphrody_boq`], shared with the Gemini web client; this
//! module re-exports it and maps its failures to [`NotebookError`].

use serde_json::Value;

pub use aphrody_boq::{XSSI_PREFIX, extract_chunks, parse_envelopes, strip_xssi};

use crate::error::{NotebookError, Result};

/// Encode a single-RPC `f.req` body string.
///
/// # Errors
///
/// Returns [`NotebookError::Parse`] if `payload` cannot be serialised.
pub fn encode_f_req(rpc_id: &str, payload: &Value) -> Result<String> {
    Ok(aphrody_boq::encode_f_req(rpc_id, payload)?)
}

/// Convenience: return the first envelope or fail with [`NotebookError::Parse`].
///
/// # Errors
///
/// Returns [`NotebookError::Parse`] when the response carries no `wrb.fr` chunk.
pub fn first_envelope(raw: &str) -> Result<Value> {
    aphrody_boq::first_envelope(raw)
        .ok_or_else(|| NotebookError::Parse("no wrb.fr envelope in response".to_string()))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn encode_wraps_the_shared_codec() {
        let encoded = encode_f_req("CCqFvf", &json!(["hello", 1, 2])).unwrap();
        assert!(encoded.contains("CCqFvf"));
        assert!(encoded.contains("\\\"hello\\\""));
    }

    #[test]
    fn first_envelope_maps_the_missing_envelope_to_a_parse_error() {
        assert!(matches!(first_envelope(")]}'\n"), Err(NotebookError::Parse(_))));
    }
}
