// SPDX-License-Identifier: Apache-2.0
//! End to end through the in-process engine with a real GGUF model.
//!
//! Ignored by default (it needs the libllama runtime and a model). Run:
//!
//! ```text
//! APHRODY_LLAMA_TEST_MODEL=/path/to/model.gguf \
//! cargo test -p aphrody-llama-server --features in-process --test in_process_real -- --ignored --nocapture
//! ```
#![cfg(feature = "in-process")]

use aphrody_llama_server::{InProcessLlama, InProcessServer, in_process::LoadOptions};
use aphrody_model_client::{
    ChatMessage, ChatTurn, ModelClient, ModelStreamEvent, Part, Role, TurnOptions,
};
use futures::StreamExt as _;

fn turn() -> ChatTurn {
    ChatTurn {
        messages: vec![ChatMessage {
            role: Role::User,
            parts: vec![Part::Text("Reply with the single word: ready".to_string())],
        }],
        options: TurnOptions { max_output_tokens: Some(16), ..TurnOptions::default() },
        ..ChatTurn::default()
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs the libllama runtime and a GGUF model (see module docs)"]
async fn in_process_model_streams_text_and_serves_openai() {
    let model = std::env::var("APHRODY_LLAMA_TEST_MODEL").expect("set APHRODY_LLAMA_TEST_MODEL");
    let engine = InProcessLlama::load(
        &model,
        "smoke",
        LoadOptions { ctx: Some(2048), ..LoadOptions::default() },
    )
    .await
    .expect("load model in process");

    let mut stream = engine.stream(turn()).await.expect("stream");
    let (mut text, mut completed) = (String::new(), false);
    while let Some(event) = stream.next().await {
        match event.expect("stream event") {
            ModelStreamEvent::TextDelta(delta) => text.push_str(&delta),
            ModelStreamEvent::Completed { .. } => completed = true,
            _ => {},
        }
    }
    eprintln!("in-process reply: {text:?}");
    assert!(completed, "stream must complete");
    assert!(!text.trim().is_empty(), "model produced no text");

    let server = InProcessServer::start(engine).await.expect("loopback server");
    let health = reqwest::get(format!("{}/health", server.base_url().trim_end_matches("/v1")))
        .await
        .expect("health request");
    assert!(health.status().is_success());
}
