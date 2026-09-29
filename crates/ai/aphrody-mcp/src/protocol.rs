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
    CallToolResult, GetPromptResult, ListPromptsResult, ListResourcesResult, ProtocolVersion,
    ReadResourceResult, Tool, ToolAnnotations,
};
use serde_json::{Value, json};

/// How an agent should pick these tools over its built-ins. Shared by the
/// server instructions, the `aphrody://guide/tools` resource and the plugin's
/// session hook.
pub(crate) const USAGE_GUIDE: &str = "\
Use the aphrody tools as native tools, first, whenever they cover the task:
- Web search: aphrody_search (Google, authenticated, rich=true for featured snippet, knowledge \
                                      panel, People-Also-Ask) instead of a built-in WebSearch.
- Read a URL: universal_web_fetch (Markdown) or aphrody_google_fetch (Markdown plus JSON-LD / \
                                      OpenGraph / canonical) instead of a built-in WebFetch; \
                                      profile=stealth or max for pages that need a real browser.
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
- Crawl or mirror a site: aphrody_crawl_recursive, aphrody_crawl_massive, aphrody_mirror.
- Google services: aphrody_google_translate, aphrody_google_detect_language, aphrody_google_tts, \
                                      aphrody_google_suggest, aphrody_google_books, \
                                      aphrody_google_dns, aphrody_google_sheet_export, \
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
        template: "Research: {}\n\nCall aphrody_search with rich=true, read the three most \
                   relevant results with aphrody_google_fetch, then answer with a short synthesis \
                   and cite every claim with its URL.",
    },
    PromptSpec {
        name: "read-page",
        title: "Read a web page",
        description: "Fetch a URL as Markdown with its structured metadata.",
        argument: ("url", "The page to read."),
        template: "Read {} with aphrody_google_fetch (profile=http; retry with profile=stealth if \
                   the page is empty or blocked) and summarise it.",
    },
    PromptSpec {
        name: "crawl-site",
        title: "Crawl a site",
        description: "Crawl a site recursively and report what it contains.",
        argument: ("url", "The site root."),
        template: "Crawl {} with aphrody_crawl_recursive, then report the page count, the main \
                   sections and any structured data found.",
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
    fn hints_follow_the_tool_name() {
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
