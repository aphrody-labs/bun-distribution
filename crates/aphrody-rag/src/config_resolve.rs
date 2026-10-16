// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! The one RAG configuration resolver.
//!
//! Before this module, the CLI (`aphrody rag`), the MCP tools
//! (`aphrody_rag_search` / `aphrody_rag_context`), and — as they grow local
//! retrieval — the agent runtime and the app-server each read a different
//! subset of environment variables to decide which embedding model, vector
//! width, and endpoint to use: the CLI read only `[rag]` from `config.toml`
//! with no environment override at all; the MCP tools read only
//! `APHRODY_RAG_EMBED_*`, ignoring both `config.toml` and the canonical
//! `APHRODY_AI_*` names. They drifted the moment one was updated and the
//! other was not (CLAUDE.md §7: "a tool that compiles is not a tool that is
//! wired"). [`resolve_embed`] and [`resolve_rerank`] are the one place every
//! surface now resolves this from.
//!
//! Precedence, matching `tools/aphrody/config/local-ai.json`'s
//! `resolution.precedence` (`canonical`, `alias`, `target`, `default`):
//!
//! 1. The canonical `APHRODY_AI_*` environment variable
//!    ([`aphrody_config::ai_env`]).
//! 2. Its legacy aliases, in the order the contract lists them.
//! 3. `configured` — the caller's `[rag]` table (`config.rag.embed_model`,
//!    `.rerank_model`, ...).
//! 4. The local model catalog's default for the role
//!    ([`aphrody_models::LocalRole::Embed`] / [`LocalRole::Rerank`]).
//!
//! A vector width is resolved the same way, except an explicit override that
//! disagrees with the catalog's own dimension for the resolved model is
//! rejected outright ([`RagError::EmbedDimensionMismatch`]) rather than one
//! silently winning: embedding spaces must never mix.

use aphrody_config::{EmbedBackend, RagConfig, ai_env};
use aphrody_models::{Catalog, LocalRole};

use crate::error::{RagError, Result};

/// Resolved configuration for the embedder half of the RAG pipeline.
///
/// `None` from [`resolve_embed`] means "no embedder is configured or
/// discoverable": the honest degrade to lexical-only search, not an error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedEmbedConfig {
    /// Which backend serves [`Self::model`].
    pub backend: EmbedBackend,
    /// The embedding model id (catalog id or a raw reference).
    pub model: String,
    /// Vector width [`Self::model`] produces.
    pub dimension: usize,
    /// The endpoint to call. `None` for [`EmbedBackend::Ort`] (in-process);
    /// always `Some` for [`EmbedBackend::LlamaServer`] /
    /// [`EmbedBackend::OpenaiCompat`] — [`resolve_embed`] errors otherwise.
    pub endpoint: Option<String>,
    /// Bearer token for [`Self::endpoint`], from `APHRODY_RAG_API_KEY`. Never
    /// sourced from `config.toml` (CLAUDE.md: no secret value belongs there).
    pub api_key: Option<String>,
}

/// Resolved configuration for the reranker half of the RAG pipeline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedRerankConfig {
    /// The reranker model id reported to the endpoint.
    pub model: String,
    /// The endpoint to call.
    pub endpoint: String,
    /// Bearer token for [`Self::endpoint`], from `APHRODY_RAG_API_KEY`.
    pub api_key: Option<String>,
}

type EnvReader<'a> = dyn Fn(&str) -> Option<String> + 'a;

fn std_env(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

fn api_key_from(env: &EnvReader<'_>) -> Option<String> {
    env("APHRODY_RAG_API_KEY").filter(|value| !value.trim().is_empty())
}

/// The embedder's own default when neither the environment nor `configured`
/// names one.
///
/// [`EmbedBackend::LlamaServer`] and [`EmbedBackend::OpenaiCompat`] both talk
/// to a server aphrody itself manages or points at, so they share
/// [`LocalRole::Embed`]'s catalog default (`qwen3-embedding-0.6b`, 1024-dim,
/// served by `llama-server`). [`EmbedBackend::Ort`] is a different serving
/// mechanism entirely — an in-process ONNX Runtime session over
/// `aphrody-embed`'s small, CPU-friendly whitelist — and `LocalRole::Embed`'s
/// llama.cpp-served default is not one of the models that whitelist accepts;
/// defaulting to it would make `OrtEmbedder::load` (feature `ort`) fail
/// outright. `Ort` therefore defaults to `aphrody-embed`'s own default
/// instead.
fn default_embed_model(backend: EmbedBackend) -> &'static str {
    match backend {
        EmbedBackend::Native => "bge-small-en-v1.5",
        EmbedBackend::Ort => default_ort_model(),
        EmbedBackend::LlamaServer | EmbedBackend::OpenaiCompat => LocalRole::Embed.default_model(),
    }
}

#[cfg(feature = "ort")]
fn default_ort_model() -> &'static str {
    aphrody_embed::EmbeddingModelKind::default().as_str()
}

#[cfg(not(feature = "ort"))]
fn default_ort_model() -> &'static str {
    // Mirrors `aphrody_embed::EmbeddingModelKind::default()`; hard-coded here
    // because a build without the `ort` feature cannot use this backend
    // regardless, so it never needs the real dependency to name its default.
    "bge-small-en-v1.5"
}

fn resolve_embed_model(
    backend: EmbedBackend,
    configured: Option<&str>,
    env: &EnvReader<'_>,
) -> String {
    ai_env::EMBED_MODEL
        .resolve_with(env)
        .or_else(|| configured.filter(|value| !value.trim().is_empty()).map(str::to_owned))
        .unwrap_or_else(|| default_embed_model(backend).to_owned())
}

fn resolve_rerank_model(configured: Option<&str>, env: &EnvReader<'_>) -> String {
    ai_env::RERANK_MODEL
        .resolve_with(env)
        .or_else(|| configured.filter(|value| !value.trim().is_empty()).map(str::to_owned))
        .unwrap_or_else(|| LocalRole::Rerank.default_model().to_owned())
}

/// Resolve the vector width for `model`: an explicit override
/// ([`ai_env::EMBED_DIMENSIONS`]) when it agrees with the catalog (or the
/// model is uncatalogued), the catalog's own dimension otherwise, and
/// `configured` (`[rag] vector_dim`) as the last resort for an uncatalogued
/// model with no override.
///
/// # Errors
///
/// [`RagError::InvalidEmbedDimension`] when the override does not parse as a
/// positive integer, [`RagError::EmbedDimensionMismatch`] when it disagrees
/// with the catalog, and [`RagError::UnknownEmbedDimension`] when neither the
/// catalog, the override, nor `configured` supplies one.
fn resolve_dimension(model: &str, configured: Option<usize>, env: &EnvReader<'_>) -> Result<usize> {
    let env_dim =
        match ai_env::EMBED_DIMENSIONS.resolve_source_with(env) {
            Some(env_var) => {
                let raw = ai_env::EMBED_DIMENSIONS.resolve_with(env).unwrap_or_default();
                let value = raw.parse::<usize>().map_err(|source| {
                    RagError::InvalidEmbedDimension { env_var, raw: raw.clone(), source }
                })?;
                Some((env_var, value))
            },
            None => None,
        };
    let catalog_dim = Catalog::builtin().dimensions(model).ok().flatten().map(|dim| dim as usize);

    match (env_dim, catalog_dim) {
        (Some((env_var, env_dim)), Some(catalog_dim)) if env_dim != catalog_dim => {
            Err(RagError::EmbedDimensionMismatch {
                env_var,
                env_dim,
                model: model.to_owned(),
                catalog_dim,
            })
        },
        (Some((_, env_dim)), _) => Ok(env_dim),
        (None, Some(catalog_dim)) => Ok(catalog_dim),
        (None, None) => {
            configured.ok_or_else(|| RagError::UnknownEmbedDimension { model: model.to_owned() })
        },
    }
}

fn resolve_embed_with(
    config: &RagConfig,
    env: &EnvReader<'_>,
) -> Result<Option<ResolvedEmbedConfig>> {
    let env_endpoint = ai_env::EMBED_BASE_URL.resolve_with(env);
    let Some(backend) = config
        .embed_backend
        .or_else(|| env_endpoint.is_some().then_some(EmbedBackend::LlamaServer))
    else {
        return Ok(None);
    };

    let model = resolve_embed_model(backend, config.embed_model.as_deref(), env);
    let dimension = resolve_dimension(&model, config.vector_dim, env)?;

    let endpoint = match backend {
        EmbedBackend::Native | EmbedBackend::Ort => None,
        EmbedBackend::LlamaServer | EmbedBackend::OpenaiCompat => {
            let endpoint = env_endpoint
                .or_else(|| {
                    config
                        .embed_endpoint
                        .as_deref()
                        .filter(|v| !v.trim().is_empty())
                        .map(str::to_owned)
                })
                .ok_or(RagError::MissingEmbedEndpoint { backend })?;
            Some(endpoint)
        },
    };

    Ok(Some(ResolvedEmbedConfig {
        backend,
        model,
        dimension,
        endpoint,
        api_key: api_key_from(env),
    }))
}

fn resolve_rerank_with(
    config: &RagConfig,
    enabled: bool,
    env: &EnvReader<'_>,
) -> Result<Option<ResolvedRerankConfig>> {
    if !enabled {
        return Ok(None);
    }
    let model = resolve_rerank_model(config.rerank_model.as_deref(), env);
    let endpoint = ai_env::RERANK_BASE_URL
        .resolve_with(env)
        .or_else(|| {
            config.rerank_endpoint.as_deref().filter(|v| !v.trim().is_empty()).map(str::to_owned)
        })
        .ok_or(RagError::MissingRerankEndpoint)?;
    Ok(Some(ResolvedRerankConfig { model, endpoint, api_key: api_key_from(env) }))
}

/// Resolve the embedder configuration from `config` and the process
/// environment.
///
/// Returns `Ok(None)` when no backend is configured *and* none can be
/// inferred (no `APHRODY_AI_EMBED_BASE_URL`, alias, or `config.embed_backend`
/// is set): callers degrade to lexical-only search, matching every existing
/// caller's behaviour before this resolver existed. Returns `Ok(Some(_))`
/// once a backend is known, with `model`, `dimension`, and (for HTTP
/// backends) `endpoint` all fully resolved.
///
/// # Errors
///
/// See [`RagError::EmbedDimensionMismatch`], [`RagError::UnknownEmbedDimension`],
/// [`RagError::InvalidEmbedDimension`], [`RagError::MissingEmbedEndpoint`].
pub fn resolve_embed(config: &RagConfig) -> Result<Option<ResolvedEmbedConfig>> {
    resolve_embed_with(config, &std_env)
}

/// Whether a reranker endpoint is currently discoverable
/// ([`ai_env::RERANK_BASE_URL`], an alias, or `config.rerank_endpoint`),
/// without resolving the rest of the configuration.
///
/// [`resolve_rerank`] requires its caller to already know whether reranking
/// is wanted (`enabled`) — right for a caller with an explicit mode flag
/// (`aphrody rag search --mode hybrid+rerank`), wrong for a caller that
/// instead wants "rerank when it is configured, else don't" as its own
/// default. This is the probe that decides `enabled` for the second case
/// without duplicating [`ai_env::RERANK_BASE_URL`] resolution at the call
/// site.
#[must_use]
pub fn rerank_available(config: &RagConfig) -> bool {
    rerank_available_with(config, &std_env)
}

fn rerank_available_with(config: &RagConfig, env: &EnvReader<'_>) -> bool {
    ai_env::RERANK_BASE_URL.resolve_with(env).is_some()
        || config.rerank_endpoint.as_deref().is_some_and(|value| !value.trim().is_empty())
}

/// Resolve the reranker configuration. `enabled` mirrors the caller's
/// requested [`aphrody_config::RagMode`]: reranking is opt-in per search, not
/// per process, so a caller that does not need it never pays for endpoint
/// resolution or its errors.
///
/// # Errors
///
/// [`RagError::MissingRerankEndpoint`] when `enabled` is `true` and no
/// endpoint resolves from the canonical environment or `config`.
pub fn resolve_rerank(config: &RagConfig, enabled: bool) -> Result<Option<ResolvedRerankConfig>> {
    resolve_rerank_with(config, enabled, &std_env)
}

#[cfg(test)]
#[path = "config_resolve_tests.rs"]
mod config_resolve_tests;
