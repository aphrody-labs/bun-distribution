# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
"""Comprehensive test suite for Gemma 4 inference, training, benchmark, eval, and serving."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from aphrody.gemma4 import (
    GEMMA4_26B_A4B_MOE_CONFIG,
    GEMMA4_E2B_CONFIG,
    Gemma4Benchmark,
    Gemma4Client,
    Gemma4DPOTrainer,
    Gemma4Evaluator,
    Gemma4InferenceEngine,
    Gemma4KVCacheManager,
    Gemma4LoRAModel,
    Gemma4MoERouter,
    Gemma4MultimodalProcessor,
    Gemma4NPOTrainer,
    Gemma4SFTTrainer,
    LoRAConfig,
    compute_bleu_score,
    compute_exact_match,
    compute_rouge_l,
    create_chat_completion_response,
    create_kv_cache_sharing_patterns,
    create_models_response,
)


def test_kv_cache_sharing_patterns() -> None:
    """Verify KV cache layer sharing index calculations."""
    e2b_patterns = create_kv_cache_sharing_patterns(GEMMA4_E2B_CONFIG)
    assert len(e2b_patterns) == 35
    # First 15 layers are unshared
    assert e2b_patterns[:15] == list(range(15))
    # Subsequent layers point back to earlier layers
    assert any(idx < 15 for idx in e2b_patterns[15:])

    # Dense without sharing (like 31B)
    from aphrody.gemma4 import GEMMA4_31B_CONFIG

    patterns_31b = create_kv_cache_sharing_patterns(GEMMA4_31B_CONFIG)
    assert patterns_31b == list(range(60))


def test_kv_cache_manager() -> None:
    """Verify memory estimation and shared layer accounting."""
    manager = Gemma4KVCacheManager(GEMMA4_E2B_CONFIG, max_seq_len=2048)
    assert manager.unshared_layer_count == 15
    assert manager.shared_layer_count == 20
    assert manager.total_memory_bytes > 0


def test_moe_router() -> None:
    """Verify top-8 routing for 128-expert Gemma 4 MoE."""
    router = Gemma4MoERouter(GEMMA4_26B_A4B_MOE_CONFIG)
    decision = router.route_token(0)
    assert len(decision.selected_experts) == 8
    assert len(decision.expert_weights) == 8
    assert pytest.approx(sum(decision.expert_weights), abs=1e-3) == 1.0


def test_multimodal_processor() -> None:
    """Verify image patch grid and audio token calculation."""
    proc = Gemma4MultimodalProcessor(GEMMA4_E2B_CONFIG)
    img_info = proc.process_image(448, 448)
    assert img_info["tokens"] == 280
    assert img_info["patch_grid"] == (28, 28)

    aud_info = proc.process_audio(duration_seconds=2.5)
    assert aud_info["tokens"] == int(2.5 * 128)


def test_inference_engine_prefill() -> None:
    """Verify full prefill calculation in InferenceEngine."""
    engine = Gemma4InferenceEngine("gemma4-e2b")
    res = engine.prefill("Translate this into French", image_dims=[(448, 448)])
    assert res["model"] == "gemma4-e2b"
    assert res["image_tokens"] == 280
    assert res["total_prefill_tokens"] >= 284
    assert res["kv_cache_memory_mb"] > 0


def test_lora_adapter_model(tmp_path: Path) -> None:
    """Verify LoRA adapter parameters and export."""
    lora_cfg = LoRAConfig(rank=16, alpha=32.0)
    lora_model = Gemma4LoRAModel(GEMMA4_E2B_CONFIG, lora_cfg)
    assert lora_model.total_trainable_params > 0
    assert len(lora_model.adapters) > 0

    save_path = tmp_path / "adapter.json"
    meta = lora_model.save_adapter(save_path)
    assert meta["base_model"] == "gemma4-e2b"
    assert meta["rank"] == 16
    assert save_path.is_file()


def test_sft_trainer() -> None:
    """Verify Supervised Fine-Tuning execution."""
    trainer = Gemma4SFTTrainer("gemma4-e2b")
    dataset = [
        {"prompt": "Hi", "response": "Hello there!"},
        {"prompt": "What is Python?", "response": "Python is a language."},
    ]
    res = trainer.train(dataset, epochs=2)
    assert res.epochs == 2
    assert res.initial_loss > res.final_loss
    assert res.trainable_params > 0


def test_dpo_trainer() -> None:
    """Verify Direct Preference Optimization loss."""
    trainer = Gemma4DPOTrainer("gemma4-e2b", beta=0.1)
    pairs = [{"prompt": "Test", "chosen": "Good answer here", "rejected": "Bad"}]
    summary = trainer.train_pairs(pairs)
    assert summary["pairs_evaluated"] == 1
    assert summary["average_dpo_loss"] > 0
    assert summary["preference_accuracy"] == 1.0


def test_npo_trainer() -> None:
    """Verify Negative Preference Optimization loss."""
    trainer = Gemma4NPOTrainer("gemma4-e2b", alpha=0.2)
    res = trainer.compute_loss(unlearn_logprob=-1.2, ref_unlearn_logprob=-0.8)
    assert "npo_loss" in res
    assert res["npo_loss"] > 0


def test_benchmark_suite() -> None:
    """Verify full benchmark execution."""
    bench = Gemma4Benchmark("gemma4-e2b")
    report = bench.run_full()
    assert report.tokens_per_second > 0
    assert report.time_to_first_token_ms >= 0
    assert report.peak_memory_mb > 0
    assert report.kv_cache_savings_mb > 0


def test_evaluation_metrics() -> None:
    """Verify linguistic evaluation metrics."""
    assert compute_exact_match("hello world", "Hello World ") == 1.0
    assert compute_exact_match("foo", "bar") == 0.0

    bleu = compute_bleu_score("the cat sat on mat", "the cat sat on the mat")
    assert bleu > 0.5

    rouge = compute_rouge_l("the cat sat", "the cat sat on mat")
    assert rouge > 0.6

    evaluator = Gemma4Evaluator("gemma4-e2b")
    summary = evaluator.evaluate_dataset(
        [{"prediction": "Fast model", "reference": "Fast model"}]
    )
    assert summary.exact_match == 1.0


def test_api_server_payloads(native_provider) -> None:
    """Verify OpenAI-compatible response payloads."""
    comp = create_chat_completion_response("What is 1+1?", model="gemma4-e2b")
    assert comp["object"] == "chat.completion"
    assert len(comp["choices"]) == 1
    assert comp["choices"][0]["message"]["content"] == "42"
    assert comp["usage"]["total_tokens"] == 12
    assert comp["usage_source"] == "provider"

    models_resp = create_models_response()
    assert models_resp["object"] == "list"
    assert len(models_resp["data"]) == 4


def test_async_client(native_provider) -> None:
    """Verify async chat and stream on Gemma4Client."""

    async def run() -> None:
        client = Gemma4Client("gemma4-e2b")
        resp = await client.achat("Async turn")
        assert resp == "42"
        tokens = []
        async for chunk in client.astream_chat("Async stream"):
            tokens.append(chunk)
        assert "".join(tokens) == "42"

    asyncio.run(run())
