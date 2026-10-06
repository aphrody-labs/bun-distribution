// SPDX-License-Identifier: Apache-2.0
//! WebAssembly adapter of [`aphrody_rag_core::api`], the single source of truth of the RAG
//! capabilities. It declares no capability: `manifest`, `call_json` and `call_vec` forward to the
//! shared call surface and the TypeScript facade (`packages/ai/rag-core`) types every operation.
//!
//! Build: `bun packages/ai/rag-core/scripts/build-wasm.ts` (`wasm32-unknown-unknown`,
//! `wasm-bindgen --target web`, `wasm-opt -Oz`).

use wasm_bindgen::prelude::*;

/// Version of the shared call surface.
#[wasm_bindgen(js_name = abiVersion)]
#[must_use]
pub fn abi_version() -> u32 {
    aphrody_rag_core::api::ABI_VERSION
}

/// JSON manifest: ABI, crate, version and every operation name.
#[wasm_bindgen]
#[must_use]
pub fn manifest() -> String {
    aphrody_rag_core::api::manifest()
}

/// Run a structured operation; `input` and the result are JSON documents.
///
/// # Errors
/// Throws the operation's error message.
#[wasm_bindgen(js_name = callJson)]
pub fn call_json(op: &str, input: &str) -> Result<String, String> {
    aphrody_rag_core::api::call_json(op, input)
}

/// Run a dense-vector operation over little-endian byte buffers `a` and `b`.
///
/// # Errors
/// Throws the operation's error message.
#[wasm_bindgen(js_name = callVec)]
pub fn call_vec(op: &str, params: &str, a: &[u8], b: &[u8]) -> Result<Vec<u8>, String> {
    aphrody_rag_core::api::call_vec(op, params, a, b)
}

#[cfg(test)]
mod tests {
    #[test]
    fn forwards_to_the_shared_surface() {
        assert_eq!(super::abi_version(), aphrody_rag_core::api::ABI_VERSION);
        assert_eq!(super::manifest(), aphrody_rag_core::api::manifest());
        assert!(super::call_json("nope", "{}").is_err());
    }
}
