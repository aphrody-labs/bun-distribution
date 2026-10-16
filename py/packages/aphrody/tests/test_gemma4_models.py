# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
"""Tests for Gemma 4 family model architectures, configurations, and specs."""

from __future__ import annotations

import pytest

from aphrody.endpoints import (
    GEMMA4_26B_A4B,
    GEMMA4_31B,
    GEMMA4_E2B,
    GEMMA4_E4B,
    GEMMA4_MODELS,
    is_gemma4_model,
)
from aphrody.gemma4 import (
    GEMMA4_26B_A4B_MOE_CONFIG,
    GEMMA4_31B_CONFIG,
    GEMMA4_E2B_CONFIG,
    GEMMA4_E4B_CONFIG,
    AttentionType,
    get_model_config,
    list_models,
)


def test_gemma4_e2b_specs() -> None:
    """Verify DeepMind Gemma 4 E2B parameter configuration."""
    cfg = GEMMA4_E2B_CONFIG
    assert cfg.name == "gemma4-e2b"
    assert cfg.embed_dim == 1536
    assert cfg.hidden_dim == 6144
    assert cfg.num_layers == 35
    assert cfg.num_heads == 8
    assert cfg.head_dim == 256
    assert cfg.num_kv_heads == 1
    assert cfg.num_global_kv_heads is None
    assert cfg.sliding_window_size == 512
    assert cfg.per_layer_input_dim == 256
    assert cfg.enable_moe is False
    assert cfg.kv_cache_sharing is not None
    assert (
        pytest.approx(cfg.kv_cache_sharing.frac_shared_layers, rel=1e-3) == 20.0 / 35.0
    )
    assert cfg.override_kv_shared_ffw_hidden == 12288
    assert cfg.vision_encoder is not None
    assert cfg.vision_encoder.use_clipped_linears is True
    assert cfg.audio_encoder is not None
    assert cfg.audio_encoder.d_model == 512


def test_gemma4_e4b_specs() -> None:
    """Verify DeepMind Gemma 4 E4B parameter configuration."""
    cfg = GEMMA4_E4B_CONFIG
    assert cfg.name == "gemma4-e4b"
    assert cfg.embed_dim == 2560
    assert cfg.hidden_dim == 10240
    assert cfg.num_layers == 42
    assert cfg.num_heads == 8
    assert cfg.head_dim == 256
    assert cfg.num_kv_heads == 2
    assert cfg.enable_moe is False
    assert cfg.kv_cache_sharing is not None
    assert (
        pytest.approx(cfg.kv_cache_sharing.frac_shared_layers, rel=1e-3) == 18.0 / 42.0
    )
    assert cfg.vision_encoder is not None
    assert cfg.audio_encoder is not None
    # 5 local sliding + 1 global attention pattern
    assert len(cfg.attention_pattern) == 6
    assert cfg.attention_pattern[-1] == AttentionType.GLOBAL


def test_gemma4_26b_a4b_moe_specs() -> None:
    """Verify DeepMind Gemma 4 26B/A4B Mixture-of-Experts architecture."""
    cfg = GEMMA4_26B_A4B_MOE_CONFIG
    assert cfg.name == "gemma4-26b-a4b"
    assert cfg.embed_dim == 2816
    assert cfg.hidden_dim == 2112  # Shared dense MLP branch
    assert cfg.num_layers == 30
    assert cfg.num_heads == 16
    assert cfg.head_dim == 256
    assert cfg.num_kv_heads == 8
    assert cfg.num_global_kv_heads == 2
    assert cfg.sliding_window_size == 1024
    assert cfg.k_eq_v_global is True
    assert cfg.enable_moe is True
    assert cfg.num_experts == 128
    assert cfg.expert_dim == 704
    assert cfg.top_k_experts == 8
    assert cfg.moe_dense_hidden_dim == 2112
    assert cfg.vision_encoder is not None
    assert cfg.vision_encoder.d_model == 1152
    assert cfg.vision_encoder.num_layers == 27
    assert cfg.vision_encoder.num_heads == 16
    assert cfg.vision_encoder.output_length == 280
    assert cfg.use_bidirectional_attention == "vision"


def test_gemma4_31b_specs() -> None:
    """Verify DeepMind Gemma 4 31B dense high-capacity model."""
    cfg = GEMMA4_31B_CONFIG
    assert cfg.name == "gemma4-31b"
    assert cfg.embed_dim == 5376
    assert cfg.hidden_dim == 21504
    assert cfg.num_layers == 60
    assert cfg.num_heads == 32
    assert cfg.head_dim == 256
    assert cfg.num_kv_heads == 16
    assert cfg.num_global_kv_heads == 4
    assert cfg.sliding_window_size == 1024
    assert cfg.enable_moe is False
    assert cfg.vision_encoder is not None
    assert cfg.use_bidirectional_attention == "vision"


def test_get_model_config_and_aliases() -> None:
    """Verify lookup with canonical names and dashes/underscores."""
    assert get_model_config("gemma4-e2b") == GEMMA4_E2B_CONFIG
    assert get_model_config("gemma-4-e2b") == GEMMA4_E2B_CONFIG
    assert get_model_config("gemma4-26b-a4b") == GEMMA4_26B_A4B_MOE_CONFIG
    assert get_model_config("gemma-4-26b-a4b") == GEMMA4_26B_A4B_MOE_CONFIG
    assert get_model_config("gemma4-31b") == GEMMA4_31B_CONFIG

    with pytest.raises(ValueError, match="Unknown Gemma 4 model"):
        get_model_config("unknown-model-xyz")


def test_list_models() -> None:
    """Verify list_models returns all 4 Gemma 4 variants."""
    models = list_models()
    assert len(models) == 4
    names = [m["name"] for m in models]
    assert "gemma4-e2b" in names
    assert "gemma4-e4b" in names
    assert "gemma4-26b-a4b" in names
    assert "gemma4-31b" in names

    moe = next(m for m in models if m["name"] == "gemma4-26b-a4b")
    assert moe["enable_moe"] is True
    assert moe["num_experts"] == 128
    assert moe["top_k_experts"] == 8


def test_endpoints_gemma4_constants() -> None:
    """Verify Gemma 4 endpoint definitions and helpers."""
    assert GEMMA4_E2B in GEMMA4_MODELS
    assert GEMMA4_E4B in GEMMA4_MODELS
    assert GEMMA4_26B_A4B in GEMMA4_MODELS
    assert GEMMA4_31B in GEMMA4_MODELS
    assert is_gemma4_model("gemma4-e2b") is True
    assert is_gemma4_model("gemma_4_31b") is True
    assert is_gemma4_model("gemini-2.5-flash") is False
