// SPDX-License-Identifier: Apache-2.0
//! Responses of the native JSON endpoints, matching the pinned vLLM protocol.

use serde::Deserialize;

/// Server-side tokenization result, including optional tokenizer strings.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct TokenizeResponse {
    pub count: usize,
    pub max_model_len: usize,
    pub tokens: Vec<u64>,
    #[serde(default)]
    pub token_strs: Option<Vec<String>>,
}

/// Score of one input pair; indices follow the server's input pairing order.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ScoreResult {
    pub index: usize,
    pub score: f32,
}

/// Scores and accounting. Unknown server fields remain available in metadata.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ScoreResponse {
    pub data: Vec<ScoreResult>,
    #[serde(flatten)]
    pub metadata: serde_json::Map<String, serde_json::Value>,
}

/// Uninterpreted pooling binary output and its shape/dtype/content headers.
#[derive(Debug, Clone)]
pub struct PoolingBytes {
    pub headers: reqwest::header::HeaderMap,
    pub data: bytes::Bytes,
}
