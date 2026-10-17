// SPDX-License-Identifier: Apache-2.0
//! What a GGUF file says about the model it holds, and what that costs in VRAM.

use std::{
    io::Read as _,
    path::{Path, PathBuf},
};

use aphrody_models::{Details, inspect_prefix};
use serde::{Deserialize, Serialize};

/// How much of the file is read to find the scalar metadata. The architecture
/// keys sit at the front; the tokenizer tables that follow can run to several
/// megabytes and are not needed here.
const METADATA_PREFIX_BYTES: u64 = 16 * 1024 * 1024;

/// Precision of the KV cache.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KvQuant {
    /// 16-bit floats (llama.cpp default).
    F16,
    /// 8-bit blocks: half the memory, negligible quality loss.
    Q8_0,
    /// 4-bit blocks: a quarter of the memory, measurable loss on long contexts.
    Q4_0,
}

impl KvQuant {
    /// The `--cache-type-k/v` value.
    #[must_use]
    pub fn as_arg(self) -> &'static str {
        match self {
            Self::F16 => "f16",
            Self::Q8_0 => "q8_0",
            Self::Q4_0 => "q4_0",
        }
    }

    /// Bytes per cached element, block scales included (ggml block layouts:
    /// q8_0 = 34 bytes / 32 elements, q4_0 = 18 bytes / 32 elements).
    #[must_use]
    pub fn bytes_per_element(self) -> f64 {
        match self {
            Self::F16 => 2.0,
            Self::Q8_0 => 34.0 / 32.0,
            Self::Q4_0 => 18.0 / 32.0,
        }
    }
}

/// The facts of a model file that decide how it can be run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelFacts {
    /// The GGUF file.
    pub path: PathBuf,
    /// Its size on disk: the weights, to within the metadata.
    pub file_bytes: u64,
    /// `general.architecture` (`qwen2`, `llama`, `qwen3moe`, `gpt-oss`, …).
    pub architecture: String,
    /// `general.name`, when present.
    pub name: Option<String>,
    /// Transformer blocks.
    pub block_count: u32,
    /// Context length the model was trained for.
    pub context_length: u32,
    /// Hidden size.
    pub embedding_length: u32,
    /// Attention heads.
    pub head_count: u32,
    /// Key/value heads (equals `head_count` without grouped-query attention).
    pub head_count_kv: u32,
    /// Per-head key dimension, when the file states it (else hidden / heads).
    pub key_length: Option<u32>,
    /// Per-head value dimension, when the file states it.
    pub value_length: Option<u32>,
    /// Experts per MoE layer; 0 for a dense model.
    pub expert_count: u32,
}

/// Why the facts of a file could not be read.
#[derive(Debug, thiserror::Error)]
pub enum FactsError {
    /// The file could not be opened or read.
    #[error("cannot read {path}: {source}")]
    Io {
        /// The file.
        path: String,
        /// The I/O error.
        source: std::io::Error,
    },
    /// The file is not a GGUF container.
    #[error("{path} is not a GGUF file")]
    NotGguf {
        /// The file.
        path: String,
    },
    /// A key every llama.cpp model carries is absent: the metadata was cut off
    /// or the file is not a language model.
    #[error("{path}: GGUF metadata lacks `{key}`")]
    MissingKey {
        /// The file.
        path: String,
        /// The missing GGUF key.
        key: String,
    },
}

impl ModelFacts {
    /// Read the facts of the GGUF file at `path`.
    ///
    /// # Errors
    ///
    /// See [`FactsError`].
    pub fn read(path: &Path) -> Result<Self, FactsError> {
        let display = path.display().to_string();
        let io = |source| FactsError::Io {
            path: display.clone(),
            source,
        };

        let file = std::fs::File::open(path).map_err(io)?;
        let file_bytes = file.metadata().map_err(io)?.len();
        let mut prefix = Vec::new();
        file.take(METADATA_PREFIX_BYTES)
            .read_to_end(&mut prefix)
            .map_err(io)?;

        let hint = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("model.gguf");
        let Some(Details::Gguf(header)) = inspect_prefix(&prefix, hint).details else {
            return Err(FactsError::NotGguf { path: display });
        };
        Self::from_metadata(path, file_bytes, &header.metadata)
    }

    /// Build the facts from already-decoded GGUF scalar metadata.
    ///
    /// # Errors
    ///
    /// [`FactsError::MissingKey`] when a required key is absent or not a number.
    pub fn from_metadata(
        path: &Path,
        file_bytes: u64,
        metadata: &std::collections::BTreeMap<String, String>,
    ) -> Result<Self, FactsError> {
        let display = path.display().to_string();
        let missing = |key: &str| FactsError::MissingKey {
            path: display.clone(),
            key: key.to_string(),
        };

        let architecture = metadata
            .get("general.architecture")
            .cloned()
            .ok_or_else(|| missing("general.architecture"))?;
        let number = |suffix: &str| -> Option<u32> {
            metadata
                .get(&format!("{architecture}.{suffix}"))?
                .trim()
                .parse()
                .ok()
        };
        let required = |suffix: &str| {
            number(suffix).ok_or_else(|| missing(&format!("{architecture}.{suffix}")))
        };

        // Checked in the order llama.cpp itself reads them, so the first key
        // reported missing is the first one a user would look for.
        let block_count = required("block_count")?;
        let context_length = required("context_length")?;
        let embedding_length = required("embedding_length")?;
        let head_count = required("attention.head_count")?;
        Ok(Self {
            path: path.to_path_buf(),
            file_bytes,
            name: metadata.get("general.name").cloned(),
            block_count,
            context_length,
            embedding_length,
            head_count,
            head_count_kv: number("attention.head_count_kv").unwrap_or(head_count),
            key_length: number("attention.key_length"),
            value_length: number("attention.value_length"),
            expert_count: number("expert_count").unwrap_or(0),
            architecture,
        })
    }

    /// Whether the model is a mixture of experts.
    #[must_use]
    pub fn is_moe(&self) -> bool {
        self.expert_count > 0
    }

    /// Bytes of KV cache per token, across all layers, at precision `quant`.
    #[must_use]
    pub fn kv_bytes_per_token(&self, quant: KvQuant) -> f64 {
        let per_head = self
            .embedding_length
            .checked_div(self.head_count)
            .unwrap_or(0);
        let key = f64::from(self.key_length.unwrap_or(per_head));
        let value = f64::from(self.value_length.unwrap_or(per_head));
        f64::from(self.block_count)
            * f64::from(self.head_count_kv)
            * (key + value)
            * quant.bytes_per_element()
    }

    /// Bytes of KV cache for a context of `ctx` tokens.
    #[must_use]
    pub fn kv_bytes(&self, ctx: u32, quant: KvQuant) -> u64 {
        (self.kv_bytes_per_token(quant) * f64::from(ctx)).ceil() as u64
    }

    /// Approximate bytes of one transformer block. The file also holds the
    /// embedding and output matrices, counted here as one more block — close
    /// enough for placement, and erring on the side of fewer layers on the GPU.
    #[must_use]
    pub fn bytes_per_block(&self) -> u64 {
        self.file_bytes / (u64::from(self.block_count) + 1)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use pretty_assertions::assert_eq;

    use super::*;

    fn metadata(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect()
    }

    /// Qwen2.5-Coder-7B: 28 blocks, 28 heads, 4 KV heads, hidden 3584.
    fn qwen_7b() -> ModelFacts {
        ModelFacts::from_metadata(
            Path::new("qwen2.5-coder-7b-q5_k_m.gguf"),
            5_440_000_000,
            &metadata(&[
                ("general.architecture", "qwen2"),
                ("general.name", "Qwen2.5 Coder 7B Instruct"),
                ("qwen2.block_count", "28"),
                ("qwen2.context_length", "32768"),
                ("qwen2.embedding_length", "3584"),
                ("qwen2.attention.head_count", "28"),
                ("qwen2.attention.head_count_kv", "4"),
            ]),
        )
        .expect("facts")
    }

    #[test]
    fn grouped_query_attention_shrinks_the_kv_cache() {
        let facts = qwen_7b();
        assert!(!facts.is_moe());
        // 28 layers * 4 kv heads * (128 + 128) * 2 bytes = 57344 bytes / token.
        assert_eq!(facts.kv_bytes_per_token(KvQuant::F16), 57_344.0);
        // 32k tokens at f16 = 1.75 GiB; q8_0 is 17/32 of that.
        assert_eq!(facts.kv_bytes(32_768, KvQuant::F16), 1_879_048_192);
        assert_eq!(facts.kv_bytes(32_768, KvQuant::Q8_0), 998_244_352);
    }

    #[test]
    fn explicit_head_dimensions_override_the_hidden_size_ratio() {
        let facts = ModelFacts::from_metadata(
            Path::new("m.gguf"),
            1,
            &metadata(&[
                ("general.architecture", "gemma3"),
                ("gemma3.block_count", "2"),
                ("gemma3.context_length", "8192"),
                ("gemma3.embedding_length", "1152"),
                ("gemma3.attention.head_count", "4"),
                ("gemma3.attention.head_count_kv", "1"),
                ("gemma3.attention.key_length", "256"),
                ("gemma3.attention.value_length", "256"),
            ]),
        )
        .expect("facts");
        // 2 layers * 1 kv head * (256 + 256) * 2 bytes.
        assert_eq!(facts.kv_bytes_per_token(KvQuant::F16), 2048.0);
    }

    #[test]
    fn moe_and_missing_keys() {
        let moe = ModelFacts::from_metadata(
            Path::new("m.gguf"),
            1,
            &metadata(&[
                ("general.architecture", "qwen3moe"),
                ("qwen3moe.block_count", "48"),
                ("qwen3moe.context_length", "262144"),
                ("qwen3moe.embedding_length", "2048"),
                ("qwen3moe.attention.head_count", "32"),
                ("qwen3moe.expert_count", "128"),
            ]),
        )
        .expect("facts");
        assert!(moe.is_moe());
        assert_eq!(moe.head_count_kv, 32, "defaults to head_count");

        let error = ModelFacts::from_metadata(
            Path::new("m.gguf"),
            1,
            &metadata(&[
                ("general.architecture", "llama"),
                ("llama.block_count", "32"),
            ]),
        )
        .expect_err("missing context length");
        assert!(
            matches!(error, FactsError::MissingKey { key, .. } if key == "llama.context_length")
        );
    }

    #[test]
    fn a_non_gguf_file_is_rejected() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("notes.gguf");
        std::fs::write(&path, b"definitely not gguf").expect("write");
        assert!(matches!(
            ModelFacts::read(&path),
            Err(FactsError::NotGguf { .. })
        ));
        assert!(matches!(
            ModelFacts::read(&dir.path().join("absent.gguf")),
            Err(FactsError::Io { .. })
        ));
    }
}
