// SPDX-License-Identifier: Apache-2.0
//! Google Search MCP route backed by the shared Rust search engine.

use std::sync::LazyLock;

use aphrody_google::search::execute_search_request as run;
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
                "rich": { "type": "boolean", "default": false, "description": "Include featured snippet / knowledge panel / PAA / related searches without changing the requested vertical." },
                "anonymous": { "type": "boolean", "default": false, "description": "Do not read or send account cookies." },
                "safe": { "type": "string", "enum": ["active", "off"], "description": "Google SafeSearch preference." },
                "start": { "type": "integer", "minimum": 0, "maximum": 1000, "description": "Result offset for pagination." }
            },
            "required": ["query"],
            "additionalProperties": false
        }
    })).expect("static Google Search tool schema")
});

static ROUTES_TOOL: LazyLock<Tool> = LazyLock::new(|| {
    serde_json::from_value(json!({
        "name": "aphrody_google_routes",
        "description": "Read the native catalogue of public Google entry points and official SEO, Web Vitals and accessibility guidance. Dated observations, not a crawl queue or authorization to mirror Search.",
        "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
        "annotations": { "readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
    })).expect("static Google route catalogue schema")
});

pub(crate) fn list(taken: impl Fn(&str) -> bool) -> Vec<Tool> {
    [&*TOOL, &*ROUTES_TOOL]
        .into_iter()
        .filter(|tool| !taken(tool.name.as_ref()))
        .cloned()
        .collect()
}

pub(crate) fn get(name: &str) -> Option<Tool> {
    [&*TOOL, &*ROUTES_TOOL]
        .into_iter()
        .find(|tool| tool.name == name)
        .cloned()
}

pub(crate) fn owns(name: &str) -> bool {
    TOOL.name == name || ROUTES_TOOL.name == name
}

pub(crate) async fn call(request: &CallToolRequestParams) -> CallToolResult {
    let args = request
        .arguments
        .as_ref()
        .map_or_else(|| json!({}), |map| Value::Object(map.clone()));
    let result = if request.name == ROUTES_TOOL.name {
        if args.as_object().is_some_and(serde_json::Map::is_empty) {
            serde_json::to_value(aphrody_google::routes::catalog())
                .map_err(|error| error.to_string())
        } else {
            Err("route catalogue accepts no arguments".to_owned())
        }
    } else {
        run(&args).await
    };
    match result {
        Ok(value) => CallToolResult::success(vec![ContentBlock::text(
            serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_owned()),
        )]),
        Err(error) => CallToolResult::error(vec![ContentBlock::text(format!(
            "{}: {error}",
            request.name
        ))]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aphrody_google::search::{
        RichSearchResult, SearchTransport, parse_search_request as parse_request, parse_serp,
        project_search_result as payload, project_vertical_result as vertical_payload,
    };

    #[test]
    fn schema_and_verticals_match_source_contract() {
        assert!(owns("aphrody_search"));
        assert_eq!(list(|_| false).len(), 2);
        let schema = serde_json::to_value(get("aphrody_search").unwrap()).unwrap();
        assert_eq!(schema["inputSchema"]["properties"]["num"]["maximum"], 20);
        assert_eq!(
            schema["inputSchema"]["properties"]["vertical"]["default"],
            "web"
        );
        for (vertical, udm) in [
            ("web", 14),
            ("images", 2),
            ("news", 12),
            ("videos", 7),
            ("books", 36),
        ] {
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
        assert!(
            run(&json!({"query":"x", "vertical":"other"}))
                .await
                .is_err()
        );
        assert!(run(&json!({"query":"x", "rich":"yes"})).await.is_err());
        for args in [
            json!({"query":"  "}),
            json!({"query":"x","anonymous":"yes"}),
            json!({"query":"x","safe":"invalid"}),
            json!({"query":"x","start":1001}),
            json!({"query":"x","start":-1}),
            json!({"query":"x","extra":true}),
        ] {
            assert!(run(&args).await.is_err(), "accepted invalid input: {args}");
        }
    }

    #[test]
    fn rich_results_preserve_vertical_and_privacy_preferences() {
        for (vertical, udm) in [
            ("web", None),
            ("images", Some(2)),
            ("news", Some(12)),
            ("videos", Some(7)),
            ("books", Some(36)),
        ] {
            let (query, options, rich) = parse_request(&json!({"query":"rust & bun","vertical":vertical,"rich":true,"anonymous":true,"safe":"active","start":20})).unwrap();
            assert!(rich && options.anonymous);
            assert_eq!(options.udm, udm);
            let url = aphrody_google::search::search_url(&query, &options).unwrap();
            let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
            assert_eq!(pairs["q"], "rust & bun");
            assert_eq!(pairs["safe"], "active");
            assert_eq!(pairs["start"], "20");
            assert_eq!(
                pairs.get("udm"),
                udm.map(|value| value.to_string()).as_ref()
            );
        }
    }

    #[test]
    fn vertical_projection_uses_real_destination_urls() {
        let images = vertical_payload("cat", json!([{"title":"Cat","imageUrl":"https://example.org/cat.png","thumbnail":"https://example.org/thumb.png"}])).unwrap();
        assert_eq!(images["organic"][0]["url"], "https://example.org/cat.png");
        let news = vertical_payload(
            "news",
            json!([{"title":"Story","url":"https://example.org/news","snippet":"Published text"}]),
        )
        .unwrap();
        assert_eq!(news["organic"][0]["snippet"], "Published text");
        assert!(
            vertical_payload("cat", json!([{"thumbnail":"data:image/png;base64,AAAA"}])).is_err()
        );
    }

    #[tokio::test]
    async fn route_tool_is_local_read_only_and_rejects_arguments() {
        let tool = get("aphrody_google_routes").unwrap();
        assert_eq!(
            serde_json::to_value(tool).unwrap()["annotations"]["readOnlyHint"],
            true
        );
        let request =
            serde_json::from_value(json!({"name":"aphrody_google_routes","arguments":{}})).unwrap();
        assert_ne!(call(&request).await.is_error, Some(true));
        let request = serde_json::from_value(
            json!({"name":"aphrody_google_routes","arguments":{"url":"https://example.org"}}),
        )
        .unwrap();
        assert_eq!(call(&request).await.is_error, Some(true));
    }
}
