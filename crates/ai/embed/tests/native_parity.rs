//! Parity with the official sentence-transformers implementation.
//!
//! Reference vectors live in `tests/fixtures/reference.json`; regenerate them with
//! `aphrody-embedding-fixtures` from the shared Python workspace.
//! The default model is always checked (downloaded on demand); BGE and E5 are checked
//! when already installed or when `APHRODY_EMBED_TEST_ALL_MODELS=1`.

mod common;

use aphrody_embed::native::{Backend, DEFAULT_MODEL_ID, EmbedOptions, TextKind, cosine};
use serde_json::Value;

const MIN_COSINE: f32 = 0.999;

fn reference() -> Value {
    let text = include_str!("fixtures/reference.json");
    serde_json::from_str(text).expect("valid reference fixture")
}

fn check_case(case: &Value, sentences: &[&str], backend: Backend) -> Option<f32> {
    let model = case["model"].as_str().unwrap();
    let kind: TextKind = case["kind"].as_str().unwrap().parse().unwrap();
    let opts = EmbedOptions { backend, threads: 4, ..EmbedOptions::default() };
    let embedder = common::embedder(model, opts)?;
    let got = embedder.embed_batch(sentences, kind).expect("embed");
    let mut worst = 1.0f32;
    for (i, (vector, want)) in got.iter().zip(case["embeddings"].as_array().unwrap()).enumerate() {
        let want: Vec<f32> =
            want.as_array().unwrap().iter().map(|v| v.as_f64().unwrap() as f32).collect();
        assert_eq!(vector.len(), want.len(), "{model} dim");
        let cos = cosine(vector, &want);
        let norm = vector.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-4, "{model} vector {i} not normalised: {norm}");
        assert!(
            cos >= MIN_COSINE,
            "{model} ({kind:?}, {backend:?}) sentence {i}: cosine {cos} < {MIN_COSINE}"
        );
        worst = worst.min(cos);
    }
    println!("parity {model} {kind:?} {backend:?}: min cosine {worst:.7}");
    Some(worst)
}

#[test]
fn default_model_matches_sentence_transformers() {
    let reference = reference();
    let sentences: Vec<&str> =
        reference["sentences"].as_array().unwrap().iter().map(|s| s.as_str().unwrap()).collect();
    assert_eq!(sentences.len(), 5);
    let case = reference["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["model"] == DEFAULT_MODEL_ID)
        .expect("default model reference");
    check_case(case, &sentences, Backend::Native);
    #[cfg(feature = "candle")]
    check_case(case, &sentences, Backend::Candle);
}

#[test]
fn optional_models_match_sentence_transformers() {
    let all = std::env::var("APHRODY_EMBED_TEST_ALL_MODELS").is_ok_and(|v| v == "1");
    let reference = reference();
    let sentences: Vec<&str> =
        reference["sentences"].as_array().unwrap().iter().map(|s| s.as_str().unwrap()).collect();
    for case in reference["cases"].as_array().unwrap() {
        let model = case["model"].as_str().unwrap();
        if model == DEFAULT_MODEL_ID {
            continue;
        }
        if !all && !common::installed(model) {
            eprintln!(
                "SKIPPED: {model} not installed (set APHRODY_EMBED_TEST_ALL_MODELS=1 to fetch)"
            );
            continue;
        }
        check_case(case, &sentences, Backend::Native);
    }
}
