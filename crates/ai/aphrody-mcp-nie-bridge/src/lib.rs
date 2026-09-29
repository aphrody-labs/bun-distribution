// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! `nie.*` — the NIE (Inazuma Eleven Victory Road) tools of the single Aphrody MCP.
//!
//! Replaces the separate `nie-game` MCP declaration of the retired `nie` plugin. The
//! game-domain implementation (VFS, Level-5 formats, reverse-engineering knowledge base,
//! wiki, explorer bridge, game launch) stays in the `nie` repository: `aphrody-ai` must not
//! link `nie` crates (`aphrody-infra/scripts/repo-layering.ts` lists no `nie` layer), so this
//! module is transport only. It keeps one long-lived `nie-mcp` child process over stdio
//! (JSON-RPC 2.0, newline-delimited, MCP handshake once) and forwards calls to it, so the
//! explorer loopback bridge that lives inside `nie-mcp` survives between calls.
//!
//! # Configuration
//!
//! | Variable | Default | Meaning |
//! | --- | --- | --- |
//! | `NIE_MCP_BIN` | `nie-mcp` (on `PATH`) | Command of the NIE MCP server; empty disables the family |
//! | `NIE_MCP_TIMEOUT_SECS` | `120` | Per-request timeout |
//!
//! Every other variable (`NIE_REPO`, `NIE_APHRODY_API_URL`, `NIE_MODEL_SERVE_URL`, ...) is
//! inherited by the child unchanged.

#![cfg(not(target_arch = "wasm32"))]

use std::{process::Stdio, time::Duration};

use rmcp::{
    model::{CallToolResult, ContentBlock},
    schemars::{self, JsonSchema},
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::Mutex,
};

const PROTOCOL_VERSION: &str = "2025-06-18";
const DEFAULT_TIMEOUT_SECS: u64 = 120;
/// Largest JSON-RPC line accepted from the child (base64 assets can be large).
const MAX_LINE_BYTES: usize = 64 * 1024 * 1024;

struct Session {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

static SESSION: Mutex<Option<Session>> = Mutex::const_new(None);

fn command() -> Result<String, String> {
    match std::env::var("NIE_MCP_BIN") {
        Ok(value) if value.trim().is_empty() => {
            Err("the nie.* tools are disabled (NIE_MCP_BIN is empty)".into())
        },
        Ok(value) => Ok(value),
        Err(_) => Ok("nie-mcp".into()),
    }
}

fn timeout() -> Duration {
    let secs = std::env::var("NIE_MCP_TIMEOUT_SECS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|secs| *secs > 0)
        .unwrap_or(DEFAULT_TIMEOUT_SECS);
    Duration::from_secs(secs)
}

async fn write_message(stdin: &mut ChildStdin, message: &Value) -> Result<(), String> {
    let mut line = serde_json::to_vec(message).map_err(|e| e.to_string())?;
    line.push(b'\n');
    stdin.write_all(&line).await.map_err(|e| format!("nie-mcp stdin: {e}"))?;
    stdin.flush().await.map_err(|e| format!("nie-mcp stdin: {e}"))
}

/// Read lines until the response carrying `id`; notifications and other ids are skipped.
async fn read_response(stdout: &mut BufReader<ChildStdout>, id: u64) -> Result<Value, String> {
    let mut line = String::new();
    loop {
        line.clear();
        let read = stdout.read_line(&mut line).await.map_err(|e| format!("nie-mcp stdout: {e}"))?;
        if read == 0 {
            return Err("nie-mcp closed its stdout".into());
        }
        if line.len() > MAX_LINE_BYTES {
            return Err(format!("nie-mcp reply exceeds {MAX_LINE_BYTES} bytes"));
        }
        let Ok(message) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if message.get("id").and_then(Value::as_u64) != Some(id) {
            continue;
        }
        if let Some(error) = message.get("error") {
            let text = error.get("message").and_then(Value::as_str).unwrap_or("unknown error");
            return Err(format!("nie-mcp: {text}"));
        }
        return Ok(message.get("result").cloned().unwrap_or(Value::Null));
    }
}

async fn start() -> Result<Session, String> {
    let program = command()?;
    let mut child = Command::new(&program)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("cannot start {program} (install nie-mcp or set NIE_MCP_BIN): {e}"))?;
    let stdin = child.stdin.take().ok_or("nie-mcp has no stdin")?;
    let stdout = BufReader::new(child.stdout.take().ok_or("nie-mcp has no stdout")?);
    let mut session = Session { child, stdin, stdout, next_id: 1 };
    let init = json!({
        "jsonrpc": "2.0",
        "id": 0,
        "method": "initialize",
        "params": {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "aphrody-mcp", "version": env!("CARGO_PKG_VERSION") }
        }
    });
    write_message(&mut session.stdin, &init).await?;
    tokio::time::timeout(timeout(), read_response(&mut session.stdout, 0))
        .await
        .map_err(|_| "nie-mcp initialize timed out".to_owned())??;
    let initialized = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
    write_message(&mut session.stdin, &initialized).await?;
    Ok(session)
}

/// One JSON-RPC request to the shared `nie-mcp` child, respawning it after any failure.
async fn request(method: &str, params: Value) -> Result<Value, String> {
    let mut guard = SESSION.lock().await;
    if guard.as_mut().is_some_and(|session| matches!(session.child.try_wait(), Ok(Some(_)))) {
        *guard = None;
    }
    if guard.is_none() {
        *guard = Some(start().await?);
    }
    let Some(session) = guard.as_mut() else {
        return Err("nie-mcp session unavailable".into());
    };
    let id = session.next_id;
    session.next_id += 1;
    let message = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
    let outcome = async {
        write_message(&mut session.stdin, &message).await?;
        tokio::time::timeout(timeout(), read_response(&mut session.stdout, id))
            .await
            .map_err(|_| format!("nie-mcp {method} timed out"))?
    }
    .await;
    if outcome.is_err() {
        // A broken or desynchronised child is dropped (kill_on_drop) and respawned next call.
        *guard = None;
    }
    outcome
}

fn err(message: impl std::fmt::Display) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(format!("nie: {message}"))])
}

/// Forward one `tools/call` and return the child's `CallToolResult` unchanged.
pub async fn forward(tool: &str, arguments: Value) -> CallToolResult {
    let arguments = match arguments {
        Value::Null => Value::Object(Map::new()),
        Value::Object(map) => Value::Object(map),
        _ => return err("arguments must be a JSON object"),
    };
    match request("tools/call", json!({ "name": tool, "arguments": arguments })).await {
        Ok(result) => serde_json::from_value::<CallToolResult>(result)
            .unwrap_or_else(|e| err(format!("unreadable tools/call result: {e}"))),
        Err(message) => err(message),
    }
}

async fn forward_typed<T: Serialize>(tool: &'static str, request: &T) -> CallToolResult {
    match serde_json::to_value(request) {
        Ok(arguments) => forward(tool, arguments).await,
        Err(e) => err(e),
    }
}

/// `nie.tools`: the live catalog of the NIE server (names, descriptions, input schemas).
pub async fn tools(r: ToolsRequest) -> CallToolResult {
    match request("tools/list", json!({})).await {
        Ok(result) => {
            let list = result.get("tools").and_then(Value::as_array).cloned().unwrap_or_default();
            let filter = r.filter.unwrap_or_default().to_lowercase();
            let rows: Vec<Value> = list
                .into_iter()
                .filter(|tool| {
                    filter.is_empty()
                        || tool
                            .get("name")
                            .and_then(Value::as_str)
                            .is_some_and(|name| name.to_lowercase().contains(&filter))
                })
                .map(|tool| {
                    if r.schemas.unwrap_or(false) {
                        tool
                    } else {
                        json!({ "name": tool.get("name"), "description": tool.get("description") })
                    }
                })
                .collect();
            let text = serde_json::to_string_pretty(&json!({ "count": rows.len(), "tools": rows }))
                .unwrap_or_else(|_| "null".into());
            CallToolResult::success(vec![ContentBlock::text(text)])
        },
        Err(message) => err(message),
    }
}

/// `nie.call`: any NIE tool by its server-side name (every `cli_*` command included).
pub async fn call(r: CallRequest) -> CallToolResult {
    let tool = r.tool.trim();
    if tool.is_empty()
        || tool.len() > 128
        || !tool.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return err("tool must be a plain NIE tool name such as vfs_list or cli_atlas");
    }
    forward(tool, r.arguments.unwrap_or(Value::Null)).await
}

macro_rules! forwarders {
    ($(($fn_name:ident, $tool:literal, $request:ty)),+ $(,)?) => {
        $(
            pub async fn $fn_name(r: $request) -> CallToolResult {
                forward_typed($tool, &r).await
            }
        )+
    };
}

forwarders!(
    (vfs_list, "vfs_list", VfsListRequest),
    (vfs_search, "vfs_search", VfsSearchRequest),
    (vfs_stat, "vfs_stat", PathRequest),
    (vfs_cat, "vfs_cat", VfsCatRequest),
    (asset_get, "asset_get", AssetRequest),
    (re_query, "re_query", QueryRequest),
    (re_function, "re_function", FunctionRequest),
    (repo_read, "repo_read", RepoReadRequest),
    (wiki_character_card, "wiki_character_card", WikiCardRequest),
    (wiki_search, "wiki_search", WikiSearchRequest),
    (zukan_rank, "zukan_rank", ZukanRankRequest),
    (explorer_navigate, "explorer_navigate", ExplorerNavigateRequest),
    (explorer_open, "explorer_open", PathRequest),
    (explorer_tab, "explorer_tab", ExplorerTabRequest),
    (explorer_toast, "explorer_toast", ExplorerToastRequest),
    (game_launch, "game_launch", GameLaunchRequest),
);

pub async fn re_coverage() -> CallToolResult {
    forward("re_coverage", Value::Null).await
}

pub async fn explorer_status() -> CallToolResult {
    forward("explorer_status", Value::Null).await
}

pub async fn health() -> CallToolResult {
    forward("aphrody_api_health", Value::Null).await
}

// ---------------------------------------------------------------------------
// Requests (mirror of the `nie-mcp` schemas in nie/crates/tools/nie-cli/src/mcp.rs)
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Deserialize, JsonSchema)]
pub struct ToolsRequest {
    /// Case-insensitive substring filter on the tool name (e.g. `cli_`, `vfs`).
    pub filter: Option<String>,
    /// Include each tool's input schema (default false).
    pub schemas: Option<bool>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CallRequest {
    /// Server-side NIE tool name, as listed by `nie.tools` (e.g. `cli_atlas`, `vfs_find`).
    pub tool: String,
    /// Tool arguments object; `cli_*` tools take `{"args": ["sub", "--flag", ...]}`.
    pub arguments: Option<Value>,
}

#[derive(Debug, Default, Serialize, Deserialize, JsonSchema)]
pub struct VfsListRequest {
    /// VFS prefix (default: root).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    /// Maximum entries (1..=5000, default 200).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

#[derive(Debug, Default, Serialize, Deserialize, JsonSchema)]
pub struct VfsSearchRequest {
    /// Case-insensitive substring or glob.
    pub query: String,
    /// Maximum results (1..=2000, default 100).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

#[derive(Debug, Default, Serialize, Deserialize, JsonSchema)]
pub struct PathRequest {
    /// VFS path.
    pub path: String,
}

#[derive(Debug, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct VfsCatRequest {
    /// VFS file path.
    pub path: String,
    /// Byte cap (1..=8 MiB, default 256 KiB).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssetRequest {
    /// VFS asset path, or a model code with `decode = "model"`.
    pub path: String,
    /// `raw` (default), `json`, `png`, `wav` or `model`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decode: Option<String>,
    /// Byte cap of the returned payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Default, Serialize, Deserialize, JsonSchema)]
pub struct QueryRequest {
    /// Read-only SQL over the RE knowledge base.
    pub sql: String,
    /// Maximum rows (1..=1000, default 50).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

#[derive(Debug, Default, Serialize, Deserialize, JsonSchema)]
pub struct FunctionRequest {
    /// Function name fragment.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Virtual address (hex).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vaddr: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RepoReadRequest {
    /// Repository-relative path inside the nie checkout.
    pub path: String,
    /// Byte cap.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_bytes: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct WikiCardRequest {
    /// Exact character ID.
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct WikiSearchRequest {
    /// Search text.
    pub query: String,
    /// Maximum results (1..=100, default 20).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ZukanRankRequest {
    /// Official encyclopedia entry (JSON).
    pub entry: Value,
    /// Candidate list (JSON).
    pub candidates: Value,
    /// Maximum suggestions.
    pub max_results: u32,
}

#[derive(Debug, Default, Serialize, Deserialize, JsonSchema)]
pub struct ExplorerNavigateRequest {
    /// VFS prefix to open.
    pub prefix: String,
    /// Entry to select.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub select: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize, JsonSchema)]
pub struct ExplorerTabRequest {
    /// editor, explorer, search, data, cpk, save, mods, re, lua or settings.
    pub tab: String,
}

#[derive(Debug, Default, Serialize, Deserialize, JsonSchema)]
pub struct ExplorerToastRequest {
    /// Notification text.
    pub message: String,
    /// info (default), success or error.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize, JsonSchema)]
pub struct GameLaunchRequest {
    /// Extra nie.exe arguments.
    #[serde(default)]
    pub args: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_requests_serialize_like_nie_mcp() {
        let cat =
            serde_json::to_value(VfsCatRequest { path: "a/b".into(), max_bytes: Some(8) }).unwrap();
        assert_eq!(cat, json!({ "path": "a/b", "maxBytes": 8 }));
        let list = serde_json::to_value(VfsListRequest::default()).unwrap();
        assert_eq!(list, json!({}));
        let zukan = serde_json::to_value(ZukanRankRequest {
            entry: json!({}),
            candidates: json!([]),
            max_results: 3,
        })
        .unwrap();
        assert_eq!(zukan["maxResults"], 3);
    }

    #[tokio::test]
    async fn call_rejects_non_plain_tool_names() {
        let result = call(CallRequest { tool: "../x".into(), arguments: None }).await;
        assert_eq!(result.is_error, Some(true));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stdio_bridge_preserves_child_catalog_schema_and_call_result() {
        use std::{fs, os::unix::fs::PermissionsExt};

        let directory = tempfile::tempdir().unwrap();
        let child = directory.path().join("mock-nie-mcp");
        fs::write(
            &child,
            "#!/bin/sh\n\
             IFS= read -r initialize\n\
             printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":0,\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"serverInfo\":{\"name\":\"fixture\",\"version\":\"1\"}}}'\n\
             IFS= read -r initialized\n\
             IFS= read -r list_tools\n\
             printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"fixture_tool\",\"description\":\"fixture\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"text\":{\"type\":\"string\"}}}}]}}'\n\
             IFS= read -r call_tool\n\
             printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"fixture result\"}],\"isError\":false}}'\n",
        )
        .unwrap();
        let mut permissions = fs::metadata(&child).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&child, permissions).unwrap();

        // SAFETY: this test is the only one that starts the child bridge, and the
        // environment variable is read synchronously when that child is started.
        unsafe { std::env::set_var("NIE_MCP_BIN", &child) };

        let catalog = tools(ToolsRequest { filter: None, schemas: Some(true) }).await;
        let catalog_text = catalog.content[0].as_text().unwrap().text.as_str();
        let catalog: Value = serde_json::from_str(catalog_text).unwrap();
        assert_eq!(catalog["count"], 1);
        assert_eq!(catalog["tools"][0]["name"], "fixture_tool");
        assert_eq!(catalog["tools"][0]["inputSchema"]["properties"]["text"]["type"], "string");

        let result = forward("fixture_tool", json!({ "text": "hello" })).await;
        assert_eq!(result.is_error, Some(false));
        assert_eq!(result.content[0].as_text().unwrap().text, "fixture result");
    }
}
