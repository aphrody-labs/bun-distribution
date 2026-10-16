// SPDX-License-Identifier: Apache-2.0
//! The MCP protocol surface of `aphrody-mcp` beyond plain tools.
//!
//! One server answers for Aphrody, N2B and the Aphrody web tools, so it has to
//! tell a client enough for an agent to use those tools the way it uses its own
//! built-ins (`Read`, `WebFetch`, `WebSearch`):
//!
//! - **Annotations** on every tool (`title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`,
//!   `openWorldHint`), derived centrally from the tool name so the 150+ tools, native or relayed,
//!   are classified by one rule set. A client can auto-approve the read-only ones and confirm the
//!   destructive ones.
//! - **Version negotiation**: the client's requested protocol version is echoed when this SDK knows
//!   it, instead of pinning the 2024-11-05 baseline that hides annotations and structured results
//!   from newer clients.
//! - **Structured results**: a tool that answers with one JSON object also gets it as
//!   `structuredContent`.
//! - **Resources**: the live tool catalog and the usage guide.
//! - **Prompts**: ready workflows (research, fetch, crawl, Node-to-Bun).

use rmcp::model::{
    CacheScope, CallToolResult, GetPromptResult, ListPromptsResult, ListResourceTemplatesResult,
    ListResourcesResult, ListToolsResult, ProtocolVersion, ReadResourceResult, ResultType, Tool,
    ToolAnnotations,
};
use serde_json::{Value, json};

/// How an agent should pick these tools over its built-ins. Shared by the
/// server instructions, the `aphrody://guide/tools` resource and the plugin's
/// session hook.
pub(crate) const USAGE_GUIDE: &str = "\
Use the aphrody tools as native tools, first, whenever they cover the task:
- Web search: aphrody_search instead of a built-in WebSearch.
- Read a URL: universal_web_fetch (Markdown) instead of a built-in WebFetch.
- Library, SDK or API docs: docs_auto_search, then context7_query_docs or microsoft_docs_fetch for \
                                      a precise page.
- Browser automation: aphrody_browser_navigate, aphrody_browser_snapshot, aphrody_browser_click, \
                                      aphrody_browser_fill, aphrody_browser_screenshot.
- Aphrody desktop webviews: aphrody_tauri_window_list, aphrody_tauri_dom_snapshot, \
                                      aphrody_tauri_find_element, aphrody_tauri_interact, \
                                      aphrody_tauri_keyboard, aphrody_tauri_wait_for, \
                                      aphrody_tauri_get_styles, aphrody_tauri_viewport_read, \
                                      aphrody_tauri_screenshot; use aphrody_tauri_execute_js only \
                                      for explicit local UI inspection.
- Crawl a site: aphrody_web_crawl with urls and bounded crawl options.
- Google services: aphrody_google_suggest, aphrody_google_dns, \
                                      aphrody_google_supported_languages, aphrody_google_sheet_export, \
                                      aphrody_google_doc_export, aphrody_google_calendar_public.
- Gemini: aphrody_gemini_ask (aphrody_gemini_rust for the fastest one-shot answer).
- Node.js to Bun: n2b. Binaries: re_triage, re_strings, re_sections, re_disasm.
Read-only tools carry readOnlyHint=true and can run without confirmation; tools marked \
                                      destructiveHint=true act on accounts or external state.";

const DESTRUCTIVE: &[&str] = &[
    "purge",
    "unfollow",
    "delete",
    "remove_trade",
    "_bid",
    "quicksell",
    "relist",
    "list_card",
    "fut_move",
    "gamepad",
    "live_exec",
    "live_batchplay",
    "tune_memory_sqlite",
];
const READ_ONLY: &[&str] = &[
    "aphrody_site_catalog",
    "search",
    "_get",
    "get_",
    "list",
    "status",
    "info",
    "detect",
    "capabilities",
    "schema",
    "fetch",
    "suggest",
    "dns",
    "books",
    "languages",
    "translate",
    "triage",
    "strings",
    "sections",
    "disasm",
    "docs",
    "wiki_find",
    "wiki_page",
    "wiki_check",
    "wiki_markdown",
    "archive_item",
    "wayback",
    "stats",
    "rankings",
    "price",
    "market",
    "player",
    "evaluate",
    "formations",
    "squads",
    "recon",
    "snapshot",
    "screenshot",
    "whoami",
    "models",
    "profile",
    "resolve",
    "export",
    "calendar",
    "coding_style_guide",
    "manifest",
    "service_status",
    "codec",
    "calc",
    "sim",
    "optimize",
    "solve",
    "scout",
    "consumables",
    "credits",
    "club",
    "unassigned",
    "tradepile",
    "watchlist",
    "stadium",
    "massinfo",
    "pricelimits",
    "filters",
    "rank",
    "screen_capture",
    "universal_web_fetch",
    "jev_decide",
    "advanced_recon",
    "rendition",
];
const LOCAL_ONLY: &[&str] = &[
    "aphrody_site_catalog",
    "re_",
    "sync_external_agents",
    "screen_capture",
    "native_hooks",
    "n2b",
    "coding_style_guide",
    "tune_memory_sqlite",
    "start_dashboard",
    "aphrody_schema",
    "supported_languages",
    "fc_iq_codec",
    "calc",
    "sim",
    "ilp_solve",
    "setup_optimize",
];

fn matches_any(name: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| name.contains(needle))
}

/// A readable title from a snake-case tool name: `aphrody_google_translate` ->
/// `Google Translate`.
fn title_of(name: &str) -> String {
    let trimmed = name.strip_prefix("aphrody_").unwrap_or(name);
    trimmed
        .split('_')
        .filter(|word| !word.is_empty())
        .map(|word| match word {
            "dns" | "tts" | "sbc" | "ilp" | "fut" | "igs" | "cdp" | "rag" | "re" | "mcp"
            | "a2a" | "n2b" | "url" | "x" | "iq" | "fc" => word.to_ascii_uppercase(),
            _ => {
                let mut chars = word.chars();
                chars.next().map_or_else(String::new, |first| {
                    first.to_uppercase().collect::<String>() + chars.as_str()
                })
            },
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// The behaviour hints for a tool name.
pub(crate) fn annotations_for(name: &str) -> ToolAnnotations {
    let destructive = matches_any(name, DESTRUCTIVE);
    let read_only = !destructive && matches_any(name, READ_ONLY);
    let open_world = !matches_any(name, LOCAL_ONLY);
    ToolAnnotations::with_title(title_of(name))
        .read_only(read_only)
        .destructive(destructive)
        .idempotent(read_only)
        .open_world(open_world)
}

/// Adds a title and behaviour hints to a tool that does not declare its own.
pub(crate) fn annotate(tool: &mut Tool) {
    let name = tool.name.to_string();
    if tool.annotations.is_none() {
        tool.annotations = Some(annotations_for(&name));
    }
    if tool.title.is_none() {
        tool.title = Some(title_of(&name));
    }
}

/// The protocol version to answer with: the client's own when this SDK knows
/// it, the latest otherwise (the client then decides whether to continue).
pub(crate) fn negotiate(requested: &ProtocolVersion) -> ProtocolVersion {
    if ProtocolVersion::KNOWN_VERSIONS.contains(requested) {
        requested.clone()
    } else {
        ProtocolVersion::LATEST
    }
}

pub(crate) trait CacheableResult {
    fn add_cache_defaults(&mut self);
}

macro_rules! impl_cacheable_result {
    ($($result:ty),+ $(,)?) => {
        $(
            impl CacheableResult for $result {
                fn add_cache_defaults(&mut self) {
                    if self.result_type.as_ref().is_none_or(ResultType::is_complete) {
                        self.result_type.get_or_insert(ResultType::COMPLETE);
                        self.ttl_ms.get_or_insert(0);
                        self.cache_scope.get_or_insert(CacheScope::Private);
                    }
                }
            }
        )+
    };
}

impl_cacheable_result!(
    ListToolsResult,
    ListPromptsResult,
    ListResourcesResult,
    ListResourceTemplatesResult,
    ReadResourceResult,
);

/// MCP 2026-07-28 requires caching hints on complete list/read results.
/// SDK constructors leave them absent for compatibility with older peers.
/// Keep declared hints; default fresh responses to private and immediately stale.
/// See https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching.
pub(crate) fn cacheable_result<T: CacheableResult>(
    mut result: T,
    protocol_version: Option<ProtocolVersion>,
) -> T {
    if protocol_version
        .is_some_and(|version| version.as_str() >= ProtocolVersion::V_2026_07_28.as_str())
    {
        result.add_cache_defaults();
    }
    result
}

/// Qualifies completed owner results for modern MCP; the transport preserves legacy compatibility.
pub(crate) fn normalize_tool_response(response: &mut rmcp::model::CallToolResponse) {
    if let rmcp::model::CallToolResponse::Complete(result) = response {
        // Relayed and JSON-deserialized owners may return the legacy shape.
        // The SDK strips this discriminator for legacy peers after dispatch.
        result.result_type.get_or_insert(ResultType::COMPLETE);
        add_structured_content(result);
    }
}

/// Mirrors a single JSON-object text answer into `structuredContent`.
pub(crate) fn add_structured_content(result: &mut CallToolResult) {
    if result.structured_content.is_some() || result.content.len() != 1 {
        return;
    }
    let Some(text) = result.content[0].as_text().map(|text| text.text.clone()) else {
        return;
    };
    let trimmed = text.trim_start();
    if !trimmed.starts_with('{') {
        return;
    }
    if let Ok(value @ Value::Object(_)) = serde_json::from_str::<Value>(trimmed) {
        result.structured_content = Some(value);
    }
}

pub(crate) const CATALOG_URI: &str = "aphrody://tools/catalog";
pub(crate) const GUIDE_URI: &str = "aphrody://guide/tools";

pub(crate) fn list_resources() -> ListResourcesResult {
    serde_json::from_value(json!({
        "resources": [
            {
                "uri": GUIDE_URI,
                "name": "tool-guide",
                "title": "How to use the Aphrody tools",
                "description": "Which aphrody tool replaces which built-in (search, fetch, docs, browser, crawl, Google, Gemini).",
                "mimeType": "text/markdown"
            },
            {
                "uri": CATALOG_URI,
                "name": "tool-catalog",
                "title": "Aphrody tool catalog",
                "description": "Every tool this server exposes, with its title and behaviour hints.",
                "mimeType": "application/json"
            }
        ]
    }))
    .unwrap_or_default()
}

/// Reads a resource; `tools` is the live `tools/list` used for the catalog.
pub(crate) fn read_resource(uri: &str, tools: &[Tool]) -> Option<ReadResourceResult> {
    let (mime, text) = match uri {
        GUIDE_URI => ("text/markdown", format!("# Aphrody tools\n\n{USAGE_GUIDE}\n")),
        CATALOG_URI => {
            let catalog: Vec<Value> = tools
                .iter()
                .map(|tool| {
                    json!({
                        "name": tool.name,
                        "title": tool.title,
                        "description": tool.description,
                        "annotations": tool.annotations,
                    })
                })
                .collect();
            ("application/json", serde_json::to_string_pretty(&catalog).ok()?)
        },
        _ => return None,
    };
    serde_json::from_value(json!({ "contents": [{ "uri": uri, "mimeType": mime, "text": text }] }))
        .ok()
}

struct PromptSpec {
    name: &'static str,
    title: &'static str,
    description: &'static str,
    argument: (&'static str, &'static str),
    template: &'static str,
}

const PROMPTS: &[PromptSpec] = &[
    PromptSpec {
        name: "research",
        title: "Research a topic on the web",
        description: "Search Google, read the best sources, answer with citations.",
        argument: ("topic", "What to research."),
        template: "Research: {}\n\nCall aphrody_search, read the three most \
                   relevant results with universal_web_fetch, then answer with a short synthesis \
                   and cite every claim with its URL.",
    },
    PromptSpec {
        name: "read-page",
        title: "Read a web page",
        description: "Fetch a URL as Markdown.",
        argument: ("url", "The page to read."),
        template: "Read {} with universal_web_fetch and summarise it.",
    },
    PromptSpec {
        name: "crawl-site",
        title: "Crawl a site",
        description: "Crawl a site recursively and report what it contains.",
        argument: ("url", "The site root."),
        template: "Crawl {} with aphrody_web_crawl (urls contains the site root), then report the page count, \
                   the main sections and any structured data found.",
    },
    PromptSpec {
        name: "migrate-to-bun",
        title: "Migrate a Node.js project to Bun",
        description: "Scan a project with n2b, then apply the safe fixes.",
        argument: ("path", "Project root."),
        template: "Run n2b on {} with mode=scan, explain the findings, then run it with mode=fix \
                   and report what changed.",
    },
];

pub(crate) fn list_prompts() -> ListPromptsResult {
    let prompts: Vec<Value> = PROMPTS
        .iter()
        .map(|p| {
            json!({
                "name": p.name,
                "title": p.title,
                "description": p.description,
                "arguments": [{ "name": p.argument.0, "description": p.argument.1, "required": true }],
            })
        })
        .collect();
    serde_json::from_value(json!({ "prompts": prompts })).unwrap_or_default()
}

pub(crate) fn get_prompt(
    name: &str,
    arguments: Option<&serde_json::Map<String, Value>>,
) -> Option<GetPromptResult> {
    let spec = PROMPTS.iter().find(|p| p.name == name)?;
    let value = arguments
        .and_then(|args| args.get(spec.argument.0))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let text = spec.template.replacen("{}", value, 1);
    serde_json::from_value(json!({
        "description": spec.description,
        "messages": [{ "role": "user", "content": { "type": "text", "text": text } }],
    }))
    .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_owner_tool_result_has_modern_discriminator_and_legacy_wire_shape() {
        let result: CallToolResult = serde_json::from_value(json!({
            "content": [{"type": "text", "text": "{\"ok\":true}"}],
            "isError": false
        }))
        .expect("legacy owner response");
        assert!(result.result_type.is_none());
        let mut response = result.into();
        normalize_tool_response(&mut response);
        let mut wire: rmcp::model::ServerResult = response.into();
        let modern = serde_json::to_value(&wire).expect("modern wire");
        assert_eq!(modern["resultType"], "complete");
        assert_eq!(modern["structuredContent"]["ok"], true);
        wire.strip_result_type_for_legacy_peer();
        let legacy = serde_json::to_value(wire).expect("legacy wire");
        assert!(legacy.get("resultType").is_none());
        assert_eq!(legacy["content"], modern["content"]);
    }

    #[test]
    fn owner_error_remains_an_error_after_tool_response_normalization() {
        let result: CallToolResult = serde_json::from_value(json!({
            "content": [{"type": "text", "text": "owner unavailable"}],
            "isError": true
        }))
        .expect("legacy owner error");
        let mut response = result.into();
        normalize_tool_response(&mut response);
        let wire = serde_json::to_value(rmcp::model::ServerResult::from(response)).expect("wire");
        assert_eq!(wire["resultType"], "complete");
        assert_eq!(wire["isError"], true);
        assert_eq!(wire["content"][0]["text"], "owner unavailable");
    }

    #[test]
    fn hints_follow_the_tool_name() {
        let site = annotations_for("aphrody_site_catalog");
        assert_eq!(site.read_only_hint, Some(true));
        assert_eq!(site.destructive_hint, Some(false));
        assert_eq!(site.idempotent_hint, Some(true));
        assert_eq!(site.open_world_hint, Some(false));
        let search = annotations_for("aphrody_search");
        assert_eq!(search.read_only_hint, Some(true));
        assert_eq!(search.destructive_hint, Some(false));
        assert_eq!(search.open_world_hint, Some(true));
        let purge = annotations_for("aphrody_x_purge_tweets");
        assert_eq!(purge.destructive_hint, Some(true));
        assert_eq!(purge.read_only_hint, Some(false));
        let triage = annotations_for("re_triage");
        assert_eq!(triage.read_only_hint, Some(true));
        assert_eq!(triage.open_world_hint, Some(false));
        let crawl = annotations_for("aphrody_crawl_recursive");
        assert_eq!(crawl.read_only_hint, Some(false));
        assert_eq!(crawl.destructive_hint, Some(false));
    }

    #[test]
    fn titles_are_readable() {
        assert_eq!(title_of("aphrody_google_translate"), "Google Translate");
        assert_eq!(title_of("aphrody_google_dns"), "Google DNS");
        assert_eq!(title_of("n2b"), "N2B");
    }

    #[test]
    fn version_negotiation_echoes_known_versions() {
        assert_eq!(negotiate(&ProtocolVersion::V_2025_06_18), ProtocolVersion::V_2025_06_18);
        assert_eq!(negotiate(&ProtocolVersion::V_2024_11_05), ProtocolVersion::V_2024_11_05);
    }

    #[test]
    fn modern_tools_list_has_required_private_cache_hints() {
        let result = cacheable_result(
            ListToolsResult::with_all_items(Vec::new()),
            Some(ProtocolVersion::V_2026_07_28),
        );
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            json!({ "resultType": "complete", "tools": [], "ttlMs": 0, "cacheScope": "private" }),
        );
    }

    #[test]
    fn legacy_tools_list_keeps_its_wire_shape() {
        let original = ListToolsResult::with_all_items(Vec::new());
        for version in
            [None, Some(ProtocolVersion::V_2024_11_05), Some(ProtocolVersion::V_2025_11_25)]
        {
            let result = cacheable_result(original.clone(), version);
            assert_eq!(result, original);
            let mut response = rmcp::model::ServerResult::ListToolsResult(result);
            response.strip_result_type_for_legacy_peer();
            assert_eq!(serde_json::to_value(response).unwrap(), json!({ "tools": [] }));
        }
    }

    #[test]
    fn modern_caching_preserves_declared_hints() {
        let original = ListToolsResult::with_all_items(Vec::new())
            .with_ttl_ms(60_000)
            .with_cache_scope(CacheScope::Public);
        let result = cacheable_result(original.clone(), Some(ProtocolVersion::V_2026_07_28));
        assert_eq!(result, original);
    }

    #[test]
    fn interim_results_do_not_receive_cache_hints() {
        let mut original = ListToolsResult::with_all_items(Vec::new());
        original.result_type = Some(ResultType::INPUT_REQUIRED);
        let result = cacheable_result(original.clone(), Some(ProtocolVersion::V_2026_07_28));
        assert_eq!(result, original);
    }

    #[test]
    fn modern_resource_and_prompt_results_have_required_cache_hints() {
        let version = Some(ProtocolVersion::V_2026_07_28);
        let results = [
            serde_json::to_value(cacheable_result(list_resources(), version.clone())).unwrap(),
            serde_json::to_value(cacheable_result(list_prompts(), version.clone())).unwrap(),
            serde_json::to_value(cacheable_result(
                ListResourceTemplatesResult::default(),
                version.clone(),
            ))
            .unwrap(),
            serde_json::to_value(cacheable_result(read_resource(GUIDE_URI, &[]).unwrap(), version))
                .unwrap(),
        ];
        for result in results {
            assert_eq!(result["resultType"], "complete");
            assert_eq!(result["ttlMs"], 0);
            assert_eq!(result["cacheScope"], "private");
        }
    }

    #[test]
    fn json_answers_become_structured_content() {
        let mut result =
            CallToolResult::success(vec![rmcp::model::ContentBlock::text("{\"a\":1}")]);
        add_structured_content(&mut result);
        assert_eq!(result.structured_content, Some(json!({ "a": 1 })));
        let mut plain = CallToolResult::success(vec![rmcp::model::ContentBlock::text("csv,a,b")]);
        add_structured_content(&mut plain);
        assert!(plain.structured_content.is_none());
    }

    #[test]
    fn resources_and_prompts_resolve() {
        assert_eq!(list_resources().resources.len(), 2);
        assert!(read_resource(GUIDE_URI, &[]).is_some());
        assert!(read_resource("aphrody://nope", &[]).is_none());
        assert_eq!(list_prompts().prompts.len(), PROMPTS.len());
        let mut args = serde_json::Map::new();
        args.insert("topic".into(), json!("tokio"));
        let prompt = get_prompt("research", Some(&args)).expect("prompt");
        assert!(serde_json::to_string(&prompt).unwrap().contains("Research: tokio"));
    }
}
