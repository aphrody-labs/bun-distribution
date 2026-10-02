// SPDX-License-Identifier: Apache-2.0
//! End-to-end smoke tests that load real weights.
//!
//! They are `#[ignore]`d and driven by environment variables, because they download or read a
//! model and run it. A test whose variable is unset says so and passes, so a sweep with
//! `--include-ignored` stays green on a machine without weights.
//!
//! | variable | meaning |
//! |---|---|
//! | `APHRODY_ENGINE_SMOKE_MODEL` | small chat model, repo id or directory (`Qwen/Qwen3-0.6B`) |
//! | `APHRODY_ENGINE_SMOKE_TOOLS` | any value: also run the tool-call test on that model |
//! | `APHRODY_ENGINE_SMOKE_EMBED_MODEL` | embedding model (`google/embeddinggemma-300m`) |
//! | `APHRODY_ENGINE_SMOKE_ISQ` | optional ISQ for the chat model (`4`, `q4k`, ...) |
//! | `APHRODY_ENGINE_SMOKE_CPU` | any value: never use a GPU, whatever the build supports |
//!
//! The tool-call test needs a model whose chat template supports tools.
//!
//! ```text
//! APHRODY_ENGINE_SMOKE_MODEL=Qwen/Qwen3-0.6B \
//!   scripts/build/rust/cargo-serial.sh test -p aphrody-engine-mistralrs --features engine \
//!   --test smoke -- --ignored --nocapture
//! ```
//!
//! Add `--features engine,cuda` (or `metal`) to run on a GPU build.

#![cfg(feature = "engine")]

use aphrody_engine_mistralrs::{
    EmbedderConfig, EngineConfig, MistralRsClient, MistralRsEmbedder, ModelSource, RuntimeOptions,
};
use aphrody_model_client::{
    ChatMessage, ChatTurn, EmbedClient, ModelClient, ModelStreamEvent, Part, Role, ToolDecl,
};
use futures::StreamExt;
use serde_json::json;

const MODEL: &str = "APHRODY_ENGINE_SMOKE_MODEL";
const TOOLS: &str = "APHRODY_ENGINE_SMOKE_TOOLS";
const EMBED_MODEL: &str = "APHRODY_ENGINE_SMOKE_EMBED_MODEL";
const ISQ: &str = "APHRODY_ENGINE_SMOKE_ISQ";
const CPU: &str = "APHRODY_ENGINE_SMOKE_CPU";

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.trim().is_empty())
}

fn skipped(variable: &str) {
    eprintln!("smoke test skipped: set {variable} to run it (see the module documentation)");
}

fn client(model: &str) -> MistralRsClient {
    let runtime = RuntimeOptions {
        isq: env(ISQ),
        force_cpu: env(CPU).is_some(),
        max_num_seqs: Some(2),
        ..RuntimeOptions::default()
    };
    let config = EngineConfig::new(ModelSource::auto(model)).with_runtime(runtime);
    MistralRsClient::new(config).expect("the smoke configuration is valid")
}

fn greedy_turn(prompt: &str) -> ChatTurn {
    let message = ChatMessage { role: Role::User, parts: vec![Part::Text(prompt.to_owned())] };
    let mut turn = ChatTurn { messages: vec![message], ..ChatTurn::default() };
    turn.options.max_output_tokens = Some(128);
    // Top-1 sampling: the same prompt gives the same answer. No thinking phase, so a short
    // token budget is spent on the answer; a template without the switch ignores it.
    turn.options.extra.insert("top_k".to_owned(), json!(1));
    turn.options.extra.insert("enable_thinking".to_owned(), json!(false));
    turn
}

async fn collect(client: &MistralRsClient, turn: ChatTurn) -> Vec<ModelStreamEvent> {
    let mut stream = client.stream(turn).await.expect("the stream opens");
    let mut events = Vec::new();
    while let Some(event) = stream.next().await {
        events.push(event.expect("no error item in the stream"));
    }
    events
}

#[tokio::test]
#[ignore = "loads real weights: set APHRODY_ENGINE_SMOKE_MODEL and run with --ignored"]
async fn a_loaded_model_streams_text_and_completes_exactly_once() {
    let Some(model) = env(MODEL) else {
        return skipped(MODEL);
    };
    let client = client(&model);
    client.load().await.expect("the model loads");
    assert!(client.capabilities().tools);

    let events = collect(&client, greedy_turn("Reply with one short sentence about Rust.")).await;
    assert!(matches!(events.first(), Some(ModelStreamEvent::Created)), "{events:?}");
    let text: String = events
        .iter()
        .filter_map(|event| match event {
            ModelStreamEvent::TextDelta(delta) => Some(delta.as_str()),
            _ => None,
        })
        .collect();
    assert!(!text.trim().is_empty(), "the model produced no text: {events:?}");
    let completions =
        events.iter().filter(|event| matches!(event, ModelStreamEvent::Completed { .. })).count();
    assert_eq!(completions, 1, "{events:?}");
    let Some(ModelStreamEvent::Completed { usage: Some(usage), finish_reason: Some(reason) }) =
        events.last()
    else {
        panic!("the stream must end with a Completed that has usage and a reason: {events:?}");
    };
    assert!(usage.input_tokens > 0 && usage.output_tokens > 0, "{usage:?}");
    eprintln!("smoke: finished with `{reason}` after {} characters, usage {usage:?}", text.len());
}

#[tokio::test]
#[ignore = "loads real weights: set APHRODY_ENGINE_SMOKE_MODEL and APHRODY_ENGINE_SMOKE_TOOLS"]
async fn a_required_tool_choice_yields_a_tool_call_event() {
    let Some(model) = env(MODEL) else {
        return skipped(MODEL);
    };
    if env(TOOLS).is_none() {
        return skipped(TOOLS);
    }
    let client = client(&model);
    let mut turn = greedy_turn("What is the weather in Paris? Use the tool.");
    turn.tools = vec![ToolDecl {
        name: "get_weather".to_owned(),
        description: "The current weather of a city".to_owned(),
        parameters: json!({
            "type": "object",
            "properties": { "city": { "type": "string" } },
            "required": ["city"]
        }),
    }];
    turn.options.extra.insert("tool_choice".to_owned(), json!("required"));

    let events = collect(&client, turn).await;
    let call = events.iter().find_map(|event| match event {
        ModelStreamEvent::ToolCall { id, name, arguments } => Some((id, name, arguments)),
        _ => None,
    });
    let (id, name, arguments) = call.unwrap_or_else(|| panic!("no tool call in {events:?}"));
    assert_eq!(name, "get_weather");
    assert!(!id.is_empty());
    assert!(arguments.get("city").is_some(), "the arguments are a JSON object: {arguments}");
    let Some(ModelStreamEvent::Completed { finish_reason, .. }) = events.last() else {
        panic!("the stream must end with Completed: {events:?}");
    };
    assert_eq!(finish_reason.as_deref(), Some("tool_calls"));
}

#[tokio::test]
#[ignore = "loads real weights: set APHRODY_ENGINE_SMOKE_EMBED_MODEL and run with --ignored"]
async fn the_embedder_returns_one_vector_per_input() {
    let Some(model) = env(EMBED_MODEL) else {
        return skipped(EMBED_MODEL);
    };
    let runtime = RuntimeOptions { force_cpu: env(CPU).is_some(), ..RuntimeOptions::default() };
    let config = EmbedderConfig { runtime, ..EmbedderConfig::new(model) };
    let embedder = MistralRsEmbedder::new(config).expect("the smoke configuration is valid");
    embedder.load().await.expect("the embedding model loads");

    let vectors = embedder
        .embed(&["a cat sat on the mat", "the stock market fell sharply"])
        .await
        .expect("the embedding call succeeds");
    assert_eq!(vectors.len(), 2);
    assert!(!vectors[0].is_empty() && vectors[0].len() == vectors[1].len());
    assert_ne!(vectors[0], vectors[1], "different texts must not embed identically");
}
