// SPDX-License-Identifier: Apache-2.0
//! Structured WSL commands through the kernel's canonical WinClean owner.

use nu_engine::command_prelude::*;
use serde_json::json;

use super::{
    json_to_nu,
    utils::{error, kernel_error, run_kernel},
};

#[derive(Clone)]
pub(super) struct AphrodyWsl;

impl Command for AphrodyWsl {
    fn name(&self) -> &str {
        "aphrody wsl"
    }

    fn description(&self) -> &str {
        "Inspect or execute commands in WSL through the Aphrody kernel."
    }

    fn signature(&self) -> Signature {
        Signature::build(self.name())
            .required(
                "action",
                SyntaxShape::String,
                "status, distributions, processes, probe, or exec",
            )
            .rest(
                "args",
                SyntaxShape::String,
                "Distribution, then probe name or literal command arguments",
            )
            .category(Category::System)
    }

    fn run(
        &self,
        engine_state: &EngineState,
        stack: &mut Stack,
        call: &Call,
        _input: PipelineData,
    ) -> Result<PipelineData, ShellError> {
        let action = call.req::<String>(engine_state, stack, 0)?;
        let args = call.rest::<String>(engine_state, stack, 1)?;
        let (tool, arguments) = match (action.as_str(), args.as_slice()) {
            ("status", []) => ("wsl_get_status", json!({})),
            ("distributions", []) => ("wsl_list_distributions", json!({})),
            ("processes", [distribution]) => {
                ("wsl_list_processes", json!({"distribution": distribution}))
            },
            ("probe", [distribution, probe]) => {
                ("wsl_read_only_probe", json!({"distribution": distribution, "probe": probe}))
            },
            ("exec", [distribution, command @ ..]) if !command.is_empty() => {
                ("wsl_execute", json!({"distribution": distribution, "command": command}))
            },
            _ => {
                return Err(error(
                    "invalid WSL command",
                    "usage: aphrody wsl status | distributions | processes <distribution> | probe <distribution> <probe> | exec <distribution> <executable> ...args",
                    call.head,
                ));
            },
        };
        let response =
            run_kernel(35_000, engine_state.signals().clone(), move |client| async move {
                client.call_tool(tool, arguments).await
            })
            .map_err(|cause| kernel_error(cause, call.head))?;
        Ok(json_to_nu(&response).into_pipeline_data())
    }
}
