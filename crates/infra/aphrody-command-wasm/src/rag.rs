// SPDX-License-Identifier: Apache-2.0
//! The RAG call surface in the single portable command module. The shared RAG core owns
//! parsing, validation and vector kernels; this module only defines the wasm-bindgen ABI.

use wasm_bindgen::prelude::*;

/// Version of the shared RAG call surface.
#[wasm_bindgen(js_name = abiVersion)]
#[must_use]
pub fn abi_version() -> u32 {
    aphrody_rag_core::api::ABI_VERSION
}

/// JSON manifest: ABI, crate, version and every RAG operation name.
#[wasm_bindgen]
#[must_use]
pub fn manifest() -> String {
    aphrody_rag_core::api::manifest()
}

/// Run a structured RAG operation; input and output are JSON documents.
///
/// # Errors
/// Throws the operation's error message.
#[wasm_bindgen(js_name = callJson)]
pub fn call_json(op: &str, input: &str) -> Result<String, String> {
    aphrody_rag_core::api::call_json(op, input)
}

/// Run a dense-vector operation over little-endian byte buffers.
///
/// # Errors
/// Throws the operation's error message.
#[wasm_bindgen(js_name = callVec)]
pub fn call_vec(op: &str, params: &str, a: &[u8], b: &[u8]) -> Result<Vec<u8>, String> {
    aphrody_rag_core::api::call_vec(op, params, a, b)
}
