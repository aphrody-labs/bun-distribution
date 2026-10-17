// SPDX-License-Identifier: Apache-2.0
//! Turning "run this model for that role" into a launch specification.
//!
//! The split of responsibilities is deliberate. aphrody decides what the *task*
//! needs — how much context an agent session wants, how precise the KV cache
//! has to be, which adapters are loaded. Where the weights end up is the
//! runtime's call whenever the build can make it (`--fit`): llama.cpp measures
//! the device it actually runs on. Only builds without `--fit` get a split
//! computed here, from the GGUF facts and the free VRAM.

use std::path::PathBuf;

use aphrody_models::HardwareProfile;

use crate::{
    caps::{FlashAttnSyntax, ServerCapabilities},
    facts::{KvQuant, ModelFacts},
    spec::{LlamaServerSpec, LoraAdapter, Placement, Role},
};

/// Context an agent session asks for when the caller does not say.
pub const DEFAULT_CHAT_CTX: u32 = 32_768;
/// Context of an embedding / reranking instance when the caller does not say.
pub const DEFAULT_ENCODER_CTX: u32 = 8_192;
/// Device memory left free, in MiB.
pub const DEFAULT_MARGIN_MIB: u32 = 1_024;
/// From this context size up, the KV cache is quantized to 8 bits when the
/// build allows it: at 32k tokens it is the difference between fitting a 7B
/// model entirely on a 12 GB card or not.
const KV_QUANT_FROM_CTX: u32 = 16_384;
/// Compute buffers, CUDA context and fragmentation, in bytes.
const RUNTIME_OVERHEAD_BYTES: u64 = 1 << 30;
/// Share of a MoE block's bytes held by its expert tensors.
const MOE_EXPERT_SHARE: f64 = 0.9;

/// Free and total memory of the GPU a server would land on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Budget {
    /// Free VRAM right now, in bytes.
    pub vram_free_bytes: u64,
    /// Total VRAM of that device, in bytes (0 = no usable GPU).
    pub vram_total_bytes: u64,
}

impl Budget {
    /// The device with the most free memory among the probed GPUs.
    #[must_use]
    pub fn from_profile(profile: &HardwareProfile) -> Self {
        profile
            .gpus
            .iter()
            .max_by_key(|gpu| gpu.vram_free_bytes)
            .map_or(
                Self {
                    vram_free_bytes: 0,
                    vram_total_bytes: 0,
                },
                |gpu| Self {
                    vram_free_bytes: gpu.vram_free_bytes,
                    vram_total_bytes: gpu.vram_bytes,
                },
            )
    }

    /// No GPU at all.
    #[must_use]
    pub fn cpu_only() -> Self {
        Self {
            vram_free_bytes: 0,
            vram_total_bytes: 0,
        }
    }
}

/// What the caller wants from the instance.
#[derive(Debug, Clone, PartialEq)]
pub struct PlanRequest {
    /// What the instance serves.
    pub role: Role,
    /// Model name reported by the API.
    pub alias: String,
    /// Multimodal projector.
    pub mmproj: Option<PathBuf>,
    /// Draft model GGUF weights for speculative decoding.
    pub draft_model: Option<PathBuf>,
    /// Context size; `None` picks the role default, capped to what the model
    /// was trained for.
    pub ctx: Option<u32>,
    /// KV precision; `None` lets the planner choose.
    pub kv: Option<KvQuant>,
    /// Device memory to leave free, in MiB.
    pub margin_mib: u32,
    /// Request slots.
    pub parallel: u8,
    /// Chat template override.
    pub chat_template_file: Option<PathBuf>,
    /// Embedding pooling.
    pub pooling: Option<String>,
    /// Adapters.
    pub lora: Vec<LoraAdapter>,
    /// Raw arguments appended last.
    pub extra_args: Vec<String>,
}

impl PlanRequest {
    /// A request with every knob on its default.
    #[must_use]
    pub fn new(role: Role, alias: impl Into<String>) -> Self {
        Self {
            role,
            alias: alias.into(),
            mmproj: None,
            draft_model: None,
            ctx: None,
            kv: None,
            margin_mib: DEFAULT_MARGIN_MIB,
            parallel: 1,
            chat_template_file: None,
            pooling: None,
            lora: Vec::new(),
            extra_args: Vec::new(),
        }
    }
}

/// The outcome of planning: the spec, what it should cost, and why.
#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    /// The launch specification.
    pub spec: LlamaServerSpec,
    /// VRAM the instance is expected to occupy, in bytes — what it declares
    /// when taking the GPU lease.
    pub estimated_vram_bytes: u64,
    /// The decisions taken, in plain words, for `doctor` / `status` / logs.
    pub notes: Vec<String>,
}

fn gib(bytes: u64) -> f64 {
    bytes as f64 / f64::from(1u32 << 30)
}

/// Plan the launch of `facts` for `request` on a machine with `budget`, for a
/// server build with `caps`.
#[must_use]
pub fn plan(
    facts: &ModelFacts,
    caps: &ServerCapabilities,
    budget: Budget,
    request: &PlanRequest,
) -> Plan {
    let mut notes = Vec::new();

    // Context: what was asked, never more than the model was trained for.
    let role_default = match request.role {
        Role::Chat => DEFAULT_CHAT_CTX,
        Role::Embed | Role::Rerank => DEFAULT_ENCODER_CTX,
    };
    let wanted = request.ctx.unwrap_or(role_default);
    let ctx = wanted.min(facts.context_length).max(1);
    if ctx < wanted {
        notes.push(format!(
            "context capped to {ctx}: the model was trained for {} tokens",
            facts.context_length
        ));
    }

    // KV precision: explicit, else 8-bit for long chat contexts when the build
    // can do it (quantized V needs flash attention).
    let can_quantize = caps.kv_cache_types && caps.flash_attn != FlashAttnSyntax::Absent;
    let kv = match request.kv {
        Some(kv) if kv != KvQuant::F16 && !can_quantize => {
            notes.push("KV quantization unavailable on this build: using f16".to_string());
            KvQuant::F16
        }
        Some(kv) => kv,
        None if request.role == Role::Chat && ctx >= KV_QUANT_FROM_CTX && can_quantize => {
            notes.push(format!("KV cache at q8_0 for a {ctx}-token context"));
            KvQuant::Q8_0
        }
        None => KvQuant::F16,
    };

    let kv_bytes = facts.kv_bytes(ctx, kv);
    let full_bytes = facts.file_bytes + kv_bytes + RUNTIME_OVERHEAD_BYTES;
    let margin_bytes = u64::from(request.margin_mib) << 20;
    let available = budget.vram_free_bytes.saturating_sub(margin_bytes);

    let (placement, estimated_vram_bytes) = if budget.vram_total_bytes == 0 {
        notes.push("no usable GPU: running on the CPU".to_string());
        (Placement::Cpu, 0)
    } else if facts.is_moe() && caps.n_cpu_moe && full_bytes > available {
        // MoE models that exceed available VRAM must use `--n-cpu-moe` rather than
        // `--fit`: `--fit` treats the model as dense layers, whereas `--n-cpu-moe`
        // keeps attention layers and the KV cache on the GPU while offloading only
        // the expert weights of leading layers to system RAM.
        planned_placement(facts, caps, kv_bytes, available, &mut notes)
    } else if caps.fit {
        notes.push(format!(
            "placement left to llama-server (--fit), {} MiB kept free",
            request.margin_mib
        ));
        if full_bytes > available {
            notes.push(format!(
                "needs about {:.1} GiB for {:.1} GiB available: part of the model will run from \
                 system RAM",
                gib(full_bytes),
                gib(available)
            ));
        }
        (
            Placement::Auto {
                margin_mib: request.margin_mib,
            },
            full_bytes.min(available),
        )
    } else {
        planned_placement(facts, caps, kv_bytes, available, &mut notes)
    };

    Plan {
        spec: LlamaServerSpec {
            role: request.role,
            model: facts.path.clone(),
            draft_model: request.draft_model.clone(),
            mmproj: request.mmproj.clone(),
            alias: request.alias.clone(),
            ctx,
            kv,
            placement,
            parallel: request.parallel.max(1),
            jinja: request.role == Role::Chat,
            chat_template_file: request.chat_template_file.clone(),
            pooling: request.pooling.clone(),
            lora: request.lora.clone(),
            extra_args: request.extra_args.clone(),
        },
        estimated_vram_bytes,
        notes,
    }
}

/// The split for a build that cannot fit itself.
fn planned_placement(
    facts: &ModelFacts,
    caps: &ServerCapabilities,
    kv_bytes: u64,
    available: u64,
    notes: &mut Vec<String>,
) -> (Placement, u64) {
    let blocks = facts.block_count;
    // llama.cpp counts the output layer as one more offloadable layer.
    let all_layers = blocks + 1;
    let full_bytes = facts.file_bytes + kv_bytes + RUNTIME_OVERHEAD_BYTES;

    if full_bytes <= available {
        notes.push(format!(
            "fits entirely on the GPU (about {:.1} GiB)",
            gib(full_bytes)
        ));
        return (
            Placement::Planned {
                n_gpu_layers: all_layers,
                n_cpu_moe: None,
            },
            full_bytes,
        );
    }

    if facts.is_moe() && caps.n_cpu_moe {
        // Keep attention and the KV cache on the GPU; push the experts of as
        // many leading layers as needed to system RAM.
        let expert_bytes = (facts.bytes_per_block() as f64 * MOE_EXPERT_SHARE).max(1.0);
        let excess = (full_bytes - available) as f64;
        let moved = ((excess / expert_bytes).ceil() as u32).min(blocks);
        let freed = (f64::from(moved) * expert_bytes) as u64;
        notes.push(format!(
            "MoE: experts of {moved}/{blocks} layers kept in system RAM (--n-cpu-moe)"
        ));
        return (
            Placement::Planned {
                n_gpu_layers: all_layers,
                n_cpu_moe: Some(moved),
            },
            full_bytes.saturating_sub(freed).min(available),
        );
    }

    // Dense: each offloaded block brings its share of the KV cache with it.
    let per_block = facts.bytes_per_block() + kv_bytes / u64::from(blocks.max(1));
    let room = available.saturating_sub(RUNTIME_OVERHEAD_BYTES);
    let layers = u32::try_from(room / per_block.max(1))
        .unwrap_or(u32::MAX)
        .min(blocks);
    notes.push(format!(
        "{layers}/{blocks} layers on the GPU, the rest on the CPU"
    ));
    let used = if layers == 0 {
        0
    } else {
        u64::from(layers) * per_block + RUNTIME_OVERHEAD_BYTES
    };
    (
        Placement::Planned {
            n_gpu_layers: layers,
            n_cpu_moe: None,
        },
        used.min(available),
    )
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, path::Path};

    use pretty_assertions::assert_eq;

    use super::*;

    const GIB: u64 = 1 << 30;

    fn facts(arch: &str, file_gib: f64, blocks: u32, train_ctx: u32, experts: u32) -> ModelFacts {
        let mut metadata = BTreeMap::new();
        let mut put = |key: &str, value: String| {
            metadata.insert(key.to_string(), value);
        };
        put("general.architecture", arch.to_string());
        put(&format!("{arch}.block_count"), blocks.to_string());
        put(&format!("{arch}.context_length"), train_ctx.to_string());
        put(&format!("{arch}.embedding_length"), "3584".to_string());
        put(&format!("{arch}.attention.head_count"), "28".to_string());
        put(&format!("{arch}.attention.head_count_kv"), "4".to_string());
        if experts > 0 {
            put(&format!("{arch}.expert_count"), experts.to_string());
        }
        ModelFacts::from_metadata(
            Path::new("m.gguf"),
            (file_gib * GIB as f64) as u64,
            &metadata,
        )
        .expect("facts")
    }

    fn caps(fit: bool) -> ServerCapabilities {
        ServerCapabilities {
            version: None,
            flash_attn: FlashAttnSyntax::Valued,
            fit,
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

    fn rtx_4070() -> Budget {
        Budget {
            vram_free_bytes: 11 * GIB,
            vram_total_bytes: 12 * GIB,
        }
    }

    #[test]
    fn modern_build_is_left_to_fit_itself_with_a_long_quantized_context() {
        let plan = plan(
            &facts("qwen2", 5.1, 28, 32_768, 0),
            &caps(true),
            rtx_4070(),
            &PlanRequest::new(Role::Chat, "qwen2.5-coder-7b"),
        );
        assert_eq!(plan.spec.ctx, 32_768);
        assert_eq!(plan.spec.kv, KvQuant::Q8_0);
        assert_eq!(plan.spec.placement, Placement::Auto { margin_mib: 1024 });
        assert!(plan.spec.jinja);
        // 5.1 GiB weights + ~0.93 GiB KV + 1 GiB overhead.
        assert!(plan.estimated_vram_bytes > 6 * GIB && plan.estimated_vram_bytes < 8 * GIB);
    }

    #[test]
    fn context_is_capped_to_the_training_length_and_short_contexts_stay_f16() {
        let plan = plan(
            &facts("llama", 4.0, 32, 8_192, 0),
            &caps(true),
            rtx_4070(),
            &PlanRequest::new(Role::Chat, "m"),
        );
        assert_eq!(plan.spec.ctx, 8_192);
        assert_eq!(plan.spec.kv, KvQuant::F16);
        assert!(
            plan.notes
                .iter()
                .any(|note| note.contains("capped to 8192"))
        );
    }

    #[test]
    fn legacy_build_dense_model_that_fits_goes_fully_on_the_gpu() {
        let plan = plan(
            &facts("qwen2", 5.1, 28, 32_768, 0),
            &caps(false),
            rtx_4070(),
            &PlanRequest::new(Role::Chat, "m"),
        );
        assert_eq!(
            plan.spec.placement,
            Placement::Planned {
                n_gpu_layers: 29,
                n_cpu_moe: None
            }
        );
    }

    #[test]
    fn legacy_build_dense_model_too_large_is_split_by_layers() {
        // 14 GiB of weights on a card with 10 GiB usable.
        let plan = plan(
            &facts("llama", 14.0, 40, 32_768, 0),
            &caps(false),
            rtx_4070(),
            &PlanRequest::new(Role::Chat, "m"),
        );
        let Placement::Planned {
            n_gpu_layers,
            n_cpu_moe,
        } = plan.spec.placement
        else {
            panic!("expected a planned split, got {:?}", plan.spec.placement);
        };
        assert_eq!(n_cpu_moe, None);
        assert!((20..40).contains(&n_gpu_layers), "got {n_gpu_layers}");
        assert!(plan.estimated_vram_bytes <= 10 * GIB);
    }

    #[test]
    fn legacy_build_moe_keeps_attention_on_the_gpu_and_moves_experts() {
        // Qwen3-Coder-30B-A3B at Q4: ~17.3 GiB, 48 blocks, 128 experts.
        let plan = plan(
            &facts("qwen3moe", 17.3, 48, 262_144, 128),
            &caps(false),
            rtx_4070(),
            &PlanRequest::new(Role::Chat, "qwen3-coder-30b-a3b"),
        );
        let Placement::Planned {
            n_gpu_layers,
            n_cpu_moe,
        } = plan.spec.placement
        else {
            panic!("expected a planned split, got {:?}", plan.spec.placement);
        };
        assert_eq!(n_gpu_layers, 49, "every layer stays addressable on the GPU");
        let moved = n_cpu_moe.expect("experts moved");
        assert!((20..=48).contains(&moved), "got {moved}");
    }

    #[test]
    fn modern_build_moe_prefers_n_cpu_moe_over_fit_when_exceeding_vram() {
        let plan = plan(
            &facts("qwen3moe", 17.3, 48, 262_144, 128),
            &caps(true),
            rtx_4070(),
            &PlanRequest::new(Role::Chat, "qwen3-30b-a3b"),
        );
        let Placement::Planned {
            n_gpu_layers,
            n_cpu_moe,
        } = plan.spec.placement
        else {
            panic!(
                "expected a planned MoE split, got {:?}",
                plan.spec.placement
            );
        };
        assert_eq!(n_gpu_layers, 49);
        let moved = n_cpu_moe.expect("experts moved with --n-cpu-moe");
        assert!((20..=48).contains(&moved), "got {moved}");
    }

    #[test]
    fn no_gpu_means_cpu_and_encoders_get_a_short_f16_context() {
        let plan = plan(
            &facts("bert", 0.1, 12, 512, 0),
            &caps(true),
            Budget::cpu_only(),
            &PlanRequest::new(Role::Embed, "e5"),
        );
        assert_eq!(plan.spec.placement, Placement::Cpu);
        assert_eq!(plan.spec.ctx, 512);
        assert_eq!(plan.spec.kv, KvQuant::F16);
        assert!(!plan.spec.jinja);
        assert_eq!(plan.estimated_vram_bytes, 0);
    }

    #[test]
    fn requested_kv_quantization_falls_back_when_the_build_cannot() {
        let mut build = caps(true);
        build.kv_cache_types = false;
        let mut request = PlanRequest::new(Role::Chat, "m");
        request.kv = Some(KvQuant::Q4_0);
        let plan = plan(
            &facts("qwen2", 5.1, 28, 32_768, 0),
            &build,
            rtx_4070(),
            &request,
        );
        assert_eq!(plan.spec.kv, KvQuant::F16);
        assert!(plan.notes.iter().any(|note| note.contains("unavailable")));
    }

    #[test]
    fn qwen3_moe_with_speculative_decoding() {
        let mut request = PlanRequest::new(Role::Chat, "qwen3-30b-a3b-instruct");
        request.draft_model = Some(PathBuf::from("qwen3-4b-instruct.gguf"));
        let plan = plan(
            &facts("qwen3moe", 17.3, 48, 262_144, 128),
            &caps(true),
            rtx_4070(),
            &request,
        );
        let Placement::Planned {
            n_gpu_layers,
            n_cpu_moe,
        } = plan.spec.placement
        else {
            panic!(
                "expected a planned MoE split, got {:?}",
                plan.spec.placement
            );
        };
        assert_eq!(n_gpu_layers, 49);
        let moved = n_cpu_moe.expect("experts moved with --n-cpu-moe");
        assert!((20..=48).contains(&moved), "got {moved}");
        assert_eq!(
            plan.spec.draft_model,
            Some(PathBuf::from("qwen3-4b-instruct.gguf"))
        );
        assert_eq!(plan.spec.kv, KvQuant::Q8_0);

        let args = plan.spec.to_args(&caps(true), "127.0.0.1", 8080);
        assert!(
            args.windows(2)
                .any(|w| w == ["--n-cpu-moe", &moved.to_string()])
        );
        assert!(
            args.windows(2)
                .any(|w| w == ["--model-draft", "qwen3-4b-instruct.gguf"])
        );
        assert!(args.windows(2).any(|w| w == ["--cache-type-k", "q8_0"]));
        assert!(args.windows(2).any(|w| w == ["--cache-type-v", "q8_0"]));
    }
}
