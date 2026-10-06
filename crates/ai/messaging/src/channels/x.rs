// SPDX-License-Identifier: Apache-2.0
//! # X (formerly Twitter) adapter
//!
//! Implements [`MessagingChannel`] for X **in process** through the `aphrody-x` crate (the
//! cookie-authenticated GraphQL client behind `aphrody x`). No `x-cli` executable is located,
//! spawned or parsed: the former adapter wrapped the standalone binary shipped by the Bun
//! application `bxc`, which was absorbed by `aphrody` and rewritten in Rust.
//!
//! ## Authentication
//!
//! [`XChannel::from_env`] reads, in order:
//!   1. `X_COOKIE_STRING` (full `auth_token=...; ct0=...` string);
//!   2. `X_AUTH_TOKEN` + `X_CT0` (and the optional `X_HANDLE`, `X_TRANSACTION_ID`).
//!
//! This adapter does not parse `.env` — it relies on the parent process environment. Callers
//! who load `.env` at startup will have it inherited. [`XChannel::with_session`] takes an
//! explicit [`XSession`] (for example one loaded from `~/.aphrody/x-session.json`).
//!
//! ## Mapping to the [`MessagingChannel`] trait
//!
//! X is not a chat platform, so the trait's "room" abstraction is bent:
//!
//! - `send_text(room="self", text)` → `CreateTweet` (the `room` argument is ignored; thread/reply
//!   chaining is a follow-up tick).
//! - `send_file(...)` → media upload, then a media-only post.
//! - `rooms()` → a single synthetic [`RoomInfo`] with id `"self"`, named from the profile of
//!   `X_HANDLE`.
//! - `stream_inbox()` → polls the profile timeline of `X_HANDLE` (20 tweets) every 30 s.

#![deny(unsafe_code)]

use std::{path::Path, sync::Arc};

use aphrody_x::{XClient, XError, XSession};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use futures::Stream;

use crate::channels::{
    ChannelError, InboundMessage, MessageRef, MessagingChannel, RoomInfo, RoomKind,
};

/// Polling interval for the timeline inbox stream (in seconds).
const INBOX_POLL_SECS: u64 = 30;

/// Tweets requested per poll.
const INBOX_PAGE: u32 = 20;

/// Handle polled when `X_HANDLE` is unset.
const DEFAULT_HANDLE: &str = "aphrody_code";

/// X's own `created_at` wire format (`Wed Oct 10 20:19:24 +0000 2018`).
const X_CREATED_AT_FMT: &str = "%a %b %d %H:%M:%S %z %Y";

/// Parse a tweet `created_at`, accepting X's format and RFC 3339.
fn parse_created_at(raw: Option<&str>) -> DateTime<Utc> {
    raw.and_then(|s| {
        DateTime::parse_from_str(s, X_CREATED_AT_FMT)
            .or_else(|_| DateTime::parse_from_rfc3339(s))
            .ok()
    })
    .map(|dt| dt.with_timezone(&Utc))
    .unwrap_or_default()
}

/// Map an `aphrody-x` failure to the channel error that says the same thing.
fn map_x_error(error: XError) -> ChannelError {
    match error {
        XError::Api { code, message } => {
            ChannelError::PlatformApi { code: code.to_string(), message }
        },
        XError::Io(error) => ChannelError::Io(error),
        other => ChannelError::UnexpectedResponse(format!("X channel: {other}")),
    }
}

fn non_empty_env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|value| !value.is_empty())
}

/// The session described by the environment.
fn session_from_env() -> Result<XSession, ChannelError> {
    if let Some(cookie) = non_empty_env("X_COOKIE_STRING") {
        return XSession::from_cookie_string(&cookie).map_err(map_x_error);
    }
    if non_empty_env("X_AUTH_TOKEN").is_none() || non_empty_env("X_CT0").is_none() {
        // The canonical pair is reported as the missing variable: it is the more user-friendly
        // composition.
        return Err(ChannelError::MissingEnvVar("X_AUTH_TOKEN"));
    }
    XSession::from_env().map_err(map_x_error)
}

// ── Adapter ───────────────────────────────────────────────────────────────────

/// X / Twitter [`MessagingChannel`] adapter over the in-process `aphrody-x` client.
///
/// Construct via [`XChannel::from_env`] (cookies from the environment) or
/// [`XChannel::with_session`] (explicit session).
#[derive(Debug, Clone)]
pub struct XChannel {
    client: Arc<XClient>,
    /// Handle used by `stream_inbox` and `rooms` for the timeline poll target.
    /// Defaults to the value of `X_HANDLE` at construction, or `"aphrody_code"`.
    handle: String,
}

impl XChannel {
    /// Construct from an explicit session.
    ///
    /// # Errors
    /// [`ChannelError::UnexpectedResponse`] when the HTTP client cannot be built.
    pub fn with_session(session: XSession) -> Result<Self, ChannelError> {
        let handle = non_empty_env("X_HANDLE").unwrap_or_else(|| DEFAULT_HANDLE.to_owned());
        let client = XClient::new(session).map_err(map_x_error)?;
        Ok(Self { client: Arc::new(client), handle })
    }

    /// Construct from the cookie variables of the environment (see the module header).
    ///
    /// Checked here rather than on first send: a misconfigured deploy should fail at
    /// construction, where the operator is still looking.
    ///
    /// # Errors
    /// - [`ChannelError::MissingEnvVar`] when neither `X_COOKIE_STRING` nor (`X_AUTH_TOKEN` +
    ///   `X_CT0`) is present.
    /// - [`ChannelError::UnexpectedResponse`] when the cookies are malformed.
    pub fn from_env() -> Result<Self, ChannelError> {
        Self::with_session(session_from_env()?)
    }

    /// Override the polling-target handle used by [`Self::stream_inbox`].
    pub fn with_handle(mut self, handle: impl Into<String>) -> Self {
        self.handle = handle.into();
        self
    }
}

#[async_trait]
impl MessagingChannel for XChannel {
    fn id(&self) -> &str {
        "x"
    }

    /// Post a new tweet.  `room` is currently ignored; reply / thread
    /// chaining is a follow-up tick.
    async fn send_text(&self, _room: &str, text: &str) -> Result<MessageRef, ChannelError> {
        let tweet = self.client.create_tweet(text, None).await.map_err(map_x_error)?;
        Ok(MessageRef { id: tweet.id, room: "self".to_owned(), channel_id: self.id().to_owned() })
    }

    /// Publish a media-only post. The media type is detected from the file extension; the
    /// trait's MIME hint is not needed by the upload.
    async fn send_file(
        &self,
        _room: &str,
        path: &Path,
        _mime: &str,
    ) -> Result<MessageRef, ChannelError> {
        tokio::fs::metadata(path).await.and_then(|metadata| {
            if metadata.is_file() {
                Ok(())
            } else {
                Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "media path is not a file",
                ))
            }
        })?;
        let media_id = self.client.upload_media(path, None).await.map_err(map_x_error)?;
        let tweet = self
            .client
            .create_tweet_with_media("", None, &[media_id])
            .await
            .map_err(map_x_error)?;
        Ok(MessageRef { id: tweet.id, room: "self".to_owned(), channel_id: self.id().to_owned() })
    }

    /// Polls the profile timeline of the configured handle (20 tweets).
    ///
    /// Each new tweet (snowflake ID greater than the last seen) is yielded as an
    /// [`InboundMessage`].  The poll interval is [`INBOX_POLL_SECS`]. A failed poll surfaces as an
    /// `Err` item and the next poll goes on.
    async fn stream_inbox(
        &self,
    ) -> Result<impl Stream<Item = Result<InboundMessage, ChannelError>>, ChannelError> {
        let client = Arc::clone(&self.client);
        let handle = self.handle.clone();

        let stream = async_stream::stream! {
            let mut user_id: Option<String> = None;
            let mut latest_id: Option<String> = None;

            loop {
                let id = match &user_id {
                    Some(id) => Ok(id.clone()),
                    None => client.user_by_screen_name(&handle).await.map(|user| user.id),
                };
                let page = match id {
                    Ok(id) => {
                        user_id = Some(id.clone());
                        client.user_tweets(&id, INBOX_PAGE, None, 1).await
                    },
                    Err(error) => Err(error),
                };

                match page {
                    Err(error) => {
                        yield Err(map_x_error(error));
                    },
                    Ok(page) => {
                        // Sort oldest-first so the cursor advances monotonically.
                        let mut sorted = page.tweets;
                        sorted.sort_by(|a, b| a.id.cmp(&b.id));

                        for tweet in sorted {
                            let cursor_advanced =
                                latest_id.as_deref().is_none_or(|cur| tweet.id.as_str() > cur);
                            if !cursor_advanced {
                                continue;
                            }
                            latest_id = Some(tweet.id.clone());

                            let sender = if tweet.author.username.is_empty() {
                                handle.clone()
                            } else {
                                tweet.author.username
                            };
                            yield Ok(InboundMessage {
                                id: tweet.id,
                                room: "self".to_owned(),
                                sender,
                                text: tweet.text,
                                attachments: Vec::new(),
                                timestamp: parse_created_at(tweet.created_at.as_deref()),
                            });
                        }
                    },
                }

                tokio::time::sleep(std::time::Duration::from_secs(INBOX_POLL_SECS)).await;
            }
        };

        Ok(stream)
    }

    /// Returns a single synthetic room representing the authenticated account.
    ///
    /// Looks up the profile of the configured handle to name the room.  If the lookup fails a
    /// usable stub is returned so callers can iterate without breaking.
    async fn rooms(&self) -> Result<Vec<RoomInfo>, ChannelError> {
        let name = match self.client.user_by_screen_name(&self.handle).await {
            Ok(user) => [user.name, user.screen_name]
                .into_iter()
                .find(|name| !name.is_empty())
                .unwrap_or_else(|| self.handle.clone()),
            Err(_) => self.handle.clone(),
        };

        Ok(vec![RoomInfo {
            id: "self".to_owned(),
            name,
            kind: RoomKind::DirectMessage, // closest semantic match (1:1 author = audience)
            member_count: None,
        }])
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(unsafe_code)]
mod tests {
    use super::*;
    use crate::channels::test_util::ENV_LOCK;

    fn clear_cookie_env() {
        unsafe {
            std::env::remove_var("X_COOKIE_STRING");
            std::env::remove_var("X_AUTH_TOKEN");
            std::env::remove_var("X_CT0");
        }
    }

    fn channel() -> XChannel {
        XChannel::with_session(XSession::new("auth-token", "ct0-token")).expect("offline client")
    }

    #[test]
    fn from_env_fails_without_cookies() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_cookie_env();
        let err = XChannel::from_env().unwrap_err();
        assert!(matches!(err, ChannelError::MissingEnvVar("X_AUTH_TOKEN")));
    }

    /// The in-process channel needs no executable: cookies alone make it.
    #[test]
    fn from_env_with_a_cookie_string_builds_the_channel_in_process() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_cookie_env();
        unsafe {
            std::env::set_var("X_COOKIE_STRING", "auth_token=abc; ct0=xyz");
        }
        let outcome = XChannel::from_env();
        clear_cookie_env();
        assert_eq!(outcome.expect("cookie string builds a channel").id(), "x");
    }

    #[test]
    fn from_env_with_the_token_pair_builds_the_channel() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_cookie_env();
        unsafe {
            std::env::set_var("X_AUTH_TOKEN", "abc");
            std::env::set_var("X_CT0", "xyz");
        }
        let outcome = XChannel::from_env();
        clear_cookie_env();
        assert!(outcome.is_ok(), "{outcome:?}");
    }

    #[test]
    fn a_malformed_cookie_string_names_the_missing_cookie() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_cookie_env();
        unsafe {
            std::env::set_var("X_COOKIE_STRING", "theme=dark");
        }
        let outcome = XChannel::from_env();
        clear_cookie_env();
        match outcome {
            Err(ChannelError::UnexpectedResponse(message)) => {
                assert!(message.contains("auth_token"), "{message}");
            },
            other => panic!("unexpected outcome: {other:?}"),
        }
    }

    #[test]
    fn with_handle_overrides_default() {
        let ch = channel().with_handle("yoyo_test");
        assert_eq!(ch.handle, "yoyo_test");
    }

    #[test]
    fn x_channel_id_is_x() {
        assert_eq!(channel().id(), "x");
    }

    #[test]
    fn x_errors_map_to_the_channel_error_that_says_the_same() {
        match map_x_error(XError::Api { code: 187, message: "duplicate".into() }) {
            ChannelError::PlatformApi { code, message } => {
                assert_eq!(code, "187");
                assert_eq!(message, "duplicate");
            },
            other => panic!("unexpected: {other:?}"),
        }
        assert!(matches!(
            map_x_error(XError::Io(std::io::Error::other("disk"))),
            ChannelError::Io(_)
        ));
        assert!(matches!(
            map_x_error(XError::Auth("no cookie".into())),
            ChannelError::UnexpectedResponse(_)
        ));
    }

    #[test]
    fn created_at_accepts_x_format_and_rfc3339_and_degrades() {
        assert_eq!(
            parse_created_at(Some("Wed Oct 10 20:19:24 +0000 2018")).timestamp(),
            1_539_202_764
        );
        assert_eq!(parse_created_at(Some("2026-05-18T09:47:00+00:00")).timestamp(), 1_779_097_620);
        assert_eq!(parse_created_at(None), DateTime::<Utc>::default());
        assert_eq!(parse_created_at(Some("not a date")), DateTime::<Utc>::default());
    }

    /// A missing file must fail before any network call.
    #[tokio::test]
    async fn send_file_rejects_missing_path() {
        let err =
            channel().send_file("self", Path::new("/tmp/nope.png"), "image/png").await.unwrap_err();
        assert!(matches!(err, ChannelError::Io(_)), "got: {err}");
    }

    /// An empty media file is refused by the uploader before any network call.
    #[tokio::test]
    async fn send_file_rejects_an_empty_media_file() {
        let media = tempfile::Builder::new().suffix(".png").tempfile().unwrap();
        let err = channel().send_file("self", media.path(), "image/png").await.unwrap_err();
        match err {
            ChannelError::UnexpectedResponse(message) => {
                assert!(message.contains("empty"), "{message}");
            },
            other => panic!("unexpected: {other}"),
        }
    }
}
