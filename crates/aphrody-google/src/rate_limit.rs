// SPDX-License-Identifier: Apache-2.0
//! Adaptive Google request pacing shared by callers of the search and fetch APIs.

use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime},
};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitConfig {
    pub capacity: f64,
    pub refill_per_sec: f64,
    pub min_rate: f64,
    pub max_rate: f64,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            capacity: 10.0,
            refill_per_sec: 2.0,
            min_rate: 0.25,
            max_rate: 10.0,
        }
    }
}

#[derive(Debug)]
struct BucketState {
    tokens: f64,
    refill_rate: f64,
    last_refill: Instant,
}

/// Cloneable token bucket; callers can share a single instance per host.
#[derive(Debug, Clone)]
pub struct AdaptiveTokenBucket {
    config: RateLimitConfig,
    state: Arc<Mutex<BucketState>>,
}

impl AdaptiveTokenBucket {
    pub fn new(config: RateLimitConfig) -> Result<Self, &'static str> {
        if !config.capacity.is_finite()
            || config.capacity < 1.0
            || !config.refill_per_sec.is_finite()
            || config.refill_per_sec <= 0.0
            || !config.min_rate.is_finite()
            || config.min_rate <= 0.0
            || !config.max_rate.is_finite()
            || config.max_rate < config.min_rate
        {
            return Err("invalid Google rate limit configuration");
        }
        Ok(Self {
            state: Arc::new(Mutex::new(BucketState {
                tokens: config.capacity,
                refill_rate: config
                    .refill_per_sec
                    .clamp(config.min_rate, config.max_rate),
                last_refill: Instant::now(),
            })),
            config,
        })
    }

    /// Wait for one token without holding the mutex while suspended.
    pub async fn acquire(&self) {
        loop {
            let wait = {
                let mut state = self
                    .state
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                self.refill(&mut state);
                if state.tokens >= 1.0 {
                    state.tokens -= 1.0;
                    return;
                }
                Duration::from_secs_f64(((1.0 - state.tokens) / state.refill_rate).max(0.05))
            };
            tokio::time::sleep(wait).await;
        }
    }

    pub fn observe(&self, status: u16) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.refill(&mut state);
        match status {
            429 | 503 => {
                state.refill_rate = (state.refill_rate / 2.0).max(self.config.min_rate);
                state.tokens = 0.0;
            }
            403 => state.refill_rate = (state.refill_rate * 0.7).max(self.config.min_rate),
            200..=299 => state.refill_rate = (state.refill_rate * 1.1).min(self.config.max_rate),
            _ => {}
        }
    }

    pub fn current_rate(&self) -> f64 {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .refill_rate
    }

    fn refill(&self, state: &mut BucketState) {
        let now = Instant::now();
        state.tokens = (state.tokens
            + now.duration_since(state.last_refill).as_secs_f64() * state.refill_rate)
            .min(self.config.capacity);
        state.last_refill = now;
    }
}

/// Google returns 403 with a GFE trace for some rate limits.
pub fn is_rate_limited(status: u16, has_gfe_trace: bool) -> bool {
    status == 429 || status == 403 && has_gfe_trace
}

/// Parse `Retry-After` as seconds or HTTP-date.
pub fn retry_after(retry_after: &str, now: SystemTime) -> Option<Duration> {
    if let Ok(seconds) = retry_after.trim().parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }
    let date = chrono::DateTime::parse_from_rfc2822(retry_after.trim()).ok()?;
    let target = SystemTime::UNIX_EPOCH
        .checked_add(Duration::from_secs(u64::try_from(date.timestamp()).ok()?))?;
    Some(target.duration_since(now).unwrap_or(Duration::ZERO))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn adaptive_rate_changes_after_responses() {
        let bucket = AdaptiveTokenBucket::new(RateLimitConfig::default()).unwrap();
        bucket.acquire().await;
        bucket.observe(429);
        assert_eq!(bucket.current_rate(), 1.0);
        bucket.observe(403);
        assert_eq!(bucket.current_rate(), 0.7);
        bucket.observe(200);
        assert!((bucket.current_rate() - 0.77).abs() < 1e-9);
    }

    #[test]
    fn google_headers_and_retry_after() {
        assert!(is_rate_limited(429, false));
        assert!(is_rate_limited(403, true));
        assert!(!is_rate_limited(403, false));
        assert_eq!(
            retry_after("10", SystemTime::UNIX_EPOCH),
            Some(Duration::from_secs(10))
        );
        assert_eq!(
            retry_after("Thu, 01 Jan 1970 00:00:10 +0000", SystemTime::UNIX_EPOCH),
            Some(Duration::from_secs(10))
        );
    }
}
