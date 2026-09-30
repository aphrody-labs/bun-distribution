// SPDX-License-Identifier: Apache-2.0
//! Native stdio MCP adapter for the Aphrody Tauri desktop subsystem.

use clap::{Parser, Subcommand};
use rmcp::{
    ServerHandler, ServiceExt,
    handler::server::wrapper::Parameters,
    model::{
        CallToolResult, ContentBlock, Implementation, ProtocolVersion, ServerCapabilities,
        ServerConfig, Tool,
    },
    schemars::{self, JsonSchema},
    tool, tool_handler, tool_router,
    transport::io::stdio,
};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Debug, Parser)]
#[command(name = "aphrody-tauri-mcp", about = "Aphrody Tauri desktop webview MCP")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}
#[derive(Debug, Subcommand)]
enum Command {
    Server,
}
const SETUP_INSTRUCTIONS: &str = "Aphrody Tauri MCP is installed as aphrody-tauri-mcp. Configure the MCP command with args ['server']; the desktop app registers its Tauri subsystem in the per-user Aphrody kernel. Use tauri_window_list, tauri_driver_session and tauri_manage_window before targeting a webview.";

const TOOL_DEFINITIONS: &[(&str, &str, &str)] = &[
    ("tauri_window_list", "List local Aphrody Tauri windows.", r#"{"type":"object"}"#),
    (
        "tauri_dom_snapshot",
        "Read DOM text and accessible elements in a local Aphrody Tauri window.",
        r#"{"type":"object","properties":{"window_id":{"type":"string"}}}"#,
    ),
    (
        "tauri_find_element",
        "Find elements by CSS selector in a local Aphrody Tauri window.",
        r#"{"type":"object","properties":{"selector":{"type":"string"},"window_id":{"type":"string"}},"required":["selector"]}"#,
    ),
    (
        "tauri_interact",
        "Click, fill, type, focus or scroll an element in a local Aphrody Tauri window.",
        r#"{"type":"object","properties":{"action":{"type":"string","enum":["click","fill","type","focus","scroll_into_view"]},"selector":{"type":"string"},"text":{"type":"string"},"window_id":{"type":"string"}},"required":["action","selector"]}"#,
    ),
    (
        "tauri_execute_js",
        "Evaluate JavaScript in a local Aphrody Tauri webview for explicit UI inspection.",
        r#"{"type":"object","properties":{"script":{"type":"string"},"window_id":{"type":"string"}},"required":["script"]}"#,
    ),
    (
        "tauri_viewport_read",
        "Read rendered text and viewport dimensions in a local Aphrody Tauri webview.",
        r#"{"type":"object","properties":{"window_id":{"type":"string"}}}"#,
    ),
    (
        "tauri_screenshot",
        "Capture a local Aphrody Tauri window as a PNG image.",
        r#"{"type":"object","properties":{"window_id":{"type":"string"}}}"#,
    ),
    (
        "tauri_get_styles",
        "Read computed CSS styles for a local Aphrody Tauri element.",
        r#"{"type":"object","properties":{"selector":{"type":"string"},"window_id":{"type":"string"}},"required":["selector"]}"#,
    ),
    (
        "tauri_keyboard",
        "Dispatch a keydown or keyup event to a local Aphrody Tauri element.",
        r#"{"type":"object","properties":{"event":{"type":"string","enum":["keydown","keyup"]},"key":{"type":"string"},"selector":{"type":"string"},"window_id":{"type":"string"}},"required":["event","key"]}"#,
    ),
    (
        "tauri_wait_for",
        "Wait for a CSS selector or text to appear in a local Aphrody Tauri webview.",
        r#"{"type":"object","properties":{"selector":{"type":"string"},"text":{"type":"string"},"timeout_ms":{"type":"integer","minimum":0,"maximum":30000},"window_id":{"type":"string"}}}"#,
    ),
    (
        "tauri_driver_session",
        "Start, stop or inspect the local Tauri automation session.",
        r#"{"type":"object","properties":{"action":{"type":"string","enum":["start","stop","status"]}},"required":["action"]}"#,
    ),
    (
        "tauri_manage_window",
        "List, inspect or resize a local Tauri window.",
        r#"{"type":"object","properties":{"action":{"type":"string","enum":["list","info","resize"]},"window_id":{"type":"string"},"width":{"type":"integer","minimum":1},"height":{"type":"integer","minimum":1}},"required":["action"]}"#,
    ),
    (
        "tauri_get_setup_instructions",
        "Return Aphrody-specific setup instructions for the Tauri MCP consumer.",
        r#"{"type":"object"}"#,
    ),
    (
        "tauri_read_logs",
        "Read console entries explicitly buffered by a local Aphrody Tauri webview.",
        r#"{"type":"object","properties":{"window_id":{"type":"string"},"source":{"type":"string","enum":["console"]}}}"#,
    ),
    (
        "webview_get_pointed_element",
        "Inspect the DOM element at viewport coordinates in a local Tauri webview.",
        r#"{"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"window_id":{"type":"string"}},"required":["x","y"]}"#,
    ),
    (
        "webview_select_element",
        "Select a DOM element by CSS selector and return its geometry in a local Tauri webview.",
        r#"{"type":"object","properties":{"selector":{"type":"string"},"window_id":{"type":"string"}},"required":["selector"]}"#,
    ),
];

fn tools() -> Vec<Tool> {
    TOOL_DEFINITIONS
        .iter()
        .filter_map(|(name, description, schema)| {
            let input_schema = serde_json::from_str::<Value>(schema).ok()?;
            serde_json::from_value(
                json!({"name":name,"description":description,"inputSchema":input_schema}),
            )
            .ok()
        })
        .collect()
}

async fn kernel() -> Result<aphrody_kernel::client::Client, String> {
    let endpoint = aphrody_kernel::transport::default_endpoint();
    let client = aphrody_kernel::client::Client::connect(&endpoint)
        .await
        .map_err(|error| error.to_string())?;
    client.initialize("aphrody-tauri-mcp").await.map_err(|error| error.to_string())?;
    Ok(client)
}

async fn call_named(name: &str, arguments: Value) -> CallToolResult {
    let child = match kernel().await {
        Ok(child) => child,
        Err(error) => return CallToolResult::error(vec![ContentBlock::text(error)]),
    };
    let result = child
        .request(
            "tools/call",
            json!({"name":name,"arguments":arguments}),
            std::time::Duration::from_secs(30),
        )
        .await;
    match result {
        Ok(value) => serde_json::from_value(value).unwrap_or_else(|error| {
            CallToolResult::error(vec![ContentBlock::text(error.to_string())])
        }),
        Err(error) => CallToolResult::error(vec![ContentBlock::text(error.to_string())]),
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
struct Target {
    window_id: Option<String>,
}
#[derive(Debug, Deserialize, JsonSchema)]
struct FindRequest {
    selector: String,
    window_id: Option<String>,
}
#[derive(Debug, Deserialize, JsonSchema)]
struct KeyboardRequest {
    event: String,
    key: String,
    selector: Option<String>,
    window_id: Option<String>,
}
#[derive(Debug, Deserialize, JsonSchema)]
struct WaitRequest {
    selector: Option<String>,
    text: Option<String>,
    timeout_ms: Option<u64>,
    window_id: Option<String>,
}
#[derive(Debug, Deserialize, JsonSchema)]
struct Interaction {
    action: String,
    selector: String,
    text: Option<String>,
    window_id: Option<String>,
}
#[derive(Debug, Deserialize, JsonSchema)]
struct ScriptRequest {
    script: String,
    window_id: Option<String>,
}
#[derive(Debug, Deserialize, JsonSchema)]
struct DriverSessionRequest {
    action: String,
}
#[derive(Debug, Deserialize, JsonSchema)]
struct ManageWindowRequest {
    action: String,
    window_id: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
}
#[derive(Debug, Deserialize, JsonSchema)]
struct ReadLogsRequest {
    window_id: Option<String>,
    source: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct PointedElementRequest {
    x: f64,
    y: f64,
    window_id: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct SelectElementRequest {
    selector: String,
    window_id: Option<String>,
}

#[derive(Debug, Clone)]
struct TauriMcp;
#[tool_router]
impl TauriMcp {
    #[tool(description = "Return Aphrody-specific setup instructions for the Tauri MCP consumer.")]
    async fn tauri_get_setup_instructions(&self) -> CallToolResult {
        CallToolResult::success(vec![ContentBlock::text(SETUP_INSTRUCTIONS)])
    }
    #[tool(description = "List local Aphrody Tauri windows.")]
    async fn tauri_window_list(&self) -> CallToolResult {
        call_named("tauri_window_list", json!({})).await
    }
    #[tool(description = "Read DOM text and accessible elements in a local Aphrody Tauri window.")]
    async fn tauri_dom_snapshot(&self, Parameters(target): Parameters<Target>) -> CallToolResult {
        call_named("tauri_dom_snapshot", json!({"window_id":target.window_id})).await
    }
    #[tool(description = "Find elements by CSS selector in a local Aphrody Tauri window.")]
    async fn tauri_find_element(
        &self,
        Parameters(request): Parameters<FindRequest>,
    ) -> CallToolResult {
        call_named(
            "tauri_find_element",
            json!({"selector":request.selector,"window_id":request.window_id}),
        )
        .await
    }
    #[tool(
        description = "Click, fill, type, focus or scroll an element in a local Aphrody Tauri window."
    )]
    async fn tauri_interact(&self, Parameters(request): Parameters<Interaction>) -> CallToolResult {
        call_named("tauri_interact",json!({"action":request.action,"selector":request.selector,"text":request.text,"window_id":request.window_id})).await
    }
    #[tool(
        description = "Evaluate JavaScript in a local Aphrody Tauri webview for explicit UI inspection."
    )]
    async fn tauri_execute_js(
        &self,
        Parameters(request): Parameters<ScriptRequest>,
    ) -> CallToolResult {
        call_named(
            "tauri_execute_js",
            json!({"script":request.script,"window_id":request.window_id}),
        )
        .await
    }
    #[tool(
        description = "Read rendered text and viewport dimensions in a local Aphrody Tauri webview."
    )]
    async fn tauri_viewport_read(&self, Parameters(target): Parameters<Target>) -> CallToolResult {
        call_named("tauri_viewport_read", json!({"window_id":target.window_id})).await
    }
    #[tool(description = "Capture a local Aphrody Tauri window as a PNG image.")]
    async fn tauri_screenshot(&self, Parameters(target): Parameters<Target>) -> CallToolResult {
        call_named("tauri_screenshot", json!({"window_id":target.window_id})).await
    }
    #[tool(description = "Read computed CSS styles for a local Aphrody Tauri element.")]
    async fn tauri_get_styles(
        &self,
        Parameters(request): Parameters<FindRequest>,
    ) -> CallToolResult {
        call_named(
            "tauri_get_styles",
            json!({"selector":request.selector,"window_id":request.window_id}),
        )
        .await
    }
    #[tool(description = "Dispatch a keydown or keyup event to a local Aphrody Tauri element.")]
    async fn tauri_keyboard(
        &self,
        Parameters(request): Parameters<KeyboardRequest>,
    ) -> CallToolResult {
        call_named("tauri_keyboard", json!({"event":request.event,"key":request.key,"selector":request.selector,"window_id":request.window_id})).await
    }
    #[tool(
        description = "Wait for a CSS selector or text to appear in a local Aphrody Tauri webview."
    )]
    async fn tauri_wait_for(&self, Parameters(request): Parameters<WaitRequest>) -> CallToolResult {
        call_named("tauri_wait_for", json!({"selector":request.selector,"text":request.text,"timeout_ms":request.timeout_ms,"window_id":request.window_id})).await
    }
    #[tool(description = "Start, stop or inspect the local Tauri automation session.")]
    async fn tauri_driver_session(
        &self,
        Parameters(request): Parameters<DriverSessionRequest>,
    ) -> CallToolResult {
        call_named("tauri_driver_session", json!({"action":request.action})).await
    }
    #[tool(description = "List, inspect or resize a local Tauri window.")]
    async fn tauri_manage_window(
        &self,
        Parameters(request): Parameters<ManageWindowRequest>,
    ) -> CallToolResult {
        call_named("tauri_manage_window", json!({"action":request.action,"window_id":request.window_id,"width":request.width,"height":request.height})).await
    }
    #[tool(
        description = "Read console entries explicitly buffered by a local Aphrody Tauri webview."
    )]
    async fn tauri_read_logs(
        &self,
        Parameters(request): Parameters<ReadLogsRequest>,
    ) -> CallToolResult {
        call_named(
            "tauri_read_logs",
            json!({"window_id":request.window_id,"source":request.source}),
        )
        .await
    }

    #[tool(
        description = "Inspect the DOM element at viewport coordinates in a local Tauri webview."
    )]
    async fn webview_get_pointed_element(
        &self,
        Parameters(request): Parameters<PointedElementRequest>,
    ) -> CallToolResult {
        call_named(
            "webview_get_pointed_element",
            json!({"x":request.x,"y":request.y,"window_id":request.window_id}),
        )
        .await
    }

    #[tool(
        description = "Select a DOM element by CSS selector and return its geometry in a local Tauri webview."
    )]
    async fn webview_select_element(
        &self,
        Parameters(request): Parameters<SelectElementRequest>,
    ) -> CallToolResult {
        call_named(
            "webview_select_element",
            json!({"selector":request.selector,"window_id":request.window_id}),
        )
        .await
    }
}
#[tool_handler]
impl ServerHandler for TauriMcp {
    fn get_info(&self) -> ServerConfig {
        let mut config = ServerConfig::default();
        config.protocol_version = ProtocolVersion::LATEST;
        config.capabilities = ServerCapabilities::builder().enable_tools().build();
        config.server_info = Implementation::new("aphrody-tauri-mcp", env!("CARGO_PKG_VERSION"));
        config.instructions=Some("Tauri tools operate on Aphrody desktop windows through the per-user kernel. PNG screenshots use native window capture.".into());
        config
    }
    async fn list_tools(
        &self,
        _: Option<rmcp::model::PaginatedRequestParams>,
        _: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> std::result::Result<rmcp::model::ListToolsResult, rmcp::ErrorData> {
        Ok(rmcp::model::ListToolsResult::with_all_items(tools()))
    }
    fn get_tool(&self, name: &str) -> Option<Tool> {
        tools().into_iter().find(|tool| tool.name == name)
    }
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command.unwrap_or(Command::Server) {
        Command::Server => {},
    }
    tokio::runtime::Builder::new_multi_thread().enable_all().build()?.block_on(async {
        let server = TauriMcp.serve(stdio()).await?;
        server.waiting().await?;
        anyhow::Ok(())
    })
}
