// SPDX-License-Identifier: Apache-2.0
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Wire protocol a model provider speaks.
///
/// Mirrors `openai/codex` `codex-rs/model-provider-info/src/lib.rs` `WireApi`,
/// with one deliberate divergence: upstream removed `wire_api = "chat"`
/// entirely (Codex now speaks only the Responses API). aphrody's default
/// providers are overwhelmingly local OpenAI-compatible chat-completions
/// servers (Ollama, LM Studio, vLLM, llama-server's OpenAI-compat front end),
/// so `Chat` stays a first-class, default variant. This is an OSS-facing
/// advantage, not an oversight (see `docs/plans/codex-oss.md`, "Cross-cutting
/// rules").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum WireApi {
    /// Traditional `OpenAI` Chat Completions API (`/v1/chat/completions`).
    /// aphrody's default: most local OSS engines speak this dialect.
    #[default]
    Chat,
    /// `OpenAI` Responses API (`/v1/responses`), used by `OpenAI`, `ChatGPT`
    /// backend, and llama-server's newer front end.
    Responses,
    /// Google Antigravity / Cloud Code `streamGenerateContent` backend.
    Antigravity,
    /// Anthropic Messages API (`/v1/messages`).
    Anthropic,
}

impl WireApi {
    /// Returns the canonical `config.toml` string for this wire API.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Responses => "responses",
            Self::Antigravity => "antigravity",
            Self::Anthropic => "anthropic",
        }
    }
}

impl std::fmt::Display for WireApi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl Serialize for WireApi {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for WireApi {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        match raw.as_str() {
            "chat" => Ok(Self::Chat),
            "responses" => Ok(Self::Responses),
            "antigravity" => Ok(Self::Antigravity),
            "anthropic" => Ok(Self::Anthropic),
            other => Err(serde::de::Error::unknown_variant(
                other,
                &["chat", "responses", "antigravity", "anthropic"],
            )),
        }
    }
}

#[cfg(test)]
#[path = "wire_api_tests.rs"]
mod wire_api_tests;
