// SPDX-License-Identifier: Apache-2.0
//! Native Discord REST API v10 Client with rate-limit tracking and multipart upload.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use reqwest::header::{HeaderMap, HeaderValue};
use reqwest::multipart::{Form, Part};
use reqwest::{Client, Method, Response, StatusCode};
use tracing::warn;

use crate::types::{
    Channel, DiscordMessage, Embed, Guild, InteractionResponse, MessagePayload, User,
};

pub const DEFAULT_DISCORD_API: &str = "https://discord.com/api/v10";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthMode {
    Bot,
    Bearer,
}

#[derive(Debug, Clone)]
pub struct DiscordClient {
    client: Client,
    token: Arc<String>,
    mode: AuthMode,
    base_url: String,
}

impl DiscordClient {
    pub fn new(bot_token: impl Into<String>) -> Self {
        Self::with_auth(bot_token, AuthMode::Bot)
    }

    pub fn with_bearer(bearer_token: impl Into<String>) -> Self {
        Self::with_auth(bearer_token, AuthMode::Bearer)
    }

    pub fn with_auth(token: impl Into<String>, mode: AuthMode) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("Failed to build reqwest client");

        Self {
            client,
            token: Arc::new(token.into().trim().to_string()),
            mode,
            base_url: DEFAULT_DISCORD_API.to_string(),
        }
    }

    pub fn set_base_url(&mut self, base_url: impl Into<String>) {
        self.base_url = base_url.into().trim_end_matches('/').to_string();
    }

    fn auth_header(&self) -> HeaderValue {
        let auth_str = match self.mode {
            AuthMode::Bot => format!("Bot {}", self.token),
            AuthMode::Bearer => format!("Bearer {}", self.token),
        };
        HeaderValue::from_str(&auth_str).expect("Invalid authorization header value")
    }

    async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<Response> {
        let path = path.strip_prefix('/').unwrap_or(path);
        let url = format!("{}/{}", self.base_url, path);

        let mut headers = HeaderMap::new();
        headers.insert(reqwest::header::AUTHORIZATION, self.auth_header());
        headers.insert(
            reqwest::header::USER_AGENT,
            HeaderValue::from_static("AphrodyDiscord/1.0.0 (https://aphrody.com)"),
        );

        let mut attempts = 0;
        loop {
            attempts += 1;
            let mut req = self
                .client
                .request(method.clone(), &url)
                .headers(headers.clone());

            if let Some(ref json_val) = body {
                req = req.json(json_val);
            }

            let response = req
                .send()
                .await
                .with_context(|| format!("Failed to send request to {url}"))?;
            let status = response.status();

            if status == StatusCode::TOO_MANY_REQUESTS {
                if attempts >= 3 {
                    bail!(
                        "Discord rate limit exceeded (HTTP 429) after {attempts} attempts for {url}"
                    );
                }

                #[derive(serde::Deserialize)]
                struct RateLimitResp {
                    retry_after: Option<f64>,
                }

                let wait_secs = if let Ok(data) = response.json::<RateLimitResp>().await {
                    data.retry_after.unwrap_or(1.0)
                } else {
                    1.0
                };

                let sleep_dur = Duration::from_secs_f64(wait_secs.min(5.0));
                warn!("Discord rate limited on {url}, sleeping for {sleep_dur:?}");
                tokio::time::sleep(sleep_dur).await;
                continue;
            }

            if !status.is_success() {
                let err_text = response.text().await.unwrap_or_default();
                bail!("Discord API error (HTTP {status}) on {url}: {err_text}");
            }

            return Ok(response);
        }
    }

    pub async fn get_me(&self) -> Result<User> {
        let res = self.request(Method::GET, "users/@me", None).await?;
        let user = res
            .json::<User>()
            .await
            .context("Failed to parse User JSON")?;
        Ok(user)
    }

    pub async fn get_guild(&self, guild_id: &str) -> Result<Guild> {
        let res = self
            .request(Method::GET, &format!("guilds/{guild_id}"), None)
            .await?;
        let guild = res
            .json::<Guild>()
            .await
            .context("Failed to parse Guild JSON")?;
        Ok(guild)
    }

    pub async fn get_channel(&self, channel_id: &str) -> Result<Channel> {
        let res = self
            .request(Method::GET, &format!("channels/{channel_id}"), None)
            .await?;
        let channel = res
            .json::<Channel>()
            .await
            .context("Failed to parse Channel JSON")?;
        Ok(channel)
    }

    pub async fn send_message(&self, channel_id: &str, content: &str) -> Result<DiscordMessage> {
        let payload = MessagePayload {
            content: Some(content.to_string()),
            embeds: Vec::new(),
            allowed_mentions: None,
        };
        let body = serde_json::to_value(&payload)?;
        let res = self
            .request(
                Method::POST,
                &format!("channels/{channel_id}/messages"),
                Some(body),
            )
            .await?;
        let msg = res
            .json::<DiscordMessage>()
            .await
            .context("Failed to parse DiscordMessage")?;
        Ok(msg)
    }

    pub async fn send_embed(&self, channel_id: &str, embed: Embed) -> Result<DiscordMessage> {
        let payload = MessagePayload {
            content: None,
            embeds: vec![embed],
            allowed_mentions: None,
        };
        let body = serde_json::to_value(&payload)?;
        let res = self
            .request(
                Method::POST,
                &format!("channels/{channel_id}/messages"),
                Some(body),
            )
            .await?;
        let msg = res
            .json::<DiscordMessage>()
            .await
            .context("Failed to parse DiscordMessage")?;
        Ok(msg)
    }

    pub async fn send_file(
        &self,
        channel_id: &str,
        content: Option<&str>,
        filename: &str,
        file_bytes: &[u8],
    ) -> Result<DiscordMessage> {
        let url = format!("{}/channels/{channel_id}/messages", self.base_url);

        let mut form = Form::new();

        let payload_json = serde_json::json!({
            "content": content,
            "allowed_mentions": { "parse": [] }
        });

        form = form.text("payload_json", payload_json.to_string());

        let part = Part::bytes(file_bytes.to_vec()).file_name(filename.to_string());
        form = form.part("files[0]", part);

        let res = self
            .client
            .post(&url)
            .header(reqwest::header::AUTHORIZATION, self.auth_header())
            .header(
                reqwest::header::USER_AGENT,
                HeaderValue::from_static("AphrodyDiscord/1.0.0 (https://aphrody.com)"),
            )
            .multipart(form)
            .send()
            .await
            .with_context(|| format!("Failed to send multipart request to {url}"))?;

        let status = res.status();
        if !status.is_success() {
            let err_text = res.text().await.unwrap_or_default();
            bail!("Discord API file upload error (HTTP {status}): {err_text}");
        }

        let msg = res
            .json::<DiscordMessage>()
            .await
            .context("Failed to parse DiscordMessage after file upload")?;
        Ok(msg)
    }

    pub async fn delete_message(&self, channel_id: &str, message_id: &str) -> Result<()> {
        self.request(
            Method::DELETE,
            &format!("channels/{channel_id}/messages/{message_id}"),
            None,
        )
        .await?;
        Ok(())
    }

    pub async fn respond_interaction(
        &self,
        interaction_id: &str,
        interaction_token: &str,
        response: &InteractionResponse,
    ) -> Result<()> {
        let path = format!("interactions/{interaction_id}/{interaction_token}/callback");
        let body = serde_json::to_value(response)?;
        self.request(Method::POST, &path, Some(body)).await?;
        Ok(())
    }
}
