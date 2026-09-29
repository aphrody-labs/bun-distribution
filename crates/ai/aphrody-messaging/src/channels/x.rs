// SPDX-License-Identifier: Apache-2.0
//! # X (formerly Twitter) adapter
//!
//! Implements [`MessagingChannel`] for X by wrapping the standalone `x-cli`
//! binary shipped by **bxc** (`bxc/rust-bridge/crates/x-client`).
//!
//! ## Why bxc's binary and not our own
//!
//! aphrody used to carry `crates/aphrody-x-client`, a self-rooted fork of the
//! same code producing an `aphrody-x` binary. The fork was byte-identical on
//! its two load-bearing modules (`client.rs`, `parse.rs`) and four modules
//! behind on everything else (`catalog_sync`, `premium`, `surface`,
//! `x_pro_deck`), so it was deleted rather than resynced: bxc is upstream now
//! and `x-cli` is the artefact. The adapter resolves it through
//! [`aphrody_web_bridge::resolve`] so there is exactly one answer on this machine to
//! "which bxc install are we driving".
//!
//! Note that the pre-migration adapter called `aphrody-x profile` and
//! `aphrody-x latest`, **neither of which that binary ever defined** — the X
//! path could not have worked as written. The subcommands used below (`post`,
//! `user`, `user-tweets`) are the real ones, verified against `x-cli --help`.
//!
//! ## Why wrap a binary instead of linking the library?
//!
//! `x-client` is a self-rooted workspace inside the bxc repository with its
//! own lockfile; linking it would drag that lock into ours. The binary gives a
//! stable JSON contract on stdout and costs one spawn per call, which is
//! nothing next to the network round-trip it wraps.
//!
//! ## Binary resolution
//!
//! 1. `$APHRODY_X_BIN` — explicit path, must exist.
//! 2. `x-cli` sitting next to the resolved `bxc` executable (see
//!    [`aphrody_web_bridge::resolve::binary`]).
//! 3. `x-cli` on `PATH`.
//!
//! When none resolves, [`XChannel::from_env`] fails with a message naming the
//! command that repairs it.
//!
//! ## Authentication
//!
//! `x-cli` reads cookies from (in order):
//!   1. `X_COOKIE_STRING` env (full `auth_token=...; ct0=...` string).
//!   2. `X_AUTH_TOKEN` + `X_CT0` envs (composed into a minimal cookie string).
//!
//! This adapter does not parse `.env` — it relies on the parent process
//! environment. Callers who load `.env` at startup will have it inherited.
//!
//! ## Mapping to the [`MessagingChannel`] trait
//!
//! X is not a chat platform, so the trait's "room" abstraction is bent:
//!
//! - `send_text(room="self", text)` → `x-cli post <text>` (the `room` argument is ignored;
//!   thread/reply chaining is a follow-up tick).
//! - `send_file(...)` → `x-cli post "" --media <path>` (a media-only post).
//! - `rooms()` → a single synthetic [`RoomInfo`] with id `"self"`, named from `x-cli user
//!   <handle>`.
//! - `stream_inbox()` → polls `x-cli user-tweets <handle> -n 20` every 30 s. The handle is read
//!   from `X_HANDLE`.

#![deny(unsafe_code)]

use std::{path::Path, process::Stdio};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use futures::Stream;
use serde::Deserialize;
use tokio::process::Command;

use crate::channels::{
    ChannelError, InboundMessage, MessageRef, MessagingChannel, RoomInfo, RoomKind,
};

/// Environment variable naming the `x-cli` executable outright.
const ENV_X_BIN: &str = "APHRODY_X_BIN";

/// Platform file name of the `x-cli` executable.
const X_BIN_NAME: &str = if cfg!(windows) { "x-cli.exe" } else { "x-cli" };

/// Polling interval for the timeline inbox stream (in seconds).
const INBOX_POLL_SECS: u64 = 30;

/// X's own `created_at` wire format (`Wed Oct 10 20:19:24 +0000 2018`).
const X_CREATED_AT_FMT: &str = "%a %b %d %H:%M:%S %z %Y";

// ── Binary resolution ─────────────────────────────────────────────────────────

/// Locate the `x-cli` executable.
///
/// Returns `None` only when nothing on this machine looks like `x-cli`; the
/// caller turns that into an actionable error rather than letting `exec` fail
/// later with a bare `NotFound` that names no repair.
#[cfg(not(target_arch = "wasm32"))]
fn resolve_x_binary() -> Option<String> {
    use std::path::PathBuf;

    if let Ok(explicit) = std::env::var(ENV_X_BIN) {
        let p = PathBuf::from(explicit.trim());
        if p.is_file() {
            return Some(p.to_string_lossy().into_owned());
        }
    }

    // Sibling of the resolved `bxc` executable: `x-cli` ships from the same
    // repository and installs into the same bin directory.
    if let Ok(bxc) = aphrody_web_bridge::resolve::binary()
        && let Some(dir) = bxc.path().parent()
    {
        let cand = dir.join(X_BIN_NAME);
        if cand.is_file() {
            return Some(cand.to_string_lossy().into_owned());
        }
    }

    let dirs = std::env::var_os("PATH")
        .map(|raw| std::env::split_paths(&raw).collect::<Vec<_>>())
        .unwrap_or_default();
    for dir in dirs {
        let cand = dir.join(X_BIN_NAME);
        if cand.is_file() {
            return Some(cand.to_string_lossy().into_owned());
        }
    }
    None
}

/// wasm32 has no process to spawn; the caller reports the failure.
#[cfg(target_arch = "wasm32")]
fn resolve_x_binary() -> Option<String> {
    None
}

// ── Wire types ────────────────────────────────────────────────────────────────

/// Shape of `x-cli user <handle>` on stdout (`x_client::api::UserInfo`).
#[derive(Debug, Deserialize)]
struct XUserInfo {
    /// Numeric user REST id (e.g. `"2244994945"`).
    #[allow(dead_code)] // part of the documented contract, not surfaced yet
    id: String,
    /// Display name.
    #[serde(default)]
    name: Option<String>,
    /// Handle without the leading `@`.
    #[serde(default)]
    screen_name: Option<String>,
}

/// Shape of `x-cli post <text>` on stdout (`x_client::api::TweetResult`).
#[derive(Debug, Deserialize)]
struct XPostResult {
    /// Numeric id of the created tweet.
    id: String,
}

/// Author sub-object of a parsed tweet (`x_client::parse::Author`).
#[derive(Debug, Deserialize)]
struct XAuthor {
    /// Handle without the leading `@`.
    #[serde(default)]
    username: String,
}

/// One tweet as emitted by `x-cli user-tweets` (`x_client::parse::Tweet`).
///
/// Only the fields the adapter surfaces are declared; unknown fields are
/// ignored, which is what keeps this resilient to upstream additions.
#[derive(Debug, Deserialize)]
struct XTweet {
    /// Tweet id snowflake.
    id: String,
    /// Tweet body text.
    #[serde(default)]
    text: String,
    /// Author handle + display name.
    #[serde(default)]
    author: Option<XAuthor>,
    /// Creation timestamp in X's own format; RFC 3339 is also accepted.
    #[serde(default)]
    created_at: Option<String>,
}

/// Envelope printed by `x_client::output::print_tweets`.
#[derive(Debug, Deserialize)]
struct XTimelinePage {
    /// The page's tweets, newest first.
    #[serde(default)]
    tweets: Vec<XTweet>,
}

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

// ── Adapter ───────────────────────────────────────────────────────────────────

/// X / Twitter [`MessagingChannel`] adapter wrapping the bxc `x-cli` binary.
///
/// Construct via [`XChannel::from_env`] (resolves `x-cli`, see the module
/// header) or [`XChannel::with_binary`] for a custom path (useful in tests).
#[derive(Debug, Clone)]
pub struct XChannel {
    /// Path or name of the `x-cli` binary. Resolved by the OS at exec.
    binary: String,
    /// Handle used by `stream_inbox` for the timeline poll target.
    /// Defaults to the value of `X_HANDLE` at construction, or `"aphrody_code"`.
    handle: String,
}

impl XChannel {
    /// Construct with a custom binary path (or name on `PATH`).
    pub fn with_binary(binary: impl Into<String>) -> Self {
        let handle = std::env::var("X_HANDLE").unwrap_or_else(|_| "aphrody_code".to_owned());
        Self { binary: binary.into(), handle }
    }

    /// Construct by resolving `x-cli` and verifying cookie configuration.
    ///
    /// Both checks happen here rather than on first send: a misconfigured
    /// deploy should fail at construction, where the operator is still looking.
    ///
    /// # Errors
    /// - [`ChannelError::MissingEnvVar`] when neither `X_COOKIE_STRING` nor (`X_AUTH_TOKEN` +
    ///   `X_CT0`) is present.
    /// - [`ChannelError::UnexpectedResponse`] when no `x-cli` can be found; the message names the
    ///   build command that produces it.
    pub fn from_env() -> Result<Self, ChannelError> {
        let has_cookie = std::env::var("X_COOKIE_STRING").map(|s| !s.is_empty()).unwrap_or(false);
        let has_pair = std::env::var("X_AUTH_TOKEN").map(|s| !s.is_empty()).unwrap_or(false)
            && std::env::var("X_CT0").map(|s| !s.is_empty()).unwrap_or(false);
        if !has_cookie && !has_pair {
            // We report the canonical pair as the missing var — it is the
            // more user-friendly composition.
            return Err(ChannelError::MissingEnvVar("X_AUTH_TOKEN"));
        }
        let binary = resolve_x_binary().ok_or_else(|| {
            ChannelError::UnexpectedResponse(format!(
                "X channel: `{X_BIN_NAME}` not found (checked ${ENV_X_BIN}, the bxc bin \
                 directory, and PATH). Build it with `cargo build --release -p aphrody-x` in \
                 bxc/rust-bridge and put the binary next to `bxc`, or set ${ENV_X_BIN}."
            ))
        })?;
        Ok(Self::with_binary(binary))
    }

    /// Override the polling-target handle used by [`Self::stream_inbox`].
    pub fn with_handle(mut self, handle: impl Into<String>) -> Self {
        self.handle = handle.into();
        self
    }

    /// Run `x-cli <args...>` and return its stdout on exit code 0.
    ///
    /// stderr is surfaced inside the error message (the binary writes
    /// human-friendly error strings; the JSON contract is stdout-only).
    async fn run(&self, args: &[&str]) -> Result<String, ChannelError> {
        let output = Command::new(&self.binary)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(ChannelError::Io)?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(ChannelError::PlatformApi {
                code: output
                    .status
                    .code()
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| "signal".into()),
                message: format!("{} {args:?} failed: {stderr}", self.binary),
            });
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
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
        let stdout = self.run(&["post", text]).await?;
        let resp: XPostResult = serde_json::from_str(&stdout).map_err(|e| {
            ChannelError::UnexpectedResponse(format!("could not parse `x-cli post` output: {e}"))
        })?;

        Ok(MessageRef { id: resp.id, room: "self".to_owned(), channel_id: self.id().to_owned() })
    }

    /// Publish a media-only post. `x-cli` detects the media type from the file;
    /// the trait's MIME hint is not needed by its `post --media` interface.
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
        let media = path.to_str().ok_or_else(|| {
            ChannelError::UnexpectedResponse("media path is not valid UTF-8".to_owned())
        })?;
        let stdout = self.run(&["post", "", "--media", media]).await?;
        let resp: XPostResult = serde_json::from_str(&stdout).map_err(|error| {
            ChannelError::UnexpectedResponse(format!(
                "could not parse `x-cli post --media` output: {error}"
            ))
        })?;
        Ok(MessageRef { id: resp.id, room: "self".to_owned(), channel_id: self.id().to_owned() })
    }

    /// Polls the user's recent tweets via `x-cli user-tweets <handle> -n 20`.
    ///
    /// Each new tweet (snowflake ID greater than the last seen) is yielded
    /// as an [`InboundMessage`].  The poll interval is [`INBOX_POLL_SECS`].
    async fn stream_inbox(
        &self,
    ) -> Result<impl Stream<Item = Result<InboundMessage, ChannelError>>, ChannelError> {
        let binary = self.binary.clone();
        let handle = self.handle.clone();

        let stream = async_stream::try_stream! {
            let mut latest_id: Option<String> = None;

            loop {
                let output = Command::new(&binary)
                    .args(["user-tweets", &handle, "-n", "20"])
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .output()
                    .await
                    .map_err(ChannelError::Io)?;

                if !output.status.success() {
                    // Surface as a transient error item; do not break the stream.
                    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                    Err(ChannelError::PlatformApi {
                        code: output.status.code().map(|c| c.to_string()).unwrap_or_else(|| "signal".into()),
                        message: format!("x-cli user-tweets failed: {stderr}"),
                    })?;
                }

                let stdout = String::from_utf8_lossy(&output.stdout);
                let page: XTimelinePage = serde_json::from_str(&stdout).map_err(|e| {
                    ChannelError::UnexpectedResponse(format!("x-cli user-tweets decode: {e}"))
                })?;

                // Sort oldest-first so the cursor advances monotonically.
                let mut sorted = page.tweets;
                sorted.sort_by(|a, b| a.id.cmp(&b.id));

                for t in sorted {
                    let cursor_advanced = latest_id.as_deref().is_none_or(|cur| t.id.as_str() > cur);
                    if !cursor_advanced {
                        continue;
                    }
                    latest_id = Some(t.id.clone());

                    let timestamp = parse_created_at(t.created_at.as_deref());
                    let sender = t
                        .author
                        .map(|a| a.username)
                        .filter(|u| !u.is_empty())
                        .unwrap_or_else(|| handle.clone());

                    yield InboundMessage {
                        id: t.id,
                        room: "self".to_owned(),
                        sender,
                        text: t.text,
                        attachments: Vec::new(),
                        timestamp,
                    };
                }

                tokio::time::sleep(std::time::Duration::from_secs(INBOX_POLL_SECS)).await;
            }
        };

        Ok(stream)
    }

    /// Returns a single synthetic room representing the authenticated account.
    ///
    /// Calls `x-cli user <handle>` to populate the room name with the
    /// account's display name (or handle).  If the call fails we still return
    /// a usable stub so callers can iterate without breaking.
    async fn rooms(&self) -> Result<Vec<RoomInfo>, ChannelError> {
        // Best-effort profile fetch.
        let name = match self.run(&["user", &self.handle]).await {
            Ok(stdout) => match serde_json::from_str::<XUserInfo>(&stdout) {
                Ok(p) => p
                    .name
                    .filter(|s| !s.is_empty())
                    .or(p.screen_name)
                    .unwrap_or_else(|| self.handle.clone()),
                Err(_) => self.handle.clone(),
            },
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

    #[test]
    fn from_env_fails_without_cookies() {
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe {
            std::env::remove_var("X_COOKIE_STRING");
            std::env::remove_var("X_AUTH_TOKEN");
            std::env::remove_var("X_CT0");
        }
        let err = XChannel::from_env().unwrap_err();
        assert!(matches!(err, ChannelError::MissingEnvVar("X_AUTH_TOKEN")));
    }

    /// The cookie check must pass and then the resolver runs. Whichever way it
    /// lands on this machine, the outcome must be actionable: either a channel
    /// pointing at a real file, or an error naming the missing binary.
    #[test]
    fn from_env_with_cookie_string_resolves_or_explains() {
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe {
            std::env::set_var("X_COOKIE_STRING", "auth_token=abc; ct0=xyz");
            std::env::remove_var("X_AUTH_TOKEN");
            std::env::remove_var("X_CT0");
        }
        let outcome = XChannel::from_env();
        unsafe {
            std::env::remove_var("X_COOKIE_STRING");
        }
        match outcome {
            Ok(ch) => {
                assert_eq!(ch.id(), "x");
                assert!(
                    Path::new(&ch.binary).is_file(),
                    "resolver returned a non-file: {}",
                    ch.binary
                );
            },
            Err(ChannelError::UnexpectedResponse(msg)) => {
                assert!(msg.contains(X_BIN_NAME), "error must name the binary: {msg}");
                assert!(msg.contains("cargo build"), "error must name the repair: {msg}");
            },
            Err(other) => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn env_override_wins_when_it_points_at_a_file() {
        let _guard = ENV_LOCK.lock().unwrap();
        let f = tempfile::NamedTempFile::new().expect("tempfile");
        unsafe {
            std::env::set_var(ENV_X_BIN, f.path());
        }
        let resolved = resolve_x_binary();
        unsafe {
            std::env::remove_var(ENV_X_BIN);
        }
        assert_eq!(resolved.as_deref(), Some(f.path().to_string_lossy().as_ref()));
    }

    #[test]
    fn with_handle_overrides_default() {
        let ch = XChannel::with_binary(X_BIN_NAME).with_handle("yoyo_test");
        assert_eq!(ch.handle, "yoyo_test");
    }

    #[test]
    fn x_channel_id_is_x() {
        let ch = XChannel::with_binary(X_BIN_NAME);
        assert_eq!(ch.id(), "x");
    }

    #[test]
    fn post_result_extracts_id() {
        let json = r#"{"id":"1800000000000000001","text":"hello"}"#;
        let resp: XPostResult = serde_json::from_str(json).expect("deserialise");
        assert_eq!(resp.id, "1800000000000000001");
    }

    #[test]
    fn timeline_page_deserialises_x_cli_envelope() {
        let json = r#"{
            "tweets": [
                {
                    "id": "1800000000000000001",
                    "text": "hello world",
                    "author": { "username": "aphrody_code", "name": "aphrody" },
                    "created_at": "Wed Oct 10 20:19:24 +0000 2018",
                    "reply_count": 0,
                    "retweet_count": 0,
                    "like_count": 0,
                    "quote_count": 0,
                    "is_note_tweet": false
                }
            ],
            "next_cursor": null
        }"#;
        let page: XTimelinePage = serde_json::from_str(json).expect("deserialise");
        assert_eq!(page.tweets.len(), 1);
        let t = &page.tweets[0];
        assert_eq!(t.text, "hello world");
        assert_eq!(t.author.as_ref().map(|a| a.username.as_str()), Some("aphrody_code"));
        assert_eq!(parse_created_at(t.created_at.as_deref()).timestamp(), 1_539_202_764);
    }

    #[test]
    fn created_at_accepts_rfc3339_and_degrades() {
        assert_eq!(parse_created_at(Some("2026-05-18T09:47:00+00:00")).timestamp(), 1_779_097_620);
        assert_eq!(parse_created_at(None), DateTime::<Utc>::default());
        assert_eq!(parse_created_at(Some("not a date")), DateTime::<Utc>::default());
    }

    #[test]
    fn user_info_deserialises_minimal() {
        let json = r#"{"id":"37252373","name":"Fixture User","screen_name":"fixture_user"}"#;
        let p: XUserInfo = serde_json::from_str(json).expect("deserialise");
        assert_eq!(p.name.as_deref(), Some("Fixture User"));
        assert_eq!(p.screen_name.as_deref(), Some("fixture_user"));
    }

    /// Exercise of [`XChannel::send_text`]: invoke a binary guaranteed to be
    /// absent and assert the error path returns a [`ChannelError::Io`] rather
    /// than panicking.  Covers the `Command::output().await` plumbing without
    /// needing a live X account.
    #[tokio::test]
    async fn send_text_fails_cleanly_on_missing_binary() {
        let ch = XChannel::with_binary("/definitely/not/a/real/binary/x-cli-12345");
        let err = ch.send_text("self", "test tweet").await.unwrap_err();
        assert!(matches!(err, ChannelError::Io(_)), "got: {err}");
    }

    /// A missing file must fail before invoking the posting command.
    #[tokio::test]
    async fn send_file_rejects_missing_path() {
        let ch = XChannel::with_binary("/definitely/not/a/real/binary/x-cli-12345");
        let err = ch.send_file("self", Path::new("/tmp/nope.png"), "image/png").await.unwrap_err();
        assert!(matches!(err, ChannelError::Io(_)), "got: {err}");
    }

    #[tokio::test]
    async fn send_file_invokes_binary_for_existing_media() {
        let media = tempfile::NamedTempFile::new().unwrap();
        let ch = XChannel::with_binary("/definitely/not/a/real/binary/x-cli-12345");
        let err = ch.send_file("self", media.path(), "image/png").await.unwrap_err();
        assert!(matches!(err, ChannelError::Io(_)), "got: {err}");
    }
}
