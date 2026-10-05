# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
"""Tests for Jan (janhq/jan) local AI runtime integration."""

from __future__ import annotations

import json
from pathlib import Path

from aphrody.gemma4 import (
    JanBridgeServer,
    JanConfigManager,
    generate_jan_manifest,
)


def test_jan_manifest_generation() -> None:
    """Verify Jan model manifest properties and structure."""
    manifest = generate_jan_manifest("gemma4-e2b", quantization="Q4_K_M")
    assert manifest.id == "gemma4-e2b"
    assert manifest.format == "gguf"
    assert manifest.context_length == 131072
    assert manifest.engine == "nitro"

    d = manifest.to_dict()
    assert d["parameters"]["ctx_len"] == 131072
    assert "<start_of_turn>" in d["prompt_template"]
    assert len(d["files"]) == 1
    assert d["files"][0]["quantization"] == "Q4_K_M"
    assert d["metadata"]["multimodal"] is True


def test_jan_config_manager(tmp_path: Path) -> None:
    """Verify installation of manifests into Jan models registry."""
    mgr = JanConfigManager(jan_home=tmp_path)
    installed_path = mgr.install_manifest("gemma4-e4b", quantization="Q8_0")
    assert installed_path.is_file()

    with installed_path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    assert data["id"] == "gemma4-e4b"
    assert data["files"][0]["quantization"] == "Q8_0"

    all_paths = mgr.install_all_gemma4_manifests()
    assert len(all_paths) == 4
    installed_models = mgr.list_installed_models()
    assert "gemma4-e2b" in installed_models
    assert "gemma4-26b-a4b" in installed_models
    assert "gemma4-31b" in installed_models

    models_index = tmp_path / "models" / "models.json"
    assert models_index.is_file()
    with models_index.open("r", encoding="utf-8") as f:
        idx_data = json.load(f)
    assert len(idx_data) >= 4


def test_jan_bridge_server() -> None:
    """Verify payload translation and SSE formatting for Jan client."""
    bridge = JanBridgeServer(port=1337)
    jan_req = {
        "model": "gemma4-e2b",
        "messages": [
            {"role": "user", "content": "Hello Jan"},
        ],
        "temperature": 0.5,
        "stream": True,
    }
    translated = bridge.translate_jan_request(jan_req)
    assert translated["model"] == "gemma4-e2b"
    assert "<start_of_turn>user\nHello Jan<end_of_turn>" in translated["prompt"]
    assert translated["temperature"] == 0.5
    assert translated["stream"] is True

    chunk = bridge.format_sse_chunk("Hello", model="gemma4-e2b")
    assert chunk.startswith("data: ")
    assert "chat.completion.chunk" in chunk
    assert "Hello" in chunk
