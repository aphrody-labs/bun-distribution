// SPDX-License-Identifier: Apache-2.0
//! Bun Windows WinClean SDK catalog re-exported over `aphrody-mcp` (feature `winclean`).
//!
//! The 166 tools of the in-process `aphrody-winclean` crate are advertised next to the
//! built-in tools and
//! dispatched in-process through [`aphrody_winclean`]: no second MCP process
//! child, no second stdio server. The tool list comes from the catalog embedded
//! and no duplicated Aphrody implementation. A built-in Aphrody tool always
//! wins a name clash.

use rmcp::model::{CallToolRequestParams, CallToolResult, ContentBlock, Tool};

/// Every WinClean tool as an MCP [`Tool`], minus names in `taken`.
pub(crate) fn list(taken: impl Fn(&str) -> bool) -> Vec<Tool> {
    aphrody_winclean::catalog()
        .iter()
        .filter(|info| !taken(&info.name))
        .filter_map(|info| {
            serde_json::from_value::<Tool>(serde_json::json!({
                "name": info.name,
                "description": info.description,
                "inputSchema": info.input_schema,
            }))
            .ok()
        })
        .collect()
}

/// The MCP [`Tool`] for `name`, when it is a WinClean tool.
pub(crate) fn get(name: &str) -> Option<Tool> {
    list(|candidate| candidate != name).into_iter().next()
}

/// Whether `name` belongs to the WinClean catalog.
pub(crate) fn owns(name: &str) -> bool {
    aphrody_winclean::TOOL_NAMES.contains(&name)
}

/// Runs a WinClean tool and returns its `CallToolResult` verbatim.
pub(crate) async fn call(request: &CallToolRequestParams) -> CallToolResult {
    let name = request.name.as_ref();
    let wc = match aphrody_winclean::shared() {
        Ok(wc) => wc,
        Err(error) => {
            return CallToolResult::error(vec![ContentBlock::text(format!(
                "{name}: aphrody-winclean backend unavailable ({error}); \
                 update ../aphrody-os and rebuild aphrody"
            ))]);
        },
    };
    let args = request
        .arguments
        .as_ref()
        .map_or_else(|| "{}".to_owned(), |map| serde_json::Value::Object(map.clone()).to_string());
    match wc.call_raw_async(name, &args).await {
        Ok(raw) => serde_json::from_str::<CallToolResult>(&raw).unwrap_or_else(|error| {
            CallToolResult::error(vec![ContentBlock::text(format!(
                "{name}: undecodable winclean result ({error}): {raw}"
            ))])
        }),
        Err(error) => CallToolResult::error(vec![ContentBlock::text(format!("{name}: {error}"))]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_converts_to_mcp_tools() {
        let tools = list(|_| false);
        assert_eq!(tools.len(), aphrody_winclean::TOOL_NAMES.len());
        let click = get("computer_click").expect("computer_click");
        assert!(click.input_schema.contains_key("properties"));
        assert!(get("not_a_winclean_tool").is_none());
        assert!(list(|n| n == "computer_click").iter().all(|t| t.name != "computer_click"));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn call_round_trips_through_the_bun_sdk() {
        if aphrody_winclean::Winclean::load().is_err() {
            return;
        }
        let request: CallToolRequestParams =
            serde_json::from_value(serde_json::json!({ "name": "get_os_info", "arguments": {} }))
                .unwrap();
        let result = call(&request).await;
        assert_ne!(result.is_error, Some(true), "{result:?}");
        let structured = result.structured_content.expect("structured WinClean result");
        assert!(structured.get("BuildNumber").is_some(), "{structured}");
    }
}
