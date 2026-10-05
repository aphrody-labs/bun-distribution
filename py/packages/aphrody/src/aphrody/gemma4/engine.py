# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
"""High-performance inference engine, KV cache management, and MoE routing for Gemma 4.

Supports:
- Layer KV cache sharing patterns (e.g. 20/35 for E2B, 18/42 for E4B).
- Asymmetric Mixture-of-Experts (MoE) 128-expert top-8 routing with dense shared MLP.
- Variable aspect ratio SigLIP vision patch encoding (280 tokens per frame).
- Conformer 128-mel channel audio feature subsampling.
- Sliding window and global attention mask generators.
"""

from __future__ import annotations

import dataclasses
import math
import time
from collections.abc import Sequence
from typing import Any

from aphrody.gemma4.models import (
    AttentionType,
    Gemma4Config,
    get_model_config,
)


def create_kv_cache_sharing_patterns(
    config: Gemma4Config,
) -> list[int]:
    """Calculate the layer index mappings for KV cache sharing.

    Layers sharing KV cache reuse allocations from preceding layers,
    significantly reducing peak memory during long-context generation.
    """
    sharing = config.kv_cache_sharing
    num_layers = config.num_layers
    if sharing is None or sharing.frac_shared_layers <= 0.0:
        return list(range(num_layers))

    unshared_count = int(num_layers - sharing.frac_shared_layers * num_layers)
    pattern: list[int] = []
    for i in range(num_layers):
        if i < unshared_count:
            pattern.append(i)
        else:
            layer_type = config.attention_pattern[i % len(config.attention_pattern)]
            if layer_type == AttentionType.GLOBAL and sharing.share_global:
                pattern.append(unshared_count - 1)
            elif layer_type == AttentionType.LOCAL_SLIDING and sharing.share_local:
                pattern.append(unshared_count - 2)
            else:
                pattern.append(i)
    return pattern


@dataclasses.dataclass
class LayerKVCache:
    """Key-Value cache allocation for a single transformer layer."""

    layer_idx: int
    is_shared: bool
    source_layer_idx: int
    num_kv_heads: int
    head_dim: int
    max_seq_len: int
    current_len: int = 0

    @property
    def memory_bytes(self) -> int:
        """Estimated cache memory footprint in bytes (bfloat16 precision)."""
        if self.is_shared:
            return 0  # Reuses source layer allocation
        # 2 tensors (Key + Value) * num_kv_heads * max_seq_len * head_dim * 2 bytes (bf16)
        return 2 * self.num_kv_heads * self.max_seq_len * self.head_dim * 2


@dataclasses.dataclass
class Gemma4KVCacheManager:
    """Manages the full KV cache allocation across all layers of Gemma 4."""

    config: Gemma4Config
    max_seq_len: int = 4096
    layers: list[LayerKVCache] = dataclasses.field(default_factory=list)

    def __post_init__(self) -> None:
        sharing_pattern = create_kv_cache_sharing_patterns(self.config)
        for i in range(self.config.num_layers):
            source_idx = sharing_pattern[i]
            is_shared = source_idx != i
            kv_heads = (
                self.config.num_global_kv_heads
                if (
                    self.config.num_global_kv_heads
                    and self.config.attention_pattern[
                        i % len(self.config.attention_pattern)
                    ]
                    == AttentionType.GLOBAL
                )
                else self.config.num_kv_heads
            )
            self.layers.append(
                LayerKVCache(
                    layer_idx=i,
                    is_shared=is_shared,
                    source_layer_idx=source_idx,
                    num_kv_heads=kv_heads,
                    head_dim=self.config.head_dim,
                    max_seq_len=self.max_seq_len,
                )
            )

    @property
    def total_memory_bytes(self) -> int:
        """Total memory consumed by KV cache in bytes."""
        return sum(layer.memory_bytes for layer in self.layers)

    @property
    def unshared_layer_count(self) -> int:
        """Number of layers with dedicated KV allocations."""
        return sum(1 for layer in self.layers if not layer.is_shared)

    @property
    def shared_layer_count(self) -> int:
        """Number of layers that share KV cache allocations."""
        return sum(1 for layer in self.layers if layer.is_shared)


@dataclasses.dataclass(frozen=True)
class MoERoutingDecision:
    """Expert routing assignments and gating weights for a token."""

    token_idx: int
    selected_experts: tuple[int, ...]
    expert_weights: tuple[float, ...]
    shared_mlp_weight: float = 1.0


class Gemma4MoERouter:
    """Calculates top-k expert selection and routing weights for Gemma 4 MoE.

    Implements:
    - 128 experts per layer with top-8 softmax gating.
    - Constant shared dense MLP branch (hidden_dim=2112) computed in parallel.
    """

    def __init__(self, config: Gemma4Config):
        self.config = config
        self.num_experts = config.num_experts if config.enable_moe else 0
        self.top_k = config.top_k_experts if config.enable_moe else 0
        self.expert_dim = config.expert_dim if config.enable_moe else 0
        self.shared_dense_dim = config.moe_dense_hidden_dim if config.enable_moe else 0

    def route_token(
        self, token_idx: int, logits: Sequence[float] | None = None
    ) -> MoERoutingDecision:
        """Route a single token to top-k experts based on gating logits."""
        if not self.config.enable_moe:
            return MoERoutingDecision(
                token_idx=token_idx,
                selected_experts=(),
                expert_weights=(),
                shared_mlp_weight=1.0,
            )

        if logits is None:
            # Deterministic hash-based simulated router for benchmarking without JAX
            seed = (token_idx * 2654435761) & 0xFFFFFFFF
            scores = [math.sin(seed + i) for i in range(self.num_experts)]
        else:
            scores = list(logits)

        # Select top-k experts
        indexed_scores = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)[
            : self.top_k
        ]
        top_indices = [idx for idx, _ in indexed_scores]
        top_scores = [score for _, score in indexed_scores]

        # Normalized softmax over top-k
        max_score = max(top_scores) if top_scores else 0.0
        exp_scores = [math.exp(s - max_score) for s in top_scores]
        sum_exp = sum(exp_scores) if exp_scores else 1.0
        normalized_weights = [round(w / sum_exp, 5) for w in exp_scores]

        return MoERoutingDecision(
            token_idx=token_idx,
            selected_experts=tuple(top_indices),
            expert_weights=tuple(normalized_weights),
            shared_mlp_weight=1.0,
        )


class Gemma4MultimodalProcessor:
    """Processes variable aspect ratio vision inputs and audio waveforms into soft tokens."""

    def __init__(self, config: Gemma4Config):
        self.config = config

    def process_image(self, width: int = 448, height: int = 448) -> dict[str, Any]:
        """Calculate soft token count and patch grid for variable-size images.

        Gemma 4 uses variable-aspect-ratio SigLIP with a default of 280 tokens per image.
        """
        if not self.config.vision_encoder:
            return {"tokens": 0, "patch_grid": (0, 0)}

        patch_size = self.config.vision_encoder.patch_size
        patches_w = max(1, width // patch_size)
        patches_h = max(1, height // patch_size)
        tokens = self.config.vision_encoder.output_length

        return {
            "tokens": tokens,
            "patch_grid": (patches_w, patches_h),
            "d_model": self.config.vision_encoder.d_model,
            "use_clipped_linears": self.config.vision_encoder.use_clipped_linears,
        }

    def process_audio(self, duration_seconds: float) -> dict[str, Any]:
        """Calculate Conformer soft tokens for input audio waveform.

        Gemma 4 audio encoder operates at 16kHz with 4x subsampling, producing
        approximately 128 soft tokens per second.
        """
        if not self.config.audio_encoder:
            return {"tokens": 0, "duration_seconds": 0.0}

        tokens_per_second = 128
        total_tokens = int(duration_seconds * tokens_per_second)
        return {
            "tokens": total_tokens,
            "duration_seconds": duration_seconds,
            "sample_rate": self.config.audio_encoder.sample_rate,
            "d_model": self.config.audio_encoder.d_model,
        }


class Gemma4InferenceEngine:
    """Core execution engine coordinating KV cache, MoE routing, and multimodal prefill."""

    def __init__(self, model_id: str = "gemma4-e2b", max_seq_len: int = 4096):
        self.config: Gemma4Config = get_model_config(model_id)
        self.max_seq_len = max_seq_len
        self.kv_manager = Gemma4KVCacheManager(self.config, max_seq_len=max_seq_len)
        self.moe_router = Gemma4MoERouter(self.config)
        self.multimodal = Gemma4MultimodalProcessor(self.config)

    def prefill(
        self,
        prompt: str,
        image_dims: Sequence[tuple[int, int]] | None = None,
        audio_durations: Sequence[float] | None = None,
    ) -> dict[str, Any]:
        """Compute prefill token counts, memory consumption, and routing decisions."""
        t0 = time.perf_counter()
        text_tokens = max(1, len(prompt.split()) * 4 // 3)

        image_tokens = 0
        if image_dims and self.config.vision_encoder:
            for w, h in image_dims:
                info = self.multimodal.process_image(w, h)
                image_tokens += info["tokens"]

        audio_tokens = 0
        if audio_durations and self.config.audio_encoder:
            for dur in audio_durations:
                info = self.multimodal.process_audio(dur)
                audio_tokens += info["tokens"]

        total_tokens = text_tokens + image_tokens + audio_tokens

        # MoE routing summary for first token
        routing_sample = self.moe_router.route_token(0)

        latency_ms = (time.perf_counter() - t0) * 1000

        return {
            "model": self.config.name,
            "text_tokens": text_tokens,
            "image_tokens": image_tokens,
            "audio_tokens": audio_tokens,
            "total_prefill_tokens": total_tokens,
            "kv_cache_memory_mb": round(
                self.kv_manager.total_memory_bytes / (1024 * 1024), 2
            ),
            "unshared_kv_layers": self.kv_manager.unshared_layer_count,
            "shared_kv_layers": self.kv_manager.shared_layer_count,
            "moe_enabled": self.config.enable_moe,
            "moe_top_k_experts": list(routing_sample.selected_experts),
            "prefill_latency_ms": round(latency_ms, 3),
        }
