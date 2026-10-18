// SPDX-License-Identifier: Apache-2.0
//! Routing and failover against real local HTTP servers.
// Portable HTTP fixtures do not depend on Bun's native string wrappers.
#![allow(clippy::disallowed_methods)]

use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use aphrody_jev::{
    Answer, Backend, Endpoint, JevError, JevRouter, Question, Request, RoutingPolicy,
};
use axum::{
    Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::post,
};
use serde_json::{Value, json};

#[derive(Clone)]
struct Fake {
    status: StatusCode,
    body: Value,
    delay: Duration,
    hits: Arc<AtomicUsize>,
    expect_token: Option<&'static str>,
}

async fn handle(
    State(fake): State<Fake>,
    headers: HeaderMap,
    body: String,
) -> (StatusCode, String) {
    fake.hits.fetch_add(1, Ordering::SeqCst);
    if let Some(token) = fake.expect_token {
        let auth = headers.get("authorization").and_then(|v| v.to_str().ok());
        if auth != Some(&format!("Bearer {token}")) {
            return (StatusCode::UNAUTHORIZED, "{}".into());
        }
    }
    let request: Value = serde_json::from_str(&body).unwrap();
    assert!(request.get("questions").is_some() || request["input"].get("questions").is_some());
    tokio::time::sleep(fake.delay).await;
    (fake.status, fake.body.to_string())
}

async fn serve(path: &'static str, fake: Fake) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = Router::new().route(path, post(handle)).with_state(fake);
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

fn fake(status: StatusCode, body: Value) -> Fake {
    Fake {
        status,
        body,
        delay: Duration::ZERO,
        hits: Arc::new(AtomicUsize::new(0)),
        expect_token: None,
    }
}

fn answers(choice: &str) -> Value {
    json!({
        "model": "jev-1.13.0",
        "answers": {
            "is_urgent": { "type": "noul", "noul": 0.95 },
            "department": {
                "type": "choice", "choice": choice, "confidence": 0.8,
                "probabilities": { "billing": 0.87, "sales": 0, "technical": 0.13 }
            },
            "frustration": {
                "type": "score", "score": 1.04, "confidence": 0.94,
                "legend": { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
                "probabilities": { "0": 0, "1": 0.96, "2": 0.04 }
            }
        },
        "usage": { "input_tokens": 426, "output_tokens": 73 }
    })
}

fn request(state: impl Into<Value>) -> Request {
    Request::new(state)
        .question("is_urgent", Question::noul("Does this convey urgency?"))
        .question(
            "department",
            Question::choice(
                "Which team should handle this?",
                [
                    ("billing", "Payments, invoicing, refunds"),
                    ("technical", "Bugs, outages, integrations"),
                    ("sales", "Pricing, upgrades, new accounts"),
                ],
            ),
        )
        .question(
            "frustration",
            Question::score(
                "How frustrated is the customer?",
                ["Calm", "Frustrated", "Very angry"],
            ),
        )
}

const TICKET: &str = "Help! My payouts have been failing for 3 days.";

#[tokio::test]
async fn saas_serves_typed_answers_with_bearer_auth() {
    let mut saas = fake(StatusCode::OK, answers("billing"));
    saas.expect_token = Some("key");
    let base = serve("/v1/systemone", saas).await;
    let router = JevRouter::new(
        Some(Endpoint::saas(&base, "key").unwrap()),
        None,
        None,
        RoutingPolicy::default(),
    )
    .unwrap();

    let decision = router.decide(&request(TICKET)).await.unwrap();
    assert_eq!(decision.served_by, Backend::Saas);
    assert!(decision.failover.is_none());
    assert_eq!(decision.response.usage.unwrap().input_tokens, 426);
    assert!(matches!(
        &decision.response.answers["department"],
        Answer::Choice { choice, .. } if choice == "billing"
    ));
}

#[tokio::test]
async fn overload_529_fails_over_to_local() {
    let saas = fake(
        StatusCode::from_u16(529).unwrap(),
        json!({ "error": "overloaded" }),
    );
    let local = fake(StatusCode::OK, answers("technical"));
    let local_hits = std::sync::Arc::clone(&local.hits);
    let saas_base = serve("/v1/systemone", saas).await;
    let local_base = serve("/v1/systemone", local).await;
    let router = JevRouter::new(
        Some(Endpoint::saas(&saas_base, "key").unwrap()),
        None,
        Some(Endpoint::local(&local_base, Some("devkey".into())).unwrap()),
        RoutingPolicy::default(),
    )
    .unwrap();

    let decision = router.decide(&request(TICKET)).await.unwrap();
    assert_eq!(decision.served_by, Backend::Local);
    let failover = decision.failover.unwrap();
    assert_eq!(
        (failover.from, failover.to),
        (Backend::Saas, Backend::Local)
    );
    assert_eq!(failover.reason, "http 529");
    assert_eq!(local_hits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn network_failure_fails_over_to_local() {
    // Bind then drop a listener to get a closed port.
    let closed = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        format!("http://{}", listener.local_addr().unwrap())
    };
    let local_base = serve("/v1/systemone", fake(StatusCode::OK, answers("billing"))).await;
    let router = JevRouter::new(
        Some(Endpoint::saas(&closed, "key").unwrap()),
        None,
        Some(Endpoint::local(&local_base, None).unwrap()),
        RoutingPolicy::default(),
    )
    .unwrap();

    let decision = router.decide(&request(TICKET)).await.unwrap();
    assert_eq!(decision.served_by, Backend::Local);
    assert!(decision.failover.unwrap().reason.starts_with("transport"));
}

#[tokio::test]
async fn degraded_p99_routes_to_local_and_probes_saas() {
    let mut saas = fake(StatusCode::OK, answers("billing"));
    saas.delay = Duration::from_millis(40);
    let saas_hits = std::sync::Arc::clone(&saas.hits);
    let saas_base = serve("/v1/systemone", saas).await;
    let local_base = serve("/v1/systemone", fake(StatusCode::OK, answers("billing"))).await;
    let policy = RoutingPolicy {
        p99_budget: Duration::from_millis(10),
        min_samples: 3,
        probe_every: 5,
        ..RoutingPolicy::default()
    };
    let router = JevRouter::new(
        Some(Endpoint::saas(&saas_base, "key").unwrap()),
        None,
        Some(Endpoint::local(&local_base, None).unwrap()),
        policy,
    )
    .unwrap();

    for _ in 0..3 {
        assert_eq!(
            router.decide(&request(TICKET)).await.unwrap().served_by,
            Backend::Saas
        );
    }
    assert!(router.saas_p99().await.unwrap() > Duration::from_millis(10));

    let skipped = router.decide(&request(TICKET)).await.unwrap();
    assert_eq!(skipped.served_by, Backend::Local);
    assert!(skipped.failover.unwrap().reason.contains("over budget"));

    // Request 5 is a probe that still measures the SaaS.
    assert_eq!(
        router.decide(&request(TICKET)).await.unwrap().served_by,
        Backend::Saas
    );
    assert_eq!(saas_hits.load(Ordering::SeqCst), 4);
}

#[tokio::test]
async fn large_state_goes_to_edge_with_envelope() {
    let edge = fake(
        StatusCode::OK,
        json!({ "result": answers("billing"), "success": true, "errors": [], "messages": [] }),
    );
    let edge_base = serve("/client/v4/accounts/acct/ai/run", edge).await;
    let saas = fake(StatusCode::OK, answers("billing"));
    let saas_hits = std::sync::Arc::clone(&saas.hits);
    let saas_base = serve("/v1/systemone", saas).await;
    let router = JevRouter::new(
        Some(Endpoint::saas(&saas_base, "key").unwrap()),
        Some(Endpoint::edge(&edge_base, "acct", "cf").unwrap()),
        None,
        RoutingPolicy::default(),
    )
    .unwrap();

    let large = TICKET.repeat(1_000);
    let decision = router.decide(&request(large)).await.unwrap();
    assert_eq!(decision.served_by, Backend::Edge);
    assert_eq!(saas_hits.load(Ordering::SeqCst), 0);

    let small = router.decide(&request(TICKET)).await.unwrap();
    assert_eq!(small.served_by, Backend::Saas);
}

#[tokio::test]
async fn non_conforming_answer_is_rejected() {
    let base = serve("/v1/systemone", fake(StatusCode::OK, answers("legal"))).await;
    let router = JevRouter::new(
        Some(Endpoint::saas(&base, "key").unwrap()),
        None,
        None,
        RoutingPolicy::default(),
    )
    .unwrap();
    let err = router.decide(&request(TICKET)).await.unwrap_err();
    assert!(
        matches!(err, JevError::Format(ref m) if m == "Yolo choice answer is not one of its options"),
        "{err}"
    );
}

#[tokio::test]
async fn text_output_is_rejected() {
    let base = serve(
        "/v1/systemone",
        fake(StatusCode::OK, json!({ "text": "billing" })),
    )
    .await;
    let router = JevRouter::new(
        Some(Endpoint::saas(&base, "key").unwrap()),
        None,
        None,
        RoutingPolicy::default(),
    )
    .unwrap();
    assert!(matches!(
        router.decide(&request(TICKET)).await,
        Err(JevError::Format(_))
    ));
}

#[tokio::test]
async fn client_error_is_not_failed_over() {
    let local = fake(StatusCode::OK, answers("billing"));
    let local_hits = std::sync::Arc::clone(&local.hits);
    let saas_base = serve(
        "/v1/systemone",
        fake(StatusCode::UNPROCESSABLE_ENTITY, json!({ "error": "bad" })),
    )
    .await;
    let local_base = serve("/v1/systemone", local).await;
    let router = JevRouter::new(
        Some(Endpoint::saas(&saas_base, "key").unwrap()),
        None,
        Some(Endpoint::local(&local_base, None).unwrap()),
        RoutingPolicy::default(),
    )
    .unwrap();
    let err = router.decide(&request(TICKET)).await.unwrap_err();
    assert!(
        matches!(err, JevError::Rejected { status: 422, .. }),
        "{err}"
    );
    assert_eq!(local_hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn malformed_requests_never_leave_the_process() {
    let router = JevRouter::new(
        None,
        None,
        Some(Endpoint::local("http://127.0.0.1:9", None).unwrap()),
        RoutingPolicy::default(),
    )
    .unwrap();
    let one_option =
        Request::new(TICKET).question("d", Question::choice("Which?", [("only", "one")]));
    assert!(matches!(
        router.decide(&one_option).await,
        Err(JevError::InvalidRequest(_))
    ));
    assert!(matches!(
        router.decide(&Request::new(TICKET)).await,
        Err(JevError::InvalidRequest(_))
    ));
}
