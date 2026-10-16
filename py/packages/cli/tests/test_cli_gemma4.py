# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
"""Tests for Gemma 4 CLI commands in :mod:`aphrody_cli.gemma4`."""

from __future__ import annotations

from unittest import mock

import pytest

from aphrody_cli import Aphrody


def test_cli_gemma4_models() -> None:
    """Verify `aphrody gemma4 models` outputs model specifications."""
    cli = Aphrody()
    with mock.patch("aphrody_cli.gemma4._emit") as mock_emit:
        cli.gemma4().models()
        mock_emit.assert_called_once()
        models = mock_emit.call_args[0][0]
        assert len(models) == 4
        names = [m["name"] for m in models]
        assert "gemma4-e2b" in names
        assert "gemma4-26b-a4b" in names


def test_cli_gemma4_inspect() -> None:
    """Verify `aphrody gemma4 inspect` outputs architecture details."""
    cli = Aphrody()
    with mock.patch("aphrody_cli.gemma4._emit") as mock_emit:
        cli.gemma4().inspect("gemma4-26b-a4b")
        mock_emit.assert_called_once()
        spec = mock_emit.call_args[0][0]
        assert spec["name"] == "gemma4-26b-a4b"
        assert spec["enable_moe"] is True
        assert spec["num_experts"] == 128
        assert spec["expert_dim"] == 704
        assert "vision_encoder" in spec


def test_cli_gemma4_chat(native_provider) -> None:
    """Verify `aphrody gemma4 chat` executes and emits text."""
    cli = Aphrody()
    with mock.patch("aphrody_cli.gemma4._emit") as mock_emit:
        cli.gemma4().chat("Say hello", model="gemma4-e2b")
        mock_emit.assert_called_once()
        reply = mock_emit.call_args[0][0]
        assert reply == "42"
        assert (
            native_provider["requests"][0][1]["messages"][-1]["content"] == "Say hello"
        )


def test_cli_gemma4_sample(native_provider) -> None:
    cli = Aphrody()
    with mock.patch("aphrody_cli.gemma4._emit") as emit:
        cli.gemma4().sample("Test sample")
        result = emit.call_args[0][0]
        assert result["token_count"] == 2 and result["usage_source"] == "provider"
    with pytest.raises(NotImplementedError, match="payloads"):
        cli.gemma4().sample("Test sample", images=1, audio_secs=2)


def test_cli_gemma4_tune_multimodal(tmp_path) -> None:
    """Verify `aphrody gemma4 tune_multimodal` runs SFT training."""
    cli = Aphrody()
    with mock.patch("aphrody_cli.gemma4._emit") as mock_emit:
        cli.gemma4().tune_multimodal(
            model="gemma4-e2b",
            epochs=1,
            output_dir=str(tmp_path / "adapters"),
        )
        mock_emit.assert_called_once()
        res = mock_emit.call_args[0][0]
        assert res["model"] == "gemma4-e2b"
        assert res["trainable_params"] > 0
        assert "adapter_checkpoint" in res


def test_cli_gemma4_export_gguf(tmp_path) -> None:
    """Verify `aphrody gemma4 export_gguf` exports GGUF descriptor."""
    cli = Aphrody()
    out_file = str(tmp_path / "model.gguf")
    with mock.patch("aphrody_cli.gemma4._emit") as mock_emit:
        cli.gemma4().export_gguf(model="gemma4-e2b", output=out_file)
        mock_emit.assert_called_once()
        res = mock_emit.call_args[0][0]
        assert res["model"] == "gemma4-e2b"
        assert res["architecture"] == "gemma4"


def test_cli_gemma4_jan_commands(tmp_path) -> None:
    """Verify Jan manifest generation and installation commands."""
    cli = Aphrody()
    with mock.patch("aphrody_cli.gemma4._emit") as mock_emit:
        cli.gemma4().jan_manifest(model="gemma4-e2b")
        mock_emit.assert_called_once()
        manifest = mock_emit.call_args[0][0]
        assert manifest["id"] == "gemma4-e2b"
        assert manifest["engine"] == "nitro"

    with mock.patch("aphrody_cli.gemma4._emit") as mock_emit:
        cli.gemma4().jan_install(model="all", jan_home=str(tmp_path))
        mock_emit.assert_called_once()
        res = mock_emit.call_args[0][0]
        assert res["installed_count"] == 4

    with mock.patch("aphrody_cli.gemma4._emit") as mock_emit:
        cli.gemma4().jan_bridge(port=1337)
        mock_emit.assert_called_once()
        res = mock_emit.call_args[0][0]
        assert res["jan_bridge"] == "active"
