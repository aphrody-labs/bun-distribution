// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! HTTP retrieval target with politeness rate limiting and circuit breaker protection.

use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use aphrody_rag_core::eval::RetrievedHit;
use async_trait::async_trait;
use reqwest::{Client, StatusCode, header::USER_AGENT};
use serde::Deserialize;
use tokio::sync::Mutex;
use tracing::{debug, warn};

use super::{EvalTarget, TargetResponse};
use crate::error::{EvalError, Result};

/// Wire format expected from a compatible HTTP search endpoint (`hits` or `results`).
#[derive(Debug, Deserialize)]
struct HttpSearchResponse {
    #[serde(alias = "results")]
    hits: Vec<RetrievedHit>,
    #[serde(alias = "modeServed", alias = "mode_served")]
    mode: String,
}

/// HTTP retrieval target with strict politeness guards (GET-only, rate limit, circuit breaker).
pub struct HttpTarget {
    name: String,
    endpoint_url: String,
    client: Client,
    min_interval: Duration,
    max_consecutive_failures: usize,
    state: Arc<Mutex<HttpTargetState>>,
}

struct HttpTargetState {
    last_request_at: Option<Instant>,
    consecutive_failures: usize,
}

impl HttpTarget {
    /// Create a new HTTP evaluation target.
    ///
    /// Defaults to 2 QPS (500 ms spacing) and circuit breaker abort after 3 failures.
    pub fn new(endpoint_url: impl Into<String>) -> Self {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let endpoint = endpoint_url.into();
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default();

        Self {
            name: format!("http:{}", endpoint),
            endpoint_url: endpoint,
            client,
            min_interval: Duration::from_millis(500), // 2 QPS
            max_consecutive_failures: 3,
            state: Arc::new(Mutex::new(HttpTargetState {
                last_request_at: None,
                consecutive_failures: 0,
            })),
        }
    }

    /// Customize minimum interval between queries (politeness rate limit).
    pub fn with_rate_limit(mut self, min_interval: Duration) -> Self {
        self.min_interval = min_interval.max(Duration::from_millis(500));
        self
    }

    /// Customize maximum allowable consecutive failures before circuit breaker trips.
    pub fn with_max_failures(mut self, max_failures: usize) -> Self {
        self.max_consecutive_failures = max_failures.max(1);
        self
    }

    /// Set a custom HTTP client.
    pub fn with_client(mut self, client: Client) -> Self {
        self.client = client;
        self
    }
}

#[async_trait]
impl EvalTarget for HttpTarget {
    fn name(&self) -> &str {
        &self.name
    }

    async fn query(&self, query_str: &str, limit: usize) -> Result<TargetResponse> {
        // Hold the lock through the response so concurrent callers cannot
        // bypass the one-request-at-a-time limit.
        let mut state = self.state.lock().await;
        let start = Instant::now();
        loop {
            if state.consecutive_failures >= self.max_consecutive_failures {
                return Err(EvalError::CircuitBreaker {
                    consecutive_failures: state.consecutive_failures,
                    last_status: 0,
                    message: "circuit breaker is open".to_owned(),
                });
            }
            if let Some(last) = state.last_request_at {
                let wait = self.min_interval.saturating_sub(last.elapsed());
                if !wait.is_zero() {
                    tokio::time::sleep(wait).await;
                }
            }
            state.last_request_at = Some(Instant::now());
            let response = self
                .client
                .get(&self.endpoint_url)
                .query(&[("q", query_str), ("limit", &limit.to_string())])
                .header(
                    USER_AGENT,
                    "aphrody-rag-eval/1.0.0 (codex-oss; +https://aphrody.com)",
                )
                .send()
                .await;
            let response = match response {
                Ok(response) => response,
                Err(error) => {
                    state.consecutive_failures += 1;
                    warn!(
                        "HTTP query failed ({}/{}): {error}",
                        state.consecutive_failures, self.max_consecutive_failures
                    );
                    if state.consecutive_failures >= self.max_consecutive_failures {
                        return Err(EvalError::CircuitBreaker {
                            consecutive_failures: state.consecutive_failures,
                            last_status: 0,
                            message: "transport failure".to_owned(),
                        });
                    }
                    continue;
                }
            };
            let status = response.status();
            if status.is_server_error() || status == StatusCode::TOO_MANY_REQUESTS {
                state.consecutive_failures += 1;
                let status_code = status.as_u16();
                warn!(
                    "HTTP {status_code} ({}/{})",
                    state.consecutive_failures, self.max_consecutive_failures
                );
                if state.consecutive_failures >= self.max_consecutive_failures {
                    return Err(EvalError::CircuitBreaker {
                        consecutive_failures: state.consecutive_failures,
                        last_status: status_code,
                        message: format!("received HTTP {status_code}"),
                    });
                }
                continue;
            }
            if !status.is_success() {
                return Err(EvalError::Other(format!("HTTP error status {status}")));
            }
            let parsed: HttpSearchResponse = response.json().await?;
            state.consecutive_failures = 0;
            let latency_ms = start.elapsed().as_millis() as u64;
            debug!(
                "Query `{query_str}` returned {} hits (mode: {}) in {}ms",
                parsed.hits.len(),
                parsed.mode,
                latency_ms
            );
            return Ok(TargetResponse {
                hits: parsed.hits,
                mode_served: parsed.mode,
                latency_ms,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_results_require_an_explicit_served_mode() {
        assert!(serde_json::from_str::<HttpSearchResponse>(r#"{"hits":[]}"#).is_err());
        let result: HttpSearchResponse =
            serde_json::from_str(r#"{"hits":[],"mode_served":"lexical"}"#)
                .expect("served mode alias");
        assert_eq!(result.mode, "lexical");
    }
}
