// SPDX-License-Identifier: Apache-2.0
//! Tests of the operation table and the runner against a loopback server: no real X host, no real
//! cookie, no network.

use std::{
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};

use serde_json::{Value, json};

use super::*;
use crate::{
    XClientOptions, XSession,
    mock::{MockServer, Request, Response},
};

fn session() -> XSession {
    XSession::new("AUTH_TOKEN_PLACEHOLDER", "CT0_PLACEHOLDER")
}

fn temp_path(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("aphx-ops-{}-{name}", uuid::Uuid::new_v4()))
}

fn client_for(server: &MockServer) -> XClient {
    XClient::with_options(
        session(),
        XClientOptions {
            api_base: Some(server.api_base()),
            upload_base: Some(server.upload_url()),
            timeout_ms: Some(10_000),
            persist_session: Some(false),
            query_ids_path: Some(temp_path("query-ids.json")),
            query_ids_ttl_secs: Some(3600),
            discovery_pages: Some(Vec::new()),
        },
    )
    .expect("client")
}

/// Retry settings that keep tests fast: no jitter, millisecond backoff, no rate-limit margin.
fn fast() -> RunOptions {
    RunOptions {
        retry: RetryPolicy {
            max_retries: 3,
            base_ms: 1,
            max_backoff_ms: 5,
            jitter: 0.0,
            max_rate_limit_waits: 3,
            max_wait_secs: 30,
            rate_limit_margin_ms: 0,
            retry_non_idempotent: false,
            wait_rate_limit_mutations: None,
        },
        pacing: None,
        timeout: Duration::from_secs(10),
        batch: false,
    }
}

fn tweet_result(id: &str, text: &str, likes: u64) -> Value {
    json!({
        "__typename": "Tweet",
        "rest_id": id,
        "core": { "user_results": { "result": {
            "rest_id": "7",
            "core": { "name": "Aphrody", "screen_name": "aphrody_code" }
        } } },
        "legacy": {
            "full_text": text,
            "favorite_count": likes,
            "retweet_count": 0,
            "reply_count": 0,
            "quote_count": 0,
            "created_at": "Fri May 22 10:00:00 +0000 2026",
            "user_id_str": "7"
        }
    })
}

fn timeline(tweets: Vec<Value>, cursor: Option<&str>) -> Value {
    let mut entries: Vec<Value> = tweets
        .into_iter()
        .enumerate()
        .map(|(i, tweet)| {
            json!({
                "entryId": format!("tweet-{i}"),
                "content": {
                    "entryType": "TimelineTimelineItem",
                    "itemContent": { "tweet_results": { "result": tweet } }
                }
            })
        })
        .collect();
    if let Some(cursor) = cursor {
        entries.push(json!({
            "entryId": "cursor-bottom",
            "content": {
                "entryType": "TimelineTimelineCursor",
                "cursorType": "Bottom",
                "value": cursor
            }
        }));
    }
    json!({ "data": { "x": { "timeline": { "instructions": [
        { "type": "TimelineAddEntries", "entries": entries }
    ] } } } })
}

fn user_response() -> Value {
    json!({ "data": { "user": { "result": {
        "rest_id": "7",
        "core": { "name": "Aphrody", "screen_name": "aphrody_code" },
        "legacy": { "followers_count": 10, "friends_count": 5 }
    } } } })
}

/// The `variables` of a GraphQL request, wherever the operation puts them.
fn variables_of(request: &Request) -> Value {
    request
        .query("variables")
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| request.json()["variables"].clone())
}

fn ctx(client: &XClient) -> OpContext<'_> {
    OpContext { client: Some(client) }
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

#[test]
fn the_table_has_unique_names_and_consistent_flags() {
    let mut seen = HashSet::new();
    for spec in OPS {
        assert!(seen.insert(spec.name), "duplicate operation {}", spec.name);
        if spec.kind != OpKind::Network {
            assert!(!spec.mutating, "{} is local but mutating", spec.name);
        }
        if spec.mutating && spec.kind == OpKind::Network {
            assert!(spec.needs_client, "{} mutates without a session", spec.name);
        }
    }
    assert!(OPS.len() > 100);
}

#[test]
fn every_local_operation_has_an_implementation() {
    for spec in OPS.iter().filter(|s| s.kind != OpKind::Network) {
        // `store_open` without a path would open the user's real store: keep the test private.
        let args =
            if spec.name == "store_open" { json!({ "path": ":memory:" }) } else { json!({}) };
        if let Err(error) = run_local(OpContext::default(), spec.name, &args) {
            let text = error.to_string();
            assert!(!text.contains("network operation"), "{}: {text}", spec.name);
            assert!(!text.contains("unknown operation"), "{}: {text}", spec.name);
        }
    }
}

#[tokio::test]
async fn every_network_operation_has_an_implementation() {
    let server = MockServer::start(|_| Response::ok(json!({ "data": {} }))).await;
    let client = client_for(&server);
    for spec in OPS.iter().filter(|s| s.kind == OpKind::Network) {
        let outcome = run(ctx(&client), spec.name, &json!({})).await;
        if let Err(error) = outcome {
            assert!(
                !error.to_string().contains("has no implementation"),
                "{} is listed but not implemented: {error}",
                spec.name
            );
        }
    }
}

#[test]
fn raw_operations_are_classified_by_their_arguments() {
    assert!(!is_mutating("graphql", &json!({ "operation": "UserTweets" })));
    assert!(is_mutating("graphql", &json!({ "operation": "CreateTweet" })));
    assert!(is_idempotent("graphql", &json!({ "operation": "UserTweets" })));
    assert!(!is_idempotent("graphql", &json!({ "operation": "CreateTweet" })));
    assert!(is_idempotent("graphql", &json!({ "operation": "CreateTweet", "idempotent": true })));
    assert!(!is_mutating("request", &json!({ "method": "get", "path": "x" })));
    assert!(is_mutating("request", &json!({ "method": "POST", "path": "x" })));
    assert!(is_mutating("create_tweet", &json!({})));
    assert!(!is_idempotent("create_tweet", &json!({})));
    assert!(is_idempotent("like", &json!({})));
}

#[test]
fn meta_serves_the_table_the_taxonomy_and_the_surface() {
    let meta = run_local(OpContext::default(), "meta", &json!({})).unwrap();
    assert_eq!(meta["ops"].as_array().unwrap().len(), OPS.len());
    assert!(meta["policy"]["auth_codes"].as_array().unwrap().contains(&json!(32)));
    assert_eq!(meta["surface"]["discovery_pages"], json!(DISCOVERY_PAGES));
    assert_eq!(meta["surface"]["premium_graphql_ops"], json!(PREMIUM_GRAPHQL_OPS));
    assert!(meta["catalog"]["total"].as_u64().unwrap() > 100);
    assert_eq!(meta["defaults"]["retry"]["max_retries"], 3);
    let create = meta["ops"].as_array().unwrap().iter().find(|o| o["name"] == "create_tweet");
    assert_eq!(create.unwrap()["idempotent"], false);
}

// ---------------------------------------------------------------------------
// Pure operations
// ---------------------------------------------------------------------------

#[test]
fn parse_operations_work_on_raw_responses() {
    let page =
        timeline(vec![tweet_result("1", "hello", 3), tweet_result("2", "world", 5)], Some("CUR"));
    let parsed = run_local(
        OpContext::default(),
        "parse_timeline_tweets",
        &json!({ "json": page, "quote_depth": 0 }),
    )
    .unwrap();
    assert_eq!(parsed["tweets"].as_array().unwrap().len(), 2);
    assert_eq!(parsed["next_cursor"], "CUR");
    assert_eq!(parsed["tweets"][1]["like_count"], 5);

    let single = run_local(
        OpContext::default(),
        "parse_single_tweet",
        &json!({ "json": page, "id": "https://x.com/aphrody_code/status/2" }),
    )
    .unwrap();
    assert_eq!(single["text"], "world");

    let count =
        run_local(OpContext::default(), "parse_post_count", &json!({ "text": "12.3K posts" }))
            .unwrap();
    assert_eq!(count, 12_300);
    let stamp = run_local(
        OpContext::default(),
        "parse_timestamp",
        &json!({ "text": "Fri May 22 10:00:00 +0000 2026" }),
    )
    .unwrap();
    assert_eq!(stamp, 1_779_444_000);
}

#[test]
fn catalog_and_feature_operations_serve_the_shared_data() {
    let op =
        run_local(OpContext::default(), "catalog_get", &json!({ "name": "CreateTweet" })).unwrap();
    assert_eq!(op["operationType"], "mutation");
    assert!(op["queryId"].as_str().is_some_and(|q| !q.is_empty()));
    let missing =
        run_local(OpContext::default(), "catalog_get", &json!({ "name": "Nope" })).unwrap();
    assert!(missing.is_null());
    let mutations = run_local(
        OpContext::default(),
        "catalog_list",
        &json!({ "type": "mutation", "filter": "tweet" }),
    )
    .unwrap();
    assert!(mutations.as_array().unwrap().iter().all(|o| o["operationType"] == "mutation"));
    assert!(mutations.as_array().unwrap().iter().any(|o| o["name"] == "CreateTweet"));
    let features =
        run_local(OpContext::default(), "features_for", &json!({ "operation": "CreateTweet" }))
            .unwrap();
    assert_eq!(features["responsive_web_graphql_timeline_navigation_enabled"], true);
    let unknown = run_local(OpContext::default(), "features_for", &json!({ "operation": "Nope" }));
    assert!(matches!(unknown, Err(XError::UnknownOperation(_))));
}

#[test]
fn rank_tweets_accepts_partial_tweets_and_ranks_them() {
    let now = 1_779_444_000;
    let tweets = json!([
        { "id": "a", "text": "popular", "author": { "username": "p", "name": "P" }, "author_id": "p",
          "like_count": 5000, "retweet_count": 1000, "reply_count": 200, "quote_count": 50,
          "created_at": "Fri May 22 09:59:00 +0000 2026" },
        { "id": "b", "text": "quiet", "author": { "username": "q", "name": "Q" }, "author_id": "q",
          "like_count": 1, "created_at": "Fri May 22 09:00:00 +0000 2026" }
    ]);
    let ranked = run_local(
        OpContext::default(),
        "rank_tweets",
        &json!({ "tweets": tweets, "context": { "now_unix": now }, "top_k": 5 }),
    )
    .unwrap();
    let ranked = ranked.as_array().unwrap();
    assert_eq!(ranked.len(), 2);
    assert_eq!(ranked[0]["post"]["id"], "a");
    assert!(ranked[0]["score"].as_f64().unwrap() > ranked[1]["score"].as_f64().unwrap());
    // The X date was understood: the candidate carries a real timestamp, not 0.
    assert_eq!(ranked[0]["post"]["created_at"], now - 60);
}

#[test]
fn invalid_arguments_are_reported_as_invalid() {
    let error = run_local(OpContext::default(), "catalog_get", &json!({})).unwrap_err();
    assert!(matches!(error, XError::Invalid(ref m) if m.contains("name")), "{error}");
    let error =
        run_local(OpContext::default(), "parse_post_count", &json!({ "text": 3 })).unwrap_err();
    assert!(matches!(error, XError::Invalid(_)));
    let envelope = execute_local(None, Some("k"), "catalog_get", &json!({}));
    assert_eq!(envelope["ok"], false);
    assert_eq!(envelope["id"], "k");
    assert_eq!(envelope["error"]["kind"], "invalid");
}

#[test]
fn a_network_operation_is_refused_by_the_synchronous_entry() {
    let envelope = execute_local(None, None, "search", &json!({ "query": "x" }));
    assert_eq!(envelope["ok"], false);
    assert!(envelope["error"]["message"].as_str().unwrap().contains("network operation"));
}

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

#[test]
fn store_operations_roundtrip_through_a_handle() {
    let ctx = OpContext::default();
    let opened = run_local(ctx, "store_open", &json!({ "path": ":memory:" })).unwrap();
    let handle = opened["store"].as_u64().unwrap();
    let tweet = json!({
        "id": "9", "text": "hello sqlite", "author": { "username": "aphrody_code", "name": "A" },
        "reply_count": 0, "retweet_count": 0, "like_count": 7, "quote_count": 0, "is_note_tweet": false
    });
    let ingested = run_local(
        ctx,
        "store_ingest",
        &json!({
            "store": handle,
            "tweets": [tweet],
            "edges": [{ "account": "me", "kind": "timeline", "tweet_id": "9" }],
            "users": [{ "id": "7", "username": "aphrody_code", "name": "A" }]
        }),
    )
    .unwrap();
    assert_eq!(ingested, json!({ "users": 1, "tweets": 1, "edges": 1, "follows": 0 }));

    let hits =
        run_local(ctx, "store_search", &json!({ "store": handle, "query": "sqlite" })).unwrap();
    assert_eq!(hits[0]["id"], "9");
    let stats = run_local(ctx, "store_stats", &json!({ "store": handle })).unwrap();
    assert_eq!((stats["tweets"].clone(), stats["edges"].clone()), (json!(1), json!(1)));
    let rows = run_local(
        ctx,
        "store_query",
        &json!({ "store": handle, "sql": "SELECT id, like_count FROM tweets WHERE id = ?1", "params": ["9"] }),
    )
    .unwrap();
    assert_eq!(rows, json!([{ "id": "9", "like_count": 7 }]));
    let refused =
        run_local(ctx, "store_query", &json!({ "store": handle, "sql": "DELETE FROM tweets" }));
    assert!(matches!(refused, Err(XError::Invalid(_))));
    let digest = run_local(ctx, "store_digest", &json!({ "store": handle, "top": 3 })).unwrap();
    assert_eq!(digest["top_tweets"][0]["id"], "9");
    assert_eq!(
        run_local(ctx, "store_known_usernames", &json!({ "store": handle })).unwrap(),
        json!(["aphrody_code"])
    );

    let closed = run_local(ctx, "store_close", &json!({ "store": handle })).unwrap();
    assert_eq!(closed["closed"], true);
    let gone = run_local(ctx, "store_stats", &json!({ "store": handle })).unwrap_err();
    assert!(gone.to_string().contains("unknown store handle"), "{gone}");
}

#[test]
fn store_ingest_users_harvests_user_results_anywhere() {
    let ctx = OpContext::default();
    let handle = run_local(ctx, "store_open", &json!({ "path": ":memory:" })).unwrap()["store"]
        .as_u64()
        .unwrap();
    let payload = json!({ "entries": [
        { "user_results": { "result": { "rest_id": "42", "legacy": { "screen_name": "aphrody", "name": "Aphrody" } } } },
        { "nested": { "user_results": { "result": { "rest_id": "42", "legacy": { "screen_name": "aphrody", "name": "Aphrody" } } } } }
    ] });
    let counted =
        run_local(ctx, "store_ingest_users", &json!({ "store": handle, "json": payload })).unwrap();
    assert_eq!(counted["users"], 1, "the same user found twice counts once");
    let rows = run_local(
        ctx,
        "store_query",
        &json!({ "store": handle, "sql": "SELECT username FROM users" }),
    )
    .unwrap();
    assert_eq!(rows, json!([{ "username": "aphrody" }]));
}

// ---------------------------------------------------------------------------
// Network operations against the loopback server
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_read_carries_the_credentials_and_parses_the_answer() {
    let server = MockServer::start(|_| Response::ok(user_response())).await;
    let client = client_for(&server);
    let result = run(ctx(&client), "user_by_screen_name", &json!({ "handle": "@aphrody_code" }))
        .await
        .unwrap();
    assert_eq!(result["id"], "7");
    assert_eq!(result["screen_name"], "aphrody_code");
    assert_eq!(result["followers_count"], 10);

    let request = &server.requests()[0];
    assert_eq!(request.method, "GET");
    assert!(request.path().contains("/i/api/graphql/"), "{}", request.path());
    assert_eq!(request.last_segment(), "UserByScreenName");
    assert_eq!(variables_of(request)["screen_name"], "aphrody_code", "the @ is stripped");
    assert_eq!(request.header("x-csrf-token"), Some("CT0_PLACEHOLDER"));
    let cookie = request.header("cookie").unwrap();
    assert!(
        cookie.contains("auth_token=AUTH_TOKEN_PLACEHOLDER")
            && cookie.contains("ct0=CT0_PLACEHOLDER")
    );
    assert!(request.header("authorization").unwrap().starts_with("Bearer "));
    assert_eq!(request.header("x-client-transaction-id").unwrap().len(), 32);
}

#[tokio::test]
async fn a_mutation_posts_its_variables_and_a_rest_call_posts_a_form() {
    let server = MockServer::start(|request| match request.last_segment() {
        "FavoriteTweet" => Response::ok(json!({ "data": { "favorite_tweet": "Done" } })),
        _ => Response::ok(json!({ "id": 42 })),
    })
    .await;
    let client = client_for(&server);
    let liked =
        run(ctx(&client), "like", &json!({ "id": "https://x.com/u/status/123" })).await.unwrap();
    assert_eq!(liked["id"], "123");
    let post = &server.requests()[0];
    assert_eq!(post.method, "POST");
    assert_eq!(post.last_segment(), "FavoriteTweet");
    assert_eq!(post.json()["variables"]["tweet_id"], "123");
    assert!(post.json()["features"].is_object());
    assert!(post.json()["queryId"].as_str().is_some_and(|q| !q.is_empty()));

    run(ctx(&client), "follow", &json!({ "user_id": "99" })).await.unwrap();
    let rest = &server.requests()[1];
    assert_eq!(rest.path(), "/i/api/1.1/friendships/create.json");
    assert_eq!(rest.form(), vec![("user_id".to_owned(), "99".to_owned())]);
    assert_eq!(rest.header("content-type"), Some("application/x-www-form-urlencoded"));
}

#[tokio::test]
async fn creating_a_tweet_sends_text_reply_and_media() {
    let server = MockServer::start(|_| {
        Response::ok(json!({ "data": { "create_tweet": { "tweet_results": { "result": {
            "rest_id": "555", "legacy": { "full_text": "echo" }
        } } } } }))
    })
    .await;
    let client = client_for(&server);
    let created = run(
        ctx(&client),
        "create_tweet",
        &json!({ "text": "hello", "reply_to": "https://x.com/a/status/77", "media_ids": ["m1", "m2"] }),
    )
    .await
    .unwrap();
    assert_eq!(created, json!({ "id": "555", "text": "echo" }));
    let variables = variables_of(&server.requests()[0]);
    assert_eq!(variables["tweet_text"], "hello");
    assert_eq!(variables["reply"]["in_reply_to_tweet_id"], "77");
    assert_eq!(variables["media"]["media_entities"][1]["media_id"], "m2");
}

#[tokio::test]
async fn pagination_follows_cursors_and_reports_completeness() {
    let server = MockServer::start(|request| {
        let cursor = variables_of(request)["cursor"].as_str().map(str::to_owned);
        match cursor.as_deref() {
            None => Response::ok(timeline(
                vec![tweet_result("1", "a", 1), tweet_result("2", "b", 1)],
                Some("A"),
            )),
            Some("A") => Response::ok(timeline(vec![tweet_result("3", "c", 1)], Some("B"))),
            // The same tweet again: a page with nothing new, then the end.
            Some("B") => Response::ok(timeline(vec![tweet_result("3", "c", 1)], None)),
            Some(other) => Response::x_error(400, 0, &format!("unexpected cursor {other}")),
        }
    })
    .await;
    let client = client_for(&server);

    let one = run(ctx(&client), "search", &json!({ "query": "rust" })).await.unwrap();
    assert_eq!(one["tweets"].as_array().unwrap().len(), 2);
    assert_eq!(one["next_cursor"], "A");
    assert_eq!(one["pages"], 1);
    assert_eq!(one["complete"], false);

    let all =
        run(ctx(&client), "search", &json!({ "query": "rust", "all": true, "max_pages": 10 }))
            .await
            .unwrap();
    let ids: Vec<&str> =
        all["tweets"].as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap()).collect();
    assert_eq!(ids, vec!["1", "2", "3"], "deduplicated across pages");
    assert_eq!(all["pages"], 3);
    assert_eq!(all["complete"], true);

    let capped =
        run(ctx(&client), "search", &json!({ "query": "rust", "all": true, "max_pages": 2 }))
            .await
            .unwrap();
    assert_eq!(capped["pages"], 2);
    assert_eq!(capped["complete"], false, "stopped on max_pages with a cursor left");
    assert_eq!(capped["next_cursor"], "B");
}

#[tokio::test]
async fn search_passes_product_and_query_source() {
    let server = MockServer::start(|_| Response::ok(timeline(vec![], None))).await;
    let client = client_for(&server);
    run(ctx(&client), "search", &json!({ "query": "q", "top": true, "query_source": "radar" }))
        .await
        .unwrap();
    let variables = variables_of(&server.requests()[0]);
    assert_eq!(variables["product"], "Top");
    assert_eq!(variables["querySource"], "radar");
    assert_eq!(variables["rawQuery"], "q");
}

#[tokio::test]
async fn user_timelines_resolve_a_handle_to_an_id_first() {
    let server = MockServer::start(|request| match request.last_segment() {
        "UserByScreenName" => Response::ok(user_response()),
        _ => Response::ok(timeline(vec![tweet_result("1", "mine", 2)], None)),
    })
    .await;
    let client = client_for(&server);
    let out = run(ctx(&client), "user_tweets", &json!({ "handle": "aphrody_code", "count": 5 }))
        .await
        .unwrap();
    assert_eq!(out["tweets"][0]["text"], "mine");
    let calls: Vec<String> =
        server.requests().iter().map(|r| r.last_segment().to_owned()).collect();
    assert_eq!(calls, ["UserByScreenName", "UserTweets"]);
    let variables = variables_of(&server.requests()[1]);
    assert_eq!(variables["userId"], "7");
    assert_eq!(variables["count"], 5);

    let replies =
        run(ctx(&client), "user_tweets_and_replies", &json!({ "user_id": "7" })).await.unwrap();
    assert_eq!(replies["tweets"].as_array().unwrap().len(), 1);
    assert_eq!(server.requests().last().unwrap().last_segment(), "UserTweetsAndReplies");
    run(ctx(&client), "user_media", &json!({ "user_id": "7" })).await.unwrap();
    assert_eq!(server.requests().last().unwrap().last_segment(), "UserMedia");
}

#[tokio::test]
async fn a_rotated_ct0_is_used_by_the_next_request() {
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    let server = MockServer::start(move |_| {
        let first = seen.fetch_add(1, Ordering::SeqCst) == 0;
        let response = Response::ok(user_response());
        if first {
            response.with_header("set-cookie", "ct0=ROTATED_CT0; Path=/; Secure")
        } else {
            response
        }
    })
    .await;
    let client = client_for(&server);
    run(ctx(&client), "user_by_screen_name", &json!({ "handle": "a" })).await.unwrap();
    run(ctx(&client), "user_by_screen_name", &json!({ "handle": "a" })).await.unwrap();
    let requests = server.requests();
    assert_eq!(requests[0].header("x-csrf-token"), Some("CT0_PLACEHOLDER"));
    assert_eq!(requests[1].header("x-csrf-token"), Some("ROTATED_CT0"));
    assert!(requests[1].header("cookie").unwrap().contains("ct0=ROTATED_CT0"));
    assert_eq!(client.session().ct0, "ROTATED_CT0");
}

#[tokio::test]
async fn a_404_on_a_query_falls_back_to_the_post_hybrid_form() {
    let server = MockServer::start(|request| {
        if request.method == "GET" {
            Response::json(404, Value::Null)
        } else {
            Response::ok(user_response())
        }
    })
    .await;
    let client = client_for(&server);
    let user = run(ctx(&client), "user_by_screen_name", &json!({ "handle": "a" })).await.unwrap();
    assert_eq!(user["id"], "7");
    let requests = server.requests();
    assert_eq!(requests.len(), 2);
    assert_eq!((requests[0].method.as_str(), requests[1].method.as_str()), ("GET", "POST"));
    assert!(requests[1].json()["features"].is_object(), "features move into the body");
    assert_eq!(variables_of(&requests[1])["screen_name"], "a", "variables stay in the URL");
}

#[tokio::test]
async fn a_414_on_a_query_also_falls_back_to_the_post_hybrid_form() {
    let server = MockServer::start(|request| {
        if request.method == "GET" {
            Response::json(414, Value::Null)
        } else {
            Response::ok(user_response())
        }
    })
    .await;
    let client = client_for(&server);
    assert!(run(ctx(&client), "user_by_screen_name", &json!({ "handle": "a" })).await.is_ok());
    assert_eq!(server.requests()[1].method, "POST");
}

#[tokio::test]
async fn the_raw_request_refuses_hosts_that_would_receive_the_session() {
    let server = MockServer::start(|_| {
        Response::ok(json!({ "pong": true })).with_header("set-cookie", "ct0=SECRET; Path=/")
    })
    .await;
    let client = client_for(&server);
    let refused = run(ctx(&client), "request", &json!({ "url": "https://evil.example.com/steal" }))
        .await
        .unwrap_err();
    assert!(refused.to_string().contains("not sent to"), "{refused}");
    let insecure = run(ctx(&client), "request", &json!({ "url": "http://x.com/i/api/1.1/x.json" }))
        .await
        .unwrap_err();
    assert!(matches!(insecure, XError::Invalid(_)));
    assert_eq!(server.count(), 0, "nothing was sent");

    let ok = run(
        ctx(&client),
        "request",
        &json!({
            "method": "GET",
            "path": "1.1/account/verify_credentials.json",
            "query": { "skip_status": true },
            "headers": { "x-extra": "1", "cookie": "evil=1", "x-csrf-token": "evil" }
        }),
    )
    .await
    .unwrap();
    assert_eq!(ok["status"], 200);
    assert_eq!(ok["json"]["pong"], true);
    assert!(ok["headers"].get("set-cookie").is_none(), "cookies are not echoed back");
    let seen = &server.requests()[0];
    assert_eq!(seen.header("x-extra"), Some("1"));
    assert_eq!(
        seen.header("x-csrf-token"),
        Some("CT0_PLACEHOLDER"),
        "credentials cannot be replaced"
    );
    assert!(!seen.header("cookie").unwrap().contains("evil"));
    assert_eq!(seen.query("skip_status").as_deref(), Some("true"));
}

#[tokio::test]
async fn media_upload_runs_init_append_finalize_and_alt_text() {
    let path = temp_path("pixel.png");
    std::fs::write(&path, [0x89, b'P', b'N', b'G', 1, 2, 3, 4]).unwrap();
    let server = MockServer::start(|request| {
        if request.last_segment() == "metadata" || request.path().ends_with("metadata/create.json")
        {
            return Response::json(200, Value::Null);
        }
        match request.form().iter().find(|(k, _)| k == "command").map(|(_, v)| v.as_str()) {
            Some("INIT") => Response::ok(json!({ "media_id_string": "mid-1" })),
            Some("FINALIZE") => Response::ok(json!({ "media_id_string": "mid-1" })),
            // APPEND is multipart: its fields are not form-encoded, so it lands here.
            _ => Response::ok(json!({})),
        }
    })
    .await;
    let client = client_for(&server);
    let uploaded = run(
        ctx(&client),
        "upload_media",
        &json!({ "path": path.display().to_string(), "alt": "a pixel" }),
    )
    .await
    .unwrap();
    assert_eq!(uploaded, json!({ "media_id": "mid-1" }));
    let requests = server.requests();
    assert!(requests.len() >= 4, "INIT, APPEND, FINALIZE, metadata: {}", requests.len());
    assert!(requests.last().unwrap().path().ends_with("1.1/media/metadata/create.json"));
    assert_eq!(requests.last().unwrap().json()["alt_text"]["text"], "a pixel");
    let _ = std::fs::remove_file(path);
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

#[tokio::test]
async fn success_envelope_carries_data_attempts_and_the_rate_limit_of_the_call() {
    let server =
        MockServer::start(|_| Response::ok(user_response()).with_rate_limit(50, 49, 4_000_000_000))
            .await;
    let client = client_for(&server);
    let envelope = execute(
        Some(&client),
        Some("u1"),
        "user_by_screen_name",
        &json!({ "handle": "a" }),
        &fast(),
    )
    .await;
    assert_eq!(envelope["ok"], true);
    assert_eq!(envelope["op"], "user_by_screen_name");
    assert_eq!(envelope["id"], "u1");
    assert_eq!(envelope["attempts"], 1);
    assert_eq!(envelope["data"]["id"], "7");
    assert_eq!(
        envelope["rate_limit"],
        json!({ "limit": 50, "remaining": 49, "reset_epoch": 4_000_000_000_i64 })
    );
    assert!(envelope["elapsed_ms"].as_u64().is_some());
}

#[tokio::test]
async fn transient_failures_of_idempotent_operations_are_retried() {
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    let server = MockServer::start(move |_| {
        if seen.fetch_add(1, Ordering::SeqCst) < 2 {
            Response::json(503, Value::Null)
        } else {
            Response::ok(user_response())
        }
    })
    .await;
    let client = client_for(&server);
    let envelope =
        execute(Some(&client), None, "user_by_screen_name", &json!({ "handle": "a" }), &fast())
            .await;
    assert_eq!(envelope["ok"], true);
    assert_eq!(envelope["attempts"], 3);
    assert_eq!(server.count(), 3);
}

#[tokio::test]
async fn retries_stop_at_the_budget_and_report_the_last_error() {
    let server = MockServer::start(|_| Response::json(503, Value::Null)).await;
    let client = client_for(&server);
    let envelope =
        execute(Some(&client), None, "user_by_screen_name", &json!({ "handle": "a" }), &fast())
            .await;
    assert_eq!(envelope["ok"], false);
    assert_eq!(envelope["attempts"], 4, "the first try and three retries");
    assert_eq!(envelope["error"]["kind"], "transient");
    assert_eq!(envelope["error"]["status"], 503);
}

#[tokio::test]
async fn a_post_is_not_sent_twice_after_an_ambiguous_failure() {
    let server = MockServer::start(|_| Response::json(503, Value::Null)).await;
    let client = client_for(&server);
    let once =
        execute(Some(&client), None, "create_tweet", &json!({ "text": "hi" }), &fast()).await;
    assert_eq!(once["ok"], false);
    assert_eq!(once["attempts"], 1);
    assert_eq!(server.count(), 1, "create_tweet is not idempotent: no automatic resend");

    let mut opt_in = fast();
    opt_in.retry.retry_non_idempotent = true;
    let again =
        execute(Some(&client), None, "create_tweet", &json!({ "text": "hi" }), &opt_in).await;
    assert_eq!(again["attempts"], 4);
}

#[tokio::test]
async fn auth_and_terminal_failures_end_the_call_immediately() {
    let server = MockServer::start(|request| match request.last_segment() {
        "UserByScreenName" => Response::x_error(401, 32, "Could not authenticate you"),
        _ => Response::x_error(403, 139, "You have already favorited this status."),
    })
    .await;
    let client = client_for(&server);
    let auth =
        execute(Some(&client), None, "user_by_screen_name", &json!({ "handle": "a" }), &fast())
            .await;
    assert_eq!(
        (auth["error"]["kind"].clone(), auth["attempts"].clone()),
        (json!("auth"), json!(1))
    );
    assert_eq!(auth["error"]["code"], 32);
    let terminal = execute(Some(&client), None, "like", &json!({ "id": "5" }), &fast()).await;
    assert_eq!(terminal["error"]["kind"], "terminal");
    assert_eq!(terminal["attempts"], 1);
    assert!(envelope_is_final(&terminal));
    assert!(!envelope_is_final(&auth));
    assert_eq!(envelope_kind(&auth), Some(ErrorKind::Auth));
    assert_eq!(server.count(), 2);
}

#[tokio::test]
async fn a_throttled_read_waits_for_the_window_and_retries() {
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    let server = MockServer::start(move |_| {
        if seen.fetch_add(1, Ordering::SeqCst) == 0 {
            Response::x_error(429, 88, "Rate limit exceeded").with_rate_limit(
                10,
                0,
                crate::client::now_epoch(),
            )
        } else {
            Response::ok(user_response())
        }
    })
    .await;
    let client = client_for(&server);
    let envelope =
        execute(Some(&client), None, "user_by_screen_name", &json!({ "handle": "a" }), &fast())
            .await;
    assert_eq!(envelope["ok"], true, "{envelope}");
    assert_eq!(envelope["attempts"], 2);
    assert_eq!(server.count(), 2);
}

#[tokio::test]
async fn a_throttled_mutation_reports_the_throttle_unless_the_policy_waits() {
    let server = MockServer::start(|_| {
        Response::x_error(429, 88, "Rate limit exceeded").with_rate_limit(
            10,
            0,
            crate::client::now_epoch(),
        )
    })
    .await;
    let client = client_for(&server);
    let reported =
        execute(Some(&client), None, "unfollow", &json!({ "user_id": "1" }), &fast()).await;
    assert_eq!(reported["error"]["kind"], "rate_limit");
    assert_eq!(reported["attempts"], 1, "a caller with its own governor keeps control");
    assert_eq!(reported["rate_limit"]["remaining"], 0);

    let mut patient = fast();
    patient.retry.wait_rate_limit_mutations = Some(true);
    patient.retry.max_rate_limit_waits = 2;
    let waited =
        execute(Some(&client), None, "unfollow", &json!({ "user_id": "1" }), &patient).await;
    assert_eq!(waited["error"]["kind"], "rate_limit");
    assert_eq!(waited["attempts"], 3, "two waits then give up");
}

#[tokio::test]
async fn a_window_longer_than_the_cap_is_reported_not_slept() {
    let reset = crate::client::now_epoch() + 3_600;
    let server = MockServer::start(move |_| {
        Response::x_error(429, 88, "Rate limit exceeded").with_rate_limit(10, 0, reset)
    })
    .await;
    let client = client_for(&server);
    let started = std::time::Instant::now();
    let envelope =
        execute(Some(&client), None, "user_by_screen_name", &json!({ "handle": "a" }), &fast())
            .await;
    assert_eq!(envelope["error"]["kind"], "rate_limit");
    assert_eq!(envelope["error"]["reset_epoch"], reset);
    assert!(started.elapsed() < Duration::from_secs(5), "no hour-long sleep");
    // The endpoint is known to be exhausted: the second call does not even reach the server.
    let before = server.count();
    let second =
        execute(Some(&client), None, "user_by_screen_name", &json!({ "handle": "a" }), &fast())
            .await;
    assert_eq!(second["error"]["kind"], "rate_limit");
    assert_eq!(server.count(), before, "the proactive check answered without a request");
}

#[tokio::test]
async fn a_slow_server_hits_the_attempt_timeout() {
    let server =
        MockServer::start(|_| Response::ok(user_response()).after(Duration::from_millis(400)))
            .await;
    let client = client_for(&server);
    let mut options = fast();
    options.timeout = Duration::from_millis(60);
    options.retry.max_retries = 0;
    let envelope =
        execute(Some(&client), None, "user_by_screen_name", &json!({ "handle": "a" }), &options)
            .await;
    assert_eq!(envelope["ok"], false);
    assert_eq!(envelope["error"]["kind"], "transient");
    assert!(envelope["error"]["message"].as_str().unwrap().contains("timed out"));
}

#[tokio::test]
async fn bad_requests_never_reach_the_network() {
    let server = MockServer::start(|_| Response::ok(user_response())).await;
    let client = client_for(&server);
    let unknown = execute(Some(&client), Some("x"), "no_such_op", &json!({}), &fast()).await;
    assert_eq!(unknown["error"]["kind"], "invalid");
    assert_eq!(unknown["attempts"], 0);
    let missing = execute(Some(&client), None, "like", &json!({}), &fast()).await;
    assert_eq!(missing["error"]["kind"], "invalid");
    let sessionless = execute(None, None, "whoami", &json!({}), &fast()).await;
    assert!(sessionless["error"]["message"].as_str().unwrap().contains("needs an open client"));
    assert_eq!(server.count(), 0);
}

#[tokio::test]
async fn the_pacer_spaces_mutations_but_not_reads() {
    let server = MockServer::start(|_| Response::ok(json!({ "data": {} }))).await;
    let client = client_for(&server);
    let mut options = fast();
    options.pacing = Some(Arc::new(Pacer::new(crate::policy::PacingOptions {
        per_window: 100,
        per_day: 100,
        min_delay_ms: 120,
        max_delay_ms: 120,
        reserve: 0,
    })));
    let started = std::time::Instant::now();
    for _ in 0..3 {
        execute(Some(&client), None, "like", &json!({ "id": "1" }), &options).await;
    }
    assert!(
        started.elapsed() >= Duration::from_millis(220),
        "two gaps of 120 ms: {:?}",
        started.elapsed()
    );
    let pacer = options.pacing.clone().unwrap();
    assert_eq!(pacer.reserved(), 3);

    for _ in 0..3 {
        execute(Some(&client), None, "home_timeline", &json!({}), &options).await;
    }
    assert_eq!(pacer.reserved(), 3, "reads do not consume pacing slots");
}

#[tokio::test]
async fn the_graphql_operation_reaches_any_catalog_entry() {
    let server = MockServer::start(|_| Response::ok(json!({ "data": { "ok": true } }))).await;
    let client = client_for(&server);
    let raw = run(
        ctx(&client),
        "graphql",
        &json!({ "operation": "Viewer", "variables": { "withCommunitiesMemberships": false } }),
    )
    .await
    .unwrap();
    assert_eq!(raw["data"]["ok"], true);
    assert_eq!(server.requests()[0].last_segment(), "Viewer");
    let unknown =
        run(ctx(&client), "graphql", &json!({ "operation": "NotInTheCatalog" })).await.unwrap_err();
    assert!(matches!(unknown, XError::UnknownOperation(_)));
}

#[tokio::test]
async fn rate_limit_and_session_info_describe_the_client() {
    let server = MockServer::start(|_| {
        Response::ok(user_response()).with_rate_limit(900, 899, 4_000_000_000)
    })
    .await;
    let client = client_for(&server);
    assert_eq!(run_local(ctx(&client), "rate_limit", &json!({})).unwrap(), Value::Null);
    run(ctx(&client), "user_by_screen_name", &json!({ "handle": "a" })).await.unwrap();
    let last = run_local(ctx(&client), "rate_limit", &json!({})).unwrap();
    assert_eq!(last["remaining"], 899);
    let own =
        run_local(ctx(&client), "rate_limit", &json!({ "operation": "UserByScreenName" })).unwrap();
    assert_eq!(own["limit"], 900);
    let info = run_local(ctx(&client), "session_info", &json!({})).unwrap();
    assert!(info.to_string().find("AUTH_TOKEN_PLACEHOLDER").is_none(), "no secret in session_info");
    assert_eq!(info["api_base"], server.api_base());
}

#[tokio::test]
async fn a_pinned_transaction_id_is_sent_instead_of_a_random_one() {
    let server = MockServer::start(|_| Response::ok(user_response())).await;
    let mut pinned = session();
    pinned.transaction_id = Some("pinned-txn".into());
    let client = XClient::with_options(
        pinned,
        XClientOptions {
            api_base: Some(server.api_base()),
            discovery_pages: Some(Vec::new()),
            query_ids_path: Some(temp_path("pinned.json")),
            persist_session: Some(false),
            ..XClientOptions::default()
        },
    )
    .unwrap();
    run(ctx(&client), "user_by_screen_name", &json!({ "handle": "a" })).await.unwrap();
    assert_eq!(server.requests()[0].header("x-client-transaction-id"), Some("pinned-txn"));
}

#[test]
fn bundle_operations_are_extracted_by_the_shared_patterns() {
    let js = r#"e.exports={queryId:"AbC-123",operationName:"Viewer",operationType:"query"};
        t={operationName:"FavoriteTweet",queryId:"Zz_9",operationType:"mutation"}"#;
    let found = run_local(OpContext::default(), "bundle_extract", &json!({ "js": js })).unwrap();
    assert_eq!(found["Viewer"], "AbC-123");
    assert_eq!(found["FavoriteTweet"], "Zz_9");
    assert_eq!(found.as_object().unwrap().len(), 2);
}
