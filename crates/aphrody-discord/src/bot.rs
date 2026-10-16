// SPDX-License-Identifier: Apache-2.0
//! Unified Discord Bot engine connecting REST, Gateway, AI, Web and Shell capabilities.

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::env;
use std::path::Path;

use crate::ai::{AiResponseMetadata, build_ai_embed};
use crate::crypto::verify_interaction_signature;
use crate::rest::DiscordClient;
use crate::shell::{build_shell_embed, run_bounded_shell};
use crate::types::{DiscordMessage, Embed, Interaction, InteractionResponse, User};
use crate::web::{build_web_embed, fetch_and_extract_web};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotConfig {
    pub token: String,
    pub client_id: Option<String>,
    pub public_key: Option<String>,
    pub guild_id: Option<String>,
}

impl BotConfig {
    /// Loads BotConfig from environment variables or a specified .env file.
    pub fn from_env() -> Result<Self> {
        let token = env::var("DISCORD_BOT_TOKEN")
            .or_else(|_| env::var("DISCORD_TOKEN"))
            .context("Missing DISCORD_BOT_TOKEN or DISCORD_TOKEN in environment")?;

        let client_id = env::var("DISCORD_CLIENT_ID").ok();
        let public_key = env::var("DISCORD_PUBLIC_KEY").ok();
        let guild_id = env::var("DISCORD_GUILD_ID").ok();

        Ok(Self { token: token.trim().to_string(), client_id, public_key, guild_id })
    }

    /// Loads BotConfig from a specific file path (e.g. `/etc/aphrody-discord.env` or `.env`).
    pub fn from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let mut token = None;
        let mut client_id = None;
        let mut public_key = None;
        let mut guild_id = None;

        for line in content.lines() {
            let line = line.trim();
            if line.starts_with('#') || line.is_empty() {
                continue;
            }
            if let Some((k, v)) = line.split_once('=') {
                let key = k.trim();
                let val = v.trim().trim_matches('"').trim_matches('\'').to_string();
                match key {
                    "DISCORD_BOT_TOKEN" | "DISCORD_TOKEN" if token.is_none() => token = Some(val),
                    "DISCORD_CLIENT_ID" => client_id = Some(val),
                    "DISCORD_PUBLIC_KEY" => public_key = Some(val),
                    "DISCORD_GUILD_ID" => guild_id = Some(val),
                    _ => {},
                }
            }
        }

        let token = token.context("Missing bot token in file")?;
        Ok(Self { token, client_id, public_key, guild_id })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotStatus {
    pub bot_user: User,
    pub guild_id: Option<String>,
    pub public_key_configured: bool,
    pub is_operational: bool,
}

pub struct AphrodyDiscordBot {
    config: BotConfig,
    client: DiscordClient,
}

impl AphrodyDiscordBot {
    pub fn new(config: BotConfig) -> Self {
        let client = DiscordClient::new(&config.token);
        Self { config, client }
    }

    pub fn client(&self) -> &DiscordClient {
        &self.client
    }

    pub fn config(&self) -> &BotConfig {
        &self.config
    }

    /// Queries Discord API to verify token identity and bot readiness.
    pub async fn check_status(&self) -> Result<BotStatus> {
        let bot_user = self.client.get_me().await?;
        Ok(BotStatus {
            bot_user,
            guild_id: self.config.guild_id.clone(),
            public_key_configured: self.config.public_key.is_some(),
            is_operational: true,
        })
    }

    /// Sends a text message to a channel.
    pub async fn send_text(&self, channel_id: &str, content: &str) -> Result<DiscordMessage> {
        self.client.send_message(channel_id, content).await
    }

    /// Sends an Embed to a channel.
    pub async fn send_embed(&self, channel_id: &str, embed: Embed) -> Result<DiscordMessage> {
        self.client.send_embed(channel_id, embed).await
    }

    /// Uploads a file with optional content to a channel.
    pub async fn upload_file(
        &self,
        channel_id: &str,
        content: Option<&str>,
        filename: &str,
        bytes: &[u8],
    ) -> Result<DiscordMessage> {
        self.client.send_file(channel_id, content, filename, bytes).await
    }

    /// Answers a question using Aphrody AI formatting and posts it to a channel.
    pub async fn answer_ai(
        &self,
        channel_id: &str,
        question: &str,
        answer: &str,
        meta: Option<&AiResponseMetadata>,
    ) -> Result<DiscordMessage> {
        let embed = build_ai_embed(question, answer, meta);
        self.client.send_embed(channel_id, embed).await
    }

    /// Fetches a web page, extracts article content, and sends a rich embed to a channel.
    pub async fn post_web_summary(&self, channel_id: &str, url: &str) -> Result<DiscordMessage> {
        let summary = fetch_and_extract_web(url).await?;
        let embed = build_web_embed(&summary);
        self.client.send_embed(channel_id, embed).await
    }

    /// Executes a bounded shell command and posts the result to a channel.
    pub async fn execute_and_post_shell(
        &self,
        channel_id: &str,
        command: &str,
    ) -> Result<DiscordMessage> {
        let res = run_bounded_shell(command).await?;
        let embed = build_shell_embed(&res);
        self.client.send_embed(channel_id, embed).await
    }

    /// Validates and handles an incoming HTTP Interaction webhook.
    pub fn handle_interaction_webhook(
        &self,
        signature: &str,
        timestamp: &str,
        body: &[u8],
    ) -> Result<InteractionResponse> {
        let Some(ref public_key) = self.config.public_key else {
            bail!("DISCORD_PUBLIC_KEY is not configured on this bot instance");
        };

        if !verify_interaction_signature(public_key, signature, timestamp, body) {
            bail!("Invalid Ed25519 webhook signature");
        }

        let interaction: Interaction = serde_json::from_slice(body)
            .context("Failed to deserialize Interaction from JSON body")?;

        match interaction.kind {
            1 => Ok(InteractionResponse::pong()), // PING
            2 => {
                // Application command
                let cmd_name = interaction
                    .data
                    .as_ref()
                    .and_then(|d| d.get("name"))
                    .and_then(|n| n.as_str())
                    .unwrap_or("unknown");

                match cmd_name {
                    "ping" => Ok(InteractionResponse::ephemeral(
                        "🏓 Pong! Aphrody Native Core is fully responsive.",
                    )),
                    "status" => {
                        let msg = format!(
                            "🤖 **Aphrody Bot Status:** Operational\nID: `{}`",
                            interaction.application_id
                        );
                        Ok(InteractionResponse::message(msg))
                    },
                    other => Ok(InteractionResponse::ephemeral(format!(
                        "Command `/{other}` acknowledged by Aphrody."
                    ))),
                }
            },
            _ => Ok(InteractionResponse::pong()),
        }
    }
}
