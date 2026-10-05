// SPDX-License-Identifier: Apache-2.0
//! aphrody-x-client — native X / Twitter control module.
//!
//! Communicates with X's private web API (GraphQL + REST v1.1) using cookie
//! authentication. Requires a valid `auth_token` + `ct0` pair extracted from
//! a logged-in X session. No X developer portal registration needed.
//!
//! # Auth
//!
//! X's private web API authenticates requests with three cooperating signals:
//!
//! 1. `Cookie: auth_token=<value>; ct0=<value>` — session cookies.
//! 2. `X-CSRF-Token: <ct0>` — the `ct0` cookie value also sent as a header (CSRF double-submit
//!    pattern). These two must match exactly.
//! 3. `Authorization: Bearer <web_bearer>` — a static public bearer token embedded in X's web
//!    bundle (not a personal token; the same value for all browsers).
//!
//! On a 401 `{"errors":[{"code":32}]}` response, the typical root cause is:
//! - `ct0` cookie value differs from `X-CSRF-Token` value.
//! - `auth_token` cookie is expired or belongs to a different domain.
//! - Missing required headers (user-agent, origin, referer).
//!
//! # Transaction-ID note
//!
//! X has progressively rolled out `x-client-transaction-id` enforcement on
//! some GraphQL mutations (CreateTweet, FavoriteTweet, etc.). This header is
//! computed client-side via a keyed HMAC over the endpoint path + nonce,
//! using a rotating key that X embeds in the main JS bundle. Reverse-
//! engineered implementations exist (Python: `xflux`, JS: `twitter-api-client`)
//! but no stable public Rust port exists yet. Without it, X may return
//! `{"errors":[{"code":353,"message":"..."}]}` on some accounts/IPs.
//!
//! This crate sets a placeholder `x-client-transaction-id` header on write
//! operations. If you hit code 353, extract the real value from a browser
//! session (DevTools → Network → CreateTweet request headers) and pass it
//! via the `XSession::transaction_id` field.

pub mod algorithm;
pub mod api;
pub mod archive;
pub mod batch;
pub mod catalog;
pub mod catalog_sync;
pub mod cli;
pub mod client;
pub mod config;
pub mod features;
pub mod ids;
pub mod media;
#[cfg(any(test, feature = "test-support"))]
pub mod mock;
pub mod news;
pub mod ops;
pub mod output;
pub mod parse;
pub mod policy;
pub mod premium;
pub mod runtime_query_ids;
pub mod session;
pub mod store;
pub mod surface;
pub mod x_pro_deck;

// X For You feed algorithm (native Rust port of core concepts from
// xai-org/x-algorithm: candidate pipeline, filters, weighted multi-action
// scorer, author diversity). Integrated here for convenient ranking of
// XClient results (timelines, search, etc.).
pub use algorithm::{
    PostCandidate as AlgoPostCandidate, RankingContext as AlgoRankingContext,
    ScoredPost as AlgoScoredPost, rank_posts as rank_posts_algo,
    rank_posts_json as rank_posts_json_algo,
};
pub use api::{ListInfo, TimelineTweet, TweetResult, UserInfo};
pub use catalog::{OpType, Operation};
pub use catalog_sync::{SyncReport, sync_catalog_file};
pub use cli::cli_main;
pub use client::{CallScope, RateLimit, XClient, XClientOptions, with_call_scope};
pub use config::Config;
pub use news::{NewsItem, NewsOptions};
pub use output::OutputMode;
pub use parse::{Author, Media, Tweet, TweetPage, User, UserPage, parse_timestamp};
pub use policy::{
    ErrorInfo, ErrorKind, Pacer, PacingOptions, RetryPolicy, classify as classify_error,
};
pub use premium::{
    PREMIUM_GRAPHQL_OPS, PRODUCT_SKUS, PremiumAccountFlags, PremiumUpsells, UpsellConfigEntry,
    parse_premium_flags, parse_upsells_response,
};
pub use runtime_query_ids::{QueryIdStore, Snapshot as QueryIdSnapshot};
pub use session::XSession;
pub use store::{Stats as StoreStats, Store, StoredTweet};
pub use surface::{
    DISCOVERY_PAGES, GRAPHQL_URL_TEMPLATE, GRYPHON_GRAPHQL_OPS, REST_V1_1_BASE, X_PRO_RECON_URLS,
};
use thiserror::Error;
pub use x_pro_deck::{
    ViewerAccountSyncResult, XProAccountSyncConfig, XProDeck, XProDeckColumn, XProDeckConfig,
    parse_viewer_account_sync,
};

/// All errors produced by this crate.
#[derive(Debug, Error)]
pub enum XError {
    /// HTTP transport error (connection refused, timeout, TLS, etc.).
    #[error("HTTP transport error: {0}")]
    Http(#[from] reqwest::Error),

    /// X API returned a structured error object (`errors[].code`).
    #[error("X API error {code}: {message}")]
    Api { code: i64, message: String },

    /// Authentication problem (missing credentials, format error, etc.).
    #[error("authentication error: {0}")]
    Auth(String),

    /// JSON deserialisation failure.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    /// I/O error (reading session file, etc.).
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// Local SQLite store error.
    #[error("store error: {0}")]
    Db(#[from] rusqlite::Error),

    /// The requested GraphQL operation name was not found in the embedded
    /// catalog.  Either the name is misspelled or the catalog needs to be
    /// re-extracted from a fresh X JS bundle.
    #[error("unknown GraphQL operation: {0}")]
    UnknownOperation(String),

    /// A request that cannot be served as written: a missing or malformed argument, an operation
    /// name this crate does not know, a destination the credentials must not be sent to. Never
    /// retried.
    #[error("invalid request: {0}")]
    Invalid(String),

    /// The operation is rate-limited and the caller's configured `max_wait`
    /// would be exceeded before the reset timestamp.  The caller should either
    /// increase `max_wait` or schedule the call after `reset_epoch`.
    #[error("rate limited until epoch {reset_epoch} (max_wait exceeded)")]
    RateLimited { reset_epoch: i64 },
}

impl XError {
    /// The HTTP status of an [`XError::Api`] built from a non-success response without a structured
    /// X error (`"HTTP 404 Not Found"`); `None` for X API codes and every other variant.
    pub fn http_status(&self) -> Option<u16> {
        match self {
            Self::Api { code, message } if message.starts_with("HTTP ") => {
                u16::try_from(*code).ok()
            },
            _ => None,
        }
    }

    /// The X API error code (`errors[].code`) of an [`XError::Api`] that is not a bare HTTP status.
    pub fn api_code(&self) -> Option<i64> {
        match self {
            Self::Api { code, message } if !message.starts_with("HTTP ") => Some(*code),
            _ => None,
        }
    }
}

/// Convenience alias used throughout the crate.
pub type Result<T> = std::result::Result<T, XError>;

/// Convert a parsed `Tweet` (from this crate's GraphQL extraction) into a
/// `PostCandidate` suitable for the X For You ranking algorithm.
///
/// `in_network` should be set to true for posts known to come from followed
/// accounts (e.g. from a HomeTimeline vs SearchTimeline).
///
/// Note: `created_at` in the source Tweet is a human string. X writes it as
/// `Wed Oct 10 20:19:24 +0000 2018` (not RFC 2822: weekday and month first, year last); that form,
/// RFC 3339 and RFC 2822 are all understood by [`parse_timestamp`]. When none matches the unix
/// timestamp is 0 (the ranker still works but its age filter is blind for that post).
pub fn tweet_to_algo_candidate(tweet: &Tweet, in_network: bool) -> algorithm::PostCandidate {
    let created_at = tweet.created_at.as_deref().and_then(parse_timestamp).unwrap_or(0);

    algorithm::PostCandidate {
        id: tweet.id.clone(),
        author_id: tweet.author_id.clone().unwrap_or_default(),
        author_handle: Some(tweet.author.username.clone()),
        text: tweet.text.clone(),
        created_at,
        like_count: tweet.like_count,
        reply_count: tweet.reply_count,
        repost_count: tweet.retweet_count,
        quote_count: tweet.quote_count,
        is_reply: tweet.in_reply_to_status_id.is_some(),
        is_repost: tweet.quoted_tweet.is_some(), // rough proxy
        has_media: !tweet.media.is_empty(),
        in_network,
    }
}

/// Rank a slice of this crate's `Tweet`s with the native X For You algorithm.
///
/// Convenience wrapper that converts + calls `algorithm::rank_posts`.
/// Returns scored candidates (with explainable `reasons`).
///
/// Example:
/// ```ignore
/// let page: TweetPage = ...;
/// let ctx = aphrody_x::algorithm::RankingContext { viewer_id: Some(uid), ..Default::default() };
/// let ranked = aphrody_x::rank_tweets(&page.tweets, ctx, 20);
/// ```
pub fn rank_tweets(
    tweets: &[Tweet],
    context: algorithm::RankingContext,
    top_k: usize,
) -> Vec<algorithm::ScoredPost> {
    let cands: Vec<_> = tweets.iter().map(|t| tweet_to_algo_candidate(t, false)).collect();
    algorithm::rank_posts(cands, &context, top_k)
}
