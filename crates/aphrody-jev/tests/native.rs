// SPDX-License-Identifier: Apache-2.0
//! Native engine and mode routing against a local OpenAI-compatible server
//! that returns deterministic log probabilities.
// Portable HTTP fixtures use std text helpers; they do not link Bun's native string wrappers.
#![allow(clippy::disallowed_methods)]

use aphrody_jev::{
    Answer, Backend, Endpoint, JevError, JevMode, JevRouter, NativeEngine, Question, Request,
    RoutingPolicy,
};
use axum::{Json, Router, routing::post};
use serde_json::{Value, json};

/// Picks the letter whose option text appears in the state, else `A`.
async fn completions(Json(body): Json<Value>) -> Json<Value> {
    let prompt = body["messages"][1]["content"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    assert_eq!(body["max_tokens"], 1);
    assert_eq!(body["logprobs"], true);
    let state = prompt
        .split("\n\nQuestion:")
        .next()
        .unwrap_or_default()
        .to_lowercase();
    let options: Vec<(char, String)> = prompt
        .lines()
        .filter_map(|l| {
            let (label, text) = l.split_once(") ")?;
            let mut chars = label.chars();
            let letter = chars.next()?;
            (chars.next().is_none() && letter.is_ascii_uppercase())
                .then(|| (letter, text.to_lowercase()))
        })
        .collect();
    let pick = options
        .iter()
        .find(|(_, text)| {
            text.split([':', ' '])
                .next()
                .is_some_and(|word| state.contains(word))
        })
        .map_or('A', |(letter, _)| *letter);
    let top: Vec<Value> = options
        .iter()
        .map(|(letter, _)| {
            let p: f64 = if *letter == pick {
                0.9
            } else {
                0.1 / (options.len() - 1) as f64
            };
            json!({ "token": letter.to_string(), "logprob": p.ln() })
        })
        .chain(std::iter::once(
            json!({ "token": "Yes", "logprob": (0.01_f64).ln() }),
        ))
        .collect();
    Json(json!({
        "choices": [{ "message": { "content": pick.to_string() },
                      "logprobs": { "content": [{ "token": pick.to_string(), "top_logprobs": top }] } }],
        "usage": { "prompt_tokens": 50, "completion_tokens": 1 }
    }))
}

async fn engine() -> NativeEngine {
    mock_engine(Router::new().route("/v1/chat/completions", post(completions))).await
}

async fn mock_engine(app: Router) -> NativeEngine {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/v1", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    NativeEngine::new(&base, "test-model", None).unwrap()
}

fn request() -> Request {
    Request::new("technical outage: the app crashes")
        .question("urgent", Question::noul("Is it urgent?"))
        .question(
            "team",
            Question::choice(
                "Which team?",
                [("billing", "Payments"), ("technical", "Bugs")],
            ),
        )
        .question(
            "level",
            Question::score("How bad?", ["Minor", "Major", "Critical"]),
        )
}

#[tokio::test]
async fn aphrody_mode_answers_with_jev_primitives() {
    let router = JevRouter::aphrody(engine().await, RoutingPolicy::default()).unwrap();
    let decision = router.decide(&request()).await.unwrap();
    assert_eq!(decision.served_by, Backend::Native);
    assert_eq!(decision.response.model, "aphrody-jev/test-model");
    let answers = &decision.response.answers;
    assert!(
        matches!(&answers["team"], Answer::Choice { choice, confidence, .. }
        if choice == "technical" && (*confidence - 0.9).abs() < 1e-9)
    );
    assert!(matches!(&answers["urgent"], Answer::Noul { noul } if (*noul - 0.9).abs() < 1e-9));
    let Answer::Score {
        score,
        probabilities,
        ..
    } = &answers["level"]
    else {
        panic!("score")
    };
    assert_eq!(probabilities.len(), 3);
    assert!((0.0..=2.0).contains(score));
    assert_eq!(decision.response.usage.unwrap().input_tokens, 150);
}

#[tokio::test]
async fn remote_outage_falls_back_to_the_native_engine() {
    let closed = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        format!("http://{}", listener.local_addr().unwrap())
    };
    let router = JevRouter::new(
        Some(Endpoint::saas(&closed, "key").unwrap()),
        None,
        None,
        RoutingPolicy::default(),
    )
    .unwrap()
    .with_native(engine().await);
    let decision = router.decide(&request()).await.unwrap();
    assert_eq!(decision.served_by, Backend::Native);
    let failover = decision.failover.unwrap();
    assert_eq!(
        (failover.from, failover.to),
        (Backend::Saas, Backend::Native)
    );
}

#[tokio::test]
async fn unreachable_engine_is_unavailable() {
    let engine = NativeEngine::new("http://127.0.0.1:9/v1", "m", None).unwrap();
    let router = JevRouter::aphrody(engine, RoutingPolicy::default()).unwrap();
    assert!(matches!(
        router.decide(&request()).await,
        Err(JevError::Unavailable(_))
    ));
}

#[test]
fn modes_parse_from_names_and_aliases() {
    assert_eq!("aphrody".parse::<JevMode>().unwrap(), JevMode::Aphrody);
    assert_eq!("KEYLESS".parse::<JevMode>().unwrap(), JevMode::Keyless);
    assert_eq!("api-key".parse::<JevMode>().unwrap(), JevMode::ApiKey);
    assert_eq!("saas".parse::<JevMode>().unwrap(), JevMode::ApiKey);
    assert!("jev".parse::<JevMode>().is_err());
    assert_eq!(JevMode::ApiKey.to_string(), "api-key");
}

#[tokio::test]
async fn native_entrypoint_rejects_invalid_requests_before_transport() {
    let engine = NativeEngine::new("http://127.0.0.1:9/v1", "m", None).unwrap();
    let invalid = Request::new(Value::Null);
    assert!(matches!(
        engine
            .decide(&invalid, std::time::Duration::from_millis(100))
            .await,
        Err(JevError::InvalidRequest(_))
    ));
}

#[tokio::test]
async fn native_transport_retains_structured_legends_and_unknown_usage() {
    async fn unknown_usage(body: Json<Value>) -> Json<Value> {
        let Json(mut reply) = completions(body).await;
        reply.as_object_mut().unwrap().remove("usage");
        Json(reply)
    }
    let engine =
        mock_engine(Router::new().route("/v1/chat/completions", post(unknown_usage))).await;
    let criteria = [json!({"level":"low"}), Value::Null];
    let request = Request::new(json!({"ticket":null}))
        .question("accepted", Question::noul(Value::Null))
        .question(
            "level",
            Question::score(json!({"policy":["ordered"]}), criteria.clone()),
        );
    let response = engine
        .decide(&request, std::time::Duration::from_secs(1))
        .await
        .unwrap();
    assert!(response.usage.is_none());
    let Answer::Score {
        legend,
        probabilities,
        ..
    } = &response.answers["level"]
    else {
        panic!("score")
    };
    assert_eq!(legend["0"], criteria[0]);
    assert_eq!(legend["1"], criteria[1]);
    assert_eq!(probabilities.len(), criteria.len());
}

#[tokio::test]
async fn native_usage_overflow_returns_a_format_error() {
    async fn huge_usage(body: Json<Value>) -> Json<Value> {
        let Json(mut reply) = completions(body).await;
        reply["usage"]["prompt_tokens"] = json!(u64::MAX);
        Json(reply)
    }
    let engine = mock_engine(Router::new().route("/v1/chat/completions", post(huge_usage))).await;
    let request = Request::new(Value::Null)
        .question("first", Question::noul(Value::Null))
        .question("second", Question::noul(Value::Null));
    assert!(matches!(
        engine
            .decide(&request, std::time::Duration::from_secs(1))
            .await,
        Err(JevError::Format(_))
    ));
}
