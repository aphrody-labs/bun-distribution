// SPDX-License-Identifier: Apache-2.0
//! `wasm-bindgen` ABI for the optional WebGPU shader-conversion artifact.

use js_sys::{Object, Reflect};
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::vkwebgpu::{ShaderTranslationError, translate_spirv_to_wgsl};

/// Translate a `Uint32Array` SPIR-V module to WGSL.
///
/// On failure this returns a rejected JS result whose value is a structured
/// object: `{ code, message, executionModel?, wordOffset? }`. It never returns
/// success with an empty WGSL module. The browser integration must create and
/// validate the real `GPUShaderModule` before acknowledging shader creation.
#[wasm_bindgen]
pub fn spirv_to_wgsl(words: &[u32]) -> Result<String, JsValue> {
    translate_spirv_to_wgsl(words).map_err(to_js_error)
}

fn to_js_error(error: ShaderTranslationError) -> JsValue {
    let object = Object::new();
    let value = JsValue::from(object.clone());
    let fields = [
        ("code", JsValue::from_str(error.code.as_str())),
        ("message", JsValue::from_str(&error.message)),
    ];
    for (name, field) in fields {
        if Reflect::set(&value, &JsValue::from_str(name), &field).is_err() {
            return JsValue::from_str("failed to construct structured shader translation error");
        }
    }
    if let Some(model) = error.execution_model {
        if Reflect::set(
            &value,
            &JsValue::from_str("executionModel"),
            &JsValue::from_f64(model as f64),
        )
        .is_err()
        {
            return JsValue::from_str("failed to construct structured shader translation error");
        }
    }
    if let Some(offset) = error.word_offset {
        if Reflect::set(
            &value,
            &JsValue::from_str("wordOffset"),
            &JsValue::from_f64(offset as f64),
        )
        .is_err()
        {
            return JsValue::from_str("failed to construct structured shader translation error");
        }
    }
    value
}
