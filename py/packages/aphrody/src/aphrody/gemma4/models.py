# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
"""Native Gemma 4 model definitions and architectural configurations.

Supports the entire Google DeepMind Gemma 4 family:
- Gemma4_E2B: 2B parameter dense multimodal model (Text + Vision + Audio)
- Gemma4_E4B: 4B parameter dense multimodal model (Text + Vision + Audio)
- Gemma4_26B_A4B: 26B total / 4B active Mixture-of-Experts (MoE) multimodal model
  with 128 experts per layer and dense shared MLP branch
- Gemma4_31B: 31B parameter dense high-capacity multimodal model with
  bidirectional vision attention
"""

from __future__ import annotations

import dataclasses
import enum
from typing import Any


class AttentionType(enum.Enum):
    """Attention mechanism for transformer layers."""

    GLOBAL = "global"
    LOCAL_SLIDING = "local_sliding"


@dataclasses.dataclass(frozen=True)
class KVCacheSharingConfig:
    """Configuration for layer KV cache sharing to optimize memory footprint."""

    frac_shared_layers: float = 0.0
    share_global: bool = True
    share_local: bool = True


@dataclasses.dataclass(frozen=True)
class ConformerConfig:
    """Configuration for Gemma 4 Conformer audio encoder."""

    subsampling_factor: int = 4
    d_model: int = 512
    num_heads: int = 8
    num_layers: int = 12
    kernel_size: int = 31
    sample_rate: int = 16000
    mel_channels: int = 128


@dataclasses.dataclass(frozen=True)
class VisionEncoderConfig:
    """Configuration for Gemma 4 vision encoder with variable aspect ratio."""

    d_model: int = 1152
    num_layers: int = 27
    num_heads: int = 16
    ffw_hidden: int = 4304
    output_length: int = 280
    patch_size: int = 16
    image_size: int = 448
    use_clipped_linears: bool = False
    standardize_embeddings: bool = True


@dataclasses.dataclass(frozen=True)
class Gemma4Config:
    """Full configuration for a Gemma 4 transformer model."""

    name: str
    vocab_size: int = 262144
    embed_dim: int = 1536
    hidden_dim: int = 6144
    num_heads: int = 8
    head_dim: int = 256
    num_kv_heads: int = 1
    num_global_kv_heads: int | None = None
    final_logit_softcap: float | None = 30.0
    use_post_attn_norm: bool = True
    use_post_ffw_norm: bool = True
    qk_norm_with_scale: bool = True
    sliding_window_size: int = 512
    global_key_size: int = 512
    k_eq_v_global: bool = False
    global_rope_proportion: float = 0.25
    local_rope_proportion: float = 1.0
    local_base_frequency: int = 10_000
    global_base_frequency: int = 1_000_000
    per_layer_input_dim: int = 0
    kv_cache_sharing: KVCacheSharingConfig | None = None
    override_kv_shared_ffw_hidden: int | None = None
    vision_encoder: VisionEncoderConfig | None = None
    audio_encoder: ConformerConfig | None = None
    use_bidirectional_attention: str | None = None

    # MoE (Mixture of Experts) configuration
    enable_moe: bool = False
    num_experts: int = 0
    expert_dim: int = 0
    top_k_experts: int = 8
    moe_dense_hidden_dim: int = 0

    # Layer count and attention pattern
    num_layers: int = 35
    attention_pattern: tuple[AttentionType, ...] = (
        AttentionType.LOCAL_SLIDING,
        AttentionType.LOCAL_SLIDING,
        AttentionType.LOCAL_SLIDING,
        AttentionType.LOCAL_SLIDING,
        AttentionType.GLOBAL,
    )

    @property
    def param_count_est(self) -> int:
        """Estimated parameter count of base model."""
        if "e2b" in self.name:
            return 2_000_000_000
        elif "e4b" in self.name:
            return 4_000_000_000
        elif "26b" in self.name:
            return 26_000_000_000
        elif "31b" in self.name:
            return 31_000_000_000
        return self.embed_dim * self.hidden_dim * self.num_layers

    def to_dict(self) -> dict[str, Any]:
        """Convert configuration to dictionary."""
        return {
            "name": self.name,
            "vocab_size": self.vocab_size,
            "embed_dim": self.embed_dim,
            "hidden_dim": self.hidden_dim,
            "num_layers": self.num_layers,
            "num_heads": self.num_heads,
            "head_dim": self.head_dim,
            "num_kv_heads": self.num_kv_heads,
            "num_global_kv_heads": self.num_global_kv_heads,
            "sliding_window_size": self.sliding_window_size,
            "enable_moe": self.enable_moe,
            "num_experts": self.num_experts if self.enable_moe else 0,
            "top_k_experts": self.top_k_experts if self.enable_moe else 0,
            "has_vision": self.vision_encoder is not None,
            "has_audio": self.audio_encoder is not None,
            "use_bidirectional_attention": self.use_bidirectional_attention,
            "kv_cache_sharing": self.kv_cache_sharing is not None,
        }


# ---------------------------------------------------------------------------
# Predefined Model Specifications (DeepMind Gemma 4 Family)
# ---------------------------------------------------------------------------

GEMMA4_E2B_CONFIG = Gemma4Config(
    name="gemma4-e2b",
    embed_dim=1536,
    hidden_dim=6144,
    num_layers=35,
    num_heads=8,
    num_kv_heads=1,
    num_global_kv_heads=None,
    per_layer_input_dim=256,
    sliding_window_size=512,
    k_eq_v_global=False,
    use_post_attn_norm=True,
    use_post_ffw_norm=True,
    kv_cache_sharing=KVCacheSharingConfig(frac_shared_layers=20.0 / 35.0),
    override_kv_shared_ffw_hidden=12288,
    vision_encoder=VisionEncoderConfig(use_clipped_linears=True),
    audio_encoder=ConformerConfig(),
)

GEMMA4_E4B_CONFIG = Gemma4Config(
    name="gemma4-e4b",
    embed_dim=2560,
    hidden_dim=10240,
    num_layers=42,
    num_heads=8,
    num_kv_heads=2,
    num_global_kv_heads=None,
    per_layer_input_dim=256,
    sliding_window_size=512,
    k_eq_v_global=False,
    use_post_attn_norm=True,
    use_post_ffw_norm=True,
    kv_cache_sharing=KVCacheSharingConfig(frac_shared_layers=18.0 / 42.0),
    vision_encoder=VisionEncoderConfig(use_clipped_linears=True),
    audio_encoder=ConformerConfig(),
    attention_pattern=(
        AttentionType.LOCAL_SLIDING,
        AttentionType.LOCAL_SLIDING,
        AttentionType.LOCAL_SLIDING,
        AttentionType.LOCAL_SLIDING,
        AttentionType.LOCAL_SLIDING,
        AttentionType.GLOBAL,
    ),
)

GEMMA4_26B_A4B_MOE_CONFIG = Gemma4Config(
    name="gemma4-26b-a4b",
    embed_dim=2816,
    hidden_dim=2112,  # Dense shared MLP branch
    num_layers=30,
    num_heads=16,
    head_dim=256,
    num_kv_heads=8,
    num_global_kv_heads=2,
    sliding_window_size=1024,
    k_eq_v_global=True,
    use_post_attn_norm=True,
    use_post_ffw_norm=True,
    enable_moe=True,
    num_experts=128,
    expert_dim=704,
    top_k_experts=8,
    moe_dense_hidden_dim=2112,
    vision_encoder=VisionEncoderConfig(
        d_model=1152,
        num_layers=27,
        num_heads=16,
        ffw_hidden=4304,
        output_length=280,
        use_clipped_linears=False,
        standardize_embeddings=True,
    ),
    use_bidirectional_attention="vision",
    attention_pattern=(
        AttentionType.LOCAL_SLIDING,
        AttentionType.LOCAL_SLIDING,
        AttentionType.LOCAL_SLIDING,
        AttentionType.LOCAL_SLIDING,
        AttentionType.LOCAL_SLIDING,
        AttentionType.GLOBAL,
    ),
)

GEMMA4_31B_CONFIG = Gemma4Config(
    name="gemma4-31b",
    embed_dim=5376,
    hidden_dim=21504,
    num_layers=60,
    num_heads=32,
    head_dim=256,
    num_kv_heads=16,
    num_global_kv_heads=4,
    sliding_window_size=1024,
    k_eq_v_global=True,
    use_post_attn_norm=True,
    use_post_ffw_norm=True,
    vision_encoder=VisionEncoderConfig(
        d_model=1152,
        num_layers=27,
        num_heads=16,
        ffw_hidden=4304,
        use_clipped_linears=False,
        standardize_embeddings=True,
    ),
    use_bidirectional_attention="vision",
    attention_pattern=(
        AttentionType.LOCAL_SLIDING,
        AttentionType.LOCAL_SLIDING,
        AttentionType.LOCAL_SLIDING,
        AttentionType.LOCAL_SLIDING,
        AttentionType.LOCAL_SLIDING,
        AttentionType.GLOBAL,
    ),
)

GEMMA4_MODELS: dict[str, Gemma4Config] = {
    "gemma4-e2b": GEMMA4_E2B_CONFIG,
    "gemma-4-e2b": GEMMA4_E2B_CONFIG,
    "gemma4-e4b": GEMMA4_E4B_CONFIG,
    "gemma-4-e4b": GEMMA4_E4B_CONFIG,
    "gemma4-26b-a4b": GEMMA4_26B_A4B_MOE_CONFIG,
    "gemma-4-26b-a4b": GEMMA4_26B_A4B_MOE_CONFIG,
    "gemma4-31b": GEMMA4_31B_CONFIG,
    "gemma-4-31b": GEMMA4_31B_CONFIG,
}


def get_model_config(model_id: str) -> Gemma4Config:
    """Lookup Gemma 4 configuration by model id or alias."""
    normalized = model_id.lower().strip()
    if normalized in GEMMA4_MODELS:
        return GEMMA4_MODELS[normalized]
    for key, cfg in GEMMA4_MODELS.items():
        if key in normalized:
            return cfg
    raise ValueError(f"Unknown Gemma 4 model: {model_id}. Available: {list_models()}")


def list_models() -> list[dict[str, Any]]:
    """List distinct Gemma 4 models with specifications."""
    seen = set()
    result = []
    for cfg in [
        GEMMA4_E2B_CONFIG,
        GEMMA4_E4B_CONFIG,
        GEMMA4_26B_A4B_MOE_CONFIG,
        GEMMA4_31B_CONFIG,
    ]:
        if cfg.name not in seen:
            seen.add(cfg.name)
            result.append(cfg.to_dict())
    return result
