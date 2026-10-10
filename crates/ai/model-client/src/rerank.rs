// SPDX-License-Identifier: Apache-2.0
//! Capability traits for the model services that are not a chat stream.
//!
//! [`ModelClient`](crate::ModelClient) is the chat/turn abstraction. Retrieval
//! pipelines need two more services from a model server, and they should not
//! have to know which server provides them:
//!
//! - [`RerankClient`] — score documents against a query (cross-encoder / late
//!   interaction rerankers). Implemented by [`VllmClient`](crate::VllmClient)
//!   over vLLM's `/rerank` route.
//! - [`EmbedClient`] — turn texts into dense vectors. Implemented by
//!   [`OllamaClient`](crate::OllamaClient) (`/api/embed`) and
//!   [`VllmClient`](crate::VllmClient) (`/v1/embeddings`).
//!
//! The traits deal in plain strings and floats on purpose: a retrieval crate
//! adapts its own candidate type to them in a few lines, and a new backend
//! (a hosted Jina or Cohere endpoint, an in-process engine) only has to
//! implement the trait.

use async_trait::async_trait;

use crate::ModelError;

/// One scored document of a rerank call.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RerankHit {
    /// Position of the document in the slice handed to
    /// [`RerankClient::rerank`].
    pub index: usize,
    /// Relevance score; higher is more relevant. The scale depends on the
    /// reranker (logits or probabilities) and is only comparable within one
    /// call.
    pub score: f32,
}

/// A service that scores documents against a query.
#[async_trait]
pub trait RerankClient: Send + Sync {
    /// The reranker model this client targets.
    fn rerank_model_id(&self) -> &str;

    /// Score `documents` against `query`.
    ///
    /// The hits are ordered best first and refer to `documents` by position.
    /// With `top_n = Some(n)` at most `n` hits are returned; `None` returns
    /// every document.
    ///
    /// # Errors
    ///
    /// Transport, status and decode failures of the backing server.
    async fn rerank(
        &self,
        query: &str,
        documents: &[&str],
        top_n: Option<usize>,
    ) -> Result<Vec<RerankHit>, ModelError>;
}

/// A service that embeds texts into dense vectors.
#[async_trait]
pub trait EmbedClient: Send + Sync {
    /// The embedding model this client targets.
    fn embed_model_id(&self) -> &str;

    /// Embed `inputs`, one vector per input, in input order.
    ///
    /// # Errors
    ///
    /// Transport, status and decode failures of the backing server, and a
    /// [`ModelError::Stream`] when the server returns a different number of
    /// vectors than inputs.
    async fn embed(&self, inputs: &[&str]) -> Result<Vec<Vec<f32>>, ModelError>;
}

/// Re-align rerank `hits` to the order of the original documents.
///
/// Slot `i` holds the score of document `i`, or `None` when the hit list does
/// not mention it (a `top_n` cut). Hits whose `index` is out of range are
/// ignored. This is the shape a retrieval pipeline needs to write scores back
/// onto its own candidate list.
#[must_use]
pub fn scores_in_input_order(hits: &[RerankHit], document_count: usize) -> Vec<Option<f32>> {
    let mut scores = vec![None; document_count];
    for hit in hits {
        if let Some(slot) = scores.get_mut(hit.index) {
            *slot = Some(hit.score);
        }
    }
    scores
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[test]
    fn scores_return_to_input_order_and_ignore_out_of_range_hits() {
        let hits = [
            RerankHit { index: 2, score: 0.9 },
            RerankHit { index: 0, score: 0.1 },
            RerankHit { index: 7, score: 5.0 },
        ];
        assert_eq!(scores_in_input_order(&hits, 3), vec![Some(0.1), None, Some(0.9)]);
        assert_eq!(scores_in_input_order(&[], 2), vec![None, None]);
    }
}
