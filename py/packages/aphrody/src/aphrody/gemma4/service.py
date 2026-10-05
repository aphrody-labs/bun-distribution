# SPDX-License-Identifier: Apache-2.0
"""Shared Gemma operations used by CLI and MCP adapters."""

import math
from typing import Any

from aphrody.gemma4.client import Gemma4Client
from aphrody.gemma4.models import get_model_config


def describe_model(model: str = "gemma4-e2b") -> dict[str, Any]:
    cfg = get_model_config(model)
    data = cfg.to_dict()
    data["head_dim"] = cfg.head_dim
    data["global_rope_proportion"] = cfg.global_rope_proportion
    data["local_rope_proportion"] = cfg.local_rope_proportion
    data["global_base_frequency"] = cfg.global_base_frequency
    data["local_base_frequency"] = cfg.local_base_frequency
    if cfg.enable_moe:
        data["expert_dim"] = cfg.expert_dim
        data["moe_dense_hidden_dim"] = cfg.moe_dense_hidden_dim
    if cfg.vision_encoder:
        data["vision_encoder"] = {
            "d_model": cfg.vision_encoder.d_model,
            "num_layers": cfg.vision_encoder.num_layers,
            "num_heads": cfg.vision_encoder.num_heads,
            "output_length": cfg.vision_encoder.output_length,
            "patch_size": cfg.vision_encoder.patch_size,
        }
    if cfg.audio_encoder:
        data["audio_encoder"] = {
            "d_model": cfg.audio_encoder.d_model,
            "num_layers": cfg.audio_encoder.num_layers,
            "num_heads": cfg.audio_encoder.num_heads,
            "sample_rate": cfg.audio_encoder.sample_rate,
        }
    if cfg.kv_cache_sharing:
        data["kv_cache_sharing"] = {
            "frac_shared_layers": cfg.kv_cache_sharing.frac_shared_layers,
            "share_global": cfg.kv_cache_sharing.share_global,
            "share_local": cfg.kv_cache_sharing.share_local,
        }
    return data


def sample_summary(
    prompt: str, model: str = "gemma4-e2b", images: int = 0, audio_seconds: float = 0.0
) -> dict[str, Any]:
    if (
        type(images) is not int
        or images < 0
        or not math.isfinite(audio_seconds)
        or audio_seconds < 0
    ):
        raise ValueError(
            "Media counts must be nonnegative; image count must be an integer"
        )
    if images or audio_seconds:
        raise NotImplementedError(
            "Media counts are not image/audio payloads; use a qualified multimodal provider"
        )
    result = Gemma4Client(model=model).sampler.sample(prompt)
    return dict(
        model=result.model,
        text=result.text,
        token_count=result.token_count,
        latency_ms=result.latency_ms,
        usage_source=result.usage_source,
    )
