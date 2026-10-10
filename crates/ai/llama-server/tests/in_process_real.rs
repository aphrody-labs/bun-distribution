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

/// A 64x64 RGB PNG (red left half, blue right half) with stored (uncompressed) deflate blocks.
fn tiny_png() -> Vec<u8> {
    fn crc32(bytes: &[u8]) -> u32 {
        let mut crc = !0_u32;
        for &byte in bytes {
            crc ^= u32::from(byte);
            for _ in 0..8 {
                crc = if crc & 1 == 1 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
            }
        }
        !crc
    }
    fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
        out.extend((data.len() as u32).to_be_bytes());
        let mut body = kind.to_vec();
        body.extend(data);
        out.extend(&body);
        out.extend(crc32(&body).to_be_bytes());
    }
    let (w, h) = (64_u32, 64_u32);
    let mut raw = Vec::new();
    for _ in 0..h {
        raw.extend([0_u8]); // filter: none
        for x in 0..w {
            raw.extend(if x < w / 2 { [220, 20, 20] } else { [20, 20, 220] });
        }
    }
    let mut z = vec![0x78, 0x01];
    let blocks: Vec<&[u8]> = raw.chunks(65_535).collect();
    for (index, block) in blocks.iter().enumerate() {
        z.push(u8::from(index + 1 == blocks.len()));
        z.extend((block.len() as u16).to_le_bytes());
        z.extend((!(block.len() as u16)).to_le_bytes());
        z.extend(*block);
    }
    let (mut a, mut b) = (1_u32, 0_u32);
    for &byte in &raw {
        a = (a + u32::from(byte)) % 65_521;
        b = (b + a) % 65_521;
    }
    z.extend(((b << 16) | a).to_be_bytes());
    let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    let mut header = Vec::new();
    header.extend(w.to_be_bytes());
    header.extend(h.to_be_bytes());
    header.extend([8, 2, 0, 0, 0]);
    chunk(&mut png, b"IHDR", &header);
    chunk(&mut png, b"IDAT", &z);
    chunk(&mut png, b"IEND", &[]);
    png
}

async fn reply(engine: &InProcessLlama, turn: ChatTurn) -> String {
    let mut stream = engine.stream(turn).await.expect("stream");
    let mut text = String::new();
    while let Some(event) = stream.next().await {
        if let ModelStreamEvent::TextDelta(delta) = event.expect("stream event") {
            text.push_str(&delta);
        }
    }
    text
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs the libllama runtime, a vision GGUF and its mmproj (APHRODY_LLAMA_TEST_MODEL + APHRODY_LLAMA_TEST_MMPROJ)"]
async fn in_process_vision_reads_an_image() {
    use aphrody_model_client::ImageSource;
    use base64::Engine as _;

    let model = std::env::var("APHRODY_LLAMA_TEST_MODEL").expect("set APHRODY_LLAMA_TEST_MODEL");
    let mmproj = std::env::var("APHRODY_LLAMA_TEST_MMPROJ").expect("set APHRODY_LLAMA_TEST_MMPROJ");
    let engine = InProcessLlama::load(
        &model,
        "vision",
        LoadOptions { ctx: Some(4096), mmproj: Some(mmproj.into()), ..LoadOptions::default() },
    )
    .await
    .expect("load model and projector");
    assert!(engine.capabilities().images, "a loaded vision projector must advertise images");

    let png = base64::engine::general_purpose::STANDARD.encode(tiny_png());
    let turn = ChatTurn {
        messages: vec![ChatMessage {
            role: Role::User,
            parts: vec![
                Part::Image(ImageSource::base64("image/png", png.clone())),
                Part::Text("Describe this image in one short sentence.".to_string()),
            ],
        }],
        options: TurnOptions {
            max_output_tokens: Some(48),
            temperature: Some(0.0),
            ..TurnOptions::default()
        },
        ..ChatTurn::default()
    };
    let text = reply(&engine, turn).await;
    eprintln!("vision reply: {text:?}");
    assert!(!text.trim().is_empty(), "model produced no text for the image");

    // The same image through the loopback OpenAI endpoint (data: URL).
    let server = InProcessServer::start(engine).await.expect("loopback server");
    let response: serde_json::Value = reqwest::Client::new()
        .post(format!("{}/chat/completions", server.base_url()))
        .json(&serde_json::json!({
            "messages": [{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": format!("data:image/png;base64,{png}")}},
                {"type": "text", "text": "What colors do you see?"},
            ]}],
            "max_tokens": 32,
            "temperature": 0,
        }))
        .send()
        .await
        .expect("chat request")
        .json()
        .await
        .expect("json body");
    eprintln!("openai vision reply: {response}");
    assert!(response["choices"][0]["message"]["content"].is_string());
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs the libllama runtime, a GGUF model and a compatible adapter (APHRODY_LLAMA_TEST_MODEL + APHRODY_LLAMA_TEST_LORA)"]
async fn in_process_lora_adapter_loads_and_generates() {
    use aphrody_llama_server::in_process::LoraSpec;

    let model = std::env::var("APHRODY_LLAMA_TEST_MODEL").expect("set APHRODY_LLAMA_TEST_MODEL");
    let lora = std::env::var("APHRODY_LLAMA_TEST_LORA").expect("set APHRODY_LLAMA_TEST_LORA");
    let engine = InProcessLlama::load(
        &model,
        "lora",
        LoadOptions {
            ctx: Some(2048),
            lora: vec![LoraSpec { path: lora.into(), scale: 1.0 }],
            ..LoadOptions::default()
        },
    )
    .await
    .expect("load model with the adapter");
    let text = reply(&engine, turn()).await;
    eprintln!("lora reply: {text:?}");
    assert!(!text.trim().is_empty());
}
