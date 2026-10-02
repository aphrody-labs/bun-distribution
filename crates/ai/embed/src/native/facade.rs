//! Flat, process-wide API intended for the C ABI bridge.
//!
//! Instances are created lazily on first use from the environment and **never download**:
//! a missing model yields [`Error::NotInstalled`] (install with [`ensure_model`]).
//! A failed initialisation is not cached, so a later call succeeds once
//! the files exist.
//!
//! - `APHRODY_EMBED_MODEL`: embedding model id (default `sentence-transformers/all-MiniLM-L6-v2`)
//! - `APHRODY_RERANK_MODEL`: reranker id (default `cross-encoder/ms-marco-MiniLM-L6-v2`)
//! - `APHRODY_MODELS_DIR`: models root (default `~/.aphrody/models`)
//! - `APHRODY_EMBED_THREADS`: worker threads for both (default: all cores)
//!
//! [`ensure_model`]: super::ensure_model

use std::sync::{Mutex, OnceLock};

use serde_json::json;

use super::{
    download::require_installed,
    embedder::{EmbedOptions, Embedder, TextKind},
    error::{Error, Result},
    manifest::{DEFAULT_MODEL_ID, DEFAULT_RERANKER_ID, ModelFiles, find_model, find_reranker},
    reranker::Reranker,
};

static EMBEDDER: OnceLock<Embedder> = OnceLock::new();
static RERANKER: OnceLock<Reranker> = OnceLock::new();
static INIT_LOCK: Mutex<()> = Mutex::new(());

fn env_or(name: &str, default: &str) -> String {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty()).unwrap_or_else(|| default.to_string())
}

fn env_options() -> EmbedOptions {
    EmbedOptions {
        threads: std::env::var("APHRODY_EMBED_THREADS")
            .ok()
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(0),
        ..EmbedOptions::default()
    }
}

fn get_or_init<T>(
    cell: &'static OnceLock<T>,
    init: impl FnOnce() -> Result<T>,
) -> Result<&'static T> {
    if let Some(value) = cell.get() {
        return Ok(value);
    }
    let _guard = INIT_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(value) = cell.get() {
        return Ok(value);
    }
    let value = init()?;
    Ok(cell.get_or_init(|| value))
}

/// The process-wide embedder (`APHRODY_EMBED_MODEL`), loaded on first call without network I/O.
pub fn global_embedder() -> Result<&'static Embedder> {
    get_or_init(&EMBEDDER, || {
        let id = env_or("APHRODY_EMBED_MODEL", DEFAULT_MODEL_ID);
        let spec = find_model(&id).ok_or_else(|| Error::UnknownModel(id.clone()))?;
        let dir = require_installed(&spec, &spec.default_dir())?;
        Embedder::load(&dir, &spec, env_options())
    })
}

/// The process-wide reranker (`APHRODY_RERANK_MODEL`), loaded on first call without network I/O.
pub fn global_reranker() -> Result<&'static Reranker> {
    get_or_init(&RERANKER, || {
        let id = env_or("APHRODY_RERANK_MODEL", DEFAULT_RERANKER_ID);
        let spec = find_reranker(&id).ok_or_else(|| Error::UnknownModel(id.clone()))?;
        let dir = require_installed(&spec, &spec.default_dir())?;
        Reranker::load(&dir, &spec, env_options())
    })
}

fn guarded(run: impl FnOnce() -> Result<String> + std::panic::UnwindSafe) -> String {
    match std::panic::catch_unwind(run) {
        Ok(Ok(payload)) => payload,
        Ok(Err(err)) => json!({ "error": err.to_string() }).to_string(),
        Err(_) => json!({ "error": "aphrody-embed panicked" }).to_string(),
    }
}

/// Embed a JSON array of strings with the global embedder.
///
/// `kind` is `"query"` or `"passage"`. Returns
/// `{"model": "<id>@<revision>", "dim": 384, "count": n, "embeddings": [[f32; dim]; n]}`
/// or `{"error": "..."}`; never panics.
pub fn embed_json(texts_json: &str, kind: &str) -> String {
    guarded(|| {
        let texts: Vec<String> = serde_json::from_str(texts_json)
            .map_err(|e| Error::InvalidInput(format!("expected a JSON array of strings: {e}")))?;
        let kind: TextKind = kind.parse()?;
        let embedder = global_embedder()?;
        let refs: Vec<&str> = texts.iter().map(String::as_str).collect();
        let vectors = embedder.embed_batch(&refs, kind)?;
        Ok(json!({
            "model": embedder.spec().versioned_id(),
            "dim": embedder.dim(),
            "count": vectors.len(),
            "embeddings": vectors,
        })
        .to_string())
    })
}

/// Embed `texts` with the global embedder into one contiguous row-major buffer
/// (`texts.len() * dim` values). Returns the buffer and `dim`.
pub fn embed_flat(texts: &[&str], kind: &str) -> Result<(Vec<f32>, usize)> {
    let kind: TextKind = kind.parse()?;
    let embedder = global_embedder()?;
    let dim = embedder.dim();
    let vectors = embedder.embed_batch(texts, kind)?;
    let mut flat = Vec::with_capacity(vectors.len() * dim);
    for vector in vectors {
        flat.extend_from_slice(&vector);
    }
    Ok((flat, dim))
}

/// Rerank a JSON array of passages for `query` with the global reranker.
///
/// Returns `[{"index": i, "score": s}, ...]` sorted by descending score (ties by index),
/// or `{"error": "..."}`; never panics.
pub fn rerank_json(query: &str, passages_json: &str) -> String {
    guarded(|| {
        let passages: Vec<String> = serde_json::from_str(passages_json)
            .map_err(|e| Error::InvalidInput(format!("expected a JSON array of strings: {e}")))?;
        let reranker = global_reranker()?;
        let refs: Vec<&str> = passages.iter().map(String::as_str).collect();
        let ranked = reranker.rank(query, &refs)?;
        let items: Vec<_> = ranked
            .into_iter()
            .map(|(index, score)| json!({ "index": index, "score": score }))
            .collect();
        Ok(serde_json::Value::Array(items).to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn facades_report_bad_input_without_loading_a_model() {
        let out: serde_json::Value =
            serde_json::from_str(&embed_json("{not json", "query")).unwrap();
        assert!(out["error"].as_str().unwrap().contains("JSON array"));
        let out: serde_json::Value = serde_json::from_str(&embed_json("[\"a\"]", "image")).unwrap();
        assert!(out["error"].as_str().unwrap().contains("unknown text kind"));
        let out: serde_json::Value = serde_json::from_str(&rerank_json("q", "nope")).unwrap();
        assert!(out["error"].as_str().unwrap().contains("JSON array"));
    }
}
