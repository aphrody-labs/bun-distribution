// SPDX-License-Identifier: Apache-2.0
//! The in-process driver: everything that names a `mistralrs` type. Compiled with the `engine`
//! feature only.
//!
//! | module | job |
//! |---|---|
//! | `load` | the crate's configuration as mistral.rs builders |
//! | `shared` | the model a client loads on first use and its clones share |
//! | `request` | a planned turn as a mistral.rs request, images included |
//! | `response` | mistral.rs responses as raw chunks and errors |
//! | `stream` | one upstream response channel as one `ModelStream` |
//!
//! The pure decisions live in `plan` and `events`, which know nothing of mistral.rs. This module
//! holds the two entry points the public clients call, and nothing else.

mod load;
mod request;
mod response;
mod shared;
mod stream;

use std::sync::Arc;

use aphrody_model_client::{ChatTurn, ModelError, ModelStream};
use mistralrs::EmbeddingRequestBuilder;

use crate::error::EngineError;
use crate::plan::plan_turn;

pub(crate) use load::LoadSpec;
pub(crate) use shared::SharedModel;

/// Stream one turn: load the model if this is the first use, plan the turn for it, build the
/// request, start it.
///
/// # Errors
/// A load failure, a turn the model cannot take (`400`), or an engine failure before the first
/// event. Later failures are items of the returned stream.
pub(crate) async fn stream_turn(
    shared: &Arc<SharedModel>,
    turn: ChatTurn,
) -> Result<ModelStream, ModelError> {
    let loaded = shared.get().await?;
    let planned = plan_turn(&turn, loaded.images).map_err(request::bad_request)?;
    let request = request::build(planned).await?;
    stream::open(loaded.model, request).await
}

/// One vector per input, in input order. Loads the model on first use; no input loads nothing.
///
/// # Errors
/// A load failure, or the engine failing (an input longer than the model's context is refused
/// by mistral.rs).
pub(crate) async fn embed(
    shared: &Arc<SharedModel>,
    inputs: &[&str],
) -> Result<Vec<Vec<f32>>, EngineError> {
    if inputs.is_empty() {
        return Ok(Vec::new());
    }
    let loaded = shared.get().await?;
    let prompts = inputs.iter().map(|text| (*text).to_owned());
    let request = EmbeddingRequestBuilder::new().add_prompts(prompts);
    let vectors = loaded
        .model
        .generate_embeddings(request)
        .await
        .map_err(|error| EngineError::Inference(error.to_string()))?;
    if vectors.len() != inputs.len() {
        return Err(EngineError::Inference(format!(
            "mistral.rs returned {} vectors for {} inputs",
            vectors.len(),
            inputs.len()
        )));
    }
    Ok(vectors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::EmbedderConfig;

    fn embedder_state() -> Arc<SharedModel> {
        let spec = LoadSpec::embedding(&EmbedderConfig::new("google/embeddinggemma-300m"));
        Arc::new(SharedModel::new(spec.expect("valid configuration")))
    }

    #[test]
    fn building_the_shared_state_loads_nothing() {
        assert!(embedder_state().loaded().is_none());
    }

    #[tokio::test]
    async fn embedding_nothing_never_loads_the_model() {
        let shared = embedder_state();
        assert!(embed(&shared, &[]).await.unwrap().is_empty());
        assert!(shared.loaded().is_none());
    }
}
