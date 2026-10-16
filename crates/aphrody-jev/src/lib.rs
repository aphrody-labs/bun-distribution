// SPDX-License-Identifier: Apache-2.0
//! Jev System One protocol shared by Bun Yolo and Rust clients.
//! Endpoint clients and HTTP serving are opt-in; the default core has no transport.

use std::{fmt, time::Duration};
#[cfg(feature = "server")]
mod cli;
#[cfg(feature = "client")]
mod client;
mod decision;
#[cfg(feature = "client")]
mod native;
pub mod protocol;
mod rag;
#[cfg(feature = "server")]
pub mod server;
mod types;
mod validate;
#[cfg(feature = "server")]
pub use cli::cli_main;
#[cfg(feature = "client")]
pub use client::{
    CLOUDFLARE_BASE_URL, EDGE_CONTEXT_TOKENS, EDGE_MODEL, Endpoint, FAILOVER_TARGET, JevMode,
    JevRouter, LOCAL_BASE_URL, RoutingPolicy, SAAS_BASE_URL,
};
pub use decision::{
    confident_choice, confident_choices, decision_output, validate_confidence_threshold,
};
#[cfg(feature = "client")]
pub use native::NativeEngine;
#[cfg(feature = "client")]
pub use rag::judge_passages;
pub use rag::{GuardPolicy, PassageVerdict, filter_and_rerank};
pub use types::{Answer, DEFAULT_MODEL, Entry, Question, Request, Response, Usage};
pub use validate::{check_request, check_response};

/// Errors of a decision call.
#[derive(Debug, thiserror::Error)]
pub enum JevError {
    /// The request is malformed and was not sent.
    #[error("invalid Jev request: {0}")]
    InvalidRequest(String),
    /// A backend answered with something other than conforming primitives.
    #[error("non-conforming Jev response: {0}")]
    Format(String),
    /// A backend refused the request with a client error (not retried).
    #[error("{backend} rejected the request with HTTP {status}: {body}")]
    Rejected {
        /// Backend that answered.
        backend: Backend,
        /// HTTP status.
        status: u16,
        /// Truncated response body.
        body: String,
    },
    /// The request cannot fit any configured backend.
    #[error("state of ~{tokens} tokens exceeds every configured backend")]
    TooLarge {
        /// Estimated input tokens.
        tokens: usize,
    },
    /// No backend is configured for this request.
    #[error("no Jev backend is configured")]
    NoBackend,
    /// Every eligible backend failed.
    #[error("all Jev backends failed: {0}")]
    Unavailable(String),
    /// Invalid configuration.
    #[error("invalid Jev configuration: {0}")]
    Config(String),
}

/// Backend identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Backend {
    /// TypeSafe SaaS.
    Saas,
    /// Cloudflare Workers AI.
    Edge,
    /// Self-hosted jeff.
    Local,
    /// Endpoint client for the product's existing local model service.
    Native,
}

impl fmt::Display for Backend {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Saas => "saas",
            Self::Edge => "edge",
            Self::Local => "local",
            Self::Native => "native",
        })
    }
}

/// A validated decision and how it was served.
#[derive(Debug, Clone)]
pub struct Decision {
    /// Conforming answers.
    pub response: Response,
    /// Backend that produced them.
    pub served_by: Backend,
    /// Wall-clock latency of the successful call.
    pub latency: Duration,
    /// Set when the primary backend was skipped or failed.
    pub failover: Option<Failover>,
}

/// Why a request did not stay on its primary backend.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failover {
    /// Primary backend.
    pub from: Backend,
    /// Backend used instead.
    pub to: Backend,
    /// Machine-readable reason.
    pub reason: String,
}
