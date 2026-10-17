// SPDX-License-Identifier: Apache-2.0
//! ONNX Runtime/Windows ML compatibility operations.
//!
//! The public WinClean contract calls these operations "WinML" for compatibility.
//! Rust uses the same ONNX Runtime C ABI through `ort` and does not pretend to
//! expose the newer Windows App SDK provider catalogue.  The runtime DLL is
//! discovered at execution time, so Linux and Windows builds remain hermetic.

use serde_json::Value;

#[cfg(windows)]
const MAX_TENSOR_ELEMENTS: usize = 1 << 20;

#[cfg(windows)]
mod native {
    use std::{
        collections::BTreeMap,
        path::{Path, PathBuf},
        sync::OnceLock,
    };

    use ort::{ep::ExecutionProvider, session::Session, value::Tensor};
    use serde::Deserialize;
    use serde_json::{Value, json};

    use super::MAX_TENSOR_ELEMENTS;

    #[derive(Debug, Deserialize)]
    struct InputTensor {
        shape: Vec<i64>,
        data: Vec<f32>,
    }

    fn runtime_path() -> Result<PathBuf, String> {
        let mut candidates = Vec::new();
        for key in ["RUST_ONNXRUNTIME_LIBRARY_PATH", "ORT_DYLIB_PATH"] {
            if let Some(path) = std::env::var_os(key) {
                candidates.push(PathBuf::from(path));
            }
        }
        if let Ok(exe) = std::env::current_exe()
            && let Some(parent) = exe.parent()
        {
            candidates.push(parent.join("onnxruntime.dll"));
        }
        if let Ok(current) = std::env::current_dir() {
            candidates.push(current.join("onnxruntime.dll"));
        }
        candidates.dedup();
        candidates.into_iter().find(|path| path.is_file()).ok_or_else(|| {
            "ONNX Runtime DLL not found; set RUST_ONNXRUNTIME_LIBRARY_PATH or install the WinClean \
             runtime"
                .into()
        })
    }

    fn ensure_runtime() -> Result<&'static PathBuf, String> {
        static RUNTIME: OnceLock<Result<PathBuf, String>> = OnceLock::new();
        RUNTIME
            .get_or_init(|| {
                let path = runtime_path()?;
                let builder = ort::init_from(&path).map_err(|error| error.to_string())?;
                // The environment is process-global. `commit` returning false
                // means another caller already installed it, which is safe.
                let _ = builder.commit();
                Ok(path)
            })
            .as_ref()
            .map_err(Clone::clone)
    }

    pub(super) fn version() -> Result<Value, String> {
        let path = ensure_runtime()?;
        let _ = path;
        Ok(json!({"version": ort::info()}))
    }

    pub(super) fn providers() -> Result<Value, String> {
        ensure_runtime()?;
        let mut providers = vec!["CPUExecutionProvider".to_owned()];
        if ort::ep::DirectML::default()
            .is_available()
            .map_err(|error| error.to_string())?
        {
            providers.push("DmlExecutionProvider".into());
        }
        if ort::ep::CUDA::default()
            .is_available()
            .map_err(|error| error.to_string())?
        {
            providers.push("CUDAExecutionProvider".into());
        }
        Ok(json!({"providers": providers}))
    }

    fn metadata(session: &Session, model_path: &str) -> Value {
        let list = |items: &[ort::value::Outlet]| {
            items
                .iter()
                .map(|item| {
                    json!({
                        "name": item.name(),
                        "elementType": item.dtype().tensor_type().map(|kind| kind.to_string()).unwrap_or_else(|| item.dtype().to_string()),
                        "shape": item.dtype().tensor_shape().map(|shape| shape.to_vec()).unwrap_or_default(),
                    })
                })
                .collect::<Vec<_>>()
        };
        json!({"action":"WinmlInspectOnnx","modelPath":model_path,"inputs":list(session.inputs()),"outputs":list(session.outputs())})
    }

    pub(super) fn inspect(model_path: &str) -> Result<Value, String> {
        if model_path.trim().is_empty() {
            return Err("modelPath required".into());
        }
        if !Path::new(model_path).is_file() {
            return Err(format!("file not found: {model_path}"));
        }
        ensure_runtime()?;
        let session = Session::builder()
            .map_err(|error| error.to_string())?
            .commit_from_file(model_path)
            .map_err(|error| error.to_string())?;
        Ok(metadata(&session, model_path))
    }

    pub(super) fn run(
        model_path: &str,
        inputs_json: &str,
        execution_provider: &str,
    ) -> Result<Value, String> {
        if model_path.trim().is_empty() {
            return Err("modelPath required".into());
        }
        if !Path::new(model_path).is_file() {
            return Err(format!("file not found: {model_path}"));
        }
        if inputs_json.trim().is_empty() {
            return Err("inputsJson required".into());
        }
        ensure_runtime()?;
        let key = if execution_provider.trim().is_empty() {
            "cpu"
        } else {
            execution_provider.trim()
        };
        let mut builder = Session::builder().map_err(|error| error.to_string())?;
        builder = match key.to_ascii_lowercase().as_str() {
            "cpu" => builder,
            "dml" | "directml" => builder
                .with_execution_providers([ort::ep::DirectML::default().build()])
                .map_err(|error| error.to_string())?,
            "cuda" => builder
                .with_execution_providers([ort::ep::CUDA::default().build()])
                .map_err(|error| error.to_string())?,
            _ => {
                return Err(format!(
                    "unknown EP '{execution_provider}'. Use cpu|dml|cuda."
                ));
            }
        };
        let mut session = builder
            .commit_from_file(model_path)
            .map_err(|error| error.to_string())?;
        let parsed: BTreeMap<String, InputTensor> = serde_json::from_str(inputs_json)
            .map_err(|error| format!("invalid inputsJson: {error}"))?;
        if parsed.is_empty() {
            return Err("inputsJson must contain at least one input".into());
        }
        let mut inputs = Vec::with_capacity(parsed.len());
        for (name, tensor) in parsed {
            if tensor.shape.iter().any(|dimension| *dimension <= 0) {
                return Err(format!("input '{name}' shape dimensions must be positive"));
            }
            let expected = tensor
                .shape
                .iter()
                .try_fold(1usize, |acc, dimension| {
                    acc.checked_mul(*dimension as usize)
                })
                .ok_or_else(|| format!("input '{name}' shape overflows"))?;
            if expected > MAX_TENSOR_ELEMENTS {
                return Err(format!(
                    "input '{name}' has {expected} elements > {MAX_TENSOR_ELEMENTS} cap"
                ));
            }
            if tensor.data.len() != expected {
                return Err(format!(
                    "input '{name}' data length {} != shape product {expected}",
                    tensor.data.len()
                ));
            }
            inputs.push((
                name,
                Tensor::from_array((tensor.shape, tensor.data))
                    .map_err(|error| error.to_string())?,
            ));
        }
        let output_name = session
            .outputs()
            .first()
            .map(|output| output.name().to_owned())
            .unwrap_or_default();
        let outputs = session.run(inputs).map_err(|error| error.to_string())?;
        let first = outputs
            .values()
            .next()
            .ok_or_else(|| "model produced no output".to_owned())?;
        let (shape, data) = first
            .try_extract_tensor::<f32>()
            .map_err(|error| error.to_string())?;
        Ok(
            json!({"action":"WinmlRunFloat32","executionProvider":key.to_ascii_lowercase(),"output":{"name":output_name,"shape":shape.to_vec(),"data":data}}),
        )
    }
}

#[cfg(windows)]
pub fn get_version() -> Result<Value, String> {
    native::version()
}

#[cfg(not(windows))]
pub fn get_version() -> Result<Value, String> {
    Err("WinML is Windows-only".into())
}

#[cfg(windows)]
pub fn list_providers() -> Result<Value, String> {
    native::providers()
}

#[cfg(not(windows))]
pub fn list_providers() -> Result<Value, String> {
    Err("WinML is Windows-only".into())
}

#[cfg(windows)]
pub fn inspect_onnx(model_path: &str) -> Result<Value, String> {
    native::inspect(model_path)
}

#[cfg(not(windows))]
pub fn inspect_onnx(_model_path: &str) -> Result<Value, String> {
    Err("WinML is Windows-only".into())
}

#[cfg(windows)]
pub fn run_float32(
    model_path: &str,
    inputs_json: &str,
    execution_provider: &str,
) -> Result<Value, String> {
    native::run(model_path, inputs_json, execution_provider)
}

#[cfg(not(windows))]
pub fn run_float32(
    _model_path: &str,
    _inputs_json: &str,
    _execution_provider: &str,
) -> Result<Value, String> {
    Err("WinML is Windows-only".into())
}

#[cfg(test)]
mod tests {
    #[cfg(not(windows))]
    #[test]
    fn non_windows_is_explicitly_unsupported() {
        assert!(
            super::list_providers()
                .unwrap_err()
                .contains("Windows-only")
        );
        assert!(super::get_version().unwrap_err().contains("Windows-only"));
    }
}
