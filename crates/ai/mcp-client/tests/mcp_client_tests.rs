// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

use aphrody_mcp_client::{
    BXC_STABLE_ALIASES, MCP_PROTOCOL_VERSION, McpClientError, McpContent, PlanState, ToolCatalog,
    ToolSearchTool, UpdatePlanTool, mcp_schema_to_toolcall_schema,
    protocol::{
        jsonrpc_notification, jsonrpc_request, parse_call_tool_result, parse_response,
        parse_server_info, parse_tools_list,
    },
    register_builtins,
};
use aphrody_toolcall::{ToolExecutor, ToolExposure, ToolRegistry};
use serde_json::json;

#[test]
fn test_jsonrpc_request_formatting() {
    let req = jsonrpc_request(42, "tools/list", json!({}));
    let v: serde_json::Value = serde_json::from_str(&req).expect("valid JSON");
    assert_eq!(v["jsonrpc"], "2.0");
    assert_eq!(v["id"], 42);
    assert_eq!(v["method"], "tools/list");
}

#[test]
fn test_jsonrpc_notification_omits_id() {
    let notif = jsonrpc_notification("notifications/initialized", json!({}));
    let v: serde_json::Value = serde_json::from_str(&notif).expect("valid JSON");
    assert_eq!(v["jsonrpc"], "2.0");
    assert!(v.get("id").is_none());
    assert_eq!(v["method"], "notifications/initialized");
}

#[test]
fn test_parse_response_success_and_error() {
    let ok_frame = r#"{"jsonrpc":"2.0","id":1,"result":{"status":"ready"}}"#;
    let res = parse_response(ok_frame).expect("parse ok");
    assert_eq!(res["status"], "ready");

    let err_frame =
        r#"{"jsonrpc":"2.0","id":2,"error":{"code":-32601,"message":"Method not found"}}"#;
    match parse_response(err_frame) {
        Err(McpClientError::JsonRpc { code, message, .. }) => {
            assert_eq!(code, -32601);
            assert_eq!(message, "Method not found");
        },
        other => panic!("expected JsonRpc error, got {other:?}"),
    }
}

#[test]
fn test_parse_server_info_and_tools_list() {
    let init_res = json!({
        "protocolVersion": MCP_PROTOCOL_VERSION,
        "serverInfo": {
            "name": "test-bxc-server",
            "version": "1.0.0"
        },
        "capabilities": {
            "tools": {}
        }
    });
    let info = parse_server_info(&init_res).expect("parsed server info");
    assert_eq!(info.name, "test-bxc-server");
    assert_eq!(info.version, "1.0.0");
    assert_eq!(info.protocol_version, MCP_PROTOCOL_VERSION);

    let tools_res = json!({
        "tools": [
            {
                "name": "web_search",
                "description": "Perform web search",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"}
                    },
                    "required": ["query"]
                }
            }
        ]
    });
    let tools = parse_tools_list(&tools_res).expect("parsed tools list");
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name, "web_search");
    assert_eq!(tools[0].description.as_deref(), Some("Perform web search"));
}

#[test]
fn test_parse_call_tool_result_content() {
    let raw = json!({
        "content": [
            {
                "type": "text",
                "text": "Search results for Rust"
            },
            {
                "type": "image",
                "data": "iVBORw0KGgoAAAANSUhEUg==",
                "mimeType": "image/png"
            }
        ],
        "isError": false
    });

    let res = parse_call_tool_result(&raw).expect("parsed call result");
    assert!(!res.is_error());
    assert_eq!(res.text_content(), "Search results for Rust");
    assert_eq!(res.content.len(), 2);
    assert!(
        matches!(&res.content[1], McpContent::Image { mime_type, .. } if mime_type == "image/png")
    );
}

#[test]
fn structured_results_survive_and_unsupported_blocks_fail_explicitly() {
    let result = parse_call_tool_result(
        &json!({"content":[],"structuredContent":{"answer":42},"_meta":{"trace":"fixture"}}),
    )
    .unwrap();
    assert_eq!(result.structured_content, Some(json!({"answer":42})));
    assert_eq!(result.meta, Some(json!({"trace":"fixture"})));
    assert!(
        parse_call_tool_result(
            &json!({"content":[{"type":"audio","data":"AA==","mimeType":"audio/wav"}]})
        )
        .is_err()
    );
}

#[test]
fn test_schema_conversion_resilience() {
    let raw = json!({
        "type": "object",
        "description": "Scrape markdown arguments",
        "properties": {
            "url": { "type": "string", "description": "Target webpage URL" },
            "depth": { "type": "integer" }
        },
        "required": ["url"]
    });

    let schema = mcp_schema_to_toolcall_schema(&raw);
    assert_eq!(schema.description.as_deref(), Some("Scrape markdown arguments"));
    assert_eq!(schema.required.as_deref(), Some(&["url".to_string()][..]));
    let props = schema.properties.expect("properties");
    assert!(props.contains_key("url"));
    assert!(props.contains_key("depth"));
}

#[tokio::test]
async fn test_update_plan_builtin() {
    let state = PlanState::new();
    let tool = UpdatePlanTool::new(state.clone());

    let plan_input = json!({
        "plan": "- [x] P0 Convergence\n- [x] P1 Config\n- [ ] P3 MCP Client\n- [ ] P8 RAG",
        "current_step": "Building MCP Client"
    });

    let out = tool.handle(plan_input).await.expect("tool executed");
    assert!(!out.is_error);
    assert!(out.content.contains("2 completed, 2 pending"));
    assert!(out.content.contains("Building MCP Client"));

    assert_eq!(state.current_step().await.as_deref(), Some("Building MCP Client"));
}

#[tokio::test]
async fn test_tool_search_builtin() {
    let catalog = ToolCatalog::new();
    let search_tool = ToolSearchTool::new(catalog.clone());

    let def1 = aphrody_toolcall::ToolDefinition::new(
        "browser_navigate",
        "Navigate the active browser to a URL",
        aphrody_toolcall::JsonSchema::object(Default::default(), None, None),
    )
    .with_exposure(ToolExposure::Direct);

    let def2 = aphrody_toolcall::ToolDefinition::new(
        "fut_player_price",
        "Look up FIFA Ultimate Team player price on FUTBin",
        aphrody_toolcall::JsonSchema::object(Default::default(), None, None),
    )
    .with_exposure(ToolExposure::Deferred);

    catalog.add(def1).await;
    catalog.add(def2).await;

    // Search for browser:
    let out = search_tool.handle(json!({"query": "browser"})).await.expect("search ok");
    assert!(out.content.contains("browser_navigate"));
    assert!(!out.content.contains("fut_player_price"));

    // Search for fut:
    let out_fut = search_tool.handle(json!({"query": "fut player"})).await.expect("search ok");
    assert!(out_fut.content.contains("fut_player_price"));
}

#[test]
fn test_register_builtins() {
    let mut registry = ToolRegistry::new();
    let (plan_state, catalog) = register_builtins(&mut registry);

    assert!(registry.get("update_plan").is_some());
    assert!(registry.get("view_image").is_some());
    assert!(registry.get("tool_search").is_some());
    assert_eq!(registry.len(), 3);

    let _ = (plan_state, catalog);
}

#[test]
fn test_bxc_stable_aliases_coverage() {
    // Check essential aliases exist in BXC_STABLE_ALIASES
    let alias_names: Vec<&str> = BXC_STABLE_ALIASES.iter().map(|a| a.exposed_name).collect();

    assert!(alias_names.contains(&"web_search"));
    assert!(alias_names.contains(&"web_fetch"));
    assert!(alias_names.contains(&"web_crawl"));
    assert!(alias_names.contains(&"bxc_recon"));
    assert!(alias_names.contains(&"browser_navigate"));
    assert!(alias_names.contains(&"browser_snapshot"));
    assert!(alias_names.contains(&"browser_click"));
    assert!(alias_names.contains(&"browser_screenshot"));
    assert!(alias_names.contains(&"browser_close"));
    assert!(alias_names.contains(&"rag_remote_search"));
    assert!(alias_names.contains(&"google_fetch"));
    assert!(alias_names.contains(&"google_translate"));

    // Verify all aliases map to valid upstream targets
    for alias in BXC_STABLE_ALIASES {
        assert!(!alias.upstream_name.is_empty());
        assert!(!alias.description.is_empty());
    }
}
