// SPDX-License-Identifier: Apache-2.0
//! Resend Email API connector.
//!
//! Resend is outbound-only. Keep OVH MX/IMAP as the receiving path and use
//! this connector for transactional delivery when `RESEND_API_KEY` is set.

use std::time::Duration;

use async_trait::async_trait;
use reqwest::{Client, StatusCode, Url, header};
use serde::{Deserialize, Serialize};

use crate::connector::{
    Connector, Message, MessageError, MessageId, MessageResult, envelope_address,
    validate_mail_value,
};

/// Default Resend API endpoint.
pub const DEFAULT_API_BASE: &str = "https://api.resend.com";

/// Resend Email API connector.
#[derive(Clone)]
pub struct ResendConnector {
    api_key: String,
    api_base: Url,
    http: Client,
    default_from: Option<String>,
}

impl ResendConnector {
    /// Build a connector with an explicit API key.
    pub fn new(api_key: impl Into<String>) -> MessageResult<Self> {
        Self::with_base(api_key, DEFAULT_API_BASE)
    }

    /// Build a connector against a custom endpoint, primarily for tests.
    pub fn with_base(api_key: impl Into<String>, api_base: impl AsRef<str>) -> MessageResult<Self> {
        let api_key = api_key.into();
        if api_key.trim().is_empty() {
            return Err(MessageError::MissingConfig("RESEND_API_KEY"));
        }
        let api_base = Url::parse(api_base.as_ref())?;
        if !matches!(api_base.scheme(), "http" | "https") {
            return Err(MessageError::InvalidUrl("Resend base URL must use HTTP(S)".to_owned()));
        }
        let http = crate::http_client().timeout(Duration::from_secs(30)).build()?;
        Ok(Self { api_key, api_base, http, default_from: None })
    }

    /// Read `RESEND_API_KEY` from the environment.
    pub fn from_env() -> MessageResult<Self> {
        let key = std::env::var("RESEND_API_KEY")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .ok_or(MessageError::MissingConfig("RESEND_API_KEY"))?;
        let mut connector = Self::with_base(
            key,
            std::env::var("RESEND_API_BASE_URL").unwrap_or_else(|_| DEFAULT_API_BASE.to_owned()),
        )?;
        let from = std::env::var("MAIL_FROM")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "Aphrody <contact@aphrody.com>".to_owned());
        connector.default_from = Some(from);
        Ok(connector)
    }

    /// Set the sender used when a message has no explicit `From` value.
    pub fn with_default_from(mut self, from: impl Into<String>) -> Self {
        self.default_from = Some(from.into());
        self
    }

    fn endpoint(&self, path: &str) -> Url {
        self.api_base
            .join(path.trim_start_matches('/'))
            .expect("validated Resend base URL must support relative paths")
    }

    async fn provider_error(&self, response: reqwest::Response) -> MessageError {
        let status = response.status();
        if status == StatusCode::TOO_MANY_REQUESTS {
            let retry_after_secs = response
                .headers()
                .get(header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(0);
            return MessageError::RateLimit { retry_after_secs };
        }
        let body = response.json::<ResendError>().await.unwrap_or_default();
        MessageError::ApiError {
            code: body
                .name
                .or(body.status_code.map(|value| value.to_string()))
                .unwrap_or_else(|| status.as_str().to_owned()),
            description: body.message.unwrap_or_else(|| format!("Resend returned HTTP {status}")),
        }
    }
}

#[derive(Debug, Serialize)]
struct SendEmail<'a> {
    from: &'a str,
    to: [&'a str; 1],
    subject: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    html: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<&'a str>,
}

#[derive(Debug, Deserialize, Default)]
struct SendEmailResponse {
    id: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct ResendError {
    name: Option<String>,
    message: Option<String>,
    status_code: Option<u16>,
}

#[async_trait]
impl Connector for ResendConnector {
    fn id(&self) -> &'static str {
        "resend"
    }

    async fn send(&self, msg: Message) -> MessageResult<MessageId> {
        let from = msg
            .from
            .as_deref()
            .or(self.default_from.as_deref())
            .ok_or(MessageError::MissingConfig("MAIL_FROM"))?;
        validate_mail_value("recipient", &msg.to)?;
        validate_mail_value("from", from)?;
        if let Some(subject) = msg.subject.as_deref() {
            validate_mail_value("subject", subject)?;
        }
        if let Some(key) = msg.idempotency_key.as_deref() {
            if key.is_empty() || key.len() > 256 || key.contains(['\r', '\n', '\0']) {
                return Err(MessageError::Unexpected("invalid idempotency key".to_owned()));
            }
        }
        // Validate the envelope form even though Resend receives the friendly
        // name unchanged. This catches malformed addresses before network I/O.
        envelope_address(&msg.to)?;
        envelope_address(from)?;
        let subject = msg.subject.as_deref().unwrap_or("(no subject)");
        let body = SendEmail {
            from,
            to: [&msg.to],
            subject,
            html: (msg.parse_mode == Some(crate::connector::ParseMode::Html))
                .then_some(msg.body.as_str()),
            text: (msg.parse_mode != Some(crate::connector::ParseMode::Html))
                .then_some(msg.body.as_str()),
        };
        let mut request =
            self.http.post(self.endpoint("emails")).bearer_auth(&self.api_key).json(&body);
        if let Some(key) = msg.idempotency_key {
            request = request.header("Idempotency-Key", key);
        }
        let response = request.send().await?;
        if !response.status().is_success() {
            return Err(self.provider_error(response).await);
        }
        let result: SendEmailResponse = response.json().await?;
        result.id.filter(|id| !id.is_empty()).map(MessageId).ok_or_else(|| {
            MessageError::Unexpected("Resend response contained no email id".to_owned())
        })
    }

    async fn health(&self) -> MessageResult<()> {
        let response =
            self.http.get(self.endpoint("domains")).bearer_auth(&self.api_key).send().await?;
        if !response.status().is_success() {
            let error = self.provider_error(response).await;
            // Resend's least-privilege "Sending access" keys are deliberately
            // not allowed to list domains. The key is still usable for the
            // connector's outbound-only purpose; a real send remains the
            // authoritative end-to-end delivery check.
            if matches!(
                &error,
                MessageError::ApiError { description, .. }
                    if description.to_ascii_lowercase().contains("only send emails")
            ) {
                return Ok(());
            }
            return Err(error);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_is_emails() {
        let connector = ResendConnector::new("re_test").expect("connector");
        assert_eq!(connector.endpoint("emails").as_str(), "https://api.resend.com/emails");
    }

    #[test]
    fn rejects_non_http_base() {
        let error = ResendConnector::with_base("re_test", "ftp://example.test")
            .err()
            .expect("invalid endpoint must fail");
        assert!(matches!(error, MessageError::InvalidUrl(_)));
    }

    #[test]
    fn html_parse_mode_serialises_html_instead_of_text() {
        let body = SendEmail {
            from: "Aphrody <contact@example.test>",
            to: ["recipient@example.test"],
            subject: "subject",
            html: Some("<p>hello</p>"),
            text: None,
        };
        let value = serde_json::to_value(body).expect("serialize");
        assert_eq!(value["html"], "<p>hello</p>");
        assert!(value.get("text").is_none());
    }
}
