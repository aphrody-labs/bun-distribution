// SPDX-License-Identifier: Apache-2.0
//! Nushell bridge to the kernel-owned uutils runtime.

use std::{env, future::Future, time::Duration};

use aphrody_kernel_client::{ClientOptions, KernelClient, default_endpoint};
use nu_engine::command_prelude::*;
use nu_protocol::{Signals, shell_error::generic::GenericError};
use serde_json::{Value as Json, json};
use tokio::runtime::Builder;

use super::json_to_nu;

const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const MAX_TIMEOUT_MS: u64 = 300_000;
const DEFAULT_MAX_OUTPUT_BYTES: u64 = 1_048_576;
const MAX_OUTPUT_BYTES: u64 = 8_388_608;

#[derive(Clone)]
pub(super) struct AphrodyUtils;

impl Command for AphrodyUtils {
    fn name(&self) -> &str {
        "aphrody utils"
    }

    fn description(&self) -> &str {
        "Run the kernel-managed uutils utilities without using the host PATH."
    }

    fn extra_description(&self) -> &str {
        "Use `aphrody utils status`, `aphrody utils catalog`, `aphrody utils run <utility> \
         ...args`, or `aphrody utils <utility> ...args`. Utility arguments are literal strings; \
         put `--` before arguments that should be passed through as utility flags. `--timeout` is \
         milliseconds. Results remain structured records for Nushell pipelines."
    }

    fn signature(&self) -> Signature {
        Signature::build("aphrody utils")
            .required("action", SyntaxShape::String, "status, catalog, run, or a utility name")
            .rest("args", SyntaxShape::String, "Literal utility arguments")
            .named("cwd", SyntaxShape::String, "Working directory for the utility", None)
            .named("timeout", SyntaxShape::Int, "Request timeout in milliseconds", None)
            .named(
                "max-output-bytes",
                SyntaxShape::Int,
                "Maximum bytes captured independently for stdout and stderr",
                None,
            )
            .named("format", SyntaxShape::String, "Output mode: text, json, or jsonl", None)
            .switch("check", "Return an error when the utility exits non-zero", None)
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
        let rest = call.rest::<String>(engine_state, stack, 1)?;
        let cwd = call.get_flag::<String>(engine_state, stack, "cwd")?;
        let timeout_ms = bounded_option(
            call.get_flag::<i64>(engine_state, stack, "timeout")?,
            DEFAULT_TIMEOUT_MS,
            MAX_TIMEOUT_MS,
            "--timeout",
        )
        .map_err(|message| error("value outside allowed range", message, call.head))?;
        let max_output_bytes = bounded_option(
            call.get_flag::<i64>(engine_state, stack, "max-output-bytes")?,
            DEFAULT_MAX_OUTPUT_BYTES,
            MAX_OUTPUT_BYTES,
            "--max-output-bytes",
        )
        .map_err(|message| error("value outside allowed range", message, call.head))?;
        let output_format = call
            .get_flag::<String>(engine_state, stack, "format")?
            .unwrap_or_else(|| "text".to_owned());
        if !matches!(output_format.as_str(), "text" | "json" | "jsonl") {
            return Err(error(
                "invalid output format",
                "--format must be text, json, or jsonl",
                call.head,
            ));
        }
        let check = call.has_flag(engine_state, stack, "check")?;

        let response = if action == "status" {
            if !rest.is_empty() {
                return Err(error(
                    "unexpected arguments",
                    "status takes no utility arguments",
                    call.head,
                ));
            }
            run_kernel(timeout_ms, engine_state.signals().clone(), |client| async move {
                client.call_tool("coreutils_status", json!({})).await
            })
            .map_err(|cause| kernel_error(cause, call.head))?
        } else if action == "catalog" {
            if !rest.is_empty() {
                return Err(error(
                    "unexpected arguments",
                    "catalog takes no utility arguments",
                    call.head,
                ));
            }
            run_kernel(timeout_ms, engine_state.signals().clone(), |client| async move {
                let core = client.call_tool("coreutils_catalog", json!({})).await?;
                let companions = client.call_tool("uutils_catalog", json!({})).await?;
                Ok(catalog_rows(&core, &companions))
            })
            .map_err(|cause| kernel_error(cause, call.head))?
        } else {
            let (utility, args) = if action == "run" {
                let Some((utility, args)) = rest.split_first() else {
                    return Err(error(
                        "missing utility",
                        "usage: aphrody utils run <utility> ...args",
                        call.head,
                    ));
                };
                (utility.clone(), args.to_vec())
            } else {
                (action, rest)
            };
            validate_utility(&utility)
                .map_err(|message| error("invalid utility name", message, call.head))?;
            if args.iter().any(|argument| argument.contains('\0')) {
                return Err(error(
                    "invalid utility argument",
                    "arguments cannot contain NUL bytes",
                    call.head,
                ));
            }
            if cwd.as_ref().is_some_and(|directory| directory.contains('\0')) {
                return Err(error(
                    "invalid working directory",
                    "--cwd cannot contain NUL bytes",
                    call.head,
                ));
            }

            let arguments = json!({
                "utility": utility,
                "args": args,
                "cwd": cwd,
                "timeout_ms": timeout_ms,
                "max_output_bytes": max_output_bytes,
                "output_format": output_format,
            });
            let result =
                run_kernel(timeout_ms, engine_state.signals().clone(), move |client| async move {
                    let core = client.call_tool("coreutils_catalog", json!({})).await?;
                    if catalog_has_utility(&core, &utility) {
                        client.call_tool("coreutils_run", arguments).await
                    } else {
                        let companions = client.call_tool("uutils_catalog", json!({})).await?;
                        if catalog_has_available_companion(&companions, &utility) {
                            client.call_tool("uutils_run", arguments).await
                        } else {
                            Err(aphrody_kernel_client::KernelClientError::Tool {
                                tool: utility,
                                message: "utility is not available in the kernel catalog"
                                    .to_owned(),
                            })
                        }
                    }
                })
                .map_err(|cause| kernel_error(cause, call.head))?;
            if check && result.get("exit_code").and_then(Json::as_i64).is_some_and(|code| code != 0)
            {
                return Err(error(
                    "utility exited unsuccessfully",
                    format!("exit code: {}", result["exit_code"]),
                    call.head,
                ));
            }
            result
        };

        Ok(json_to_nu(&response).into_pipeline_data())
    }
}

enum KernelError {
    Interrupted,
    Failed(String),
}

fn kernel_error(cause: KernelError, span: Span) -> ShellError {
    match cause {
        KernelError::Interrupted => ShellError::Interrupted { span },
        KernelError::Failed(message) => error("Aphrody OS kernel request failed", message, span),
    }
}

fn run_kernel<F, Fut>(timeout_ms: u64, signals: Signals, operation: F) -> Result<Json, KernelError>
where
    F: FnOnce(KernelClient) -> Fut,
    Fut: Future<Output = Result<Json, aphrody_kernel_client::KernelClientError>>,
{
    if tokio::runtime::Handle::try_current().is_ok() {
        return Err(KernelError::Failed(
            "kernel utility commands require blocking Nushell evaluation off the async executor"
                .to_owned(),
        ));
    }

    let runtime = Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|cause| KernelError::Failed(format!("kernel runtime unavailable: {cause}")))?;
    let request_timeout = timeout_ms.saturating_add(5_000);
    let mut options =
        ClientOptions::new(default_endpoint()).with_timeout(Duration::from_millis(request_timeout));
    if env::var_os("APHRODY_OS_AUTH_TOKEN").is_some() {
        let token = env::var("APHRODY_OS_AUTH_TOKEN").map_err(|_| {
            KernelError::Failed("APHRODY_OS_AUTH_TOKEN must contain valid Unicode text".to_owned())
        })?;
        options = options.with_auth_token(token);
    }
    runtime.block_on(async move {
        let request = async move {
            let client = KernelClient::connect(options)
                .await
                .map_err(|cause| KernelError::Failed(cause.to_string()))?;
            operation(client).await.map_err(|cause| KernelError::Failed(cause.to_string()))
        };
        tokio::select! {
            result = request => result,
            () = wait_for_interrupt(signals) => Err(KernelError::Interrupted),
        }
    })
}

async fn wait_for_interrupt(signals: Signals) {
    while !signals.interrupted() {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn catalog_rows(core: &Json, companions: &Json) -> Json {
    let mut rows = core
        .get("utilities")
        .and_then(Json::as_array)
        .into_iter()
        .flatten()
        .filter_map(Json::as_str)
        .map(|utility| json!({ "utility": utility, "provider": "coreutils", "available": true }))
        .collect::<Vec<_>>();
    rows.extend(
        companions
            .get("utilities")
            .and_then(Json::as_array)
            .into_iter()
            .flatten()
            .filter_map(Json::as_object)
            .filter_map(|companion| {
                Some(json!({
                    "utility": companion.get("utility")?.as_str()?,
                    "provider": "uutils companion",
                    "available": companion.get("available")?.as_bool()?,
                }))
            }),
    );
    Json::Array(rows)
}

fn catalog_has_utility(catalog: &Json, utility: &str) -> bool {
    catalog
        .get("utilities")
        .and_then(Json::as_array)
        .is_some_and(|utilities| utilities.iter().any(|entry| entry.as_str() == Some(utility)))
}

fn catalog_has_available_companion(catalog: &Json, utility: &str) -> bool {
    catalog.get("utilities").and_then(Json::as_array).is_some_and(|utilities| {
        utilities.iter().any(|entry| {
            entry.get("utility").and_then(Json::as_str) == Some(utility)
                && entry.get("available").and_then(Json::as_bool) == Some(true)
        })
    })
}

fn validate_utility(utility: &str) -> Result<(), String> {
    if utility.is_empty()
        || !utility.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'_' | b'.' | b'[')
        })
    {
        return Err("utility names cannot be paths or shell expressions".to_owned());
    }
    Ok(())
}

fn bounded_option(
    value: Option<i64>,
    default: u64,
    maximum: u64,
    name: &str,
) -> Result<u64, String> {
    let Some(value) = value else { return Ok(default) };
    let value = u64::try_from(value)
        .ok()
        .filter(|value| (1..=maximum).contains(value))
        .ok_or_else(|| format!("{name} must be between 1 and {maximum}"))?;
    Ok(value)
}

fn error(title: &str, message: impl Into<String>, span: Span) -> ShellError {
    ShellError::Generic(GenericError::new(title.to_owned(), message.into(), span))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        bounded_option, catalog_has_available_companion, catalog_has_utility, catalog_rows,
        validate_utility, wait_for_interrupt,
    };

    #[test]
    fn catalogs_preserve_provider_and_availability() {
        let rows = catalog_rows(
            &json!({ "utilities": ["ls", "cp"] }),
            &json!({ "utilities": [
                { "utility": "grep", "available": true },
                { "utility": "find", "available": false }
            ] }),
        );
        assert_eq!(rows[0]["provider"], "coreutils");
        assert_eq!(rows[2]["utility"], "grep");
        assert_eq!(rows[3]["available"], false);
    }

    #[test]
    fn only_catalogued_companions_are_selectable() {
        let catalog = json!({ "utilities": [
            { "utility": "grep", "available": true },
            { "utility": "find", "available": false }
        ] });
        assert!(catalog_has_available_companion(&catalog, "grep"));
        assert!(!catalog_has_available_companion(&catalog, "find"));
        assert!(!catalog_has_available_companion(&catalog, "unknown"));
        assert!(catalog_has_utility(&json!({ "utilities": ["ls"] }), "ls"));
    }

    #[test]
    fn rejects_utility_paths_and_shell_expressions() {
        assert!(validate_utility("grep").is_ok());
        assert!(validate_utility("../grep").is_err());
        assert!(validate_utility("grep;rm").is_err());
    }

    #[test]
    fn enforces_timeout_and_output_resource_bounds() {
        assert_eq!(bounded_option(None, 30_000, 300_000, "--timeout").unwrap(), 30_000);
        assert_eq!(bounded_option(Some(300_000), 1, 300_000, "--timeout").unwrap(), 300_000);
        assert!(bounded_option(Some(0), 1, 300_000, "--timeout").is_err());
        assert!(bounded_option(Some(-1), 1, 300_000, "--timeout").is_err());
        assert!(bounded_option(Some(8_388_609), 1, 8_388_608, "--max-output-bytes").is_err());
    }

    #[tokio::test]
    async fn interrupt_signal_cancels_kernel_wait() {
        use std::sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        };

        let flag = Arc::new(AtomicBool::new(false));
        let signals = nu_protocol::Signals::new(Arc::clone(&flag));
        let trigger = tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            flag.store(true, Ordering::Relaxed);
        });
        tokio::time::timeout(std::time::Duration::from_millis(100), wait_for_interrupt(signals))
            .await
            .expect("interruption is observed promptly");
        trigger.await.expect("signal trigger");
    }
}
