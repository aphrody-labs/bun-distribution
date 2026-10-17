// SPDX-License-Identifier: Apache-2.0
//! Aphrody AI and RAG integration for Discord: prompt formatting, source citations and rich embeds.

use crate::types::{Embed, EmbedAuthor, EmbedField, EmbedFooter, clip};

#[derive(Debug, Clone)]
pub struct SourceCitation {
    pub title: String,
    pub url_or_path: String,
    pub score: f32,
    pub excerpt: String,
}

#[derive(Debug, Clone)]
pub struct AiResponseMetadata {
    pub model: String,
    pub latency_ms: u64,
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
    pub citations: Vec<SourceCitation>,
}

/// Builds a rich Discord Embed formatted for Aphrody AI inference answers.
pub fn build_ai_embed(question: &str, answer: &str, meta: Option<&AiResponseMetadata>) -> Embed {
    let mut fields = Vec::new();

    if let Some(m) = meta {
        let mut perf_info = format!(
            "⚡ **Model:** `{}` | **Latency:** `{}ms`",
            m.model, m.latency_ms
        );
        if let (Some(p), Some(c)) = (m.prompt_tokens, m.completion_tokens) {
            perf_info.push_str(&format!(" | **Tokens:** `p:{p}/c:{c}`"));
        }
        fields.push(EmbedField {
            name: "Performance & Model".to_string(),
            value: perf_info,
            inline: false,
        });

        if !m.citations.is_empty() {
            let mut citations_text = String::new();
            for (idx, cite) in m.citations.iter().take(4).enumerate() {
                citations_text.push_str(&format!(
                    "**[{}]** `{}` (relevance: `{:.2}`)\n> {}\n",
                    idx + 1,
                    cite.title,
                    cite.score,
                    cite.excerpt.replace('\n', " ")
                ));
            }
            fields.push(EmbedField {
                name: "Sources & Grounding (RAG)".to_string(),
                value: citations_text,
                inline: false,
            });
        }
    }

    let description = if answer.len() > 3900 {
        format!("{}… *(truncated)*", clip(answer, 3900))
    } else {
        answer.to_string()
    };

    Embed {
        title: Some(format!("Q: {}", clip(question, 250))),
        description: Some(description),
        color: Some(0x7C3AED), // Aphrody purple accent
        author: Some(EmbedAuthor {
            name: "Aphrody AI Laboratory".to_string(),
            url: Some("https://aphrody.com".to_string()),
            icon_url: None,
        }),
        footer: Some(EmbedFooter {
            text: "Autonomous In-Process Inference · Aphrody Core".to_string(),
            icon_url: None,
        }),
        fields,
        ..Default::default()
    }
}

/// Formats a list of code-graph symbols or RAG nodes for Discord.
pub fn format_code_graph_discord(nodes: &[(&str, &str, &str)]) -> Embed {
    let mut fields = Vec::new();
    for (name, kind, file_path) in nodes.iter().take(10) {
        fields.push(EmbedField {
            name: format!("{kind}: `{name}`"),
            value: format!("`{file_path}`"),
            inline: true,
        });
    }

    Embed {
        title: Some("Aphrody Native Code Graph".to_string()),
        description: Some(format!("Discovered **{}** matching symbols:", nodes.len())),
        color: Some(0x2563EB), // Blue
        fields,
        footer: Some(EmbedFooter {
            text: "Aphrody Graph Engine".to_string(),
            icon_url: None,
        }),
        ..Default::default()
    }
}
