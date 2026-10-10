// SPDX-License-Identifier: Apache-2.0
//! Typed failures of the in-process page fetch and of the shared browser session.
//!
//! Every variant names what failed and for which URL. Nothing here routes a request through a
//! third party to hide a failure: a refused fetch is reported, not retried elsewhere.

/// Result alias for [`crate::fetch`] and [`crate::session`].
pub type Result<T> = core::result::Result<T, WebError>;

/// Everything that can go wrong fetching a page or driving the shared browser.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum WebError {
    /// The shared session does not expose this operation.
    #[error("native Web operation {operation} is unavailable: {detail}")]
    Unsupported {
        /// Requested operation.
        operation: &'static str,
        /// Why the shared session cannot serve it.
        detail: &'static str,
    },

    /// The in-process Obscura browser failed while loading a page or running a tool.
    #[error("browser navigation failed for {url}: {detail}")]
    Browser {
        /// Requested URL or tool name.
        url: String,
        /// Browser error without page contents or credentials.
        detail: String,
    },

    /// The browser did not finish before the caller's deadline.
    #[error("browser navigation for {url} exceeded {secs}s")]
    BrowserTimeout {
        /// Requested URL or tool name.
        url: String,
        /// Caller-supplied deadline in seconds.
        secs: u64,
    },

    /// A requested browser capability was not compiled into this build.
    #[error("browser profile {profile} requires the aphrody-web-service stealth feature")]
    BrowserFeatureMissing {
        /// Requested profile.
        profile: &'static str,
    },

    /// Direct HTTP failed.
    #[error("GET {url} failed: {source}")]
    Http {
        /// The URL that was requested.
        url: String,
        /// Transport error.
        #[source]
        source: Box<dyn core::error::Error + Send + Sync>,
    },

    /// The origin answered, but with an error status.
    #[error("GET {url} answered HTTP {status}")]
    HttpStatus {
        /// The URL that was requested.
        url: String,
        /// The status line.
        status: u16,
    },

    /// The caller handed over something that is not a fetchable URL.
    #[error("`{url}` is not an http(s) URL")]
    BadUrl {
        /// What was passed.
        url: String,
    },
}
