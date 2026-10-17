// SPDX-License-Identifier: Apache-2.0
//! Tauri desktop tools proxied from the Aphrody kernel's UI-owned subsystem.

use std::{sync::LazyLock, time::Duration};

use crate::protocol;
use aphrody_kernel::client::Client;
use rmcp::model::{CallToolRequestParams, CallToolResult, ContentBlock, Tool};
use serde_json::{Value, json};
use tokio::sync::Mutex;

const PREFIX: &str = "aphrody_";
const TIMEOUT: Duration = Duration::from_secs(25);
const SETUP_INSTRUCTIONS: &str = "Aphrody Tauri tools are served by aphrody-mcp (and the in-process kernel); the desktop app registers its Tauri subsystem in the per-user Aphrody kernel. Use aphrody_tauri_window_list, aphrody_tauri_driver_session and aphrody_tauri_manage_window before targeting a webview.";
const TOOL_DEFINITIONS: &[(&str, &str, &str)] = &[
    (
        "aphrody_tauri_window_list",
        "List local Aphrody Tauri windows.",
        r#"{"type":"object"}"#,
    ),
    (
        "aphrody_tauri_dom_snapshot",
        "Read DOM text and accessible elements in a local Aphrody Tauri window.",
        r#"{"type":"object","properties":{"window_id":{"type":"string"}}}"#,
    ),
    (
        "aphrody_tauri_find_element",
        "Find elements by CSS selector in a local Aphrody Tauri window.",
        r#"{"type":"object","properties":{"selector":{"type":"string"},"window_id":{"type":"string"}},"required":["selector"]}"#,
    ),
    (
        "aphrody_tauri_interact",
        "Click, fill, type, focus or scroll an element in a local Aphrody Tauri window.",
        r#"{"type":"object","properties":{"action":{"type":"string","enum":["click","fill","type","focus","scroll_into_view"]},"selector":{"type":"string"},"text":{"type":"string"},"window_id":{"type":"string"}},"required":["action","selector"]}"#,
    ),
    (
        "aphrody_tauri_execute_js",
        "Evaluate JavaScript in a local Aphrody Tauri webview for explicit UI inspection.",
        r#"{"type":"object","properties":{"script":{"type":"string"},"window_id":{"type":"string"}},"required":["script"]}"#,
    ),
    (
        "aphrody_tauri_viewport_read",
        "Read rendered text and viewport dimensions in a local Aphrody Tauri webview.",
        r#"{"type":"object","properties":{"window_id":{"type":"string"}}}"#,
    ),
    (
        "aphrody_tauri_screenshot",
        "Capture a local Aphrody Tauri window as a PNG image.",
        r#"{"type":"object","properties":{"window_id":{"type":"string"}}}"#,
    ),
    (
        "aphrody_tauri_get_styles",
        "Read computed CSS styles for a local Aphrody Tauri element.",
        r#"{"type":"object","properties":{"selector":{"type":"string"},"window_id":{"type":"string"}},"required":["selector"]}"#,
    ),
    (
        "aphrody_tauri_keyboard",
        "Dispatch a keydown or keyup event to a local Aphrody Tauri element.",
        r#"{"type":"object","properties":{"event":{"type":"string","enum":["keydown","keyup"]},"key":{"type":"string"},"selector":{"type":"string"},"window_id":{"type":"string"}},"required":["event","key"]}"#,
    ),
    (
        "aphrody_tauri_wait_for",
        "Wait for a CSS selector or text to appear in a local Aphrody Tauri webview.",
        r#"{"type":"object","properties":{"selector":{"type":"string"},"text":{"type":"string"},"timeout_ms":{"type":"integer","minimum":0,"maximum":30000},"window_id":{"type":"string"}}}"#,
    ),
    (
        "aphrody_tauri_driver_session",
        "Start, stop or inspect the local Tauri automation session.",
        r#"{"type":"object","properties":{"action":{"type":"string","enum":["start","stop","status"]}},"required":["action"]}"#,
    ),
    (
        "aphrody_tauri_manage_window",
        "List, inspect or resize a local Tauri window.",
        r#"{"type":"object","properties":{"action":{"type":"string","enum":["list","info","resize"]},"window_id":{"type":"string"},"width":{"type":"integer","minimum":1},"height":{"type":"integer","minimum":1}},"required":["action"]}"#,
    ),
    (
        "aphrody_tauri_get_setup_instructions",
        "Return Aphrody-specific setup instructions for the Tauri MCP consumer.",
        r#"{"type":"object"}"#,
    ),
    (
        "aphrody_tauri_read_logs",
        "Read console entries explicitly buffered by a local Aphrody Tauri webview.",
        r#"{"type":"object","properties":{"window_id":{"type":"string"},"source":{"type":"string","enum":["console"]}}}"#,
    ),
    (
        "aphrody_webview_get_pointed_element",
        "Inspect the DOM element at viewport coordinates in a local Tauri webview.",
        r#"{"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"window_id":{"type":"string"}},"required":["x","y"]}"#,
    ),
    (
        "aphrody_webview_select_element",
        "Select a DOM element by CSS selector and return its geometry in a local Tauri webview.",
        r#"{"type":"object","properties":{"selector":{"type":"string"},"window_id":{"type":"string"}},"required":["selector"]}"#,
    ),
];
static CATALOG: Mutex<Option<Vec<Tool>>> = Mutex::const_new(None);
static SYNC_CATALOG: LazyLock<std::sync::RwLock<Vec<Tool>>> =
    LazyLock::new(|| std::sync::RwLock::new(Vec::new()));

fn static_tools() -> Vec<Tool> {
    TOOL_DEFINITIONS
        .iter()
        .filter_map(|(name, description, schema)| {
            let input_schema = serde_json::from_str::<Value>(schema).ok()?;
            let mut tool = serde_json::from_value(
                json!({"name":name,"description":description,"inputSchema":input_schema}),
            )
            .ok()?;
            protocol::annotate(&mut tool);
            Some(tool)
        })
        .collect()
}

async fn connect() -> Result<Client, String> {
    let endpoint = aphrody_kernel::transport::default_endpoint();
    let client = Client::connect(&endpoint)
        .await
        .map_err(|error| error.to_string())?;
    client
        .initialize("aphrody-mcp")
        .await
        .map_err(|error| error.to_string())?;
    Ok(client)
}

async fn catalog() -> Result<Vec<Tool>, String> {
    let mut cache = CATALOG.lock().await;
    if let Some(tools) = cache.as_ref().filter(|tools| !tools.is_empty()) {
        return Ok(tools.clone());
    }
    let client = connect().await?;
    let raw = client
        .request("tools/list", json!({}), TIMEOUT)
        .await
        .map_err(|error| error.to_string())?;
    let tools: Vec<Tool> = raw
        .get("tools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|tool| {
            tool.get("name")
                .and_then(Value::as_str)
                .is_some_and(is_kernel_tool)
        })
        .cloned()
        .filter_map(|tool| {
            serde_json::from_value(json!({
                "name": format!("{PREFIX}{}", tool["name"].as_str().unwrap_or_default()),
                "description": tool["description"],
                "inputSchema": tool["inputSchema"]
            }))
            .ok()
        })
        .collect();
    *SYNC_CATALOG
        .write()
        .map_err(|_| "Tauri catalog lock poisoned".to_owned())? = tools.clone();
    *cache = Some(tools.clone());
    Ok(tools)
}

/// Kernel-side names owned by the desktop Tauri subsystem.
fn is_kernel_tool(name: &str) -> bool {
    name.starts_with("tauri_") || name.starts_with("webview_")
}

pub(crate) async fn list(taken: impl Fn(&str) -> bool) -> Vec<Tool> {
    match catalog().await {
        Ok(tools) => tools
            .into_iter()
            .filter(|tool| !taken(tool.name.as_ref()))
            .collect(),
        Err(error) => {
            tracing::debug!(%error, "Tauri MCP catalog unavailable");
            static_tools()
                .into_iter()
                .filter(|tool| !taken(tool.name.as_ref()))
                .collect()
        }
    }
}
pub(crate) fn get(name: &str) -> Option<Tool> {
    SYNC_CATALOG
        .read()
        .ok()?
        .iter()
        .find(|tool| tool.name == name)
        .cloned()
        .or_else(|| static_tools().into_iter().find(|tool| tool.name == name))
}
pub(crate) async fn owns(name: &str) -> bool {
    static_tools().iter().any(|tool| tool.name == name)
}

pub(crate) async fn call(request: &CallToolRequestParams) -> CallToolResult {
    let name = request.name.as_ref();
    let Some(internal) = name
        .strip_prefix(PREFIX)
        .filter(|internal| is_kernel_tool(internal))
    else {
        return error(format!("unknown Tauri tool {name}"));
    };
    let arguments = request
        .arguments
        .as_ref()
        .map_or_else(|| json!({}), |map| Value::Object(map.clone()));
    if internal == "tauri_get_setup_instructions" {
        return CallToolResult::success(vec![ContentBlock::text(SETUP_INSTRUCTIONS)]);
    }
    let client = match connect().await {
        Ok(client) => client,
        Err(reason) => return error(format!("{name}: Aphrody kernel unavailable ({reason})")),
    };
    let result = client
        .request(
            "tools/call",
            json!({"name": internal, "arguments": arguments}),
            TIMEOUT,
        )
        .await;
    match result {
        Ok(raw) => serde_json::from_value(raw)
            .unwrap_or_else(|reason| error(format!("{name}: invalid kernel result: {reason}"))),
        Err(reason) => error(format!("{name}: {reason}")),
    }
}

fn error(message: impl std::fmt::Display) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(message.to_string())])
}
