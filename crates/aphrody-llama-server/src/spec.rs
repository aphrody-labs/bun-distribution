// SPDX-License-Identifier: Apache-2.0
//! The launch specification of one `llama-server` instance and its command line.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::{
    caps::{FlashAttnSyntax, ServerCapabilities},
    facts::KvQuant,
};

/// What an instance is for. One instance per role may run at a time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    /// Chat / tool-calling generation (`/v1/chat/completions`, `/v1/responses`).
    Chat,
    /// Text embeddings (`/v1/embeddings`).
    Embed,
    /// Reranking (`/v1/rerank`).
    Rerank,
}

impl Role {
    /// Stable lowercase name, used in state-file and lease names.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Embed => "embed",
            Self::Rerank => "rerank",
        }
    }

    /// Parse [`Role::as_str`] back.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "chat" => Some(Self::Chat),
            "embed" => Some(Self::Embed),
            "rerank" => Some(Self::Rerank),
            _ => None,
        }
    }
}

/// Who decides where the weights live.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "mode")]
pub enum Placement {
    /// The server fits layers, experts and buffers to the free device memory
    /// itself (`--fit on`), keeping `margin_mib` free.
    Auto {
        /// Device memory left unused, in MiB.
        margin_mib: u32,
    },
    /// aphrody computed the split (builds without `--fit`).
    Planned {
        /// Layers offloaded to the GPU.
        n_gpu_layers: u32,
        /// Leading layers whose expert weights stay in system RAM.
        n_cpu_moe: Option<u32>,
    },
    /// No usable GPU: everything on the CPU.
    Cpu,
}

/// A LoRA adapter loaded with the base model.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoraAdapter {
    /// The GGUF adapter file.
    pub path: PathBuf,
    /// Scale applied once the server is up (0.0 = loaded but inactive).
    pub scale: f32,
}

/// Everything that determines how an instance is started. Two equal specs
/// describe interchangeable servers, which is what lets a client attach to a
/// running instance instead of starting its own.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LlamaServerSpec {
    /// What the instance serves.
    pub role: Role,
    /// The GGUF weights.
    pub model: PathBuf,
    /// Draft model GGUF weights for speculative decoding.
    pub draft_model: Option<PathBuf>,
    /// Multimodal projector, for vision models.
    pub mmproj: Option<PathBuf>,
    /// Model name reported by the API.
    pub alias: String,
    /// Context size in tokens.
    pub ctx: u32,
    /// KV cache precision.
    pub kv: KvQuant,
    /// Weight placement.
    pub placement: Placement,
    /// Concurrent request slots (the context is divided between them).
    pub parallel: u8,
    /// Use the model's own Jinja chat template (needed for native tool calls).
    pub jinja: bool,
    /// Chat template override, for models whose embedded template lacks tools.
    pub chat_template_file: Option<PathBuf>,
    /// Pooling for an embedding instance (`mean`, `cls`, `last`, …).
    pub pooling: Option<String>,
    /// Adapters to load.
    pub lora: Vec<LoraAdapter>,
    /// Raw arguments appended last (user escape hatch: they win).
    pub extra_args: Vec<String>,
}

impl LlamaServerSpec {
    /// Refuse explicit features the selected binary cannot honor. Call this
    /// before launching; `to_args` alone is a compatibility formatter.
    ///
    /// # Errors
    /// Names the unsupported feature without exposing model paths or arguments.
    pub fn validate_capabilities(&self, caps: &ServerCapabilities) -> Result<(), &'static str> {
        if self.draft_model.is_some() && !caps.model_draft {
            return Err("speculative decoding requires --model-draft");
        }
        if self.mmproj.is_some() && !caps.mmproj {
            return Err("vision projector requires --mmproj");
        }
        if self.jinja && !caps.jinja {
            return Err("native tool templates require --jinja");
        }
        if self.kv != KvQuant::F16 && !caps.kv_cache_types {
            return Err("quantized KV cache requires cache-type flags");
        }
        if matches!(self.placement, Placement::Auto { .. }) && !caps.fit {
            return Err("automatic placement requires --fit");
        }
        if matches!(
            self.placement,
            Placement::Planned {
                n_cpu_moe: Some(_),
                ..
            }
        ) && !caps.n_cpu_moe
        {
            return Err("CPU expert placement requires --n-cpu-moe");
        }
        if self.role == Role::Embed && caps.embedding_flag.is_none() {
            return Err("embedding role requires an embedding flag");
        }
        if self.role == Role::Rerank && caps.rerank_flag.is_none() {
            return Err("reranking role requires a rerank flag");
        }
        Ok(())
    }

    /// A stable fingerprint of the spec (FNV-1a over its canonical JSON): the
    /// same across processes and builds, so independent aphrody processes
    /// agree on whether a running server is the one they need.
    #[must_use]
    pub fn fingerprint(&self) -> String {
        let canonical = serde_json::to_string(self).unwrap_or_default();
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for byte in canonical.bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        format!("{hash:016x}")
    }

    /// The `llama-server` command line for this spec, using only flags the
    /// build described by `caps` documents.
    #[must_use]
    pub fn to_args(&self, caps: &ServerCapabilities, host: &str, port: u16) -> Vec<String> {
        let mut args: Vec<String> = Vec::new();
        let mut push = |items: &[&str]| args.extend(items.iter().map(|item| (*item).to_string()));

        push(&["--model", &self.model.display().to_string()]);
        push(&["--host", host, "--port", &port.to_string()]);
        push(&["--ctx-size", &self.ctx.to_string()]);
        push(&["--parallel", &self.parallel.max(1).to_string()]);

        if caps.alias {
            push(&["--alias", &self.alias]);
        }
        if let (true, Some(draft)) = (caps.model_draft, &self.draft_model) {
            push(&["--model-draft", &draft.display().to_string()]);
        }
        if let (true, Some(mmproj)) = (caps.mmproj, &self.mmproj) {
            push(&["--mmproj", &mmproj.display().to_string()]);
        }

        match self.placement {
            Placement::Auto { margin_mib } => {
                push(&["--fit", "on", "--fit-target", &margin_mib.to_string()]);
            }
            Placement::Planned {
                n_gpu_layers,
                n_cpu_moe,
            } => {
                if caps.fit {
                    // An explicit split must not be second-guessed.
                    push(&["--fit", "off"]);
                }
                push(&["--n-gpu-layers", &n_gpu_layers.to_string()]);
                if let (true, Some(layers)) = (caps.n_cpu_moe, n_cpu_moe) {
                    push(&["--n-cpu-moe", &layers.to_string()]);
                }
            }
            Placement::Cpu => {
                if caps.fit {
                    push(&["--fit", "off"]);
                }
                push(&["--n-gpu-layers", "0"]);
            }
        }

        if self.kv != KvQuant::F16 && caps.kv_cache_types {
            // A quantized V cache needs flash attention; `auto` (valued syntax)
            // already enables it where supported.
            if caps.flash_attn == FlashAttnSyntax::Switch {
                push(&["--flash-attn"]);
            }
            push(&[
                "--cache-type-k",
                self.kv.as_arg(),
                "--cache-type-v",
                self.kv.as_arg(),
            ]);
        }

        match self.role {
            Role::Chat => {
                if self.jinja && caps.jinja {
                    push(&["--jinja"]);
                }
                if let Some(template) = &self.chat_template_file {
                    push(&["--chat-template-file", &template.display().to_string()]);
                }
            }
            Role::Embed => {
                if let Some(flag) = &caps.embedding_flag {
                    push(&[flag]);
                }
                if let Some(pooling) = &self.pooling {
                    push(&["--pooling", pooling]);
                }
            }
            Role::Rerank => {
                if let Some(flag) = &caps.rerank_flag {
                    push(&[flag]);
                }
            }
        }

        if !self.lora.is_empty() {
            if caps.lora_init_without_apply {
                // Loaded inactive; the supervisor applies the scales once the
                // server is up, and can change them later without a restart.
                for adapter in &self.lora {
                    push(&["--lora", &adapter.path.display().to_string()]);
                }
                push(&["--lora-init-without-apply"]);
            } else {
                for adapter in &self.lora {
                    push(&[
                        "--lora-scaled",
                        &format!("{}:{}", adapter.path.display(), adapter.scale),
                    ]);
                }
            }
        }

        if let Some(flag) = &caps.no_webui_flag {
            push(&[flag]);
        }

        args.extend(self.extra_args.iter().cloned());
        args
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    fn modern() -> ServerCapabilities {
        ServerCapabilities {
            version: None,
            flash_attn: FlashAttnSyntax::Valued,
            fit: true,
            n_cpu_moe: true,
            kv_cache_types: true,
            jinja: true,
            rerank_flag: Some("--reranking".into()),
            embedding_flag: Some("--embeddings".into()),
            lora_init_without_apply: true,
            no_webui_flag: Some("--no-webui".into()),
            alias: true,
            mmproj: true,
            model_draft: true,
        }
    }

    #[test]
    fn explicit_optional_features_are_refused_before_launch() {
        let caps = modern();
        let mut spec = chat_spec();
        assert!(spec.validate_capabilities(&caps).is_ok());
        spec.draft_model = Some(PathBuf::from("fixture-draft.gguf"));
        let mut absent = caps.clone();
        absent.model_draft = false;
        assert_eq!(
            spec.validate_capabilities(&absent),
            Err("speculative decoding requires --model-draft")
        );
        spec.draft_model = None;
        spec.mmproj = Some(PathBuf::from("fixture-mmproj.gguf"));
        absent = caps.clone();
        absent.mmproj = false;
        assert_eq!(
            spec.validate_capabilities(&absent),
            Err("vision projector requires --mmproj")
        );
        spec.mmproj = None;
        spec.role = Role::Embed;
        absent = caps.clone();
        absent.embedding_flag = None;
        assert_eq!(
            spec.validate_capabilities(&absent),
            Err("embedding role requires an embedding flag")
        );
        spec.role = Role::Rerank;
        absent = caps;
        absent.rerank_flag = None;
        assert_eq!(
            spec.validate_capabilities(&absent),
            Err("reranking role requires a rerank flag")
        );
    }

    fn legacy() -> ServerCapabilities {
        ServerCapabilities {
            version: None,
            flash_attn: FlashAttnSyntax::Switch,
            fit: false,
            n_cpu_moe: false,
            kv_cache_types: true,
            jinja: false,
            rerank_flag: Some("--reranking".into()),
            embedding_flag: Some("--embedding".into()),
            lora_init_without_apply: false,
            no_webui_flag: None,
            alias: false,
            mmproj: false,
            model_draft: false,
        }
    }

    fn chat_spec() -> LlamaServerSpec {
        LlamaServerSpec {
            role: Role::Chat,
            model: PathBuf::from("m.gguf"),
            draft_model: None,
            mmproj: None,
            alias: "qwen2.5-coder".into(),
            ctx: 32_768,
            kv: KvQuant::Q8_0,
            placement: Placement::Auto { margin_mib: 1024 },
            parallel: 1,
            jinja: true,
            chat_template_file: None,
            pooling: None,
            lora: vec![LoraAdapter {
                path: PathBuf::from("a.gguf"),
                scale: 1.0,
            }],
            extra_args: vec!["--threads".into(), "8".into()],
        }
    }

    #[test]
    fn modern_chat_command_line() {
        let args = chat_spec().to_args(&modern(), "127.0.0.1", 9001);
        assert_eq!(
            args,
            vec![
                "--model",
                "m.gguf",
                "--host",
                "127.0.0.1",
                "--port",
                "9001",
                "--ctx-size",
                "32768",
                "--parallel",
                "1",
                "--alias",
                "qwen2.5-coder",
                "--fit",
                "on",
                "--fit-target",
                "1024",
                "--cache-type-k",
                "q8_0",
                "--cache-type-v",
                "q8_0",
                "--jinja",
                "--lora",
                "a.gguf",
                "--lora-init-without-apply",
                "--no-webui",
                "--threads",
                "8",
            ]
        );
    }

    /// A legacy build only ever receives flags it documents.
    #[test]
    fn legacy_command_line_degrades_to_what_the_build_knows() {
        let mut spec = chat_spec();
        spec.placement = Placement::Planned {
            n_gpu_layers: 20,
            n_cpu_moe: Some(4),
        };
        let args = spec.to_args(&legacy(), "127.0.0.1", 9001);
        assert_eq!(
            args,
            vec![
                "--model",
                "m.gguf",
                "--host",
                "127.0.0.1",
                "--port",
                "9001",
                "--ctx-size",
                "32768",
                "--parallel",
                "1",
                "--n-gpu-layers",
                "20",
                "--flash-attn",
                "--cache-type-k",
                "q8_0",
                "--cache-type-v",
                "q8_0",
                "--lora-scaled",
                "a.gguf:1",
                "--threads",
                "8",
            ]
        );
    }

    #[test]
    fn embed_and_rerank_roles_use_the_build_spelling() {
        let mut spec = chat_spec();
        spec.lora.clear();
        spec.extra_args.clear();
        spec.kv = KvQuant::F16;
        spec.role = Role::Embed;
        spec.pooling = Some("mean".into());
        spec.placement = Placement::Cpu;
        let embed = spec.to_args(&modern(), "127.0.0.1", 1);
        assert!(
            embed
                .windows(3)
                .any(|w| w == ["--embeddings", "--pooling", "mean"])
        );
        assert!(
            embed
                .windows(4)
                .any(|w| w == ["--fit", "off", "--n-gpu-layers", "0"])
        );
        assert!(!embed.contains(&"--jinja".to_string()));

        spec.role = Role::Rerank;
        assert!(
            spec.to_args(&legacy(), "127.0.0.1", 1)
                .contains(&"--reranking".to_string())
        );
    }

    #[test]
    fn fingerprint_is_stable_and_sensitive() {
        let spec = chat_spec();
        assert_eq!(spec.fingerprint(), chat_spec().fingerprint());
        assert_eq!(spec.fingerprint().len(), 16);
        let mut other = chat_spec();
        other.ctx = 16_384;
        assert_ne!(spec.fingerprint(), other.fingerprint());
    }

    #[test]
    fn speculative_decoding_args() {
        let mut spec = chat_spec();
        spec.draft_model = Some(PathBuf::from("draft.gguf"));
        let modern_args = spec.to_args(&modern(), "127.0.0.1", 9001);
        assert!(
            modern_args
                .windows(2)
                .any(|w| w == ["--model-draft", "draft.gguf"])
        );

        // Legacy build does not know --model-draft, so it must not be passed.
        let legacy_args = spec.to_args(&legacy(), "127.0.0.1", 9001);
        assert!(!legacy_args.contains(&"--model-draft".to_string()));
    }

    #[test]
    fn role_names_round_trip() {
        for role in [Role::Chat, Role::Embed, Role::Rerank] {
            assert_eq!(Role::parse(role.as_str()), Some(role));
        }
        assert_eq!(Role::parse("vision"), None);
    }
}
