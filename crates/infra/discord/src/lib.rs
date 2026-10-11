// SPDX-License-Identifier: Apache-2.0
//! # aphrody-discord
//!
//! Native Discord engine for Aphrody:
//! - Ed25519 webhook signature verification (ring).
//! - Asynchronous REST API v10 client with rate-limiting and multipart file upload.
//! - Embed builders for AI answers (model, latency, citations) supplied by the caller.
//! - Web unfurls: literal-address SSRF guard, HTML-to-markdown extraction.
//! - Shell receipts: platform shell run with a wall-clock timeout.
//! - Bot wrapper (status, send, upload, signed interaction handling) and CLI bindings.

pub mod ai;
pub mod bot;
pub mod crypto;
pub mod rest;
pub mod shell;
pub mod types;
aphrody_web_source::module!("crates/infra/discord/src/web.rs", pub mod web);

pub use ai::{AiResponseMetadata, SourceCitation, build_ai_embed, format_code_graph_discord};
pub use bot::{AphrodyDiscordBot, BotConfig, BotStatus};
pub use crypto::verify_interaction_signature;
pub use rest::{AuthMode, DEFAULT_DISCORD_API, DiscordClient};
pub use shell::{ShellExecutionResult, build_shell_embed, run_bounded_shell};
pub use types::*;
pub use web::{WebPageSummary, build_web_embed, fetch_and_extract_web, is_safe_public_url};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_types_serialization() {
        let embed = Embed {
            title: Some("Test Embed".to_string()),
            description: Some("Hello Aphrody Discord".to_string()),
            color: Some(0x7C3AED),
            fields: vec![EmbedField {
                name: "Field 1".to_string(),
                value: "Value 1".to_string(),
                inline: true,
            }],
            ..Default::default()
        };

        let json = serde_json::to_string(&embed).expect("Serialization failed");
        assert!(json.contains("Test Embed"));
        assert!(json.contains("Hello Aphrody Discord"));
    }

    #[test]
    fn test_interaction_response_factories() {
        let pong = InteractionResponse::pong();
        assert_eq!(pong.kind, 1);

        let msg = InteractionResponse::message("Test message");
        assert_eq!(msg.kind, 4);
        assert_eq!(msg.data.unwrap().content.as_deref(), Some("Test message"));

        let ephemeral = InteractionResponse::ephemeral("Secret");
        assert_eq!(ephemeral.data.unwrap().flags, Some(64));
    }

    #[test]
    fn test_ai_embed_generation() {
        let meta = AiResponseMetadata {
            model: "gemma4-e2b".to_string(),
            latency_ms: 42,
            prompt_tokens: Some(10),
            completion_tokens: Some(25),
            citations: vec![SourceCitation {
                title: "Rust Guide".to_string(),
                url_or_path: "docs/rust.md".to_string(),
                score: 0.95,
                excerpt: "Rust is safe.".to_string(),
            }],
        };

        let embed = build_ai_embed("How is Rust?", "Rust ensures memory safety.", Some(&meta));
        assert_eq!(embed.title.as_deref(), Some("Q: How is Rust?"));
        assert_eq!(embed.fields.len(), 2);
    }

    #[test]
    fn test_embeds_truncate_on_char_boundaries() {
        let long = "é".repeat(3000);
        let embed = build_ai_embed(&long, &long, None);
        assert!(embed.title.unwrap().starts_with("Q: é"));
        assert!(embed.description.unwrap().ends_with("*(truncated)*"));

        let res = ShellExecutionResult {
            command: long.clone(),
            exit_code: Some(0),
            stdout: long.clone(),
            stderr: long,
            duration_ms: 1,
            success: true,
        };
        assert_eq!(build_shell_embed(&res).fields.len(), 3);
    }

    #[test]
    fn test_web_embed_generation() {
        let summary = WebPageSummary {
            url: "https://example.com/article".to_string(),
            title: "Example Article".to_string(),
            description: "An informative article.".to_string(),
            canonical_url: Some("https://example.com/canonical".to_string()),
            markdown_content: "Full markdown content.".to_string(),
            image_url: None,
        };

        let embed = build_web_embed(&summary);
        assert_eq!(embed.title.as_deref(), Some("Example Article"));
        assert_eq!(embed.fields.len(), 1);
    }
}
