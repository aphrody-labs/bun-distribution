// SPDX-License-Identifier: Apache-2.0
//! The Obscura browser, served natively by `aphrody-mcp` (feature `native-browser`).
//!
//! Obscura (`native/bxc-rust-bridge/crates/obscura-*`, vendored whole from
//! h4ckf0r0day/obscura) is a Rust browser engine: HTTP, html5ever DOM, V8 through
//! `deno_core`, and with `render` a layout/paint engine for screenshots and PDF.
//! Every tool of its MCP surface (navigate, snapshot, click, fill, markdown,
//! links, forms, tabs, cookies, storage state, scroll, extract, search,
//! screenshot, pdf, ...) is published here as `aphrody_browser_*` and run
//! in-process through `aphrody_web_service::WebSession`, so the list follows the vendored
//! engine automatically and no tool is relayed to the TypeScript backend.
//!
//! The session holds a V8 isolate (`!Send`), so it lives on one dedicated OS
//! thread with a current-thread Tokio runtime; handlers talk to it over a
//! channel. One page session is shared by every call.

use std::{
    sync::{LazyLock, OnceLock},
    time::Duration,
};

use rmcp::model::{CallToolRequestParams, CallToolResult, ContentBlock, Tool};
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};

/// Stack for the browser thread: V8 needs far more than the 2 MiB default.
const BROWSER_STACK: usize = 64 * 1024 * 1024;
/// Upper bound on one browser call (navigation plus scripts plus rendering).
const CALL_TIMEOUT: Duration = Duration::from_secs(180);
const ENGINE_PREFIX: &str = "browser_";
const PUBLIC_PREFIX: &str = "aphrody_browser_";

struct Job {
    tool: String,
    args: Value,
    reply: oneshot::Sender<Result<Value, String>>,
}

static WORKER: OnceLock<mpsc::UnboundedSender<Job>> = OnceLock::new();

fn worker() -> Result<&'static mpsc::UnboundedSender<Job>, String> {
    if let Some(sender) = WORKER.get() {
        return Ok(sender);
    }
    let (sender, mut receiver) = mpsc::unbounded_channel::<Job>();
    std::thread::Builder::new()
        .name("aphrody-browser".to_owned())
        .stack_size(BROWSER_STACK)
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
                Ok(runtime) => runtime,
                Err(error) => {
                    tracing::error!(%error, "browser runtime failed to start");
                    return;
                },
            };
            let local = tokio::task::LocalSet::new();
            local.block_on(&runtime, async move {
                let proxy = std::env::var("APHRODY_BROWSER_PROXY").ok().filter(|p| !p.is_empty());
                let stealth =
                    matches!(std::env::var("APHRODY_BROWSER_STEALTH").as_deref(), Ok("1" | "true"));
                let mut state = aphrody_web_service::WebSession::new(proxy, None, stealth);
                while let Some(job) = receiver.recv().await {
                    let result = state.call(&job.tool, job.args).await;
                    let _ = job.reply.send(result);
                }
            });
        })
        .map_err(|error| format!("browser thread: {error}"))?;
    Ok(WORKER.get_or_init(|| sender))
}

/// The engine's tool catalog as public MCP tools (built once; pure data, no V8).
static CATALOG: LazyLock<Vec<Tool>> = LazyLock::new(|| {
    aphrody_web_service::WebSession::tools()
        .into_iter()
        .filter_map(|tool| {
            let name = tool.get("name")?.as_str()?;
            let public = format!("{PUBLIC_PREFIX}{}", name.strip_prefix(ENGINE_PREFIX).unwrap_or(name));
            serde_json::from_value::<Tool>(json!({
                "name": public,
                "description": tool.get("description").cloned().unwrap_or(json!("")),
                "inputSchema": tool.get("inputSchema").cloned().unwrap_or(json!({ "type": "object" })),
            }))
            .ok()
        })
        .collect()
});

/// Every browser tool, minus names in `taken`.
pub(crate) fn list(taken: impl Fn(&str) -> bool) -> Vec<Tool> {
    CATALOG.iter().filter(|tool| !taken(tool.name.as_ref())).cloned().collect()
}

pub(crate) fn get(name: &str) -> Option<Tool> {
    CATALOG.iter().find(|tool| tool.name == name).cloned()
}

pub(crate) fn owns(name: &str) -> bool {
    CATALOG.iter().any(|tool| tool.name == name)
}

fn engine_name(public: &str) -> String {
    format!("{ENGINE_PREFIX}{}", public.strip_prefix(PUBLIC_PREFIX).unwrap_or(public))
}

async fn run(tool: String, args: Value) -> Result<Value, String> {
    let (reply, answer) = oneshot::channel();
    let label = tool.clone();
    worker()?.send(Job { tool, args, reply }).map_err(|_| "browser thread stopped".to_owned())?;
    tokio::time::timeout(CALL_TIMEOUT, answer)
        .await
        .map_err(|_| format!("{label} timed out after {}s", CALL_TIMEOUT.as_secs()))?
        .map_err(|_| "browser thread dropped the call".to_owned())?
}

/// Runs a browser tool and returns the engine's `CallToolResult` verbatim
/// (text, image or resource content).
pub(crate) async fn call(request: &CallToolRequestParams) -> CallToolResult {
    let name = request.name.as_ref();
    let args =
        request.arguments.as_ref().map_or_else(|| json!({}), |map| Value::Object(map.clone()));
    match run(engine_name(name), args).await {
        Ok(raw) => serde_json::from_value::<CallToolResult>(raw.clone()).unwrap_or_else(|error| {
            CallToolResult::error(vec![ContentBlock::text(format!(
                "{name}: undecodable result ({error}): {raw}"
            ))])
        }),
        Err(reason) => CallToolResult::error(vec![ContentBlock::text(format!("{name}: {reason}"))]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(name: &str, args: Value) -> CallToolRequestParams {
        serde_json::from_value(json!({ "name": name, "arguments": args })).unwrap()
    }

    fn text(result: &CallToolResult) -> String {
        serde_json::to_string(&result.content).unwrap()
    }

    #[test]
    fn catalog_publishes_every_engine_tool() {
        assert!(CATALOG.len() >= 30, "expected the full Obscura catalog, got {}", CATALOG.len());
        assert_eq!(CATALOG.len(), aphrody_web_service::WebSession::tools().len());
        for name in [
            "aphrody_browser_navigate",
            "aphrody_browser_snapshot",
            "aphrody_browser_markdown",
            "aphrody_browser_fill_form",
        ] {
            assert!(owns(name), "{name}");
        }
        assert!(CATALOG.iter().all(|t| t.name.starts_with(PUBLIC_PREFIX)));
        assert_eq!(engine_name("aphrody_browser_click"), "browser_click");
    }

    #[tokio::test]
    async fn shared_session_rejects_non_web_navigation_without_network() {
        let result =
            call(&request("aphrody_browser_navigate", json!({ "url": "file:///tmp/a" }))).await;
        assert_eq!(result.is_error, Some(true));
        assert!(text(&result).contains("not allowed"), "{result:?}");
    }

    #[test]
    fn native_catalog_claims_source_browser_aliases_before_child_catalog() {
        for source_name in [
            "bxc_browser_navigate",
            "browser_snapshot",
            "bxc_browser_click",
            "browser_fill",
            "bxc_browser_type",
            "browser_press_key",
            "bxc_browser_select_option",
            "browser_evaluate",
            "bxc_browser_wait_for",
            "browser_screenshot",
            "bxc_browser_pdf",
            "browser_close",
        ] {
            let public = crate::bxc_tools::public_name(source_name);
            assert!(owns(&public), "{source_name} should resolve to native {public}");
        }
    }

    /// Drives the in-process engine on a real page.
    ///
    /// Network-dependent (loads example.com). Also aborts inside V8 on Windows
    /// debug builds ("table->address(index) == table->address(encoded_index)",
    /// a snapshot external-reference mismatch in aphrody-web obscura), so it is
    /// opt-in: `cargo test -p aphrody-mcp -- --ignored engine_runs`.
    #[tokio::test]
    #[ignore = "network-dependent; V8 snapshot abort on Windows debug (aphrody-web obscura)"]
    async fn engine_runs_a_page_end_to_end() {
        let nav =
            call(&request("aphrody_browser_navigate", json!({ "url": "https://example.com" })))
                .await;
        if nav.is_error == Some(true) {
            eprintln!("offline: {}", text(&nav));
            return;
        }
        let md = call(&request("aphrody_browser_markdown", json!({}))).await;
        assert!(text(&md).contains("Example Domain"), "{}", text(&md));
        let count = call(&request(
            "aphrody_browser_evaluate",
            json!({ "expression": "document.querySelectorAll('a').length" }),
        ))
        .await;
        assert_ne!(count.is_error, Some(true), "{}", text(&count));
    }
}
