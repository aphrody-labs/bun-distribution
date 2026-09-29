// SPDX-License-Identifier: Apache-2.0
//! Environment-backed outbound mail selection.

use async_trait::async_trait;

use crate::{
    Connector, Message, MessageError, MessageId, MessageResult, ResendConnector, SmtpConnector,
    TlsMode,
};

/// Mail provider selected by `MAIL_PROVIDER`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MailProvider {
    /// Prefer Resend when configured, otherwise use OVH SMTP.
    Auto,
    /// Resend Email API.
    Resend,
    /// OVH SMTP (`ssl0.ovh.net`).
    Smtp,
}

impl MailProvider {
    fn from_env() -> MessageResult<Self> {
        match std::env::var("MAIL_PROVIDER")
            .unwrap_or_else(|_| "auto".to_owned())
            .to_ascii_lowercase()
            .as_str()
        {
            "auto" => Ok(Self::Auto),
            "resend" => Ok(Self::Resend),
            "smtp" | "ovh" => Ok(Self::Smtp),
            value => Err(MessageError::Unexpected(format!(
                "invalid MAIL_PROVIDER `{value}`; expected auto, resend, or smtp"
            ))),
        }
    }
}

/// Configured mail connector. Auto selection happens once at startup; a
/// failed Resend request is never silently retried through SMTP, which avoids
/// duplicate delivery.
#[derive(Clone)]
pub enum MailConnector {
    /// Resend API connector.
    Resend(ResendConnector),
    /// OVH SMTP connector.
    Smtp(SmtpConnector),
}

impl MailConnector {
    /// Construct the configured provider from process environment.
    pub fn from_env() -> MessageResult<Self> {
        let provider = MailProvider::from_env()?;
        match provider {
            MailProvider::Resend => Ok(Self::Resend(ResendConnector::from_env()?)),
            MailProvider::Smtp => Ok(Self::Smtp(smtp_from_env()?)),
            MailProvider::Auto => {
                if std::env::var("RESEND_API_KEY").ok().filter(|v| !v.trim().is_empty()).is_some() {
                    Ok(Self::Resend(ResendConnector::from_env()?))
                } else {
                    Ok(Self::Smtp(smtp_from_env()?))
                }
            },
        }
    }

    /// Stable provider name for health output and metrics.
    pub fn provider(&self) -> &'static str {
        match self {
            Self::Resend(_) => "resend",
            Self::Smtp(_) => "smtp",
        }
    }
}

#[async_trait]
impl Connector for MailConnector {
    fn id(&self) -> &'static str {
        "mail"
    }

    async fn send(&self, msg: Message) -> MessageResult<MessageId> {
        match self {
            Self::Resend(connector) => connector.send(msg).await,
            Self::Smtp(connector) => connector.send(msg).await,
        }
    }

    async fn health(&self) -> MessageResult<()> {
        match self {
            Self::Resend(connector) => connector.health().await,
            Self::Smtp(connector) => connector.health().await,
        }
    }
}

fn smtp_from_env() -> MessageResult<SmtpConnector> {
    let host = std::env::var("SMTP_HOST").unwrap_or_else(|_| "ssl0.ovh.net".to_owned());
    let port = std::env::var("SMTP_PORT")
        .unwrap_or_else(|_| "465".to_owned())
        .parse::<u16>()
        .map_err(|_| MessageError::Unexpected("SMTP_PORT must be a valid port".to_owned()))?;
    let username = std::env::var("SMTP_USER")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "contact@aphrody.com".to_owned());
    let password = std::env::var("SMTP_PASSWORD")
        .ok()
        .filter(|value| !value.is_empty())
        .ok_or(MessageError::MissingConfig("SMTP_PASSWORD"))?;
    let tls = match std::env::var("SMTP_TLS").unwrap_or_default().to_ascii_lowercase().as_str() {
        "implicit" | "implicit_tls" => TlsMode::ImplicitTls,
        "starttls" | "start_tls" => TlsMode::Starttls,
        "plain" => TlsMode::Plain,
        "" => match std::env::var("SMTP_SECURE")
            .unwrap_or_else(|_| "true".to_owned())
            .to_ascii_lowercase()
            .as_str()
        {
            "1" | "true" | "yes" => TlsMode::ImplicitTls,
            "0" | "false" | "no" => TlsMode::Starttls,
            _ => {
                return Err(MessageError::Unexpected(
                    "SMTP_SECURE must be true or false".to_owned(),
                ));
            },
        },
        _ => {
            return Err(MessageError::Unexpected(
                "SMTP_TLS must be implicit, starttls, or plain".to_owned(),
            ));
        },
    };
    let connector = SmtpConnector::new(host, port, username, password, tls);
    let default_from = std::env::var("MAIL_FROM")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Aphrody <contact@aphrody.com>".to_owned());
    Ok(connector.with_default_from(default_from))
}
