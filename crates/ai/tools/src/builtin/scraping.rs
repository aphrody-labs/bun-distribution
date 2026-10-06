// SPDX-License-Identifier: Apache-2.0
//! Shared HTTP client and browser-identity headers for the `web_fetch` builtin.
//!
//! Two things live here, and nothing else:
//!
//! 1. **Shared client** — [`ScrapingClient`] wraps a [`reqwest::Client`] behind an [`Arc`] so
//!    cloning is cheap and every caller reuses the same connection pool.
//!    [`web_fetch`](super::web_fetch) holds exactly one of these in a `OnceLock`; building a client
//!    per request would throw away HTTP/2 multiplexing and keep-alive.
//!
//! 2. **Chrome 146 identity constants** — the `User-Agent` string and the `Sec-CH-UA-*` client-hint
//!    values Chrome 146 sends by default on a Windows 11 x64 host.  [`CHROME146_USER_AGENT`] is
//!    what the shared client is built with; the client-hint constants are data for callers that
//!    need to send the matching hint set on a request they build themselves.
//!
//! The TLS backend needs a crypto provider installed before the first client is
//! built (`rustls::crypto::ring::default_provider().install_default()`);
//! `crates/cli/src/main.rs` does that at boot.

use std::{sync::Arc, time::Duration};

use reqwest::Client;

// ---------------------------------------------------------------------------
// Chrome 146 UA + client hints
// ---------------------------------------------------------------------------

/// Chrome 146 stable User-Agent string on Windows 11 x64.
///
/// Format mirrors the frozen UA that Chrome 146 ships; the `(Windows NT 10.0;
/// Win64; x64)` platform token is the universal form sent to non-origin-trial
/// sites as of 2026.
/// The value is owned by `aphrody-web-service`, the single source for every direct fetch.
pub const CHROME146_USER_AGENT: &str = aphrody_web_service::fetch::USER_AGENT;

// ---------------------------------------------------------------------------
// Shared scraping client
// ---------------------------------------------------------------------------

/// A shared [`reqwest::Client`] configured for scraping workloads.
///
/// Clone is cheap (`Arc` inside): every clone points at the same connection
/// pool, which is the entire reason this type exists.
#[derive(Clone, Debug)]
pub struct ScrapingClient {
    inner: Arc<Client>,
}

impl ScrapingClient {
    /// Build a new [`ScrapingClient`] with the given timeout.
    ///
    /// # Errors
    ///
    /// Returns a [`reqwest::Error`] if the TLS backend fails to initialise
    /// (usually a missing crypto provider — call
    /// `rustls::crypto::ring::default_provider().install_default()` first).
    pub fn new(timeout: Duration) -> reqwest::Result<Self> {
        let client = Client::builder()
            .timeout(timeout)
            .user_agent(CHROME146_USER_AGENT)
            .connection_verbose(false)
            .pool_max_idle_per_host(16)
            .tcp_keepalive(Duration::from_secs(30))
            .build()?;
        Ok(Self { inner: Arc::new(client) })
    }

    /// Return the inner [`reqwest::Client`] for ad-hoc request building.
    #[must_use]
    pub fn inner(&self) -> &Client {
        &self.inner
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use std::sync::Once;

    use super::*;

    fn ensure_rustls_provider() {
        static INSTALL: Once = Once::new();
        INSTALL.call_once(|| {
            let _ = rustls::crypto::ring::default_provider().install_default();
        });
    }

    #[test]
    fn scraping_client_builds_and_clones() {
        ensure_rustls_provider();
        let c = ScrapingClient::new(Duration::from_secs(5)).unwrap();
        let c2 = c.clone();
        // Both clones point to the same inner Arc.
        assert!(Arc::ptr_eq(&c.inner, &c2.inner));
    }

    #[test]
    fn chrome146_ua_contains_chrome_146() {
        assert!(CHROME146_USER_AGENT.contains("Chrome/146.0.0.0"));
    }
}
