// SPDX-License-Identifier: Apache-2.0
//! WebAssembly adapter of [`aphrody_command_pure`]: `aphrody pure ...` in the browser.
//!
//! One entry point, [`run`], takes the arguments (without the program name), the stdin text and
//! the named files as a JSON object, and returns `{"code", "stdout", "stderr"}` as JSON. Parsing,
//! help and execution are the shared pure crate's, identical to the native `aphrody pure`.
//!
//! Build: `bun run build:wasm` in `packages/infra/cli-wasm`.

use aphrody_command_pure::{MemoryIo, run_args};
use wasm_bindgen::prelude::*;

/// Run `aphrody pure <args...>`; `files_json` is a JSON object `{ "name": "text", ... }`.
///
/// # Errors
/// Throws when `files_json` is not a JSON object of strings.
#[wasm_bindgen]
pub fn run(args: Vec<String>, stdin: &str, files_json: &str) -> Result<String, String> {
    run_json(&args, stdin, files_json)
}

/// Package version of the pure command crate.
#[wasm_bindgen]
#[must_use]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn run_json(args: &[String], stdin: &str, files_json: &str) -> Result<String, String> {
    let files = if files_json.trim().is_empty() {
        std::collections::BTreeMap::new()
    } else {
        serde_json::from_str(files_json)
            .map_err(|e| format!("files must be a JSON object of strings: {e}"))?
    };
    let mut io = MemoryIo { stdin: stdin.to_string(), files };
    let out = run_args(args, &mut io);
    Ok(serde_json::json!({ "code": out.code, "stdout": out.stdout, "stderr": out.stderr })
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::run_json;

    #[test]
    fn runs_a_command_and_reports_json() {
        let args = ["toolcall".to_string(), "repair".to_string(), "-".to_string()];
        let out: serde_json::Value =
            serde_json::from_str(&run_json(&args, "{'a': 1}", "").unwrap()).unwrap();
        assert_eq!(out["code"], 0);
        assert!(out["stdout"].as_str().unwrap().contains("\"a\""));
    }

    #[test]
    fn files_and_errors() {
        let args = ["html".to_string(), "markdown".to_string(), "a.html".to_string()];
        let out: serde_json::Value =
            serde_json::from_str(&run_json(&args, "", r#"{"a.html":"<h1>T</h1>"}"#).unwrap())
                .unwrap();
        assert!(out["stdout"].as_str().unwrap().contains("# T"));
        assert!(run_json(&args, "", "[1]").is_err());
    }
}
