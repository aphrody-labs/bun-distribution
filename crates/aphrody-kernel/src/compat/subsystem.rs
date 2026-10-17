// SPDX-License-Identifier: Apache-2.0
//! `SystemSubsystem` implementation for cross-compatibility runtime layer.

use std::collections::HashMap;

use aphrody_subsystem::{SubsystemError, SystemSubsystem, ToolDefinition};
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::compat::{dotnet, pwsh, wine_proton};

#[derive(Default)]
pub struct CompatSubsystem;

impl CompatSubsystem {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl SystemSubsystem for CompatSubsystem {
    fn name(&self) -> &str {
        "compat"
    }

    fn description(&self) -> &str {
        "Cross-platform compatibility runtimes (Proton, Wine, .NET 10, PowerShell Core pwsh)"
    }

    fn tools(&self) -> Vec<ToolDefinition> {
        vec![
            ToolDefinition::new(
                "compat_runtimes_status",
                "Detect and report availability of Wine, Proton, .NET and PowerShell Core runtimes",
                json!({
                    "type": "object",
                    "properties": {}
                }),
            )
            .read_only(),
            ToolDefinition::new(
                "compat_wine_exec",
                "Execute a Windows binary using Proton/Wine (or native Windows fallback)",
                json!({
                    "type": "object",
                    "properties": {
                        "executable": { "type": "string", "description": "Executable path or name" },
                        "args": { "type": "array", "items": { "type": "string" }, "description": "Command arguments" },
                        "prefix": { "type": "string", "description": "Optional custom WINEPREFIX directory" },
                        "env": { "type": "object", "description": "Optional environment variables" }
                    },
                    "required": ["executable"]
                }),
            ),
            ToolDefinition::new(
                "compat_dotnet_exec",
                "Execute a .NET assembly or application using the dotnet CLI",
                json!({
                    "type": "object",
                    "properties": {
                        "assembly_path": { "type": "string", "description": "Path to the .dll or .exe assembly" },
                        "args": { "type": "array", "items": { "type": "string" }, "description": "Assembly arguments" }
                    },
                    "required": ["assembly_path"]
                }),
            ),
            ToolDefinition::new(
                "compat_pwsh_eval",
                "Evaluate a PowerShell Core (pwsh) or Windows PowerShell script with output \
                 capture",
                json!({
                    "type": "object",
                    "properties": {
                        "script": { "type": "string", "description": "PowerShell script command" },
                        "cwd": { "type": "string", "description": "Working directory" }
                    },
                    "required": ["script"]
                }),
            ),
        ]
    }

    async fn call(&self, tool: &str, arguments: Value) -> Result<Value, SubsystemError> {
        match tool {
            "compat_runtimes_status" => {
                let wine = wine_proton::detect_wine_runtime();
                let dotnet = dotnet::detect_dotnet().await;
                let pwsh = pwsh::detect_pwsh().await;
                Ok(json!({
                    "wine_proton": wine,
                    "dotnet": dotnet,
                    "pwsh": pwsh,
                }))
            }
            "compat_wine_exec" => {
                let executable = arguments
                    .get("executable")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        SubsystemError::InvalidArguments("missing `executable`".into())
                    })?;
                let args: Vec<String> = arguments
                    .get("args")
                    .and_then(Value::as_array)
                    .map(|arr| {
                        arr.iter()
                            .filter_map(Value::as_str)
                            .map(ToString::to_string)
                            .collect()
                    })
                    .unwrap_or_default();
                let prefix = arguments.get("prefix").and_then(Value::as_str);
                let env_map: HashMap<String, String> = arguments
                    .get("env")
                    .and_then(Value::as_object)
                    .map(|obj| {
                        obj.iter()
                            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                            .collect()
                    })
                    .unwrap_or_default();

                let res = wine_proton::execute_binary(executable, &args, prefix, &env_map)
                    .await
                    .map_err(SubsystemError::Failed)?;
                Ok(json!(res))
            }
            "compat_dotnet_exec" => {
                let assembly = arguments
                    .get("assembly_path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        SubsystemError::InvalidArguments("missing `assembly_path`".into())
                    })?;
                let args: Vec<String> = arguments
                    .get("args")
                    .and_then(Value::as_array)
                    .map(|arr| {
                        arr.iter()
                            .filter_map(Value::as_str)
                            .map(ToString::to_string)
                            .collect()
                    })
                    .unwrap_or_default();

                let res = dotnet::execute_assembly(assembly, &args)
                    .await
                    .map_err(SubsystemError::Failed)?;
                Ok(json!(res))
            }
            "compat_pwsh_eval" => {
                let script = arguments
                    .get("script")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing `script`".into()))?;
                let cwd = arguments.get("cwd").and_then(Value::as_str);

                let res = pwsh::eval_script(script, cwd)
                    .await
                    .map_err(SubsystemError::Failed)?;
                Ok(json!(res))
            }
            other => Err(SubsystemError::UnknownTool(other.to_owned())),
        }
    }
}
