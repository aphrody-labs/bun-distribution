// SPDX-License-Identifier: Apache-2.0
//! Opt-in smoke test for a real trained SentenceTransformers ONNX export.

#![cfg(feature = "ort")]

use aphrody_rag::{Embedder as _, OrtEmbedder};

#[tokio::test]
#[ignore = "requires APHRODY_TRAIN_SMOKE_MODEL_DIR and a local ONNX Runtime DLL"]
async fn trained_embedding_export_loads_and_embeds() {
    let model_dir = std::path::PathBuf::from(
        std::env::var_os("APHRODY_TRAIN_SMOKE_MODEL_DIR")
            .expect("set APHRODY_TRAIN_SMOKE_MODEL_DIR to the trained model directory"),
    );
    let onnx = model_dir.join("onnx").join("model.onnx");
    let embedder = OrtEmbedder::load_user_defined(&onnx, &model_dir)
        .expect("Rust ORT loader must accept the trained ONNX and tokenizer");
    assert_eq!(embedder.dimension(), 384);

    let texts = [
        "What is Rust?".to_owned(),
        "Rust is a programming language.".to_owned(),
        "A carrot is a vegetable.".to_owned(),
    ];
    let vectors = embedder
        .embed_batch(&texts)
        .await
        .expect("ONNX inference must succeed");
    assert_eq!(vectors.len(), texts.len());
    for vector in &vectors {
        assert_eq!(vector.len(), embedder.dimension());
        assert!(vector.iter().all(|value| value.is_finite()));
        assert!(vector.iter().map(|value| value * value).sum::<f32>() > 0.0);
    }

    let cosine = |a: &[f32], b: &[f32]| {
        let dot = a.iter().zip(b).map(|(x, y)| x * y).sum::<f32>();
        let norm_a = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        let norm_b = b.iter().map(|x| x * x).sum::<f32>().sqrt();
        dot / (norm_a * norm_b)
    };
    let positive_cosine = cosine(&vectors[0], &vectors[1]);
    let negative_cosine = cosine(&vectors[0], &vectors[2]);
    println!(
        "dimension={}, positive_cosine={positive_cosine:.6}, negative_cosine={negative_cosine:.6}",
        embedder.dimension()
    );
    assert!(positive_cosine > negative_cosine);
}
