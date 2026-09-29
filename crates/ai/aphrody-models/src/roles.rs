// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
// One source of truth for "which local model does aphrody run for job X".
//
// Before this module, the same defaults were typed out as string literals in
// half a dozen crates (the CLI, the MCP server, the agent runtime, the
// managed llama-server supervisor, the vision and OCR task crates). They
// drifted the moment one call site was updated and the others were not: a
// literal that compiles is a literal nobody's build catches. `LocalRole` is
// the enum every one of those call sites now matches against instead.

use crate::catalog::ModelTask;

/// A job aphrody runs a local model for.
///
/// This is deliberately narrower than [`ModelTask`]: several roles can share
/// one task (both [`LocalRole::Vision`] and [`LocalRole::Ocr`] pull from the
/// catalog's `visual-transcription` task, for instance), but a caller asking
/// "what model backs code completion" wants a role, not a task.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LocalRole {
    /// General conversation and tool-calling: the default agent model.
    Chat,
    /// Source-code generation and editing.
    Code,
    /// Chain-of-thought / hard reasoning tasks.
    Reasoning,
    /// Fast, small-footprint routing, summarisation and repair.
    Small,
    /// Image description: captioning, dense regions, visual question answering.
    Vision,
    /// Image or page to text (`aphrody ocr`'s default VLM engine).
    Ocr,
    /// Audio to text.
    Stt,
    /// Text to dense vector.
    Embed,
    /// Text to relevance score / reranking.
    Rerank,
}

impl LocalRole {
    /// Every role, in declaration order. Useful for CLI help, completions and
    /// exhaustive tests.
    pub const ALL: [Self; 9] = [
        Self::Chat,
        Self::Code,
        Self::Reasoning,
        Self::Small,
        Self::Vision,
        Self::Ocr,
        Self::Stt,
        Self::Embed,
        Self::Rerank,
    ];

    /// Stable machine-friendly name, used to derive [`Self::env_var`].
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Code => "code",
            Self::Reasoning => "reasoning",
            Self::Small => "small",
            Self::Vision => "vision",
            Self::Ocr => "ocr",
            Self::Stt => "stt",
            Self::Embed => "embed",
            Self::Rerank => "rerank",
        }
    }

    /// The catalog task governing this role's default model.
    ///
    /// Matches the [`crate::CatalogEntry::task`] of [`Self::default_model`],
    /// not a role-name-derived guess: [`Self::Vision`] and [`Self::Ocr`] both
    /// resolve to [`ModelTask::VisualTranscription`] because their default
    /// models are catalogued under that task, even though the roles serve
    /// different callers.
    #[must_use]
    pub const fn task(self) -> ModelTask {
        match self {
            Self::Chat | Self::Code | Self::Reasoning | Self::Small => ModelTask::TextGeneration,
            Self::Vision | Self::Ocr => ModelTask::VisualTranscription,
            Self::Stt => ModelTask::SpeechToText,
            Self::Embed => ModelTask::TextEmbedding,
            Self::Rerank => ModelTask::TextRerank,
        }
    }

    /// The catalog id run for this role when no override is configured.
    ///
    /// Every id returned here must exist in [`crate::Catalog::builtin`] with
    /// the task named by [`Self::task`]; `roles_tests` in this module asserts
    /// it for every role.
    #[must_use]
    pub const fn default_model(self) -> &'static str {
        match self {
            Self::Chat => "qwen3-30b-a3b-instruct-2507-q4km",
            Self::Code => "qwen3-coder-30b-a3b-q4km",
            Self::Reasoning => "gpt-oss-20b-mxfp4",
            Self::Small => "qwen3-4b-instruct-2507-q4km",
            Self::Vision => "qwen3-vl-8b-instruct-q4km",
            // The catalog id `aphrody ocr page` / `aphrody ocr batch` (the
            // default `--engine vlm`) resolves to when `--model` is left
            // unset (`crates/aphrody/src/ocr_cmd.rs`).
            Self::Ocr => "granite-docling-258m",
            Self::Stt => "whisper-large-v3-turbo-q8",
            Self::Embed => "qwen3-embedding-0.6b",
            Self::Rerank => "qwen3-reranker-0.6b-q8",
        }
    }

    /// The environment variable a caller may set to override this role's
    /// model, independently of any config file: `APHRODY_AI_<ROLE>_MODEL`.
    #[must_use]
    pub fn env_var(self) -> String {
        format!("APHRODY_AI_{}_MODEL", self.as_str().to_ascii_uppercase())
    }

    /// Resolve the effective model id for this role.
    ///
    /// Precedence: [`Self::env_var`] (when set to a non-empty value), then
    /// `configured` (when non-empty), then [`Self::default_model`]. This is
    /// the one function every call site that used to hardcode a default
    /// should route through instead.
    #[must_use]
    pub fn resolve(self, configured: Option<&str>) -> String {
        self.resolve_with(configured, |var| std::env::var(var).ok())
    }

    /// [`Self::resolve`], with the environment lookup injected so it stays
    /// unit-testable without mutating the real process environment (this
    /// crate forbids `unsafe`, and `std::env::set_var` requires it as of the
    /// 2024 edition).
    fn resolve_with(
        self,
        configured: Option<&str>,
        env: impl Fn(&str) -> Option<String>,
    ) -> String {
        if let Some(value) = env(&self.env_var()).filter(|v| !v.trim().is_empty()) {
            return value;
        }
        if let Some(value) = configured.filter(|v| !v.trim().is_empty()) {
            return value.to_owned();
        }
        self.default_model().to_owned()
    }
}

impl core::fmt::Display for LocalRole {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::Catalog;

    #[test]
    fn every_default_exists_in_the_builtin_catalog_with_the_matching_task() {
        for role in LocalRole::ALL {
            let entry = Catalog::builtin()
                .get(role.default_model())
                .unwrap_or_else(|e| panic!("{role}: {e}"));
            assert_eq!(
                entry.task,
                role.task(),
                "{role}: default `{}` is catalogued as `{}`, role expects `{}`",
                role.default_model(),
                entry.task,
                role.task()
            );
        }
    }

    #[test]
    fn env_var_names_follow_the_convention() {
        assert_eq!(LocalRole::Chat.env_var(), "APHRODY_AI_CHAT_MODEL");
        assert_eq!(LocalRole::Ocr.env_var(), "APHRODY_AI_OCR_MODEL");
        assert_eq!(LocalRole::Rerank.env_var(), "APHRODY_AI_RERANK_MODEL");
    }

    #[test]
    fn resolve_prefers_env_then_configured_then_default() {
        let role = LocalRole::Embed;

        // Nothing set anywhere: the catalog default.
        assert_eq!(role.resolve_with(None, |_| None), role.default_model());

        // Only `configured`: it wins over the default.
        assert_eq!(role.resolve_with(Some("custom-embed"), |_| None), "custom-embed");

        // Both set: the environment variable wins.
        assert_eq!(
            role.resolve_with(Some("custom-embed"), |var| {
                (var == role.env_var()).then(|| "env-embed".to_owned())
            }),
            "env-embed"
        );

        // Blank values are treated as unset, not as an explicit empty model.
        assert_eq!(role.resolve_with(Some("   "), |_| Some(String::new())), role.default_model());
    }

    #[test]
    fn all_covers_every_variant_exactly_once() {
        let mut seen: Vec<&'static str> = LocalRole::ALL.iter().map(|r| r.as_str()).collect();
        seen.sort_unstable();
        seen.dedup();
        assert_eq!(seen.len(), LocalRole::ALL.len(), "ALL must list every role exactly once");
    }
}
