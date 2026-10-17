// SPDX-License-Identifier: Apache-2.0
//! Historical Web tool aliases backed by the existing native Rust owners.
//! Catalog discovery and calls never spawn the retired BXC executable.

#[cfg(all(feature = "native-browser", not(target_arch = "wasm32")))]
use crate::browser_tools;
#[cfg(not(target_arch = "wasm32"))]
use crate::{gemini_tools, search_tools};
use crate::{native_crawl_tools, public_web_tools, x_tools};
use rmcp::model::{CallToolRequestParams, CallToolResult, ContentBlock, Tool};
use serde_json::Value;
use std::sync::LazyLock;

pub(crate) fn enabled() -> bool {
    !matches!(std::env::var("APHRODY_MCP_NO_WEB").as_deref(), Ok("1" | "true" | "yes"))
}

static TOOLS: LazyLock<Vec<Tool>> =
    LazyLock::new(|| {
        let mut tools = public_web_tools::list(|_| false);
        tools.extend(native_crawl_tools::list(|_| false));
        tools.extend(x_tools::list(|_| false));
        #[cfg(not(target_arch = "wasm32"))]
        {
            tools.extend(search_tools::list(|_| false));
            tools.extend(gemini_tools::list(|_| false));
        }
        #[cfg(all(feature = "native-browser", not(target_arch = "wasm32")))]
        tools.extend(browser_tools::list(|_| false));
        tools.push(serde_json::from_value(serde_json::json!({
        "name": "aphrody_capabilities",
        "description": "List the native Aphrody Web tools available in this build.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true}
    })).expect("native Web capabilities schema"));
        let mut names = std::collections::HashSet::new();
        tools.retain(|tool| names.insert(tool.name.to_string()));
        tools
            .into_iter()
            .map(|tool| {
                let mut value = serde_json::to_value(tool).expect("native tool serialization");
                public_schema(&mut value);
                serde_json::from_value(value).expect("native tool schema")
            })
            .collect()
    });

pub(crate) fn internal_name(public: &str) -> Option<String> {
    get(public).map(|tool| tool.name.to_string())
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
#[cfg(test)]
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

/// The native catalog requires no separate executable or handshake.
pub(crate) async fn catalog() -> Result<Vec<Tool>, String> {
    Ok(TOOLS.clone())
}

pub(crate) async fn list(taken: impl Fn(&str) -> bool) -> Vec<Tool> {
    if !enabled() {
        return Vec::new();
    }
    TOOLS.iter().filter(|tool| !taken(tool.name.as_ref())).cloned().collect()
}

pub(crate) fn get(name: &str) -> Option<Tool> {
    TOOLS.iter().find(|tool| tool.name == name).cloned()
}

pub(crate) async fn owns(name: &str) -> bool {
    enabled() && get(name).is_some()
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

/// Calls a historical tool alias through its native Rust owner.
pub(crate) async fn call_raw(name: &str, arguments: Value) -> Result<Value, String> {
    if public_name(name) == "aphrody_capabilities" {
        let value = serde_json::json!({"backend": "aphrody-web", "tools": &*TOOLS});
        let mut result = CallToolResult::success(vec![ContentBlock::text(value.to_string())]);
        result.structured_content = Some(value);
        return serde_json::to_value(result).map_err(|error| error.to_string());
    }
    if let Some(result) = call_direct_raw(name, arguments).await {
        return result;
    }
    Err(format!("{} is not available in this native Aphrody Web build", public_name(name)))
}

/// Runs a historical Web alias through its native owner and returns its `CallToolResult` verbatim.
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
            "{name}: the native Aphrody Web tool failed ({error})."
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

    #[tokio::test]
    async fn native_catalog_and_call_round_trip() {
        let tools = catalog().await.expect("native Web catalog");
        assert!(tools.len() >= 18, "{} native tools", tools.len());
        let names: std::collections::HashSet<_> = tools.iter().map(|tool| &tool.name).collect();
        assert_eq!(names.len(), tools.len(), "duplicate public names");
        assert!(tools.iter().all(|tool| !tool.name.contains("bxc")));
        for (name, field) in [
            ("aphrody_google_dns", "name"),
            ("aphrody_google_supported_languages", "target"),
            ("aphrody_google_suggest", "query"),
            ("aphrody_google_calendar_public", "calendarId"),
            ("aphrody_google_sheet_export", "spreadsheetId"),
            ("aphrody_google_doc_export", "documentId"),
            ("aphrody_x_client", "action"),
            ("aphrody_x_algorithm_rank", "candidates"),
        ] {
            let tool = tools.iter().find(|tool| tool.name == name).expect(name);
            let properties = tool.input_schema.get("properties").expect("properties");
            assert!(properties.get(field).is_some(), "{name}: {field}");
        }
        assert!(owns("aphrody_capabilities").await);
        assert!(get("aphrody_capabilities").is_some());
        let capabilities = call_raw("bxc_capabilities", serde_json::json!({})).await.unwrap();
        assert_ne!(capabilities["isError"], true);
        let languages =
            call_raw("bxc_google_supported_languages", serde_json::json!({})).await.unwrap();
        assert_ne!(languages["isError"], true);
        assert!(languages.to_string().contains("languages"));
        let unknown = call_raw("bxc_unported_tool", serde_json::json!({})).await.unwrap_err();
        assert!(unknown.contains("not available in this native Aphrody Web build"));
    }
}
