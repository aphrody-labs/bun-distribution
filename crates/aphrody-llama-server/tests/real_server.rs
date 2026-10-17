// SPDX-License-Identifier: Apache-2.0
//! End to end against a real `llama-server` and a real GGUF model.
//!
//! Ignored by default (it needs the runtime, a model and ideally a GPU). Run:
//!
//! ```text
//! APHRODY_LLAMA_BIN=/path/to/llama-server \
//! APHRODY_LLAMA_TEST_MODEL=/path/to/model.gguf \
//! cargo test -p aphrody-llama-server --test real_server -- --ignored --nocapture
//! ```
#![cfg(feature = "test-support")]

use std::{path::PathBuf, time::Duration};

use aphrody_llama_server::{
    Budget, DaemonCommand, EnsureOptions, ModelFacts, PlanRequest, Role, ServerCapabilities,
    StateDirs, Supervisor, plan,
};
use aphrody_model_client::{
    ChatMessage, ChatTurn, ModelClient, ModelStreamEvent, OpenAiCompatClient, OpenAiWire, Part,
    ProviderRuntime, TurnOptions,
};
use futures::StreamExt as _;

const DAEMON: &str = env!("CARGO_BIN_EXE_aphrody-llama-daemon");

fn env_path(name: &str) -> PathBuf {
    PathBuf::from(std::env::var(name).unwrap_or_else(|_| panic!("set {name}")))
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a real llama-server binary and GGUF model (see module docs)"]
async fn real_server_plans_launches_answers_and_stops() {
    let binary = env_path("APHRODY_LLAMA_BIN");
    let model = env_path("APHRODY_LLAMA_TEST_MODEL");

    let facts = ModelFacts::read(&model).expect("gguf facts");
    let caps = ServerCapabilities::probe(&binary).expect("server capabilities");
    let budget = Budget::from_profile(&aphrody_models::accel::probe());
    let plan = plan(
        &facts,
        &caps,
        budget,
        &PlanRequest::new(Role::Chat, "smoke-model"),
    );
    eprintln!(
        "facts: {} {} blocks, trained ctx {}",
        facts.architecture, facts.block_count, facts.context_length
    );
    eprintln!("build: {:?}", caps.version);
    eprintln!(
        "plan: {:?} ctx {} kv {:?}",
        plan.spec.placement, plan.spec.ctx, plan.spec.kv
    );
    for note in &plan.notes {
        eprintln!("  - {note}");
    }

    let root = tempfile::tempdir().expect("tempdir");
    let supervisor = Supervisor::new(
        StateDirs::new(root.path()),
        DaemonCommand {
            program: PathBuf::from(DAEMON),
            args: Vec::new(),
        },
    );
    let options = EnsureOptions {
        ready_timeout: Duration::from_secs(300),
        ..EnsureOptions::default()
    };
    let endpoint = match supervisor.ensure(&binary, &plan, options).await {
        Ok(endpoint) => endpoint,
        Err(error) => panic!("launch failed: {error}"),
    };
    eprintln!(
        "ready at {} (pid {})",
        endpoint.base_url(),
        endpoint.state.server_pid
    );

    let tokens = endpoint
        .client()
        .count_tokens("The quick brown fox")
        .await
        .expect("tokenize");
    assert!(tokens > 0, "tokenize returned no tokens");

    let client = OpenAiCompatClient::from_provider(
        ProviderRuntime::keyless(endpoint.base_url()),
        OpenAiWire::Chat,
        "smoke-model",
    );
    let turn = ChatTurn {
        messages: vec![ChatMessage {
            role: aphrody_model_client::Role::User,
            parts: vec![Part::Text("Reply with the single word: ready".to_string())],
        }],
        options: TurnOptions {
            max_output_tokens: Some(16),
            temperature: Some(0.0),
            ..TurnOptions::default()
        },
        ..ChatTurn::default()
    };
    let mut text = String::new();
    let mut completed = false;
    let mut stream = client.stream(turn).await.expect("stream");
    while let Some(event) = stream.next().await {
        match event.expect("event") {
            ModelStreamEvent::TextDelta(delta) => text.push_str(&delta),
            ModelStreamEvent::Completed { .. } => completed = true,
            _ => {}
        }
    }
    eprintln!("model said: {text:?}");
    assert!(completed, "the stream did not complete");
    assert!(!text.trim().is_empty(), "the model produced no text");

    let attached = supervisor
        .ensure(&binary, &plan, options)
        .await
        .expect("attach");
    assert!(
        attached.attached,
        "a second ensure must reuse the running server"
    );

    assert!(supervisor.stop(Role::Chat).await.expect("stop"));
    assert!(supervisor.status(Role::Chat).is_none());
}
