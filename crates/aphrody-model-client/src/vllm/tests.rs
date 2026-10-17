// SPDX-License-Identifier: Apache-2.0
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Router,
    extract::State,
    http::{HeaderMap, StatusCode, Uri},
    response::IntoResponse,
    routing::any,
};
use futures::StreamExt;
use serde_json::{Value, json};

use super::*;
use crate::{ChatMessage, ModelStreamEvent, Part, Role};

type Captured = (String, HeaderMap, Value);
#[derive(Default)]
struct Mock {
    requests: Mutex<Vec<Captured>>,
    replies: Mutex<Vec<(StatusCode, String)>>,
}

async fn serve(
    replies: Vec<(StatusCode, String)>,
) -> (String, Arc<Mock>, tokio::task::JoinHandle<()>) {
    let mock = Arc::new(Mock {
        replies: Mutex::new(replies),
        ..Mock::default()
    });
    let router = Router::new()
        .fallback(any(
            |State(mock): State<Arc<Mock>>, uri: Uri, headers: HeaderMap, body: String| async move {
                let value = if body.is_empty() {
                    Value::Null
                } else {
                    serde_json::from_str(&body).expect("body JSON")
                };
                mock.requests
                    .lock()
                    .expect("requests")
                    .push((uri.to_string(), headers, value));
                let (status, body) = mock.replies.lock().expect("replies").remove(0);
                (status, body)
            },
        ))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let address = listener.local_addr().expect("address");
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.expect("serve");
    });
    (format!("http://{address}"), mock, task)
}

fn ok(value: Value) -> (StatusCode, String) {
    (StatusCode::OK, value.to_string())
}
fn turn() -> ChatTurn {
    ChatTurn {
        messages: vec![ChatMessage {
            role: Role::User,
            parts: vec![Part::Text("hello".into())],
        }],
        ..ChatTurn::default()
    }
}
fn tls() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

#[tokio::test]
async fn routes_auth_queries_and_native_response_shapes() {
    tls();
    let (base, mock, task) = serve(vec![
        ok(json!({"version":"0.30.0"})), ok(json!({"data":[{"id":"served-alias"}]})),
        (StatusCode::OK, String::new()), (StatusCode::OK, "# HELP vllm metric\nvllm:num_requests_running 2\n".into()),
        ok(json!({"count":2,"max_model_len":512,"tokens":[11,12],"token_strs":["hello","!"]})),
        ok(json!({"prompt":"hello!"})),
        ok(json!({"data":[{"index":1,"score":0.9},{"index":0,"score":0.1}],"model":"m","usage":{"prompt_tokens":3}})),
        ok(json!({"data":[{"index":0,"data":[[0.1,0.2],[0.3,0.4]]}]})),
    ]).await;
    let mut runtime = ProviderRuntime::keyless(format!("{base}/proxy/v1/"));
    runtime.bearer_token = Some("test-key".into());
    runtime.headers.push(("x-tenant".into(), "tenant".into()));
    runtime.query_params.push(("tenant".into(), "a&b".into()));
    let api = VllmApi::from_provider(runtime);
    assert_eq!(api.version().await.expect("version"), "0.30.0");
    assert_eq!(api.models().await.expect("models"), vec!["served-alias"]);
    api.health().await.expect("empty health");
    assert_eq!(
        api.metrics().await.expect("metrics"),
        "# HELP vllm metric\nvllm:num_requests_running 2\n"
    );
    assert_eq!(
        api.tokenize("m", "hello!").await.expect("tokenize").tokens,
        vec![11, 12]
    );
    assert_eq!(
        api.detokenize("m", &[11, 12]).await.expect("detokenize"),
        "hello!"
    );
    let score = api
        .score(&json!({"model":"m","text_1":"q","text_2":["a","b"],"use_activation":false}))
        .await
        .expect("score");
    assert_eq!(
        score.data[0],
        ScoreResult {
            index: 0,
            score: 0.1
        }
    );
    assert_eq!(score.metadata["usage"]["prompt_tokens"], 3);
    let request = json!({"model":"m","input":["hello"],"task":"token_embed"});
    assert_eq!(
        api.pooling(&request).await.expect("pooling")["data"][0]["data"],
        json!([[0.1, 0.2], [0.3, 0.4]])
    );
    let seen = mock.requests.lock().expect("requests");
    let paths: Vec<_> = seen.iter().map(|r| r.0.as_str()).collect();
    assert_eq!(
        paths,
        vec![
            "/proxy/version?tenant=a%26b",
            "/proxy/v1/models?tenant=a%26b",
            "/proxy/health?tenant=a%26b",
            "/proxy/metrics?tenant=a%26b",
            "/proxy/tokenize?tenant=a%26b",
            "/proxy/detokenize?tenant=a%26b",
            "/proxy/score?tenant=a%26b",
            "/proxy/pooling?tenant=a%26b"
        ]
    );
    for (_, headers, _) in seen.iter() {
        assert_eq!(headers["authorization"], "Bearer test-key");
        assert_eq!(headers["x-tenant"], "tenant");
    }
    assert_eq!(seen[6].2["use_activation"], false);
    assert_eq!(seen[7].2, request);
    task.abort();
}

#[tokio::test]
async fn embeddings_and_rerank_obey_input_and_top_n_contracts() {
    tls();
    let (base,mock,task) = serve(vec![
        ok(json!({"data":[{"index":1,"embedding":[0.3,0.4]},{"index":0,"embedding":[0.1,0.2]}]})),
        ok(json!({"results":[{"index":0,"relevance_score":0.1},{"index":1,"relevance_score":0.9}]})),
        ok(json!({"results":[{"index":1,"relevance_score":0.9}]})),
    ]).await;
    let client = VllmClient::new(VllmConfig::new("alias").with_base_url(format!("{base}/v1/")));
    assert_eq!(
        client.embed(&["a", "b"]).await.expect("embed"),
        vec![vec![0.1, 0.2], vec![0.3, 0.4]]
    );
    assert_eq!(
        client.rerank("q", &["a", "b"], None).await.expect("rerank")[0].index,
        1
    );
    assert_eq!(
        client
            .rerank("q", &["a", "b"], Some(1))
            .await
            .expect("rerank")
            .len(),
        1
    );
    assert!(
        client
            .rerank("q", &["a"], Some(0))
            .await
            .expect("zero")
            .is_empty()
    );
    assert!(client.embed(&[]).await.expect("empty").is_empty());
    assert!(
        client
            .rerank("q", &[], None)
            .await
            .expect("empty")
            .is_empty()
    );
    let seen = mock.requests.lock().expect("requests");
    assert_eq!(seen.len(), 3);
    assert_eq!(seen[0].0, "/v1/embeddings");
    assert_eq!(seen[0].2["encoding_format"], "float");
    assert_eq!(seen[1].0, "/rerank");
    assert_eq!(seen[2].2["top_n"], 1);
    task.abort();
}

#[tokio::test]
async fn malformed_batches_and_tokenization_are_rejected() {
    tls();
    let (base,_,task) = serve(vec![
        ok(json!({"data":[{"index":0,"embedding":[1.0]},{"index":0,"embedding":[2.0]}]})),
        ok(json!({"data":[{"index":0,"embedding":[1.0]}]})),
        ok(json!({"data":[{"embedding":[1.0]}]})),
        ok(json!({"data":[{"index":0,"embedding":[1.0]},{"index":1,"embedding":[]}]})),
        ok(json!({"results":[{"index":2,"relevance_score":0.5}]})),
        ok(json!({"results":[{"index":0,"relevance_score":0.5},{"index":0,"relevance_score":0.4}]})),
        ok(json!({"results":[]})),
        ok(json!({"count":3,"max_model_len":512,"tokens":[1,2]})),
        ok(json!({"data":[{"index":1,"score":0.2}]})),
    ]).await;
    let client = VllmClient::new(VllmConfig::new("m").with_base_url(base));
    for _ in 0..4 {
        assert!(client.embed(&["a", "b"]).await.is_err());
    }
    assert!(client.rerank("q", &["a"], None).await.is_err());
    assert!(client.rerank("q", &["a", "b"], None).await.is_err());
    assert!(client.rerank("q", &["a"], None).await.is_err());
    assert!(client.api().tokenize("m", "a").await.is_err());
    assert!(
        client
            .api()
            .score(&json!({"text_1":"a","text_2":"b"}))
            .await
            .is_err()
    );
    assert!(client.api().detokenize("m", &[u64::MAX]).await.is_err());
    task.abort();
}

#[tokio::test]
async fn retries_errors_and_decode_failure_use_shared_policy() {
    tls();
    let (base, mock, task) = serve(vec![
        (StatusCode::SERVICE_UNAVAILABLE, "loading".into()),
        ok(json!({"version":"ready"})),
        (
            StatusCode::UNAUTHORIZED,
            json!({"error":{"message":"invalid key"}}).to_string(),
        ),
        (
            StatusCode::BAD_REQUEST,
            json!({"detail":"unsupported pooling task"}).to_string(),
        ),
        (StatusCode::OK, "not JSON".into()),
    ])
    .await;
    let mut runtime = ProviderRuntime::keyless(base);
    runtime.request_max_retries = 1;
    let api = VllmApi::from_provider(runtime);
    assert_eq!(api.version().await.expect("retry"), "ready");
    assert!(
        matches!(api.models().await,Err(ModelError::Api{status:401,message}) if message=="invalid key")
    );
    assert!(
        matches!(api.pooling(&json!({})).await,Err(ModelError::Api{status:400,message}) if message=="unsupported pooling task")
    );
    assert!(matches!(api.version().await, Err(ModelError::Decode(_))));
    assert_eq!(mock.requests.lock().expect("requests").len(), 5);
    task.abort();
}

const CHAT: &str = concat!(
    "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n",
    "data: {\"choices\":[{\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":1,\"total_tokens\":4}}\n\n",
    "data: [DONE]\n\n"
);

#[tokio::test]
async fn chat_stream_preserves_vllm_options_and_usage() {
    tls();
    let (base, mock, task) = serve(vec![(StatusCode::OK, CHAT.into())]).await;
    let mut runtime = ProviderRuntime::keyless(format!("{base}/v1"));
    runtime
        .default_options
        .extra
        .insert("top_k".into(), json!(20));
    let client = VllmClient::from_provider(runtime, "served-name");
    let mut turn = turn();
    turn.options.extra.insert("top_k".into(), json!(5));
    turn.options.extra.insert(
        "chat_template_kwargs".into(),
        json!({"enable_thinking":false}),
    );
    let events: Vec<_> = client
        .stream(turn)
        .await
        .expect("stream")
        .map(|r| r.expect("event"))
        .collect()
        .await;
    assert_eq!(events[1], ModelStreamEvent::TextDelta("hi".into()));
    assert!(
        matches!(&events[2],ModelStreamEvent::Completed{usage:Some(usage),..} if usage.total_tokens==4)
    );
    let seen = mock.requests.lock().expect("requests");
    assert_eq!(seen[0].0, "/v1/chat/completions");
    assert_eq!(seen[0].2["model"], "served-name");
    assert_eq!(seen[0].2["top_k"], 5);
    assert_eq!(seen[0].2["stream"], true);
    assert_eq!(seen[0].2["chat_template_kwargs"]["enable_thinking"], false);
    task.abort();
}

#[tokio::test]
async fn deadlines_cover_headers_native_body_and_sse_idle() {
    tls();
    let router = Router::new()
        .route(
            "/version",
            any(|| async {
                (
                    StatusCode::OK,
                    axum::body::Body::from_stream(futures::stream::pending::<
                        Result<bytes::Bytes, std::convert::Infallible>,
                    >()),
                )
            }),
        )
        .route(
            "/v1/chat/completions",
            any(|| async { std::future::pending::<String>().await }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let base = format!("http://{}", listener.local_addr().expect("addr"));
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.expect("serve");
    });
    let client = VllmClient::new(VllmConfig::new("m").with_base_url(base))
        .with_request_timeout(Duration::from_millis(30));
    assert!(
        matches!(client.api().version().await,Err(ModelError::Stream(message)) if message.contains("deadline"))
    );
    assert!(
        matches!(client.stream(turn()).await,Err(ModelError::Stream(message)) if message.contains("deadline"))
    );
    task.abort();

    let router = Router::new().route(
        "/v1/chat/completions",
        any(|| async {
            let first = futures::stream::once(async {
                Ok::<_, std::convert::Infallible>(bytes::Bytes::from_static(
                    b"data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",
                ))
            });
            (
                [("content-type", "text/event-stream")],
                axum::body::Body::from_stream(first.chain(futures::stream::pending())),
            )
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let base = format!("http://{}", listener.local_addr().expect("addr"));
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.expect("serve");
    });
    let mut runtime = ProviderRuntime::keyless(base);
    runtime.stream_idle_timeout = Duration::from_millis(30);
    let client = VllmClient::from_provider(runtime, "m");
    let events: Vec<_> = client.stream(turn()).await.expect("stream").collect().await;
    assert!(events.iter().any(
        |event| matches!(event,Err(ModelError::Stream(message)) if message.contains("idle timeout"))
    ));
    task.abort();
}

#[tokio::test]
async fn dropping_chat_stream_releases_http_body() {
    tls();
    let (dropped_tx, mut dropped_rx) = tokio::sync::mpsc::unbounded_channel();
    struct DropSignal(Option<tokio::sync::mpsc::UnboundedSender<()>>);
    impl Drop for DropSignal {
        fn drop(&mut self) {
            if let Some(tx) = self.0.take() {
                let _ = tx.send(());
            }
        }
    }
    let router = Router::new().route(
        "/v1/chat/completions",
        any(move || {
            let guard = DropSignal(Some(dropped_tx.clone()));
            async move {
                let body = futures::stream::unfold((guard, false), |(guard, sent)| async move {
                    if sent {
                        std::future::pending::<()>().await;
                    }
                    Some((
                        Ok::<_, std::convert::Infallible>(bytes::Bytes::from_static(
                            b"data: {\"choices\":[{\"delta\":{\"content\":\"one\"}}]}\n\n",
                        )),
                        (guard, true),
                    ))
                });
                (
                    [("content-type", "text/event-stream")],
                    axum::body::Body::from_stream(body),
                )
                    .into_response()
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let base = format!("http://{}", listener.local_addr().expect("addr"));
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.expect("serve");
    });
    let client = VllmClient::new(VllmConfig::new("m").with_base_url(base));
    let mut stream = client.stream(turn()).await.expect("stream");
    assert!(matches!(
        stream.next().await,
        Some(Ok(ModelStreamEvent::Created))
    ));
    assert!(matches!(
        stream.next().await,
        Some(Ok(ModelStreamEvent::TextDelta(_)))
    ));
    drop(stream);
    tokio::time::timeout(Duration::from_secs(2), dropped_rx.recv())
        .await
        .expect("body dropped promptly")
        .expect("signal");
    task.abort();
}

#[test]
fn config_debug_redacts_key() {
    let config = VllmConfig::new("m").with_api_key("secret-key");
    let debug = format!("{config:?}");
    assert!(!debug.contains("secret-key"));
    assert!(debug.contains("redacted"));
}

#[tokio::test]
async fn advanced_inputs_and_binary_pooling_keep_wire_data() {
    tls();
    let (base, mock, task) = serve(vec![
        ok(json!({"data":[{"index":0,"embedding":"AACAPw=="}],"usage":{"prompt_tokens":1}})),
        ok(json!({"results":[{"index":0,"relevance_score":1.0}]})),
        ok(json!({"count":1,"max_model_len":512,"tokens":[1]})),
        ok(json!({"data":[]})),
    ])
    .await;
    let api = VllmApi::new(base, None);
    let embed = json!({"model":"m","input":[[1,2]],"encoding_format":"base64","dimensions":1});
    assert_eq!(
        api.embeddings(&embed).await.expect("advanced embed")["data"][0]["embedding"],
        "AACAPw=="
    );
    let rerank =
        json!({"model":"m","query":"q","documents":["a"],"top_n":0,"max_tokens_per_doc":32});
    api.rerank_request(&rerank).await.expect("advanced rerank");
    let tokens = json!({"model":"m","messages":[{"role":"user","content":"hi"}],"add_special_tokens":false,"chat_template_kwargs":{"enable_thinking":false}});
    api.tokenize_request(&tokens).await.expect("chat tokenize");
    assert!(
        api.score(&json!({"queries":"q","documents":["a"]}))
            .await
            .is_err()
    );
    {
        let seen = mock.requests.lock().expect("requests");
        assert_eq!(seen[0].2, embed);
        assert_eq!(seen[1].2, rerank);
        assert_eq!(seen[2].2, tokens);
    }
    task.abort();

    let router = Router::new().route(
        "/pooling",
        any(|| async {
            (
                [
                    ("content-type", "application/octet-stream"),
                    ("metadata", r#"{"id":"pool-test","model":"m","created":1,"data":[{"index":0,"embed_dtype":"float32","endianness":"little","start":0,"end":4,"shape":[1]}],"usage":{"prompt_tokens":1,"total_tokens":1}}"#),
                ],
                bytes::Bytes::from_static(&[0, 0, 128, 63]),
            )
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let base = format!("http://{}", listener.local_addr().expect("addr"));
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.expect("serve");
    });
    let api = VllmApi::new(base, None);
    let output = api.pooling_bytes(&json!({"model":"m","input":"hi","encoding_format":"bytes","embed_dtype":"float32","endianness":"little"})).await.expect("binary");
    assert_eq!(output.headers["content-type"], "application/octet-stream");
    let metadata: Value = serde_json::from_str(
        output.headers["metadata"]
            .to_str()
            .expect("metadata header"),
    )
    .expect("metadata JSON");
    assert_eq!(metadata["data"][0]["embed_dtype"], "float32");
    assert_eq!(metadata["data"][0]["end"], 4);
    assert_eq!(output.data.as_ref(), &[0, 0, 128, 63]);
    task.abort();
}
