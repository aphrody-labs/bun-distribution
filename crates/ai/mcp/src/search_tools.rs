// SPDX-License-Identifier: Apache-2.0
//! Google Search MCP route backed by the shared Rust search engine.

use std::sync::LazyLock;

use aphrody_google::search::{RichSearchResult, SearchOptions, search_rich};
use rmcp::model::{CallToolRequestParams, CallToolResult, ContentBlock, Tool};
use serde_json::{Value, json};

static TOOL: LazyLock<Tool> = LazyLock::new(|| {
    serde_json::from_value(json!({
        "name": "aphrody_search",
        "description": "Powerful Google Web Search. Returns ranked organic results (title, URL, snippet) and, with `rich`, the featured snippet / knowledge panel / People-Also-Ask / related searches. Authenticates automatically from ~/.aphrody/cookies/google.json when present. Supports verticals (web/images/news/videos/books).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "The search query." },
                "num": { "type": "integer", "minimum": 1, "maximum": 20, "description": "Number of results to request." },
                "hl": { "type": "string", "description": "UI language, e.g. 'en', 'fr'." },
                "gl": { "type": "string", "description": "Region bias, e.g. 'US', 'FR'." },
                "domain": { "type": "string", "description": "Google domain, e.g. 'google.fr'." },
                "vertical": { "type": "string", "enum": ["web", "images", "news", "videos", "books"], "default": "web", "description": "Search vertical." },
                "rich": { "type": "boolean", "default": false, "description": "Include featured snippet / knowledge panel / PAA / related searches." }
            },
            "required": ["query"],
            "additionalProperties": false
        }
    })).expect("static Google Search tool schema")
});

pub(crate) fn list(taken: impl Fn(&str) -> bool) -> Vec<Tool> {
    if taken(TOOL.name.as_ref()) { Vec::new() } else { vec![TOOL.clone()] }
}

pub(crate) fn get(name: &str) -> Option<Tool> {
    (TOOL.name == name).then(|| TOOL.clone())
}

pub(crate) fn owns(name: &str) -> bool {
    TOOL.name == name
}

fn optional_text(args: &Value, name: &str) -> Result<Option<String>, String> {
    args.get(name)
        .map(|value| {
            value.as_str().map(str::to_owned).ok_or_else(|| format!("{name} must be a string"))
        })
        .transpose()
}

fn parse_request(args: &Value) -> Result<(String, SearchOptions, bool), String> {
    let query =
        args.get("query").and_then(Value::as_str).ok_or("query must be a string")?.to_owned();
    let mut options = SearchOptions::default();
    if let Some(num) = args.get("num") {
        let num = num
            .as_u64()
            .filter(|num| (1..=20).contains(num))
            .ok_or("num must be an integer from 1 to 20")?;
        options.num = Some(num as u8);
    }
    if let Some(hl) = optional_text(args, "hl")? {
        options.hl = hl;
    }
    if let Some(gl) = optional_text(args, "gl")? {
        options.gl = gl;
    }
    if let Some(domain) = optional_text(args, "domain")? {
        options.domain = domain;
    }
    let vertical = optional_text(args, "vertical")?.unwrap_or_else(|| "web".to_owned());
    let rich = args
        .get("rich")
        .map_or(Ok(false), |value| value.as_bool().ok_or("rich must be a boolean"))?;
    options.classic = !rich;
    options.udm = if rich {
        None
    } else {
        Some(match vertical.as_str() {
            "web" => 14,
            "images" => 2,
            "news" => 12,
            "videos" => 7,
            "books" => 36,
            _ => return Err("vertical must be web, images, news, videos or books".to_owned()),
        })
    };
    if rich && !matches!(vertical.as_str(), "web" | "images" | "news" | "videos" | "books") {
        return Err("vertical must be web, images, news, videos or books".to_owned());
    }
    Ok((query, options, rich))
}

fn payload(result: &RichSearchResult, rich: bool) -> Value {
    let mut value = serde_json::Map::new();
    value.insert("query".to_owned(), json!(result.content.query));
    value.insert("authenticated".to_owned(), json!(result.authenticated));
    value.insert("transport".to_owned(), json!(result.profile_used));
    if let Some(total) = result.content.total_results {
        value.insert("totalResults".to_owned(), json!(total));
    }
    if let Some(corrected) = &result.content.corrected_query {
        value.insert("correctedQuery".to_owned(), json!(corrected));
    }
    value.insert("organic".to_owned(), Value::Array(result.content.organic.iter().map(|hit| json!({
        "position": hit.position, "title": hit.title, "url": hit.url, "snippet": hit.snippet,
    })).collect()));
    if rich {
        if let Some(snippet) = &result.content.featured_snippet {
            value.insert("featuredSnippet".to_owned(), json!(snippet));
        }
        if let Some(panel) = &result.content.knowledge_panel {
            value.insert("knowledgePanel".to_owned(), json!(panel));
        }
        value.insert("peopleAlsoAsk".to_owned(), json!(result.content.people_also_ask));
        value.insert("relatedSearches".to_owned(), json!(result.content.related_searches));
    }
    Value::Object(value)
}

async fn run(args: &Value) -> Result<Value, String> {
    let (query, options, rich) = parse_request(args)?;
    let result = search_rich(&query, &options).await?;
    Ok(payload(&result, rich))
}

pub(crate) async fn call(request: &CallToolRequestParams) -> CallToolResult {
    let args =
        request.arguments.as_ref().map_or_else(|| json!({}), |map| Value::Object(map.clone()));
    match run(&args).await {
        Ok(value) => CallToolResult::success(vec![ContentBlock::text(
            serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_owned()),
        )]),
        Err(error) => {
            CallToolResult::error(vec![ContentBlock::text(format!("aphrody_search: {error}"))])
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aphrody_google::search::{SearchTransport, parse_serp};

    #[test]
    fn schema_and_verticals_match_source_contract() {
        assert!(owns("aphrody_search"));
        assert_eq!(list(|_| false).len(), 1);
        let schema = serde_json::to_value(get("aphrody_search").unwrap()).unwrap();
        assert_eq!(schema["inputSchema"]["properties"]["num"]["maximum"], 20);
        assert_eq!(schema["inputSchema"]["properties"]["vertical"]["default"], "web");
        for (vertical, udm) in
            [("web", 14), ("images", 2), ("news", 12), ("videos", 7), ("books", 36)]
        {
            let (_, options, rich) =
                parse_request(&json!({"query":"rust", "vertical":vertical})).unwrap();
            assert_eq!(options.udm, Some(udm));
            assert!(!rich);
        }
    }

    #[test]
    fn payload_keeps_public_fields_and_rich_switch() {
        let content = parse_serp(
            "<div id='rso'><div class='g'><a href='https://example.org'><h3>Example</h3></a><div class='VwiC3b'>A snippet</div></div></div><div class='related-question-pair'>Question?</div>",
            "example",
        );
        let result = RichSearchResult {
            content,
            served_from_cache: false,
            profile_used: SearchTransport::Fetch,
            authenticated: false,
        };
        let basic = payload(&result, false);
        assert_eq!(basic["organic"][0]["title"], "Example");
        assert_eq!(basic["transport"], "fetch");
        assert!(basic.get("peopleAlsoAsk").is_none());
        let rich = payload(&result, true);
        assert_eq!(rich["peopleAlsoAsk"], json!(["Question?"]));
    }

    #[tokio::test]
    async fn malformed_input_fails_before_network() {
        assert!(run(&json!({})).await.is_err());
        assert!(run(&json!({"query":"x", "num":21})).await.is_err());
        assert!(run(&json!({"query":"x", "vertical":"other"})).await.is_err());
        assert!(run(&json!({"query":"x", "rich":"yes"})).await.is_err());
    }
}
