// SPDX-License-Identifier: Apache-2.0
//! Plain-data configuration of the engine.
//!
//! Nothing here names a mistral.rs or candle type, so the types serialize into
//! settings files, cross the wasm boundary and stay stable when the upstream pin
//! moves. The `engine` feature maps them onto mistral.rs' builders at load time.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::EngineError;

/// Where the weights come from and how mistral.rs should load them.
///
/// `id` is a Hugging Face repo id (`Qwen/Qwen3-4B`) or a local directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ModelSource {
    /// Safetensors weights; mistral.rs reads `config.json` and picks the text or
    /// the vision pipeline itself (`ModelBuilder`).
    Auto {
        /// Repo id or local directory.
        id: String,
    },
    /// Safetensors weights, text pipeline forced (`TextModelBuilder`).
    Text {
        /// Repo id or local directory.
        id: String,
    },
    /// Safetensors weights, vision pipeline forced (`MultimodalModelBuilder`).
    Vision {
        /// Repo id or local directory.
        id: String,
    },
    /// GGUF weights (`GgufModelBuilder`). `aphrody-models` and `aphrody-llama` stay
    /// the preferred GGUF path; this exists for GGUF files that need mistral.rs'
    /// features (paged attention, ISQ requantization, vision projector).
    Gguf {
        /// Repo id or local directory holding the files.
        id: String,
        /// GGUF file names inside `id` (several for a split model).
        files: Vec<String>,
        /// Repo that provides the tokenizer, config and chat template when the
        /// GGUF repo does not.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tokenizer_from: Option<String>,
        /// Multimodal projector files, for vision GGUF models.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        mmproj_files: Vec<String>,
    },
    /// UQFF weights, mistral.rs' pre-quantized format (`UqffTextModelBuilder` or
    /// `UqffMultimodalModelBuilder`).
    Uqff {
        /// Repo id or local directory holding the files.
        id: String,
        /// UQFF files inside `id`. For a sharded model name the first shard only.
        files: Vec<PathBuf>,
        /// Load through the vision pipeline.
        #[serde(default)]
        vision: bool,
    },
}

impl ModelSource {
    /// Safetensors weights with automatic text/vision detection.
    #[must_use]
    pub fn auto(id: impl Into<String>) -> Self {
        Self::Auto { id: id.into() }
    }

    /// GGUF weights.
    #[must_use]
    pub fn gguf(id: impl Into<String>, files: Vec<String>) -> Self {
        Self::Gguf { id: id.into(), files, tokenizer_from: None, mmproj_files: Vec::new() }
    }

    /// UQFF weights through the text pipeline.
    #[must_use]
    pub fn uqff(id: impl Into<String>, files: Vec<PathBuf>) -> Self {
        Self::Uqff { id: id.into(), files, vision: false }
    }

    /// The repo id or directory, whatever the format.
    #[must_use]
    pub fn id(&self) -> &str {
        match self {
            Self::Auto { id }
            | Self::Text { id }
            | Self::Vision { id }
            | Self::Gguf { id, .. }
            | Self::Uqff { id, .. } => id,
        }
    }

    /// Whether the source loads through a vision pipeline, from the configuration alone.
    ///
    /// `None` for [`Auto`](Self::Auto): mistral.rs reads the model's `config.json` and picks the
    /// pipeline while loading, so only a loaded client knows. A GGUF source is vision when it
    /// names a multimodal projector.
    #[must_use]
    pub fn declares_vision(&self) -> Option<bool> {
        match self {
            Self::Auto { .. } => None,
            Self::Text { .. } => Some(false),
            Self::Vision { .. } => Some(true),
            Self::Gguf { mmproj_files, .. } => {
                Some(mmproj_files.iter().any(|file| !file.trim().is_empty()))
            },
            Self::Uqff { vision, .. } => Some(*vision),
        }
    }

    /// Check what can be checked without loading anything.
    ///
    /// # Errors
    /// [`EngineError::Config`] for an empty id or an empty file list.
    pub fn validate(&self) -> Result<(), EngineError> {
        if self.id().trim().is_empty() {
            return Err(EngineError::Config("the model id must not be empty".into()));
        }
        match self {
            Self::Gguf { files, .. } if files.iter().all(|file| file.trim().is_empty()) => {
                Err(EngineError::Config("a GGUF source needs at least one file name".into()))
            },
            Self::Uqff { files, .. } if files.is_empty() => {
                Err(EngineError::Config("a UQFF source needs at least one file".into()))
            },
            _ => Ok(()),
        }
    }
}

/// How much GPU memory the paged KV cache may take.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PagedMemory {
    /// Enough blocks for this many tokens of context.
    ContextTokens(usize),
    /// An absolute amount, in megabytes.
    Megabytes(usize),
    /// A fraction of the device memory, in `(0, 1]`.
    Utilization(f32),
}

/// KV cache element type of the paged cache.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PagedCache {
    /// The activation dtype.
    #[default]
    Auto,
    /// 8-bit float cache (needs F16, BF16 or F32 activations).
    F8e4m3,
}

/// PagedAttention settings. Silently ignored by mistral.rs where the platform
/// has no paged attention (CPU), so a config stays portable.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PagedAttentionSpec {
    /// Tokens per block; mistral.rs picks one when `None`.
    pub block_size: Option<usize>,
    /// Cache size.
    pub memory: PagedMemory,
    /// Cache element type.
    pub cache: PagedCache,
}

impl Default for PagedAttentionSpec {
    /// Upstream's own default: room for 4096 tokens, automatic cache type.
    fn default() -> Self {
        Self { block_size: None, memory: PagedMemory::ContextTokens(4096), cache: PagedCache::Auto }
    }
}

impl PagedAttentionSpec {
    fn validate(&self) -> Result<(), EngineError> {
        let bad = |what: &str| Err(EngineError::Config(format!("paged attention: {what}")));
        match self.memory {
            PagedMemory::ContextTokens(0) | PagedMemory::Megabytes(0) => {
                bad("the cache size must be nonzero")
            },
            PagedMemory::Utilization(fraction)
                if fraction.is_nan() || fraction <= 0.0 || fraction > 1.0 =>
            {
                bad("utilization must be in (0, 1]")
            },
            _ if self.block_size == Some(0) => bad("the block size must be nonzero"),
            _ => Ok(()),
        }
    }
}

/// Load-time options shared by the chat client and the embedder.
///
/// Every field is optional: `Default` is "let mistral.rs decide", which is
/// ISQ off, dtype automatic, device automatic, paged attention off.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct RuntimeOptions {
    /// In-situ quantization applied while loading: a bit width (`2`, `3`, `4`, `5`,
    /// `6`, `8`; resolved per platform, Q4K on CPU/CUDA and AFQ4 on Metal) or an
    /// exact type (`q4k`, `q8_0`, `hqq4`, `afq4`, ...).
    pub isq: Option<String>,
    /// `auto`, `bf16`, `f16` or `f32`.
    pub dtype: Option<String>,
    /// Never use a GPU, whatever the build supports.
    pub force_cpu: bool,
    /// Paged attention (CUDA or Metal builds).
    pub paged_attention: Option<PagedAttentionSpec>,
    /// Concurrent sequences; mistral.rs' default is 32.
    pub max_num_seqs: Option<usize>,
    /// Cap on the context length, in tokens.
    pub max_model_len: Option<usize>,
    /// Prompts kept in the prefix cache. `None` keeps upstream's default (16 for the text, auto
    /// and GGUF builders; the multimodal builder keeps the cache off), `Some(0)` disables the
    /// cache.
    pub prefix_cache_seqs: Option<usize>,
    /// A Jinja chat template, or a path to a `.json` / `.jinja` one.
    pub chat_template: Option<String>,
    /// Path to a standalone `tokenizer.json`.
    pub tokenizer_json: Option<String>,
    /// Hugging Face revision (branch, tag or commit).
    pub hf_revision: Option<String>,
    /// Hugging Face cache directory.
    pub hf_cache_dir: Option<PathBuf>,
    /// Where the Hugging Face token comes from, in mistral.rs' own syntax:
    /// `cache`, `none`, `env:VAR`, `path:FILE` or `literal:TOKEN`.
    pub hf_token_source: Option<String>,
    /// Let mistral.rs log while it loads and serves.
    pub logging: bool,
}

impl RuntimeOptions {
    /// Check what can be checked without loading anything.
    ///
    /// # Errors
    /// [`EngineError::Config`] naming the offending field.
    pub fn validate(&self) -> Result<(), EngineError> {
        let bad = |what: String| Err(EngineError::Config(what));
        if let Some(isq) = &self.isq
            && isq.trim().is_empty()
        {
            return bad("`isq` must not be empty".into());
        }
        if let Some(dtype) = &self.dtype
            && !["auto", "bf16", "f16", "f32"].contains(&dtype.trim().to_ascii_lowercase().as_str())
        {
            return bad(format!("`dtype` must be auto, bf16, f16 or f32, got `{dtype}`"));
        }
        if self.max_num_seqs == Some(0) {
            return bad("`max_num_seqs` must be nonzero".into());
        }
        if self.max_model_len == Some(0) {
            return bad("`max_model_len` must be nonzero".into());
        }
        if let Some(paged) = &self.paged_attention {
            paged.validate()?;
        }
        Ok(())
    }
}

/// Configuration of a [`MistralRsClient`](crate::MistralRsClient).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EngineConfig {
    /// The weights.
    pub model: ModelSource,
    /// The id the client reports and the gateway serves it under; the source id
    /// when `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Load-time options.
    #[serde(default)]
    pub runtime: RuntimeOptions,
}

impl EngineConfig {
    /// A configuration with every option left to mistral.rs.
    #[must_use]
    pub fn new(model: ModelSource) -> Self {
        Self { model, name: None, runtime: RuntimeOptions::default() }
    }

    /// Serve under `name` instead of the source id.
    #[must_use]
    pub fn with_name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    /// Replace the load-time options.
    #[must_use]
    pub fn with_runtime(mut self, runtime: RuntimeOptions) -> Self {
        self.runtime = runtime;
        self
    }

    /// The id the client reports.
    #[must_use]
    pub fn served_name(&self) -> &str {
        self.name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| self.model.id())
    }

    /// Check what can be checked without loading anything.
    ///
    /// # Errors
    /// [`EngineError::Config`] naming the offending field.
    pub fn validate(&self) -> Result<(), EngineError> {
        self.model.validate()?;
        self.runtime.validate()
    }
}

/// Configuration of a [`MistralRsEmbedder`](crate::MistralRsEmbedder).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EmbedderConfig {
    /// Embedding model repo id or local directory (`google/embeddinggemma-300m`).
    pub id: String,
    /// The id the embedder reports; `id` when `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Load-time options. The embedding builder has no paged attention, chat
    /// template, prefix cache or context cap; setting them is rejected rather than
    /// silently dropped.
    #[serde(default)]
    pub runtime: RuntimeOptions,
}

impl EmbedderConfig {
    /// A configuration with every option left to mistral.rs.
    #[must_use]
    pub fn new(id: impl Into<String>) -> Self {
        Self { id: id.into(), name: None, runtime: RuntimeOptions::default() }
    }

    /// The id the embedder reports.
    #[must_use]
    pub fn served_name(&self) -> &str {
        self.name.as_deref().map(str::trim).filter(|name| !name.is_empty()).unwrap_or(&self.id)
    }

    /// Check what can be checked without loading anything.
    ///
    /// # Errors
    /// [`EngineError::Config`] naming the offending field.
    pub fn validate(&self) -> Result<(), EngineError> {
        if self.id.trim().is_empty() {
            return Err(EngineError::Config("the embedding model id must not be empty".into()));
        }
        self.runtime.validate()?;
        let runtime = &self.runtime;
        let unsupported = [
            ("paged_attention", runtime.paged_attention.is_some()),
            ("chat_template", runtime.chat_template.is_some()),
            ("prefix_cache_seqs", runtime.prefix_cache_seqs.is_some()),
            ("max_model_len", runtime.max_model_len.is_some()),
        ];
        match unsupported.iter().find(|(_, set)| *set) {
            Some((field, _)) => Err(EngineError::Config(format!(
                "`{field}` is not supported by the embedding builder"
            ))),
            None => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_ids_and_constructors() {
        assert_eq!(ModelSource::auto("Qwen/Qwen3-4B").id(), "Qwen/Qwen3-4B");
        assert_eq!(
            ModelSource::gguf("unsloth/m-GGUF", vec!["m.gguf".into()]).id(),
            "unsloth/m-GGUF"
        );
        let uqff = ModelSource::uqff("EricB/x-UQFF", vec!["x-q8_0.uqff".into()]);
        assert_eq!(uqff.id(), "EricB/x-UQFF");
        assert!(matches!(uqff, ModelSource::Uqff { vision: false, .. }));
    }

    #[test]
    fn vision_is_declared_by_the_source_except_for_auto() {
        assert_eq!(ModelSource::auto("a/b").declares_vision(), None);
        assert_eq!(ModelSource::Text { id: "a/b".into() }.declares_vision(), Some(false));
        assert_eq!(ModelSource::Vision { id: "a/b".into() }.declares_vision(), Some(true));
        assert_eq!(ModelSource::uqff("a/b", vec!["x.uqff".into()]).declares_vision(), Some(false));
        let uqff_vision =
            ModelSource::Uqff { id: "a/b".into(), files: vec!["x.uqff".into()], vision: true };
        assert_eq!(uqff_vision.declares_vision(), Some(true));

        assert_eq!(ModelSource::gguf("a/b", vec!["m.gguf".into()]).declares_vision(), Some(false));
        let gguf = |mmproj_files: Vec<String>| ModelSource::Gguf {
            id: "a/b".into(),
            files: vec!["m.gguf".into()],
            tokenizer_from: None,
            mmproj_files,
        };
        assert_eq!(gguf(vec![" ".into(), "mmproj.gguf".into()]).declares_vision(), Some(true));
        assert_eq!(gguf(vec![" ".into()]).declares_vision(), Some(false));
    }

    #[test]
    fn serde_round_trip_uses_a_kind_tag() {
        let config = EngineConfig::new(ModelSource::gguf("repo", vec!["a.gguf".into()]))
            .with_name("local")
            .with_runtime(RuntimeOptions {
                isq: Some("4".into()),
                paged_attention: Some(PagedAttentionSpec::default()),
                ..RuntimeOptions::default()
            });
        let json = serde_json::to_value(&config).expect("serialize");
        assert_eq!(json["model"]["kind"], "gguf");
        assert_eq!(json["runtime"]["isq"], "4");
        assert_eq!(json["runtime"]["paged_attention"]["memory"]["context_tokens"], 4096);
        let back: EngineConfig = serde_json::from_value(json).expect("deserialize");
        assert_eq!(back, config);
    }

    #[test]
    fn a_minimal_document_deserializes_with_defaults() {
        let config: EngineConfig =
            serde_json::from_str(r#"{ "model": { "kind": "auto", "id": "Qwen/Qwen3-4B" } }"#)
                .expect("deserialize");
        assert_eq!(config.runtime, RuntimeOptions::default());
        assert_eq!(config.served_name(), "Qwen/Qwen3-4B");
        config.validate().expect("valid");
    }

    #[test]
    fn served_name_prefers_a_non_blank_override() {
        let config = EngineConfig::new(ModelSource::auto("a/b")).with_name("  ");
        assert_eq!(config.served_name(), "a/b");
        assert_eq!(config.with_name("alias").served_name(), "alias");
    }

    #[test]
    fn validation_names_the_offending_field() {
        let blank = EngineConfig::new(ModelSource::auto(" "));
        assert!(blank.validate().unwrap_err().to_string().contains("model id"));

        let no_files = EngineConfig::new(ModelSource::gguf("repo", vec![]));
        assert!(no_files.validate().unwrap_err().to_string().contains("GGUF"));

        let no_uqff = EngineConfig::new(ModelSource::uqff("repo", vec![]));
        assert!(no_uqff.validate().unwrap_err().to_string().contains("UQFF"));

        let runtime = |runtime: RuntimeOptions| {
            EngineConfig::new(ModelSource::auto("a/b")).with_runtime(runtime).validate()
        };
        let zero_len = runtime(RuntimeOptions { max_model_len: Some(0), ..Default::default() });
        assert!(zero_len.unwrap_err().to_string().contains("max_model_len"));
        let bad_dtype = runtime(RuntimeOptions { dtype: Some("fp4".into()), ..Default::default() });
        assert!(bad_dtype.unwrap_err().to_string().contains("dtype"));
        let bad_util = runtime(RuntimeOptions {
            paged_attention: Some(PagedAttentionSpec {
                memory: PagedMemory::Utilization(1.5),
                ..PagedAttentionSpec::default()
            }),
            ..Default::default()
        });
        assert!(bad_util.unwrap_err().to_string().contains("utilization"));
        assert!(
            runtime(RuntimeOptions { dtype: Some("BF16".into()), ..Default::default() }).is_ok()
        );
    }

    #[test]
    fn embedder_rejects_options_its_builder_lacks() {
        let mut config = EmbedderConfig::new("google/embeddinggemma-300m");
        config.validate().expect("valid");
        assert_eq!(config.served_name(), "google/embeddinggemma-300m");

        config.runtime.paged_attention = Some(PagedAttentionSpec::default());
        assert!(config.validate().unwrap_err().to_string().contains("paged_attention"));
        config.runtime.paged_attention = None;
        config.runtime.max_model_len = Some(512);
        assert!(config.validate().unwrap_err().to_string().contains("max_model_len"));
    }
}
