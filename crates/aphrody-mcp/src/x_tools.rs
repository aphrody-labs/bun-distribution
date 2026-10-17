// SPDX-License-Identifier: Apache-2.0
//! X client and local ranking tools served directly by the Rust MCP host.

use std::sync::LazyLock;

use aphrody_x::algorithm::{PostCandidate, RankingContext, rank_posts};
use aphrody_x::{NewsOptions, XClient, XSession};
use rmcp::model::{CallToolRequestParams, CallToolResult, ContentBlock, Tool};
use serde_json::{Value, json};

static TOOLS: LazyLock<Vec<Tool>> = LazyLock::new(|| {
    [
        json!({
            "name": "aphrody_x_client",
            "description": "Native X / Twitter client (cookie auth, no API key). Fetch a profile, a user's tweets, search the Latest timeline, trending news, or resolve the authenticated account. Auth uses an auth_token + ct0 cookie pair from the session file / X_AUTH_TOKEN+X_CT0 env, or an explicit cookie string.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["profile", "tweets", "search", "news", "whoami", "rank", "foryou"],
                        "description": "Operation to run. 'rank'/'foryou' run local X For You style ranking (x-algorithm port) over search/news results."
                    },
                    "handle": { "type": "string", "description": "@handle (screen name) for profile/tweets." },
                    "query": { "type": "string", "description": "Search query for action=search." },
                    "count": { "type": "integer", "minimum": 1, "maximum": 100, "default": 20, "description": "Number of items to fetch for tweets/search/news." },
                    "cookie": { "type": "string", "description": "Explicit \"auth_token=...; ct0=...\" pair (overrides session/env)." }
                },
                "required": ["action"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "aphrody_x_algorithm_rank",
            "description": "Rank a list of X posts using the local port of X For You algorithm (filters + weighted engagement scorer + author diversity from xai-org/x-algorithm). Returns ScoredPost[].",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "candidates": { "type": "array", "items": {}, "description": "Array of post objects (id, author_id, text, like_count, reply_count, ...). toPostCandidate() shape accepted." },
                    "context": {
                        "type": "object",
                        "properties": {
                            "viewer_id": { "type": "string" },
                            "followed_author_ids": { "type": "array", "items": { "type": "string" } },
                            "recent_engagement_author_ids": { "type": "array", "items": { "type": "string" } },
                            "muted_keywords": { "type": "array", "items": { "type": "string" } },
                            "blocked_author_ids": { "type": "array", "items": { "type": "string" } }
                        },
                        "additionalProperties": false
                    },
                    "topK": { "type": "integer", "minimum": 1, "maximum": 100 },
                    "top_k": { "type": "integer", "minimum": 1, "maximum": 100 }
                },
                "required": ["candidates"],
                "additionalProperties": false
            }
        }),
    ]
    .into_iter()
    .map(|definition| serde_json::from_value(definition).expect("static X tool schema"))
    .collect()
});

pub(crate) fn list(taken: impl Fn(&str) -> bool) -> Vec<Tool> {
    TOOLS
        .iter()
        .filter(|tool| !taken(tool.name.as_ref()))
        .cloned()
        .collect()
}

pub(crate) fn get(name: &str) -> Option<Tool> {
    TOOLS.iter().find(|tool| tool.name == name).cloned()
}

pub(crate) fn owns(name: &str) -> bool {
    get(name).is_some()
}

fn optional_text<'a>(args: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    args.get(key)
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| format!("{key} must be a string"))
        })
        .transpose()
}

fn count(args: &Value, key: &str, default: u32) -> Result<u32, String> {
    let Some(value) = args.get(key) else {
        return Ok(default);
    };
    let count = value
        .as_u64()
        .filter(|value| (1..=100).contains(value))
        .ok_or_else(|| format!("{key} must be an integer from 1 through 100"))?;
    Ok(count as u32)
}

fn post_candidate(raw: &Value) -> Result<PostCandidate, String> {
    let id = raw
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "candidate.id must be a string".to_owned())?;
    let author_id = raw
        .get("author_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let author_handle = raw
        .get("author_handle")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let text = raw.get("text").and_then(Value::as_str).unwrap_or_default();
    let metric = |key: &str| raw.get(key).and_then(Value::as_u64).unwrap_or(0);
    Ok(PostCandidate {
        id: id.to_owned(),
        author_id: author_id.to_owned(),
        author_handle,
        text: text.to_owned(),
        created_at: raw.get("created_at").and_then(Value::as_i64).unwrap_or(0),
        like_count: metric("like_count"),
        reply_count: metric("reply_count"),
        repost_count: metric("repost_count"),
        quote_count: metric("quote_count"),
        is_reply: raw
            .get("is_reply")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        is_repost: raw
            .get("is_repost")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        has_media: raw
            .get("has_media")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        in_network: raw
            .get("in_network")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

fn context(raw: Option<&Value>) -> Result<RankingContext, String> {
    let Some(raw) = raw else {
        return Ok(RankingContext::default());
    };
    if !raw.is_object() {
        return Err("context must be an object".to_owned());
    }
    serde_json::from_value(raw.clone()).map_err(|error| format!("context: {error}"))
}

fn rank(args: &Value) -> Result<Value, String> {
    let raw_candidates = args
        .get("candidates")
        .and_then(Value::as_array)
        .ok_or_else(|| "candidates must be an array".to_owned())?;
    let candidates = raw_candidates
        .iter()
        .map(post_candidate)
        .collect::<Result<Vec<_>, _>>()?;
    let mut originals = std::collections::HashMap::new();
    for raw in raw_candidates {
        if let Some(id) = raw.get("id").and_then(Value::as_str) {
            originals.entry(id).or_insert(raw);
        }
    }
    let context = context(args.get("context"))?;
    let top_k = if args.get("topK").is_some() {
        count(args, "topK", 20)?
    } else {
        count(args, "top_k", 20)?
    };
    let mut value = serde_json::to_value(rank_posts(candidates, &context, top_k as usize))
        .map_err(|error| error.to_string())?;
    if let Some(items) = value.as_array_mut() {
        for item in items {
            if let Some(id) = item.pointer("/post/id").and_then(Value::as_str)
                && let Some(original) = originals.get(id)
            {
                item["post"] = (*original).clone();
            }
        }
    }
    Ok(value)
}

async fn client_action(args: &Value) -> Result<Value, String> {
    let action = args
        .get("action")
        .and_then(Value::as_str)
        .ok_or_else(|| "action must be a string".to_owned())?;
    if ![
        "profile", "tweets", "search", "news", "whoami", "rank", "foryou",
    ]
    .contains(&action)
    {
        return Err(format!("unsupported X action: {action}"));
    }
    let handle = optional_text(args, "handle")?;
    let query = optional_text(args, "query")?;
    let cookie = optional_text(args, "cookie")?;
    let count = count(args, "count", 20)?;
    if matches!(action, "profile" | "tweets") && handle.is_none_or(str::is_empty) {
        return Err(format!("action={action} requires handle"));
    }
    if action == "search" && query.is_none_or(str::is_empty) {
        return Err("action=search requires query".to_owned());
    }
    let session = match cookie.filter(|cookie| !cookie.is_empty()) {
        Some(cookie) => XSession::from_cookie_string(cookie),
        None => XSession::load_or_env(),
    }
    .map_err(|error| error.to_string())?;
    let client = XClient::new(session).map_err(|error| error.to_string())?;
    let handle = handle.map(|handle| handle.strip_prefix('@').unwrap_or(handle));
    let payload = match action {
        "profile" => serde_json::to_value(
            client
                .user_by_screen_name(handle.unwrap_or_default())
                .await
                .map_err(|error| error.to_string())?,
        ),
        "tweets" => {
            let id = client
                .user_id_for(handle.unwrap_or_default())
                .await
                .map_err(|error| error.to_string())?;
            serde_json::to_value(
                client
                    .user_tweets(&id, count, None, 1)
                    .await
                    .map_err(|error| error.to_string())?,
            )
        }
        "search" => serde_json::to_value(
            client
                .search(query.unwrap_or_default(), count, None, "Latest", 1)
                .await
                .map_err(|error| error.to_string())?,
        ),
        "news" => serde_json::to_value(
            client
                .get_news(count as usize, &NewsOptions::default())
                .await
                .map_err(|error| error.to_string())?,
        ),
        "whoami" => serde_json::to_value(client.whoami().await.map_err(|error| error.to_string())?),
        "rank" | "foryou" => {
            let viewer_id = client.whoami().await.ok().map(|viewer| viewer.id);
            let context = RankingContext {
                viewer_id,
                ..Default::default()
            };
            let candidates = if action == "foryou" || query.is_some_and(|query| !query.is_empty()) {
                let query = if action == "foryou" {
                    query.filter(|q| !q.is_empty()).unwrap_or("ai")
                } else {
                    query.filter(|q| !q.is_empty()).unwrap_or("tech")
                };
                client
                    .search(query, count.max(30), None, "Latest", 1)
                    .await
                    .map_err(|error| error.to_string())?
                    .tweets
                    .iter()
                    .map(|tweet| aphrody_x::tweet_to_algo_candidate(tweet, false))
                    .collect()
            } else {
                client
                    .get_news(count.max(30) as usize, &NewsOptions::default())
                    .await
                    .map_err(|error| error.to_string())?
                    .iter()
                    .filter_map(|item| serde_json::to_value(item).ok())
                    .filter_map(|item| post_candidate(&item).ok())
                    .collect()
            };
            let ranked = rank_posts(candidates, &context, count as usize);
            serde_json::to_value(json!({
                "ranked_count": ranked.len(),
                "action": action,
                "results": ranked
            }))
        }
        _ => unreachable!("action checked above"),
    };
    payload.map_err(|error| error.to_string())
}

pub(crate) async fn call(request: &CallToolRequestParams) -> CallToolResult {
    let name = request.name.as_ref();
    let args = request
        .arguments
        .as_ref()
        .map_or_else(|| json!({}), |map| Value::Object(map.clone()));
    let result = match name {
        "aphrody_x_client" => client_action(&args).await,
        "aphrody_x_algorithm_rank" => rank(&args),
        _ => Err(format!("unknown X tool: {name}")),
    };
    match result {
        Ok(value) => {
            let mut result = CallToolResult::success(vec![ContentBlock::text(
                serde_json::to_string_pretty(&value).unwrap_or_else(|_| "null".to_owned()),
            )]);
            if value.is_object() {
                result.structured_content = Some(value);
            }
            result
        }
        Err(error) => CallToolResult::error(vec![ContentBlock::text(format!("{name}: {error}"))]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_exposes_both_source_schemas() {
        assert!(owns("aphrody_x_client"));
        assert!(owns("aphrody_x_algorithm_rank"));
        assert_eq!(TOOLS.len(), 2);
        let schema = serde_json::to_value(get("aphrody_x_client").unwrap()).unwrap();
        assert_eq!(schema["inputSchema"]["properties"]["count"]["default"], 20);
    }

    #[test]
    fn rank_runs_locally_without_credentials() {
        let value = rank(&json!({
            "candidates": [
                { "id": "one", "author_id": "a", "text": "hello", "created_at": 1_700_000_000, "like_count": 10 },
                { "id": "two", "author_id": "b", "text": "world", "created_at": 1_700_000_000, "like_count": 1 }
            ],
            "context": { "now_unix": 1_700_000_010 },
            "topK": 1
        })).unwrap();
        assert_eq!(value.as_array().unwrap().len(), 1);
        assert_eq!(value[0]["post"]["id"], "one");
        assert!(value[0]["post"].get("author_handle").is_none());
    }

    #[test]
    fn camel_case_top_k_wins_over_legacy_alias() {
        let input = json!({ "candidates": [], "topK": 1, "top_k": 101 });
        assert!(rank(&input).is_ok());
        assert!(rank(&json!({ "candidates": [], "top_k": 101 })).is_err());
    }

    #[tokio::test]
    async fn invalid_client_action_fails_before_credentials() {
        assert!(
            client_action(&json!({ "action": "search" }))
                .await
                .unwrap_err()
                .contains("query")
        );
        assert!(
            client_action(&json!({ "action": "tweets" }))
                .await
                .unwrap_err()
                .contains("handle")
        );
        assert!(
            client_action(&json!({ "action": "whoami", "cookie": "auth_token=x" }))
                .await
                .unwrap_err()
                .contains("ct0")
        );
    }
}
