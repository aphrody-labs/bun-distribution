// SPDX-License-Identifier: Apache-2.0
//! The Aphrody OS kernel hosted in this server: its subsystems (systemd, compat, coreutils,
//! Nushell, Bun docs, infra, cloud, runtimes), the browser plugin and the Bun tool hosts
//! (`yolo tool`, M3) are served through this one MCP endpoint. `aphrody kernel mcp`, `yolo mcp`
//! and the M3 server are aliases of this server, not second servers.

use std::{
    collections::HashSet,
    sync::{Arc, RwLock},
    time::Duration,
};

use aphrody_kernel::{
    Kernel,
    client::{Client, ClientError},
    transport::default_endpoint,
};
use rmcp::model::{CallToolRequestParams, CallToolResult, ContentBlock, Tool};
use serde_json::{Value, json};
use tokio::sync::OnceCell;

static KERNEL: OnceCell<Option<Arc<Kernel>>> = OnceCell::const_new();
/// The kernel catalogue as of the last `list`, for the synchronous `get_tool`.
static CATALOG: RwLock<Vec<Tool>> = RwLock::new(Vec::new());

fn imported_native_tool(name: &str) -> bool {
    ["desktop_", "windows_", "privileged_"].iter().any(|prefix| name.starts_with(prefix))
}

// The owner-only native endpoint imports authenticated Windows/desktop/root bridges.
// Connect per operation so restarts recover without replaying a call of unknown outcome.
async fn bridge_request(
    endpoint: &str,
    method: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, ClientError> {
    tokio::time::timeout(timeout, async {
        let client = Client::connect(endpoint).await?;
        client.initialize("aphrody-mcp-native-bridge").await?;
        client.request(method, params, timeout).await
    })
    .await
    .map_err(|_| ClientError::Timeout { method: method.to_owned() })?
}

async fn bridge_tools(endpoint: &str) -> Result<Vec<Tool>, ClientError> {
    let result = bridge_request(endpoint, "tools/list", json!({}), Duration::from_secs(2)).await?;
    let tools = result.get("tools").and_then(Value::as_array).ok_or_else(|| ClientError::Rpc {
        code: -32603,
        message: "native bridge returned an invalid tool catalog".to_owned(),
    })?;
    Ok(tools
        .iter()
        .filter(|tool| tool.get("name").and_then(Value::as_str).is_some_and(imported_native_tool))
        .filter_map(|tool| serde_json::from_value(tool.clone()).ok())
        .collect())
}

async fn bridge_call(endpoint: &str, request: &CallToolRequestParams) -> CallToolResult {
    let arguments =
        request.arguments.as_ref().map_or_else(|| json!({}), |map| Value::Object(map.clone()));
    match bridge_request(
        endpoint,
        "tools/call",
        json!({"name":request.name, "arguments":arguments}),
        Duration::from_secs(30),
    )
    .await
    {
        Ok(result) => serde_json::from_value(result).unwrap_or_else(|reason| {
            CallToolResult::error(vec![ContentBlock::text(format!(
                "invalid native bridge result: {reason}"
            ))])
        }),
        Err(reason) => CallToolResult::error(vec![ContentBlock::text(format!(
            "native bridge unavailable: {reason}"
        ))]),
    }
}

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
    let mut tools: Vec<Tool> = if let Some(kernel) = kernel().await {
        kernel
            .tools()
            .await
            .into_iter()
            .filter(|(_, definition)| !taken(&definition.name))
            .filter_map(|(_, definition)| serde_json::from_value::<Tool>(definition.to_mcp()).ok())
            .collect()
    } else {
        Vec::new()
    };
    let occupied: HashSet<String> = tools.iter().map(|tool| tool.name.to_string()).collect();
    if let Ok(imported) = bridge_tools(&default_endpoint()).await {
        tools.extend(
            imported
                .into_iter()
                .filter(|tool| !taken(&tool.name) && !occupied.contains(tool.name.as_ref())),
        );
    }
    if let Ok(mut catalog) = CATALOG.write() {
        catalog.clone_from(&tools);
    }
    tools
}

pub(crate) fn get(name: &str) -> Option<Tool> {
    CATALOG.read().ok()?.iter().find(|tool| tool.name == name).cloned()
}

pub(crate) async fn owns(name: &str) -> bool {
    if let Some(kernel) = kernel().await
        && kernel.tools().await.iter().any(|(_, tool)| tool.name == name)
    {
        return true;
    }
    if imported_native_tool(name) {
        return bridge_tools(&default_endpoint())
            .await
            .is_ok_and(|tools| tools.iter().any(|tool| tool.name == name));
    }
    false
}

pub(crate) async fn call(request: &CallToolRequestParams) -> CallToolResult {
    let kernel = kernel().await;
    let embedded_owns = if let Some(kernel) = &kernel {
        kernel.tools().await.iter().any(|(_, tool)| tool.name == request.name)
    } else {
        false
    };
    if imported_native_tool(request.name.as_ref()) && !embedded_owns {
        return bridge_call(&default_endpoint(), request).await;
    }
    let Some(kernel) = kernel else {
        return CallToolResult::error(vec![ContentBlock::text("Aphrody kernel unavailable")]);
    };
    let arguments =
        request.arguments.as_ref().map_or_else(|| json!({}), |map| Value::Object(map.clone()));
    let result = kernel.call_tool_result(request.name.as_ref(), arguments).await;
    serde_json::from_value(result).unwrap_or_else(|reason| {
        CallToolResult::error(vec![ContentBlock::text(format!("invalid kernel result: {reason}"))])
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    fn peer(result: Value) -> (tempfile::TempDir, String, tokio::task::JoinHandle<()>) {
        let directory = tempfile::tempdir().unwrap();
        let endpoint = directory.path().join("native.sock");
        let listener = tokio::net::UnixListener::bind(&endpoint).unwrap();
        let task = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (read, mut write) = stream.into_split();
            let mut read = BufReader::new(read);
            let mut line = String::new();
            while read.read_line(&mut line).await.unwrap() > 0 {
                let message: Value = serde_json::from_str(&line).unwrap();
                line.clear();
                let Some(id) = message.get("id") else { continue };
                let initializing = message["method"] == "initialize";
                let payload = if initializing {
                    json!({"protocolVersion":"2025-03-26", "capabilities":{}})
                } else {
                    result.clone()
                };
                write
                    .write_all(
                        format!("{}\n", json!({"jsonrpc":"2.0", "id":id, "result":payload}))
                            .as_bytes(),
                    )
                    .await
                    .unwrap();
                if !initializing {
                    break;
                }
            }
        });
        (directory, endpoint.to_string_lossy().into_owned(), task)
    }

    #[tokio::test]
    async fn native_catalog_import_cannot_replace_builtin_owners() {
        let definition =
            |name| json!({"name":name, "description":"native", "inputSchema":{"type":"object"}});
        let (_directory, endpoint, task) = peer(
            json!({"tools":[definition("desktop_computer_observe"), definition("aphrody_search"), definition("nu_eval")]}),
        );
        let tools = bridge_tools(&endpoint).await.unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "desktop_computer_observe");
        task.await.unwrap();
    }

    #[tokio::test]
    async fn native_call_preserves_images_and_error_results() {
        for result in [
            json!({"content":[{"type":"image", "data":"AQ==", "mimeType":"image/png"}], "structuredContent":{"window":{"Handle":42}}, "isError":false}),
            json!({"content":[{"type":"text", "text":"foreground denied"}], "isError":true}),
        ] {
            let (_directory, endpoint, task) = peer(result.clone());
            let request =
                serde_json::from_value(json!({"name":"desktop_computer_observe", "arguments":{}}))
                    .unwrap();
            let returned = serde_json::to_value(bridge_call(&endpoint, &request).await).unwrap();
            assert_eq!(returned["content"], result["content"]);
            assert_eq!(returned["isError"], result["isError"]);
            assert_eq!(returned.get("structuredContent"), result.get("structuredContent"));
            task.await.unwrap();
        }
    }
}
