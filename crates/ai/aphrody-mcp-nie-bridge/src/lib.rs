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
    io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::Mutex,
};

const PROTOCOL_VERSION: &str = "2025-06-18";
const LEGACY_PROTOCOL_VERSION: &str = "2024-11-05";
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

/// Read one newline-terminated frame without buffering beyond `limit` bytes.
/// Returns `None` only when EOF arrives before any bytes of a new frame.
async fn read_bounded_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    limit: usize,
) -> Result<Option<Vec<u8>>, String> {
    let mut line = Vec::with_capacity(limit.min(8 * 1024));
    loop {
        let available = reader.fill_buf().await.map_err(|e| format!("nie-mcp stdout: {e}"))?;
        if available.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err("nie-mcp closed stdout in the middle of a JSON-RPC frame".into())
            };
        }
        let count =
            available.iter().position(|byte| *byte == b'\n').map_or(available.len(), |i| i + 1);
        if line.len().saturating_add(count) > limit {
            return Err(format!("nie-mcp reply exceeds {limit} bytes"));
        }
        let complete = available[count - 1] == b'\n';
        line.extend_from_slice(&available[..count]);
        reader.consume(count);
        if complete {
            return Ok(Some(line));
        }
    }
}

/// Read responses until `id`; notifications and responses for other ids are skipped.
async fn read_response(stdout: &mut BufReader<ChildStdout>, id: u64) -> Result<Value, String> {
    loop {
        let line = read_bounded_line(stdout, MAX_LINE_BYTES)
            .await?
            .ok_or_else(|| "nie-mcp closed its stdout".to_owned())?;
        let message: Value = serde_json::from_slice(&line)
            .map_err(|error| format!("nie-mcp sent invalid JSON-RPC: {error}"))?;
        if message.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
            return Err("nie-mcp sent a frame without jsonrpc=\"2.0\"".into());
        }
        if message.get("id").and_then(Value::as_u64) != Some(id) {
            continue;
        }
        if let Some(error) = message.get("error") {
            let code = error.get("code").and_then(Value::as_i64);
            let text = error.get("message").and_then(Value::as_str).unwrap_or("unknown error");
            return Err(match code {
                Some(code) => format!("nie-mcp JSON-RPC error {code}: {text}"),
                None => format!("nie-mcp JSON-RPC error: {text}"),
            });
        }
        return message
            .get("result")
            .cloned()
            .ok_or_else(|| "nie-mcp response omitted both result and error".into());
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
    let initialize = tokio::time::timeout(timeout(), read_response(&mut session.stdout, 0))
        .await
        .map_err(|_| "nie-mcp initialize timed out".to_owned())??;
    let version = initialize
        .get("protocolVersion")
        .and_then(Value::as_str)
        .ok_or_else(|| "nie-mcp initialize response omitted protocolVersion".to_owned())?;
    if version != PROTOCOL_VERSION && version != LEGACY_PROTOCOL_VERSION {
        return Err(format!("nie-mcp negotiated unsupported protocol version {version}"));
    }
    if !initialize.get("capabilities").is_some_and(Value::is_object)
        || !initialize.get("serverInfo").is_some_and(Value::is_object)
    {
        return Err("nie-mcp initialize response omitted capabilities or serverInfo".into());
    }
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
        Ok(result) => match format_tool_catalog(result, r) {
            Ok(text) => CallToolResult::success(vec![ContentBlock::text(text)]),
            Err(message) => err(message),
        },
        Err(message) => err(message),
    }
}

fn format_tool_catalog(result: Value, request: ToolsRequest) -> Result<String, String> {
    let list = result
        .get("tools")
        .and_then(Value::as_array)
        .ok_or_else(|| "invalid NIE tools/list response: tools must be an array".to_owned())?;
    if list.iter().any(|tool| {
        !tool.get("name").and_then(Value::as_str).is_some_and(|name| !name.is_empty())
            || !tool.get("inputSchema").is_some_and(Value::is_object)
    }) {
        return Err(
            "invalid NIE tools/list response: each tool needs a name and inputSchema".into()
        );
    }
    let filter = request.filter.unwrap_or_default().to_lowercase();
    let rows: Vec<Value> = list
        .iter()
        .filter(|tool| {
            filter.is_empty()
                || tool
                    .get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| name.to_lowercase().contains(&filter))
        })
        .map(|tool| {
            if request.schemas.unwrap_or(false) {
                tool.clone()
            } else {
                json!({ "name": tool.get("name"), "description": tool.get("description") })
            }
        })
        .collect();
    serde_json::to_string_pretty(&json!({ "count": rows.len(), "tools": rows }))
        .map_err(|error| format!("unable to encode NIE tools/list response: {error}"))
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
#[serde(deny_unknown_fields)]
pub struct WikiCardRequest {
    /// Exact character ID.
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct WikiSearchRequest {
    /// Search text.
    pub query: String,
    /// Maximum results (1..=100, default 20).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
    use serde_json::json;

    #[derive(Debug, Default, Deserialize, JsonSchema)]
    struct CliToolRequest {
        /// Arguments after the top-level command and tool name.
        #[serde(default)]
        args: Vec<String>,
    }

    #[tokio::test]
    async fn bounded_line_enforces_limit_before_collecting_the_whole_frame() {
        let input = b"123456\nnext\n";
        let mut reader = BufReader::new(&input[..]);
        assert!(read_bounded_line(&mut reader, 5).await.unwrap_err().contains("exceeds 5"));

        let mut reader = BufReader::new(&input[..]);
        assert_eq!(read_bounded_line(&mut reader, 7).await.unwrap().unwrap(), b"123456\n");
        assert_eq!(read_bounded_line(&mut reader, 7).await.unwrap().unwrap(), b"next\n");
        assert!(read_bounded_line(&mut reader, 7).await.unwrap().is_none());
    }

    #[test]
    fn typed_requests_serialize_like_nie_mcp() {
        assert!(CliToolRequest::default().args.is_empty());
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
        let wiki_card_schema = generated_input_schema::<WikiCardRequest>();
        assert_eq!(wiki_card_schema["required"], json!(["id"]));
        assert_eq!(wiki_card_schema["additionalProperties"], false);
        let wiki_search_schema = generated_input_schema::<WikiSearchRequest>();
        assert_eq!(wiki_search_schema["required"], json!(["query"]));
        assert_eq!(wiki_search_schema["additionalProperties"], false);
        let zukan_schema = generated_input_schema::<ZukanRankRequest>();
        assert_eq!(zukan_schema["required"], json!(["entry", "candidates", "maxResults"]));
        assert_eq!(zukan_schema["additionalProperties"], false);
        assert!(zukan_schema["properties"].get("max_results").is_none());
    }

    #[tokio::test]
    async fn call_rejects_non_plain_tool_names() {
        let result = call(CallRequest { tool: "../x".into(), arguments: None }).await;
        assert_eq!(result.is_error, Some(true));
    }

    #[test]
    fn catalog_rejects_missing_or_incomplete_child_descriptors() {
        assert!(
            format_tool_catalog(json!({}), ToolsRequest::default())
                .unwrap_err()
                .contains("tools must be an array")
        );
        assert!(
            format_tool_catalog(
                json!({"tools": [{"name": "missing_schema"}]}),
                ToolsRequest::default(),
            )
            .unwrap_err()
            .contains("inputSchema")
        );
    }

    fn generated_input_schema<T: JsonSchema + std::any::Any>() -> Value {
        let schema = rmcp::handler::server::common::schema_for_input::<
            rmcp::handler::server::wrapper::Parameters<T>,
        >()
        .expect("valid object input schema");
        serde_json::to_value(schema.as_ref()).expect("serializable input schema")
    }

    fn source_mirror_schema(name: &str) -> Value {
        if name.starts_with("cli_") {
            return generated_input_schema::<CliToolRequest>();
        }
        match name {
            "wiki_character_card" => generated_input_schema::<WikiCardRequest>(),
            "wiki_search" => generated_input_schema::<WikiSearchRequest>(),
            "zukan_rank" => generated_input_schema::<ZukanRankRequest>(),
            "vfs_list" => generated_input_schema::<VfsListRequest>(),
            "vfs_search" => generated_input_schema::<VfsSearchRequest>(),
            "vfs_stat" | "explorer_open" => generated_input_schema::<PathRequest>(),
            "vfs_cat" => generated_input_schema::<VfsCatRequest>(),
            "asset_get" => generated_input_schema::<AssetRequest>(),
            "re_query" => generated_input_schema::<QueryRequest>(),
            "re_function" => generated_input_schema::<FunctionRequest>(),
            "repo_read" => generated_input_schema::<RepoReadRequest>(),
            "explorer_navigate" => generated_input_schema::<ExplorerNavigateRequest>(),
            "explorer_tab" => generated_input_schema::<ExplorerTabRequest>(),
            "explorer_toast" => generated_input_schema::<ExplorerToastRequest>(),
            "game_launch" => generated_input_schema::<GameLaunchRequest>(),
            "aphrody_api_health" | "re_coverage" | "explorer_status" => serde_json::to_value(
                rmcp::handler::server::common::schema_for_empty_input().as_ref(),
            )
            .expect("serializable empty input schema"),
            unknown => panic!("unmapped NIE MCP source tool {unknown}"),
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stdio_bridge_preserves_child_catalog_schema_and_call_result() {
        use std::{fs, os::unix::fs::PermissionsExt};

        let directory = tempfile::tempdir().unwrap();
        let child = directory.path().join("mock-nie-mcp");
        let catalog_path = directory.path().join("catalog.json");
        let starts_path = directory.path().join("starts.txt");
        let cli_tools = [
            "oc",
            "computer_use",
            "mod",
            "launcher",
            "viola",
            "format",
            "decode",
            "refresh_typed_json",
            "steam",
            "info",
            "locales",
            "convert",
            "render",
            "lua",
            "lua_run",
            "lua_audit",
            "net",
            "seed",
            "seed_ui",
            "strings",
            "find",
            "grep",
            "img",
            "play",
            "mode",
            "icons",
            "avatar",
            "ocgen",
            "atlas",
            "coverage",
            "queue",
            "propagate",
            "rtti",
            "index",
            "disasm",
            "pdata",
            "rebuild",
            "recover",
            "save",
            "wiki",
            "uniform_map",
            "textures",
            "menu_predecode",
            "mem",
            "vfs",
            "vn",
            "video",
            "live",
        ];
        let compat_tools = [
            "wiki_character_card",
            "wiki_search",
            "zukan_rank",
            "aphrody_api_health",
            "vfs_list",
            "vfs_search",
            "vfs_stat",
            "vfs_cat",
            "asset_get",
            "re_query",
            "re_function",
            "re_coverage",
            "repo_read",
            "explorer_status",
            "explorer_navigate",
            "explorer_open",
            "explorer_tab",
            "explorer_toast",
            "game_launch",
        ];
        assert_eq!(cli_tools.len() + compat_tools.len(), 67);
        let mut descriptors = Vec::new();
        for name in cli_tools
            .map(|name| format!("cli_{name}"))
            .into_iter()
            .chain(compat_tools.map(str::to_owned))
        {
            let input_schema = source_mirror_schema(&name);
            descriptors.push(json!({
                "name": name,
                "description": format!("Fixture for {name}"),
                "inputSchema": input_schema
            }));
        }
        fs::write(&catalog_path, serde_json::to_vec(&json!({"tools": descriptors})).unwrap())
            .unwrap();
        fs::write(
            &child,
            "#!/bin/sh\n\
             echo started >> \"$NIE_FIXTURE_STARTS\"\n\
             IFS= read -r initialize\n\
             printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":0,\"result\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"serverInfo\":{\"name\":\"fixture\",\"version\":\"1\"}}}'\n\
             IFS= read -r initialized\n\
             next=1\n\
             while IFS= read -r request; do\n\
               case \"$request\" in\n\
                 *slow_tool*) sleep 2; printf '{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"late\"}]}}\\n' \"$next\" ;;\n\
                 *fixture_error*) printf '{\"jsonrpc\":\"2.0\",\"id\":%s,\"error\":{\"code\":-32000,\"message\":\"fixture failure\"}}\\n' \"$next\" ;;\n\
                 *tools/list*) printf '{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":' \"$next\"; cat \"$NIE_FIXTURE_CATALOG\"; printf '}\\n' ;;\n\
                 *) printf '{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"fixture result\"}],\"isError\":false}}\\n' \"$next\" ;;\n\
               esac\n\
               next=$((next + 1))\n\
             done\n",
        )
        .unwrap();
        let mut permissions = fs::metadata(&child).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&child, permissions).unwrap();

        // SAFETY: this test is the only one that starts the child bridge, and the
        // environment variable is read synchronously when that child is started.
        unsafe { std::env::set_var("NIE_MCP_BIN", &child) };
        unsafe { std::env::set_var("NIE_MCP_TIMEOUT_SECS", "1") };
        unsafe { std::env::set_var("NIE_FIXTURE_CATALOG", &catalog_path) };
        unsafe { std::env::set_var("NIE_FIXTURE_STARTS", &starts_path) };

        let catalog = tools(ToolsRequest { filter: None, schemas: Some(false) }).await;
        let catalog_text = catalog.content[0].as_text().unwrap().text.as_str();
        let catalog: Value = serde_json::from_str(catalog_text).unwrap();
        assert_eq!(catalog["count"], 67);
        assert!(
            catalog["tools"].as_array().unwrap().iter().any(|tool| tool["name"] == "cli_atlas")
        );
        assert!(catalog["tools"][0].get("inputSchema").is_none());

        let schemas =
            tools(ToolsRequest { filter: Some("CLI_".into()), schemas: Some(true) }).await;
        let schemas: Value =
            serde_json::from_str(schemas.content[0].as_text().unwrap().text.as_str()).unwrap();
        assert_eq!(schemas["count"], 48);
        let atlas = schemas["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == "cli_atlas")
            .unwrap();
        assert_eq!(atlas["inputSchema"]["properties"]["args"]["items"]["type"], "string");

        let direct_schemas =
            tools(ToolsRequest { filter: Some("wiki_search".into()), schemas: Some(true) }).await;
        let direct_schemas: Value =
            serde_json::from_str(direct_schemas.content[0].as_text().unwrap().text.as_str())
                .unwrap();
        assert_eq!(direct_schemas["count"], 1);
        assert_eq!(direct_schemas["tools"][0]["inputSchema"]["required"], json!(["query"]));
        assert_eq!(direct_schemas["tools"][0]["inputSchema"]["additionalProperties"], false);

        let result = forward("cli_atlas", json!({ "args": ["status"] })).await;
        assert_eq!(result.is_error, Some(false));
        assert_eq!(result.content[0].as_text().unwrap().text, "fixture result");

        let child_error = forward("fixture_error", json!({})).await;
        assert_eq!(child_error.is_error, Some(true));
        assert!(child_error.content[0].as_text().unwrap().text.contains("-32000"));

        let timed_out = forward("slow_tool", json!({})).await;
        assert_eq!(timed_out.is_error, Some(true));
        assert!(timed_out.content[0].as_text().unwrap().text.contains("timed out"));
        let after_restart = forward("cli_atlas", json!({ "args": [] })).await;
        assert_eq!(after_restart.is_error, Some(false));
        assert_eq!(fs::read_to_string(&starts_path).unwrap().lines().count(), 3);

        // Drop the long-lived child before its temporary script and catalog disappear.
        SESSION.lock().await.take();
    }
}
