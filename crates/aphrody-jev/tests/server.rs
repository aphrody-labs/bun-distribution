// SPDX-License-Identifier: Apache-2.0
//! The Jev-compatible server: auth envelope, validation and routing.
#![cfg(feature = "server")]
// Exercise the optional server's portable std HashSet authentication API.
#![allow(clippy::disallowed_types)]

use std::{
    collections::HashSet,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use aphrody_jev::{
    Endpoint, JevRouter, RoutingPolicy,
    server::{ServerState, app},
};
use axum::{Json, Router, routing::post};
use serde_json::{Value, json};

async fn upstream(Json(_): Json<Value>) -> Json<Value> {
    Json(json!({
        "model": "jev-1.13.0",
        "answers": { "urgent": { "type": "noul", "noul": 0.9 } },
        "usage": { "input_tokens": 10, "output_tokens": 1 }
    }))
}

async fn spawn(app: Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    base
}

async fn server() -> String {
    let upstream = spawn(Router::new().route("/v1/systemone", post(upstream))).await;
    let router = JevRouter::new(
        None,
        None,
        Some(Endpoint::local(&upstream, None).unwrap()),
        RoutingPolicy::default(),
    )
    .unwrap();
    let keys = HashSet::from(["devkey".to_owned()]);
    spawn(app(ServerState::new(Arc::new(router), keys, "jev-latest"))).await
}

#[tokio::test]
async fn missing_key_gets_jev_authentication_error() {
    let base = server().await;
    let reply = reqwest::Client::new()
        .post(format!("{base}/v1/systemone"))
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(reply.status(), 401);
    let body: Value = reply.json().await.unwrap();
    assert_eq!(body["detail"]["error_type"], "authentication_error");
    assert_eq!(
        body["detail"]["message"],
        "Must supply an API key! Check your request and try again."
    );
}

#[tokio::test]
async fn valid_request_is_served_and_invalid_one_is_422() {
    let base = server().await;
    let client = reqwest::Client::new();
    let ok: Value = client
        .post(format!("{base}/v1/systemone"))
        .bearer_auth("devkey")
        .json(&json!({ "state": "x", "model": "jev-latest",
                       "questions": { "urgent": { "type": "noul", "instructions": "Urgent?" } } }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(ok["answers"]["urgent"]["noul"], 0.9);

    let bad = client
        .post(format!("{base}/v1/systemone"))
        .bearer_auth("devkey")
        .json(&json!({ "state": "x", "model": "jev-latest", "questions": {} }))
        .send()
        .await
        .unwrap();
    assert_eq!(bad.status(), 422);
    let body: Value = bad.json().await.unwrap();
    assert_eq!(body["detail"]["error_type"], "invalid_request_error");
}

#[tokio::test]
async fn confidence_policy_preserves_auth_and_rejects_invalid_thresholds_before_inference() {
    let hits = Arc::new(AtomicUsize::new(0));
    let count = hits.clone();
    let upstream = spawn(Router::new().route("/v1/systemone", post(move || {
        let count = count.clone();
        async move {
            count.fetch_add(1, Ordering::SeqCst);
            Json(json!({"model":"fixture","usage":null,"answers":{"tool":{"type":"choice","choice":"read","confidence":0.7,"probabilities":{"read":0.7,"search":0.3}}}}))
        }
    }))).await;
    let router = JevRouter::new(
        None,
        None,
        Some(Endpoint::local(&upstream, None).unwrap()),
        RoutingPolicy::default(),
    )
    .unwrap();
    let base = spawn(app(ServerState::new(
        Arc::new(router),
        HashSet::from(["devkey".to_owned()]),
        "fixture",
    )))
    .await;
    let client = reqwest::Client::new();
    let request = json!({"state":"synthetic fixture","model":"fixture","questions":{"tool":{"type":"choice","instructions":"Select a tool","criteria":{"read":"Read","search":"Search"}}}});
    let denied = client
        .post(format!("{base}/v1/systemone?minimum_confidence=NaN"))
        .json(&request)
        .send()
        .await
        .unwrap();
    assert_eq!(denied.status(), 401);
    for (threshold, selected) in [("0.8", Value::Null), ("0.6", json!("read"))] {
        let response = client
            .post(format!(
                "{base}/v1/systemone?minimum_confidence={threshold}"
            ))
            .bearer_auth("devkey")
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        let output: Value = response.json().await.unwrap();
        assert!(output.get("selections").is_some());
        assert_eq!(output["selections"]["tool"], selected);
        assert_eq!(output["answers"]["tool"]["confidence"], 0.7);
    }
    for query in ["NaN", "invalid", "-1", "1.1", "0.8&minimum_confidence=0.6"] {
        let response = client
            .post(format!("{base}/v1/systemone?minimum_confidence={query}"))
            .bearer_auth("devkey")
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 422);
        let output: Value = response.json().await.unwrap();
        assert_eq!(output["detail"]["error_type"], "invalid_request_error");
    }
    assert_eq!(hits.load(Ordering::SeqCst), 2);
}
