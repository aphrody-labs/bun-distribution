// SPDX-License-Identifier: Apache-2.0
use pretty_assertions::assert_eq;

use super::*;

#[test]
fn rag_mode_uses_plus_sign_for_hybrid_rerank() {
    let json = serde_json::to_string(&RagMode::HybridRerank).expect("serialize");
    assert_eq!(json, "\"hybrid+rerank\"");
    let back: RagMode = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(back, RagMode::HybridRerank);
}

#[test]
fn rag_config_full_table_parses() {
    let toml_str = r#"
        enabled = true
        db_path = "~/.aphrody/rag/index.db"
        embed_model = "multilingual-e5-small"
        embed_backend = "ort"
        vector_dim = 384
        embed_endpoint = "http://127.0.0.1:8081/v1/embeddings"
        rerank_model = "bge-reranker-base"
        rerank_endpoint = "http://127.0.0.1:8082/rerank"
        mode = "hybrid+rerank"
        top_k = 20
        rerank_top_n = 8
        auto_context = "first-turn"
        auto_context_max_tokens = 2000
        min_score = 0.2
        include = ["**/*.rs"]
        exclude = ["target/**"]
        watch = true
    "#;
    let cfg: RagConfig = toml::from_str(toml_str).expect("parse");
    assert_eq!(cfg.mode, Some(RagMode::HybridRerank));
    assert_eq!(cfg.embed_backend, Some(EmbedBackend::Ort));
    assert_eq!(cfg.vector_dim, Some(384));
    assert_eq!(
        cfg.embed_endpoint.as_deref(),
        Some("http://127.0.0.1:8081/v1/embeddings")
    );
    assert_eq!(
        cfg.rerank_endpoint.as_deref(),
        Some("http://127.0.0.1:8082/rerank")
    );
    assert_eq!(cfg.auto_context, Some(AutoContext::FirstTurn));
    assert_eq!(cfg.top_k, Some(20));
}

#[test]
fn embed_backend_kebab_case() {
    assert_eq!(
        serde_json::to_string(&EmbedBackend::LlamaServer).unwrap(),
        "\"llama-server\""
    );
    assert_eq!(
        serde_json::to_string(&EmbedBackend::OpenaiCompat).unwrap(),
        "\"openai-compat\""
    );
}

#[test]
fn auto_context_kebab_case() {
    assert_eq!(serde_json::to_string(&AutoContext::Off).unwrap(), "\"off\"");
    assert_eq!(
        serde_json::to_string(&AutoContext::EveryTurn).unwrap(),
        "\"every-turn\""
    );
}

#[test]
fn compat_defaults_to_never_reading_codex_home() {
    let cfg = CompatConfig::default();
    assert!(!cfg.read_codex_home);
}

#[test]
fn computer_use_environment_kebab_case() {
    assert_eq!(
        serde_json::to_string(&ComputerUseEnvironment::Windows).unwrap(),
        "\"windows\""
    );
    assert_eq!(
        serde_json::to_string(&ComputerUseEnvironment::Browser).unwrap(),
        "\"browser\""
    );
}

#[test]
fn llama_config_parses_minimal() {
    let cfg: LlamaConfig = toml::from_str(r"ctx = 8192").expect("parse");
    assert_eq!(cfg.ctx, Some(8192));
    assert_eq!(cfg.keep_alive, None);
}
