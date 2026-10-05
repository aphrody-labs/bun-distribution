# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
"""Tests for Gemma 4 multimodal fine-tuning, LoRA adapters, and GGUF export."""

from __future__ import annotations

import json
from pathlib import Path

from aphrody.gemma4 import (
    GEMMA4_26B_A4B_MOE_CONFIG,
    GEMMA4_E2B_CONFIG,
    Gemma4Exporter,
    Gemma4MultimodalDPOTrainer,
    Gemma4MultimodalSFTTrainer,
    LossMaskingStrategy,
    MultimodalDataset,
    MultimodalLoRAConfig,
    MultimodalLoRAModel,
    MultimodalMessage,
    MultimodalSample,
)


def test_multimodal_dataset_validation(tmp_path: Path) -> None:
    """Verify validation of multimodal dataset with images and audio."""
    sample = MultimodalSample(
        id="sample_001",
        messages=[
            MultimodalMessage(
                role="user",
                content="Analyze this diagram and sound effect",
                images=["path/to/diagram.png"],
                audio_paths=["path/to/sound.wav"],
            ),
            MultimodalMessage(
                role="assistant",
                content="The diagram shows a neural network architecture.",
                thought="Processing visual patch grid and audio conformer spectrogram...",
            ),
        ],
    )
    dataset = MultimodalDataset([sample])
    val = dataset.validate()
    assert val["total_samples"] == 1
    assert val["valid_samples"] == 1
    assert val["total_images"] == 1
    assert val["total_audio"] == 1
    assert len(val["errors"]) == 0

    # Test JSONL serialisation / loading
    jsonl_file = tmp_path / "train.jsonl"
    with jsonl_file.open("w", encoding="utf-8") as f:
        json.dump(
            {
                "id": "sample_002",
                "messages": [
                    {"role": "user", "content": "What is 2+2?"},
                    {"role": "assistant", "content": "4"},
                ],
            },
            f,
        )
        f.write("\n")

    loaded_ds = MultimodalDataset.from_jsonl(jsonl_file)
    assert len(loaded_ds.samples) == 1
    assert loaded_ds.samples[0].id == "sample_002"


def test_loss_masking_strategy() -> None:
    """Verify assistant-only loss masking and token formatting."""
    masker = LossMaskingStrategy(GEMMA4_E2B_CONFIG)
    sample = MultimodalSample(
        id="s1",
        messages=[
            MultimodalMessage(
                role="user",
                content="Look at this picture",
                images=["img.jpg"],
            ),
            MultimodalMessage(
                role="assistant",
                content="I see a cat in the image.",
                thought="Detected feline contours.",
            ),
        ],
    )
    mask = masker.compute_loss_mask(sample)
    assert mask["total_tokens"] > 0
    assert mask["supervised_tokens"] > 0
    assert 0.0 < mask["mask_ratio"] < 1.0


def test_multimodal_lora_adapters() -> None:
    """Verify vision, audio, and MoE adapter allocations."""
    # Test dense multimodal (E2B)
    cfg_dense = MultimodalLoRAConfig(
        rank=16,
        alpha=32.0,
        tune_vision_projection=True,
        tune_audio_projection=True,
    )
    model_dense = MultimodalLoRAModel(GEMMA4_E2B_CONFIG, cfg_dense)
    assert "model.vision_projection" in model_dense.adapters
    assert "model.audio_projection" in model_dense.adapters
    assert model_dense.total_trainable_params > 0

    vram = model_dense.estimate_vram_gb()
    assert vram["qlora_4bit_gb"] < vram["lora_bf16_gb"] < vram["full_finetune_gb"]

    # Test MoE multimodal (26B/A4B)
    cfg_moe = MultimodalLoRAConfig(
        rank=8,
        tune_expert_routers=True,
    )
    model_moe = MultimodalLoRAModel(GEMMA4_26B_A4B_MOE_CONFIG, cfg_moe)
    # Ensure router adapters are present
    assert any("moe.router" in name for name in model_moe.adapters)


def test_multimodal_sft_trainer(tmp_path: Path) -> None:
    """Verify end-to-end multimodal SFT execution."""
    sample = MultimodalSample(
        id="s1",
        messages=[
            MultimodalMessage(role="user", content="Describe"),
            MultimodalMessage(role="assistant", content="Complete"),
        ],
    )
    ds = MultimodalDataset([sample])
    trainer = Gemma4MultimodalSFTTrainer("gemma4-e2b")
    result = trainer.train(ds, epochs=2, output_dir=tmp_path / "adapters")
    assert result.epochs == 2
    assert result.initial_loss > result.final_loss
    assert result.trainable_params > 0
    assert Path(result.adapter_checkpoint_path).is_file()


def test_multimodal_dpo_trainer() -> None:
    """Verify multimodal preference pair training."""
    trainer = Gemma4MultimodalDPOTrainer("gemma4-e2b", beta=0.1)
    pairs = [
        {
            "prompt": "Identify object in image",
            "chosen": "A blue sports car parked on the street.",
            "rejected": "A car.",
            "image": "car.png",
        }
    ]
    res = trainer.train_pairs(pairs)
    assert res["pairs_count"] == 1
    assert res["accuracy"] == 1.0
    assert res["average_loss"] > 0


def test_gguf_metadata_exporter(tmp_path: Path) -> None:
    """Verify GGUF metadata export with Gemma 4 context and vision properties."""
    exporter = Gemma4Exporter("gemma4-e2b")
    meta = exporter.generate_gguf_metadata(quantization="Q4_K_M")
    assert meta["general.architecture"] == "gemma4"
    assert meta["general.file_type"] == "Q4_K_M"
    assert meta["gemma4.context_length"] == 131072
    assert meta["gemma4.sliding_window_size"] == 512
    assert "gemma4.vision.embedding_length" in meta

    out_file = tmp_path / "model_manifest.json"
    res = exporter.export_jan_gguf(out_file, quantization="Q4_K_M")
    assert out_file.is_file()
    assert res["general.name"] == "gemma4-e2b"
