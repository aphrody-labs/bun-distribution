// SPDX-License-Identifier: Apache-2.0
//! WebAssembly bindings of the RE core (feature `wasm`), the single browser surface that
//! `aphrody-nie-wasm` re-exports.
use wasm_bindgen::prelude::*;

/// Inspects a PE `.pdata` table with exact counters and a bounded root sample (JSON).
#[wasm_bindgen]
pub fn pdata_inspect_json(bytes: &[u8], max_roots: u32) -> Result<String, JsValue> {
    crate::pdata::inspect_json(bytes, max_roots).map_err(|error| JsValue::from_str(&error))
}
