// aphrody addition (not upstream): an in-process API over this crate's MCP
// surface, so a host MCP server (aphrody-mcp) can publish and run every
// Obscura browser tool in process; the upstream stdio/HTTP JSON-RPC loops are
// removed (aphrody-mcp is the only MCP server). Tool handlers stay upstream's.
//
// `BrowserState` holds a V8 isolate and is `!Send`: callers keep it on one
// thread (a current-thread runtime / LocalSet).

use serde_json::{Value, json};

use crate::{BrowserState, handle_tool_call};

/// Every tool this build serves, as MCP tool descriptors
/// (`name`, `description`, `inputSchema`). Includes `browser_screenshot` and
/// `browser_pdf` when the crate is built with `render`.
pub fn tools() -> Vec<Value> {
    let response = crate::handle_tools_list(json!(0));
    response
        .result
        .as_ref()
        .and_then(|r| r.get("tools"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

/// Runs one tool and returns the MCP `tools/call` result
/// (`{ content: [...], isError? }`), or a JSON-RPC error message.
pub async fn call(state: &mut BrowserState, name: &str, arguments: Value) -> Result<Value, String> {
    let params = json!({ "name": name, "arguments": arguments });
    let response = handle_tool_call(json!(0), &params, state).await;
    if let Some(error) = response.error {
        return Err(error.message);
    }
    response.result.ok_or_else(|| "empty tool result".to_owned())
}
