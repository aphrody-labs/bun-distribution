// SPDX-License-Identifier: Apache-2.0
//! The Aphrody OS kernel hosted in this server: its subsystems (systemd, compat, coreutils,
//! Nushell, Bun docs, infra, cloud, runtimes), the browser plugin and the Bun tool hosts
//! (`yolo tool`, M3) are served through this one MCP endpoint. `aphrody kernel mcp`, `yolo mcp`
//! and the M3 server are aliases of this server, not second servers.

use std::sync::{Arc, RwLock};

use aphrody_kernel::Kernel;
use rmcp::model::{CallToolRequestParams, CallToolResult, ContentBlock, Tool};
use serde_json::{Value, json};
use tokio::sync::OnceCell;

static KERNEL: OnceCell<Option<Arc<Kernel>>> = OnceCell::const_new();
/// The kernel catalogue as of the last `list`, for the synchronous `get_tool`.
static CATALOG: RwLock<Vec<Tool>> = RwLock::new(Vec::new());

async fn kernel() -> Option<Arc<Kernel>> {
    KERNEL
        .get_or_init(|| async {
            match aphrody_kernel::cli::embedded_kernel().await {
                Ok(kernel) => Some(Arc::new(kernel)),
                Err(error) => {
                    tracing::warn!(%error, "embedded Aphrody kernel unavailable");
                    None
                },
            }
        })
        .await
        .clone()
}

/// Kernel tools not already served by a built-in route.
pub(crate) async fn list(taken: impl Fn(&str) -> bool) -> Vec<Tool> {
    let Some(kernel) = kernel().await else { return Vec::new() };
    let tools: Vec<Tool> = kernel
        .tools()
        .await
        .into_iter()
        .filter(|(_, definition)| !taken(&definition.name))
        .filter_map(|(_, definition)| serde_json::from_value::<Tool>(definition.to_mcp()).ok())
        .collect();
    if let Ok(mut catalog) = CATALOG.write() {
        catalog.clone_from(&tools);
    }
    tools
}

pub(crate) fn get(name: &str) -> Option<Tool> {
    CATALOG.read().ok()?.iter().find(|tool| tool.name == name).cloned()
}

pub(crate) async fn owns(name: &str) -> bool {
    match kernel().await {
        Some(kernel) => kernel.tools().await.iter().any(|(_, tool)| tool.name == name),
        None => false,
    }
}

pub(crate) async fn call(request: &CallToolRequestParams) -> CallToolResult {
    let Some(kernel) = kernel().await else {
        return CallToolResult::error(vec![ContentBlock::text("Aphrody kernel unavailable")]);
    };
    let arguments =
        request.arguments.as_ref().map_or_else(|| json!({}), |map| Value::Object(map.clone()));
    let result = kernel.call_tool_result(request.name.as_ref(), arguments).await;
    serde_json::from_value(result).unwrap_or_else(|reason| {
        CallToolResult::error(vec![ContentBlock::text(format!("invalid kernel result: {reason}"))])
    })
}
