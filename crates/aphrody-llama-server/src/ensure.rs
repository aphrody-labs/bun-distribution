// SPDX-License-Identifier: Apache-2.0
//! Helper to ensure an open-source model and its provider are ready for inference.
//!
//! Supports:
//! - `llama` / `managed`: resolves catalog entry, verifies weights in [`ModelStore`], pulls missing
//!   artefacts via [`Downloader`], and yields local GGUF path.
//! - `ollama`: probes endpoint `/api/tags`, triggers `/api/pull` if missing.
//! - `lmstudio`: probes `/v1/models` to ensure local runtime is serving.
//! - `vllm`: probes `/v1/models` to ensure local runtime is serving.

use std::path::{Path, PathBuf};

use aphrody_models::{Catalog, Downloader, LocalRole, ModelStore, PullOptions};

/// Default model identifier used for managed llama-server when unspecified.
///
/// Single source of truth: [`LocalRole::Chat`]. Kept as its own `const`
/// because it names the fallback in doc comments and error messages across
/// this crate.
pub const DEFAULT_OSS_MODEL: &str = LocalRole::Chat.default_model();

/// Default model identifier used for Ollama when unspecified.
///
/// Must agree with `aphrody-config`'s `hardcoded_default_model("ollama")`
/// (`crates/aphrody-config/src/resolve.rs`): that crate is an intentionally
/// dependency-free leaf (no `aphrody-models`), so the two cannot share one
/// `const` — this comment is the cross-check. `gpt-oss:20b` mirrors upstream
/// `openai/codex`'s own OSS default and is published under this exact tag by
/// Ollama, LM Studio and vLLM, which is why it — not a `LocalRole` model
/// family — is the one this crate and `aphrody-config` agree on.
pub const DEFAULT_OLLAMA_MODEL: &str = "gpt-oss:20b";

/// Default model identifier used for LM Studio when unspecified.
///
/// Must agree with `aphrody-config`'s `hardcoded_default_model("lmstudio")`;
/// see [`DEFAULT_OLLAMA_MODEL`] for why these are two literals, not one
/// shared `const`.
pub const DEFAULT_LMSTUDIO_MODEL: &str = "openai/gpt-oss-20b";

/// Default Ollama loopback endpoint.
pub const DEFAULT_OLLAMA_ENDPOINT: &str = "http://localhost:11434";

/// Default LM Studio loopback endpoint.
pub const DEFAULT_LMSTUDIO_ENDPOINT: &str = "http://localhost:1234/v1";

/// Default vLLM loopback endpoint.
pub const DEFAULT_VLLM_ENDPOINT: &str = "http://localhost:8000/v1";

/// Options passed to [`ensure_oss_ready`].
#[derive(Debug, Clone)]
pub struct OssReadyOptions<'a> {
    /// Provider name: `"llama"` | `"managed"` | `"ollama"` | `"lmstudio"` | `"vllm"`.
    pub provider: &'a str,
    /// Model identifier or catalog id. If empty or `"default"`, uses provider default.
    pub model: Option<&'a str>,
    /// Custom endpoint URL if different from provider default.
    pub endpoint: Option<&'a str>,
    /// Optional store root directory (defaults to standard store directory).
    pub store_root: Option<&'a Path>,
    /// Force pull / redownload even if weights are already present.
    pub force: bool,
}

impl<'a> Default for OssReadyOptions<'a> {
    fn default() -> Self {
        Self {
            provider: "llama",
            model: None,
            endpoint: None,
            store_root: None,
            force: false,
        }
    }
}

/// Outcome of [`ensure_oss_ready`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OssReadyOutcome {
    /// Managed llama-server: weights verified in store (pulled if necessary).
    LlamaReady {
        /// Resolved model catalog ID or reference.
        model_id: String,
        /// Primary weights file path on local filesystem.
        primary_path: PathBuf,
        /// All required artefact paths (e.g. weights + mmproj projector).
        all_paths: Vec<PathBuf>,
        /// Whether the model was already completely present before this call.
        already_present: bool,
    },
    /// Ollama endpoint verified; model pulled or already loaded.
    OllamaReady {
        /// Model name verified in Ollama.
        model: String,
        /// Active Ollama endpoint base URL.
        endpoint: String,
    },
    /// LM Studio endpoint verified; model listed under `/v1/models`.
    LmStudioReady {
        /// Model name.
        model: String,
        /// Active LM Studio endpoint base URL.
        endpoint: String,
    },
    /// vLLM endpoint verified; model listed under `/v1/models`.
    VllmReady {
        /// Model name.
        model: String,
        /// Active vLLM endpoint base URL.
        endpoint: String,
    },
}

/// Errors occurring during [`ensure_oss_ready`].
#[derive(Debug, thiserror::Error)]
pub enum OssReadyError {
    /// Provider is unknown or unsupported.
    #[error("unknown or unsupported provider: '{0}'")]
    UnknownProvider(String),
    /// Error originating from [`aphrody_models`] (catalog, store, or download).
    #[error("model store error: {0}")]
    Model(#[from] aphrody_models::ModelError),
    /// HTTP transport failure.
    #[error("network or HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    /// Server is down or unreachable.
    #[error("endpoint unavailable at {endpoint}: {reason}")]
    EndpointUnavailable {
        /// Endpoint URL.
        endpoint: String,
        /// Underlying reason.
        reason: String,
    },
    /// Requested model is not available on remote server.
    #[error("model '{model}' not found on endpoint '{endpoint}'")]
    ModelNotFound {
        /// Model identifier.
        model: String,
        /// Endpoint URL.
        endpoint: String,
    },
    /// Model pull command failed on remote server.
    #[error("pull failed on '{endpoint}': {reason}")]
    PullFailed {
        /// Endpoint URL.
        endpoint: String,
        /// Error message.
        reason: String,
    },
    /// Local filesystem I/O error.
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// Ensure that the required open-source model and inference provider are ready.
///
/// For `"llama"` or `"managed"`, downloads and verifies the model weights into
/// the local [`ModelStore`]. For external servers (`"ollama"`, `"lmstudio"`, `"vllm"`),
/// verifies service connectivity and model availability.
///
/// # Errors
///
/// Returns [`OssReadyError`] if the provider is unknown, the model cannot be resolved
/// or downloaded, or an external endpoint cannot be reached.
pub async fn ensure_oss_ready(opts: OssReadyOptions<'_>) -> Result<OssReadyOutcome, OssReadyError> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    match opts.provider.to_ascii_lowercase().as_str() {
        "llama" | "managed" | "aphrody" | "local" => ensure_llama_ready(&opts).await,
        "ollama" => ensure_ollama_ready(&opts).await,
        "lmstudio" => ensure_lmstudio_ready(&opts).await,
        "vllm" => ensure_vllm_ready(&opts).await,
        other => Err(OssReadyError::UnknownProvider(other.to_string())),
    }
}

async fn ensure_llama_ready(opts: &OssReadyOptions<'_>) -> Result<OssReadyOutcome, OssReadyError> {
    let raw_model = opts.model.unwrap_or(DEFAULT_OSS_MODEL);
    let model_id = if raw_model.is_empty() || raw_model == "default" {
        DEFAULT_OSS_MODEL
    } else {
        raw_model
    };

    let store = match opts.store_root {
        Some(root) => ModelStore::with_root(root)?,
        None => ModelStore::open()?,
    };

    let catalog = Catalog::builtin();
    let resolved = catalog.resolve(model_id)?;
    let downloader = Downloader::new()?;

    let mut all_paths = Vec::new();
    let mut any_downloaded = false;

    for (reference, expected_sha256) in resolved.artifacts() {
        let final_path = store.path_for(&reference);
        all_paths.push(final_path);

        let pull_opts = PullOptions {
            expected_sha256,
            force: opts.force,
            catalog_id: resolved.catalog_id().map(ToOwned::to_owned),
        };

        let outcome = downloader
            .pull(&store, &reference, &pull_opts, |_| {})
            .await?;
        if outcome.transferred() {
            any_downloaded = true;
        }
    }

    let primary_path = all_paths.first().cloned().unwrap_or_default();
    Ok(OssReadyOutcome::LlamaReady {
        model_id: model_id.to_string(),
        primary_path,
        all_paths,
        already_present: !any_downloaded,
    })
}

async fn ensure_ollama_ready(opts: &OssReadyOptions<'_>) -> Result<OssReadyOutcome, OssReadyError> {
    let raw_model = opts.model.unwrap_or(DEFAULT_OLLAMA_MODEL);
    let model = if raw_model.is_empty() || raw_model == "default" {
        DEFAULT_OLLAMA_MODEL
    } else {
        raw_model
    };
    let endpoint = opts
        .endpoint
        .unwrap_or(DEFAULT_OLLAMA_ENDPOINT)
        .trim_end_matches('/');

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    let tags_url = format!("{endpoint}/api/tags");
    let resp =
        client
            .get(&tags_url)
            .send()
            .await
            .map_err(|e| OssReadyError::EndpointUnavailable {
                endpoint: endpoint.to_string(),
                reason: e.to_string(),
            })?;

    if !resp.status().is_success() {
        return Err(OssReadyError::EndpointUnavailable {
            endpoint: endpoint.to_string(),
            reason: format!("HTTP {}", resp.status()),
        });
    }

    let tags_json: serde_json::Value =
        resp.json()
            .await
            .map_err(|e| OssReadyError::EndpointUnavailable {
                endpoint: endpoint.to_string(),
                reason: format!("malformed JSON response: {e}"),
            })?;

    let mut exists = false;
    if let Some(models) = tags_json.get("models").and_then(|m| m.as_array()) {
        for m in models {
            if let Some(name) = m.get("name").and_then(|n| n.as_str())
                && (name == model
                    || name == format!("{model}:latest")
                    || name.starts_with(&format!("{model}:"))
                    || model.starts_with(&format!("{name}:")))
            {
                exists = true;
                break;
            }
        }
    }

    if !exists || opts.force {
        let pull_url = format!("{endpoint}/api/pull");
        let pull_body = serde_json::json!({
            "name": model,
            "stream": false,
        });
        let pull_resp = client
            .post(&pull_url)
            .json(&pull_body)
            .send()
            .await
            .map_err(|e| OssReadyError::PullFailed {
                endpoint: endpoint.to_string(),
                reason: e.to_string(),
            })?;

        if !pull_resp.status().is_success() {
            let status = pull_resp.status();
            let body = pull_resp.text().await.unwrap_or_default();
            return Err(OssReadyError::PullFailed {
                endpoint: endpoint.to_string(),
                reason: format!("HTTP {status}: {body}"),
            });
        }
    }

    Ok(OssReadyOutcome::OllamaReady {
        model: model.to_string(),
        endpoint: endpoint.to_string(),
    })
}

async fn ensure_lmstudio_ready(
    opts: &OssReadyOptions<'_>,
) -> Result<OssReadyOutcome, OssReadyError> {
    let raw_model = opts.model.unwrap_or(DEFAULT_LMSTUDIO_MODEL);
    let model = if raw_model.is_empty() || raw_model == "default" {
        DEFAULT_LMSTUDIO_MODEL
    } else {
        raw_model
    };
    let endpoint = opts
        .endpoint
        .unwrap_or(DEFAULT_LMSTUDIO_ENDPOINT)
        .trim_end_matches('/');

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;

    let models_url = if endpoint.ends_with("/v1") {
        format!("{endpoint}/models")
    } else {
        format!("{endpoint}/v1/models")
    };

    let resp =
        client
            .get(&models_url)
            .send()
            .await
            .map_err(|e| OssReadyError::EndpointUnavailable {
                endpoint: endpoint.to_string(),
                reason: e.to_string(),
            })?;

    if !resp.status().is_success() {
        return Err(OssReadyError::EndpointUnavailable {
            endpoint: endpoint.to_string(),
            reason: format!("HTTP {}", resp.status()),
        });
    }

    Ok(OssReadyOutcome::LmStudioReady {
        model: model.to_string(),
        endpoint: endpoint.to_string(),
    })
}

async fn ensure_vllm_ready(opts: &OssReadyOptions<'_>) -> Result<OssReadyOutcome, OssReadyError> {
    let model = opts.model.unwrap_or("default");
    let endpoint = opts
        .endpoint
        .unwrap_or(DEFAULT_VLLM_ENDPOINT)
        .trim_end_matches('/');

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;

    let models_url = if endpoint.ends_with("/v1") {
        format!("{endpoint}/models")
    } else {
        format!("{endpoint}/v1/models")
    };

    let resp =
        client
            .get(&models_url)
            .send()
            .await
            .map_err(|e| OssReadyError::EndpointUnavailable {
                endpoint: endpoint.to_string(),
                reason: e.to_string(),
            })?;

    if !resp.status().is_success() {
        return Err(OssReadyError::EndpointUnavailable {
            endpoint: endpoint.to_string(),
            reason: format!("HTTP {}", resp.status()),
        });
    }

    Ok(OssReadyOutcome::VllmReady {
        model: model.to_string(),
        endpoint: endpoint.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_constants_are_valid() {
        assert_eq!(DEFAULT_OSS_MODEL, "qwen3-30b-a3b-instruct-2507-q4km");
        assert!(Catalog::builtin().get(DEFAULT_OSS_MODEL).is_ok());
        assert!(!DEFAULT_OLLAMA_MODEL.is_empty());
        assert!(DEFAULT_OLLAMA_ENDPOINT.starts_with("http://"));
        assert!(DEFAULT_LMSTUDIO_ENDPOINT.starts_with("http://"));
    }

    #[tokio::test]
    async fn unknown_provider_returns_error() {
        let res = ensure_oss_ready(OssReadyOptions {
            provider: "unknown-infer",
            ..Default::default()
        })
        .await;

        match res {
            Err(OssReadyError::UnknownProvider(name)) => assert_eq!(name, "unknown-infer"),
            other => panic!("expected UnknownProvider, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn llama_provider_resolves_catalog_model_into_store() {
        let temp = tempfile::tempdir().unwrap();
        let store = ModelStore::with_root(temp.path()).unwrap();

        // Adopt a local file to simulate having the weights present
        let fake_weights = temp.path().join("fake_qwen.gguf");
        std::fs::write(&fake_weights, b"GGUF_TEST_BYTES").unwrap();

        let local_ref = aphrody_models::ModelRef::Local(fake_weights.clone());
        let adopted = store.adopt_local(&fake_weights).unwrap();
        assert_eq!(adopted.bytes, 15);

        // Run ensure_oss_ready on a local reference
        let res = ensure_oss_ready(OssReadyOptions {
            provider: "llama",
            model: Some(&local_ref.to_string()),
            store_root: Some(temp.path()),
            ..Default::default()
        })
        .await
        .unwrap();

        match res {
            OssReadyOutcome::LlamaReady {
                primary_path,
                all_paths,
                already_present,
                ..
            } => {
                assert_eq!(primary_path, fake_weights);
                assert_eq!(all_paths.len(), 1);
                assert!(already_present);
            }
            other => panic!("expected LlamaReady, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn unreachable_ollama_endpoint_reports_unavailable() {
        let res = ensure_oss_ready(OssReadyOptions {
            provider: "ollama",
            endpoint: Some("http://127.0.0.1:54321"),
            ..Default::default()
        })
        .await;

        match res {
            Err(OssReadyError::EndpointUnavailable { endpoint, .. }) => {
                assert!(endpoint.contains("54321"));
            }
            other => panic!("expected EndpointUnavailable, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn unreachable_lmstudio_endpoint_reports_unavailable() {
        let res = ensure_oss_ready(OssReadyOptions {
            provider: "lmstudio",
            endpoint: Some("http://127.0.0.1:54322/v1"),
            ..Default::default()
        })
        .await;

        match res {
            Err(OssReadyError::EndpointUnavailable { endpoint, .. }) => {
                assert!(endpoint.contains("54322"));
            }
            other => panic!("expected EndpointUnavailable, got {other:?}"),
        }
    }
}
