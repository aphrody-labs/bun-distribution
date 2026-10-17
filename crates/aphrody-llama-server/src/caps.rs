// SPDX-License-Identifier: Apache-2.0
//! What the installed `llama-server` build supports.
//!
//! llama.cpp ships several builds a week and its command line moves with it:
//! `-fa` became `--flash-attn on|off|auto`, `--fit` and `--n-cpu-moe` appeared,
//! `--reranking` gained a `--rerank` alias. Pinning one build would freeze a
//! fast-moving runtime, so the launch line is derived from the build's own
//! `--help` instead: a flag is only ever passed when the binary advertises it.

use aphrody_proc::NoWindow as _;
use std::{path::Path, process::Command};

use serde::{Deserialize, Serialize};

/// How this build spells "enable flash attention".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FlashAttnSyntax {
    /// `--flash-attn on|off|auto` (the default is `auto`).
    Valued,
    /// A bare `-fa` switch (off unless passed).
    Switch,
    /// The build has no such flag.
    Absent,
}

/// Feature flags of one `llama-server` binary, read from its `--help`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerCapabilities {
    /// The `version:` line of `--version`, when the build prints one.
    pub version: Option<String>,
    /// Flash-attention flag spelling.
    pub flash_attn: FlashAttnSyntax,
    /// `--fit on|off`: the server places layers / experts / context itself to
    /// fit the free device memory.
    pub fit: bool,
    /// `--n-cpu-moe N`.
    pub n_cpu_moe: bool,
    /// `--cache-type-k` / `--cache-type-v`.
    pub kv_cache_types: bool,
    /// `--jinja` (native chat templates, required for tool calling).
    pub jinja: bool,
    /// The reranking switch, spelled as this build accepts it.
    pub rerank_flag: Option<String>,
    /// The embeddings switch, spelled as this build accepts it.
    pub embedding_flag: Option<String>,
    /// `--lora-init-without-apply` (load adapters at scale 0, hot-swap later).
    pub lora_init_without_apply: bool,
    /// The switch that disables the bundled web UI, when there is one.
    pub no_webui_flag: Option<String>,
    /// `--alias`.
    pub alias: bool,
    /// `--mmproj`.
    pub mmproj: bool,
    /// `--model-draft` (speculative decoding draft model).
    pub model_draft: bool,
}

/// Why the capabilities of a binary could not be read.
#[derive(Debug, thiserror::Error)]
pub enum CapabilityError {
    /// The binary could not be started.
    #[error("cannot run `{binary} --help`: {source}")]
    Spawn {
        /// The binary that was tried.
        binary: String,
        /// The spawn error.
        source: std::io::Error,
    },
    /// `--help` printed nothing that looks like a llama-server usage text.
    #[error(
        "`{binary} --help` does not look like llama-server (no --model / --port in its output)"
    )]
    NotLlamaServer {
        /// The binary that was tried.
        binary: String,
    },
}

/// Whether `help` documents the long flag `flag` (`--fit`), as a whole word.
fn documents(help: &str, flag: &str) -> bool {
    help.match_indices(flag).any(|(index, _)| {
        let after = help[index + flag.len()..].chars().next();
        let before = help[..index].chars().next_back();
        let ends = after.is_none_or(|c| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        let starts = before.is_none_or(|c| !(c.is_ascii_alphanumeric() || c == '-'));
        ends && starts
    })
}

/// The first of `candidates` this help text documents.
fn first_documented(help: &str, candidates: &[&str]) -> Option<String> {
    candidates
        .iter()
        .find(|flag| documents(help, flag))
        .map(|flag| (*flag).to_string())
}

impl ServerCapabilities {
    /// Derive the capabilities from a `--help` text (and an optional
    /// `--version` text). Pure, so every known spelling carries a test.
    #[must_use]
    pub fn parse(help: &str, version_output: Option<&str>) -> Self {
        let flash_attn = if documents(help, "--flash-attn") {
            let valued = help
                .lines()
                .any(|line| line.contains("--flash-attn") && line.contains("[on|off|auto]"));
            if valued {
                FlashAttnSyntax::Valued
            } else {
                FlashAttnSyntax::Switch
            }
        } else {
            FlashAttnSyntax::Absent
        };

        let version = version_output.and_then(|output| {
            output
                .lines()
                .find_map(|line| line.trim().strip_prefix("version:"))
                .map(|rest| rest.trim().to_string())
        });

        Self {
            version,
            flash_attn,
            fit: documents(help, "--fit"),
            n_cpu_moe: documents(help, "--n-cpu-moe"),
            kv_cache_types: documents(help, "--cache-type-k"),
            jinja: documents(help, "--jinja"),
            rerank_flag: first_documented(help, &["--reranking", "--rerank"]),
            embedding_flag: first_documented(help, &["--embeddings", "--embedding"]),
            lora_init_without_apply: documents(help, "--lora-init-without-apply"),
            no_webui_flag: first_documented(help, &["--no-webui", "--no-ui"]),
            alias: documents(help, "--alias"),
            mmproj: documents(help, "--mmproj"),
            model_draft: documents(help, "--model-draft") || documents(help, "-md"),
        }
    }

    /// Run `binary --help` (and `--version`) and parse the result.
    ///
    /// # Errors
    ///
    /// [`CapabilityError::Spawn`] when the binary cannot be run,
    /// [`CapabilityError::NotLlamaServer`] when its output is not a
    /// llama-server usage text.
    pub fn probe(binary: &Path) -> Result<Self, CapabilityError> {
        let run = |flag: &str| {
            Command::new(binary)
                .no_window()
                .arg(flag)
                .output()
                .map(|output| {
                    // llama.cpp prints usage on stdout and its banner on stderr;
                    // older builds mix the two.
                    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
                    text.push_str(&String::from_utf8_lossy(&output.stderr));
                    text
                })
        };
        let help = run("--help").map_err(|source| CapabilityError::Spawn {
            binary: binary.display().to_string(),
            source,
        })?;
        if !(documents(&help, "--model") && documents(&help, "--port")) {
            return Err(CapabilityError::NotLlamaServer {
                binary: binary.display().to_string(),
            });
        }
        let version = run("--version").ok();
        Ok(Self::parse(&help, version.as_deref()))
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    /// Excerpt of the usage text of build 10549 (2026).
    const MODERN: &str = "\
-c,    --ctx-size N                     size of the prompt context
-fa,   --flash-attn [on|off|auto]       set Flash Attention use ('on', 'off', or 'auto', default: \
                          'auto')
-ctk,  --cache-type-k TYPE              KV cache data type for K
-ncmoe, --n-cpu-moe N                   keep the MoE weights of the first N layers in the CPU
-fit,  --fit [on|off]                   whether to adjust unset arguments to fit in device memory
-fitc, --fit-ctx N                      minimum ctx size that can be set by --fit option
--lora FNAME                            path to LoRA adapter
-m,    --model FNAME                    model path to load
-md,   --model-draft FNAME              draft model path to load for speculative decoding
-mm,   --mmproj FILE                    path to a multimodal projector file
-a,    --alias STRING                   set model name aliases
--port PORT                             port to listen (default: 8080)
--ui,  --webui, --no-ui, --no-webui     whether to enable the Web UI (default: enabled)
--embedding, --embeddings               restrict to only support embedding use case
--rerank, --reranking                   enable reranking endpoint on server
--jinja, --no-jinja                     whether to use jinja template engine for chat
--lora-init-without-apply               load LoRA adapters without applying them
";

    /// Excerpt of a 2024 build: bare `-fa`, no fit, no MoE placement.
    const LEGACY: &str = "\
-c,    --ctx-size N                     size of the prompt context
-fa,   --flash-attn                     enable Flash Attention (default: disabled)
-m,    --model FNAME                    model path
--port PORT                             port to listen (default: 8080)
--embedding                             restrict to only support embedding use case
--reranking                             enable reranking endpoint on server
";

    #[test]
    fn modern_build_is_fully_recognised() {
        let caps = ServerCapabilities::parse(
            MODERN,
            Some("version: 0.1.2-dev (build 10549)\nbuilt with Clang"),
        );
        assert_eq!(caps.version.as_deref(), Some("0.1.2-dev (build 10549)"));
        assert_eq!(caps.flash_attn, FlashAttnSyntax::Valued);
        assert!(caps.fit && caps.n_cpu_moe && caps.kv_cache_types && caps.jinja);
        assert!(caps.lora_init_without_apply && caps.alias && caps.mmproj && caps.model_draft);
        assert_eq!(caps.rerank_flag.as_deref(), Some("--reranking"));
        assert_eq!(caps.embedding_flag.as_deref(), Some("--embeddings"));
        assert_eq!(caps.no_webui_flag.as_deref(), Some("--no-webui"));
    }

    #[test]
    fn legacy_build_gets_only_what_it_documents() {
        let caps = ServerCapabilities::parse(LEGACY, None);
        assert_eq!(caps.version, None);
        assert_eq!(caps.flash_attn, FlashAttnSyntax::Switch);
        assert!(!caps.fit && !caps.n_cpu_moe && !caps.kv_cache_types && !caps.jinja);
        assert!(!caps.lora_init_without_apply && !caps.alias && !caps.mmproj);
        assert_eq!(caps.rerank_flag.as_deref(), Some("--reranking"));
        assert_eq!(caps.embedding_flag.as_deref(), Some("--embedding"));
        assert_eq!(caps.no_webui_flag, None);
    }

    /// `--fit` must not be "found" inside `--fit-ctx`, nor `--lora` inside
    /// `--lora-init-without-apply`.
    #[test]
    fn flags_match_as_whole_words() {
        assert!(!documents("-fitc, --fit-ctx N   minimum ctx", "--fit"));
        assert!(documents("-fit,  --fit [on|off]", "--fit"));
        assert!(!documents("--lora-init-without-apply   load", "--lora"));
        assert!(documents("--jinja, --no-jinja", "--jinja"));
        assert!(!documents("--no-jinja only", "--jinja"));
    }
}
