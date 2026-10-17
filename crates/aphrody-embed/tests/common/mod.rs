//! Shared helpers for integration tests that need real model files.

#![allow(dead_code)]

use aphrody_embed::native::{
    EmbedOptions, Embedder, ModelFiles, ModelSpec, ensure_model, find_model, find_reranker,
    is_offline,
};

/// Resolve a model, downloading it when needed. Returns `None` (after printing why) only
/// when the files are missing and `APHRODY_OFFLINE=1` forbids fetching them.
pub(crate) fn model_or_skip(id: &str) -> Option<(ModelSpec, std::path::PathBuf)> {
    let spec = find_model(id).expect("model in manifest");
    let dir = spec.default_dir();
    match ensure_model(&spec, &dir) {
        Ok(dir) => Some((spec, dir)),
        Err(err) if is_offline() => {
            eprintln!("SKIPPED: {id} not installed and APHRODY_OFFLINE=1 ({err})");
            None
        }
        Err(err) => panic!("cannot install {id}: {err}"),
    }
}

/// `true` when every file of `id` is already on disk (no download needed).
pub(crate) fn installed(id: &str) -> bool {
    let spec = find_model(id).expect("model in manifest");
    let dir = spec.default_dir();
    spec.files.iter().all(|f| {
        std::fs::metadata(dir.join(&f.name))
            .map(|m| m.len() == f.size)
            .unwrap_or(false)
    })
}

/// Like [`model_or_skip`] for cross-encoders.
pub(crate) fn reranker_or_skip(
    id: &str,
) -> Option<(aphrody_embed::native::RerankerSpec, std::path::PathBuf)> {
    let spec = find_reranker(id).expect("reranker in manifest");
    let dir = spec.default_dir();
    match ensure_model(&spec, &dir) {
        Ok(dir) => Some((spec, dir)),
        Err(err) if is_offline() => {
            eprintln!("SKIPPED: {id} not installed and APHRODY_OFFLINE=1 ({err})");
            None
        }
        Err(err) => panic!("cannot install {id}: {err}"),
    }
}

/// `true` when every file of reranker `id` is already on disk.
pub(crate) fn reranker_installed(id: &str) -> bool {
    let spec = find_reranker(id).expect("reranker in manifest");
    aphrody_embed::native::is_installed(&spec, &spec.default_dir())
}

pub(crate) fn embedder(id: &str, opts: EmbedOptions) -> Option<Embedder> {
    let (spec, dir) = model_or_skip(id)?;
    Some(Embedder::load(&dir, &spec, opts).expect("load embedder"))
}
