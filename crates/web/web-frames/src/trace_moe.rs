// SPDX-License-Identifier: Apache-2.0
//! Remote vector search against trace.moe.

use std::{sync::Arc, time::Duration};

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex;

use crate::{
    descriptor::{ColorLayoutVector, encode_color_layout},
    error::{FramesError, Result},
};

const API_BASE: &str = "https://api.trace.moe";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Quota {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub quota: Option<u64>,
    #[serde(default)]
    pub remaining: Option<u64>,
    #[serde(default)]
    pub concurrency: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceMatch {
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub episode: Value,
    #[serde(default)]
    pub from: f64,
    #[serde(default)]
    pub to: f64,
    #[serde(default)]
    pub similarity: f64,
    #[serde(default)]
    pub video: String,
    #[serde(default)]
    pub image: String,
    #[serde(default)]
    pub anilist: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceSearchResponse {
    #[serde(default)]
    pub frame_count: u64,
    #[serde(default)]
    pub error: String,
    #[serde(default)]
    pub result: Vec<TraceMatch>,
}

#[derive(Clone)]
pub struct TraceMoeClient {
    client: Client,
    base_url: String,
    api_key: Option<String>,
    last_request: Arc<Mutex<Option<tokio::time::Instant>>>,
}

impl TraceMoeClient {
    pub fn new() -> Result<Self> {
        Self::with_base_url(API_BASE)
    }

    /// Custom base URL supports local protocol tests and compatible service proxies.
    pub fn with_base_url(base_url: impl Into<String>) -> Result<Self> {
        let client = Client::builder()
            .user_agent(concat!("aphrody-web-frames/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| FramesError::TraceMoe(error.to_string()))?;
        Ok(Self {
            client,
            base_url: base_url.into().trim_end_matches('/').to_owned(),
            api_key: std::env::var("TRACE_MOE_KEY").ok().filter(|value| !value.is_empty()),
            last_request: Arc::default(),
        })
    }

    pub async fn search_by_vector(
        &self,
        vector: &ColorLayoutVector,
        anilist_id: Option<i64>,
    ) -> Result<Vec<TraceMatch>> {
        let encoded = encode_color_layout(vector)?;
        let mut url = reqwest::Url::parse(&format!("{}/search", self.base_url))
            .map_err(|e| FramesError::TraceMoe(e.to_string()))?;
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("anilistInfo", "");
            if let Some(id) = anilist_id {
                query.append_pair("anilistID", &id.to_string());
            }
        }
        let mut request = self.client.post(url).json(&serde_json::json!({ "vector": encoded }));
        if let Some(key) = &self.api_key {
            request = request.header("x-trace-key", key);
        }
        let response = self.send_rate_limited(request).await?;
        let status = response.status();
        if !status.is_success() {
            return Err(trace_status_error(status, response.text().await.unwrap_or_default()));
        }
        let response: TraceSearchResponse =
            response.json().await.map_err(|e| FramesError::TraceMoe(e.to_string()))?;
        if !response.error.is_empty() {
            return Err(FramesError::TraceMoe(response.error));
        }
        Ok(response.result)
    }

    pub async fn quota(&self) -> Result<Quota> {
        let mut request = self.client.get(format!("{}/me", self.base_url));
        if let Some(key) = &self.api_key {
            request = request.header("x-trace-key", key);
        }
        let response = self.send_rate_limited(request).await?;
        let status = response.status();
        if !status.is_success() {
            return Err(trace_status_error(status, response.text().await.unwrap_or_default()));
        }
        response.json().await.map_err(|e| FramesError::TraceMoe(e.to_string()))
    }

    async fn send_rate_limited(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<reqwest::Response> {
        let mut last_error = None;
        for attempt in 0..3 {
            {
                let mut last = self.last_request.lock().await;
                if let Some(at) = *last {
                    let delay = Duration::from_millis(250).saturating_sub(at.elapsed());
                    if !delay.is_zero() {
                        tokio::time::sleep(delay).await;
                    }
                }
                *last = Some(tokio::time::Instant::now());
            }
            match request
                .try_clone()
                .ok_or_else(|| FramesError::TraceMoe("request cannot be retried".into()))?
                .send()
                .await
            {
                Ok(response) if should_retry(response.status()) && attempt < 2 => {
                    let delay = response
                        .headers()
                        .get("retry-after")
                        .and_then(|value| value.to_str().ok())
                        .and_then(|value| value.parse::<u64>().ok())
                        .map(Duration::from_secs)
                        .unwrap_or(Duration::from_millis(300 * (attempt + 1)));
                    tokio::time::sleep(delay.min(Duration::from_secs(3))).await;
                },
                Ok(response) => return Ok(response),
                Err(error) => {
                    last_error = Some(error);
                    if attempt < 2 {
                        tokio::time::sleep(Duration::from_millis(300 * (attempt + 1))).await;
                    }
                },
            }
        }
        Err(FramesError::TraceMoe(
            last_error.map_or_else(|| "remote retries exhausted".into(), |e| e.to_string()),
        ))
    }
}

fn should_retry(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}
fn trace_status_error(status: StatusCode, body: String) -> FramesError {
    let detail = if body.trim().is_empty() {
        status.to_string()
    } else {
        format!("{status}: {}", body.trim())
    };
    FramesError::TraceMoe(detail)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_only_transient_http_statuses() {
        assert!(should_retry(StatusCode::TOO_MANY_REQUESTS));
        assert!(should_retry(StatusCode::BAD_GATEWAY));
        assert!(!should_retry(StatusCode::PAYMENT_REQUIRED));
        assert!(!should_retry(StatusCode::BAD_REQUEST));
    }
}
