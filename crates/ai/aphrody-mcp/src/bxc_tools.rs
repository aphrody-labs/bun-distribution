// SPDX-License-Identifier: Apache-2.0
//! BXC catalog re-exported over `aphrody-mcp`.
//!
//! BXC is not a second MCP server any more: every tool of the BXC backend is
//! advertised in `aphrody-mcp`'s own `tools/list` and dispatched through it, so
//! Claude Code, Codex and Antigravity register exactly one server. The BXC
//! backend (`bxc mcp`, resolved by [`aphrody_web_bridge::resolve::binary`]) runs as an
//! internal stdio child that no client configuration names.
//!
//! - The catalog is fetched once and cached; a failed fetch is not cached, so a BXC installed after
//!   start-up appears on the next `tools/list`.
//! - Calls borrow a connected child from a small idle pool, so two long BXC calls (a crawl and a
//!   search) run concurrently instead of queueing behind one stdio pipe. A child that failed a call
//!   is dropped, never pooled.
//! - Tools are published under Aphrody names (`bxc_search` -> `aphrody_search`, `browser_click` ->
//!   `aphrody_browser_click`), with descriptions free of the internal code name; [`internal_name`]
//!   maps a public name back.
//! - A built-in aphrody tool always wins a name clash.
//! - `APHRODY_MCP_NO_WEB=1` removes the BXC catalog (the `aphrody_web_call` gateway stays
//!   available).

use std::{sync::LazyLock, time::Duration};

use aphrody_gemini_runtime::McpClient;
use rmcp::model::{CallToolRequestParams, CallToolResult, ContentBlock, Tool};
use serde_json::Value;
use tokio::sync::Mutex;

#[cfg(all(feature = "native-browser", not(target_arch = "wasm32")))]
use crate::browser_tools;
#[cfg(not(target_arch = "wasm32"))]
use crate::{gemini_tools, search_tools};
use crate::{native_crawl_tools, public_web_tools, x_tools};

/// Idle connected BXC children kept for reuse.
const MAX_IDLE: usize = 4;
/// Upper bound on the first catalog fetch, so a hung BXC never stalls `tools/list`.
const CATALOG_TIMEOUT: Duration = Duration::from_secs(20);
/// Default per-call timeout: crawls and mirrors legitimately run for minutes.
const DEFAULT_CALL_TIMEOUT_SECS: u64 = 600;

static POOL: LazyLock<Mutex<Vec<McpClient>>> = LazyLock::new(|| Mutex::new(Vec::new()));
static CATALOG: LazyLock<Mutex<Option<Vec<Tool>>>> = LazyLock::new(|| Mutex::new(None));
/// Public name -> backend name, filled with the catalog.
static NAMES: LazyLock<std::sync::RwLock<std::collections::HashMap<String, String>>> =
    LazyLock::new(|| std::sync::RwLock::new(std::collections::HashMap::new()));
/// Synchronous mirror of the cached catalog, for `ServerHandler::get_tool`.
static CATALOG_SYNC: LazyLock<std::sync::RwLock<Vec<Tool>>> =
    LazyLock::new(|| std::sync::RwLock::new(Vec::new()));

/// Whether the BXC catalog is merged into `tools/list`.
pub(crate) fn enabled() -> bool {
    !matches!(std::env::var("APHRODY_MCP_NO_WEB").as_deref(), Ok("1" | "true" | "yes"))
}

fn call_timeout() -> Duration {
    let secs = std::env::var("APHRODY_WEB_TIMEOUT_SECS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|secs| *secs > 0)
        .unwrap_or(DEFAULT_CALL_TIMEOUT_SECS);
    Duration::from_secs(secs)
}

/// The OS backend inherits its own explicit BXC paths from the parent process.
/// Only the MCP recursion guard is injected by the AI layer.
fn backend_env() -> std::collections::HashMap<String, String> {
    let mut env = std::collections::HashMap::new();
    // `bxc mcp` hands the session to aphrody-mcp unless it is asked for the
    // aphrody_backend; without this the child would start another aphrody-mcp.
    env.insert("BXC_MCP_BACKEND".to_owned(), "1".to_owned());
    env
}

/// Spawns and initialises a fresh `bxc mcp` child.
pub(crate) async fn connect() -> Result<McpClient, String> {
    let source = aphrody_web_bridge::resolve::binary().map_err(|error| error.to_string())?;
    let binary = source.into_path();
    let command = binary.to_string_lossy();
    let env = backend_env();
    let mut client =
        McpClient::from_stdio(&command, &["mcp"], &env).await.map_err(|error| error.to_string())?;
    client.rpc_timeout = call_timeout();
    client.initialize().await.map_err(|error| error.to_string())?;
    Ok(client)
}

async fn checkout() -> Result<McpClient, String> {
    if let Some(client) = POOL.lock().await.pop() {
        return Ok(client);
    }
    connect().await
}

async fn checkin(mut client: McpClient) {
    let mut pool = POOL.lock().await;
    if pool.len() < MAX_IDLE {
        pool.push(client);
    } else {
        drop(pool);
        client.shutdown().await;
    }
}

/// The public Aphrody name of a backend tool: the internal `bxc_` prefix becomes
/// `aphrody_` (without doubling an existing `aphrody_`), other names gain it.
pub(crate) fn public_name(internal: &str) -> String {
    let rest = internal.strip_prefix("bxc_").unwrap_or(internal);
    if rest.starts_with("aphrody_") { rest.to_owned() } else { format!("aphrody_{rest}") }
}

/// Rewrites the internal code name out of a tool description.
pub(crate) fn public_text(text: &str) -> String {
    static CODE_NAME: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"(?i)\bbxc\b").expect("static regex"));
    static TOOL_REF: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"(?i)\bbxc_(?:aphrody_)?(\w+)").expect("static regex"));
    let tools = TOOL_REF.replace_all(text, "aphrody_$1");
    CODE_NAME.replace_all(&tools, "Aphrody").into_owned()
}

/// The backend name behind a public tool name, when the catalog knows it.
pub(crate) fn internal_name(public: &str) -> Option<String> {
    NAMES.read().ok()?.get(public).cloned()
}

/// Scrubs the code name out of an input schema: every `description` is
/// rewritten, and a `default` that carries the code name is dropped (the backend
/// applies its own default; rewriting the value would change what it does).
fn public_schema(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            if map
                .get("default")
                .is_some_and(|d| d.to_string().to_ascii_lowercase().contains("bxc"))
            {
                map.remove("default");
            }
            for (key, child) in map.iter_mut() {
                if key == "description" || key == "title" {
                    if let serde_json::Value::String(text) = child {
                        *text = public_text(text);
                    }
                } else {
                    public_schema(child);
                }
            }
        },
        serde_json::Value::Array(items) => items.iter_mut().for_each(public_schema),
        _ => {},
    }
}

/// Converts a backend tool descriptor to a public MCP [`Tool`].
fn to_tool(tool: &aphrody_gemini_runtime::McpTool) -> Option<Tool> {
    let mut schema = if tool.input_schema.is_object() {
        tool.input_schema.clone()
    } else {
        serde_json::json!({ "type": "object", "properties": {} })
    };
    public_schema(&mut schema);
    serde_json::from_value::<Tool>(serde_json::json!({
        "name": public_name(&tool.name),
        "description": public_text(&tool.description),
        "inputSchema": schema,
    }))
    .ok()
}

/// The live BXC catalog as MCP tools, fetched once and cached on success.
pub(crate) async fn catalog() -> Result<Vec<Tool>, String> {
    let mut cached = CATALOG.lock().await;
    if let Some(tools) = cached.as_ref() {
        return Ok(tools.clone());
    }
    let fetch = async {
        let mut client = checkout().await?;
        match client.list_tools().await {
            Ok(tools) => {
                checkin(client).await;
                Ok(tools)
            },
            Err(error) => {
                client.shutdown().await;
                Err(error.to_string())
            },
        }
    };
    let raw = tokio::time::timeout(CATALOG_TIMEOUT, fetch)
        .await
        .map_err(|_| format!("bxc tools/list timed out after {}s", CATALOG_TIMEOUT.as_secs()))??;
    let tools: Vec<Tool> = raw.iter().filter_map(to_tool).collect();
    if let Ok(mut names) = NAMES.write() {
        *names = raw.iter().map(|tool| (public_name(&tool.name), tool.name.clone())).collect();
    }
    if let Ok(mut mirror) = CATALOG_SYNC.write() {
        mirror.clone_from(&tools);
    }
    *cached = Some(tools.clone());
    Ok(tools)
}

/// Every BXC tool, minus names in `taken`. Empty when BXC is disabled or absent.
pub(crate) async fn list(taken: impl Fn(&str) -> bool) -> Vec<Tool> {
    if !enabled() {
        return Vec::new();
    }
    match catalog().await {
        Ok(tools) => tools.into_iter().filter(|tool| !taken(tool.name.as_ref())).collect(),
        Err(error) => {
            tracing::warn!(%error, "BXC catalog unavailable; tools/list carries the aphrody tools only");
            Vec::new()
        },
    }
}

/// The cached MCP [`Tool`] for `name`, when it is a BXC tool.
pub(crate) fn get(name: &str) -> Option<Tool> {
    CATALOG_SYNC.read().ok()?.iter().find(|tool| tool.name == name).cloned()
}

/// Whether `name` belongs to the BXC catalog (fetching it on first use).
pub(crate) async fn owns(name: &str) -> bool {
    enabled() && catalog().await.is_ok_and(|tools| tools.iter().any(|tool| tool.name == name))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DirectTool {
    PublicWeb,
    Crawl,
    X,
    #[cfg(not(target_arch = "wasm32"))]
    Search,
    #[cfg(not(target_arch = "wasm32"))]
    Gemini,
    #[cfg(all(feature = "native-browser", not(target_arch = "wasm32")))]
    Browser,
}

fn direct_tool(name: &str) -> Option<(String, DirectTool)> {
    let public = public_name(name);
    let owner = if public_web_tools::owns(&public) {
        DirectTool::PublicWeb
    } else if native_crawl_tools::owns(&public) {
        DirectTool::Crawl
    } else if x_tools::owns(&public) {
        DirectTool::X
    } else {
        #[cfg(not(target_arch = "wasm32"))]
        if search_tools::owns(&public) {
            return Some((public, DirectTool::Search));
        }
        #[cfg(not(target_arch = "wasm32"))]
        if gemini_tools::owns(&public) {
            return Some((public, DirectTool::Gemini));
        }
        #[cfg(all(feature = "native-browser", not(target_arch = "wasm32")))]
        if browser_tools::owns(&public) {
            return Some((public, DirectTool::Browser));
        }
        return None;
    };
    Some((public, owner))
}

async fn call_direct_raw(name: &str, arguments: Value) -> Option<Result<Value, String>> {
    let (public, owner) = direct_tool(name)?;
    let request = serde_json::from_value::<CallToolRequestParams>(serde_json::json!({
        "name": public,
        "arguments": arguments,
    }));
    let request = match request {
        Ok(request) => request,
        Err(error) => return Some(Err(format!("{public}: invalid tool arguments: {error}"))),
    };
    let result = match owner {
        DirectTool::PublicWeb => public_web_tools::call(&request).await,
        DirectTool::Crawl => native_crawl_tools::call(&request).await,
        DirectTool::X => x_tools::call(&request).await,
        #[cfg(not(target_arch = "wasm32"))]
        DirectTool::Search => search_tools::call(&request).await,
        #[cfg(not(target_arch = "wasm32"))]
        DirectTool::Gemini => gemini_tools::call(&request).await,
        #[cfg(all(feature = "native-browser", not(target_arch = "wasm32")))]
        DirectTool::Browser => browser_tools::call(&request).await,
    };
    Some(serde_json::to_value(result).map_err(|error| error.to_string()))
}

/// Calls a BXC tool and returns the raw JSON-RPC `result`.
pub(crate) async fn call_raw(
    name: &str,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if let Some(result) = call_direct_raw(name, arguments.clone()).await {
        return result;
    }
    let mut client = checkout().await?;
    match client.call_tool(name, arguments).await {
        Ok(result) => {
            checkin(client).await;
            Ok(result)
        },
        Err(error) => {
            // The child may be wedged mid-frame; never hand it to another call.
            client.shutdown().await;
            Err(error.to_string())
        },
    }
}

/// Runs a BXC tool and returns its `CallToolResult` verbatim.
pub(crate) async fn call(request: &CallToolRequestParams) -> CallToolResult {
    let name = request.name.as_ref();
    let arguments = request
        .arguments
        .as_ref()
        .map_or_else(|| serde_json::json!({}), |map| serde_json::Value::Object(map.clone()));
    let backend = internal_name(name).unwrap_or_else(|| name.to_owned());
    match call_raw(&backend, arguments).await {
        // Error messages name the backend tool; data results are returned untouched.
        Ok(mut raw) if raw.get("isError").and_then(serde_json::Value::as_bool) == Some(true) => {
            if let Some(parts) = raw.get_mut("content").and_then(serde_json::Value::as_array_mut) {
                for part in parts {
                    if let Some(serde_json::Value::String(text)) = part.get_mut("text") {
                        *text = public_text(text);
                    }
                }
            }
            serde_json::from_value::<CallToolResult>(raw).unwrap_or_else(|error| {
                CallToolResult::error(vec![ContentBlock::text(format!("{name}: {error}"))])
            })
        },
        Ok(raw) => serde_json::from_value::<CallToolResult>(raw.clone()).unwrap_or_else(|error| {
            CallToolResult::error(vec![ContentBlock::text(format!(
                "{name}: undecodable web backend result ({error}): {raw}"
            ))])
        }),
        Err(error) => CallToolResult::error(vec![ContentBlock::text(format!(
            "{name}: the Aphrody web backend is unavailable or failed ({error}); install it with \
             `aphrody package`."
        ))]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_owners_cover_source_and_public_names() {
        for (source, owner) in [
            ("bxc_google_supported_languages", DirectTool::PublicWeb),
            ("bxc_detect_frameworks", DirectTool::PublicWeb),
            ("aphrody_web_crawl", DirectTool::Crawl),
            ("aphrody_google_dns", DirectTool::PublicWeb),
            ("bxc_x_algorithm_rank", DirectTool::X),
            ("aphrody_x_client", DirectTool::X),
        ] {
            assert_eq!(direct_tool(source).map(|(_, route)| route), Some(owner), "{source}");
        }
        #[cfg(not(target_arch = "wasm32"))]
        for (source, owner) in
            [("bxc_search", DirectTool::Search), ("bxc_gemini_rust", DirectTool::Gemini)]
        {
            assert_eq!(direct_tool(source).map(|(_, route)| route), Some(owner), "{source}");
        }
        #[cfg(all(feature = "native-browser", not(target_arch = "wasm32")))]
        assert_eq!(
            direct_tool("bxc_browser_click").map(|(_, route)| route),
            Some(DirectTool::Browser)
        );
        assert!(direct_tool("bxc_unported_tool").is_none());
    }

    #[tokio::test]
    async fn raw_gateway_calls_native_tools_without_child_process() {
        let languages = call_raw("bxc_google_supported_languages", serde_json::json!({}))
            .await
            .expect("native languages");
        assert_ne!(languages["isError"], true, "{languages}");
        assert!(languages.to_string().contains("languages"), "{languages}");

        let rank = call_raw("bxc_x_algorithm_rank", serde_json::json!({ "candidates": [] }))
            .await
            .expect("native local ranking");
        assert_ne!(rank["isError"], true, "{rank}");

        let detect =
            call_raw("bxc_detect_frameworks", serde_json::json!({ "url": "file:///tmp/a" }))
                .await
                .expect("native detection dispatch");
        assert_eq!(detect["isError"], true, "{detect}");

        let crawl = call_raw("aphrody_web_crawl", serde_json::json!({ "urls": ["file:///tmp/a"] }))
            .await
            .expect("native crawl dispatch");
        assert_eq!(crawl["isError"], true, "{crawl}");

        #[cfg(not(target_arch = "wasm32"))]
        {
            let search =
                call_raw("bxc_search", serde_json::json!({})).await.expect("native search");
            assert_eq!(search["isError"], true, "{search}");
            assert!(search.to_string().contains("query must be a string"), "{search}");
        }
    }

    #[test]
    fn descriptor_converts_to_mcp_tool() {
        let tool = aphrody_gemini_runtime::McpTool {
            name: "bxc_search".to_owned(),
            description: "search".to_owned(),
            input_schema: serde_json::json!({ "type": "object", "properties": { "q": { "type": "string" } } }),
        };
        let converted = to_tool(&tool).expect("converts");
        assert_eq!(converted.name, "aphrody_search");
        assert!(converted.input_schema.contains_key("properties"));
    }

    #[test]
    fn public_names_and_text_hide_the_code_name() {
        assert_eq!(public_name("bxc_google_translate"), "aphrody_google_translate");
        assert_eq!(public_name("bxc_aphrody_status"), "aphrody_status");
        assert_eq!(public_name("browser_click"), "aphrody_browser_click");
        assert_eq!(public_name("tune_memory_sqlite"), "aphrody_tune_memory_sqlite");
        assert_eq!(
            public_text("Use BXC first; run bxc doctor."),
            "Use Aphrody first; run Aphrody doctor."
        );
        assert_eq!(public_text("bxcfoo stays"), "bxcfoo stays");
        assert_eq!(
            public_text("then call bxc_scrape or bxc_aphrody_status"),
            "then call aphrody_scrape or aphrody_status"
        );
    }

    #[test]
    fn schemas_lose_the_code_name() {
        let mut schema = serde_json::json!({
            "type": "object",
            "properties": {
                "corpus": { "type": "string", "default": "bxc_crawl", "description": "Written by bxc." },
                "keep": { "type": "string", "default": "web" }
            }
        });
        public_schema(&mut schema);
        assert!(!schema.to_string().to_ascii_lowercase().contains("bxc"), "{schema}");
        assert_eq!(schema["properties"]["keep"]["default"], "web");
        assert_eq!(schema["properties"]["corpus"]["description"], "Written by Aphrody.");
    }

    #[test]
    fn missing_schema_becomes_empty_object() {
        let tool = aphrody_gemini_runtime::McpTool {
            name: "bxc_capabilities".to_owned(),
            description: String::new(),
            input_schema: serde_json::Value::Null,
        };
        let converted = to_tool(&tool).expect("converts");
        assert_eq!(converted.input_schema.get("type"), Some(&serde_json::json!("object")));
    }

    /// Live round trip against the installed BXC; skipped when BXC is absent.
    #[tokio::test]
    async fn live_catalog_and_call_round_trip() {
        if aphrody_web_bridge::resolve::binary().is_err() {
            return;
        }
        let tools = catalog().await.expect("bxc catalog");
        assert!(tools.len() > 20, "expected the full BXC catalog, got {}", tools.len());
        assert!(tools.iter().all(|t| !t.name.contains("bxc")), "code name leaked into a tool name");
        // Google and X are owned by the OS backend; removing the native IA
        // route must leave their public MCP names and key input fields intact.
        for (name, field) in [
            ("aphrody_search", "query"),
            ("aphrody_google_fetch", "url"),
            ("aphrody_google_dns", "name"),
            ("aphrody_google_translate", "text"),
            ("aphrody_google_detect_language", "text"),
            ("aphrody_google_supported_languages", "target"),
            ("aphrody_google_tts", "text"),
            ("aphrody_google_suggest", "query"),
            ("aphrody_google_books", "query"),
            ("aphrody_google_calendar_public", "calendarId"),
            ("aphrody_google_sheet_export", "spreadsheetId"),
            ("aphrody_google_doc_export", "documentId"),
            ("aphrody_gemini_rust", "prompt"),
            ("aphrody_gemini_ask", "prompt"),
            ("aphrody_x_client", "action"),
            ("aphrody_x_algorithm_rank", "candidates"),
            ("aphrody_xpro_deck", "action"),
        ] {
            let tool = tools
                .iter()
                .find(|tool| tool.name == name)
                .unwrap_or_else(|| panic!("missing {name}"));
            let properties = tool.input_schema.get("properties").expect("tool properties");
            assert!(properties.get(field).is_some(), "{name} missing {field}");
            assert!(
                crate::GoogleMcpServer::all_tools().get(name).is_none(),
                "{name} still has an IA Web route"
            );
        }
        assert!(owns("aphrody_capabilities").await);
        assert!(get("aphrody_capabilities").is_some());
        assert_eq!(internal_name("aphrody_capabilities").as_deref(), Some("bxc_capabilities"));
        let request: CallToolRequestParams = serde_json::from_value(
            serde_json::json!({ "name": "aphrody_capabilities", "arguments": {} }),
        )
        .unwrap();
        let result = call(&request).await;
        assert_ne!(result.is_error, Some(true), "{result:?}");
        let languages: CallToolRequestParams = serde_json::from_value(
            serde_json::json!({ "name": "aphrody_google_supported_languages", "arguments": {} }),
        )
        .unwrap();
        let result = call(&languages).await;
        assert_ne!(result.is_error, Some(true), "{result:?}");
        assert!(format!("{result:?}").contains("languages"), "{result:?}");
    }
}
