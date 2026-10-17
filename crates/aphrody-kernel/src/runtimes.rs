// SPDX-License-Identifier: Apache-2.0
//! Unified toolchain runtime subsystem (`runtime`).
//!
//! Exposes [`aphrody_toolchains`] to agents: for a project directory, which
//! Bun / uv / Nushell executable would be launched, where it came from, its
//! installed version and whether it satisfies the repository pin.

use std::path::PathBuf;

use aphrody_subsystem::{SubsystemError, SystemSubsystem, ToolDefinition};
use aphrody_toolchains::{Runtime, Toolchain};
use async_trait::async_trait;
use serde_json::{Value, json};

/// The kernel-owned view of the unified Bun / uv / Nushell runtime layer.
#[derive(Debug, Default)]
pub struct RuntimeSubsystem;

/// Stock Bun ships `bun:ffi`; a successful probe proves the runtime can
/// `dlopen` the `aphrody-ffi` cdylib. No native library is loaded by the probe.
fn bun_ffi_available(runtime: &Runtime) -> bool {
    runtime
        .command([
            "-e",
            "if (typeof require('bun:ffi').dlopen !== 'function') process.exit(1)",
        ])
        .output()
        .is_ok_and(|output| output.status.success())
}

impl RuntimeSubsystem {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

/// Resolve one toolchain for `dir` into a JSON report (never an error: a
/// missing or mismatched toolchain is a reportable state, not a failure).
#[must_use]
pub fn report(tool: Toolchain, dir: &std::path::Path) -> Value {
    let pin = tool.pinned_version(dir);
    let pin_json = match &pin {
        Ok(Some(p)) => json!({"version": p.version, "source": p.source}),
        Ok(None) => Value::Null,
        Err(e) => json!({"error": e.to_string()}),
    };
    match tool.resolve_unchecked(dir) {
        Ok(rt) => json!({
            "toolchain": tool.executable_name(),
            "found": true,
            "path": rt.path(),
            "source": rt.source().as_str(),
            "version": rt.version(),
            "pin": pin_json,
            "satisfies_pin": rt.satisfies_pin(),
            "ffi_available": (tool == Toolchain::Bun).then(|| bun_ffi_available(&rt)),
        }),
        Err(e) => json!({
            "toolchain": tool.executable_name(),
            "found": false,
            "error": e.to_string(),
            "pin": pin_json,
            "satisfies_pin": false,
            "ffi_available": null,
        }),
    }
}

#[async_trait]
impl SystemSubsystem for RuntimeSubsystem {
    fn name(&self) -> &'static str {
        "runtime"
    }

    fn description(&self) -> &'static str {
        "Unified Bun / uv / Nushell runtime layer: shell-free discovery, repository version pins, \
         pin compliance and the Aphrody Bun module contract version for a project directory."
    }

    fn tools(&self) -> Vec<ToolDefinition> {
        vec![
            ToolDefinition::new(
                "runtime_resolve",
                "Resolve Bun, uv and Nushell: path, source, installed version, repository pin, pin compliance and Aphrody Bun module version when present",
                json!({
                    "type": "object",
                    "properties": {
                        "project_dir": {
                            "type": "string",
                            "description": "Project directory whose pins apply (defaults to the kernel working directory)"
                        },
                        "toolchain": {
                            "type": "string",
                            "enum": ["bun", "uv", "nu"],
                            "description": "Restrict to one toolchain (default: all three)"
                        }
                    }
                }),
            )
            .read_only(),
        ]
    }

    async fn call(&self, tool: &str, arguments: Value) -> Result<Value, SubsystemError> {
        if tool != "runtime_resolve" {
            return Err(SubsystemError::UnknownTool(tool.to_owned()));
        }
        let dir = match arguments.get("project_dir").and_then(Value::as_str) {
            Some(p) => {
                let path = PathBuf::from(p);
                if !path.is_dir() {
                    return Err(SubsystemError::InvalidArguments(format!(
                        "project_dir is not a directory: {p}"
                    )));
                }
                path
            }
            None => std::env::current_dir()
                .map_err(|e| SubsystemError::Failed(format!("no working directory: {e}")))?,
        };
        let tools = match arguments.get("toolchain").and_then(Value::as_str) {
            Some(name) => vec![Toolchain::from_name(name).ok_or_else(|| {
                SubsystemError::InvalidArguments(format!("unknown toolchain: {name}"))
            })?],
            None => Toolchain::ALL.to_vec(),
        };
        let runtimes = tokio::task::spawn_blocking(move || {
            let list: Vec<Value> = tools.into_iter().map(|t| report(t, &dir)).collect();
            json!({"project_dir": dir, "runtimes": list})
        })
        .await
        .map_err(|e| SubsystemError::Failed(format!("runtime resolution task failed: {e}")))?;
        Ok(runtimes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn resolves_pins_from_a_project_directory() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("mise.toml"), "[tools]\nuv = \"0.12.17\"\n").expect("write");
        let result = RuntimeSubsystem::new()
            .call(
                "runtime_resolve",
                json!({"project_dir": dir.path(), "toolchain": "uv"}),
            )
            .await
            .expect("resolve");
        let uv = &result["runtimes"][0];
        assert_eq!(uv["toolchain"], "uv");
        assert_eq!(uv["pin"]["version"], "0.12.17", "{result}");
        assert!(uv["found"].is_boolean());
    }

    #[tokio::test]
    async fn rejects_unknown_toolchain_and_tool() {
        let rt = RuntimeSubsystem::new();
        assert!(matches!(
            rt.call("runtime_resolve", json!({"toolchain": "node"}))
                .await,
            Err(SubsystemError::InvalidArguments(_))
        ));
        assert!(matches!(
            rt.call("nope", json!({})).await,
            Err(SubsystemError::UnknownTool(_))
        ));
        assert_eq!(rt.tools().len(), 1);
    }
}
