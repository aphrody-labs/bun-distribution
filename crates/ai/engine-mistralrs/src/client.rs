// SPDX-License-Identifier: Apache-2.0
//! The public clients over mistral.rs: [`MistralRsClient`] for chat and [`MistralRsEmbedder`].
//!
//! Both are cheap to build. Construction validates the configuration, parses every option into
//! what mistral.rs takes, and stores the result; nothing is downloaded or loaded. The model loads
//! on first use, or earlier through [`MistralRsClient::load`] / [`MistralRsEmbedder::load`], and
//! every clone of a client shares that one loaded model.
//!
//! Without the `engine` feature the constructors report [`EngineError::feature_disabled`], so no
//! value of these types exists and a build that links no engine fails early and clearly.

#[cfg(feature = "engine")]
use std::sync::Arc;

use aphrody_model_client::{
    ChatTurn, EmbedClient, ModelCapabilities, ModelClient, ModelError, ModelStream,
};
use async_trait::async_trait;

use crate::config::{EmbedderConfig, EngineConfig};
#[cfg(feature = "engine")]
use crate::driver::{self, LoadSpec, SharedModel};
use crate::error::EngineError;

/// In-process client driving mistral.rs for inference.
///
/// Cloning is cheap, and clones share one lazily loaded model, so one client per process is the
/// normal shape. Capabilities read from the configuration until the model is loaded, then from
/// the model itself: with [`ModelSource::Auto`](crate::ModelSource::Auto) the pipeline (and so
/// image support) is only known after [`load`](Self::load).
#[derive(Clone)]
pub struct MistralRsClient {
    config: EngineConfig,
    #[cfg(feature = "engine")]
    shared: Arc<SharedModel>,
}

impl MistralRsClient {
    /// Create a new `MistralRsClient` with the given configuration.
    ///
    /// Cheap: the configuration is validated and parsed, nothing is loaded.
    ///
    /// # Errors
    /// [`EngineError::Config`] for an invalid configuration, and
    /// [`EngineError::feature_disabled`] if the crate is compiled without the `engine` feature.
    pub fn new(config: EngineConfig) -> Result<Self, EngineError> {
        config.validate()?;
        #[cfg(feature = "engine")]
        {
            let shared = Arc::new(SharedModel::new(LoadSpec::chat(&config)?));
            Ok(Self { config, shared })
        }
        #[cfg(not(feature = "engine"))]
        {
            let _ = config;
            Err(EngineError::feature_disabled())
        }
    }

    /// Alias of [`MistralRsClient::new`], for call sites that read as "build from a config".
    ///
    /// # Errors
    /// The same as [`MistralRsClient::new`].
    pub fn from_config(config: EngineConfig) -> Result<Self, EngineError> {
        Self::new(config)
    }

    /// The served name.
    #[must_use]
    pub fn name(&self) -> &str {
        self.config.served_name()
    }

    /// Load the model now instead of on the first request, so a caller sees a load error early
    /// (and the first answer is not delayed by it). Loading an already loaded model is a no-op.
    ///
    /// Concurrent callers share one load, and cancelling this future does not cancel it.
    ///
    /// # Errors
    /// [`EngineError::Load`] with mistral.rs' own message, or
    /// [`EngineError::feature_disabled`] without the `engine` feature.
    pub async fn load(&self) -> Result<(), EngineError> {
        #[cfg(feature = "engine")]
        {
            self.shared.get().await.map(|_| ())
        }
        #[cfg(not(feature = "engine"))]
        {
            Err(EngineError::feature_disabled())
        }
    }
}

/// What the configuration alone says the client can do.
fn declared_capabilities(config: &EngineConfig) -> ModelCapabilities {
    let images = config.model.declares_vision().unwrap_or(false);
    let context_window = config.runtime.max_model_len.and_then(|tokens| u64::try_from(tokens).ok());
    capabilities_of(images, context_window)
}

/// A mistral.rs chat model: native tool calls, reasoning content and JSON-schema constraints
/// (llguidance) always, images when the pipeline is a vision one.
fn capabilities_of(images: bool, context_window: Option<u64>) -> ModelCapabilities {
    ModelCapabilities {
        tools: true,
        images,
        reasoning: true,
        json_schema: true,
        context_window,
        ..ModelCapabilities::default()
    }
}

#[async_trait]
impl ModelClient for MistralRsClient {
    fn model_id(&self) -> &str {
        self.config.served_name()
    }

    fn capabilities(&self) -> ModelCapabilities {
        #[cfg(feature = "engine")]
        {
            if let Some(loaded) = self.shared.loaded() {
                return capabilities_of(loaded.images, loaded.context_window);
            }
        }
        declared_capabilities(&self.config)
    }

    async fn stream(&self, turn: ChatTurn) -> Result<ModelStream, ModelError> {
        #[cfg(feature = "engine")]
        {
            driver::stream_turn(&self.shared, turn).await
        }
        #[cfg(not(feature = "engine"))]
        {
            let _ = turn;
            Err(ModelError::from(EngineError::feature_disabled()))
        }
    }
}

/// In-process embedder driving mistral.rs.
///
/// Implements [`EmbedClient`], the neutral interface retrieval pipelines take, so it plugs in
/// wherever an Ollama or vLLM embedding endpoint does. Clones share one lazily loaded model.
/// Inputs longer than the model's context are refused by mistral.rs: chunk before embedding.
#[derive(Clone)]
pub struct MistralRsEmbedder {
    config: EmbedderConfig,
    #[cfg(feature = "engine")]
    shared: Arc<SharedModel>,
}

impl MistralRsEmbedder {
    /// Create a new `MistralRsEmbedder`.
    ///
    /// Cheap: the configuration is validated and parsed, nothing is loaded.
    ///
    /// # Errors
    /// [`EngineError::Config`] for an invalid configuration, and
    /// [`EngineError::feature_disabled`] if the crate is compiled without the `engine` feature.
    pub fn new(config: EmbedderConfig) -> Result<Self, EngineError> {
        config.validate()?;
        #[cfg(feature = "engine")]
        {
            let shared = Arc::new(SharedModel::new(LoadSpec::embedding(&config)?));
            Ok(Self { config, shared })
        }
        #[cfg(not(feature = "engine"))]
        {
            let _ = config;
            Err(EngineError::feature_disabled())
        }
    }

    /// The model id reported.
    #[must_use]
    pub fn model_id(&self) -> &str {
        self.config.served_name()
    }

    /// Load the model now instead of on the first call. See [`MistralRsClient::load`].
    ///
    /// # Errors
    /// [`EngineError::Load`] with mistral.rs' own message, or
    /// [`EngineError::feature_disabled`] without the `engine` feature.
    pub async fn load(&self) -> Result<(), EngineError> {
        #[cfg(feature = "engine")]
        {
            self.shared.get().await.map(|_| ())
        }
        #[cfg(not(feature = "engine"))]
        {
            Err(EngineError::feature_disabled())
        }
    }
}

#[async_trait]
impl EmbedClient for MistralRsEmbedder {
    fn embed_model_id(&self) -> &str {
        self.config.served_name()
    }

    async fn embed(&self, inputs: &[&str]) -> Result<Vec<Vec<f32>>, ModelError> {
        #[cfg(feature = "engine")]
        {
            driver::embed(&self.shared, inputs).await.map_err(ModelError::from)
        }
        #[cfg(not(feature = "engine"))]
        {
            let _ = inputs;
            Err(ModelError::from(EngineError::feature_disabled()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{ModelSource, RuntimeOptions};

    #[test]
    fn the_source_and_the_context_cap_decide_the_declared_capabilities() {
        let declared = |source: ModelSource, max_model_len: Option<usize>| {
            let runtime = RuntimeOptions { max_model_len, ..RuntimeOptions::default() };
            declared_capabilities(&EngineConfig::new(source).with_runtime(runtime))
        };
        let text = declared(ModelSource::auto("a/b"), None);
        assert!(text.tools && text.reasoning && text.json_schema);
        assert!(!text.images, "an auto source is text until a loaded model says otherwise");
        assert_eq!(text.context_window, None);

        let vision = declared(ModelSource::Vision { id: "a/b".into() }, Some(8192));
        assert!(vision.images);
        assert_eq!(vision.context_window, Some(8192));
        assert!(!declared(ModelSource::Text { id: "a/b".into() }, None).images);
    }

    #[test]
    fn an_invalid_configuration_is_refused_before_anything_else() {
        let error = MistralRsClient::new(EngineConfig::new(ModelSource::auto(" "))).err();
        assert!(matches!(error, Some(EngineError::Config(_))), "{error:?}");
        let error = MistralRsEmbedder::new(EmbedderConfig::new("")).err();
        assert!(matches!(error, Some(EngineError::Config(_))), "{error:?}");
    }

    #[cfg(not(feature = "engine"))]
    #[test]
    fn without_the_engine_feature_no_client_can_be_built() {
        let error = MistralRsClient::from_config(EngineConfig::new(ModelSource::auto("a/b")))
            .err()
            .expect("the engine is not compiled in");
        assert!(error.is_unavailable(), "{error}");
        let error = MistralRsEmbedder::new(EmbedderConfig::new("a/b")).err().expect("same");
        assert!(error.is_unavailable(), "{error}");
    }

    #[cfg(feature = "engine")]
    #[test]
    fn building_a_client_parses_the_options_but_loads_nothing() {
        let runtime = RuntimeOptions {
            isq: Some("4".into()),
            dtype: Some("bf16".into()),
            ..RuntimeOptions::default()
        };
        let client = MistralRsClient::new(
            EngineConfig::new(ModelSource::auto("Qwen/Qwen3-4B")).with_runtime(runtime),
        )
        .expect("a valid configuration builds without touching the network");
        assert_eq!(client.model_id(), "Qwen/Qwen3-4B");
        assert!(client.shared.loaded().is_none());
        assert!(!client.capabilities().images);
        assert!(client.clone().shared.loaded().is_none());
    }

    #[cfg(feature = "engine")]
    #[test]
    fn a_typo_in_an_option_fails_construction_not_the_first_request() {
        let runtime = RuntimeOptions { isq: Some("q9z".into()), ..RuntimeOptions::default() };
        let config = EngineConfig::new(ModelSource::auto("a/b")).with_runtime(runtime);
        let error = MistralRsClient::new(config).err().expect("an unknown ISQ type is refused");
        assert!(matches!(&error, EngineError::Config(text) if text.contains("isq")), "{error}");
    }

    #[cfg(feature = "engine")]
    #[tokio::test]
    async fn embedding_nothing_needs_no_model() {
        let embedder = MistralRsEmbedder::new(EmbedderConfig::new("google/embeddinggemma-300m"))
            .expect("valid");
        assert_eq!(embedder.embed_model_id(), "google/embeddinggemma-300m");
        assert!(embedder.embed(&[]).await.expect("no inputs, no work").is_empty());
    }
}
