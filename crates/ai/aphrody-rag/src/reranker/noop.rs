// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

use async_trait::async_trait;

use super::Reranker;
use crate::{error::Result, store::ScoredChunk};

/// A no-op reranker that leaves candidates in their incoming order.
#[derive(Debug, Default, Clone)]
pub struct NoopReranker {
    model_id: String,
}

impl NoopReranker {
    pub fn new() -> Self {
        Self { model_id: "noop".to_string() }
    }

    pub fn with_model_id(model_id: impl Into<String>) -> Self {
        Self { model_id: model_id.into() }
    }
}

#[async_trait]
impl Reranker for NoopReranker {
    fn model_id(&self) -> &str {
        &self.model_id
    }

    async fn rerank(&self, _query: &str, _candidates: &mut [ScoredChunk]) -> Result<()> {
        // Nothing to do; incoming ordering (e.g. from RRF fusion) is preserved.
        Ok(())
    }
}
