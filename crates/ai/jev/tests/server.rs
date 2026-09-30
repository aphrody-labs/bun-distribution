// SPDX-License-Identifier: Apache-2.0
//! The Jev-compatible server: auth envelope, validation and routing.
#![cfg(feature = "server")]

use std::{collections::HashSet, sync::Arc};

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
