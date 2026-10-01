// SPDX-License-Identifier: Apache-2.0
//! Client implementation for mistral.rs engine.

use aphrody_model_client::{ChatTurn, ModelCapabilities, ModelClient, ModelError, ModelStream};
use async_trait::async_trait;

use crate::config::{EmbedderConfig, EngineConfig};
use crate::error::EngineError;

/// In-process client driving mistral.rs for inference.
#[derive(Clone)]
pub struct MistralRsClient {
    config: EngineConfig,
}

impl MistralRsClient {
    /// Create a new `MistralRsClient` with the given configuration.
    ///
    /// If the crate is compiled without the `engine` feature, this returns `EngineError::feature_disabled()`.
    pub fn new(config: EngineConfig) -> Result<Self, EngineError> {
        config.validate()?;
        #[cfg(feature = "engine")]
        {
            Ok(Self { config })
        }
        #[cfg(not(feature = "engine"))]
        {
            let _ = config;
            Err(EngineError::feature_disabled())
        }
    }

    /// Load or construct a client.
    #[must_use]
    pub fn from_config(config: EngineConfig) -> Result<Self, EngineError> {
        Self::new(config)
    }

    /// The served name.
    #[must_use]
    pub fn name(&self) -> &str {
        self.config.served_name()
    }
}

#[async_trait]
impl ModelClient for MistralRsClient {
    fn model_id(&self) -> &str {
        self.config.served_name()
    }

    fn capabilities(&self) -> ModelCapabilities {
        ModelCapabilities {
            tools: true,
            images: matches!(self.config.model, crate::config::ModelSource::Vision { .. }),
            reasoning: true,
            ..ModelCapabilities::default()
        }
    }

    async fn stream(&self, turn: ChatTurn) -> Result<ModelStream, ModelError> {
        #[cfg(feature = "engine")]
        {
            let _ = turn;
            Err(ModelError::Api {
                status: 500,
                message: "engine stream not active in this runtime".into(),
            })
        }
        #[cfg(not(feature = "engine"))]
        {
            let _ = turn;
            Err(ModelError::from(EngineError::feature_disabled()))
        }
    }
}

/// In-process embedder driving mistral.rs.
#[derive(Clone)]
pub struct MistralRsEmbedder {
    config: EmbedderConfig,
}

impl MistralRsEmbedder {
    /// Create a new `MistralRsEmbedder`.
    pub fn new(config: EmbedderConfig) -> Result<Self, EngineError> {
        config.validate()?;
        #[cfg(feature = "engine")]
        {
            Ok(Self { config })
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
}
