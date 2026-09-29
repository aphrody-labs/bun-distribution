// SPDX-License-Identifier: Apache-2.0
//! # aphrody-messaging
//!
//! Unified messaging crate combining:
//!
//! - **Outbound connectors** (`connector`, `slack`, `telegram`, `email`) — minimal, object-safe
//!   [`Connector`] trait for alerting / notification.
//! - **Bidirectional channels** ([`channels`]) — full [`channels::MessagingChannel`] trait with
//!   attachments, inbox streaming, room listing (Slack, Telegram, Matrix, Discord, X). Merged from
//!   the former `aphrody-channels` crate.
//!
//! ## Layering
//!
//! ```text
//!  channels::MessagingChannel (rich, bidirectional)
//!      Discord / Slack / Telegram / Matrix / X
//!
//!  connector::Connector (minimal, outbound-only)
//!      TelegramConnector / SlackConnector / SmtpConnector
//! ```

#![deny(unsafe_code)]

#[cfg(not(target_arch = "wasm32"))] pub mod config;
pub mod connector;
pub mod resend;
pub mod slack;
pub mod telegram;

#[cfg(not(target_arch = "wasm32"))] pub mod email;

// Bidirectional messaging channels — merged from the former `aphrody-channels` crate.
pub mod channels;

/// HTTP client builder shared by every connector.
///
/// reqwest is built with `rustls-no-provider`, so a process-wide rustls crypto
/// provider must exist before a `Client` is built, or building panics. This
/// installs ring once (a no-op when a provider is already installed).
pub(crate) fn http_client() -> reqwest::ClientBuilder {
    #[cfg(not(target_arch = "wasm32"))]
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder().user_agent(concat!("aphrody-messaging/", env!("CARGO_PKG_VERSION")))
}

#[cfg(not(target_arch = "wasm32"))]
pub use config::{MailConnector, MailProvider};
pub use connector::{Connector, Message, MessageError, MessageId, MessageResult, ParseMode};
#[cfg(not(target_arch = "wasm32"))] pub use email::{SmtpConnector, TlsMode};
pub use resend::ResendConnector;
pub use slack::SlackConnector;
pub use telegram::TelegramConnector;
